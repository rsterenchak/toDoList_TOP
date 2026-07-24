import { listLogic } from './listLogic.js';
import {
    mintEntryId,
    embedEntryMarker,
    injectEntry,
    dispatchRun,
    readTodoMdFromWorker,
    markEntryPresentLocally,
    refreshShippedMarkers,
    showInjectToast,
} from './inject.js';

// The generic "ship a TODO.md entry tied to a todo and dispatch a run for it"
// core, extracted verbatim from agentView's dispatchDraft. It mints (or reuses)
// an entry id, embeds the marker, injects the entry into TODO.md, stamps the id
// back onto the source todo, waits (best-effort) for the marker to surface on
// main, then dispatches claude-run.yml in entry mode against that id.
//
// This module owns none of the Agent board's bookkeeping: it does NOT touch
// agent_queue, does NOT start any poller, and does NOT refresh any view — those
// stay in the caller. It returns enough for the caller to do that tail itself.

// How long the head-start marker-visibility poll waits before dispatching
// anyway. The on-main read served by the Worker is content-cache backed by a
// KV-ish variable and can lag past the window even though inject committed, and
// the run's own runner-boot latency (tens of seconds) reliably exceeds
// propagation, so if the marker doesn't surface in time we dispatch anyway
// rather than block a legitimate run. A rare genuine race then no-changes and
// self-heals on Retry.
const ENTRY_VISIBLE_ATTEMPTS = 8;
const ENTRY_VISIBLE_DELAY_MS = 1000;

// Ship a todo's entry through the run pipeline: mint an id, embed the marker,
// inject the entry into TODO.md, then dispatch claude-run.yml in entry mode
// against that id. On success returns { ok:true, entryId, correlationId, runId }
// (runId omitted when the dispatch didn't return one); on failure returns
// { ok:false, error } so the caller can surface a non-blocking failure.
//
// `existingEntryId` powers the Stuck-card Retry: passing the row's stored
// entry_id reuses the marker already in TODO.md, so injectEntry dedup-skips
// instead of appending a second copy of the entry. When omitted (the normal
// Dispatch path) a fresh id is minted.
export async function shipEntryForTodo(options) {
    const todoId = options.todoId;
    const entryText = options.entryText;
    const target = options.target;
    const existingEntryId = options.existingEntryId;

    const entryId = existingEntryId || mintEntryId();
    const entry = embedEntryMarker(entryText, entryId);

    const injectResult = await injectEntry({ entry: entry, id: entryId, target: target });
    if (!injectResult || !injectResult.ok) {
        return { ok: false, error: 'Inject failed — ' + ((injectResult && injectResult.reason) || 'error') };
    }

    // Write the entry id back to the source task so its tasks-view row shows the
    // run-status glyph — amber now (the marker is in TODO.md, unshipped), flipping
    // to green once the run merges and the entry's checkbox goes `[x]`. The glyph
    // resolves from `item.entryId` against the shared TODO.md marker cache, so
    // stamping the id is all that's needed for both edges: greenness is driven by
    // the checkbox the run itself sets, exactly as for inject-button tasks. The
    // stamp routes through listLogic (data-model writes must), keyed by the row's
    // `todo_id` (= the item's id); markEntryPresentLocally + a forced marker
    // refresh light the amber immediately, mirroring injectDescription.
    if (todoId != null) {
        // Surface a stamp failure rather than swallowing it: the run has been
        // injected/dispatched, but if the entry id doesn't reach the todo's
        // Supabase row the task is silently orphaned from its entry on every
        // other device — the same failure mode the inject button guards. A
        // failure here is a link failure, not a dispatch failure, so the toast
        // says exactly that.
        Promise.resolve(listLogic.stampTodoEntryId(todoId, entryId)).then(
            function (stamp) {
                if (!stamp || stamp.ok === false) {
                    showInjectToast('Run dispatched, but couldn’t link this task to its entry', 'error');
                }
            },
            function () {
                showInjectToast('Run dispatched, but couldn’t link this task to its entry', 'error');
            }
        );
        if (target && target.repo) {
            markEntryPresentLocally(target.repo, entryId);
            refreshShippedMarkers(target, true);
        }
    }

    // Best-effort head start: poll the same on-main read the reconcile path uses
    // for the entry's id marker, dispatching immediately once it appears so a run
    // doesn't race ahead of the push and no-op against a stale TODO.md. A
    // transient read error counts as a miss and is retried until the attempt
    // budget is spent. This is a head start, not a gate — if the marker never
    // surfaces we dispatch anyway below rather than block a legitimate run.
    const marker = '<!-- id: ' + entryId + ' -->';
    let visible = false;
    for (let i = 0; i < ENTRY_VISIBLE_ATTEMPTS; i++) {
        let read = null;
        try {
            read = await readTodoMdFromWorker(target);
        } catch (e) { read = null; }
        if (read && read.ok !== false && typeof read.content === 'string'
            && read.content.indexOf(marker) !== -1) {
            visible = true;
            break;
        }
        if (i < ENTRY_VISIBLE_ATTEMPTS - 1) {
            await new Promise(function (res) { setTimeout(res, ENTRY_VISIBLE_DELAY_MS); });
        }
    }
    if (!visible) {
        // The entry was injected (marker appended) but hasn't propagated to the
        // on-main read within the window. Don't block: the run's boot latency
        // covers the remaining propagation, so dispatch anyway. A rare genuine
        // race then no-changes and self-heals on Retry, which reuses this
        // entry_id (persisted below alongside the dispatched state).
        console.warn('dispatchDraft: entry ' + entryId
            + ' not confirmed on main within the visibility window; dispatching anyway');
    }

    const correlationId = mintEntryId();
    const dispatchResult = await dispatchRun({
        mode: 'entry',
        entryId: entryId,
        correlationId: correlationId,
        target: target,
    });
    if (!dispatchResult || !dispatchResult.ok) {
        return { ok: false, error: 'Run failed — ' + ((dispatchResult && dispatchResult.reason) || 'error') };
    }

    const result = { ok: true, entryId: entryId, correlationId: correlationId };
    if (dispatchResult.runId != null) result.runId = dispatchResult.runId;
    return result;
}
