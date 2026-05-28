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
// out. updateDuePillLabel surfaces the count via a data-days-until-due
// attribute; the mobile @media block in style.css paints it via a ::after
// pseudo so desktop stays unaffected. Today, no-date, and overdue states
// are out of scope per the task brief and must NOT receive the badge.
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


describe('mobile due pill — days-until-due badge CSS', () => {

    const css = read('style.css');

    function mobileMediaBlocks() {
        const blocks = [];
        let cursor = 0;
        while (true) {
            const media = css.indexOf('@media (max-width: 700px)', cursor);
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

    it('targets the mobile pill via a #duePill[data-days-until-due]::after rule', () => {
        const has = mobileMediaBlocks().some(b =>
            /#duePill\[data-days-until-due\][^{]*::after\s*\{/.test(b)
        );
        expect(has).toBe(true);
    });

    it('reads the digit from the data attribute via content: attr(data-days-until-due)', () => {
        const has = mobileMediaBlocks().some(b =>
            /::after\s*\{[^}]*content:\s*attr\(data-days-until-due\)/.test(b)
        );
        expect(has).toBe(true);
    });

    it('scopes the badge to the yellow .due-soon state so today/overdue/no-date stay icon-only', () => {
        // The data attribute is already gated to the 1-3 day window by JS,
        // but the CSS selector also requires .due-soon as defense in
        // depth — if any future caller writes the attribute outside that
        // window, the badge still won't render.
        const has = mobileMediaBlocks().some(b =>
            /#toDoChild\.due-soon\s+#duePill\[data-days-until-due\][^{]*::after/.test(b)
        );
        expect(has).toBe(true);
    });

    it('mobile #duePill gets position: relative so the absolutely positioned badge anchors to it', () => {
        const has = mobileMediaBlocks().some(b =>
            /#duePill\s*\{[^}]*position:\s*relative/.test(b)
        );
        expect(has).toBe(true);
    });

    it('absolutely positions the badge so it overlays the calendar icon', () => {
        const has = mobileMediaBlocks().some(b =>
            /#duePill\[data-days-until-due\][^{]*::after\s*\{[^}]*position:\s*absolute/.test(b)
        );
        expect(has).toBe(true);
    });

    it('styles the digit in Trebuchet MS / Verdana at ~9px weight 500 per the task brief', () => {
        const blocks = mobileMediaBlocks();
        const afterRule = blocks
            .map(b => {
                const m = b.match(/#duePill\[data-days-until-due\][^{]*::after\s*\{([^}]*)\}/);
                return m ? m[1] : '';
            })
            .find(body => body.length > 0);
        expect(afterRule).toBeTruthy();
        expect(afterRule).toMatch(/font-family:[^;]*Trebuchet MS/);
        expect(afterRule).toMatch(/font-family:[^;]*Verdana/);
        expect(afterRule).toMatch(/font-size:\s*9px/);
        expect(afterRule).toMatch(/font-weight:\s*500/);
    });

    it('anchors the badge below the pill\'s vertical center so the digit lands in the calendar\'s date-grid body, not at the header line', () => {
        // Regression for the days-until-due digit "riding up" at the
        // y=6 calendar header line on mobile. A pure top: 60% placed
        // the digit's center on the icon's crossbar once the pill's
        // flex cross-axis resolved smaller than its 32px min-height,
        // surfacing it above the date-grid body of the 14×14 viewBox.
        // The fix anchors the badge at pill-center + a positive pixel
        // nudge so the digit lands inside the date-grid body
        // (header at y=6, rect bottom at y=12.5) regardless of pill
        // height. Accept either an explicit percentage ≥ 65% or a
        // calc(50% + Npx) with N ≥ 2 — both express "deeper into the
        // icon body than the buggy 60% anchor".
        const blocks = mobileMediaBlocks();
        const afterRule = blocks
            .map(b => {
                const m = b.match(/#duePill\[data-days-until-due\][^{]*::after\s*\{([^}]*)\}/);
                return m ? m[1] : '';
            })
            .find(body => body.length > 0);
        expect(afterRule).toBeTruthy();
        const topMatch = afterRule.match(/top:\s*([^;}]+)/);
        expect(topMatch).toBeTruthy();
        const topVal = topMatch[1].trim();
        const percent = topVal.match(/^(\d+(?:\.\d+)?)%$/);
        const calc = topVal.match(/calc\(\s*50%\s*\+\s*(\d+(?:\.\d+)?)px\s*\)/);
        const placedDeeper = (percent && parseFloat(percent[1]) >= 65) ||
                             (calc && parseFloat(calc[1]) >= 2);
        expect(placedDeeper).toBe(true);
    });

    it('inherits the icon stroke color via currentColor so it matches the yellow urgency tint', () => {
        const blocks = mobileMediaBlocks();
        const afterRule = blocks
            .map(b => {
                const m = b.match(/#duePill\[data-days-until-due\][^{]*::after\s*\{([^}]*)\}/);
                return m ? m[1] : '';
            })
            .find(body => body.length > 0);
        expect(afterRule).toBeTruthy();
        expect(afterRule).toMatch(/color:\s*currentColor/);
    });
});
