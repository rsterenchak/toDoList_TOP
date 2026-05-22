// Pins the mobile first-run welcome carousel contract — module behavior
// (start / advance / dismiss / persistence / swipe), the settings-menu
// "Replay welcome carousel" entry that triggers it, the modal-overlap
// guard in modals.js, the auto-trigger hook in index.js, and the seeding
// that runs on every viewport so the mobile carousel and desktop tour
// both anchor against the same sample project. The CSS surfaces that
// style the backdrop, slides, dots, and CTA pill are pinned too so a
// future refactor can't silently drop the full-screen container or the
// active-dot accent.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    startWelcomeCarousel,
    maybeStartFirstRunCarousel,
    getWelcomeCarouselCardCount,
    CAROUSEL_BACKDROP_ID,
    CAROUSEL_ID,
    CAROUSEL_SKIP_ID,
    CAROUSEL_TRACK_ID,
    CAROUSEL_NEXT_ID,
} from '../src/welcomeCarousel.js';
import {
    isOnboardingComplete,
    setOnboardingComplete,
    ONBOARDING_COMPLETE_KEY,
} from '../src/prefs.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function setMobileViewport() {
    Object.defineProperty(window, 'innerWidth', { value: 414, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
}

function setDesktopViewport() {
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
}

function stubMatchMedia(coarse) {
    window.matchMedia = function(query) {
        const matches = query.indexOf('coarse') !== -1 ? !!coarse : !coarse;
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

function makeTouchEvent(type, x, y) {
    // jsdom doesn't ship the TouchEvent constructor; build the same shape
    // the module reads (touches / changedTouches with clientX/Y) on top
    // of a plain Event so dispatchEvent fires the registered handlers.
    const ev = new Event(type, { bubbles: true, cancelable: true });
    const touch = { clientX: x, clientY: y };
    ev.touches = type === 'touchend' || type === 'touchcancel' ? [] : [touch];
    ev.changedTouches = [touch];
    return ev;
}

describe('welcome carousel — module', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
        setMobileViewport();
        stubMatchMedia(true);
    });

    afterEach(() => {
        // Pressing Escape routes through the module's own finish() path
        // so the module-internal active state clears between tests.
        if (document.getElementById(CAROUSEL_BACKDROP_ID)) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
    });

    it('exposes four cards and stable ids', () => {
        expect(getWelcomeCarouselCardCount()).toBe(4);
        expect(CAROUSEL_BACKDROP_ID).toBe('welcomeCarouselBackdrop');
        expect(CAROUSEL_ID).toBe('welcomeCarousel');
        expect(CAROUSEL_SKIP_ID).toBe('welcomeCarouselSkip');
        expect(CAROUSEL_TRACK_ID).toBe('welcomeCarouselTrack');
        expect(CAROUSEL_NEXT_ID).toBe('welcomeCarouselNext');
        expect(ONBOARDING_COMPLETE_KEY).toBe('todoapp_onboardingComplete');
    });

    it('mounts the backdrop, container, four slides, Skip link, and Next button', () => {
        startWelcomeCarousel();
        const backdrop = document.getElementById(CAROUSEL_BACKDROP_ID);
        const container = document.getElementById(CAROUSEL_ID);
        const skip = document.getElementById(CAROUSEL_SKIP_ID);
        const next = document.getElementById(CAROUSEL_NEXT_ID);
        const track = document.getElementById(CAROUSEL_TRACK_ID);
        expect(backdrop).not.toBeNull();
        expect(container).not.toBeNull();
        expect(skip).not.toBeNull();
        expect(next).not.toBeNull();
        expect(track).not.toBeNull();
        expect(track.querySelectorAll('.welcomeCarouselSlide').length).toBe(4);
    });

    it('renders a dialog role and pagination dots with the first dot active', () => {
        startWelcomeCarousel();
        const container = document.getElementById(CAROUSEL_ID);
        expect(container.getAttribute('role')).toBe('dialog');
        expect(container.getAttribute('aria-modal')).toBe('true');
        expect(container.getAttribute('aria-labelledby')).toBe('welcomeCarouselTitle');
        const dots = document.querySelectorAll('.welcomeCarouselDot');
        expect(dots.length).toBe(4);
        expect(dots[0].classList.contains('active')).toBe(true);
        for (let i = 1; i < dots.length; i++) {
            expect(dots[i].classList.contains('active')).toBe(false);
        }
    });

    it('shifts the track via translateX as the user advances', () => {
        startWelcomeCarousel();
        const track = document.getElementById(CAROUSEL_TRACK_ID);
        expect(track.style.transform).toBe('translateX(-0%)');
        document.getElementById(CAROUSEL_NEXT_ID).click();
        expect(track.style.transform).toBe('translateX(-100%)');
        document.getElementById(CAROUSEL_NEXT_ID).click();
        expect(track.style.transform).toBe('translateX(-200%)');
    });

    it('advances the active dot to match the current step', () => {
        startWelcomeCarousel();
        document.getElementById(CAROUSEL_NEXT_ID).click();
        document.getElementById(CAROUSEL_NEXT_ID).click();
        const dots = document.querySelectorAll('.welcomeCarouselDot');
        expect(dots[2].classList.contains('active')).toBe(true);
        expect(dots[0].classList.contains('active')).toBe(false);
        expect(dots[1].classList.contains('active')).toBe(false);
        expect(dots[3].classList.contains('active')).toBe(false);
    });

    it('switches the Next button copy to "Let\'s go" on the closer card', () => {
        startWelcomeCarousel();
        const next = document.getElementById(CAROUSEL_NEXT_ID);
        expect(next.textContent).toBe('Next ›');
        for (let i = 0; i < 3; i++) next.click();
        expect(next.textContent).toBe("Let's go");
    });

    it("'Let's go' on the closer card finishes the carousel and persists the flag", () => {
        startWelcomeCarousel();
        const next = document.getElementById(CAROUSEL_NEXT_ID);
        for (let i = 0; i < 4; i++) {
            document.getElementById(CAROUSEL_NEXT_ID).click();
        }
        expect(document.getElementById(CAROUSEL_BACKDROP_ID)).toBeNull();
        expect(isOnboardingComplete()).toBe(true);
    });

    it('Skip dismisses the carousel and persists the completion flag', () => {
        startWelcomeCarousel();
        document.getElementById(CAROUSEL_SKIP_ID).click();
        expect(document.getElementById(CAROUSEL_BACKDROP_ID)).toBeNull();
        expect(isOnboardingComplete()).toBe(true);
    });

    it('Escape dismisses the carousel', () => {
        startWelcomeCarousel();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.getElementById(CAROUSEL_BACKDROP_ID)).toBeNull();
        expect(isOnboardingComplete()).toBe(true);
    });

    it('does NOT dismiss on backdrop click — the surface IS the carousel', () => {
        startWelcomeCarousel();
        const backdrop = document.getElementById(CAROUSEL_BACKDROP_ID);
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById(CAROUSEL_BACKDROP_ID)).not.toBeNull();
    });

    it('a left-swipe gesture advances to the next card', () => {
        startWelcomeCarousel();
        const track = document.getElementById(CAROUSEL_TRACK_ID);
        track.dispatchEvent(makeTouchEvent('touchstart', 300, 400));
        track.dispatchEvent(makeTouchEvent('touchend', 200, 405));
        expect(track.style.transform).toBe('translateX(-100%)');
    });

    it('a right-swipe gesture retreats to the previous card', () => {
        startWelcomeCarousel();
        document.getElementById(CAROUSEL_NEXT_ID).click();
        const track = document.getElementById(CAROUSEL_TRACK_ID);
        expect(track.style.transform).toBe('translateX(-100%)');
        track.dispatchEvent(makeTouchEvent('touchstart', 100, 400));
        track.dispatchEvent(makeTouchEvent('touchend', 240, 410));
        expect(track.style.transform).toBe('translateX(-0%)');
    });

    it('a swipe under the threshold or mostly-vertical does nothing', () => {
        startWelcomeCarousel();
        const track = document.getElementById(CAROUSEL_TRACK_ID);
        // tiny horizontal
        track.dispatchEvent(makeTouchEvent('touchstart', 300, 400));
        track.dispatchEvent(makeTouchEvent('touchend', 280, 405));
        expect(track.style.transform).toBe('translateX(-0%)');
        // vertical-dominant
        track.dispatchEvent(makeTouchEvent('touchstart', 300, 200));
        track.dispatchEvent(makeTouchEvent('touchend', 200, 600));
        expect(track.style.transform).toBe('translateX(-0%)');
    });

    it('starting twice is a no-op — only one backdrop mounts', () => {
        startWelcomeCarousel();
        startWelcomeCarousel();
        expect(document.querySelectorAll('#' + CAROUSEL_BACKDROP_ID).length).toBe(1);
    });

    it('maybeStartFirstRunCarousel skips when the completion flag is set', () => {
        setOnboardingComplete(true);
        const started = maybeStartFirstRunCarousel();
        expect(started).toBe(false);
        expect(document.getElementById(CAROUSEL_BACKDROP_ID)).toBeNull();
    });

    it('maybeStartFirstRunCarousel skips on desktop-width viewports', () => {
        setDesktopViewport();
        stubMatchMedia(true);
        const started = maybeStartFirstRunCarousel();
        expect(started).toBe(false);
        expect(document.getElementById(CAROUSEL_BACKDROP_ID)).toBeNull();
    });

    it('maybeStartFirstRunCarousel skips when the pointer is fine (desktop mouse)', () => {
        setMobileViewport();
        stubMatchMedia(false);
        const started = maybeStartFirstRunCarousel();
        expect(started).toBe(false);
        expect(document.getElementById(CAROUSEL_BACKDROP_ID)).toBeNull();
    });

    it('maybeStartFirstRunCarousel runs on coarse-pointer mobile viewports with no saved flag', () => {
        setMobileViewport();
        stubMatchMedia(true);
        const started = maybeStartFirstRunCarousel();
        expect(started).toBe(true);
        expect(document.getElementById(CAROUSEL_BACKDROP_ID)).not.toBeNull();
    });

    it('maybeStartFirstRunCarousel yields when the desktop coachmark overlay is already mounted', () => {
        setMobileViewport();
        stubMatchMedia(true);
        const sentinel = document.createElement('div');
        sentinel.id = 'coachmarkOverlay';
        document.body.appendChild(sentinel);
        const started = maybeStartFirstRunCarousel();
        expect(started).toBe(false);
        expect(document.getElementById(CAROUSEL_BACKDROP_ID)).toBeNull();
    });

    it('startWelcomeCarousel clears any prior completion flag so a Replay works', () => {
        setOnboardingComplete(true);
        expect(isOnboardingComplete()).toBe(true);
        startWelcomeCarousel();
        expect(isOnboardingComplete()).toBe(false);
    });

    it('Skip link uses 16px+ font-size so iOS Safari does not auto-zoom on tap', () => {
        // Per CLAUDE.md, touch-targeted inputs and tappable text controls
        // sit at 16px or larger to suppress the iOS focus-zoom behavior.
        // Reading from the source rather than computed style because jsdom
        // doesn't apply external stylesheets.
        const css = read('style.css');
        const skipRule = css.match(/\.welcomeCarouselSkip\s*\{([^}]*)\}/);
        expect(skipRule).toBeTruthy();
        const fs = skipRule[1].match(/font-size:\s*(\d+)px/);
        expect(fs).toBeTruthy();
        expect(parseInt(fs[1], 10)).toBeGreaterThanOrEqual(16);
    });
});


