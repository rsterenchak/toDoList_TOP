// Mobile ghost talk — one big speech bubble, as a modal.
//
// The desktop skin (ghostTalk.js) floats a small bubble and a whisper input at
// pixel coordinates beside the wandering sprite. On a phone that lands on top of
// the TODO.md pill, the list rows and the assistant FAB, so the perch wears this
// skin instead: a scrim over the app and one large bubble anchored just above
// the perched ghost, with the conversation inside it.
//
// Three things fall out of being a bottom-anchored CSS box rather than a
// JS-positioned one. It never needs measuring or reflowing, so nothing here
// watches element sizes. It rides the software keyboard for free in the cured
// visual viewport, which is why the desktop skin's viewport-docking listeners
// are gone rather than reused. And the perch itself stays visible above the
// scrim — the tail points down at it, and the `is-still` state the talk
// handshake already sets is what lifts it over the dim.
//
// The plumbing under the skin is shared with desktop and lives in ghostTalk.js:
// the two Worker calls, the recency-gated opening line, the in-voice error
// lines, and the pending render. Nothing in this file talks to the Worker.
//
// The greeting is the one thing on screen that is not transcript. When the last
// exchange is stale the opening line renders as the newest ghost row —
// deliberately indistinguishable from a real one — but it is never persisted and
// never rides a payload, so the next hydrate simply doesn't contain it.

import { prefersReducedMotion } from './companion.js';
import {
    GHOST_PLACEHOLDER,
    askGhost,
    fetchGhostHistory,
    ghostOpeningLine,
    isGhostWireReady,
    renderGhostPending,
    supportsMobileGhostTalk,
} from './ghostTalk.js';

// How much of the transcript the thread carries. Deep enough that reopening
// shows the conversation rather than a fragment, shallow enough that the hydrate
// stays one screen of DOM.
const THREAD_LIMIT = 20;
const FADE_MS = 200;
const SURFACE = 'mobile';

let scrimEl  = null;
let modalEl  = null;
let threadEl = null;
let inputEl  = null;
let closeId  = null;
// The perch's freeze controls, held for the life of the modal so the ghost is
// still while it is being spoken to.
let mountApi = null;
// Bumped on every open and close. In-flight work captures it and bails when it
// no longer matches, so a reply landing after a dismissal — or after a second
// open — can never paint into a thread that has moved on.
let session = 0;

// Open the modal against the perch. `api` carries the same freeze controls the
// desktop skin takes (freeze / resume / setTalkOpen); the perch has nowhere to
// wander, so those only still its bob and lift it above the scrim.
export function openGhostModal(api) {
    if (!supportsMobileGhostTalk()) return null;

    // A second tap while the modal is up re-opens it rather than stacking two.
    teardown();
    mountApi = api || null;
    session++;
    const mySession = session;
    if (mountApi && typeof mountApi.setTalkOpen === 'function') mountApi.setTalkOpen(true);
    if (mountApi && typeof mountApi.freeze === 'function') mountApi.freeze();

    mount();
    reveal();
    if (inputEl && typeof inputEl.focus === 'function') inputEl.focus();

    // Non-blocking: the bubble opens empty and fills in with the tail of the
    // transcript, then either its last line or a greeting.
    hydrate(mySession);

    return { close: closeGhostModal };
}

export function closeGhostModal() {
    if (!modalEl && !scrimEl) return;
    const api = mountApi;
    session++;
    fadeOutAndTeardown();
    // Release in the order the open took it: the modal stops claiming the
    // ghost, then the perch's idle bob is re-armed.
    if (api && typeof api.setTalkOpen === 'function') api.setTalkOpen(false);
    if (api && typeof api.resume === 'function') api.resume();
    mountApi = null;
}

export function isGhostModalOpen() {
    return !!modalEl;
}

// ── DOM ──

function mount() {
    const doc = document;

    scrimEl = doc.createElement('div');
    scrimEl.id = 'ghostModalScrim';
    scrimEl.className = 'ghostModalScrim';
    // The dim is decoration; the dialog below carries the accessible name.
    scrimEl.setAttribute('aria-hidden', 'true');

    modalEl = doc.createElement('div');
    modalEl.id = 'ghostModal';
    modalEl.className = 'ghostModal';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-label', 'Talk to the ghost');

    threadEl = doc.createElement('div');
    threadEl.className = 'ghostModalThread';
    // Replies arrive asynchronously, so the thread announces its own additions.
    threadEl.setAttribute('role', 'log');
    threadEl.setAttribute('aria-live', 'polite');
    modalEl.appendChild(threadEl);

    const foot = doc.createElement('div');
    foot.className = 'ghostModalFoot';
    inputEl = doc.createElement('input');
    inputEl.id = 'ghostModalInput';
    inputEl.className = 'ghostModalInput';
    inputEl.type = 'text';
    inputEl.placeholder = GHOST_PLACEHOLDER;
    inputEl.setAttribute('aria-label', 'Ask the ghost');
    foot.appendChild(inputEl);
    modalEl.appendChild(foot);

    // The tail sits outside the padded content so it can straddle the border.
    const tail = doc.createElement('span');
    tail.className = 'ghostModalTail';
    tail.setAttribute('aria-hidden', 'true');
    modalEl.appendChild(tail);

    if (prefersReducedMotion()) {
        // Fade instead of pop — the scale-in is the part that reads as motion.
        modalEl.classList.add('ghostModal--calm');
    }

    doc.body.appendChild(scrimEl);
    doc.body.appendChild(modalEl);

    inputEl.addEventListener('keydown', onInputKeydown);
    // Touch alongside click: on the scrim the dim has to lift the moment the
    // finger lands, or a tap-away while the keyboard is up reads as a dead tap.
    scrimEl.addEventListener('click', onScrimTap);
    scrimEl.addEventListener('touchstart', onScrimTap);
    doc.addEventListener('keydown', onDocKeydown, true);
}

