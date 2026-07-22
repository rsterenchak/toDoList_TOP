import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { insertFilePathIntoEntry } from '../src/modals.js';
import { getCachedManifest, loadManifest } from '../src/claudeSheet.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the description-editor File:-path picker: a target chip beside THE ENTRY
// lists the active project's manifest files (read synchronously from the cache
// structureView already populated) and, on selection, writes the chosen path
// into the entry's `File:` line. The core is the pure insertion helper, which is
// exercised behaviorally; the modal wiring (which is too heavily wired to mount
// end-to-end here) and the styling are verified by source inspection, matching
// the mobileDescEditorRail / mobileDescEditorReviewAction style.

describe('insertFilePathIntoEntry — appending to an existing File: line', () => {
    it('appends the backtick-wrapped path comma-separated to an existing File: line', () => {
        const entry = [
            '- [ ] **[MEDIUM]** Do a thing',
            '  - Type: feature',
            '  - File: `src/a.js`',
        ].join('\n');
        const out = insertFilePathIntoEntry(entry, 'src/b.js');
        expect(out).toContain('  - File: `src/a.js`, `src/b.js`');
    });

    it('is a no-op when the path is already listed (backtick-wrapped)', () => {
        const entry = [
            '- [ ] **[MEDIUM]** Do a thing',
            '  - File: `src/a.js`, `src/b.js`',
        ].join('\n');
        expect(insertFilePathIntoEntry(entry, 'src/b.js')).toBe(entry);
    });

    it('is a no-op when the path is already listed bare (no backticks)', () => {
        const entry = '  - File: src/a.js, src/b.js';
        expect(insertFilePathIntoEntry(entry, 'src/a.js')).toBe(entry);
    });

    it('fills an empty File: line directly rather than adding a stray comma', () => {
        const entry = '  - File:';
        expect(insertFilePathIntoEntry(entry, 'src/a.js')).toBe('  - File: `src/a.js`');
    });

    it('matches the File: line tolerantly of indentation and case', () => {
        const entry = '    - file: `src/a.js`';
        const out = insertFilePathIntoEntry(entry, 'src/b.js');
        expect(out).toBe('    - file: `src/a.js`, `src/b.js`');
    });
});

describe('insertFilePathIntoEntry — inserting a new File: line', () => {
    it('inserts before the Completed: line, matching its indent', () => {
        const entry = [
            '- [ ] **[MEDIUM]** Do a thing',
            '  - Type: feature',
            '  - Completed: YYYY-MM-DD',
        ].join('\n');
        const out = insertFilePathIntoEntry(entry, 'src/a.js');
        expect(out).toBe([
            '- [ ] **[MEDIUM]** Do a thing',
            '  - Type: feature',
            '  - File: `src/a.js`',
            '  - Completed: YYYY-MM-DD',
        ].join('\n'));
    });

    it('appends at the end (matching sub-bullet indent) when there is no Completed line', () => {
        const entry = [
            '- [ ] **[MEDIUM]** Do a thing',
            '  - Type: feature',
            '  - Description: something',
        ].join('\n');
        const out = insertFilePathIntoEntry(entry, 'src/a.js');
        expect(out).toBe([
            '- [ ] **[MEDIUM]** Do a thing',
            '  - Type: feature',
            '  - Description: something',
            '  - File: `src/a.js`',
        ].join('\n'));
    });

    it('inserts inside the block, past a trailing blank line', () => {
        const entry = '- [ ] **[MEDIUM]** Do a thing\n  - Type: feature\n';
        const out = insertFilePathIntoEntry(entry, 'src/a.js');
        expect(out).toBe('- [ ] **[MEDIUM]** Do a thing\n  - Type: feature\n  - File: `src/a.js`\n');
    });
});

describe('insertFilePathIntoEntry — invariants', () => {
    it('returns the source unchanged for an empty or whitespace path', () => {
        const entry = '  - File: `src/a.js`';
        expect(insertFilePathIntoEntry(entry, '')).toBe(entry);
        expect(insertFilePathIntoEntry(entry, '   ')).toBe(entry);
    });

    it('preserves the rest of the entry byte-for-byte (only the File: line changes)', () => {
        const entry = [
            '- [ ] **[HIGH]** Title with -- dashes and "quotes"',
            '  - Type: bug',
            '  - Description: keep    indentation and `backticks`',
            '  - File: `src/a.js`',
            '  <!-- id: abc -->',
        ].join('\n');
        const out = insertFilePathIntoEntry(entry, 'src/b.js');
        // Every line except the File: line is untouched.
        const outLines = out.split('\n');
        const inLines = entry.split('\n');
        expect(outLines[0]).toBe(inLines[0]);
        expect(outLines[1]).toBe(inLines[1]);
        expect(outLines[2]).toBe(inLines[2]);
        expect(outLines[4]).toBe(inLines[4]);
        expect(outLines[3]).toBe('  - File: `src/a.js`, `src/b.js`');
    });
});

