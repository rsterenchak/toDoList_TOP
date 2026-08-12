// Ghost talk surface — tap-to-talk, shared by both ghost mounts.
//
// Tapping the ghost freezes it and mounts two elements docked to the frozen
// position: a comic speech bubble above the ghost and a single-line ask input
// beside it. Typing a question posts it to the Worker's `ghost` route and the
// reply lands in the bubble.
//
// Two things are deliberate here. First, the surface is ephemeral — the
// exchange is kept server-side in `ghost_messages`, and this bubble shows one
// line at a time, never a history list. On open it asks the Worker for the
// last thing the ghost said, so the ghost greets you where you left off.
// Second, every failure speaks in the ghost's own voice inside the bubble:
// there is no toast, no assistant-tone error copy, and nothing throws out of
// the click handler. Technical detail goes to console.warn where a developer
// can find it and the user never sees it.
//
// There are two mounts, and the surface is per-mount rather than desktop-only.
// The desktop mount rides the companion: the module subscribes to the sprite's
// activation event, which only ever fires from a mounted sprite. The mobile
// mount is the swipe-summoned perch (mobileGhost.js), which opens this surface
// against its own element. Each mount names its surface when it opens, that
// name rides the Worker payload so the transcript records where the exchange
// happened, and the matching viewport gate is re-checked here — so neither
// mount can ever create a surface on the other's viewport.

import { postToWorker, isInjectConfigured } from './inject.js';
import { supportsDesktopCompanion, onCompanionActivate, prefersReducedMotion } from './companion.js';

// In-voice copy. The ghost never says "request failed" — it says the wire is
// dead. These strings are the whole error surface for this feature.
const WIRE_DEAD   = "the wire's dead. try again later.";
const NO_WIRE     = 'no wire to the other side yet.';
const QUIET       = '…';
const PLACEHOLDER = 'whisper something…';

// Docking geometry. The fallbacks mirror the CSS box so positioning still
// resolves where there is no layout engine to measure against.
const GAP      = 12;   // sprite → bubble / sprite → input
const EDGE     = 8;    // minimum distance from any viewport edge
const CLEAR    = 8;    // floor on the bubble→sprite / bubble→input separation
const BUBBLE_W = 250;  // matches max-width on .ghostTalkBubble
const BUBBLE_H = 44;
const INPUT_W  = 180;
const INPUT_H  = 32;
const TAIL_INSET = 14; // keeps the tail from sliding off the bubble's corners
const FADE_MS  = 200;

let bubbleEl = null;
let textEl   = null;
let tailEl   = null;
let inputEl  = null;
let closeId  = null;
// The freeze/position controls of whichever mount opened the surface — the
// wandering sprite on desktop, the perch on mobile.
let mountApi = null;
let unsubscribe = null;
// Which mount is showing. Read at ask() time so the Worker records the surface
// the question was actually asked from.
let activeSurface = 'desktop';
// Placement inputs captured at open. The sprite is frozen for the whole life of
// the surface and the input never moves, so only the bubble's own size changes
// — which is exactly what drives a reflow.
let spriteBox = null;
let inputBox  = null;
let sizeObserver = null;
// Bumped on every open and close. Async work captures it and bails when it no
// longer matches, so a slow history readback can never overwrite a reply the
// user has already asked for — or paint into a torn-down bubble.
let session = 0;

// The mobile perch's viewport gate. It lives here rather than in
// mobileGhost.js so this module can check the same predicate the perch mounts
// under without the two importing each other; mobileGhost.js imports it back.
export function supportsMobileGhostTalk() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 1023px)').matches);
}

// One gate per mount surface. A surface only ever opens on the viewport its
// own ghost lives on, so a resize across the breakpoint can't leave the wrong
// mount holding a bubble.
const SURFACE_GATES = {
    desktop: supportsDesktopCompanion,
    mobile:  supportsMobileGhostTalk,
};

// Subscribe once to sprite activation. Safe to call repeatedly; a no-op on
// viewports where the companion never runs, so the desktop mount contributes
// nothing on mobile (where the perch mounts this surface instead).
export function ensureGhostTalk() {
    if (unsubscribe) return true;
    if (!supportsDesktopCompanion()) return false;
    unsubscribe = onCompanionActivate(openGhostTalk);
    return true;
}

