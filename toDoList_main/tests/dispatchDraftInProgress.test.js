import { vi } from 'vitest';
import { describe, it, expect, beforeEach } from 'vitest';

// Accepting a derive/assignment proposal (a queue row with no `todo_id`) ships
// through dispatchDraft, which materializes a real todo via addEntryTodo. That
// todo is born `active`, so it sat as a plain task while its run was in flight.
// These tests pin the fix: once the run ships, the auto-created todo is moved to
// `in_progress` through listLogic.setToDoStatus (so it persists), and the visible
// list is repainted. Rows that already carry a todo_id, and ships that fail, make
// no status change. shipEntry, inject, listLogic, and toDoRow are mocked so each
// call is observed directly.

let shipResult;
let projectItems = [];
let statusCalls = [];
let restoreCalls = [];

vi.mock('../src/shipEntry.js', () => ({
    shipEntryForTodo: () => Promise.resolve(shipResult),
}));

vi.mock('../src/inject.js', () => ({
    findTargetById: () => null,
    mintEntryId: () => 'ent-mint',
    embedEntryMarker: (t, id) => String(t == null ? '' : t) + '\n  <!-- id: ' + id + ' -->',
}));

vi.mock('../src/agentQueueStore.js', () => ({
    kickDispatchReconciler: () => Promise.resolve(),
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        getProjectTargetId: () => null,
        addEntryTodo: (projectName, title) => {
            projectItems.push({ id: 'created-id-1', tit: title, status: 'active' });
            return 'created-id-1';
        },
        listItems: () => projectItems,
        setToDoStatus: (projectName, item, status) => {
            statusCalls.push({ projectName, item, status });
            item.status = status;
        },
        setAgentRunState: () => Promise.resolve({ ok: true }),
    },
}));

vi.mock('../src/toDoRow.js', () => ({
    addToDos_restore: (...a) => { restoreCalls.push(a); },
    addAllToDo_DOM: () => {},
}));

import { dispatchDraft } from '../src/dispatchDraft.js';

function selectProject(name) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>' +
        '<ul id="mainList"></ul>';
}

function proposalRow() {
    return { id: 'q9', todo_id: null, entry_id: null, context: { title: 'Add a widget' } };
}

beforeEach(() => {
    shipResult = { ok: true, entryId: 'ent-new', correlationId: 'corr-9', runId: 222 };
    projectItems = [{ id: 'other', tit: 'Existing', status: 'active' }];
    statusCalls = [];
    restoreCalls = [];
    document.body.innerHTML = '';
});

describe('dispatchDraft sets an accepted proposal\'s auto-created task to In Progress', () => {
    it('moves the created todo to in_progress through listLogic.setToDoStatus', async () => {
        selectProject('Inbox');
        const res = await dispatchDraft(proposalRow(), 'entry body', null);
        expect(res).toEqual({ ok: true });

        expect(statusCalls).toHaveLength(1);
        expect(statusCalls[0].projectName).toBe('Inbox');
        expect(statusCalls[0].item.id).toBe('created-id-1');
        expect(statusCalls[0].status).toBe('in_progress');
        // The unrelated item is untouched.
        expect(projectItems[0].status).toBe('active');
    });

    it('repaints the on-screen list after the status change', async () => {
        selectProject('Inbox');
        await dispatchDraft(proposalRow(), 'entry body', null);

        // The final render reflects the in_progress status.
        const last = restoreCalls[restoreCalls.length - 1];
        const rendered = last[0].find(function (i) { return i.id === 'created-id-1'; });
        expect(rendered.status).toBe('in_progress');
    });

    it('makes no status change when the ship fails', async () => {
        selectProject('Inbox');
        shipResult = { ok: false, error: 'boom' };
        const res = await dispatchDraft(proposalRow(), 'entry body', null);
        expect(res.ok).toBe(false);
        expect(statusCalls).toHaveLength(0);
    });

    it('leaves rows that already carry a todo_id at their current status', async () => {
        selectProject('Inbox');
        const row = { id: 'q1', todo_id: 'other', entry_id: 'ent-keep', context: { title: 'X' } };
        await dispatchDraft(row, 'entry body', row.entry_id);
        expect(statusCalls).toHaveLength(0);
        expect(projectItems[0].status).toBe('active');
    });

    it('makes no status change when creation is skipped (no title)', async () => {
        selectProject('Inbox');
        const row = { id: 'q2', todo_id: null, entry_id: null, context: {} };
        await dispatchDraft(row, '', null);
        expect(statusCalls).toHaveLength(0);
    });
});
