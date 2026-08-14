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
import { readRepoFile, chatWithWorker } from '../src/inject.js';
import { setStructureLens, STRUCTURE_LENS_KEY } from '../src/prefs.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

const REPO = 'rsterenchak/toDoList_TOP';
const realInnerWidth = window.innerWidth;

function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

function mountDom(name = 'My Project') {
    document.body.innerHTML =
        '<div id="structureView"></div>' +
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>';
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
    // The last-file-per-repo memory outlives a lens repaint by design, so it also
    // outlives a test — drop it so one test's open file can't reopen in the next.
    resetStructureCodeMemory();
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

    it('carries no per-row Explain button — the row is icon, name, GitHub link, complexity chip', async () => {
        renderStructureView();
        await flush();

        const row = rowFor('main.js');
        expect(row.querySelector('.structureExplainBtn')).toBeNull();
        expect(row.parentElement.querySelector('.structureExplainResult')).toBeNull();
        // Explaining a file is a control in the viewer, never a per-row button.
        // The trailing complexity chip (complexityHotspots.js) is the one control
        // the row does carry, after the GitHub glyph.
        expect(Array.from(row.children).map((c) => c.className)).toEqual([
            'structureFileIcon',
            'structureFileName',
            'structureGithubLink structureGithubLink--glyph',
            'complexityChip',
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

// A lens repaint throws the detail column's contents away, and clearing the viewer
// with them is correct — it must not report a file as open once its DOM is gone.
// Nothing reopened it afterwards, though, so the toggle silently cost the user
// their place. The file is now recorded on the way out and reopened when the Code
// lens paints again, per repo, and only until it is explicitly closed.
describe('Code lens — the open file survives a lens switch', () => {
    function lensBtn(which) {
        return Array.from(document.querySelectorAll('.structureLensBtn'))
            .find((b) => (which === 'code' ? b.dataset.lens === 'code' : b.dataset.lens !== 'code'));
    }

    async function switchLens(which) {
        lensBtn(which).click();
        await flush();
    }

    it('reopens the file, and its row, when the Code lens paints again', async () => {
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();

        await switchLens('ui');
        expect(getOpenCodeViewerFile()).toBeNull();

        await switchLens('code');

        expect(getOpenCodeViewerFile()).toBe('toDoList_main/src/main.js');
        expect(detailHost().querySelector('.codeViewerPane').hidden).toBe(false);
        expect(detailHost().querySelector('.codeViewerEmpty').hidden).toBe(true);
        // The reopen lands after the tree is painted, so the row on screen — not
        // the one the repaint replaced — carries the selection.
        expect(rowFor('main.js').classList.contains('structureFileRow--selected')).toBe(true);
    });

    it('leaves the column empty when the lens switch was made with no file open', async () => {
        renderStructureView();
        await flush();

        await switchLens('ui');
        await switchLens('code');

        expect(getOpenCodeViewerFile()).toBeNull();
        expect(detailHost().querySelector('.codeViewerEmpty').hidden).toBe(false);
        expect(readRepoFile).not.toHaveBeenCalled();
    });

    it('forgets a file that was explicitly closed, so the column comes back empty', async () => {
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();
        detailHost().querySelector('.codeViewerClose').click();

        await switchLens('ui');
        await switchLens('code');

        expect(getOpenCodeViewerFile()).toBeNull();
        expect(detailHost().querySelector('.codeViewerEmpty').hidden).toBe(false);
    });

    it('reopens the last file, not the first', async () => {
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();
        rowFor('ui/panel.js').click();
        await flush();

        await switchLens('ui');
        await switchLens('code');

        expect(getOpenCodeViewerFile()).toBe('toDoList_main/src/ui/panel.js');
    });

    it('does not carry a file across a repo switch', async () => {
        const OTHER_REPO = 'rsterenchak/matchingGame-test';
        state.projectRepos.Game = OTHER_REPO;
        state.manifests[OTHER_REPO] = { ok: true, srcRoot: 'src', files: ['game.js'] };

        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();

        mountDom('Game');
        state.reads = [];
        renderStructureView();
        await flush();

        // The other repo has no remembered file of its own, and this one's must not
        // stand in for it — the path wouldn't even exist in that tree. Asserted on
        // the column rather than getOpenCodeViewerFile(), which still names the
        // prior repo's file here: a project switch rebuilds the host, so the clear
        // that would have dropped it runs against the new one. That stale report
        // predates the reopen and is not what this covers.
        expect(detailHost().querySelector('.codeViewerEmpty').hidden).toBe(false);
        expect(detailHost().querySelector('.codeViewerPane').hidden).toBe(true);
        expect(state.reads).toEqual([]);

        // Coming back does restore it: the memory is per repo, not shared. Read off
        // the rebuilt column for the same reason as above.
        mountDom();
        renderStructureView();
        await flush();
        const pane = detailHost().querySelector('.codeViewerPane');
        expect(pane.hidden).toBe(false);
        expect(pane.querySelector('.codeViewerPath').textContent).toBe('toDoList_main/src/main.js');
        expect(rowFor('main.js').classList.contains('structureFileRow--selected')).toBe(true);
    });

    it('does not reopen the sheet below 1024px — opening it is a deliberate gesture', async () => {
        setWidth(900);
        renderStructureView();
        await flush();
        rowFor('main.js').click();
        await flush();
        expect(sheet().hidden).toBe(false);

        await switchLens('ui');
        await switchLens('code');

        expect(sheet().hidden).toBe(true);
        expect(getOpenCodeViewerFile()).toBeNull();
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

// The Types lens's outline rows have carried a `file` and a `line` from the
// manifest all along and did nothing with them. They now jump: the same gesture
// the Code lens's file rows use, through the SAME shared opener, so the desktop
// column / mobile sheet split is decided in one place for every caller. These
// tests cover that wiring — the path read, the span highlighted, the banner, and
// the rows that deliberately do NOT jump.
describe('Types lens — an outline row jumps into the code viewer', () => {
    const OTHER = 'rsterenchak/matchingGame-test';

    // A C# manifest, but with a non-empty srcRoot so the join the Code lens's rows
    // make is exercised here too. Lines sit inside the mocked 3-line file so the
    // highlight actually lands on a rendered row. `string Name` deliberately has no
    // line — the row that must stay selection-only.
    function typesManifest() {
        return {
            ok: true,
            files: ['Greeter.cs'],
            hasDom: false,
            lens: 'types',
            srcRoot: 'src',
            types: [
                {
                    kind: 'class', name: 'Greeter', file: 'Greeter.cs', line: 2,
                    members: [
                        { signature: 'void Main', name: 'Main', line: 3 },
                        { signature: 'string Name', name: 'Name' },
                    ],
                },
            ],
        };
    }

    // Park on a neutral repo first so the render for OTHER is a clean repo change:
    // structureView holds the manifest's srcRoot/lens/types in module scope.
    async function renderTypesRepo() {
        state.projectRepos['__neutral__'] = 'rsterenchak/__neutral__';
        state.projectRepos.Game = OTHER;
        state.manifests[OTHER] = typesManifest();
        // The persisted choice is the "second slot"; a types manifest normalizes it
        // onto its own outline.
        setStructureLens('ui');
        mountDom('__neutral__');
        renderStructureView();
        await flush();

        mountDom('Game');
        renderStructureView();
        await flush();
        state.reads = [];
        readRepoFile.mockClear();
    }

    function typeRow(label) {
        return Array.from(document.querySelectorAll('.structureRegionRow')).find((r) => {
            const l = r.querySelector('.structureTypeLabel');
            return l && l.textContent === label;
        });
    }

    function paneIn(host) {
        return host.querySelector(':scope > .codeViewerPane');
    }

    function hitLines(host) {
        return Array.from(host.querySelectorAll('.codeViewerLine--hit'))
            .map((el) => el.dataset.line);
    }

    it('opens the type’s file at its srcRoot-joined path, highlighted under a banner naming it', async () => {
        await renderTypesRepo();

        typeRow('class Greeter').click();
        await flush();

        expect(state.reads).toEqual([{ repo: OTHER, filePath: 'src/Greeter.cs' }]);
        expect(getOpenCodeViewerFile()).toBe('src/Greeter.cs');

        const pane = paneIn(detailHost());
        expect(pane.hidden).toBe(false);
        expect(pane.querySelector('.codeViewerBanner').hidden).toBe(false);
        expect(pane.querySelector('.codeViewerBannerText').textContent).toBe('class Greeter');
        expect(hitLines(detailHost())).toEqual(['2']);
    });

    it('marks the clicked row selected, the way a Code lens file row is', async () => {
        await renderTypesRepo();

        const row = typeRow('class Greeter');
        row.click();
        await flush();

        expect(row.classList.contains('is-selected')).toBe(true);
        expect(row.getAttribute('aria-pressed')).toBe('true');
    });

    it('a member row jumps to its own line, not the type’s', async () => {
        await renderTypesRepo();

        typeRow('void Main').click();
        await flush();

        expect(getOpenCodeViewerFile()).toBe('src/Greeter.cs');
        expect(detailHost().querySelector('.codeViewerBannerText').textContent).toBe('void Main');
        expect(hitLines(detailHost())).toEqual(['3']);
    });

    it('opens on Enter, so the jump is reachable from the keyboard', async () => {
        await renderTypesRepo();

        typeRow('class Greeter')
            .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await flush();

        expect(getOpenCodeViewerFile()).toBe('src/Greeter.cs');
    });

    it('a row with no usable line opens nothing, but still selects its handle', async () => {
        await renderTypesRepo();

        const row = typeRow('string Name');
        row.click();
        await flush();

        // No jump: opening the file at the top would land nowhere near the member.
        expect(readRepoFile).not.toHaveBeenCalled();
        expect(getOpenCodeViewerFile()).toBeNull();
        // The row keeps its handle — Reference / Copy / Find still work from it.
        expect(row.classList.contains('is-selected')).toBe(true);
        const toolbar = document.querySelector('.structureActionToolbar');
        expect(toolbar.classList.contains('structureActionToolbar--idle')).toBe(false);
    });

    it('the banner’s dismiss drops the highlight and leaves the file open', async () => {
        await renderTypesRepo();

        typeRow('class Greeter').click();
        await flush();
        detailHost().querySelector('.codeViewerBannerDismiss').click();

        expect(detailHost().querySelector('.codeViewerBanner').hidden).toBe(true);
        expect(hitLines(detailHost())).toEqual([]);
        expect(getOpenCodeViewerFile()).toBe('src/Greeter.cs');
    });

    it('reopening after a lens switch restores the span the jump opened with', async () => {
        await renderTypesRepo();

        typeRow('class Greeter').click();
        await flush();

        // Types → Code repaints the column; the Code lens's paint reopens the file.
        Array.from(document.querySelectorAll('.structureLensBtn'))
            .find((b) => b.dataset.lens === 'code').click();
        await flush();

        expect(getOpenCodeViewerFile()).toBe('src/Greeter.cs');
        expect(detailHost().querySelector('.codeViewerBannerText').textContent).toBe('class Greeter');
        expect(hitLines(detailHost())).toEqual(['2']);
    });

    it('a dismissed highlight does not come back with the file', async () => {
        await renderTypesRepo();

        typeRow('class Greeter').click();
        await flush();
        detailHost().querySelector('.codeViewerBannerDismiss').click();

        Array.from(document.querySelectorAll('.structureLensBtn'))
            .find((b) => b.dataset.lens === 'code').click();
        await flush();

        expect(getOpenCodeViewerFile()).toBe('src/Greeter.cs');
        expect(detailHost().querySelector('.codeViewerBanner').hidden).toBe(true);
        expect(hitLines(detailHost())).toEqual([]);
    });

    it('below 1024px the jump opens the sheet instead of the detail column', async () => {
        setWidth(900);
        await renderTypesRepo();

        typeRow('class Greeter').click();
        await flush();

        expect(sheet().hidden).toBe(false);
        const pane = paneIn(sheetHost());
        expect(pane.hidden).toBe(false);
        expect(pane.querySelector('.codeViewerPath').textContent).toBe('src/Greeter.cs');
        expect(pane.querySelector('.codeViewerBannerText').textContent).toBe('class Greeter');
        expect(hitLines(sheetHost())).toEqual(['2']);
        expect(detailHost().querySelector('.codeViewerPane')).toBeNull();
    });
});
