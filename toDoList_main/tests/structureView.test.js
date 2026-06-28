import { vi } from 'vitest';

// The STRUCTURE view renders a cross-repo map with two lenses:
//   • Code lens — a collapsible folder/file tree built from the selected repo's
//     published src-manifest.json, with a per-file "Explain with Sonnet" action.
//   • UI lens — a live, tappable map of the running app's on-screen regions,
//     walked from the DOM, with per-region "Reference in chat" / "Copy selector".
// A Code/UI toggle (persisted via prefs, default UI) swaps between them, and the
// repo picker is bound to the chat workspace.
//
// These tests drive renderStructureView against a jsdom DOM with its
// collaborators mocked:
//   • claudeSheet.js — loadManifest (canned manifest), getAttachRepos (the repo
//     allowlist), getActiveChatRepo (the default selection), getRunningAppRepo
//     (which repo maps live), setChatWorkspaceRepo (workspace binding spy), and
//     insertReference (reference-in-chat spy).
//   • inject.js — chatWithWorker, captured so we can assert the Explain turn's
//     attached file + repo + Fast-mode flag and feed back a canned reply.
const { state } = vi.hoisted(() => ({
    state: {
        repos: ['rsterenchak/toDoList_TOP', 'rsterenchak/matchingGame-test'],
        activeRepo: 'rsterenchak/toDoList_TOP',
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
    getAttachRepos: vi.fn(function () { return state.repos.slice(); }),
    getActiveChatRepo: vi.fn(function () { return state.activeRepo; }),
    getRunningAppRepo: vi.fn(function () { return state.runningRepo; }),
    setChatWorkspaceRepo: vi.fn(),
    insertReference: vi.fn(),
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
import { setStructureLens, STRUCTURE_LENS_KEY } from '../src/prefs.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) {
    for (let i = 0; i < n; i++) await tick();
}

function mountDom() {
    document.body.innerHTML = '<div id="structureView"></div>';
}

beforeEach(() => {
    mountDom();
    state.repos = ['rsterenchak/toDoList_TOP', 'rsterenchak/matchingGame-test'];
    state.activeRepo = 'rsterenchak/toDoList_TOP';
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

describe('renderStructureView — repo picker', () => {
    it('populates the picker from getAttachRepos and defaults to the active chat repo', async () => {
        state.activeRepo = 'rsterenchak/matchingGame-test';
        renderStructureView();
        await flush();
        const picker = document.getElementById('structureRepoPicker');
        expect(picker).toBeTruthy();
        const values = Array.from(picker.options).map((o) => o.value);
        expect(values).toEqual(state.repos);
        expect(picker.value).toBe('rsterenchak/matchingGame-test');
    });

    it('short-circuits cleanly when the container is absent', () => {
        document.body.innerHTML = '';
        expect(() => renderStructureView()).not.toThrow();
    });

    it('binds the picker to the chat workspace: selecting a repo reframes the conversation', async () => {
        // Run under the Code lens so the change handler isn't competing with a
        // live DOM walk; the workspace binding is lens-independent.
        setStructureLens('code');
        renderStructureView();
        await flush();
        const picker = document.getElementById('structureRepoPicker');
        picker.value = 'rsterenchak/matchingGame-test';
        picker.dispatchEvent(new Event('change'));
        await flush();
        expect(setChatWorkspaceRepo).toHaveBeenCalledWith('rsterenchak/matchingGame-test');
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

describe('renderStructureView — UI lens', () => {
    beforeEach(() => {
        state.repos = ['rsterenchak/toDoList_TOP'];
        setStructureLens('ui');
    });

    // The UI lens walks `document` — so the view container plus some sample
    // regions must live on the page. mountUiDom appends regions alongside the
    // structureView container, then we render into the latter.
    function mountUiDom(extraHtml) {
        document.body.innerHTML =
            '<div id="structureView"></div>' +
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

    it('shows a "no published UI map yet" notice for a non-running repo', async () => {
        state.repos = ['rsterenchak/matchingGame-test'];
        state.activeRepo = 'rsterenchak/matchingGame-test';
        state.runningRepo = 'rsterenchak/toDoList_TOP';
        mountUiDom();
        renderStructureView();
        await flush();
        const notice = document.querySelector('.structureNoUiMap');
        expect(notice).toBeTruthy();
        expect(notice.textContent).toMatch(/no published ui map/i);
    });
});
