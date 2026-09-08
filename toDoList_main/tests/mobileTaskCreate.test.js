import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mobile quick-capture panel (mobileTaskCreate.js) — the `capture` chip on the
// blank placeholder's create strip turns ONE dictated/typed paragraph into
// SEVERAL tasks. Every module the panel leans on is mocked so each branch is
// scriptable without the Worker, Supabase, or SpeechRecognition: the Worker
// call (extractTasksFromWorker), the data model (listLogic.addEntryTodo), the
// selected-project read (activeProjectNameForViewer), and the shared mic
// (mountMicButton). The three invariants pinned here are the ones the panel
// would silently lose: it is mobile-only, a `similar_to` task is opt-in, and
// ADD performs exactly one insert per checked row into the SELECTED project.

let extractResult = { tasks: [] };
let extractError = null;
let cachedTargets = [];

const extractTasksFromWorker = vi.fn(() => (
    extractError ? Promise.reject(extractError) : Promise.resolve(extractResult)
));

vi.mock('../src/inject.js', () => ({
    showInjectToast: vi.fn(),
    extractTasksFromWorker: (...a) => extractTasksFromWorker(...a),
    getCachedTargets: () => cachedTargets,
}));

let projects = [];
let itemsByProject = {};
let targetIdByProject = {};
const addEntryTodo = vi.fn();

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        listProjectsArray: () => projects,
        listItems: (name) => itemsByProject[name],
        getProjectTargetId: (name) => targetIdByProject[name] || null,
        addEntryTodo: (...a) => addEntryTodo(...a),
    },
}));

let activeProject = '';
vi.mock('../src/runState.js', () => ({
    activeProjectNameForViewer: () => activeProject,
}));

let dictating = false;
const stopDictation = vi.fn(() => { dictating = false; });
const mountMicButton = vi.fn(() => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'micButton captureEntryMic';
    return btn;
});

vi.mock('../src/voiceInput.js', () => ({
    mountMicButton: (...a) => mountMicButton(...a),
    isDictating: () => dictating,
    stopDictation: (...a) => stopDictation(...a),
}));

vi.mock('../src/dueDate.js', () => ({
    setRowDateOffset: vi.fn(),
    showDueDatePopover: vi.fn(),
}));

vi.mock('../src/entryParse.js', () => ({
    parsePastedEntry: vi.fn(() => ({ title: '', description: '', hasMarker: false })),
}));

vi.mock('../src/todoMdViewer.js', () => ({
    refreshViewerExpandedHeight: vi.fn(),
}));

import {
    attachMobileCreateChips,
    resetMobileCreateSession,
} from '../src/mobileTaskCreate.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

const originalWidth = window.innerWidth;

function setWidth(px) {
    Object.defineProperty(window, 'innerWidth', { value: px, configurable: true });
}

// A blank placeholder row shaped like the one buildToDoRow hands to
// attachMobileCreateChips: an empty #toDoInput plus the #descToggle the + ¶
// chip drives. Mounted first so the chip row inserts as its sibling straight
// away rather than deferring to focus.
function makeBlankRow() {
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = { tit: '', desc: '', due: '' };

    const input = document.createElement('input');
    input.id = 'toDoInput';
    row.appendChild(input);

    const descToggle = document.createElement('div');
    descToggle.id = 'descToggle';
    row.appendChild(descToggle);

    document.body.appendChild(row);
    return row;
}

function chipsFor(row) {
    const sib = row.nextElementSibling;
    return sib && sib.id === 'createChipRow' ? sib : null;
}

function captureChipFor(row) {
    const chips = chipsFor(row);
    return chips ? chips.querySelector('#createCaptureChip') : null;
}

function panelFor() {
    return document.getElementById('captureEntryPanel');
}

function actionByText(panel, text) {
    const buttons = panel.querySelectorAll('.pasteEntryBtn');
    for (let i = 0; i < buttons.length; i++) {
        if (buttons[i].textContent === text) return buttons[i];
    }
    return null;
}

// Open the panel on a fresh mobile row and type `text` into its textarea.
function openPanelWith(text) {
    const row = makeBlankRow();
    attachMobileCreateChips(row, row.__item);
    const chip = captureChipFor(row);
    chip.click();
    const panel = panelFor();
    const textarea = panel.querySelector('.captureEntryInput');
    textarea.value = text;
    textarea.dispatchEvent(new Event('input'));
    return { row, chip, panel, textarea };
}

beforeEach(() => {
    resetMobileCreateSession();
    document.body.innerHTML = '';
    setWidth(390);
    extractResult = { tasks: [] };
    extractError = null;
    cachedTargets = [];
    projects = ['Inbox', 'Side quests'];
    itemsByProject = { Inbox: [], 'Side quests': [] };
    targetIdByProject = {};
    activeProject = 'Inbox';
    dictating = false;
    extractTasksFromWorker.mockClear();
    addEntryTodo.mockClear();
    stopDictation.mockClear();
    mountMicButton.mockClear();
});

afterEach(() => {
    setWidth(originalWidth);
});


