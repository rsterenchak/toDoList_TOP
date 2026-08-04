// Shared, project-scoped cache of `agent_queue` rows plus the live realtime
// subscription that keeps it current. Extracted out of agentView.js so BOTH the
// Agent board (agentView.js) and the task-row layer (toDoRow.js / phase.js) read
// ONE store rather than two.
//
// The task rows surface a `needs_words` triage question inline — an `⌁ ASKING`
// badge plus an answer field in the row's description panel — and that means the
// row layer has to resolve a todo's linked queue row SYNCHRONOUSLY on the render
// path (derivePhase can't await). The rows therefore have to be in memory before
// the Agent tab is ever opened, which the old board-only cache never guaranteed
// (it populated only on Agent mount). Owning the cache here — together with the
// realtime channel, the unsent-answer draft map, and the triage in-flight guard —
// lets the board and the rows read a single source and never drift.
//
// This module deliberately holds only DATA + the subscription. Rendering
// (paint/settle for the board; badge + description block for the row) stays in
// the consuming view: on a realtime push the store fetches ONCE and notifies its
// listeners, which repaint from cache.

import { supabase } from './supabaseClient.js';
import { listLogic } from './listLogic.js';

// The terminal `agent_queue` state that means a dispatched run merged. A row
// reaching it is the one event that guarantees the target repo's TODO.md just
// changed (the entry's checkbox flipped to `[x]`), so it is the trigger for a
// forced shipped-marker refresh — see refreshMarkersForShippedTransitions.
const SHIPPED_STATE = 'shipped';

// The rows last loaded for a project, and which project they belong to. The
// realtime channel is app-lifetime (see startAgentQueueSubscription) so the
// task-row badges stay live on the list view, not just while the Agent tab is
// mounted.
let _rows = [];
let _loadedProjectName = null;
let _channel = null;

// The all-projects `agent_queue` cache — every one of the user's rows across ALL
// projects, held SEPARATELY from `_rows`. `_rows` stays scoped to the selected
// project so `getQueueRowForTodo` (the synchronous render-path lookup) keeps
// returning only the on-screen project's rows; re-scoping it would change what
// that returns for every task row. This second cache feeds the project
// switcher's per-project "triage question waiting" count, which has to reason
// over projects that are NOT currently on screen. RLS already scopes
// `agent_queue` to the user, so one select with no `project_id` filter returns
// every project's rows in a single round trip.
let _allRows = [];

// Short in-flight guard shared by every triage-sweep dispatcher — the Agent
// board's header Run button, the board's answer-submit auto-fire, and the task
// row's answer-submit auto-fire — so a rapid double-tap or two answers in the
// same tick can't fire redundant sweeps. Lives here (not in agentView.js) so it
// covers callers on both surfaces.
let _triageInFlight = false;

// Consumers that repaint from cache after a realtime push has reloaded the rows.
const _listeners = new Set();

// In-progress, unsent needs_words answers, keyed by agent_queue row id → the
// current textarea text. A realtime-push repaint (or a task-row rebuild) tears
// down the answer textarea and builds a fresh empty one, silently dropping
// whatever the user typed but hadn't sent. Both surfaces mirror the draft here on
// every keystroke and re-apply it after a rebuild, so an unsent answer survives —
// and an answer typed on one surface appears on the other, since they share this
// one store. Cleared on a successful send. Session-scoped only.
export const pendingAnswers = new Map();

// The Agent board's triage-sweep dispatcher, registered by agentView.js so the
// task-row answer path can fire the EXACT same sweep (driving the same header
// pill, sharing the same in-flight guard) without importing agentView.js — the
// row layer must not, to avoid the toDoRow → agentView import cycle. Null until
// the Agent module registers it (it does so at module load).
let _triageDispatcher = null;
export function setTriageDispatcher(fn) {
    _triageDispatcher = typeof fn === 'function' ? fn : null;
}
// Fire a triage sweep for the named project through the registered board
// dispatcher. Resolves to null when nothing is registered (Agent module not
// loaded) so a caller can treat it as a no-op rather than throwing.
export function fireTriageSweep(projectName) {
    if (_triageDispatcher) return Promise.resolve(_triageDispatcher(projectName));
    return Promise.resolve(null);
}

// The project-scoped shipped-marker refresher (`refreshShippedMarkersForProject`
// in inject.js), registered by inject.js at module load. Held via a setter — not
// a static import — because inject.js pulls in modals → agentView, whose
// top-level `setTriageDispatcher` call reaches back into this module: importing
// inject here would re-enter this file before its own `let`s initialize (a TDZ
// crash). Same registration idiom as the triage dispatcher above. Null until
// inject registers, so the refresh is a safe no-op before then.
let _shippedMarkerRefresher = null;
export function setShippedMarkerRefresher(fn) {
    _shippedMarkerRefresher = typeof fn === 'function' ? fn : null;
}

// The Worker-call helpers the persistent dispatch reconciler needs, registered by
// inject.js at module load (same setter idiom, and for the same TDZ-avoidance
// reason, as setShippedMarkerRefresher above — the store must not statically
// import inject.js). The bundle carries `pollRunStatus`, `fetchRunResult`,
// `resolveEntryByMarker`, `findTargetById`, `refreshShippedMarkersForProject`, and
// `resolveEntryRunState`. Null until inject registers, so the reconciler degrades
// to a no-op before then (and under a stub that never registers).
let _reconcilerDeps = null;
export function setDispatchReconcilerDeps(deps) {
    _reconcilerDeps = (deps && typeof deps === 'object') ? deps : null;
}

// Read-only view of the cache; always an array.
export function getQueueRows() {
    return Array.isArray(_rows) ? _rows : [];
}
export function getLoadedProjectName() {
    return _loadedProjectName;
}
// Overwrite the cache. `projectName` (optional) records which project the rows
// belong to; omit it to leave the loaded-project marker untouched.
export function setQueueRows(rows, projectName) {
    _rows = Array.isArray(rows) ? rows : [];
    if (projectName !== undefined) _loadedProjectName = projectName;
}

// Recency key for a queue row, used to break ties when a single todo links more
// than one agent_queue row (see getQueueRowForTodo). `created_at` reflects when
// the row was created, which is the signal we want: a fresh direct-injection
// dispatch row is created AFTER the stale row it should supersede. Falls back to
// `updated_at`, then to -Infinity when neither is present or parseable — a row
// with a timestamp always outranks one without, and two timestamp-less rows tie
// (so the first-encountered wins, preserving the original first-match behavior).
function queueRowRecency(row) {
    const raw = (row && (row.created_at || row.updated_at)) || null;
    if (!raw) return -Infinity;
    const t = Date.parse(raw);
    return Number.isNaN(t) ? -Infinity : t;
}

// Synchronous lookup of a todo's linked agent_queue row (agent_queue.todo_id ===
// todoId). Used by derivePhase on the render path — returns null when nothing is
// cached or nothing links, so a row with no queue row is unaffected.
//
// A todo can accumulate MORE THAN ONE queue row: e.g. a task whose mockup
// generation is deferred leaves a stale `needs_mockup` row, and pivoting to a
// direct inject then creates a second, newer `dispatched` row. First-match would
// return whichever the cache happened to list first — often the stale one — which
// pins derivePhase in PHASE.MOCKUP so the row never paints its pending glyph.
// Return the MOST RECENT matching row instead (by created_at, then updated_at),
// so the current run wins; a strictly-greater comparison keeps the
// first-encountered row on a tie, so the single-row common case is unchanged.
export function getQueueRowForTodo(todoId) {
    if (!todoId) return null;
    const rows = getQueueRows();
    let best = null;
    let bestTs = -Infinity;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.todo_id !== todoId) continue;
        const ts = queueRowRecency(row);
        if (best === null || ts > bestTs) {
            best = row;
            bestTs = ts;
        }
    }
    return best;
}

export function isTriageInFlight() { return _triageInFlight; }
export function setTriageInFlight(v) { _triageInFlight = !!v; }

// Read-only view of the all-projects cache; always an array.
export function getAllQueueRows() {
    return Array.isArray(_allRows) ? _allRows : [];
}

// Per-project count of triage questions still waiting on the user — the amber
// number the project switcher paints next to each project. A row counts ONLY
// when it is parked in `needs_words` (a pending triage question, the ASKING
// state). Nothing else is included: shipped-but-unreviewed entries and landed
// drafts are deliberately out of scope, and counting drafts would require each
// project's todos in memory (which broke an earlier attempt). Returns a
// `{ [projectName]: count }` map with only non-zero projects present.
//
// Reads NO todo data. It resolves each queue row's `project_id` to a project
// NAME through the same in-memory model the store already uses
// (`listLogic.getProjectId`), so an unresolvable id contributes nothing and
// reads as zero downstream rather than raising. Reads the all-rows cache
// synchronously; degrades to `{}` when it is empty (e.g. under the stub client,
// where the all-fetch resolves to `[]`) and never throws — the switcher's render
// leans on this so a broken count source can never abort its project list.
export function getWaitingQuestionCounts() {
    const counts = {};
    try {
        const rows = getAllQueueRows();
        if (!rows.length) return counts;
        // Reverse-map project id → name from the in-memory model so each queue
        // row's `project_id` resolves to the switcher row it belongs to. A name
        // whose id is not yet known simply never enters the map, so it counts as
        // zero rather than raising.
        const names = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
        const idToName = {};
        for (let i = 0; i < names.length; i++) {
            const pid = listLogic.getProjectId(names[i]);
            if (pid) idToName[pid] = names[i];
        }
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.state !== 'needs_words') continue;
            const name = idToName[row.project_id];
            if (!name) continue;
            counts[name] = (counts[name] || 0) + 1;
        }
    } catch (e) {
        return {};
    }
    return counts;
}

