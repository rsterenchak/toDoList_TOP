import { vi } from 'vitest';

// The STRUCTURE view renders a cross-repo map with two lenses:
//   • Code lens — a collapsible folder/file tree built from the selected repo's
//     published src-manifest.json, with a per-file "Explain with Sonnet" action.
//   • UI lens — a live, tappable map of the running app's on-screen regions,
//     walked from the DOM, with per-region "Reference in chat" / "Copy selector".
// A Code/UI toggle (persisted via prefs, default UI) swaps between them, and the
// repo is resolved from the currently-selected project (no picker).
//
// These tests drive renderStructureView against a jsdom DOM with its
// collaborators mocked:
//   • claudeSheet.js — loadManifest (canned manifest), getRunningAppRepo
//     (which repo maps live), setChatWorkspaceRepo (workspace reframe spy), and
//     insertReference (reference-in-chat spy).
//   • seedTasksModal.js — resolveProjectRepo, the project→repo resolver, canned
//     per project name so a selected project resolves to a repo (or null).
//   • inject.js — chatWithWorker, captured so we can assert the Explain turn's
//     attached file + repo + Fast-mode flag and feed back a canned reply.
const { state } = vi.hoisted(() => ({
    state: {
        // project name → resolved repo (null = not linked to a repo).
        projectRepos: {
            'My Project': 'rsterenchak/toDoList_TOP',
            'Game': 'rsterenchak/matchingGame-test',
        },
        runningRepo: 'rsterenchak/toDoList_TOP',
        manifests: {},
        explainReply: 'This file does a thing.',
        explainError: null,
        lastChatCall: null,
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
    chatWithWorker: vi.fn(function (messages, entryId, attach, repo, suggested, deep) {
        state.lastChatCall = { messages, entryId, attach, repo, suggested, deep };
        if (state.explainError) return Promise.reject(state.explainError);
        return Promise.resolve({ reply: state.explainReply });
    }),
}));

import { renderStructureView, captureStructureSnapshot, buildUiTree } from '../src/structureView.js';
import { resetCanvasState } from '../src/structureCanvas.js';
import { chatWithWorker, } from '../src/inject.js';
import { setChatWorkspaceRepo, insertReference } from '../src/claudeSheet.js';
import {
    setStructureLens,
    STRUCTURE_LENS_KEY,
    STRUCTURE_TREE_KEY,
    getStructureTreeState,
} from '../src/prefs.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) {
    for (let i = 0; i < n; i++) await tick();
}

// Mount the structure container plus a selected-project sidebar row whose
// #projInput names the project — the same source the view reads. `name` may be
// '' to model "nothing selected" (no .selectedProject row at all).
function mountDom(name = 'My Project', extraHtml = '') {
    const projectRow = name
        ? '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>'
        : '';
    document.body.innerHTML = '<div id="structureView"></div>' + projectRow + (extraHtml || '');
}

beforeEach(() => {
    mountDom();
    state.projectRepos = {
        'My Project': 'rsterenchak/toDoList_TOP',
        'Game': 'rsterenchak/matchingGame-test',
    };
    state.runningRepo = 'rsterenchak/toDoList_TOP';
    state.manifests = {};
    state.explainReply = 'This file does a thing.';
    state.explainError = null;
    state.lastChatCall = null;
    chatWithWorker.mockClear();
    setChatWorkspaceRepo.mockClear();
    insertReference.mockClear();
    try { localStorage.removeItem(STRUCTURE_LENS_KEY); } catch (e) { /* ignore */ }
});

describe('buildUiTree — class-identified guest regions (knownClasses)', () => {
    // A class-based guest document (React-app shape): the only id is the mount
    // point, and the real regions are keyed by className.
    function classOnlyDoc() {
        const doc = document.implementation.createHTMLDocument('guest');
        doc.body.innerHTML =
            '<div id="app">' +
            '<div class="homeSection"><div class="card"></div></div>' +
            '<div class="navSection"></div>' +
            '</div>';
        return doc;
    }

    it('keeps class-bearing elements when their class is in the known set, nesting them', () => {
        const doc = classOnlyDoc();
        const known = new Set(['homeSection', 'card', 'navSection']);
        const tree = buildUiTree(doc, known);
        // #app is kept by id; its class-kept descendants nest beneath it.
        const app = tree.find((n) => n.selector === '#app');
        expect(app).toBeTruthy();
        const kids = app.children.map((c) => c.selector);
        expect(kids).toEqual(expect.arrayContaining(['div.homeSection', 'div.navSection']));
        const home = app.children.find((c) => c.selector === 'div.homeSection');
        expect(home.children.map((c) => c.selector)).toContain('div.card');
    });

    it('drops class-only elements when no known set is passed (self-repo no-regression)', () => {
        const doc = classOnlyDoc();
        // No knownClasses → only the id-bearing #app is kept, childless flat root.
        const flat = buildUiTree(doc);
        expect(flat.map((n) => n.selector)).toEqual(['#app']);
        expect(flat[0].children).toEqual([]);
        // An empty set behaves the same as none — nothing class-only is kept.
        const empty = buildUiTree(doc, new Set());
        expect(empty.map((n) => n.selector)).toEqual(['#app']);
        expect(empty[0].children).toEqual([]);
    });

    it('still keeps an id-bearing element by id even when it also matches a class', () => {
        const doc = document.implementation.createHTMLDocument('guest');
        doc.body.innerHTML = '<div id="app"><section id="stage" class="homeSection"></section></div>';
        const tree = buildUiTree(doc, new Set(['homeSection']));
        const app = tree.find((n) => n.selector === '#app');
        // The dual id+class element keeps its #id selector (id precedence).
        expect(app.children.map((c) => c.selector)).toEqual(['#stage']);
    });
});

describe('buildUiTree — class-kept region labels (classLabels)', () => {
    it('labels a class-kept region from the manifest map, and prettifies an unmapped class', () => {
        const doc = document.implementation.createHTMLDocument('guest');
        doc.body.innerHTML =
            '<div id="app">' +
            '<div class="navSection"></div>' +
            '<div class="logoSection2"></div>' +
            '</div>';
        const known = new Set(['navSection', 'logoSection2']);
        const labels = new Map([['navSection', 'Nav Section']]);
        const tree = buildUiTree(doc, known, labels);
        const app = tree.find((n) => n.selector === '#app');
        const nav = app.children.find((c) => c.selector === 'div.navSection');
        const logo = app.children.find((c) => c.selector === 'div.logoSection2');
        // Mapped class → its manifest label; unmapped class → prettified class token.
        expect(nav.label).toBe('Nav Section');
        expect(logo.label).toBe('Logo Section2');
    });

    it('a class-less kept element still reads its role even when a classLabels map is present', () => {
        const doc = document.implementation.createHTMLDocument('guest');
        doc.body.innerHTML = '<div id="app"><nav></nav></div>';
        const tree = buildUiTree(doc, new Set(), new Map([['x', 'X']]));
        const app = tree.find((n) => n.selector === '#app');
        // <nav> is kept by its landmark role and carries no class, so it falls
        // through the (empty) class steps to its role label.
        expect(app.children[0].label).toBe('Navigation');
    });

    it('self-repo labeling is unchanged when no classLabels map is passed', () => {
        const doc = document.implementation.createHTMLDocument('guest');
        doc.body.innerHTML = '<div id="app"><nav class="topNav"></nav></div>';
        // No map → the class-based steps never fire, so the role-kept <nav> keeps
        // its "Navigation" label rather than a class-derived "Top Nav".
        const tree = buildUiTree(doc);
        const app = tree.find((n) => n.selector === '#app');
        expect(app.children[0].label).toBe('Navigation');
    });
});

describe('renderStructureView — project-derived repo', () => {
    it('resolves the repo from the selected project and shows it as a read-only label', async () => {
        mountDom('Game');
        renderStructureView();
        await flush();
        // No picker control any more.
        expect(document.getElementById('structureRepoPicker')).toBeFalsy();
        const repoName = document.querySelector('.structureRepoName');
        expect(repoName).toBeTruthy();
        expect(repoName.textContent).toBe('rsterenchak/matchingGame-test');
        // The project name rides along as a quiet hint.
        const hint = document.querySelector('.structureRepoProjectHint');
        expect(hint.textContent).toBe('Game');
    });

    it('short-circuits cleanly when the container is absent', () => {
        document.body.innerHTML = '';
        expect(() => renderStructureView()).not.toThrow();
    });

    it('prompts to select a project when none is selected', async () => {
        mountDom('');
        renderStructureView();
        await flush();
        const empty = document.querySelector('.structureEmptyState');
        expect(empty).toBeTruthy();
        expect(empty.textContent).toMatch(/select a project/i);
        // No header / repo label is rendered in the empty state.
        expect(document.querySelector('.structureRepoName')).toBeFalsy();
        expect(document.querySelector('.structureLensToggle')).toBeFalsy();
    });

    it('guides the user to link a repo when the selected project has none', async () => {
        state.projectRepos['Unlinked'] = null;
        mountDom('Unlinked');
        renderStructureView();
        await flush();
        const empty = document.querySelector('.structureEmptyState');
        expect(empty).toBeTruthy();
        expect(empty.textContent).toContain('Unlinked');
        expect(empty.textContent).toMatch(/link one in its inject target/i);
        expect(document.querySelector('.structureLensToggle')).toBeFalsy();
    });

    it('does NOT reframe the chat workspace on render or project switch', async () => {
        mountDom('My Project');
        renderStructureView();
        await flush();
        mountDom('Game');
        renderStructureView();
        await flush();
        expect(setChatWorkspaceRepo).not.toHaveBeenCalled();
    });
});

