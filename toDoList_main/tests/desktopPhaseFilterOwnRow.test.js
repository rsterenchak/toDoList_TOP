import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract that at desktop widths the filter pills (ALL / IN PROGRESS /
// DONE) sit on their OWN full-width row, with the Sort dropdown overlay + blocked
// chip dropped to the row beneath. Sharing one row with the Sort overlay squeezed
// each pill too narrow in the ~308px queue rail, truncating the longest label and
// pushing DONE out of view. The fix stacks #taskFilterBar into a column at desktop
// only.
//
// Verified by source inspection because jsdom does no layout and main.js is too
// large to instantiate (per CLAUDE.md guidance). A layout-computed assertion is
// not possible here; these pins guard the mechanism of the fix — the two-row
// stack and the Sort overlay's move off the top row — from silent regression.
describe('desktop phase filters get their own full-width row', () => {
    const css = read('style.css');

    // The desktop header consolidation media region (>= 1024px) holds the
    // desktop-scoped #taskFilterBar / #bulkDescActions rules.
    function consolidationBlock() {
        const start = css.indexOf('DESKTOP HEADER CONSOLIDATION');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('D2 — DESKTOP TWO-PANE CHAT', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    function ruleBody(block, selector) {
        // Match the bare `<selector> { ... }` rule inside the given block.
        const re = new RegExp(
            '(^|[\\s}])' + selector.replace(/[.#*]/g, '\\$&') + '\\s*\\{([^}]*)\\}',
            'm'
        );
        const m = block.match(re);
        expect(m).not.toBeNull();
        return m[2];
    }

    it('(a) #taskFilterBar stacks into a column at desktop so the pills own a row', () => {
        const rule = ruleBody(consolidationBlock(), '#taskFilterBar');
        expect(rule).toMatch(/flex-direction:\s*column/);
    });

    it('(b) the Sort overlay drops off the top row (no longer top: 0) onto the second row', () => {
        const rule = ruleBody(consolidationBlock(), '#bulkDescActions');
        // It must be pushed down to clear the phase-pill row — not pinned to the
        // bar's top, where it would overlap the pills again.
        expect(rule).toMatch(/top:\s*40px/);
        expect(rule).not.toMatch(/top:\s*0\b/);
    });

    it('(c) the blocked chip is right-anchored on the second row (align-self: flex-end)', () => {
        const block = consolidationBlock();
        const rule = ruleBody(block, '.taskFilterBlockedChip');
        expect(rule).toMatch(/align-self:\s*flex-end/);
    });

    it('(d) the phase-pill labels keep the ellipsis + overflow safety nets', () => {
        // The own-row width should keep the ellipsis from engaging, but the
        // safety nets stay so a longer future label degrades gracefully rather
        // than overflowing the rail.
        const label = css.match(/\.taskPhaseFilterLabel\s*\{([^}]*)\}/);
        expect(label).not.toBeNull();
        expect(label[1]).toMatch(/text-overflow:\s*ellipsis/);
        const group = css.match(/\.taskPhaseFilters\s*\{([^}]*)\}/);
        expect(group).not.toBeNull();
        expect(group[1]).toMatch(/overflow-x:\s*auto/);
    });
});
