// Ghost talk — the shared plumbing, plus the desktop floating skin.
//
// Tapping the desktop ghost freezes it and mounts two elements docked to the
// frozen position: a comic speech bubble above the ghost and a single-line ask
// input beside it. Typing a question posts it to the Worker's `ghost` route and
// the reply lands in the bubble.
//
// The mobile perch does NOT wear that skin. Phone screens are dense enough that
// a floating bubble lands on top of the TODO.md pill, the list rows and the FAB,
// so the perch opens the Claude sheet already possessed (see the POSSESSION
// section of the Claude sheet module) and the ghost speaks through that surface
// instead. What the two surfaces share lives at the top of this file under
// SHARED PLUMBING: the two Worker calls, the recency-gated opening line, the
// in-voice error strings and the pending render. Neither reaches for the Worker
// itself.
//
// Two things are deliberate about the plumbing. First, the desktop surface is
// ephemeral — the exchange is kept server-side in `ghost_messages`, and the
// bubble shows one line at a time, never a history list. On open it asks the
// Worker for the last thing the ghost said and shows it only while the exchange
// is still warm; past that window a replayed answer reads as an answer without
// its question, so the ghost greets instead.
// Second, every failure speaks in the ghost's own voice inside the bubble:
// there is no toast, no assistant-tone error copy, and nothing throws out of
// the click handler. Technical detail goes to console.warn where a developer
// can find it and the user never sees it.
//
// The desktop cluster is fixed-positioned at pixel coordinates captured at open.
// That is safe here because the desktop mount has no software keyboard to be
// buried under; the possessed sheet is a layout box that already rides the cured
// viewport, which is why no viewport-docking code lives in this module.
//
// The desktop mount rides the companion: this module subscribes to the sprite's
// activation event, which only ever fires from a mounted sprite. The mobile
// perch (mobileGhost.js) opens the possessed Claude sheet instead. Each surface
// names itself on the Worker payload so the transcript records where the
// exchange happened, and the floating skin re-checks its own viewport gate — so
// it can never open on a phone.

import { postToWorker, isInjectConfigured } from './inject.js';
import { supportsDesktopCompanion, onCompanionActivate, prefersReducedMotion } from './companion.js';

// ── SHARED PLUMBING ──
// Everything in this section is surface-agnostic: the desktop bubble below and
// the possessed Claude sheet both build on exactly these pieces, so the two can
// never drift on what the ghost says or what goes out over the wire.

// In-voice copy. The ghost never says "request failed" — it says the wire is
// dead. These strings are the whole error surface for this feature.
export const GHOST_WIRE_DEAD   = "the wire's dead. try again later.";
export const GHOST_NO_WIRE     = 'no wire to the other side yet.';
export const GHOST_QUIET       = '…';
export const GHOST_PLACEHOLDER = 'whisper something…';

// How long a conversation stays warm. Reopen inside this window and the ghost
// picks up on its last reply — the thread was never really dropped. Outside it,
// that reply is stale and gets a greeting instead.
export const GHOST_CONTINUATION_MS = 10 * 60 * 1000;

// Cold-open lines, one picked at random. These are theatre only: a greeting is
// never posted to the Worker and never reaches `ghost_messages`, so it can
// never turn up later as something the ghost actually said.
export const GHOST_GREETINGS = [
    'you again. good.',
    'still here.',
    'quiet in here.',
    "the list isn't going anywhere. neither am i.",
    "speak, or don't. i have time.",
];

// The mobile perch's viewport gate. It lives here rather than in
// mobileGhost.js so the perch and this module check the same predicate without
// either importing the other.
export function supportsMobileGhostTalk() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 1023px)').matches);
}

// Whether there is a Worker to talk to at all. Surfaces read this to decide
// whether a pending state is worth showing before the answer comes back.
export function isGhostWireReady() {
    return isInjectConfigured();
}

// Post one question and resolve with the line the ghost says back — the reply
// when the wire holds, an in-voice failure line when it doesn't. NEVER rejects:
// both surfaces paint whatever comes back straight into their thread, and a throw
// out of a keydown handler is exactly the assistant-tone failure this feature
// exists to avoid.
export function askGhost(message, surface) {
    if (!isInjectConfigured()) {
        // The user has no Worker wired up. In-voice to the caller; the actual
        // cause goes to the console for whoever is debugging the setup.
        console.warn('[ghostTalk] Worker not configured — set the inject URL and secret to talk to the ghost.');
        return Promise.resolve(GHOST_NO_WIRE);
    }
    return postToWorker({ ghost: true, message: message, surface: surface })
        .then(function (res) {
            return readText(res) || GHOST_QUIET;
        })
        .catch(function (err) {
            console.warn('[ghostTalk] ghost route failed', err);
            return err && err.notConfigured ? GHOST_NO_WIRE : GHOST_WIRE_DEAD;
        });
}

