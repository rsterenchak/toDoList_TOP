import { vi } from 'vitest';
import { describe, it, expect, beforeEach } from 'vitest';

// When a derive proposal (a queue row with no `todo_id`) is accepted, dispatchDraft
// materializes a real todo in the selected project before shipping. Without a
// re-render the new todo sits only in the data model and #mainList stays stale
// until the user re-selects the project. These tests pin the fix: after creating
// the todo, dispatchDraft rebuilds #mainList through toDoRow's render helpers, and
// only when the created todo still belongs to the currently-selected project.
// shipEntry, inject, listLogic, and toDoRow are mocked so nothing renders for real
// and each call is observed directly.

let shipCalls = [];
let shipResult = { ok: true, entryId: 'ent-new', correlationId: 'corr-9', runId: 222 };
let addToDoCalls = [];
let projectItems = [];
let restoreCalls = [];
let domCalls = [];

vi.mock('../src/shipEntry.js', () => ({
    shipEntryForTodo: (opts) => {
        shipCalls.push(opts);
        return Promise.resolve(shipResult);
    },
}));

vi.mock('../src/inject.js', () => ({
    findTargetById: () => null,
}));

vi.mock('../src/agentQueueStore.js', () => ({
    kickDispatchReconciler: () => Promise.resolve(),
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        getProjectTargetId: () => null,
        addToDo: (projectName, title) => {
            addToDoCalls.push({ projectName, title });
            projectItems.push({ id: 'created-id-1', tit: title, desc: '' });
        },
        listItems: () => projectItems,
        editToDoItem: () => {},
        setAgentRunState: () => Promise.resolve({ ok: true }),
    },
}));

vi.mock('../src/toDoRow.js', () => ({
    addToDos_restore: (...a) => { restoreCalls.push(a); },
    addAllToDo_DOM: (...a) => { domCalls.push(a); },
}));

import { dispatchDraft } from '../src/dispatchDraft.js';

// getSelectedProjectName reads a `.selectedProject` row's #projInput value; stand
// one up (plus the #mainList the rebuild targets) so the derive branch has a
// project to create the todo in and a list to repaint.
function selectProject(name) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>' +
        '<div id="mainList"></div>';
}

beforeEach(() => {
    shipCalls = [];
    addToDoCalls = [];
    projectItems = [];
    restoreCalls = [];
    domCalls = [];
    shipResult = { ok: true, entryId: 'ent-new', correlationId: 'corr-9', runId: 222 };
    document.body.innerHTML = '';
});

describe('dispatchDraft rebuilds #mainList after materializing a derive-proposal todo', () => {
    it('repaints the selected project list through addToDos_restore once the todo exists', async () => {
        selectProject('Inbox');
        const row = {
            id: 'q9',
            todo_id: null,
            entry_id: null,
            context: { title: 'Add a widget', description: 'A shiny new widget.' },
        };

        const res = await dispatchDraft(row, 'entry body', row.entry_id);
        expect(res).toEqual({ ok: true });

        // The todo was created, then #mainList was rebuilt for that same project.
        expect(addToDoCalls).toEqual([{ projectName: 'Inbox', title: 'Add a widget' }]);
        expect(restoreCalls).toHaveLength(1);
        expect(restoreCalls[0][1]).toBe('Inbox');
        // The created item is present in the items handed to the renderer.
        expect(restoreCalls[0][0].some((i) => i.id === 'created-id-1')).toBe(true);
    });

    it('does not rebuild #mainList for a row that already carries a todo_id', async () => {
        selectProject('Inbox');
        const row = {
            id: 'q1',
            todo_id: 't-existing',
            entry_id: 'ent-keep',
            context: { title: 'unused', description: 'x' },
        };

        await dispatchDraft(row, 'entry body', row.entry_id);

        // No todo created and no repaint — the normal flagged-task path is untouched.
        expect(addToDoCalls).toHaveLength(0);
        expect(restoreCalls).toHaveLength(0);
        expect(domCalls).toHaveLength(0);
    });

    it('does not throw when #mainList is absent from the DOM', async () => {
        // Only the selected-project row exists — no #mainList to repaint.
        document.body.innerHTML =
            '<div class="selectedProject"><input id="projInput" value="Inbox"></div>';
        const row = {
            id: 'q9',
            todo_id: null,
            entry_id: null,
            context: { title: 'Add a widget', description: 'desc' },
        };

        const res = await dispatchDraft(row, 'entry body', row.entry_id);
        expect(res).toEqual({ ok: true });
        // The todo is still created; the rebuild simply no-ops with no list present.
        expect(addToDoCalls).toEqual([{ projectName: 'Inbox', title: 'Add a widget' }]);
        expect(restoreCalls).toHaveLength(0);
        expect(domCalls).toHaveLength(0);
    });
});