// Open the talk surface against a frozen ghost. `api` carries the freeze
// controls — on desktop it is the narrow surface companion.js hands to
// activation subscribers (getPosition + freeze/resume/setTalkOpen); on mobile
// the perch passes the same controls and names itself through `opts.anchor`.
// `opts` is `{ surface, anchor }`; an absent surface reads as 'desktop', which
// keeps the companion's `openGhostTalk(api)` call site unchanged.
export function openGhostTalk(api, opts) {
    const options = opts || {};
    const surface = options.surface === 'mobile' ? 'mobile' : 'desktop';
    if (!SURFACE_GATES[surface]()) return null;
    const pos = anchorBox(api, options.anchor);
    if (!pos) return null;

    // A second tap on the ghost while the bubble is up just re-docks it
    // rather than stacking a second surface.
    teardown();
    mountApi = api || null;
    activeSurface = surface;
    session++;
    const mySession = session;
    // Hold the freeze until the surface closes — without this the desktop ghost
    // walks out from under its own bubble the moment the pointer leaves the
    // sprite, and the perch keeps bobbing while it is being spoken to.
    if (mountApi && typeof mountApi.setTalkOpen === 'function') mountApi.setTalkOpen(true);
    if (mountApi && typeof mountApi.freeze === 'function') mountApi.freeze();

    mount();
    position(pos);
    reveal();
    if (inputEl && typeof inputEl.focus === 'function') inputEl.focus();

    // Non-blocking greeting: the bubble opens quiet and fills in if the Worker
    // still remembers the last thing the ghost said.
    say(QUIET);
    loadLastLine(mySession);

    return { close: closeGhostTalk };
}

export function closeGhostTalk() {
    if (!bubbleEl && !inputEl) return;
    const api = mountApi;
    session++;
    fadeOutAndTeardown();
    // Release in the same order the open took it: the surface stops claiming
    // the ghost, then its idle motion is re-armed from the frozen position.
    if (api && typeof api.setTalkOpen === 'function') api.setTalkOpen(false);
    if (api && typeof api.resume === 'function') api.resume();
    mountApi = null;
}

// ── DOM ──

function mount() {
    const doc = document;

    // The surface modifier is what the mobile-viewport hide rule keys off: the
    // desktop mount is barred below 1024px, the mobile mount is not.
    const surfaceClass = 'ghostTalkSurface--' + activeSurface;

    bubbleEl = doc.createElement('div');
    bubbleEl.id = 'ghostTalkBubble';
    bubbleEl.className = 'ghostTalkBubble ghostTalkSurface ' + surfaceClass;
    // Replies arrive asynchronously, so the bubble announces itself.
    bubbleEl.setAttribute('role', 'status');
    bubbleEl.setAttribute('aria-live', 'polite');

    textEl = doc.createElement('span');
    textEl.className = 'ghostTalkText';
    bubbleEl.appendChild(textEl);

    tailEl = doc.createElement('span');
    tailEl.className = 'ghostTalkTail';
    tailEl.setAttribute('aria-hidden', 'true');
    bubbleEl.appendChild(tailEl);

    inputEl = doc.createElement('input');
    inputEl.id = 'ghostTalkInput';
    inputEl.className = 'ghostTalkInput ghostTalkSurface ' + surfaceClass;
    inputEl.type = 'text';
    inputEl.placeholder = PLACEHOLDER;
    inputEl.setAttribute('aria-label', 'Ask the ghost');

    if (prefersReducedMotion()) {
        // Fade instead of pop — the scale-in is the part that reads as motion.
        bubbleEl.classList.add('ghostTalkSurface--calm');
        inputEl.classList.add('ghostTalkSurface--calm');
    }

    doc.body.appendChild(bubbleEl);
    doc.body.appendChild(inputEl);

    inputEl.addEventListener('keydown', onInputKeydown);
    doc.addEventListener('keydown', onDocKeydown, true);
    doc.addEventListener('mousedown', onDocPointerDown, true);
    // Touch gets its own listener rather than relying on the synthetic mousedown
    // iOS emits after the tap: on the perch the surface has to dismiss the
    // moment the finger lands, or a tap-away while the keyboard is up reads as
    // a dead first tap.
    doc.addEventListener('touchstart', onDocPointerDown, true);

    // The bubble is bottom-anchored, so every content change (greeting swap,
    // pending dots, reply, error line) has to re-place it or the box grows
    // downward over the sprite and the input. Watching the element itself
    // catches wrapping changes the callers can't predict.
    observeBubbleSize();
}

