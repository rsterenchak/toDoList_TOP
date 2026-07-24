import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression pin for "File picker: rows collapse instead of filling the list".
//
// `.filePickRow` buttons rendered far narrower than their `.filePickList`
// container, so file paths appeared as one- or two-character fragments instead
// of readable rows. The list measures full width — the collapse was at the row
// level — so the fix places three defensive declarations on `.filePickRow`:
// `align-self: stretch`, `width: 100%`, and `min-width: 0`.
//
// LAYOUT-MEASUREMENT NOTE: the test environment is jsdom, which resolves the
// stylesheet cascade through `getComputedStyle` but performs NO layout —
// `offsetWidth` and `getBoundingClientRect().width` are `0` for every element.
// A true "row's laid-out width equals the list's content width in px" assertion
// is therefore impossible in this suite (that is exactly why the last four
// layout defects in this panel reached production). What IS available, and what
// these pins use, is the resolved computed style of a REAL `.filePickRow` node
// built by the real picker and matched against the real `style.css` cascade —
// stronger than grepping the stylesheet text, since it would catch a later
// override, a wrong selector, or a media query eating the declaration.

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

function openPickerWithRows() {
    styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    withManifest([
        'toDoList_main/src/a-really-quite-long-path/component.js',
        'toDoList_main/src/b.js',
        'toDoList_main/src/c.js',
    ]);
    const textarea = document.createElement('textarea');
    const picker = createFilePicker({ projectName: 'P', textarea });
    document.body.appendChild(picker.trigger);
    document.body.appendChild(picker.panel);
    picker.trigger.click();
    return picker;
}

describe('file picker rows fill the list (do not collapse)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        if (styleEl) styleEl.remove();
        styleEl = null;
        document.body.innerHTML = '';
    });

    it('every rendered row resolves to full container width through the real cascade', () => {
        const picker = openPickerWithRows();
        const rows = picker.panel.querySelectorAll('.filePickRow');
        expect(rows.length).toBe(3);
        for (const row of rows) {
            const cs = getComputedStyle(row);
            // Fills the container instead of shrinking to its content.
            expect(cs.width).toBe('100%');
            expect(cs.alignSelf).toBe('stretch');
            // min-width:0 lets overflow:hidden + ellipsis clip a long path
            // rather than the flex item's automatic min-content size forcing
            // it to max-content.
            expect(cs.minWidth).toBe('0px');
        }
    });

    it('long paths clip on one line (nowrap + ellipsis) rather than fragmenting', () => {
        const picker = openPickerWithRows();
        const row = picker.panel.querySelector('.filePickRow');
        const cs = getComputedStyle(row);
        expect(cs.whiteSpace).toBe('nowrap');
        expect(cs.overflow).toBe('hidden');
        expect(cs.textOverflow).toBe('ellipsis');
    });

    it('rows keep border-box so width:100% + padding does not overflow the list', () => {
        const picker = openPickerWithRows();
        const row = picker.panel.querySelector('.filePickRow');
        // The global reset sets border-box on everything; assert it reaches the
        // row so the 8px 10px padding stays inside the 100% width.
        expect(getComputedStyle(row).boxSizing).toBe('border-box');
    });
});
