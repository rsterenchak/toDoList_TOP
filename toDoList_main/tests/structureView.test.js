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

import { renderStructureView } from '../src/structureView.js';
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

    it('excludes the Structure view and chat surfaces from the map', async () => {
        mountUiDom(
            '<div id="desktopChatPane"><div id="chatInside" data-region="ChatInside"></div></div>' +
            '<div id="claudeSheet"><div id="sheetInside"></div></div>'
        );
        renderStructureView();
        await flush();
        const selectors = Array.from(document.querySelectorAll('.structureRegionSelector')).map((n) => n.textContent);
        expect(selectors).not.toContain('#desktopChatPane');
        expect(selectors).not.toContain('#claudeSheet');
        expect(selectors).not.toContain('#chatInside');
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

    it('tapping a region reveals its actions; Reference in chat hands the selector off', async () => {
        mountUiDom();
        renderStructureView();
        await flush();

        // Find the #taskList region row and toggle its action panel.
        const rows = Array.from(document.querySelectorAll('.structureRegionRow'));
        const taskRow = rows.find((r) => r.querySelector('.structureRegionSelector').textContent === '#taskList');
        expect(taskRow).toBeTruthy();
        const actions = taskRow.parentNode.querySelector('.structureRegionActions');
        expect(actions.hidden).toBe(true);
        taskRow.click();
        expect(actions.hidden).toBe(false);

        actions.querySelector('.structureReferenceBtn').click();
        expect(insertReference).toHaveBeenCalledWith('Task List', '#taskList');
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

    it('a published region row exposes Find in code and a GitHub deep link to its file', async () => {
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
        const actions = row.parentNode.querySelector('.structureRegionActions');
        expect(actions.hidden).toBe(true);
        row.click();
        expect(actions.hidden).toBe(false);

        const gh = actions.querySelector('.structureGithubLink');
        expect(gh).toBeTruthy();
        expect(gh.getAttribute('href')).toBe('https://github.com/' + OTHER + '/blob/main/pkg/src/app.js#L12');

        // Find in code reveals the owner file row.
        actions.querySelector('.structureFindBtn').click();
        await flush();
        const owner = actions.querySelector('.structureOwnerFileBtn');
        expect(owner).toBeTruthy();
        expect(owner.textContent).toBe('app.js:12');
    });

    it('a published region row also exposes Reference in chat and Copy selector', async () => {
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
        const actions = row.parentNode.querySelector('.structureRegionActions');
        row.click();
        expect(actions.hidden).toBe(false);

        // Reference in chat reframes onto the published repo and hands off the
        // region's label + selector — identical contract to the live row.
        const refBtn = actions.querySelector('.structureReferenceBtn');
        expect(refBtn).toBeTruthy();
        refBtn.click();
        expect(setChatWorkspaceRepo).toHaveBeenCalledWith(OTHER);
        expect(insertReference).toHaveBeenCalledWith('Card', '.card');

        // Copy selector writes the region's selector to the clipboard.
        const writeText = vi.fn(() => Promise.resolve());
        const priorClipboard = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const copyBtn = actions.querySelector('.structureCopyBtn');
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
        const note = row.parentNode.querySelector('.structureRegionNote');
        expect(note.textContent).toBe('Line 5.');
        expect(note.textContent).not.toMatch(/app\.js/);
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
        taskRow.click(); // open actions
        const actions = taskRow.parentNode.querySelector('.structureRegionActions');
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
