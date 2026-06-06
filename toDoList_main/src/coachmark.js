// First-run spotlight coachmark tour for new desktop users.
//
// On a fresh install the welcome flow seeds a "Getting started" sample
// project (via listLogic.seedSampleProject) so every step has a real DOM
// node to anchor against. This module dims the page with a full-viewport
// overlay, cuts a hole around one target element at a time via a four-
// rect mask, and anchors a callout next to the spotlight that walks
// through the sample project row, a due-date pill, the description
// chevron, the sidebar "+" project button, the Pomodoro toggle, the
// music toggle, and the settings toggle in the navbar.
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

// Each step describes one stop on the tour. `target` is a function returning
// the DOM element to spotlight (or null when unavailable) — resolved fresh
// at advance time so dynamic chrome like the placeholder todo row is found
// even when it was mounted after the tour started. `advanceOn` lists DOM
// events on the target that should trigger a forward step in addition to
// the explicit Next button; the listener is attached at spotlight time and
// removed when the step changes.
//
// Step 1 anchors against the seeded sample project in the sidebar — the
// first-run flow writes a "Getting started" project into the data model
// before the tour mounts so the target always exists. Steps 2 and 3 point
// at seeded todo rows for the same reason. The replay path (no re-seed)
// falls back gracefully if the user deleted the sample: the layout helper
// renders a centered callout when target() returns null.
const STEPS = [
    {
        id: 'sampleProject',
        title: 'This is a project',
        body: "Projects group your todos. We seeded \"Getting started\" so you can poke around — rename or delete it any time.",
        target: function() {
            const sideMa = document.getElementById('sideMa');
            if (!sideMa) return null;
            // Prefer the currently-selected row; on first run that's the
            // sample project. Falls back to the first project row so a
            // replay tour with a different selection still has a target.
            return sideMa.querySelector('.selectedProject')
                || sideMa.querySelector('#projChild');
        },
        advanceOn: ['click'],
        placement: 'right',
    },
    {
        id: 'duePill',
        title: 'Set a due date',
        body: 'Every committed todo gets a date pill — click it to pick a due date or recurrence.',
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
        title: 'Expand for details',
        body: 'The chevron next to each todo opens a description panel — great for notes or links.',
        target: function() {
            const main = document.getElementById('mainList');
            if (!main) return null;
            const rows = main.querySelectorAll('#toDoChild');
            for (let i = 0; i < rows.length; i++) {
                const tog = rows[i].querySelector('#descToggle');
                if (tog && tog.style.display !== 'none') return tog;
            }
            return null;
        },
        advanceOn: ['click'],
        placement: 'bottom',
    },
    {
        id: 'addProject',
        title: 'Create a project',
        body: 'Use the + in the sidebar to start a project of your own. Each project keeps its own list of todos.',
        target: function() { return document.getElementById('projButton'); },
        advanceOn: ['click'],
        placement: 'right',
    },
    {
        id: 'pomodoro',
        title: 'Stay focused',
        body: 'The clock opens a Pomodoro timer to keep work and break intervals on track.',
        target: function() { return document.getElementById('pomodoroToggle'); },
        advanceOn: ['click'],
        placement: 'bottom',
    },
    {
        id: 'music',
        title: 'Focus music',
        body: 'The note icon plays ambient focus stations you can run alongside the timer.',
        target: function() { return document.getElementById('musicToggle'); },
        advanceOn: ['click'],
        placement: 'bottom',
    },
    {
        id: 'settings',
        title: 'Settings and more',
        body: 'The menu hides theme, import / export, and the option to replay this welcome tour whenever you want.',
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

function renderStep() {
    if (!active) return;
    const step = STEPS[active.index];

    detachTargetListener();

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
// sidebar between steps.
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

function fitsInViewport(pos, cw, ch) {
    return pos.left >= CALLOUT_MARGIN
        && pos.top >= CALLOUT_MARGIN
        && pos.left + cw <= window.innerWidth - CALLOUT_MARGIN
        && pos.top + ch <= window.innerHeight - CALLOUT_MARGIN;
}

// Collision-aware placement: try the preferred side first; if it would
// clip the viewport, flip to the opposite side. Whichever side wins, a
// final clamp catches edge cases (a callout taller than the viewport,
// a target right against the edge) by pinning the callout inside the
// margins. Recentering on missing-target is handled separately in
// layoutStep before this helper is even called.
function placeCallout(callout, cutout, placement) {
    const cw = callout.offsetWidth || 280;
    const ch = callout.offsetHeight || 160;

    const opposite = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };
    const primary = computePlacement(placement, cutout, cw, ch);
    let chosen = primary;
    if (!fitsInViewport(primary, cw, ch) && opposite[placement]) {
        const flipped = computePlacement(opposite[placement], cutout, cw, ch);
        if (fitsInViewport(flipped, cw, ch)) chosen = flipped;
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

    window.removeEventListener('resize', onWindowChange);
    window.removeEventListener('scroll', onWindowChange, true);
    document.removeEventListener('keydown', onKeydown, true);
    active.overlay.removeEventListener('click', onOverlayClick);

    if (active.overlay.parentNode) active.overlay.parentNode.removeChild(active.overlay);
    if (active.callout.parentNode) active.callout.parentNode.removeChild(active.callout);

    active = null;

    setOnboardingComplete(true);
}
