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
// line, count pills on a second line) into ONE row on a deep #15151e bar
// (Option A): the centered, bold near-white project name with a short
// purple accent underline beneath it and its ▾ dropdown chevron, plus the
// open/done counts as inline plain text on the right, with the hamburger
// staying absolute-anchored at the top-right. The styling lives in the
// "Compressed single-row mobile header" override block; the JS count/label
// contract and the workspace-picker tap wiring stay intact. Verified
// through source inspection because main.js is too large to instantiate in
// jsdom (per CLAUDE.md guidance).
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

    it('renders the title at 14px, centered and bold in near-white #e8e8f0, ellipsised to one line (Option A)', () => {
        const name = rule(denseBlock(), '#mobileProjName');
        expect(name).toMatch(/font-size:\s*14px/);
        expect(name).toMatch(/font-weight:\s*700/);
        expect(name).toMatch(/text-align:\s*center/);
        expect(name).toMatch(/color:\s*#e8e8f0/i);
        expect(name).toMatch(/text-overflow:\s*ellipsis/);
        expect(name).toMatch(/white-space:\s*nowrap/);
        expect(name).toMatch(/overflow:\s*hidden/);
    });

    it('paints the bar in the deep near-black #15151e (Option A)', () => {
        const header = rule(denseBlock(), '#mobileProjHeader');
        expect(header).toMatch(/background:\s*#15151e/i);
    });

    it('draws a short purple accent underline centered beneath the name (Option A)', () => {
        const block = denseBlock();
        // The title row grows + centers so the name reads as centered, with
        // room reserved below for the underline.
        const titleRow = rule(block, '#mobileProjTitleRow');
        expect(titleRow).toMatch(/justify-content:\s*center/);
        expect(titleRow).toMatch(/position:\s*relative/);
        // The underline pseudo-element: ~120px wide, 2.5px tall, accent purple,
        // centered horizontally, and non-interactive so taps still reach the name.
        const underline = rule(block, '#mobileProjTitleRow::after');
        expect(underline).toMatch(/width:\s*120px/);
        expect(underline).toMatch(/height:\s*2\.5px/);
        expect(underline).toMatch(/background:\s*#6C5DF5/i);
        expect(underline).toMatch(/left:\s*50%/);
        expect(underline).toMatch(/transform:\s*translateX\(-50%\)/);
        expect(underline).toMatch(/pointer-events:\s*none/);
    });

    it('keeps the ▾ project-menu chevron in a muted-gray token (Option A)', () => {
        const chev = rule(denseBlock(), '.mobileProjDropdownChev');
        expect(chev).toMatch(/color:\s*var\(--text-muted\)/);
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