describe('welcome carousel — wired into the app', () => {
    const main = read('main.js');
    const index = read('index.js');
    const modals = read('modals.js');
    const css = read('style.css');

    it('index.js imports and triggers the welcome carousel on mount', () => {
        expect(index).toMatch(/from\s+['"]\.\/welcomeCarousel\.js['"]/);
        expect(index).toMatch(/maybeStartFirstRunCarousel\s*\(\s*\)/);
    });

    it('main.js exposes the carousel module for the Replay entry', () => {
        expect(main).toMatch(/from\s+['"]\.\/welcomeCarousel\.js['"]/);
        expect(main).toMatch(/startWelcomeCarousel/);
    });

    it('settings menu Replay welcome tour row dispatches to the carousel on mobile viewports', () => {
        // The desktop popover and the mobile settings modal both surface a
        // single "Replay welcome tour" row that dispatches by viewport: the
        // mobile carousel on coarse-pointer narrow viewports, the desktop
        // coachmark tour everywhere else. Pin the row label and the
        // carousel reference inside the row's activation handler so a
        // future refactor can't silently drop one half of the dispatch.
        expect(main).toMatch(/buildSettingsMenuItem\(\s*['"]Replay welcome tour['"]/);
        const idx = main.indexOf("'Replay welcome tour'");
        expect(idx).toBeGreaterThan(-1);
        const slice = main.slice(idx, idx + 1000);
        expect(slice).toMatch(/startWelcomeCarousel\s*\(\s*\)/);
        expect(slice).toMatch(/isMobileCarouselViewport\s*\(\s*\)/);
    });

    it('settings menu groups the Replay entry under a HELP section heading', () => {
        // Both popovers expose the Replay row inside a labelled HELP
        // section so the global utilities cluster reads as one group.
        // The desktop popover uses a presentational heading element
        // (settingsMenuSectionHeading); the mobile modal uses the same
        // settingsSectionHeading class the View / Appearance sections use,
        // wrapped in a section with id #settingsHelpSection.
        expect(main).toMatch(/className\s*=\s*['"]settingsMenuSectionHeading['"]/);
        expect(main).toMatch(/settingsHelpSection/);
        // The desktop popover heading carries the literal label.
        const headingIdx = main.indexOf("'settingsMenuSectionHeading'");
        expect(headingIdx).toBeGreaterThan(-1);
        const headingSlice = main.slice(headingIdx, headingIdx + 200);
        expect(headingSlice).toMatch(/textContent\s*=\s*['"]Help['"]/);
    });

    it('mobile settings modal Replay row dispatches by viewport and closes the modal', () => {
        // The mobile drawer's Settings modal renders the Replay row via
        // createDrawerActionRow (chevron state, not ON/OFF pill). Tapping
        // closes the modal before starting the chosen flow so the carousel
        // / coachmark land on a clean surface, not on top of an open modal.
        const fnIdx = main.indexOf('function showSettingsModal');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 6000);
        expect(slice).toMatch(/createDrawerActionRow\(\s*['"]Replay welcome tour['"]/);
        expect(slice).toMatch(/isMobileCarouselViewport\s*\(\s*\)/);
        expect(slice).toMatch(/startWelcomeCarousel\s*\(\s*\)/);
        expect(slice).toMatch(/startCoachmarkTour\s*\(\s*\)/);
        // The close() call must precede the dispatch so the modal is gone
        // before the next flow mounts.
        const replayIdx = slice.indexOf("createDrawerActionRow('Replay welcome tour'");
        expect(replayIdx).toBeGreaterThan(-1);
        const handlerSlice = slice.slice(replayIdx, replayIdx + 1000);
        expect(handlerSlice.indexOf('close()')).toBeGreaterThan(-1);
        expect(handlerSlice.indexOf('close()'))
            .toBeLessThan(handlerSlice.indexOf('startWelcomeCarousel'));
    });

    it('exports isMobileCarouselViewport for the shared dispatch helper', () => {
        // The Replay row in both popovers calls into this helper so the
        // auto-trigger detection and the manual replay use the exact
        // same coarse-pointer / 768px gate.
        const welcome = read('welcomeCarousel.js');
        expect(welcome).toMatch(/export\s+function\s+isMobileCarouselViewport\s*\(/);
    });

    it('isAnyModalOrPopoverOpen treats the carousel backdrop as a modal', () => {
        const fnIdx = modals.indexOf('function isAnyModalOrPopoverOpen');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = modals.slice(fnIdx, fnIdx + 1500);
        expect(body).toContain('welcomeCarouselBackdrop');
    });

    it('restoreFromStorage seeds the sample project on every viewport, not just desktop', () => {
        // The mobile carousel and desktop coachmark both anchor against the
        // seeded "Getting started" project, so the seed gate is just the
        // onboarding flag — not the viewport width.
        const fnIdx = main.indexOf('function restoreFromStorage');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 600);
        expect(slice).toMatch(/seedSampleProject/);
        // The old gate (window.innerWidth > 700) is gone — only the
        // onboarding flag guards the seed.
        expect(slice).not.toMatch(/window\.innerWidth\s*>\s*700/);
    });

    it('styles the backdrop at z-index 600+ so it wins over every other modal', () => {
        const overlayRule = css.match(/#welcomeCarouselBackdrop\s*\{([^}]*)\}/);
        expect(overlayRule).toBeTruthy();
        const zMatch = overlayRule[1].match(/z-index:\s*(\d+)/);
        expect(zMatch).toBeTruthy();
        expect(parseInt(zMatch[1], 10)).toBeGreaterThanOrEqual(600);
    });

    it('styles the active pagination dot in the accent color', () => {
        expect(css).toMatch(/\.welcomeCarouselDot\.active\s*\{[^}]*background:\s*var\(--accent\)/);
    });

    it('styles the carousel container with full-viewport position: fixed inset 0', () => {
        const rule = css.match(/#welcomeCarouselBackdrop\s*\{([^}]*)\}/);
        expect(rule).toBeTruthy();
        expect(rule[1]).toMatch(/position:\s*fixed/);
        expect(rule[1]).toMatch(/inset:\s*0/);
    });

    it('mobile modal Replay handler switches to Projects view before starting the carousel', () => {
        // The mobile carousel itself isn't DOM-anchored, but it shares
        // the prep flow with the desktop tour so the same view-switch +
        // seed-when-empty fix lands symmetrically. Replaying from Today
        // or Calendar would otherwise leave the project sidebar hidden
        // behind the carousel backdrop.
        const fnIdx = main.indexOf('function showSettingsModal');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 7000);
        const replayIdx = slice.indexOf("createDrawerActionRow('Replay welcome tour'");
        expect(replayIdx).toBeGreaterThan(-1);
        const handlerSlice = slice.slice(replayIdx, replayIdx + 1500);
        expect(handlerSlice).toMatch(/applyActiveView\(\s*['"]projects['"]\s*\)/);
        const applyIdx = handlerSlice.indexOf("applyActiveView('projects')");
        const startIdx = handlerSlice.indexOf('startWelcomeCarousel');
        expect(applyIdx).toBeLessThan(startIdx);
    });

    it('mobile modal Replay handler force-seeds the sample project when the user has none', () => {
        const fnIdx = main.indexOf('function showSettingsModal');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 7000);
        const replayIdx = slice.indexOf("createDrawerActionRow('Replay welcome tour'");
        expect(replayIdx).toBeGreaterThan(-1);
        const handlerSlice = slice.slice(replayIdx, replayIdx + 1500);
        expect(handlerSlice).toMatch(/listProjectsArray\(\s*\)\.length\s*===\s*0/);
        expect(handlerSlice).toMatch(/seedSampleProject\(\s*\{\s*force:\s*true\s*\}\s*\)/);
    });

    it('mobile modal Replay handler defers the tour kickoff so layout settles first', () => {
        const fnIdx = main.indexOf('function showSettingsModal');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 7000);
        const replayIdx = slice.indexOf("createDrawerActionRow('Replay welcome tour'");
        expect(replayIdx).toBeGreaterThan(-1);
        const handlerSlice = slice.slice(replayIdx, replayIdx + 1500);
        expect(handlerSlice).toMatch(/requestAnimationFrame/);
        const rafIdx = handlerSlice.indexOf('requestAnimationFrame');
        const startIdx = handlerSlice.indexOf('startWelcomeCarousel');
        expect(rafIdx).toBeLessThan(startIdx);
    });
});
