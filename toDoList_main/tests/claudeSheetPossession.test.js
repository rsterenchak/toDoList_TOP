import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Possession — the ghost wearing the Claude sheet.
//
// The sheet now carries two identities on one surface, and the contracts pinned
// here are the ones that would regress without anything LOOKING broken.
//
// The load-bearing one is the greeting. It renders as an ordinary ghost row —
// deliberately indistinguishable from a real one — and must never leave the
// client: a greeting that reached `ghost_messages` would come back on the next
// hydrate as something the ghost actually said, and the recency gate that
// produced it would be arguing with its own output.
//
// The second is the swap itself. Possession HIDES the work chat, it does not
// tear it down: the transcript, the composer draft and the send wiring all have
// to be exactly where they were when the ghost hands the sheet back. A flip that
// quietly ate a half-written prompt would read as a UI quirk rather than the
// data loss it is.
//
// inject.js is mocked over its real module (the sheet imports far more of it
// than the ghost does) so every Worker call can be scripted or deferred with no
// network and no configured Worker.

const { state } = vi.hoisted(() => ({
    state: {
        configured: true,
        calls: [],
        // When set, ghost Worker calls resolve only once the test releases them.
        defer: false,
        pending: [],
        historyResult: null,
        askResult: { reply: 'boo' },
    },
}));

vi.mock('../src/inject.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        isInjectConfigured: vi.fn(() => state.configured),
        postToWorker: vi.fn(function (payload) {
            state.calls.push(payload);
            const isHistory = !!(payload && payload.history);
            const result = isHistory ? state.historyResult : state.askResult;
            if (!state.defer) return Promise.resolve(result);
            return new Promise(function (release) {
                state.pending.push(function () { release(result); });
            });
        }),
    };
});

import {
    mountClaudeSheet,
    openClaudeSheet,
    closeClaudeSheet,
    isClaudeSheetOpen,
    isSheetPossessed,
    togglePossession,
} from '../src/claudeSheet.js';
import { GHOST_GREETINGS, GHOST_CONTINUATION_MS } from '../src/ghostTalk.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

// Transcript timestamps in the shape the Worker sends them (ISO strings).
function minutesAgo(m) {
    return new Date(Date.now() - m * 60 * 1000).toISOString();
}

function setViewport(width) {
    Object.defineProperty(window, 'innerWidth', {
        value: width,
        configurable: true,
        writable: true,
    });
}

const body = () => document.getElementById('claudeSheetBody');
const chip = () => document.getElementById('claudeGhostChip');
const listening = () => document.getElementById('claudeGhostListening');
const workSurface = () => document.getElementById('claudeChatSurface');
const thread = () => document.getElementById('claudeGhostThread');
const rows = () => Array.from(document.querySelectorAll('.claudeGhostRow'));
const rowText = () => rows().map((r) => r.textContent);
const composer = () => document.getElementById('claudeComposerInput');
const send = () => document.getElementById('claudeComposerSend');
const pressEnter = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

beforeEach(() => {
    state.configured = true;
    state.calls = [];
    state.defer = false;
    state.pending = [];
    state.historyResult = null;
    state.askResult = { reply: 'boo' };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setViewport(390);
    // The work chat persists per repo, so a turn sent by one case would replay
    // into the next case's surface and blur what "the work thread" holds.
    localStorage.clear();
    document.body.innerHTML = '';
    mountClaudeSheet(document.body);
});

