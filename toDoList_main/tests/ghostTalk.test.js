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
        askResult: { reply: 'boo' },
        askRejects: null,
    },
}));

vi.mock('../src/inject.js', () => ({
    isInjectConfigured: vi.fn(() => state.configured),
    postToWorker: vi.fn(function (payload) {
        state.calls.push(payload);
        const isHistory = !!(payload && payload.history);
        if (!isHistory && state.askRejects) return Promise.reject(state.askRejects);
        const result = isHistory ? state.historyResult : state.askResult;
        if (!state.defer) return Promise.resolve(result);
        return new Promise(function (resolve, reject) {
            state.pending.push(function () {
                if (!isHistory && state.askRejects) reject(state.askRejects);
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

beforeEach(() => {
    state.configured = true;
    state.calls = [];
    state.defer = false;
    state.pending = [];
    state.historyResult = null;
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
                { role: 'ghost', content: 'still here. always.' },
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

    it('stays quiet when the transcript has no ghost line yet', async () => {
        state.historyResult = { messages: [] };
        mountCompanion();
        hit().click();
        await flush();
        expect(bubbleText()).toBe('…');
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
    });
});
