import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';

// The shared dispatch core (dispatchDraft.js) is the ONE implementation both the
// Agent board and the task-row description panel ship a draft / retry a failed run
// through. These tests pin the invariants that would silently diverge if the two
// surfaces ever grew their own copies:
//   - Retry reuses the row's existing entry_id (so injectEntry dedup-skips the
//     already-present marker rather than appending a duplicate to TODO.md),
//   - a successful ship persists the `dispatched` state, and
//   - the optional board tail runs after that persist (the board arms its poller
//     and repaints there; the row layer passes no tail, so nothing polls).
// shipEntry.js, inject.js, and listLogic.js are mocked so no network is touched
// and each call is observed directly.

let shipCalls = [];
let shipResult = { ok: true, entryId: 'ent-keep', correlationId: 'corr-1', runId: 111 };
let runStateCalls = [];

vi.mock('../src/shipEntry.js', () => ({
    shipEntryForTodo: (opts) => {
        shipCalls.push(opts);
        return Promise.resolve(shipResult);
    },
}));

vi.mock('../src/inject.js', () => ({
    // resolveDispatchTarget only reaches findTargetById when a target id resolves;
    // these tests run project-less, so it returns null before ever calling this.
    findTargetById: () => null,
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        getProjectTargetId: () => null,
        setAgentRunState: (id, patch) => {
            runStateCalls.push({ id, patch });
            return Promise.resolve({ ok: true });
        },
    },
}));

import { dispatchDraft, resolveDispatchTarget } from '../src/dispatchDraft.js';
import { setQueueRows } from '../src/agentQueueStore.js';

beforeEach(() => {
    shipCalls = [];
    runStateCalls = [];
    shipResult = { ok: true, entryId: 'ent-keep', correlationId: 'corr-1', runId: 111 };
    // Reset the shared queue cache the sibling-mockup sweep reads (see the
    // "settles a stale needs_mockup sibling" tests) so no seeded rows leak between
    // cases and the plain-dispatch tests above see no siblings.
    setQueueRows([]);
});

describe('shared dispatchDraft core', () => {
    it('Retry reuses the row\'s stored entry_id so the marker is dedup-skipped, not duplicated', async () => {
        const row = { id: 'q1', todo_id: 't1', entry_id: 'ent-keep' };
        const res = await dispatchDraft(row, 'entry body', row.entry_id);

        expect(res).toEqual({ ok: true });
        expect(shipCalls).toHaveLength(1);
        expect(shipCalls[0].existingEntryId).toBe('ent-keep');
        expect(shipCalls[0].todoId).toBe('t1');
        expect(shipCalls[0].entryText).toBe('entry body');
    });

    it('persists the dispatched state with the shipped ids after a successful ship', async () => {
        const row = { id: 'q1', todo_id: 't1', entry_id: 'ent-keep' };
        await dispatchDraft(row, 'entry body', row.entry_id);

        expect(runStateCalls).toHaveLength(1);
        expect(runStateCalls[0].id).toBe('q1');
        expect(runStateCalls[0].patch).toMatchObject({
            state: 'dispatched',
            entry_id: 'ent-keep',
            correlation_id: 'corr-1',
            run_id: 111,
        });
    });

    it('runs the board tail after persisting, with the shipped ids and target', async () => {
        const tailCalls = [];
        const row = { id: 'q1', todo_id: 't1', entry_id: 'ent-keep' };
        await dispatchDraft(row, 'entry body', row.entry_id, {
            onDispatched: (...args) => tailCalls.push(args),
        });

        expect(tailCalls).toHaveLength(1);
        expect(tailCalls[0][0]).toBe('q1');       // rowId
        expect(tailCalls[0][1]).toBe('ent-keep'); // entryId
        expect(tailCalls[0][2]).toBe('corr-1');   // correlationId
        expect(tailCalls[0][3]).toBeNull();       // target (project-less here)
    });

    it('is safe with no tail — the row-layer call shape, nothing polls', async () => {
        const row = { id: 'q1', todo_id: 't1', entry_id: 'ent-keep' };
        const res = await dispatchDraft(row, 'entry body', row.entry_id);
        expect(res).toEqual({ ok: true });
        // Still persisted the dispatched state even though no tail ran.
        expect(runStateCalls).toHaveLength(1);
    });

    it('surfaces a ship failure without persisting any dispatched state', async () => {
        shipResult = { ok: false, error: 'Inject failed — boom' };
        const row = { id: 'q1', todo_id: 't1', entry_id: 'ent-keep' };
        const tailCalls = [];
        const res = await dispatchDraft(row, 'entry body', row.entry_id, {
            onDispatched: (...args) => tailCalls.push(args),
        });

        expect(res).toEqual({ ok: false, error: 'Inject failed — boom' });
        expect(runStateCalls).toHaveLength(0);
        expect(tailCalls).toHaveLength(0);
    });

    it('resolveDispatchTarget returns null when no project is selected', () => {
        expect(resolveDispatchTarget()).toBeNull();
    });
});

