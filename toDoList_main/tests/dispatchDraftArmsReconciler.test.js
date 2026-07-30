import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

// Regression coverage for the circular arming bug: the dispatch reconciler used to
// arm ONLY from an `onQueueChange`, which fires only after a settle, which comes
// only from the poller — so a run dispatched in-session (no realtime push) never
// armed the poller and never settled until a page reload. dispatchDraft — the one
// funnel every surface (Dispatch, Retry, mockup Use, proposal Accept) resolves
// through — now kicks the reconciler after persisting the dispatched state, which
// breaks the cycle. This test dispatches with NO realtime push (notifyQueueChange
// is never called) and asserts the poll interval arms purely from that local kick.

let allRows = [];

// The stub supabase reads back exactly what a fresh dispatch would have written:
// loadAllQueueRows (inside the kick) returns our dispatched row so evaluateReconciler
// sees a pollable in-flight row and arms the interval.
vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => {
                const result = Promise.resolve({ data: allRows, error: null });
                result.eq = () => Promise.resolve({ data: allRows, error: null });
                return result;
            },
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

// A successful ship so dispatchDraft persists `dispatched` and reaches the kick.
vi.mock('../src/shipEntry.js', () => ({
    shipEntryForTodo: () => Promise.resolve({ ok: true, entryId: 'e1', correlationId: 'c1', runId: 5 }),
}));

// resolveDispatchTarget runs project-less here, so findTargetById is never reached.
vi.mock('../src/inject.js', () => ({ findTargetById: () => null }));

import { listLogic } from '../src/listLogic.js';
import { dispatchDraft } from '../src/dispatchDraft.js';
import { isReconcilePollerActive, stopDispatchReconciler } from '../src/agentQueueStore.js';

beforeEach(() => {
    listLogic._reset();
    // The dispatched-state write is observed but not driven onto a real backend.
    vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
    allRows = [];
});

afterEach(() => {
    stopDispatchReconciler();
    vi.restoreAllMocks();
});

describe('a local dispatch arms the reconciler without any realtime push', () => {
    it('arms the poll interval after dispatchDraft, with no onQueueChange fired', async () => {
        // The row loadAllQueueRows will read back once the dispatch has landed.
        allRows = [{ id: 'q1', state: 'dispatched', entry_id: 'e1', correlation_id: 'c1', project_id: null }];
        expect(isReconcilePollerActive()).toBe(false);

        const res = await dispatchDraft({ id: 'q1', todo_id: 't1', entry_id: 'e1' }, 'entry body', 'e1');
        expect(res).toEqual({ ok: true });

        // The kick is fire-and-forget; flush its microtask chain (every mocked
        // promise resolves on the microtask queue — there are no timers to advance).
        for (let i = 0; i < 50 && !isReconcilePollerActive(); i++) {
            await Promise.resolve();
        }

        // Armed purely from the local dispatch — notifyQueueChange was never called,
        // and no realtime subscription was ever started.
        expect(isReconcilePollerActive()).toBe(true);
    });

    it('does not arm when the dispatch never lands (nothing in flight to poll)', async () => {
        // shipEntry still succeeds, but loadAllQueueRows sees no in-flight row — the
        // kick runs, evaluates an empty in-flight set, and leaves the interval idle.
        allRows = [];
        const res = await dispatchDraft({ id: 'q1', todo_id: 't1', entry_id: 'e1' }, 'entry body', 'e1');
        expect(res).toEqual({ ok: true });

        for (let i = 0; i < 50; i++) await Promise.resolve();

        expect(isReconcilePollerActive()).toBe(false);
    });
});