describe('quick-capture chip — mobile gating', () => {

    it('mounts the capture chip on the create strip below 1024px', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        expect(captureChipFor(row)).not.toBeNull();
    });

    it('omits the chip — and therefore the panel — at desktop widths', () => {
        setWidth(1280);
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        expect(captureChipFor(row)).toBeNull();
        expect(panelFor()).toBeNull();
    });

    it('keeps the description toggle at the strip’s trailing edge', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        const chips = chipsFor(row);
        expect(chips.lastElementChild.id).toBe('createDescChip');
    });

    it('never builds the strip — or the chip — on a committed row', () => {
        const row = makeBlankRow();
        row.__item.tit = 'walk dog';
        attachMobileCreateChips(row, row.__item);
        expect(chipsFor(row)).toBeNull();
    });
});


describe('quick-capture panel — compose stage', () => {

    it('opens as the row’s sibling with the project select seeded to the active project', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        captureChipFor(row).click();

        const panel = panelFor();
        expect(panel).not.toBeNull();
        // Sibling, never a descendant — the row is `overflow: clip`.
        expect(row.querySelector('#captureEntryPanel')).toBeNull();
        expect(row.getAttribute('data-capture-open')).toBe('true');

        const select = panel.querySelector('.captureEntryProject');
        expect(Array.from(select.options).map((o) => o.value))
            .toEqual(['Inbox', 'Side quests']);
        expect(select.value).toBe('Inbox');
    });

    it('mounts the shared mic review-only — no onFinal, so dictation stays in the field', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        captureChipFor(row).click();

        expect(mountMicButton).toHaveBeenCalled();
        const opts = mountMicButton.mock.calls[0][1];
        expect(opts.onFinal).toBeUndefined();
        expect(opts.overlay).toBe(true);
        expect(panelFor().querySelector('.captureEntryMic')).not.toBeNull();
    });

    it('re-tapping the chip closes the panel', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        const chip = captureChipFor(row);
        chip.click();
        expect(panelFor()).not.toBeNull();
        chip.click();
        expect(panelFor()).toBeNull();
        expect(row.hasAttribute('data-capture-open')).toBe(false);
    });

    it('EXTRACT is inert on an empty transcript', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        captureChipFor(row).click();
        actionByText(panelFor(), 'EXTRACT').click();
        expect(extractTasksFromWorker).not.toHaveBeenCalled();
        expect(panelFor()).not.toBeNull();
    });

    it('sends the transcript, the target project’s repo, and its open titles', async () => {
        targetIdByProject.Inbox = 'tgt-1';
        cachedTargets = [{ id: 'tgt-1', repo: 'rsterenchak/toDoList_TOP' }];
        itemsByProject.Inbox = [
            { tit: '', completed: false },
            { tit: 'call the vet', completed: false },
            { tit: 'already done', completed: true },
        ];
        const { panel } = openPanelWith('call the vet and book a flight');
        actionByText(panel, 'EXTRACT').click();
        await tick();

        expect(extractTasksFromWorker).toHaveBeenCalledTimes(1);
        expect(extractTasksFromWorker.mock.calls[0]).toEqual([
            'Inbox',
            'rsterenchak/toDoList_TOP',
            'call the vet and book a flight',
            ['call the vet'],
        ]);
    });

    it('sends a null repo when the project routes to no inject target', async () => {
        const { panel } = openPanelWith('two things happened');
        actionByText(panel, 'EXTRACT').click();
        await tick();
        expect(extractTasksFromWorker.mock.calls[0][1]).toBeNull();
    });

    it('stops a live dictation before reading the transcript', async () => {
        dictating = true;
        const { panel } = openPanelWith('one thing, then another');
        actionByText(panel, 'EXTRACT').click();
        expect(stopDictation).toHaveBeenCalled();
        await tick();
        expect(extractTasksFromWorker.mock.calls[0][2]).toBe('one thing, then another');
    });

    it('keeps the transcript and shows an inline error when the Worker fails', async () => {
        extractError = new Error('Server error 502');
        const { panel } = openPanelWith('a paragraph');
        actionByText(panel, 'EXTRACT').click();
        await tick();

        const error = panel.querySelector('.captureEntryError');
        expect(error.hidden).toBe(false);
        expect(error.textContent).toBe('Server error 502');
        expect(panel.querySelector('.captureEntryInput').value).toBe('a paragraph');
        // The button is usable again so the same transcript can be retried.
        expect(actionByText(panel, 'EXTRACT').disabled).toBe(false);
    });

    it('reports an empty extraction inline rather than opening an empty review', async () => {
        extractResult = { tasks: [] };
        const { panel } = openPanelWith('mmm');
        actionByText(panel, 'EXTRACT').click();
        await tick();
        expect(panel.querySelector('.captureReviewList')).toBeNull();
        expect(panel.querySelector('.captureEntryError').hidden).toBe(false);
    });
});


