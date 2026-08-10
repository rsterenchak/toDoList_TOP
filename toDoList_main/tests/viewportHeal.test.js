import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

// Regression cover for the "band under the mobile tab bar" problem. The first
// three attempts were static CSS patches — how much room the bar reserves,
// what `bottom: 0` resolves against, and a pseudo element painting the raw
// safe-area inset. None of them could work, because the defect is not in the
// bar's box: it is the known iOS standalone-PWA viewport bug. The first time
// the software keyboard opens, the layout viewport shrinks ~59px and stays
// shrunk for the whole session, so a `position: fixed; bottom: 0` bar sits
// 59px above the physical screen edge with the page background showing
// through.
//
// The fourth attempt was the right shape — detect the shrink at runtime and
// force the browser to re-measure by flipping #outerContainer's display with a
// synchronous reflow in between — but measured "short" against the tallest
// viewport seen this session, which is never short in the field: iOS keeps the
// installed app resident, so a launch inside an already-shrunken web process
// seeds the maximum from the shrunken height and the deficit reads zero
// forever. The reference is now the PHYSICAL SCREEN, which the bug cannot
// corrupt.
//
// These tests pin what makes that safe: the standalone gate, an expectation
// derived from `screen` rather than from history, the 24px threshold, the
// launch/resume triggers that need no user action, the reflow landing BETWEEN
// the two display writes, #mainList's scroll surviving the flip, and the
// cooldown that stops a platform where expected legitimately differs from
// actual from flipping in a loop.
//
// ── AND THEN THE VACCINE ──
//
// The document-scrollability probe cured the shrink at its source: a shell
// whose document can scroll is revealed by scrolling, not by resizing, so the
// viewport never shrinks and the deficit reads 0 on the device that used to
// report 59. That turned every intervention above into a misfire — the 140ms
// focusout check lands mid-restore, reads the transient shrunken height, and
// flips `#outerContainer` during the keyboard's dismiss animation — so
// `HEAL_INTERVENTIONS` is now false and the module is telemetry-only.
//
// Both states are covered here, because the intervention code is a revival kit
// rather than dead weight. The SHIPPED state (the constant false) is what
// `loadModule()` gives you, and the telemetry-only describe below pins it:
// measurement lives, acting does not. The intervention describes load a copy
// with the constant rewritten to true — the module imports nothing, so a data
// URL is a faithful copy of it — and every behavior they always asserted still
// holds, which is what proves flipping the constant back actually revives the
// flip, the cooldown and the published deficit.

// Each test arms a fresh copy of the module so the cooldown clock and the
// armed latch start clean; teardown removes that copy's listeners so a later
// test never runs an earlier module instance's handlers.
let teardown = null;

const HEAL_SOURCE = readFileSync(resolve(srcDir, 'viewportHeal.js'), 'utf8');
const GATE_OFF = /const HEAL_INTERVENTIONS = false;/;

// The module as it ships: interventions gated off, telemetry live.
async function loadModule() {
    vi.resetModules();
    return import('../src/viewportHeal.js');
}

// The same module with the one constant flipped, so the intervention behaviors
// are exercised against the real code rather than against a description of it.
// Asserting the substitution landed matters more than it looks: a rename of the
// constant would otherwise leave every intervention test silently running the
// gated-off build and passing vacuously, since "no flip" is what most of them
// would then see as an empty ops array.
async function loadModuleWithInterventions() {
    expect(HEAL_SOURCE).toMatch(GATE_OFF);
    const revived = HEAL_SOURCE.replace(GATE_OFF, 'const HEAL_INTERVENTIONS = true;');
    expect(revived).toMatch(/const HEAL_INTERVENTIONS = true;/);
    vi.resetModules();
    return import(
        'data:text/javascript;base64,' + Buffer.from(revived, 'utf8').toString('base64')
    );
}

function setStandalone(matches) {
    window.matchMedia = function (query) {
        return {
            matches: query === '(display-mode: standalone)' ? matches : false,
            media: query,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
        };
    };
}

function setViewport(width, height) {
    window.innerWidth = width;
    window.innerHeight = height;
}

