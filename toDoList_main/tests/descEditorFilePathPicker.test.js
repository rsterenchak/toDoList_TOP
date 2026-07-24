import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// insertFilePathIntoEntry now lives in the shared filePicker.js module and is
// re-exported from modals.js — import from the re-export so this pins the seam
// callers/tests actually use.
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

describe('File:-path picker — shared module (filePicker.js)', () => {
    const filePicker = read('filePicker.js');

    it('loads the manifest on demand through loadManifest and reads the cache — one seam, no structureView import', () => {
        expect(filePicker).toMatch(
            /import\s*\{[^}]*getCachedManifest[^}]*loadManifest[^}]*\}\s*from\s*['"]\.\/claudeSheet\.js['"]/
        );
        expect(filePicker).toMatch(/\bloadManifest\(/);
        expect(filePicker).toMatch(/getCachedManifest\(/);
        // The load reaches loadManifest, not a second fetch or a copied parse,
        // and never pulls in structureView (which would drag the canvas along).
        expect(filePicker).not.toMatch(/from\s*['"]\.\/structureView\.js['"]/);
        expect(filePicker).not.toMatch(/\bfetch\(/);
    });

    it('dedups a load already in flight rather than starting a duplicate fetch', () => {
        expect(filePicker).toMatch(/manifestLoadsInFlight/);
    });

    it('guards the on-demand repaint against a detached panel node', () => {
        expect(filePicker).toMatch(/isConnected/);
    });

    it('exports createFilePicker plus the insertion helper for both hosts to share', () => {
        expect(filePicker).toMatch(/export function createFilePicker\(/);
        expect(filePicker).toMatch(/export function insertFilePathIntoEntry\(/);
    });

    it('hides the trigger only when the project has no linked repo (present otherwise, loads on open)', () => {
        expect(filePicker).toMatch(/if\s*\(\s*!repo\s*\)\s*trigger\.style\.display\s*=\s*['"]none['"]/);
    });

    it('writes the pick through insertFilePathIntoEntry, re-syncs the textarea, then defers persistence to the host', () => {
        const idx = filePicker.indexOf('function applyFilePick');
        expect(idx).toBeGreaterThan(-1);
        const fn = filePicker.slice(idx, idx + 600);
        expect(fn).toMatch(/insertFilePathIntoEntry\(\s*textarea\.value\s*,\s*path\s*\)/);
        // Dispatch the input event (auto-grow, and on the modal item.desc +
        // inject-button re-sync), then hand off to the host's onInsert.
        expect(fn).toMatch(/textarea\.dispatchEvent\(\s*new Event\(\s*['"]input['"]\s*\)\s*\)/);
        expect(fn).toMatch(/onInsert\(\)/);
    });

    it('caps the rendered rows and shows a keep-typing hint past the cap', () => {
        expect(filePicker).toMatch(/TARGET_PICK_CAP/);
        const idx = filePicker.indexOf('function renderList');
        expect(idx).toBeGreaterThan(-1);
        const fn = filePicker.slice(idx, idx + 2200);
        expect(fn).toMatch(/slice\(\s*0\s*,\s*TARGET_PICK_CAP\s*\)/);
        expect(fn).toMatch(/Keep typing to narrow/);
    });
});

describe('File:-path picker — modal host (modals.js)', () => {
    const modals = read('modals.js');

    it('drives the shared picker rather than a private copy — no direct manifest read', () => {
        expect(modals).toMatch(/import\s*\{[^}]*createFilePicker[^}]*\}\s*from\s*['"]\.\/filePicker\.js['"]/);
        expect(modals).not.toMatch(/from\s*['"]\.\/structureView\.js['"]/);
        expect(modals).not.toMatch(/\bloadManifest\(/);
        // The manifest read moved into filePicker.js; the modal no longer touches it.
        expect(modals).not.toMatch(/getCachedManifest\(/);
    });

    it('mounts the trigger above the textarea and the panel in the body, keeping the modal id hooks', () => {
        expect(modals).toMatch(/createFilePicker\(\{/);
        expect(modals).toMatch(/triggerId:\s*['"]descEditorModalTargetPick['"]/);
        expect(modals).toMatch(/body\.insertBefore\(\s*filePicker\.trigger\s*,\s*textarea\s*\)/);
        expect(modals).toMatch(/body\.appendChild\(\s*filePicker\.panel\s*\)/);
    });

    it('persists through listLogic after a pick', () => {
        const idx = modals.indexOf('createFilePicker({');
        const call = modals.slice(idx, idx + 400);
        expect(call).toMatch(/onInsert:\s*function\s*\(\)\s*\{\s*listLogic\.saveToStorage\(\)/);
    });
});

describe('File:-path picker — styling (shared .filePick* classes)', () => {
    const css = read('style.css');

    it('the chip follows the 36×36 / 10px-radius convention', () => {
        const m = css.match(/\.filePickTrigger\s*\{([\s\S]{0,700}?)\}/);
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/width:\s*36px/);
        expect(m[1]).toMatch(/height:\s*36px/);
        expect(m[1]).toMatch(/border-radius:\s*10px/);
    });

    it('the search input carries the 16px iOS-auto-zoom floor', () => {
        const m = css.match(/\.filePickSearch\s*\{([\s\S]{0,700}?)\}/);
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/font-size:\s*16px/);
    });

    it('the list scrolls within a bounded panel rather than growing unbounded', () => {
        const m = css.match(/\.filePickPanel\s*\{([\s\S]{0,700}?)\}/);
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/max-height:/);
        const list = css.match(/\.filePickList\s*\{([\s\S]{0,300}?)\}/);
        expect(list).toBeTruthy();
        expect(list[1]).toMatch(/overflow-y:\s*auto/);
    });
});

describe('File:-path picker — desktop panel host (toDoRow.js)', () => {
    const toDoRow = read('toDoRow.js');
    const css = read('style.css');

    function ruleBodyContaining(source, needle) {
        let depth = 0;
        let selectorStart = 0;
        for (let i = 0; i < source.length; i++) {
            const c = source[i];
            if (c === '{') {
                if (depth === 0) {
                    const selector = source.slice(selectorStart, i);
                    if (selector.includes(needle)) {
                        const blockEnd = source.indexOf('}', i);
                        return source.slice(i + 1, blockEnd);
                    }
                }
                depth++;
                continue;
            }
            if (c === '}') {
                depth--;
                if (depth === 0) selectorStart = i + 1;
            }
        }
        return null;
    }

    it('builds the desktop picker through the shared createFilePicker', () => {
        expect(toDoRow).toMatch(/import\s*\{[^}]*createFilePicker[^}]*\}\s*from\s*['"]\.\/filePicker\.js['"]/);
        expect(toDoRow).toMatch(/function mountDescFilePicker\(/);
        expect(toDoRow).toMatch(/createFilePicker\(\{/);
    });

    it('mounts the trigger above the textarea and the panel inside #descSibling', () => {
        const idx = toDoRow.indexOf('function mountDescFilePicker(');
        const fn = toDoRow.slice(idx, idx + 900);
        expect(fn).toMatch(/descSibling\.insertBefore\(\s*picker\.trigger\s*,\s*descInput\s*\)/);
        expect(fn).toMatch(/descSibling\.insertBefore\(\s*picker\.panel\s*,\s*descInput\.nextSibling\s*\)/);
    });

    it('mounts the picker on every panel open (rebuilt each time), not once at build', () => {
        expect(toDoRow).toMatch(/mountDescFilePicker\(descSibling,\s*descInput,\s*item,\s*projectName,\s*injectBtn\)/);
        const openIdx = toDoRow.indexOf('function wireDescToggle(');
        const openBlock = toDoRow.slice(openIdx, openIdx + 3000);
        expect(openBlock).toMatch(/mountDescFilePicker\(/);
    });

    it('persists through the listLogic path descInput uses and refreshes inject + viewer height after a pick', () => {
        const idx = toDoRow.indexOf('function mountDescFilePicker(');
        const fn = toDoRow.slice(idx, idx + 1100);
        expect(fn).toMatch(/listLogic\.saveToStorage\(\)/);
        expect(fn).toMatch(/listLogic\.editToDoItem\(projectName,\s*item\)/);
        expect(fn).toMatch(/refreshInjectButton\(injectBtn,\s*item,\s*projectName\)/);
        expect(fn).toMatch(/refreshViewerExpandedHeight\(\)/);
    });

    it('recomputes the viewer height after the picker (re)paints via onRender', () => {
        const idx = toDoRow.indexOf('function mountDescFilePicker(');
        const fn = toDoRow.slice(idx, idx + 1100);
        expect(fn).toMatch(/onRender:\s*function\s*\(\)\s*\{\s*refreshViewerExpandedHeight\(\)/);
    });

    it('places the trigger and panel full-width in the #descSibling grid (no 14px gutter collapse)', () => {
        const body = ruleBodyContaining(css, '#descSibling .filePickTrigger');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-column:\s*1\s*\/\s*-1\s*;/);
        // The grouped selector must also name the panel so it spans the row too.
        const idx = css.indexOf('#descSibling .filePickTrigger');
        const selector = css.slice(idx, css.indexOf('{', idx));
        expect(selector).toContain('#descSibling .filePickPanel');
    });
});
