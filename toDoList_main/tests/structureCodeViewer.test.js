import { vi } from 'vitest';

// The Structure view's Code lens fills the desktop detail column
// (`#structureView > .structureCanvasHost`) with the code viewer — the column the
// UI lens uses for the block canvas and the Code lens previously left empty.
// These tests cover the WIRING between the two modules: which path a tapped file
// row reads, that the row stays selected, that a lens switch hands the column
// back, and that below 1024px — where there is no detail column — the same pane
// opens in a full-screen sheet instead.
//
// codeViewer.js's own behaviour — windowing, chunk loading, highlighting — is
// covered in codeViewer.test.js; here it is exercised through structureView.
const { state } = vi.hoisted(() => ({
    state: {
        projectRepos: { 'My Project': 'rsterenchak/toDoList_TOP' },
        runningRepo: 'rsterenchak/toDoList_TOP',
        manifests: {},
        reads: [],
    },
}));

vi.mock('../src/claudeSheet.js', () => ({
    loadManifest: vi.fn(function (repo) {
        return Promise.resolve(state.manifests[repo] || { ok: false, files: [] });
    }),
    getRunningAppRepo: vi.fn(function () { return state.runningRepo; }),
    setChatWorkspaceRepo: vi.fn(),
    insertReference: vi.fn(),
}));

vi.mock('../src/seedTasksModal.js', () => ({
    resolveProjectRepo: vi.fn(function (name) {
        return Object.prototype.hasOwnProperty.call(state.projectRepos, name)
            ? state.projectRepos[name]
            : null;
    }),
}));

vi.mock('../src/inject.js', () => ({
    chatWithWorker: vi.fn(function () { return Promise.resolve({ reply: 'ok' }); }),
    readRepoFile: vi.fn(function (target, filePath) {
        state.reads.push({ repo: target && target.repo, filePath });
        return Promise.resolve({ ok: true, content: 'a\nb\nc', sha: 'sha-1' });
    }),
    // The NEXT REFACTOR card mounts inside the view; keep it inert here.
    scanRefactor: vi.fn(function () { return Promise.resolve({ ok: true, found: false }); }),
    getCachedTargets: vi.fn(function () { return []; }),
    isInjectConfigured: vi.fn(function () { return false; }),
    dispatchScan: vi.fn(function () { return Promise.resolve({ ok: true }); }),
    mintEntryId: vi.fn(function () { return 'corr-test'; }),
}));

vi.mock('../src/structureRemoteCapture.js', () => ({
    captureRemote: vi.fn(function () { return Promise.resolve({ ok: true, passes: 2 }); }),
}));

import { renderStructureView } from '../src/structureView.js';
import { getOpenCodeViewerFile, resetCodeViewer } from '../src/codeViewer.js';
import { readRepoFile, chatWithWorker } from '../src/inject.js';
import { setStructureLens, STRUCTURE_LENS_KEY } from '../src/prefs.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

const REPO = 'rsterenchak/toDoList_TOP';
const realInnerWidth = window.innerWidth;

function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

function mountDom() {
    document.body.innerHTML =
        '<div id="structureView"></div>' +
        '<div class="selectedProject"><input id="projInput" value="My Project"></div>';
}

function fileRows() {
    return Array.from(document.querySelectorAll('.structureFileWrap'));
}

function rowFor(path) {
    const wrap = fileRows().find((w) => w.dataset.structureFile === path);
    return wrap ? wrap.querySelector('.structureFileRow') : null;
}

function detailHost() {
    return document.querySelector('#structureView > .structureCanvasHost');
}

function sheet() {
    return document.getElementById('structureCodeSheet');
}

function sheetHost() {
    return document.querySelector('#structureCodeSheet .structureCodeSheetHost');
}