// iOS's legacy standalone flag. Absent (undefined) everywhere else, including
// jsdom, so the default state of every other test is "not set".
function setNavigatorStandalone(value) {
    Object.defineProperty(window.navigator, 'standalone', {
        configurable: true,
        value: value,
    });
}

// The physical screen the expectation is derived from. Device-native on iOS:
// `width`/`height` do not swap with orientation, so a portrait viewport should
// be `height` tall and a landscape one `width` tall.
function setScreen(width, height) {
    Object.defineProperty(window.screen, 'width', { configurable: true, value: width });
    Object.defineProperty(window.screen, 'height', { configurable: true, value: height });
}

function setVisibility(state) {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get() { return state; },
    });
}

// The app shell the heal operates on: a full-height #outerContainer and the
// independently-scrolling #mainList inside it.
function buildShell() {
    document.body.innerHTML = '';
    const outer = document.createElement('div');
    outer.id = 'outerContainer';
    const list = document.createElement('div');
    list.id = 'mainList';
    outer.appendChild(list);
    document.body.appendChild(outer);
    return { outer, list };
}

// Record the exact sequence of display writes and layout reads on the element,
// so a test can assert the reflow happened while the element was hidden rather
// than merely that both writes occurred.
function instrument(outer) {
    const ops = [];
    const style = outer.style;
    let current = '';
    Object.defineProperty(style, 'display', {
        configurable: true,
        get() { return current; },
        set(v) { current = v; ops.push('display=' + (v === '' ? '<empty>' : v)); },
    });
    Object.defineProperty(outer, 'offsetHeight', {
        configurable: true,
        get() { ops.push('reflow@' + (current === '' ? '<empty>' : current)); return 0; },
    });
    return ops;
}

// Long enough for the launch/resume settle check to have run.
const PAST_LAUNCH_CHECK = 400;

beforeEach(() => {
    vi.useFakeTimers();
    setScreen(390, 844);
    setViewport(390, 844);
    setStandalone(true);
    delete window.visualViewport;
});

afterEach(() => {
    if (teardown) teardown();
    teardown = null;
    vi.useRealTimers();
    delete document.visibilityState;
    delete window.navigator.standalone;
    document.body.innerHTML = '';
    // The fallback lives on the document rather than in module state, so a
    // reset of the module alone would leak it into the next test.
    document.body.classList.remove('vhDeficit');
    document.documentElement.style.removeProperty('--vh-deficit');
});

describe('viewportHeal — the standalone gate', () => {
    it('arms only when the display mode is standalone', async () => {
        const { initViewportHeal } = await loadModule();
        teardown = initViewportHeal();
        expect(typeof teardown).toBe('function');
    });

    it('is inert in a browser tab, where the viewport recovers on its own', async () => {
        setStandalone(false);
        const { initViewportHeal } = await loadModuleWithInterventions();
        expect(initViewportHeal()).toBeNull();

        // Nothing armed means nothing listens: neither a blur after a shrink
        // nor the launch window itself may touch the DOM in Safari.
        const { outer } = buildShell();
        const ops = instrument(outer);
        setViewport(390, 785);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(500);
        expect(ops).toEqual([]);
    });

    it('survives an environment with no matchMedia rather than throwing', async () => {
        delete window.matchMedia;
        const { initViewportHeal } = await loadModule();
        expect(initViewportHeal()).toBeNull();
    });

    it('does not arm twice', async () => {
        const { initViewportHeal } = await loadModule();
        teardown = initViewportHeal();
        expect(initViewportHeal()).toBeNull();
    });

    // The gate is the leading suspect for why four shipped fixes have never
    // been observed working: if the installed iOS container reports the
    // display-mode query as false, every one of them no-ops in silence. Either
    // reading now arms it.
    it('arms on the legacy navigator.standalone flag when display-mode says no', async () => {
        setStandalone(false);
        setNavigatorStandalone(true);
        const { initViewportHeal } = await loadModule();
        teardown = initViewportHeal();
        expect(typeof teardown).toBe('function');
    });

    it('heals normally once armed through the legacy flag', async () => {
        setStandalone(false);
        setNavigatorStandalone(true);
        setScreen(393, 852);
        setViewport(390, 793);

        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        expect(ops).toEqual(['display=none', 'reflow@none', 'display=<empty>']);
    });

    it('stays inert when navigator.standalone is present but false', async () => {
        setStandalone(false);
        setNavigatorStandalone(false);
        const { initViewportHeal } = await loadModule();
        expect(initViewportHeal()).toBeNull();
    });
});

