import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

// The shared agent-queue store owns the project-scoped `agent_queue` cache, the
// realtime channel, the unsent-answer draft map, and the triage in-flight guard —
// so the Agent board and the task-row layer read one store rather than two. These
// tests drive its public surface against a controllable fake Supabase client.

let queueRows = [];
let queueFetches = 0;

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => {
                    queueFetches += 1;
                    return Promise.resolve({ data: queueRows, error: null });
                },
            }),
        }),
        channel: () => ({
            on() { return this; },
            subscribe() { return this; },
        }),
        removeChannel: () => {},
    },
}));

import { listLogic } from '../src/listLogic.js';
import {
    getQueueRows,
    getLoadedProjectName,
    setQueueRows,
    getQueueRowForTodo,
    settleStaleMockupRows,
    loadQueueRows,
    fetchQueueRows,
    pendingAnswers,
    isTriageInFlight,
    setTriageInFlight,
    onQueueChange,
    notifyQueueChange,
    setTriageDispatcher,
    fireTriageSweep,
} from '../src/agentQueueStore.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    queueFetches = 0;
    setQueueRows([]);
    pendingAnswers.clear();
    setTriageInFlight(false);
    setTriageDispatcher(null);
});

afterEach(() => {
    setTriageDispatcher(null);
});

describe('cache accessors', () => {
    it('setQueueRows / getQueueRows round-trips and coerces non-arrays to []', () => {
        setQueueRows([{ id: 'a', todo_id: 't1' }], 'Proj');
        expect(getQueueRows()).toHaveLength(1);
        expect(getLoadedProjectName()).toBe('Proj');
        setQueueRows(null);
        expect(getQueueRows()).toEqual([]);
    });

    it('getQueueRowForTodo finds the row linked by todo_id, else null', () => {
        setQueueRows([
            { id: 'q1', todo_id: 't1', state: 'needs_words' },
            { id: 'q2', todo_id: 't2', state: 'triaging' },
        ]);
        expect(getQueueRowForTodo('t2').id).toBe('q2');
        expect(getQueueRowForTodo('nope')).toBeNull();
        expect(getQueueRowForTodo('')).toBeNull();
        expect(getQueueRowForTodo(undefined)).toBeNull();
    });

    it('getQueueRowForTodo prefers the most recent row when a todo links more than one', () => {
        // A stale needs_mockup row plus a newer direct-inject dispatch row for the
        // same todo: the newer row must win, or the stale one pins the phase.
        setQueueRows([
            { id: 'stale', todo_id: 't1', state: 'needs_mockup', created_at: '2026-07-01T00:00:00Z' },
            { id: 'fresh', todo_id: 't1', state: 'dispatched', created_at: '2026-07-02T00:00:00Z' },
        ]);
        expect(getQueueRowForTodo('t1').id).toBe('fresh');
        // Order in the cache must not change the outcome — recency decides.
        setQueueRows([
            { id: 'fresh', todo_id: 't1', state: 'dispatched', created_at: '2026-07-02T00:00:00Z' },
            { id: 'stale', todo_id: 't1', state: 'needs_mockup', created_at: '2026-07-01T00:00:00Z' },
        ]);
        expect(getQueueRowForTodo('t1').id).toBe('fresh');
    });

    it('getQueueRowForTodo falls back to updated_at, then first-match on a tie', () => {
        // No created_at: updated_at breaks the tie.
        setQueueRows([
            { id: 'older', todo_id: 't1', state: 'needs_mockup', updated_at: '2026-07-01T00:00:00Z' },
            { id: 'newer', todo_id: 't1', state: 'dispatched', updated_at: '2026-07-03T00:00:00Z' },
        ]);
        expect(getQueueRowForTodo('t1').id).toBe('newer');
        // Neither row carries a timestamp → first-encountered wins (unchanged behavior).
        setQueueRows([
            { id: 'q1', todo_id: 't1', state: 'needs_mockup' },
            { id: 'q2', todo_id: 't1', state: 'dispatched' },
        ]);
        expect(getQueueRowForTodo('t1').id).toBe('q1');
        // A row WITH a timestamp outranks a timestamp-less one regardless of order.
        setQueueRows([
            { id: 'q1', todo_id: 't1', state: 'needs_mockup' },
            { id: 'q2', todo_id: 't1', state: 'dispatched', created_at: '2026-07-02T00:00:00Z' },
        ]);
        expect(getQueueRowForTodo('t1').id).toBe('q2');
    });
});