describe('renderStructureView — Code/UI lens toggle', () => {
    it('renders a Code/UI segmented control defaulting to UI', async () => {
        renderStructureView();
        await flush();
        const toggle = document.querySelector('.structureLensToggle');
        expect(toggle).toBeTruthy();
        const btns = Array.from(toggle.querySelectorAll('.structureLensBtn'));
        expect(btns.map((b) => b.textContent)).toEqual(['UI', 'Code']);
        const ui = btns.find((b) => b.dataset.lens === 'ui');
        expect(ui.getAttribute('aria-selected')).toBe('true');
    });

    it('switching to Code renders the source tree and persists the choice', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = { ok: true, files: ['src/main.js'] };
        renderStructureView();
        await flush();
        // Default UI lens shows no folder rows.
        expect(document.querySelector('.structureFolderName')).toBeFalsy();
        const codeBtn = Array.from(document.querySelectorAll('.structureLensBtn'))
            .find((b) => b.dataset.lens === 'code');
        codeBtn.click();
        await flush();
        expect(document.querySelector('.structureFolderName')).toBeTruthy();
        expect(localStorage.getItem(STRUCTURE_LENS_KEY)).toBe('code');
    });
});

describe('renderStructureView — source tree (Code lens)', () => {
    // Pin the allowlist to the single default repo so the module-scoped
    // selection (which persists across renders by design) resolves to it
    // regardless of any selection a prior test left behind. The Code lens must
    // be explicitly selected since the view now defaults to the UI lens.
    beforeEach(() => {
        state.repos = ['rsterenchak/toDoList_TOP'];
        setStructureLens('code');
    });

    it('groups the manifest paths into collapsible folders and files', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true,
            files: ['src/main.js', 'src/util/a.js', 'src/util/b.js', 'README.md'],
        };
        renderStructureView();
        await flush();

        // Top-level folders (src) and top-level files (README.md) render.
        const folders = Array.from(document.querySelectorAll('.structureFolderName')).map((n) => n.textContent);
        expect(folders).toContain('src');
        const files = Array.from(document.querySelectorAll('.structureFileName')).map((n) => n.textContent);
        expect(files).toContain('README.md');
        // The nested util/ folder exists; its files are present in the DOM.
        expect(folders).toContain('util');
        expect(files).toContain('a.js');
        expect(files).toContain('b.js');
    });

    it('toggles a folder open/closed on click', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true,
            files: ['src/main.js'],
        };
        renderStructureView();
        await flush();
        const folder = document.querySelector('.structureFolderRow');
        const children = folder.nextElementSibling;
        expect(children.classList.contains('structureFolderChildren')).toBe(true);
        // Starts collapsed.
        expect(children.hidden).toBe(true);
        folder.click();
        expect(children.hidden).toBe(false);
        expect(folder.getAttribute('aria-expanded')).toBe('true');
        folder.click();
        expect(children.hidden).toBe(true);
    });

    it('shows a graceful no-manifest state when the repo has no published manifest', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = { ok: false, files: [] };
        renderStructureView();
        await flush();
        const notice = document.querySelector('.structureNoManifest');
        expect(notice).toBeTruthy();
        expect(notice.textContent).toMatch(/no manifest/i);
    });

    it('renders a View-on-GitHub link for an empty-srcRoot (C#) manifest without a double slash', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true,
            srcRoot: '',
            files: ['LinearSearch/BST.cs'],
        };
        renderStructureView();
        await flush();

        // Expand the LinearSearch folder so its file row is reachable.
        const folder = document.querySelector('.structureFolderRow');
        folder.click();

        const gh = document.querySelector('.structureGithubLink');
        expect(gh).toBeTruthy();
        const href = gh.getAttribute('href');
        expect(href).toBe('https://github.com/rsterenchak/toDoList_TOP/blob/main/LinearSearch/BST.cs');
        // No root segment means no double slash after the branch.
        expect(href).not.toContain('blob/main//');
    });

    it('still prefixes srcRoot for web repos (non-empty srcRoot)', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true,
            srcRoot: 'src',
            files: ['main.js'],
        };
        renderStructureView();
        await flush();

        const gh = document.querySelector('.structureGithubLink');
        expect(gh).toBeTruthy();
        expect(gh.getAttribute('href')).toBe('https://github.com/rsterenchak/toDoList_TOP/blob/main/src/main.js');
    });
});

describe('renderStructureView — Explain with Sonnet (Code lens)', () => {
    beforeEach(() => {
        state.repos = ['rsterenchak/toDoList_TOP'];
        setStructureLens('code');
    });

    it('runs a Fast-mode one-shot turn with the file attached and renders the reply inline', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true,
            files: ['README.md'],
        };
        renderStructureView();
        await flush();

        const btn = document.querySelector('.structureExplainBtn');
        expect(btn).toBeTruthy();
        btn.click();
        await flush();

        // The Explain turn carried the file as the only attachment, the selected
        // repo, and NO deep flag (Fast mode), and sent no entry_id.
        const call = state.lastChatCall;
        expect(call).toBeTruthy();
        expect(call.attach).toEqual(['README.md']);
        expect(call.repo).toBe('rsterenchak/toDoList_TOP');
        expect(call.entryId).toBeFalsy();
        expect(call.deep).toBeFalsy();

        const out = document.querySelector('.structureExplainText');
        expect(out).toBeTruthy();
        expect(out.textContent).toBe('This file does a thing.');
    });

    it('shows an error fallback when the Explain turn fails', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true,
            files: ['README.md'],
        };
        state.explainError = Object.assign(new Error('boom'), { reason: 'boom' });
        renderStructureView();
        await flush();

        document.querySelector('.structureExplainBtn').click();
        await flush();

        const err = document.querySelector('.structureExplainError');
        expect(err).toBeTruthy();
        expect(err.textContent).toMatch(/boom/);
    });
});

describe('renderStructureView — Explain cache (per repo + file + SHA)', () => {
    const CACHE_KEY = 'todoapp_structureExplain';

    beforeEach(() => {
        state.repos = ['rsterenchak/toDoList_TOP'];
        setStructureLens('code');
        try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
    });

    // Render the Code lens, click the first file's Explain button, settle.
    async function clickExplain() {
        renderStructureView();
        await flush();
        const btn = document.querySelector('.structureExplainBtn');
        btn.click();
        await flush();
        return btn;
    }

    it('serves a second explain of the same file+SHA from cache with no Worker call', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true, files: ['README.md'], sha: 'abc123',
        };
        await clickExplain();
        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.structureExplainText').textContent)
            .toBe('This file does a thing.');

        // Re-render (fresh DOM) and explain the same file again — cache hit.
        chatWithWorker.mockClear();
        await clickExplain();
        expect(chatWithWorker).not.toHaveBeenCalled();
        expect(document.querySelector('.structureExplainText').textContent)
            .toBe('This file does a thing.');
    });

    it('re-explains when the manifest SHA changes (new commit invalidates)', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true, files: ['README.md'], sha: 'abc123',
        };
        await clickExplain();
        expect(chatWithWorker).toHaveBeenCalledTimes(1);

        // A new commit → new SHA → cache miss → fresh Worker call.
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true, files: ['README.md'], sha: 'def456',
        };
        state.explainReply = 'Updated summary.';
        chatWithWorker.mockClear();
        await clickExplain();
        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.structureExplainText').textContent)
            .toBe('Updated summary.');
    });

    it('never caches when the manifest omits a SHA — always calls the Worker', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true, files: ['README.md'],
        };
        await clickExplain();
        chatWithWorker.mockClear();
        await clickExplain();
        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    });

    it('does not cache a failed explanation', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true, files: ['README.md'], sha: 'abc123',
        };
        state.explainError = Object.assign(new Error('boom'), { reason: 'boom' });
        await clickExplain();
        expect(localStorage.getItem(CACHE_KEY)).toBeNull();

        // The retry after a failure re-asks Sonnet (nothing was cached).
        state.explainError = null;
        chatWithWorker.mockClear();
        await clickExplain();
        expect(chatWithWorker).toHaveBeenCalledTimes(1);
    });

    it('persists the cache under the todoapp_-prefixed key', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true, files: ['README.md'], sha: 'abc123',
        };
        await clickExplain();
        const raw = localStorage.getItem(CACHE_KEY);
        expect(raw).toBeTruthy();
        const store = JSON.parse(raw);
        expect(store.map['rsterenchak/toDoList_TOP:README.md:abc123'])
            .toBe('This file does a thing.');
    });
});