describe('viewportHeal — the status readout', () => {
    it('records both gate readings and armed:false when the gate rejects', async () => {
        // The whole point of the readout: a gate that never passed has to be
        // visible from the device, not inferred from an absence of healing.
        setStandalone(false);
        setNavigatorStandalone(false);
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
        expect(initViewportHeal()).toBeNull();

        const status = getViewportHealStatus();
        expect(status.armed).toBe(false);
        expect(status.displayModeStandalone).toBe(false);
        expect(status.navigatorStandalone).toBe(false);
    });

    it('records which of the two readings let it through', async () => {
        setStandalone(false);
        setNavigatorStandalone(true);
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
        teardown = initViewportHeal();

        const status = getViewportHealStatus();
        expect(status.armed).toBe(true);
        expect(status.displayModeStandalone).toBe(false);
        expect(status.navigatorStandalone).toBe(true);
    });

    it('records the expected height and deficit of the last stuck-check', async () => {
        setScreen(393, 852);
        setViewport(390, 793);
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
        teardown = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        const status = getViewportHealStatus();
        expect(status.expectedHeight).toBe(852);
        expect(status.lastDeficit).toBe(59);
        expect(typeof status.lastCheckAt).toBe('number');
    });

    it('separates heals attempted from heals that actually recovered the viewport', async () => {
        // An attempted-but-ineffective flip is the signature of a platform
        // where expected legitimately differs from actual; counting the two
        // together would hide it.
        setViewport(390, 785);
        const { initViewportHeal, getViewportHealStatus } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        const status = getViewportHealStatus();
        expect(status.healsAttempted).toBe(1);
        expect(status.healsEffective).toBe(0);
    });

    it('counts a flip that recovered the viewport as effective', async () => {
        setViewport(390, 785);
        const { initViewportHeal, getViewportHealStatus } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        Object.defineProperty(outer.style, 'display', {
            configurable: true,
            get() { return this._d || ''; },
            set(v) { this._d = v; if (v === '') window.innerHeight = 844; },
        });

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        const status = getViewportHealStatus();
        expect(status.healsAttempted).toBe(1);
        expect(status.healsEffective).toBe(1);
    });

    it('hands out a copy, so a reader cannot mutate module state', async () => {
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
        teardown = initViewportHeal();

        const first = getViewportHealStatus();
        first.armed = 'tampered';
        expect(getViewportHealStatus().armed).toBe(true);
    });

    it('reports armed:false again after teardown', async () => {
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
        const stop = initViewportHeal();
        expect(getViewportHealStatus().armed).toBe(true);
        stop();
        teardown = null;
        expect(getViewportHealStatus().armed).toBe(false);
    });
});

describe('viewportHeal — the expectation comes from the screen', () => {
    it('heals a session that BOOTS stuck, with no focus event and no user action', async () => {
        // The field case the session-maximum reference could never catch: iOS
        // keeps the installed app resident, so a launch inside an
        // already-shrunken web process starts short and stays short.
        setScreen(393, 852);
        setViewport(390, 793);                   // 59px short from the first frame

        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        expect(ops).toEqual(['display=none', 'reflow@none', 'display=<empty>']);
    });

    it('does not treat a shrink as healthy just because it was there at init', async () => {
        // Same boot-stuck session, now checked through the focusout path: a
        // session maximum seeded at init would read this as a deficit of zero.
        setScreen(393, 852);
        setViewport(390, 793);

        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(ops.length).toBeGreaterThan(0);
    });

    it('compares against screen.width in landscape, where the screen does not rotate', async () => {
        // `screen.width`/`screen.height` are device-native on iOS and do not
        // swap with orientation, so a landscape viewport should be
        // `screen.width` tall — reading `screen.height` there would report a
        // permanent phantom deficit.
        setScreen(390, 844);
        setViewport(844, 390);                   // healthy landscape
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        expect(ops).toEqual([]);

        setViewport(844, 331);                   // now 59px short of screen.width
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);
        expect(ops.length).toBeGreaterThan(0);
    });

    it('stays inert when there is no usable screen to compare against', async () => {
        setScreen(0, 0);
        setViewport(390, 785);
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(ops).toEqual([]);
    });
});

