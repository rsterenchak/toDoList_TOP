import { vi } from 'vitest';

// The Structure tab's shared selection toolbar speaks selector vocabulary — it
// was built for the UI lens, where a handle is a CSS selector resolved through
// the build-time region index into a list of owner FILES. A Types-lens row is a
// different thing: the C# manifest records the exact declaration site (`file` +
// `line`) of every type and member, so there is nothing to search for and no
// list to choose from.
//
// So the two actions adapt to the lens:
//   • Copy reads "Copy name" and writes the bare identifier — a member copies
//     its own name, never a dotted path.
//   • Find in code JUMPS: switch to the Code lens, flash the defining file's
//     row, and open the viewer on the declaration line under a
//     "<Name> · declaration" banner (member rows qualified by their type).
//
// These tests cover the jump's destination, its banner, the srcRoot join, the
// guard for an older manifest with no recorded line, and that the UI lens's own
// Find — the owner-file result list — is untouched.
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
    // Long enough that every declaration line these fixtures name (5, 9, 12, 44)
    // exists in the source — a highlight past the end of the file lights nothing.
    readRepoFile: vi.fn(function (target, filePath) {
        state.reads.push({ repo: target && target.repo, filePath });
        const lines = [];
        for (let n = 1; n <= 60; n++) lines.push('line ' + n);
        return Promise.resolve({ ok: true, content: lines.join('\n'), sha: 'sha-1' });
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

import { renderStructureView, resetStructureCodeMemory } from '../src/structureView.js';
import { getOpenCodeViewerFile, resetCodeViewer } from '../src/codeViewer.js';
import { setStructureLens, STRUCTURE_LENS_KEY, STRUCTURE_TREE_KEY } from '../src/prefs.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) { for (let i = 0; i < n; i++) await tick(); }

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

const toolbar = () => document.querySelector('.structureActionToolbar');
const findBtn = () => toolbar().querySelector('.structureFindBtn');
const detailHost = () => document.querySelector('#structureView > .structureCanvasHost');
const bannerText = (host) => {
    const el = host.querySelector('.codeViewerBannerText');
    return el ? el.textContent : null;
};
const hitLines = (host) =>
    Array.from(host.querySelectorAll('.codeViewerLine--hit')).map((el) => el.dataset.line);

// Find an outline row by its rendered label (`class BinarySearchTree`,
// `Insert(int value)`).
function typeRow(label) {
    return Array.from(document.querySelectorAll('.structureRegionRow')).find((r) => {
        const l = r.querySelector('.structureTypeLabel');
        return l && l.textContent === label;
    });
}

const BST = {
    kind: 'class', name: 'BinarySearchTree', file: 'LinearSearch/BST.cs', line: 5,
    members: [
        { signature: 'Insert(int value)', name: 'Insert', line: 12 },
        { signature: 'Count : int', name: 'Count', line: 30 },
    ],
};

// Render the Types lens for the non-running repo. Parks on a project with no
// repo first so a module-scoped selection from a prior test is cleared rather
// than re-applied onto the fresh tree.
async function renderTypes(types, srcRoot = '', files = ['LinearSearch/BST.cs']) {
    mountDom('');
    renderStructureView();
    await flush();

    state.manifests[OTHER] = {
        ok: true, files: files, hasDom: false, lens: 'types', srcRoot: srcRoot, types: types,
    };
    mountDom('Game');
    renderStructureView();
    await flush();
    state.reads = [];
}

beforeEach(() => {
    setWidth(1280);
    state.runningRepo = 'rsterenchak/toDoList_TOP';
    state.projectRepos = {
        'My Project': 'rsterenchak/toDoList_TOP',
        'Game': 'rsterenchak/matchingGame-test',
    };
    state.manifests = {};
    state.reads = [];
    resetCodeViewer();
    resetStructureCodeMemory();
    try { localStorage.removeItem(STRUCTURE_LENS_KEY); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(STRUCTURE_TREE_KEY); } catch (e) { /* ignore */ }
    // The persisted lens choice is the "second slot", stored as 'ui'; a types repo
    // normalizes that to its Types outline.
    setStructureLens('ui');
});

afterEach(() => {
    setWidth(realInnerWidth);
});

describe('Types lens — Find in code jumps to the declaration', () => {
    it('switches to the Code lens, flashes the defining file row, and opens the type’s line', async () => {
        await renderTypes([BST]);
        typeRow('class BinarySearchTree').click();
        findBtn().click();
        await flush();

        // The lens switch persists, exactly as the UI lens's tap-through does.
        expect(localStorage.getItem(STRUCTURE_LENS_KEY)).toBe('code');
        const wrap = document.querySelector('[data-structure-file="LinearSearch/BST.cs"]');
        expect(wrap).toBeTruthy();
        expect(wrap.classList.contains('structureFileWrap--flash')).toBe(true);

        // …and the viewer lands on the declaration, not the top of the file.
        expect(getOpenCodeViewerFile()).toBe('LinearSearch/BST.cs');
        expect(bannerText(detailHost())).toBe('BinarySearchTree · declaration');
        expect(hitLines(detailHost())).toEqual(['5']);
    });

    it('qualifies a member by its owning type and opens the member’s own line', async () => {
        await renderTypes([BST]);
        typeRow('Insert(int value)').click();
        findBtn().click();
        await flush();

        expect(bannerText(detailHost())).toBe('BinarySearchTree.Insert · declaration');
        expect(hitLines(detailHost())).toEqual(['12']);
    });

    // The name alone is ambiguous — two classes each define a `Reset` — which is
    // exactly why the member row jumps to ITS declaration instead of listing every
    // definition of the name and making the user pick.
    it('jumps a same-named member to its own type’s declaration, not a list', async () => {
        await renderTypes([
            { kind: 'class', name: 'Node', file: 'B.cs', line: 40, members: [{ signature: 'Reset()', name: 'Reset', line: 44 }] },
            { kind: 'class', name: 'Tree', file: 'A.cs', line: 5, members: [{ signature: 'Reset()', name: 'Reset', line: 9 }] },
        ], '', ['A.cs', 'B.cs']);

        // Files group alphabetically, so the first `Reset()` row is Tree's in A.cs.
        typeRow('Reset()').click();
        findBtn().click();
        await flush();

        expect(getOpenCodeViewerFile()).toBe('A.cs');
        expect(bannerText(detailHost())).toBe('Tree.Reset · declaration');
        expect(hitLines(detailHost())).toEqual(['9']);
        // No owner-file result list is left behind in the toolbar.
        expect(document.querySelector('.structureOwnerFileBtn')).toBeFalsy();
    });

    it('joins the manifest’s srcRoot so the read path is repo-relative', async () => {
        await renderTypes([BST], 'pkg/src');
        typeRow('class BinarySearchTree').click();
        state.reads = [];
        findBtn().click();
        await flush();

        expect(getOpenCodeViewerFile()).toBe('pkg/src/LinearSearch/BST.cs');
        expect(state.reads.every((r) => r.filePath === 'pkg/src/LinearSearch/BST.cs')).toBe(true);
        expect(state.reads.every((r) => r.repo === OTHER)).toBe(true);
    });

    it('below 1024px the jump opens in the full-screen sheet instead of the detail column', async () => {
        setWidth(800);
        await renderTypes([BST]);
        typeRow('class BinarySearchTree').click();
        findBtn().click();
        await flush();

        const host = document.querySelector('#structureCodeSheet .structureCodeSheetHost');
        expect(host).toBeTruthy();
        expect(document.getElementById('structureCodeSheet').hidden).toBe(false);
        expect(bannerText(host)).toBe('BinarySearchTree · declaration');
    });
});

describe('Types lens — Copy reads "Copy name" and writes the bare identifier', () => {
    function withClipboard(fn) {
        const writeText = vi.fn(() => Promise.resolve());
        const prior = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        try { fn(writeText); } finally {
            if (prior === undefined) delete navigator.clipboard;
            else Object.defineProperty(navigator, 'clipboard', { value: prior, configurable: true });
        }
    }

    it('copies a member’s own name rather than a dotted path', async () => {
        await renderTypes([BST]);
        typeRow('Insert(int value)').click();

        const copy = toolbar().querySelector('.structureCopyBtn');
        expect(copy.textContent).toBe('Copy name');
        withClipboard((writeText) => {
            copy.click();
            expect(writeText).toHaveBeenCalledWith('Insert');
        });
    });

    it('copies a type’s name', async () => {
        await renderTypes([BST]);
        typeRow('class BinarySearchTree').click();

        withClipboard((writeText) => {
            toolbar().querySelector('.structureCopyBtn').click();
            expect(writeText).toHaveBeenCalledWith('BinarySearchTree');
        });
    });
});

describe('Types lens — an outline entry with no line has no Find action', () => {
    // A manifest predating the generator's per-member `line` has nowhere to jump.
    // The action is omitted rather than mounted as a dead click; Copy still works,
    // because the name is always there.
    it('omits Find for a member with no recorded line, keeping Copy name', async () => {
        await renderTypes([
            {
                kind: 'class', name: 'Legacy', file: 'LinearSearch/BST.cs', line: 5,
                members: [{ signature: 'Old()', name: 'Old' }],
            },
        ]);
        typeRow('Old()').click();

        expect(toolbar().classList.contains('structureActionToolbar--idle')).toBe(false);
        expect(toolbar().querySelector('.structureFindBtn')).toBeFalsy();
        expect(toolbar().querySelector('.structureCopyBtn').textContent).toBe('Copy name');
        expect(toolbar().querySelector('.structureReferenceBtn')).toBeTruthy();
    });

    it('omits Find for a type whose line is 0, which would land at the top of the file', async () => {
        await renderTypes([
            { kind: 'class', name: 'Legacy', file: 'LinearSearch/BST.cs', line: 0, members: [] },
        ]);
        typeRow('class Legacy').click();

        expect(toolbar().querySelector('.structureFindBtn')).toBeFalsy();
    });

    it('omits Find for a type with a line but no file', async () => {
        await renderTypes([
            { kind: 'class', name: 'Legacy', line: 5, members: [] },
        ], '', []);
        typeRow('class Legacy').click();

        expect(toolbar().querySelector('.structureFindBtn')).toBeFalsy();
    });

    // A sibling with a line keeps its action — the guard is per-selection, not a
    // whole-lens switch.
    it('keeps Find for a sibling that does carry a line', async () => {
        await renderTypes([
            {
                kind: 'class', name: 'Legacy', file: 'LinearSearch/BST.cs', line: 5,
                members: [{ signature: 'Old()', name: 'Old' }, { signature: 'New()', name: 'New', line: 22 }],
            },
        ]);
        typeRow('Old()').click();
        expect(toolbar().querySelector('.structureFindBtn')).toBeFalsy();

        typeRow('New()').click();
        expect(toolbar().querySelector('.structureFindBtn')).toBeTruthy();
    });
});

describe('UI lens — Find in code still lists owner files', () => {
    it('resolves a published selector through the region index instead of jumping', async () => {
        mountDom('');
        renderStructureView();
        await flush();

        state.manifests[OTHER] = {
            ok: true, files: ['app.js'], hasDom: true, srcRoot: 'pkg/src',
            regions: [{ selector: '#board', label: 'Board', file: 'app.js', line: 4, files: [{ file: 'app.js', line: 4 }] }],
        };
        mountDom('Game');
        renderStructureView();
        await flush();

        const row = Array.from(document.querySelectorAll('.structureRegionRow')).find((r) => {
            const s = r.querySelector('.structureRegionSelector');
            return s && s.textContent === '#board';
        });
        row.click();
        findBtn().click();
        await flush();

        const owners = Array.from(document.querySelectorAll('.structureOwnerFileBtn')).map((b) => b.textContent);
        expect(owners).toEqual(['app.js:4']);
        // Listing is not jumping: the lens has not moved and nothing opened.
        expect(localStorage.getItem(STRUCTURE_LENS_KEY)).not.toBe('code');
        expect(getOpenCodeViewerFile()).toBe(null);
    });
});