describe('renderStructureView — UI lens', () => {
    beforeEach(() => {
        setStructureLens('ui');
    });

    // The UI lens walks `document` — so the view container plus some sample
    // regions must live on the page. mountUiDom appends regions alongside the
    // structureView container plus the selected-project row that resolves the
    // repo (default 'My Project' → the running app repo), then we render into
    // the latter.
    function mountUiDom(extraHtml, projectName) {
        const name = projectName === undefined ? 'My Project' : projectName;
        const projectRow = name
            ? '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>'
            : '';
        document.body.innerHTML =
            '<div id="structureView"></div>' +
            projectRow +
            '<header id="appHeader" aria-label="App header"></header>' +
            '<main id="mainPanel" data-region="Tasks">' +
            '  <ul id="taskList">' +
            '    <li class="taskRow">a</li>' +
            '    <li class="taskRow">b</li>' +
            '    <li class="taskRow">c</li>' +
            '    <li class="taskRow">d</li>' +
            '  </ul>' +
            '  <section data-region="Sidebar"></section>' +
            '</main>' +
            (extraHtml || '');
    }

    it('walks the live DOM into kept regions by id, data-region, and landmark role', async () => {
        mountUiDom();
        renderStructureView();
        await flush();

        const labels = Array.from(document.querySelectorAll('.structureRegionLabel')).map((n) => n.textContent);
        // id → prettified label; data-region wins over id for the label; aria-label on the header.
        expect(labels).toContain('App header');   // aria-label
        expect(labels).toContain('Tasks');        // data-region on #mainPanel
        expect(labels).toContain('Task List');    // prettified #taskList id
        expect(labels).toContain('Sidebar');      // data-region on the id-less section

        const selectors = Array.from(document.querySelectorAll('.structureRegionSelector')).map((n) => n.textContent);
        // Selector precedence is #id > [data-region]: #mainPanel keeps its id selector
        // even though its label comes from data-region; the id-less section uses data-region.
        expect(selectors).toContain('#mainPanel');
        expect(selectors).toContain('#taskList');
        expect(selectors).toContain('[data-region="Sidebar"]');
    });

    it('excludes only the Structure view, and maps the chat surfaces as rows', async () => {
        mountUiDom(
            '<div id="desktopChatPane"><div id="chatInside" data-region="ChatInside"></div></div>' +
            '<div id="claudeSheet"><div id="sheetInside" data-region="SheetInside"></div></div>'
        );
        renderStructureView();
        await flush();
        const selectors = Array.from(document.querySelectorAll('.structureRegionSelector')).map((n) => n.textContent);
        // The chat surfaces are now walked into the map (not excluded): the desktop
        // chat pane and its subtree, plus the Claude sheet and its subtree, appear.
        expect(selectors).toContain('#desktopChatPane');
        expect(selectors).toContain('#chatInside');
        expect(selectors).toContain('#claudeSheet');
        expect(selectors).toContain('#sheetInside');
        // Only the Structure view itself stays excluded (mapping from inside itself).
        expect(selectors).not.toContain('#structureView');
    });

    it('collapses runs of id-less repeated siblings into a single "× N rows" line', async () => {
        mountUiDom();
        renderStructureView();
        await flush();
        const collapsed = document.querySelector('.structureCollapsedRow');
        expect(collapsed).toBeTruthy();
        expect(collapsed.textContent).toBe('× 4 li rows');
    });

    it('tapping a region selects it; the shared toolbar references the selector, re-tap deselects', async () => {
        mountUiDom();
        renderStructureView();
        await flush();

        // The shared toolbar starts idle (no row selected).
        const toolbar = document.querySelector('.structureActionToolbar');
        expect(toolbar).toBeTruthy();
        expect(toolbar.classList.contains('structureActionToolbar--idle')).toBe(true);
        expect(toolbar.querySelector('.structureReferenceBtn')).toBeFalsy();

        // Find the #taskList region row and select it.
        const rows = Array.from(document.querySelectorAll('.structureRegionRow'));
        const taskRow = rows.find((r) => r.querySelector('.structureRegionSelector').textContent === '#taskList');
        expect(taskRow).toBeTruthy();
        taskRow.click();
        expect(taskRow.classList.contains('is-selected')).toBe(true);
        expect(taskRow.getAttribute('aria-pressed')).toBe('true');
        expect(toolbar.classList.contains('structureActionToolbar--idle')).toBe(false);
        expect(toolbar.querySelector('.structureActionToolbarLabel').textContent).toBe('Task List');

        // The toolbar's Reference action hands off the selected handle.
        toolbar.querySelector('.structureReferenceBtn').click();
        expect(insertReference).toHaveBeenCalledWith('Task List', '#taskList');

        // Re-tapping the selected row deselects it back to the idle toolbar.
        taskRow.click();
        expect(taskRow.classList.contains('is-selected')).toBe(false);
        expect(taskRow.getAttribute('aria-pressed')).toBe('false');
        expect(toolbar.classList.contains('structureActionToolbar--idle')).toBe(true);
    });

    it('shows a "no manifest" notice for a non-running repo with no published manifest', async () => {
        // 'Game' resolves to matchingGame-test, which isn't the running repo.
        state.runningRepo = 'rsterenchak/toDoList_TOP';
        mountUiDom(undefined, 'Game');
        renderStructureView();
        await flush();
        const notice = document.querySelector('.structureNoUiMap');
        expect(notice).toBeTruthy();
        expect(notice.textContent).toMatch(/no manifest/i);
    });
});

describe('renderStructureView — published UI map + states (UI lens, non-running repo)', () => {
    const OTHER = 'rsterenchak/matchingGame-test';
    beforeEach(() => {
        // Reset any module-scoped selection a prior test left behind by rendering
        // the no-project empty state first (it clears the active handle), so the
        // selection toolbar starts idle for each test rather than re-applying a
        // stale same-repo selection.
        mountDom('');
        renderStructureView();
        // 'Game' resolves to OTHER (matchingGame-test), the non-running repo, so
        // the view renders that repo's published map rather than a live walk.
        mountDom('Game');
        state.runningRepo = 'rsterenchak/toDoList_TOP';
        setStructureLens('ui');
    });

    it('renders the published region map from the manifest regions', async () => {
        state.manifests[OTHER] = {
            ok: true,
            files: ['app.js', 'app.css'],
            hasDom: true,
            srcRoot: 'src',
            regions: [
                { selector: '#board', label: 'Board', file: 'app.js', line: 12, files: [{ file: 'app.js', line: 12 }, { file: 'app.css', line: 88 }] },
                { selector: '[data-region="HUD"]', label: 'HUD', file: 'app.js', line: 40, files: [{ file: 'app.js', line: 40 }] },
            ],
        };
        renderStructureView();
        await flush();

        const banner = document.querySelector('.structurePublishedBanner');
        expect(banner).toBeTruthy();
        const labels = Array.from(document.querySelectorAll('.structureRegionLabel')).map((n) => n.textContent);
        expect(labels).toContain('Board');
        expect(labels).toContain('HUD');
        const selectors = Array.from(document.querySelectorAll('.structureRegionSelector')).map((n) => n.textContent);
        expect(selectors).toContain('#board');
        expect(selectors).toContain('[data-region="HUD"]');
    });

    it('shows a "No UI surface" state when the manifest reports hasDom:false', async () => {
        state.manifests[OTHER] = { ok: true, files: ['lib.js'], hasDom: false, srcRoot: 'src', regions: [] };
        renderStructureView();
        await flush();
        const notice = document.querySelector('.structureNoUiMap');
        expect(notice).toBeTruthy();
        expect(notice.textContent).toMatch(/no ui surface/i);
    });

    it('shows a "not built yet" state when the manifest predates the UI index (no regions key)', async () => {
        // regions undefined → manifest fetched but without the build-time index.
        state.manifests[OTHER] = { ok: true, files: ['app.js'], hasDom: undefined, srcRoot: undefined, regions: undefined };
        renderStructureView();
        await flush();
        const notice = document.querySelector('.structureNoUiMap');
        expect(notice).toBeTruthy();
        expect(notice.textContent).toMatch(/not built yet/i);
    });

    it('selecting a published region row exposes Find in code and a GitHub deep link to its file', async () => {
        state.manifests[OTHER] = {
            ok: true,
            files: ['app.js'],
            hasDom: true,
            srcRoot: 'pkg/src',
            regions: [
                { selector: '#board', label: 'Board', file: 'app.js', line: 12, files: [{ file: 'app.js', line: 12 }] },
            ],
        };
        renderStructureView();
        await flush();

        const row = document.querySelector('.structureRegionRow');
        expect(row).toBeTruthy();
        const toolbar = document.querySelector('.structureActionToolbar');
        // Idle until the row is selected — no GitHub link in the toolbar yet.
        expect(toolbar.querySelector('.structureGithubLink')).toBeFalsy();
        row.click();

        const gh = toolbar.querySelector('.structureGithubLink');
        expect(gh).toBeTruthy();
        expect(gh.getAttribute('href')).toBe('https://github.com/' + OTHER + '/blob/main/pkg/src/app.js#L12');

        // Find in code reveals the owner file row inside the toolbar's result area.
        toolbar.querySelector('.structureFindBtn').click();
        await flush();
        const owner = toolbar.querySelector('.structureOwnerFileBtn');
        expect(owner).toBeTruthy();
        expect(owner.textContent).toBe('app.js:12');
    });

    it('a selected published region row also exposes Reference in chat and Copy selector', async () => {
        state.manifests[OTHER] = {
            ok: true,
            files: ['app.js'],
            hasDom: true,
            srcRoot: 'src',
            regions: [
                { selector: '.card', label: 'Card', file: 'app.js', line: 5, files: [{ file: 'app.js', line: 5 }] },
            ],
        };
        renderStructureView();
        await flush();

        const row = document.querySelector('.structureRegionRow');
        const toolbar = document.querySelector('.structureActionToolbar');
        row.click();
        expect(toolbar.classList.contains('structureActionToolbar--idle')).toBe(false);

        // Reference in chat reframes onto the published repo and hands off the
        // region's label + selector — identical contract to the live row.
        const refBtn = toolbar.querySelector('.structureReferenceBtn');
        expect(refBtn).toBeTruthy();
        refBtn.click();
        expect(setChatWorkspaceRepo).toHaveBeenCalledWith(OTHER);
        expect(insertReference).toHaveBeenCalledWith('Card', '.card');

        // Copy selector writes the region's selector to the clipboard.
        const writeText = vi.fn(() => Promise.resolve());
        const priorClipboard = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const copyBtn = toolbar.querySelector('.structureCopyBtn');
        expect(copyBtn).toBeTruthy();
        copyBtn.click();
        expect(writeText).toHaveBeenCalledWith('.card');
        if (priorClipboard === undefined) {
            delete navigator.clipboard;
        } else {
            Object.defineProperty(navigator, 'clipboard', { value: priorClipboard, configurable: true });
        }
    });

    it('groups published rows under a collapsible file header per defining file, files alphabetical', async () => {
        state.manifests[OTHER] = {
            ok: true,
            files: ['app.js', 'hud.js'],
            hasDom: true,
            srcRoot: 'src',
            regions: [
                { selector: '#board', label: 'Board', file: 'app.js', line: 12, files: [{ file: 'app.js', line: 12 }] },
                { selector: '[data-region="HUD"]', label: 'HUD', file: 'hud.js', line: 40, files: [{ file: 'hud.js', line: 40 }] },
                { selector: '.card', label: 'Card', file: 'app.js', line: 5, files: [{ file: 'app.js', line: 5 }] },
            ],
        };
        renderStructureView();
        await flush();

        // One header per distinct file, ordered alphabetically.
        const headers = Array.from(document.querySelectorAll('.structureFolderRow'))
            .map((n) => n.querySelector('.structureFolderName').textContent);
        expect(headers).toEqual(['app.js', 'hud.js']);

        // Headers default to expanded so all handles are visible on open.
        document.querySelectorAll('.structureFolderRow').forEach((h) => {
            expect(h.getAttribute('aria-expanded')).toBe('true');
        });
        expect(Array.from(document.querySelectorAll('.structureRegionLabel')).map((n) => n.textContent))
            .toEqual(expect.arrayContaining(['Board', 'Card', 'HUD']));
    });

    it('orders rows within a file group by line, and shortens the per-row note to just the line', async () => {
        state.manifests[OTHER] = {
            ok: true,
            files: ['app.js'],
            hasDom: true,
            srcRoot: 'src',
            regions: [
                { selector: '#board', label: 'Board', file: 'app.js', line: 12, files: [{ file: 'app.js', line: 12 }] },
                { selector: '.card', label: 'Card', file: 'app.js', line: 5, files: [{ file: 'app.js', line: 5 }] },
            ],
        };
        renderStructureView();
        await flush();

        const group = document.querySelector('.structureFolderRow').parentNode;
        const labels = Array.from(group.querySelectorAll('.structureRegionLabel')).map((n) => n.textContent);
        expect(labels).toEqual(['Card', 'Board']); // line 5 before line 12

        const row = group.querySelector('.structureRegionRow');
        row.click();
        // The per-row note moved to the shared toolbar's context line — it carries
        // the selector plus just the line within the grouping file (no file name).
        const context = document.querySelector('.structureActionToolbarContext');
        expect(context.textContent).toContain('Line 5.');
        expect(context.textContent).not.toMatch(/app\.js/);
    });

    it('collapses a file group when its header is clicked, hiding the nested rows', async () => {
        state.manifests[OTHER] = {
            ok: true,
            files: ['app.js'],
            hasDom: true,
            srcRoot: 'src',
            regions: [
                { selector: '#board', label: 'Board', file: 'app.js', line: 12, files: [{ file: 'app.js', line: 12 }] },
            ],
        };
        renderStructureView();
        await flush();

        const header = document.querySelector('.structureFolderRow');
        const childWrap = header.nextSibling;
        expect(childWrap.hidden).toBe(false);
        header.click();
        expect(childWrap.hidden).toBe(true);
        expect(header.getAttribute('aria-expanded')).toBe('false');
        header.click();
        expect(childWrap.hidden).toBe(false);
        expect(header.getAttribute('aria-expanded')).toBe('true');
    });
});

