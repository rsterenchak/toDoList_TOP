// Pins the contract for the Ctrl+Space global shortcut: it toggles the
// Pomodoro timer through a single controller entry point, surfaces a
// transient status pill inside the popover header for confirmation, and the
// help-modal catalogue lists the chord under Global so the keyboard path is
// discoverable. The controller's toggle() is unit-tested directly; the
// main.js wiring is verified via source-level regex (mirroring the rest of
// the pomodoro test file).
//
// History: this shortcut was originally Ctrl+Pause, but most modern
// keyboards (Mac, Chromebook, compact laptops) lack a Pause/Break key, so
// the chord was unreachable in practice. It was swapped to Ctrl+Space —
// which collides with text entry, so the handler now requires an editable-
// surface guard (see the input-focus test below).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    createPomodoro,
    POMODORO_STATE_KEY,
    DEFAULT_DURATIONS,
    destroyPomodoro,
} from '../src/pomodoro.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function clearPomodoroStorage() {
    localStorage.removeItem(POMODORO_STATE_KEY);
}


describe('pomodoro — toggle() controller method', () => {
    beforeEach(clearPomodoroStorage);
    afterEach(() => { destroyPomodoro(); clearPomodoroStorage(); });

    it('exposes a toggle method on the controller', () => {
        const ctl = createPomodoro(document);
        expect(typeof ctl.toggle).toBe('function');
        ctl.destroy();
    });

    it('IDLE → toggle() starts a session and reports playing', () => {
        const ctl = createPomodoro(document);
        expect(ctl.getState().status).toBe('IDLE');
        const result = ctl.toggle();
        expect(result).toBe('playing');
        expect(ctl.getState().status).toBe('RUNNING');
        ctl.destroy();
    });

    it('RUNNING → toggle() pauses and reports paused', () => {
        const ctl = createPomodoro(document);
        ctl.start();
        const result = ctl.toggle();
        expect(result).toBe('paused');
        expect(ctl.getState().status).toBe('PAUSED');
        ctl.destroy();
    });

    it('PAUSED → toggle() resumes and reports playing', () => {
        const ctl = createPomodoro(document);
        ctl.start();
        ctl.pause();
        const result = ctl.toggle();
        expect(result).toBe('playing');
        expect(ctl.getState().status).toBe('RUNNING');
        ctl.destroy();
    });

    it('COMPLETE_UNACKED → toggle() is a no-op (does not auto-restart)', () => {
        // The shortcut must never silently fire a fresh session from the
        // alert state — the user should explicitly acknowledge and pick the
        // next mode (typically via the popover's suggestion button).
        localStorage.setItem(POMODORO_STATE_KEY, JSON.stringify({
            mode: 'focus',
            durations: DEFAULT_DURATIONS,
            endTimestamp: null,
            status: 'COMPLETE_UNACKED',
            soundEnabled: true,
            volume: 0.6,
        }));
        const ctl = createPomodoro(document);
        expect(ctl.getState().status).toBe('COMPLETE_UNACKED');
        const result = ctl.toggle();
        expect(result).toBe('noop');
        // Status untouched — no implicit acknowledgement, no fresh session.
        expect(ctl.getState().status).toBe('COMPLETE_UNACKED');
        ctl.destroy();
    });

    it('rapid IDLE → RUNNING → PAUSED → RUNNING via repeated toggle()', () => {
        // The shortcut spec calls out rapid repeated presses — the
        // controller must walk the full state machine without getting
        // stuck.
        const ctl = createPomodoro(document);
        expect(ctl.toggle()).toBe('playing');
        expect(ctl.toggle()).toBe('paused');
        expect(ctl.toggle()).toBe('playing');
        expect(ctl.toggle()).toBe('paused');
        expect(ctl.getState().status).toBe('PAUSED');
        ctl.destroy();
    });
});


