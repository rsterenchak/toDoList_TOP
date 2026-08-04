import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { showAssignmentEditorModal } from '../src/modals.js';

// Feature coverage for "Add a corner drag handle to resize the assignment edit
// modal on desktop".
//
// The dialog clips its overflow, so the textarea's native `resize: vertical`
// grip could never grow the chrome around it. A bottom-right handle now sizes
// the whole dialog: a pointer drag writes the --assignment-editor-width /
// --assignment-editor-height custom properties the CSS sizes the panel from,
// clamped to 360x300 .. 90vw x 90vh, and only above the 480px phone breakpoint.
//
// The drag math is exercised behaviorally (jsdom computes no layout, so the
// dialog's start rect is stubbed); the appearance + breakpoint gating, which
// depend on cascade jsdom doesn't apply, are read from the CSS source in the
// style of queueRailResizeHandle.

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Declaration body of the first rule whose selector text ends with the literal
// `selectorLiteral` immediately before its opening brace — the same finder the
// queue-rail handle tests use, so nested (@media) rules are reachable too.
function ruleBody(selectorLiteral) {
    let from = 0;
    for (;;) {
        const idx = css.indexOf(selectorLiteral, from);
        if (idx === -1) return null;
        const brace = css.indexOf('{', idx);
        if (brace === -1) return null;
        if (/^\s*$/.test(css.slice(idx + selectorLiteral.length, brace))) {
            return css.slice(brace + 1, css.indexOf('}', brace));
        }
        from = idx + selectorLiteral.length;
    }
}

const realInnerWidth = window.innerWidth;
const realInnerHeight = window.innerHeight;

function setViewport(width, height) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
}

// Open the editor and hand back its dialog + grip, with the dialog reporting a
// fixed start rect (jsdom lays nothing out, so every rect is 0x0 otherwise).
function openEditor(startWidth = 520, startHeight = 460) {
    showAssignmentEditorModal({ repo: 'owner/repo', file_path: 'TODO.md' }, 'body', 'sha-0', {});
    const dialog = document.getElementById('assignmentEditorModal');
    dialog.getBoundingClientRect = () => ({
        width: startWidth,
        height: startHeight,
        top: 0, left: 0, right: startWidth, bottom: startHeight, x: 0, y: 0,
    });
    return { dialog: dialog, grip: document.getElementById('assignmentEditorModalResize') };
}

// jsdom has no PointerEvent constructor; the handlers only read clientX/clientY
// (and an always-optional pointerId), so a MouseEvent of the right type is a
// faithful stand-in.
function pointer(type, clientX, clientY) {
    return new MouseEvent(type, { clientX: clientX, clientY: clientY, bubbles: true, cancelable: true });
}

function drag(grip, from, to) {
    grip.dispatchEvent(pointer('pointerdown', from.x, from.y));
    grip.dispatchEvent(pointer('pointermove', to.x, to.y));
    grip.dispatchEvent(pointer('pointerup', to.x, to.y));
}

function sizeOf(dialog) {
    return {
        width: dialog.style.getPropertyValue('--assignment-editor-width'),
        height: dialog.style.getPropertyValue('--assignment-editor-height'),
    };
}

beforeEach(() => {
    setViewport(1280, 900);
    document.body.innerHTML = '';
});

afterEach(() => {
    const backdrop = document.getElementById('assignmentEditorModalBackdrop');
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    setViewport(realInnerWidth, realInnerHeight);
});

