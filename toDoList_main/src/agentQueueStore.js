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
                resolve((res && res.data) || []);
            }).catch(function () { resolve([]); });
        } catch (e) {
            resolve([]);
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

// Persist a row to `shipped`, attaching the run id and a best-effort PR link
// (resolved without blocking the ship — a missing link still ships).
function settleShipped(rowId, entryId, runId) {
    const patch = { state: 'shipped' };
    if (runId != null) patch.run_id = runId;
    return bestEffortPrLink(entryId).then(function (link) {
        if (link.pr_url) patch.pr_url = link.pr_url;
        if (link.pr_number != null) patch.pr_number = link.pr_number;
        return listLogic.setAgentRunState(rowId, patch);
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
        if (shipped) return settleShipped(row.id, row.entry_id, runId);
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
                return settleShipped(row.id, row.entry_id, row.run_id);
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
