// Hides the mobile tab bar and Claude FAB while an iOS standalone launch's viewport is still growing to full height.
//
// ── IOS STANDALONE LAUNCH SETTLE ──
//
// On launch the installed iOS PWA paints its first frames into a layout
// viewport that starts ~53px short and then grows to the full screen over the
// next couple of seconds. Everything bottom-anchored with `position: fixed` —
// `#mobileTabBar` and `#claudeLauncher` — rides that growth, so the bar and
// FAB visibly slide down while the rest of the shell holds still.
//
// The growth is the platform's own, not a bug this app can correct (and the
// root-scrollability probe in `style.css` that is likely behind it stays — it
// is the vaccine against the keyboard shrink). So the settle is MASKED instead
// of fought: while the viewport is short, `body.viewportSettling` makes the two
// elements transparent, and once it reaches full height the class comes off
// and they fade in at their final position. A launch that is already full
// height never sets the class, so unaffected launches never hide the nav.
//
// Gating and the truth test match `viewportHeal.js`: standalone only, mobile
// breakpoint only, and the expected height is the physical screen dimension.

// How far below the screen height still counts as settled — the same margin
// viewportHeal.js uses to absorb rounding and minor UA insets.
const SETTLED_MARGIN_PX = 24;

// Never hide the nav longer than this, even if the viewport never reaches the
// expected height (a platform where it legitimately can't).
const SETTLE_CAP_MS = 3000;

// The mobile layout (and the tab bar with it) is scoped to ≤1023px.
const DESKTOP_MIN_WIDTH = 1024;

const SETTLING_CLASS = 'viewportSettling';

function isStandalone() {
    let displayModeStandalone = false;
    try {
        displayModeStandalone = !!(window.matchMedia
            && window.matchMedia('(display-mode: standalone)').matches);
    } catch (_) { /* matchMedia is absent in some embedded webviews */ }
    return displayModeStandalone || !!(navigator && navigator.standalone === true);
}

// `screen.width`/`screen.height` are device-native on iOS and do not swap with
// orientation, so portrait expects `height` and landscape expects `width`.
function expectedViewportHeight() {
    const s = window.screen;
    if (!s) return 0;
    const w = typeof s.width === 'number' ? s.width : 0;
    const h = typeof s.height === 'number' ? s.height : 0;
    const landscape = window.innerWidth > window.innerHeight;
    const expected = landscape ? w : h;
    return expected > 0 ? expected : 0;
}

function isSettled(expected) {
    return window.innerHeight >= expected - SETTLED_MARGIN_PX;
}

// Mask the launch settle when there is one. Returns true when the class was
// applied, false when the launch was a no-op (not standalone, desktop width,
// no usable screen, or already full height).
export function initViewportSettle() {
    if (!isStandalone()) return false;
    if (window.innerWidth >= DESKTOP_MIN_WIDTH) return false;
    const expected = expectedViewportHeight();
    if (!expected || isSettled(expected)) return false;
    if (!document.body || typeof window.requestAnimationFrame !== 'function') return false;

    document.body.classList.add(SETTLING_CLASS);
    const startedAt = Date.now();

    function poll() {
        if (isSettled(expected) || Date.now() - startedAt >= SETTLE_CAP_MS) {
            document.body.classList.remove(SETTLING_CLASS);
            return;
        }
        window.requestAnimationFrame(poll);
    }
    window.requestAnimationFrame(poll);
    return true;
}
