import { vi } from 'vitest';
import { describe, it, expect, beforeEach } from 'vitest';

// A fresh derive proposal accepted from the Agent board or the Coverage tab ships
// through dispatchDraft with `row.todo_id === null` — the proposal was never a
// real list item. These tests pin the branch that closes that gap: dispatchDraft
// must materialize a real todo in the selected project (title + description from
// the proposal's context) before shipping, ship the run against the CREATED todo's
// id, and persist that id back onto the queue row so stampEntryShipped can find it
// when the PR merges. Rows that already carry a todo_id must be untouched by this
// path. shipEntry.js, inject.js, and listLogic.js are mocked so no network is hit
// and each call is observed directly.

let shipCalls = [];
let shipResult = { ok: true, entryId: 'ent-new', correlationId: 'corr-9', runId: 222 };
let runStateCalls = [];
let addToDoCalls = [];
let editCalls = [];
let projectItems = [];

vi.mock('../src/shipEntry.js', () => ({
    shipEntryForTodo: (opts) => {
        shipCalls.push(opts);
        return Promise.resolve(shipResult);
    },
}));

vi.mock('../src/inject.js', () => ({
    findTargetById: () => null,
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        getProjectTargetId: () => null,
        addToDo: (projectName, title) => {
            addToDoCalls.push({ projectName, title });
            // Mirror listLogic.addToDo: a real item with a fresh id lands in the list.
            projectItems.push({ id: 'created-id-1', tit: title, desc: '' });
        },
        listItems: () => projectItems,
        editToDoItem: (projectName, item) => {
            editCalls.push({ projectName, item: { ...item } });
        },
        setAgentRunState: (id, patch) => {
            runStateCalls.push({ id, patch });
            return Promise.resolve({ ok: true });
        },
    },
}));

import { dispatchDraft } from '../src/dispatchDraft.js';

// getSelectedProjectName reads a `.selectedProject` row's #projInput value from the
// DOM; stand one up so the derive branch has a project to create the todo in.
function selectProject(name) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>';
}

beforeEach(() => {
    shipCalls = [];
    runStateCalls = [];
    addToDoCalls = [];
    editCalls = [];
    projectItems = [];
    shipResult = { ok: true, entryId: 'ent-new', correlationId: 'corr-9', runId: 222 };
    document.body.innerHTML = '';
});

describe('dispatchDraft creates a real todo for a derive proposal (no source todo_id)', () => {
    it('materializes a todo from the proposal context and ships against its id', async () => {
        selectProject('Inbox');
        const row = {
            id: 'q9',
            todo_id: null,
            entry_id: null,
            context: { title: 'Add a widget', description: 'A shiny new widget.' },
        };

        const res = await dispatchDraft(row, 'entry body', row.entry_id);
        expect(res).toEqual({ ok: true });

        // A real todo was created in the selected project with the proposal's title,
        // and its description backfilled through the edit path.
        expect(addToDoCalls).toEqual([{ projectName: 'Inbox', title: 'Add a widget' }]);
        expect(editCalls).toHaveLength(1);
        expect(editCalls[0].projectName).toBe('Inbox');
        expect(editCalls[0].item.id).toBe('created-id-1');
        expect(editCalls[0].item.desc).toBe('A shiny new widget.');

        // The run shipped against the CREATED todo's id, not the null row.todo_id.
        expect(shipCalls).toHaveLength(1);
        expect(shipCalls[0].todoId).toBe('created-id-1');
    });

    it('persists the created todo id back onto the queue row for later stamping', async () => {
        selectProject('Inbox');
        const row = {
            id: 'q9',
            todo_id: null,
            entry_id: null,
            context: { title: 'Add a widget', description: 'A shiny new widget.' },
        };

        await dispatchDraft(row, 'entry body', row.entry_id);

        expect(runStateCalls).toHaveLength(1);
        expect(runStateCalls[0].id).toBe('q9');
        expect(runStateCalls[0].patch).toMatchObject({
            state: 'dispatched',
            entry_id: 'ent-new',
            correlation_id: 'corr-9',
            run_id: 222,
            todo_id: 'created-id-1',
        });
    });
});

describe('dispatchDraft leaves rows that already carry a todo_id untouched', () => {
    it('does not create a todo and does not rewrite todo_id when one is present', async () => {
        selectProject('Inbox');
        const row = {
            id: 'q1',
            todo_id: 't-existing',
            entry_id: 'ent-keep',
            context: { title: 'Should not be used', description: 'x' },
        };

        const res = await dispatchDraft(row, 'entry body', row.entry_id);
        expect(res).toEqual({ ok: true });

        // No todo creation path ran for a row that already has a source todo.
        expect(addToDoCalls).toHaveLength(0);
        expect(editCalls).toHaveLength(0);

        // Ships against the existing todo_id and never writes todo_id back.
        expect(shipCalls[0].todoId).toBe('t-existing');
        expect(runStateCalls[0].patch).not.toHaveProperty('todo_id');
    });
});
