import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The mobile ghost's big-bubble chat modal.
//
// This is the phone skin of the talk surface: a scrim over the app and one large
// speech bubble anchored above the perch, replacing the floating bubble the
// desktop companion wears. The contracts pinned here are the ones that could
// regress without the surface looking broken.
//
// The load-bearing one is the greeting. It renders as an ordinary ghost row —
// deliberately indistinguishable from a real one — and must never leave the
// client: a greeting that reached `ghost_messages` would come back on the next
// hydrate as something the ghost actually said, and the whole recency gate that
// produced it would be arguing with its own output. The rest is the thread
// contract (hydration order, alignment, the optimistic send) and the teardown,
// which has to survive a dismissal with a reply still in flight.
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

import { openGhostModal, closeGhostModal, resetGhostModal } from '../src/ghostModal.js';
import { GHOST_GREETINGS, GHOST_CONTINUATION_MS } from '../src/ghostTalk.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

// jsdom answers `matches: false` to every query, which would bar the mobile
// gate. `mobile` decides whether the max-width query passes.
function stubMatchMedia({ mobile = true, reducedMotion = false } = {}) {
    window.matchMedia = (query) => ({
        matches: /prefers-reduced-motion/.test(query) ? reducedMotion
               : /max-width/.test(query)             ? mobile
               : !mobile,
        media: query,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
    });
}

// The perch's freeze controls, as mobileGhost.js hands them over.
function talkApi() {
    return { freeze: vi.fn(), resume: vi.fn(), setTalkOpen: vi.fn() };
}

const scrim  = () => document.getElementById('ghostModalScrim');
const modal  = () => document.getElementById('ghostModal');
const input  = () => document.getElementById('ghostModalInput');
const thread = () => document.querySelector('.ghostModalThread');
const rows   = () => Array.from(document.querySelectorAll('.ghostModalRow'));
const rowText = () => rows().map((r) => r.textContent);
const pressEnter = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

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
    resetGhostModal();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('ghost modal — mounting', () => {
    it('mounts a scrim above the app and the bubble above the perch', () => {
        expect(openGhostModal(talkApi())).not.toBeNull();

        expect(scrim()).not.toBeNull();
        expect(modal()).not.toBeNull();
        expect(modal().getAttribute('role')).toBe('dialog');
        expect(modal().getAttribute('aria-modal')).toBe('true');
        expect(modal().querySelector('.ghostModalTail')).not.toBeNull();
        expect(thread()).not.toBeNull();
        expect(input().placeholder).toBe('whisper something…');
    });

    it('takes the perch\'s freeze on open so the ghost holds still to listen', () => {
        const api = talkApi();
        openGhostModal(api);

        expect(api.setTalkOpen).toHaveBeenCalledWith(true);
        expect(api.freeze).toHaveBeenCalled();
    });

    it('mounts nothing at >=1024px, where the desktop floating skin runs instead', () => {
        stubMatchMedia({ mobile: false });

        expect(openGhostModal(talkApi())).toBeNull();
        expect(scrim()).toBeNull();
        expect(modal()).toBeNull();
    });

    it('re-opens rather than stacking a second modal', () => {
        openGhostModal(talkApi());
        openGhostModal(talkApi());

        expect(document.querySelectorAll('.ghostModal').length).toBe(1);
        expect(document.querySelectorAll('.ghostModalScrim').length).toBe(1);
    });

    it('drops the scale pop under reduced motion, keeping the fade', () => {
        stubMatchMedia({ mobile: true, reducedMotion: true });
        openGhostModal(talkApi());

        expect(modal().classList.contains('ghostModal--calm')).toBe(true);
    });
});

