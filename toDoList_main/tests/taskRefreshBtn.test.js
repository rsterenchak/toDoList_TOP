import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildTaskRefreshBtn, requestAppReload } from '../src/main.js';

// Standalone (installed) mode has no browser chrome, so there is no reload
// button and no way to refresh short of force-quitting the app. #taskRefreshBtn
// restores plain Safari refresh semantics as a chip in the filter bar's right
// cluster, DOM-ordered between the blocked-count chip and the Sort trigger, and
// CSS-gated to the mobile breakpoint (mounted unconditionally, since the bar is
// shared across breakpoints and relocated by desktopHeaderPlacement.js).
//
// The reload is deliberately NOT an update path: activating the chip must never
// message the service worker or call skipWaiting — the update pill in
// index.js / mobileUpdatePill.js stays the sole activation route for a waiting
// worker. The boundary is pinned below.
//
// jsdom cannot spy on window.location.reload (the property is non-configurable),
// so the tests swap window.location for a stub object and restore it after —
// activation is asserted, no navigation happens.
//
// The reload is deferred by a double requestAnimationFrame so the refresh
// splash is guaranteed a painted frame before the navigation commits (see
// refreshSplash.test.js), hence the flushFrames() awaits below. Our own frame
// callbacks are registered first, so a double-rAF chain queued afterwards
// always settles behind them — the wait is deterministic, not a sleep.
const here = dirname(fileURLToPath(import.meta.url));

function flushFrames() {
    return new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
}
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function extractMobileRule(css, selector) {
    // Grab the declaration block for `selector` inside the first
    // `@media (max-width: 1023px)` block — same naive parse the other
    // mobile-layout tests in this suite use.
    const media = css.indexOf('@media (max-width: 1023px)');
    expect(media).toBeGreaterThan(-1);
    let mediaEnd = css.length;
    let depth = 0;
    for (let i = css.indexOf('{', media); i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') {
            depth--;
            if (depth === 0) { mediaEnd = i; break; }
        }
    }
    const haystack = css.slice(media, mediaEnd).replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleRe = new RegExp(
        selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}'
    );
    const match = haystack.match(ruleRe);
    expect(match).not.toBeNull();
    return match[1];
}

describe('refresh chip — rendered element', () => {
    let btn;

    beforeEach(() => {
        document.body.innerHTML = '';
        btn = buildTaskRefreshBtn();
        document.body.appendChild(btn);
    });

    it('is a non-submitting button carrying the documented id', () => {
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.id).toBe('taskRefreshBtn');
        // type="button" so a future move into a form can never submit it.
        expect(btn.type).toBe('button');
    });

    it('names itself for screen readers', () => {
        expect(btn.getAttribute('aria-label')).toBe('Refresh app');
    });

    it('shares the .bulkDescBtn chip family with the Sort trigger', () => {
        expect(btn.classList.contains('bulkDescBtn')).toBe(true);
        expect(btn.classList.contains('taskRefreshBtn')).toBe(true);
    });

    it('renders an inline currentColor reload glyph, hidden from screen readers', () => {
        const glyph = btn.querySelector('.taskRefreshBtnGlyph');
        expect(glyph).not.toBeNull();
        expect(glyph.getAttribute('aria-hidden')).toBe('true');
        const svg = glyph.querySelector('svg');
        expect(svg).not.toBeNull();
        // Stroked in currentColor so the chip's own colour (and its hover/active
        // accent) drives the icon — no hardcoded theme colour.
        expect(svg.getAttribute('stroke')).toBe('currentColor');
        expect(svg.getAttribute('fill')).toBe('none');
        // The accessible name lives entirely on the button's aria-label.
        expect(btn.textContent.trim()).toBe('');
    });
});

describe('refresh chip — activation', () => {
    const realLocation = window.location;
    let reload;

    beforeEach(() => {
        document.body.innerHTML = '';
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
        document.documentElement.classList.remove('refreshing');
        sessionStorage.clear();
    });

    it('reloads the page exactly once per activation', async () => {
        const btn = buildTaskRefreshBtn();
        document.body.appendChild(btn);
        btn.click();
        await flushFrames();
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('exposes the reload as a plain window.location.reload()', async () => {
        requestAppReload();
        await flushFrames();
        expect(reload).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledWith();
    });

    it('asks for no confirmation — one tap reloads', async () => {
        // Safari's refresh has no confirmation step and this control mirrors it;
        // in-flight unsaved input is lost by design. Guard against a confirm()
        // creeping in: jsdom's confirm is not implemented, so a call would throw,
        // but assert the spy explicitly so the intent is recorded.
        const confirmSpy = vi.fn(() => true);
        const realConfirm = window.confirm;
        window.confirm = confirmSpy;
        try {
            const btn = buildTaskRefreshBtn();
            document.body.appendChild(btn);
            btn.click();
            await flushFrames();
            expect(confirmSpy).not.toHaveBeenCalled();
            expect(reload).toHaveBeenCalledTimes(1);
        } finally {
            window.confirm = realConfirm;
        }
    });

    it('never touches the service worker — the update pill owns that path', async () => {
        // HARD BOUNDARY: a plain reload only. No postMessage, no skipWaiting, no
        // registration lookup. Asserted against the built element's live handler
        // by failing loudly if the SW surface is reached at all.
        const swCalls = [];
        const realSW = navigator.serviceWorker;
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            get() { swCalls.push('accessed'); return realSW; },
        });
        try {
            const btn = buildTaskRefreshBtn();
            document.body.appendChild(btn);
            btn.click();
            await flushFrames();
            expect(swCalls).toEqual([]);
            expect(reload).toHaveBeenCalledTimes(1);
        } finally {
            if (realSW === undefined) {
                delete navigator.serviceWorker;
            } else {
                Object.defineProperty(navigator, 'serviceWorker', {
                    configurable: true,
                    value: realSW,
                });
            }
        }
    });
});

