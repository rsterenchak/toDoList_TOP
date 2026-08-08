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
// it: the box is correct, the viewport it resolves against is wrong. The
// documented workaround is to force the browser to re-measure by hiding a
// full-viewport-height element, flushing layout synchronously while it is
// hidden, then restoring it — see
// https://dev.to/cederhook/fixing-the-ios-standalone-pwa-keyboard-bug-that-shrinks-your-viewport-for-good-63d
// `#outerContainer` is `height: 100dvh` on mobile, which satisfies the
// workaround's full-viewport-height requirement.
//
// The heal is a strict no-op unless the viewport is measurably shorter than
// the tallest it has been this session, so Safari, desktop, and a fresh
// standalone session that has not yet opened the keyboard never see it run.

// How far below the session maximum the viewport must sit before we treat it
// as stuck. The iOS shrink is ~59px; a few pixels of drift (rounding, a
// scrollbar appearing) is normal and must not trigger a flip.
const STUCK_THRESHOLD_PX = 4;

// iOS keeps resizing the viewport for a beat after the keyboard starts
// dismissing, so healing on the blur itself would measure mid-animation and
// either miss the shrink or heal against a transient height.
const FOCUSOUT_HEAL_DELAY_MS = 140;

// The visual viewport fires a burst of resizes as the keyboard slides away;
// debounce past the burst so the stuck-check reads a settled height.
const VIEWPORT_SETTLE_MS = 200;

// The mobile layout — and therefore `#mobileTabBar`, the element this exists
// to reseat — is scoped to ≤1023px. At desktop widths the bar is `display:
// none` and there is nothing to heal, so a desktop-installed PWA whose window
// the user merely resized smaller never flips anything.
const DESKTOP_MIN_WIDTH = 1024;

// The tallest `window.innerHeight` seen this session. The iOS shrink is
// permanent for the session, so the pre-keyboard height is the only reference
// for "how tall should this be" available at runtime.
let maxViewportHeight = 0;

function readViewportHeight() {
    const h = window.innerHeight;
    return typeof h === 'number' && h > 0 ? h : 0;
}

function trackViewportHeight() {
    const h = readViewportHeight();
    if (h > maxViewportHeight) maxViewportHeight = h;
}

// True only when the viewport is shorter than its session maximum by more than
// the threshold, at a width where the mobile layout is actually in play. Every
// trigger routes through here, so the no-op guarantee lives in one place.
function isViewportStuck() {
    if (window.innerWidth >= DESKTOP_MIN_WIDTH) return false;
    const h = readViewportHeight();
    if (!h || !maxViewportHeight) return false;
    return (maxViewportHeight - h) > STUCK_THRESHOLD_PX;
}

// Whether anything other than the document body holds focus. Used by the
// visual-viewport trigger: a resize while an input is still focused is the
// keyboard OPENING, which we must not heal against — that height is the
// legitimate current viewport, not a stuck one.
function hasFocusedElement() {
    const el = document.activeElement;
    return !!el && el !== document.body && el !== document.documentElement;
}

// The heal itself. Hiding `#outerContainer` and reading a layout-forcing
// property while it is hidden makes the browser drop and rebuild the layout
// against the real viewport; restoring `display` paints it back at the correct
// height in the same frame, so nothing is ever visible in the hidden state.
// `#mainList` scrolls independently and would otherwise be reset to 0 by the
// display flip, so its offset is captured and restored around it.
// Returns whether a heal actually ran, which is what makes the no-op path
// observable to tests.
function healViewport() {
    if (!isViewportStuck()) return false;
    const outer = document.getElementById('outerContainer');
    if (!outer) return false;

    const list = document.getElementById('mainList');
    const scrollTop = list ? list.scrollTop : 0;

    outer.style.display = 'none';
    void outer.offsetHeight;   // synchronous reflow, between the two writes
    outer.style.display = '';

    if (list) list.scrollTop = scrollTop;
    return true;
}

let started = false;

// Arm the heal. Gated on the standalone display mode because the bug is
// exclusive to the installed PWA — in Safari the viewport recovers on its own
// and there is nothing to correct. Returns a teardown function when armed, or
// null when the gate rejected (or it was already armed), so a caller can tell
// the two apart.
export function initViewportHeal() {
    if (started) return null;
    let standalone = false;
    try {
        standalone = !!(window.matchMedia
            && window.matchMedia('(display-mode: standalone)').matches);
    } catch (_) { /* matchMedia is absent in some embedded webviews */ }
    if (!standalone) return null;

    started = true;
    trackViewportHeight();

    let focusoutTimer = null;
    let settleTimer = null;

    function onResize() {
        trackViewportHeight();
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

    window.addEventListener('resize', onResize);
    document.addEventListener('focusout', onFocusOut, true);

    const vv = window.visualViewport;
    const hasVisualViewport = !!(vv && typeof vv.addEventListener === 'function');
    if (hasVisualViewport) vv.addEventListener('resize', onVisualViewportResize);

    return function teardownViewportHeal() {
        if (focusoutTimer) clearTimeout(focusoutTimer);
        if (settleTimer) clearTimeout(settleTimer);
        focusoutTimer = null;
        settleTimer = null;
        window.removeEventListener('resize', onResize);
        document.removeEventListener('focusout', onFocusOut, true);
        if (hasVisualViewport) vv.removeEventListener('resize', onVisualViewportResize);
        started = false;
        maxViewportHeight = 0;
    };
}
