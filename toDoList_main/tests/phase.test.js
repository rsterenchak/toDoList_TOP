import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    markEntryPresentLocally,
    forgetEntryMarkerLocally,
    refreshShippedMarkers,
    initInjectConfig,
} from '../src/inject.js';
import { derivePhase, PHASE, PHASE_RAIL_ORDER, PHASE_RAIL_LABELS, isBlockedPhase } from '../src/phase.js';
import { setQueueRows } from '../src/agentQueueStore.js';

// derivePhase is the single source of truth for a task row's pipeline phase:
// the status badge and the run glyph both read it so they can never drift. It
// resolves the shared agent-queue cache (via getQueueRowForTodo) plus the shared
// TODO.md marker cache (via resolveEntryRunState) plus the in-memory item's
// `entryReviewedAt` acknowledgement stamp, all synchronously.

let realFetch;
function mockTodoMd(content) {
    globalThis.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: content }),
    }));
}

let repoSeq = 0;
function freshTarget() {
    repoSeq += 1;
    return { repo: 'owner/phase-repo-' + repoSeq, file_path: 'TODO.md' };
}

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();
    realFetch = globalThis.fetch;
});
afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    // Clear the shared agent-queue cache so an `asking` seed can't leak between
    // tests (derivePhase reads it synchronously via getQueueRowForTodo).
    setQueueRows([]);
});

describe('PHASE constants', () => {
    it('exposes the nine phases (four pipeline + asking + drafted + stuck + mockup + running), and no run phase', () => {
        expect(PHASE).toEqual({
            NONE: 'none',
            DRAFT: 'draft',
            ACCEPT: 'accept',
            DONE: 'done',
            ASKING: 'asking',
            DRAFTED: 'drafted',
            STUCK: 'stuck',
            MOCKUP: 'mockup',
            RUNNING: 'running',
        });
        // 'running' is a phase, but there is still no bare 'run' phase.
        expect(Object.values(PHASE)).not.toContain('run');
    });
});

describe('PHASE_RAIL_ORDER / PHASE_RAIL_LABELS — read-only rail vocabulary', () => {
    it('orders the four pipeline phases left → right, with no run and no asking node', () => {
        expect(PHASE_RAIL_ORDER).toEqual([PHASE.NONE, PHASE.DRAFT, PHASE.ACCEPT, PHASE.DONE]);
        // asking/drafted/stuck/mockup are triage-queue facts, not rail nodes — none appear.
        expect(PHASE_RAIL_ORDER).not.toContain(PHASE.ASKING);
        expect(PHASE_RAIL_ORDER).not.toContain(PHASE.DRAFTED);
        expect(PHASE_RAIL_ORDER).not.toContain(PHASE.STUCK);
        expect(PHASE_RAIL_ORDER).not.toContain(PHASE.MOCKUP);
        expect(PHASE_RAIL_ORDER).not.toContain(PHASE.RUNNING);
        expect(PHASE_RAIL_ORDER).not.toContain('run');
    });

    it('maps each rail phase to its short uppercase display label', () => {
        expect(PHASE_RAIL_LABELS[PHASE.NONE]).toBe('IDEA');
        expect(PHASE_RAIL_LABELS[PHASE.DRAFT]).toBe('DRAFT');
        expect(PHASE_RAIL_LABELS[PHASE.ACCEPT]).toBe('REVIEW');
        expect(PHASE_RAIL_LABELS[PHASE.DONE]).toBe('DONE');
    });

    it('has a label for every rail-order phase (no missing node label)', () => {
        PHASE_RAIL_ORDER.forEach((p) => {
            expect(typeof PHASE_RAIL_LABELS[p]).toBe('string');
            expect(PHASE_RAIL_LABELS[p].length).toBeGreaterThan(0);
        });
    });
});

