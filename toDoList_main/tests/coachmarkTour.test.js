// Pins the first-run spotlight coachmark tour contract — module behavior
// (start / advance / dismiss / persistence), the static settings-menu
// "Replay welcome tour" entry that triggers it, the modal-overlap guard
// in modals.js, and the auto-trigger hook in restoreFromStorage. The CSS
// surfaces that style the overlay, callout, and dots are also pinned so a
// future refactor can't silently drop the dim panels or accent ring.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    startCoachmarkTour,
    maybeStartFirstRunTour,
    getCoachmarkStepCount,
    COACHMARK_OVERLAY_ID,
    COACHMARK_CALLOUT_ID,
    COACHMARK_CUTOUT_ID,
} from '../src/coachmark.js';
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

function buildSkeletonDOM() {
    document.body.innerHTML = '';
    // Targets that STEPS look up by id / selector inside the module.
    // sideMa carries the project rows; step 1 anchors against a selected
    // project entry inside it (the seeded sample on first run).
    const sideMa = document.createElement('div');
    sideMa.id = 'sideMa';
    const projChild = document.createElement('div');
    projChild.id = 'projChild';
    projChild.className = 'selectedProject';
    sideMa.appendChild(projChild);
    document.body.appendChild(sideMa);

    const projButton = document.createElement('div');
    projButton.id = 'projButton';
    document.body.appendChild(projButton);

    const pomodoroToggle = document.createElement('button');
    pomodoroToggle.id = 'pomodoroToggle';
    document.body.appendChild(pomodoroToggle);

    const musicToggle = document.createElement('button');
    musicToggle.id = 'musicToggle';
    document.body.appendChild(musicToggle);

    const settingsToggle = document.createElement('button');
    settingsToggle.id = 'settingsToggle';
    document.body.appendChild(settingsToggle);

    const mainList = document.createElement('div');
    mainList.id = 'mainList';
    const row = document.createElement('div');
    row.id = 'toDoChild';
    const input = document.createElement('input');
    input.id = 'toDoInput';
    row.appendChild(input);
    const duePill = document.createElement('button');
    duePill.id = 'duePill';
    row.appendChild(duePill);
    const descToggle = document.createElement('div');
    descToggle.id = 'descToggle';
    row.appendChild(descToggle);
    mainList.appendChild(row);
    document.body.appendChild(mainList);
    return { sideMa, projChild, projButton, pomodoroToggle, musicToggle, settingsToggle, mainList, row, input, duePill, descToggle };
}

function ensureDesktopViewport() {
    // jsdom defaults to 1024×768; explicitly set so the mobile-breakpoint
    // bail in maybeStartFirstRunTour can't fire even if the env changes.
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
}

