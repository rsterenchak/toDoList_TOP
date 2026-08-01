import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';

// Chat's "Inject & run" used to inject an entry and dispatch a run with NOTHING
// representing the work in a list — no ACCEPT face, no revert, no iterate. It now
// creates a real task the same way a fresh derive proposal does, through the ONE
// shared `materializeEntryTodo` funnel in dispatchDraft.js. These tests pin that
// funnel's invariants (create a todo whose description is the entry text as
// injected, repaint the list, don't adopt a same-title task) and pin the chat
// path's wiring to it (resolve the project from the TARGET repo, stamp the entry
// id onto the created todo, skip + report when no project routes to the repo).
//
// shipEntry.js, inject.js, listLogic.js, agentQueueStore.js and toDoRow.js are
// mocked so nothing renders or hits the network and each call is observed
// directly — mirroring the sibling dispatchDraft tests.

let addToDoCalls = [];
let editCalls = [];
let projectItems = [];
let restoreCalls = [];
let domCalls = [];

vi.mock('../src/shipEntry.js', () => ({
    shipEntryForTodo: () => Promise.resolve({ ok: true, entryId: 'e', correlationId: 'c' }),
}));

vi.mock('../src/inject.js', () => ({
    findTargetById: () => null,
    mintEntryId: () => 'ent-mint',
    embedEntryMarker: (t, id) => String(t == null ? '' : t).replace(/\s+$/, '') + '\n  <!-- id: ' + id + ' -->',
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
        editToDoItem: (projectName, item) => {
            editCalls.push({ projectName, item: { ...item } });
        },
    },
}));

vi.mock('../src/toDoRow.js', () => ({
    addToDos_restore: (...a) => { restoreCalls.push(a); },
    addAllToDo_DOM: (...a) => { domCalls.push(a); },
}));

import { materializeEntryTodo } from '../src/dispatchDraft.js';

// getSelectedProjectName reads a `.selectedProject` row's #projInput value; stand
// one up (plus the #mainList the rebuild targets) so the helper has a project on
// screen and a list to repaint.
function selectProject(name) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>' +
        '<div id="mainList"></div>';
}

beforeEach(() => {
    addToDoCalls = [];
    editCalls = [];
    projectItems = [];
    restoreCalls = [];
    domCalls = [];
    document.body.innerHTML = '';
});

describe('materializeEntryTodo — the shared create-a-todo-for-an-entry funnel', () => {
    it('creates a todo and stores the entry text VERBATIM as its description', async () => {
        selectProject('Inbox');
        const entry =
            '- [ ] **[MEDIUM]** Add a widget\n  - Type: feature\n' +
            '  - Description: Renders a widget.\n  - File: `src/widget.js`\n' +
            '  <!-- id: ent-mint -->';

        const createdId = await materializeEntryTodo('Inbox', 'Add a widget', entry);

        expect(createdId).toBe('created-id-1');
        expect(addToDoCalls).toEqual([{ projectName: 'Inbox', title: 'Add a widget' }]);
        // The description is the FULL entry as injected — headline, Type/File
        // bullets and the marker — not a one-line summary. The funnel is
        // marker-agnostic: it stores exactly what it was handed.
        expect(editCalls).toHaveLength(1);
        expect(editCalls[0].item.desc).toBe(entry);
        expect(editCalls[0].item.desc).toContain('- Type: feature');
        expect(editCalls[0].item.desc).toContain('<!-- id: ent-mint -->');
    });

    it('repaints #mainList when the created todo is in the on-screen project', async () => {
        selectProject('Inbox');
        await materializeEntryTodo('Inbox', 'Add a widget', 'entry body');
        expect(restoreCalls).toHaveLength(1);
        expect(restoreCalls[0][1]).toBe('Inbox');
        expect(restoreCalls[0][0].some((i) => i.id === 'created-id-1')).toBe(true);
    });

    it('does NOT repaint when the created todo belongs to an off-screen project', async () => {
        // Chat can target a repo whose project is not the one selected — creating
        // a todo there must not repaint the visible list.
        selectProject('Inbox');
        const createdId = await materializeEntryTodo('Archive', 'Add a widget', 'entry body');
        expect(createdId).toBe('created-id-1');
        expect(addToDoCalls).toEqual([{ projectName: 'Archive', title: 'Add a widget' }]);
        expect(restoreCalls).toHaveLength(0);
        expect(domCalls).toHaveLength(0);
    });

    it('returns null and creates nothing when the project or title is missing', async () => {
        selectProject('Inbox');
        expect(await materializeEntryTodo('', 'Add a widget', 'entry')).toBeNull();
        expect(await materializeEntryTodo('Inbox', '   ', 'entry')).toBeNull();
        expect(addToDoCalls).toHaveLength(0);
        expect(editCalls).toHaveLength(0);
    });

    it('does not adopt a pre-existing task that shares the title', async () => {
        selectProject('Inbox');
        projectItems.push({ id: 'old-1', tit: 'Add a widget', desc: 'pre-existing' });
        const createdId = await materializeEntryTodo('Inbox', 'Add a widget', 'entry body');
        // The fresh id, never the pre-existing 'old-1', is returned and edited.
        expect(createdId).toBe('created-id-1');
        expect(editCalls).toHaveLength(1);
        expect(editCalls[0].item.id).toBe('created-id-1');
        expect(projectItems.find((i) => i.id === 'old-1').desc).toBe('pre-existing');
    });
});

// The chat ship path lives in shipDraftedEntry, reachable only through a rendered
// draft card and a network-backed inject/dispatch, so its wiring to the shared
// funnel is pinned structurally — the same approach dispatchDraftShared uses to
// guarantee the two surfaces never grow divergent copies.
describe('chat Inject & run wires into the shared funnel (no divergent copy)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const srcDir = resolve(here, '../src');
    const claudeSheet = readFileSync(resolve(srcDir, 'claudeSheet.js'), 'utf8');

    it('imports materializeEntryTodo from dispatchDraft.js rather than reimplementing it', () => {
        expect(claudeSheet).toMatch(/import \{ materializeEntryTodo \} from '\.\/dispatchDraft\.js'/);
        // No second creation loop copied into the chat file.
        expect(claudeSheet).not.toMatch(/listLogic\.addToDo\(/);
    });

    it('resolves the task project from the TARGET repo, not the on-screen project', () => {
        expect(claudeSheet).toMatch(/function projectForRepo\(repo\)/);
        expect(claudeSheet).toMatch(/const taskProject = projectForRepo\(activeChatRepo\)/);
    });

    it('creates the todo with the entry headline as title and the injected entry as description', () => {
        expect(claudeSheet).toMatch(/materializeEntryTodo\(\s*taskProject,\s*deriveRunTitle\(entryText\),\s*entry\s*\)/);
    });

    it('stamps the entry id onto the created todo so it resolves its shipped state', () => {
        expect(claudeSheet).toMatch(/stampTodoEntryId\(createdId, entryId\)/);
    });

    it('skips creation and reports when no project routes to the target repo', () => {
        // The else branch of `if (taskProject)` surfaces the skip in the chat.
        expect(claudeSheet).toMatch(/no project here routes to/);
    });
});
