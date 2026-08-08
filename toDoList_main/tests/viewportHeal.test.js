import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

// Regression cover for the FOURTH and final iteration of the "band under the
// mobile tab bar" problem. The first three were static CSS patches — how much
// room the bar reserves, what `bottom: 0` resolves against, and a pseudo
// element painting the raw safe-area inset. None of them could work, because
// the defect is not in the bar's box: it is the known iOS standalone-PWA
// viewport bug. The first time the software keyboard opens, the layout
// viewport shrinks ~59px and stays shrunk for the whole session, so a
// `position: fixed; bottom: 0` bar sits 59px above the physical screen edge
// with the page background showing through.
//
// The fix is a runtime one: detect that the viewport is shorter than its
// session maximum and force the browser to re-measure by flipping
// #outerContainer's display with a synchronous reflow in between. These tests
// pin the four properties that make that safe — the standalone gate, the
// stuck threshold, the reflow landing BETWEEN the two display writes, and
// #mainList's scroll surviving the flip.

// Each test arms a fresh copy of the module so `maxViewportHeight` and the
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

beforeEach(() => {
    vi.useFakeTimers();
    setViewport(390, 844);
    setStandalone(true);
    delete window.visualViewport;
});

afterEach(() => {
    if (teardown) teardown();
    teardown = null;
    vi.useRealTimers();
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

        // Nothing armed means nothing listens: a blur after a shrink must not
        // touch the DOM at all in Safari.
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
});

describe('viewportHeal — the stuck threshold', () => {
    it('heals after a blur once the viewport is more than 4px short', async () => {
        const { initViewportHeal } = await loadModule();
        teardown = initViewportHeal();          // records the 844px maximum
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 785);                   // the ~59px iOS shrink
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(ops.length).toBeGreaterThan(0);
    });

    it('never fires while the viewport is within 4px of its session max', async () => {
        const { initViewportHeal } = await loadModule();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(390, 841);                   // 3px of drift, not the bug
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(ops).toEqual([]);
    });

    it('is a no-op on a fresh session that has not shrunk at all', async () => {
        const { initViewportHeal } = await loadModule();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(500);

        expect(ops).toEqual([]);
    });

    it('tracks the session maximum across resizes, so a taller viewport rebases it', async () => {
        const { initViewportHeal } = await loadModule();
        teardown = initViewportHeal();
        const { outer } = buildShell();

        // Rotate/expand to a taller viewport, then come back to the original
        // height: relative to the NEW maximum that is now a shrink.
        setViewport(390, 900);
        window.dispatchEvent(new Event('resize'));
        setViewport(390, 844);
        const ops = instrument(outer);
        document.dispatchEvent(new Event('focusout', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(ops.length).toBeGreaterThan(0);
    });

    it('leaves desktop alone even when installed and resized smaller', async () => {
        // A desktop PWA window dragged shorter looks "stuck" by height alone.
        // The mobile tab bar this exists to reseat is display:none at ≥1024px,
        // so there is nothing to heal and the flip must not run.
        const { initViewportHeal } = await loadModule();
        teardown = initViewportHeal();
        const { outer } = buildShell();
        const ops = instrument(outer);

        setViewport(1440, 600);
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