function ensureMobileViewport() {
    Object.defineProperty(window, 'innerWidth', { value: 480, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
}

describe('coachmark tour — module', () => {
    beforeEach(() => {
        localStorage.clear();
        ensureDesktopViewport();
        buildSkeletonDOM();
    });

    afterEach(() => {
        // Dispatch Escape to trigger the module's own finish() path so the
        // module-internal `active` state is cleared between tests. Without
        // this, subsequent startCoachmarkTour() calls no-op (the module
        // guards against double-start).
        if (document.getElementById(COACHMARK_OVERLAY_ID)) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
    });

    it('exposes seven steps and stable ids', () => {
        expect(getCoachmarkStepCount()).toBe(7);
        expect(COACHMARK_OVERLAY_ID).toBe('coachmarkOverlay');
        expect(COACHMARK_CALLOUT_ID).toBe('coachmarkCallout');
        expect(COACHMARK_CUTOUT_ID).toBe('coachmarkCutout');
        expect(ONBOARDING_COMPLETE_KEY).toBe('todoapp_onboardingComplete');
    });

    it('mounts the overlay, callout, and cutout on start', () => {
        startCoachmarkTour();
        const overlay = document.getElementById(COACHMARK_OVERLAY_ID);
        const callout = document.getElementById(COACHMARK_CALLOUT_ID);
        const cutout  = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(overlay).not.toBeNull();
        expect(callout).not.toBeNull();
        expect(cutout).not.toBeNull();
        // Four dim panels arranged around the cut-out — the task allows
        // either a clip-path or a four-rect mask; this implementation
        // uses the four-rect approach for reliable cross-browser dimming.
        expect(overlay.querySelectorAll('.coachmarkPanel').length).toBe(4);
    });

    it('renders the STEP N OF M label with the documented format', () => {
        startCoachmarkTour();
        const label = document.querySelector('.coachmarkStepLabel');
        expect(label).not.toBeNull();
        expect(label.textContent).toBe('STEP 1 OF 7');
    });

    it('renders pagination dots, Skip / Next buttons, and a dialog role', () => {
        startCoachmarkTour();
        const dots = document.querySelectorAll('.coachmarkDot');
        expect(dots.length).toBe(7);
        expect(dots[0].classList.contains('active')).toBe(true);
        expect(document.querySelector('.coachmarkSkip')).not.toBeNull();
        const next = document.querySelector('.coachmarkNext');
        expect(next).not.toBeNull();
        expect(next.textContent).toBe('Next ›');
        const callout = document.getElementById(COACHMARK_CALLOUT_ID);
        expect(callout.getAttribute('role')).toBe('dialog');
        expect(callout.getAttribute('aria-labelledby')).toBe('coachmarkTitle');
    });

    it('advances to the next step when Next is clicked', () => {
        startCoachmarkTour();
        const next = document.querySelector('.coachmarkNext');
        next.click();
        const label = document.querySelector('.coachmarkStepLabel');
        expect(label.textContent).toBe('STEP 2 OF 7');
    });

    it('switches the Next button to "You\'re set" on the final step', () => {
        startCoachmarkTour();
        for (let i = 0; i < 6; i++) {
            document.querySelector('.coachmarkNext').click();
        }
        const next = document.querySelector('.coachmarkNext');
        expect(next.textContent).toBe("You're set");
        const skip = document.querySelector('.coachmarkSkip');
        expect(skip.textContent).toBe('Close');
    });

    it('clicking "You\'re set" finishes the tour and persists the completion flag', () => {
        startCoachmarkTour();
        for (let i = 0; i < 7; i++) {
            document.querySelector('.coachmarkNext').click();
        }
        expect(document.getElementById(COACHMARK_OVERLAY_ID)).toBeNull();
        expect(document.getElementById(COACHMARK_CALLOUT_ID)).toBeNull();
        expect(isOnboardingComplete()).toBe(true);
    });

    it('Skip dismisses the tour and persists the completion flag', () => {
        startCoachmarkTour();
        document.querySelector('.coachmarkSkip').click();
        expect(document.getElementById(COACHMARK_OVERLAY_ID)).toBeNull();
        expect(isOnboardingComplete()).toBe(true);
    });

    it('Escape dismisses the tour', () => {
        startCoachmarkTour();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.getElementById(COACHMARK_OVERLAY_ID)).toBeNull();
        expect(isOnboardingComplete()).toBe(true);
    });

    it('backdrop panel click dismisses the tour', () => {
        startCoachmarkTour();
        const overlay = document.getElementById(COACHMARK_OVERLAY_ID);
        const panel = overlay.querySelector('.coachmarkPanel');
        // Need a real click event that targets the panel itself.
        panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById(COACHMARK_OVERLAY_ID)).toBeNull();
    });

    it('clicking the highlighted target advances the step', () => {
        startCoachmarkTour();
        // Step 1's target is the selected sidebar project row (the
        // seeded sample on first run). Click it to verify the advance.
        const projChild = document.querySelector('.selectedProject');
        projChild.click();
        // The advance handler defers by one tick so the underlying click
        // can settle before the next target() resolves.
        return new Promise(function(done) {
            setTimeout(function() {
                const label = document.querySelector('.coachmarkStepLabel');
                expect(label.textContent).toBe('STEP 2 OF 7');
                done();
            }, 0);
        });
    });

    it('starting twice is a no-op — only one overlay mounts', () => {
        startCoachmarkTour();
        startCoachmarkTour();
        const overlays = document.querySelectorAll('#' + COACHMARK_OVERLAY_ID);
        expect(overlays.length).toBe(1);
    });

    it('maybeStartFirstRunTour skips when the completion flag is set', () => {
        setOnboardingComplete(true);
        const started = maybeStartFirstRunTour();
        expect(started).toBe(false);
        expect(document.getElementById(COACHMARK_OVERLAY_ID)).toBeNull();
    });

    it('maybeStartFirstRunTour skips on mobile-width viewports', () => {
        ensureMobileViewport();
        const started = maybeStartFirstRunTour();
        expect(started).toBe(false);
        expect(document.getElementById(COACHMARK_OVERLAY_ID)).toBeNull();
    });

    it('maybeStartFirstRunTour starts the tour on desktop with no saved flag', () => {
        const started = maybeStartFirstRunTour();
        expect(started).toBe(true);
        expect(document.getElementById(COACHMARK_OVERLAY_ID)).not.toBeNull();
    });

    it('startCoachmarkTour clears any prior completion flag so a Replay works', () => {
        setOnboardingComplete(true);
        expect(isOnboardingComplete()).toBe(true);
        startCoachmarkTour();
        // While the tour is mid-flight the flag is false; only finish() sets it.
        expect(isOnboardingComplete()).toBe(false);
    });

    it('walks through the music toggle on step 6 and the settings toggle on step 7', () => {
        const { musicToggle, settingsToggle } = buildSkeletonDOM();
        musicToggle.getBoundingClientRect = function() {
            return { top: 20, left: 600, right: 640, bottom: 60, width: 40, height: 40, x: 600, y: 20 };
        };
        settingsToggle.getBoundingClientRect = function() {
            return { top: 20, left: 660, right: 700, bottom: 60, width: 40, height: 40, x: 660, y: 20 };
        };
        startCoachmarkTour();
        // Advance to step 6 (music) and verify the cutout tracks #musicToggle.
        for (let i = 0; i < 5; i++) {
            document.querySelector('.coachmarkNext').click();
        }
        let label = document.querySelector('.coachmarkStepLabel');
        expect(label.textContent).toBe('STEP 6 OF 7');
        let cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(parseInt(cutout.style.left, 10)).toBe(594);
        // Advance to step 7 (settings) and verify the cutout tracks #settingsToggle.
        document.querySelector('.coachmarkNext').click();
        label = document.querySelector('.coachmarkStepLabel');
        expect(label.textContent).toBe('STEP 7 OF 7');
        cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(parseInt(cutout.style.left, 10)).toBe(654);
    });

    it('positions the cutout over the target via fixed coordinates', () => {
        const { projChild } = buildSkeletonDOM();
        // Step 1's target is the selected sidebar project row, so the
        // cutout should track its bounding rect (plus the 6px padding).
        projChild.getBoundingClientRect = function() {
            return { top: 100, left: 50, right: 150, bottom: 140, width: 100, height: 40, x: 50, y: 100 };
        };
        startCoachmarkTour();
        const cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(cutout.style.position).toBe('');
        // Coordinates account for the 6px padding around the target rect.
        expect(parseInt(cutout.style.top, 10)).toBe(94);
        expect(parseInt(cutout.style.left, 10)).toBe(44);
    });
});


