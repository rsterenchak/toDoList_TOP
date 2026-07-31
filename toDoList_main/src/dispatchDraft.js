import { listLogic } from './listLogic.js';
import { findTargetById } from './inject.js';
import { shipEntryForTodo } from './shipEntry.js';
import { kickDispatchReconciler } from './agentQueueStore.js';

// Shared dispatch core for a drafted/stuck agent_queue row's entry. Extracted out
// of agentView so BOTH the Agent board and the task-row description panel ship a
// draft and retry a failed run through ONE implementation — the entry-id reuse
// that keeps Retry from appending a duplicate to TODO.md, and the dispatched-state
// persistence that moves the card on, can never drift between the two surfaces.
// This module deliberately imports neither agentView.js nor the row layer, so it
// stays acyclic for both importers.

// The name of the currently-selected project, read from the sidebar's selected
// row. A DOM read kept local so this shared core has no dependency on either
// importer; mirrors agentView's own getSelectedProjectName.
function getSelectedProjectName() {
    const selected = document.querySelector('.selectedProject');
    if (!selected) return '';
    const input = selected.querySelector('#projInput');
    return input ? (input.value || '').trim() : '';
}

// The dispatch target (repo/filePath) for the active project's runs: the active
// project's linked inject target (the same routing the inject/run path uses), or
// null when the project has no target — in which case the Worker falls back to its
// default repo. The single resolver the Agent board and the description-panel
// Dispatch/Retry both route through, so a run shipped from either surface targets
// the same repo. Mirrors resolveReadTarget.
export function resolveDispatchTarget() {
    const projectName = getSelectedProjectName();
    if (!projectName) return null;
    const targetId = listLogic.getProjectTargetId(projectName);
    return targetId ? findTargetById(targetId) : null;
}

// Ship a drafted row's entry through the run pipeline: mint (or reuse) an id,
// embed the marker, inject the entry into TODO.md, then dispatch claude-run.yml in
// entry mode against that id (all inside shipEntryForTodo). On success persists the
// ids + `dispatched` state (so the realtime subscription moves the card and a
// reopen can resume polling), then runs the optional tail. Returns { ok } /
// { ok:false, error } so the caller can re-enable its control and surface a
// non-blocking failure, leaving the row `drafted`/`stuck`.
//
// `existingEntryId` powers Retry: passing the row's stored entry_id reuses the
// marker already in TODO.md, so injectEntry dedup-skips instead of appending a
// second copy of the entry. When omitted (the normal Dispatch path) a fresh id is
// minted.
//
// `tail.onDispatched(rowId, entryId, correlationId, target)` runs after the
// dispatched state is persisted. The Agent board passes one to arm its status
// poller and repaint the board so the card leaves Drafted even where realtime
// isn't observed; the row layer passes none — its phase advances through the
// shared queue store's realtime subscription and its action clears on the next
// repaint, so nothing polls.
export async function dispatchDraft(row, draftText, existingEntryId, tail) {
    const rowId = row.id;
    const target = resolveDispatchTarget();

    // A fresh derive proposal ships with no source todo — `row.todo_id` is null
    // because the proposal was never a real list item (see agentView.js:713-716).
    // Left as-is the run injects into TODO.md and dispatches, but no visible todo
    // ever appears in the sidebar, and stampEntryShipped (keyed by todo_id) has
    // nothing to stamp when the PR merges. So when there is no source todo,
    // materialize a real one in the selected project from the proposal's context
    // and ship against IT. Mirrors refactorCard's pushCandidate: add by title,
    // look the created item up, backfill its description through the edit path.
    // Rows that already carry a todo_id (normal flagged tasks) skip this entirely.
    let todoId = row.todo_id;
    if (!todoId) {
        const projectName = getSelectedProjectName();
        const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
        const title = (ctx.title || '').toString().trim();
        if (projectName && title) {
            listLogic.addToDo(projectName, title);
            const items = listLogic.listItems(projectName) || [];
            const created = items.filter(function (it) { return it && it.tit === title; }).pop();
            if (created) {
                created.desc = (ctx.description || '').toString();
                listLogic.editToDoItem(projectName, created);
                todoId = created.id;
            }
        }
    }

    const res = await shipEntryForTodo({
        todoId: todoId,
        entryText: draftText,
        target: target,
        existingEntryId: existingEntryId,
    });
    if (!res || !res.ok) {
        return { ok: false, error: res.error };
    }

    const patch = {
        state: 'dispatched',
        entry_id: res.entryId,
        correlation_id: res.correlationId,
    };
    if (res.runId != null) patch.run_id = res.runId;
    // Persist a newly-minted todo id onto the queue row so later reconciliation
    // (stampEntryShipped, keyed by todo_id) can find and stamp it when the PR
    // merges. Only when this run created the todo — rows that already had a
    // todo_id don't rewrite it.
    if (!row.todo_id && todoId) patch.todo_id = todoId;
    await listLogic.setAgentRunState(rowId, patch);

    // Arm the dispatch reconciler for THIS in-session dispatch, from the one funnel
    // every surface (Dispatch, Retry, mockup Use, proposal Accept) resolves through.
    // The reconciler otherwise arms only from an `onQueueChange`, which fires only
    // after a settle, which comes only from the poller — a cycle nothing but a page
    // reload breaks, so a locally-dispatched run would never settle until a refresh.
    // Kicking here breaks that cycle so the run settles on its own within a poll
    // cycle of its PR merging. Fire-and-forget: a failed kick must leave the row
    // `dispatched` (reconciled on the next reload) and never turn a dispatch that
    // actually worked into a surfaced error, and must not block the success path or
    // its UI feedback. The realtime `onQueueChange` arming path stays intact for runs
    // dispatched from another device; both paths are safe together (evaluateReconciler
    // is idempotent and won't start a second interval).
    try {
        Promise.resolve(kickDispatchReconciler()).catch(function () {});
    } catch (e) { /* never let a kick failure fail the dispatch */ }

    if (tail && typeof tail.onDispatched === 'function') {
        tail.onDispatched(rowId, res.entryId, res.correlationId, target);
    }
    return { ok: true };
}
