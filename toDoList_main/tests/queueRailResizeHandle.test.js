// Feature coverage for "Add draggable resize handle between task queue rail and
// detail pane in Stream view (desktop)".
//
// Three invariants are pinned:
//   1. prefs.js persists the chosen queue width behind a todoapp_-prefixed key,
//      mirroring the sidebar-width accessors (NaN default, round-trip, has-pref).
//   2. The desktop CSS drives the queue track from a --queue-width custom
//      property (so the drag can update it live and the STRUCTURE single-track
//      collapse still wins), with the handle gated to STREAM view and styled as
//      a col-resize grip that turns accent on hover / during a drag.
//   3. main.js clamps the width to 260–480px, wires pointerdown/move/up/cancel
//      (no native HTML5 drag-and-drop), and updates the custom property rather
//      than an inline grid-template-columns override.
//
// jsdom computes no layout, so the CSS/main.js assertions read the source text
// that PRODUCES the behaviour, the same approach as descPaneRailStripWidth.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';

import {
    QUEUE_WIDTH_KEY,
    readQueueWidthPref,
    writeQueueWidthPref,
    hasQueueWidthPref,
} from '../src/prefs.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const css = readFileSync(resolve(srcDir, 'style.css'), 'utf8');
const mainJs = readFileSync(resolve(srcDir, 'main.js'), 'utf8');

// Return the declaration body of the FIRST rule (at ANY nesting depth — these
// rules live inside the ≥1024px @media block) whose selector text ends with the
// literal `selectorLiteral` immediately before its opening brace. The queue-split
// rules contain no nested braces, so reading to the next `}` is sufficient.
function nestedRuleBody(selectorLiteral) {
    let from = 0;
    for (;;) {
        const idx = css.indexOf(selectorLiteral, from);
        if (idx === -1) return null;
        const brace = css.indexOf('{', idx);
        if (brace === -1) return null;
        // Ensure only whitespace sits between the selector and the brace, so we
        // don't match a longer selector that merely contains this substring.
        if (/^\s*$/.test(css.slice(idx + selectorLiteral.length, brace))) {
            const end = css.indexOf('}', brace);
            return css.slice(brace + 1, end);
        }
        from = idx + selectorLiteral.length;
    }
}

describe('queue-width preference', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('uses a todoapp_-prefixed key', () => {
        expect(QUEUE_WIDTH_KEY).toBe('todoapp_queueWidth');
    });

    it('returns NaN when nothing is stored', () => {
        expect(localStorage.getItem(QUEUE_WIDTH_KEY)).toBeNull();
        expect(Number.isNaN(readQueueWidthPref())).toBe(true);
        expect(hasQueueWidthPref()).toBe(false);
    });

    it('round-trips a written width', () => {
        writeQueueWidthPref(360);
        expect(readQueueWidthPref()).toBe(360);
        expect(hasQueueWidthPref()).toBe(true);
    });
});