describe('coachmark tour — wired into the app', () => {
    const main = read('main.js');
    const modals = read('modals.js');
    const css = read('style.css');
    const prefs = read('prefs.js');

    it('main.js imports the coachmark module', () => {
        expect(main).toMatch(/from\s+['"]\.\/coachmark\.js['"]/);
        expect(main).toMatch(/maybeStartFirstRunTour/);
        expect(main).toMatch(/startCoachmarkTour/);
    });

    it('restoreFromStorage triggers the first-run tour when no projects exist', () => {
        // The auto-trigger sits inside the savedProjects.length === 0 branch
        // of restoreFromStorage. Find that branch and assert the call.
        const fnIdx = main.indexOf('function restoreFromStorage');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 1200);
        expect(slice).toMatch(/savedProjects\.length\s*===\s*0/);
        expect(slice).toMatch(/maybeStartFirstRunTour\s*\(\s*\)/);
    });

    it('settings menu exposes a Replay welcome tour entry', () => {
        expect(main).toMatch(/buildSettingsMenuItem\(\s*['"]Replay welcome tour['"]/);
        const idx = main.indexOf("'Replay welcome tour'");
        expect(idx).toBeGreaterThan(-1);
        const slice = main.slice(idx, idx + 400);
        expect(slice).toMatch(/startCoachmarkTour\s*\(\s*\)/);
    });

    it('isAnyModalOrPopoverOpen treats the coachmark overlay as a modal', () => {
        const fnIdx = modals.indexOf('function isAnyModalOrPopoverOpen');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = modals.slice(fnIdx, fnIdx + 1400);
        expect(body).toContain('coachmarkOverlay');
    });

    it('persists the onboarding flag under the documented key', () => {
        expect(prefs).toMatch(/ONBOARDING_COMPLETE_KEY\s*=\s*['"]todoapp_onboardingComplete['"]/);
        expect(prefs).toMatch(/export\s+function\s+isOnboardingComplete\s*\(/);
        expect(prefs).toMatch(/export\s+function\s+setOnboardingComplete\s*\(/);
    });

    it('styles the overlay at z-index 600+ so it wins over every other modal', () => {
        // The overlay must outrank modals/popovers (the existing modal stack
        // sits well below 600 in style.css), otherwise the spotlight gets
        // covered by something the user shouldn't be interacting with.
        const overlayRule = css.match(/#coachmarkOverlay\s*\{([^}]*)\}/);
        expect(overlayRule).toBeTruthy();
        const zMatch = overlayRule[1].match(/z-index:\s*(\d+)/);
        expect(zMatch).toBeTruthy();
        expect(parseInt(zMatch[1], 10)).toBeGreaterThanOrEqual(600);
    });

    it('styles the dim panels and the accent ring around the cut-out', () => {
        // The four dim panels are auto-painted with a dark wash; the visible
        // ring traces the cut-out in the accent color so the user can see
        // exactly which control the step is pointing at.
        expect(css).toMatch(/\.coachmarkPanel\s*\{[^}]*background:\s*rgba/);
        expect(css).toMatch(/#coachmarkCutout\s*\{[^}]*border:[^;]*var\(--accent\)/);
        // Pointer events stay off the ring so the user can click through to
        // the highlighted control.
        expect(css).toMatch(/#coachmarkCutout\s*\{[^}]*pointer-events:\s*none/);
    });

    it('styles the callout dots so the active step is accent-coloured', () => {
        expect(css).toMatch(/\.coachmarkDot\.active\s*\{[^}]*background:\s*var\(--accent\)/);
    });

    it('restoreFromStorage seeds the sample project before reading projects', () => {
        // The seed call has to land before listLogic.listProjectsArray()
        // so the rendered branch picks up the freshly-seeded sample and
        // the tour has live DOM targets to anchor against.
        const fnIdx = main.indexOf('function restoreFromStorage');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 1500);
        const seedIdx = slice.indexOf('seedSampleProject');
        const readIdx = slice.indexOf('listProjectsArray');
        expect(seedIdx).toBeGreaterThan(-1);
        expect(readIdx).toBeGreaterThan(-1);
        expect(seedIdx).toBeLessThan(readIdx);
    });

    it('persists the sample-seeded flag under the documented key', () => {
        expect(prefs).toMatch(/SAMPLE_SEEDED_KEY\s*=\s*['"]todoapp_sampleSeeded['"]/);
        expect(prefs).toMatch(/export\s+function\s+isSampleSeeded\s*\(/);
        expect(prefs).toMatch(/export\s+function\s+setSampleSeeded\s*\(/);
    });
});