// Keep the observer optional: jsdom has no ResizeObserver, and the explicit
// reflow() after each content write covers that case on its own.
function observeBubbleSize() {
    if (typeof ResizeObserver === 'undefined' || !bubbleEl) return;
    try {
        sizeObserver = new ResizeObserver(function () { reflow(); });
        sizeObserver.observe(bubbleEl);
    } catch (err) {
        sizeObserver = null;
    }
}

function releaseObserver() {
    if (!sizeObserver) return;
    sizeObserver.disconnect();
    sizeObserver = null;
}

function teardown() {
    if (closeId) { clearTimeout(closeId); closeId = null; }
    releaseObserver();
    document.removeEventListener('keydown', onDocKeydown, true);
    document.removeEventListener('mousedown', onDocPointerDown, true);
    document.removeEventListener('touchstart', onDocPointerDown, true);
    if (inputEl) {
        inputEl.removeEventListener('keydown', onInputKeydown);
        if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
    }
    if (bubbleEl && bubbleEl.parentNode) bubbleEl.parentNode.removeChild(bubbleEl);
    bubbleEl = null;
    textEl   = null;
    tailEl   = null;
    inputEl  = null;
    spriteBox = null;
    inputBox  = null;
}

function fadeOutAndTeardown() {
    const bubble = bubbleEl;
    const input  = inputEl;
    if (bubble) bubble.classList.add('is-closing');
    if (input)  input.classList.add('is-closing');
    // Detach listeners now so a keystroke during the fade can't reopen work
    // against a surface that is on its way out. The size observer goes with
    // them — the fading bubble still resizes, and a reflow into a surface the
    // user has dismissed is wasted work at best.
    releaseObserver();
    if (input) input.removeEventListener('keydown', onInputKeydown);
    document.removeEventListener('keydown', onDocKeydown, true);
    document.removeEventListener('mousedown', onDocPointerDown, true);
    document.removeEventListener('touchstart', onDocPointerDown, true);
    bubbleEl = null;
    textEl   = null;
    tailEl   = null;
    inputEl  = null;
    spriteBox = null;
    inputBox  = null;
    if (closeId) clearTimeout(closeId);
    closeId = setTimeout(function () {
        closeId = null;
        if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble);
        if (input  && input.parentNode)  input.parentNode.removeChild(input);
    }, FADE_MS);
}

// Flip both elements to their open state. Reading offsetHeight first flushes
// pending style so the transition actually runs from the closed state instead
// of the browser collapsing both frames into one.
function reveal() {
    if (bubbleEl) { void bubbleEl.offsetHeight; bubbleEl.classList.add('is-open'); }
    if (inputEl)  { void inputEl.offsetHeight;  inputEl.classList.add('is-open'); }
}

// Where the bubble goes, given the boxes around it. Pure — no DOM, no module
// state — because this is the part that has to stay correct as the bubble's
// height changes underneath it, and the only way to pin that is to test it
// directly at sizes a layout-less test environment can't produce.
//
// The bubble is BOTTOM-anchored in 'above' mode: its bottom edge is pinned a
// fixed distance over the top of the cluster (sprite and ask input), so growing
// content pushes the box upward into empty space instead of downward over the
// two things it is docked to. When there isn't room overhead for that — a ghost
// frozen near the top of the viewport, or a bubble tall enough to run off it —
// placement flips to 'below', where the bubble sits under the cluster and the
// caller flips the tail to point back up at the sprite.
//
// `spriteRect` and `inputRect` are `{x, y, width, height}` in viewport
// coordinates; `inputRect` may be null. `bubbleSize` is `{width, height}` and
// `viewport` is `{width, height}`.
export function computeTalkLayout(spriteRect, bubbleSize, inputRect, viewport) {
    const sx = num(spriteRect && spriteRect.x, 0);
    const sy = num(spriteRect && spriteRect.y, 0);
    const sw = num(spriteRect && spriteRect.width, 0);
    const sh = num(spriteRect && spriteRect.height, 0);
    const bw = num(bubbleSize && bubbleSize.width, BUBBLE_W);
    const bh = num(bubbleSize && bubbleSize.height, BUBBLE_H);
    const vw = num(viewport && viewport.width, 1024);
    const vh = num(viewport && viewport.height, 768);

    // The cluster the bubble must clear: the sprite, plus the ask input when
    // one is placed. Anchoring on the extremes of both is what keeps the three
    // elements from ever stacking on top of each other.
    let clusterTop    = sy;
    let clusterBottom = sy + sh;
    if (inputRect) {
        const iy = num(inputRect.y, sy);
        const ih = num(inputRect.height, 0);
        clusterTop    = Math.min(clusterTop, iy);
        clusterBottom = Math.max(clusterBottom, iy + ih);
    }

    // GAP is the intended separation and CLEAR the hard floor; taking the max
    // states the invariant in code rather than leaving it to the constants.
    const sep = Math.max(GAP, CLEAR);
    const centreX = sx + sw / 2;
    const bubbleX = clamp(centreX - bw / 2, EDGE, vw - EDGE - bw);

    let placement = 'above';
    let bubbleY = clusterTop - sep - bh;
    if (bubbleY < EDGE) {
        // Not enough headroom for the whole box plus its gap and edge margin.
        placement = 'below';
        bubbleY = clamp(clusterBottom + sep, EDGE, Math.max(EDGE, vh - EDGE - bh));
    }

    // The tail tracks the sprite rather than the bubble's centre, so a bubble
    // clamped against a viewport edge still points back at the ghost.
    const tailX = clamp(centreX - bubbleX, TAIL_INSET, Math.max(TAIL_INSET, bw - TAIL_INSET));

    return { bubbleX: bubbleX, bubbleY: bubbleY, tailX: tailX, placement: placement };
}