describe('ghost modal — the thread', () => {
    it('hydrates the newest rows oldest-to-newest with per-role alignment', async () => {
        state.historyResult = {
            messages: [
                { role: 'user',  content: 'are you there', created_at: minutesAgo(4) },
                { role: 'ghost', content: 'still here. always.', created_at: minutesAgo(3) },
            ],
        };
        openGhostModal(talkApi());

        expect(state.calls.find((c) => c && c.history)).toEqual({ ghost: true, history: true });
        await flush();

        expect(rowText()).toEqual(['are you there', 'still here. always.']);
        expect(rows()[0].classList.contains('ghostModalRow--user')).toBe(true);
        expect(rows()[1].classList.contains('ghostModalRow--ghost')).toBe(true);
    });

    it('carries only the newest 20 rows', async () => {
        state.historyResult = {
            messages: Array.from({ length: 30 }, (_, i) => ({
                role: i % 2 ? 'ghost' : 'user',
                content: 'line ' + i,
                created_at: minutesAgo(200),
            })),
        };
        openGhostModal(talkApi());
        await flush();

        // The greeting rides along as a 21st row: the transcript is stale.
        const text = rowText();
        expect(text.slice(0, 20)).toEqual(
            Array.from({ length: 20 }, (_, i) => 'line ' + (i + 10))
        );
        expect(GHOST_GREETINGS).toContain(text[20]);
    });

    it('scrolls to the foot of the thread once hydrated', async () => {
        state.historyResult = { messages: [{ role: 'ghost', content: 'down here', created_at: minutesAgo(1) }] };
        openGhostModal(talkApi());
        // jsdom reports every box as 0, so drive scrollHeight directly — the
        // contract is that the module writes scrollTop from it at all.
        Object.defineProperty(thread(), 'scrollHeight', { value: 4200, configurable: true });
        await flush();

        expect(thread().scrollTop).toBe(4200);
    });

    it('opens with an empty thread rather than an error when the readback fails', async () => {
        state.historyRejects = new Error('wire cut');
        openGhostModal(talkApi());
        await flush();

        // One row only, and it is a greeting — no error copy anywhere.
        expect(rows().length).toBe(1);
        expect(GHOST_GREETINGS).toContain(rowText()[0]);
        expect(document.getElementById('injectToast')).toBeNull();
    });
});

// The greeting is theatre: it exists in this thread and nowhere else. A
// greeting that reached the transcript would come back on the next hydrate as
// something the ghost said, so this is the contract worth pinning hardest.
describe('ghost modal — the greeting', () => {
    it('adds a greeting as the newest ghost row when the last exchange is stale', async () => {
        state.historyResult = {
            messages: [{ role: 'ghost', content: 'that was a long time ago', created_at: minutesAgo(180) }],
        };
        openGhostModal(talkApi());
        await flush();

        const text = rowText();
        expect(text[0]).toBe('that was a long time ago');
        expect(GHOST_GREETINGS).toContain(text[1]);
        // Visually indistinct from the real rows around it.
        expect(rows()[1].className).toBe(rows()[0].className);
    });

    it('adds nothing when the conversation is still warm', async () => {
        state.historyResult = {
            messages: [{ role: 'ghost', content: 'i was mid-sentence', created_at: minutesAgo(3) }],
        };
        openGhostModal(talkApi());
        await flush();

        expect(rowText()).toEqual(['i was mid-sentence']);
    });

    it('holds the reply right up to the continuation window and greets just past it', async () => {
        const at = async (ms) => {
            state.historyResult = {
                messages: [{ role: 'ghost', content: 'on the edge', created_at: new Date(Date.now() - ms).toISOString() }],
            };
            openGhostModal(talkApi());
            await flush();
            return rowText();
        };

        expect(await at(GHOST_CONTINUATION_MS - 60 * 1000)).toEqual(['on the edge']);
        const past = await at(GHOST_CONTINUATION_MS + 60 * 1000);
        expect(past[0]).toBe('on the edge');
        expect(GHOST_GREETINGS).toContain(past[1]);
    });

    it('greets on an empty transcript', async () => {
        state.historyResult = { messages: [] };
        openGhostModal(talkApi());
        await flush();

        expect(rows().length).toBe(1);
        expect(GHOST_GREETINGS).toContain(rowText()[0]);
    });

    it('never lets the greeting reach the worker on any payload', async () => {
        state.historyResult = { messages: [] };
        openGhostModal(talkApi());
        await flush();

        const greeting = rowText()[0];
        expect(GHOST_GREETINGS).toContain(greeting);

        input().value = 'what were we saying';
        pressEnter(input());
        await flush();

        const ask = state.calls.find((c) => c && c.message);
        expect(ask).toEqual({ ghost: true, message: 'what were we saying', surface: 'mobile' });
        const wire = JSON.stringify(state.calls);
        GHOST_GREETINGS.forEach((line) => expect(wire).not.toContain(line));
    });
});

