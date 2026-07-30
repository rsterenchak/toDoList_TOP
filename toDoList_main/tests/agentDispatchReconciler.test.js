import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

// Regression coverage for the persistent, mount-INDEPENDENT dispatch reconciler
// that now lives in the agent-queue store. It was extracted out of agentView.js,
// whose per-row pollers only ran while the Agent board was mounted — so a run
// dispatched from the task row or the detail pane (the normal path) never settled.
// These tests drive the store's reconcile units directly with injected Worker-call
// spies (the same setDispatchReconcilerDeps seam inject.js registers in
// production), so no board and no network is involved.

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => {
                const result = Promise.resolve({ data: [], error: null });
                result.eq = () => Promise.resolve({ data: [], error: null });
                return result;
            },
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

import { listLogic } from '../src/listLogic.js';
import {
    setDispatchReconcilerDeps,
    reconcileDispatchRow,
    reconcileShippedStamps,
    settleShippedRows,
    evaluateReconciler,
    isReconcilePollerActive,
    stopDispatchReconciler,
} from '../src/agentQueueStore.js';

// The injected Worker-call bundle. Each test scripts the relevant spy; defaults
// keep a run un-shipped and un-resolved so a test only sets what it exercises.
let deps;
let setStateSpy;

function shippedCalls(rowId) {
    return setStateSpy.mock.calls.filter(function (c) {
        return c[0] === rowId && c[1] && c[1].state === 'shipped';
    });
}
function findCall(rowId, state) {
    return setStateSpy.mock.calls.find(function (c) {
        return c[0] === rowId && c[1] && c[1].state === state;
    });
}

beforeEach(() => {
    listLogic._reset();
    setStateSpy = vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
    deps = {
        pollRunStatus: vi.fn(() => Promise.resolve({ ok: true, found: false })),
        fetchRunResult: vi.fn(() => Promise.resolve({ ok: true, result: '' })),
        resolveEntryByMarker: vi.fn(() => Promise.resolve({ ok: true, found: false })),
        findTargetById: vi.fn(() => null),
        refreshShippedMarkersForProject: vi.fn(() => Promise.resolve()),
        resolveEntryRunState: vi.fn(() => 'none'),
    };
    setDispatchReconcilerDeps(deps);
});

afterEach(() => {
    stopDispatchReconciler();
    setDispatchReconcilerDeps(null);
    vi.restoreAllMocks();
});

describe('reconcileDispatchRow — completed run outcomes', () => {
    it('settles a checked box to shipped with a PR link', async () => {
        deps.pollRunStatus.mockResolvedValue({ ok: true, found: true, status: 'completed', conclusion: 'success', runId: 7 });
        deps.resolveEntryRunState.mockReturnValue('shipped');
        deps.resolveEntryByMarker.mockResolvedValue({ ok: true, found: true, pr_url: 'https://x/pull/9', pr_number: 9 });

        await reconcileDispatchRow({ id: 'r1', state: 'dispatched', entry_id: 'e1', correlation_id: 'c1' });

        const shipped = findCall('r1', 'shipped');
        expect(shipped).toBeTruthy();
        expect(shipped[1].pr_url).toBe('https://x/pull/9');
        expect(shipped[1].pr_number).toBe(9);
        expect(shipped[1].run_id).toBe(7);
        expect(findCall('r1', 'no_change')).toBeFalsy();
    });

    it('settles an unchecked box to no_change with the closing summary', async () => {
        deps.pollRunStatus.mockResolvedValue({ ok: true, found: true, status: 'completed', conclusion: 'success', runId: 7 });
        deps.resolveEntryRunState.mockReturnValue('pending');
        deps.fetchRunResult.mockResolvedValue({ ok: true, result: 'Entry was ineligible; nothing to do.' });

        await reconcileDispatchRow({ id: 'r1', state: 'dispatched', entry_id: 'e1', correlation_id: 'c1' });

        const noChange = findCall('r1', 'no_change');
        expect(noChange).toBeTruthy();
        expect(noChange[1].failure_reason).toBe('Entry was ineligible; nothing to do.');
        expect(findCall('r1', 'shipped')).toBeFalsy();
    });

    it('ships from the merged-PR search when the marker cache has no box', async () => {
        deps.pollRunStatus.mockResolvedValue({ ok: true, found: true, status: 'completed', conclusion: 'success', runId: 7 });
        deps.resolveEntryRunState.mockReturnValue('none');
        deps.resolveEntryByMarker.mockResolvedValue({ ok: true, found: true, merge_commit_sha: 'abc', pr_url: 'https://x/pull/3', pr_number: 3 });

        await reconcileDispatchRow({ id: 'r1', state: 'dispatched', entry_id: 'e1', correlation_id: 'c1' });

        const shipped = findCall('r1', 'shipped');
        expect(shipped).toBeTruthy();
        expect(shipped[1].pr_number).toBe(3);
    });

    it('settles to failed with the closing summary on a recognized failure conclusion', async () => {
        deps.pollRunStatus.mockResolvedValue({ ok: true, found: true, status: 'completed', conclusion: 'failure', runId: 7 });
        deps.fetchRunResult.mockResolvedValue({ ok: true, result: 'Tests failed after three iterations.' });

        await reconcileDispatchRow({ id: 'r1', state: 'dispatched', entry_id: 'e1', correlation_id: 'c1' });

        const failed = findCall('r1', 'failed');
        expect(failed).toBeTruthy();
        expect(failed[1].failure_reason).toBe('Tests failed after three iterations.');
        expect(findCall('r1', 'shipped')).toBeFalsy();
    });

    it('leaves an unregistered / still-running row untouched', async () => {
        deps.pollRunStatus.mockResolvedValue({ ok: true, found: false });
        await reconcileDispatchRow({ id: 'r1', state: 'dispatched', entry_id: 'e1', correlation_id: 'c1' });
        expect(setStateSpy).not.toHaveBeenCalled();

        deps.pollRunStatus.mockResolvedValue({ ok: true, found: true, status: 'completed', conclusion: 'neutral', runId: 7 });
        await reconcileDispatchRow({ id: 'r1', state: 'dispatched', entry_id: 'e1', correlation_id: 'c1' });
        // A neutral conclusion is not a positive failure — the row stays in flight.
        expect(findCall('r1', 'failed')).toBeFalsy();
        expect(findCall('r1', 'no_change')).toBeFalsy();
    });
});

