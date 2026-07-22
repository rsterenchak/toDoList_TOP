import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Pins the mobile "phase word only when blocked on you" feature: the inline
// status badge (`.todoStatusLabel`) stays hidden at the ≤1023px breakpoint —
// the row hands its width to the title and the left-edge color tab carries
// manual status — EXCEPT when the derived phase is one genuinely blocked on the
// user: REVIEW (shipped, unacknowledged) or ASKING (triage has a question). For
// those two the badge surfaces, right-aligned in the trailing cluster, so a
// word on a row always means "act on this". The exception is keyed purely off
// the badge's own `data-status` attribute, so it needs no JS change. Source
// inspection only — media queries don't apply under jsdom, matching the
// mobileRowStatusEdgeTab / mobileCopyTitleAndSlimDuePill tests.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(rel) {
    return readFileSync(resolve(srcDir, rel), 'utf8');
}

describe('mobile blocked-phase badge — surface REVIEW / ASKING only', () => {

    const css = read('style.css');

    // Both the default hide and the exception live under the first ≤1023px
    // mobile block; slice from there so assertions stay scoped to mobile.
    const mobileIdx = css.indexOf('@media (max-width: 1023px)');
    const mobileSlice = css.slice(mobileIdx);

    it('opens a ≤1023px mobile block', () => {
        expect(mobileIdx).toBeGreaterThan(-1);
    });

    it('keeps the default hide for every other status on mobile', () => {
        expect(mobileSlice).toMatch(/\.todoStatusLabel\s*\{\s*display:\s*none/);
    });

    it('surfaces the badge on mobile for the two blocked-on-you phases', () => {
        // A single exception rule keyed off data-status, covering exactly
        // review and asking, with a non-none display.
        const exception = mobileSlice.match(
            /\.todoStatusLabel\[data-status="review"\]\s*,\s*\.todoStatusLabel\[data-status="asking"\]\s*\{([\s\S]*?)\}/);
        expect(exception).not.toBeNull();
        const body = exception[1];
        expect(body).toMatch(/display:\s*(?!none)/);
        expect(body).toMatch(/display:\s*inline-flex/);
    });

    it('does not unhide any manual status (active / in_progress / idea stay off)', () => {
        // The exception selector must NOT reference the settable statuses, or a
        // permanent badge returns to every row — the exact regression the
        // narrowed hide exists to prevent.
        const exceptionStart = mobileSlice.indexOf('.todoStatusLabel[data-status="review"]');
        const exceptionEnd = mobileSlice.indexOf('}', exceptionStart);
        const selectorAndBody = mobileSlice.slice(exceptionStart, exceptionEnd);
        expect(selectorAndBody).not.toMatch(/data-status="active"/);
        expect(selectorAndBody).not.toMatch(/data-status="in_progress"/);
        expect(selectorAndBody).not.toMatch(/data-status="idea"/);
    });

    it('places the badge in the trailing cluster near the copy control via flex order', () => {
        const exception = mobileSlice.match(
            /\.todoStatusLabel\[data-status="review"\]\s*,\s*\.todoStatusLabel\[data-status="asking"\]\s*\{([\s\S]*?)\}/);
        const orderMatch = exception[1].match(/order:\s*(\d+)/);
        expect(orderMatch).not.toBeNull();
        const badgeOrder = Number(orderMatch[1]);
        // Sits after the order-0 title, alongside the trailing controls.
        expect(badgeOrder).toBeGreaterThan(0);
        // And no later than the copy control it renders before.
        const copyOrder = mobileSlice.match(/#toDoChild\s+\.copyTitleBtn\s*\{\s*order:\s*(\d+)/);
        expect(copyOrder).not.toBeNull();
        expect(badgeOrder).toBeLessThanOrEqual(Number(copyOrder[1]));
    });

    it('reuses the existing amber (#ffbd5e) for both blocked states — no new token', () => {
        expect(css).toMatch(/\.todoStatusLabel\[data-status="review"\]\s*\{\s*color:\s*#ffbd5e/);
        expect(css).toMatch(/\.todoStatusLabel\[data-status="asking"\]\s*\{\s*color:\s*#ffbd5e/);
    });

    it('drives the badge value from derivePhase with no new JS flag', () => {
        // The exception is CSS-only: the same overlayForPhase map that already
        // sets data-status is the single source, so review/asking land on the
        // attribute the selector reads without a parallel class.
        const toDoRow = read('toDoRow.js');
        expect(toDoRow).toMatch(/function overlayForPhase\(phase\)/);
        expect(toDoRow).toMatch(/if\s*\(\s*phase\s*===\s*PHASE\.ASKING\s*\)\s*return\s*'asking'/);
        expect(toDoRow).toMatch(/if\s*\(\s*phase\s*===\s*PHASE\.ACCEPT\s*\)\s*return\s*'review'/);

        const todoStatus = read('todoStatus.js');
        expect(todoStatus).toMatch(/setAttribute\('data-status',\s*'review'\)/);
        expect(todoStatus).toMatch(/setAttribute\('data-status',\s*'asking'\)/);
    });
});
