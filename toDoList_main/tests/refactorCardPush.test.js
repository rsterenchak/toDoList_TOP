import { describe, it, expect, beforeEach, vi } from 'vitest';

// Tests for the "Push entry" control on the NEXT REFACTOR card (refactorCard.js):
// turning the shown candidate into a real todo and handing it to the agent loop.
// inject.js, listLogic.js, and toDoRow.js are fully mocked so the create →
// backfill → flag → dismiss hand-off can be scripted without network/Supabase.

let scanResult;
const scanRefactor = vi.fn(function () { return Promise.resolve(scanResult); });

// A tiny in-memory todo store so addToDo/listItems behave end-to-end.
let store;
let nextId;
let flagResult;
const addToDo = vi.fn(function (project, title) {
    store.push({ id: 'id-' + (nextId++), tit: title, desc: '' });
});
const listItems = vi.fn(function () { return store; });
const editToDoItem = vi.fn(function () {});
const flagTaskForAgent = vi.fn(function () { return Promise.resolve(flagResult); });
const dismissRefactorCandidate = vi.fn(function () { return Promise.resolve({ ok: true }); });
const saveRefactorScan = vi.fn(function () { return Promise.resolve({ ok: true }); });
const loadLatestRefactorScan = vi.fn(function () { return Promise.resolve({ ok: true, row: null }); });

const addToDos_restore = vi.fn(function () {});
const addAllToDo_DOM = vi.fn(function () {});

vi.mock('../src/inject.js', () => ({
    scanRefactor: (...a) => scanRefactor(...a),
    getCachedTargets: () => [],
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        loadLatestRefactorScan: (...a) => loadLatestRefactorScan(...a),
        saveRefactorScan: (...a) => saveRefactorScan(...a),
        dismissRefactorCandidate: (...a) => dismissRefactorCandidate(...a),
        addToDo: (...a) => addToDo(...a),
        listItems: (...a) => listItems(...a),
        editToDoItem: (...a) => editToDoItem(...a),
        flagTaskForAgent: (...a) => flagTaskForAgent(...a),
    },
}));

vi.mock('../src/toDoRow.js', () => ({
    addToDos_restore: (...a) => addToDos_restore(...a),
    addAllToDo_DOM: (...a) => addAllToDo_DOM(...a),
}));

import { renderRefactorCard, _resetRefactorCard } from '../src/refactorCard.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) { for (let i = 0; i < n; i++) await tick(); }

const FOUND = {
    ok: true,
    found: true,
    target_file: 'src/agentView.js',
    target_sha: 'sha-1',
    candidates: [
        {
            name: 'buildMockupSecondary',
            lines: 120,
            start_line: 1222,
            end_line: 1342,
            closure_refs: ['ctx', 'row'],
            suggested_module: 'src/agentMockup.js',
            cluster_with: ['renderMockupPreviews'],
            rationale: 'Self-contained mockup rendering.',
        },
        {
            name: 'buildDiscussSeed',
            lines: 40,
            closure_refs: [],
            suggested_module: 'src/agentHandoff.js',
            cluster_with: [],
            rationale: 'Pure seed assembly.',
        },
    ],
};

beforeEach(() => {
    _resetRefactorCard();
    document.body.innerHTML = '<div id="mainList"></div>';
    scanResult = FOUND;
    store = [];
    nextId = 1;
    flagResult = { ok: true };
    scanRefactor.mockClear();
    addToDo.mockClear();
    listItems.mockClear();
    editToDoItem.mockClear();
    flagTaskForAgent.mockClear();
    dismissRefactorCandidate.mockClear();
    addToDos_restore.mockClear();
    addAllToDo_DOM.mockClear();
});

describe('Push entry — rendering', () => {
    it('renders a Push button left of Skip', async () => {
        const card = renderRefactorCard('o/r', 'My Project');
        await flush();
        const actions = card.querySelector('.refactorCardActions');
        const buttons = actions.querySelectorAll('button');
        expect(buttons[0].className).toBe('refactorCardPush');
        expect(buttons[0].textContent).toBe('Push entry');
        expect(buttons[1].className).toBe('refactorCardSkip');
        expect(buttons[0].disabled).toBe(false);
    });

    it('disables Push when no project is linked', async () => {
        const card = renderRefactorCard('o/r', '');
        await flush();
        const push = card.querySelector('.refactorCardPush');
        expect(push.disabled).toBe(true);
    });
});

describe('Push entry — hand-off', () => {
    it('creates the todo, backfills its description, flags it, and dismisses', async () => {
        const card = renderRefactorCard('o/r', 'My Project');
        await flush();
        card.querySelector('.refactorCardPush').click();
        await flush();

        // Title is an imperative extraction instruction.
        expect(addToDo).toHaveBeenCalledWith(
            'My Project',
            'Extract buildMockupSecondary from agentView.js into src/agentMockup.js'
        );
        // Description backfilled through the edit path.
        expect(editToDoItem).toHaveBeenCalledTimes(1);
        const edited = editToDoItem.mock.calls[0][1];
        expect(edited.desc).toMatch(/behaviour-preserving/i);
        expect(edited.desc).toContain('toDoList_main/src/agentView.js');
        expect(edited.desc).toContain('toDoList_main/src/agentMockup.js');
        expect(edited.desc).toContain('renderMockupPreviews');
        expect(edited.desc).toContain('1222');
        // Handed to the agent loop with the created id.
        expect(flagTaskForAgent).toHaveBeenCalledWith('id-1');
        // Pushed candidate is dismissed.
        expect(dismissRefactorCandidate).toHaveBeenCalledWith('o/r', 'src/agentView.js', 'buildMockupSecondary');
        // Confirmation replaces the actions row.
        expect(card.querySelector('.refactorCardActions')).toBeFalsy();
        expect(card.querySelector('.refactorCardPushed').textContent).toMatch(/triaging/i);
        // Projects list rebuilt (real items exist post-add).
        expect(addToDos_restore).toHaveBeenCalledTimes(1);
    });

    it('surfaces an inline error and does not dismiss when the hand-off fails', async () => {
        flagResult = { ok: false, error: 'Insert failed.' };
        const card = renderRefactorCard('o/r', 'My Project');
        await flush();
        const push = card.querySelector('.refactorCardPush');
        push.click();
        await flush();

        expect(flagTaskForAgent).toHaveBeenCalledTimes(1);
        expect(dismissRefactorCandidate).not.toHaveBeenCalled();
        const err = card.querySelector('.refactorCardPushError');
        expect(err).toBeTruthy();
        expect(err.textContent).toContain('Insert failed.');
        // Buttons re-enabled for a retry; candidate unchanged.
        expect(push.disabled).toBe(false);
        expect(card.querySelector('.refactorCardSkip').disabled).toBe(false);
        expect(card.querySelector('.refactorCardTitle').textContent).toBe('buildMockupSecondary');
    });

    it('ignores repeat clicks while a push is in flight (no double-create)', async () => {
        let resolveFlag;
        flagTaskForAgent.mockImplementationOnce(function () {
            return new Promise(function (r) { resolveFlag = r; });
        });
        const card = renderRefactorCard('o/r', 'My Project');
        await flush();
        const push = card.querySelector('.refactorCardPush');
        push.click();
        await flush(1);
        // Second tap while the first is pending is a no-op.
        push.click();
        resolveFlag({ ok: true });
        await flush();
        expect(addToDo).toHaveBeenCalledTimes(1);
        expect(flagTaskForAgent).toHaveBeenCalledTimes(1);
    });
});
