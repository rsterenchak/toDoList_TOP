import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';

import { updateDuePillLabel } from '../src/dueDate.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(rel) {
    return readFileSync(resolve(srcDir, rel), 'utf8');
}

function mkPill() {
    const pill = document.createElement('button');
    pill.id = 'duePill';
    return pill;
}

function dateStringInDays(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return (d.getMonth() + 1) + '-' + d.getDate() + '-' + d.getFullYear();
}

// The mobile bare-icon pill renders a single-digit "days until due" number
// inside the yellow calendar icon when the row's due date falls 1-3 days
// out. updateDuePillLabel surfaces the count both as a data-days-until-due
// attribute (a testable state signal) and as an SVG <text> element drawn
// inside the calendar glyph's own viewBox so the digit lives in the
// date-grid body of the icon instead of being overlaid by a CSS pseudo.
// Drawing inside the SVG keeps the digit anchored to the glyph regardless
// of how the pill's flex cross-axis resolves. Today, no-date, and overdue
// states are out of scope per the task brief and must NOT receive the
// badge.
describe('mobile due pill — days-until-due badge attribute', () => {

    beforeEach(() => {
        vi.useFakeTimers();
        // Anchor "today" mid-morning so the daysUntilDue math doesn't ride
        // a daylight-savings sub-pixel edge.
        vi.setSystemTime(new Date(2026, 4, 28, 10, 0, 0));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('writes data-days-until-due="1" when the row is due in 1 day', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(1), completed: false });
        expect(pill.getAttribute('data-days-until-due')).toBe('1');
    });

    it('writes data-days-until-due="2" when the row is due in 2 days', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(2), completed: false });
        expect(pill.getAttribute('data-days-until-due')).toBe('2');
    });

    it('writes data-days-until-due="3" at the far edge of the yellow window', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(3), completed: false });
        expect(pill.getAttribute('data-days-until-due')).toBe('3');
    });

    it('does not write data-days-until-due for due-today rows (out of scope)', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(0), completed: false });
        expect(pill.getAttribute('data-days-until-due')).toBeNull();
    });

    it('does not write data-days-until-due for rows >3 days out (no urgency yet)', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(7), completed: false });
        expect(pill.getAttribute('data-days-until-due')).toBeNull();
    });

    it('does not write data-days-until-due for overdue rows (red icon stays as-is)', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(-1), completed: false });
        expect(pill.getAttribute('data-days-until-due')).toBeNull();
    });

    it('does not write data-days-until-due when the item is completed', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(2), completed: true });
        expect(pill.getAttribute('data-days-until-due')).toBeNull();
    });

    it('does not write data-days-until-due when no due date is set', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: '', completed: false });
        expect(pill.getAttribute('data-days-until-due')).toBeNull();
    });

    it('clears a stale data-days-until-due when the date moves out of the yellow window', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(2), completed: false });
        expect(pill.getAttribute('data-days-until-due')).toBe('2');
        // Re-render with a future date that no longer qualifies for the
        // yellow badge — the attribute has to come back off so the badge
        // doesn't linger over the now-purple calendar icon.
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(10), completed: false });
        expect(pill.getAttribute('data-days-until-due')).toBeNull();
    });
});


describe('mobile due pill — days-until-due badge rendered inside the SVG', () => {

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 28, 10, 0, 0));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function findDayBadge(pill) {
        return pill.querySelector('.duePillIcon .duePillIconDayBadge');
    }

    it('embeds a <text> element with the digit inside the calendar SVG when due-soon', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(2), completed: false });
        const badge = findDayBadge(pill);
        expect(badge).not.toBeNull();
        expect(badge.tagName.toLowerCase()).toBe('text');
        expect(badge.textContent).toBe('2');
    });

    it('positions the digit below the y=6 header line so it lands in the date-grid body, not on the calendar crossbar', () => {
        // Regression for the days-until-due digit overflowing the top of
        // the calendar glyph. The 14×14 viewBox has its header crossbar
        // at y=6 and the rect bottom at y=12.5 — y must sit strictly
        // below the header line (y > 6) and inside the rect (y <= 12.5).
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(2), completed: false });
        const badge = findDayBadge(pill);
        expect(badge).not.toBeNull();
        const y = parseFloat(badge.getAttribute('y'));
        expect(Number.isFinite(y)).toBe(true);
        expect(y).toBeGreaterThan(6);
        expect(y).toBeLessThanOrEqual(12.5);
    });

    it('centers the digit horizontally in the viewBox via text-anchor="middle"', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(2), completed: false });
        const badge = findDayBadge(pill);
        expect(badge).not.toBeNull();
        expect(badge.getAttribute('text-anchor')).toBe('middle');
        const x = parseFloat(badge.getAttribute('x'));
        // 14-unit viewBox → center is at x=7.
        expect(x).toBe(7);
    });

    it('inherits the icon color via fill="currentColor" and disables stroke so the digit reads crisp', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(2), completed: false });
        const badge = findDayBadge(pill);
        expect(badge).not.toBeNull();
        expect(badge.getAttribute('fill')).toBe('currentColor');
        expect(badge.getAttribute('stroke')).toBe('none');
    });

    it('omits the <text> element entirely when the row is outside the 1-3 day yellow window', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(7), completed: false });
        expect(findDayBadge(pill)).toBeNull();
    });

    it('omits the <text> element for due-today rows', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(0), completed: false });
        expect(findDayBadge(pill)).toBeNull();
    });

    it('omits the <text> element for overdue rows', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(-1), completed: false });
        expect(findDayBadge(pill)).toBeNull();
    });

    it('omits the <text> element when the item is completed', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(2), completed: true });
        expect(findDayBadge(pill)).toBeNull();
    });

    it('drops the <text> element on rerender when the date moves out of the yellow window', () => {
        const pill = mkPill();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(2), completed: false });
        expect(findDayBadge(pill)).not.toBeNull();
        updateDuePillLabel(pill, { tit: 'x', due: dateStringInDays(10), completed: false });
        expect(findDayBadge(pill)).toBeNull();
    });
});


