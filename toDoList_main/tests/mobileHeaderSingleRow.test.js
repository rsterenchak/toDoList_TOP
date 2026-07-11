import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the dense left-aligned mobile project header (Variant C). At the
// ≤1023px breakpoint the header lays out as a horizontal row on a deep
// #15151e bar: a left column (#mobileProjMain) stacks, flush to the left
// edge, the PROJECT N OF M label, a name row (project name + ▾ dropdown
// chevron + run spinner inline) rendered as a clean left-aligned accent
// title, and an open/done counts line below; a vertically-stacked ‹ / ›
// chevron column (#mobileProjChevCol) sits at the right of the row. The
// styling lives in the "Dense left-aligned mobile header (Variant C)"
// override block; the JS count/label contract and the workspace-picker tap
// wiring stay intact. Verified through source inspection because main.js is
// too large to instantiate in jsdom (per CLAUDE.md guidance).
describe('Dense left-aligned mobile header (Variant C)', () => {
    const css = read('style.css');
    const main = read('main.js');

    // Slice just the Variant C override block (the second
    // @media (max-width:1023px) pass that re-styles the header) so these
    // assertions can't accidentally read the base STACK block's rules.
    function denseBlock() {
        const start = css.indexOf('── Dense left-aligned mobile header (Variant C)');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('App-root safe-area paint', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    function rule(block, selector) {
        const re = new RegExp(
            selector.replace(/[#.[\]"=:]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}'
        );
        const m = block.match(re);
        expect(m).not.toBeNull();
        return m[1];
    }

    it('lays the header out as a single horizontal row on the deep #15151e bar', () => {
        const block = denseBlock();
        const header = rule(block, '#mobileProjHeader');
        expect(header).toMatch(/flex-direction:\s*row/);
        expect(header).toMatch(/align-items:\s*center/);
        expect(header).toMatch(/gap:\s*12px/);
        expect(header).toMatch(/background:\s*#15151e/i);
        // Left/right padding is symmetric now — the hamburger is gone on mobile
        // so no right-side slot is reserved.
        expect(header).toMatch(/padding:[^;]*\)\s+16px\s+6px\s+16px/);
        // Retains the defensive stacking context.
        expect(header).toMatch(/position:\s*relative/);
    });

    it('stacks the label / name-row / counts flush-left in the left column', () => {
        const main2 = rule(denseBlock(), '#mobileProjMain');
        expect(main2).toMatch(/display:\s*flex/);
        expect(main2).toMatch(/flex-direction:\s*column/);
        expect(main2).toMatch(/align-items:\s*flex-start/);
        // Absorbs the horizontal slack so the chevron column parks at the right.
        expect(main2).toMatch(/flex:\s*1 1 auto/);
    });

    it('keeps the PROJECT N OF M label visible (it is the top band of the column)', () => {
        // Unlike the old compressed single-row header, Variant C keeps the label
        // — it is the first stacked band of the left column, not hidden.
        expect(rule(denseBlock(), '#mobileProjLabel')).toMatch(/display:\s*block/);
    });

    it('renders the title as a one-line 16px left-aligned bold accent-purple #9D93EE title that ellipsizes', () => {
        const name = rule(denseBlock(), '#mobileProjName');
        expect(name).toMatch(/font-size:\s*16px/);
        expect(name).toMatch(/font-weight:\s*700/);
        expect(name).toMatch(/text-align:\s*left/);
        expect(name).toMatch(/color:\s*#9D93EE/i);
        // One line with ellipsis, not a two-line clamp — a name too long for one
        // line truncates rather than wrapping the chevron off the row.
        expect(name).toMatch(/white-space:\s*nowrap/);
        expect(name).toMatch(/text-overflow:\s*ellipsis/);
        expect(name).toMatch(/overflow:\s*hidden/);
        expect(name).not.toMatch(/-webkit-line-clamp:\s*2/);
    });

    it('renders the name + ▾ as a clean left-aligned title, not a boxed pill', () => {
        const block = denseBlock();
        // The name + ▾ live inside #mobileProjPill, but in Variant C the wrapper
        // carries no border/background/radius — it is a plain inline-flex group,
        // a clean title rather than the boxed chip.
        const pill = rule(block, '#mobileProjPill');
        expect(pill).toMatch(/display:\s*inline-flex/);
        expect(pill).toMatch(/align-items:\s*center/);
        expect(pill).toMatch(/border:\s*none/);
        expect(pill).toMatch(/background:\s*none/);
        // The name row is left-aligned, not centered.
        const titleRow = rule(block, '#mobileProjTitleRow');
        expect(titleRow).toMatch(/justify-content:\s*flex-start/);
    });

    it('lays the name row out in normal flow, left-aligned (no absolute bar-centering)', () => {
        const titleRow = rule(denseBlock(), '#mobileProjTitleRow');
        // The old absolute bar-centering is gone — the row is in normal flow.
        expect(titleRow).toMatch(/position:\s*static/);
        expect(titleRow).not.toMatch(/position:\s*absolute/);
        expect(titleRow).not.toMatch(/transform:\s*translate\(-50%/);
        // The swipe surface stays pan-y so the horizontal gesture handler can
        // still claim horizontal drags.
        expect(titleRow).toMatch(/touch-action:\s*pan-y/);
    });

    it('paints the ▾ project-menu chevron in full accent purple', () => {
        const chev = rule(denseBlock(), '.mobileProjDropdownChev');
        expect(chev).toMatch(/color:\s*#6C5DF5/i);
    });

    it('hides the desktop in-pill count badge on mobile (counts render as their own line)', () => {
        expect(rule(denseBlock(), '.mobileProjCountBadge')).toMatch(/display:\s*none/);
    });

    it('left-aligns the counts line directly under the name row', () => {
        const stats = rule(denseBlock(), '#mobileProjStats');
        expect(stats).toMatch(/margin-left:\s*0/);
        expect(stats).toMatch(/justify-content:\s*flex-start/);
    });

    it('reveals the ‹ › chevrons as a vertical column at the right of the row', () => {
        const block = denseBlock();
        const col = rule(block, '#mobileProjChevCol');
        expect(col).toMatch(/display:\s*flex/);
        expect(col).toMatch(/flex-direction:\s*column/);
        expect(col).toMatch(/margin-left:\s*auto/);
        // The chevrons are visible here (mobile), stacked in the column — not
        // hidden as they were in the old centered single-row layout.
        expect(block).toMatch(/#mobileProjChevCol\s+\.mobileProjChev\s*\{[^}]*display:\s*inline-flex/);
    });

    it('populates the counts and the badge from the single header writer', () => {
        // updateMobileProjHeader is the sole writer of both the mobile counts
        // line and the desktop "open/total" badge.
        expect(main).toMatch(/mobileProjCounts\.textContent\s*=\s*open\s*\+\s*['"] open · ['"]\s*\+\s*done/);
        expect(main).toMatch(/mobileProjCountBadge\.textContent\s*=\s*open\s*\+\s*['"]\/['"]\s*\+\s*\(open \+ done\)/);
    });

    it('reveals the header as the project pill at the ≥1024px breakpoint (D1c)', () => {
        // The dense left-aligned layout is mobile-only, but D1c still reveals
        // #mobileProjHeader at desktop as the compact project pill (an
        // inline-flex drawer trigger), not display:none.
        expect(css).not.toMatch(
            /@media \(min-width:\s*1024px\)\s*\{[\s\S]*?#mobileProjHeader\s*\{\s*display:\s*none\s*;?\s*\}/
        );
        expect(css).toMatch(
            /@media \(min-width:\s*1024px\)\s*\{[\s\S]*?#mobileProjHeader\s*\{[\s\S]*?display:\s*inline-flex/
        );
    });

    it('keeps the workspace-picker tap wiring on the name and dropdown chevron', () => {
        // Tapping the title or the ▾ chevron must still open the project
        // picker — now via activateProjectPicker, which routes to the mobile
        // drawer below 1024px.
        expect(main).toMatch(/mobileProjName\.addEventListener\(\s*['"]click['"]\s*,\s*activateProjectPicker\s*\)/);
        expect(main).toMatch(/mobileProjChevron\.addEventListener\(\s*['"]click['"]\s*,\s*activateProjectPicker\s*\)/);
    });
});