describe('renderStructureView — guest deployed-site capture trigger (UI lens)', () => {
    const OTHER = 'rsterenchak/matchingGame-test';
    beforeEach(() => {
        // Clear any stale module selection, then point at the guest repo on the UI lens.
        mountDom('');
        renderStructureView();
        mountDom('Game');
        state.runningRepo = 'rsterenchak/toDoList_TOP';
        setStructureLens('ui');
    });

    it('shows the "Capture layout from deployed site" trigger on a guest web repo UI lens', async () => {
        state.manifests[OTHER] = {
            ok: true, files: ['app.js'], hasDom: true, srcRoot: 'src',
            regions: [{ selector: '#board', label: 'Board', file: 'app.js', line: 1, files: [{ file: 'app.js', line: 1 }] }],
        };
        renderStructureView();
        await flush();
        const btn = document.querySelector('.structureCaptureBtn');
        expect(btn).toBeTruthy();
        expect(btn.textContent).toMatch(/capture layout/i);
    });

    it('omits the trigger for a repo whose manifest reports no UI surface', async () => {
        state.manifests[OTHER] = { ok: true, files: ['lib.js'], hasDom: false, srcRoot: 'src', regions: [] };
        renderStructureView();
        await flush();
        expect(document.querySelector('.structureCaptureBtn')).toBeFalsy();
    });

    it('omits the trigger on the Types lens', async () => {
        state.manifests[OTHER] = {
            ok: true, files: ['Game.cs'], lens: 'types',
            types: [{ kind: 'class', name: 'Game', file: 'Game.cs', line: 3, members: [] }],
        };
        renderStructureView();
        await flush();
        expect(document.querySelector('.structureCaptureBtn')).toBeFalsy();
        // Sanity: the Types outline did render (so absence isn't just an empty lens).
        expect(document.querySelector('.structureTypeLabel')).toBeTruthy();
    });

    it('omits the trigger on the self (running) repo live UI lens', async () => {
        // 'My Project' resolves to the running repo → the live self map, never the trigger.
        document.body.innerHTML =
            '<div id="structureView"></div>' +
            '<div class="selectedProject"><input id="projInput" value="My Project"></div>' +
            '<main id="mainPanel" data-region="Tasks"></main>';
        renderStructureView();
        await flush();
        expect(document.querySelector('.structureCaptureBtn')).toBeFalsy();
    });
});

describe('renderStructureView — shared selection toolbar', () => {
    beforeEach(() => {
        setStructureLens('ui');
        // Reset any selection a prior test left in module state by rendering the
        // no-project empty state first (it clears the active handle), so each test
        // starts idle rather than re-applying a stale same-repo selection.
        mountDom('');
        renderStructureView();
    });

    function mountUiDom() {
        document.body.innerHTML =
            '<div id="structureView"></div>' +
            '<div class="selectedProject"><input id="projInput" value="My Project"></div>' +
            '<main id="mainPanel" data-region="Tasks">' +
            '  <ul id="taskList"><li>a</li></ul>' +
            '  <section data-region="Sidebar"></section>' +
            '</main>';
    }

    const toolbar = () => document.querySelector('.structureActionToolbar');
    const rowFor = (selector) =>
        Array.from(document.querySelectorAll('.structureRegionRow')).find(
            (r) => r.querySelector('.structureRegionSelector') &&
                r.querySelector('.structureRegionSelector').textContent === selector
        );

    it('starts idle: a muted hint and no action buttons', async () => {
        mountUiDom();
        renderStructureView();
        await flush();

        const bar = toolbar();
        expect(bar).toBeTruthy();
        expect(bar.hidden).toBe(false); // the UI lens shows it
        expect(bar.classList.contains('structureActionToolbar--idle')).toBe(true);
        expect(bar.querySelector('.structureActionToolbarLabel').textContent).toMatch(/select a handle/i);
        expect(bar.querySelector('.structureReferenceBtn')).toBeFalsy();
        expect(bar.querySelector('.structureFindBtn')).toBeFalsy();
    });

    it('the caret toggles children without selecting the row', async () => {
        mountUiDom();
        renderStructureView();
        await flush();

        // #mainPanel (Tasks) nests child regions, so its row carries a caret.
        const tasksRow = rowFor('#mainPanel');
        expect(tasksRow).toBeTruthy();
        const caret = tasksRow.querySelector('.structureRegionCaret');
        const childWrap = tasksRow.parentNode.querySelector('.structureRegionChildren');
        expect(childWrap.hidden).toBe(true);

        caret.click();
        // Children expand, but the row is NOT selected and the toolbar stays idle.
        expect(childWrap.hidden).toBe(false);
        expect(tasksRow.classList.contains('expanded')).toBe(true);
        expect(tasksRow.classList.contains('is-selected')).toBe(false);
        expect(toolbar().classList.contains('structureActionToolbar--idle')).toBe(true);
    });

    it('keeps a single active selection — selecting another row moves it', async () => {
        mountUiDom();
        renderStructureView();
        await flush();

        const tasksRow = rowFor('#mainPanel');
        const listRow = rowFor('#taskList');
        expect(tasksRow).toBeTruthy();
        expect(listRow).toBeTruthy();

        tasksRow.click();
        expect(tasksRow.classList.contains('is-selected')).toBe(true);

        listRow.click();
        // Selection moved — only one row is selected at a time.
        expect(listRow.classList.contains('is-selected')).toBe(true);
        expect(tasksRow.classList.contains('is-selected')).toBe(false);
        expect(document.querySelectorAll('.structureRegionRow.is-selected').length).toBe(1);
        expect(toolbar().querySelector('.structureActionToolbarLabel').textContent).toBe('Task List');
    });

    it('re-applies the selection to the matching row across a same-repo re-render', async () => {
        mountUiDom();
        renderStructureView();
        await flush();

        rowFor('#taskList').click();
        expect(rowFor('#taskList').classList.contains('is-selected')).toBe(true);

        // A same-repo, same-lens repaint re-finds the handle by its value and
        // re-marks the row; the toolbar still reflects it.
        renderStructureView();
        await flush();
        const reRow = rowFor('#taskList');
        expect(reRow.classList.contains('is-selected')).toBe(true);
        expect(reRow.getAttribute('aria-pressed')).toBe('true');
        expect(toolbar().classList.contains('structureActionToolbar--idle')).toBe(false);
        expect(toolbar().querySelector('.structureActionToolbarLabel').textContent).toBe('Task List');
    });

    it('hides the toolbar on the Code lens (no handles to act on)', async () => {
        state.manifests['rsterenchak/toDoList_TOP'] = { ok: true, files: ['src/main.js'] };
        mountUiDom();
        renderStructureView();
        await flush();
        expect(toolbar().hidden).toBe(false);

        const codeBtn = Array.from(document.querySelectorAll('.structureLensBtn')).find((b) => b.dataset.lens === 'code');
        codeBtn.click();
        await flush();
        expect(toolbar().hidden).toBe(true);
    });
});

