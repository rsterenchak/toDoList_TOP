import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression pin for "File picker: rows squash to zero height when the list
// overflows".
//
// `.filePickRow` sets `overflow: hidden` for its ellipsis treatment. On a flex
// item that drops the automatic minimum size from content-based to zero, so once
// the file list is long enough to overflow `.filePickPanel`'s 240px cap the
// default `flex-shrink: 1` compresses every row toward zero height, clipping each
// path to a horizontal sliver. Filtering down to a single match removes the
// overflow, so the picker looked fine in the one-result case and unreadable
// otherwise. The fix is `flex-shrink: 0` on `.filePickRow` (and on
// `.filePickEmpty`, which shares the column and carries the "Keep typing to
// narrow" hint that coexists with the rows).
//
// LAYOUT-MEASUREMENT NOTE: the test environment is jsdom, which resolves the
// stylesheet cascade through `getComputedStyle` but performs NO layout —
// `offsetHeight` and `getBoundingClientRect().height` are `0` for every element,
// so a true "each laid-out row height is non-zero and equal" assertion is
// impossible in this suite (which is exactly how four layout defects in this
// panel reached production). What IS available, and what this pin uses, is the
// resolved computed style of REAL nodes built by the real picker matched against
// the real `style.css` cascade — stronger than grepping the stylesheet text,
// since it would catch a later override, a wrong selector, or a media query
// eating the declaration.

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

import { createFilePicker } from '../src/filePicker.js';
import { getCachedManifest } from '../src/claudeSheet.js';
import { findTargetById } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Warm cache so the picker renders its rows synchronously on open.
function withManifest(files) {
    listLogic.getProjectTargetId.mockReturnValue('target-1');
    findTargetById.mockReturnValue({ id: 'target-1', repo: 'owner/repo' });
    getCachedManifest.mockReturnValue({ ok: true, files });
}

let styleEl;

// Build a manifest with many rows so the list overflows the panel's 240px cap —
// the exact condition under which flex-shrink:1 would squash the rows.
function manyFiles(n) {
    return Array.from({ length: n }, (_, i) => `toDoList_main/src/file-number-${i}.js`);
}

function openPickerWithManyRows() {
    styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // More than the picker's 60-row cap, so the rows overflow the panel AND the
    // "Keep typing to narrow" hint renders below them.
    withManifest(manyFiles(80));
    const textarea = document.createElement('textarea');
    const picker = createFilePicker({ projectName: 'P', textarea });
    document.body.appendChild(picker.trigger);
    document.body.appendChild(picker.panel);
    picker.trigger.click();
    return picker;
}

describe('file picker rows keep their height when the list overflows', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        if (styleEl) styleEl.remove();
        styleEl = null;
        document.body.innerHTML = '';
    });

    it('every rendered row resolves to flex-shrink:0 through the real cascade', () => {
        const picker = openPickerWithManyRows();
        const rows = picker.panel.querySelectorAll('.filePickRow');
        // More rows than fit the 240px cap, so the overflow condition is live.
        expect(rows.length).toBeGreaterThan(3);
        for (const row of rows) {
            const cs = getComputedStyle(row);
            // The height floor: without this, overflow:hidden lets flex-shrink:1
            // compress each row toward zero height once the list overflows.
            expect(cs.flexShrink).toBe('0');
            // overflow:hidden must remain — it is load-bearing for the ellipsis.
            expect(cs.overflow).toBe('hidden');
        }
    });

    it('the "keep typing to narrow" hint shares the row height floor', () => {
        // The 80-file manifest is larger than the 60-row cap, so the hint renders
        // below the rows, where it shares .filePickList's flex column and would
        // squash too.
        const picker = openPickerWithManyRows();
        const hint = picker.panel.querySelector('.filePickEmpty');
        // With 40 files past the cap, the "Keep typing to narrow…" hint is present.
        expect(hint).not.toBeNull();
        expect(getComputedStyle(hint).flexShrink).toBe('0');
    });
});
