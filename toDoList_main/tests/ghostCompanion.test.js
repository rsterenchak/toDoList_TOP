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
    // wireCheckbox now lives in toDoRow.js — the cheer() trigger asserts read
    // there. The companion toggle switch in the nav still lives in main.js.
    const toDoRow = read('toDoRow.js');
    // The lazy-instantiation singleton was moved out of main.js into
    // companion.js itself, so callers don't have to thread a deps bag — every
    // importer gets the same instance via ensureCompanion()/destroyCompanion().
    const companion = read('companion.js');

    it('imports ensureCompanion and destroyCompanion from ./companion.js', () => {
        expect(js).toMatch(/import\s*\{[^}]*ensureCompanion[^}]*\}\s*from\s*['"]\.\/companion\.js['"]/);
        expect(js).toMatch(/import\s*\{[^}]*destroyCompanion[^}]*\}\s*from\s*['"]\.\/companion\.js['"]/);
    });

    it('instantiates the companion lazily via the exported ensureCompanion singleton in companion.js', () => {
        // The helper itself now lives in companion.js — main.js just calls it
        // from the nav toggle handler. The lazy contract is preserved: the
        // helper memoizes a single createCompanion(document) instance.
        expect(companion).toMatch(/export\s+function\s+ensureCompanion\s*\(/);
        expect(companion).toMatch(/createCompanion\s*\(\s*document\s*\)/);
        // main.js wires the toggle to ensureCompanion / destroyCompanion.
        expect(js).toMatch(/ensureCompanion\s*\(\s*\)/);
        expect(js).toMatch(/destroyCompanion\s*\(\s*\)/);
    });

    it('calls companion.cheer() from inside the checkbox change handler', () => {
        // Isolate wireCheckbox so the assertion can't false-positive off
        // unrelated code that happens to invoke cheer().
        const start = toDoRow.indexOf('function wireCheckbox(');
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let end = -1;
        for (let i = toDoRow.indexOf('{', start); i < toDoRow.length; i++) {
            const c = toDoRow[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        expect(end).toBeGreaterThan(start);
        const body = toDoRow.slice(start, end);
        expect(body).toMatch(/\.cheer\s*\(/);
    });

    it('passes a truthy "big" flag to cheer() when no open items remain in the project', () => {
        // The project-complete variant triggers a louder animation. Guard
        // against the wiring degrading to always-small cheers.
        const start = toDoRow.indexOf('function wireCheckbox(');
        const body = toDoRow.slice(start, start + 4000);
        expect(body).toMatch(/remainingOpen\s*===\s*0/);
    });

    it('exposes the companion toggle as a Toggle floating ghost item inside the ghost menu dropdown', () => {
        // The pill-switch in the nav has been replaced by a dropdown menu
        // item — now labelled "Toggle floating ghost" to disambiguate it
        // from the static ghost-icon menu trigger that lives in the top-
        // right of the nav. The handler still flips isCompanionEnabled and
        // calls ensureCompanion / destroyCompanion the same way the old
        // switch did.
        expect(js).toMatch(/buildSettingsMenuItem\(\s*'Toggle floating ghost'/);
        expect(js).toMatch(/setCompanionEnabled\s*\(\s*next\s*\)/);
        expect(js).toMatch(/ensureCompanion\s*\(\s*\)/);
        expect(js).toMatch(/destroyCompanion\s*\(\s*\)/);
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

    it('hides the Show ghost settings item on mobile', () => {
        // Same gate the companion module itself uses — only show the toggle
        // on viewports where the companion actually runs.
        expect(css).toMatch(/@media\s+not\s+all\s+and\s+\(min-width:\s*1024px\)[^{]*\(pointer:\s*coarse\)\s*\{[^}]*\.settingsMenuItem--ghost\s*\{[^}]*display:\s*none/);
    });
});

describe('ghost companion — pomodoro studying state', () => {
    const js  = read('companion.js');
    const css = read('style.css');
    const main = read('main.js');

    it('exposes setStudying on the controller alongside cheer/setEnabled/destroy', () => {
        localStorage.setItem('todoapp_companion_enabled', 'false');
        const c = createCompanion(document);
        expect(typeof c.setStudying).toBe('function');
        c.destroy();
    });

    it('setStudying is a safe no-op when the companion never mounted', () => {
        // jsdom: desktop gate fails, sprite never enters the DOM. The call
        // must remain safe so the pomodoro sync subscriber doesn't crash on
        // mobile-class viewports.
        localStorage.setItem('todoapp_companion_enabled', 'true');
        const c = createCompanion(document);
        expect(() => c.setStudying(true)).not.toThrow();
        expect(() => c.setStudying(false)).not.toThrow();
        c.destroy();
    });

    it('ships the book-holding sprite at src/assets/companion-ghost-study.svg', () => {
        const svgPath = resolve(srcDir, 'assets/companion-ghost-study.svg');
        expect(existsSync(svgPath)).toBe(true);
        const svg = readFileSync(svgPath, 'utf8');
        expect(svg).toMatch(/<svg[\s\S]*<\/svg>/);
    });

    it('style.css swaps to the study sprite and widens the box on .companion.studying', () => {
        expect(css).toMatch(/\.companion\.studying\s*\{[^}]*background-image:\s*url\(\s*['"]?\.\/assets\/companion-ghost-study\.svg/);
        expect(css).toMatch(/\.companion\.studying\s*\{[^}]*width:\s*64px/);
    });

    it('keeps the idle bob running while studying — the focus state is held position, not held breath', () => {
        // .studying keeps the same companionIdle keyframe so the ghost still
        // reads as alive while the pomodoro session is running.
        expect(css).toMatch(/\.companion\.studying\s*\{[^}]*animation:\s*companionIdle/);
    });

    it('silences the studying bob under prefers-reduced-motion alongside idle/cheer', () => {
        const blocks = css.match(/@media\s+\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g) || [];
        const companionBlock = blocks.find(function (b) { return /\.companion\.cheering/.test(b); });
        expect(companionBlock).toBeTruthy();
        expect(companionBlock).toMatch(/\.companion\.studying/);
    });

    it('STUDYING blocks blinks the same way CHEERING does', () => {
        // setState routes both CHEERING and STUDYING through cancelBlink so
        // the closed-eye frame never fires during a focus session.
        expect(js).toMatch(/next\s*===\s*['"]CHEERING['"]\s*\|\|\s*next\s*===\s*['"]STUDYING['"]/);
    });

    it('wander tick re-schedules without picking a new target while studying', () => {
        // The wander timer guard now matches CHEERING and STUDYING — both
        // hold the ghost in place.
        expect(js).toMatch(/state\s*===\s*['"]CHEERING['"]\s*\|\|\s*state\s*===\s*['"]STUDYING['"]/);
    });

    it('right-edge clamping accounts for the wider study footprint', () => {
        // pickTarget uses a per-state right margin so the wider 64px box
        // doesn't clip past the viewport when studying near the right edge.
        expect(js).toMatch(/function\s+rightMargin\s*\(/);
        expect(js).toMatch(/state\s*===\s*['"]STUDYING['"]\s*\?\s*64\s*:\s*48/);
    });

    it('defers a study request received mid-cheer until the cheer resolves', () => {
        // The cheer tail-end checks studyPending and lands in STUDYING when
        // the user-facing intent flipped during the animation.
        expect(js).toMatch(/studyPending/);
        // setStudying short-circuits when state is CHEERING so the cheer
        // animation isn't yanked mid-frame.
        const setStudyingStart = js.indexOf('function setStudying(');
        expect(setStudyingStart).toBeGreaterThan(-1);
        let depth = 0;
        let end = -1;
        for (let i = js.indexOf('{', setStudyingStart); i < js.length; i++) {
            const c = js[i];
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        const body = js.slice(setStudyingStart, end);
        expect(body).toMatch(/state\s*===\s*['"]CHEERING['"]/);
    });

    it('main.js mirrors pomodoro RUNNING status onto companion.setStudying', () => {
        // syncPomodoroIcon is the single sink that already runs on every
        // controller subscribe — wiring setStudying here keeps the call sites
        // aligned with the icon's data-pomo-status writes.
        expect(main).toMatch(/setStudying\s*\(\s*snap\.status\s*===\s*['"]RUNNING['"]\s*\)/);
    });
});

describe('ghost companion — STUDYING runtime behavior', () => {
    // Force the desktop gate to pass so the sprite actually mounts and we
    // can assert against the live DOM element.
    const originalMatchMedia = window.matchMedia;
    beforeEach(() => {
        window.matchMedia = function (query) {
            return {
                matches: query.indexOf('min-width: 1024px') !== -1,
                media: query,
                addEventListener: function () {},
                removeEventListener: function () {},
                addListener: function () {},
                removeListener: function () {},
                onchange: null,
                dispatchEvent: function () { return false; },
            };
        };
    });
    afterEach(() => {
        window.matchMedia = originalMatchMedia;
    });

    it('setStudying(true) adds the .studying class and removes idle/walking', () => {
        localStorage.setItem('todoapp_companion_enabled', 'true');
        const c = createCompanion(document);
        const el = document.getElementById('companion');
        expect(el).not.toBeNull();
        c.setStudying(true);
        expect(el.classList.contains('studying')).toBe(true);
        expect(el.classList.contains('idle')).toBe(false);
        expect(el.classList.contains('walking')).toBe(false);
        c.destroy();
    });

    it('setStudying(false) restores idle when leaving the study state', () => {
        localStorage.setItem('todoapp_companion_enabled', 'true');
        const c = createCompanion(document);
        const el = document.getElementById('companion');
        c.setStudying(true);
        expect(el.classList.contains('studying')).toBe(true);
        c.setStudying(false);
        expect(el.classList.contains('studying')).toBe(false);
        expect(el.classList.contains('idle')).toBe(true);
        c.destroy();
    });

    it('setStudying(true) called twice does not stack class manipulations', () => {
        localStorage.setItem('todoapp_companion_enabled', 'true');
        const c = createCompanion(document);
        const el = document.getElementById('companion');
        c.setStudying(true);
        c.setStudying(true);
        // Exactly one .studying class on the element regardless of repeat calls.
        const classes = (el.className || '').split(/\s+/).filter(Boolean);
        const studyingCount = classes.filter(function (cls) { return cls === 'studying'; }).length;
        expect(studyingCount).toBe(1);
        c.destroy();
    });
});

describe('ghost companion — periodic blink', () => {
    const js  = read('companion.js');
    const css = read('style.css');

    it('swaps to a closed-eyes sprite while .blinking is applied — true eye-only blink, not a body transform', () => {
        // The blink is a sprite-swap, not an animation. The .blinking rule
        // overrides background-image to a separate "closed eyes" SVG so only
        // the eye region changes during the 120ms the class is on.
        expect(css).toMatch(/\.companion\.blinking\s*\{[^}]*background-image:\s*url\([^)]*companion-ghost-blink\.svg[^)]*\)[^}]*\}/);
    });

    it('keeps the blink running under prefers-reduced-motion — same policy as the JS wander loop', () => {
        // The 120ms blink is mild ambient motion (matches the wander, which
        // also stays on under reduced-motion). The cheer keyframes and idle
        // bob are still silenced — they're the attention-grabby ones.
        // Find the companion-specific reduced-motion block (style.css has
        // multiple `prefers-reduced-motion: reduce` blocks; we want the one
        // that gates `.companion.cheering`).
        const blocks = css.match(/@media\s+\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g) || [];
        const companionBlock = blocks.find(function (b) { return /\.companion\.cheering/.test(b); });
        expect(companionBlock).toBeTruthy();
        expect(companionBlock).not.toMatch(/\.companion\.blinking/);
        // Sanity: cheer + idle are still gated in this same block.
        expect(companionBlock).toMatch(/\.companion\.cheering/);
        expect(companionBlock).toMatch(/\.companion\.idle/);
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

    it('blocks blinks only during cheering — walking and idle both blink so they read as alive while wandering', () => {
        // The blink fire-callback bails when state is CHEERING, and setState
        // calls cancelBlink on entry into CHEERING. WALKING and IDLE both
        // permit blinks because the brief 120ms transform squish doesn't
        // conflict with the position lerp, only with the cheer keyframes.
        const cheerGuard = /state\s*===\s*['"]CHEERING['"]/.test(js)
                        || /state\s*!==?\s*['"]CHEERING['"]/.test(js);
        expect(cheerGuard).toBe(true);
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
