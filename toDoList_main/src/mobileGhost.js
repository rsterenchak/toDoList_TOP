// Mobile ghost perch — the phone-side counterpart to the desktop companion.
//
// The ghost has no ambient presence on mobile: it is summoned. Swiping UP from
// the bottom tab bar raises a small ghost from behind the bar to a perch in the
// bottom-LEFT corner just above it; swiping DOWN on the bar or on the ghost
// itself sinks it away again. Tapping the perched ghost opens the Claude sheet
// already possessed (claudeSheet.js), where the ghost wears the whole surface
// and posts with `surface: "mobile"` so the exchange lands in the same
// transcript the desktop sprite writes to.
//
// Three constraints shape the gesture handling. The bar's tabs must keep
// working: only a predominantly-vertical drag past the threshold counts, and
// when one commits, the click it would otherwise produce is swallowed for that
// touch alone — a plain tap, a short drag, or any horizontal movement falls
// straight through to the tab. The perch is bottom-LEFT on purpose, the corner
// opposite #claudeLauncher, so it can never overlap the assistant FAB or read
// as a second one. And visibility is a real preference: it persists in
// localStorage, so a summoned ghost is still there on the next launch.
//
// The perch never mounts on a viewport that runs the desktop companion — the
// two ghosts are mutually exclusive by gate, not by luck.

import { supportsDesktopCompanion } from './companion.js';
import { supportsMobileGhostTalk } from './ghostTalk.js';
import { openClaudeSheet, POSSESSION_EVENT } from './claudeSheet.js';

const STORAGE_KEY = 'todoapp_mobileGhostVisible';

// Vertical travel that commits a summon or a dismiss. Deliberately short — the
// tab bar is only ~56px tall, so the finger has little room before it leaves
// the element the gesture started on.
const SWIPE_PX = 24;
// A committed swipe may never produce a click at all (the finger lifts outside
// the bar, or the browser cancels the touch). Drop the suppression on a timer
// so a stale flag can never eat a genuine tap made later.
const CLICK_SUPPRESS_MS = 700;

let perchEl   = null;
let spriteEl  = null;
let barEl     = null;
let visible   = false;
let talkOpen  = false;
// Live gesture on the tab bar: the touch's origin plus whether it has already
// committed, so a single drag summons once rather than on every move frame.
let barGesture = null;
let suppressClick = false;
let suppressId = null;
// The perch's own gesture. `swiped` marks a dismiss that already fired, so the
// click that follows the same touch doesn't then re-open the talk surface.
let perchGesture = null;
let perchSwiped = false;

// The perch's viewport gate. Mobile breakpoint AND not a viewport the desktop
// companion claims, so the two ghosts can never both be mounted.
export function supportsMobileGhost() {
    return supportsMobileGhostTalk() && !supportsDesktopCompanion();
}

// Mount the perch and wire the tab-bar gesture. Safe to call repeatedly: it
// re-wires only when the tab bar it is bound to has changed (the bar is rebuilt
// whenever the app shell re-renders), and is a no-op on viewports the perch
// doesn't run on, so desktop gets zero presence.
export function ensureMobileGhost() {
    if (!supportsMobileGhost()) return false;
    const bar = document.getElementById('mobileTabBar');
    if (!bar) return false;
    if (barEl === bar && perchEl) return true;

    destroyMobileGhost();
    barEl = bar;
    barEl.addEventListener('touchstart', onBarTouchStart, { passive: true });
    barEl.addEventListener('touchmove', onBarTouchMove, { passive: true });
    barEl.addEventListener('touchend', onBarTouchEnd);
    barEl.addEventListener('touchcancel', onBarTouchCancel);
    // Capture phase, so the swallow lands before the tab's own click handler
    // navigates.
    barEl.addEventListener('click', onBarClickCapture, true);
    document.addEventListener(POSSESSION_EVENT, onPossessionChange);

    mountPerch();
    // Restore where the user left the ghost. Applied before the element has
    // ever been laid out, so a ghost that was already up on the last launch is
    // simply there rather than rising on boot.
    applyVisible(readVisible());
    return true;
}

export function destroyMobileGhost() {
    document.removeEventListener(POSSESSION_EVENT, onPossessionChange);
    if (barEl) {
        barEl.removeEventListener('touchstart', onBarTouchStart);
        barEl.removeEventListener('touchmove', onBarTouchMove);
        barEl.removeEventListener('touchend', onBarTouchEnd);
        barEl.removeEventListener('touchcancel', onBarTouchCancel);
        barEl.removeEventListener('click', onBarClickCapture, true);
        barEl = null;
    }
    if (perchEl) {
        perchEl.removeEventListener('click', onPerchClick);
        perchEl.removeEventListener('touchstart', onPerchTouchStart);
        perchEl.removeEventListener('touchmove', onPerchTouchMove);
        perchEl.removeEventListener('touchend', onPerchTouchEnd);
        if (perchEl.parentNode) perchEl.parentNode.removeChild(perchEl);
    }
    perchEl = null;
    spriteEl = null;
    visible = false;
    talkOpen = false;
    barGesture = null;
    perchGesture = null;
    perchSwiped = false;
    clearSuppress();
}

// ── PERCH ──