// The transcript, oldest-first, as `{ role, text, createdAt }` rows. Quiet by
// design: an unconfigured Worker makes no request at all, and every failure
// resolves empty rather than surfacing an error nobody asked for.
export function fetchGhostHistory() {
    if (!isInjectConfigured()) return Promise.resolve([]);
    return postToWorker({ ghost: true, history: true })
        .then(readGhostRows)
        .catch(function (err) {
            console.warn('[ghostTalk] history readback failed', err);
            return [];
        });
}

// The Worker owns the transcript shape, so read it forgivingly: a list under
// any of the names the route has used, or a single bare reply. Anything
// unrecognised reads as an empty transcript.
export function readGhostRows(res) {
    if (!res) return [];
    const list = Array.isArray(res)                ? res
               : Array.isArray(res.messages)       ? res.messages
               : Array.isArray(res.history)        ? res.history
               : Array.isArray(res.ghost_messages) ? res.ghost_messages
               : null;
    if (!list) {
        const bare = readText(res);
        return bare ? [{ role: 'ghost', text: bare, createdAt: readTime(res) }] : [];
    }
    const rows = [];
    for (let i = 0; i < list.length; i++) {
        const row = list[i];
        if (!row) continue;
        const text = readText(row);
        if (!text) continue;
        rows.push({ role: rowRole(row), text: text, createdAt: readTime(row) });
    }
    return rows;
}

// The ghost's last word and when it said it, or null when the transcript holds
// nothing the ghost said. `createdAt` rides along because the recency gate
// needs it; it is null where the row carried no time.
export function lastGhostReply(rows) {
    if (!Array.isArray(rows)) return null;
    for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i] && rows[i].role === 'ghost' && rows[i].text) return rows[i];
    }
    return null;
}

// A missing or unparseable timestamp reads as stale. The gate is "provably
// warm" — without a time to check, the greeting is the safer line. Times in
// the future count as warm, so a little clock skew doesn't cost the thread.
export function isGhostReplyWarm(createdAt) {
    const t = parseTime(createdAt);
    if (t === null) return false;
    return Date.now() - t < GHOST_CONTINUATION_MS;
}

export function pickGhostGreeting() {
    const i = Math.floor(Math.random() * GHOST_GREETINGS.length);
    return GHOST_GREETINGS[clamp(i, 0, GHOST_GREETINGS.length - 1)];
}

// The line the ghost opens on, as `{ text, greeting }`. A reply from the last
// few minutes is a conversation being picked back up, so it comes back verbatim
// and `greeting` is false; anything older — or nothing at all — gets a greeting,
// because a stale reply shown without its question reads as the ghost answering
// an empty room. Skins use the flag to tell theatre from transcript: the desktop
// bubble shows one line either way, while the possessed sheet appends a greeting
// as a row the thread never had (and never sends).
export function ghostOpeningLine(rows) {
    const entry = lastGhostReply(rows);
    if (entry && isGhostReplyWarm(entry.createdAt)) return { text: entry.text, greeting: false };
    return { text: pickGhostGreeting(), greeting: true };
}

// Blinking dots while a reply is in flight, written into `host`. Under reduced
// motion the same state renders as a static ellipsis — same shape, no animation.
// Both surfaces share the dot element so one stylesheet rule drives both.
export function renderGhostPending(host) {
    if (!host) return;
    if (prefersReducedMotion()) {
        host.textContent = GHOST_QUIET;
        return;
    }
    host.textContent = '';
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'ghostTalkDot';
        host.appendChild(dot);
    }
}

function rowRole(row) {
    const role = typeof row === 'string' ? '' : (row.role || row.author || '');
    // An unlabelled row is the ghost's — the route has always sent bare replies
    // that way, and the user's own turns are the ones that carry a role.
    return !role || role === 'ghost' || role === 'assistant' ? 'ghost' : 'user';
}

function readText(row) {
    if (!row) return '';
    if (typeof row === 'string') return row;
    if (typeof row.reply   === 'string') return row.reply;
    if (typeof row.content === 'string') return row.content;
    if (typeof row.message === 'string') return row.message;
    if (typeof row.text    === 'string') return row.text;
    return '';
}