// The box the surface docks to, however the mount describes it. The wandering
// sprite has no stable element box worth reading — it is lerped from JS — so it
// reports through getPosition(); the perch is a real fixed element and reports
// through its own rect. Returns null when neither is usable, which is the
// caller's cue to open nothing at all.
function anchorBox(api, anchor) {
    if (api && typeof api.getPosition === 'function') return api.getPosition();
    if (anchor && typeof anchor.getBoundingClientRect === 'function') {
        const r = anchor.getBoundingClientRect();
        return {
            x:      num(r.left, 0),
            y:      num(r.top, 0),
            width:  num(r.width, 0)  || anchor.offsetWidth  || 0,
            height: num(r.height, 0) || anchor.offsetHeight || 0,
        };
    }
    return null;
}

// Dock the input beside the frozen sprite and record both boxes, then place the
// bubble against them. Only the input placement lives here — the bubble's runs
// through reflow() so it can be repeated on every size change.
function position(pos) {
    if (!bubbleEl || !inputEl) return;
    const vw = window.innerWidth  || 1024;
    const vh = window.innerHeight || 768;

    const iw = inputEl.offsetWidth  || INPUT_W;
    const ih = inputEl.offsetHeight || INPUT_H;
    // Prefer the right of the sprite; flip to its left when that would run
    // past the edge.
    let ix = pos.x + pos.width + GAP;
    if (ix + iw > vw - EDGE) ix = pos.x - GAP - iw;
    ix = clamp(ix, EDGE, vw - EDGE - iw);
    const iy = clamp(pos.y + pos.height / 2 - ih / 2, EDGE, vh - EDGE - ih);
    inputEl.style.left = Math.round(ix) + 'px';
    inputEl.style.top  = Math.round(iy) + 'px';

    spriteBox = { x: pos.x, y: pos.y, width: pos.width, height: pos.height };
    inputBox  = { x: ix, y: iy, width: iw, height: ih };
    reflow();
}

// Re-place the bubble against the boxes captured at open. Called by the size
// observer and explicitly after every content write, so the bottom-anchoring
// holds even where ResizeObserver doesn't exist.
function reflow() {
    if (!bubbleEl || !spriteBox) return;
    const size = {
        width:  bubbleEl.offsetWidth  || BUBBLE_W,
        height: bubbleEl.offsetHeight || BUBBLE_H,
    };
    const viewport = { width: window.innerWidth || 1024, height: window.innerHeight || 768 };
    const layout = computeTalkLayout(spriteBox, size, inputBox, viewport);

    bubbleEl.style.left = Math.round(layout.bubbleX) + 'px';
    bubbleEl.style.top  = Math.round(layout.bubbleY) + 'px';
    bubbleEl.classList.toggle('ghostTalkBubble--below', layout.placement === 'below');
    if (tailEl) tailEl.style.left = Math.round(layout.tailX) + 'px';
}

