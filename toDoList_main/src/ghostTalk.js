// Desktop ghost talk surface — tap-to-talk for the wandering companion.
//
// Clicking the sprite freezes it and mounts two elements docked to the frozen
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
// Mounting rides the companion: the module subscribes to the sprite's
// activation event, which only ever fires from a mounted sprite, and the
// desktop gate is re-checked here so nothing is created on mobile.

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
let spriteApi = null;
let unsubscribe = null;
// Bumped on every open and close. Async work captures it and bails when it no
// longer matches, so a slow history readback can never overwrite a reply the
// user has already asked for — or paint into a torn-down bubble.
let session = 0;

// Subscribe once to sprite activation. Safe to call repeatedly; a no-op on
// viewports where the companion never runs, so mobile gets zero presence.
export function ensureGhostTalk() {
    if (unsubscribe) return true;
    if (!supportsDesktopCompanion()) return false;
    unsubscribe = onCompanionActivate(openGhostTalk);
    return true;
}

// Open the talk surface against a frozen sprite. `api` is the narrow surface
// companion.js hands to activation subscribers: getPosition + freeze controls.
export function openGhostTalk(api) {
    if (!supportsDesktopCompanion()) return null;
    if (!api || typeof api.getPosition !== 'function') return null;
    const pos = api.getPosition();
    if (!pos) return null;

    // A second click on the ghost while the bubble is up just re-docks it
    // rather than stacking a second surface.
    teardown();
    spriteApi = api;
    session++;
    const mySession = session;
    // Hold the freeze until the surface closes — without this the ghost walks
    // out from under its own bubble the moment the pointer leaves the sprite.
    if (typeof api.setTalkOpen === 'function') api.setTalkOpen(true);
    if (typeof api.freeze === 'function') api.freeze();

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
    const api = spriteApi;
    session++;
    fadeOutAndTeardown();
    // Release in the same order the open took it: the surface stops claiming
    // the sprite, then the wander is re-armed from the frozen position.
    if (api && typeof api.setTalkOpen === 'function') api.setTalkOpen(false);
    if (api && typeof api.resume === 'function') api.resume();
    spriteApi = null;
}

// ── DOM ──

function mount() {
    const doc = document;

    bubbleEl = doc.createElement('div');
    bubbleEl.id = 'ghostTalkBubble';
    bubbleEl.className = 'ghostTalkBubble ghostTalkSurface';
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
    inputEl.className = 'ghostTalkInput ghostTalkSurface';
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
    doc.addEventListener('mousedown', onDocMouseDown, true);
}

function teardown() {
    if (closeId) { clearTimeout(closeId); closeId = null; }
    document.removeEventListener('keydown', onDocKeydown, true);
    document.removeEventListener('mousedown', onDocMouseDown, true);
    if (inputEl) {
        inputEl.removeEventListener('keydown', onInputKeydown);
        if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
    }
    if (bubbleEl && bubbleEl.parentNode) bubbleEl.parentNode.removeChild(bubbleEl);
    bubbleEl = null;
    textEl   = null;
    tailEl   = null;
    inputEl  = null;
}

function fadeOutAndTeardown() {
    const bubble = bubbleEl;
    const input  = inputEl;
    if (bubble) bubble.classList.add('is-closing');
    if (input)  input.classList.add('is-closing');
    // Detach listeners now so a keystroke during the fade can't reopen work
    // against a surface that is on its way out.
    if (input) input.removeEventListener('keydown', onInputKeydown);
    document.removeEventListener('keydown', onDocKeydown, true);
    document.removeEventListener('mousedown', onDocMouseDown, true);
    bubbleEl = null;
    textEl   = null;
    tailEl   = null;
    inputEl  = null;
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

// Dock the bubble above the sprite and the input beside it, clamped so an
// edge-wandered ghost never pushes either element off-screen.
function position(pos) {
    if (!bubbleEl || !inputEl) return;
    const vw = window.innerWidth  || 1024;
    const vh = window.innerHeight || 768;
    const centreX = pos.x + pos.width / 2;

    const bw = bubbleEl.offsetWidth  || BUBBLE_W;
    const bh = bubbleEl.offsetHeight || BUBBLE_H;
    const bx = clamp(centreX - bw / 2, EDGE, vw - EDGE - bw);
    const by = clamp(pos.y - GAP - bh, EDGE, vh - EDGE - bh);
    bubbleEl.style.left = Math.round(bx) + 'px';
    bubbleEl.style.top  = Math.round(by) + 'px';

    // The tail tracks the sprite rather than the bubble's centre, so a bubble
    // clamped against a viewport edge still points back at the ghost.
    if (tailEl) {
        const tailX = clamp(centreX - bx, TAIL_INSET, Math.max(TAIL_INSET, bw - TAIL_INSET));
        tailEl.style.left = Math.round(tailX) + 'px';
    }

    const iw = inputEl.offsetWidth  || INPUT_W;
    const ih = inputEl.offsetHeight || INPUT_H;
    // Prefer the right of the sprite; flip to its left when that would run
    // past the edge.
    let ix = pos.x + pos.width + GAP;
    if (ix + iw > vw - EDGE) ix = pos.x - GAP - iw;
    inputEl.style.left = Math.round(clamp(ix, EDGE, vw - EDGE - iw)) + 'px';
    inputEl.style.top  = Math.round(clamp(pos.y + pos.height / 2 - ih / 2, EDGE, vh - EDGE - ih)) + 'px';
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
}

// Blinking dots while a reply is in flight. Under reduced motion the same
// state renders as a static ellipsis — same shape, no animation.
function sayPending() {
    if (!textEl || !bubbleEl) return;
    bubbleEl.classList.add('ghostTalkBubble--pending');
    if (prefersReducedMotion()) {
        textEl.textContent = QUIET;
        return;
    }
    textEl.textContent = '';
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement('span');
        dot.className = 'ghostTalkDot';
        textEl.appendChild(dot);
    }
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
    postToWorker({ ghost: true, message: message, surface: 'desktop' })
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

function onDocMouseDown(e) {
    const t = e.target;
    if (!t) { closeGhostTalk(); return; }
    if (bubbleEl && bubbleEl.contains(t)) return;
    if (inputEl && (inputEl === t || inputEl.contains(t))) return;
    // Clicks on the sprite's hit target belong to the companion — it re-opens
    // (re-docks) the surface itself, so closing here would fight it.
    if (typeof t.closest === 'function' && t.closest('.companionHit')) return;
    closeGhostTalk();
}

// Test seam — drops the surface and the subscription without touching the
// companion, so each case starts from a known-empty module state.
export function resetGhostTalk() {
    session++;
    teardown();
    spriteApi = null;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}
