import { vi } from 'vitest';
import { describe, it, expect, beforeEach } from 'vitest';

// A fresh derive proposal accepted from the Agent board or the Coverage tab ships
// through dispatchDraft with `row.todo_id === null` — the proposal was never a
// real list item. These tests pin the branch that closes that gap: dispatchDraft
// must materialize a real todo in the selected project (title + description from
// the proposal's context) before shipping, ship the run against the CREATED todo's
// id, and persist that id back onto the queue row so stampEntryShipped can find it
// when the PR merges. Rows that already carry a todo_id must be untouched by this
// path. The todo is created through `listLogic.addEntryTodo`, whose SINGLE insert
// carries the description AND the entry id — the fix for the earlier bug where an
// insert-then-update pair raced and left both null server-side. shipEntry.js,
// inject.js, and listLogic.js are mocked so no network is hit and each call is
// observed directly.

let shipCalls = [];
let shipResult = { ok: true, entryId: 'ent-new', correlationId: 'corr-9', runId: 222 };
let runStateCalls = [];
let addEntryCalls = [];

vi.mock('../src/shipEntry.js', () => ({
    shipEntryForTodo: (opts) => {
        shipCalls.push(opts);
        return Promise.resolve(shipResult);
    },
}));

vi.mock('../src/inject.js', () => ({
    findTargetById: () => null,
    mintEntryId: () => 'ent-mint',
    embedEntryMarker: (t, id) => String(t == null ? '' : t).replace(/\s+$/, '') + '\n  <!-- id: ' + id + ' -->',
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        getProjectTargetId: () => null,
        // The single-insert create path: records its args and returns a fresh id,
        // mirroring listLogic.addEntryTodo's contract (never a title diff).
        addEntryTodo: (projectName, title, description, entryId) => {
            addEntryCalls.push({ projectName, title, description, entryId });
            return 'created-id-1';
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
    addEntryCalls = [];
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
        // and its description set to the ENTRY being injected (draftText) — marker-
        // embedded — NOT the proposal's short summary. The description AND the
        // minted entry id both travel in that single create call.
        expect(addEntryCalls).toHaveLength(1);
        expect(addEntryCalls[0].projectName).toBe('Inbox');
        expect(addEntryCalls[0].title).toBe('Add a widget');
        expect(addEntryCalls[0].description).toBe('entry body\n  <!-- id: ent-mint -->');
        expect(addEntryCalls[0].description).not.toBe('A shiny new widget.');
        expect(addEntryCalls[0].entryId).toBe('ent-mint');

        // The run shipped against the CREATED todo's id, not the null row.todo_id,
        // reusing the id minted for the todo so the two never diverge.
        expect(shipCalls).toHaveLength(1);
        expect(shipCalls[0].todoId).toBe('created-id-1');
        expect(shipCalls[0].existingEntryId).toBe('ent-mint');
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

    it('backfills the entry text as the description, not the proposal summary', async () => {
        selectProject('Inbox');
        const row = {
            id: 'q9',
            todo_id: null,
            entry_id: null,
            context: { title: 'Add a widget', description: 'A shiny new widget.' },
        };

        const entryText =
            '- [ ] **[MEDIUM]** Add a widget\n  - Type: feature\n' +
            '  - Description: Renders a widget.\n  - File: `src/widget.js`';
        await dispatchDraft(row, entryText, row.entry_id);

        // The stored description is the full injected entry (headline + Type/File
        // bullets) with the marker appended — never the one-line proposal summary.
        expect(addEntryCalls[0].description).toBe(entryText + '\n  <!-- id: ent-mint -->');
        expect(addEntryCalls[0].description).toContain('- Type: feature');
        expect(addEntryCalls[0].description).toContain('- File: `src/widget.js`');
        expect(addEntryCalls[0].description).not.toContain('A shiny new widget.');
    });

    it('ships against the id addEntryTodo returns, not a title-matched row', async () => {
        selectProject('Inbox');
        const row = {
            id: 'q9',
            todo_id: null,
            entry_id: null,
            context: { title: 'Add a widget', description: 'A shiny new widget.' },
        };

        await dispatchDraft(row, 'entry body', row.entry_id);

        // The created todo's id (returned directly by addEntryTodo, which never
        // adopts a same-title row) is what the run and the queue-row stamp use.
        expect(shipCalls[0].todoId).toBe('created-id-1');
        expect(runStateCalls[0].patch.todo_id).toBe('created-id-1');
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
        expect(addEntryCalls).toHaveLength(0);

        // Ships against the existing todo_id and never writes todo_id back.
        expect(shipCalls[0].todoId).toBe('t-existing');
        expect(runStateCalls[0].patch).not.toHaveProperty('todo_id');
    });
});
