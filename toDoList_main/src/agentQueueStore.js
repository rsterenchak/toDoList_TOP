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

// Synchronous lookup of a todo's linked agent_queue row (agent_queue.todo_id ===
// todoId). Used by derivePhase on the render path — returns null when nothing is
// cached or nothing links, so a row with no queue row is unaffected.
export function getQueueRowForTodo(todoId) {
    if (!todoId) return null;
    const rows = getQueueRows();
    for (let i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].todo_id === todoId) return rows[i];
    }
    return null;
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
                    Promise.all([
                        loadQueueRows(resolveSelectedProjectName()),
                        loadAllQueueRows(),
                    ]).then(notifyQueueChange);
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
