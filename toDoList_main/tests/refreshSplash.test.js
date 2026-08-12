import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    REFRESH_FLAG_KEY,
    buildRefreshSplash,
    dismissRefreshSplash,
    initRefreshSplash,
    mountRefreshSplash,
    requestAppReload,
} from '../src/main.js';

// The refresh splash spans a document boundary, which no single element can do:
// tapping the mobile refresh chip tears the old document down and the new one
// boots through an empty <body>. Two halves paint the same picture instead —
// the overlay requestAppReload() mounts before reloading, and the inline twin in
// template.html that the new document paints at literal first paint. The
// `todoapp_refreshing` sessionStorage flag is the baton between them, and the
// new document's head script reads AND clears it so an abandoned session can
// never leak the splash into a normal launch.
//
// The template half runs against built HTML at a moment jsdom never reaches
// (before the bundle exists), so it is pinned with source-pattern assertions,
// matching bootWatchdog.test.js. The main.js half is exercised for real.
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Our reload is deferred by a double rAF. A double-rAF chain queued afterwards
// always settles behind it, so this is a deterministic wait, not a sleep.
function flushFrames() {
    return new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
}

function resetSplashState() {
    document.body.innerHTML = '';
    document.documentElement.classList.remove('refreshing');
    sessionStorage.clear();
}

describe('refresh splash — old document half', () => {
    const realLocation = window.location;
    let reload;

    beforeEach(() => {
        resetSplashState();
        reload = vi.fn();
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: { reload },
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: realLocation,
        });
        resetSplashState();
    });

    it('mounts the overlay and sets the hand-off flag BEFORE the reload commits', async () => {
        requestAppReload();
        // Everything the splash needs is in place synchronously; only the
        // navigation waits for a painted frame.
        const splash = document.getElementById('refreshSplash');
        expect(splash).not.toBeNull();
        expect(document.documentElement.classList.contains('refreshing')).toBe(true);
        expect(sessionStorage.getItem(REFRESH_FLAG_KEY)).toBe('1');
        expect(reload).not.toHaveBeenCalled();

        await flushFrames();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('paints one splash on a double tap', () => {
        const first = mountRefreshSplash();
        const second = mountRefreshSplash();
        expect(second).toBe(first);
        expect(document.querySelectorAll('#refreshSplash')).toHaveLength(1);
    });

    it('reloads anyway when sessionStorage is denied', async () => {
        const realSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new Error('denied'); };
        try {
            requestAppReload();
            await flushFrames();
            expect(reload).toHaveBeenCalledTimes(1);
        } finally {
            Storage.prototype.setItem = realSetItem;
        }
    });

    it('never touches the service worker — the update pill owns that path', async () => {
        // HARD BOUNDARY: the splash is cosmetic and the reload is plain. No
        // postMessage, no skipWaiting, no registration lookup.
        const swCalls = [];
        const realSW = navigator.serviceWorker;
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            get() { swCalls.push('accessed'); return realSW; },
        });
        try {
            requestAppReload();
            await flushFrames();
            expect(swCalls).toEqual([]);
        } finally {
            Object.defineProperty(navigator, 'serviceWorker', {
                configurable: true,
                value: realSW,
            });
        }
    });
});

describe('refresh splash — the overlay element', () => {
    let splash;

    beforeEach(() => {
        resetSplashState();
        splash = buildRefreshSplash();
    });

    afterEach(resetSplashState);

    it('is decorative — no text, out of the accessibility tree', () => {
        expect(splash.id).toBe('refreshSplash');
        expect(splash.getAttribute('aria-hidden')).toBe('true');
        expect(splash.textContent.trim()).toBe('');
    });

    it('renders the reload glyph large and stroked in currentColor', () => {
        const glyph = splash.querySelector('.refreshSplashGlyph');
        expect(glyph).not.toBeNull();
        const svg = glyph.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg.getAttribute('stroke')).toBe('currentColor');
        expect(svg.getAttribute('fill')).toBe('none');
        // Splash scale, not chip scale — the same mark blown up.
        expect(svg.getAttribute('width')).toBe('64');
        expect(svg.getAttribute('height')).toBe('64');
    });
});