describe('viewportHeal — the stuck threshold', () => {
    it('heals after a blur once the viewport is more than 24px short', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 785);                   // the ~59px iOS shrink
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(ops.length).toBeGreaterThan(0);
    });

    it('never fires while the viewport is within 24px of the screen', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 824);                   // 20px of drift, not the bug
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(ops).toEqual([]);
    });

    it('is a no-op on a session whose viewport matches the screen', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(ops).toEqual([]);
    });

    it('leaves desktop alone even when installed and resized smaller', async () => {
        // A desktop PWA window dragged shorter is a genuine deficit against
        // the screen. The mobile tab bar this exists to reseat is display:none
        // at ≥1024px, so there is nothing to heal and the flip must not run.
        setScreen(1440, 900);
        setViewport(1440, 600);
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(ops).toEqual([]);
    });
});

describe('viewportHeal — the display flip', () => {
    it('forces the reflow BETWEEN the two display writes, then restores', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 785);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        // Hiding without flushing layout, or flushing after the element is
        // already back, both leave the viewport exactly as stuck as before —
        // the ORDER is the whole fix, not the individual writes.
        expect(ops).toEqual(['display=none', 'reflow@none', 'display=<empty>']);
        expect(outer.style.display).toBe('');
    });

    it('waits out the keyboard dismissal rather than measuring mid-animation', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 785);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(100);
        expect(ops).toEqual([]);                 // still settling
        vi.advanceTimersByTime(100);
        expect(ops.length).toBeGreaterThan(0);
    });

    it('does nothing when the shell is absent', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        document.body.innerHTML = '';

        setViewport(390, 785);
        expect(() => {
            document.dispatchEvent(new Event('focusout', { bubbles: true }));
            vi.advanceTimersByTime(500);
        }).not.toThrow();
    });
});

describe('viewportHeal — scroll restoration', () => {
    it('puts #mainList back where it was after the flip', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer, list } = buildShell();

        list.scrollTop = 420;
        // A display flip resets a scroll container to the top in a real
        // browser; model that so the restore is actually exercised.
        Object.defineProperty(outer.style, 'display', {
            configurable: true,
            get() { return this._d || ''; },
            set(v) { this._d = v; if (v === 'none') list.scrollTop = 0; },
        });

        setViewport(390, 785);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(list.scrollTop).toBe(420);
    });
});

describe('viewportHeal — the resume triggers', () => {
    it('checks again when the app comes back visible from the app switcher', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);   // spend the launch check while healthy
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 785);
        setVisibility('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        expect(ops).toEqual(['display=none', 'reflow@none', 'display=<empty>']);
    });

    it('ignores a visibilitychange into the background', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 785);
        setVisibility('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        expect(ops).toEqual([]);
    });

    it('checks again on a bfcache restore', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 785);
        window.dispatchEvent(new Event('pageshow'));
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        expect(ops).toEqual(['display=none', 'reflow@none', 'display=<empty>']);
    });

    it('stops listening after teardown', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        const stop = initViewportHeal();
        stop();
        teardown = null;
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 785);
        window.dispatchEvent(new Event('pageshow'));
        setVisibility('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(1000);

        expect(ops).toEqual([]);
    });
});