// Query agent_queue for one project's rows. Written to survive both the live
// Supabase client (a chainable, awaitable query builder) and the test/stub
// client (whose .select() resolves immediately and has no .eq); a synchronous
// throw from the incompatible chain is caught and treated as "no rows", so the
// view degrades to an empty board rather than crashing.
export function fetchQueueRows(projectId) {
    return new Promise(function (resolve) {
        try {
            Promise.resolve(
                supabase.from('agent_queue').select('*').eq('project_id', projectId)
            ).then(function (res) {
                if (res && res.error) { resolve([]); return; }
                resolve((res && res.data) || []);
            }).catch(function () { resolve([]); });
        } catch (e) {
            resolve([]);
        }
    });
}

// Query agent_queue for EVERY project's rows in a single round trip. RLS already
// scopes the table to the user, so a select with no `project_id` filter returns
// all of the user's rows. Same stub-client survival contract as fetchQueueRows:
// the test client's `.select()` carries no row data of its own, so the wrapped
// result has no `data`/`error` and this resolves to `[]` — the switcher degrades
// to no counts rather than crashing.
export function fetchAllQueueRows() {
    return new Promise(function (resolve) {
        try {
            Promise.resolve(
                supabase.from('agent_queue').select('*')
            ).then(function (res) {
                if (res && res.error) { resolve([]); return; }
                const rows = (res && res.data) || [];
                reconcileShippedStamps(rows);
                resolve(rows);
            }).catch(function () { resolve([]); });
        } catch (e) {
            resolve([]);
        }
    });
}

// Repair the `shipped_at` invariant across every already-loaded queue row.
// `settleShipped` stamps the linked todo exactly once, at settle time, and does
// not gate the ship on that stamp succeeding — so a stamp that fails in that one
// moment (most plausibly a startup reconcile settling rows before the todos have
// hydrated, making listLogic's in-memory scan miss the todo) is never retried,
// and the row reaches `shipped` with a todo that carries no `shippedAt`. The
// derived REVIEW/DONE phase then rests solely on the TODO.md marker and a
// `clear all entries` wipes it. This pass makes the stamp a repairable invariant
// instead of a one-shot: for every row already at `shipped` carrying a
// `todo_id`, re-stamp its todo. `stampEntryShipped` is idempotent (an
// already-stamped todo keeps its original time), so this is safe to run on every
// load and needs no separate migration for rows stranded before this shipped —
// they repair on the next pass. Gated on todos actually being hydrated: before
// hydration the scan would miss a todo that exists on the server, so the pass
// skips and retries on the next load rather than firing a doomed lookup per row.
// Best-effort like the settle stamp — a not-yet-loaded todo is left for the next
// pass, not warned about, since this pass exists precisely to be re-run.
export function reconcileShippedStamps(rows) {
    if (!listLogic.hasHydratedTodos()) return;
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
        if (!row || row.state !== 'shipped' || !row.todo_id) return;
        try {
            listLogic.stampEntryShipped(row.todo_id);
        } catch (e) {
            /* transient — the pass re-runs on the next load and repairs then */
        }
    });
}

// Reload the all-projects cache. Resolves to the cached rows. Does NOT repaint or
// notify — the caller decides what to re-render. Used for the switcher's initial
// paint; realtime pushes refresh it alongside the selected-project cache.
export function loadAllQueueRows() {
    return fetchAllQueueRows().then(function (rows) {
        _allRows = Array.isArray(rows) ? rows : [];
        return getAllQueueRows();
    });
}

// Re-scope and reload the cache for a project. Sets `_loadedProjectName`
// synchronously (the stale-guard anchor) and applies the fetched rows only when
// that project is still the loaded one, so a stale in-flight fetch from a
// since-abandoned project can't clobber a newer load. Resolves to the cached
// rows. Does NOT repaint or notify — the caller decides what to re-render.
export function loadQueueRows(projectName) {
    _loadedProjectName = projectName;
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    if (!projectId) {
        _rows = [];
        return Promise.resolve(getQueueRows());
    }
    return fetchQueueRows(projectId).then(function (rows) {
        if (_loadedProjectName === projectName) {
            _rows = Array.isArray(rows) ? rows : [];
        }
        return getQueueRows();
    });
}

// Register a change listener, invoked after a realtime push has reloaded the
// store. Returns an unsubscribe thunk.
export function onQueueChange(listener) {
    if (typeof listener === 'function') _listeners.add(listener);
    return function () { _listeners.delete(listener); };
}
export function notifyQueueChange() {
    _listeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
}

// Resolve the selected project from the sidebar — the same source agentView and
// the row layer read — so a realtime push reloads the on-screen project's rows.
function resolveSelectedProjectName() {
    if (typeof document === 'undefined') return '';
    const selected = document.querySelector('.selectedProject');
    if (!selected) return '';
    const input = selected.querySelector('#projInput');
    return input ? (input.value || '').trim() : '';
}

// Reverse-map project id → name from the in-memory model, so a queue row's
// `project_id` resolves to the project it belongs to. A name whose id is not
// yet known simply never enters the map (reads as unresolvable downstream).
function buildProjectIdToNameMap() {
    const idToName = {};
    const names = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
    for (let i = 0; i < names.length; i++) {
        const pid = listLogic.getProjectId(names[i]);
        if (pid) idToName[pid] = names[i];
    }
    return idToName;
}

// After a realtime push has reloaded the all-projects cache, force a
// shipped-marker refresh for any project whose queue row just transitioned INTO
// the terminal `shipped` state. This is the one event that guarantees TODO.md
// changed: a run that merges on Actions never goes through the client ship
// path's forced refresh (`shipEntry.js`), so without this the row keeps reading
// the pre-merge marker cache (up to a TTL stale) and shows its pending glyph
// instead of flipping to `⌁ REVIEW`.
//
// Fires ONLY on the transition edge (prev state !== shipped, new state ===
// shipped) so ordinary triage churn does not put a GitHub read behind every
// push. Dedups by project so several rows shipping together produce one forced
// refresh per project (and `refreshShippedMarkers` further coalesces per repo
// via its in-flight map). Resolves each row's project from its own
// `project_id`, NOT the selected project, since a run can finish for a project
// the user is not looking at. Never throws — a push handler must not break.
export function refreshMarkersForShippedTransitions(prevRows, currentRows) {
    try {
        const prevState = new Map();
        const pRows = Array.isArray(prevRows) ? prevRows : [];
        for (let i = 0; i < pRows.length; i++) {
            const r = pRows[i];
            if (r && r.id != null) prevState.set(r.id, r.state);
        }
        const cRows = Array.isArray(currentRows) ? currentRows : [];
        const projectIds = new Set();
        for (let i = 0; i < cRows.length; i++) {
            const row = cRows[i];
            if (!row || row.state !== SHIPPED_STATE) continue;
            // Skip rows that were already shipped before this push — only a
            // fresh transition into shipped warrants a fetch.
            if (row.id != null && prevState.get(row.id) === SHIPPED_STATE) continue;
            if (row.project_id != null) projectIds.add(row.project_id);
        }
        if (!projectIds.size) return;
        if (!_shippedMarkerRefresher) return;
        const idToName = buildProjectIdToNameMap();
        projectIds.forEach(function (pid) {
            const name = idToName[pid];
            if (name) _shippedMarkerRefresher(name, true);
        });
    } catch (e) { /* never let a realtime push handler throw */ }
}

// Open the realtime subscription on agent_queue. Idempotent. On each push it
// reloads the selected project's rows ONCE, then notifies listeners to repaint
// from cache — so the board and the task rows update from a single fetch. The
// channel is user-scoped by RLS. Unlike the old board-only channel this is NOT
// torn down on Agent-tab exit: the task rows need live updates on the list view
// too, so it is started once and left open (mirroring the persistent working
// watch's own channel in agentView.js).
export function startAgentQueueSubscription() {
    if (_channel || !supabase || typeof supabase.channel !== 'function') return;
    try {
        _channel = supabase
            .channel('public:agent_queue')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'agent_queue' },
                function () {
                    // One push refreshes BOTH the selected-project cache (task-row
                    // badges) and the all-projects cache (the switcher's per-project
                    // question counts); listeners then repaint both surfaces from
                    // cache. Reuses this single app-lifetime channel rather than
                    // opening a second subscription for the switcher counts.
                    //
                    // Snapshot the all-projects rows BEFORE the reload so a row's
                    // transition into the terminal shipped state can be detected
                    // against the prior cache (loadAllQueueRows REPLACES `_allRows`
                    // rather than mutating it, so this reference stays the old set).
                    const prevAllRows = getAllQueueRows();
                    Promise.all([
                        loadQueueRows(resolveSelectedProjectName()),
                        loadAllQueueRows(),
                    ]).then(function () {
                        // A run that merges on Actions flips its queue row to
                        // `shipped` without the client ship path's forced marker
                        // refresh, so force one here for any project whose row just
                        // reached shipped — the row then repaints to `⌁ REVIEW` via
                        // the TODO_RUN_STATUS_EVENT refreshShippedMarkers emits.
                        refreshMarkersForShippedTransitions(prevAllRows, getAllQueueRows());
                        notifyQueueChange();
                    });
                })
            .subscribe();
    } catch (e) {
        _channel = null;
    }
}
export function stopAgentQueueSubscription() {
    if (_channel && supabase && typeof supabase.removeChannel === 'function') {
        try { supabase.removeChannel(_channel); } catch (e) { /* ignore */ }
    }
    _channel = null;
}