describe('settleStaleMockupRows (write-side cleanup for the pending-glyph read fix)', () => {
    it('settles sibling needs_mockup rows for the todo to no_change, excluding the dispatched row', async () => {
        const spy = vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
        setQueueRows([
            { id: 'mockA', todo_id: 't1', state: 'needs_mockup' },
            { id: 'q1', todo_id: 't1', state: 'dispatched' },
            { id: 'mockOther', todo_id: 't2', state: 'needs_mockup' },
        ]);

        const settled = await settleStaleMockupRows('t1', 'q1');

        expect(settled).toEqual(['mockA']);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('mockA', expect.objectContaining({
            state: 'no_change',
        }));
        expect(spy.mock.calls[0][1].failure_reason).toEqual(expect.any(String));
        spy.mockRestore();
    });

    it('excludes the dispatched row itself even if it is somehow still needs_mockup', async () => {
        const spy = vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
        setQueueRows([{ id: 'q1', todo_id: 't1', state: 'needs_mockup' }]);

        const settled = await settleStaleMockupRows('t1', 'q1');

        expect(settled).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('is a no-op (no writes) when the todo has no sibling needs_mockup row', async () => {
        const spy = vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
        setQueueRows([
            { id: 'q1', todo_id: 't1', state: 'drafted' },
            { id: 'q2', todo_id: 't1', state: 'dispatched' },
        ]);

        const settled = await settleStaleMockupRows('t1', 'q2');

        expect(settled).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('returns [] without writing for a falsy todo id', async () => {
        const spy = vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
        setQueueRows([{ id: 'mockA', todo_id: 't1', state: 'needs_mockup' }]);

        const settled = await settleStaleMockupRows(null, 'q1');

        expect(settled).toEqual([]);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('omits a row whose settle write fails, keeping the sweep best-effort', async () => {
        const spy = vi.spyOn(listLogic, 'setAgentRunState')
            .mockResolvedValueOnce({ ok: false, error: 'Update failed.' })
            .mockResolvedValueOnce({ ok: true });
        setQueueRows([
            { id: 'mockA', todo_id: 't1', state: 'needs_mockup' },
            { id: 'mockB', todo_id: 't1', state: 'needs_mockup' },
            { id: 'q1', todo_id: 't1', state: 'dispatched' },
        ]);

        const settled = await settleStaleMockupRows('t1', 'q1');

        // Both rows attempted; only the one whose write returned ok is reported.
        expect(spy).toHaveBeenCalledTimes(2);
        expect(settled).toEqual(['mockB']);
        spy.mockRestore();
    });
});

describe('loadQueueRows', () => {
    it('fetches a project id and caches the rows', async () => {
        listLogic.addProject('Alpha');
        queueRows = [{ id: 'q1', todo_id: 't1', state: 'needs_words' }];
        const rows = await loadQueueRows('Alpha');
        expect(rows).toHaveLength(1);
        expect(getLoadedProjectName()).toBe('Alpha');
        expect(getQueueRowForTodo('t1').state).toBe('needs_words');
    });

    it('clears the cache and never fetches when the project has no id', async () => {
        setQueueRows([{ id: 'stale', todo_id: 'x' }], 'Old');
        const before = queueFetches;
        const rows = await loadQueueRows('Unknown-project');
        expect(rows).toEqual([]);
        expect(queueFetches).toBe(before);
    });
});

describe('fetchQueueRows', () => {
    it('resolves to the row data and never throws on the query', async () => {
        queueRows = [{ id: 'z' }];
        const rows = await fetchQueueRows('pid');
        expect(rows).toEqual([{ id: 'z' }]);
    });
});

describe('triage in-flight guard', () => {
    it('toggles and coerces to a boolean', () => {
        expect(isTriageInFlight()).toBe(false);
        setTriageInFlight(1);
        expect(isTriageInFlight()).toBe(true);
        setTriageInFlight(0);
        expect(isTriageInFlight()).toBe(false);
    });
});

describe('triage dispatcher registration', () => {
    it('fireTriageSweep routes to the registered dispatcher, else resolves null', async () => {
        expect(await fireTriageSweep('Any')).toBeNull();
        const calls = [];
        setTriageDispatcher((name) => { calls.push(name); return { ok: true }; });
        const res = await fireTriageSweep('Beta');
        expect(calls).toEqual(['Beta']);
        expect(res).toEqual({ ok: true });
    });
});

describe('change notification', () => {
    it('notifies registered listeners and honours the unsubscribe thunk', () => {
        let hits = 0;
        const off = onQueueChange(() => { hits += 1; });
        notifyQueueChange();
        expect(hits).toBe(1);
        off();
        notifyQueueChange();
        expect(hits).toBe(1);
    });

    it('a throwing listener does not break the others', () => {
        let hits = 0;
        onQueueChange(() => { throw new Error('boom'); });
        onQueueChange(() => { hits += 1; });
        expect(() => notifyQueueChange()).not.toThrow();
        expect(hits).toBe(1);
    });
});