describe('viewportHeal — the ineffective-heal cooldown', () => {
    it('refuses to re-flip for 5s after a flip that changed nothing', async () => {
        // iPad windowed standalone is the real case: the layout viewport is
        // legitimately shorter than the screen, so every trigger would look
        // stuck and flip forever. One harmless flip, then back off.
        setViewport(390, 785);
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        expect(ops.length).toBe(3);              // the one allowed flip

        // The deficit is unchanged, so further triggers inside the window are
        // refused even though the viewport still reads as stuck.
        window.dispatchEvent(new Event('pageshow'));
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);
        expect(ops.length).toBe(3);
    });

    it('tries again once the cooldown expires', async () => {
        setViewport(390, 785);
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        expect(ops.length).toBe(3);

        vi.advanceTimersByTime(5000);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(ops.length).toBe(6);
    });

    it('does not arm the cooldown when the flip actually recovered the viewport', async () => {
        setViewport(390, 785);
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = [];
        let current = '';
        Object.defineProperty(outer.style, 'display', {
            configurable: true,
            get() { return current; },
            set(v) {
                current = v;
                ops.push('display=' + (v === '' ? '<empty>' : v));
                // Model the browser re-measuring: restoring the element brings
                // the viewport back to its full height.
                if (v === '') window.innerHeight = 844;
            },
        });
        Object.defineProperty(outer, 'offsetHeight', {
            configurable: true,
            get() { ops.push('reflow@' + (current === '' ? '<empty>' : current)); return 0; },
        });

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        expect(ops.length).toBe(3);

        // A second shrink inside what would have been the cooldown window must
        // still heal, because the first flip worked.
        setViewport(390, 785);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(ops.length).toBe(6);
    });
});

describe('viewportHeal — the stuck-session fallback', () => {
    // Field diagnostics settled what the first four attempts could only guess
    // at: the gate passes, the deficit is real (852 vs 793), the flip runs —
    // and WebKit never re-measures. So the flip keeps first refusal, and what
    // it fails to close is published as a flag: the deficit on the root element
    // and `vhDeficit` on the body. That flag drove a CSS reseat once and no
    // longer does — nothing paints below the shrunken viewport — but the
    // publishing contract is unchanged and the Diagnostics readout depends on
    // it, so it stays pinned exactly as it was.
    function readDeficitVar() {
        return document.documentElement.style.getPropertyValue('--vh-deficit');
    }

    it('flags the session when a flip leaves the deficit exactly where it found it', async () => {
        setScreen(393, 852);
        setViewport(390, 793);                   // the field reading: 59px short
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        expect(document.body.classList.contains('vhDeficit')).toBe(true);
        expect(readDeficitVar()).toBe('59px');
    });

    it('never flags a session whose viewport matches the screen', async () => {
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(document.body.classList.contains('vhDeficit')).toBe(false);
        expect(readDeficitVar()).toBe('');
    });

    it('clears the flag once a later measurement reads healthy', async () => {
        setViewport(390, 785);
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        expect(document.body.classList.contains('vhDeficit')).toBe(true);

        // Whatever recovered it — a force-quit, an orientation change, a flip
        // that finally took — the flag has to come off, or a healthy session
        // keeps reporting a deficit it no longer has.
        setViewport(390, 844);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(document.body.classList.contains('vhDeficit')).toBe(false);
        expect(readDeficitVar()).toBe('');
    });

    it('reconciles on a trigger the cooldown refused to flip on', async () => {
        // The cooldown stops a useless flip repeating; it must not stop the
        // viewport being measured, or a session that recovers during the
        // cooldown window keeps a flag nothing is left to remove.
        setViewport(390, 785);
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        expect(ops.length).toBe(3);
        expect(document.body.classList.contains('vhDeficit')).toBe(true);

        setViewport(390, 844);
        window.dispatchEvent(new Event('pageshow'));
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        expect(ops.length).toBe(3);              // still inside the cooldown
        expect(document.body.classList.contains('vhDeficit')).toBe(false);
    });

    it('refuses a deficit far outside the plausibility band', async () => {
        // 200px is not the iOS shrink. It is a legitimately windowed
        // environment — iPad Stage Manager, a resized installed window — and
        // reporting it as a stuck session would put a number in the readout
        // that means something else entirely.
        setScreen(390, 844);
        setViewport(390, 644);
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        expect(document.body.classList.contains('vhDeficit')).toBe(false);
        expect(readDeficitVar()).toBe('');
    });

    it('refuses a deficit below the band, where the flip is the only remedy', async () => {
        setScreen(390, 844);
        setViewport(390, 815);                   // 29px: over the threshold, under the band
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        expect(ops.length).toBe(3);              // still worth a flip
        expect(document.body.classList.contains('vhDeficit')).toBe(false);
    });

    it('leaves desktop unflagged even at a deficit inside the band', async () => {
        setScreen(1440, 900);
        setViewport(1440, 841);
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        expect(document.body.classList.contains('vhDeficit')).toBe(false);
    });

    it('reports the fallback on both paths through the status readout', async () => {
        setViewport(390, 785);
        const { initViewportHeal, getViewportHealStatus } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        expect(getViewportHealStatus().fallbackActive).toBe(true);
        expect(getViewportHealStatus().fallbackDeficitPx).toBe(59);

        setViewport(390, 844);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);
        expect(getViewportHealStatus().fallbackActive).toBe(false);
        expect(getViewportHealStatus().fallbackDeficitPx).toBeNull();
    });

    it('takes the flag off the document on teardown', async () => {
        setViewport(390, 785);
        const { initViewportHeal, getViewportHealStatus } = await loadModuleWithInterventions();
        const stop = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        expect(document.body.classList.contains('vhDeficit')).toBe(true);

        stop();
        teardown = null;

        expect(document.body.classList.contains('vhDeficit')).toBe(false);
        expect(readDeficitVar()).toBe('');
        expect(getViewportHealStatus().fallbackActive).toBe(false);
    });
});

