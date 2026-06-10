// Shared popover-keyboard helpers centralized into popoverNav.js: behavior of
// isFocusInTextInput / popoverArrowNav, plus the wiring contract that main.js,
// music.js, and settingsMenu.js source the helpers from this module rather than
// defining or injecting them.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { isFocusInTextInput, popoverArrowNav } from '../src/popoverNav.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, '../src');
const readSrc = (name) => readFileSync(resolve(srcDir, name), 'utf8');

function focus(el) {
    document.body.appendChild(el);
    el.focus();
    return el;
}

describe('popoverNav — module surface', () => {
    it('exports both helpers as functions', () => {
        expect(typeof isFocusInTextInput).toBe('function');
        expect(typeof popoverArrowNav).toBe('function');
    });
});

describe('isFocusInTextInput', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('is false when nothing is focused', () => {
        document.body.innerHTML = '';
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        expect(isFocusInTextInput()).toBe(false);
    });

    it('is true for a focused textarea', () => {
        focus(document.createElement('textarea'));
        expect(isFocusInTextInput()).toBe(true);
    });

    it.each(['text', 'url', 'search', 'tel', 'email', 'password', 'number'])(
        'is true for a focused input[type=%s]', (type) => {
            const input = document.createElement('input');
            input.type = type;
            focus(input);
            expect(isFocusInTextInput()).toBe(true);
        });

    it('is false for a focused range input (arrow keys are meaningful there)', () => {
        const input = document.createElement('input');
        input.type = 'range';
        focus(input);
        expect(isFocusInTextInput()).toBe(false);
    });

    it('is false for a focused button', () => {
        focus(document.createElement('button'));
        expect(isFocusInTextInput()).toBe(false);
    });
});

describe('popoverArrowNav', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    function buildPopover() {
        const pop = document.createElement('div');
        const a = document.createElement('button'); a.textContent = 'A';
        const b = document.createElement('button'); b.textContent = 'B';
        const c = document.createElement('button'); c.textContent = 'C';
        pop.append(a, b, c);
        document.body.appendChild(pop);
        // jsdom returns empty getClientRects by default; stub a non-empty rect
        // so the visibility filter keeps the buttons.
        [a, b, c].forEach((el) => { el.getClientRects = () => [{ width: 10, height: 10 }]; });
        return { pop, a, b, c };
    }

    function keyEvent(key) {
        const ev = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        let prevented = false;
        const origPrevent = ev.preventDefault.bind(ev);
        ev.preventDefault = () => { prevented = true; origPrevent(); };
        Object.defineProperty(ev, '_prevented', { get: () => prevented });
        return ev;
    }

    it('returns false (not consumed) for non-navigation keys', () => {
        const { pop } = buildPopover();
        expect(popoverArrowNav(pop, keyEvent('Enter'))).toBe(false);
    });

    it('ArrowDown advances focus to the next item and consumes the key', () => {
        const { pop, a, b } = buildPopover();
        a.focus();
        const ev = keyEvent('ArrowDown');
        expect(popoverArrowNav(pop, ev)).toBe(true);
        expect(document.activeElement).toBe(b);
        expect(ev._prevented).toBe(true);
    });

    it('ArrowUp wraps from the first item to the last', () => {
        const { pop, a, c } = buildPopover();
        a.focus();
        expect(popoverArrowNav(pop, keyEvent('ArrowUp'))).toBe(true);
        expect(document.activeElement).toBe(c);
    });

    it('Home focuses the first item, End the last', () => {
        const { pop, a, b, c } = buildPopover();
        b.focus();
        popoverArrowNav(pop, keyEvent('Home'));
        expect(document.activeElement).toBe(a);
        popoverArrowNav(pop, keyEvent('End'));
        expect(document.activeElement).toBe(c);
    });

    it('defers to native semantics (returns false) when focus is in a text input', () => {
        const { pop } = buildPopover();
        const input = document.createElement('input');
        input.type = 'text';
        pop.appendChild(input);
        input.getClientRects = () => [{ width: 10, height: 10 }];
        input.focus();
        const ev = keyEvent('ArrowDown');
        expect(popoverArrowNav(pop, ev)).toBe(false);
        expect(ev._prevented).toBe(false);
    });

    it('defers to native semantics for a focused range slider', () => {
        const { pop } = buildPopover();
        const slider = document.createElement('input');
        slider.type = 'range';
        pop.appendChild(slider);
        slider.getClientRects = () => [{ width: 10, height: 10 }];
        slider.focus();
        expect(popoverArrowNav(pop, keyEvent('ArrowDown'))).toBe(false);
    });
});

describe('popoverNav — wiring contract across modules', () => {
    it('main.js no longer defines the helpers; pomodoro.js imports isFocusInTextInput', () => {
        const main = readSrc('main.js');
        const pomodoro = readSrc('pomodoro.js');
        expect(main).not.toMatch(/function\s+isFocusInTextInput\s*\(/);
        expect(main).not.toMatch(/function\s+popoverArrowNav\s*\(/);
        // The pomodoro popover (the lone main.js consumer of isFocusInTextInput)
        // folded into pomodoro.js's createPomodoroUI factory, which now owns the
        // import. main.js no longer references either helper.
        expect(pomodoro).toMatch(/import\s*\{[^}]*isFocusInTextInput[^}]*\}\s*from\s*['"]\.\/popoverNav\.js['"]/);
        expect(main).not.toMatch(/isFocusInTextInput/);
        expect(main).not.toMatch(/popoverArrowNav/);
    });

    it('music.js imports both helpers from popoverNav.js and no longer reads them off deps', () => {
        const music = readSrc('music.js');
        expect(music).toMatch(/import\s*\{[^}]*isFocusInTextInput[^}]*popoverArrowNav[^}]*\}\s*from\s*['"]\.\/popoverNav\.js['"]/);
        expect(music).not.toMatch(/deps\.isFocusInTextInput/);
        expect(music).not.toMatch(/deps\.popoverArrowNav/);
    });

    it('settingsMenu.js imports isFocusInTextInput from popoverNav.js and drops it from deps', () => {
        const settings = readSrc('settingsMenu.js');
        expect(settings).toMatch(/import\s*\{\s*isFocusInTextInput\s*\}\s*from\s*['"]\.\/popoverNav\.js['"]/);
        // The deps destructuring no longer includes isFocusInTextInput.
        const depsBlock = settings.match(/const\s*\{([\s\S]*?)\}\s*=\s*deps;/);
        expect(depsBlock).not.toBeNull();
        expect(depsBlock[1]).not.toMatch(/isFocusInTextInput/);
    });
});