describe('derivePhase — asking outranks the marker-derived phases', () => {
    it("returns 'asking' when the item's linked queue row is in needs_words", () => {
        setQueueRows([{ id: 'q1', todo_id: 'todo-asking', state: 'needs_words' }]);
        expect(derivePhase({ id: 'todo-asking' })).toBe(PHASE.ASKING);
    });

    it('outranks a shipped/checked marker when both apply', async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: phase-asking-ship -->');
        await refreshShippedMarkers(freshTarget());
        // Without a queue row this is ACCEPT…
        expect(derivePhase({ id: 'todo-x', entryId: 'phase-asking-ship' })).toBe(PHASE.ACCEPT);
        // …but a needs_words queue row on the same todo takes precedence.
        setQueueRows([{ id: 'q2', todo_id: 'todo-x', state: 'needs_words' }]);
        expect(derivePhase({ id: 'todo-x', entryId: 'phase-asking-ship' })).toBe(PHASE.ASKING);
    });

    it('ignores a linked queue row in any other state', () => {
        setQueueRows([{ id: 'q3', todo_id: 'todo-tri', state: 'triaging' }]);
        expect(derivePhase({ id: 'todo-tri' })).toBe(PHASE.NONE);
        expect(derivePhase({ id: 'todo-tri', entryId: 'never-seen' })).toBe(PHASE.NONE);
    });

    it('is unaffected when the item has no id or no linked row', () => {
        setQueueRows([{ id: 'q4', todo_id: 'someone-else', state: 'needs_words' }]);
        expect(derivePhase({ entryId: 'never-seen' })).toBe(PHASE.NONE);
        expect(derivePhase({ id: 'unlinked' })).toBe(PHASE.NONE);
    });
});

describe('derivePhase — drafted (landed-but-unread draft) outranks the marker phases', () => {
    it("returns 'drafted' when the linked queue row is drafted and the draft is unseen", () => {
        setQueueRows([{ id: 'q5', todo_id: 'todo-drafted', state: 'drafted' }]);
        expect(derivePhase({ id: 'todo-drafted' })).toBe(PHASE.DRAFTED);
    });

    it("clears to the underlying phase once draftSeenAt is stamped", async () => {
        setQueueRows([{ id: 'q6', todo_id: 'todo-seen', state: 'drafted' }]);
        // Unseen → DRAFTED…
        expect(derivePhase({ id: 'todo-seen' })).toBe(PHASE.DRAFTED);
        // …once looked at, the drafted overlay is gone. With no marker it is NONE.
        expect(derivePhase({ id: 'todo-seen', draftSeenAt: '2026-07-22T00:00:00.000Z' }))
            .toBe(PHASE.NONE);
    });

    it('yields to asking when both could apply (asking outranks drafted)', () => {
        // A single queue row can only be in one state, but the ranking is pinned
        // by check order: needs_words is tested before drafted.
        setQueueRows([{ id: 'q7', todo_id: 'todo-both', state: 'needs_words' }]);
        expect(derivePhase({ id: 'todo-both' })).toBe(PHASE.ASKING);
    });

    it('outranks a shipped/checked marker when the queue row is drafted', async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: phase-drafted-ship -->');
        await refreshShippedMarkers(freshTarget());
        // Without a queue row this is ACCEPT…
        expect(derivePhase({ id: 'todo-d', entryId: 'phase-drafted-ship' })).toBe(PHASE.ACCEPT);
        // …but an unseen drafted queue row on the same todo takes precedence.
        setQueueRows([{ id: 'q8', todo_id: 'todo-d', state: 'drafted' }]);
        expect(derivePhase({ id: 'todo-d', entryId: 'phase-drafted-ship' })).toBe(PHASE.DRAFTED);
        // Once the draft is seen, the marker phase (ACCEPT) shows through again.
        expect(derivePhase({ id: 'todo-d', entryId: 'phase-drafted-ship', draftSeenAt: '2026-07-22T00:00:00.000Z' }))
            .toBe(PHASE.ACCEPT);
    });

    it('ignores a drafted row for a different todo, or a missing id', () => {
        setQueueRows([{ id: 'q9', todo_id: 'someone-else', state: 'drafted' }]);
        expect(derivePhase({ id: 'unlinked' })).toBe(PHASE.NONE);
        expect(derivePhase({ draftSeenAt: undefined })).toBe(PHASE.NONE);
    });
});

