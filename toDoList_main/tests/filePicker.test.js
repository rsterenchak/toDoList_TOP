import { describe, it, expect, vi, beforeEach } from 'vitest';

// Behavioral pins for the shared File:-path picker. The manifest read reaches
// out to listLogic (project → target id), inject.js (target id → repo), and
// claudeSheet.js (repo → cached manifest); mock those three seams so the picker
// can be exercised end-to-end in jsdom without the full app graph.

vi.mock('../src/claudeSheet.js', () => ({
    getCachedManifest: vi.fn(),
}));
vi.mock('../src/inject.js', () => ({
    findTargetById: vi.fn(),
}));
vi.mock('../src/listLogic.js', () => ({
    listLogic: { getProjectTargetId: vi.fn(), saveToStorage: vi.fn() },
}));

import { createFilePicker, insertFilePathIntoEntry } from '../src/filePicker.js';
import { getCachedManifest } from '../src/claudeSheet.js';
import { findTargetById } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

function withManifest(files) {
    listLogic.getProjectTargetId.mockReturnValue('target-1');
    findTargetById.mockReturnValue({ id: 'target-1', repo: 'owner/repo' });
    getCachedManifest.mockReturnValue({ ok: true, files });
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

    it('is unavailable when the repo manifest was never loaded', () => {
        listLogic.getProjectTargetId.mockReturnValue('target-1');
        findTargetById.mockReturnValue({ id: 'target-1', repo: 'owner/repo' });
        getCachedManifest.mockReturnValue(null);
        const textarea = document.createElement('textarea');
        const picker = createFilePicker({ projectName: 'P', textarea });
        expect(picker.available).toBe(false);
        expect(picker.trigger.style.display).toBe('none');
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