describe('desktop queue|handle|detail grid split', () => {
    it('drives the queue track from --queue-width and keeps three tracks', () => {
        // The FIRST #mainSec rule is the base single-track one; the desktop split
        // rule is the one that references the custom property.
        const desktop = css.slice(css.indexOf('--queue-width'));
        const gridDecl = desktop.match(/grid-template-columns:\s*var\(--queue-width[^;]*;/);
        expect(gridDecl).not.toBeNull();
        // queue track | handle track (auto) | detail track (1fr).
        expect(gridDecl[0]).toMatch(/var\(--queue-width,\s*minmax\(260px,\s*308px\)\)/);
        expect(gridDecl[0]).toMatch(/auto/);
        expect(gridDecl[0]).toMatch(/minmax\(0,\s*1fr\)/);
    });

    it('the STRUCTURE collapse rule still sets a literal single track (var ignored)', () => {
        const structure = nestedRuleBody('body[data-view="structure"] #mainSec');
        expect(structure).not.toBeNull();
        expect(structure).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
        expect(structure).not.toMatch(/--queue-width/);
    });

    it('the detail pane moves to the third track', () => {
        // The base #descDetailPane rule is `display:none`; the desktop rule places
        // it in the third (detail) track.
        expect(css).toMatch(/#descDetailPane\s*\{\s*grid-column:\s*3/);
    });
});

describe('resize handle appearance + gating', () => {
    it('is hidden by default (no split below 1024px)', () => {
        const base = css.match(/\n#queueResizeHandle\s*\{([^}]*)\}/);
        expect(base).not.toBeNull();
        expect(base[1]).toMatch(/display:\s*none/);
    });

    it('only shows in STREAM view, occupies the handle track, and shows a col-resize cursor', () => {
        const handle = nestedRuleBody('body[data-view="projects"] #queueResizeHandle');
        expect(handle).not.toBeNull();
        expect(handle).toMatch(/grid-column:\s*2/);
        expect(handle).toMatch(/display:\s*flex/);
        expect(handle).toMatch(/cursor:\s*col-resize/);
        // touch-action:none lets a pointer drag resize rather than scroll on touch.
        expect(handle).toMatch(/touch-action:\s*none/);
    });

    it('renders a 4px-wide, 44px-tall rounded grip', () => {
        const grip = nestedRuleBody('body[data-view="projects"] #queueResizeHandle::before');
        expect(grip).not.toBeNull();
        expect(grip).toMatch(/width:\s*4px/);
        expect(grip).toMatch(/height:\s*44px/);
        expect(grip).toMatch(/border-radius:/);
    });

    it('turns accent-colored on hover and during a drag', () => {
        // Grouped selector (:hover + .dragging), so read the body from the brace
        // that closes the selector group rather than via the strict finder.
        const idx = css.indexOf('#queueResizeHandle:hover::before');
        expect(idx).toBeGreaterThan(-1);
        const brace = css.indexOf('{', idx);
        const body = css.slice(brace + 1, css.indexOf('}', brace));
        expect(body).toMatch(/var\(--accent\)/);
        const selectorHead = css.slice(idx, brace);
        expect(selectorHead).toMatch(/\.dragging::before/);
    });
});

describe('resize handle drag wiring (main.js)', () => {
    it('clamps the queue width to 260–480px', () => {
        expect(mainJs).toMatch(/QUEUE_WIDTH_MIN\s*=\s*260/);
        expect(mainJs).toMatch(/QUEUE_WIDTH_MAX\s*=\s*480/);
        expect(mainJs).toMatch(/function clampQueueWidth/);
    });

    it('wires pointer events, not native HTML5 drag-and-drop', () => {
        expect(mainJs).toMatch(/addEventListener\('pointerdown'/);
        expect(mainJs).toMatch(/addEventListener\('pointermove'/);
        expect(mainJs).toMatch(/addEventListener\('pointerup'/);
        expect(mainJs).toMatch(/addEventListener\('pointercancel'/);
        // The handle setup must not lean on native dragstart/dragover.
        const setup = mainJs.slice(mainJs.indexOf('function setupQueueResizeHandle'));
        const body = setup.slice(0, setup.indexOf('\n}\n'));
        expect(body).not.toMatch(/dragstart|dragover|draggable/);
    });

    it('updates the --queue-width custom property, never an inline grid-template-columns', () => {
        expect(mainJs).toMatch(/setProperty\('--queue-width'/);
        // Guard against a regression that would defeat the STRUCTURE collapse.
        expect(mainJs).not.toMatch(/style\.gridTemplateColumns\s*=/);
    });

    it('restores a persisted width on boot, clamped', () => {
        expect(mainJs).toMatch(/function applyStoredQueueWidth/);
        const restore = mainJs.slice(mainJs.indexOf('function applyStoredQueueWidth'));
        const body = restore.slice(0, restore.indexOf('\n}\n'));
        expect(body).toMatch(/readQueueWidthPref/);
        expect(body).toMatch(/clampQueueWidth/);
    });
});
