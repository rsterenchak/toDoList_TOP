import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { applyDueUrgency } from '../src/dueDate.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the "recede row action icons to neutral, reserve red for overdue"
// change: the calendar (due) pill and the copy-title icon default to a dim
// neutral so they stop competing with the task title, and the danger pink
// #ff5d7a is applied to the calendar icon ONLY on a past-due row. Red is
// gated by the existing .due-overdue class (applyDueUrgency), so no new
// per-icon class is introduced. Source-inspection for the CSS plus a
// behavior check on the overdue signal that drives the red.

describe('row action icons recede to a dim neutral by default', () => {

    const css = read('style.css');

    it('desktop #duePill top-level rule uses the dim neutral #4a4b58', () => {
        const topLevel = css.match(/(?:^|\n)#duePill\s*\{([\s\S]*?)\}/);
        expect(topLevel).not.toBeNull();
        expect(topLevel[1]).toMatch(/color:\s*#4a4b58/i);
    });

    it('.copyTitleBtn top-level rule uses the dim neutral #4a4b58', () => {
        const topLevel = css.match(/(?:^|\n)\.copyTitleBtn\s*\{([\s\S]*?)\}/);
        expect(topLevel).not.toBeNull();
        expect(topLevel[1]).toMatch(/color:\s*#4a4b58/i);
    });

    it('the copied-feedback flip still brightens the copy icon to the accent', () => {
        // The neutral default must not swallow the "copied" confirmation —
        // the data-copied flip stays on the accent so the tap reads.
        expect(css).toMatch(/\.copyTitleBtn\[data-copied="true"\]\s*\{[^}]*color:\s*var\(--accent\)/);
    });
});

describe('red is reserved for a past-due calendar icon', () => {

    const css = read('style.css');

    it('desktop overdue #duePill paints the danger pink #ff5d7a', () => {
        expect(css).toMatch(/#toDoChild\.due-overdue\s+#duePill\s*\{[^}]*color:\s*#ff5d7a/i);
    });

    it('mobile overdue #duePill paints the danger pink #ff5d7a', () => {
        // The mobile bare-icon rule lives in the ≤1023px block; assert the
        // overdue selector there also lands on #ff5d7a.
        const overdueRules = css.match(/#toDoChild\.due-overdue\s+#duePill\s*\{[^}]*color:\s*#ff5d7a/gi) || [];
        expect(overdueRules.length).toBeGreaterThanOrEqual(2);
    });

    it('the default calendar color is NOT a danger red (neutral, not #ff5d7a)', () => {
        // Regression guard for the task premise: the resting calendar icon
        // must not read as danger on every row.
        const topLevel = css.match(/(?:^|\n)#duePill\s*\{([\s\S]*?)\}/);
        expect(topLevel[1]).not.toMatch(/color:\s*#ff5d7a/i);
    });
});

describe('the overdue red is gated by the existing due-overdue class', () => {

    // The red rule keys off #toDoChild.due-overdue, applied during row
    // render by applyDueUrgency when the due date is in the past — so no
    // separate per-icon class is needed. These checks confirm the signal
    // that lights the red fires exactly on a past-due, non-completed row.

    function dueString(offsetDays) {
        const t = new Date();
        t.setDate(t.getDate() + offsetDays);
        return (t.getMonth() + 1) + '-' + t.getDate() + '-' + t.getFullYear();
    }

    it('adds due-overdue for a date in the past', () => {
        const el = document.createElement('div');
        applyDueUrgency(el, { tit: 'late task', due: dueString(-5), completed: false });
        expect(el.classList.contains('due-overdue')).toBe(true);
    });

    it('does not add due-overdue for a future date', () => {
        const el = document.createElement('div');
        applyDueUrgency(el, { tit: 'later task', due: dueString(30), completed: false });
        expect(el.classList.contains('due-overdue')).toBe(false);
    });

    it('never marks a completed row overdue (no red on completed rows)', () => {
        const el = document.createElement('div');
        applyDueUrgency(el, { tit: 'done task', due: dueString(-5), completed: true });
        expect(el.classList.contains('due-overdue')).toBe(false);
    });
});
