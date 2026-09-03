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
        // The API-spend nav button sits between focus-mode and settings in the
        // right cluster, so it appears in the arrow-key order between them too.
        expect(js).toMatch(/musicToggle,\s*focusModeToggle,\s*spendToggle,\s*settingsToggle/);
    });
});

// The scene swap borrows the live YouTube player iframe from the music
// popover and hands it back. The node identity assertions below are the point
// of these tests: recreating the iframe instead of reparenting it would
// restart playback, which is exactly the regression this feature must not
// introduce.
describe('focus mode — video scene swap', () => {
    function mountFakePlayer() {
        const wrap = document.createElement('div');
        wrap.className = 'musicPlayerWrap';
        const frame = document.createElement('iframe');
        frame.id = 'musicPlayerTarget';
        wrap.appendChild(frame);
        document.body.appendChild(wrap);
        return { wrap, frame };
    }

    afterEach(() => {
        destroyFocusMode();
        const stray = document.getElementById('focusModeOverlay');
        if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
        const wrap = document.querySelector('.musicPlayerWrap');
        if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
        document.body.classList.remove('focusModeOpen');
        delete window.matchMedia;
    });

    it('renders a third icon-only control after the session button in the corner cluster', () => {
        stubMatchMedia(true);
        const f = createFocusMode(document);
        f.activate();
        const corner = document.querySelector('.focusCorner');
        const videoBtn = corner.querySelector('.focusVideoBtn');
        expect(videoBtn).not.toBeNull();
        // Order: chip, session button, then the scene swap.
        const kids = Array.from(corner.children);
        expect(kids.indexOf(videoBtn)).toBe(kids.indexOf(corner.querySelector('.focusSessionBtn')) + 1);
        // Icon-only, inline stroke SVG — no text label.
        expect(videoBtn.querySelector('svg[stroke="currentColor"]')).not.toBeNull();
        expect(videoBtn.textContent.trim()).toBe('');
        f.destroy();
    });

    it('mounts an empty .focusVideoLayer with a scrim above the scene', () => {
        stubMatchMedia(true);
        const f = createFocusMode(document);
        f.activate();
        const layer = document.querySelector('#focusModeOverlay .focusVideoLayer');
        expect(layer).not.toBeNull();
        expect(layer.querySelector('.focusVideoScrim')).not.toBeNull();
        expect(layer.querySelector('iframe')).toBeNull();
        f.destroy();
    });

    it('is disabled and a no-op when no player iframe exists yet', () => {
        stubMatchMedia(true);
        const f = createFocusMode(document);
        f.activate();
        const videoBtn = document.querySelector('.focusVideoBtn');
        expect(videoBtn.disabled).toBe(true);
        videoBtn.click();
        expect(document.getElementById('focusModeOverlay').classList.contains('focusModeOverlay--video')).toBe(false);
        expect(document.querySelector('.focusVideoLayer iframe')).toBeNull();
        expect(videoBtn.getAttribute('aria-pressed')).toBe('false');
        f.destroy();
    });

    it('reparents the SAME iframe node into the video layer and hides the star scene', () => {
        stubMatchMedia(true);
        const { frame } = mountFakePlayer();
        const f = createFocusMode(document);
        f.activate();
        const videoBtn = document.querySelector('.focusVideoBtn');
        expect(videoBtn.disabled).toBe(false);
        videoBtn.click();
        const layer = document.querySelector('.focusVideoLayer');
        // Same node, never recreated — that is what preserves playback.
        expect(layer.querySelector('iframe')).toBe(frame);
        expect(document.querySelector('.musicPlayerWrap iframe')).toBeNull();
        expect(document.getElementById('focusModeOverlay').classList.contains('focusModeOverlay--video')).toBe(true);
        expect(videoBtn.getAttribute('aria-pressed')).toBe('true');
        f.destroy();
    });

    it('toggling off hands the same iframe back to .musicPlayerWrap and restores the scene', () => {
        stubMatchMedia(true);
        const { wrap, frame } = mountFakePlayer();
        const f = createFocusMode(document);
        f.activate();
        const videoBtn = document.querySelector('.focusVideoBtn');
        videoBtn.click();
        videoBtn.click();
        expect(wrap.querySelector('iframe')).toBe(frame);
        expect(document.querySelector('.focusVideoLayer iframe')).toBeNull();
        expect(document.getElementById('focusModeOverlay').classList.contains('focusModeOverlay--video')).toBe(false);
        expect(videoBtn.getAttribute('aria-pressed')).toBe('false');
        f.destroy();
    });

    it('exiting focus mode restores the iframe even while the swap is still on, and re-entry starts on the star scene', () => {
        stubMatchMedia(true);
        const { wrap, frame } = mountFakePlayer();
        const f = createFocusMode(document);
        f.activate();
        document.querySelector('.focusVideoBtn').click();
        f.deactivate();
        expect(wrap.querySelector('iframe')).toBe(frame);
        const overlay = document.getElementById('focusModeOverlay');
        expect(overlay.classList.contains('focusModeOverlay--video')).toBe(false);
        // Re-entry: star scene, toggle reset to off.
        f.activate();
        expect(overlay.classList.contains('focusModeOverlay--video')).toBe(false);
        expect(document.querySelector('.focusVideoBtn').getAttribute('aria-pressed')).toBe('false');
        expect(document.querySelector('.focusVideoLayer iframe')).toBeNull();
        f.destroy();
    });

    it('Escape exits and restores the iframe', () => {
        stubMatchMedia(true);
        const { wrap, frame } = mountFakePlayer();
        const f = createFocusMode(document);
        f.activate();
        document.querySelector('.focusVideoBtn').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(f.isActive()).toBe(false);
        expect(wrap.querySelector('iframe')).toBe(frame);
        f.destroy();
    });

    it('destroy hands the iframe back before tearing the overlay down', () => {
        stubMatchMedia(true);
        const { wrap, frame } = mountFakePlayer();
        const f = createFocusMode(document);
        f.activate();
        document.querySelector('.focusVideoBtn').click();
        f.destroy();
        expect(wrap.querySelector('iframe')).toBe(frame);
        expect(document.getElementById('focusModeOverlay')).toBeNull();
    });
});

