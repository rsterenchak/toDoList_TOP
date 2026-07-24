// Single source of truth for a task row's pipeline phase.
//
// A task row used to compute its pipeline state in two independent places —
// the status badge resolved shipped-and-unreviewed to decide whether to render
// `⌁ REVIEW`, and the run glyph separately resolved shipped/pending to pick its
// icon. Both read the same underlying facts through different code paths, so
// they could drift and visibly duplicated (an unreviewed row showed the amber
// REVIEW badge AND the green shipped check at once, marking one fact twice).
//
// `derivePhase(item)` collapses both decisions into ONE phase per item so both
// surfaces read from the same result. It is deliberately kept in its own module,
// consumed only by the row layer (`toDoRow.js`): it imports `resolveEntryRunState`
// from `inject.js`, reads the in-memory item's acknowledgement stamp, and reads
// the shared agent-queue cache (`getQueueRowForTodo`) — none of those touch the
// row layer, so a module the row layer consumes stays acyclic. Do NOT import this
// module from `todoStatus.js` or `inject.js`; that would recreate the import
// cycle those files are structured to avoid.
//
// The phase vocabulary is six-valued — still no `'run'` phase. Per-entry run
// state is not tracked on task rows, so `derivePhase` never reaches for the
// Worker `active_runs` probe or `runState.js` to synthesize one. The two values
// beyond the four pipeline phases are `'asking'` and `'drafted'` — both states
// genuinely blocked on the user that live on the triage `agent_queue` rather than
// the marker pipeline. `'asking'` is a linked queue row parked in `needs_words`
// (triage has a pending question); `'drafted'` is a linked queue row in `drafted`
// whose landed draft the user has not yet looked at (`!item.draftSeenAt`). Both
// are triage-queue facts, not pipeline facts, so they outrank the four
// marker-derived phases when they apply; between them, `asking` outranks
// `drafted`.

import { resolveEntryRunState } from './inject.js';
import { getQueueRowForTodo } from './agentQueueStore.js';


// The pipeline phases a task row can occupy, exported so both the badge and the
// glyph key off the same constants rather than re-hardcoding the strings.
//   'none'  — no entry id, or the marker is absent from every cached TODO.md
//   'draft' — the marker is present in TODO.md but its entry is still unchecked
//   'accept'— the marker sits on a CHECKED entry that has NOT been acknowledged
//   'done'  — the marker sits on a CHECKED entry that HAS been acknowledged
//   'asking'— the item's linked agent_queue row is in `needs_words`: triage has a
//             pending question. Outranks the four above; independent of the marker.
//   'drafted'— the item's linked agent_queue row is in `drafted` and its landed
//             draft has not been looked at yet (`!item.draftSeenAt`): the derived
//             entry is sitting unread. Outranks the four marker-derived phases;
//             `asking` outranks it. Independent of the marker.
export const PHASE = Object.freeze({
    NONE: 'none',
    DRAFT: 'draft',
    ACCEPT: 'accept',
    DONE: 'done',
    ASKING: 'asking',
    DRAFTED: 'drafted',
});


// Resolve a single item to exactly one pipeline phase. Synchronous by contract:
// every call site is on the render path and cannot await — `getQueueRowForTodo`
// reads the shared agent-queue cache synchronously, `resolveEntryRunState` reads
// the shared marker cache synchronously, and the acknowledgement check reads the
// in-memory item's own `entryReviewedAt` stamp. `asking` is checked first because
// a pending triage question outranks the marker-derived phases; `drafted` is
// checked next (a landed-but-unread draft, `!item.draftSeenAt`) so it too outranks
// the marker phases while yielding to `asking`. The remaining mapping then mirrors
// the three-way run state resolver — 'pending' → draft, 'shipped' splits on the
// acknowledgement stamp into accept (unreviewed) or done (reviewed), and both the
// falsy-id and cache-miss cases collapse to 'none'.
export function derivePhase(item) {
    if (!item) return PHASE.NONE;
    const queueRow = item.id ? getQueueRowForTodo(item.id) : null;
    if (queueRow && queueRow.state === 'needs_words') return PHASE.ASKING;
    if (queueRow && queueRow.state === 'drafted' && !item.draftSeenAt) return PHASE.DRAFTED;
    if (!item.entryId) return PHASE.NONE;
    const runState = resolveEntryRunState(item.entryId);
    if (runState === 'pending') return PHASE.DRAFT;
    if (runState === 'shipped') {
        return item.entryReviewedAt ? PHASE.DONE : PHASE.ACCEPT;
    }
    return PHASE.NONE;
}


// The set of phases that mean a task is genuinely blocked on the user: ACCEPT
// (shipped but unacknowledged — derivePhase only returns ACCEPT while unreviewed,
// flipping to DONE once `entryReviewedAt` is set, so no extra unreviewed check is
// needed here), ASKING (a parked triage question), and DRAFTED (a landed draft
// not yet looked at). This is the single definition of the blocked set — the
// status filter's blocked-on-you toggle reads it rather than inlining the three
// phases, so a fourth blocked state later lands in exactly one place.
export function isBlockedPhase(phase) {
    return phase === PHASE.ACCEPT || phase === PHASE.ASKING || phase === PHASE.DRAFTED;
}


// ── PHASE RAIL VOCABULARY ────────────────────────────────────────────────
// The read-only phase rail (currently rendered in the mobile description-editor
// modal) shows the pipeline as four ordered nodes and highlights the one a task
// occupies. These two exports are its single source of truth so any surface that
// grows a rail later — e.g. the desktop `#descSibling` panel — reuses the same
// vocabulary and order rather than defining a second copy that could drift.
//
// PHASE_RAIL_ORDER is the left → right node order. It intentionally lists only
// the FOUR pipeline phases, not `asking`: `asking` is a triage-queue fact, not a
// pipeline node, so it has no rail node of its own — a rail renderer resolves it
// to its underlying DRAFT stage rather than inventing a fifth node. There is
// deliberately no RUN node: per-row run state is not tracked, and a permanently
// empty node reads worse than no node.
export const PHASE_RAIL_ORDER = Object.freeze([
    PHASE.NONE, PHASE.DRAFT, PHASE.ACCEPT, PHASE.DONE,
]);

// The short uppercase display label each rail node shows. Keyed by the same
// phase values derivePhase returns so a renderer can map a derived phase straight
// to its node label.
export const PHASE_RAIL_LABELS = Object.freeze({
    [PHASE.NONE]: 'IDEA',
    [PHASE.DRAFT]: 'DRAFT',
    [PHASE.ACCEPT]: 'REVIEW',
    [PHASE.DONE]: 'DONE',
});
