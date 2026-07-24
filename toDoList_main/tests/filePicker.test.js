import { describe, it, expect, vi, beforeEach } from 'vitest';

// Behavioral pins for the shared File:-path picker. The manifest read reaches
// out to listLogic (project → target id), inject.js (target id → repo), and
// claudeSheet.js (repo → cached manifest); mock those three seams so the picker
// can be exercised end-to-end in jsdom without the full app graph.

vi.mock('../src/claudeSheet.js', () => ({
    getCachedManifest: vi.fn(),
    loadManifest: vi.fn(),
}));
vi.mock('../src/inject.js', () => ({
    findTargetById: vi.fn(),
}));
vi.mock('../src/listLogic.js', () => ({
    listLogic: { getProjectTargetId: vi.fn(), saveToStorage: vi.fn() },
}));

import { createFilePicker, insertFilePathIntoEntry } from '../src/filePicker.js';
import { getCachedManifest, loadManifest } from '../src/claudeSheet.js';
import { findTargetById } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

// Warm cache: the repo is linked AND its manifest is already loaded, so the
// picker renders synchronously with no on-demand load.
function withManifest(files) {
    listLogic.getProjectTargetId.mockReturnValue('target-1');
    findTargetById.mockReturnValue({ id: 'target-1', repo: 'owner/repo' });
    getCachedManifest.mockReturnValue({ ok: true, files });
}

// Cold cache: the repo is linked but nothing is cached yet, so opening the
// picker loads the manifest on demand. `loadManifest` resolves to `result`.
function withColdManifest(result) {
    listLogic.getProjectTargetId.mockReturnValue('target-1');
    findTargetById.mockReturnValue({ id: 'target-1', repo: 'owner/cold-' + Math.random() });
    getCachedManifest.mockReturnValue(null);
    loadManifest.mockResolvedValue(result);
}

// Mount a picker's panel so the on-demand load's isConnected guard passes.
function mount(picker) {
    document.body.appendChild(picker.trigger);
    document.body.appendChild(picker.panel);
}

// Flush all pending microtasks (the load chain hops through several .then's).
function flush() {
    return new Promise((res) => setTimeout(res, 0));
}

describe('createFilePicker — availability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('is unavailable and hides the trigger when the project has no linked target', () => {
        listLogic.getProjectTargetId.mockReturnValue(null);
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        expect(picker.available).toBe(false);
        expect(picker.trigger.style.display).toBe('none');
        expect(picker.panel.hidden).toBe(true);
    });

    it('is available and shows the trigger when the repo is linked but the manifest is not yet loaded', () => {
        listLogic.getProjectTargetId.mockReturnValue('target-1');
        findTargetById.mockReturnValue({ id: 'target-1', repo: 'owner/repo' });
        getCachedManifest.mockReturnValue(null);
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        // The trigger is present because a routing target exists — whether the
        // repo has files is only knowable after opening.
        expect(picker.available).toBe(true);
        expect(picker.trigger.style.display).not.toBe('none');
    });

    it('is available and shows the trigger when the manifest has files', () => {
        withManifest(['src/a.js', 'src/b.js']);
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        expect(picker.available).toBe(true);
        expect(picker.trigger.style.display).not.toBe('none');
        expect(picker.trigger.className).toContain('filePickTrigger');
        expect(picker.panel.className).toContain('filePickPanel');
    });
});