describe('refresh chip — cluster placement in main.js', () => {
    const main = read('main.js');

    it('mounts onto the filter bar immediately BEFORE the Sort trigger', () => {
        // Cluster order is blocked chip → refresh → Sort. The blocked chip's
        // `margin-left: auto` anchors everything after it to the bar's right
        // edge, so the refresh chip must be appended between the two.
        const refreshAt = main.indexOf('mobileSortHost.appendChild(taskRefreshBtn)');
        const sortAt = main.indexOf('mobileSortHost.appendChild(mobileSortBtn)');
        expect(refreshAt).toBeGreaterThan(-1);
        expect(sortAt).toBeGreaterThan(-1);
        expect(refreshAt).toBeLessThan(sortAt);
        expect(main).toMatch(/taskRefreshBtn\s*=\s*buildTaskRefreshBtn\(\)/);
    });

    it('mounts unconditionally — visibility, not mounting, is the breakpoint gate', () => {
        // The bar is shared across breakpoints and relocated by
        // desktopHeaderPlacement.js, so a JS width check would strand the chip
        // after a resize. Nothing may guard the append.
        const slice = main.slice(
            main.indexOf('const mobileSortHost = taskFilterBar;'),
            main.indexOf('mobileSortHost.appendChild(mobileSortBtn)')
        );
        expect(slice).not.toMatch(/isMobileViewport\(/);
        expect(slice).not.toMatch(/innerWidth/);
        expect(slice).not.toMatch(/matchMedia/);
    });

    it('routes the click through the exported reload handler, not an inline reload', () => {
        const fn = main.match(/export function buildTaskRefreshBtn\(\)[\s\S]*?\n}/);
        expect(fn).not.toBeNull();
        expect(fn[0]).toMatch(/requestAppReload\(\)/);
        // No SW messaging inside the builder — the update pill owns that path.
        expect(fn[0]).not.toMatch(/skipWaiting|SKIP_WAITING|postMessage|serviceWorker/);
        expect(main).toMatch(/export function requestAppReload\(\)/);
    });
});

describe('refresh chip — CSS breakpoint gate', () => {
    const css = read('style.css');

    it('is hidden at base scope and reads as a 36×36 chip like the Sort trigger', () => {
        const match = css.match(/#taskRefreshBtn\s*\{([^}]*)\}/);
        expect(match).not.toBeNull();
        // Desktop browsers already have a reload button — no chip there.
        expect(match[1]).toMatch(/display:\s*none/);
        expect(match[1]).toMatch(/width:\s*36px/);
        expect(match[1]).toMatch(/height:\s*36px/);
        expect(match[1]).toMatch(/border-radius:\s*10px/);
        expect(match[1]).toMatch(/border:\s*0\.5px\s+solid/);
    });

    it('uses theme variables rather than hardcoded colours', () => {
        const match = css.match(/#taskRefreshBtn\s*\{([^}]*)\}/);
        expect(match[1]).toMatch(/background:\s*var\(--/);
        expect(match[1]).toMatch(/color:\s*var\(--/);
        expect(match[1]).toMatch(/border:\s*0\.5px\s+solid\s+var\(--/);
    });

    it('is revealed only inside the mobile block, with no competing auto margin', () => {
        const rule = extractMobileRule(css, '#taskRefreshBtn');
        expect(rule).toMatch(/display:\s*inline-flex/);
        // The right cluster is anchored by the blocked chip's margin-left:auto;
        // a second auto margin here would split the free space and push the
        // chips apart.
        expect(rule).not.toMatch(/margin-left:\s*auto/);
    });

    it('gives touch devices press feedback, since they never get :hover', () => {
        expect(css).toMatch(/#taskRefreshBtn:active\s*\{/);
        expect(css).toMatch(/#taskRefreshBtn:hover\s*\{/);
    });
});