describe('derivePhase — stuck (a failed / no_change run) outranks the marker phases', () => {
    it("returns 'stuck' when the linked queue row is in failed", () => {
        setQueueRows([{ id: 'qs1', todo_id: 'todo-failed', state: 'failed' }]);
        expect(derivePhase({ id: 'todo-failed' })).toBe(PHASE.STUCK);
    });

    it("returns 'stuck' when the linked queue row is in no_change", () => {
        setQueueRows([{ id: 'qs2', todo_id: 'todo-nochange', state: 'no_change' }]);
        expect(derivePhase({ id: 'todo-nochange' })).toBe(PHASE.STUCK);
    });

    it('outranks a pending (present-but-unchecked) marker — a failed run leaves its entry unchecked', () => {
        markEntryPresentLocally('owner/stuck-repo', 'phase-stuck-pending');
        // Without a queue row the still-unchecked marker reads as DRAFT…
        expect(derivePhase({ id: 'todo-sp', entryId: 'phase-stuck-pending' })).toBe(PHASE.DRAFT);
        // …but a failed queue row on the same todo takes precedence.
        setQueueRows([{ id: 'qs3', todo_id: 'todo-sp', state: 'failed' }]);
        expect(derivePhase({ id: 'todo-sp', entryId: 'phase-stuck-pending' })).toBe(PHASE.STUCK);
    });

    it('outranks a shipped/checked marker as well', async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: phase-stuck-ship -->');
        await refreshShippedMarkers(freshTarget());
        expect(derivePhase({ id: 'todo-ss', entryId: 'phase-stuck-ship' })).toBe(PHASE.ACCEPT);
        setQueueRows([{ id: 'qs4', todo_id: 'todo-ss', state: 'no_change' }]);
        expect(derivePhase({ id: 'todo-ss', entryId: 'phase-stuck-ship' })).toBe(PHASE.STUCK);
    });

    it('clears when the queue row moves to another state (re-triage / re-dispatch)', () => {
        setQueueRows([{ id: 'qs5', todo_id: 'todo-clear', state: 'failed' }]);
        expect(derivePhase({ id: 'todo-clear' })).toBe(PHASE.STUCK);
        // Re-triaging moves the row back to triaging — not a blocked/derived phase —
        // so with no marker the row collapses back to NONE.
        setQueueRows([{ id: 'qs5', todo_id: 'todo-clear', state: 'triaging' }]);
        expect(derivePhase({ id: 'todo-clear' })).toBe(PHASE.NONE);
    });
});

describe('derivePhase — mockup (a needs_mockup run) outranks the marker phases', () => {
    it("returns 'mockup' when the linked queue row is in needs_mockup", () => {
        setQueueRows([{ id: 'qm1', todo_id: 'todo-mockup', state: 'needs_mockup' }]);
        expect(derivePhase({ id: 'todo-mockup' })).toBe(PHASE.MOCKUP);
    });

    it('outranks a pending (present-but-unchecked) marker', () => {
        markEntryPresentLocally('owner/mockup-repo', 'phase-mockup-pending');
        // Without a queue row the still-unchecked marker reads as DRAFT…
        expect(derivePhase({ id: 'todo-mp', entryId: 'phase-mockup-pending' })).toBe(PHASE.DRAFT);
        // …but a needs_mockup queue row on the same todo takes precedence.
        setQueueRows([{ id: 'qm2', todo_id: 'todo-mp', state: 'needs_mockup' }]);
        expect(derivePhase({ id: 'todo-mp', entryId: 'phase-mockup-pending' })).toBe(PHASE.MOCKUP);
    });

    it('outranks a shipped/checked marker as well', async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: phase-mockup-ship -->');
        await refreshShippedMarkers(freshTarget());
        expect(derivePhase({ id: 'todo-ms', entryId: 'phase-mockup-ship' })).toBe(PHASE.ACCEPT);
        setQueueRows([{ id: 'qm3', todo_id: 'todo-ms', state: 'needs_mockup' }]);
        expect(derivePhase({ id: 'todo-ms', entryId: 'phase-mockup-ship' })).toBe(PHASE.MOCKUP);
    });

    it('clears when the queue row leaves needs_mockup (a mockup is chosen / re-triage)', () => {
        setQueueRows([{ id: 'qm4', todo_id: 'todo-mclear', state: 'needs_mockup' }]);
        expect(derivePhase({ id: 'todo-mclear' })).toBe(PHASE.MOCKUP);
        // Choosing a mockup or re-triaging moves the row on — with no marker it
        // collapses back to NONE.
        setQueueRows([{ id: 'qm4', todo_id: 'todo-mclear', state: 'triaging' }]);
        expect(derivePhase({ id: 'todo-mclear' })).toBe(PHASE.NONE);
    });

    it('ignores a needs_mockup row for a different todo, or a missing id', () => {
        setQueueRows([{ id: 'qm5', todo_id: 'someone-else', state: 'needs_mockup' }]);
        expect(derivePhase({ id: 'unlinked' })).toBe(PHASE.NONE);
        expect(derivePhase({})).toBe(PHASE.NONE);
    });
});

