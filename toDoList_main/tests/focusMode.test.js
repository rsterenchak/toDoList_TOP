import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    supportsDesktopFocusMode,
    createFocusMode,
    ensureFocusMode,
    destroyFocusMode,
} from '../src/focusMode.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Stub matchMedia so the desktop gate ('(min-width: 1024px) and (pointer:
// fine)') and the reduced-motion query resolve deterministically. jsdom's
// default matchMedia returns matches:false, which is the non-desktop branch.
function stubMatchMedia(desktop) {
    window.matchMedia = function(query) {
        let matches = false;
        if (query.indexOf('min-width: 1024px') !== -1) matches = !!desktop;
        return {
            matches,
            media: query,
            onchange: null,
            addListener: function() {},
            removeListener: function() {},
            addEventListener: function() {},
            removeEventListener: function() {},
            dispatchEvent: function() { return false; },
        };
    };
}

// Focus mode is a desktop-only full-screen study scene. These tests pin the
// controller contract, the desktop gate, the lazy-and-retained overlay, the
// exit affordances (Esc + pill, but NOT clicking the scene), the CSS hooks,
// and the main.js nav wiring so the feature can't silently regress.
describe('focus mode — module surface', () => {
    afterEach(() => {
        destroyFocusMode();
        delete window.matchMedia;
    });

    it('exports supportsDesktopFocusMode / createFocusMode / ensureFocusMode / destroyFocusMode', () => {
        expect(typeof supportsDesktopFocusMode).toBe('function');
        expect(typeof createFocusMode).toBe('function');
        expect(typeof ensureFocusMode).toBe('function');
        expect(typeof destroyFocusMode).toBe('function');
    });

    it('createFocusMode returns a controller with activate/deactivate/isActive/destroy', () => {
        const f = createFocusMode(document);
        expect(typeof f.activate).toBe('function');
        expect(typeof f.deactivate).toBe('function');
        expect(typeof f.isActive).toBe('function');
        expect(typeof f.destroy).toBe('function');
        f.destroy();
    });

    it('supportsDesktopFocusMode reflects the desktop matchMedia gate', () => {
        stubMatchMedia(false);
        expect(supportsDesktopFocusMode()).toBe(false);
        stubMatchMedia(true);
        expect(supportsDesktopFocusMode()).toBe(true);
    });
});

describe('focus mode — controller behavior', () => {
    afterEach(() => {
        destroyFocusMode();
        const stray = document.getElementById('focusModeOverlay');
        if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
        document.body.classList.remove('focusModeOpen');
        delete window.matchMedia;
    });

    it('does not build the overlay and stays inactive when the viewport does not qualify', () => {
        stubMatchMedia(false);
        const f = createFocusMode(document);
        f.activate();
        expect(f.isActive()).toBe(false);
        expect(document.getElementById('focusModeOverlay')).toBeNull();
        f.destroy();
    });

    it('builds the overlay lazily on activate and marks it active on desktop', () => {
        stubMatchMedia(true);
        const f = createFocusMode(document);
        expect(document.getElementById('focusModeOverlay')).toBeNull();
        f.activate();
        const overlay = document.getElementById('focusModeOverlay');
        expect(overlay).not.toBeNull();
        expect(overlay.classList.contains('focusModeOverlay--active')).toBe(true);
        expect(overlay.getAttribute('aria-hidden')).toBe('false');
        expect(document.body.classList.contains('focusModeOpen')).toBe(true);
        expect(f.isActive()).toBe(true);
        f.destroy();
    });

    it('retains the overlay in the DOM after deactivate so re-entry is instant', () => {
        stubMatchMedia(true);
        const f = createFocusMode(document);
        f.activate();
        f.deactivate();
        const overlay = document.getElementById('focusModeOverlay');
        // Still mounted, just no longer active — no paint cost while off.
        expect(overlay).not.toBeNull();
        expect(overlay.classList.contains('focusModeOverlay--active')).toBe(false);
        expect(overlay.getAttribute('aria-hidden')).toBe('true');
        expect(document.body.classList.contains('focusModeOpen')).toBe(false);
        expect(f.isActive()).toBe(false);
        // Re-entry reuses the same element.
        f.activate();
        expect(document.getElementById('focusModeOverlay')).toBe(overlay);
        expect(f.isActive()).toBe(true);
        f.destroy();
    });

    it('exits on Escape', () => {
        stubMatchMedia(true);
        const f = createFocusMode(document);
        f.activate();
        expect(f.isActive()).toBe(true);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(f.isActive()).toBe(false);
        f.destroy();
    });

    it('exits when the dim exit pill is clicked', () => {
        stubMatchMedia(true);
        const f = createFocusMode(document);
        f.activate();
        const pill = document.querySelector('.focusExitPill');
        expect(pill).not.toBeNull();
        pill.click();
        expect(f.isActive()).toBe(false);
        f.destroy();
    });

    it('does NOT exit when the scene itself is clicked (stray-click guard)', () => {
        stubMatchMedia(true);
        const f = createFocusMode(document);
        f.activate();
        const scene = document.querySelector('.focusScene');
        expect(scene).not.toBeNull();
        scene.click();
        expect(f.isActive()).toBe(true);
        f.destroy();
    });

    it('renders a now-playing chip and a single icon-only session control (no MM:SS)', () => {
        stubMatchMedia(true);
        const f = createFocusMode(document);
        f.activate();
        const chip = document.querySelector('.focusNowPlaying');
        const sessionBtn = document.querySelector('.focusSessionBtn');
        expect(chip).not.toBeNull();
        expect(chip.querySelector('.focusEqBars')).not.toBeNull();
        expect(sessionBtn).not.toBeNull();
        expect(sessionBtn.getAttribute('data-pomo-status')).not.toBeNull();
        // The session control carries both play and pause glyphs; CSS swaps
        // them by data-pomo-status. No timer text is rendered anywhere.
        expect(sessionBtn.querySelector('.focusSessionPlay')).not.toBeNull();
        expect(sessionBtn.querySelector('.focusSessionPause')).not.toBeNull();
        expect(document.getElementById('focusModeOverlay').textContent).not.toMatch(/\d{1,2}:\d{2}/);
        f.destroy();
    });

    it('destroy removes the overlay entirely and detaches the Esc handler', () => {
        stubMatchMedia(true);
        const f = createFocusMode(document);
        f.activate();
        f.destroy();
        expect(document.getElementById('focusModeOverlay')).toBeNull();
        // A stray Escape after destroy must not throw.
        expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))).not.toThrow();
    });

    it('ensureFocusMode returns null off-desktop and a memoized singleton on desktop', () => {
        stubMatchMedia(false);
        expect(ensureFocusMode()).toBeNull();
        stubMatchMedia(true);
        const a = ensureFocusMode();
        const b = ensureFocusMode();
        expect(a).not.toBeNull();
        expect(a).toBe(b);
        destroyFocusMode();
    });
});