describe('getCachedManifest — synchronous, no-fetch cache read', () => {
    let fetchSpy;
    afterEach(() => {
        if (fetchSpy) fetchSpy.mockRestore();
        fetchSpy = undefined;
    });

    it('returns null for a falsy repo or a repo never loaded', () => {
        expect(getCachedManifest(null)).toBeNull();
        expect(getCachedManifest('')).toBeNull();
        expect(getCachedManifest('nobody/never-loaded-' + Math.random())).toBeNull();
    });

    it('returns the same cached result loadManifest produced, without a second fetch', async () => {
        const repo = 'owner/cached-' + Math.floor(Math.random() * 1e9);
        fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ['src/a.js', 'src/b.js'],
        });
        const loaded = await loadManifest(repo);
        expect(loaded.ok).toBe(true);
        expect(loaded.files).toEqual(['src/a.js', 'src/b.js']);
        // The cached read returns the identical object and triggers no fetch.
        fetchSpy.mockClear();
        const cached = getCachedManifest(repo);
        expect(cached).toBe(loaded);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('desc editor File:-path picker — modal wiring', () => {
    const modals = read('modals.js');

    it('reads the manifest synchronously from the cache (no second fetch; no structureView import)', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*getCachedManifest[^}]*\}\s*from\s*['"]\.\/claudeSheet\.js['"]/
        );
        // Reads the cache, never calls the async loader from the modal.
        expect(modals).toMatch(/getCachedManifest\(/);
        expect(modals).not.toMatch(/from\s*['"]\.\/structureView\.js['"]/);
        expect(modals).not.toMatch(/\bloadManifest\(/);
    });

    it('builds a #descEditorModalTargetPick chip, hidden when there is no manifest', () => {
        expect(modals).toMatch(/['"]descEditorModalTargetPick['"]/);
        const idx = modals.indexOf("'descEditorModalTargetPick'");
        expect(idx).toBeGreaterThan(-1);
        // Hidden entirely when the manifest has no files to browse.
        expect(modals).toMatch(/if\s*\(\s*!manifestFiles\.length\s*\)\s*targetPickBtn\.style\.display\s*=\s*['"]none['"]/);
    });

    it('mounts the chip above the textarea and the panel in the body', () => {
        expect(modals).toMatch(/body\.insertBefore\(\s*targetPickBtn\s*,\s*textarea\s*\)/);
        expect(modals).toMatch(/body\.appendChild\(\s*targetPanel\s*\)/);
    });

    it('writes the pick through insertFilePathIntoEntry then re-syncs + persists', () => {
        const idx = modals.indexOf('function applyFilePick');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 600);
        expect(fn).toMatch(/insertFilePathIntoEntry\(\s*textarea\.value\s*,\s*path\s*\)/);
        // Dispatch the input event (re-syncs item.desc + inject button + auto-grow)
        // and persist through listLogic.
        expect(fn).toMatch(/textarea\.dispatchEvent\(\s*new Event\(\s*['"]input['"]\s*\)\s*\)/);
        expect(fn).toMatch(/listLogic\.saveToStorage\(\)/);
    });

    it('caps the rendered rows and shows a keep-typing hint past the cap', () => {
        expect(modals).toMatch(/TARGET_PICK_CAP/);
        const idx = modals.indexOf('function renderTargetList');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 1200);
        expect(fn).toMatch(/slice\(\s*0\s*,\s*TARGET_PICK_CAP\s*\)/);
        expect(fn).toMatch(/Keep typing to narrow/);
    });
});

describe('desc editor File:-path picker — styling', () => {
    const css = read('style.css');

    it('the chip follows the 36×36 / 10px-radius convention', () => {
        const m = css.match(/#descEditorModalTargetPick\s*\{([\s\S]{0,700}?)\}/);
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/width:\s*36px/);
        expect(m[1]).toMatch(/height:\s*36px/);
        expect(m[1]).toMatch(/border-radius:\s*10px/);
    });

    it('the search input carries the 16px iOS-auto-zoom floor', () => {
        const m = css.match(/#descEditorModalTargetSearch\s*\{([\s\S]{0,700}?)\}/);
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/font-size:\s*16px/);
    });

    it('the list scrolls within a bounded panel rather than growing unbounded', () => {
        const m = css.match(/#descEditorModalTargetPanel\s*\{([\s\S]{0,700}?)\}/);
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/max-height:/);
        const list = css.match(/#descEditorModalTargetList\s*\{([\s\S]{0,300}?)\}/);
        expect(list).toBeTruthy();
        expect(list[1]).toMatch(/overflow-y:\s*auto/);
    });
});
