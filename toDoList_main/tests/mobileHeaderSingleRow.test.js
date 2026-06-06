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
// line, count pills on a second line) into ONE ~40px row: project name +
// ▾ dropdown chevron on the left, the open/done counts as inline plain
// text on the right, with the hamburger staying absolute-anchored at the
// top-right. The styling lives in the "Compressed single-row mobile
// header" override block; the JS count/label contract and the
// workspace-picker tap wiring stay intact. Verified through source
// inspection because main.js is too large to instantiate in jsdom (per
// CLAUDE.md guidance).
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

    it('renders the title at 14px in the #9D93EE purple token, ellipsised to one line', () => {
        const name = rule(denseBlock(), '#mobileProjName');
        expect(name).toMatch(/font-size:\s*14px/);
        expect(name).toMatch(/color:\s*#9D93EE/i);
        expect(name).toMatch(/text-overflow:\s*ellipsis/);
        expect(name).toMatch(/white-space:\s*nowrap/);
        expect(name).toMatch(/overflow:\s*hidden/);
    });

    it('pushes the counts to the right edge of the row', () => {
        const stats = rule(denseBlock(), '#mobileProjStats');
        expect(stats).toMatch(/margin-left:\s*auto/);
    });

    it('renders the counts as plain inline text, not pills', () => {
        const block = denseBlock();
        // No pill chrome remains on the counts in the compressed header.
        expect(block).not.toMatch(/border-radius:\s*999px/);
        // The two counts carry their own standalone color rules (the open
        // count in purple, the done count muted).
        expect(block).toMatch(/#mobileProjOpen\s*\{\s*color:\s*#6C5DF5\s*;?\s*\}/i);
        expect(block).toMatch(/#mobileProjDone\s*\{\s*color:\s*#5a5a6a\s*;?\s*\}/i);
    });

    it('separates the two counts with a dimmer middot', () => {
        const before = rule(denseBlock(), '#mobileProjDone::before');
        expect(before).toMatch(/content:\s*['"]·['"]/);
        expect(before).toMatch(/color:\s*#8a8a99/i);
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

    it('preserves the JS count text contract ("N open" / "N done")', () => {
        // The middot and styling are pure CSS — the JS still writes the
        // raw "N open" / "N done" strings, so the count source of truth is
        // unchanged.
        expect(main).toMatch(/mobileProjOpen\.textContent\s*=\s*open\s*\+\s*['"]\s*open['"]/);
        expect(main).toMatch(/mobileProjDone\.textContent\s*=\s*done\s*\+\s*['"]\s*done['"]/);
    });

    it('keeps the workspace-picker tap wiring on the name and dropdown chevron', () => {
        // Tapping the title or the ▾ chevron must still open the mobile
        // drawer (the project picker) after the compression.
        expect(main).toMatch(/mobileProjName\.addEventListener\(\s*['"]click['"]\s*,\s*openMobileDrawer\s*\)/);
        expect(main).toMatch(/mobileProjChevron\.addEventListener\(\s*['"]click['"]\s*,\s*openMobileDrawer\s*\)/);
    });
});
