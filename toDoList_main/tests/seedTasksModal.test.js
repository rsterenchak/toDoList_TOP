import { vi } from 'vitest';

// The "Generate tasks" review modal (seedTasksModal.js) decomposes a project's
// Build-plan stage into todos via the in-app Claude chat path and opens a
// review checklist. These tests drive the modal end-to-end against a jsdom DOM
// with the two collaborators mocked:
//   • chatWithWorker (inject.js) — captured so we can assert the outbound
//     prompt and feed back canned replies (JSON array vs. stray prose).
//   • listLogic (listLogic.js) — stubbed to supply stages + existing titles
//     and to spy on the addToDo commit path.
const { state } = vi.hoisted(() => ({
    state: {
        reply: '[]',
        lastMessages: null,
        stages: [],
        items: [],
        added: [],
        edited: [],
        targetId: null,
        targets: [],
    },
}));

vi.mock('../src/inject.js', () => ({
    chatWithWorker: vi.fn(function (messages) {
        state.lastMessages = messages;
        return Promise.resolve({ reply: state.reply, suggestedFiles: [] });
    }),
    // Resolve a target id against the canned cache so resolveProjectRepo can
    // map a project's target_id to a repo (or null when absent).
    findTargetById: vi.fn(function (id) {
        return state.targets.find(function (t) { return t.id === id; }) || null;
    }),
}));

// Spy the #mainList re-render path. Mocking the module keeps the heavy real
// toDoRow.js (and its render machinery) out of these DOM-level tests while
// letting us assert the post-commit re-render fires.
vi.mock('../src/toDoRow.js', () => ({
    addToDos_restore: vi.fn(),
    addAllToDo_DOM: vi.fn(),
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        getProjectStages: function () { return state.stages; },
        // Spec-shaped project: the actionable stage is 'Build plan', so the
        // modal targets the Build-plan stage in this fixture.
        getProjectLifecycle: function () { return 'spec'; },
        getProjectTargetId: function () { return state.targetId; },
        listItems: function () { return state.items; },
        // Mirror the real add path: append a committed item (empty desc) so the
        // confirm flow can find it by title and backfill its description.
        addToDo: vi.fn(function (project, title) {
            state.added.push(title);
            state.items.push({ tit: title, desc: '' });
            return { array: state.items };
        }),
        // Description-update path the confirm flow routes the entry through.
        editToDoItem: vi.fn(function (project, item) { state.edited.push(item); }),
    },
}));

import { openSeedTasksModal, parseTasks, resolveProjectRepo } from '../src/seedTasksModal.js';
import { chatWithWorker } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';
import { addToDos_restore, addAllToDo_DOM } from '../src/toDoRow.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) {
    for (let i = 0; i < n; i++) await tick();
}

function makeStage(label, body) {
    return { id: 'id-' + label, label: label, body: body };
}

beforeEach(() => {
    document.body.innerHTML = '';
    state.reply = '[]';
    state.lastMessages = null;
    state.stages = [
        makeStage('Why', ''),
        makeStage('Concept', 'A focused planner.'),
        makeStage('Requirements', ''),
        makeStage('Design', ''),
        makeStage('Build plan', 'Step one. Step two.'),
    ];
    state.items = [];
    state.added = [];
    state.edited = [];
    state.targetId = null;
    state.targets = [];
    chatWithWorker.mockClear();
    listLogic.addToDo.mockClear();
    listLogic.editToDoItem.mockClear();
    addToDos_restore.mockClear();
    addAllToDo_DOM.mockClear();
});

