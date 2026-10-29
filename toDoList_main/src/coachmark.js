// First-run spotlight coachmark tour for new desktop users.
//
// On a fresh install the welcome flow seeds a "Getting started" sample
// project (via listLogic.seedSampleProject) so every step has a real DOM
// node to anchor against. This module dims the page with a full-viewport
// overlay, cuts a hole around one target element at a time via a four-
// rect mask, and anchors a callout next to the spotlight that walks
// through the header project pill, the blank add-a-task row, a due-date
// pill, a committed task row (which opens the detail pane), the project
// picker's "+" new-project button, the
// Pomodoro toggle, the music toggle, the Focus mode toggle, and the
// settings toggle in the navbar.
//
// State is local to the module — only the persisted flag in prefs.js
// (`todoapp_onboardingComplete`) survives between sessions. Calling
// startCoachmarkTour() while a tour is already mounted is a no-op.
//
// Mobile is intentionally out of scope; maybeStartFirstRunTour bails on
// viewports ≤1023px so the desktop-only flow doesn't pop on phones.

import { isOnboardingComplete, setOnboardingComplete } from './prefs.js';

export const COACHMARK_OVERLAY_ID = 'coachmarkOverlay';
export const COACHMARK_CALLOUT_ID = 'coachmarkCallout';
export const COACHMARK_CUTOUT_ID = 'coachmarkCutout';

const MOBILE_BREAKPOINT = 1023;
const CUTOUT_PADDING = 6;
const CALLOUT_GAP = 12;
const CALLOUT_MARGIN = 8;

// On desktop the project control is the header pill (#mobileProjPill), which
// opens the anchored #projectPickerDropdown (projectPicker.js) — switching,
// rename, delete and the "+" new-project button all live there. Steps that
// spotlight a control inside the dropdown (`picker: true`) open it by
// clicking the pill — the pill's own handler toggles the picker, so no
// parallel open path exists — and every other step closes it again.
const PICKER_PILL_ID = 'mobileProjPill';
const PICKER_DROPDOWN_ID = 'projectPickerDropdown';
const PICKER_OPEN_CLASS = 'open';