describe('dispatchDraft settles a stale needs_mockup sibling on a direct-inject pivot', () => {
    it('moves a sibling needs_mockup row for the same todo out of that state (to no_change)', async () => {
        // The bug scenario: a todo carries BOTH a stale needs_mockup row and the
        // newer drafted row that the direct-inject pivot dispatches. Dispatching
        // the drafted row must settle the stale sibling so the todo is not left
        // with two in-flight-competing rows.
        setQueueRows([
            { id: 'mockA', todo_id: 't1', state: 'needs_mockup' },
            { id: 'q1', todo_id: 't1', state: 'drafted' },
        ]);
        const row = { id: 'q1', todo_id: 't1', entry_id: 'ent-keep' };
        const res = await dispatchDraft(row, 'entry body', row.entry_id);

        expect(res).toEqual({ ok: true });
        // Two writes: the dispatched persist for q1, then the sibling settle.
        expect(runStateCalls).toHaveLength(2);
        expect(runStateCalls[0].id).toBe('q1');
        expect(runStateCalls[0].patch).toMatchObject({ state: 'dispatched' });
        const settle = runStateCalls.find((c) => c.id === 'mockA');
        expect(settle).toBeTruthy();
        expect(settle.patch.state).toBe('no_change');
        expect(settle.patch.state).not.toBe('needs_mockup');
        expect(typeof settle.patch.failure_reason).toBe('string');
    });

    it('leaves needs_mockup rows of OTHER todos untouched', async () => {
        setQueueRows([
            { id: 'mockB', todo_id: 't2', state: 'needs_mockup' },
            { id: 'q1', todo_id: 't1', state: 'drafted' },
        ]);
        const row = { id: 'q1', todo_id: 't1', entry_id: 'ent-keep' };
        await dispatchDraft(row, 'entry body', row.entry_id);

        // Only the dispatched persist — the other todo's mockup row is not swept.
        expect(runStateCalls).toHaveLength(1);
        expect(runStateCalls[0].id).toBe('q1');
    });

    it('is a no-op sweep for the normal single-row dispatch (no sibling to settle)', async () => {
        setQueueRows([{ id: 'q1', todo_id: 't1', state: 'drafted' }]);
        const row = { id: 'q1', todo_id: 't1', entry_id: 'ent-keep' };
        await dispatchDraft(row, 'entry body', row.entry_id);

        expect(runStateCalls).toHaveLength(1);
        expect(runStateCalls[0].id).toBe('q1');
    });

    it('does not settle siblings when the ship itself fails (no dispatched row created)', async () => {
        shipResult = { ok: false, error: 'Inject failed — boom' };
        setQueueRows([
            { id: 'mockA', todo_id: 't1', state: 'needs_mockup' },
            { id: 'q1', todo_id: 't1', state: 'drafted' },
        ]);
        const row = { id: 'q1', todo_id: 't1', entry_id: 'ent-keep' };
        const res = await dispatchDraft(row, 'entry body', row.entry_id);

        expect(res).toEqual({ ok: false, error: 'Inject failed — boom' });
        // No dispatched persist and no sweep — the pivot never completed.
        expect(runStateCalls).toHaveLength(0);
    });
});

describe('dispatchDraft is shared, not copied (both surfaces route through it)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const srcDir = resolve(here, '../src');
    const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

    it('the Agent board imports and uses the shared dispatch, keeping no local copy', () => {
        const agentView = read('agentView.js');
        expect(agentView).toMatch(/import \{ dispatchDraft, resolveDispatchTarget \} from '\.\/dispatchDraft\.js'/);
        // No second definition of the extracted functions.
        expect(agentView).not.toMatch(/async function dispatchDraft\(/);
        expect(agentView).not.toMatch(/function resolveDispatchTarget\(/);
        // The board still no longer imports shipEntryForTodo directly.
        expect(agentView).not.toMatch(/from '\.\/shipEntry\.js'/);
    });

    it('the row layer imports the same shared dispatch (no agentView import)', () => {
        const toDoRow = read('toDoRow.js');
        // Tolerant of additional named imports from the shared module (the review
        // surface also pulls resolveDispatchTarget from here); what matters is that
        // dispatchDraft comes from dispatchDraft.js and agentView is never imported.
        expect(toDoRow).toMatch(/import \{[^}]*\bdispatchDraft\b[^}]*\} from '\.\/dispatchDraft\.js'/s);
        expect(toDoRow).not.toMatch(/from '\.\/agentView\.js'/);
    });

    it('the row layer passes the row\'s entry_id (Retry dedup) and no board tail', () => {
        const toDoRow = read('toDoRow.js');
        expect(toDoRow).toMatch(/dispatchDraft\(queueRow,\s*draftText,\s*queueRow\.entry_id\)/);
    });
});
