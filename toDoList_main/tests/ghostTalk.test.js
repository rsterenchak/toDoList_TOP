import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname } from 'node:path';

// ghostTalk.js — the ghost's plumbing, and nothing else.
//
// The floating desktop bubble that used to live in this module is gone: the
// ghost speaks through the possessed Claude pane on every viewport now, so what
// remains here is the part both doors share and must never fork — the two
// Worker calls, the recency-gated opening line, the in-voice error strings and
// the pending render.
//
// The contracts pinned here are the ones a later edit could break without
// looking broken: the exact payload shape the Worker route expects, the recency
// gate that decides between a replayed reply and a greeting, and the in-voice
// failure lines — the whole point of the feature is that a dead Worker still
// answers in character rather than throwing or raising a toast. The greeting is
// the load-bearing one: it is theatre, and a greeting that reached the Worker
// would come back on the next readback as something the ghost actually said.
//
// inject.js is mocked so every Worker call can be scripted (or deferred) with
// no network and no configured Worker.

const { state } = vi.hoisted(() => ({
    state: {
        configured: true,
        calls: [],
        // Canned resolution per kind, or a rejection to force the failure path.
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
        return Promise.resolve(isHistory ? state.historyResult : state.askResult);
    }),
}));

import {
    askGhost,
    fetchGhostHistory,
    readGhostRows,
    lastGhostReply,
    isGhostReplyWarm,
    ghostOpeningLine,
    pickGhostGreeting,
    renderGhostPending,
    isGhostWireReady,
    GHOST_GREETINGS,
    GHOST_CONTINUATION_MS,
    GHOST_WIRE_DEAD,
    GHOST_NO_WIRE,
    GHOST_QUIET,
    GHOST_PLACEHOLDER,
} from '../src/ghostTalk.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

// Every source file the app ships, so "no references anywhere in src" is
// checked against the tree rather than against a hand-listed set of files.
function sourceFiles(dir = srcDir, out = []) {
    readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, out);
        else if (['.js', '.css', '.html'].includes(extname(entry.name))) out.push(full);
    });
    return out;
}

// jsdom's matchMedia answers `matches: false` to everything; reduced-motion
// reads false unless a case asks otherwise.
function stubMatchMedia({ reducedMotion = false } = {}) {
    window.matchMedia = (query) => ({
        matches: /prefers-reduced-motion/.test(query) ? reducedMotion : false,
        media: query,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
    });
}

// Transcript timestamps in the shape the Worker sends them (ISO strings).
function minutesAgo(m) {
    return new Date(Date.now() - m * 60 * 1000).toISOString();
}

