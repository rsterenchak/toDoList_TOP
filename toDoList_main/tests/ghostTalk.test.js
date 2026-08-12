import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Tap-to-talk for the desktop ghost: clicking the sprite freezes it and docks
// a speech bubble + ask input to the frozen position, wired to the Worker's
// `ghost` route.
//
// The load-bearing contracts pinned here are the ones a later edit could break
// without looking broken: the freeze handshake (open takes it, dismiss gives it
// back), the exact payload shape the Worker route expects, and the in-voice
// error strings — the whole point of the feature is that a dead Worker still
// answers in character rather than throwing or raising a toast.
//
// inject.js is mocked so every Worker call can be scripted (or deferred) with
// no network and no configured Worker.

const { state } = vi.hoisted(() => ({
    state: {
        configured: true,
        calls: [],
        // When set, Worker calls resolve only once the test releases them.
        defer: false,
        pending: [],
        // Canned resolution for non-deferred calls, per kind.
        historyResult: null,
        historyRejects: null,
        askResult: { reply: 'boo' },
        askRejects: null,
    },
}));

vi.mock('../src/inject.js', () => ({
    isInjectConfigured: vi.fn(() => state.configured),
    postToWorker: vi.fn(function (payload) {
        state.calls.push(payload);
        const isHistory = !!(payload && payload.history);
        const rejection = isHistory ? state.historyRejects : state.askRejects;
        if (rejection) return Promise.reject(rejection);
        const result = isHistory ? state.historyResult : state.askResult;
        if (!state.defer) return Promise.resolve(result);
        return new Promise(function (resolve, reject) {
            state.pending.push(function () {
                if (rejection) reject(rejection);
                else resolve(result);
            });
        });
    }),
}));

import { createCompanion } from '../src/companion.js';
import {
    ensureGhostTalk,
    openGhostTalk,
    closeGhostTalk,
    resetGhostTalk,
    computeTalkLayout,
    GHOST_GREETINGS,
    GHOST_CONTINUATION_MS,
} from '../src/ghostTalk.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

// jsdom's matchMedia answers `matches: false` to everything, which would bar
// the desktop gate. `desktop` decides whether the min-width/pointer query
// passes; reduced-motion always answers false unless a test asks otherwise.
function stubMatchMedia({ desktop = true, reducedMotion = false } = {}) {
    window.matchMedia = (query) => ({
        matches: /prefers-reduced-motion/.test(query) ? reducedMotion : desktop,
        media: query,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
    });
}

let companion = null;

function mountCompanion() {
    localStorage.setItem('todoapp_companion_enabled', 'true');
    companion = createCompanion(document);
    ensureGhostTalk();
    return companion;
}

function hit() {
    return document.getElementById('companionHit');
}
function bubble() {
    return document.getElementById('ghostTalkBubble');
}
function bubbleText() {
    const b = bubble();
    const t = b && b.querySelector('.ghostTalkText');
    return t ? t.textContent : null;
}
function input() {
    return document.getElementById('ghostTalkInput');
}
function pressEnter(el) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}
// Transcript timestamps in the shape the Worker sends them (ISO strings).
function minutesAgo(m) {
    return new Date(Date.now() - m * 60 * 1000).toISOString();
}

beforeEach(() => {
    state.configured = true;
    state.calls = [];
    state.defer = false;
    state.pending = [];
    state.historyResult = null;
    state.historyRejects = null;
    state.askResult = { reply: 'boo' };
    state.askRejects = null;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubMatchMedia();
});