describe('renderStructureView — canvas toolbar (dims context + Locate)', () => {
    const toolbar = () => document.querySelector('.structureActionToolbar');
    const rowFor = (selector) =>
        Array.from(document.querySelectorAll('.structureRegionRow')).find(
            (r) => r.querySelector('.structureRegionSelector') &&
                r.querySelector('.structureRegionSelector').textContent === selector
        );

    function stubRect(el, w, h) {
        el.getBoundingClientRect = () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h });
        el.getClientRects = () => (w > 0 && h > 0 ? [{ width: w, height: h }] : []);
    }

    // A self-repo DOM (My Project → the running app repo) so the block canvas
    // mounts and `canvasActive` is true; #mainPanel/#taskList carry stubbed rects
    // so the snapshot measures real dims.
    function mountSelfDom() {
        document.body.innerHTML =
            '<div id="structureView"></div>' +
            '<div class="selectedProject"><input id="projInput" value="My Project"></div>' +
            '<main id="mainPanel" data-region="Tasks">' +
            '  <ul id="taskList"><li>a</li></ul>' +
            '</main>';
        stubRect(document.getElementById('mainPanel'), 300, 400);
        stubRect(document.getElementById('taskList'), 200, 150);
    }

    beforeEach(() => {
        setStructureLens('ui');
        resetCanvasState();
        state.runningRepo = 'rsterenchak/toDoList_TOP';
        // Start idle so no stale selection leaks in from a prior test.
        mountDom('');
        renderStructureView();
    });

    it('a canvas-active live selection shows dims + Visible text and an enabled Locate', async () => {
        mountSelfDom();
        captureStructureSnapshot(); // measures the stubbed rects into the active bucket
        renderStructureView();
        await flush();

        rowFor('#mainPanel').click();

        const context = toolbar().querySelector('.structureActionToolbarContext');
        expect(context.textContent).toBe('#mainPanel · 300 × 400 · Visible in viewport');

        const locate = toolbar().querySelector('.structureLocateBtn');
        expect(locate).toBeTruthy();
        expect(locate.disabled).toBe(false);
        expect(toolbar().querySelector('.structureLocateHint')).toBeFalsy();
    });

    it('clicking the enabled Locate flashes the live element', async () => {
        mountSelfDom();
        captureStructureSnapshot();
        renderStructureView();
        await flush();

        const raf = global.requestAnimationFrame;
        global.requestAnimationFrame = (cb) => { cb(); return 0; };
        rowFor('#mainPanel').click();
        toolbar().querySelector('.structureLocateBtn').click();
        global.requestAnimationFrame = raf;

        expect(document.getElementById('mainPanel').classList.contains('locate-pulse')).toBe(true);
    });

    it('renders Locate disabled with a helper note when the handle is not live-visible', async () => {
        mountSelfDom();
        captureStructureSnapshot(); // #mainPanel captured visible at 300×400
        // Collapse it in the live DOM: the snapshot still says visible, but the
        // current viewport has no on-screen box → Locate disabled with the note.
        stubRect(document.getElementById('mainPanel'), 0, 0);
        renderStructureView();
        await flush();

        rowFor('#mainPanel').click();

        const locate = toolbar().querySelector('.structureLocateBtn');
        expect(locate).toBeTruthy();
        expect(locate.disabled).toBe(true);
        expect(toolbar().querySelector('.structureLocateHint').textContent).toBe('hidden in this viewport');
    });

    it('a non-canvas repo keeps the On screen now. context and shows no Locate', async () => {
        // A live repo that is NOT the self repo → the canvas never mounts, so the
        // toolbar context and actions stay exactly as before.
        state.runningRepo = 'rsterenchak/matchingGame-test';
        document.body.innerHTML =
            '<div id="structureView"></div>' +
            '<div class="selectedProject"><input id="projInput" value="Game"></div>' +
            '<main id="board" data-region="Board"><div id="cell">x</div></main>';
        document.getElementById('board').getClientRects = () => [{ width: 100, height: 100 }];
        renderStructureView();
        await flush();

        rowFor('#board').click();

        expect(toolbar().querySelector('.structureActionToolbarContext').textContent)
            .toBe('#board · On screen now.');
        expect(toolbar().querySelector('.structureLocateBtn')).toBeFalsy();
    });
});

describe('renderStructureView — Find in code (live UI lens → Code lens)', () => {
    beforeEach(() => {
        state.repos = ['rsterenchak/toDoList_TOP'];
        state.activeRepo = 'rsterenchak/toDoList_TOP';
        state.runningRepo = 'rsterenchak/toDoList_TOP';
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true,
            files: ['main.js'],
            hasDom: true,
            srcRoot: 'src',
            regions: [
                { selector: '#taskList', label: 'Task List', file: 'main.js', line: 200, files: [{ file: 'main.js', line: 200 }] },
            ],
        };
        setStructureLens('ui');
    });

    function mountUiDom() {
        document.body.innerHTML =
            '<div id="structureView"></div>' +
            '<div class="selectedProject"><input id="projInput" value="My Project"></div>' +
            '<main id="mainPanel"><ul id="taskList"><li>x</li></ul></main>';
    }

    it('resolves a live selector to its owner file, then taps through to the Code lens and reveals it', async () => {
        mountUiDom();
        renderStructureView();
        await flush();

        const rows = Array.from(document.querySelectorAll('.structureRegionRow'));
        const taskRow = rows.find((r) => r.querySelector('.structureRegionSelector') && r.querySelector('.structureRegionSelector').textContent === '#taskList');
        expect(taskRow).toBeTruthy();
        taskRow.click(); // select the handle
        const actions = document.querySelector('.structureActionToolbar');
        actions.querySelector('.structureFindBtn').click();
        await flush();

        const owner = actions.querySelector('.structureOwnerFileBtn');
        expect(owner).toBeTruthy();
        expect(owner.textContent).toBe('main.js:200');

        // Tapping the owner file switches to the Code lens and flashes the file row.
        owner.click();
        await flush();
        expect(localStorage.getItem(STRUCTURE_LENS_KEY)).toBe('code');
        const fileWrap = document.querySelector('[data-structure-file="main.js"]');
        expect(fileWrap).toBeTruthy();
    });
});

