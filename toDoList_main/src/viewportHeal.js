// ── iOS STANDALONE VIEWPORT HEAL ──
//
// In an installed iOS PWA the layout viewport shrinks by ~59px the first time
// the software keyboard opens, and never recovers for the rest of the session:
// `window.innerHeight` and `100dvh` both stay short until the app is
// force-quit. Everything anchored to the bottom of that viewport rides the gap
// — most visibly `#mobileTabBar`, which is `position: fixed; bottom: 0` and so
// ends up ~59px above the physical screen bottom with the page background
// showing through beneath it.
//
// This is a runtime viewport-state bug, not a styling one, so no CSS can fix
// it — not static CSS, and not CSS driven by the measurement either: the box is
// correct, the viewport it resolves against is wrong, and the compositor will
// not paint outside it (see the fallback below). The
// documented workaround is to force the browser to re-measure by hiding a
// full-viewport-height element, flushing layout synchronously while it is
// hidden, then restoring it — see
// https://dev.to/cederhook/fixing-the-ios-standalone-pwa-keyboard-bug-that-shrinks-your-viewport-for-good-63d
// `#outerContainer` is `height: 100dvh` on mobile, which satisfies the
// workaround's full-viewport-height requirement.
//
// "Too short" is measured against the PHYSICAL SCREEN, never against the
// tallest viewport seen this session. A session maximum cannot work in the
// field: iOS keeps the installed app resident, so a launch inside an
// already-shrunken web process — the common case, since only a force-quit
// resets it — seeds the maximum FROM the shrunken height and reports a deficit
// of zero forever, on exactly the sessions that need healing. `screen.height`
// and `screen.width` are CSS pixels on iOS and do not shrink with this bug,
// and in standalone with `viewport-fit=cover` the layout viewport should equal
// the full screen dimension, so the screen is a reference the bug cannot
// corrupt.

// How far below the expected height the viewport must sit before we treat it
// as stuck. The real deficit is ~59px; the margin absorbs minor UA quirks
// (rounding, a layout viewport legitimately inset a few px) without thrashing.
const STUCK_THRESHOLD_PX = 24;

// iOS keeps resizing the viewport for a beat after the keyboard starts
// dismissing, so healing on the blur itself would measure mid-animation and
// either miss the shrink or heal against a transient height.
const FOCUSOUT_HEAL_DELAY_MS = 140;

// The visual viewport fires a burst of resizes as the keyboard slides away;
// debounce past the burst so the stuck-check reads a settled height.
const VIEWPORT_SETTLE_MS = 200;

// Launch, resume-from-the-app-switcher, and bfcache restore all land with the
// viewport still settling, so each defers its check by this much rather than
// measuring the frame it arrives on.
const SETTLE_CHECK_DELAY_MS = 300;

// After a flip that changed nothing, back off. Platforms where the expected
// dimension legitimately differs from the layout viewport — iPad windowed
// standalone most obviously — would otherwise flip on every trigger forever;
// this buys them one harmless flip instead of a loop.
const INEFFECTIVE_HEAL_COOLDOWN_MS = 5000;

// ── THE FALLBACK: SEAM MITIGATION, NOT RESEATING ──
//
// Field diagnostics from the installed app closed the last open question: the
// gate passes, the deficit is real (screen 852, innerHeight 793 → 59px), the
// flip runs — and WebKit never re-measures. The flip is the right remedy where
// it works and stays first in line, but it cannot be the only one, so a
// measurement that survives it publishes a deficit the rest of the app can see.
//
// That deficit ONCE drove a CSS reseat: subtract it from every bottom-fixed
// element's `bottom` and the chrome lands against the physical screen instead
// of the short viewport. The device disproved it. WebKit composites the stuck
// session onto a surface exactly as tall as the shrunken layout viewport, so
// the reseated tab bar rendered only the sliver still above that line and its
// icons and labels vanished. Nothing in-page paints below the shrunken
// viewport bottom, whatever `bottom` says.
//
// So the chrome keeps its base anchors, the un-paintable strip is left to the
// OS canvas extension — which is --bg-elevated, the same token the tab bar and
// body carry, so it reads as an apron rather than a gap — and what remains here
// is the measurement itself: `--vh-deficit` and the `vhDeficit` body class,
// published for the Diagnostics section so a stuck session is legible from the
// device that has it. `style.css` reads neither; see the banner there for the
// one case that would bring a rule back.
//
// The band is a guard, not a tolerance. A viewport legitimately shorter than
// the screen — iPad Stage Manager, a resized desktop-installed window — is not
// this bug, and flagging it as one would put a number in the diagnostics
// readout that means something else entirely. The iOS shrink is ~59px; 30–90px
// brackets it.
const FALLBACK_MIN_DEFICIT_PX = 30;
const FALLBACK_MAX_DEFICIT_PX = 90;