function mountPerch() {
    perchEl = document.createElement('button');
    perchEl.id = 'mobileGhostPerch';
    perchEl.className = 'mobileGhostPerch';
    perchEl.type = 'button';
    perchEl.setAttribute('aria-label', 'Talk to the ghost');

    // The bob animation and the summon rise are both transforms, so they get
    // separate elements: the button carries the rise, the sprite inside it
    // carries the bob. One element could only run one of them.
    spriteEl = document.createElement('span');
    spriteEl.className = 'mobileGhostSprite';
    spriteEl.setAttribute('aria-hidden', 'true');
    perchEl.appendChild(spriteEl);

    perchEl.addEventListener('click', onPerchClick);
    perchEl.addEventListener('touchstart', onPerchTouchStart, { passive: true });
    perchEl.addEventListener('touchmove', onPerchTouchMove, { passive: true });
    perchEl.addEventListener('touchend', onPerchTouchEnd);
    document.body.appendChild(perchEl);
}

// Paint the visibility state. A dismissed perch is fully out of reach — no
// pointer events (CSS), no focus stop, and hidden from assistive tech, since
// the ghost is genuinely not on screen.
function applyVisible(next) {
    visible = !!next;
    if (!perchEl) return;
    perchEl.classList.toggle('is-visible', visible);
    perchEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
    perchEl.tabIndex = visible ? 0 : -1;
    // A sunk perch stops holding still — but it does NOT close the sheet it
    // opened. The perch is a door, not the room: once the ghost is wearing the
    // sheet the conversation belongs to that surface, and dismissing the perch
    // out from under a sheet the user is mid-sentence in would be a data loss
    // dressed up as a gesture.
    if (!visible && talkOpen) setStill(false);
}

// The one writer for visibility. Persists first so the preference survives even
// if the paint below is the last thing that happens before a reload.
function setVisible(next) {
    if (visible === !!next) return;
    writeVisible(!!next);
    applyVisible(!!next);
}

export function isMobileGhostVisible() {
    return visible;
}

function readVisible() {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (e) {
        // Private mode / quota — the ghost simply starts dismissed.
        return false;
    }
}

function writeVisible(v) {
    try {
        localStorage.setItem(STORAGE_KEY, v ? 'true' : 'false');
    } catch (e) {
        /* quota or private-mode — the preference is transient this session */
    }
}

// ── TAB-BAR GESTURE ──

function onBarTouchStart(e) {
    // Clears the previous gesture's suppression: the click it was armed for has
    // either landed by now or never will.
    clearSuppress();
    const t = singleTouch(e);
    if (!t) { barGesture = null; return; }
    barGesture = { x: t.clientX, y: t.clientY, committed: false };
}

function onBarTouchMove(e) {
    if (!barGesture || barGesture.committed) return;
    const t = singleTouch(e);
    if (!t) return;
    const dx = t.clientX - barGesture.x;
    const dy = t.clientY - barGesture.y;
    if (Math.abs(dy) < SWIPE_PX) return;
    // Predominantly vertical only. Horizontal travel belongs to other gestures
    // (project swipe-nav lives elsewhere), so it never summons or dismisses.
    if (Math.abs(dx) >= Math.abs(dy)) return;
    barGesture.committed = true;
    armSuppress();
    // Up summons, down dismisses.
    setVisible(dy < 0);
}

function onBarTouchEnd() {
    barGesture = null;
}

function onBarTouchCancel() {
    barGesture = null;
    // No click follows a cancelled touch, so nothing is left to swallow.
    clearSuppress();
}

function onBarClickCapture(e) {
    if (!suppressClick) return;
    clearSuppress();
    e.stopPropagation();
    e.preventDefault();
}

function armSuppress() {
    suppressClick = true;
    if (suppressId) clearTimeout(suppressId);
    suppressId = setTimeout(clearSuppress, CLICK_SUPPRESS_MS);
}

function clearSuppress() {
    suppressClick = false;
    if (suppressId) { clearTimeout(suppressId); suppressId = null; }
}

function singleTouch(e) {
    const list = e && e.touches;
    if (!list || list.length !== 1) return null;
    return list[0];
}

// ── PERCH GESTURE ──

function onPerchTouchStart(e) {
    perchSwiped = false;
    const t = singleTouch(e);
    if (!t) { perchGesture = null; return; }
    perchGesture = { x: t.clientX, y: t.clientY };
}

function onPerchTouchMove(e) {
    if (!perchGesture || perchSwiped) return;
    const t = singleTouch(e);
    if (!t) return;
    const dx = t.clientX - perchGesture.x;
    const dy = t.clientY - perchGesture.y;
    // Downward and predominantly vertical — the same shape as the bar's dismiss.
    if (dy < SWIPE_PX) return;
    if (Math.abs(dx) >= dy) return;
    perchSwiped = true;
    setVisible(false);
}

function onPerchTouchEnd() {
    perchGesture = null;
}

function onPerchClick() {
    // The dismiss already acted on this touch; the trailing click is not a tap.
    if (perchSwiped) { perchSwiped = false; return; }
    if (!visible) return;
    openTalk();
}

// ── TALK SURFACE ──

// The perch has no talk surface of its own: tapping it hands the ghost the
// Claude sheet. The sheet announces every possession flip on the document, and
// the perch follows that rather than tracking the sheet's state itself — so the
// bob stills whether possession was entered from here or from the sheet's own
// ghost chip, and releases on every exit (chip, RUNS tab, or sheet close).
function onPossessionChange(e) {
    talkOpen = !!(e && e.detail && e.detail.possessed);
    setStill(talkOpen);
}

function setStill(still) {
    if (perchEl) perchEl.classList.toggle('is-still', !!still);
}

function openTalk() {
    if (!perchEl) return;
    openClaudeSheet({ possessed: true });
}
