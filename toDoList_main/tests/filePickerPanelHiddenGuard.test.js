import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression pin for "File picker: the panel won't close because [hidden] loses
// to display:flex".
//
// `.filePickPanel` declares `display: flex` in its base rule, and the trigger
// toggles the panel via `panel.hidden = true/false`. An author-level `display`
// declaration outranks the UA stylesheet's `[hidden] { display: none }`, so
// setting the attribute left the panel visible and the picker appeared not to
// close. The fix is a `.filePickPanel[hidden] { display: none; }` guard placed
// AFTER the base rule so source order wins at equal specificity — the same guard
// this codebase already carries on eight `claude*` elements and four
// Structure-view elements for the identical trap.
//
// CASCADE-MEASUREMENT NOTE: this is source inspection, mirroring
// structureHiddenGuards.test.js. jsdom does NOT model the UA-vs-author cascade
// for the `hidden` attribute — its `getComputedStyle` resolves `display: none`
// for a `[hidden]` element whether or not the author guard is present, so a
// computed-`display` assertion passes today WITH the bug present and cannot
// discriminate the fix. The behavioral half below pins the JS contract the guard
// depends on (the panel is driven via the `hidden` attribute and mounts closed);
// the source half pins the CSS contract (base declares display, guard exists,
// guard follows the base). Together they fail if either side of the fix regresses.

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

function withManifest(files) {
    listLogic.getProjectTargetId.mockReturnValue('target-1');
    findTargetById.mockReturnValue({ id: 'target-1', repo: 'owner/repo' });
    getCachedManifest.mockReturnValue({ ok: true, files });
}

function openPicker() {
    withManifest(['toDoList_main/src/toDoRow.js', 'toDoList_main/src/style.css']);
    const textarea = document.createElement('textarea');
    const picker = createFilePicker({ projectName: 'P', textarea });
    document.body.appendChild(picker.trigger);
    document.body.appendChild(picker.panel);
    return picker;
}

describe('file picker panel is driven by the hidden attribute', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('mounts closed with the hidden attribute set (the guard would be dead otherwise)', () => {
        const picker = openPicker();
        expect(picker.panel.hidden).toBe(true);
    });

    it('tapping the trigger opens the panel by clearing the hidden attribute', () => {
        const picker = openPicker();
        picker.trigger.click();
        expect(picker.panel.hidden).toBe(false);
    });

    it('tapping the trigger a second time closes the panel via the hidden attribute', () => {
        const picker = openPicker();
        picker.trigger.click(); // open
        picker.trigger.click(); // close
        expect(picker.panel.hidden).toBe(true);
    });
});

// Source-inspection contract for the CSS guard. This is what actually catches the
// shipped defect, since jsdom cannot reproduce the UA-vs-author cascade.
describe('.filePickPanel[hidden] guard overrides the base display declaration', () => {
    function ruleBody(selector) {
        const start = css.indexOf(selector + ' {');
        if (start === -1) return null;
        const open = css.indexOf('{', start);
        const close = css.indexOf('}', open);
        if (open === -1 || close === -1) return null;
        return css.slice(open + 1, close);
    }

    it('.filePickPanel declares display in its base rule (the reason the guard is needed)', () => {
        const body = ruleBody('.filePickPanel');
        expect(body).not.toBeNull();
        expect(body).toMatch(/display:\s*(?:flex|inline-flex)/);
    });

    it('.filePickPanel[hidden] { display: none } guard exists so panel.hidden = true actually hides', () => {
        expect(css).toMatch(/\.filePickPanel\[hidden\]\s*\{\s*display:\s*none/);
    });

    it('the guard comes AFTER the base rule so source order wins at equal specificity', () => {
        const baseIdx = css.indexOf('.filePickPanel {');
        const guardIdx = css.indexOf('.filePickPanel[hidden]');
        expect(baseIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeGreaterThan(baseIdx);
    });
});
