import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Desktop possession — the wandering companion IS the door.
//
// On desktop the pane at rest carries no ghost affordance: the sheet's ghost
// chip is hidden at this breakpoint, so the only way in (and one of two ways
// out, with the RUNS tab) is clicking the sprite. That makes two contracts
// load-bearing here.
//
// First, the click has to work both directions off ONE target. A click that
// only ever entered possession would strand the ghost in the pane with no
// desktop way back, and the failure looks like nothing at all — the pane simply
// stays possessed.
//
// Second, the perch follows the STATE, not the click: docking hangs off the
// possession event claudeSheet fires, so a flip from the RUNS tab or a sheet
// close moves the sprite too. Wiring it to the click instead would leave the
// ghost perched on a pane that had already handed itself back — visually
// identical to the ghost still being there.
//
// inject.js is mocked so the ghost's Worker calls resolve with no network and
// no configured Worker.

const { state } = vi.hoisted(() => ({
    state: {
        configured: true,
        calls: [],
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
            return Promise.resolve(isHistory ? state.historyResult : state.askResult);
        }),
    };
});

import {
    mountClaudeSheet,
    closeClaudeSheet,
    isSheetPossessed,
} from '../src/claudeSheet.js';
import { ensureCompanion, destroyCompanion } from '../src/companion.js';
import { ensureDesktopGhostPossession } from '../src/main.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

// jsdom answers `matches: false` to everything, which would bar the desktop
// gate the companion (and this whole feature) runs behind.
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

function setViewport(width, height = 900) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
}

// jsdom measures nothing, so the pane reports the box a real layout would.
function stubPaneRect(el, rect) {
    el.getBoundingClientRect = () => ({
        left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height,
        width: rect.width, height: rect.height, x: rect.left, y: rect.top,
    });
}

// The glide runs on rAF. jsdom's is 16ms-timer-backed, so a case waiting on it
// would be a real-time sleep of half a second; this puts frames on the
// macrotask queue instead, making `settleGlide` a deterministic wait rather
// than a guess at how many milliseconds the ease takes.
function stubFrames() {
    const real = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
    globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    return function restore() {
        globalThis.requestAnimationFrame = real.raf;
        globalThis.cancelAnimationFrame = real.caf;
    };
}