afterEach(() => {
    resetGhostTalk();
    if (companion) { companion.destroy(); companion = null; }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('ghost talk — opening from the sprite', () => {
    it('mounts a hit target alongside the sprite so the ghost itself stays click-through', () => {
        mountCompanion();
        expect(document.getElementById('companion')).not.toBeNull();
        expect(hit()).not.toBeNull();
    });

    it('clicking the ghost mounts the bubble and the ask input and engages the freeze', () => {
        mountCompanion();
        expect(companion.isFrozen()).toBe(false);

        hit().click();

        expect(bubble()).not.toBeNull();
        expect(input()).not.toBeNull();
        expect(input().placeholder).toBe('whisper something…');
        expect(companion.isFrozen()).toBe(true);
    });

    it('holds the freeze through mouseleave while the talk surface is open', () => {
        mountCompanion();
        hit().click();
        expect(companion.isFrozen()).toBe(true);

        // Leaving the sprite normally resumes the wander — but not while the
        // ghost is mid-conversation, or it would walk out from under its bubble.
        hit().dispatchEvent(new MouseEvent('mouseleave'));
        expect(companion.isFrozen()).toBe(true);
    });

    it('hovering off the sprite with no talk surface open resumes the wander', () => {
        mountCompanion();
        hit().dispatchEvent(new MouseEvent('mouseenter'));
        expect(companion.isFrozen()).toBe(true);
        hit().dispatchEvent(new MouseEvent('mouseleave'));
        expect(companion.isFrozen()).toBe(false);
    });

    it('opens quiet and fills in the ghost\'s last line from the history readback', async () => {
        state.historyResult = {
            messages: [
                { role: 'user',  content: 'are you there' },
                { role: 'ghost', content: 'still here. always.', created_at: minutesAgo(3) },
            ],
        };
        mountCompanion();
        hit().click();

        // Quiet on the very first frame — the readback has not landed yet.
        expect(bubbleText()).toBe('…');
        const historyCall = state.calls.find((c) => c && c.history);
        expect(historyCall).toEqual({ ghost: true, history: true });

        await flush();
        expect(bubbleText()).toBe('still here. always.');
    });

    it('greets instead of staying quiet when the transcript has no ghost line yet', async () => {
        state.historyResult = { messages: [] };
        mountCompanion();
        hit().click();
        await flush();
        expect(GHOST_GREETINGS).toContain(bubbleText());
    });
});

// The bubble's first line is a recency question, not a replay: a reply from
// minutes ago is a conversation still going, while one from hours ago is an
// answer with no question in sight. The greeting is theatre — it exists only
// in the bubble and must never reach the transcript.
describe('ghost talk — the opening line', () => {
    it('replays the last reply when the exchange is still warm', async () => {
        state.historyResult = {
            messages: [{ role: 'ghost', content: 'i was mid-sentence', created_at: minutesAgo(3) }],
        };
        mountCompanion();
        hit().click();
        await flush();

        expect(bubbleText()).toBe('i was mid-sentence');
    });

    it('greets rather than replaying a reply from hours ago', async () => {
        state.historyResult = {
            messages: [{ role: 'ghost', content: 'that was a long time ago', created_at: minutesAgo(180) }],
        };
        mountCompanion();
        hit().click();
        await flush();

        expect(bubbleText()).not.toBe('that was a long time ago');
        expect(GHOST_GREETINGS).toContain(bubbleText());
    });

    it('holds the reply right up to the continuation window and greets just past it', async () => {
        // Re-tapping the ghost re-docks the same surface, so each pass opens
        // fresh without a fading duplicate left in the document.
        const at = async (ms) => {
            state.historyResult = {
                messages: [{ role: 'ghost', content: 'on the edge', created_at: new Date(Date.now() - ms).toISOString() }],
            };
            hit().click();
            await flush();
            return bubbleText();
        };
        mountCompanion();

        expect(await at(GHOST_CONTINUATION_MS - 60 * 1000)).toBe('on the edge');
        expect(GHOST_GREETINGS).toContain(await at(GHOST_CONTINUATION_MS + 60 * 1000));
    });

    it('greets when the last reply carries no timestamp at all', async () => {
        state.historyResult = { messages: [{ role: 'ghost', content: 'undated and unmoored' }] };
        mountCompanion();
        hit().click();
        await flush();

        expect(GHOST_GREETINGS).toContain(bubbleText());
    });

    it('greets when the readback fails, and never shows an error', async () => {
        state.historyRejects = new Error('wire cut');
        mountCompanion();
        hit().click();
        await flush();

        expect(GHOST_GREETINGS).toContain(bubbleText());
        expect(document.getElementById('injectToast')).toBeNull();
    });

    it('greets with no Worker configured, without posting anything', async () => {
        state.configured = false;
        mountCompanion();
        hit().click();
        await flush();

        expect(GHOST_GREETINGS).toContain(bubbleText());
        expect(state.calls.length).toBe(0);
    });

    it('draws only from the greeting set, across the whole random range', async () => {
        const seen = new Set();
        state.historyResult = { messages: [] };
        mountCompanion();

        for (const r of [0, 0.2, 0.45, 0.79, 0.999999]) {
            vi.spyOn(Math, 'random').mockReturnValue(r);
            hit().click();
            await flush();
            const line = bubbleText();
            expect(GHOST_GREETINGS).toContain(line);
            seen.add(line);
        }
        // Every slot of the array is reachable, so no greeting is dead copy.
        expect(seen.size).toBe(GHOST_GREETINGS.length);
    });

    it('keeps the greeting out of the transcript and off every Worker payload', async () => {
        state.historyResult = { messages: [] };
        mountCompanion();
        hit().click();
        await flush();

        const greeting = bubbleText();
        expect(GHOST_GREETINGS).toContain(greeting);

        input().value = 'what were we saying';
        pressEnter(input());
        await flush();

        // The ask goes out as the user typed it, and nothing the client
        // invented rides along in any field of any call.
        const ask = state.calls.find((c) => c && c.message);
        expect(ask).toEqual({ ghost: true, message: 'what were we saying', surface: 'desktop' });
        const wire = JSON.stringify(state.calls);
        GHOST_GREETINGS.forEach((line) => expect(wire).not.toContain(line));
        expect(bubbleText()).toBe('boo');
    });

    it('lets a reply the user asked for outrank a readback still in flight', async () => {
        state.defer = true;
        state.historyResult = { messages: [{ role: 'ghost', content: 'stale news', created_at: minutesAgo(1) }] };
        mountCompanion();
        hit().click();

        input().value = 'never mind that';
        pressEnter(input());
        // History resolves first, then the reply — the bubble must end on the
        // reply, not on a line the readback painted over the pending dots.
        state.pending.forEach((release) => release());
        await flush();

        expect(bubbleText()).toBe('boo');
    });
});

describe('ghost talk — asking', () => {
    it('posts the exact { ghost, message, surface } payload on Enter', async () => {
        mountCompanion();
        hit().click();
        input().value = 'what is it like over there';
        pressEnter(input());
        await flush();

        const ask = state.calls.find((c) => c && c.message);
        expect(ask).toEqual({
            ghost: true,
            message: 'what is it like over there',
            surface: 'desktop',
        });
    });

    it('shows blinking dots while the reply is in flight, then swaps in the reply', async () => {
        state.defer = true;
        state.askResult = { reply: 'cold. quiet. fine.' };
        mountCompanion();
        hit().click();
        input().value = 'how is it';
        pressEnter(input());

        expect(bubble().classList.contains('ghostTalkBubble--pending')).toBe(true);
        expect(bubble().querySelectorAll('.ghostTalkDot').length).toBe(3);

        state.pending.forEach((release) => release());
        await flush();

        expect(bubbleText()).toBe('cold. quiet. fine.');
        expect(bubble().classList.contains('ghostTalkBubble--pending')).toBe(false);
    });

    it('clears the input on send so the next question starts empty', async () => {
        mountCompanion();
        hit().click();
        input().value = 'hello';
        pressEnter(input());
        expect(input().value).toBe('');
        await flush();
    });

    it('ignores Enter on an empty input', async () => {
        mountCompanion();
        hit().click();
        input().value = '   ';
        pressEnter(input());
        await flush();
        expect(state.calls.some((c) => c && c.message)).toBe(false);
    });
});

describe('ghost talk — failures speak in the ghost\'s voice', () => {
    it('answers "the wire\'s dead" in the bubble when the worker is unreachable', async () => {
        state.askRejects = Object.assign(new Error('Network error'), { network: true });
        mountCompanion();
        hit().click();
        input().value = 'anyone there';
        pressEnter(input());
        await flush();

        expect(bubbleText()).toBe("the wire's dead. try again later.");
    });

    it('answers "the wire\'s dead" on a non-ok worker response', async () => {
        state.askRejects = Object.assign(new Error('HTTP 500'), { status: 500 });
        mountCompanion();
        hit().click();
        input().value = 'anyone there';
        pressEnter(input());
        await flush();

        expect(bubbleText()).toBe("the wire's dead. try again later.");
    });

    it('answers "no wire to the other side yet" when inject is unconfigured, and never posts', async () => {
        state.configured = false;
        mountCompanion();
        hit().click();
        input().value = 'hello?';
        pressEnter(input());
        await flush();

        expect(bubbleText()).toBe('no wire to the other side yet.');
        // Neither the ask nor the greeting readback goes out unconfigured.
        expect(state.calls.length).toBe(0);
        // The technical detail lands on the console, not on the user.
        expect(console.warn).toHaveBeenCalled();
    });

    it('raises no toast on any failure path', async () => {
        state.askRejects = new Error('boom');
        mountCompanion();
        hit().click();
        input().value = 'x';
        pressEnter(input());
        await flush();
        expect(document.getElementById('injectToast')).toBeNull();
    });
});

describe('ghost talk — dismissal', () => {
    it('Escape fades the surface out and releases the freeze', async () => {
        mountCompanion();
        hit().click();
        expect(companion.isFrozen()).toBe(true);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(companion.isFrozen()).toBe(false);
        expect(bubble().classList.contains('is-closing')).toBe(true);

        await new Promise((r) => setTimeout(r, 260));
        expect(bubble()).toBeNull();
        expect(input()).toBeNull();
    });

    it('a click away closes the surface and releases the freeze', () => {
        mountCompanion();
        hit().click();
        const outside = document.createElement('div');
        document.body.appendChild(outside);

        outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(companion.isFrozen()).toBe(false);
        expect(bubble().classList.contains('is-closing')).toBe(true);
    });

    it('a click inside the bubble or the input keeps the surface open', () => {
        mountCompanion();
        hit().click();
        bubble().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(bubble().classList.contains('is-closing')).toBe(false);
        input().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(bubble().classList.contains('is-closing')).toBe(false);
        expect(companion.isFrozen()).toBe(true);
    });

    it('resumes the wander from the frozen position rather than teleporting', () => {
        mountCompanion();
        const before = companion.getPosition();
        hit().click();
        closeGhostTalk();
        const after = companion.getPosition();
        expect(after.x).toBe(before.x);
        expect(after.y).toBe(before.y);
        expect(companion.isFrozen()).toBe(false);
    });
});

describe('ghost talk — reduced motion', () => {
    it('renders a static ellipsis instead of animated dots while pending', async () => {
        stubMatchMedia({ desktop: true, reducedMotion: true });
        state.defer = true;
        mountCompanion();
        hit().click();
        input().value = 'quietly now';
        pressEnter(input());

        expect(bubble().querySelectorAll('.ghostTalkDot').length).toBe(0);
        expect(bubbleText()).toBe('…');

        state.pending.forEach((release) => release());
        await flush();
        expect(bubbleText()).toBe('boo');
    });

    it('marks the surface as fade-only so the scale pop is dropped', () => {
        stubMatchMedia({ desktop: true, reducedMotion: true });
        mountCompanion();
        hit().click();
        expect(bubble().classList.contains('ghostTalkSurface--calm')).toBe(true);
        expect(input().classList.contains('ghostTalkSurface--calm')).toBe(true);
    });
});

describe('ghost talk — mobile has zero presence', () => {
    it('does not subscribe or mount when supportsDesktopCompanion() is false', () => {
        stubMatchMedia({ desktop: false });
        expect(ensureGhostTalk()).toBe(false);

        // Even called directly with a live sprite API, the gate refuses.
        const api = {
            getPosition: () => ({ x: 100, y: 200, width: 48, height: 56 }),
            freeze: vi.fn(),
            resume: vi.fn(),
            setTalkOpen: vi.fn(),
        };
        expect(openGhostTalk(api)).toBeNull();
        expect(bubble()).toBeNull();
        expect(input()).toBeNull();
        expect(api.freeze).not.toHaveBeenCalled();
    });

    it('the companion never mounts a hit target on a non-qualifying viewport', () => {
        stubMatchMedia({ desktop: false });
        localStorage.setItem('todoapp_companion_enabled', 'true');
        companion = createCompanion(document);
        expect(document.getElementById('companion')).toBeNull();
        expect(hit()).toBeNull();
    });
});

// This module is the DESKTOP skin. The mobile perch wears the big-bubble modal
// (ghostModal.js) instead, so the floating surface must stay off phone
// viewports entirely — and must keep naming itself on the Worker payload, since
// the transcript's `surface` field is the only record of where an exchange
// happened.
describe('ghost talk — the desktop skin only', () => {
    // The file-wide stubMatchMedia answers the same `matches` to every query,
    // which can't express "mobile breakpoint but not desktop companion". This
    // one is query-aware so each gate is exercised against a real viewport
    // shape rather than a blanket yes.
    function stubMobileViewport() {
        window.matchMedia = (query) => ({
            matches: /prefers-reduced-motion/.test(query) ? false : /max-width/.test(query),
            media: query,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
        });
    }

    it('tags the surface as the desktop mount and names it on the payload', async () => {
        mountCompanion();
        hit().click();

        expect(bubble().classList.contains('ghostTalkSurface--desktop')).toBe(true);
        expect(bubble().classList.contains('ghostTalkSurface--mobile')).toBe(false);
        input().value = 'hello';
        pressEnter(input());
        await flush();

        const ask = state.calls.find((c) => c && c.message);
        expect(ask.surface).toBe('desktop');
    });

    it('refuses to open on a phone viewport, where the modal skin runs instead', () => {
        stubMobileViewport();
        const api = {
            getPosition: () => ({ x: 14, y: 600, width: 34, height: 40 }),
            freeze: vi.fn(),
            resume: vi.fn(),
            setTalkOpen: vi.fn(),
        };

        expect(openGhostTalk(api)).toBeNull();
        expect(bubble()).toBeNull();
        expect(input()).toBeNull();
    });

    it('dismisses on a touch outside the surface, without waiting for a synthetic mousedown', () => {
        mountCompanion();
        hit().click();

        const outside = document.createElement('div');
        document.body.appendChild(outside);
        outside.dispatchEvent(new Event('touchstart', { bubbles: true }));

        expect(bubble().classList.contains('is-closing')).toBe(true);
    });

    it('opens nothing without a sprite api to dock against', () => {
        mountCompanion();
        expect(openGhostTalk(null)).toBeNull();
        expect(bubble()).toBeNull();
    });
});

describe('ghost talk — positioning', () => {
    it('clamps the bubble inside the viewport for an edge-wandered ghost', () => {
        mountCompanion();
        const api = {
            getPosition: () => ({ x: 4, y: 8, width: 48, height: 56 }),
            freeze: vi.fn(),
            resume: vi.fn(),
            setTalkOpen: vi.fn(),
        };
        openGhostTalk(api);

        // Fallback geometry is used under jsdom (no layout), so the assertion
        // is on the clamp itself: never past the 8px edge margin.
        expect(parseInt(bubble().style.left, 10)).toBeGreaterThanOrEqual(8);
        expect(parseInt(bubble().style.top, 10)).toBeGreaterThanOrEqual(8);
        expect(parseInt(input().style.left, 10)).toBeGreaterThanOrEqual(8);
    });
});

// The placement math is pulled out as a pure function precisely so it can be
// exercised at bubble sizes jsdom can never produce — a layout-less DOM reports
// every box as 0×0, which is what let the original top-anchored bug ship green.
describe('computeTalkLayout', () => {
    const VIEWPORT = { width: 1024, height: 768 };
    const sprite = (x, y) => ({ x, y, width: 48, height: 56 });
    // The ask input as position() places it: centred on the sprite, to its right.
    const inputFor = (s) => ({ x: s.x + s.width + 12, y: s.y + s.height / 2 - 16, width: 180, height: 32 });

    it('bottom-anchors in above mode — growing the bubble moves it up, not down', () => {
        const s = sprite(400, 400);
        const short = computeTalkLayout(s, { width: 250, height: 44 }, inputFor(s), VIEWPORT);
        const tall  = computeTalkLayout(s, { width: 250, height: 140 }, inputFor(s), VIEWPORT);

        expect(short.placement).toBe('above');
        expect(tall.placement).toBe('above');
        expect(tall.bubbleY).toBeLessThan(short.bubbleY);
        // The bottom edge is the anchor, so it does not move as content grows.
        expect(tall.bubbleY + 140).toBe(short.bubbleY + 44);
    });

    it('clears both the sprite and the ask input by at least 8px at any height', () => {
        const s = sprite(400, 400);
        const inp = inputFor(s);
        // The input hangs below the sprite's top edge, so it is the binding
        // constraint — a bubble that only cleared the sprite would sit on it.
        for (const height of [20, 44, 90, 160, 300]) {
            const l = computeTalkLayout(s, { width: 250, height }, inp, VIEWPORT);
            expect(l.placement).toBe('above');
            expect(s.y - (l.bubbleY + height)).toBeGreaterThanOrEqual(8);
            expect(inp.y - (l.bubbleY + height)).toBeGreaterThanOrEqual(8);
        }
    });

    it('flips below when a tall bubble has no headroom over a sprite near the top', () => {
        const s = sprite(400, 60);
        const inp = inputFor(s);
        const l = computeTalkLayout(s, { width: 250, height: 140 }, inp, VIEWPORT);

        expect(l.placement).toBe('below');
        // Docked under the whole cluster, clearing the lower of sprite and input.
        expect(l.bubbleY).toBeGreaterThanOrEqual(Math.max(s.y + s.height, inp.y + inp.height) + 8);
        expect(l.bubbleY + 140).toBeLessThanOrEqual(VIEWPORT.height - 8);
        // The tail still points at the sprite; only its edge flips (in CSS).
        expect(l.tailX).toBe(s.x + s.width / 2 - l.bubbleX);
    });

    it('stays above when a short bubble fits over a sprite near the top', () => {
        const s = sprite(400, 60);
        expect(computeTalkLayout(s, { width: 250, height: 30 }, inputFor(s), VIEWPORT).placement).toBe('above');
    });

    it('keeps the tail pointed at the sprite when the bubble is clamped against the left edge', () => {
        const s = sprite(4, 400);
        const l = computeTalkLayout(s, { width: 250, height: 44 }, inputFor(s), VIEWPORT);

        // The bubble is clamped to the edge margin, but the tail tracks the
        // sprite's centre (x=28) inside it rather than the bubble's own centre.
        expect(l.bubbleX).toBe(8);
        expect(l.tailX).toBe(28 - 8);
    });

    it('holds the tail off the bubble corner when the sprite centre falls outside it', () => {
        // A sprite centred left of the clamped bubble would put the tail at a
        // negative offset; the inset keeps it on the rounded corner instead.
        const l = computeTalkLayout({ x: 0, y: 400, width: 8, height: 56 }, { width: 250, height: 44 }, null, VIEWPORT);
        expect(l.bubbleX).toBe(8);
        expect(l.tailX).toBe(14);
    });

    it('keeps the bubble on-screen when the sprite hugs the right edge', () => {
        const s = sprite(1000, 400);
        const l = computeTalkLayout(s, { width: 250, height: 44 }, inputFor(s), VIEWPORT);
        expect(l.bubbleX + 250).toBeLessThanOrEqual(VIEWPORT.width - 8);
        expect(l.tailX).toBeLessThanOrEqual(250 - 14);
    });

    it('tolerates a missing input rect and anchors on the sprite alone', () => {
        const s = sprite(400, 400);
        const l = computeTalkLayout(s, { width: 250, height: 44 }, null, VIEWPORT);
        expect(l.placement).toBe('above');
        expect(l.bubbleY + 44).toBe(s.y - 12);
    });
});

describe('ghost talk — reflow on content change', () => {
    function openAt(pos) {
        mountCompanion();
        const api = {
            getPosition: () => pos,
            freeze: vi.fn(),
            resume: vi.fn(),
            setTalkOpen: vi.fn(),
        };
        openGhostTalk(api);
        return api;
    }

    // jsdom reports every box as 0×0, so the bubble's height is stubbed to
    // stand in for the wrap the real greeting would cause.
    function stubHeight(el, initial) {
        const box = { h: initial };
        Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => box.h });
        return box;
    }

    it('re-places the bubble when the greeting replaces the placeholder', async () => {
        state.historyResult = {
            messages: [{ role: 'ghost', content: 'i have been waiting a while', created_at: minutesAgo(2) }],
        };
        openAt({ x: 400, y: 400, width: 48, height: 56 });

        const b = bubble();
        const before = parseInt(b.style.top, 10);
        // The greeting wraps to three lines where the "…" placeholder was one.
        const box = stubHeight(b, 120);

        await flush();

        expect(bubbleText()).toBe('i have been waiting a while');
        const after = parseInt(b.style.top, 10);
        expect(after).toBeLessThan(before);
        // Grown upward: the bottom edge is where it was, so the sprite and the
        // ask input below it are untouched.
        expect(after + box.h).toBe(before + 44);
    });

    it('keeps the bottom edge fixed across the pending-dots to reply swap', async () => {
        state.defer = true;
        state.askResult = { reply: 'a much longer answer than the dots were' };
        openAt({ x: 400, y: 400, width: 48, height: 56 });

        const b = bubble();
        const bottomAt = () => parseInt(b.style.top, 10) + b.offsetHeight;
        const box = stubHeight(b, 44);
        const bottom = bottomAt();

        input().value = 'how long have you been here';
        pressEnter(input());
        box.h = 44;
        expect(bottomAt()).toBe(bottom);

        box.h = 96;
        state.pending.forEach((release) => release());
        await flush();

        expect(bubbleText()).toBe('a much longer answer than the dots were');
        expect(bottomAt()).toBe(bottom);
        // And still clear of the sprite it is docked to.
        expect(parseInt(b.style.top, 10) + box.h).toBeLessThanOrEqual(400 - 8);
    });

    it('flips to the below placement class for a tall bubble near the viewport top', async () => {
        state.historyResult = { messages: [{ role: 'ghost', content: 'no room up here' }] };
        openAt({ x: 400, y: 40, width: 48, height: 56 });

        const b = bubble();
        stubHeight(b, 200);
        await flush();

        expect(b.classList.contains('ghostTalkBubble--below')).toBe(true);
        expect(parseInt(b.style.top, 10)).toBeGreaterThan(40 + 56);
    });

    it('observes the bubble for size changes and disconnects on dismissal mid-pending', async () => {
        const observe = vi.fn();
        const disconnect = vi.fn();
        const had = 'ResizeObserver' in globalThis;
        const saved = globalThis.ResizeObserver;
        globalThis.ResizeObserver = class {
            constructor(cb) { this.cb = cb; }
            observe(el) { observe(el); }
            disconnect() { disconnect(); }
        };
        try {
            state.defer = true;
            openAt({ x: 400, y: 400, width: 48, height: 56 });
            expect(observe).toHaveBeenCalledWith(bubble());

            input().value = 'are you still there';
            pressEnter(input());
            expect(bubble().classList.contains('ghostTalkBubble--pending')).toBe(true);

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(disconnect).toHaveBeenCalledTimes(1);

            // Teardown is idempotent — a second dismissal is a no-op, and the
            // deferred reply landing afterwards must not paint or throw.
            closeGhostTalk();
            state.pending.forEach((release) => release());
            await flush();
            expect(disconnect).toHaveBeenCalledTimes(1);

            await new Promise((r) => setTimeout(r, 260));
            expect(bubble()).toBeNull();
            expect(input()).toBeNull();
        } finally {
            if (had) globalThis.ResizeObserver = saved;
            else delete globalThis.ResizeObserver;
        }
    });

    it('re-places the bubble when the size observer fires without a content write', () => {
        let fire = null;
        const had = 'ResizeObserver' in globalThis;
        const saved = globalThis.ResizeObserver;
        globalThis.ResizeObserver = class {
            constructor(cb) { fire = cb; }
            observe() {}
            disconnect() { fire = null; }
        };
        try {
            openAt({ x: 400, y: 400, width: 48, height: 56 });
            const b = bubble();
            const before = parseInt(b.style.top, 10);
            stubHeight(b, 130);

            fire();

            expect(parseInt(b.style.top, 10)).toBe(before + 44 - 130);
        } finally {
            if (had) globalThis.ResizeObserver = saved;
            else delete globalThis.ResizeObserver;
        }
    });
});