afterEach(() => {
    closeClaudeSheet();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('possession — the chip flips the sheet\'s identity', () => {
    it('mounts unpossessed, with the ghost chip present and idle', () => {
        expect(isSheetPossessed()).toBe(false);
        expect(body().classList.contains('is-possessed')).toBe(false);
        expect(chip()).not.toBeNull();
        expect(chip().getAttribute('aria-pressed')).toBe('false');
        expect(chip().classList.contains('is-active')).toBe(false);
        expect(listening()).not.toBeNull();
        expect(composer().placeholder).toBe('Ask Claude…');
    });

    it('the chip toggles possession both ways, swapping thread and composer', () => {
        chip().click();

        expect(isSheetPossessed()).toBe(true);
        expect(body().classList.contains('is-possessed')).toBe(true);
        expect(chip().getAttribute('aria-pressed')).toBe('true');
        expect(chip().classList.contains('is-active')).toBe(true);
        expect(thread()).not.toBeNull();
        expect(composer().placeholder).toBe('whisper something…');

        chip().click();

        expect(isSheetPossessed()).toBe(false);
        expect(body().classList.contains('is-possessed')).toBe(false);
        expect(chip().getAttribute('aria-pressed')).toBe('false');
        expect(composer().placeholder).toBe('Ask Claude…');
    });

    it('hides the work thread rather than tearing it down', async () => {
        // A turn in the work chat, so the surface has something to lose.
        composer().value = 'draft an entry for the sidebar';
        pressEnter(composer());
        await flush();
        const before = workSurface().innerHTML;
        expect(workSurface().querySelectorAll('.claudeMsg').length).toBeGreaterThan(0);

        chip().click();
        chip().click();

        // Same node, same content — possession is a swap, never a wipe.
        expect(document.getElementById('claudeChatSurface')).not.toBeNull();
        expect(workSurface().innerHTML).toBe(before);
    });

    it('banks each identity\'s draft and restores it on the way back', () => {
        composer().value = 'half a prompt about the runs tab';
        chip().click();
        expect(composer().value).toBe('');

        composer().value = 'are you cold';
        chip().click();
        expect(composer().value).toBe('half a prompt about the runs tab');

        chip().click();
        expect(composer().value).toBe('are you cold');
    });

    it('exports a togglePossession the chip and callers share', () => {
        togglePossession();
        expect(isSheetPossessed()).toBe(true);
        expect(chip().classList.contains('is-active')).toBe(true);
        togglePossession();
        expect(isSheetPossessed()).toBe(false);
    });
});

describe('possession — lifecycle', () => {
    it('opens unpossessed by default, and possessed on request', () => {
        openClaudeSheet();
        expect(isClaudeSheetOpen()).toBe(true);
        expect(isSheetPossessed()).toBe(false);

        closeClaudeSheet();
        openClaudeSheet({ possessed: true });
        expect(isSheetPossessed()).toBe(true);
        expect(body().classList.contains('is-possessed')).toBe(true);
    });

    it('a possessed open lands on the CHAT tab', () => {
        document.getElementById('claudeTabRuns').click();
        openClaudeSheet({ possessed: true });

        expect(document.getElementById('claudeSheet').getAttribute('data-tab')).toBe('chat');
        expect(isSheetPossessed()).toBe(true);
    });

    it('ignores a stray event argument from an existing caller', () => {
        // openClaudeSheet is wired straight to clicks elsewhere; an Event has no
        // `possessed` field, so those callers keep their old behavior.
        openClaudeSheet(new MouseEvent('click'));
        expect(isSheetPossessed()).toBe(false);
    });

    it('the RUNS tab exits possession, and CHAT comes back to the work chat', () => {
        openClaudeSheet({ possessed: true });
        composer().value = 'unsent whisper';

        document.getElementById('claudeTabRuns').click();
        expect(isSheetPossessed()).toBe(false);
        expect(body().classList.contains('is-possessed')).toBe(false);

        document.getElementById('claudeTabChat').click();
        expect(isSheetPossessed()).toBe(false);
        expect(composer().placeholder).toBe('Ask Claude…');
        // The chip is still there to flip back with, and it remembers the
        // whisper that never went out.
        expect(chip()).not.toBeNull();
        chip().click();
        expect(composer().value).toBe('unsent whisper');
    });

    it('resets on sheet close and drops the thread it was holding', async () => {
        state.historyResult = { messages: [{ role: 'ghost', content: 'earlier', created_at: minutesAgo(2) }] };
        openClaudeSheet({ possessed: true });
        await flush();
        expect(rows().length).toBe(1);

        closeClaudeSheet();
        expect(isSheetPossessed()).toBe(false);
        expect(rows().length).toBe(0);

        // The next open hydrates fresh rather than stacking a second copy.
        openClaudeSheet({ possessed: true });
        await flush();
        expect(rowText()).toEqual(['earlier']);
    });
});

describe('possession — the ghost thread', () => {
    it('hydrates the newest rows oldest-to-newest with per-role alignment', async () => {
        state.historyResult = {
            messages: [
                { role: 'user', content: 'are you there', created_at: minutesAgo(4) },
                { role: 'ghost', content: 'still here. always.', created_at: minutesAgo(3) },
            ],
        };
        openClaudeSheet({ possessed: true });

        expect(state.calls.find((c) => c && c.history)).toEqual({ ghost: true, history: true });
        await flush();

        expect(rowText()).toEqual(['are you there', 'still here. always.']);
        expect(rows()[0].classList.contains('claudeGhostRow--user')).toBe(true);
        expect(rows()[1].classList.contains('claudeGhostRow--ghost')).toBe(true);
    });

    it('carries only the newest 20 rows', async () => {
        state.historyResult = {
            messages: Array.from({ length: 30 }, (_, i) => ({
                role: i % 2 ? 'ghost' : 'user',
                content: 'line ' + i,
                created_at: minutesAgo(200),
            })),
        };
        openClaudeSheet({ possessed: true });
        await flush();

        const text = rowText();
        expect(text.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => 'line ' + (i + 10)));
        // The greeting rides along as a 21st row: the transcript is stale.
        expect(GHOST_GREETINGS).toContain(text[20]);
    });

    it('reads the transcript once per sheet-open, not once per flip', async () => {
        state.historyResult = { messages: [{ role: 'ghost', content: 'once', created_at: minutesAgo(1) }] };
        openClaudeSheet({ possessed: true });
        await flush();

        chip().click();
        chip().click();
        await flush();

        expect(state.calls.filter((c) => c && c.history).length).toBe(1);
        expect(rowText()).toEqual(['once']);
    });

    it('opens on a greeting rather than an error when the readback comes back empty', async () => {
        state.historyResult = { messages: [] };
        openClaudeSheet({ possessed: true });
        await flush();

        expect(rows().length).toBe(1);
        expect(GHOST_GREETINGS).toContain(rowText()[0]);
    });

    it('holds a warm reply and greets past the continuation window', async () => {
        state.historyResult = {
            messages: [{ role: 'ghost', content: 'on the edge', created_at: new Date(Date.now() - (GHOST_CONTINUATION_MS - 60000)).toISOString() }],
        };
        openClaudeSheet({ possessed: true });
        await flush();
        expect(rowText()).toEqual(['on the edge']);

        closeClaudeSheet();
        state.historyResult = {
            messages: [{ role: 'ghost', content: 'on the edge', created_at: new Date(Date.now() - (GHOST_CONTINUATION_MS + 60000)).toISOString() }],
        };
        openClaudeSheet({ possessed: true });
        await flush();
        const text = rowText();
        expect(text[0]).toBe('on the edge');
        expect(GHOST_GREETINGS).toContain(text[1]);
    });
});

describe('possession — whispering', () => {
    it('appends optimistically, shows pending, then swaps in the reply', async () => {
        state.historyResult = { messages: [{ role: 'ghost', content: 'earlier', created_at: minutesAgo(2) }] };
        openClaudeSheet({ possessed: true });
        await flush();
        expect(rows().length).toBe(1);

        state.defer = true;
        state.askResult = { reply: 'cold. quiet. fine.' };
        composer().value = 'how is it';
        pressEnter(composer());

        expect(rows().length).toBe(3);
        expect(rows()[1].textContent).toBe('how is it');
        expect(rows()[1].classList.contains('claudeGhostRow--user')).toBe(true);
        const pending = rows()[2];
        expect(pending.classList.contains('claudeGhostRow--pending')).toBe(true);
        expect(pending.querySelectorAll('.ghostTalkDot').length).toBe(3);

        state.pending.forEach((release) => release());
        await flush();

        // The reply lands in the row that was holding its place — no new row.
        expect(rows().length).toBe(3);
        expect(rows()[2]).toBe(pending);
        expect(pending.textContent).toBe('cold. quiet. fine.');
        expect(pending.classList.contains('claudeGhostRow--pending')).toBe(false);
    });

    it('sends `{ghost: true}` with the mobile surface under 1024px', async () => {
        openClaudeSheet({ possessed: true });
        composer().value = 'is it colder over there';
        pressEnter(composer());
        await flush();

        expect(state.calls.find((c) => c && c.message)).toEqual({
            ghost: true,
            message: 'is it colder over there',
            surface: 'mobile',
        });
    });

    it('sends the desktop surface above the breakpoint', async () => {
        setViewport(1280);
        openClaudeSheet({ possessed: true });
        composer().value = 'and up here';
        pressEnter(composer());
        await flush();

        expect(state.calls.find((c) => c && c.message).surface).toBe('desktop');
    });

    it('never lets the greeting reach the worker on any payload', async () => {
        state.historyResult = { messages: [] };
        openClaudeSheet({ possessed: true });
        await flush();

        const greeting = rowText()[0];
        expect(GHOST_GREETINGS).toContain(greeting);

        composer().value = 'what were we saying';
        pressEnter(composer());
        await flush();

        const wire = JSON.stringify(state.calls);
        GHOST_GREETINGS.forEach((line) => expect(wire).not.toContain(line));
    });

    it('keeps the whisper out of the work chat entirely', async () => {
        openClaudeSheet({ possessed: true });
        composer().value = 'between us';
        pressEnter(composer());
        await flush();

        // No work bubble, and no chat-route turn — the two conversations are
        // separate transcripts on separate wires. (The surface still holds its
        // intro note; a whisper doesn't consume that either.)
        expect(workSurface().querySelectorAll('.claudeMsg--user, .claudeMsg--assistant').length).toBe(0);
        expect(document.getElementById('claudeChatIntro')).not.toBeNull();
        expect(state.calls.every((c) => c && c.ghost === true)).toBe(true);
    });

    it('drops a late reply once possession has ended', async () => {
        state.defer = true;
        openClaudeSheet({ possessed: true });
        composer().value = 'still there?';
        pressEnter(composer());

        chip().click();
        state.pending.forEach((release) => release());
        await flush();

        chip().click();
        expect(rowText()).not.toContain('boo');
    });

    it('ignores an empty whisper', () => {
        openClaudeSheet({ possessed: true });
        composer().value = '   ';
        pressEnter(composer());

        expect(state.calls.some((c) => c && c.message)).toBe(false);
        expect(rows().length).toBe(0);
    });

    it('answers in the ghost\'s voice with no wire, and never posts', async () => {
        state.configured = false;
        openClaudeSheet({ possessed: true });
        await flush();

        composer().value = 'hello?';
        pressEnter(composer());
        await flush();

        expect(rowText().slice(-2)).toEqual(['hello?', 'no wire to the other side yet.']);
        expect(state.calls.length).toBe(0);
    });

    it('sends the work chat, not the ghost, when unpossessed', async () => {
        composer().value = 'a real request';
        pressEnter(composer());
        await flush();

        expect(state.calls.some((c) => c && c.ghost)).toBe(false);
        expect(workSurface().querySelectorAll('.claudeMsg').length).toBeGreaterThan(0);
    });
});

describe('possession — styling and wiring', () => {
    const css = read('style.css');
    const rule = (selector, contains = '') => {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = css.match(new RegExp(escaped + '\\s*\\{[^}]*' + contains + '[^}]*\\}'));
        expect(m).not.toBeNull();
        return m[0];
    };

    it('drives the whole identity from one state class on the movable chat body', () => {
        // On the body, not the sheet: the desktop pane adopts this node, and a
        // class on #claudeSheet would stop applying the moment it does.
        expect(css).toMatch(/#claudeSheetBody\.is-possessed #claudeChatSurface\s*\{\s*display:\s*none;\s*\}/);
        expect(rule('#claudeSheetBody.is-possessed .claudeGhostThread', 'display:\\s*flex'))
            .toMatch(/overflow-y:\s*auto/);
    });

    it('hides the model picker, scope chip, attach/image/voice circles and chip rail', () => {
        const hide = css.match(
            /#claudeSheetBody\.is-possessed \.claudeAttach,[\s\S]*?\{\s*display:\s*none;\s*\}/
        );
        expect(hide).not.toBeNull();
        [
            '.claudeImageAttach',
            '#claudeComposerMic',
            '#claudeComposerSendCaret',
            '#claudeComposerModeMenu',
            '#claudeScopeChip',
            '#claudeImageRail',
            '.claudeAttachChip',
        ].forEach((sel) => expect(hide[0]).toContain(sel));
        // …and says who is reading instead.
        expect(rule('#claudeSheetBody.is-possessed .claudeGhostListening', 'display:\\s*inline-flex'))
            .toMatch(/color:\s*#cfc9ff/);
    });

    it('paints the approved ghost row and ghostly composer', () => {
        const ghostRow = rule('.claudeGhostRow--ghost');
        expect(ghostRow).toMatch(/background:\s*#191434/);
        expect(ghostRow).toMatch(/border:\s*1px solid rgba\(122,\s*108,\s*240,\s*0?\.35\)/);
        expect(ghostRow).toMatch(/color:\s*#cfc9ff/);
        expect(rule('.claudeGhostRow--user')).toMatch(/align-self:\s*flex-end/);

        const input = rule('#claudeSheetBody.is-possessed .claudeComposerInput');
        expect(input).toMatch(/box-shadow:\s*inset/);
        // 16px keeps iOS Safari from auto-zooming on focus.
        expect(input).toMatch(/font-size:\s*16px/);
    });

    it('wears the shared pixel sprite on the chip rather than a second asset', () => {
        const chipRule = rule('.claudeGhostChip', 'width:\\s*34px');
        expect(chipRule).toMatch(/background-image:\s*var\(\s*--ghost-sprite\s*\)/);
        expect(chipRule).toMatch(/height:\s*34px/);
        expect(chipRule).toMatch(/image-rendering:\s*pixelated/);
        expect(rule('.claudeGhostChip.is-active')).toMatch(/drop-shadow/);
    });

    it('reaches the worker only through the shared ghost plumbing, never Supabase', () => {
        const js = read('claudeSheet.js');
        expect(js).toMatch(/import\s*\{[\s\S]*?askGhost[\s\S]*?\}\s*from\s*['"]\.\/ghostTalk\.js['"]/);
        expect(js).toMatch(/askGhost\(message,\s*ghostSurface\(\)\)/);
        // The house rule: the sheet has no Supabase access of its own.
        expect(js).not.toMatch(/supabaseClient/);
        expect(js).not.toMatch(/\bsupabase\./);
    });

    it('leaves no trace of the retired standalone modal', () => {
        expect(existsSync(resolve(srcDir, 'ghostModal.js'))).toBe(false);
        expect(existsSync(resolve(here, 'ghostModal.test.js'))).toBe(false);
        ['claudeSheet.js', 'ghostTalk.js', 'style.css'].forEach((file) => {
            expect(read(file)).not.toMatch(/ghostModal/);
        });
    });
});
