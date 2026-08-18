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

let addEntryCalls = [];
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
        // The single-insert create path: the description and entry id travel in
        // ONE write. Records its args, lands the item so the rebuild renders it,
        // and returns its id (never a title diff).
        addEntryTodo: (projectName, title, description, entryId) => {
            addEntryCalls.push({ projectName, title, description, entryId });
            projectItems.push({ id: 'created-id-1', tit: title, desc: description, entryId });
            return 'created-id-1';
        },
        listItems: () => projectItems,
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
    addEntryCalls = [];
    projectItems = [];
    restoreCalls = [];
    domCalls = [];
    document.body.innerHTML = '';
});

describe('materializeEntryTodo — the shared create-a-todo-for-an-entry funnel', () => {
    it('creates a todo and stores the entry text VERBATIM as its description in one write', async () => {
        selectProject('Inbox');
        const entry =
            '- [ ] **[MEDIUM]** Add a widget\n  - Type: feature\n' +
            '  - Description: Renders a widget.\n  - File: `src/widget.js`\n' +
            '  <!-- id: ent-mint -->';

        const createdId = await materializeEntryTodo('Inbox', 'Add a widget', entry, 'ent-mint');

        expect(createdId).toBe('created-id-1');
        expect(addEntryCalls).toHaveLength(1);
        expect(addEntryCalls[0].projectName).toBe('Inbox');
        expect(addEntryCalls[0].title).toBe('Add a widget');
        // The description is the FULL entry as injected — headline, Type/File
        // bullets and the marker — not a one-line summary. The funnel is
        // marker-agnostic: it stores exactly what it was handed. The entry id
        // rides in the SAME create call so the row's insert carries both.
        expect(addEntryCalls[0].description).toBe(entry);
        expect(addEntryCalls[0].description).toContain('- Type: feature');
        expect(addEntryCalls[0].description).toContain('<!-- id: ent-mint -->');
        expect(addEntryCalls[0].entryId).toBe('ent-mint');
    });

    it('repaints #mainList when the created todo is in the on-screen project', async () => {
        selectProject('Inbox');
        await materializeEntryTodo('Inbox', 'Add a widget', 'entry body', 'ent-mint');
        expect(restoreCalls).toHaveLength(1);
        expect(restoreCalls[0][1]).toBe('Inbox');
        expect(restoreCalls[0][0].some((i) => i.id === 'created-id-1')).toBe(true);
    });

    it('does NOT repaint when the created todo belongs to an off-screen project', async () => {
        // Chat can target a repo whose project is not the one selected — creating
        // a todo there must not repaint the visible list.
        selectProject('Inbox');
        const createdId = await materializeEntryTodo('Archive', 'Add a widget', 'entry body', 'ent-mint');
        expect(createdId).toBe('created-id-1');
        expect(addEntryCalls).toHaveLength(1);
        expect(addEntryCalls[0].projectName).toBe('Archive');
        expect(restoreCalls).toHaveLength(0);
        expect(domCalls).toHaveLength(0);
    });

    it('returns null and creates nothing when the project or title is missing', async () => {
        selectProject('Inbox');
        expect(await materializeEntryTodo('', 'Add a widget', 'entry')).toBeNull();
        expect(await materializeEntryTodo('Inbox', '   ', 'entry')).toBeNull();
        expect(addEntryCalls).toHaveLength(0);
    });

    it('returns the id addEntryTodo mints rather than matching by title', async () => {
        selectProject('Inbox');
        // A pre-existing task shares the title; addEntryTodo always creates a
        // fresh row and returns ITS id, so materializeEntryTodo never adopts the
        // old one — the guarantee now lives in the single-insert create path.
        projectItems.push({ id: 'old-1', tit: 'Add a widget', desc: 'pre-existing' });
        const createdId = await materializeEntryTodo('Inbox', 'Add a widget', 'entry body', 'ent-mint');
        expect(createdId).toBe('created-id-1');
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
        // The import grew a second and third name (the shared revert step and its
        // copy helpers), so match the shared module + the name rather than the
        // exact single-name form it used to have.
        expect(claudeSheet).toMatch(/import \{[^}]*materializeEntryTodo[^}]*\} from '\.\/dispatchDraft\.js'/s);
        // No second creation loop copied into the chat file — neither the plain
        // add path nor the single-insert entry path.
        expect(claudeSheet).not.toMatch(/listLogic\.addToDo\(/);
        expect(claudeSheet).not.toMatch(/listLogic\.addEntryTodo\(/);
    });

    it('resolves the task project from the TARGET repo, not the on-screen project', () => {
        expect(claudeSheet).toMatch(/function projectForRepo\(repo\)/);
        expect(claudeSheet).toMatch(/const taskProject = projectForRepo\(activeChatRepo\)/);
    });

    it('creates the todo with the entry headline as title, the injected entry as description, and the entry id in the same call', () => {
        // The entry id is passed as the 4th arg so it rides in the todo's single
        // insert (addEntryTodo) rather than a follow-up UPDATE that would race it.
        expect(claudeSheet).toMatch(/materializeEntryTodo\(\s*taskProject,\s*deriveRunTitle\(entryText\),\s*entry,\s*entryId\s*\)/);
    });

    it('stamps the entry id onto the created todo so it resolves its shipped state', () => {
        expect(claudeSheet).toMatch(/stampTodoEntryId\(createdId, entryId\)/);
    });

    it('skips creation and reports when no project routes to the target repo', () => {
        // The else branch of `if (taskProject)` surfaces the skip in the chat.
        expect(claudeSheet).toMatch(/no project here routes to/);
    });
});