async function settleGlide(n = 120) {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

const sprite = () => document.getElementById('companion');
const hit = () => document.getElementById('companionHit');
const chip = () => document.getElementById('claudeGhostChip');
const body = () => document.getElementById('claudeSheetBody');
const composer = () => document.getElementById('claudeComposerInput');
const rows = () => Array.from(document.querySelectorAll('.claudeGhostRow'));
const spritePos = () => ({ x: parseFloat(sprite().style.left), y: parseFloat(sprite().style.top) });

let pane;
let companion;
let restoreFrames = null;

// The full desktop shell the feature runs in: the chat pane the sheet's content
// relocates into, the sheet itself, a mounted companion, and the glue wired.
function mountDesktop({ reducedMotion = false } = {}) {
    stubMatchMedia({ desktop: true, reducedMotion });
    pane = document.createElement('div');
    pane.id = 'desktopChatPane';
    stubPaneRect(pane, { left: 1000, top: 100, width: 440, height: 800 });
    document.body.appendChild(pane);
    mountClaudeSheet(document.body);
    companion = ensureCompanion();
    ensureDesktopGhostPossession();
    return companion;
}

beforeEach(() => {
    state.configured = true;
    state.calls = [];
    state.historyResult = null;
    state.askResult = { reply: 'boo' };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setViewport(1440);
    localStorage.clear();
    localStorage.setItem('todoapp_companion_enabled', 'true');
    document.body.innerHTML = '';
    document.body.className = '';
});

afterEach(() => {
    closeClaudeSheet();
    destroyCompanion();
    companion = null;
    if (restoreFrames) { restoreFrames(); restoreFrames = null; }
    document.body.innerHTML = '';
    document.body.className = '';
    vi.restoreAllMocks();
});

describe('desktop possession — the companion is the door', () => {
    it('mounts the sprite and leaves the pane unpossessed at rest', () => {
        mountDesktop();
        expect(sprite()).not.toBeNull();
        expect(isSheetPossessed()).toBe(false);
        expect(body().classList.contains('is-possessed')).toBe(false);
    });

    it('clicking the sprite while unpossessed possesses the pane', () => {
        mountDesktop();
        hit().click();

        expect(isSheetPossessed()).toBe(true);
        expect(body().classList.contains('is-possessed')).toBe(true);
        expect(composer().placeholder).toBe('whisper something…');
    });

    it('clicking it again releases the pane back to the work chat', () => {
        mountDesktop();
        hit().click();
        hit().click();

        expect(isSheetPossessed()).toBe(false);
        expect(body().classList.contains('is-possessed')).toBe(false);
        expect(composer().placeholder).toBe('Ask Claude…');
    });

    it('uncollapses a collapsed pane on the way in, so possession is never hidden', () => {
        mountDesktop();
        document.body.classList.add('chatPaneCollapsed');

        hit().click();

        expect(document.body.classList.contains('chatPaneCollapsed')).toBe(false);
        expect(isSheetPossessed()).toBe(true);
    });

    it('lands on the CHAT tab, and the RUNS tab is the other way out', () => {
        mountDesktop();
        document.getElementById('claudeTabRuns').click();
        hit().click();

        expect(document.getElementById('claudeSheet').getAttribute('data-tab')).toBe('chat');
        expect(isSheetPossessed()).toBe(true);

        document.getElementById('claudeTabRuns').click();
        expect(isSheetPossessed()).toBe(false);
    });

    it('carries a whisper round-trip through the possessed pane, named as the desktop surface', async () => {
        mountDesktop();
        hit().click();
        await flush();

        composer().value = 'are you cold';
        composer().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await flush();

        const ask = state.calls.find((c) => c && c.message);
        expect(ask).toEqual({ ghost: true, message: 'are you cold', surface: 'desktop' });
        expect(rows().map((r) => r.textContent).slice(-2)).toEqual(['are you cold', 'boo']);
    });

    it('wires the glue at boot rather than leaving the sprite inert', () => {
        const js = read('main.js');
        expect(js).toMatch(/setTimeout\(ensureDesktopGhostPossession,\s*0\)/);
        expect(js).toMatch(/onCompanionActivate\(/);
        expect(js).toMatch(/openClaudeSheet\(\{\s*possessed:\s*true\s*\}\)/);
        // The retired floating skin's bootstrap is gone with it.
        expect(js).not.toMatch(/ensureGhostTalk/);
    });
});

describe('desktop possession — the sprite docks on the pane', () => {
    it('docks on possession and releases on the way out', () => {
        mountDesktop();
        const dock = vi.spyOn(companion, 'dock');
        const release = vi.spyOn(companion, 'release');

        hit().click();
        expect(dock).toHaveBeenCalledTimes(1);
        expect(dock.mock.calls[0][0]).toBe(pane);
        expect(companion.isDocked()).toBe(true);

        hit().click();
        expect(release).toHaveBeenCalledTimes(1);
        expect(companion.isDocked()).toBe(false);
    });

    it('follows a flip that came from somewhere other than the sprite', () => {
        mountDesktop();
        hit().click();
        expect(companion.isDocked()).toBe(true);

        // The RUNS tab exits possession without touching the companion. The
        // perch has to come off with it or the ghost sits on a pane it has
        // already left.
        document.getElementById('claudeTabRuns').click();
        expect(companion.isDocked()).toBe(false);

        // Same for a sheet close.
        document.getElementById('claudeTabChat').click();
        hit().click();
        expect(companion.isDocked()).toBe(true);
        closeClaudeSheet();
        expect(companion.isDocked()).toBe(false);
    });

    it('glides to the pane\'s rim and holds there', async () => {
        restoreFrames = stubFrames();
        mountDesktop();
        hit().click();
        await settleGlide();

        // Straddling the pane's left edge (half the 48px sprite over it), just
        // below its top edge.
        expect(spritePos()).toEqual({ x: 1000 - 24, y: 100 + 18 });
        expect(companion.isFrozen()).toBe(true);
    });

    it('re-measures the rim when the window resizes under a docked ghost', async () => {
        restoreFrames = stubFrames();
        mountDesktop();
        hit().click();
        await settleGlide();

        stubPaneRect(pane, { left: 800, top: 60, width: 440, height: 700 });
        window.dispatchEvent(new Event('resize'));

        expect(spritePos()).toEqual({ x: 800 - 24, y: 60 + 18 });
    });

    it('stops re-measuring once released', async () => {
        restoreFrames = stubFrames();
        mountDesktop();
        hit().click();
        await settleGlide();
        hit().click();

        const parked = spritePos();
        stubPaneRect(pane, { left: 200, top: 500, width: 440, height: 300 });
        window.dispatchEvent(new Event('resize'));

        expect(spritePos()).toEqual(parked);
    });

    it('places the sprite without a glide under reduced motion', () => {
        mountDesktop({ reducedMotion: true });
        hit().click();

        // No frames waited: reduced motion is expected to land it outright.
        expect(spritePos()).toEqual({ x: 1000 - 24, y: 100 + 18 });
    });

    it('releases the wander from the docked position rather than teleporting', async () => {
        mountDesktop({ reducedMotion: true });
        hit().click();
        const perched = spritePos();

        hit().click();

        expect(companion.isFrozen()).toBe(false);
        expect(spritePos()).toEqual(perched);
    });

    it('holds the perch through a mouseleave, which would otherwise resume the wander', () => {
        mountDesktop({ reducedMotion: true });
        hit().click();

        hit().dispatchEvent(new MouseEvent('mouseleave'));

        expect(companion.isFrozen()).toBe(true);
        expect(companion.isDocked()).toBe(true);
    });

    it('possesses even with the floating ghost turned off, with nothing to perch', () => {
        localStorage.setItem('todoapp_companion_enabled', 'false');
        stubMatchMedia({ desktop: true });
        pane = document.createElement('div');
        pane.id = 'desktopChatPane';
        document.body.appendChild(pane);
        mountClaudeSheet(document.body);
        ensureDesktopGhostPossession();

        expect(ensureCompanion()).toBeNull();
        expect(sprite()).toBeNull();
        // The chip is the fallback door when there is no sprite to click; it
        // must still flip a pane that has no companion to dock.
        expect(() => chip().click()).not.toThrow();
        expect(isSheetPossessed()).toBe(true);
    });
});

describe('desktop possession — the chip is mobile\'s door only', () => {
    const css = read('style.css');

    // The hide lives inside the desktop chat-pane block. Brace-match that block
    // so "is it gated behind the desktop breakpoint" is answered by the rule's
    // actual enclosure rather than by its distance from a media query.
    function desktopPaneBlock() {
        // Anchored on a selector that exists ONLY inside that block — the bare
        // `#desktopChatPane {` also appears as a top-level rule, and walking
        // back from that one lands in an unrelated desktop query.
        const anchor = css.indexOf('#desktopChatPane #claudeSheetTabs {');
        expect(anchor).toBeGreaterThan(-1);
        const open = css.lastIndexOf('@media (min-width: 1024px) {', anchor);
        expect(open).toBeGreaterThan(-1);
        let depth = 0;
        for (let i = css.indexOf('{', open); i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}' && --depth === 0) return css.slice(open, i + 1);
        }
        throw new Error('unterminated desktop block');
    }

    it('hides the ghost chip at the desktop breakpoint', () => {
        expect(desktopPaneBlock()).toMatch(/\.claudeGhostChip \{ display: none; \}/);
    });

    it('leaves the chip visible below it, and the listening indicator on both', () => {
        // No hide on the chip ANYWHERE but inside that desktop block — the
        // mobile door is the same element, so a rule outside it would take
        // mobile's only entry point with it.
        // Comments stripped first: the stylesheet names the chip in prose
        // several times, and a prose hit would pair with whatever rule happened
        // to follow it.
        const rest = css.replace(desktopPaneBlock(), '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(rest).not.toMatch(/\.claudeGhostChip[^{]*\{[^}]*display:\s*none/);
        // The indicator only renders while possessed, so it needs no gate.
        expect(css).toMatch(/#claudeSheetBody\.is-possessed \.claudeGhostListening \{/);
    });

    it('still builds the chip at every breakpoint, so the gate is presentational', () => {
        // Hiding it in CSS rather than skipping the build keeps one DOM shape
        // across the breakpoint the chat content is relocated over.
        setViewport(1440);
        mountDesktop();
        expect(chip()).not.toBeNull();
    });
});
