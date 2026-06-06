import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the desktop header row-spacing contract: at desktop widths (>=1024px)
// the stacked header rows — top header (#navBar) + view sub-band, then the
// task-pane filter pills row, then the compose row — get vertical breathing
// room so the sections read as distinct (per header-option-b.svg). The gaps
// are added as padding-top on the receiving containers (#mainSec for the
// sub-band -> filter pills gap; #mainList for the filter pills -> compose
// gap) and scoped entirely to the desktop media query so mobile spacing is
// untouched. Verified via source inspection because jsdom does no layout and
// main.js is too large to instantiate (per CLAUDE.md guidance).
describe('desktop header row spacing', () => {
    const css = read('style.css');

    // Slice the desktop header consolidation media region — the spacing rules
    // live at its tail, beside the #bulkDescActions overlay placement.
    function consolidationBlock() {
        const start = css.indexOf('DESKTOP HEADER CONSOLIDATION');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('D2 — DESKTOP TWO-PANE CHAT', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    function paddingTopPx(block, selector) {
        const re = new RegExp(
            selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}'
        );
        const m = block.match(re);
        expect(m).not.toBeNull();
        const pt = m[1].match(/padding-top:\s*(\d+)px/);
        expect(pt).not.toBeNull();
        return parseInt(pt[1], 10);
    }

    it('(a) sub-band -> filter pills gap: #mainSec gets >= 12px padding-top at desktop', () => {
        const block = consolidationBlock();
        // #mainSec carries the whole task pane (filter pills + the SORT/EXPAND
        // overlay anchored to #mainBar) down together, so the overlay stays
        // centered on the filter row while a clear gap opens below the sub-band.
        expect(paddingTopPx(block, '#mainSec')).toBeGreaterThanOrEqual(12);
    });

    it('(b) filter pills -> compose gap: #mainList gets >= 8px padding-top at desktop', () => {
        const block = consolidationBlock();
        expect(paddingTopPx(block, '#mainList')).toBeGreaterThanOrEqual(8);
    });

    it('(c) the spacing rules are scoped to the desktop media query (>= 1024px)', () => {
        // The receiving-container padding sits inside an @media (min-width:1024px)
        // block, so it cannot fire at mobile widths.
        const block = consolidationBlock();
        expect(block).toMatch(/@media \(min-width:\s*1024px\)/);
        // Both spacing rules appear after a min-width:1024px guard in the block.
        const guard = block.indexOf('@media (min-width: 1024px)');
        expect(guard).toBeGreaterThan(-1);
        expect(block.indexOf('#mainSec', guard)).toBeGreaterThan(guard);
        expect(block.indexOf('#mainList', guard)).toBeGreaterThan(guard);
    });

    it('(c) mobile spacing is unchanged — base #mainList keeps its 4px padding and base #mainSec has no padding', () => {
        // Base (non-media) #mainList rule keeps padding: 4px 0 — the desktop
        // padding-top override only applies at >= 1024px, so a 500px viewport
        // renders the original spacing.
        const baseList = css.match(/\n#mainList\s*\{([^}]*)\}/);
        expect(baseList).not.toBeNull();
        expect(baseList[1]).toMatch(/padding:\s*4px 0/);
        expect(baseList[1]).not.toMatch(/padding-top/);
        // Base #mainSec declares no padding, so mobile is untouched.
        const baseSec = css.match(/\n#mainSec\s*\{([^}]*)\}/);
        expect(baseSec).not.toBeNull();
        expect(baseSec[1]).not.toMatch(/padding/);
    });
});