// Published for readers of the document, currently the Diagnostics section.
// Set on the root element rather than on the body so the value resolves for
// anything that inherits from it, including chrome that is not a body
// descendant, should a rule ever need it again.
const VH_DEFICIT_PROPERTY = '--vh-deficit';
const FALLBACK_BODY_CLASS = 'vhDeficit';

// The mobile layout — and therefore `#mobileTabBar`, the element that rides the
// gap — is scoped to ≤1023px. At desktop widths the bar is `display: none` and
// there is nothing to heal, so a desktop-installed PWA whose window the user
// merely resized smaller never flips anything.
const DESKTOP_MIN_WIDTH = 1024;

// When the last flip left the deficit exactly where it found it. 0 means no
// ineffective flip has been recorded.
let lastIneffectiveHealAt = 0;

// ── INSTRUMENTATION ──
//
// Four viewport fixes have shipped without a single field observation, because
// nothing here is visible from the device that has the bug: if the gate never
// passes, every fix behind it no-ops in silence and looks exactly like a fix
// that ran and did not help. This record is what tells those two apart. Both
// gate readings are written even when arming REJECTS — a dead gate is the
// leading suspect, so it has to be the first thing readable — and the
// measurement fields are refreshed by every stuck-check whether or not it
// leads to a flip.
const healStatus = {
    armed: false,
    displayModeStandalone: null,   // null until initViewportHeal() has read it
    navigatorStandalone: null,
    lastCheckAt: null,             // ms epoch of the last stuck-check
    lastDeficit: null,
    expectedHeight: null,
    healsAttempted: 0,
    healsEffective: 0,             // flips that actually shrank the deficit
    fallbackActive: false,         // whether the stuck-session flag is applied
    fallbackDeficitPx: null,       // the px value published to --vh-deficit
};

// A copy, so a reader (the Settings → Diagnostics section) cannot hold a live
// handle on module state and cannot mutate it.
export function getViewportHealStatus() {
    return Object.assign({}, healStatus);
}

function readViewportHeight() {
    const h = window.innerHeight;
    return typeof h === 'number' && h > 0 ? h : 0;
}

// How tall the layout viewport should be. `screen.width`/`screen.height` are
// device-native on iOS and do NOT swap with orientation, so the portrait
// height is `screen.height` and the landscape height is `screen.width`.
// Orientation is read off the viewport itself rather than `screen.orientation`,
// which is absent on older iOS. Returns 0 when there is no usable screen to
// compare against, which makes every caller a no-op rather than a guess.
function expectedViewportHeight() {
    const s = window.screen;
    if (!s) return 0;
    const w = typeof s.width === 'number' ? s.width : 0;
    const h = typeof s.height === 'number' ? s.height : 0;
    const landscape = window.innerWidth > window.innerHeight;
    const expected = landscape ? w : h;
    return expected > 0 ? expected : 0;
}

// Positive when the viewport is shorter than the screen says it should be.
// 0 when either measurement is unavailable, so an unknown state reads as
// healthy.
function viewportDeficit() {
    const expected = expectedViewportHeight();
    const actual = readViewportHeight();
    if (!expected || !actual) return 0;
    return expected - actual;
}

// True only when the viewport is short of the physical screen by more than the
// threshold, at a width where the mobile layout is actually in play. Every
// trigger routes through here, so the no-op guarantee lives in one place.
function isViewportStuck() {
    // Recorded before the width gate so a desktop reading is still observable
    // — "checked, measured, declined" is a different diagnosis from "never
    // checked", and the section has to be able to show which one happened.
    healStatus.lastCheckAt = Date.now();
    healStatus.expectedHeight = expectedViewportHeight();
    healStatus.lastDeficit = viewportDeficit();
    if (window.innerWidth >= DESKTOP_MIN_WIDTH) return false;
    return healStatus.lastDeficit > STUCK_THRESHOLD_PX;
}