describe('renderStructureView — filter box', () => {
    const OTHER = 'rsterenchak/matchingGame-test';

    // Mount the structure container plus live regions (for the UI lens) and the
    // selected-project row; default project resolves to the running app repo.
    function mountUiDom(extraHtml, projectName) {
        const name = projectName === undefined ? 'My Project' : projectName;
        const projectRow = name
            ? '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>'
            : '';
        document.body.innerHTML =
            '<div id="structureView"></div>' +
            projectRow +
            '<header id="appHeader" aria-label="App header"></header>' +
            '<main id="mainPanel" data-region="Tasks">' +
            '  <section data-region="Sidebar"></section>' +
            '</main>' +
            (extraHtml || '');
    }

    function typeFilter(value) {
        const input = document.querySelector('.structureFilterInput');
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return input;
    }

    it('renders a filter input that reflects the active lens in its placeholder', async () => {
        setStructureLens('code');
        state.manifests['rsterenchak/toDoList_TOP'] = { ok: true, files: ['src/main.js'] };
        renderStructureView();
        await flush();
        const input = document.querySelector('.structureFilterInput');
        expect(input).toBeTruthy();
        expect(input.placeholder).toMatch(/filter files/i);

        // Switching to the UI lens updates the placeholder copy.
        const uiBtn = Array.from(document.querySelectorAll('.structureLensBtn')).find((b) => b.dataset.lens === 'ui');
        uiBtn.click();
        await flush();
        expect(document.querySelector('.structureFilterInput').placeholder).toMatch(/filter handles/i);
    });

    it('Code lens: filters files by path, hides non-matches, and shows an "X of Y" count', async () => {
        setStructureLens('code');
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true,
            files: ['src/main.js', 'src/util/alpha.js', 'src/util/beta.js', 'README.md'],
        };
        renderStructureView();
        await flush();

        typeFilter('alpha');
        // The matching file stays; non-matches are filter-hidden.
        const wraps = Array.from(document.querySelectorAll('.structureFileWrap'));
        const visible = wraps.filter((w) => !w.classList.contains('structureFilterHidden'));
        expect(visible.length).toBe(1);
        expect(visible[0].dataset.structureFile).toBe('src/util/alpha.js');
        // Its folder ancestors are revealed (not filter-hidden).
        const utilHead = Array.from(document.querySelectorAll('.structureFolderName')).find((n) => n.textContent === 'util');
        expect(utilHead.closest('.structureFolderRow').classList.contains('structureFilterHidden')).toBe(false);
        // Count reads visible-of-total.
        expect(document.querySelector('.structureFilterCount').textContent).toBe('1 of 4');
        // The matched substring is highlighted in the file name.
        expect(visible[0].querySelector('.structureFilterMark')).toBeTruthy();
    });

    it('Code lens: a folder-name query keeps every file under that folder', async () => {
        setStructureLens('code');
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true,
            files: ['src/util/alpha.js', 'src/util/beta.js', 'src/main.js'],
        };
        renderStructureView();
        await flush();

        typeFilter('util');
        const visible = Array.from(document.querySelectorAll('.structureFileWrap'))
            .filter((w) => !w.classList.contains('structureFilterHidden'))
            .map((w) => w.dataset.structureFile)
            .sort();
        expect(visible).toEqual(['src/util/alpha.js', 'src/util/beta.js']);
    });

    it('clearing the filter restores the full tree and prior fold state', async () => {
        setStructureLens('code');
        state.manifests['rsterenchak/toDoList_TOP'] = {
            ok: true,
            files: ['src/util/alpha.js', 'README.md'],
        };
        renderStructureView();
        await flush();

        // The util folder starts collapsed.
        const utilHead = document.querySelector('.structureFolderRow');
        const utilChildren = utilHead.nextElementSibling;
        expect(utilChildren.hidden).toBe(true);

        typeFilter('alpha');
        // Filtering auto-expanded the folder to reveal the match.
        expect(utilChildren.hidden).toBe(false);

        // Clearing via the × button restores everything.
        const clear = document.querySelector('.structureFilterClear');
        expect(clear.hidden).toBe(false);
        clear.click();
        expect(document.querySelectorAll('.structureFilterHidden').length).toBe(0);
        expect(document.querySelectorAll('.structureFilterMark').length).toBe(0);
        // Prior collapsed state is restored.
        expect(utilChildren.hidden).toBe(true);
        expect(document.querySelector('.structureFilterCount').textContent).toBe('');
        expect(clear.hidden).toBe(true);
    });

    it('shows a quiet no-match notice when nothing matches', async () => {
        setStructureLens('code');
        state.manifests['rsterenchak/toDoList_TOP'] = { ok: true, files: ['src/main.js'] };
        renderStructureView();
        await flush();

        typeFilter('zzzznope');
        const note = document.querySelector('.structureFilterNoMatch');
        expect(note).toBeTruthy();
        expect(note.textContent).toMatch(/no matches for/i);
        expect(note.textContent).toContain('zzzznope');
        expect(document.querySelector('.structureFilterCount').textContent).toBe('0 of 1');
    });

    it('UI lens: filters live regions by label or selector', async () => {
        setStructureLens('ui');
        mountUiDom();
        renderStructureView();
        await flush();

        // Match by label: "Tasks" keeps the #mainPanel region.
        typeFilter('tasks');
        const visibleSelectors = Array.from(document.querySelectorAll('.structureRegionWrap'))
            .filter((w) => !w.classList.contains('structureFilterHidden'))
            .map((w) => w.querySelector('.structureRegionSelector').textContent);
        expect(visibleSelectors).toContain('#mainPanel');
        // The id-less Sidebar region (selector [data-region="Sidebar"]) is hidden.
        const sidebar = Array.from(document.querySelectorAll('.structureRegionWrap'))
            .find((w) => w.querySelector('.structureRegionSelector').textContent === '[data-region="Sidebar"]');
        expect(sidebar.classList.contains('structureFilterHidden')).toBe(true);
    });

    it('published UI map: filters by grouping file and keeps that file’s rows', async () => {
        mountDom('Game');
        state.runningRepo = 'rsterenchak/toDoList_TOP';
        setStructureLens('ui');
        state.manifests[OTHER] = {
            ok: true,
            files: ['board.js', 'hud.js'],
            hasDom: true,
            srcRoot: 'src',
            regions: [
                { selector: '#board', label: 'Board', file: 'board.js', line: 12, files: [{ file: 'board.js', line: 12 }] },
                { selector: '[data-region="HUD"]', label: 'HUD', file: 'hud.js', line: 40, files: [{ file: 'hud.js', line: 40 }] },
            ],
        };
        renderStructureView();
        await flush();

        // Filtering by the grouping file name keeps that group's rows and hides
        // the other file group entirely.
        typeFilter('hud.js');
        const visibleRows = Array.from(document.querySelectorAll('.structureRegionWrap'))
            .filter((w) => isVisibleUnder(w))
            .map((w) => w.querySelector('.structureRegionLabel').textContent);
        expect(visibleRows).toEqual(['HUD']);
    });

    function isVisibleUnder(el) {
        let n = el;
        while (n && !n.classList.contains('structureTree')) {
            if (n.classList.contains('structureFilterHidden')) return false;
            n = n.parentElement;
        }
        return true;
    }
});

describe('renderStructureView — persisted tree open/closed state (per repo + lens)', () => {
    const TOP = 'rsterenchak/toDoList_TOP';
    const OTHER = 'rsterenchak/matchingGame-test';

    beforeEach(async () => {
        try { localStorage.removeItem(STRUCTURE_TREE_KEY); } catch (e) { /* ignore */ }
        state.runningRepo = TOP;
        // The module keeps `selectedRepo` and its fold sets across renders by
        // design (a same-repo re-render is not a reload). Park selection on a
        // neutral repo that no test targets, so each test's first render for TOP
        // or OTHER is a genuine repo change — a clean reload-like hydration that
        // isolates it from module state a prior test left behind.
        state.projectRepos['__neutral__'] = 'rsterenchak/__neutral__';
        mountDom('__neutral__');
        renderStructureView();
        await flush();
    });

    // Re-point the view at a project (and thus its repo) from a fresh DOM, as a
    // page would after a reload or a project switch.
    async function renderFor(project) {
        mountDom(project);
        renderStructureView();
        await flush();
    }

    function folderByName(name) {
        return Array.from(document.querySelectorAll('.structureFolderRow'))
            .find((h) => h.querySelector('.structureFolderName').textContent === name);
    }

    it('Code lens: an expanded folder is restored after switching repos away and back', async () => {
        setStructureLens('code');
        state.manifests[TOP] = { ok: true, files: ['src/main.js', 'src/util/a.js'] };
        state.manifests[OTHER] = { ok: true, files: ['game.js'] };

        await renderFor('My Project');
        let src = folderByName('src');
        expect(src.nextElementSibling.hidden).toBe(true); // collapsed by default
        src.click();
        expect(src.nextElementSibling.hidden).toBe(false);
        // The open folder path was persisted under repo + lens.
        expect(getStructureTreeState(TOP, 'code')).toContain('src');

        // Switch to another repo (resets live state), then back — a reload-like cycle.
        await renderFor('Game');
        await renderFor('My Project');

        src = folderByName('src');
        expect(src.getAttribute('aria-expanded')).toBe('true');
        expect(src.nextElementSibling.hidden).toBe(false);
    });

    it('Code lens: collapsing a previously open folder clears it from storage', async () => {
        setStructureLens('code');
        state.manifests[TOP] = { ok: true, files: ['src/main.js'] };
        await renderFor('My Project');

        const folder = document.querySelector('.structureFolderRow');
        folder.click(); // open
        expect(getStructureTreeState(TOP, 'code')).toContain('src');
        folder.click(); // close
        expect(getStructureTreeState(TOP, 'code') || []).not.toContain('src');
    });

    it('Published UI map: a collapsed file group is restored after a reload cycle', async () => {
        setStructureLens('ui');
        state.manifests[OTHER] = {
            ok: true, files: ['app.js'], hasDom: true, srcRoot: 'src',
            regions: [{ selector: '#board', label: 'Board', file: 'app.js', line: 12, files: [{ file: 'app.js', line: 12 }] }],
        };
        await renderFor('Game');

        let header = document.querySelector('.structureFolderRow');
        expect(header.nextSibling.hidden).toBe(false); // expanded by default
        header.click(); // collapse
        expect(header.nextSibling.hidden).toBe(true);
        // The published map records collapsed headers as its exception set.
        expect(getStructureTreeState(OTHER, 'ui')).toContain('app.js');

        // Reload: park on the running repo (live map), then back to Game.
        await renderFor('My Project');
        await renderFor('Game');

        header = document.querySelector('.structureFolderRow');
        expect(header.getAttribute('aria-expanded')).toBe('false');
        expect(header.nextSibling.hidden).toBe(true);
    });

    it('Live UI map: an expanded region is restored after a reload cycle', async () => {
        setStructureLens('ui');
        state.runningRepo = TOP;
        function mountLive() {
            document.body.innerHTML =
                '<div id="structureView"></div>' +
                '<div class="selectedProject"><input id="projInput" value="My Project"></div>' +
                '<main id="mainPanel" data-region="Tasks"><section data-region="Sidebar"></section></main>';
        }
        function mainPanelRow() {
            return Array.from(document.querySelectorAll('.structureRegionRow'))
                .find((r) => r.querySelector('.structureRegionSelector').textContent === '#mainPanel');
        }

        mountLive();
        renderStructureView();
        await flush();

        let row = mainPanelRow();
        let childWrap = row.parentNode.querySelector('.structureRegionChildren');
        expect(childWrap.hidden).toBe(true); // collapsed by default
        row.querySelector('.structureRegionCaret').click();
        expect(childWrap.hidden).toBe(false);
        // The live map records open region selectors as its exception set.
        expect(getStructureTreeState(TOP, 'ui')).toContain('#mainPanel');

        // Reload: park on the other repo, then re-render the live map.
        await renderFor('Game');
        mountLive();
        renderStructureView();
        await flush();

        row = mainPanelRow();
        childWrap = row.parentNode.querySelector('.structureRegionChildren');
        expect(childWrap.hidden).toBe(false);
        expect(row.classList.contains('expanded')).toBe(true);
    });

    it('keeps each repo + lens state independent', async () => {
        setStructureLens('code');
        state.manifests[TOP] = { ok: true, files: ['src/main.js'] };
        state.manifests[OTHER] = { ok: true, files: ['lib/x.js'] };

        await renderFor('My Project');
        folderByName('src').click();
        await renderFor('Game');
        folderByName('lib').click();

        expect(getStructureTreeState(TOP, 'code')).toEqual(['src']);
        expect(getStructureTreeState(OTHER, 'code')).toEqual(['lib']);
    });

    it('the filter’s temporary auto-expand is not persisted (only manual toggles persist)', async () => {
        setStructureLens('code');
        state.manifests[TOP] = { ok: true, files: ['src/util/a.js'] };
        await renderFor('My Project');
        // Nothing stored before any manual toggle.
        expect(getStructureTreeState(TOP, 'code')).toBeNull();

        // Typing a query that matches the nested file auto-expands its ancestors.
        const input = document.querySelector('.structureFilterInput');
        input.value = 'a.js';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flush();
        const util = folderByName('util');
        expect(util.nextElementSibling.hidden).toBe(false); // revealed by the filter

        // …but the auto-expand was never written to storage.
        expect(getStructureTreeState(TOP, 'code')).toBeNull();
    });
});

