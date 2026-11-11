import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { ensurePomodoro, destroyPomodoro } from '../src/pomodoro.js';
import { createFocusMode, destroyFocusMode } from '../src/focusMode.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

function stubMatchMedia() {
    window.matchMedia = function(query) {
        return {
            matches: query.indexOf('min-width: 1024px') !== -1,
            media: query,
            onchange: null,
            addListener() {}, removeListener() {},
            addEventListener() {}, removeEventListener() {},
            dispatchEvent() { return false; },
        };
    };
}

const q = (sel) => document.querySelector('#focusModeOverlay ' + sel);
const isOpen = () => q('.focusPomoWrap').classList.contains('focusPomoWrap--open');
const touch = (el) => el.dispatchEvent(new Event('touchstart', { bubbles: true }));

// The pomodoro pill collapses to just the session button; the stepper, label
// and dots reveal on hover / focus-within, or via a tap-toggled --open class.
describe('focus mode — pomodoro details collapse', () => {
    let f;
    beforeEach(() => {
        localStorage.clear();
        stubMatchMedia();
        f = createFocusMode(document);
        f.activate();
    });
    afterEach(() => {
        f.destroy();
        destroyFocusMode();
        try { ensurePomodoro().reset(); } catch (e) { /* ignore */ }
        destroyPomodoro();
        const stray = document.getElementById('focusModeOverlay');
        if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
        document.body.classList.remove('focusModeOpen');
        delete window.matchMedia;
    });

    it('wraps the stepper and dots in a details container after the session button', () => {
        const wrap = q('.focusPomoWrap');
        expect(wrap.children[0].classList.contains('focusSessionBtn')).toBe(true);
        const details = wrap.children[1];
        expect(details.classList.contains('focusPomoDetails')).toBe(true);
        expect(details.querySelector('.focusPomoStepper')).not.toBeNull();
        expect(details.querySelectorAll('.focusPomoDot').length).toBe(3);
        expect(isOpen()).toBe(false);
    });

    it('collapses details by default and reveals them on :hover, :focus-within and --open', () => {
        const sel = '.focusPomoWrap:not(:hover):not(:focus-within):not(.focusPomoWrap--open) .focusPomoDetails';
        const i = css.indexOf(sel + ' {');
        expect(i).toBeGreaterThan(-1);
        const rule = css.slice(i, css.indexOf('}', i));
        expect(rule).toMatch(/max-width:\s*0/);
        expect(rule).toMatch(/opacity:\s*0/);
        expect(rule).toMatch(/transition:[^;]*max-width[^;]*opacity/);
        expect(css).toMatch(/\.focusPomoWrap:not\(:hover\):not\(:focus-within\):not\(\.focusPomoWrap--open\)\s*\{[^}]*padding-right:\s*0/);
        // Pill geometry stays intact.
        expect(css).toMatch(/\.focusPomoWrap\s*\{[^}]*height:\s*42px[^}]*border-radius:\s*21px[^}]*background:\s*rgba\(255,255,255,0\.06\)[^}]*border:\s*0\.5px solid rgba\(255,255,255,0\.14\)/);
    });

    it('a mouse click on the session button toggles the session without opening details', () => {
        q('.focusSessionBtn').click();
        expect(ensurePomodoro().getState().status).toBe('RUNNING');
        expect(q('.focusSessionBtn').getAttribute('data-pomo-status')).toBe('RUNNING');
        expect(isOpen()).toBe(false);
    });

    it('first tap on the collapsed session button opens details; next tap starts and collapses', () => {
        const btn = q('.focusSessionBtn');
        touch(btn); btn.click();
        expect(isOpen()).toBe(true);
        expect(ensurePomodoro().getState().status).toBe('IDLE');
        touch(btn); btn.click();
        expect(ensurePomodoro().getState().status).toBe('RUNNING');
        expect(isOpen()).toBe(false);
    });

    it('tapping the pill body toggles the open state', () => {
        const wrap = q('.focusPomoWrap');
        q('.focusPomoLabel').click();
        expect(isOpen()).toBe(true);
        wrap.click();
        expect(isOpen()).toBe(false);
    });

    it('step arrows still cycle modes while open, keep it open, and the dot tracks', () => {
        q('.focusPomoLabel').click();
        q('.focusPomoStep--next').click();
        expect(ensurePomodoro().getState().mode).toBe('short');
        expect(q('.focusPomoDot--active').getAttribute('data-pomo-mode')).toBe('short');
        expect(isOpen()).toBe(true);
        q('.focusPomoStep--prev').click();
        expect(ensurePomodoro().getState().mode).toBe('focus');
        expect(isOpen()).toBe(true);
    });

    it('collapses on an outside press and on deactivate', () => {
        q('.focusPomoLabel').click();
        q('.focusPomoStep--next').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(isOpen()).toBe(true);
        q('.focusVideoBtn').dispatchEvent(new Event('touchstart', { bubbles: true }));
        expect(isOpen()).toBe(false);
        q('.focusPomoLabel').click();
        expect(isOpen()).toBe(true);
        f.deactivate();
        expect(isOpen()).toBe(false);
    });

    it('pill clicks never exit focus mode', () => {
        q('.focusPomoLabel').click();
        expect(f.isActive()).toBe(true);
    });
});
