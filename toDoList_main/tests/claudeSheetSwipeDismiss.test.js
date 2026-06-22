import { vi } from 'vitest';
import {
    mountClaudeSheet,
    openClaudeSheet,
    isClaudeSheetOpen,
} from '../src/claudeSheet.js';

// Reuse the same Supabase stub shape the main claudeSheet suite relies on so
// mounting the sheet never reaches a real client.
vi.mock('../src/supabaseClient.js', () => {
    function makeQuery() {
        const q = {
            select: function() { return q; },
            order: function() { return Promise.resolve({ data: [], error: null }); },
            insert: function() { return Promise.resolve({ data: null, error: null }); },
            update: function() { return q; },
            delete: function() { return q; },
            eq: function() { return Promise.resolve({ data: null, error: null }); },
        };
        return q;
    }
    return {
        supabase: {
            auth: {
                getSession: function() { return Promise.resolve({ data: { session: null }, error: null }); },
                onAuthStateChange: function() { return { data: { subscription: { unsubscribe: function() {} } } }; },
                signInWithOtp: function() { return Promise.resolve({ data: null, error: { message: 'x' } }); },
                signOut: function() { return Promise.resolve({ error: null }); },
            },
            from: function() { return makeQuery(); },
            channel: function() { return { on: function() { return this; }, subscribe: function() { return this; }, unsubscribe: function() { return this; } }; },
            removeChannel: function() {},
        },
    };
});

// jsdom has no TouchEvent constructor; dispatch plain Events carrying the
// `touches` / `changedTouches` arrays the handlers read.
function fireTouch(el, type, point) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    if (type === 'touchend') {
        ev.changedTouches = point ? [point] : [];
    } else {
        ev.touches = point ? [point] : [];
    }
    el.dispatchEvent(ev);
}

// Drive a full swipe gesture with controllable elapsed time (ms) so velocity is
// deterministic. We mock Date.now to advance by `durationMs` between the
// touchstart and touchend reads.
function swipe(el, fromY, toY, durationMs) {
    let t = 1000;
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockImplementation(() => t);
    fireTouch(el, 'touchstart', { clientY: fromY });
    fireTouch(el, 'touchmove', { clientY: toY });
    t = 1000 + durationMs;
    fireTouch(el, 'touchend', { clientY: toY });
    nowSpy.mockRestore();
}

describe('Mobile chat sheet swipe-down dismiss sensitivity', () => {
    const realInnerWidth = window.innerWidth;

    beforeEach(() => {
        document.body.innerHTML = '';
        // Force a mobile viewport so the swipe handler doesn't bail.
        Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true, writable: true });
        mountClaudeSheet(document.body);
        openClaudeSheet();
    });

    afterEach(() => {
        Object.defineProperty(window, 'innerWidth', { value: realInnerWidth, configurable: true, writable: true });
    });

    function sheet() {
        return document.getElementById('claudeSheet');
    }

    it('does NOT close on a small slow scroll-intent drag (raised distance threshold)', () => {
        expect(isClaudeSheetOpen()).toBe(true);
        // 70px over 700ms → 0.1 px/ms: below the long-drag distance (120px) and
        // below the flick velocity (0.5 px/ms). The old 60px-only rule would
        // have dismissed here.
        swipe(sheet(), 100, 170, 700);
        expect(isClaudeSheetOpen()).toBe(true);
    });

    it('closes on a long deliberate drag regardless of speed', () => {
        expect(isClaudeSheetOpen()).toBe(true);
        // 140px (>= 120) even at a slow 0.1 px/ms.
        swipe(sheet(), 100, 240, 1400);
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('closes on a short but fast downward flick', () => {
        expect(isClaudeSheetOpen()).toBe(true);
        // 70px over 50ms → 1.4 px/ms: clears the flick bar (>= 60px, >= 0.5).
        swipe(sheet(), 100, 170, 50);
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('ignores the gesture when it starts inside an already-scrolled chat log', () => {
        const surface = document.getElementById('claudeChatSurface');
        expect(surface).toBeTruthy();
        // Make the surface a genuinely scrollable, scrolled-down region.
        surface.style.overflowY = 'auto';
        Object.defineProperty(surface, 'scrollHeight', { value: 800, configurable: true });
        Object.defineProperty(surface, 'clientHeight', { value: 300, configurable: true });
        surface.scrollTop = 120;

        expect(isClaudeSheetOpen()).toBe(true);
        // A long, fast downward drag that WOULD otherwise dismiss is treated as
        // a scroll because it began in a scrolled region.
        swipe(surface, 100, 300, 60);
        expect(isClaudeSheetOpen()).toBe(true);
    });

    it('still dismisses a drag that starts in the chat log when it is scrolled to the top', () => {
        const surface = document.getElementById('claudeChatSurface');
        surface.style.overflowY = 'auto';
        Object.defineProperty(surface, 'scrollHeight', { value: 800, configurable: true });
        Object.defineProperty(surface, 'clientHeight', { value: 300, configurable: true });
        surface.scrollTop = 0;

        expect(isClaudeSheetOpen()).toBe(true);
        swipe(surface, 100, 260, 60);
        expect(isClaudeSheetOpen()).toBe(false);
    });
});