beforeEach(() => {
    state.configured = true;
    state.calls = [];
    state.historyResult = null;
    state.historyRejects = null;
    state.askResult = { reply: 'boo' };
    state.askRejects = null;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubMatchMedia();
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('ghost plumbing — asking', () => {
    it('posts the exact { ghost, message, surface } payload and resolves the reply', async () => {
        const text = await askGhost('are you there', 'desktop');

        expect(state.calls).toEqual([{ ghost: true, message: 'are you there', surface: 'desktop' }]);
        expect(text).toBe('boo');
    });

    it('carries whichever surface the caller names, so the transcript records the door', async () => {
        await askGhost('hello', 'mobile');
        expect(state.calls[0].surface).toBe('mobile');
    });

    it('falls back to the quiet line when the worker answers with nothing sayable', async () => {
        state.askResult = { reply: '' };
        expect(await askGhost('hello', 'desktop')).toBe(GHOST_QUIET);
    });
});

describe('ghost plumbing — failures speak in the ghost\'s voice', () => {
    it('answers "the wire\'s dead" when the worker is unreachable, and never rejects', async () => {
        state.askRejects = new Error('network down');
        await expect(askGhost('hello', 'desktop')).resolves.toBe(GHOST_WIRE_DEAD);
    });

    it('answers "no wire to the other side yet" when inject is unconfigured, and never posts', async () => {
        state.configured = false;
        expect(await askGhost('hello', 'desktop')).toBe(GHOST_NO_WIRE);
        expect(state.calls).toEqual([]);
        expect(isGhostWireReady()).toBe(false);
    });

    it('reads a notConfigured rejection as the no-wire line rather than a dead wire', async () => {
        state.askRejects = Object.assign(new Error('nope'), { notConfigured: true });
        expect(await askGhost('hello', 'desktop')).toBe(GHOST_NO_WIRE);
    });

    it('resolves the transcript empty when the readback fails, without surfacing an error', async () => {
        state.historyRejects = new Error('boom');
        await expect(fetchGhostHistory()).resolves.toEqual([]);
    });

    it('makes no readback request at all with no worker configured', async () => {
        state.configured = false;
        expect(await fetchGhostHistory()).toEqual([]);
        expect(state.calls).toEqual([]);
    });
});

describe('ghost plumbing — the transcript readback', () => {
    it('posts { ghost, history } and returns the rows oldest-first', async () => {
        state.historyResult = {
            messages: [
                { role: 'user', content: 'are you there', created_at: minutesAgo(4) },
                { role: 'ghost', content: 'still here.', created_at: minutesAgo(3) },
            ],
        };

        const rows = await fetchGhostHistory();

        expect(state.calls).toEqual([{ ghost: true, history: true }]);
        expect(rows.map((r) => r.role)).toEqual(['user', 'ghost']);
        expect(rows.map((r) => r.text)).toEqual(['are you there', 'still here.']);
    });

    it('reads the list under any of the names the route has used', () => {
        const row = { role: 'ghost', content: 'hi' };
        [[row], { messages: [row] }, { history: [row] }, { ghost_messages: [row] }].forEach((shape) => {
            expect(readGhostRows(shape)).toEqual([{ role: 'ghost', text: 'hi', createdAt: null }]);
        });
    });

    it('reads a bare reply as a single ghost row', () => {
        expect(readGhostRows({ reply: 'boo', created_at: 12345 }))
            .toEqual([{ role: 'ghost', text: 'boo', createdAt: 12345 }]);
    });

    it('treats anything unrecognised as an empty transcript', () => {
        [null, undefined, {}, { messages: null }].forEach((shape) => {
            expect(readGhostRows(shape)).toEqual([]);
        });
    });

    it('counts an unlabelled row as the ghost and a labelled one as the user', () => {
        const rows = readGhostRows([{ content: 'bare' }, { role: 'assistant', content: 'also mine' }, { role: 'user', content: 'yours' }]);
        expect(rows.map((r) => r.role)).toEqual(['ghost', 'ghost', 'user']);
    });

    it('drops rows carrying no text rather than rendering blanks', () => {
        expect(readGhostRows([{ role: 'ghost', content: '' }, null, { role: 'user', text: 'kept' }]))
            .toEqual([{ role: 'user', text: 'kept', createdAt: null }]);
    });

    it('finds the ghost\'s last word, or null when it never spoke', () => {
        const rows = [
            { role: 'ghost', text: 'first', createdAt: null },
            { role: 'user', text: 'mine', createdAt: null },
            { role: 'ghost', text: 'last', createdAt: null },
        ];
        expect(lastGhostReply(rows).text).toBe('last');
        expect(lastGhostReply([{ role: 'user', text: 'mine' }])).toBeNull();
        expect(lastGhostReply(null)).toBeNull();
    });
});

describe('ghost plumbing — the opening line', () => {
    it('replays the last reply verbatim while the exchange is still warm', () => {
        const line = ghostOpeningLine([{ role: 'ghost', text: 'i remember', createdAt: minutesAgo(2) }]);
        expect(line).toEqual({ text: 'i remember', greeting: false });
    });

    it('greets rather than replaying a reply from hours ago', () => {
        const line = ghostOpeningLine([{ role: 'ghost', text: 'i remember', createdAt: minutesAgo(600) }]);
        expect(line.greeting).toBe(true);
        expect(GHOST_GREETINGS).toContain(line.text);
    });

    it('holds the reply right up to the continuation window and greets just past it', () => {
        const inside = Date.now() - (GHOST_CONTINUATION_MS - 1000);
        const outside = Date.now() - (GHOST_CONTINUATION_MS + 1000);
        expect(isGhostReplyWarm(inside)).toBe(true);
        expect(isGhostReplyWarm(outside)).toBe(false);
        expect(ghostOpeningLine([{ role: 'ghost', text: 'warm', createdAt: inside }]).greeting).toBe(false);
        expect(ghostOpeningLine([{ role: 'ghost', text: 'cold', createdAt: outside }]).greeting).toBe(true);
    });

    it('treats a missing or unparseable timestamp as stale — provably warm, or greet', () => {
        [null, undefined, '', 'not a date', NaN].forEach((t) => {
            expect(isGhostReplyWarm(t)).toBe(false);
        });
        expect(ghostOpeningLine([{ role: 'ghost', text: 'no time', createdAt: null }]).greeting).toBe(true);
    });

    it('counts a little clock skew as warm rather than losing the thread', () => {
        expect(isGhostReplyWarm(Date.now() + 5000)).toBe(true);
    });

    it('greets on an empty transcript, and on one the ghost never spoke in', () => {
        expect(ghostOpeningLine([]).greeting).toBe(true);
        expect(ghostOpeningLine([{ role: 'user', text: 'hello?', createdAt: minutesAgo(1) }]).greeting).toBe(true);
    });

    it('draws only from the greeting set, across the whole random range', () => {
        const spy = vi.spyOn(Math, 'random');
        [0, 0.25, 0.5, 0.75, 0.999999, 1].forEach((r) => {
            spy.mockReturnValue(r);
            expect(GHOST_GREETINGS).toContain(pickGhostGreeting());
        });
    });

    it('keeps every greeting off the wire — it is theatre, never transcript', async () => {
        state.historyResult = { messages: [{ role: 'ghost', content: 'ancient', created_at: minutesAgo(600) }] };
        const line = ghostOpeningLine(await fetchGhostHistory());

        expect(line.greeting).toBe(true);
        // The readback is the only call the opening line makes, and a greeting
        // never becomes a message the Worker is told about.
        expect(state.calls).toEqual([{ ghost: true, history: true }]);
        expect(state.calls.some((c) => c && c.message)).toBe(false);
    });
});

describe('ghost plumbing — the pending render', () => {
    it('writes three animated dots into the host', () => {
        const host = document.createElement('div');
        renderGhostPending(host);
        expect(host.querySelectorAll('.ghostTalkDot').length).toBe(3);
    });

    it('renders a static ellipsis instead of dots under reduced motion', () => {
        stubMatchMedia({ reducedMotion: true });
        const host = document.createElement('div');
        renderGhostPending(host);
        expect(host.querySelectorAll('.ghostTalkDot').length).toBe(0);
        expect(host.textContent).toBe(GHOST_QUIET);
    });

    it('replaces whatever the host was showing rather than appending to it', () => {
        const host = document.createElement('div');
        host.textContent = 'an older line';
        renderGhostPending(host);
        expect(host.textContent).toBe('');
        expect(host.querySelectorAll('.ghostTalkDot').length).toBe(3);
    });

    it('does nothing without a host, rather than throwing into a caller', () => {
        expect(() => renderGhostPending(null)).not.toThrow();
    });
});

describe('ghost plumbing — module wiring', () => {
    it('inject.js exports postToWorker so the ghost reuses the one worker caller', () => {
        expect(read('inject.js')).toMatch(/export\s+async\s+function\s+postToWorker\s*\(/);
    });

    it('imports postToWorker from inject.js rather than calling fetch itself', () => {
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

    it('carries no viewport-docking code — the possessed pane rides the cured viewport itself', () => {
        expect(read('ghostTalk.js')).not.toMatch(/visualViewport/);
    });

    it('keeps every export possession consumes', () => {
        const js = read('ghostTalk.js');
        ['askGhost', 'fetchGhostHistory', 'readGhostRows', 'lastGhostReply', 'isGhostReplyWarm',
         'ghostOpeningLine', 'pickGhostGreeting', 'renderGhostPending', 'isGhostWireReady']
            .forEach((name) => {
                expect(js).toMatch(new RegExp('export function ' + name + '\\b'));
            });
        [GHOST_WIRE_DEAD, GHOST_NO_WIRE, GHOST_QUIET, GHOST_PLACEHOLDER].forEach((copy) => {
            expect(typeof copy).toBe('string');
            expect(copy.length).toBeGreaterThan(0);
        });
    });
});

// The floating skin — a bubble and an ask input docked to the frozen sprite —
// was dead code the moment possession took its click wiring, and is now gone.
// A removal this wide leaves orphans easily: an unreachable export, a rule
// block keyed off a class nothing creates, a stale import.
describe('the floating talk skin — retired', () => {
    it('leaves no reference to the deleted exports anywhere in src', () => {
        ['ensureGhostTalk', 'openGhostTalk', 'closeGhostTalk', 'computeTalkLayout', 'resetGhostTalk']
            .forEach((name) => {
                const offenders = sourceFiles().filter((file) =>
                    new RegExp(name).test(readFileSync(file, 'utf8'))
                );
                expect(offenders).toEqual([]);
            });
    });

    it('drops the bubble DOM machinery and the companion subscription from the module', () => {
        const js = read('ghostTalk.js');
        expect(js).not.toMatch(/ghostTalkBubble|ghostTalkTail|ghostTalkInput|ghostTalkSurface/);
        expect(js).not.toMatch(/onCompanionActivate|supportsDesktopCompanion/);
        // The one companion import it still needs is the motion preference the
        // pending render reads.
        expect(js).toMatch(/import\s*\{\s*prefersReducedMotion\s*\}\s*from\s*['"]\.\/companion\.js['"]/);
    });

    it('removes the bubble, tail, ask input and talk-layout rule blocks from the stylesheet', () => {
        const css = read('style.css');
        expect(css).not.toMatch(/\.ghostTalkBubble/);
        expect(css).not.toMatch(/\.ghostTalkTail/);
        expect(css).not.toMatch(/\.ghostTalkInput/);
        expect(css).not.toMatch(/\.ghostTalkSurface/);
    });

    it('keeps the pending dots, which every ghost thread still draws', () => {
        const css = read('style.css');
        expect(css).toMatch(/\.ghostTalkDot\s*\{/);
        expect(css).toMatch(/@keyframes\s+ghostTalkDots/);
    });

    it('describes the module as plumbing rather than as a surface', () => {
        // The header is the first thing an editor reads; leaving it describing a
        // bubble that no longer exists is how a floating surface gets rebuilt.
        const header = read('ghostTalk.js').split('\nimport')[0];
        expect(header).toMatch(/plumbing/i);
        expect(header).not.toMatch(/speech bubble|floating skin/i);
    });
});