// ── PERSISTENT DISPATCH RECONCILER ────────────────────────────────────
// A mount-INDEPENDENT poller that settles dispatched runs no matter which surface
// dispatched them or what is on screen. It was extracted here out of agentView.js,
// whose per-row pollers only ran while the Agent BOARD was mounted — so a run
// dispatched from the task row or the detail pane (the normal path now) never
// settled: its queue row stayed `dispatched` forever, the nav working dot stayed
// lit, and the row never flipped to REVIEW. Mirroring the persistent working
// watch's shape (one module-level started flag, one interval, no dependence on a
// mounted view), it lives in the store — the shared owner of the queue cache and
// the realtime channel — so the board and the row layer both reach ONE poller
// rather than racing two. The reconciliation LOGIC is unchanged from the board's:
// a completed run is proven shipped by the entry's checkbox on main (didEntryShip),
// else settled to no_change with the run's closing summary.

// Poll cadence and give-up window for a dispatched run. Match the board poller
// they replace: a completed run is normally observed within minutes, and a run
// that GitHub Actions no longer surfaces (aged out of the status window) can only
// be settled by the checkbox signal, which the startup/mount backlog pass covers.
const RECONCILE_POLL_MS = 5000;
const RECONCILE_GIVE_UP_MS = 15 * 60 * 1000;

// Workflow conclusions that positively mean the run failed — mirrors the board's
// FAILURE_CONCLUSIONS. Any other completed conclusion (neutral / skipped / none)
// keeps the row in-progress rather than asserting failure.
const RECONCILE_FAILURE_CONCLUSIONS = ['failure', 'cancelled', 'timed_out'];

let _reconcilerStarted = false;
let _reconcilePoller = null;
// rowId → ms first watched; the give-up window's anchor. Set the first tick a row
// is seen in flight (its real dispatch time is unknown for a stranded row).
const _rowStartedAt = new Map();
// rowIds past the give-up window: skip status-polling them, but the checkbox
// backlog pass can still settle a genuinely-shipped one.
const _rowGaveUp = new Set();
// rowIds with a settle in flight — the double-settle guard. A row being settled by
// one path (a poll tick) must not be settled again by another (a concurrent
// backlog pass, or the board's mount kick), so both consult this set.
const _settleInFlight = new Set();

// Every in-flight (dispatched/running) row across ALL projects, read from the
// all-projects cache so a run finishing for a project the user is not looking at
// still settles.
function getInFlightRows() {
    return getAllQueueRows().filter(function (r) {
        return r && (r.state === 'dispatched' || r.state === 'running');
    });
}

// Resolve a queue row's project name from its own `project_id` (NOT the selected
// project — a background reconcile spans projects). '' when unresolvable.
function resolveRowProjectName(row) {
    if (!row || row.project_id == null) return '';
    const idToName = buildProjectIdToNameMap();
    return idToName[row.project_id] || '';
}

// Resolve a queue row's routed inject target (repo/filePath) from its project,
// via the same getProjectTargetId → findTargetById path resolveDispatchTarget
// uses. null when there's no routing (the Worker then falls back to its default
// repo), mirroring the board's target resolution.
function resolveRowTarget(row) {
    if (!_reconcilerDeps) return null;
    const name = resolveRowProjectName(row);
    if (!name) return null;
    const targetId = listLogic.getProjectTargetId(name);
    return targetId ? _reconcilerDeps.findTargetById(targetId) : null;
}

// Run `fn` under the row's settle guard: skip if a settle is already in flight for
// the row, otherwise mark it in-flight, run, and clear on resolve OR reject. This
// is what keeps a poll tick and a concurrent backlog/mount pass from double-
// settling the same row.
function withSettleGuard(rowId, fn) {
    if (_settleInFlight.has(rowId)) return Promise.resolve();
    _settleInFlight.add(rowId);
    return Promise.resolve().then(fn).then(function (v) {
        _settleInFlight.delete(rowId);
        return v;
    }, function () {
        _settleInFlight.delete(rowId);
    });
}

// Reload BOTH caches and notify listeners so a mounted board / the task rows
// repaint after a settle even where realtime isn't observed (the stub client).
// notifyQueueChange also re-runs evaluateReconciler (registered as a listener),
// which prunes tracking for the just-settled row and stops the interval when
// nothing is left in flight.
function refreshQueueAndNotify() {
    return Promise.all([
        loadQueueRows(resolveSelectedProjectName()),
        loadAllQueueRows(),
    ]).then(function () {
        notifyQueueChange();
    });
}

// Whether a completed dispatched run actually shipped. The lag-free signal is the
// entry's checkbox on main: force the project's shipped-marker cache current
// (coalesced per repo with any concurrent refresh via inject's in-flight map, so
// this REUSES the marker path rather than issuing a second TODO.md read), then read
// the checkbox from the cache — 'shipped' → true, 'pending' → false. Only when the
// marker is absent from the cache (a failed read, or the entry is gone) do we fall
// back to the merged-PR marker search, so a transient miss never mislabels a real
// ship as no_change.
function didEntryShip(projectName, entryId) {
    if (!_reconcilerDeps) return Promise.resolve(false);
    return Promise.resolve(_reconcilerDeps.refreshShippedMarkersForProject(projectName, true))
        .then(function () {
            const state = _reconcilerDeps.resolveEntryRunState(entryId);
            if (state === 'shipped') return true;
            if (state === 'pending') return false;
            return null; // absent — fall back to the PR-marker search
        }, function () { return null; })
        .then(function (decided) {
            if (decided !== null) return decided;
            return Promise.resolve(_reconcilerDeps.resolveEntryByMarker(entryId)).then(function (resolved) {
                return !!(resolved && resolved.ok && resolved.found === true && resolved.merge_commit_sha);
            }, function () { return false; });
        });
}

// Best-effort PR link for a shipped entry. Resolving the marker to a closed PR lags
// GitHub's index, so this only decorates the Shipped card's link — the shipped
// transition is never gated on it; a missing link fills in on a later poll.
function bestEffortPrLink(entryId) {
    if (!_reconcilerDeps) return Promise.resolve({ pr_url: '', pr_number: undefined });
    return Promise.resolve(_reconcilerDeps.resolveEntryByMarker(entryId)).then(function (resolved) {
        if (resolved && resolved.ok && resolved.found === true) {
            return {
                pr_url: resolved.pr_url || resolved.html_url || '',
                pr_number: resolved.pr_number != null ? resolved.pr_number : undefined,
            };
        }
        return { pr_url: '', pr_number: undefined };
    }, function () { return { pr_url: '', pr_number: undefined }; });
}

// A completed run's closing summary (the agent's verdict), surfaced on a no_change
// / failed row. Keyed by run id when known, else the correlation id (the Worker
// resolves either). Degrades to '' on any failure so the row falls back to a
// friendly default line.
function fetchClosingSummary(runId, correlationId, target) {
    if (!_reconcilerDeps) return Promise.resolve('');
    const key = (runId != null && runId !== '') ? runId : correlationId;
    return Promise.resolve(_reconcilerDeps.fetchRunResult(key, target || null)).then(function (res) {
        if (res && res.ok && typeof res.result === 'string') return res.result.trim();
        return '';
    }, function () { return ''; });
}

// Stamp `shipped_at` on the settled row's linked todo via listLogic (never a
// direct Supabase write — the store owns queue rows, listLogic owns todos). Best-
// effort and non-blocking in the SAME sense as the PR link: a missing todo id or a
// stamp failure is SURFACED with a warning but must not prevent the row reaching
// `shipped`, and a silently-unstamped ship is the exact regression this guards, so
// the failure is never swallowed quietly. listLogic makes the stamp idempotent, so
// a re-settling tick won't overwrite an earlier ship time. Never throws.
function stampShippedTodo(todoId) {
    if (!todoId) {
        console.warn('settleShipped: settled row has no todo_id; shipped_at not stamped');
        return;
    }
    try {
        const res = listLogic.stampEntryShipped(todoId);
        if (!res || res.ok !== true) {
            console.warn('settleShipped: failed to stamp shipped_at on todo '
                + todoId + ': ' + ((res && res.error) || 'unknown error'));
        }
    } catch (e) {
        console.warn('settleShipped: error stamping shipped_at on todo ' + todoId, e);
    }
}

