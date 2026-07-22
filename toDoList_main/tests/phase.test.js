import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    markEntryPresentLocally,
    forgetEntryMarkerLocally,
    refreshShippedMarkers,
    initInjectConfig,
} from '../src/inject.js';
import { derivePhase, PHASE } from '../src/phase.js';
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
    it('exposes the five phases (four pipeline + asking), and no run phase', () => {
        expect(PHASE).toEqual({
            NONE: 'none',
            DRAFT: 'draft',
            ACCEPT: 'accept',
            DONE: 'done',
            ASKING: 'asking',
        });
        expect(Object.values(PHASE)).not.toContain('run');
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