describe('refresh splash — dismissal', () => {
    beforeEach(() => {
        resetSplashState();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        resetSplashState();
    });

    it('arms nothing on a normal launch', () => {
        // No `refreshing` class means this document never painted a splash, so
        // no listener is registered and no failsafe timer is scheduled.
        expect(initRefreshSplash()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('fades the splash out on hydration, then removes it and the gate class', () => {
        mountRefreshSplash();
        expect(initRefreshSplash()).toBe(true);

        document.dispatchEvent(new CustomEvent('listLogicHydrated'));
        // Fading first — the node must survive long enough to animate.
        const splash = document.getElementById('refreshSplash');
        expect(splash).not.toBeNull();
        expect(splash.classList.contains('refreshSplashFading')).toBe(true);

        vi.advanceTimersByTime(200);
        expect(document.getElementById('refreshSplash')).toBeNull();
        expect(document.documentElement.classList.contains('refreshing')).toBe(false);
    });

    it('dismisses via the 8s failsafe when hydration never arrives', () => {
        // A signed-out session or an offline hydrate never dispatches the
        // event; without this the user is trapped behind the splash.
        mountRefreshSplash();
        initRefreshSplash();

        vi.advanceTimersByTime(7999);
        expect(document.getElementById('refreshSplash')).not.toBeNull();

        vi.advanceTimersByTime(1);
        expect(
            document.getElementById('refreshSplash').classList.contains('refreshSplashFading')
        ).toBe(true);
        vi.advanceTimersByTime(200);
        expect(document.getElementById('refreshSplash')).toBeNull();
        expect(document.documentElement.classList.contains('refreshing')).toBe(false);
    });

    it('cancels the failsafe once hydration has dismissed the splash', () => {
        mountRefreshSplash();
        initRefreshSplash();
        document.dispatchEvent(new CustomEvent('listLogicHydrated'));
        vi.advanceTimersByTime(200);
        expect(document.getElementById('refreshSplash')).toBeNull();

        // Nothing left pending that could tear down a splash the user mounts
        // later in the same session.
        vi.advanceTimersByTime(10000);
        expect(document.getElementById('refreshSplash')).toBeNull();
    });

    it('is idempotent — repeat dismissals neither throw nor double-remove', () => {
        mountRefreshSplash();
        dismissRefreshSplash();
        dismissRefreshSplash();
        dismissRefreshSplash();
        vi.advanceTimersByTime(200);
        expect(document.getElementById('refreshSplash')).toBeNull();
        expect(document.documentElement.classList.contains('refreshing')).toBe(false);

        // And with nothing mounted at all — every normal launch takes this path.
        expect(() => dismissRefreshSplash()).not.toThrow();
    });
});

describe('refresh splash — new document half in template.html', () => {
    const html = read('template.html');
    const main = read('main.js');

    it('ships the splash markup in the body', () => {
        expect(html).toMatch(/<div id="refreshSplash"[^>]*aria-hidden="true"/);
        expect(html).toMatch(/class="refreshSplashGlyph"/);
    });

    it('carries its own inline styles so it is correct at first paint', () => {
        // style.css arrives via style-loader, i.e. only after the bundle
        // evaluates — far too late for the first frame of a reload.
        expect(html).toMatch(/#refreshSplash\s*\{[^}]*position:\s*fixed/);
        expect(html).toMatch(/#refreshSplash\s*\{[^}]*inset:\s*0/);
        expect(html).toMatch(/#refreshSplash\s*\{[^}]*background:\s*var\(--bg-base/);
        expect(html).toMatch(/#refreshSplash\s+\.refreshSplashGlyph\s*\{[^}]*animation:\s*refreshSplashSpin/);
        expect(html).toMatch(/@keyframes\s+refreshSplashSpin\s*\{/);
    });

    it('shows only under the `refreshing` gate, so normal launches see nothing', () => {
        expect(html).toMatch(/#refreshSplash\s*\{[^}]*display:\s*none/);
        expect(html).toMatch(/html\.refreshing\s+#refreshSplash\s*\{\s*display:\s*flex/);
    });

    it('reads AND clears the hand-off flag, gating the class on it', () => {
        const script = html.slice(html.indexOf("var KEY = 'todoapp_refreshing'"));
        expect(script).toMatch(/sessionStorage\.getItem\(KEY\)/);
        expect(script).toMatch(/sessionStorage\.removeItem\(KEY\)/);
        // The class is applied only when the flag was actually present — a
        // reload that never completed must not arm the next launch.
        expect(script).toMatch(/if\s*\(flag\)\s*document\.documentElement\.className\s*\+=\s*' refreshing'/);
        // Read-before-clear: reversing these would always yield null.
        expect(script.indexOf('getItem')).toBeLessThan(script.indexOf('removeItem'));
    });

    it('pauses the spin for prefers-reduced-motion rather than hiding the glyph', () => {
        const rm = html.slice(html.indexOf('@media (prefers-reduced-motion: reduce)'));
        expect(rm).toMatch(/#refreshSplash\s+\.refreshSplashGlyph\s*\{\s*animation:\s*none/);
    });

    it('stays below the boot watchdog in the stacking order', () => {
        // A failed boot's recovery prompt must still win over a stale splash.
        const splashZ = Number(html.match(/z-index:\s*(\d+);[\s\S]{0,200}?display:\s*none/)[1]);
        expect(splashZ).toBeLessThan(2147483647);
        expect(html).toContain('z-index:2147483647');
    });

    it('draws the same glyph the bundle draws', () => {
        // template.html cannot import reloadGlyphSvg — it has to paint before
        // the bundle exists — so the copy is hand-kept and pinned here.
        const paths = main.match(/<path d="[^"]+"\/>/g);
        expect(paths).not.toBeNull();
        const unique = [...new Set(paths)].filter(p => p.includes('M19.5 12') || p.includes('M17.3 2.5'));
        expect(unique).toHaveLength(2);
        unique.forEach(p => expect(html).toContain(p));
    });
});

describe('refresh splash — boot wiring in main.js', () => {
    const main = read('main.js');

    it('dismisses on the existing hydration event', () => {
        expect(main).toMatch(
            /addEventListener\(\s*'listLogicHydrated'\s*,\s*dismissRefreshSplash\s*\)/
        );
    });

    it('arms the wiring at module scope so the new document dismisses itself', () => {
        expect(main).toMatch(/if \(typeof document !== 'undefined' && typeof window !== 'undefined'\) \{\n    initRefreshSplash\(\);/);
    });

    it('defers the reload behind two frames', () => {
        const fn = main.match(/export function requestAppReload\(\)[\s\S]*?\n}/)[0];
        expect(fn).toMatch(/requestAnimationFrame\([\s\S]*requestAnimationFrame\(/);
        expect(fn).toMatch(/mountRefreshSplash\(\)/);
        expect(fn).toMatch(/sessionStorage\.setItem\(REFRESH_FLAG_KEY/);
        // Still not an update path.
        expect(fn).not.toMatch(/skipWaiting|SKIP_WAITING|postMessage|serviceWorker/);
    });
});
