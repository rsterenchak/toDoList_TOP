import { vi } from 'vitest';

// The STRUCTURE view renders a cross-repo source map: a repo picker plus a
// collapsible folder/file tree built from the selected repo's published
// src-manifest.json, with a per-file "Explain with Sonnet" action. These tests
// drive renderStructureView against a jsdom DOM with its collaborators mocked:
//   • claudeSheet.js — loadManifest (canned manifest), getAttachRepos (the repo
//     allowlist), getActiveChatRepo (the default selection).
//   • inject.js — chatWithWorker, captured so we can assert the Explain turn's
//     attached file + repo + Fast-mode flag and feed back a canned reply.
const { state } = vi.hoisted(() => ({
    state: {
        repos: ['rsterenchak/toDoList_TOP', 'rsterenchak/matchingGame-test'],
        activeRepo: 'rsterenchak/toDoList_TOP',
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
}));

vi.mock('../src/inject.js', () => ({
    chatWithWorker: vi.fn(function (messages, entryId, attach, repo, suggested, deep) {
        state.lastChatCall = { messages, entryId, attach, repo, suggested, deep };
        if (state.explainError) return Promise.reject(state.explainError);
        return Promise.resolve({ reply: state.explainReply });
    }),
}));

import { renderStructureView } from '../src/structureView.js';
import { chatWithWorker } from '../src/inject.js';

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
    state.manifests = {};
    state.explainReply = 'This file does a thing.';
    state.explainError = null;
    state.lastChatCall = null;
    chatWithWorker.mockClear();
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
});

describe('renderStructureView — source tree', () => {
    // Pin the allowlist to the single default repo so the module-scoped
    // selection (which persists across renders by design) resolves to it
    // regardless of any selection a prior test left behind.
    beforeEach(() => { state.repos = ['rsterenchak/toDoList_TOP']; });

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

describe('renderStructureView — Explain with Sonnet', () => {
    beforeEach(() => { state.repos = ['rsterenchak/toDoList_TOP']; });

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