describe('Ctrl+Space — main.js shortcut wiring', () => {
    const main = read('main.js');
    const css  = read('style.css');
    const modals = read('modals.js');

    function findHandler() {
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"],[\s\S]*?\}\s*\)\s*;/g) || [];
        // The Pomodoro toggle handler is the one that gates on Ctrl plus the
        // space key (' ' on modern engines, 'Spacebar' on older Gecko) and
        // routes through the controller's toggle() entry point.
        return blocks.find(function(b) {
            return /e\.key\s*!==\s*['"] ['"]/.test(b)
                && /ctrlKey/.test(b)
                && /\.toggle\(\s*\)/.test(b);
        });
    }

    it('registers a global keydown listener that matches Ctrl+Space', () => {
        const handler = findHandler();
        expect(handler).toBeTruthy();
        expect(handler).toMatch(/e\.ctrlKey/);
        // Both ' ' and 'Spacebar' should be accepted so older Gecko users
        // can still trigger the shortcut.
        expect(handler).toMatch(/['"]Spacebar['"]/);
    });

    it('bails on Alt, Shift, or Meta modifiers so the chord is exact', () => {
        const handler = findHandler();
        expect(handler).toMatch(/altKey/);
        expect(handler).toMatch(/shiftKey/);
        expect(handler).toMatch(/metaKey/);
    });

    it('routes the chord through the controllers single toggle entry point', () => {
        const handler = findHandler();
        // Single entry point keeps the state machine consistent with the
        // existing primary button — main.js never decides start vs pause.
        expect(handler).toMatch(/\.toggle\(\s*\)/);
    });

    it('preventDefaults so the browser does not absorb the chord', () => {
        const handler = findHandler();
        expect(handler).toMatch(/preventDefault\(\s*\)/);
    });

    it('bails on input/textarea/contentEditable focus so typing still inserts a space', () => {
        // Ctrl+Space DOES collide with text entry (it inserts a space, and
        // many IMEs use the chord to commit a candidate). The handler must
        // therefore short-circuit when focus is on an editable surface so
        // we don't steal the keystroke from the user.
        const handler = findHandler();
        const beforeToggle = handler.split(/\.toggle\(/)[0];
        expect(beforeToggle).toMatch(/activeElement/);
        expect(beforeToggle).toMatch(/INPUT/);
        expect(beforeToggle).toMatch(/TEXTAREA/);
        expect(beforeToggle).toMatch(/isContentEditable/);
    });

    it('renders a status pill helper with paused / playing variants', () => {
        // The pill is the user-facing confirmation that the toggle landed.
        // Both transitions need a distinct variant so the user can tell
        // pause from resume at a glance.
        expect(main).toMatch(/showPomodoroStatusPill/);
        expect(main).toMatch(/['"]paused['"]/);
        expect(main).toMatch(/['"]playing['"]/);
    });

    it('CSS defines the pill base + state-modifier classes', () => {
        expect(css).toMatch(/\.pomodoroStatusPill\b/);
        expect(css).toMatch(/\.pomodoroStatusPill\.paused/);
        expect(css).toMatch(/\.pomodoroStatusPill\.playing/);
        // Fade-out is CSS-only via opacity transition on the .fading class
        expect(css).toMatch(/\.pomodoroStatusPill\.fading/);
        const baseIdx = css.indexOf('.pomodoroStatusPill ');
        expect(baseIdx).toBeGreaterThan(-1);
        const block = css.slice(baseIdx, baseIdx + 600);
        expect(block).toMatch(/transition:\s*opacity/);
    });

    it('lists Ctrl+Space in the shortcuts modal under the Pomodoro toggle description', () => {
        const idx = modals.indexOf("keys: ['Ctrl', 'Space']");
        expect(idx).toBeGreaterThan(-1);
        const entry = modals.slice(idx, idx + 300);
        expect(entry).toMatch(/description:\s*['"][^'"]*Pomodoro[^'"]*['"]/i);
    });
});
