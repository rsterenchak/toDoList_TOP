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
    },
}));

vi.mock('../src/inject.js', () => ({
    chatWithWorker: vi.fn(function (messages) {
        state.lastMessages = messages;
        return Promise.resolve({ reply: state.reply, suggestedFiles: [] });
    }),
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        getProjectStages: function () { return state.stages; },
        listItems: function () { return state.items; },
        addToDo: vi.fn(function (project, title) { state.added.push(title); }),
    },
}));

import { openSeedTasksModal, parseTaskTitles } from '../src/seedTasksModal.js';
import { chatWithWorker } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

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
    chatWithWorker.mockClear();
    listLogic.addToDo.mockClear();
});

describe('parseTaskTitles', () => {
    it('parses a clean JSON array of titles', () => {
        expect(parseTaskTitles('["Add login", "Wire logout"]'))
            .toEqual(['Add login', 'Wire logout']);
    });

    it('strips ```json code fences before parsing', () => {
        expect(parseTaskTitles('```json\n["A", "B"]\n```')).toEqual(['A', 'B']);
    });

    it('falls back to line-splitting (stripping -, *, 1. markers) for non-JSON replies', () => {
        const reply = 'Here are tasks:\n- First task\n* Second task\n1. Third task';
        expect(parseTaskTitles(reply))
            .toEqual(['Here are tasks:', 'First task', 'Second task', 'Third task']);
    });

    it('caps the result at 20 titles', () => {
        const arr = Array.from({ length: 30 }, (_, i) => 'Task ' + i);
        expect(parseTaskTitles(JSON.stringify(arr)).length).toBe(20);
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

        // The call must not touch the live chat conversation: no entry_id,
        // null repo (Worker default).
        expect(chatWithWorker.mock.calls[0][1]).toBeUndefined(); // entryId
        expect(chatWithWorker.mock.calls[0][3]).toBeNull();      // repo
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