// Persist a row to `shipped`, attaching the run id and a best-effort PR link
// (resolved without blocking the ship — a missing link still ships), and record
// the ship in the database by stamping `shipped_at` on the linked todo so the
// derived REVIEW/DONE phase survives a TODO.md rewrite. Takes the full row (like
// resolveRowProjectName / resolveRowTarget) so it can read `row.todo_id` without a
// new parameter threaded through the callers. The stamp is best-effort and does
// NOT gate the ship: a failed stamp is surfaced but the row still reaches shipped.
function settleShipped(row, entryId, runId) {
    const patch = { state: 'shipped' };
    if (runId != null) patch.run_id = runId;
    return bestEffortPrLink(entryId).then(function (link) {
        if (link.pr_url) patch.pr_url = link.pr_url;
        if (link.pr_number != null) patch.pr_number = link.pr_number;
        stampShippedTodo(row.todo_id);
        return listLogic.setAgentRunState(row.id, patch);
    });
}

// Reconcile a completed run into a terminal state. A green conclusion alone isn't
// proof of a ship — the routine can exit clean having merged nothing — so consult
// the entry's checkbox on main: checked → shipped + a best-effort PR link; still
// unchecked → a no-change run whose closing summary we surface.
function reconcileShipped(row, runId) {
    const projectName = resolveRowProjectName(row);
    const target = resolveRowTarget(row);
    return didEntryShip(projectName, row.entry_id).then(function (shipped) {
        if (shipped) return settleShipped(row, row.entry_id, runId);
        return fetchClosingSummary(runId, row.correlation_id, target).then(function (summary) {
            return listLogic.setAgentRunState(row.id, {
                state: 'no_change',
                failure_reason: summary || 'The run finished without merging any changes.',
                run_id: runId,
            });
        });
    }).then(refreshQueueAndNotify);
}

// One poll tick for a single dispatched row. Mirrors the board's pollDispatchOnce:
// completed+success reconciles success against the checkbox proof; a recognized
// failure conclusion flips to failed with the closing summary; any other completed
// conclusion (neutral/skipped/none) is NOT a positive failure and keeps the row
// in-progress; queued/running reflect the live state. Exported so a test can drive
// one reconcile without the interval.
export function reconcileDispatchRow(row) {
    if (!_reconcilerDeps || !row || !row.id) return Promise.resolve();
    const rowId = row.id;
    if (_settleInFlight.has(rowId)) return Promise.resolve();
    const target = resolveRowTarget(row);
    return Promise.resolve(_reconcilerDeps.pollRunStatus({ correlationId: row.correlation_id, target: target || null }))
        .then(function (res) {
            if (!res || res.ok === false) return; // transient — keep polling
            if (res.found === false) return; // run not surfaced yet — stay dispatched
            if (res.status === 'completed') {
                if (res.conclusion === 'success') {
                    _rowGaveUp.delete(rowId);
                    return withSettleGuard(rowId, function () { return reconcileShipped(row, res.runId); });
                }
                if (RECONCILE_FAILURE_CONCLUSIONS.indexOf(res.conclusion) !== -1) {
                    _rowGaveUp.delete(rowId);
                    return withSettleGuard(rowId, function () {
                        return fetchClosingSummary(res.runId, row.correlation_id, target).then(function (summary) {
                            return listLogic.setAgentRunState(rowId, {
                                state: 'failed',
                                failure_reason: summary || 'The run failed.',
                                run_id: res.runId,
                            });
                        }).then(refreshQueueAndNotify);
                    });
                }
                return; // neutral / skipped / no conclusion — keep polling
            }
            const desired = res.status === 'queued' ? 'dispatched' : 'running';
            if (row.state !== desired) {
                return listLogic.setAgentRunState(rowId, { state: desired }).then(refreshQueueAndNotify);
            }
        })
        .catch(function () { /* transient — keep polling */ });
}

// One interval tick: poll every in-flight row across all projects. Sets each row's
// give-up anchor on first sight, skips rows past the window (or already settling),
// and reconciles the rest.
function reconcileTick() {
    const rows = getInFlightRows();
    const now = Date.now();
    rows.forEach(function (row) {
        if (!row || !row.correlation_id || !row.entry_id) return;
        if (_rowGaveUp.has(row.id) || _settleInFlight.has(row.id)) return;
        if (!_rowStartedAt.has(row.id)) _rowStartedAt.set(row.id, now);
        if (now - _rowStartedAt.get(row.id) >= RECONCILE_GIVE_UP_MS) {
            _rowGaveUp.add(row.id);
            return;
        }
        reconcileDispatchRow(row);
    });
}

// Settle any already-shipped in-flight rows from the lag-free checkbox signal — a
// run that merged while every surface was closed (possibly aged out of the status
// window, so its poller could never observe completion) still settles to shipped
// here with no poll. Refreshes each involved project's marker cache ONCE (one
// GitHub read per repo, not per row) then reads each row's checkbox from the cache.
// Rows still unchecked are left to the poller — an unchecked in-flight row may
// simply still be running. Exported for the startup/mount backlog pass and tests.
export function settleShippedRows(rows) {
    if (!_reconcilerDeps) return Promise.resolve(0);
    const inFlight = (Array.isArray(rows) ? rows : []).filter(function (r) {
        return r && r.entry_id && (r.state === 'dispatched' || r.state === 'running');
    });
    if (!inFlight.length) return Promise.resolve(0);
    const projectNames = new Set();
    inFlight.forEach(function (r) {
        const n = resolveRowProjectName(r);
        if (n) projectNames.add(n);
    });
    const refreshes = [];
    projectNames.forEach(function (n) {
        refreshes.push(Promise.resolve(_reconcilerDeps.refreshShippedMarkersForProject(n, true)).catch(function () {}));
    });
    return Promise.all(refreshes).then(function () {
        const settles = [];
        inFlight.forEach(function (row) {
            if (_settleInFlight.has(row.id)) return;
            if (_reconcilerDeps.resolveEntryRunState(row.entry_id) !== 'shipped') return;
            settles.push(withSettleGuard(row.id, function () {
                return settleShipped(row, row.entry_id, row.run_id);
            }));
        });
        if (!settles.length) return 0;
        return Promise.all(settles).then(function () {
            refreshQueueAndNotify();
            return settles.length;
        });
    });
}

// Reconcile the interval against what's in flight: prune tracking for rows that
// have left the in-flight states, then arm the interval when at least one pollable
// row remains (in flight, carrying its ids, not given up) and clear it when none
// do — so an idle app performs no work. `rowsOverride` lets a test drive the
// decision without populating the cache.
export function evaluateReconciler(rowsOverride) {
    const inFlight = Array.isArray(rowsOverride) ? rowsOverride : getInFlightRows();
    const liveIds = new Set();
    inFlight.forEach(function (r) { if (r && r.id != null) liveIds.add(r.id); });
    Array.from(_rowStartedAt.keys()).forEach(function (id) {
        if (!liveIds.has(id)) _rowStartedAt.delete(id);
    });
    Array.from(_rowGaveUp).forEach(function (id) {
        if (!liveIds.has(id)) _rowGaveUp.delete(id);
    });
    const pollable = inFlight.some(function (r) {
        return r && r.correlation_id && r.entry_id && !_rowGaveUp.has(r.id);
    });
    if (pollable) {
        if (!_reconcilePoller) _reconcilePoller = setInterval(reconcileTick, RECONCILE_POLL_MS);
    } else if (_reconcilePoller) {
        clearInterval(_reconcilePoller);
        _reconcilePoller = null;
    }
}

// Whether the reconcile interval is currently armed. Exposed for tests.
export function isReconcilePollerActive() {
    return !!_reconcilePoller;
}

// Refresh the all-projects cache, settle any already-shipped stranded rows, then
// (re)evaluate the interval and fire one immediate tick. The board's mount and the
// board dispatch tail call this so a run settles promptly without waiting for the
// interval; startDispatchReconciler shares the same body on app init.
export function kickDispatchReconciler() {
    return loadAllQueueRows().then(function () {
        return settleShippedRows(getInFlightRows());
    }).then(function () {
        evaluateReconciler();
        reconcileTick();
    });
}

// Start the persistent dispatch reconciler. Idempotent (guarded against double-
// init, like startAgentWorkingWatch). Registers an onQueueChange listener so every
// realtime push re-evaluates what's in flight — the one signal that arms the poller
// when a run is dispatched from ANY surface and stops it when the last run settles —
// then runs the startup backlog reconcile.
export function startDispatchReconciler() {
    if (_reconcilerStarted) return;
    _reconcilerStarted = true;
    onQueueChange(function () { evaluateReconciler(); });
    kickDispatchReconciler();
}

// Tear down the reconciler and clear its tracking. Production never calls this
// (the reconciler is app-lifetime); it exists for test isolation.
export function stopDispatchReconciler() {
    if (_reconcilePoller) { clearInterval(_reconcilePoller); _reconcilePoller = null; }
    _reconcilerStarted = false;
    _rowStartedAt.clear();
    _rowGaveUp.clear();
    _settleInFlight.clear();
}

