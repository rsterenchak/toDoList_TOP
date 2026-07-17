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

    // The wandering ghost is decorative and must sit above every other
    // stacking layer (top floating layer is z-index:10000) so it never
    // disappears behind the chat pane, modals, popovers, or sheets while it
    // wanders. It stays pointer-events:none so clicks pass through.
    it('the base .companion rule sits above the top floating layer (z-index 10001)', () => {
        const css = read('style.css');
        const block = css.match(/\.companion\s*\{([^}]*)\}/);
        expect(block).not.toBeNull();
        expect(block[1]).toMatch(/z-index:\s*10001\b/);
    });

    it('preserves pointer-events: none on .companion so clicks pass through', () => {
        const css = read('style.css');
        const block = css.match(/\.companion\s*\{([^}]*)\}/);
        expect(block).not.toBeNull();
        expect(block[1]).toMatch(/pointer-events:\s*none/);
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
    // The desktop ghost-menu "Toggle floating ghost" item was extracted into
    // settingsMenu.js (closure-to-factory carve-out); main.js still imports
    // ensure/destroyCompanion for the mobile settings modal + boot wiring.
    const settingsMenu = read('settingsMenu.js');
    // The mobile Settings-modal companion toggle builder (buildCompanionToggle)
    // was extracted into drawerRows.js, so its ensureCompanion/destroyCompanion
    // wiring is pinned there now; main.js supplies the toggle via
    // buildCompanionToggleRow and still calls ensureCompanion at boot.
    const drawerRows = read('drawerRows.js');

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
        // The mobile Settings-modal companion toggle handler now lives in
        // drawerRows.js, where it wires ensureCompanion / destroyCompanion.
        expect(drawerRows).toMatch(/ensureCompanion\s*\(\s*\)/);
        expect(drawerRows).toMatch(/destroyCompanion\s*\(\s*\)/);
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
        // against the wiring degrading to always-small cheers. Isolate the
        // wireCheckbox body via brace-matching so the search window doesn't
        // depend on a fragile fixed byte count.
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
        expect(body).toMatch(/remainingOpen\s*===\s*0/);
    });

    it('exposes the companion toggle as a Toggle floating ghost item inside the ghost menu dropdown', () => {
        // The pill-switch in the nav has been replaced by a dropdown menu
        // item — now labelled "Toggle floating ghost" to disambiguate it
        // from the static ghost-icon menu trigger that lives in the top-
        // right of the nav. The handler still flips isCompanionEnabled and
        // calls ensureCompanion / destroyCompanion the same way the old
        // switch did.
        expect(settingsMenu).toMatch(/buildSettingsMenuItem\(\s*'Toggle floating ghost'/);
        expect(settingsMenu).toMatch(/setCompanionEnabled\s*\(\s*next\s*\)/);
        expect(settingsMenu).toMatch(/ensureCompanion\s*\(\s*\)/);
        expect(settingsMenu).toMatch(/destroyCompanion\s*\(\s*\)/);
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
