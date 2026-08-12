import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The swipe-summoned mobile ghost perch.
//
// The contracts pinned here are the ones a later edit could break invisibly.
// The gesture is the risky part: it shares the tab bar with the app's primary
// mobile navigation, so a regression that made every tab tap summon the ghost
// (or, worse, stopped tabs navigating at all) would be a silent nav outage. The
// rest is the wiring the feature exists for — the perch tap opening the shared
// talk surface with `surface: "mobile"` on the payload, and the visibility
// preference surviving a reload.
//
// inject.js is mocked so the Worker call the talk surface makes is observable
// with no network and no configured Worker.

const { state } = vi.hoisted(() => ({
    state: { configured: true, calls: [] },
}));

vi.mock('../src/inject.js', () => ({
    isInjectConfigured: vi.fn(() => state.configured),
    postToWorker: vi.fn(function (payload) {
        state.calls.push(payload);
        return Promise.resolve({ reply: 'boo' });
    }),
}));

import { resetGhostTalk, computeTalkLayout } from '../src/ghostTalk.js';
import {
    ensureMobileGhost,
    destroyMobileGhost,
    isMobileGhostVisible,
    supportsMobileGhost,
} from '../src/mobileGhost.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

const STORAGE_KEY = 'todoapp_mobileGhostVisible';
const tick = () => new Promise((r) => setTimeout(r, 0));

// jsdom answers `matches: false` to every query, which would bar the mobile
// gate. `mobile` decides whether the max-width query passes; the desktop
// companion's own query answers the inverse so the two ghosts stay exclusive.
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

// jsdom has no TouchEvent constructor; dispatch plain Events carrying the
// `touches` array the handlers read.
function fireTouch(el, type, point) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    const list = point ? [point] : [];
    ev.touches = type === 'touchend' ? [] : list;
    ev.changedTouches = list;
    el.dispatchEvent(ev);
    return ev;
}

// A full vertical drag, start to finish, on one element.
function swipe(el, fromY, toY, x = 60) {
    fireTouch(el, 'touchstart', { clientX: x, clientY: fromY });
    fireTouch(el, 'touchmove', { clientX: x, clientY: toY });
    fireTouch(el, 'touchend', { clientX: x, clientY: toY });
}

let tabActivations = [];

// A stand-in for the real #mobileTabBar: same id, one tab whose click handler
// stands in for applyActiveView() so a swallowed activation is observable.
function mountTabBar() {
    const bar = document.createElement('nav');
    bar.id = 'mobileTabBar';
    const tab = document.createElement('button');
    tab.id = 'mobileTabProjects';
    tab.className = 'mobileTab';
    tab.addEventListener('click', () => { tabActivations.push('projects'); });
    bar.appendChild(tab);
    document.body.appendChild(bar);
    return { bar, tab };
}

function perch() {
    return document.getElementById('mobileGhostPerch');
}
function bubble() {
    return document.getElementById('ghostTalkBubble');
}
function talkInput() {
    return document.getElementById('ghostTalkInput');
}

// The perch is fixed-positioned by CSS jsdom doesn't apply, so hand the talk
// surface the box the real perch would occupy above the tab bar.
function stubPerchBox() {
    perch().getBoundingClientRect = () => ({
        left: 14, top: 600, right: 48, bottom: 634, width: 34, height: 34, x: 14, y: 600,
    });
}