describe('parseTasks', () => {
    it('parses an object array of {title, entry} pairs', () => {
        const reply = JSON.stringify([
            { title: 'Add login', entry: '- [ ] **[HIGH]** Add login\n  - Type: feature' },
            { title: 'Wire logout', entry: '- [ ] **[LOW]** Wire logout\n  - Type: feature' },
        ]);
        expect(parseTasks(reply)).toEqual([
            { title: 'Add login', entry: '- [ ] **[HIGH]** Add login\n  - Type: feature' },
            { title: 'Wire logout', entry: '- [ ] **[LOW]** Wire logout\n  - Type: feature' },
        ]);
    });

    it('defaults entry to "" when an object omits it or it is non-string', () => {
        const reply = JSON.stringify([{ title: 'A' }, { title: 'B', entry: 42 }]);
        expect(parseTasks(reply)).toEqual([
            { title: 'A', entry: '' },
            { title: 'B', entry: '' },
        ]);
    });

    it('skips objects without a usable title', () => {
        const reply = JSON.stringify([{ entry: 'orphan' }, { title: '  ' }, { title: 'Keep me' }]);
        expect(parseTasks(reply)).toEqual([{ title: 'Keep me', entry: '' }]);
    });

    it('parses a plain string array as titles with empty entries', () => {
        expect(parseTasks('["Add login", "Wire logout"]'))
            .toEqual([
                { title: 'Add login', entry: '' },
                { title: 'Wire logout', entry: '' },
            ]);
    });

    it('strips ```json code fences before parsing', () => {
        expect(parseTasks('```json\n["A", "B"]\n```'))
            .toEqual([{ title: 'A', entry: '' }, { title: 'B', entry: '' }]);
    });

    it('falls back to line-splitting (stripping -, *, 1. markers) for non-JSON replies', () => {
        const reply = 'Here are tasks:\n- First task\n* Second task\n1. Third task';
        expect(parseTasks(reply)).toEqual([
            { title: 'Here are tasks:', entry: '' },
            { title: 'First task', entry: '' },
            { title: 'Second task', entry: '' },
            { title: 'Third task', entry: '' },
        ]);
    });

    it('caps a title-only (string array) reply at 20', () => {
        const arr = Array.from({ length: 30 }, (_, i) => 'Task ' + i);
        expect(parseTasks(JSON.stringify(arr)).length).toBe(20);
    });

    it('caps an entry (object array) reply lower than the title-only path (10)', () => {
        const arr = Array.from({ length: 30 }, (_, i) => ({ title: 'Task ' + i, entry: 'e' + i }));
        expect(parseTasks(JSON.stringify(arr)).length).toBe(10);
    });
});