// Each step describes one stop on the tour. `target` is a function returning
// the DOM element to spotlight (or null when unavailable) — resolved fresh
// at advance time so dynamic chrome like the placeholder todo row is found
// even when it was mounted after the tour started. `advanceOn` lists DOM
// events on the target that should trigger a forward step in addition to
// the explicit Next button; the listener is attached at spotlight time and
// removed when the step changes.
//
// Step 1 anchors against the header pill showing the seeded "Getting
// started" project — the first-run flow writes it into the data model before
// the tour mounts so the pill names a real project. Step 2 points at the
// blank placeholder row and steps 3 and 4 at seeded todo rows for the same
// reason. Step 5 opens the project picker and spotlights its "+". The replay
// path (no re-seed) falls back gracefully if a target is missing: the layout
// helper renders a centered callout when target() returns null.
const STEPS = [
    {
        id: 'project',
        title: 'This is your project',
        body: "The pill shows the project you're in. Click it to switch projects, rename or delete one, or start a new one. We seeded \"Getting started\" so you can poke around.",
        target: function() {
            const pill = document.getElementById(PICKER_PILL_ID);
            if (!pill) return null;
            // At desktop the pill node is display:contents (no box of its
            // own) and the padded pill the user sees is #mobileProjHeader,
            // so spotlight that when the pill itself measures empty.
            const rect = pill.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                return pill.closest('#mobileProjHeader') || pill;
            }
            return pill;
        },
        advanceOn: ['click'],
        placement: 'bottom',
    },
    {
        id: 'addTask',
        title: 'Add a task',
        body: 'Type here and press Enter. Each Enter commits the task and gives you a fresh line for the next one.',
        target: function() {
            const main = document.getElementById('mainList');
            if (!main) return null;
            // The blank placeholder row is the one whose input is empty.
            const rows = main.querySelectorAll('#toDoChild');
            for (let i = 0; i < rows.length; i++) {
                const input = rows[i].querySelector('#toDoInput');
                if (input && input.value === '') return rows[i];
            }
            return null;
        },
        advanceOn: ['click'],
        placement: 'bottom',
    },
    {
        id: 'duePill',
        title: 'Set a due date',
        body: "Every task gets a date pill once it's committed — click it to pick a due date or make it repeat.",
        target: function() {
            const main = document.getElementById('mainList');
            if (!main) return null;
            const rows = main.querySelectorAll('#toDoChild');
            for (let i = 0; i < rows.length; i++) {
                const pill = rows[i].querySelector('#duePill');
                if (pill && pill.style.display !== 'none') return pill;
            }
            return null;
        },
        advanceOn: ['click'],
        placement: 'bottom',
    },
    {
        id: 'descToggle',
        title: 'Notes and details',
        body: 'Click a task to open it in the detail pane on the right — notes, links, longer thoughts. Ctrl/Cmd + Enter opens every panel at once.',
        target: function() {
            const main = document.getElementById('mainList');
            if (!main) return null;
            // #descToggle is headless (display:none) at every width, so
            // spotlight the first committed row — clicking it opens the
            // task in #descDetailPane.
            const rows = main.querySelectorAll('#toDoChild');
            for (let i = 0; i < rows.length; i++) {
                const input = rows[i].querySelector('#toDoInput');
                if (input && input.value !== '') return rows[i];
            }
            return null;
        },
        advanceOn: ['click'],
        placement: 'bottom',
    },
    {
        id: 'addProject',
        title: 'Create a project',
        body: 'Hit + in the picker to start a project of your own. Each project keeps its own list.',
        target: function() {
            return document.querySelector('#' + PICKER_DROPDOWN_ID + ' .projectPickerAddBtn');
        },
        picker: true,
        advanceOn: ['click'],
        placement: 'right',
    },
    {
        id: 'pomodoro',
        title: 'Stay focused',
        body: 'The stopwatch opens a Pomodoro timer; the countdown shows right here on the button while a session runs.',
        target: function() { return document.getElementById('pomodoroToggle'); },
        advanceOn: ['click'],
        placement: 'bottom',
    },
    {
        id: 'music',
        title: 'Focus music',
        body: 'The bars play ambient focus stations you can run alongside the timer.',
        target: function() { return document.getElementById('musicToggle'); },
        advanceOn: ['click'],
        placement: 'bottom',
    },
    {
        id: 'focusMode',
        title: 'Focus mode',
        body: 'The sparkle hides everything but a calm drifting space scene — timer and music ride along in the corner. Press Esc to come back.',
        target: function() { return document.getElementById('focusModeToggle'); },
        advanceOn: ['click'],
        placement: 'bottom',
    },
    {
        id: 'settings',
        title: 'Settings and backup',
        body: 'The gear holds theme, app lock, Export / Import to JSON, and Replay welcome tour. Your tasks live in this browser — export a JSON copy now and then.',
        target: function() { return document.getElementById('settingsToggle'); },
        advanceOn: ['click'],
        placement: 'bottom',
    },
];

let active = null;

export function getCoachmarkStepCount() { return STEPS.length; }

// Public entry point — called from restoreFromStorage when there are no
// saved projects on a fresh load. Defers to the persisted flag and the
// mobile breakpoint so the tour only runs on its intended path.
export function maybeStartFirstRunTour() {
    if (isOnboardingComplete()) return false;
    if (window.innerWidth <= MOBILE_BREAKPOINT) return false;
    startCoachmarkTour();
    return true;
}