describe('ghost modal — asking', () => {
    it('appends the question optimistically, shows pending, then swaps in the reply', async () => {
        // A warm transcript, so the thread starts on one real row and nothing
        // the greeting added.
        state.historyResult = {
            messages: [{ role: 'ghost', content: 'earlier', created_at: minutesAgo(2) }],
        };
        openGhostModal(talkApi());
        await flush();
        expect(rows().length).toBe(1);

        state.defer = true;
        state.askResult = { reply: 'cold. quiet. fine.' };
        input().value = 'how is it';
        pressEnter(input());

        // Both rows are up before anything has come back.
        expect(rows().length).toBe(3);
        expect(rows()[1].textContent).toBe('how is it');
        expect(rows()[1].classList.contains('ghostModalRow--user')).toBe(true);
        const pending = rows()[2];
        expect(pending.classList.contains('ghostModalRow--ghost')).toBe(true);
        expect(pending.classList.contains('ghostModalRow--pending')).toBe(true);
        expect(pending.querySelectorAll('.ghostTalkDot').length).toBe(3);

        state.pending.forEach((release) => release());
        await flush();

        // The reply lands in the row that was holding its place — no new row.
        expect(rows().length).toBe(3);
        expect(rows()[2]).toBe(pending);
        expect(pending.textContent).toBe('cold. quiet. fine.');
        expect(pending.classList.contains('ghostModalRow--pending')).toBe(false);
    });

    it('clears the input on send and ignores an empty one', async () => {
        openGhostModal(talkApi());

        input().value = '   ';
        pressEnter(input());
        expect(state.calls.some((c) => c && c.message)).toBe(false);

        input().value = 'hello';
        pressEnter(input());
        expect(input().value).toBe('');
        await flush();
    });

    it('answers in the ghost\'s voice when the wire is dead, without a toast', async () => {
        state.askRejects = Object.assign(new Error('HTTP 500'), { status: 500 });
        openGhostModal(talkApi());

        input().value = 'anyone there';
        pressEnter(input());
        await flush();

        expect(rows()[1].textContent).toBe("the wire's dead. try again later.");
        expect(document.getElementById('injectToast')).toBeNull();
    });

    it('answers "no wire" with nothing configured, and never posts', async () => {
        state.configured = false;
        openGhostModal(talkApi());
        await flush();

        input().value = 'hello?';
        pressEnter(input());
        await flush();

        // The thread opened on a greeting, so the exchange is the last two rows.
        expect(rowText().slice(-2)).toEqual(['hello?', 'no wire to the other side yet.']);
        // Neither the ask nor the hydrate goes out unconfigured.
        expect(state.calls.length).toBe(0);
        expect(console.warn).toHaveBeenCalled();
    });

    it('renders a static ellipsis instead of dots while pending under reduced motion', () => {
        stubMatchMedia({ mobile: true, reducedMotion: true });
        state.defer = true;
        openGhostModal(talkApi());

        input().value = 'quietly now';
        pressEnter(input());

        expect(rows()[1].querySelectorAll('.ghostTalkDot').length).toBe(0);
        expect(rows()[1].textContent).toBe('…');
    });
});

describe('ghost modal — dismissal', () => {
    it('a scrim tap fades the modal out and gives the perch back', async () => {
        const api = talkApi();
        openGhostModal(api);

        scrim().dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(modal().classList.contains('is-closing')).toBe(true);
        expect(scrim().classList.contains('is-closing')).toBe(true);
        expect(api.setTalkOpen).toHaveBeenLastCalledWith(false);
        expect(api.resume).toHaveBeenCalled();

        await new Promise((r) => setTimeout(r, 260));
        expect(modal()).toBeNull();
        expect(scrim()).toBeNull();
    });

    it('dismisses on a scrim touch without waiting for a synthetic click', () => {
        openGhostModal(talkApi());

        scrim().dispatchEvent(new Event('touchstart', { bubbles: true }));

        expect(modal().classList.contains('is-closing')).toBe(true);
    });

    it('a tap inside the bubble keeps it open', () => {
        openGhostModal(talkApi());

        modal().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        input().dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(modal().classList.contains('is-closing')).toBe(false);
    });

    it('Escape closes it too', () => {
        openGhostModal(talkApi());
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(modal().classList.contains('is-closing')).toBe(true);
    });

    it('drops focus on dismissal so the keyboard retracts with the bubble', () => {
        openGhostModal(talkApi());
        const el = input();
        el.focus();
        expect(document.activeElement).toBe(el);

        closeGhostModal();

        expect(document.activeElement).not.toBe(el);
    });

    it('tears down cleanly mid-pending and never paints the late reply', async () => {
        state.defer = true;
        openGhostModal(talkApi());
        input().value = 'still there?';
        pressEnter(input());

        closeGhostModal();
        state.pending.forEach((release) => release());
        await flush();
        await new Promise((r) => setTimeout(r, 260));

        expect(modal()).toBeNull();
        expect(rows().length).toBe(0);
    });

    it('a late reply from a previous session never lands in the reopened thread', async () => {
        state.defer = true;
        openGhostModal(talkApi());
        input().value = 'first';
        pressEnter(input());

        // Re-open before the first reply comes back.
        state.historyResult = { messages: [] };
        state.defer = false;
        openGhostModal(talkApi());
        state.pending.forEach((release) => release());
        await flush();

        // Only the fresh session's greeting is in the thread.
        expect(rows().length).toBe(1);
        expect(GHOST_GREETINGS).toContain(rowText()[0]);
    });
});

