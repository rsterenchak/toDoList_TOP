import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

// The shared agent-queue store owns the project-scoped `agent_queue` cache, the
// realtime channel, the unsent-answer draft map, and the triage in-flight guard —
// so the Agent board and the task-row layer read one store rather than two. These
// tests drive its public surface against a controllable fake Supabase client.

let queueRows = [];
let queueFetches = 0;
let allFetches = 0;

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            // The per-project path chains `.select().eq()`; the all-projects path
            // (fetchAllQueueRows / loadAllQueueRows / refreshQueueCaches) awaits
            // `.select()` directly, so the returned builder is BOTH a thenable
            // (resolving to the row set) and carries an `.eq` for the scoped path.
            select: () => {
                const result = { data: queueRows, error: null };
                return {
                    eq: () => {
                        queueFetches += 1;
                        return Promise.resolve(result);
                    },
                    then: (onF, onR) => {
                        allFetches += 1;
                        return Promise.resolve(result).then(onF, onR);
                    },
                };
            },
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
    getAllQueueRows,
    loadAllQueueRows,
    fetchAllQueueRows,
    getWaitingAgentCounts,
} from '../src/agentQueueStore.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    queueFetches = 0;
    allFetches = 0;
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

describe('all-projects cache', () => {
    it('fetchAllQueueRows selects with no project filter and resolves the rows', async () => {
        queueRows = [{ id: 'a', project_id: 'p1' }, { id: 'b', project_id: 'p2' }];
        const before = queueFetches;
        const rows = await fetchAllQueueRows();
        expect(rows).toHaveLength(2);
        // The all-fetch must NOT go through the project-scoped `.eq` path.
        expect(queueFetches).toBe(before);
    });

    it('loadAllQueueRows caches every project\'s rows, exposed via getAllQueueRows', async () => {
        expect(getAllQueueRows()).toEqual([]);
        queueRows = [{ id: 'a', project_id: 'p1', state: 'needs_words' }];
        const rows = await loadAllQueueRows();
        expect(rows).toHaveLength(1);
        expect(getAllQueueRows()).toHaveLength(1);
    });
});

describe('getWaitingAgentCounts', () => {
    // Add a project and give it real todos so the drafted/unread test can read
    // each todo's draftSeenAt from the in-memory model, the same source the
    // switcher paint uses.
    function seedProject(name, items) {
        listLogic.addProject(name);
        const arr = listLogic.listItems(name);
        // addProject seeds one empty placeholder item; append the real ones.
        (items || []).forEach((it) => arr.push(it));
        return listLogic.getProjectId(name);
    }

    it('is empty when nothing is cached', () => {
        expect(getWaitingAgentCounts()).toEqual({});
    });

    it('counts needs_words (ASKING) and unread drafted, per project', async () => {
        const p1 = seedProject('Alpha', [
            { id: 'a-ask', tit: 'ask', draftSeenAt: null },
            { id: 'a-draft', tit: 'draft', draftSeenAt: null },
        ]);
        const p2 = seedProject('Beta', [
            { id: 'b-ask', tit: 'ask', draftSeenAt: null },
        ]);
        queueRows = [
            { id: 'q1', project_id: p1, todo_id: 'a-ask', state: 'needs_words' },
            { id: 'q2', project_id: p1, todo_id: 'a-draft', state: 'drafted' },
            { id: 'q3', project_id: p2, todo_id: 'b-ask', state: 'needs_words' },
        ];
        await loadAllQueueRows();
        expect(getWaitingAgentCounts()).toEqual({ Alpha: 2, Beta: 1 });
    });

    it('excludes a drafted row once its todo has been looked at (draftSeenAt set)', async () => {
        const p1 = seedProject('Alpha', [
            { id: 'seen', tit: 'seen', draftSeenAt: '2026-07-22T00:00:00.000Z' },
            { id: 'unseen', tit: 'unseen', draftSeenAt: null },
        ]);
        queueRows = [
            { id: 'q1', project_id: p1, todo_id: 'seen', state: 'drafted' },
            { id: 'q2', project_id: p1, todo_id: 'unseen', state: 'drafted' },
        ];
        await loadAllQueueRows();
        expect(getWaitingAgentCounts()).toEqual({ Alpha: 1 });
    });

    it('ignores non-blocking states and rows whose project is unknown', async () => {
        const p1 = seedProject('Alpha', [
            { id: 'triaging', tit: 't', draftSeenAt: null },
        ]);
        queueRows = [
            { id: 'q1', project_id: p1, todo_id: 'triaging', state: 'triaging' },
            { id: 'q2', project_id: 'ghost-project-id', todo_id: 'x', state: 'needs_words' },
        ];
        await loadAllQueueRows();
        expect(getWaitingAgentCounts()).toEqual({});
    });
});