describe('renderStructureView — adaptive second lens (Types for a C# repo)', () => {
    const OTHER = 'rsterenchak/matchingGame-test';

    // A C# manifest: empty srcRoot (repo-root-relative file paths), lens 'types',
    // and a types array of classes/interfaces each carrying a members list.
    function typesManifest() {
        return {
            ok: true,
            files: ['LinearSearch/BST.cs'],
            hasDom: false,
            lens: 'types',
            srcRoot: '',
            types: [
                {
                    kind: 'class', name: 'BinarySearchTree', file: 'LinearSearch/BST.cs', line: 5,
                    members: [
                        { signature: 'Insert(int value)', name: 'Insert', line: 12 },
                        { signature: 'Count : int', name: 'Count', line: 30 },
                    ],
                },
                { kind: 'interface', name: 'IComparable', file: 'LinearSearch/BST.cs', line: 60, members: [] },
            ],
        };
    }

    beforeEach(async () => {
        try { localStorage.removeItem(STRUCTURE_TREE_KEY); } catch (e) { /* ignore */ }
        state.runningRepo = 'rsterenchak/toDoList_TOP';
        // The persisted lens choice is "second slot" — stored as 'ui'. A types repo
        // must still land on its Types outline via the active-lens normalization.
        setStructureLens('ui');
        // Park on a neutral repo so the first render for OTHER is a clean repo change
        // (a reload-like hydration that isolates each test from prior module state).
        state.projectRepos['__neutral__'] = 'rsterenchak/__neutral__';
        mountDom('__neutral__');
        renderStructureView();
        await flush();
    });

    async function renderTypesRepo() {
        state.manifests[OTHER] = typesManifest();
        mountDom('Game');
        renderStructureView();
        await flush();
    }

    it('relabels the second toggle segment to Types and renders the class/member outline', async () => {
        await renderTypesRepo();

        const btns = Array.from(document.querySelectorAll('.structureLensBtn'));
        expect(btns.map((b) => b.textContent)).toEqual(['Types', 'Code']);
        const second = btns.find((b) => b.dataset.lens === 'types');
        expect(second).toBeTruthy();
        // Persisted choice was 'ui', but normalization keeps the user on the second
        // slot with this repo's identity — Types is the active segment.
        expect(second.getAttribute('aria-selected')).toBe('true');

        // One collapsible file-group header per defining file.
        const headers = Array.from(document.querySelectorAll('.structureFolderName')).map((n) => n.textContent);
        expect(headers).toContain('LinearSearch/BST.cs');

        // Type rows show kind + name; member rows show the signature.
        const labels = Array.from(document.querySelectorAll('.structureTypeLabel')).map((n) => n.textContent);
        expect(labels).toContain('class BinarySearchTree');
        expect(labels).toContain('interface IComparable');
        expect(labels).toContain('Insert(int value)');
        expect(labels).toContain('Count : int');
    });

    it('switching to Code and back keeps the second slot on Types for a types repo', async () => {
        await renderTypesRepo();
        expect(document.querySelector('.structureTypeLabel')).toBeTruthy();

        const codeBtn = Array.from(document.querySelectorAll('.structureLensBtn')).find((b) => b.dataset.lens === 'code');
        codeBtn.click();
        await flush();
        // Code lens shows the source tree, not the type outline.
        expect(document.querySelector('.structureTypeLabel')).toBeFalsy();
        expect(document.querySelector('.structureFolderName').textContent).toBe('LinearSearch');

        const second = Array.from(document.querySelectorAll('.structureLensBtn')).find((b) => b.dataset.lens === 'types');
        second.click();
        await flush();
        expect(document.querySelector('.structureTypeLabel')).toBeTruthy();
    });

    it('a type row exposes Reference/Copy/Find and a GitHub deep link; members carry their own line', async () => {
        await renderTypesRepo();

        const rows = Array.from(document.querySelectorAll('.structureRegionRow'));
        const labelOf = (r) => {
            const l = r.querySelector('.structureTypeLabel');
            return l ? l.textContent : '';
        };
        const typeRow = rows.find((r) => labelOf(r) === 'class BinarySearchTree');
        expect(typeRow).toBeTruthy();
        const toolbar = document.querySelector('.structureActionToolbar');
        expect(toolbar.classList.contains('structureActionToolbar--idle')).toBe(true);
        typeRow.click();
        expect(toolbar.classList.contains('structureActionToolbar--idle')).toBe(false);

        // Empty srcRoot → repo-root-relative blob path at the type's line, no double slash.
        const gh = toolbar.querySelector('.structureGithubLink');
        expect(gh.getAttribute('href')).toBe('https://github.com/' + OTHER + '/blob/main/LinearSearch/BST.cs#L5');

        // Reference reframes onto the repo and hands off label + name; Copy writes the name.
        toolbar.querySelector('.structureReferenceBtn').click();
        expect(setChatWorkspaceRepo).toHaveBeenCalledWith(OTHER);
        expect(insertReference).toHaveBeenCalledWith('class BinarySearchTree', 'BinarySearchTree');

        const writeText = vi.fn(() => Promise.resolve());
        const priorClipboard = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        toolbar.querySelector('.structureCopyBtn').click();
        expect(writeText).toHaveBeenCalledWith('BinarySearchTree');
        if (priorClipboard === undefined) delete navigator.clipboard;
        else Object.defineProperty(navigator, 'clipboard', { value: priorClipboard, configurable: true });

        // Selecting a member row repaints the shared toolbar with the member's own
        // GitHub link, pointing at the member's line.
        const memberRow = rows.find((r) => labelOf(r) === 'Insert(int value)');
        expect(memberRow).toBeTruthy();
        memberRow.click();
        const mGh = toolbar.querySelector('.structureGithubLink');
        expect(mGh.getAttribute('href')).toBe('https://github.com/' + OTHER + '/blob/main/LinearSearch/BST.cs#L12');
    });

    it('shows the empty notice when a types manifest has no types', async () => {
        state.manifests[OTHER] = { ok: true, files: [], hasDom: false, lens: 'types', srcRoot: '', types: [] };
        mountDom('Game');
        renderStructureView();
        await flush();
        const notice = document.querySelector('.structureNoUiMap');
        expect(notice).toBeTruthy();
        expect(notice.textContent).toMatch(/no types found/i);
    });

    it('filtering by a member signature reveals its file group and type, hiding non-matches', async () => {
        await renderTypesRepo();

        const input = document.querySelector('.structureFilterInput');
        input.value = 'Insert';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await flush();

        const memberLabel = Array.from(document.querySelectorAll('.structureTypeLabel'))
            .find((n) => n.textContent === 'Insert(int value)');
        expect(memberLabel).toBeTruthy();
        const memberWrap = memberLabel.closest('.structureRegionWrap');
        expect(memberWrap.classList.contains('structureFilterHidden')).toBe(false);

        // Its containing type wrap and file group are revealed so the match stays reachable.
        const typeWrap = memberWrap.parentElement.closest('.structureRegionWrap');
        expect(typeWrap).toBeTruthy();
        expect(typeWrap.classList.contains('structureFilterHidden')).toBe(false);
        const group = memberWrap.closest('.structurePublishedFileGroup');
        expect(group.classList.contains('structureFilterHidden')).toBe(false);

        // A non-matching sibling type is hidden.
        const ifaceLabel = Array.from(document.querySelectorAll('.structureTypeLabel'))
            .find((n) => n.textContent === 'interface IComparable');
        expect(ifaceLabel.closest('.structureRegionWrap').classList.contains('structureFilterHidden')).toBe(true);
    });

    it('persists a collapsed type file group under the repo:types key across a reload cycle', async () => {
        await renderTypesRepo();

        let header = document.querySelector('.structureFolderRow');
        expect(header.nextSibling.hidden).toBe(false); // expanded by default
        header.click(); // collapse
        expect(header.nextSibling.hidden).toBe(true);
        expect(getStructureTreeState(OTHER, 'types')).toContain('LinearSearch/BST.cs');

        // Reload: park on the running repo, then back to the types repo.
        mountDom('My Project');
        renderStructureView();
        await flush();
        state.manifests[OTHER] = typesManifest();
        mountDom('Game');
        renderStructureView();
        await flush();

        header = document.querySelector('.structureFolderRow');
        expect(header.getAttribute('aria-expanded')).toBe('false');
        expect(header.nextSibling.hidden).toBe(true);
    });

    it('labels the copy action "Copy name" on a type row', async () => {
        await renderTypesRepo();

        const rows = Array.from(document.querySelectorAll('.structureRegionRow'));
        const labelOf = (r) => {
            const l = r.querySelector('.structureTypeLabel');
            return l ? l.textContent : '';
        };
        const typeRow = rows.find((r) => labelOf(r) === 'class BinarySearchTree');
        typeRow.click();
        const toolbar = document.querySelector('.structureActionToolbar');
        expect(toolbar.querySelector('.structureCopyBtn').textContent).toBe('Copy name');
    });

    it('Find in code lists every definition of a name from the type index, sorted by file then line', async () => {
        // Two classes in different files each define a member named `Reset`; Find in
        // code must surface both definitions, which a single-line GitHub link can't.
        state.manifests[OTHER] = {
            ok: true, files: ['A.cs', 'B.cs'], hasDom: false, lens: 'types', srcRoot: '',
            types: [
                {
                    kind: 'class', name: 'Node', file: 'B.cs', line: 40,
                    members: [{ signature: 'Reset()', name: 'Reset', line: 44 }],
                },
                {
                    kind: 'class', name: 'Tree', file: 'A.cs', line: 5,
                    members: [{ signature: 'Reset()', name: 'Reset', line: 9 }],
                },
            ],
        };
        mountDom('Game');
        renderStructureView();
        await flush();

        const rows = Array.from(document.querySelectorAll('.structureRegionRow'));
        const labelOf = (r) => {
            const l = r.querySelector('.structureTypeLabel');
            return l ? l.textContent : '';
        };
        const resetRow = rows.find((r) => labelOf(r) === 'Reset()');
        expect(resetRow).toBeTruthy();
        resetRow.click();
        const toolbar = document.querySelector('.structureActionToolbar');
        toolbar.querySelector('.structureFindBtn').click();
        await flush();

        const owners = Array.from(toolbar.querySelectorAll('.structureOwnerFileBtn')).map((b) => b.textContent);
        expect(owners).toEqual(['A.cs:9', 'B.cs:44']);

        // The owner file row taps through to the Code lens, like the UI-lens Find.
        toolbar.querySelector('.structureOwnerFileBtn').click();
        await flush();
        expect(localStorage.getItem(STRUCTURE_LENS_KEY)).toBe('code');
    });

    it('a manifest without a lens field keeps the UI lens (back-compat)', async () => {
        state.manifests[OTHER] = {
            ok: true, files: ['app.js'], hasDom: true, srcRoot: 'src',
            regions: [{ selector: '#board', label: 'Board', file: 'app.js', line: 12, files: [{ file: 'app.js', line: 12 }] }],
        };
        mountDom('Game');
        renderStructureView();
        await flush();

        const btns = Array.from(document.querySelectorAll('.structureLensBtn'));
        expect(btns.map((b) => b.textContent)).toEqual(['UI', 'Code']);
        expect(document.querySelector('.structureTypeLabel')).toBeFalsy();
        expect(document.querySelector('.structurePublishedBanner')).toBeTruthy();
    });
});