// ── TRIAGE-SWEEP & DERIVE RUN TRACKERS ────────────────────────────────
// Two mount-INDEPENDENT run trackers relocated here out of agentView.js, beside
// the dispatch reconciler and the persistent working watch they mirror. Each drives
// the board's Working/Idle pill from a REAL GitHub Actions run — the sweep tracker
// from claude-triage.yml, the derive tracker from claude-derive.yml — via the
// Worker's workflow-scoped `active_runs` probe, because neither run is represented
// by any lasting agent_queue row state. They used to live in the board and so only
// ran while it was mounted; a sweep or derive dispatched from anywhere else had no
// pending state (the same defect that stranded dispatched runs before the reconciler
// moved). Here they poll regardless of whether the board is open.
//
// The board (and, next entry, the coverage tab) OBSERVE the trackers through the
// isSweepActive() / isDeriveActive() accessors and drive their own rendering; the
// trackers reach the board's pill repaint, the working watch's seed, and the Worker
// probes ONLY through callbacks registered via configureRunTrackers — the store must
// not import a view or inject.js (the same TDZ / acyclic rule the reconciler follows).

// Poll cadence and windows. The poll runs every SWEEP_POLL_MS; a run that hasn't
// registered yet holds the pill optimistically Working up to SWEEP_GRACE_MS
// (registration lag), and SWEEP_HARD_CAP_MS force-stops a wedged poller regardless.
// GRACE and HARD_CAP are exported because the view's persistent working watch mirrors
// the same grace arc for the nav dot and shares these exact windows.
const SWEEP_POLL_MS = 5000;
export const SWEEP_GRACE_MS = 30 * 1000;
export const SWEEP_HARD_CAP_MS = 5 * 60 * 1000;

// Board + Worker callbacks, registered on boot by the wiring module (agentWiring.js
// in the running app; agentView.js still self-registers them when a test mounts the
// board). Same setter idiom and acyclic rationale as setDispatchReconcilerDeps: the
// store must not import inject.js or a view, so the live probes are injected. Null
// until a registrar runs, so a tracker call degrades to a no-op before then.
//   refreshStatusPill()          — repaint the board header pill in place (board-only,
//                                  OPTIONAL: omitted by the app wiring, which has no board)
//   paint()                      — full board repaint (board-only, OPTIONAL, as above)
//   refreshAgentQueue(name)      — reload + notify the selected project's rows (live)
//   fetchActiveRuns(target, wf)  — Worker active-runs probe (inject.js)
//   pollRunStatus(opts)          — Worker run-status lookup (inject.js)
//   resolveDispatchTarget()      — the selected project's routed target (dispatchDraft.js)
//   showInjectToast(msg, kind)   — non-blocking notice (inject.js)
// The board-only repaint callbacks are guarded at each call site (checked present
// before invoking) so a wiring that omits them — the app's — never throws.
let _trackerDeps = null;
export function configureRunTrackers(deps) {
    _trackerDeps = (deps && typeof deps === 'object') ? deps : null;
}

// Triage-sweep tracking state. `_sweepActive` is what the pill reads; `_sweepPoller`
// is the interval handle; `_sweepSeenActive` records whether a poll has confirmed the
// run in flight (so registration lag is distinguished from a finished run); the
// deadlines bound the grace window and the hard cap; `_sweepProjectName` is the
// project captured when tracking starts, so the post-finish reconcile targets THIS
// project's rows rather than whatever board is on screen when the sweep settles.
let _sweepActive = false;
let _sweepPoller = null;
let _sweepSeenActive = false;
let _sweepGraceDeadline = 0;
let _sweepHardDeadline = 0;
let _sweepProjectName = null;

// Derive-run tracking state, mirroring the sweep tracker but with no post-finish row
// reconcile (derive rows leave `proposed` via Accept, not a stuck state).
// `_deriveCorrelationId` is the id minted for the in-flight run, retained so a genuine
// completion can look up the run's conclusion; set via setDeriveCorrelationId on
// dispatch, cleared on stop.
let _deriveActive = false;
let _derivePoller = null;
let _deriveSeenActive = false;
let _deriveGraceDeadline = 0;
let _deriveHardDeadline = 0;
let _deriveCorrelationId = null;

// Accessors — the board (and the coverage tab, next entry) observe the trackers
// through these rather than the raw bindings, so a consumer reads the signal without
// being able to mutate it.
export function isSweepActive() { return _sweepActive; }
export function isDeriveActive() { return _deriveActive; }
export function setDeriveCorrelationId(id) { _deriveCorrelationId = (id != null ? id : null); }

// ── triage-sweep tracking ────────────────────────────────────────────
// Drive the pill from the real claude-triage.yml run. A sweep is a batch workflow
// with no lasting agent_queue row state, so the pill can't be computed from rows
// alone — instead poll the Worker's triage-scoped `active_runs` probe and flip the
// pill Working → Idle from what GitHub actually reports. Cross-device: a sweep started
// on another device is picked up by the mount-time seed (seedSweepState).

// Begin (or refresh) tracking a triage sweep. Sets the pill optimistically to Working
// immediately, (re)arms the poller, and kicks a one-shot poll so an already-completed
// run settles at once. `alreadyConfirmed` is true only for the mount-time seed, where
// the seed fetch has already observed the run in flight — otherwise we start
// unconfirmed so the grace window covers the registration lag. This is also the single
// chokepoint that seeds the persistent working watch (both local dispatch via
// fireTriageSweep and the cross-device mount seed via seedSweepState), so the nav
// "● Agent" dot lights the instant a sweep dispatches instead of waiting on the watch's
// slow remote probe to observe the run once it registers.
export function startSweepTracking(alreadyConfirmed) {
    const now = Date.now();
    _sweepActive = true;
    _sweepSeenActive = !!alreadyConfirmed;
    _sweepProjectName = resolveSelectedProjectName();
    _sweepGraceDeadline = now + SWEEP_GRACE_MS;
    _sweepHardDeadline = now + SWEEP_HARD_CAP_MS;
    if (!_sweepPoller) {
        _sweepPoller = setInterval(pollSweepOnce, SWEEP_POLL_MS);
    }
    // Seed the mount-independent working watch so the nav dot lights now, not
    // 30-45s later when the probe finally observes the registered run. The watch
    // now lives in this module, so this is a local call rather than a DI hop.
    seedWorkingWatchSweep(alreadyConfirmed);
    if (_trackerDeps && _trackerDeps.refreshStatusPill) _trackerDeps.refreshStatusPill();
    pollSweepOnce();
}

// Stop tracking and settle the pill to Idle. Idempotent; refreshes the pill only when
// it was actually showing Working, so a no-op stop (e.g. on view exit with no sweep)
// doesn't touch the DOM.
export function stopSweepTracking() {
    if (_sweepPoller) {
        clearInterval(_sweepPoller);
        _sweepPoller = null;
    }
    const wasActive = _sweepActive;
    _sweepActive = false;
    _sweepSeenActive = false;
    if (wasActive && _trackerDeps && _trackerDeps.refreshStatusPill) _trackerDeps.refreshStatusPill();
}

// One poll tick: ask the Worker whether claude-triage.yml has an in-flight run.
// `active:true` confirms the sweep (and keeps the pill Working); `active:false` after a
// confirmation means it finished → settle to Idle. Before any confirmation,
// `active:false` is registration lag: stay Working until the grace window elapses. A
// transient failure (`ok:false`) is ignored and retried. A hard cap force-stops
// regardless so a wedged run can't pin the pill forever.
function pollSweepOnce() {
    if (Date.now() >= _sweepHardDeadline) {
        finishSweep();
        return;
    }
    const target = _trackerDeps ? _trackerDeps.resolveDispatchTarget() : null;
    Promise.resolve(_trackerDeps ? _trackerDeps.fetchActiveRuns(target, 'triage') : null).then(function (res) {
        if (!_sweepPoller && !_sweepActive) return; // torn down mid-flight
        if (!res || res.ok === false) return; // transient — retry next tick
        if (res.active) {
            _sweepSeenActive = true;
            if (!_sweepActive) { _sweepActive = true; if (_trackerDeps && _trackerDeps.refreshStatusPill) _trackerDeps.refreshStatusPill(); }
            return;
        }
        // active === false
        if (_sweepSeenActive || Date.now() >= _sweepGraceDeadline) {
            // Either the confirmed run has finished, or the grace window for a
            // run that never registered has elapsed — settle to Idle.
            finishSweep();
        }
    });
}

// A tracked sweep has reached a terminal point — the probe confirmed its run finished,
// the grace window for a never-registered run elapsed, or the hard cap force-stopped a
// wedged run. Settle the pill to Idle, then reconcile any row the sweep left stuck at
// 'triaging'. Only reconcile when a sweep was genuinely being tracked (`wasActive`), so
// a stray poll while idle is a pure no-op. This is deliberately NOT folded into
// stopSweepTracking(): that also fires on plain teardown (view exit, or a dispatch that
// never launched a run), where the sweep may still be running and its rows must be left
// untouched.
function finishSweep() {
    const projectName = _sweepProjectName;
    const wasActive = _sweepActive;
    stopSweepTracking();
    if (wasActive) reconcileStuckTriaging(projectName);
}