function teardown() {
    if (closeId) { clearTimeout(closeId); closeId = null; }
    detachListeners();
    if (scrimEl && scrimEl.parentNode) scrimEl.parentNode.removeChild(scrimEl);
    if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    scrimEl  = null;
    modalEl  = null;
    threadEl = null;
    inputEl  = null;
}

function detachListeners() {
    document.removeEventListener('keydown', onDocKeydown, true);
    if (inputEl) inputEl.removeEventListener('keydown', onInputKeydown);
    if (scrimEl) {
        scrimEl.removeEventListener('click', onScrimTap);
        scrimEl.removeEventListener('touchstart', onScrimTap);
    }
}

function fadeOutAndTeardown() {
    const scrim = scrimEl;
    const modal = modalEl;
    const input = inputEl;
    if (scrim) scrim.classList.add('is-closing');
    if (modal) modal.classList.add('is-closing');
    // Detach now so a keystroke during the fade can't queue work against a
    // surface that is on its way out.
    detachListeners();
    // Dismissing mid-typing has to drop the keyboard with the modal. The input
    // is detached a frame later anyway, but iOS only retracts the keyboard if
    // the focus is released explicitly first.
    if (input && typeof input.blur === 'function') input.blur();
    scrimEl  = null;
    modalEl  = null;
    threadEl = null;
    inputEl  = null;
    if (closeId) clearTimeout(closeId);
    closeId = setTimeout(function () {
        closeId = null;
        if (scrim && scrim.parentNode) scrim.parentNode.removeChild(scrim);
        if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    }, FADE_MS);
}

// Flip both elements to their open state. Reading offsetHeight first flushes
// pending style so the transition runs from the closed state instead of the
// browser collapsing both frames into one.
function reveal() {
    if (scrimEl) { void scrimEl.offsetHeight; scrimEl.classList.add('is-open'); }
    if (modalEl) { void modalEl.offsetHeight; modalEl.classList.add('is-open'); }
}

// ── THREAD ──

// The newest rows, oldest-to-newest, then the opening line. A warm conversation
// already ends on the ghost's last reply, so only a stale one adds a row — the
// greeting, which exists here and nowhere else.
function hydrate(mySession) {
    fetchGhostHistory().then(function (rows) {
        if (mySession !== session || !threadEl) return;
        const recent = rows.slice(-THREAD_LIMIT);
        for (let i = 0; i < recent.length; i++) appendRow(recent[i].role, recent[i].text);
        const opening = ghostOpeningLine(rows);
        if (opening.greeting) appendRow('ghost', opening.text);
        scrollToBottom();
    });
}

function appendRow(role, text) {
    if (!threadEl) return null;
    const row = document.createElement('div');
    row.className = 'ghostModalRow ghostModalRow--' + (role === 'user' ? 'user' : 'ghost');
    row.textContent = text;
    threadEl.appendChild(row);
    return row;
}

function scrollToBottom() {
    if (!threadEl) return;
    threadEl.scrollTop = threadEl.scrollHeight;
}

// ── ASKING ──

function onInputKeydown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const message = (inputEl && inputEl.value ? inputEl.value : '').trim();
    if (!message) return;
    inputEl.value = '';
    send(message);
}

// Optimistic: the user's turn and a pending ghost row go up immediately, and
// the reply swaps into the row that was already holding its place. Both turns
// land in `ghost_messages` server-side, so the next hydrate agrees with what
// was shown here.
function send(message) {
    const mySession = session;
    appendRow('user', message);
    const pendingRow = appendRow('ghost', '');
    // No dots where there is no wire — the answer is already known, and dots
    // that never resolve into anything read as a hang.
    if (pendingRow && isGhostWireReady()) {
        pendingRow.classList.add('ghostModalRow--pending');
        renderGhostPending(pendingRow);
    }
    scrollToBottom();

    askGhost(message, SURFACE).then(function (text) {
        if (mySession !== session || !pendingRow) return;
        pendingRow.classList.remove('ghostModalRow--pending');
        pendingRow.textContent = text;
        scrollToBottom();
    });
}

// ── DISMISSAL ──

function onDocKeydown(e) {
    if (e.key === 'Escape') closeGhostModal();
}

function onScrimTap() {
    closeGhostModal();
}

// Test seam — drops the modal without touching the perch, so each case starts
// from a known-empty module state.
export function resetGhostModal() {
    session++;
    teardown();
    mountApi = null;
}
