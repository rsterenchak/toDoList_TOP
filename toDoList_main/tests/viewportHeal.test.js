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

// Each test arms a fresh copy of the module so the cooldown clock and the
// armed latch start clean; teardown removes that copy's listeners so a later
// test never runs an earlier module instance's handlers.
let teardown = null;

async function loadModule() {
    vi.resetModules();
    return import('../src/viewportHeal.js');
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
});

describe('viewportHeal — the standalone gate', () => {
    it('arms only when the display mode is standalone', async () => {
        const { initViewportHeal } = await loadModule();
        teardown = initViewportHeal();
        expect(typeof teardown).toBe('function');
    });

    it('is inert in a browser tab, where the viewport recovers on its own', async () => {
        setStandalone(false);
        const { initViewportHeal } = await loadModule();
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

        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
        teardown = initViewportHeal();
        buildShell();

        vi.advanceTimersByTime(PAST_LAUNCH_CHECK);

        const status = getViewportHealStatus();
        expect(status.healsAttempted).toBe(1);
        expect(status.healsEffective).toBe(0);
    });

    it('counts a flip that recovered the viewport as effective', async () => {
        setViewport(390, 785);
        const { initViewportHeal, getViewportHealStatus } = await loadModule();
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

        const { initViewportHeal } = await loadModule();
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

        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 785);                   // the ~59px iOS shrink
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(ops.length).toBeGreaterThan(0);
    });

    it('never fires while the viewport is within 24px of the screen', async () => {
        const { initViewportHeal } = await loadModule();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 824);                   // 20px of drift, not the bug
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(ops).toEqual([]);
    });

    it('is a no-op on a session whose viewport matches the screen', async () => {
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
        const { initViewportHeal } = await loadModule();
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
});