describe('focus mode — video scene CSS hooks', () => {
    const css = read('style.css');

    it('sizes .focusVideoLayer to cover, above the scene and below the corner cluster', () => {
        const block = css.match(/\.focusVideoLayer\s*\{([^}]*)\}/);
        expect(block).not.toBeNull();
        expect(block[1]).toMatch(/position:\s*absolute/);
        expect(block[1]).toMatch(/inset:\s*0/);
        expect(block[1]).toMatch(/z-index:\s*1\b/);
    });

    it('stretches the borrowed iframe to fill the layer', () => {
        const block = css.match(/\.focusVideoLayer iframe\s*\{([^}]*)\}/);
        expect(block).not.toBeNull();
        expect(block[1]).toMatch(/width:\s*100%/);
        expect(block[1]).toMatch(/height:\s*100%/);
    });

    it('scrims the video so the corner controls stay legible', () => {
        const block = css.match(/\.focusVideoScrim\s*\{([^}]*)\}/);
        expect(block).not.toBeNull();
        expect(block[1]).toMatch(/background:\s*rgba\(0,\s*0,\s*0,\s*0\.35\)/);
    });

    it('hides the star scene via the --video class, not an inline style', () => {
        expect(css).toMatch(/\.focusModeOverlay--video\s+\.focusScene\s*\{\s*display:\s*none/);
        expect(read('focusMode.js')).not.toMatch(/style\.display/);
    });

    it('gives the swap control a purple active state and a disabled state', () => {
        const active = css.match(/\.focusVideoBtn\[aria-pressed="true"\]\s*\{([^}]*)\}/);
        expect(active).not.toBeNull();
        expect(active[1]).toMatch(/rgba\(108,\s*93,\s*245,\s*0\.28\)/);
        expect(active[1]).toMatch(/#9D93EE/i);
        expect(css).toMatch(/\.focusVideoBtn:disabled\s*\{/);
    });

    it('respects prefers-reduced-motion on the swap transition', () => {
        expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*\.focusVideoLayer\s*\{\s*transition:\s*none/);
    });
});