beforeEach(async () => {
    setWidth(1280);
    mountDom();
    state.reads = [];
    state.manifests = {
        [REPO]: { ok: true, srcRoot: 'toDoList_main/src', files: ['main.js', 'ui/panel.js'] },
    };
    readRepoFile.mockClear();
    chatWithWorker.mockClear();
    resetCodeViewer();
    // The explanation cache is keyed repo+path+sha, so a leftover entry would let
    // a later Explain resolve without ever calling the Worker.
    try { localStorage.removeItem('todoapp_structureExplain'); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(STRUCTURE_LENS_KEY); } catch (e) { /* ignore */ }
    setStructureLens('code');
});

afterEach(() => {
    setWidth(realInnerWidth);
});

describe('Code lens — the detail column hosts the code viewer', () => {
    it('mounts the viewer’s empty state in the detail column before any file is opened', async () => {
        renderStructureView();
        await flush();

        const empty = detailHost().querySelector(':scope > .codeViewerEmpty');
        expect(empty).toBeTruthy();
        expect(empty.hidden).toBe(false);
        expect(detailHost().querySelector('.codeViewerPane').hidden).toBe(true);
        expect(readRepoFile).not.toHaveBeenCalled();
    });

    it('tapping a file row reads it at its srcRoot-joined repo-relative path', async () => {
        renderStructureView();
        await flush();

        rowFor('ui/panel.js').click();
        await flush();

        // The manifest names files relative to its srcRoot; the Worker's read
        // route wants the full repo-relative path.
        expect(state.reads).toEqual([
            { repo: REPO, filePath: 'toDoList_main/src/ui/panel.js' },
        ]);
        expect(getOpenCodeViewerFile()).toBe('toDoList_main/src/ui/panel.js');
    });

    it('renders the file’s source into the detail column', async () => {
        renderStructureView();
        await flush();

        rowFor('main.js').click();
        await flush();

        const pane = detailHost().querySelector(':scope > .codeViewerPane');
        expect(pane.hidden).toBe(false);
        expect(detailHost().querySelector('.codeViewerEmpty').hidden).toBe(true);
        expect(pane.querySelector('.codeViewerPath').textContent)
            .toBe('toDoList_main/src/main.js');
        expect(Array.from(pane.querySelectorAll('.codeViewerCode')).map((n) => n.textContent))
            .toEqual(['a', 'b', 'c']);
    });

    it('keeps the tapped row selected, and moves the selection to the next tap', async () => {
        renderStructureView();
        await flush();

        rowFor('main.js').click();
        await flush();
        expect(rowFor('main.js').classList.contains('structureFileRow--selected')).toBe(true);
        expect(rowFor('main.js').getAttribute('aria-pressed')).toBe('true');
        expect(rowFor('ui/panel.js').classList.contains('structureFileRow--selected')).toBe(false);

        rowFor('ui/panel.js').click();
        await flush();
        expect(rowFor('main.js').classList.contains('structureFileRow--selected')).toBe(false);
        expect(rowFor('ui/panel.js').classList.contains('structureFileRow--selected')).toBe(true);
    });

    it('closing the viewer clears the row selection and empties the column', async () => {
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();

        detailHost().querySelector('.codeViewerClose').click();

        expect(rowFor('main.js').classList.contains('structureFileRow--selected')).toBe(false);
        expect(rowFor('main.js').getAttribute('aria-pressed')).toBe('false');
        expect(detailHost().querySelector('.codeViewerEmpty').hidden).toBe(false);
        expect(getOpenCodeViewerFile()).toBeNull();
    });

    it('opens on Enter and Space, so the row is reachable from the keyboard', async () => {
        renderStructureView();
        await flush();

        const row = rowFor('main.js');
        expect(row.getAttribute('role')).toBe('button');
        expect(row.getAttribute('tabindex')).toBe('0');
        row.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await flush();

        expect(getOpenCodeViewerFile()).toBe('toDoList_main/src/main.js');
    });

    it('carries no per-row Explain button — the row is icon, name, GitHub link', async () => {
        renderStructureView();
        await flush();

        const row = rowFor('main.js');
        expect(row.querySelector('.structureExplainBtn')).toBeNull();
        expect(row.parentElement.querySelector('.structureExplainResult')).toBeNull();
        expect(Array.from(row.children).map((c) => c.className)).toEqual([
            'structureFileIcon',
            'structureFileName',
            'structureGithubLink structureGithubLink--glyph',
        ]);
    });

    it('switching to the other lens hands the column back and closes the viewer', async () => {
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();
        expect(getOpenCodeViewerFile()).toBe('toDoList_main/src/main.js');

        const uiBtn = Array.from(document.querySelectorAll('.structureLensBtn'))
            .find((b) => b.dataset.lens !== 'code');
        uiBtn.click();
        await flush();

        expect(getOpenCodeViewerFile()).toBeNull();
        expect(detailHost().querySelector('.codeViewerPane')).toBeNull();
    });
});

