import { vi } from 'vitest';

// Published UI region rows have carried `file` and `line` from the manifest all
// along — the shared action toolbar even prints "Line N." as the selected
// handle's context — but nothing acted on the number. The toolbar now carries a
// "View code" action that jumps into the code viewer at that line, the same
// destination a Types-lens row reaches through the same shared opener.
//
// The action lives in the TOOLBAR rather than on the row: a region row's click
// already means "select", which is what drives the toolbar, so the jump has to
// be an explicit second action or it would steal that gesture.
//
// These tests cover the wiring — when the action shows, the path it reads, the
// span and banner it highlights under, the handles that deliberately get no
// jump, and that selecting is left alone.
const { state } = vi.hoisted(() => ({
    state: {
        projectRepos: {
            'My Project': 'rsterenchak/toDoList_TOP',
            'Game': 'rsterenchak/matchingGame-test',
        },
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
        return Promise.resolve({ ok: true, content: 'a\nb\nc\nd\ne', sha: 'sha-1' });
    }),
    // The NEXT REFACTOR card mounts inside the view; keep it inert here.
    scanRefactor: vi.fn(function () { return Promise.resolve({ ok: true, found: false }); }),
    getCachedTargets: vi.fn(function () { return []; }),
    isInjectConfigured: vi.fn(function () { return false; }),
    dispatchScan: vi.fn(function () { return Promise.resolve({ ok: true }); }),
    mintEntryId: vi.fn(function () { return 'corr-test'; }),
}));

// `pagesUrlFor` keeps its real behavior — the canvas's Live chip is gated on it
// resolving, so stubbing it away would silently drop the chip from these renders.
vi.mock('../src/structureRemoteCapture.js', () => ({
    captureRemote: vi.fn(function () { return Promise.resolve({ ok: true, passes: 2 }); }),
    pagesUrlFor: vi.fn(function (repo) {
        const parts = String(repo || '').split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
        return 'https://' + parts[0] + '.github.io/' + parts[1] + '/';
    }),
}));

import { renderStructureView, resetStructureCodeMemory } from '../src/structureView.js';
import { getOpenCodeViewerFile, resetCodeViewer } from '../src/codeViewer.js';
import { readRepoFile } from '../src/inject.js';
import { setStructureLens, STRUCTURE_LENS_KEY } from '../src/prefs.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

const OTHER = 'rsterenchak/matchingGame-test';
const realInnerWidth = window.innerWidth;

function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

function mountDom(name) {
    const projectRow = name
        ? '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>'
        : '';
    document.body.innerHTML = '<div id="structureView"></div>' + projectRow;
}

// The live map walks the real DOM, so the running repo's project needs regions
// on the page to walk.
function mountLiveDom() {
    document.body.innerHTML =
        '<div id="structureView"></div>' +
        '<div class="selectedProject"><input id="projInput" value="My Project"></div>' +
        '<main id="mainPanel" data-region="Tasks"><ul id="taskList"><li>a</li></ul></main>';
}

const toolbar = () => document.querySelector('.structureActionToolbar');
const viewCodeBtn = () => toolbar().querySelector('.structureViewCodeBtn');
const detailHost = () => document.querySelector('#structureView > .structureCanvasHost');

function regionRow(selector) {
    return Array.from(document.querySelectorAll('.structureRegionRow')).find(
        (r) => r.querySelector('.structureRegionSelector') &&
            r.querySelector('.structureRegionSelector').textContent === selector
    );
}

function hitLines(host) {
    return Array.from(host.querySelectorAll('.codeViewerLine--hit')).map((el) => el.dataset.line);
}

// Render the published map for the non-running repo. Parks on a project with no
// repo first so the module-scoped selection from a prior test is cleared rather
// than re-applied onto the fresh tree.
async function renderPublished(regions, srcRoot = 'pkg/src') {
    mountDom('');
    renderStructureView();
    await flush();

    state.manifests[OTHER] = {
        ok: true,
        files: ['app.js'],
        hasDom: true,
        srcRoot: srcRoot,
        regions: regions,
    };
    mountDom('Game');
    renderStructureView();
    await flush();
    state.reads = [];
    readRepoFile.mockClear();
}

const BOARD = { selector: '#board', label: 'Board', file: 'app.js', line: 4, files: [{ file: 'app.js', line: 4 }] };

beforeEach(() => {
    setWidth(1280);
    state.runningRepo = 'rsterenchak/toDoList_TOP';
    state.manifests = {
        'rsterenchak/toDoList_TOP': { ok: true, srcRoot: 'toDoList_main/src', files: ['main.js'] },
    };
    state.reads = [];
    resetCodeViewer();
    resetStructureCodeMemory();
    try { localStorage.removeItem(STRUCTURE_LENS_KEY); } catch (e) { /* ignore */ }
    setStructureLens('ui');
});

afterEach(() => {
    setWidth(realInnerWidth);
});