describe('mobile due pill — days-until-due badge CSS', () => {

    const css = read('style.css');

    function mobileMediaBlocks() {
        const blocks = [];
        let cursor = 0;
        while (true) {
            const media = css.indexOf('@media (max-width: 1023px)', cursor);
            if (media === -1) break;
            let depth = 0;
            let end = css.length;
            for (let i = css.indexOf('{', media); i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') {
                    depth--;
                    if (depth === 0) { end = i + 1; break; }
                }
            }
            blocks.push(css.slice(media, end));
            cursor = end;
        }
        expect(blocks.length).toBeGreaterThan(0);
        return blocks;
    }

    it('does not paint the digit via a #duePill[data-days-until-due]::after rule (now drawn inside the SVG instead)', () => {
        // The original ::after overlay rode above the calendar's header
        // line because the 11×11 icon left no room to anchor an
        // absolutely-positioned span inside its tiny date-grid body.
        // The fix moves the digit into the SVG's own viewBox so this
        // selector should no longer exist in the stylesheet.
        const has = mobileMediaBlocks().some(b =>
            /#duePill\[data-days-until-due\][^{]*::after\s*\{/.test(b)
        );
        expect(has).toBe(false);
    });

    it('reveals the in-SVG day badge on mobile only via a .duePillIconDayBadge rule inside the mobile media block', () => {
        const has = mobileMediaBlocks().some(b =>
            /\.duePillIconDayBadge[^{]*\{[^}]*display:\s*inline/.test(b)
        );
        expect(has).toBe(true);
    });

    it('scopes the badge to the yellow .due-soon state so today/overdue/no-date stay icon-only', () => {
        // The <text> element is only emitted in the 1-3 day window by JS,
        // but the CSS selector also requires .due-soon as defense in
        // depth — if any future caller routes a value through
        // buildCalendarSvg outside that window, the badge still won't
        // render on mobile.
        const has = mobileMediaBlocks().some(b =>
            /#toDoChild\.due-soon\s+#duePill\s+\.duePillIconDayBadge[^{]*\{/.test(b)
        );
        expect(has).toBe(true);
    });

    it('hides the in-SVG day badge by default so desktop pills stay textual-only', () => {
        // Desktop already shows the "Due in Nd" label next to the icon,
        // so a second copy of the digit inside the glyph would be
        // redundant. The default-scope rule hides .duePillIconDayBadge;
        // the mobile media block opts it back in.
        const re = /#duePill\s+\.duePillIconDayBadge\s*\{[^}]*display:\s*none/;
        expect(re.test(css)).toBe(true);
    });

    it('styles the in-SVG digit in Trebuchet MS / Verdana per the task brief so the numeral reads cleanly inside the 14×14 viewBox', () => {
        const blocks = mobileMediaBlocks();
        const rule = blocks
            .map(b => {
                const m = b.match(/\.duePillIconDayBadge[^{]*\{([^}]*)\}/);
                return m ? m[1] : '';
            })
            .find(body => body.length > 0);
        expect(rule).toBeTruthy();
        expect(rule).toMatch(/font-family:[^;]*Trebuchet MS/);
        expect(rule).toMatch(/font-family:[^;]*Verdana/);
        expect(rule).toMatch(/font-weight:\s*500/);
    });
});