describe('viewportHeal — the visual-viewport trigger', () => {
    function stubVisualViewport() {
        const listeners = {};
        window.visualViewport = {
            addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
            removeEventListener(type, fn) {
                listeners[type] = (listeners[type] || []).filter(f => f !== fn);
            },
            emit(type) { (listeners[type] || []).slice().forEach(fn => fn()); },
        };
        return window.visualViewport;
    }

    it('heals a keyboard dismissal that never produced a blur', async () => {
        // iOS can close the keyboard via the toolbar's Done button without
        // moving focus, so focusout alone would leave the app stuck.
        const vv = stubVisualViewport();
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 785);
        vv.emit('resize');
        vi.advanceTimersByTime(200);

        expect(ops).toEqual(['display=none', 'reflow@none', 'display=<empty>']);
    });

    it('ignores a resize while a field still holds focus — that is the keyboard opening', async () => {
        const vv = stubVisualViewport();
        const { initViewportHeal } = await loadModuleWithInterventions();
        teardown = initViewportHeal();
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);   // spend the launch check while healthy
        const { outer } = buildShell();
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        const ops = instrument(outer);

        setViewport(390, 785);
        vv.emit('resize');
        vi.advanceTimersByTime(500);

        expect(ops).toEqual([]);
    });

    it('arms without a visualViewport rather than throwing', async () => {
        const { initViewportHeal } = await loadModule();
        expect(() => { teardown = initViewportHeal(); }).not.toThrow();
        expect(typeof teardown).toBe('function');
    });
});

