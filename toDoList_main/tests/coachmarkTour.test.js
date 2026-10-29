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
    // Step 1 anchors against the header project pill; step 5 against the
    // "+" in the project picker dropdown the pill opens.
    const { pill, dropdown, addBtn } = buildPickerChrome();

    const pomodoroToggle = document.createElement('button');
    pomodoroToggle.id = 'pomodoroToggle';
    document.body.appendChild(pomodoroToggle);

    const musicToggle = document.createElement('button');
    musicToggle.id = 'musicToggle';
    document.body.appendChild(musicToggle);

    const focusModeToggle = document.createElement('button');
    focusModeToggle.id = 'focusModeToggle';
    document.body.appendChild(focusModeToggle);

    const settingsToggle = document.createElement('button');
    settingsToggle.id = 'settingsToggle';
    document.body.appendChild(settingsToggle);

    const mainList = document.createElement('div');
    mainList.id = 'mainList';
    // The blank placeholder row the addTask step spotlights.
    const blankRow = document.createElement('div');
    blankRow.id = 'toDoChild';
    const blankInput = document.createElement('input');
    blankInput.id = 'toDoInput';
    blankRow.appendChild(blankInput);
    mainList.appendChild(blankRow);
    const row = document.createElement('div');
    row.id = 'toDoChild';
    const input = document.createElement('input');
    input.id = 'toDoInput';
    input.value = 'Committed task';
    row.appendChild(input);
    const duePill = document.createElement('button');
    duePill.id = 'duePill';
    row.appendChild(duePill);
    const descToggle = document.createElement('div');
    descToggle.id = 'descToggle';
    row.appendChild(descToggle);
    mainList.appendChild(row);
    document.body.appendChild(mainList);
    return { pill, dropdown, addBtn, pomodoroToggle, musicToggle, focusModeToggle, settingsToggle, mainList, blankRow, row, input, duePill, descToggle };
}

// Header pill + project picker dropdown. The pill's real handler (main.js)
// toggles the picker; the stub mirrors that by toggling .open.
function buildPickerChrome() {
    const header = document.createElement('div');
    header.id = 'mobileProjHeader';
    const pill = document.createElement('div');
    pill.id = 'mobileProjPill';
    header.appendChild(pill);
    document.body.appendChild(header);

    const dropdown = document.createElement('div');
    dropdown.id = 'projectPickerDropdown';
    const pickerHeader = document.createElement('div');
    pickerHeader.className = 'projectPickerHeader';
    const addBtn = document.createElement('button');
    addBtn.className = 'projectPickerAddBtn';
    pickerHeader.appendChild(addBtn);
    dropdown.appendChild(pickerHeader);
    document.body.appendChild(dropdown);

    pill.addEventListener('click', function() {
        dropdown.classList.toggle('open');
    });
    return { header, pill, dropdown, addBtn };
}