describe('createFilePicker — on-demand manifest load', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads the manifest on first open when the cache is cold, showing a loading state then the files', async () => {
        withColdManifest({ ok: true, files: ['src/a.js', 'src/b.js'] });
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        mount(picker);
        picker.trigger.click();
        // Loading line paints synchronously before the load resolves.
        expect(picker.panel.querySelector('.filePickLoading')).not.toBeNull();
        expect(loadManifest).toHaveBeenCalledTimes(1);
        await flush();
        const rows = picker.panel.querySelectorAll('.filePickRow');
        expect(rows.length).toBe(2);
        expect(picker.panel.querySelector('.filePickLoading')).toBeNull();
    });

    it('does not refetch on a second open once loaded', async () => {
        withColdManifest({ ok: true, files: ['src/a.js'] });
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        mount(picker);
        picker.trigger.click();
        await flush();
        expect(loadManifest).toHaveBeenCalledTimes(1);
        picker.trigger.click(); // close
        picker.trigger.click(); // re-open
        await Promise.resolve();
        expect(loadManifest).toHaveBeenCalledTimes(1);
        expect(picker.panel.querySelectorAll('.filePickRow').length).toBe(1);
    });

    it('reuses the in-flight load when two hosts open the same repo concurrently', async () => {
        listLogic.getProjectTargetId.mockReturnValue('target-1');
        findTargetById.mockReturnValue({ id: 'target-1', repo: 'owner/shared-' + Math.random() });
        getCachedManifest.mockReturnValue(null);
        let resolveLoad;
        loadManifest.mockReturnValue(new Promise((res) => { resolveLoad = res; }));

        const ta1 = document.createElement('textarea');
        const ta2 = document.createElement('textarea');
        const p1 = createFilePicker({ projectName: 'P', textarea: ta1 });
        const p2 = createFilePicker({ projectName: 'P', textarea: ta2 });
        mount(p1);
        mount(p2);
        p1.trigger.click();
        p2.trigger.click();
        // Both opened while the single load is still outstanding → one fetch.
        expect(loadManifest).toHaveBeenCalledTimes(1);
        resolveLoad({ ok: true, files: ['src/a.js'] });
        await flush();
        expect(p1.panel.querySelectorAll('.filePickRow').length).toBe(1);
        expect(p2.panel.querySelectorAll('.filePickRow').length).toBe(1);
    });

    it('renders an explanatory empty state (not "No files match") for a genuinely empty manifest', async () => {
        withColdManifest({ ok: true, files: [] });
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        mount(picker);
        picker.trigger.click();
        await flush();
        const msg = picker.panel.querySelector('.filePickEmpty');
        expect(msg).not.toBeNull();
        expect(msg.textContent).toMatch(/manifest/i);
        expect(msg.textContent).not.toBe('No files match');
    });

    it('reads a failed fetch as a retryable problem, distinct from an empty manifest', async () => {
        withColdManifest({ ok: false, files: [] });
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        mount(picker);
        picker.trigger.click();
        await flush();
        const msg = picker.panel.querySelector('.filePickEmpty');
        expect(msg.textContent).toMatch(/couldn|temporary|load/i);
        expect(msg.textContent).not.toBe('No files match');
    });

    it('does not paint when the panel was detached before the load resolved', async () => {
        withColdManifest({ ok: true, files: ['src/a.js'] });
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        mount(picker);
        picker.trigger.click();
        // Simulate wireDescToggle rebuilding the panel (detaching this node).
        picker.panel.remove();
        picker.trigger.remove();
        await flush();
        // No rows painted onto the detached node.
        expect(picker.panel.querySelectorAll('.filePickRow').length).toBe(0);
    });

    it('runs onRender after the loading state and again after the list resolves', async () => {
        withColdManifest({ ok: true, files: ['src/a.js'] });
        const textarea = document.createElement('textarea');
        const onRender = vi.fn();
        const picker = createFilePicker({ projectName: 'P', textarea, onRender });
        mount(picker);
        picker.trigger.click();
        expect(onRender).toHaveBeenCalledTimes(1); // loading paint
        await flush();
        expect(onRender).toHaveBeenCalledTimes(2); // populated paint
    });
});