// Reconcile rows a finished triage sweep left behind. A flagged todo's agent_queue row
// is set to 'triaging' at flag time (and again on re-triage after an answer), before any
// run exists, and nothing ever revisits that row from the client: dispatchTriage is
// fire-and-forget and the sweep poller only drives the header pill. So if
// claude-triage.yml errors, times out, or exhausts its turns before writing a verdict for
// a given row, that row is left at 'triaging' indefinitely. Once the tracked run is
// confirmed finished, flip each still-'triaging' row for the swept project to a visible
// 'failed' state (surfaced in the Stuck bucket) with an explanatory reason, so the user
// can re-run triage from the row's Retry triage control rather than stall unseen — that
// control is the recovery the reason names, since such a row has no entry and no draft
// and so has nothing a dispatch could ship. The queue is read fresh
// (not the possibly-stale render cache) so a row the sweep DID resolve is never clobbered,
// and the board repaints only when the swept project is still the one on screen.
async function reconcileStuckTriaging(projectName) {
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    if (!projectId) return;
    const rows = await fetchQueueRows(projectId);
    const stuck = (Array.isArray(rows) ? rows : []).filter(function (r) {
        return r && r.state === 'triaging';
    });
    if (!stuck.length) return;
    let changedAny = false;
    for (let i = 0; i < stuck.length; i++) {
        const res = await listLogic.setAgentRunState(stuck[i].id, {
            state: 'failed',
            failure_reason: 'The triage sweep didn’t finish for this task. Use Retry triage to run it again.',
        });
        if (res && res.ok) changedAny = true;
    }
    if (changedAny && resolveSelectedProjectName() === projectName && _trackerDeps) {
        _trackerDeps.refreshAgentQueue(projectName);
    }
}

// Mount-time seed: a one-shot triage active_runs check so a sweep already running
// (possibly started on another device) shows Working here too and is tracked to
// completion. Fire-and-forget; a miss or transient error leaves the pill as the row
// states dictate.
export function seedSweepState() {
    const target = _trackerDeps ? _trackerDeps.resolveDispatchTarget() : null;
    Promise.resolve(_trackerDeps ? _trackerDeps.fetchActiveRuns(target, 'triage') : null).then(function (res) {
        if (res && res.ok !== false && res.active) {
            startSweepTracking(true);
        }
    });
}

// ── derive-run tracking ──────────────────────────────────────────────
// Drive the header pill (and the Draft button's disabled state) from the real
// claude-derive.yml run for its whole duration, rather than a fixed timer. Mirrors the
// triage-sweep tracker but with no row reconcile: a derive run's results land as
// `proposed` rows and leave via Accept, so there's no stuck state to clean up when it
// settles.

// Begin tracking a derive run. Sets the pill optimistically to Working, arms the poller,
// and kicks a one-shot poll so an already-finished run settles at once. Always starts
// unconfirmed so the grace window covers the registration lag before the run appears in
// the probe.
export function startDeriveTracking() {
    const now = Date.now();
    _deriveActive = true;
    _deriveSeenActive = false;
    _deriveGraceDeadline = now + SWEEP_GRACE_MS;
    _deriveHardDeadline = now + SWEEP_HARD_CAP_MS;
    if (!_derivePoller) {
        _derivePoller = setInterval(pollDeriveOnce, SWEEP_POLL_MS);
    }
    if (_trackerDeps && _trackerDeps.refreshStatusPill) _trackerDeps.refreshStatusPill();
    // Announce on the store's channel so the Coverage tab repaints its Derive action
    // into the disabled "Deriving…" state (read from isDeriveActive() on each paint).
    // Only the DERIVE tracker notifies, not the sweep tracker: derive runs boardless
    // in the app (via the Coverage tab), whereas the sweep tracker only runs while the
    // Agent board is mounted (the app's triage dispatcher is board-owned), so notifying
    // on a sweep transition would only reach the mounted board — whose full-paint
    // onQueueChange listener would clobber the Run button's transient "Queued" label,
    // a behaviour the board still relies on. The board's own refreshStatusPill covers
    // the sweep pill; a derive-button repaint is safe because it reads its durable
    // state from isDeriveActive() rather than a captured transient label.
    notifyQueueChange();
    // Light the nav working dot at dispatch time. The persistent watch polls
    // independently and does NOT observe onQueueChange, so the notify above won't
    // move the dot; set the class directly here, and pollAgentWorkingWatch folds
    // isDeriveActive() into its signal so the dot stays lit for the run's duration.
    setAgentWorkingClass(true);
    pollDeriveOnce();
}

// Stop tracking and settle the pill to Idle, re-enabling the Draft button. Idempotent;
// repaints only when it was actually showing Working so a no-op stop doesn't churn the
// DOM. A full paint() (not just refreshStatusPill) is used so the rebuilt assignment
// card picks up the cleared `_deriveActive` and drops its "Drafting…" disabled state.
// `silent` is passed on board teardown (unsubscribeAgentView), where the board is being
// torn down and a settle paint would be wasted.
export function stopDeriveTracking(silent) {
    if (_derivePoller) {
        clearInterval(_derivePoller);
        _derivePoller = null;
    }
    const wasActive = _deriveActive;
    _deriveActive = false;
    _deriveSeenActive = false;
    _deriveCorrelationId = null;
    if (wasActive && !silent && _trackerDeps && _trackerDeps.paint) _trackerDeps.paint();
    // The board's paint() above is dead in the app; the surface that used to be the
    // rebuilt assignment card is now the Coverage tab, which repaints from
    // isDeriveActive() on an onQueueChange notification. Fire that on a real settle
    // (not a silent board teardown) so the Derive action leaves "Deriving…" without
    // a project switch. Then recompute the nav dot — isDeriveActive() is now false,
    // so it clears unless a ship run or triage sweep still holds it lit.
    if (wasActive && !silent) notifyQueueChange();
    if (wasActive) pollAgentWorkingWatch();
}

// One poll tick: ask the Worker whether claude-derive.yml has an in-flight run.
// `active:true` confirms the run (keeps the pill Working); `active:false` after a
// confirmation means it finished → settle to Idle. Before any confirmation,
// `active:false` is registration lag: stay Working until the grace window elapses. A
// transient failure (`ok:false`) is ignored and retried. A hard cap force-stops
// regardless so a wedged run can't pin the pill forever.
function pollDeriveOnce() {
    if (Date.now() >= _deriveHardDeadline) {
        stopDeriveTracking();
        return;
    }
    const probeTarget = _trackerDeps ? _trackerDeps.resolveDispatchTarget() : null;
    Promise.resolve(_trackerDeps ? _trackerDeps.fetchActiveRuns(probeTarget, 'derive') : null).then(function (res) {
        if (!_derivePoller && !_deriveActive) return; // torn down mid-flight
        if (!res || res.ok === false) return; // transient — retry next tick
        if (res.active) {
            _deriveSeenActive = true;
            if (!_deriveActive) { _deriveActive = true; if (_trackerDeps && _trackerDeps.refreshStatusPill) _trackerDeps.refreshStatusPill(); notifyQueueChange(); setAgentWorkingClass(true); }
            return;
        }
        // active === false
        if (_deriveSeenActive) {
            // A confirmed run has finished — capture its correlation id and target
            // before settling to Idle, then fetch the run's conclusion so a silent
            // failure surfaces, and refresh the queue so proposals land even if the
            // realtime push lagged.
            const correlationId = _deriveCorrelationId;
            const target = _trackerDeps ? _trackerDeps.resolveDispatchTarget() : null;
            stopDeriveTracking();
            finishDeriveRun(correlationId, target);
        } else if (Date.now() >= _deriveGraceDeadline) {
            // The grace window for a run that never registered has elapsed — there's
            // no genuine run outcome to report, so settle silently.
            stopDeriveTracking();
        }
    });
}

// Called once a confirmed derive run reports finished. Fetches the run's conclusion by
// its correlation id (reusing the ship flow's pollRunStatus / FAILURE_CONCLUSIONS
// machinery) and raises a failure toast when it failed; then refreshes the queue so
// newly written proposals appear even if the realtime push was missed. Never throws — a
// transient status miss just skips the toast, and the queue refresh still runs.
function finishDeriveRun(correlationId, target) {
    const refresh = function () {
        if (_trackerDeps) _trackerDeps.refreshAgentQueue(resolveSelectedProjectName());
    };
    if (!correlationId) { refresh(); return; }
    Promise.resolve(_trackerDeps ? _trackerDeps.pollRunStatus({ correlationId: correlationId, target: target || null }) : null)
        .then(
            function (res) {
                if (res && res.ok !== false && res.status === 'completed'
                    && RECONCILE_FAILURE_CONCLUSIONS.indexOf(res.conclusion) !== -1) {
                    if (_trackerDeps) _trackerDeps.showInjectToast('Derive run failed — check the run.', 'error');
                }
            },
            function () {}
        )
        .then(refresh);
}

