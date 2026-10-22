import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Cover for the launch slide of the mobile tab bar and FAB in the installed
// iOS PWA: the layout viewport starts short and grows after first paint, so
// viewportSettle.js holds `body.viewportSettling` (which makes both
// transparent) until the viewport reaches the screen height, or 3000ms pass.
// A launch that is already full height must never set the class.

let now = 0;
let frames = [];

async function loadModule() {
    vi.resetModules();
    return import('../src/viewportSettle.js');
}

function setStandalone(matches) {
    window.matchMedia = function (query) {
        return {
            matches: query === '(display-mode: standalone)' ? matches : false,
            media: query,
            addEventListener() {},
            removeEventListener() {},
        };
    };
}

function setViewport(width, height) {
    window.innerWidth = width;
    window.innerHeight = height;
}

function setScreen(width, height) {
    Object.defineProperty(window.screen, 'width', { configurable: true, value: width });
    Object.defineProperty(window.screen, 'height', { configurable: true, value: height });
}

// Run every queued animation frame once (each frame may queue the next).
function runFrame(advanceMs = 16) {
    now += advanceMs;
    const pending = frames;
    frames = [];
    pending.forEach(function (cb) { cb(now); });
}

function settling() {
    return document.body.classList.contains('viewportSettling');
}

beforeEach(() => {
    now = 1000;
    frames = [];
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    window.requestAnimationFrame = function (cb) { frames.push(cb); return frames.length; };
    document.body.className = '';
    setScreen(390, 844);
    setViewport(390, 844);
    setStandalone(true);
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: undefined });
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.className = '';
});

describe('initViewportSettle', () => {
    it('hides the nav on a short launch and reveals it once the viewport reaches the screen height', async () => {
        setViewport(390, 791);
        const { initViewportSettle } = await loadModule();
        expect(initViewportSettle()).toBe(true);
        expect(settling()).toBe(true);

        runFrame();
        expect(settling()).toBe(true);
        window.innerHeight = 810;   // still more than 24px short
        runFrame();
        expect(settling()).toBe(true);

        window.innerHeight = 844;
        runFrame();
        expect(settling()).toBe(false);
        expect(frames.length).toBe(0);   // polling stopped
    });

    it('treats a reading within 24px of the screen as settled', async () => {
        setViewport(390, 791);
        const { initViewportSettle } = await loadModule();
        initViewportSettle();
        window.innerHeight = 820;
        runFrame();
        expect(settling()).toBe(false);
    });

    it('never adds the class when the launch reading is already full height', async () => {
        const { initViewportSettle } = await loadModule();
        expect(initViewportSettle()).toBe(false);
        expect(settling()).toBe(false);
        expect(frames.length).toBe(0);
    });

    it('uses the screen width as the expected height in landscape', async () => {
        setViewport(844, 390);
        const { initViewportSettle } = await loadModule();
        expect(initViewportSettle()).toBe(false);
        expect(settling()).toBe(false);
    });

    it('removes the class at the 3000ms cap even if the height never settles', async () => {
        setViewport(390, 791);
        const { initViewportSettle } = await loadModule();
        initViewportSettle();
        runFrame(2900);
        expect(settling()).toBe(true);
        runFrame(99);
        expect(settling()).toBe(true);
        runFrame(1);
        expect(settling()).toBe(false);
        expect(frames.length).toBe(0);
    });

    it('is a no-op outside standalone', async () => {
        setStandalone(false);
        setViewport(390, 791);
        const { initViewportSettle } = await loadModule();
        expect(initViewportSettle()).toBe(false);
        expect(settling()).toBe(false);
        expect(frames.length).toBe(0);
    });

    it('arms on the legacy navigator.standalone flag alone', async () => {
        setStandalone(false);
        Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true });
        setViewport(390, 791);
        const { initViewportSettle } = await loadModule();
        expect(initViewportSettle()).toBe(true);
        expect(settling()).toBe(true);
    });

    it('is a no-op at 1024px wide and above', async () => {
        setScreen(1024, 1366);
        setViewport(1024, 1300);
        const { initViewportSettle } = await loadModule();
        expect(initViewportSettle()).toBe(false);
        expect(settling()).toBe(false);
        expect(frames.length).toBe(0);
    });
});