function readTime(row) {
    if (!row || typeof row === 'string') return null;
    if (row.created_at != null) return row.created_at;
    if (row.createdAt  != null) return row.createdAt;
    return null;
}

function parseTime(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value === 'string' && value) {
        const t = Date.parse(value);
        if (!isNaN(t)) return t;
    }
    return null;
}

// ── DESKTOP SKIN ──

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

const SURFACE = 'desktop';

let bubbleEl = null;
let textEl   = null;
let tailEl   = null;
let inputEl  = null;
let closeId  = null;
// The freeze/position controls of the wandering sprite that opened the surface.
let mountApi = null;
let unsubscribe = null;
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
// True from open until the bubble has said anything the user asked for. The
// opening line is slower than the user is: without this, a readback landing
// after the first Enter would paint over the pending dots.
let openingPending = false;

// Subscribe once to sprite activation. Safe to call repeatedly; a no-op on
// viewports where the companion never runs, so this mount contributes nothing
// on mobile (where the perch opens the possessed sheet instead).
export function ensureGhostTalk() {
    if (unsubscribe) return true;
    if (!supportsDesktopCompanion()) return false;
    unsubscribe = onCompanionActivate(openGhostTalk);
    return true;
}

// Open the talk surface against a frozen ghost. `api` is the narrow surface
// companion.js hands to activation subscribers (getPosition + freeze / resume /
// setTalkOpen).
export function openGhostTalk(api) {
    if (!supportsDesktopCompanion()) return null;
    const pos = api && typeof api.getPosition === 'function' ? api.getPosition() : null;
    if (!pos) return null;

    // A second tap on the ghost while the bubble is up just re-docks it
    // rather than stacking a second surface.
    teardown();
    mountApi = api || null;
    session++;
    const mySession = session;
    // Hold the freeze until the surface closes — without this the ghost walks
    // out from under its own bubble the moment the pointer leaves the sprite.
    if (mountApi && typeof mountApi.setTalkOpen === 'function') mountApi.setTalkOpen(true);
    if (mountApi && typeof mountApi.freeze === 'function') mountApi.freeze();

    mount();
    position(pos);
    reveal();
    if (inputEl && typeof inputEl.focus === 'function') inputEl.focus();

    // Non-blocking: the bubble opens quiet and fills in with either a greeting
    // or the tail of a conversation still in progress.
    say(GHOST_QUIET);
    openingPending = true;
    loadOpeningLine(mySession);

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

    // The surface modifier is what the mobile-viewport hide rule keys off.
    const surfaceClass = 'ghostTalkSurface--' + SURFACE;

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
    inputEl.placeholder = GHOST_PLACEHOLDER;
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
    // a touchscreen emits after the tap, so a tap-away dismisses the moment the
    // finger lands rather than reading as a dead first tap.
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

function sayPending() {
    if (!textEl || !bubbleEl) return;
    bubbleEl.classList.add('ghostTalkBubble--pending');
    renderGhostPending(textEl);
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
    // The bubble now belongs to this exchange; a readback still in flight
    // stays out of it.
    openingPending = false;
    // No pending state where there is no wire — the answer is already known,
    // and dots that never resolve into anything read as a hang.
    if (isGhostWireReady()) sayPending();
    askGhost(message, SURFACE).then(function (text) {
        if (mySession !== session) return;
        say(text);
    });
}

// The opening line, decided by the readback: a ghost reply from the last few
// minutes comes back verbatim, anything older — or nothing at all — greets.
function loadOpeningLine(mySession) {
    fetchGhostHistory().then(function (rows) {
        sayOpening(mySession, ghostOpeningLine(rows).text);
    });
}

// Paint the opening line, but only into a bubble nobody has spoken to yet —
// a reply the user actually asked for outranks a late readback.
function sayOpening(mySession, text) {
    if (mySession !== session || !openingPending || !text) return;
    openingPending = false;
    say(text);
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
    // A tap on the ghost belongs to the sprite, which re-opens (re-docks) the
    // surface itself — closing here would fight it.
    if (typeof t.closest === 'function' && t.closest('.companionHit')) return;
    closeGhostTalk();
}

// Test seam — drops the surface and the subscription without touching the
// companion, so each case starts from a known-empty module state.
export function resetGhostTalk() {
    session++;
    teardown();
    mountApi = null;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}