describe('quick-capture panel — review stage', () => {

    const THREE_TASKS = {
        tasks: [
            { title: 'Call the vet', description: 'Booster shot is overdue.', source: '', similar_to: '' },
            { title: 'Book a flight', description: '', source: '', similar_to: '' },
            { title: 'Renew passport', description: '', source: '', similar_to: 'Renew the passport' },
        ],
    };

    async function openReview(text) {
        extractResult = THREE_TASKS;
        const opened = openPanelWith(text || 'three things on my mind');
        actionByText(opened.panel, 'EXTRACT').click();
        await tick();
        return opened;
    }

    it('renders one row per extracted task, checked by default', async () => {
        const { panel } = await openReview();
        const rows = panel.querySelectorAll('.captureReviewRow');
        expect(rows.length).toBe(3);
        expect(rows[0].querySelector('.captureReviewTitle').value).toBe('Call the vet');
        expect(rows[0].querySelector('.captureReviewDesc').textContent)
            .toBe('Booster shot is overdue.');
        expect(rows[0].querySelector('.captureReviewCheck').checked).toBe(true);
        expect(rows[1].querySelector('.captureReviewCheck').checked).toBe(true);
    });

    it('renders a similar_to task unchecked, marked as a dupe, and hinted', async () => {
        const { panel } = await openReview();
        const dupe = panel.querySelectorAll('.captureReviewRow')[2];
        expect(dupe.getAttribute('data-dupe')).toBe('true');
        expect(dupe.querySelector('.captureReviewCheck').checked).toBe(false);
        expect(dupe.querySelector('.captureReviewHint').textContent)
            .toContain('Renew the passport');
    });

    it('labels ADD with the checked count and follows every tick', async () => {
        const { panel } = await openReview();
        expect(actionByText(panel, 'ADD 2 TASKS')).not.toBeNull();

        const rows = panel.querySelectorAll('.captureReviewRow');
        const dupeCheck = rows[2].querySelector('.captureReviewCheck');
        dupeCheck.checked = true;
        dupeCheck.dispatchEvent(new Event('change'));
        expect(actionByText(panel, 'ADD 3 TASKS')).not.toBeNull();

        const first = rows[0].querySelector('.captureReviewCheck');
        first.checked = false;
        first.dispatchEvent(new Event('change'));
        const second = rows[1].querySelector('.captureReviewCheck');
        second.checked = false;
        second.dispatchEvent(new Event('change'));
        expect(actionByText(panel, 'ADD 1 TASK')).not.toBeNull();
    });

    it('ADD inserts one todo per checked row into the selected project, then closes', async () => {
        const { panel } = await openReview();
        panel.querySelector('.captureEntryProject').value = 'Side quests';

        actionByText(panel, 'ADD 2 TASKS').click();

        // Exactly one insert per checked row — the dupe row is skipped, and no
        // follow-up update is issued against any of them.
        expect(addEntryTodo).toHaveBeenCalledTimes(2);
        expect(addEntryTodo.mock.calls[0])
            .toEqual(['Side quests', 'Call the vet', 'Booster shot is overdue.']);
        expect(addEntryTodo.mock.calls[1]).toEqual(['Side quests', 'Book a flight', '']);
        expect(panelFor()).toBeNull();
    });

    it('commits an inline title edit rather than the extracted text', async () => {
        const { panel } = await openReview();
        const rows = panel.querySelectorAll('.captureReviewRow');
        rows[1].querySelector('.captureReviewCheck').checked = false;
        rows[0].querySelector('.captureReviewTitle').value = 'Call the vet about the booster';

        actionByText(panel, 'ADD 2 TASKS').click();
        expect(addEntryTodo).toHaveBeenCalledTimes(1);
        expect(addEntryTodo.mock.calls[0][1]).toBe('Call the vet about the booster');
    });

    it('ADD is inert with nothing ticked', async () => {
        const { panel } = await openReview();
        panel.querySelectorAll('.captureReviewCheck').forEach((c) => {
            c.checked = false;
            c.dispatchEvent(new Event('change'));
        });
        actionByText(panel, 'ADD 0 TASKS').click();
        expect(addEntryTodo).not.toHaveBeenCalled();
        expect(panelFor()).not.toBeNull();
    });

    it('BACK returns to the textarea with the transcript intact', async () => {
        const { panel } = await openReview('three things on my mind');
        actionByText(panel, 'BACK').click();

        expect(panel.querySelector('.captureReviewList')).toBeNull();
        expect(panel.querySelector('.captureEntryInput').value)
            .toBe('three things on my mind');
        expect(actionByText(panel, 'EXTRACT')).not.toBeNull();
    });

    it('re-extracts against the new project when the select changes mid-review', async () => {
        const { panel } = await openReview();
        itemsByProject['Side quests'] = [{ tit: 'ship the thing', completed: false }];

        const select = panel.querySelector('.captureEntryProject');
        select.value = 'Side quests';
        select.dispatchEvent(new Event('change'));
        await tick();

        expect(extractTasksFromWorker).toHaveBeenCalledTimes(2);
        const second = extractTasksFromWorker.mock.calls[1];
        expect(second[0]).toBe('Side quests');
        expect(second[3]).toEqual(['ship the thing']);
    });
});