function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function clamp(v, lo, hi) {
    if (hi < lo) return lo;
    return Math.max(lo, Math.min(hi, v));
}

// ── BUBBLE CONTENT ──

function say(text) {
    if (!textEl) return;
    textEl.textContent = text;
    if (bubbleEl) bubbleEl.classList.remove('ghostTalkBubble--pending');
    reflow();
}

// Blinking dots while a reply is in flight. Under reduced motion the same
// state renders as a static ellipsis — same shape, no animation.
function sayPending() {
    if (!textEl || !bubbleEl) return;
    bubbleEl.classList.add('ghostTalkBubble--pending');
    if (prefersReducedMotion()) {
        textEl.textContent = QUIET;
        reflow();
        return;
    }
    textEl.textContent = '';
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'ghostTalkDot';
        textEl.appendChild(dot);
    }
    reflow();
}

// ── WORKER ──

function onInputKeydown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const message = (inputEl && inputEl.value ? inputEl.value : '').trim();
    if (!message) return;
    inputEl.value = '';
    ask(message);
}

function ask(message) {
    const mySession = session;
    if (!isInjectConfigured()) {
        // The user has no Worker wired up. In-voice in the bubble; the actual
        // cause goes to the console for whoever is debugging the setup.
        console.warn('[ghostTalk] Worker not configured — set the inject URL and secret to talk to the ghost.');
        say(NO_WIRE);
        return;
    }
    sayPending();
    postToWorker({ ghost: true, message: message, surface: activeSurface })
        .then(function (res) {
            if (mySession !== session) return;
            const reply = readText(res);
            say(reply || QUIET);
        })
        .catch(function (err) {
            if (mySession !== session) return;
            console.warn('[ghostTalk] ghost route failed', err);
            say(err && err.notConfigured ? NO_WIRE : WIRE_DEAD);
        });
}

// Greeting readback. Quiet by design: a failure here leaves the bubble on its
// "…" rather than opening with an error the user did not ask for.
function loadLastLine(mySession) {
    if (!isInjectConfigured()) return;
    postToWorker({ ghost: true, history: true })
        .then(function (res) {
            if (mySession !== session) return;
            const line = readLastGhostLine(res);
            if (line) say(line);
        })
        .catch(function (err) {
            console.warn('[ghostTalk] history readback failed', err);
        });
}

// The Worker owns the transcript shape, so read it forgivingly: a bare
// string, a reply/text field, or a list of rows under any of the names the
// route has used. Anything unrecognised reads as "no line", which the caller
// treats as the quiet open.
function readText(row) {
    if (!row) return '';
    if (typeof row === 'string') return row;
    if (typeof row.reply   === 'string') return row.reply;
    if (typeof row.content === 'string') return row.content;
    if (typeof row.message === 'string') return row.message;
    if (typeof row.text    === 'string') return row.text;
    return '';
}

function readLastGhostLine(res) {
    if (!res) return '';
    const list = Array.isArray(res)                ? res
               : Array.isArray(res.messages)       ? res.messages
               : Array.isArray(res.history)        ? res.history
               : Array.isArray(res.ghost_messages) ? res.ghost_messages
               : null;
    if (!list) return readText(res);
    for (let i = list.length - 1; i >= 0; i--) {
        const row = list[i];
        if (!row) continue;
        // Skip the user's own turns — the greeting is the ghost's last word.
        const role = typeof row === 'string' ? '' : (row.role || row.author || '');
        if (role && role !== 'ghost' && role !== 'assistant') continue;
        const text = readText(row);
        if (text) return text;
    }
    return '';
}

// ── DISMISSAL ──

function onDocKeydown(e) {
    if (e.key === 'Escape') closeGhostTalk();
}

function onDocPointerDown(e) {
    const t = e.target;
    if (!t) { closeGhostTalk(); return; }
    if (bubbleEl && bubbleEl.contains(t)) return;
    if (inputEl && (inputEl === t || inputEl.contains(t))) return;
    // Taps on either ghost belong to its own mount — both re-open (re-dock) the
    // surface themselves, so closing here would fight them.
    if (typeof t.closest === 'function' && t.closest('.companionHit, .mobileGhostPerch')) return;
    closeGhostTalk();
}

// Test seam — drops the surface and the subscription without touching the
// companion, so each case starts from a known-empty module state.
export function resetGhostTalk() {
    session++;
    teardown();
    mountApi = null;
    activeSurface = 'desktop';
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}