// ── generic active-runs poll tracker ─────────────────────────────────
// The triage-sweep and derive-run trackers above share one shape: a single
// interval, a grace window that holds the flag optimistically on through the run's
// registration lag, and a hard cap that force-settles a wedged run. They predate
// this factory and keep their bespoke settle side-effects — a sweep reconciles
// stuck 'triaging' rows and seeds the working watch, a derive fetches its run
// conclusion and toggles the nav dot — so retrofitting them is out of scope here.
// This factory captures the shared poll loop so a NEW tracker (the refactor scan)
// is a configured instance rather than a third hand-rolled copy. `workflow` scopes
// the active_runs probe; `onStart(context)` runs as tracking begins and
// `onSettle(context)` runs once when a tracked run reaches a terminal point
// (confirmed finished, grace elapsed, or hard cap), each with the context captured
// at start. Both hooks default to no-ops. Probes flow through the same injected
// `_trackerDeps` the sweep/derive trackers use (fetchActiveRuns / resolveDispatchTarget).
function makeRunTracker(opts) {
    const workflow = opts.workflow;
    const onStart = (typeof opts.onStart === 'function') ? opts.onStart : function () {};
    const onSettle = (typeof opts.onSettle === 'function') ? opts.onSettle : function () {};
    let active = false;
    let poller = null;
    let seenActive = false;
    let graceDeadline = 0;
    let hardDeadline = 0;
    let context = null;

    function settle() {
        if (poller) { clearInterval(poller); poller = null; }
        const wasActive = active;
        const ctx = context;
        active = false;
        seenActive = false;
        if (wasActive) onSettle(ctx);
    }

    function pollOnce() {
        if (Date.now() >= hardDeadline) { settle(); return; }
        const target = _trackerDeps ? _trackerDeps.resolveDispatchTarget() : null;
        Promise.resolve(_trackerDeps ? _trackerDeps.fetchActiveRuns(target, workflow) : null).then(function (res) {
            if (!poller && !active) return;          // torn down mid-flight
            if (!res || res.ok === false) return;    // transient — retry next tick
            if (res.active) {
                seenActive = true;
                active = true;
                return;
            }
            // active === false: a confirmed run has finished, or the grace window
            // for a run that never registered has elapsed — either way, settle.
            if (seenActive || Date.now() >= graceDeadline) settle();
        });
    }

    return {
        start: function (ctx) {
            const now = Date.now();
            active = true;
            seenActive = false;
            context = (ctx === undefined ? null : ctx);
            graceDeadline = now + SWEEP_GRACE_MS;
            hardDeadline = now + SWEEP_HARD_CAP_MS;
            if (!poller) poller = setInterval(pollOnce, SWEEP_POLL_MS);
            onStart(context);
            pollOnce();
        },
        stop: function () {
            if (poller) { clearInterval(poller); poller = null; }
            active = false;
            seenActive = false;
        },
        isActive: function () { return active; },
        context: function () { return context; },
    };
}

// ── refactor-scan tracking ───────────────────────────────────────────
// Drive the NEXT REFACTOR card's pending state from the real claude-scan.yml run.
// A scan writes NO agent_queue row — its only lasting record is the refactor_scans
// row the Worker writes at the END of the run — so the card cannot infer "scanning"
// from queue state; it observes this tracker instead. On dispatch the card starts
// tracking; the poll flips off when the scan-scoped active_runs probe reports the
// run gone (or the grace window elapses for a run that never registered), and the
// card re-reads its stored scan on the settle notification. The pending state lives
// HERE, not on the card element, so a lens switch, a project switch, or a tab reopen
// renders pending from isScanActive() unchanged. The captured context is the scanned
// repo, so a card can tell a scan for its own repo apart from one dispatched for a
// different project's.
const _scanListeners = new Set();

// Subscribe to scan-tracker transitions (dispatch → pending, settle → re-read).
// Returns an unsubscribe thunk. The card subscribes on mount and self-unsubscribes
// once it leaves the DOM, so stale cards from earlier mounts don't accumulate.
export function onScanChange(listener) {
    if (typeof listener === 'function') _scanListeners.add(listener);
    return function () { _scanListeners.delete(listener); };
}
function notifyScanChange() {
    _scanListeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
}

const _scanTracker = makeRunTracker({
    workflow: 'scan',
    onStart: function () { notifyScanChange(); },
    onSettle: function () { notifyScanChange(); },
});

// Begin tracking a refactor scan for `repo`. Notifies on start so a mounted card
// flips to its pending state at once, then polls the scan-scoped active_runs probe.
export function startScanTracking(repo) { _scanTracker.start(repo || null); }
// Stop tracking WITHOUT a settle notification — used to cancel the optimistic poller
// when a dispatch fails, where the card renders its own error and repaint. A genuine
// run settle goes through the tracker's own onSettle (which does notify).
export function stopScanTracking() { _scanTracker.stop(); }
export function isScanActive() { return _scanTracker.isActive(); }
export function getScanningRepo() { return _scanTracker.context(); }

// ── PERSISTENT AGENT-WORKING WATCH ──
// A lightweight, mount-INDEPENDENT watch on whether the agent is actively
// working — a triage sweep in flight, or a ship run dispatched/running for the
// selected project. Relocated here out of agentView.js so it survives the
// board's deletion, beside the dispatch reconciler and the run trackers it
// mirrors. The board subscription (subscribeAgentView) is torn down by
// unsubscribeAgentView() on tab-exit (a backgrounded board holds no open
// socket), which also clears the board's row cache and forces `_sweepActive`
// false via stopSweepTracking — so the header pill's working signal goes dark the
// instant you leave the Agent tab, exactly the context the nav "working" dot
// exists to serve. This watch is therefore started once at app init and NEVER
// torn down. It carries ONLY the working signal: its own minimal agent_queue
// realtime subscription (separate from the shared board channel, to catch
// dispatched/running transitions) plus a slow triage active-runs probe. It
// deliberately does NOT keep the board subscription or the dispatch pollers alive
// off-tab, and never rebuilds the board — it only toggles a `body.agentWorking`
// class the nav CSS keys the dot off, mirroring the `agentUnavailable` body-flag
// pattern. The Worker probes it needs (fetchActiveRuns / resolveDispatchTarget)
// are reached through the run-tracker DI bundle (_trackerDeps) the same acyclic
// way the sweep/derive trackers reach them — the store must not import inject.js
// or a view — so the sweep half degrades to a no-op before agentView.js has
// registered the trackers (the ship half needs only the store-local queue cache).
let _workingWatchStarted = false;
let _workingWatchChannel = null;
let _workingWatchPoller = null;
let _workingWatchState = false;
// The watch's own view of a locally-seeded triage sweep, independent of the
// mounted board's `_sweepActive`/`_sweepSeenActive` (which are cleared on tab
// exit). Seeded by startSweepTracking the instant a sweep dispatches so the nav
// dot lights synchronously, then settled by the watch's poll: held true through
// the registration window, and cleared once the probe has confirmed the run in
// flight and then seen it gone (seen-active-then-gone), or once the grace / hard
// cap elapses — mirroring pollSweepOnce's grace semantics so the optimistic seed
// doesn't flicker off on the first pre-registration tick.
let _workingWatchSweepSeeded = false;
let _workingWatchSweepSeenActive = false;
let _workingWatchSweepGraceDeadline = 0;
let _workingWatchSweepHardDeadline = 0;

// Background probe cadence for the persistent working watch. Slower than the
// mounted sweep poller (SWEEP_POLL_MS) — this only drives a cosmetic nav dot, so
// a gentle tick keeps Worker load low while still catching a triage sweep or a
// project switch that no realtime push covers.
const WORKING_WATCH_POLL_MS = 15000;

// Toggle body.agentWorking to reflect the computed working signal, but only when
// it actually changes so the class isn't churned every tick. No-op before
// document.body exists.
function setAgentWorkingClass(working) {
    working = !!working;
    if (working === _workingWatchState) return;
    _workingWatchState = working;
    if (document.body) document.body.classList.toggle('agentWorking', working);
}

// Seed the watch with a just-dispatched triage sweep: arm the grace / hard-cap
// deadlines and light the nav dot immediately, so it lights from dispatch time
// rather than from the first probe that observes the registered run. Called from
// startSweepTracking (the shared chokepoint for local dispatch and the
// cross-device mount seed). `alreadyConfirmed` marks the mount seed, whose fetch
// already saw the run in flight, so the seen-active-then-gone settle applies at
// once instead of waiting out the grace window.
function seedWorkingWatchSweep(alreadyConfirmed) {
    const now = Date.now();
    _workingWatchSweepSeeded = true;
    _workingWatchSweepSeenActive = !!alreadyConfirmed;
    _workingWatchSweepGraceDeadline = now + SWEEP_GRACE_MS;
    _workingWatchSweepHardDeadline = now + SWEEP_HARD_CAP_MS;
    setAgentWorkingClass(true);
}

// Drop the watch's seeded-sweep state. Called when a dispatch fails (no run will
// register) so the seed can't hold the dot lit through the grace window, and
// from the watch's own settle logic once a sweep is confirmed finished.
export function clearWorkingWatchSweepSeed() {
    _workingWatchSweepSeeded = false;
    _workingWatchSweepSeenActive = false;
    _workingWatchSweepGraceDeadline = 0;
    _workingWatchSweepHardDeadline = 0;
}