describe('UI lens — View code jumps a published region row to its defining line', () => {
    it('mounts the action beside Reference / Copy, ahead of Find in code', async () => {
        await renderPublished([BOARD]);
        regionRow('#board').click();

        const order = Array.from(toolbar().querySelector('.structureActionToolbarActions').children)
            .map((el) => el.className);
        expect(order).toEqual([
            'structureReferenceBtn',
            'structureCopyBtn',
            'structureViewCodeBtn',
            'structureFindBtn',
            'structureGithubLink',
        ]);
        expect(viewCodeBtn().textContent).toBe('View code');
        expect(viewCodeBtn().hidden).toBe(false);
    });

    it('opens the region’s file at its srcRoot-joined path, highlighted under a banner naming it', async () => {
        await renderPublished([BOARD]);
        regionRow('#board').click();
        viewCodeBtn().click();
        await flush();

        expect(state.reads).toEqual([{ repo: OTHER, filePath: 'pkg/src/app.js' }]);
        expect(getOpenCodeViewerFile()).toBe('pkg/src/app.js');

        const pane = detailHost().querySelector(':scope > .codeViewerPane');
        expect(pane.hidden).toBe(false);
        expect(pane.querySelector('.codeViewerBanner').hidden).toBe(false);
        expect(pane.querySelector('.codeViewerBannerText').textContent).toBe('Board');
    });

    // A region is a point, not a span: both ends of the highlight are its line, so
    // exactly one row lights up.
    it('highlights the single line rather than a span', async () => {
        await renderPublished([BOARD]);
        regionRow('#board').click();
        viewCodeBtn().click();
        await flush();

        expect(hitLines(detailHost())).toEqual(['4']);
    });

    it('leaves the row selected and the toolbar up, so a second region can be inspected', async () => {
        await renderPublished([
            BOARD,
            { selector: '.card', label: 'Card', file: 'app.js', line: 2, files: [{ file: 'app.js', line: 2 }] },
        ]);
        const row = regionRow('#board');
        row.click();
        viewCodeBtn().click();
        await flush();

        expect(row.classList.contains('is-selected')).toBe(true);
        expect(row.getAttribute('aria-pressed')).toBe('true');
        expect(toolbar().classList.contains('structureActionToolbar--idle')).toBe(false);
        expect(viewCodeBtn().hidden).toBe(false);

        // The second region is reachable without reselecting the first.
        regionRow('.card').click();
        viewCodeBtn().click();
        await flush();
        expect(detailHost().querySelector('.codeViewerBannerText').textContent).toBe('Card');
        expect(hitLines(detailHost())).toEqual(['2']);
    });

    // Selection is what drives the toolbar, so the row's own gesture must not have
    // gained a second meaning.
    it('does not change what clicking the row does — selecting still opens nothing', async () => {
        await renderPublished([BOARD]);
        regionRow('#board').click();
        await flush();

        expect(state.reads).toEqual([]);
        expect(getOpenCodeViewerFile()).toBe(null);
    });

    it('below 1024px the jump opens in the full-screen sheet instead of the detail column', async () => {
        setWidth(800);
        await renderPublished([BOARD]);
        regionRow('#board').click();
        viewCodeBtn().click();
        await flush();

        const host = document.querySelector('#structureCodeSheet .structureCodeSheetHost');
        expect(host).toBeTruthy();
        expect(document.getElementById('structureCodeSheet').hidden).toBe(false);
        expect(host.querySelector('.codeViewerBannerText').textContent).toBe('Board');
    });
});

describe('UI lens — handles with no recorded line keep today’s toolbar', () => {
    // The context line and the action read the SAME test, so they can never
    // disagree about a handle: "Line not recorded." always means no jump.
    it('hides the action for a region whose line is missing, matching its context line', async () => {
        await renderPublished([
            { selector: '#board', label: 'Board', file: 'app.js', files: [{ file: 'app.js' }] },
        ]);
        regionRow('#board').click();

        expect(toolbar().querySelector('.structureActionToolbarContext').textContent)
            .toBe('#board · Line not recorded.');
        expect(viewCodeBtn().hidden).toBe(true);
    });

    it('hides the action for a line of 0, which would land at the top of the file', async () => {
        await renderPublished([
            { selector: '#board', label: 'Board', file: 'app.js', line: 0, files: [{ file: 'app.js', line: 0 }] },
        ]);
        regionRow('#board').click();

        expect(viewCodeBtn().hidden).toBe(true);
    });

    it('hides the action for a region with a line but no file', async () => {
        await renderPublished([
            { selector: '#board', label: 'Board', line: 4, files: [] },
        ]);
        regionRow('#board').click();

        expect(viewCodeBtn().hidden).toBe(true);
    });

    it('a hidden action does not open anything when activated', async () => {
        await renderPublished([
            { selector: '#board', label: 'Board', file: 'app.js', files: [{ file: 'app.js' }] },
        ]);
        regionRow('#board').click();
        viewCodeBtn().click();
        await flush();

        expect(state.reads).toEqual([]);
        expect(getOpenCodeViewerFile()).toBe(null);
    });

    // Live regions are measured from the running DOM, so they carry no file/line
    // at all — the guard hides the action there without a second condition.
    it('hides the action for a live-map region', async () => {
        mountLiveDom();
        renderStructureView();
        await flush();

        regionRow('#taskList').click();
        expect(toolbar().classList.contains('structureActionToolbar--idle')).toBe(false);
        expect(viewCodeBtn().hidden).toBe(true);
        // Reference and Copy are untouched — the toolbar reads as it did before.
        expect(toolbar().querySelector('.structureReferenceBtn')).toBeTruthy();
        expect(toolbar().querySelector('.structureCopyBtn')).toBeTruthy();
    });
});