describe('viewportHeal — telemetry-only, as it ships', () => {
    // The scroll-slack vaccine means a genuinely stuck viewport should no
    // longer occur at all. What these pin is what happens when one is MEASURED
    // anyway — which is precisely what the mid-restore misfire looked like from
    // in here, a transient shrunken reading 140ms after a blur: the module
    // records it in full and does nothing else with it.
    function readDeficitVar() {
        return document.documentElement.style.getPropertyValue('--vh-deficit');
    }

    it('ships with the interventions gated off', () => {
        expect(HEAL_SOURCE).toMatch(GATE_OFF);
    });

    it('measures a stuck reading into the status but never flips', async () => {
        setScreen(393, 852);
        setViewport(390, 793);                   // the old field reading: 59px short
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        const status = getViewportHealStatus();
        expect(status.expectedHeight).toBe(852);
        expect(status.lastDeficit).toBe(59);
        expect(typeof status.lastCheckAt).toBe('number');
        expect(ops).toEqual([]);
        expect(status.healsAttempted).toBe(0);
        expect(status.healsEffective).toBe(0);
    });

    it('writes neither the vhDeficit class nor the deficit property', async () => {
        // 59px sits squarely inside the band the flag used to fire in, so this
        // is the reading that would have published one.
        setScreen(393, 852);
        setViewport(390, 793);
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
        teardown = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(document.body.classList.contains('vhDeficit')).toBe(false);
        expect(readDeficitVar()).toBe('');
        expect(getViewportHealStatus().fallbackActive).toBe(false);
        expect(getViewportHealStatus().fallbackDeficitPx).toBeNull();
    });

    it('still measures on every trigger — blur, visual viewport, resume, bfcache', async () => {
        // Diagnostics is the regression tripwire now, so a trigger that quietly
        // stopped measuring would blind the one thing left standing. Each
        // trigger gets its own height so the readout has to have come from that
        // trigger and not from a stale earlier check.
        const listeners = {};
        window.visualViewport = {
            addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
            removeEventListener(type, fn) {
                listeners[type] = (listeners[type] || []).filter(f => f !== fn);
            },
            emit(type) { (listeners[type] || []).slice().forEach(fn => fn()); },
        };
        setScreen(393, 852);
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        setViewport(390, 800);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);
        expect(getViewportHealStatus().lastDeficit).toBe(52);

        setViewport(390, 801);
        window.visualViewport.emit('resize');
        vi.advanceTimersByTime(200);
        expect(getViewportHealStatus().lastDeficit).toBe(51);

        setViewport(390, 802);
        setVisibility('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        expect(getViewportHealStatus().lastDeficit).toBe(50);

        setViewport(390, 803);
        window.dispatchEvent(new Event('pageshow'));
        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        expect(getViewportHealStatus().lastDeficit).toBe(49);

        expect(ops).toEqual([]);
        expect(getViewportHealStatus().healsAttempted).toBe(0);
    });

    it('never engages the cooldown, since nothing is ever flipped', async () => {
        // The cooldown is armed only by an ineffective flip, and its whole
        // effect is to skip work. With no flip to arm it, a session reading
        // stuck on every trigger must keep being measured on every one of them.
        setViewport(390, 785);
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);
        const firstCheck = getViewportHealStatus().lastCheckAt;
        for (let i = 0; i < 3; i += 1) {
            document.dispatchEvent(new Event('focusout', { bubbles: true }));
            vi.advanceTimersByTime(200);
        }
        setViewport(390, 786);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(ops).toEqual([]);
        expect(getViewportHealStatus().healsAttempted).toBe(0);
        expect(getViewportHealStatus().lastDeficit).toBe(58);
        expect(getViewportHealStatus().lastCheckAt).toBeGreaterThan(firstCheck);
    });

    it('keeps the full status shape, so the Diagnostics section needs no change', async () => {
        setViewport(390, 785);
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
        teardown = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        expect(Object.keys(getViewportHealStatus()).sort()).toEqual([
            'armed',
            'displayModeStandalone',
            'expectedHeight',
            'fallbackActive',
            'fallbackDeficitPx',
            'healsAttempted',
            'healsEffective',
            'lastCheckAt',
            'lastDeficit',
            'navigatorStandalone',
        ]);
        expect(getViewportHealStatus().armed).toBe(true);
    });
});