describe('assignment editor — corner resize handle', () => {
    it('mounts a pointer-only grip inside the dialog', () => {
        const { dialog, grip } = openEditor();
        expect(grip).toBeTruthy();
        expect(grip.parentNode).toBe(dialog);
        // Pointer-only affordance: hidden from assistive tech rather than
        // exposed as a control no keyboard can reach.
        expect(grip.getAttribute('aria-hidden')).toBe('true');
    });

    it('grows the whole dialog — both axes — by the drag delta', () => {
        const { dialog, grip } = openEditor(520, 460);
        drag(grip, { x: 500, y: 500 }, { x: 620, y: 580 });
        expect(sizeOf(dialog)).toEqual({ width: '640px', height: '540px' });
    });

    it('shrinks the dialog on an inward drag', () => {
        const { dialog, grip } = openEditor(700, 600);
        drag(grip, { x: 500, y: 500 }, { x: 420, y: 430 });
        expect(sizeOf(dialog)).toEqual({ width: '620px', height: '530px' });
    });

    it('clamps to the 360x300 minimum however far the drag goes inward', () => {
        const { dialog, grip } = openEditor(520, 460);
        drag(grip, { x: 500, y: 500 }, { x: 0, y: 0 });
        expect(sizeOf(dialog)).toEqual({ width: '360px', height: '300px' });
    });

    it('clamps to 90vw x 90vh however far the drag goes outward', () => {
        setViewport(1000, 800);
        const { dialog, grip } = openEditor(520, 460);
        drag(grip, { x: 500, y: 500 }, { x: 5000, y: 5000 });
        expect(sizeOf(dialog)).toEqual({ width: '900px', height: '720px' });
    });

    it('releases the textarea min-height floor once the dialog is user-sized', () => {
        const { dialog, grip } = openEditor();
        expect(dialog.classList.contains('assignmentEditorModalResized')).toBe(false);
        // Pressing alone pins the current size, so the panel cannot jump when
        // the floor is released.
        grip.dispatchEvent(pointer('pointerdown', 500, 500));
        expect(dialog.classList.contains('assignmentEditorModalResized')).toBe(true);
        expect(sizeOf(dialog).width).toBe('520px');
    });

    it('stops tracking the pointer after the drag ends', () => {
        const { dialog, grip } = openEditor(520, 460);
        drag(grip, { x: 500, y: 500 }, { x: 620, y: 580 });
        grip.dispatchEvent(pointer('pointermove', 900, 900));
        expect(sizeOf(dialog)).toEqual({ width: '640px', height: '540px' });
    });

    it('ignores a pointercancel-terminated drag the same way', () => {
        const { dialog, grip } = openEditor(520, 460);
        grip.dispatchEvent(pointer('pointerdown', 500, 500));
        grip.dispatchEvent(pointer('pointermove', 620, 580));
        grip.dispatchEvent(pointer('pointercancel', 620, 580));
        grip.dispatchEvent(pointer('pointermove', 900, 900));
        expect(sizeOf(dialog)).toEqual({ width: '640px', height: '540px' });
    });

    it('does not resize at or below the 480px phone breakpoint', () => {
        setViewport(480, 800);
        const { dialog, grip } = openEditor(520, 460);
        drag(grip, { x: 300, y: 300 }, { x: 400, y: 400 });
        expect(dialog.classList.contains('assignmentEditorModalResized')).toBe(false);
        expect(sizeOf(dialog)).toEqual({ width: '', height: '' });
    });
});

describe('assignment editor resize — styling and gating', () => {
    it('sizes the dialog from the drag custom properties, falling back to the original shell', () => {
        const body = ruleBody('#assignmentEditorModal');
        expect(body).not.toBeNull();
        expect(body).toMatch(/position:\s*relative/);
        expect(body).toMatch(/width:\s*var\(--assignment-editor-width,\s*100%\)/);
        expect(body).toMatch(/max-width:\s*var\(--assignment-editor-width,\s*520px\)/);
        expect(body).toMatch(/height:\s*var\(--assignment-editor-height,\s*auto\)/);
        expect(body).toMatch(/max-height:\s*var\(--assignment-editor-height,\s*86vh\)/);
    });

    it('parks the grip in the bottom-right corner with a diagonal-resize cursor', () => {
        const body = ruleBody('#assignmentEditorModalResize');
        expect(body).not.toBeNull();
        expect(body).toMatch(/position:\s*absolute/);
        expect(body).toMatch(/right:\s*2px/);
        expect(body).toMatch(/bottom:\s*2px/);
        expect(body).toMatch(/width:\s*16px/);
        expect(body).toMatch(/height:\s*16px/);
        expect(body).toMatch(/cursor:\s*nwse-resize/);
        // A pointer drag must resize rather than scroll the surface under it.
        expect(body).toMatch(/touch-action:\s*none/);
        // Themed grip dots — never a hardcoded color (CLAUDE.md theme rule).
        expect(body).toMatch(/var\(--text-secondary\)/);
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    });

    it('drops the textarea grip so only the dialog handle drives sizing', () => {
        const body = ruleBody('#assignmentEditorModalTextarea');
        expect(body).not.toBeNull();
        expect(body).toMatch(/resize:\s*none/);
        expect(body).not.toMatch(/resize:\s*vertical/);
    });

    it('hides the handle on phones and discards any desktop-dragged size there', () => {
        // Several `@media (max-width: 480px)` blocks exist; take the one that
        // actually carries the grip rule.
        const gripIdx = css.indexOf('\n  #assignmentEditorModalResize {');
        expect(gripIdx).toBeGreaterThan(-1);
        const mediaIdx = css.lastIndexOf('@media (max-width: 480px)', gripIdx);
        const scoped = css.slice(mediaIdx, css.indexOf('\n}\n', mediaIdx));
        // The grip itself is desktop-only.
        expect(scoped).toMatch(/#assignmentEditorModalResize\s*\{[^}]*display:\s*none/);
        // ...and the phone shell overrides width/height so a size dragged before
        // the viewport narrowed cannot survive into the mobile layout.
        const phoneDialog = scoped.match(/#assignmentEditorModal\s*\{([^}]*)\}/);
        expect(phoneDialog).not.toBeNull();
        expect(phoneDialog[1]).toMatch(/width:\s*100%/);
        expect(phoneDialog[1]).toMatch(/height:\s*auto/);
        // The pre-existing mobile cap stays put.
        expect(phoneDialog[1]).toMatch(/max-height:\s*92vh/);
    });
});