// Explicit trigger — used by the "Replay welcome tour" menu item. Clears
// the persisted flag so a manual replay puts the user back in first-run
// mode (any subsequent reload would have re-triggered the tour anyway,
// which matches the user's expressed intent).
export function startCoachmarkTour() {
    if (active) return;
    setOnboardingComplete(false);

    const overlay = document.createElement('div');
    overlay.id = COACHMARK_OVERLAY_ID;
    overlay.setAttribute('role', 'presentation');

    // Four dim panels arranged around the cut-out. Each panel intercepts
    // pointer events for backdrop-dismiss; the gap between them lets the
    // highlighted target receive clicks without the overlay swallowing
    // them. A separate ring element traces the cut-out boundary for the
    // visible spotlight outline; pointer-events: none keeps it transparent
    // to clicks.
    const panelTop    = document.createElement('div');
    const panelBottom = document.createElement('div');
    const panelLeft   = document.createElement('div');
    const panelRight  = document.createElement('div');
    panelTop.className    = 'coachmarkPanel coachmarkPanelTop';
    panelBottom.className = 'coachmarkPanel coachmarkPanelBottom';
    panelLeft.className   = 'coachmarkPanel coachmarkPanelLeft';
    panelRight.className  = 'coachmarkPanel coachmarkPanelRight';

    const cutout = document.createElement('div');
    cutout.id = COACHMARK_CUTOUT_ID;
    cutout.setAttribute('aria-hidden', 'true');

    overlay.appendChild(panelTop);
    overlay.appendChild(panelBottom);
    overlay.appendChild(panelLeft);
    overlay.appendChild(panelRight);
    overlay.appendChild(cutout);

    const callout = document.createElement('div');
    callout.id = COACHMARK_CALLOUT_ID;
    callout.setAttribute('role', 'dialog');
    callout.setAttribute('aria-modal', 'false');
    callout.setAttribute('aria-labelledby', 'coachmarkTitle');

    document.body.appendChild(overlay);
    document.body.appendChild(callout);

    active = {
        index: 0,
        overlay,
        callout,
        cutout,
        panels: { top: panelTop, bottom: panelBottom, left: panelLeft, right: panelRight },
        currentTarget: null,
        currentEventHandler: null,
        currentEventNames: null,
    };

    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);
    document.addEventListener('keydown', onKeydown, true);
    overlay.addEventListener('click', onOverlayClick);

    renderStep();
}

function onWindowChange() {
    if (!active) return;
    layoutStep();
}

function onKeydown(event) {
    if (!active) return;
    if (event.key === 'Escape') {
        event.stopPropagation();
        finish();
    }
}

// Backdrop clicks dismiss the tour. The four dim panels intercept the
// click; the gap between them is the cut-out window so the highlighted
// target receives clicks directly. The visible ring (#coachmarkCutout)
// has pointer-events: none in CSS so clicks pass through it as well.
function onOverlayClick(event) {
    if (!active) return;
    if (!event.target.classList || !event.target.classList.contains('coachmarkPanel')) return;
    finish();
}

function isPickerOpen() {
    const dropdown = document.getElementById(PICKER_DROPDOWN_ID);
    return !!dropdown && dropdown.classList.contains(PICKER_OPEN_CLASS);
}

// Route through the pill's own click handler, which toggles the picker. The
// document-level dismisser ignores clicks inside #mobileProjHeader, so the
// synthetic click never reads as an outside-click. Guarded so the helper is
// a no-op when the header chrome isn't present (e.g. a test skeleton).
function clickPickerPill() {
    const pill = document.getElementById(PICKER_PILL_ID);
    if (pill) pill.click();
}

// Open the picker for picker-targeted steps; close it on any other step.
// Closing is unconditional rather than tracking who opened it: the user
// advancing step 1 by clicking the pill leaves the picker open over step 2,
// and closeProjectPicker also cancels an inline create started by the "+"
// click that advances step 5.
//
// Opening waits one frame: when Next triggers the step, that same click is
// still bubbling and would reach the document-level outside-click dismisser
// after the picker opened, shutting it again. The picker rebuilds its rows
// (and so its "+") on every open, so the advance listener is re-attached to
// the fresh node and the spotlight re-measured.
function syncPickerForStep(step) {
    if (!active) return;
    if (!step || !step.picker) {
        if (isPickerOpen()) clickPickerPill();
        return;
    }
    const stepAtSchedule = active.index;
    requestAnimationFrame(function() {
        if (!active || active.index !== stepAtSchedule) return;
        if (!isPickerOpen()) clickPickerPill();
        detachTargetListener();
        attachTargetListener(step);
        layoutStep();
    });
}