function inHealCooldown() {
    if (!lastIneffectiveHealAt) return false;
    return (Date.now() - lastIneffectiveHealAt) < INEFFECTIVE_HEAL_COOLDOWN_MS;
}

// Whether anything other than the document body holds focus. Used by the
// visual-viewport trigger: a resize while an input is still focused is the
// keyboard OPENING, which we must not heal against — that height is the
// legitimate current viewport, not a stuck one.
function hasFocusedElement() {
    const el = document.activeElement;
    return !!el && el !== document.body && el !== document.documentElement;
}

// Flag the document as a stuck session and publish the measured deficit with
// it. Rounded because a fractional value buys nothing here and makes the
// diagnostics readout harder to eyeball against a screenshot.
function applyFallback(deficit) {
    const px = Math.round(deficit);
    const docEl = document.documentElement;
    if (docEl && docEl.style) docEl.style.setProperty(VH_DEFICIT_PROPERTY, px + 'px');
    if (document.body) document.body.classList.add(FALLBACK_BODY_CLASS);
    healStatus.fallbackActive = true;
    healStatus.fallbackDeficitPx = px;
}

// Both the class and the property come off together. Leaving the property
// behind with the class gone would be harmless to layout — no rule reads it —
// but it would be a stale number sitting in the DOM, and the readout that
// number feeds is the whole reason it is published.
function clearFallback() {
    const docEl = document.documentElement;
    if (docEl && docEl.style) docEl.style.removeProperty(VH_DEFICIT_PROPERTY);
    if (document.body) document.body.classList.remove(FALLBACK_BODY_CLASS);
    healStatus.fallbackActive = false;
    healStatus.fallbackDeficitPx = null;
}

// Re-measure and decide whether the session is still stuck. Runs on EVERY
// trigger, including ones where the flip was skipped for the cooldown — the
// cooldown exists to stop a useless flip repeating, not to stop the viewport
// from being measured, and a session that heals on its own later must be able
// to drop the flag without waiting for a flip it will never get.
function reconcileFallback() {
    const stuck = isViewportStuck();
    const deficit = healStatus.lastDeficit;
    const inBand = deficit >= FALLBACK_MIN_DEFICIT_PX && deficit <= FALLBACK_MAX_DEFICIT_PX;
    if (stuck && inBand) applyFallback(deficit);
    else clearFallback();
}

// The flip itself. Hiding `#outerContainer` and reading a layout-forcing
// property while it is hidden makes the browser drop and rebuild the layout
// against the real viewport; restoring `display` paints it back at the correct
// height in the same frame, so nothing is ever visible in the hidden state.
// `#mainList` scrolls independently and would otherwise be reset to 0 by the
// display flip, so its offset is captured and restored around it.
// Returns whether a flip actually ran, which is what makes the no-op path
// observable to tests.
function attemptFlip() {
    if (inHealCooldown()) return false;
    const outer = document.getElementById('outerContainer');
    if (!outer) return false;

    const list = document.getElementById('mainList');
    const scrollTop = list ? list.scrollTop : 0;
    const before = viewportDeficit();
    healStatus.healsAttempted += 1;

    outer.style.display = 'none';
    void outer.offsetHeight;   // synchronous reflow, between the two writes
    outer.style.display = '';

    if (list) list.scrollTop = scrollTop;

    // Re-measure. A flip that left the deficit where it found it either did
    // not work or was never the right remedy here, and repeating it on every
    // subsequent trigger would be a loop; a flip that shrank the deficit is
    // free to run again immediately.
    if (viewportDeficit() >= before) lastIneffectiveHealAt = Date.now();
    else healStatus.healsEffective += 1;
    return true;
}

// What every trigger routes through: measure, flip if that looks worth trying,
// then reconcile the fallback flag against a FRESH measurement. The order is
// the point — the flip gets first refusal, and the flag only reports the
// deficit the flip failed to close, so a platform where the flip works never
// looks stuck in the diagnostics readout.
function healViewport() {
    const flipped = isViewportStuck() && attemptFlip();
    reconcileFallback();
    return flipped;
}

let started = false;

