// Per-project active-run state for the in-app automation pipeline.
//
// At most one automation run (backlog or entry mode) is tracked per project at
// a time. Both surfaces that can launch a run — the TODO.md viewer's header
// "Running" pill and the Claude sheet's chat ship path — share this module so
// a run dispatched from either drives the same per-project state: the viewer's
// pill attaches to a chat-shipped run, and a second run on the same project is
// refused from both surfaces. Runs on different projects never interfere.
//
// State is keyed per project (`todoapp_activeRun:<encodeURIComponent(project)>`)
// and persisted in localStorage so a run survives project navigation and full
// reloads. A `todoapp:activeRunChange` CustomEvent fires on `document`
// (detail.project) whenever a project's entry is written or cleared, so a
// viewer that is already mounted for that project can attach or detach its
// pill the instant a run starts or ends elsewhere.

const ACTIVE_RUN_PREFIX = 'todoapp_activeRun:';

// Change-event name fired on `document` when a project's active-run entry is
// written or cleared. detail = { project }.
export const ACTIVE_RUN_CHANGE_EVENT = 'todoapp:activeRunChange';

// A run that has been in flight this long without a confirmed terminal outcome
// can no longer be reconciled. Reads treat an entry older than this as stale —
// they clear it and report no active run — so a project can never stay
// permanently blocked if a run is never confirmed. Mirrors the give-up window
// the run-status pollers use.
export const RUN_GIVE_UP_MS = 20 * 60 * 1000;

function activeRunKey(project) {
    return ACTIVE_RUN_PREFIX + encodeURIComponent(project || '');
}

function emitChange(project) {
    if (typeof document === 'undefined') return;
    try {
        document.dispatchEvent(new CustomEvent(ACTIVE_RUN_CHANGE_EVENT, {
            detail: { project: project || '' },
        }));
    } catch (e) { /* non-DOM environment */ }
}

// Read a project's active-run record, or null when none is tracked. A record
// without a usable correlation id is treated as absent (it can never be
// polled). A record older than RUN_GIVE_UP_MS is stale: it is cleared and null
// is returned so the project's run guard is freed even if its viewer is closed.
export function readActiveRun(project) {
    try {
        const raw = localStorage.getItem(activeRunKey(project));
        if (!raw) return null;
        const rec = JSON.parse(raw);
        if (!rec || typeof rec.correlationId !== 'string' || !rec.correlationId) return null;
        if (typeof rec.dispatchedAt === 'number' &&
            Date.now() - rec.dispatchedAt >= RUN_GIVE_UP_MS) {
            clearActiveRun(project);
            return null;
        }
        return rec;
    } catch (e) { return null; }
}

export function writeActiveRun(project, rec) {
    try {
        localStorage.setItem(activeRunKey(project), JSON.stringify(rec));
    } catch (e) { /* private mode */ }
    emitChange(project);
}

export function clearActiveRun(project) {
    try {
        localStorage.removeItem(activeRunKey(project));
    } catch (e) { /* private mode */ }
    emitChange(project);
}

// The selected project's name, read from the sidebar's selected-project input.
// Shared so the viewer (which reads the per-project key on render) and the chat
// ship path (which writes it) resolve the same project under the same key,
// rather than each duplicating the `.selectedProject #projInput` selector.
export function activeProjectNameForViewer() {
    if (typeof document === 'undefined') return '';
    const selected = document.querySelector('.selectedProject');
    if (!selected) return '';
    const projInput = selected.querySelector('#projInput');
    return projInput ? (projInput.value || '').trim() : '';
}