function renderStep() {
    if (!active) return;
    const step = STEPS[active.index];

    detachTargetListener();
    syncPickerForStep(step);

    const callout = active.callout;
    while (callout.firstChild) callout.removeChild(callout.firstChild);

    const stepLabel = document.createElement('div');
    stepLabel.className = 'coachmarkStepLabel';
    stepLabel.textContent = 'STEP ' + (active.index + 1) + ' OF ' + STEPS.length;

    const title = document.createElement('div');
    title.id = 'coachmarkTitle';
    title.className = 'coachmarkTitle';
    title.textContent = step.title;

    const body = document.createElement('div');
    body.className = 'coachmarkBody';
    body.textContent = step.body;

    const footer = document.createElement('div');
    footer.className = 'coachmarkFooter';

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'coachmarkSkip';
    skip.textContent = active.index === STEPS.length - 1 ? 'Close' : 'Skip';
    skip.addEventListener('click', function() { finish(); });

    const dots = document.createElement('div');
    dots.className = 'coachmarkDots';
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < STEPS.length; i++) {
        const dot = document.createElement('span');
        dot.className = 'coachmarkDot' + (i === active.index ? ' active' : '');
        dots.appendChild(dot);
    }

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'coachmarkNext';
    next.textContent = active.index === STEPS.length - 1 ? "You're set" : 'Next ›';
    next.addEventListener('click', advance);

    footer.appendChild(skip);
    footer.appendChild(dots);
    footer.appendChild(next);

    callout.appendChild(stepLabel);
    callout.appendChild(title);
    callout.appendChild(body);
    callout.appendChild(footer);

    layoutStep();
    attachTargetListener(step);

    // Re-measure after one frame once layout has settled — on first run the
    // tour mounts while the app shell is still being revealed, so the
    // synchronous rect can be empty. Only if the tour is still on this same
    // step.
    const stepAtSchedule = active.index;
    requestAnimationFrame(function() {
        if (active && active.index === stepAtSchedule) layoutStep();
    });

    next.focus();
}

function advance() {
    if (!active) return;
    if (active.index >= STEPS.length - 1) {
        finish();
        return;
    }
    active.index += 1;
    renderStep();
}

function attachTargetListener(step) {
    if (!active) return;
    if (!step.advanceOn || !step.advanceOn.length) return;
    const target = step.target();
    if (!target) return;

    const handler = function() {
        // Defer one frame so the underlying click handler (e.g., projButton
        // adds a new project row) finishes mutating the DOM before the
        // next step's target() resolves against the live tree.
        setTimeout(advance, 0);
    };

    step.advanceOn.forEach(function(eventName) {
        target.addEventListener(eventName, handler, { once: true, capture: false });
    });

    active.currentTarget = target;
    active.currentEventHandler = handler;
    active.currentEventNames = step.advanceOn.slice();
}

function detachTargetListener() {
    if (!active) return;
    if (!active.currentTarget || !active.currentEventHandler) return;
    const names = active.currentEventNames || [];
    names.forEach(function(eventName) {
        active.currentTarget.removeEventListener(eventName, active.currentEventHandler, false);
    });
    active.currentTarget = null;
    active.currentEventHandler = null;
    active.currentEventNames = null;
}

// Compute the cut-out rectangle around the current target and the position
// of the callout. Falls back to a centered callout with no cut-out when the
// target is missing — keeps the tour navigable even if the user closed the
// picker between steps.
function layoutStep() {
    if (!active) return;
    const step = STEPS[active.index];
    const target = step.target();
    const overlay = active.overlay;
    const callout = active.callout;
    const cutout = active.cutout;
    const panels = active.panels;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!target) {
        // No target — collapse the cut-out to nothing and let the top
        // panel cover the whole viewport so the screen still dims.
        overlay.classList.add('noTarget');
        cutout.style.display = 'none';
        panels.top.style.cssText    = 'top:0;left:0;width:100%;height:100%;';
        panels.bottom.style.cssText = 'display:none;';
        panels.left.style.cssText   = 'display:none;';
        panels.right.style.cssText  = 'display:none;';
        callout.style.top = Math.max(CALLOUT_MARGIN, (vh - callout.offsetHeight) / 2) + 'px';
        callout.style.left = Math.max(CALLOUT_MARGIN, (vw - callout.offsetWidth) / 2) + 'px';
        return;
    }

    overlay.classList.remove('noTarget');
    const rect = target.getBoundingClientRect();
    const top = Math.max(0, rect.top - CUTOUT_PADDING);
    const left = Math.max(0, rect.left - CUTOUT_PADDING);
    const right = Math.min(vw, rect.right + CUTOUT_PADDING);
    const bottom = Math.min(vh, rect.bottom + CUTOUT_PADDING);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);

    cutout.style.display = 'block';
    cutout.style.top    = top + 'px';
    cutout.style.left   = left + 'px';
    cutout.style.width  = width + 'px';
    cutout.style.height = height + 'px';

    panels.top.style.cssText    = 'top:0;left:0;width:100%;height:' + top + 'px;';
    panels.bottom.style.cssText = 'top:' + bottom + 'px;left:0;width:100%;height:' + Math.max(0, vh - bottom) + 'px;';
    panels.left.style.cssText   = 'top:' + top + 'px;left:0;width:' + left + 'px;height:' + height + 'px;';
    panels.right.style.cssText  = 'top:' + top + 'px;left:' + right + 'px;width:' + Math.max(0, vw - right) + 'px;height:' + height + 'px;';

    placeCallout(callout, { top, left, right, bottom }, step.placement || 'bottom');
}