describe('focus mode — CSS hooks', () => {
    const css = read('style.css');

    it('the overlay sits above the companion (z-index 10001) at z-index 10002', () => {
        const block = css.match(/\.focusModeOverlay\s*\{([^}]*)\}/);
        expect(block).not.toBeNull();
        expect(block[1]).toMatch(/z-index:\s*10002\b/);
        expect(block[1]).toMatch(/position:\s*fixed/);
    });

    it('drives visibility/animation off the .focusModeOverlay--active class', () => {
        expect(css).toMatch(/\.focusModeOverlay--active\s*\{/);
        // Scene drift animations are scoped to the active class so no paint
        // cost is incurred while off.
        expect(css).toMatch(/\.focusModeOverlay--active\s+\.focusStars--far/);
    });

    it('respects prefers-reduced-motion by disabling the scene animations', () => {
        // The reduced-motion block collapses the enter scale and stills the
        // drift/twinkle/shoot/pulse animations.
        expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*\.focusModeOverlay--active\s*\{\s*animation:\s*none/);
        expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*\.focusShootingStar/);
    });

    it('styles the #focusModeToggle nav button', () => {
        expect(css).toMatch(/#focusModeToggle\s*\{/);
    });

    it('hides #focusModeToggle on mobile alongside the other right-cluster toggles', () => {
        expect(css).toMatch(/#focusModeToggle,\s*\n\s*#settingsToggle\s*\{\s*display:\s*none/);
    });
});

describe('focus mode — main.js nav wiring', () => {
    const js = read('main.js');

    it('imports ensureFocusMode from ./focusMode.js', () => {
        expect(js).toMatch(/import\s*\{[^}]*ensureFocusMode[^}]*\}\s*from\s*['"]\.\/focusMode\.js['"]/);
    });

    it('creates a #focusModeToggle button and appends it to the nav cluster', () => {
        expect(js).toMatch(/focusModeToggle\.id\s*=\s*['"]focusModeToggle['"]/);
        expect(js).toMatch(/nav\.appendChild\(focusModeToggle\)/);
    });

    it('wires the toggle click to activate the focus-mode controller', () => {
        // The click handler resolves the singleton and calls activate().
        const idx = js.indexOf("focusModeToggle.addEventListener('click'");
        expect(idx).toBeGreaterThan(-1);
        const body = js.slice(idx, idx + 260);
        expect(body).toMatch(/ensureFocusMode\s*\(\s*\)|getFocusModeController\s*\(\s*\)/);
        expect(body).toMatch(/\.activate\s*\(/);
    });

    it('includes focusModeToggle in the header arrow-key navigation order', () => {
        expect(js).toMatch(/musicToggle,\s*focusModeToggle,\s*settingsToggle/);
    });
});
