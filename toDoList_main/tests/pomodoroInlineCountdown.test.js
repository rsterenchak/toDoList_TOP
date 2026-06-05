// Pins the contract for the Pomodoro toggle's inline countdown: when a
// session is running or paused, the header toggle button expands to show the
// live MM:SS next to the clock icon with a purple accent border; when idle (or
// complete-acked) it collapses back to the icon-only chip. The presentation
// lives entirely in main.js (the syncPomodoroIcon wiring) and style.css; the
// pomodoro.js state machine is unchanged. The main.js wiring is verified via
// source-level regex (mirroring the rest of the pomodoro test suite, since
// main.js's component() bootstrap is not instantiable in jsdom), and the
// state-driven text content is exercised against the real controller.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    createPomodoro,
    POMODORO_STATE_KEY,
    DEFAULT_DURATIONS,
    destroyPomodoro,
    formatMMSS,
} from '../src/pomodoro.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function clearPomodoroStorage() {
    localStorage.removeItem(POMODORO_STATE_KEY);
}


describe('pomodoro inline countdown — toggle markup', () => {
    const main = read('main.js');

    it('renders a .pomodoroCountdownInline span inside the toggle button', () => {
        // The span must live in the button's innerHTML so the icon and the
        // countdown share one element and one accent border.
        expect(main).toMatch(/pomodoroToggle\.innerHTML[\s\S]*pomodoroCountdownInline/);
    });

    it('marks the inline countdown aria-hidden (decorative duplicate of state)', () => {
        const idx = main.indexOf('pomodoroCountdownInline');
        expect(idx).toBeGreaterThan(-1);
        const span = main.slice(idx - 40, idx + 80);
        expect(span).toMatch(/aria-hidden/);
    });
});


describe('pomodoro inline countdown — syncPomodoroIcon wiring', () => {
    const main = read('main.js');

    function syncBody() {
        const m = /function\s+syncPomodoroIcon\s*\([\s\S]*?\n    \}/.exec(main);
        expect(m).toBeTruthy();
        return m[0];
    }

    it('populates the inline span only while RUNNING or PAUSED', () => {
        const body = syncBody();
        expect(body).toMatch(/pomodoroCountdownInline/);
        expect(body).toMatch(/['"]RUNNING['"]/);
        expect(body).toMatch(/['"]PAUSED['"]/);
        // The MM:SS string comes from the shared formatMMSS helper, fed the
        // controller's remainingMs (same source the popover countdown uses).
        expect(body).toMatch(/formatMMSS\([^)]*remainingMs/);
    });

    it('clears the inline span text when idle / complete so the chip collapses', () => {
        const body = syncBody();
        // An explicit empty-string assignment for the non-running branch keeps
        // stale countdowns from lingering after acknowledge / reset.
        expect(body).toMatch(/textContent\s*=\s*['"]['"]/);
    });

    it('does not touch the existing clock-hand sweep transform', () => {
        const body = syncBody();
        // The minute-hand rotation is ambient feedback that must survive this
        // change untouched.
        expect(body).toMatch(/clockIconHand/);
        expect(body).toMatch(/setAttribute\(\s*['"]transform['"]/);
    });
});


describe('pomodoro inline countdown — CSS presentation', () => {
    const css = read('style.css');

    it('hides the inline countdown by default', () => {
        const idx = css.indexOf('.pomodoroCountdownInline');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 300);
        expect(block).toMatch(/display:\s*none/);
    });

    it('styles the countdown ~12px bold in the accent color', () => {
        const idx = css.indexOf('.pomodoroCountdownInline');
        const block = css.slice(idx, idx + 300);
        expect(block).toMatch(/font-size:\s*12px/);
        expect(block).toMatch(/font-weight:\s*700/);
        expect(block).toMatch(/color:\s*var\(--accent\)/);
        // Small gap between the icon and the text.
        expect(block).toMatch(/margin-left:\s*6px/);
    });

    it('reveals the countdown only when the toggle is RUNNING or PAUSED', () => {
        expect(css).toMatch(/#pomodoroToggle\[data-pomo-status="RUNNING"\]\s+\.pomodoroCountdownInline/);
        expect(css).toMatch(/#pomodoroToggle\[data-pomo-status="PAUSED"\]\s+\.pomodoroCountdownInline/);
    });

    it('expands the toggle to width:auto with an accent border when active', () => {
        // Find the RUNNING/PAUSED rule on the toggle itself (not the inner span).
        const m = /#pomodoroToggle\[data-pomo-status="RUNNING"\],\s*#pomodoroToggle\[data-pomo-status="PAUSED"\]\s*\{([\s\S]*?)\}/.exec(css);
        expect(m).toBeTruthy();
        const block = m[1];
        expect(block).toMatch(/width:\s*auto/);
        expect(block).toMatch(/border:\s*1px solid var\(--accent\)/);
    });
});


describe('pomodoro inline countdown — state-driven text contract', () => {
    beforeEach(clearPomodoroStorage);
    afterEach(() => { destroyPomodoro(); clearPomodoroStorage(); });

    it('formatMMSS of a running session yields the MM:SS the inline span shows', () => {
        // The inline span renders formatMMSS(remainingMs/1000). Confirm the
        // controller exposes a remainingMs the helper formats to MM:SS.
        const ctl = createPomodoro(document);
        ctl.start();
        const snap = ctl.getState();
        expect(snap.status).toBe('RUNNING');
        const label = formatMMSS(Math.round(snap.remainingMs / 1000));
        expect(label).toMatch(/^\d{1,2}:\d{2}$/);
        ctl.destroy();
    });

    it('a paused session still exposes a positive remainingMs to display', () => {
        const ctl = createPomodoro(document);
        ctl.start();
        ctl.pause();
        const snap = ctl.getState();
        expect(snap.status).toBe('PAUSED');
        expect(snap.remainingMs).toBeGreaterThan(0);
        expect(formatMMSS(Math.round(snap.remainingMs / 1000))).toMatch(/^\d{1,2}:\d{2}$/);
        ctl.destroy();
    });

    it('an idle / complete-acked session is the collapsed (no-countdown) state', () => {
        // After acknowledge the status returns to IDLE — the branch where the
        // inline span is cleared and CSS hides it.
        localStorage.setItem(POMODORO_STATE_KEY, JSON.stringify({
            mode: 'focus',
            durations: DEFAULT_DURATIONS,
            endTimestamp: null,
            status: 'COMPLETE_UNACKED',
            soundEnabled: true,
            volume: 0.6,
        }));
        const ctl = createPomodoro(document);
        expect(ctl.getState().status).toBe('COMPLETE_UNACKED');
        ctl.acknowledge();
        expect(ctl.getState().status).toBe('IDLE');
        ctl.destroy();
    });
});
