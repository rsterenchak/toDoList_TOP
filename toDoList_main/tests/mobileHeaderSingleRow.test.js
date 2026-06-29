import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the compressed single-row mobile project header. At the ≤1023px
// breakpoint the header collapses from a stacked block (large name on one
// line, count pills on a second line) into ONE row on a deep #15151e bar:
// the project name renders as a prominent, bold, accent-purple (#9D93EE)
// centered title with its ▾ dropdown chevron grouped immediately beside it
// — a clean title rather than a boxed pill — absolute-centered against the
// full bar width and height, plus the open/done counts as inline plain text
// on the right, with the hamburger staying absolute-anchored at the
// top-right. The styling lives in the "Compressed single-row mobile header"
// override block; the JS count/label contract and the workspace-picker tap
// wiring stay intact. Verified through source inspection because main.js is
// too large to instantiate in jsdom (per CLAUDE.md guidance).
describe('Compressed single-row mobile header', () => {
    const css = read('style.css');
    const main = read('main.js');

    // Slice just the compressed-header override block (the second
    // @media (max-width:1023px) pass that re-styles the header) so these
    // assertions can't accidentally read the base STACK block's rules.
    function denseBlock() {
        const start = css.indexOf('── Compressed single-row mobile header');
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

    it('lays the header out as a single horizontal row', () => {
        const block = denseBlock();
        const header = rule(block, '#mobileProjHeader');
        expect(header).toMatch(/flex-direction:\s*row/);
        expect(header).toMatch(/align-items:\s*center/);
        // Right padding reserves space for the absolute hamburger so the
        // inline counts never paint underneath it.
        expect(header).toMatch(/padding:[^;]*\)\s+60px\s+8px\s+16px/);
    });

    it('hides the PROJECT N OF M label and the ‹ › carousel chevrons', () => {
        const block = denseBlock();
        expect(rule(block, '#mobileProjLabel')).toMatch(/display:\s*none/);
        expect(rule(block, '.mobileProjChev')).toMatch(/display:\s*none/);
    });

    it('renders the title as a prominent 18px centered bold accent-purple #9D93EE title, wrapping to at most two lines', () => {
        const name = rule(denseBlock(), '#mobileProjName');
        expect(name).toMatch(/font-size:\s*18px/);
        expect(name).toMatch(/font-weight:\s*700/);
        expect(name).toMatch(/text-align:\s*center/);
        expect(name).toMatch(/color:\s*#9D93EE/i);
        // Two-line wrap (clamp), not the old single-line ellipsis.
        expect(name).toMatch(/-webkit-line-clamp:\s*2/);
        expect(name).toMatch(/-webkit-box-orient:\s*vertical/);
        expect(name).toMatch(/overflow:\s*hidden/);
        expect(name).not.toMatch(/white-space:\s*nowrap/);
    });

    it('paints the bar in the deep near-black #15151e (Option A)', () => {
        const header = rule(denseBlock(), '#mobileProjHeader');
        expect(header).toMatch(/background:\s*#15151e/i);
    });

    it('drops the boxed pill chrome for a clean centered title group', () => {
        const titleRow = rule(denseBlock(), '#mobileProjTitleRow');
        // The A3 pill (rounded border + tinted fill + inset padding) is gone —
        // the title now reads as a confident title, not a chip.
        expect(titleRow).not.toMatch(/border-radius:\s*14px/);
        expect(titleRow).not.toMatch(/background:\s*#1a1826/i);
        expect(titleRow).not.toMatch(/border:\s*1px solid rgba\(108,\s*93,\s*245/i);
        expect(titleRow).not.toMatch(/padding:\s*1px 4px 1px 12px/);
        // The name and ▾ stay grouped and centered as one unit.
        expect(titleRow).toMatch(/align-items:\s*center/);
        expect(titleRow).toMatch(/justify-content:\s*center/);
    });

    it('centers the title group against the full bar width and height via absolute positioning', () => {
        const block = denseBlock();
        // The header is the containing block for the absolutely-centered group.
        const header = rule(block, '#mobileProjHeader');
        expect(header).toMatch(/position:\s*relative/);
        // The group is taken out of flow and centered against the whole bar
        // (not the leftover flex space) — absolute + left/top:50% + translate.
        const titleRow = rule(block, '#mobileProjTitleRow');
        expect(titleRow).toMatch(/position:\s*absolute/);
        expect(titleRow).toMatch(/left:\s*50%/);
        expect(titleRow).toMatch(/top:\s*50%/);
        expect(titleRow).toMatch(/transform:\s*translate\(-50%,\s*-50%\)/);
        expect(titleRow).toMatch(/width:\s*max-content/);
        expect(titleRow).toMatch(/max-width:\s*60%/);
        expect(titleRow).toMatch(/justify-content:\s*center/);
        // The old flex-grow centering is gone.
        expect(titleRow).not.toMatch(/flex:\s*1 1 auto/);
    });

    it('removes the accent-underline pseudo-element and its reserved space (A3)', () => {
        const block = denseBlock();
        // The ::after underline is gone entirely.
        expect(block).not.toMatch(/#mobileProjTitleRow::after/);
        // And the padding-bottom that reserved room for it is gone from the row.
        const titleRow = rule(block, '#mobileProjTitleRow');
        expect(titleRow).not.toMatch(/padding-bottom/);
    });

    it('paints the ▾ project-menu chevron in full accent purple (A3)', () => {
        const chev = rule(denseBlock(), '.mobileProjDropdownChev');
        expect(chev).toMatch(/color:\s*#6C5DF5/i);
    });

    it('pushes the counts to the right edge of the row', () => {
        const stats = rule(denseBlock(), '#mobileProjStats');
        expect(stats).toMatch(/margin-left:\s*auto/);
    });

    it('reveals the header as the project pill at the ≥1024px breakpoint (D1c)', () => {
        // The compressed single-row layout is mobile-only, but D1c no longer
        // hides #mobileProjHeader at desktop — it is revealed there as the
        // compact project pill (an inline-flex drawer trigger), not
        // display:none. This pins that the old desktop-hide rule is gone and
        // the pill is shown.
        expect(css).not.toMatch(
            /@media \(min-width:\s*1024px\)\s*\{[\s\S]*?#mobileProjHeader\s*\{\s*display:\s*none\s*;?\s*\}/
        );
        expect(css).toMatch(
            /@media \(min-width:\s*1024px\)\s*\{[\s\S]*?#mobileProjHeader\s*\{[\s\S]*?display:\s*inline-flex/
        );
    });

    it('keeps the workspace-picker tap wiring on the name and dropdown chevron', () => {
        // Tapping the title or the ▾ chevron must still open the project
        // picker after the compression — now via activateProjectPicker, which
        // routes to the mobile drawer below 1024px.
        expect(main).toMatch(/mobileProjName\.addEventListener\(\s*['"]click['"]\s*,\s*activateProjectPicker\s*\)/);
        expect(main).toMatch(/mobileProjChevron\.addEventListener\(\s*['"]click['"]\s*,\s*activateProjectPicker\s*\)/);
    });
});