describe('settleShippedRows — stranded-backlog reconcile', () => {
    it('settles a checked stranded row to shipped and leaves an unchecked one running', async () => {
        deps.resolveEntryRunState.mockImplementation(function (id) {
            return id === 'shipEnt' ? 'shipped' : 'pending';
        });

        await settleShippedRows([
            { id: 'a', state: 'dispatched', entry_id: 'shipEnt' },
            { id: 'b', state: 'running', entry_id: 'runEnt' },
        ]);

        expect(findCall('a', 'shipped')).toBeTruthy();
        expect(setStateSpy.mock.calls.some(function (c) { return c[0] === 'b'; })).toBe(false);
    });

    it('does no work when nothing is in flight', async () => {
        await settleShippedRows([{ id: 's1', state: 'shipped', entry_id: 'e' }]);
        expect(deps.refreshShippedMarkersForProject).not.toHaveBeenCalled();
        expect(setStateSpy).not.toHaveBeenCalled();
    });

    it('does not double-settle a row already being settled', async () => {
        // Hang the PR-link resolve so the first settle stays in flight while a
        // second pass runs — the guard must skip the row the second time.
        let release;
        deps.resolveEntryRunState.mockReturnValue('shipped');
        deps.resolveEntryByMarker.mockImplementation(function () {
            return new Promise(function (r) { release = r; });
        });

        const p1 = settleShippedRows([{ id: 'a', state: 'dispatched', entry_id: 'e' }]);
        await Promise.resolve(); await Promise.resolve();
        const p2 = settleShippedRows([{ id: 'a', state: 'dispatched', entry_id: 'e' }]);
        await Promise.resolve(); await Promise.resolve();
        release({ ok: false });
        await p1; await p2;

        expect(shippedCalls('a').length).toBe(1);
    });
});

describe('settleShipped — records the ship in the DB (shipped_at stamp)', () => {
    it('stamps shipped_at on the linked todo when a row settles to shipped', async () => {
        listLogic.addProject('Alpha');
        listLogic.addToDo('Alpha', 'Ship me');
        const todo = listLogic.listItems('Alpha').find((i) => i.tit === 'Ship me');
        deps.resolveEntryRunState.mockReturnValue('shipped');

        await settleShippedRows([
            { id: 'row1', todo_id: todo.id, state: 'dispatched', entry_id: 'e1' },
        ]);

        // The row reached shipped AND the linked todo carries a ship stamp.
        expect(findCall('row1', 'shipped')).toBeTruthy();
        const after = listLogic.listItems('Alpha').find((i) => i.id === todo.id);
        expect(typeof after.shippedAt).toBe('string');
        expect(after.shippedAt.length).toBeGreaterThan(0);
    });

    it('a second settle does not overwrite the earlier shipped_at', async () => {
        listLogic.addProject('Alpha');
        listLogic.addToDo('Alpha', 'Ship once');
        const todo = listLogic.listItems('Alpha').find((i) => i.tit === 'Ship once');
        deps.resolveEntryRunState.mockReturnValue('shipped');

        await settleShippedRows([{ id: 'row2', todo_id: todo.id, state: 'dispatched', entry_id: 'e1' }]);
        const firstStamp = listLogic.listItems('Alpha').find((i) => i.id === todo.id).shippedAt;
        expect(firstStamp).toBeTruthy();

        await settleShippedRows([{ id: 'row2', todo_id: todo.id, state: 'dispatched', entry_id: 'e1' }]);
        const secondStamp = listLogic.listItems('Alpha').find((i) => i.id === todo.id).shippedAt;
        expect(secondStamp).toBe(firstStamp);
    });

    it('still ships when the row carries no todo_id (stamp is best-effort, non-blocking)', async () => {
        deps.resolveEntryRunState.mockReturnValue('shipped');
        await settleShippedRows([{ id: 'row3', state: 'dispatched', entry_id: 'e1' }]);
        // A missing todo_id must not block the ship — the row still reaches shipped.
        expect(findCall('row3', 'shipped')).toBeTruthy();
    });
});

