import { listLogic } from './listLogic.js';
import { findTargetById, mintEntryId, embedEntryMarker } from './inject.js';
import { shipEntryForTodo } from './shipEntry.js';
import { kickDispatchReconciler } from './agentQueueStore.js';

// Shared dispatch core for a drafted/stuck agent_queue row's entry. Extracted out
// of agentView so BOTH the Agent board and the task-row description panel ship a
// draft and retry a failed run through ONE implementation — the entry-id reuse
// that keeps Retry from appending a duplicate to TODO.md, and the dispatched-state
// persistence that moves the card on, can never drift between the two surfaces.
// This module statically imports neither agentView.js nor the row layer, so it
// stays acyclic for both importers. The row-layer render helpers it needs to
// repaint #mainList after materializing a derive-proposal todo are pulled in
// lazily via a dynamic import (see rebuildSelectedList), which keeps the static
// module graph free of the cycle that a top-level `import ./toDoRow.js` would form
// (toDoRow imports this module).

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
    // through the shared `materializeEntryTodo` (chat's Inject & run uses the same
    // helper) and ship against IT. Rows that already carry a todo_id (normal
    // flagged tasks) skip this entirely.
    //
    // The created todo's description is the ENTRY being injected (`draftText`), NOT
    // the proposal's short summary (`ctx.description`) — the summary reads fine as a
    // blurb but has no `- Type:`/`- Description:`/`- File:` structure, so everything
    // downstream that parses `item.desc` (WHAT CHANGED, COPY CONTEXT, ITERATE) breaks
    // against it. We mint the entry id up front and embed the marker before handing
    // the entry to `materializeEntryTodo`, so the todo's `desc` matches byte-for-byte
    // what shipEntryForTodo injects into TODO.md (it embeds the same id into the same
    // `draftText`), and COPY CONTEXT's block carries the marker that makes a follow-up
    // traceable. The minted id is passed on to shipEntryForTodo as its entry id so the
    // two never diverge.
    let todoId = row.todo_id;
    let shipEntryId = existingEntryId;
    if (!todoId) {
        const projectName = getSelectedProjectName();
        const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
        const title = (ctx.title || '').toString().trim();
        if (projectName && title) {
            const entryId = existingEntryId || mintEntryId();
            const createdId = await materializeEntryTodo(
                projectName,
                title,
                embedEntryMarker((draftText || '').toString(), entryId)
            );
            if (createdId) {
                todoId = createdId;
                shipEntryId = entryId;
            }
        }
    }

    const res = await shipEntryForTodo({
        todoId: todoId,
        entryText: draftText,
        target: target,
        existingEntryId: shipEntryId,
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

// Create a real todo for an entry that is about to ship but has no source list
// item — a fresh derive proposal (dispatchDraft, above) or an entry drafted
// straight from chat's Inject & run (claudeSheet). Adds a todo titled `title`
// to `projectName`, backfills its description with `entryText` — the FULL entry
// as injected, marker and all, so everything reading `item.desc` (WHAT CHANGED,
// COPY CONTEXT, ITERATE) sees byte-for-byte what shipped — then repaints
// #mainList when that project is the one on screen so the row appears without a
// project switch. Callers embed the `<!-- id -->` marker into `entryText`
// themselves (the derive path via embedEntryMarker, chat by passing the already-
// injected entry), so this helper stays marker-agnostic.
//
// Returns the created todo's id, or null when creation was skipped (no project
// or title) or the row couldn't be found after adding. The RUN LINKAGE is left
// to the caller because it differs: the Agent board persists the id onto its
// agent_queue row (stampEntryShipped later keys off it), while chat has no
// queue row and stamps the entry id straight onto the todo via stampTodoEntryId.
//
// Mirrors refactorCard's pushCandidate: add by title, look the created item up
// by diffing ids (addToDo returns nothing), backfill through the edit path. The
// id diff is what stops a pre-existing task — or a second proposal — that shares
// the title from being adopted as "the created todo".
export async function materializeEntryTodo(projectName, title, entryText) {
    const cleanTitle = (title || '').toString().trim();
    if (!projectName || !cleanTitle) return null;
    const beforeIds = new Set(
        (listLogic.listItems(projectName) || []).map(function (it) { return it && it.id; })
    );
    listLogic.addToDo(projectName, cleanTitle);
    const items = listLogic.listItems(projectName) || [];
    const created = items.filter(function (it) {
        return it && it.tit === cleanTitle && !beforeIds.has(it.id);
    }).pop();
    if (!created) return null;
    created.desc = (entryText || '').toString();
    listLogic.editToDoItem(projectName, created);
    // Repaint the visible list now — #mainList only rebuilds from data on project
    // selection, so the new row would otherwise stay invisible until the user
    // navigates away and back. Guarded on the created todo still belonging to the
    // currently-selected project so an unrelated project's list is never repainted
    // (chat can create a todo in a project that isn't on screen).
    if (projectName === getSelectedProjectName()) {
        await rebuildSelectedList(projectName);
    }
    return created.id;
}

// Rebuild #mainList for `projectName` from the data model, mirroring the project-
// selection render (and refactorCard/seedTasksModal's post-add rebuild): clear the
// list, then re-render either the real items or the empty-project placeholder. The
// row-layer render helpers live in toDoRow.js, which imports THIS module, so they
// are pulled in with a dynamic import to avoid a static cycle (see the module note
// above). Best-effort by design: a repaint failure must never turn a dispatch that
// already created the todo and shipped the run into a surfaced error.
async function rebuildSelectedList(projectName) {
    const mainList = document.getElementById('mainList');
    if (!mainList) return;
    try {
        const toDoRow = await import('./toDoRow.js');
        while (mainList.firstChild) mainList.removeChild(mainList.firstChild);
        const items = listLogic.listItems(projectName);
        const hasRealItems = items && items.some(function (i) { return i.tit !== ''; });
        if (hasRealItems) {
            toDoRow.addToDos_restore(items, projectName);
        } else if (items) {
            toDoRow.addAllToDo_DOM(items, projectName);
        }
    } catch (e) { /* best-effort repaint — never fail the dispatch on a render error */ }
}