// The mobile mount used to wear this same floating cluster, which is
// fixed-positioned from pixel coordinates captured at open — so it needed
// visualViewport listeners to stay off the software keyboard. The phone skin is
// now the bottom-anchored modal (ghostModal.js), which rides the cured viewport
// in CSS, and that docking code was deleted rather than left dormant. These pin
// the deletion: a dormant listener re-attached later would silently fight the
// modal for the same keyboard.
describe('ghost talk — no viewport docking left behind', () => {
    // jsdom has no visualViewport. This stand-in counts anything that subscribes
    // to it.
    function stubVisualViewport() {
        const listeners = {};
        window.visualViewport = {
            height: 768,
            offsetTop: 0,
            addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
            removeEventListener(type, fn) {
                listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
            },
            count(type) { return (listeners[type] || []).length; },
        };
        return window.visualViewport;
    }

    afterEach(() => {
        delete window.visualViewport;
    });

    it('subscribes to nothing on the visual viewport when the surface opens', () => {
        const vv = stubVisualViewport();
        mountCompanion();
        hit().click();

        expect(bubble()).not.toBeNull();
        expect(vv.count('resize')).toBe(0);
        expect(vv.count('scroll')).toBe(0);
    });

    it('carries no visualViewport code at all', () => {
        expect(read('ghostTalk.js')).not.toMatch(/visualViewport/);
    });
});