beforeEach(() => {
    state.configured = true;
    state.calls = [];
    tabActivations = [];
    localStorage.removeItem(STORAGE_KEY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubMatchMedia();
});

afterEach(() => {
    resetGhostTalk();
    destroyMobileGhost();
    document.body.innerHTML = '';
    localStorage.removeItem(STORAGE_KEY);
    vi.restoreAllMocks();
});

describe('mobile ghost — mounting', () => {
    it('mounts the perch dismissed under the mobile breakpoint', () => {
        mountTabBar();
        expect(ensureMobileGhost()).toBe(true);

        expect(perch()).not.toBeNull();
        expect(perch().classList.contains('is-visible')).toBe(false);
        expect(perch().getAttribute('aria-hidden')).toBe('true');
        expect(isMobileGhostVisible()).toBe(false);
    });

    it('mounts nothing at >=1024px, where the desktop companion runs instead', () => {
        stubMatchMedia({ mobile: false });
        mountTabBar();

        expect(supportsMobileGhost()).toBe(false);
        expect(ensureMobileGhost()).toBe(false);
        expect(perch()).toBeNull();
    });

    it('mounts nothing before the tab bar exists', () => {
        expect(ensureMobileGhost()).toBe(false);
        expect(perch()).toBeNull();
    });

    it('is idempotent — a second call against the same bar mounts one perch', () => {
        mountTabBar();
        ensureMobileGhost();
        ensureMobileGhost();
        expect(document.querySelectorAll('.mobileGhostPerch').length).toBe(1);
    });
});

describe('mobile ghost — the tab-bar swipe', () => {
    it('summons on an upward swipe past the threshold and swallows that tab activation', () => {
        const { tab } = mountTabBar();
        ensureMobileGhost();

        // The gesture starts on the tab itself — the realistic case, since the
        // tabs fill the bar — and bubbles up to the bar's handler.
        fireTouch(tab, 'touchstart', { clientX: 60, clientY: 700 });
        fireTouch(tab, 'touchmove', { clientX: 62, clientY: 660 });
        fireTouch(tab, 'touchend', { clientX: 62, clientY: 660 });

        expect(isMobileGhostVisible()).toBe(true);
        expect(perch().classList.contains('is-visible')).toBe(true);
        expect(perch().getAttribute('aria-hidden')).toBe('false');

        // The click the browser fires after that same touch must not navigate.
        tab.click();
        expect(tabActivations).toEqual([]);
    });

    it('leaves a plain tab tap alone', () => {
        const { tab } = mountTabBar();
        ensureMobileGhost();

        fireTouch(tab, 'touchstart', { clientX: 60, clientY: 700 });
        fireTouch(tab, 'touchend', { clientX: 60, clientY: 700 });
        tab.click();

        expect(tabActivations).toEqual(['projects']);
        expect(isMobileGhostVisible()).toBe(false);
    });

    it('leaves a short drag alone — under the threshold is still a tap', () => {
        const { tab } = mountTabBar();
        ensureMobileGhost();

        swipe(tab, 700, 682);
        tab.click();

        expect(isMobileGhostVisible()).toBe(false);
        expect(tabActivations).toEqual(['projects']);
    });

    it('ignores a predominantly horizontal drag', () => {
        const { bar, tab } = mountTabBar();
        ensureMobileGhost();

        fireTouch(bar, 'touchstart', { clientX: 60, clientY: 700 });
        fireTouch(bar, 'touchmove', { clientX: 200, clientY: 670 });
        fireTouch(bar, 'touchend', { clientX: 200, clientY: 670 });

        expect(isMobileGhostVisible()).toBe(false);
        tab.click();
        expect(tabActivations).toEqual(['projects']);
    });

    it('dismisses on a downward swipe on the bar', () => {
        const { bar } = mountTabBar();
        ensureMobileGhost();

        swipe(bar, 700, 660);
        expect(isMobileGhostVisible()).toBe(true);

        swipe(bar, 660, 700);
        expect(isMobileGhostVisible()).toBe(false);
        expect(perch().classList.contains('is-visible')).toBe(false);
    });

    it('summons once per gesture, not on every move frame', () => {
        const { bar, tab } = mountTabBar();
        ensureMobileGhost();

        fireTouch(bar, 'touchstart', { clientX: 60, clientY: 700 });
        fireTouch(bar, 'touchmove', { clientX: 60, clientY: 660 });
        // Reversing direction mid-gesture must not turn the summon into a
        // dismiss — the swipe already committed.
        fireTouch(bar, 'touchmove', { clientX: 60, clientY: 740 });
        fireTouch(bar, 'touchend', { clientX: 60, clientY: 740 });

        expect(isMobileGhostVisible()).toBe(true);
        // Still exactly one swallowed click, so the NEXT tap navigates.
        tab.click();
        expect(tabActivations).toEqual([]);
        tab.click();
        expect(tabActivations).toEqual(['projects']);
    });

    it('ignores multi-touch so a pinch never summons', () => {
        const { bar } = mountTabBar();
        ensureMobileGhost();

        const start = new Event('touchstart', { bubbles: true });
        start.touches = [{ clientX: 60, clientY: 700 }, { clientX: 200, clientY: 700 }];
        bar.dispatchEvent(start);
        const move = new Event('touchmove', { bubbles: true });
        move.touches = [{ clientX: 60, clientY: 640 }, { clientX: 200, clientY: 640 }];
        bar.dispatchEvent(move);

        expect(isMobileGhostVisible()).toBe(false);
    });
});

describe('mobile ghost — the perch gesture', () => {
    it('dismisses on a downward swipe on the ghost itself', () => {
        const { bar } = mountTabBar();
        ensureMobileGhost();
        swipe(bar, 700, 660);
        expect(isMobileGhostVisible()).toBe(true);

        swipe(perch(), 600, 640);
        expect(isMobileGhostVisible()).toBe(false);
    });

    it('does not open the talk surface on the click trailing a dismiss swipe', () => {
        const { bar } = mountTabBar();
        ensureMobileGhost();
        swipe(bar, 700, 660);

        swipe(perch(), 600, 640);
        perch().click();

        expect(bubble()).toBeNull();
    });
});

describe('mobile ghost — visibility persists', () => {
    it('round-trips through localStorage across a remount', () => {
        const { bar } = mountTabBar();
        ensureMobileGhost();
        swipe(bar, 700, 660);
        expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

        // A fresh launch: same stored preference, brand-new DOM and module state.
        destroyMobileGhost();
        document.body.innerHTML = '';
        mountTabBar();
        ensureMobileGhost();

        expect(isMobileGhostVisible()).toBe(true);
        expect(perch().classList.contains('is-visible')).toBe(true);
    });

    it('stays dismissed across a remount after being sunk away', () => {
        const { bar } = mountTabBar();
        ensureMobileGhost();
        swipe(bar, 700, 660);
        swipe(bar, 660, 700);
        expect(localStorage.getItem(STORAGE_KEY)).toBe('false');

        destroyMobileGhost();
        document.body.innerHTML = '';
        mountTabBar();
        ensureMobileGhost();

        expect(isMobileGhostVisible()).toBe(false);
        expect(perch().classList.contains('is-visible')).toBe(false);
    });
});

describe('mobile ghost — the talk surface', () => {
    function summon() {
        const { bar } = mountTabBar();
        ensureMobileGhost();
        swipe(bar, 700, 660);
        stubPerchBox();
        return bar;
    }

    it('tapping the perched ghost opens the bubble and the whisper input', () => {
        summon();
        perch().click();

        expect(bubble()).not.toBeNull();
        expect(talkInput()).not.toBeNull();
        expect(talkInput().placeholder).toBe('whisper something…');
        // Tagged as the mobile mount, which is what keeps the desktop-only hide
        // rule off it.
        expect(bubble().classList.contains('ghostTalkSurface--mobile')).toBe(true);
        expect(bubble().classList.contains('ghostTalkSurface--desktop')).toBe(false);
    });

    it('sends surface "mobile" on the worker payload', async () => {
        summon();
        perch().click();

        talkInput().value = 'is it colder over there';
        talkInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await tick();

        const ask = state.calls.find((c) => c && c.message);
        expect(ask).toEqual({
            ghost: true,
            message: 'is it colder over there',
            surface: 'mobile',
        });
    });

    it('stills the idle bob while the surface is open and releases it on dismiss', () => {
        summon();
        perch().click();
        expect(perch().classList.contains('is-still')).toBe(true);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(perch().classList.contains('is-still')).toBe(false);
    });

    it('does nothing when the ghost is not summoned', () => {
        mountTabBar();
        ensureMobileGhost();
        perch().click();
        expect(bubble()).toBeNull();
    });

    it('closes an open surface when the ghost is sunk away', () => {
        const bar = summon();
        perch().click();
        expect(bubble()).not.toBeNull();

        swipe(bar, 660, 700);
        expect(bubble().classList.contains('is-closing')).toBe(true);
    });
});

describe('mobile ghost — styling and wiring', () => {
    const css = read('style.css');

    it('docks the perch bottom-left above the tab bar, clear of the assistant FAB', () => {
        const rule = css.match(/\.mobileGhostPerch\s*\{[^}]*position:\s*fixed[^}]*\}/);
        expect(rule).not.toBeNull();
        // Bottom-LEFT — #claudeLauncher holds the bottom-right corner.
        expect(rule[0]).toMatch(/left:\s*14px/);
        expect(rule[0]).not.toMatch(/right:/);
        expect(rule[0]).toMatch(
            /bottom:\s*calc\(\s*var\(--mobile-tab-h[^)]*\)\s*\+\s*var\(--mobile-bottom-inset[^)]*\)\s*\+\s*10px\s*\)/
        );
        // Below #mobileTabBar's z-index (49) so the summon rises from behind it.
        const z = rule[0].match(/z-index:\s*(\d+)/);
        expect(Number(z[1])).toBeLessThan(49);
    });

    it('renders the perch only under the mobile breakpoint', () => {
        expect(css).toMatch(/\.mobileGhostPerch\s*\{\s*display:\s*none;\s*\}/);
        const mobileBlock = css.slice(css.indexOf('.mobileGhostPerch { display: none; }'));
        expect(mobileBlock).toMatch(/@media \(max-width:\s*1023px\)/);
    });

    // One ghost, one body: the perch renders the same committed pixel sprite as
    // the desktop companion, and both read it from the shared :root property so
    // restyling one surface can't silently fork the art.
    it('renders the shared pixel sprite rather than a second asset or an icon library', () => {
        const sprite = css.match(/\.mobileGhostSprite\s*\{[^}]*\}/);
        expect(sprite[0]).toMatch(/background-image:\s*var\(\s*--ghost-sprite\s*\)/);
        expect(sprite[0]).not.toMatch(/ghost_purple\.svg/);
        expect(sprite[0]).toMatch(/animation:\s*mobileGhostBob/);
    });

    // Scaled pixel art blurs without this, and a square box would stretch a
    // 48x56 sprite — 34px wide therefore demands 40px tall.
    it('keeps the sprite crisp and the perch box at the sprite\'s 48:56 aspect', () => {
        const sprite = css.match(/\.mobileGhostSprite\s*\{[^}]*\}/)[0];
        expect(sprite).toMatch(/image-rendering:\s*pixelated/);
        expect(sprite).toMatch(/background-size:\s*100%\s+100%/);

        const perch = css.match(/\.mobileGhostPerch\s*\{[^}]*position:\s*fixed[^}]*\}/)[0];
        const w = Number(perch.match(/width:\s*(\d+)px/)[1]);
        const h = Number(perch.match(/height:\s*(\d+)px/)[1]);
        expect(Math.abs(h - w * (56 / 48))).toBeLessThanOrEqual(0.5);
    });

    // The perch grew 6px taller, so the bubble's anchor moved up with it. The
    // existing reflow machinery should absorb that; assert it rather than
    // assume it.
    it('leaves the bubble fully clear of the taller perch', () => {
        const perchRect = { x: 14, y: 728, width: 34, height: 40 };
        const inputRect = { x: 56, y: 736, width: 180, height: 34 };
        const layout = computeTalkLayout(
            perchRect, { width: 232, height: 120 }, inputRect, { width: 390, height: 844 }
        );
        expect(layout.placement).toBe('above');
        // Bottom of the bubble stays above the top of the sprite/input cluster.
        const clusterTop = Math.min(perchRect.y, inputRect.y);
        expect(layout.bubbleY + 120).toBeLessThan(clusterTop);
        expect(layout.bubbleY).toBeGreaterThanOrEqual(0);
    });

    it('rises with a translateY and fades, and stills the bob while talking', () => {
        const rule = css.match(/\.mobileGhostPerch\s*\{[^}]*position:\s*fixed[^}]*\}/)[0];
        expect(rule).toMatch(/transform:\s*translateY\(\d+px\)/);
        expect(rule).toMatch(/opacity:\s*0/);
        const visible = css.match(/\.mobileGhostPerch\.is-visible\s*\{[^}]*\}/)[0];
        expect(visible).toMatch(/transform:\s*translateY\(0\)/);
        expect(visible).toMatch(/opacity:\s*1/);
        expect(css).toMatch(/\.mobileGhostPerch\.is-still\s+\.mobileGhostSprite\s*\{\s*animation:\s*none/);
    });

    it('drops the rise and the bob under reduced motion, keeping the fade', () => {
        const block = css.match(
            /@media \(prefers-reduced-motion: reduce\) \{\s*\.mobileGhostPerch,[\s\S]*?\n\}/
        );
        expect(block).not.toBeNull();
        expect(block[0]).toMatch(/transform:\s*none/);
        expect(block[0]).toMatch(/transition:\s*opacity/);
        expect(block[0]).toMatch(/\.mobileGhostSprite\s*\{\s*animation:\s*none/);
    });

    it('keeps the whisper input at 16px so iOS never auto-zooms on focus', () => {
        const rule = css.match(/\.ghostTalkInput\s*\{[^}]*\}/);
        expect(rule[0]).toMatch(/font-size:\s*16px/);
    });

    it('main.js mounts the perch at boot', () => {
        const js = read('main.js');
        expect(js).toMatch(/import\s*\{[^}]*ensureMobileGhost[^}]*\}\s*from\s*['"]\.\/mobileGhost\.js['"]/);
        expect(js).toMatch(/setTimeout\(ensureMobileGhost,\s*0\)/);
    });

    it('reuses the shared talk surface rather than posting to the worker itself', () => {
        const js = read('mobileGhost.js');
        expect(js).toMatch(/import\s*\{[^}]*openGhostTalk[^}]*\}\s*from\s*['"]\.\/ghostTalk\.js['"]/);
        expect(js).not.toMatch(/\bfetch\s*\(/);
        expect(js).not.toMatch(/postToWorker/);
        // The perch is a presence surface, not an agent one.
        expect(js).not.toMatch(/claudeSheet/);
        expect(js).not.toMatch(/supabase/i);
    });
});
