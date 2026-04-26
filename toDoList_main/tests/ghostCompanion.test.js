import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    isCompanionEnabled,
    setCompanionEnabled,
    supportsDesktopCompanion,
    createCompanion,
} from '../src/companion.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Ghost companion is a desktop-only decorative feature that cheers on todo
// completions. These tests pin down the contract surface (the exports, the
// persistence key, the desktop gate, the cheer trigger wiring) and the
// layout hooks (media queries, reduced-motion respect) so the feature can't
// silently regress into a broken half-implementation.
describe('ghost companion — module surface', () => {
    it('exports isCompanionEnabled / setCompanionEnabled / supportsDesktopCompanion / createCompanion', () => {
        expect(typeof isCompanionEnabled).toBe('function');
        expect(typeof setCompanionEnabled).toBe('function');
        expect(typeof supportsDesktopCompanion).toBe('function');
        expect(typeof createCompanion).toBe('function');
    });

    it('defaults to enabled when no persisted value exists', () => {
        localStorage.removeItem('todoapp_companion_enabled');
        expect(isCompanionEnabled()).toBe(true);
    });

    it('persists enabled state under todoapp_companion_enabled', () => {
        setCompanionEnabled(false);
        expect(localStorage.getItem('todoapp_companion_enabled')).toBe('false');
        expect(isCompanionEnabled()).toBe(false);
        setCompanionEnabled(true);
        expect(localStorage.getItem('todoapp_companion_enabled')).toBe('true');
        expect(isCompanionEnabled()).toBe(true);
    });

    it('createCompanion returns a controller with cheer/setEnabled/destroy', () => {
        localStorage.setItem('todoapp_companion_enabled', 'false');
        const c = createCompanion(document);
        expect(typeof c.cheer).toBe('function');
        expect(typeof c.setEnabled).toBe('function');
        expect(typeof c.destroy).toBe('function');
        c.destroy();
    });

    it('does not mount the ghost element when the viewport does not qualify', () => {
        // jsdom's matchMedia returns matches:false by default, so the desktop
        // gate bars mounting. The element should never appear in the DOM.
        localStorage.setItem('todoapp_companion_enabled', 'true');
        const c = createCompanion(document);
        expect(document.getElementById('companion')).toBeNull();
        c.destroy();
    });

    it('cheer() no-ops when the element is not mounted', () => {
        localStorage.setItem('todoapp_companion_enabled', 'true');
        const c = createCompanion(document);
        // Did not mount (jsdom). cheer should be a safe no-op.
        expect(() => c.cheer()).not.toThrow();
        expect(() => c.cheer(true)).not.toThrow();
        c.destroy();
    });
});