// The tour opens the picker one frame after a step renders; resolves after
// that frame has run.
function nextFrame() {
    return new Promise(function(done) { requestAnimationFrame(function() { done(); }); });
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

    it('exposes nine steps and stable ids', () => {
        expect(getCoachmarkStepCount()).toBe(9);
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
        expect(label.textContent).toBe('STEP 1 OF 9');
    });

    it('renders pagination dots, Skip / Next buttons, and a dialog role', () => {
        startCoachmarkTour();
        const dots = document.querySelectorAll('.coachmarkDot');
        expect(dots.length).toBe(9);
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
        expect(label.textContent).toBe('STEP 2 OF 9');
    });

    it('switches the Next button to "You\'re set" on the final step', () => {
        startCoachmarkTour();
        for (let i = 0; i < 8; i++) {
            document.querySelector('.coachmarkNext').click();
        }
        const next = document.querySelector('.coachmarkNext');
        expect(next.textContent).toBe("You're set");
        const skip = document.querySelector('.coachmarkSkip');
        expect(skip.textContent).toBe('Close');
    });

    it('clicking "You\'re set" finishes the tour and persists the completion flag', () => {
        startCoachmarkTour();
        for (let i = 0; i < 9; i++) {
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
        // Step 1's target is the header project pill. Click it to verify
        // the advance.
        document.getElementById('mobileProjPill').click();
        // The advance handler defers by one tick so the underlying click
        // can settle before the next target() resolves.
        return new Promise(function(done) {
            setTimeout(function() {
                const label = document.querySelector('.coachmarkStepLabel');
                expect(label.textContent).toBe('STEP 2 OF 9');
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

    it('walks through music on step 7, focus mode on step 8 and settings on step 9', () => {
        const { musicToggle, focusModeToggle, settingsToggle } = buildSkeletonDOM();
        musicToggle.getBoundingClientRect = function() {
            return { top: 20, left: 600, right: 640, bottom: 60, width: 40, height: 40, x: 600, y: 20 };
        };
        focusModeToggle.getBoundingClientRect = function() {
            return { top: 20, left: 630, right: 670, bottom: 60, width: 40, height: 40, x: 630, y: 20 };
        };
        settingsToggle.getBoundingClientRect = function() {
            return { top: 20, left: 660, right: 700, bottom: 60, width: 40, height: 40, x: 660, y: 20 };
        };
        startCoachmarkTour();
        // Advance to step 7 (music) and verify the cutout tracks #musicToggle.
        for (let i = 0; i < 6; i++) {
            document.querySelector('.coachmarkNext').click();
        }
        let label = document.querySelector('.coachmarkStepLabel');
        expect(label.textContent).toBe('STEP 7 OF 9');
        let cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(parseInt(cutout.style.left, 10)).toBe(594);
        // Advance to step 8 (focus mode) and verify the cutout tracks #focusModeToggle.
        document.querySelector('.coachmarkNext').click();
        label = document.querySelector('.coachmarkStepLabel');
        expect(label.textContent).toBe('STEP 8 OF 9');
        cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(parseInt(cutout.style.left, 10)).toBe(624);
        // Advance to step 9 (settings) and verify the cutout tracks #settingsToggle.
        document.querySelector('.coachmarkNext').click();
        label = document.querySelector('.coachmarkStepLabel');
        expect(label.textContent).toBe('STEP 9 OF 9');
        cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(parseInt(cutout.style.left, 10)).toBe(654);
    });

    it('spotlights the blank placeholder row on step 2 and advances when it is clicked', () => {
        const { blankRow } = buildSkeletonDOM();
        blankRow.getBoundingClientRect = function() {
            return { top: 200, left: 300, right: 900, bottom: 240, width: 600, height: 40, x: 300, y: 200 };
        };
        startCoachmarkTour();
        document.querySelector('.coachmarkNext').click();
        expect(document.querySelector('.coachmarkStepLabel').textContent).toBe('STEP 2 OF 9');
        expect(document.getElementById('coachmarkTitle').textContent).toBe('Add a task');
        const cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(parseInt(cutout.style.left, 10)).toBe(294);
        blankRow.click();
        return new Promise(function(done) {
            setTimeout(function() {
                expect(document.querySelector('.coachmarkStepLabel').textContent).toBe('STEP 3 OF 9');
                done();
            }, 0);
        });
    });

    it('falls back to the centered callout on step 2 when no blank row exists', () => {
        const { blankRow } = buildSkeletonDOM();
        blankRow.remove();
        startCoachmarkTour();
        document.querySelector('.coachmarkNext').click();
        expect(document.querySelector('.coachmarkStepLabel').textContent).toBe('STEP 2 OF 9');
        expect(document.getElementById(COACHMARK_CALLOUT_ID)).not.toBeNull();
        expect(document.getElementById(COACHMARK_OVERLAY_ID).classList.contains('noTarget')).toBe(true);
        expect(document.getElementById(COACHMARK_CUTOUT_ID).style.display).toBe('none');
    });

    it('spotlights the first committed task row on step 4 with the detail-pane copy', () => {
        const { blankRow, row } = buildSkeletonDOM();
        // jsdom resolves a scoped '#toDoInput' lookup through the document's
        // first element with that id, so only the first row's input is
        // reachable — drop the blank row so the committed row comes first.
        blankRow.remove();
        row.getBoundingClientRect = function() {
            return { top: 300, left: 300, right: 900, bottom: 340, width: 600, height: 40, x: 300, y: 300 };
        };
        startCoachmarkTour();
        for (let i = 0; i < 3; i++) document.querySelector('.coachmarkNext').click();
        expect(document.querySelector('.coachmarkStepLabel').textContent).toBe('STEP 4 OF 9');
        expect(document.getElementById('coachmarkTitle').textContent).toBe('Notes and details');
        expect(document.querySelector('.coachmarkBody').textContent).toBe(
            'Click a task to open it in the detail pane on the right — notes, links, longer thoughts. Ctrl/Cmd + Enter opens every panel at once.'
        );
        const cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(cutout.style.display).toBe('block');
        expect(parseInt(cutout.style.top, 10)).toBe(294);
        expect(parseInt(cutout.style.left, 10)).toBe(294);
        // Callout sits below the row (placement: bottom).
        const callout = document.getElementById(COACHMARK_CALLOUT_ID);
        expect(parseInt(callout.style.top, 10)).toBe(346 + 12);
        row.click();
        return new Promise(function(done) {
            setTimeout(function() {
                expect(document.querySelector('.coachmarkStepLabel').textContent).toBe('STEP 5 OF 9');
                done();
            }, 0);
        });
    });

    it('step 1 spotlights the header pill with the callout below it', () => {
        const { pill } = buildSkeletonDOM();
        pill.getBoundingClientRect = function() {
            return { top: 60, left: 40, right: 240, bottom: 92, width: 200, height: 32, x: 40, y: 60 };
        };
        startCoachmarkTour();
        expect(document.getElementById('coachmarkTitle').textContent).toBe('This is your project');
        expect(document.querySelector('.coachmarkBody').textContent).toBe(
            "The pill shows the project you're in. Click it to switch projects, rename or delete one, or start a new one. We seeded \"Getting started\" so you can poke around."
        );
        const cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(parseInt(cutout.style.top, 10)).toBe(54);
        expect(parseInt(cutout.style.left, 10)).toBe(34);
        const callout = document.getElementById(COACHMARK_CALLOUT_ID);
        expect(parseInt(callout.style.top, 10)).toBe(98 + 12);
    });

    it('step 5 copy points at the + in the project picker', () => {
        startCoachmarkTour();
        for (let i = 0; i < 4; i++) document.querySelector('.coachmarkNext').click();
        expect(document.querySelector('.coachmarkStepLabel').textContent).toBe('STEP 5 OF 9');
        expect(document.getElementById('coachmarkTitle').textContent).toBe('Create a project');
        expect(document.querySelector('.coachmarkBody').textContent).toBe(
            'Hit + in the picker to start a project of your own. Each project keeps its own list.'
        );
    });

    it('step 5 places the callout to the RIGHT of the picker +', async () => {
        const { addBtn } = buildSkeletonDOM();
        addBtn.getBoundingClientRect = function() {
            return { top: 110, left: 300, right: 324, bottom: 134, width: 24, height: 24, x: 300, y: 110 };
        };
        startCoachmarkTour();
        for (let i = 0; i < 4; i++) document.querySelector('.coachmarkNext').click();
        await nextFrame();
        const cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        const callout = document.getElementById(COACHMARK_CALLOUT_ID);
        const cutRight = parseInt(cutout.style.left, 10) + parseInt(cutout.style.width, 10);
        expect(parseInt(callout.style.left, 10)).toBe(cutRight + 12);
    });

    it('flips to the opposite side when the primary is off-screen even if the flip overflows on the cross axis', () => {
        // Step 1 prefers `bottom`. With the pill hugging the bottom-left
        // corner, the primary side is off-screen; the flipped (top) side
        // fits vertically but its horizontally-centred left would sit left
        // of the margin. The flip must still win, with left clamped to the
        // margin, so the callout never lands on top of the cut-out.
        const { pill } = buildSkeletonDOM();
        pill.getBoundingClientRect = function() {
            return { top: 760, left: 0, right: 100, bottom: 790, width: 100, height: 30, x: 0, y: 760 };
        };
        startCoachmarkTour();
        const callout = document.getElementById(COACHMARK_CALLOUT_ID);
        const cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        const cutTop = parseInt(cutout.style.top, 10);
        const top = parseInt(callout.style.top, 10);
        const left = parseInt(callout.style.left, 10);
        // jsdom has no layout, so the callout falls back to 280×160.
        expect(top).toBe(cutTop - 12 - 160);
        expect(left).toBe(8);
        expect(top + 160).toBeLessThanOrEqual(cutTop);
    });

    it('positions the cutout over the target via fixed coordinates', () => {
        const { pill } = buildSkeletonDOM();
        // Step 1's target is the header project pill, so the cutout should
        // track its bounding rect (plus the 6px padding).
        pill.getBoundingClientRect = function() {
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
    // The desktop ghost-menu "Replay welcome tour" item was extracted into
    // settingsMenu.js; the mobile settings modal (showSettingsModal, incl. its
    // replay handler) was extracted into settingsModal.js.
    const settingsMenu = read('settingsMenu.js');
    const settingsModal = read('settingsModal.js');

    it('main.js imports maybeStartFirstRunTour; settingsModal.js imports startCoachmarkTour from coachmark', () => {
        expect(main).toMatch(/from\s+['"]\.\/coachmark\.js['"]/);
        expect(main).toMatch(/maybeStartFirstRunTour/);
        expect(settingsModal).toMatch(/from\s+['"]\.\/coachmark\.js['"]/);
        expect(settingsModal).toMatch(/startCoachmarkTour/);
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
        expect(settingsMenu).toMatch(/buildSettingsMenuItem\(\s*['"]Replay welcome tour['"]/);
        const idx = settingsMenu.indexOf("'Replay welcome tour'");
        expect(idx).toBeGreaterThan(-1);
        const slice = settingsMenu.slice(idx, idx + 1500);
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

    it('stacks the desktop drawer above the nav bar so the step-1 row is not covered', () => {
        const navZ = parseInt(css.match(/#navBar\s*\{[^}]*z-index:\s*(\d+)/)[1], 10);
        const desktop = css.slice(css.indexOf('@media (min-width: 1024px)'));
        const sideZ = parseInt(desktop.match(/#sideBar\s*\{[^}]*z-index:\s*(\d+)/)[1], 10);
        expect(sideZ).toBeGreaterThan(navZ);
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

    it('Replay handler switches to Projects view before starting the tour', () => {
        // The desktop tour anchors against the project sidebar row, the
        // todo-row chrome, and the right-side icon cluster. Replaying
        // from Today or Calendar would leave those targets hidden, so
        // the handler flips to PROJECTS first.
        const idx = settingsModal.indexOf("'Replay welcome tour'");
        expect(idx).toBeGreaterThan(-1);
        const slice = settingsModal.slice(idx, idx + 1500);
        expect(slice).toMatch(/applyActiveView\(\s*['"]projects['"]\s*\)/);
        const applyIdx = slice.indexOf("applyActiveView('projects')");
        const startIdx = slice.indexOf('startCoachmarkTour');
        expect(applyIdx).toBeGreaterThan(-1);
        expect(startIdx).toBeGreaterThan(-1);
        expect(applyIdx).toBeLessThan(startIdx);
    });

    it('Replay handler force-seeds the sample project when the user has none', () => {
        // When the user deleted the seeded sample, the once-per-install
        // flag would otherwise keep seedSampleProject from re-seeding —
        // so the replay path passes { force: true } to bypass that gate.
        // The seed is skipped when the user already has projects so a
        // sample can't surprise-appear on a populated install.
        const idx = settingsModal.indexOf("'Replay welcome tour'");
        expect(idx).toBeGreaterThan(-1);
        const slice = settingsModal.slice(idx, idx + 1500);
        expect(slice).toMatch(/listProjectsArray\(\s*\)\.length\s*===\s*0/);
        expect(slice).toMatch(/seedSampleProject\(\s*\{\s*force:\s*true\s*\}\s*\)/);
    });

    it('Replay handler seeds sample todos when the active project is empty', () => {
        // When projects already exist but the currently-active one holds
        // only the blank placeholder, the per-row coachmark steps for
        // #duePill and #descToggle would otherwise anchor against
        // nothing. The handler invokes the in-between seeder so the
        // tour always has live row chrome to point at.
        const idx = settingsModal.indexOf("'Replay welcome tour'");
        expect(idx).toBeGreaterThan(-1);
        const slice = settingsModal.slice(idx, idx + 1500);
        expect(slice).toMatch(/seedSampleTodosIntoActiveProjectIfEmpty\s*\(/);
    });

    it('main.js wires a helper that seeds sample todos into the empty active project', () => {
        // The replay handler delegates to a module-level helper that
        // reads the currently-selected project from the DOM, inspects
        // its items, and calls listLogic.seedSampleTodos when no titled
        // row exists. The helper re-renders the main list in place so
        // the new rows appear without rebuilding the sidebar selection.
        expect(main).toMatch(/function\s+seedSampleTodosIntoActiveProjectIfEmpty\s*\(/);
        const fnIdx = main.indexOf('function seedSampleTodosIntoActiveProjectIfEmpty');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = main.slice(fnIdx, fnIdx + 1200);
        expect(body).toMatch(/\.selectedProject/);
        expect(body).toMatch(/listLogic\.seedSampleTodos\s*\(/);
        expect(body).toMatch(/addToDos_restore\s*\(/);
    });

    it('Replay handler defers the tour kickoff so layout settles first', () => {
        // After flipping the active view (and possibly re-rendering the
        // project sidebar / main list), the tour needs a frame to let
        // the now-visible targets compute their bounding rects before
        // the spotlight cut-out reads them.
        const idx = settingsModal.indexOf("'Replay welcome tour'");
        expect(idx).toBeGreaterThan(-1);
        const slice = settingsModal.slice(idx, idx + 1500);
        expect(slice).toMatch(/requestAnimationFrame/);
        const rafIdx = slice.indexOf('requestAnimationFrame');
        const startIdx = slice.indexOf('startCoachmarkTour');
        expect(rafIdx).toBeLessThan(startIdx);
    });
});


// On desktop the project control is the header pill and its anchored picker
// dropdown, not the slide-in drawer. Step 1 spotlights the pill; step 5 opens
// the picker (through the pill's own click handler) and spotlights its "+".
// Every other step, and finish, closes the picker — even one the user opened
// by clicking the pill to advance step 1. The drawer is never touched.
describe('coachmark tour — opens the project picker for picker steps', () => {
    function buildPickerDOM() {
        document.body.innerHTML = '';

        const sideBar = document.createElement('div');
        sideBar.id = 'sideBar';
        document.body.appendChild(sideBar);
        const overlay = document.createElement('div');
        overlay.id = 'sidebarOverlay';
        document.body.appendChild(overlay);

        const chrome = buildPickerChrome();

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
        input.value = 'Committed task';
        row.appendChild(input);
        const duePill = document.createElement('button');
        duePill.id = 'duePill';
        row.appendChild(duePill);
        mainList.appendChild(row);
        document.body.appendChild(mainList);

        return { sideBar, overlay, ...chrome };
    }

    function clickNext() {
        document.querySelector('.coachmarkNext').click();
    }

    function goToStep(n) {
        for (let i = 1; i < n; i++) clickNext();
        expect(document.querySelector('.coachmarkStepLabel').textContent).toBe('STEP ' + n + ' OF 9');
    }

    let dom;

    beforeEach(() => {
        localStorage.clear();
        Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        dom = buildPickerDOM();
    });

    afterEach(() => {
        if (document.getElementById(COACHMARK_OVERLAY_ID)) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
    });

    it('step 1 leaves the drawer and picker untouched and wraps the pill', () => {
        dom.pill.getBoundingClientRect = function() {
            return { top: 60, left: 40, right: 240, bottom: 92, width: 200, height: 32, x: 40, y: 60 };
        };
        startCoachmarkTour();
        expect(dom.sideBar.classList.contains('sidebar-open')).toBe(false);
        expect(dom.overlay.classList.contains('visible')).toBe(false);
        expect(dom.dropdown.classList.contains('open')).toBe(false);
        const cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(parseInt(cutout.style.top, 10)).toBe(54);
        expect(parseInt(cutout.style.left, 10)).toBe(34);
        expect(parseInt(cutout.style.width, 10)).toBe(212);
    });

    it('falls back to the padded header when the pill itself has no box (display:contents at desktop)', () => {
        dom.header.getBoundingClientRect = function() {
            return { top: 34, left: 41, right: 209, bottom: 74, width: 168, height: 40, x: 41, y: 34 };
        };
        startCoachmarkTour();
        const cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(parseInt(cutout.style.top, 10)).toBe(28);
        expect(parseInt(cutout.style.left, 10)).toBe(35);
        expect(parseInt(cutout.style.width, 10)).toBe(180);
    });

    it('closes the picker on step 2 when the user advanced step 1 by clicking the pill', () => {
        startCoachmarkTour();
        dom.pill.click();
        expect(dom.dropdown.classList.contains('open')).toBe(true);
        return new Promise(function(done) {
            setTimeout(function() {
                expect(document.querySelector('.coachmarkStepLabel').textContent).toBe('STEP 2 OF 9');
                expect(dom.dropdown.classList.contains('open')).toBe(false);
                done();
            }, 0);
        });
    });

    it('opens the picker on step 5 and spotlights its +', async () => {
        dom.addBtn.getBoundingClientRect = function() {
            return { top: 110, left: 300, right: 324, bottom: 134, width: 24, height: 24, x: 300, y: 110 };
        };
        const pillClick = vi.fn();
        dom.pill.addEventListener('click', pillClick);
        startCoachmarkTour();
        goToStep(5);
        await nextFrame();
        expect(dom.dropdown.classList.contains('open')).toBe(true);
        expect(pillClick).toHaveBeenCalledTimes(1);
        expect(dom.sideBar.classList.contains('sidebar-open')).toBe(false);
        const cutout = document.getElementById(COACHMARK_CUTOUT_ID);
        expect(cutout.style.display).toBe('block');
        expect(parseInt(cutout.style.left, 10)).toBe(294);
        expect(parseInt(cutout.style.top, 10)).toBe(104);
    });

    it('keeps the picker open when the Next click reaches the document-level outside-click dismisser', async () => {
        // Mirrors main.js: any click outside the dropdown and the header
        // closes the picker. The Next click that enters step 5 bubbles there.
        function dismiss(e) {
            if (dom.dropdown.contains(e.target) || dom.header.contains(e.target)) return;
            dom.dropdown.classList.remove('open');
        }
        document.addEventListener('click', dismiss);
        try {
            startCoachmarkTour();
            goToStep(5);
            await nextFrame();
            expect(dom.dropdown.classList.contains('open')).toBe(true);
        } finally {
            document.removeEventListener('click', dismiss);
        }
    });

    it('does not toggle an already-open picker shut on step 5', async () => {
        startCoachmarkTour();
        goToStep(4);
        dom.dropdown.classList.add('open');
        clickNext();
        await nextFrame();
        expect(dom.dropdown.classList.contains('open')).toBe(true);
    });

    it('clicking the picker + advances to step 6, which closes the picker', async () => {
        startCoachmarkTour();
        goToStep(5);
        await nextFrame();
        dom.addBtn.click();
        return new Promise(function(done) {
            setTimeout(function() {
                expect(document.querySelector('.coachmarkStepLabel').textContent).toBe('STEP 6 OF 9');
                expect(dom.dropdown.classList.contains('open')).toBe(false);
                done();
            }, 0);
        });
    });

    it('closes the picker when advancing from step 5 with Next', async () => {
        startCoachmarkTour();
        goToStep(5);
        await nextFrame();
        expect(dom.dropdown.classList.contains('open')).toBe(true);
        clickNext();
        expect(document.querySelector('.coachmarkStepLabel').textContent).toBe('STEP 6 OF 9');
        expect(dom.dropdown.classList.contains('open')).toBe(false);
    });

    it('closes the picker when the tour finishes on the picker step', async () => {
        startCoachmarkTour();
        goToStep(5);
        await nextFrame();
        expect(dom.dropdown.classList.contains('open')).toBe(true);
        document.querySelector('.coachmarkSkip').click();
        expect(document.getElementById(COACHMARK_OVERLAY_ID)).toBeNull();
        expect(dom.dropdown.classList.contains('open')).toBe(false);
    });

    it('does not throw when the picker chrome is absent', async () => {
        document.getElementById('mobileProjHeader').remove();
        document.getElementById('projectPickerDropdown').remove();
        expect(() => startCoachmarkTour()).not.toThrow();
        expect(() => goToStep(5)).not.toThrow();
        await nextFrame();
        expect(document.getElementById(COACHMARK_OVERLAY_ID).classList.contains('noTarget')).toBe(true);
    });
});