describe('derivePhase — running (an in-flight dispatched run) outranks the marker phases', () => {
    it("returns 'running' when the linked queue row is dispatched", () => {
        setQueueRows([{ id: 'qr1', todo_id: 'todo-disp', state: 'dispatched' }]);
        expect(derivePhase({ id: 'todo-disp' })).toBe(PHASE.RUNNING);
    });

    it("returns 'running' when the linked queue row is running", () => {
        setQueueRows([{ id: 'qr2', todo_id: 'todo-run', state: 'running' }]);
        expect(derivePhase({ id: 'todo-run' })).toBe(PHASE.RUNNING);
    });

    it('outranks a pending (present-but-unchecked) marker — a dispatched run injects its entry first', () => {
        markEntryPresentLocally('owner/running-repo', 'phase-running-pending');
        // Without a queue row the still-unchecked marker reads as DRAFT…
        expect(derivePhase({ id: 'todo-rp', entryId: 'phase-running-pending' })).toBe(PHASE.DRAFT);
        // …but a dispatched queue row on the same todo takes precedence.
        setQueueRows([{ id: 'qr3', todo_id: 'todo-rp', state: 'running' }]);
        expect(derivePhase({ id: 'todo-rp', entryId: 'phase-running-pending' })).toBe(PHASE.RUNNING);
    });

    it('yields to the four user-blocking queue states (they outrank running)', () => {
        // A single row is only ever in one state, but the ranking is pinned by
        // check order: needs_words / drafted / failed / needs_mockup are all
        // tested before dispatched|running.
        setQueueRows([{ id: 'qr4', todo_id: 'todo-rank', state: 'needs_words' }]);
        expect(derivePhase({ id: 'todo-rank' })).toBe(PHASE.ASKING);
        setQueueRows([{ id: 'qr4', todo_id: 'todo-rank', state: 'failed' }]);
        expect(derivePhase({ id: 'todo-rank' })).toBe(PHASE.STUCK);
        setQueueRows([{ id: 'qr4', todo_id: 'todo-rank', state: 'needs_mockup' }]);
        expect(derivePhase({ id: 'todo-rank' })).toBe(PHASE.MOCKUP);
    });

    it('is NOT a blocked phase and NOT a rail node', () => {
        expect(isBlockedPhase(PHASE.RUNNING)).toBe(false);
        expect(PHASE_RAIL_ORDER).not.toContain(PHASE.RUNNING);
    });

    it('clears when the queue row leaves dispatched/running', () => {
        setQueueRows([{ id: 'qr5', todo_id: 'todo-rclear', state: 'dispatched' }]);
        expect(derivePhase({ id: 'todo-rclear' })).toBe(PHASE.RUNNING);
        // A run that completes moves the row on — with no marker it collapses to NONE.
        setQueueRows([{ id: 'qr5', todo_id: 'todo-rclear', state: 'triaging' }]);
        expect(derivePhase({ id: 'todo-rclear' })).toBe(PHASE.NONE);
    });

    it('resolves RUNNING, not MOCKUP, for a todo holding a stale needs_mockup row and a newer dispatched row', () => {
        // A deferred-mockup task that is then injected directly ends up with TWO
        // queue rows: the stale needs_mockup one and a newer dispatched one.
        // getQueueRowForTodo must return the newer (dispatched) row so the row
        // paints its pending glyph instead of hanging on the ⌁ MOCKUP overlay.
        setQueueRows([
            { id: 'stale', todo_id: 'todo-defer', state: 'needs_mockup', created_at: '2026-07-01T00:00:00Z' },
            { id: 'fresh', todo_id: 'todo-defer', state: 'dispatched', created_at: '2026-07-02T00:00:00Z' },
        ]);
        expect(derivePhase({ id: 'todo-defer' })).toBe(PHASE.RUNNING);
        // Cache order must not change the outcome.
        setQueueRows([
            { id: 'fresh', todo_id: 'todo-defer', state: 'dispatched', created_at: '2026-07-02T00:00:00Z' },
            { id: 'stale', todo_id: 'todo-defer', state: 'needs_mockup', created_at: '2026-07-01T00:00:00Z' },
        ]);
        expect(derivePhase({ id: 'todo-defer' })).toBe(PHASE.RUNNING);
    });
});