describe('ghost companion — sprite asset', () => {
    it('ships an SVG sprite at src/assets/companion-ghost.svg', () => {
        const svgPath = resolve(srcDir, 'assets/companion-ghost.svg');
        expect(existsSync(svgPath)).toBe(true);
        const svg = readFileSync(svgPath, 'utf8');
        expect(svg).toMatch(/<svg[\s\S]*<\/svg>/);
    });

    it('style.css references the sprite as the .companion background image', () => {
        const css = read('style.css');
        expect(css).toMatch(/\.companion\s*\{[^}]*background-image:\s*url\(\s*['"]?\.\/assets\/companion-ghost\.svg/);
    });
});

describe('ghost companion — main.js wiring', () => {
    const js = read('main.js');

    it('imports createCompanion from ./companion.js', () => {
        expect(js).toMatch(/import\s*\{[^}]*createCompanion[^}]*\}\s*from\s*['"]\.\/companion\.js['"]/);
    });

    it('instantiates the companion lazily via an ensureCompanion helper', () => {
        expect(js).toMatch(/function\s+ensureCompanion\s*\(/);
        expect(js).toMatch(/createCompanion\s*\(\s*document\s*\)/);
    });

    it('calls companion.cheer() from inside the checkbox change handler', () => {
        // Isolate wireCheckbox so the assertion can't false-positive off
        // unrelated code that happens to invoke cheer().
        const start = js.indexOf('function wireCheckbox(');
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let end = -1;
        for (let i = js.indexOf('{', start); i < js.length; i++) {
            const c = js[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        expect(end).toBeGreaterThan(start);
        const body = js.slice(start, end);
        expect(body).toMatch(/\.cheer\s*\(/);
    });

    it('passes a truthy "big" flag to cheer() when no open items remain in the project', () => {
        // The project-complete variant triggers a louder animation. Guard
        // against the wiring degrading to always-small cheers.
        const start = js.indexOf('function wireCheckbox(');
        const body = js.slice(start, start + 4000);
        expect(body).toMatch(/remainingOpen\s*===\s*0/);
    });

    it('exposes a companion toggle switch in the nav', () => {
        expect(js).toMatch(/companionToggle\.id\s*=\s*['"]companionToggle['"]/);
        expect(js).toMatch(/companionToggle\.setAttribute\s*\(\s*['"]role['"]\s*,\s*['"]switch['"]/);
        expect(js).toMatch(/nav\.appendChild\s*\(\s*companionToggle\s*\)/);
    });
});

describe('ghost companion — CSS gates', () => {
    const css = read('style.css');

    it('hides the companion element outside the desktop viewport gate', () => {
        // The media query fires when min-width: 1024px is NOT matched OR when
        // a coarse pointer is present. Either branch hides the element.
        expect(css).toMatch(/@media\s+not\s+all\s+and\s+\(min-width:\s*1024px\)[^{]*\(pointer:\s*coarse\)\s*\{[^}]*\.companion\s*\{[^}]*display:\s*none/);
    });

    it('disables companion animations under prefers-reduced-motion', () => {
        expect(css).toMatch(/@media\s+\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.companion[^}]*animation:\s*none/);
    });

    it('hides the companion toggle switch on mobile', () => {
        expect(css).toMatch(/@media\s+not\s+all\s+and\s+\(min-width:\s*1024px\)[^{]*\(pointer:\s*coarse\)\s*\{[^}]*#companionToggle\s*\{[^}]*display:\s*none/);
    });
});

describe('ghost companion — periodic blink', () => {
    const js  = read('companion.js');
    const css = read('style.css');

    it('defines a .companion.blinking rule with a finite-iteration animation', () => {
        // Finite iteration (matches the existing cheer pattern) — the blink
        // is one short pulse, not a continuous loop.
        expect(css).toMatch(/\.companion\.blinking\s*\{[^}]*animation:[^}]*\b1\b[^}]*\}/);
    });

    it('disables the blink animation under prefers-reduced-motion alongside the other states', () => {
        expect(css).toMatch(/@media\s+\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.companion\.blinking[\s\S]*?animation:\s*none/);
    });

    it('toggles a "blinking" class on the sprite via add/remove pair', () => {
        // Pair of class manipulations is the contract — one to start the
        // closed-eye frame, one to end it. Both must exist or the blink is
        // either stuck on or never visible.
        expect(js).toMatch(/classList\.add\s*\(\s*['"]blinking['"]\s*\)/);
        expect(js).toMatch(/classList\.remove\s*\(\s*['"]blinking['"]\s*\)/);
    });

    it('drives the blink from a setTimeout-based scheduler, not a new animation system', () => {
        // Reuses the existing timer pattern (setTimeout + setState) rather
        // than introducing rAF loops or a frame counter for blinks.
        expect(js).toMatch(/function\s+scheduleBlink\s*\(/);
        expect(js).toMatch(/setTimeout\s*\(/);
    });

    it('only schedules blinks while idle so they do not clip mid-walk or mid-cheer', () => {
        // Either the scheduled callback bails when state is not IDLE, or the
        // entry into non-idle states cancels the pending blink.
        const idleGuard = /state\s*!==?\s*['"]IDLE['"]/.test(js)
                       || /state\s*===\s*['"]IDLE['"]/.test(js);
        expect(idleGuard).toBe(true);
        expect(js).toMatch(/function\s+cancelBlink\s*\(/);
    });

    it('clears the blink timer on destroy so it cannot fire after teardown', () => {
        const destroyStart = js.indexOf('function destroy(');
        expect(destroyStart).toBeGreaterThan(-1);
        // Walk to the matching brace so we only inspect destroy's body.
        let depth = 0;
        let end = -1;
        for (let i = js.indexOf('{', destroyStart); i < js.length; i++) {
            const c = js[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        expect(end).toBeGreaterThan(destroyStart);
        const body = js.slice(destroyStart, end);
        expect(body).toMatch(/clearTimeout\s*\(\s*blinkId\s*\)/);
    });
});