describe('reconcileShippedStamps — repairable shipped_at invariant', () => {
    it('stamps a shipped row whose linked todo has no shippedAt yet', () => {
        listLogic.addProject('Alpha');
        listLogic.addToDo('Alpha', 'Repair me');
        const todo = listLogic.listItems('Alpha').find((i) => i.tit === 'Repair me');
        expect(todo.shippedAt).toBeFalsy();

        reconcileShippedStamps([{ id: 'q1', state: 'shipped', todo_id: todo.id }]);

        const after = listLogic.listItems('Alpha').find((i) => i.id === todo.id);
        expect(typeof after.shippedAt).toBe('string');
        expect(after.shippedAt.length).toBeGreaterThan(0);
    });

    it('leaves an already-stamped todo untouched with its original timestamp', () => {
        listLogic.addProject('Alpha');
        listLogic.addToDo('Alpha', 'Already shipped');
        const todo = listLogic.listItems('Alpha').find((i) => i.tit === 'Already shipped');

        // First pass stamps it; a second pass must be idempotent.
        reconcileShippedStamps([{ id: 'q1', state: 'shipped', todo_id: todo.id }]);
        const firstStamp = listLogic.listItems('Alpha').find((i) => i.id === todo.id).shippedAt;
        expect(firstStamp).toBeTruthy();

        reconcileShippedStamps([{ id: 'q1', state: 'shipped', todo_id: todo.id }]);
        const secondStamp = listLogic.listItems('Alpha').find((i) => i.id === todo.id).shippedAt;
        expect(secondStamp).toBe(firstStamp);
    });

    it('skips a shipped row with a null todo_id without error', () => {
        listLogic.addProject('Alpha');
        const stampSpy = vi.spyOn(listLogic, 'stampEntryShipped');
        expect(() => reconcileShippedStamps([{ id: 'q1', state: 'shipped', todo_id: null }])).not.toThrow();
        expect(stampSpy).not.toHaveBeenCalled();
    });

    it('ignores rows that are not shipped', () => {
        listLogic.addProject('Alpha');
        listLogic.addToDo('Alpha', 'Still running');
        const todo = listLogic.listItems('Alpha').find((i) => i.tit === 'Still running');

        reconcileShippedStamps([{ id: 'q1', state: 'running', todo_id: todo.id }]);

        const after = listLogic.listItems('Alpha').find((i) => i.id === todo.id);
        expect(after.shippedAt).toBeFalsy();
    });

    it('is a no-op when todos are not yet hydrated, preserving its one chance', () => {
        // No project added → the local todo store is empty (pre-hydration). The
        // pass must skip entirely rather than fire a doomed lookup per row.
        expect(listLogic.hasHydratedTodos()).toBe(false);
        const stampSpy = vi.spyOn(listLogic, 'stampEntryShipped');

        reconcileShippedStamps([{ id: 'q1', state: 'shipped', todo_id: 'todo-on-server' }]);

        expect(stampSpy).not.toHaveBeenCalled();
    });
});

describe('evaluateReconciler — the interval follows what is in flight', () => {
    it('arms the poller while a pollable row is in flight and stops when none remain', () => {
        expect(isReconcilePollerActive()).toBe(false);
        evaluateReconciler([{ id: 'r1', state: 'dispatched', entry_id: 'e', correlation_id: 'c' }]);
        expect(isReconcilePollerActive()).toBe(true);
        // No in-flight rows left → the interval is cleared so an idle app polls nothing.
        evaluateReconciler([]);
        expect(isReconcilePollerActive()).toBe(false);
    });

    it('does not arm the poller for a row missing its dispatch ids', () => {
        evaluateReconciler([{ id: 'r1', state: 'dispatched' }]);
        expect(isReconcilePollerActive()).toBe(false);
    });
});