// Resolve the sweep component of the working signal from the latest probe result
// plus any local seed. A live probe (`active:true`) always means Working and
// promotes a seed to seen-active. With the probe quiet, a seed still holds the
// dot lit through the registration window and settles it only once the run has
// been seen active and then gone, or the grace / hard cap elapses — the same
// arc pollSweepOnce uses for the mounted pill. Without a seed the probe alone
// decides (e.g. a sweep started on another device that this client never seeded).
function resolveWatchSweepWorking(probeActive) {
    if (probeActive) {
        if (_workingWatchSweepSeeded) _workingWatchSweepSeenActive = true;
        return true;
    }
    if (!_workingWatchSweepSeeded) return false;
    const now = Date.now();
    if (now >= _workingWatchSweepHardDeadline) { clearWorkingWatchSweepSeed(); return false; }
    // Confirmed in flight and now gone → finished.
    if (_workingWatchSweepSeenActive) { clearWorkingWatchSweepSeed(); return false; }
    // Never registered within the grace window → give up.
    if (now >= _workingWatchSweepGraceDeadline) { clearWorkingWatchSweepSeed(); return false; }
    // Still inside the registration window → hold the dot lit.
    return true;
}

// One watch tick: compute `working` = a triage sweep in flight for the selected
// project OR any dispatched/running row for the selected project OR a derive run in
// flight (isDeriveActive, folded in below) — the same predicate the header pill uses
// (refreshStatusPill), but resolved independently so it holds off-tab where the
// board's row cache / `_sweepActive` are cleared.
// Both halves are scoped to the selected project: the ship half reads its
// dispatched/running rows, and the sweep half gates the repo-wide triage
// active-runs probe on the project actually owning an in-flight 'triaging' row
// (see below). The sweep component then folds the raw probe with any local seed
// via resolveWatchSweepWorking, so a just-dispatched sweep stays lit through the
// registration window instead of blinking dark until the probe first observes the
// registered run. Both probes degrade to false on any error, and skip entirely
// when there is no selected project or no routed target (or before the run
// trackers register their Worker probes), so a pre-auth or repo-less state is a
// cheap no-op (a local seed is still honored — the probe simply resolves false).
export function pollAgentWorkingWatch() {
    const projectName = resolveSelectedProjectName();
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    const target = _trackerDeps ? _trackerDeps.resolveDispatchTarget() : null;

    const shipProbe = projectId
        ? fetchQueueRows(projectId).then(function (rows) {
            return (Array.isArray(rows) ? rows : []).some(function (r) {
                return r && (r.state === 'dispatched' || r.state === 'running');
            });
        }).catch(function () { return false; })
        : Promise.resolve(false);

    // Scope the sweep half to the selected project the same way shipProbe scopes
    // the ship half. The repo-wide triage active-runs probe only reports whether
    // the TARGET REPO has a claude-triage.yml run in flight, with no project
    // attribution — on its own it lights the dot for every project sharing that
    // repo (or the null default target). Gate it on the project owning an
    // in-flight 'triaging' agent_queue row (the state flagTaskForAgent writes and
    // reconcileStuckTriaging later clears), so the dot lights only while THIS
    // project has a sweep actually processing its flagged tasks.
    const sweepProbe = (target && projectId)
        ? Promise.all([
            Promise.resolve(_trackerDeps.fetchActiveRuns(target, 'triage')),
            fetchQueueRows(projectId),
        ]).then(function (parts) {
            const repoActive = !!(parts[0] && parts[0].ok !== false && parts[0].active);
            const projectTriaging = (Array.isArray(parts[1]) ? parts[1] : []).some(function (r) {
                return r && r.state === 'triaging';
            });
            return repoActive && projectTriaging;
        }).catch(function () { return false; })
        : Promise.resolve(false);

    return Promise.all([shipProbe, sweepProbe]).then(function (parts) {
        const sweepWorking = resolveWatchSweepWorking(parts[1]);
        // Fold in a live derive run. A derive isn't a triage sweep and leaves no
        // dispatched/running row (its output lands as `proposed`), so neither probe
        // above catches it — without this the nav dot would never light for a derive.
        // isDeriveActive() is a synchronous module flag, so this needs no extra probe.
        setAgentWorkingClass(parts[0] || sweepWorking || isDeriveActive());
    });
}

// Start the persistent working watch. Idempotent — guarded against double-init
// (app-init code can evaluate more than once), so a second call is a no-op
// rather than a second channel plus a second poller. Opens its own agent_queue
// realtime channel (each push re-evaluates the working signal) and a slow
// background poller, then kicks one immediate tick.
export function startAgentWorkingWatch() {
    if (_workingWatchStarted) return;
    _workingWatchStarted = true;
    if (!_workingWatchChannel && supabase && typeof supabase.channel === 'function') {
        try {
            _workingWatchChannel = supabase
                .channel('agent-working-watch:agent_queue')
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'agent_queue' },
                    function () { pollAgentWorkingWatch(); })
                .subscribe();
        } catch (e) {
            _workingWatchChannel = null;
        }
    }
    if (!_workingWatchPoller) {
        _workingWatchPoller = setInterval(pollAgentWorkingWatch, WORKING_WATCH_POLL_MS);
    }
    pollAgentWorkingWatch();
}

// ── AGENT AVAILABILITY GATE ───────────────────────────────────────────
// Relocated here out of agentView.js so it survives the board's deletion. A
// project with no routed inject target can't draft, dispatch, or ship agent
// work — there's nowhere to append the TODO.md entry. A single `agentUnavailable`
// body flag (toggled here) drives the hollow "no-repo" marker's CSS on the
// STRUCTURE entry points and the board's paint() unavailable branch while the
// board still exists. main.js routes every project switch through
// syncAgentAvailabilityForProject and reads its hasRepo return to bail off a
// now-dead board; the badge-route handler consults the same gate. It is the SAME
// test the sidebar thunderbolt uses: inject configured globally AND this project
// carrying a routed inject target.
//
// The gate reaches inject.js's configured-check through the store's established DI
// channel rather than a static import — the store must not import a view or
// inject.js, the same acyclic rule the reconciler and run trackers already follow:
//   • isInjectConfigured() — registered from inject.js via setAgentAvailabilityDeps
//     at that module's load (its natural home; survives the board's deletion).
// The nav-dot recompute (pollAgentWorkingWatch) is now a local call: the
// persistent working watch relocated into this module beside the run trackers.
export const AGENT_UNAVAILABLE_MSG =
    'Agent unavailable here — no repo configured for this project';

// inject.js registers { isInjectConfigured } here at module load — same setter
// idiom and TDZ-avoidance reason as setDispatchReconcilerDeps: the store must not
// statically import inject.js, so it reaches the check through a registered bundle.
let _availabilityDeps = null;
export function setAgentAvailabilityDeps(deps) {
    _availabilityDeps = (deps && typeof deps === 'object') ? deps : null;
}

function applyAgentAvailability(hasRepo) {
    // Just toggle the body flag — the CSS keys the hollow "no-repo" marker off it
    // and the board's paint() renders the unavailable message in-view when opened
    // on a repo-less project.
    document.body.classList.toggle('agentUnavailable', !hasRepo);
}

// Recompute agent availability for the given project and apply it. Called from
// main.js's project-switch hooks (alongside syncClaudeSheetForProject) so both
// gates derive from one source of truth and clear together, and from the
// badge-route handler to refuse a route into a repo-less board. Returns hasRepo so
// the caller can bail off a now-dead board.
export function syncAgentAvailabilityForProject(projectName) {
    const injectConfigured = !!(_availabilityDeps
        && typeof _availabilityDeps.isInjectConfigured === 'function'
        && _availabilityDeps.isInjectConfigured());
    const hasRepo = injectConfigured
        && !!listLogic.getProjectTargetId(projectName);
    applyAgentAvailability(hasRepo);
    // Recompute the nav "agent working" dot for the newly selected project right
    // now. The working signal is scoped to the selected project, but the watch
    // otherwise only ticks on its 15s interval or an agent_queue realtime push —
    // never on a project switch. Without this the dot hangs on the previous
    // project's state for up to WORKING_WATCH_POLL_MS after switching. This is the
    // documented project-switch hook, so recompute here (local call — the watch
    // lives in this module).
    pollAgentWorkingWatch();
    return hasRepo;
}

// True while the agent gate is off for the active project. The board's paint()
// consults this to render the in-view unavailable message instead of the queue.
export function isAgentUnavailable() {
    return document.body.classList.contains('agentUnavailable');
}

// Resolve the reason text a Stuck (`failed` / `no_change`) row surfaces: its own
// recorded `failure_reason` when present, else a state-specific fallback. The
// single copy resolver shared by the Agent board (buildStuckSecondary), the mobile
// desc-editor modal, and the desktop row layer (via the registered resolver seam),
// so none defines a second copy of the fallback strings. Pure over `agent_queue`
// row fields — it lives here with the rest of the row data model.
export function stuckReasonText(row) {
    const reason = (row && row.failure_reason ? String(row.failure_reason) : '').trim();
    if (reason) return reason;
    return (row && row.state === 'no_change')
        ? 'The run finished without merging any changes.'
        : 'The run failed. Retry from the queue.';
}
