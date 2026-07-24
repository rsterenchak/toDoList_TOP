import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    markEntryPresentLocally,
    forgetEntryMarkerLocally,
    refreshShippedMarkers,
    initInjectConfig,
} from '../src/inject.js';
import { derivePhase, PHASE, PHASE_RAIL_ORDER, PHASE_RAIL_LABELS } from '../src/phase.js';
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
    it('exposes the seven phases (four pipeline + asking + drafted + stuck), and no run phase', () => {
        expect(PHASE).toEqual({
            NONE: 'none',
            DRAFT: 'draft',
            ACCEPT: 'accept',
            DONE: 'done',
            ASKING: 'asking',
            DRAFTED: 'drafted',
            STUCK: 'stuck',
        });
        expect(Object.values(PHASE)).not.toContain('run');
    });
});

describe('PHASE_RAIL_ORDER / PHASE_RAIL_LABELS — read-only rail vocabulary', () => {
    it('orders the four pipeline phases left → right, with no run and no asking node', () => {
        expect(PHASE_RAIL_ORDER).toEqual([PHASE.NONE, PHASE.DRAFT, PHASE.ACCEPT, PHASE.DONE]);
        // asking and drafted are triage-queue facts, not rail nodes — neither appears.
        expect(PHASE_RAIL_ORDER).not.toContain(PHASE.ASKING);
        expect(PHASE_RAIL_ORDER).not.toContain(PHASE.DRAFTED);
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
        // The acknowledgement stamp is irrelevant until the entry is checked.
        expect(derivePhase({
            entryId: 'phase-draft-id', entryReviewedAt: '2026-07-22T00:00:00.000Z',
        })).toBe(PHASE.DRAFT);
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
