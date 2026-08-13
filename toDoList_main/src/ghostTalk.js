// Ghost talk — the plumbing the ghost speaks through, and nothing else.
//
// This module owns no surface. The possessed Claude sheet is the ghost's whole
// presence now, on every viewport: the chip flips it on a phone, clicking the
// wandering companion flips it on desktop, and both land in the same possessed
// pane (see the POSSESSION section of the Claude sheet module). What lives here
// is what any such surface needs and must never fork — the two Worker calls,
// the recency-gated opening line, the in-voice error strings and the pending
// render. None of it touches the Worker directly; every call goes through
// inject.js, the one Worker caller.
//
// Two things are deliberate. First, the transcript is server-side: it lives in
// `ghost_messages` and is read back rather than cached here, so a surface asks
// for the last thing the ghost said and shows it only while the exchange is
// still warm. Past that window a replayed answer reads as an answer without its
// question, so the ghost greets instead — and the greeting is theatre, never
// posted and never persisted.
// Second, every failure speaks in the ghost's own voice: there is no toast, no
// assistant-tone error copy, and nothing throws out of a caller's handler.
// Technical detail goes to console.warn where a developer can find it and the
// user never sees it.
//
// Callers name their own surface on the Worker payload ('mobile' / 'desktop'),
// so the transcript records where an exchange happened without this module
// having to know which one is on screen.

import { postToWorker, isInjectConfigured } from './inject.js';
import { prefersReducedMotion } from './companion.js';

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

// Whether there is a Worker to talk to at all. Surfaces read this to decide
// whether a pending state is worth showing before the answer comes back.
export function isGhostWireReady() {
    return isInjectConfigured();
}

// Post one question and resolve with the line the ghost says back — the reply
// when the wire holds, an in-voice failure line when it doesn't. NEVER rejects:
// the caller paints whatever comes back straight into its thread, and a throw
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
    // Clamped rather than trusted: a Math.random() of exactly 1 would index off
    // the end of the set and hand a caller `undefined` to render.
    return GHOST_GREETINGS[Math.max(0, Math.min(GHOST_GREETINGS.length - 1, i))];
}

// The line the ghost opens on, as `{ text, greeting }`. A reply from the last
// few minutes is a conversation being picked back up, so it comes back verbatim
// and `greeting` is false; anything older — or nothing at all — gets a greeting,
// because a stale reply shown without its question reads as the ghost answering
// an empty room. The flag tells theatre from transcript: the possessed sheet
// appends a greeting as a row the thread never had (and never sends), while a
// replayed reply is a real one that is already in `ghost_messages`.
export function ghostOpeningLine(rows) {
    const entry = lastGhostReply(rows);
    if (entry && isGhostReplyWarm(entry.createdAt)) return { text: entry.text, greeting: false };
    return { text: pickGhostGreeting(), greeting: true };
}

// Blinking dots while a reply is in flight, written into `host`. Under reduced
// motion the same state renders as a static ellipsis — same shape, no animation.
// The dot element lives here so one stylesheet rule drives every surface that
// shows a pending whisper.
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