describe('ghost talk — module wiring', () => {
    it('inject.js exports postToWorker so the talk surface reuses the one worker caller', () => {
        expect(read('inject.js')).toMatch(/export\s+async\s+function\s+postToWorker\s*\(/);
    });

    it('ghostTalk.js imports postToWorker from inject.js rather than calling fetch itself', () => {
        const js = read('ghostTalk.js');
        expect(js).toMatch(/import\s*\{[^}]*postToWorker[^}]*\}\s*from\s*['"]\.\/inject\.js['"]/);
        expect(js).not.toMatch(/\bfetch\s*\(/);
    });

    it('does not reach into claudeSheet, the agent surfaces, or Supabase', () => {
        const js = read('ghostTalk.js');
        expect(js).not.toMatch(/claudeSheet/);
        expect(js).not.toMatch(/agentView/);
        expect(js).not.toMatch(/supabase/i);
    });

    it('never routes a ghost failure through the toast helper', () => {
        expect(read('ghostTalk.js')).not.toMatch(/showInjectToast/);
    });

    it('main.js subscribes the talk surface at boot', () => {
        const js = read('main.js');
        expect(js).toMatch(/import\s*\{[^}]*ensureGhostTalk[^}]*\}\s*from\s*['"]\.\/ghostTalk\.js['"]/);
        expect(js).toMatch(/ensureGhostTalk/);
    });

    it('keeps pointer-events off the sprite and puts them on the hit wrapper', () => {
        const css = read('style.css');
        const sprite = css.match(/\.companion\s*\{([^}]*)\}/);
        expect(sprite[1]).toMatch(/pointer-events:\s*none/);
        const hitRule = css.match(/\.companionHit\s*\{([^}]*)\}/);
        expect(hitRule).not.toBeNull();
        expect(hitRule[1]).toMatch(/pointer-events:\s*auto/);
        expect(hitRule[1]).toMatch(/cursor:\s*pointer/);
    });

    it('styles the bubble from theme variables with a rotated tail', () => {
        const css = read('style.css');
        const bubbleRule = css.match(/\.ghostTalkBubble\s*\{([^}]*)\}/);
        expect(bubbleRule).not.toBeNull();
        expect(bubbleRule[1]).toMatch(/background:\s*var\(--bg-card\)/);
        expect(bubbleRule[1]).toMatch(/border:\s*1px solid var\(--border-mid\)/);
        expect(bubbleRule[1]).toMatch(/border-radius:\s*12px/);
        expect(bubbleRule[1]).toMatch(/max-width:\s*250px/);
        const tailRule = css.match(/\.ghostTalkTail\s*\{([^}]*)\}/);
        expect(tailRule[1]).toMatch(/transform:\s*rotate\(45deg\)/);
    });

    it('flips the tail to the top edge for the below placement', () => {
        const css = read('style.css');
        const flipped = css.match(/\.ghostTalkBubble--below\s+\.ghostTalkTail\s*\{([^}]*)\}/);
        expect(flipped).not.toBeNull();
        expect(flipped[1]).toMatch(/bottom:\s*auto/);
        expect(flipped[1]).toMatch(/top:\s*-5px/);
        expect(flipped[1]).toMatch(/border-top:\s*1px solid var\(--border-mid\)/);
        expect(flipped[1]).toMatch(/border-left:\s*1px solid var\(--border-mid\)/);
    });

    it('hides the talk surface on viewports where the companion never runs', () => {
        const css = read('style.css');
        // Same gate that hides the sprite. Brace-match the block so the
        // assertion reads the whole rule set rather than stopping at the
        // first nested `}`.
        const start = css.indexOf('.companion { display: none; }');
        expect(start).toBeGreaterThan(-1);
        const open = css.lastIndexOf('{', css.lastIndexOf('@media', start) + 60);
        let depth = 0;
        let end = -1;
        for (let i = open; i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        const block = css.slice(css.lastIndexOf('@media', start), end);
        expect(block).toMatch(/\(pointer:\s*coarse\)/);
        expect(block).toMatch(/\.companionHit\s*\{\s*display:\s*none/);
        expect(block).toMatch(/\.ghostTalkBubble[\s\S]*display:\s*none/);
        // Scoped to the DESKTOP mount only — the mobile perch mounts the same
        // bubble on exactly these viewports, so an unscoped rule here would
        // hide the mobile surface the moment it opened.
        expect(block).toMatch(/\.ghostTalkBubble\.ghostTalkSurface--desktop/);
        expect(block).toMatch(/\.ghostTalkInput\.ghostTalkSurface--desktop/);
        expect(block).not.toMatch(/ghostTalkSurface--mobile/);
    });
});