describe('ghost modal — styling and wiring', () => {
    const css = read('style.css');
    // `contains` disambiguates the real rule from the display:none stub that
    // keeps both elements off desktop.
    const rule = (selector, contains = '') => {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = css.match(new RegExp(escaped + '\\s*\\{[^}]*' + contains + '[^}]*\\}'));
        expect(m).not.toBeNull();
        return m[0];
    };

    it('dims the app behind the bubble with the approved scrim', () => {
        const scrimRule = rule('.ghostModalScrim', 'position:\\s*fixed');
        expect(scrimRule).toMatch(/position:\s*fixed/);
        expect(scrimRule).toMatch(/inset:\s*0/);
        expect(scrimRule).toMatch(/background:\s*rgba\(5,\s*6,\s*10,\s*0?\.55\)/);
        // Above the app's highest backdrop (the confirm modal, at 4200).
        expect(Number(scrimRule.match(/z-index:\s*(\d+)/)[1])).toBeGreaterThan(4200);
    });

    it('anchors the bubble above the perch and lets it ride the keyboard', () => {
        const modalRule = rule('.ghostModal', 'position:\\s*fixed');
        expect(modalRule).toMatch(/position:\s*fixed/);
        expect(modalRule).toMatch(/left:\s*12px/);
        expect(modalRule).toMatch(/right:\s*12px/);
        expect(modalRule).toMatch(
            /bottom:\s*calc\(\s*var\(--mobile-tab-h[^)]*\)\s*\+\s*var\(--mobile-bottom-inset[^)]*\)\s*\+\s*66px\s*\)/
        );
        // dvh, not vh — the cured viewport is what shrinks with the keyboard.
        expect(modalRule).toMatch(/max-height:\s*min\(\s*60dvh/);
        expect(modalRule).toMatch(/background:\s*var\(--bg-elevated\)/);
        expect(modalRule).toMatch(/border:\s*1px solid var\(--border-mid\)/);
        expect(modalRule).toMatch(/border-radius:\s*16px/);
        // Over its own scrim.
        const z = Number(modalRule.match(/z-index:\s*(\d+)/)[1]);
        expect(z).toBeGreaterThan(Number(rule('.ghostModalScrim', 'position:\\s*fixed').match(/z-index:\s*(\d+)/)[1]));
    });

    it('points a rotated-square tail down at the perched ghost', () => {
        const tail = rule('.ghostModalTail');
        expect(tail).toMatch(/transform:\s*rotate\(45deg\)/);
        expect(tail).toMatch(/bottom:\s*-6px/);
        // The perch centre (14 + 34/2 = 31px) less the bubble's 12px inset.
        expect(tail).toMatch(/left:\s*19px/);
    });

    it('scrolls the thread inside the bubble rather than growing it', () => {
        const threadRule = rule('.ghostModalThread');
        expect(threadRule).toMatch(/overflow-y:\s*auto/);
        // Without min-height:0 a flex child refuses to shrink and the bubble
        // grows past its max-height instead of scrolling.
        expect(threadRule).toMatch(/min-height:\s*0/);
        expect(rule('.ghostModalRow--ghost')).toMatch(/align-self:\s*flex-start/);
        expect(rule('.ghostModalRow--user')).toMatch(/align-self:\s*flex-end/);
    });

    it('keeps the whisper input at 16px so iOS never auto-zooms on focus', () => {
        expect(rule('.ghostModalInput')).toMatch(/font-size:\s*16px/);
    });

    it('renders only under the mobile breakpoint', () => {
        expect(css).toMatch(/\.ghostModalScrim,\s*\n\.ghostModal\s*\{\s*display:\s*none;\s*\}/);
        const block = css.slice(css.indexOf('.ghostModalScrim,'));
        expect(block).toMatch(/@media \(max-width:\s*1023px\)/);
    });

    it('reuses the shared plumbing rather than calling the worker itself', () => {
        const js = read('ghostModal.js');
        expect(js).toMatch(/import\s*\{[\s\S]*?askGhost[\s\S]*?\}\s*from\s*['"]\.\/ghostTalk\.js['"]/);
        expect(js).not.toMatch(/\bfetch\s*\(/);
        expect(js).not.toMatch(/postToWorker/);
        // No viewport docking: the bottom-anchored CSS box rides the keyboard.
        expect(js).not.toMatch(/visualViewport/);
        // A presence surface, not an agent one.
        expect(js).not.toMatch(/claudeSheet/);
        expect(js).not.toMatch(/supabase/i);
        expect(js).not.toMatch(/showInjectToast/);
    });
});