describe('renderStructureView — collapse / expand all toolbar pill', () => {
    const TOP = 'rsterenchak/toDoList_TOP';
    const OTHER = 'rsterenchak/matchingGame-test';

    beforeEach(async () => {
        try { localStorage.removeItem(STRUCTURE_TREE_KEY); } catch (e) { /* ignore */ }
        state.runningRepo = TOP;
        // Park selection on a neutral repo so each test's first render for a target
        // repo is a genuine repo change (clean fold-set hydration), isolating it
        // from module state a prior test left behind.
        state.projectRepos['__neutral__'] = 'rsterenchak/__neutral__';
        mountDom('__neutral__');
        renderStructureView();
        await flush();
    });

    async function renderFor(project) {
        mountDom(project);
        renderStructureView();
        await flush();
    }

    const pill = () => document.querySelector('.structureCollapseAllPill');
    const folderChildren = () =>
        Array.from(document.querySelectorAll('.structureFolderChildren'));

    it('renders the pill in a toolbar strip when the lens has collapsible sections', async () => {
        setStructureLens('code');
        state.manifests[TOP] = { ok: true, files: ['src/main.js', 'lib/x.js'] };
        await renderFor('My Project');

        const toolbar = document.querySelector('.structureToolbar');
        expect(toolbar).toBeTruthy();
        expect(toolbar.hidden).toBe(false);
        expect(pill()).toBeTruthy();
        // Code-lens folders default collapsed, so the next action is to expand.
        expect(pill().textContent).toBe('Expand all');
    });

    it('hides the toolbar when the lens has no collapsible sections', async () => {
        setStructureLens('code');
        // A flat list of top-level files — no folders, so nothing to fold.
        state.manifests[TOP] = { ok: true, files: ['README.md', 'LICENSE'] };
        await renderFor('My Project');

        expect(document.querySelector('.structureFolderRow')).toBeFalsy();
        expect(document.querySelector('.structureToolbar').hidden).toBe(true);
    });

    it('Expand all opens every section then relabels; clicking again re-collapses', async () => {
        setStructureLens('code');
        state.manifests[TOP] = {
            ok: true,
            files: ['src/main.js', 'src/util/a.js', 'lib/x.js'],
        };
        await renderFor('My Project');

        // src, util (nested), lib → three folder sections, all collapsed by default.
        let kids = folderChildren();
        expect(kids.length).toBe(3);
        expect(kids.every((c) => c.hidden)).toBe(true);
        expect(pill().textContent).toBe('Expand all');

        pill().click();
        kids = folderChildren();
        expect(kids.every((c) => !c.hidden)).toBe(true);
        // Every section head carries the open chevron state in sync.
        expect(Array.from(document.querySelectorAll('.structureFolderRow'))
            .every((h) => h.classList.contains('expanded'))).toBe(true);
        expect(pill().textContent).toBe('Collapse all');

        pill().click();
        kids = folderChildren();
        expect(kids.every((c) => c.hidden)).toBe(true);
        expect(pill().textContent).toBe('Expand all');
    });

    it('a per-section chevron toggle keeps the pill label in sync', async () => {
        setStructureLens('code');
        state.manifests[TOP] = { ok: true, files: ['src/main.js', 'lib/x.js'] };
        await renderFor('My Project');

        pill().click(); // expand everything
        expect(pill().textContent).toBe('Collapse all');

        // Collapse one folder by its own chevron — the pill must flip to Expand all.
        const folder = document.querySelector('.structureFolderRow');
        folder.click();
        await tick(); // the capture-phase listener relabels on the next microtask
        expect(pill().textContent).toBe('Expand all');
    });

    it('the bulk fold is UI-only and never written to persisted tree state', async () => {
        setStructureLens('code');
        state.manifests[TOP] = { ok: true, files: ['src/main.js', 'lib/x.js'] };
        await renderFor('My Project');

        pill().click(); // expand all
        pill().click(); // collapse all
        // Per-section toggles persist; the bulk pill must not. Nothing was clicked
        // individually, so the Code-lens open-folder set stays empty.
        expect(getStructureTreeState(TOP, 'code') || []).toEqual([]);
    });

    it('Published UI map: file groups default open, so the pill starts on Collapse all', async () => {
        setStructureLens('ui');
        state.runningRepo = TOP; // OTHER is the non-running repo → published map
        state.manifests[OTHER] = {
            ok: true,
            files: ['app.js'],
            hasDom: true,
            srcRoot: 'src',
            regions: [
                { selector: '#board', label: 'Board', file: 'app.js', line: 12, files: [{ file: 'app.js', line: 12 }] },
                { selector: '#hud', label: 'HUD', file: 'ui.js', line: 5, files: [{ file: 'ui.js', line: 5 }] },
            ],
        };
        await renderFor('Game');

        expect(pill().textContent).toBe('Collapse all');
        pill().click();
        // Both file-group children wraps collapse.
        expect(folderChildren().every((c) => c.hidden)).toBe(true);
        expect(pill().textContent).toBe('Expand all');
    });
});
