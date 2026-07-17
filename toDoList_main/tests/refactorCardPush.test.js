import { describe, it, expect, beforeEach, vi } from 'vitest';

// Tests for the "Push entry" control on the NEXT REFACTOR card (refactorCard.js):
// turning the shown candidate into a real todo, then shipping its entry and
// dispatching a run for it directly (via shipEntryForTodo), gated first by an
// in-flight run probe (fetchActiveRuns) that fails closed. inject.js,
// shipEntry.js, listLogic.js, and toDoRow.js are fully mocked so the
// gate → create → backfill → ship → dismiss hand-off can be scripted without
// network/Supabase.

// The card reads its candidate from the stored scan row now (the Worker owns the
// scan), so tests drive the shown candidate through loadLatestRefactorScan.
let loadResult;

// The one-tap push safety rail: probe for an in-flight run before creating
// anything. Fails closed, so ok:false blocks the push.
let activeRunsResult;
const fetchActiveRuns = vi.fn(function () { return Promise.resolve(activeRunsResult); });

// The shared ship-and-dispatch core, mocked so the create → backfill → ship
// path can be scripted.
let shipResult;
const shipEntryForTodo = vi.fn(function () { return Promise.resolve(shipResult); });

// A tiny in-memory todo store so addToDo/listItems behave end-to-end.
let store;
let nextId;
const addToDo = vi.fn(function (project, title) {
    store.push({ id: 'id-' + (nextId++), tit: title, desc: '' });
});
const listItems = vi.fn(function () { return store; });
const editToDoItem = vi.fn(function () {});
const dismissRefactorCandidate = vi.fn(function () { return Promise.resolve({ ok: true }); });
const loadLatestRefactorScan = vi.fn(function () { return Promise.resolve(loadResult); });

const addToDos_restore = vi.fn(function () {});
const addAllToDo_DOM = vi.fn(function () {});

vi.mock('../src/inject.js', () => ({
    getCachedTargets: () => [],
    fetchActiveRuns: (...a) => fetchActiveRuns(...a),
}));

vi.mock('../src/shipEntry.js', () => ({
    shipEntryForTodo: (...a) => shipEntryForTodo(...a),
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        loadLatestRefactorScan: (...a) => loadLatestRefactorScan(...a),
        dismissRefactorCandidate: (...a) => dismissRefactorCandidate(...a),
        addToDo: (...a) => addToDo(...a),
        listItems: (...a) => listItems(...a),
        editToDoItem: (...a) => editToDoItem(...a),
    },
}));

vi.mock('../src/toDoRow.js', () => ({
    addToDos_restore: (...a) => addToDos_restore(...a),
    addAllToDo_DOM: (...a) => addAllToDo_DOM(...a),
}));

import { renderRefactorCard } from '../src/refactorCard.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) { for (let i = 0; i < n; i++) await tick(); }

const CANDIDATES = [
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
];

// A stored refactor_scans row — the shape loadLatestRefactorScan returns and the
// card reads directly to render the candidate a push then acts on.
function makeRow(candidates, targetFile) {
    return {
        repo: 'o/r',
        target_file: targetFile || 'src/agentView.js',
        target_sha: 'sha-1',
        candidates: candidates || CANDIDATES,
        dismissed: [],
        scanned_at: new Date().toISOString(),
    };
}

