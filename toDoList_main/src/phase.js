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
// from `inject.js` and reads the in-memory item's acknowledgement stamp, and
// neither of those touch the row layer — so a module the row layer consumes
// stays acyclic. Do NOT import this module from `todoStatus.js` or `inject.js`;
// that would recreate the import cycle those files are structured to avoid.
//
// The phase vocabulary is intentionally four-valued — there is no `'run'` phase.
// Per-entry run state is not tracked on task rows, so `derivePhase` never reaches
// for the Worker `active_runs` probe or `runState.js` to synthesize one.

import { resolveEntryRunState } from './inject.js';


// The four pipeline phases a task row can occupy, exported so both the badge and
// the glyph key off the same constants rather than re-hardcoding the strings.
//   'none'  — no entry id, or the marker is absent from every cached TODO.md
//   'draft' — the marker is present in TODO.md but its entry is still unchecked
//   'accept'— the marker sits on a CHECKED entry that has NOT been acknowledged
//   'done'  — the marker sits on a CHECKED entry that HAS been acknowledged
export const PHASE = Object.freeze({
    NONE: 'none',
    DRAFT: 'draft',
    ACCEPT: 'accept',
    DONE: 'done',
});


// Resolve a single item to exactly one pipeline phase. Synchronous by contract:
// both call sites are on the render path and cannot await — `resolveEntryRunState`
// reads the shared marker cache synchronously, and the acknowledgement check
// reads the in-memory item's own `entryReviewedAt` stamp. The mapping mirrors the
// three-way run state resolver: 'pending' → draft, 'shipped' splits on the
// acknowledgement stamp into accept (unreviewed) or done (reviewed), and both the
// falsy-id and cache-miss cases collapse to 'none'.
export function derivePhase(item) {
    if (!item || !item.entryId) return PHASE.NONE;
    const runState = resolveEntryRunState(item.entryId);
    if (runState === 'pending') return PHASE.DRAFT;
    if (runState === 'shipped') {
        return item.entryReviewedAt ? PHASE.DONE : PHASE.ACCEPT;
    }
    return PHASE.NONE;
}
