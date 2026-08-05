import { vi } from 'vitest';

// The Structure view's Code lens fills the desktop detail column
// (`#structureView > .structureCanvasHost`) with the code viewer — the column the
// UI lens uses for the block canvas and the Code lens previously left empty.
// These tests cover the WIRING between the two modules: which path a tapped file
// row reads, that the row stays selected, that Explain is still its own action,
// that a lens switch hands the column back, and that below 1024px (no detail
// column) the rows keep their previous behaviour and no viewer is mounted.
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
import { readRepoFile } from '../src/inject.js';
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

beforeEach(async () => {
    setWidth(1280);
    mountDom();
    state.reads = [];
    state.manifests = {
        [REPO]: { ok: true, srcRoot: 'toDoList_main/src', files: ['main.js', 'ui/panel.js'] },
    };
    readRepoFile.mockClear();
    resetCodeViewer();
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

    it('Explain with Sonnet stays its own action and does not open the viewer', async () => {
        renderStructureView();
        await flush();

        rowFor('main.js').querySelector('.structureExplainBtn').click();
        await flush();

        expect(readRepoFile).not.toHaveBeenCalled();
        expect(getOpenCodeViewerFile()).toBeNull();
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

describe('Code lens — below 1024px there is no detail column', () => {
    beforeEach(() => {
        setWidth(900);
    });

    it('renders no viewer and leaves the file rows exactly as they were', async () => {
        renderStructureView();
        await flush();

        const row = rowFor('main.js');
        expect(row.getAttribute('role')).toBeNull();
        expect(row.getAttribute('tabindex')).toBeNull();
        expect(document.querySelector('.codeViewerPane')).toBeNull();
        expect(document.querySelector('.codeViewerEmpty')).toBeNull();
    });

    it('tapping a row reads nothing', async () => {
        renderStructureView();
        await flush();

        rowFor('main.js').click();
        await flush();

        expect(readRepoFile).not.toHaveBeenCalled();
        expect(getOpenCodeViewerFile()).toBeNull();
    });
});