describe('viewportHeal — wiring and the retired CSS patch', () => {
    const index = readFileSync(resolve(srcDir, 'index.js'), 'utf8');
    const css = readFileSync(resolve(srcDir, 'style.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');   // prose names the retired rule

    it('is armed from the app bootstrap', async () => {
        expect(index).toMatch(/import\s*\{\s*initViewportHeal\s*\}\s*from\s*'\.\/viewportHeal\.js'/);
        expect(index).toMatch(/initViewportHeal\(\)/);
    });

    it('arms after the shell is attached, since the heal reads #outerContainer', () => {
        const appendAt = index.indexOf('document.body.appendChild(component())');
        const armAt = index.indexOf('initViewportHeal();');
        expect(appendAt).toBeGreaterThan(-1);
        expect(armAt).toBeGreaterThan(appendAt);
    });

    it('drops the dead safe-area paint-through pseudo-element', () => {
        // With the bar at `bottom: 0` a `top: 100%` pseudo-element hangs
        // entirely below the layout viewport and paints nothing — it never
        // covered the band, and leaving it implies a fix that is not there.
        expect(css).not.toMatch(/#mobileTabBar::after/);
    });

    it('leaves the bar\'s own layout as the prior fixes settled it', () => {
        // Those two decisions were correct and are not what this change is
        // about: the bar still anchors to the viewport bottom and still
        // reserves only the capped inset so the labels stay flush.
        // #mobileTabBar also has a bare `display: none` desktop baseline, so
        // pick the block that actually lays the bar out rather than the first.
        const blocks = [...css.matchAll(/(^|[\s},])#mobileTabBar\s*\{([\s\S]*?)\}/g)]
            .map(m => m[2]);
        const laidOut = blocks.filter(b => /position:\s*fixed\s*;/.test(b));
        expect(laidOut.length).toBe(1);
        expect(laidOut[0]).toMatch(/bottom:\s*0\s*;/);
        expect(laidOut[0]).toMatch(/padding-bottom:\s*var\(--mobile-bottom-inset[^)]*\)/);
    });

    // The reseat is retired. WebKit composites the stuck session onto a surface
    // exactly as tall as the SHRUNKEN layout viewport, so an element pushed
    // below that line does not move down — it stops rendering. The device
    // screenshot showed the reseated tab bar down to its 2px active-tab
    // indicator with the icons and labels gone. Every bottom-fixed element
    // therefore keeps its base anchor in a stuck session, and the ban is pinned
    // here because the reseat is an intuitive thing to re-derive from the bug
    // report alone.
    it('reseats no bottom-fixed element below the effective viewport', () => {
        [
            '#mobileTabBar',
            '#claudeLauncher',
            '#bottomSheet\\[data-state="IDLE"\\]',
            '#bottomSheet\\[data-state="PEEK"\\]',
            '#undoToast',
            '#mobileUpdatePill',
        ].forEach((selector) => {
            const rule = new RegExp(
                'body\\.vhDeficit\\s+' + selector + '[^{]*\\{[^}]*bottom:'
            );
            expect(css, selector + ' still carries a vhDeficit reseat').not.toMatch(rule);
        });
        // Belt and braces: no rule anywhere subtracts the published deficit.
        expect(css).not.toMatch(/-\s*var\(--vh-deficit/);
    });

    it('leaves the stretched overlays alone, per the entry', () => {
        // EXPANDED and the chat sheet are full-height, not bottom-anchored:
        // they would need a height correction, and they are out of scope for
        // the same reason the reseat was abandoned — nothing paints down there.
        expect(css).not.toMatch(/body\.vhDeficit\s+#bottomSheet\[data-state="EXPANDED"\]/);
        expect(css).not.toMatch(/body\.vhDeficit\s+#claudeSheet/);
    });

    // With no reseat, the fallback's whole job is that the un-paintable strip
    // below the bar reads as intentional. The bar paints no box-shadow, so
    // nothing is sheared flat at the surface boundary — add a downward shadow
    // to the bar and this fails, which is the moment `body.vhDeficit` needs a
    // suppression rule.
    //
    // The canvas token this once pinned to --bg-elevated (matching the bar's
    // surface) is now --bg-base, per the entry that measured the OS shading
    // over the bar's bottom ~30px and found it landing on base: a base band
    // continues that shading rather than stepping away from it at the hard cut.
    // mobileCanvasBand.test.js owns that declaration; here we only pin that the
    // bar keeps its elevated surface and its no-shadow premise.
    it('leaves the tab bar meeting the canvas with no shadow to shear', () => {
        const barBlocks = [...css.matchAll(/(^|[\s},])#mobileTabBar\s*\{([\s\S]*?)\}/g)]
            .map(m => m[2]);
        const laidOut = barBlocks.filter(b => /position:\s*fixed\s*;/.test(b))[0];
        expect(laidOut).toBeTruthy();
        expect(laidOut).not.toMatch(/box-shadow/);
        expect(laidOut).toMatch(/background:\s*var\(--bg-elevated\)/);

        // The canvas the OS extends into the strip comes from `body` on this
        // breakpoint, and it paints --bg-base so the band continues the
        // system shading's landing colour.
        const bodyBlocks = [...css.matchAll(/(^|[\s},])body\s*\{([\s\S]*?)\}/g)].map(m => m[2]);
        const mobileBody = bodyBlocks.filter(b => /min-height:\s*100dvh/.test(b))[0];
        expect(mobileBody).toBeTruthy();
        expect(mobileBody).toMatch(/background:\s*var\(--bg-base\)/);
    });
});