describe('derivePhase — one phase per item', () => {
    it("returns 'none' for a missing item, a falsy id, or a marker absent from every cache", () => {
        expect(derivePhase(null)).toBe(PHASE.NONE);
        expect(derivePhase({})).toBe(PHASE.NONE);
        expect(derivePhase({ entryId: '' })).toBe(PHASE.NONE);
        expect(derivePhase({ entryId: 'never-seen-anywhere' })).toBe(PHASE.NONE);
    });

    it("returns 'draft' while the marker is present but unchecked", () => {
        markEntryPresentLocally('owner/draft-repo', 'phase-draft-id');
        expect(derivePhase({ entryId: 'phase-draft-id' })).toBe(PHASE.DRAFT);
        // A review stamp is now an independent terminal DONE gate checked ahead of
        // the marker: acknowledging is only reachable from ACCEPT, so a stamp is
        // proof the task shipped and it resolves DONE even over an unchecked marker.
        expect(derivePhase({
            entryId: 'phase-draft-id', entryReviewedAt: '2026-07-22T00:00:00.000Z',
        })).toBe(PHASE.DONE);
    });

    it("returns 'accept' when checked but not acknowledged, 'done' when acknowledged", async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: phase-ship-id -->');
        await refreshShippedMarkers(freshTarget());
        expect(derivePhase({ entryId: 'phase-ship-id' })).toBe(PHASE.ACCEPT);
        expect(derivePhase({
            entryId: 'phase-ship-id', entryReviewedAt: '2026-07-22T00:00:00.000Z',
        })).toBe(PHASE.DONE);
    });

    it("drops back to 'none' once the marker is forgotten (deleted/reverted)", async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: phase-forget-id -->');
        await refreshShippedMarkers(freshTarget());
        expect(derivePhase({ entryId: 'phase-forget-id' })).toBe(PHASE.ACCEPT);
        forgetEntryMarkerLocally('phase-forget-id');
        expect(derivePhase({ entryId: 'phase-forget-id' })).toBe(PHASE.NONE);
    });
});


