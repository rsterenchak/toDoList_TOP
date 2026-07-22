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