// Arm the heal. Gated on standalone because the bug is exclusive to the
// installed PWA — in Safari the viewport recovers on its own and there is
// nothing to correct. TWO readings satisfy that gate, and either one is
// enough: the standard `display-mode: standalone` media query, and iOS's
// legacy `navigator.standalone` flag. The legacy flag is here because the
// installed-app container is the one place this fix has to work and the one
// place we cannot prove the media query answers true — a container that
// reports the query as false would silently no-op every fix behind it, which
// is indistinguishable from a fix that ran and did not help. Both readings are
// recorded either way, so the Diagnostics section can show which (if either)
// let it through. Returns a teardown function when armed, or null when the
// gate rejected (or it was already armed), so a caller can tell the two apart.
export function initViewportHeal() {
    if (started) return null;
    let displayModeStandalone = false;
    try {
        displayModeStandalone = !!(window.matchMedia
            && window.matchMedia('(display-mode: standalone)').matches);
    } catch (_) { /* matchMedia is absent in some embedded webviews */ }
    const navigatorStandalone = !!(navigator && navigator.standalone === true);

    healStatus.displayModeStandalone = displayModeStandalone;
    healStatus.navigatorStandalone = navigatorStandalone;

    if (!displayModeStandalone && !navigatorStandalone) {
        healStatus.armed = false;
        return null;
    }

    started = true;
    healStatus.armed = true;
    healStatus.healsAttempted = 0;
    healStatus.healsEffective = 0;
    healStatus.fallbackActive = false;
    healStatus.fallbackDeficitPx = null;
    lastIneffectiveHealAt = 0;

    let focusoutTimer = null;
    let settleTimer = null;
    let checkTimer = null;

    // Shared by the three "we may have arrived into a stuck viewport" triggers
    // — launch, resume, bfcache restore. They can fire in quick succession
    // (a bfcache restore is also a visibility change), so they share one timer
    // and the last one to arrive decides when the check runs.
    function scheduleSettledCheck() {
        if (checkTimer) clearTimeout(checkTimer);
        checkTimer = setTimeout(function () {
            checkTimer = null;
            healViewport();
        }, SETTLE_CHECK_DELAY_MS);
    }

    // Capture phase: blur does not bubble reliably off every control, and a
    // handler further down the tree could stop propagation of the focusout
    // before a bubbling listener ever saw it.
    function onFocusOut() {
        if (focusoutTimer) clearTimeout(focusoutTimer);
        focusoutTimer = setTimeout(function () {
            focusoutTimer = null;
            healViewport();
        }, FOCUSOUT_HEAL_DELAY_MS);
    }

    // Secondary trigger: iOS can dismiss the keyboard without blurring the
    // field (the toolbar's Done button, a drag-to-dismiss), in which case no
    // focusout ever fires and the focusout arm alone would leave the app stuck.
    function onVisualViewportResize() {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(function () {
            settleTimer = null;
            if (hasFocusedElement()) return;
            healViewport();
        }, VIEWPORT_SETTLE_MS);
    }

    // Coming back from the app switcher. The shrink survives backgrounding, so
    // a resume is a fresh chance to notice it without waiting for the user to
    // open and close the keyboard again.
    function onVisibilityChange() {
        if (document.visibilityState !== 'visible') return;
        scheduleSettledCheck();
    }

    // A bfcache restore replays the page into whatever viewport the process
    // currently has, which is the shrunken one if the bug already fired.
    function onPageShow() {
        scheduleSettledCheck();
    }

    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);

    const vv = window.visualViewport;
    const hasVisualViewport = !!(vv && typeof vv.addEventListener === 'function');
    if (hasVisualViewport) vv.addEventListener('resize', onVisualViewportResize);

    // A session that boots already shrunken heals on its own, with no focus
    // event and no user action — which is the whole point of measuring against
    // the screen instead of a session maximum.
    scheduleSettledCheck();

    return function teardownViewportHeal() {
        if (focusoutTimer) clearTimeout(focusoutTimer);
        if (settleTimer) clearTimeout(settleTimer);
        if (checkTimer) clearTimeout(checkTimer);
        focusoutTimer = null;
        settleTimer = null;
        checkTimer = null;
        document.removeEventListener('focusout', onFocusOut, true);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pageshow', onPageShow);
        if (hasVisualViewport) vv.removeEventListener('resize', onVisualViewportResize);
        // The flag lives on the document, not in module state, so a teardown
        // that left it behind would leave the app permanently reporting a stuck
        // viewport with nothing left running to re-measure it.
        clearFallback();
        started = false;
        healStatus.armed = false;
        lastIneffectiveHealAt = 0;
    };
}