describe('createFilePicker — srcRoot prefixing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Warm cache carrying an explicit srcRoot, mirroring a real manifest whose
    // file names are relative to that root.
    function withRootedManifest(srcRoot, files) {
        listLogic.getProjectTargetId.mockReturnValue('target-1');
        findTargetById.mockReturnValue({ id: 'target-1', repo: 'owner/repo' });
        getCachedManifest.mockReturnValue({ ok: true, files, srcRoot });
    }

    it('renders full repo-relative paths for a non-empty srcRoot', () => {
        withRootedManifest('toDoList_main/src', ['toDoRow.js', 'style.css']);
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        picker.trigger.click();
        const rows = [...picker.panel.querySelectorAll('.filePickRow')].map((r) => r.textContent);
        expect(rows).toEqual(['toDoList_main/src/toDoRow.js', 'toDoList_main/src/style.css']);
    });

    it('inserts the full prefixed path into the File: line', () => {
        withRootedManifest('toDoList_main/src', ['toDoRow.js']);
        const textarea = document.createElement('textarea');
        textarea.value = '- [ ] **[MEDIUM]** Do a thing\n  - Type: feature';
        const picker = createFilePicker({ projectName: 'P', textarea });
        picker.trigger.click();
        picker.panel.querySelector('.filePickRow').click();
        expect(textarea.value).toContain('- File: `toDoList_main/src/toDoRow.js`');
        expect(textarea.value).not.toContain('`toDoRow.js`,');
    });

    it('filters by a directory segment once paths are prefixed', () => {
        withRootedManifest('toDoList_main/src', ['toDoRow.js', 'style.css']);
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        picker.trigger.click();
        const search = picker.panel.querySelector('.filePickSearch');
        search.value = 'toDoList_main/src';
        search.dispatchEvent(new Event('input'));
        expect(picker.panel.querySelectorAll('.filePickRow').length).toBe(2);
    });

    it('leaves names unchanged for an empty srcRoot (C# / repo-root-relative), no leading slash', () => {
        withRootedManifest('', ['LinearSearch/BST.cs']);
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        picker.trigger.click();
        const row = picker.panel.querySelector('.filePickRow');
        expect(row.textContent).toBe('LinearSearch/BST.cs');
    });

    it('treats an undefined srcRoot the same as empty', () => {
        withRootedManifest(undefined, ['app.js']);
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        picker.trigger.click();
        const row = picker.panel.querySelector('.filePickRow');
        expect(row.textContent).toBe('app.js');
    });

    it('strips a trailing slash on srcRoot rather than producing a double slash', () => {
        withRootedManifest('toDoList_main/src/', ['toDoRow.js']);
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        picker.trigger.click();
        const row = picker.panel.querySelector('.filePickRow');
        expect(row.textContent).toBe('toDoList_main/src/toDoRow.js');
    });
});

describe('createFilePicker — open/filter/pick behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('toggles the panel open and renders one row per manifest file', () => {
        withManifest(['src/a.js', 'src/b.js', 'src/c.js']);
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        expect(picker.panel.hidden).toBe(true);
        picker.trigger.click();
        expect(picker.panel.hidden).toBe(false);
        expect(picker.trigger.getAttribute('aria-expanded')).toBe('true');
        const rows = picker.panel.querySelectorAll('.filePickRow');
        expect(rows.length).toBe(3);
    });

    it('filters the list by the search query', () => {
        withManifest(['src/alpha.js', 'src/beta.js', 'tests/alpha.test.js']);
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        picker.trigger.click();
        const search = picker.panel.querySelector('.filePickSearch');
        search.value = 'beta';
        search.dispatchEvent(new Event('input'));
        const rows = picker.panel.querySelectorAll('.filePickRow');
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toBe('src/beta.js');
    });

    it('writes the chosen path into the entry, dispatches input, runs onInsert, and closes', () => {
        withManifest(['src/a.js', 'src/b.js']);
        const textarea = document.createElement('textarea');
        textarea.value = [
            '- [ ] **[MEDIUM]** Do a thing',
            '  - Type: feature',
        ].join('\n');
        let inputFired = 0;
        textarea.addEventListener('input', () => { inputFired++; });
        const onInsert = vi.fn();
        const picker = createFilePicker({ projectName: 'P', textarea, onInsert });
        picker.trigger.click();
        const rows = picker.panel.querySelectorAll('.filePickRow');
        rows[1].click(); // pick src/b.js

        expect(textarea.value).toBe(insertFilePathIntoEntry(
            '- [ ] **[MEDIUM]** Do a thing\n  - Type: feature', 'src/b.js'
        ));
        expect(textarea.value).toContain('- File: `src/b.js`');
        expect(inputFired).toBeGreaterThan(0);
        expect(onInsert).toHaveBeenCalledTimes(1);
        expect(picker.panel.hidden).toBe(true);
    });

    it('re-picking an already-listed path is a no-op on the text', () => {
        withManifest(['src/a.js']);
        const textarea = document.createElement('textarea');
        textarea.value = '  - File: `src/a.js`';
        const picker = createFilePicker({ projectName: 'P', textarea });
        picker.trigger.click();
        picker.panel.querySelector('.filePickRow').click();
        expect(textarea.value).toBe('  - File: `src/a.js`');
    });
});