describe('derivePhase — a stamped ship survives a TODO.md rewrite (shippedAt)', () => {
    it("returns 'accept' for a stamped, unreviewed task with NO marker present", () => {
        // No marker anywhere in the cache — the file was cleared — yet the DB stamp
        // keeps the task reporting REVIEW rather than collapsing to IDEA/NONE.
        expect(derivePhase({
            id: 'todo-stamped', entryId: 'gone-from-file',
            shippedAt: '2026-07-28T00:00:00.000Z',
        })).toBe(PHASE.ACCEPT);
    });

    it("returns 'done' when both shippedAt and entryReviewedAt are set, marker absent", () => {
        expect(derivePhase({
            id: 'todo-stamped2', entryId: 'gone-from-file',
            shippedAt: '2026-07-28T00:00:00.000Z',
            entryReviewedAt: '2026-07-28T01:00:00.000Z',
        })).toBe(PHASE.DONE);
    });

    it('resolves REVIEW from the stamp even with no entryId at all', () => {
        expect(derivePhase({
            id: 'todo-stamped3', shippedAt: '2026-07-28T00:00:00.000Z',
        })).toBe(PHASE.ACCEPT);
    });

    it('a task with NO stamp still resolves from the marker (fallback preserved)', async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: phase-nostamp-id -->');
        await refreshShippedMarkers(freshTarget());
        // Unstamped (pre-migration) ship — the marker path still drives ACCEPT/DONE.
        expect(derivePhase({ id: 'todo-nostamp', entryId: 'phase-nostamp-id' }))
            .toBe(PHASE.ACCEPT);
        expect(derivePhase({
            id: 'todo-nostamp', entryId: 'phase-nostamp-id',
            entryReviewedAt: '2026-07-28T01:00:00.000Z',
        })).toBe(PHASE.DONE);
    });

    it('yields to the queue-derived phases (a live queue row still outranks the stamp)', () => {
        // A stamped ship plus an in-flight/blocked queue row: the queue state wins,
        // exactly as it outranks the marker-derived terminal phases.
        setQueueRows([{ id: 'qsh', todo_id: 'todo-stamp-q', state: 'needs_words' }]);
        expect(derivePhase({
            id: 'todo-stamp-q', shippedAt: '2026-07-28T00:00:00.000Z',
        })).toBe(PHASE.ASKING);
    });
});


describe('derivePhase — entryReviewedAt is its own terminal proof-of-ship gate', () => {
    it("returns 'done' for a task with only entryReviewedAt (no shippedAt, no marker)", () => {
        // Acknowledging is only reachable from ACCEPT, which already requires
        // shipped-ness, so a review stamp cannot exist on a task that never shipped.
        // Tasks acknowledged before shipped_at existed, and tasks whose markers were
        // destroyed by `clear all entries`, have neither gate — the review stamp alone
        // must still resolve DONE rather than collapsing to NONE.
        expect(derivePhase({
            id: 'todo-reviewed-only', entryId: 'gone-from-file',
            entryReviewedAt: '2026-07-28T00:00:00.000Z',
        })).toBe(PHASE.DONE);
        // Even with no entryId at all.
        expect(derivePhase({
            id: 'todo-reviewed-only2',
            entryReviewedAt: '2026-07-28T00:00:00.000Z',
        })).toBe(PHASE.DONE);
    });

    it('yields to a live queue row — a re-dispatched task with a stale review stamp is RUNNING, not DONE', () => {
        setQueueRows([{ id: 'qrev', todo_id: 'todo-rev-run', state: 'dispatched' }]);
        expect(derivePhase({
            id: 'todo-rev-run',
            entryReviewedAt: '2026-07-28T00:00:00.000Z',
        })).toBe(PHASE.RUNNING);
    });

    it('leaves the shippedAt gate intact — stamped but unreviewed still resolves ACCEPT', () => {
        expect(derivePhase({
            id: 'todo-ship-noreview', entryId: 'gone-from-file',
            shippedAt: '2026-07-28T00:00:00.000Z',
        })).toBe(PHASE.ACCEPT);
    });

    it('leaves the marker gate intact — a checked marker with no review still resolves ACCEPT', async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: phase-marker-noreview -->');
        await refreshShippedMarkers(freshTarget());
        expect(derivePhase({ id: 'todo-marker-noreview', entryId: 'phase-marker-noreview' }))
            .toBe(PHASE.ACCEPT);
    });
});