beforeEach(() => {
    document.body.innerHTML = '<div id="mainList"></div>';
    loadResult = { ok: true, row: makeRow() };
    store = [];
    nextId = 1;
    activeRunsResult = { ok: true, active: false };
    shipResult = { ok: true, entryId: 'entry-1', correlationId: 'corr-1' };
    loadLatestRefactorScan.mockClear();
    fetchActiveRuns.mockClear();
    shipEntryForTodo.mockClear();
    addToDo.mockClear();
    listItems.mockClear();
    editToDoItem.mockClear();
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

describe('Push entry — ship and dispatch', () => {
    it('probes for an in-flight run, creates the todo, backfills, ships, and dismisses', async () => {
        const card = renderRefactorCard('o/r', 'My Project');
        await flush();
        card.querySelector('.refactorCardPush').click();
        await flush();

        // The safety gate ran first, against the resolved target.
        expect(fetchActiveRuns).toHaveBeenCalledTimes(1);
        expect(fetchActiveRuns.mock.calls[0][0]).toEqual({ repo: 'o/r' });
        // No workflow argument — the probe hits claude-run.yml, not triage.
        expect(fetchActiveRuns.mock.calls[0][1]).toBeUndefined();

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
        // Shipped through the shared core with the created id, the entry text,
        // and the resolved target — and NO existingEntryId (fresh id minted).
        expect(shipEntryForTodo).toHaveBeenCalledTimes(1);
        const shipArg = shipEntryForTodo.mock.calls[0][0];
        expect(shipArg.todoId).toBe('id-1');
        expect(shipArg.entryText).toBe(edited.desc);
        expect(shipArg.target).toEqual({ repo: 'o/r' });
        expect(shipArg.existingEntryId).toBeUndefined();
        // Pushed candidate is dismissed.
        expect(dismissRefactorCandidate).toHaveBeenCalledWith('o/r', 'src/agentView.js', 'buildMockupSecondary');
        // Confirmation replaces the actions row and reflects a shipped run.
        expect(card.querySelector('.refactorCardActions')).toBeFalsy();
        expect(card.querySelector('.refactorCardPushed').textContent).toMatch(/shipped/i);
        expect(card.querySelector('.refactorCardPushed').textContent).not.toMatch(/triaging/i);
        // Projects list rebuilt (real items exist post-add).
        expect(addToDos_restore).toHaveBeenCalledTimes(1);
    });

    it('resolves a bare suggested_module against the target file dir, keeping src/', async () => {
        // Regression: the scan reports `suggested_module` as a bare filename
        // (`dismissable.js`) while `target_file` arrives already prefixed
        // (`toDoList_main/src/main.js`). The destination must land inside the
        // target file's directory — `toDoList_main/src/dismissable.js` — not one
        // level up outside webpack's tree.
        loadResult = { ok: true, row: makeRow([
            {
                name: 'makeDismissable',
                lines: 60,
                closure_refs: [],
                suggested_module: 'dismissable.js',
                cluster_with: [],
                rationale: 'Reusable dismiss helper.',
            },
        ], 'toDoList_main/src/main.js') };
        const card = renderRefactorCard('o/r', 'My Project');
        await flush();
        card.querySelector('.refactorCardPush').click();
        await flush();

        const edited = editToDoItem.mock.calls[0][1];
        expect(edited.desc).toContain('toDoList_main/src/dismissable.js');
        expect(edited.desc).not.toContain('toDoList_main/dismissable.js');
        // Source path stays correct too.
        expect(edited.desc).toContain('toDoList_main/src/main.js');
    });

    it('backfills a complete TODO.md entry, not free prose', async () => {
        // Regression: a pushed refactor's description IS its TODO.md entry
        // (injectDescription posts item.desc verbatim), so it must be a full,
        // parseable entry — a `- [ ]` checkbox line, a literal-bracket priority,
        // and Type/Description/File/Completed sub-bullets — not prose.
        const card = renderRefactorCard('o/r', 'My Project');
        await flush();
        card.querySelector('.refactorCardPush').click();
        await flush();

        const desc = editToDoItem.mock.calls[0][1].desc;
        const lines = desc.split('\n');
        // First line: checkbox + literal-bracket MEDIUM priority + the title.
        expect(lines[0]).toBe(
            '- [ ] **[MEDIUM]** Extract buildMockupSecondary from agentView.js into src/agentMockup.js'
        );
        // Two-space-indented sub-bullets in the repo's exact shape. Type must be
        // `feature` — the routine only accepts bug/feature, so `refactor` would
        // render the pushed entry ineligible and silently unrunnable.
        expect(desc).toContain('\n  - Type: feature');
        expect(desc).not.toContain('\n  - Type: refactor');
        expect(desc).toContain('\n  - Description: ');
        expect(desc).toContain(
            '\n  - File: `toDoList_main/src/agentView.js`, `toDoList_main/src/agentMockup.js`'
        );
        expect(desc).toContain('\n  - Completed: YYYY-MM-DD (PR #<number>)');
        // The Description body is a single line (no bare newlines inside it).
        const descLine = lines.find((l) => l.startsWith('  - Description: '));
        expect(descLine).toBeTruthy();
        expect(descLine).toMatch(/behaviour-preserving/i);
        // Must state the module is imported back and call sites stay unchanged.
        expect(descLine.toLowerCase()).toContain('import');
        expect(descLine.toLowerCase()).toContain('call site');
        // No id marker — shipEntryForTodo mints and embeds that itself.
        expect(desc).not.toContain('<!-- id:');
    });

    it('surfaces an inline error and does not dismiss when the ship fails', async () => {
        shipResult = { ok: false, error: 'Inject failed — error' };
        const card = renderRefactorCard('o/r', 'My Project');
        await flush();
        const push = card.querySelector('.refactorCardPush');
        push.click();
        await flush();

        expect(shipEntryForTodo).toHaveBeenCalledTimes(1);
        expect(dismissRefactorCandidate).not.toHaveBeenCalled();
        const err = card.querySelector('.refactorCardPushError');
        expect(err).toBeTruthy();
        expect(err.textContent).toContain('Inject failed');
        // The failure is worded as a ship failure, not a push failure.
        expect(err.textContent.toLowerCase()).toContain('ship');
        // Buttons re-enabled for a retry; candidate unchanged.
        expect(push.disabled).toBe(false);
        expect(card.querySelector('.refactorCardSkip').disabled).toBe(false);
        expect(card.querySelector('.refactorCardTitle').textContent).toBe('buildMockupSecondary');
    });

    it('ignores repeat clicks while a push is in flight (no double-create)', async () => {
        let resolveShip;
        shipEntryForTodo.mockImplementationOnce(function () {
            return new Promise(function (r) { resolveShip = r; });
        });
        const card = renderRefactorCard('o/r', 'My Project');
        await flush();
        const push = card.querySelector('.refactorCardPush');
        push.click();
        await flush(1);
        // Second tap while the first is pending is a no-op.
        push.click();
        resolveShip({ ok: true, entryId: 'entry-1' });
        await flush();
        expect(addToDo).toHaveBeenCalledTimes(1);
        expect(shipEntryForTodo).toHaveBeenCalledTimes(1);
    });
});

describe('Push entry — in-flight run gate', () => {
    it('fails closed and creates nothing when the run probe errors', async () => {
        activeRunsResult = { ok: false, reason: 'network' };
        const card = renderRefactorCard('o/r', 'My Project');
        await flush();
        const push = card.querySelector('.refactorCardPush');
        push.click();
        await flush();

        // Probed, then refused before creating anything.
        expect(fetchActiveRuns).toHaveBeenCalledTimes(1);
        expect(addToDo).not.toHaveBeenCalled();
        expect(shipEntryForTodo).not.toHaveBeenCalled();
        expect(dismissRefactorCandidate).not.toHaveBeenCalled();
        const err = card.querySelector('.refactorCardPushError');
        expect(err).toBeTruthy();
        expect(err.textContent).toMatch(/in-flight run/i);
        // Buttons re-enabled; candidate still shown.
        expect(push.disabled).toBe(false);
        expect(card.querySelector('.refactorCardSkip').disabled).toBe(false);
        expect(card.querySelector('.refactorCardTitle').textContent).toBe('buildMockupSecondary');
    });

    it('blocks and creates nothing when a run is already in flight', async () => {
        activeRunsResult = { ok: true, active: true };
        const card = renderRefactorCard('o/r', 'My Project');
        await flush();
        const push = card.querySelector('.refactorCardPush');
        push.click();
        await flush();

        expect(fetchActiveRuns).toHaveBeenCalledTimes(1);
        expect(addToDo).not.toHaveBeenCalled();
        expect(shipEntryForTodo).not.toHaveBeenCalled();
        expect(dismissRefactorCandidate).not.toHaveBeenCalled();
        const err = card.querySelector('.refactorCardPushError');
        expect(err).toBeTruthy();
        expect(err.textContent).toMatch(/already in flight/i);
        expect(push.disabled).toBe(false);
        expect(card.querySelector('.refactorCardSkip').disabled).toBe(false);
    });
});
