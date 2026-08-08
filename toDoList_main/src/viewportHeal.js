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

// The mobile layout — and therefore `#mobileTabBar`, the element this exists
// to reseat — is scoped to ≤1023px. At desktop widths the bar is `display:
// none` and there is nothing to heal, so a desktop-installed PWA whose window
// the user merely resized smaller never flips anything.
const DESKTOP_MIN_WIDTH = 1024;

// When the last flip left the deficit exactly where it found it. 0 means no
// ineffective flip has been recorded.
let lastIneffectiveHealAt = 0;

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
    if (window.innerWidth >= DESKTOP_MIN_WIDTH) return false;
    return viewportDeficit() > STUCK_THRESHOLD_PX;
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
    if (inHealCooldown()) return false;
    const outer = document.getElementById('outerContainer');
    if (!outer) return false;

    const list = document.getElementById('mainList');
    const scrollTop = list ? list.scrollTop : 0;
    const before = viewportDeficit();

    outer.style.display = 'none';
    void outer.offsetHeight;   // synchronous reflow, between the two writes
    outer.style.display = '';

    if (list) list.scrollTop = scrollTop;

    // Re-measure. A flip that left the deficit where it found it either did
    // not work or was never the right remedy here, and repeating it on every
    // subsequent trigger would be a loop; a flip that shrank the deficit is
    // free to run again immediately.
    if (viewportDeficit() >= before) lastIneffectiveHealAt = Date.now();
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
        started = false;
        lastIneffectiveHealAt = 0;
    };
}