// Explain moved off the ~80 per-file rows and onto one control in the viewer,
// acting on the open file. structureView still does the explaining (the cache is
// keyed by the manifest SHA it owns) and registers itself as the viewer's handler,
// so these tests exercise that registration end to end.
describe('Code lens — Explain lives in the viewer', () => {
    function explainBtn() {
        return detailHost().querySelector('.codeViewerExplain');
    }
    function explanation() {
        return detailHost().querySelector('.codeViewerExplanation');
    }

    it('is disabled while the column is empty and enabled once a file opens', async () => {
        renderStructureView();
        await flush();
        expect(explainBtn().disabled).toBe(true);

        rowFor('main.js').click();
        await flush();
        expect(explainBtn().disabled).toBe(false);

        detailHost().querySelector('.codeViewerClose').click();
        expect(explainBtn().disabled).toBe(true);
    });

    it('renders the reply in a block above the code body, not over it', async () => {
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();

        expect(explanation().hidden).toBe(true);
        explainBtn().click();
        await flush();

        expect(explanation().hidden).toBe(false);
        expect(explanation().querySelector('.structureExplainText').textContent).toBe('ok');
        // Source order is what makes it push the code down rather than overlay it.
        const pane = detailHost().querySelector('.codeViewerPane');
        const kids = Array.from(pane.children).map((c) => c.className);
        expect(kids.indexOf('codeViewerExplanation'))
            .toBeLessThan(kids.indexOf('codeViewerBody'));
    });

    // The viewer holds repo-relative paths, but the explanation cache has always
    // been keyed by the manifest-relative name — so the wiring undoes the srcRoot
    // join and entries written before Explain moved here still hit.
    it('asks about the open file at its manifest-relative path, as the cache expects', async () => {
        renderStructureView();
        await flush();
        rowFor('ui/panel.js').click();
        await flush();
        explainBtn().click();
        await flush();

        const [messages, , attach, repo] = chatWithWorker.mock.calls[0];
        expect(messages[0].content).toContain('`ui/panel.js`');
        expect(attach).toEqual(['ui/panel.js']);
        expect(repo).toBe(REPO);
    });

    it('serves a cache hit written before the control moved, with no Worker call', async () => {
        // Caching is keyed by the manifest's commit sha, so it needs one.
        state.manifests[REPO].sha = 'sha-1';
        localStorage.setItem('todoapp_structureExplain', JSON.stringify({
            order: [REPO + ':main.js:sha-1'],
            map: { [REPO + ':main.js:sha-1']: 'cached summary' },
        }));
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();

        explainBtn().click();
        await flush();

        expect(chatWithWorker).not.toHaveBeenCalled();
        expect(explanation().querySelector('.structureExplainText').textContent)
            .toBe('cached summary');
    });

    it('collapses on the chevron and expands again', async () => {
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();
        explainBtn().click();
        await flush();

        const toggle = explanation().querySelector('.codeViewerExplanationToggle');
        const body = () => explanation().querySelector('.codeViewerExplanationBody');
        expect(body().hidden).toBe(false);

        toggle.click();
        expect(body().hidden).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        toggle.click();
        expect(body().hidden).toBe(false);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    it('opening a different file clears the explanation', async () => {
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();
        explainBtn().click();
        await flush();
        expect(explanation().hidden).toBe(false);

        rowFor('ui/panel.js').click();
        await flush();

        expect(explanation().hidden).toBe(true);
        expect(explanation().querySelector('.structureExplainText')).toBeNull();
    });

    it('a reply that lands after the user moved on does not paint over the new file', async () => {
        let settle;
        chatWithWorker.mockImplementationOnce(function () {
            return new Promise((r) => { settle = r; });
        });
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();
        explainBtn().click();
        await flush();

        rowFor('ui/panel.js').click();
        await flush();
        settle({ reply: 'stale summary' });
        await flush();

        expect(explanation().hidden).toBe(true);
        expect(detailHost().textContent).not.toContain('stale summary');
    });
});

describe('Code lens — below 1024px the viewer opens in a full-screen sheet', () => {
    beforeEach(() => {
        setWidth(900);
    });

    it('keeps the row a control, since there is now somewhere for it to open into', async () => {
        renderStructureView();
        await flush();

        const row = rowFor('main.js');
        expect(row.getAttribute('role')).toBe('button');
        expect(row.getAttribute('tabindex')).toBe('0');
        // Nothing opened yet, so no sheet is showing.
        expect(sheet() === null || sheet().hidden).toBe(true);
    });

    it('tapping a row reads the file and reveals the sheet around the same pane', async () => {
        renderStructureView();
        await flush();

        rowFor('main.js').click();
        await flush();

        expect(state.reads).toEqual([
            { repo: REPO, filePath: 'toDoList_main/src/main.js' },
        ]);
        expect(sheet().hidden).toBe(false);
        const pane = sheetHost().querySelector(':scope > .codeViewerPane');
        expect(pane.hidden).toBe(false);
        expect(pane.querySelector('.codeViewerPath').textContent)
            .toBe('toDoList_main/src/main.js');
        // The same chrome the detail column gets, not a reduced mobile variant.
        expect(pane.querySelector('.codeViewerExplain')).toBeTruthy();
        expect(pane.querySelector('.codeViewerBanner')).toBeTruthy();
        expect(pane.querySelectorAll('.codeViewerMore').length).toBe(2);
    });

    it('does not mount a viewer into the (hidden) detail column', async () => {
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();

        expect(detailHost().querySelector('.codeViewerPane')).toBeNull();
    });

    it('the pane’s close dismisses the sheet and leaves the row selected', async () => {
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();

        sheetHost().querySelector('.codeViewerClose').click();

        expect(sheet().hidden).toBe(true);
        // Closing the sheet returns to the tree — the file stays open, so the row
        // that opened it is still marked.
        expect(getOpenCodeViewerFile()).toBe('toDoList_main/src/main.js');
        expect(rowFor('main.js').classList.contains('structureFileRow--selected')).toBe(true);
    });

    it('closes on a backdrop tap and on Escape', async () => {
        renderStructureView();
        await flush();

        rowFor('main.js').click();
        await flush();
        sheet().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        expect(sheet().hidden).toBe(true);

        rowFor('main.js').click();
        await flush();
        expect(sheet().hidden).toBe(false);
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(sheet().hidden).toBe(true);
    });

    it('a lens switch drops the sheet and what it was showing', async () => {
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();

        const uiBtn = Array.from(document.querySelectorAll('.structureLensBtn'))
            .find((b) => b.dataset.lens !== 'code');
        uiBtn.click();
        await flush();

        expect(sheet().hidden).toBe(true);
        expect(getOpenCodeViewerFile()).toBeNull();
    });
});