describe('openSeedTasksModal — outbound prompt', () => {
    it('sends the Build plan plus non-empty context stages and the "tasks only from the Build plan" instruction', async () => {
        openSeedTasksModal('Proj');
        await flush();

        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        const messages = state.lastMessages;
        expect(Array.isArray(messages)).toBe(true);
        const prompt = messages[0].content;

        // Build-plan body is the task source.
        expect(prompt).toContain('Step one. Step two.');
        // Non-empty context stage rides along; empty ones do not.
        expect(prompt).toContain('Concept');
        expect(prompt).toContain('A focused planner.');
        expect(prompt).not.toMatch(/###\s+Why/);
        expect(prompt).not.toMatch(/###\s+Requirements/);
        // The derive-only-from-the-Build-plan instruction is present.
        expect(prompt).toMatch(/ONLY from the Build plan/i);
        // The prompt requests title + entry objects in the core TODO.md shape.
        expect(prompt).toContain('"title"');
        expect(prompt).toContain('"entry"');
        expect(prompt).toMatch(/JSON array of objects/i);
        expect(prompt).toContain('- [ ] **[PRIORITY]**');
        expect(prompt).toContain('- Type: bug | feature');

        // The call must not touch the live chat conversation: no entry_id,
        // null repo (Worker default).
        expect(chatWithWorker.mock.calls[0][1]).toBeUndefined(); // entryId
        expect(chatWithWorker.mock.calls[0][3]).toBeNull();      // repo
        // Seed-todos decomposition routes through the heavier model: the
        // trailing deep flag is true. Every other chat turn omits it.
        expect(chatWithWorker.mock.calls[0][5]).toBe(true);      // deep
    });
});

describe('resolveProjectRepo', () => {
    it('returns the linked repo when the project target_id resolves to a cached target', () => {
        state.targetId = 't1';
        state.targets = [{ id: 't1', repo: 'owner/some-app' }];
        expect(resolveProjectRepo('Proj')).toBe('owner/some-app');
    });

    it('returns null when the project has no target_id', () => {
        state.targetId = null;
        state.targets = [{ id: 't1', repo: 'owner/some-app' }];
        expect(resolveProjectRepo('Proj')).toBeNull();
    });

    it('returns null when the target_id is not in the cache (deleted/unwarmed)', () => {
        state.targetId = 'missing';
        state.targets = [{ id: 't1', repo: 'owner/some-app' }];
        expect(resolveProjectRepo('Proj')).toBeNull();
    });
});

describe('openSeedTasksModal — repo grounding', () => {
    it('passes the project linked repo as the repo arg when the project is linked', async () => {
        state.targetId = 't1';
        state.targets = [{ id: 't1', repo: 'owner/some-app' }];
        openSeedTasksModal('Proj');
        await flush();

        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        expect(chatWithWorker.mock.calls[0][3]).toBe('owner/some-app'); // repo
        expect(chatWithWorker.mock.calls[0][5]).toBe(true);             // deep
    });

    it('passes null (Worker default) when the project has no linked repo', async () => {
        state.targetId = null;
        openSeedTasksModal('Proj');
        await flush();

        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        expect(chatWithWorker.mock.calls[0][3]).toBeNull(); // repo
    });
});

describe('openSeedTasksModal — checklist rendering', () => {
    it('renders a JSON-array reply as a checklist, all checked by default', async () => {
        state.reply = '["Build the API", "Write the tests"]';
        openSeedTasksModal('Proj');
        await flush();

        const rows = document.querySelectorAll('.seedTasksModalRow');
        expect(rows.length).toBe(2);
        const boxes = document.querySelectorAll('.seedTasksModalCheckbox');
        expect([...boxes].every((b) => b.checked)).toBe(true);

        const addBtn = document.getElementById('seedTasksModalAdd');
        expect(addBtn.textContent).toBe('Add 2 tasks');
        expect(addBtn.disabled).toBe(false);
    });

    it('renders a non-JSON reply via the line-split fallback', async () => {
        state.reply = '- First\n- Second\n- Third';
        openSeedTasksModal('Proj');
        await flush();

        const titles = [...document.querySelectorAll('.seedTasksModalRowTitle')]
            .map((el) => el.textContent);
        expect(titles).toEqual(['First', 'Second', 'Third']);
    });

    it('shows an error with a retry on an empty/unparseable reply', async () => {
        state.reply = '';
        openSeedTasksModal('Proj');
        await flush();

        expect(document.querySelector('.seedTasksModalError')).toBeTruthy();
        // No silent close — the modal is still mounted.
        expect(document.getElementById('seedTasksModalBackdrop')).toBeTruthy();
    });
});

describe('openSeedTasksModal — duplicate filtering', () => {
    it('greys, disables, unchecks, and excludes titles that already exist in the project', async () => {
        state.items = [{ tit: 'Write the tests' }, { tit: '' }];
        state.reply = '["Build the API", "write the TESTS"]';
        openSeedTasksModal('Proj');
        await flush();

        const dupRows = document.querySelectorAll('.seedTasksModalRowDup');
        expect(dupRows.length).toBe(1);
        expect(document.querySelector('.seedTasksModalDupTag').textContent).toBe('in tasks');

        const boxes = [...document.querySelectorAll('.seedTasksModalCheckbox')];
        const dupBox = boxes.find((b) => b.disabled);
        expect(dupBox).toBeTruthy();
        expect(dupBox.checked).toBe(false);

        // Only the non-duplicate counts toward the total.
        expect(document.getElementById('seedTasksModalAdd').textContent).toBe('Add 1 task');
    });
});

describe('openSeedTasksModal — confirm creates tasks', () => {
    it('adds exactly the checked, non-duplicate tasks through listLogic.addToDo', async () => {
        state.items = [{ tit: 'Existing task' }];
        state.reply = '["Existing task", "New one", "New two"]';
        openSeedTasksModal('Proj');
        await flush();

        // Uncheck "New two" so only "New one" remains checked + non-duplicate.
        const boxes = [...document.querySelectorAll('.seedTasksModalCheckbox')];
        const newTwo = boxes.find((b) => b.value === 'New two');
        newTwo.checked = false;
        newTwo.dispatchEvent(new Event('change'));

        document.getElementById('seedTasksModalAdd').click();

        expect(listLogic.addToDo).toHaveBeenCalledTimes(1);
        expect(state.added).toEqual(['New one']);
        // Modal closes after confirming.
        expect(document.getElementById('seedTasksModalBackdrop')).toBeNull();
    });

    it('does not double-create a title that duplicates an existing task even if checked state is forced', async () => {
        state.items = [{ tit: 'Dup' }];
        state.reply = '["Dup", "Fresh"]';
        openSeedTasksModal('Proj');
        await flush();

        document.getElementById('seedTasksModalAdd').click();

        expect(state.added).toEqual(['Fresh']);
    });
});

describe('openSeedTasksModal — entry Details toggle', () => {
    it('renders a Details toggle only for non-duplicate rows that carry an entry, and reveals the preformatted entry on toggle', async () => {
        state.items = [{ tit: 'Already there' }];
        state.reply = JSON.stringify([
            { title: 'Has entry', entry: '- [ ] **[MEDIUM]** Has entry\n  - Type: feature' },
            { title: 'No entry', entry: '' },
            { title: 'Already there', entry: '- [ ] **[LOW]** Already there\n  - Type: feature' },
        ]);
        openSeedTasksModal('Proj');
        await flush();

        const toggles = document.querySelectorAll('.seedTasksModalDetailsToggle');
        // Only the non-duplicate task with a non-empty entry gets a toggle.
        expect(toggles.length).toBe(1);

        const details = document.querySelector('.seedTasksModalDetails');
        expect(details).toBeTruthy();
        expect(details.hidden).toBe(true);
        expect(details.textContent).toContain('- [ ] **[MEDIUM]** Has entry');

        const toggle = toggles[0];
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        toggle.click();
        expect(details.hidden).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        toggle.click();
        expect(details.hidden).toBe(true);
    });
});

describe('openSeedTasksModal — confirm sets the entry as the todo description', () => {
    it('creates each checked task and backfills its entry via editToDoItem', async () => {
        state.reply = JSON.stringify([
            { title: 'First', entry: '- [ ] **[HIGH]** First\n  - Type: feature' },
            { title: 'Second', entry: '' },
        ]);
        openSeedTasksModal('Proj');
        await flush();

        document.getElementById('seedTasksModalAdd').click();

        // Both titles created through the add path.
        expect(state.added).toEqual(['First', 'Second']);
        // Only the task with a non-empty entry gets a description-update call.
        expect(listLogic.editToDoItem).toHaveBeenCalledTimes(1);
        const editedItem = state.edited[0];
        expect(editedItem.tit).toBe('First');
        expect(editedItem.desc).toBe('- [ ] **[HIGH]** First\n  - Type: feature');
    });
});

describe('openSeedTasksModal — re-renders the active list after commit', () => {
    it('re-renders the seeded project list once after the batch, without a project switch', async () => {
        document.body.innerHTML = '<div id="mainList"></div>';
        state.reply = '["New one", "New two"]';
        openSeedTasksModal('Proj');
        await flush();

        document.getElementById('seedTasksModalAdd').click();

        // The seeded project's list is re-rendered from data — exactly once
        // for the whole batch, not once per added task — so the new todos
        // appear without the user switching projects.
        expect(addToDos_restore).toHaveBeenCalledTimes(1);
        expect(addToDos_restore).toHaveBeenCalledWith(state.items, 'Proj');
        // #mainList was cleared before the render (no stale pre-seed rows).
        expect(document.getElementById('mainList').children.length).toBe(0);
    });

    it('does not throw when #mainList is absent (re-render is guarded)', async () => {
        document.body.innerHTML = '';
        state.reply = '["Only one"]';
        openSeedTasksModal('Proj');
        await flush();

        expect(() => document.getElementById('seedTasksModalAdd').click()).not.toThrow();
        expect(addToDos_restore).not.toHaveBeenCalled();
    });
});

describe('openSeedTasksModal — dismissal affordances', () => {
    it('closes on the close button', async () => {
        state.reply = '["A"]';
        openSeedTasksModal('Proj');
        await flush();
        document.getElementById('seedTasksModalClose').click();
        expect(document.getElementById('seedTasksModalBackdrop')).toBeNull();
    });

    it('closes on Escape', async () => {
        state.reply = '["A"]';
        openSeedTasksModal('Proj');
        await flush();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.getElementById('seedTasksModalBackdrop')).toBeNull();
    });

    it('closes on a backdrop click', async () => {
        state.reply = '["A"]';
        openSeedTasksModal('Proj');
        await flush();
        const backdrop = document.getElementById('seedTasksModalBackdrop');
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById('seedTasksModalBackdrop')).toBeNull();
    });
});