function computePlacement(placement, cutout, cw, ch) {
    let top, left;
    switch (placement) {
        case 'right':
            top = cutout.top + (cutout.bottom - cutout.top - ch) / 2;
            left = cutout.right + CALLOUT_GAP;
            break;
        case 'left':
            top = cutout.top + (cutout.bottom - cutout.top - ch) / 2;
            left = cutout.left - CALLOUT_GAP - cw;
            break;
        case 'top':
            top = cutout.top - CALLOUT_GAP - ch;
            left = cutout.left + (cutout.right - cutout.left - cw) / 2;
            break;
        case 'bottom':
        default:
            top = cutout.bottom + CALLOUT_GAP;
            left = cutout.left + (cutout.right - cutout.left - cw) / 2;
            break;
    }
    return { top: top, left: left };
}

// Checks only the placement axis — horizontal span for left/right, vertical
// span for top/bottom. Cross-axis overflow is left to the final clamp in
// placeCallout, which can always fix it without covering the cut-out.
function fitsOnAxis(pos, placement, cw, ch) {
    if (placement === 'left' || placement === 'right') {
        return pos.left >= CALLOUT_MARGIN
            && pos.left + cw <= window.innerWidth - CALLOUT_MARGIN;
    }
    return pos.top >= CALLOUT_MARGIN
        && pos.top + ch <= window.innerHeight - CALLOUT_MARGIN;
}

// Collision-aware placement: try the preferred side first; if it would
// clip the viewport on the placement axis, flip to the opposite side. A
// candidate is never discarded for a cross-axis overflow. Whichever side
// wins, a final clamp catches edge cases (a callout taller than the
// viewport, a target right against the edge) by pinning the callout
// inside the margins. Recentering on missing-target is handled separately in
// layoutStep before this helper is even called.
function placeCallout(callout, cutout, placement) {
    const cw = callout.offsetWidth || 280;
    const ch = callout.offsetHeight || 160;

    const opposite = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };
    const primary = computePlacement(placement, cutout, cw, ch);
    let chosen = primary;
    if (opposite[placement] && !fitsOnAxis(primary, placement, cw, ch)) {
        const flipped = computePlacement(opposite[placement], cutout, cw, ch);
        if (fitsOnAxis(flipped, placement, cw, ch)) chosen = flipped;
    }

    let top = chosen.top;
    let left = chosen.left;

    if (left + cw > window.innerWidth - CALLOUT_MARGIN) {
        left = window.innerWidth - CALLOUT_MARGIN - cw;
    }
    if (left < CALLOUT_MARGIN) left = CALLOUT_MARGIN;
    if (top + ch > window.innerHeight - CALLOUT_MARGIN) {
        top = window.innerHeight - CALLOUT_MARGIN - ch;
    }
    if (top < CALLOUT_MARGIN) top = CALLOUT_MARGIN;

    callout.style.top = top + 'px';
    callout.style.left = left + 'px';
}

function finish() {
    if (!active) return;
    detachTargetListener();

    // Never leave the picker open behind a finished tour.
    if (isPickerOpen()) clickPickerPill();

    window.removeEventListener('resize', onWindowChange);
    window.removeEventListener('scroll', onWindowChange, true);
    document.removeEventListener('keydown', onKeydown, true);
    active.overlay.removeEventListener('click', onOverlayClick);

    if (active.overlay.parentNode) active.overlay.parentNode.removeChild(active.overlay);
    if (active.callout.parentNode) active.callout.parentNode.removeChild(active.callout);

    active = null;

    setOnboardingComplete(true);
}
