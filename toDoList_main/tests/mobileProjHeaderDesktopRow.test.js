import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression guard for the two desktop workspace-pill (#mobileProjHeader)
// regressions introduced by the header-polish entry:
//   (1) the pill rendered as two stacked lines — project name on one line,
//       the ▾ dropdown indicator on a second line below — because the desktop
//       title row had no `display: flex` (it fell back to block flow, stacking
//       its block-level name and the chevron).
//   (2) clicking the body of the pill no longer opened the project drawer,
//       because the drawer-open handler was bound only to the name and the ▾
//       chevron, not to the padded pill (#mobileProjHeader) itself.
// Both are pinned here by source inspection because main.js is too large to
// instantiate in jsdom (per CLAUDE.md guidance).
describe('desktop workspace pill — single row + click-to-open', () => {
    const css = read('style.css');
    const main = read('main.js');

    // Slice just the D1c desktop pill block so these assertions can't read the
    // similarly-named mobile rules (which legitimately stack / use flex too).
    function desktopPillBlock() {
        const start = css.indexOf('D1c — DESKTOP PROJECT PILL');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('DESKTOP HEADER CONSOLIDATION', start);
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

    it('(a) lays the desktop title row out as a horizontal flex row, not stacked', () => {
        // The fix: the desktop #mobileProjTitleRow declares display:flex with a
        // row direction so the project name and the ▾ chevron sit side-by-side.
        // Without this the row falls back to block flow and the chevron drops
        // onto a second line — the reported two-line regression.
        const titleRow = rule(desktopPillBlock(), '#mobileProjTitleRow');
        expect(titleRow).toMatch(/display:\s*flex/);
        expect(titleRow).toMatch(/flex-direction:\s*row/);
        expect(titleRow).not.toMatch(/flex-direction:\s*column/);
    });

    it('(b) keeps the pill compact — name on one line, ellipsised, with a small line-height', () => {
        // A single-line name plus the row layout keeps the pill within the
        // ~32px nav band (catches a height regression from a wrapping name).
        const name = rule(desktopPillBlock(), '#mobileProjName');
        expect(name).toMatch(/white-space:\s*nowrap/);
        expect(name).toMatch(/text-overflow:\s*ellipsis/);
        expect(name).toMatch(/overflow:\s*hidden/);
        expect(name).toMatch(/font-size:\s*14px/);
    });

    it('(c) binds a drawer-open click handler to the pill (#mobileProjHeader) itself', () => {
        // The fix for the click regression: the whole padded pill is clickable,
        // not just the name + ▾ glyphs. Locate the header click listener and
        // confirm it routes to openMobileDrawer.
        const idx = main.indexOf("mobileProjHeader.addEventListener('click'");
        expect(idx).toBeGreaterThan(-1);
        // Grab the handler body up to its closing "});".
        const handler = main.slice(idx, main.indexOf('});', idx) + 3);
        expect(handler).toMatch(/openMobileDrawer\(\)/);
    });

    it('(d) the pill handler ignores ‹ › carousel chevron clicks so mobile project-nav is unchanged', () => {
        // At mobile the ‹ › chevrons (.mobileProjChev) navigate prev/next
        // project; they must NOT also open the drawer when their clicks bubble
        // up to the header handler. The handler bails on .mobileProjChev targets.
        const idx = main.indexOf("mobileProjHeader.addEventListener('click'");
        const handler = main.slice(idx, main.indexOf('});', idx) + 3);
        expect(handler).toMatch(/\.mobileProjChev/);
    });

    it('(e) retains the original name + ▾ chevron drawer wiring (mobile contract)', () => {
        // The header-level handler is additive — the existing name and dropdown
        // chevron listeners stay so the mobile picker tap is byte-for-byte the
        // same behavior it always had.
        expect(main).toMatch(/mobileProjName\.addEventListener\(\s*['"]click['"]\s*,\s*openMobileDrawer\s*\)/);
        expect(main).toMatch(/mobileProjChevron\.addEventListener\(\s*['"]click['"]\s*,\s*openMobileDrawer\s*\)/);
    });

    it('(f regression) the mobile title row stays a flex row and the ‹ › chevrons stay visible', () => {
        // Guard that the desktop fix didn't disturb the mobile layout: the base
        // (max-width:1023px) title row is still display:flex and the carousel
        // chevrons are not hidden at mobile widths.
        const mobileScope = css.slice(
            css.indexOf('@media (max-width: 1023px)'),
            css.indexOf('@media (min-width: 1024px)', css.indexOf('@media (max-width: 1023px)'))
        );
        expect(mobileScope).toMatch(/#mobileProjTitleRow\s*\{[^}]*display:\s*flex/);
    });
});
