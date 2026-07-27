import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the desktop two-line project block: at desktop widths (>=1024px) the
// project header (#mobileProjHeader) renders a "PROJECT n OF m" eyebrow above
// the project name (the larger purple monospace treatment) with its ▾ caret,
// and the inline open/total count badge is dropped (the counts live in the
// footer). Mobile keeps its single-line name + count badge + caret. Verified
// via source + CSS inspection because main.js is too large to instantiate in
// jsdom (per CLAUDE.md guidance).
describe('desktop project eyebrow — PROJECT n OF m two-line block', () => {
    const css = read('style.css');
    const main = read('main.js');
    const footerCounts = read('footerCounts.js');

    // Slice just the D1c desktop pill block so these assertions can't read the
    // similarly-named mobile rules (which legitimately show the label / badge).
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

    it('(a) the header lays out as a two-line column (eyebrow stacked over the title row)', () => {
        // pillStyleRule: grab the styling rule body (the one declaring the
        // display:inline-flex box) rather than any grid-placement rule.
        const block = desktopPillBlock();
        const m = block.match(/#mobileProjHeader\s*\{([^}]*display:\s*inline-flex[^}]*)\}/);
        expect(m).not.toBeNull();
        const header = m[1];
        expect(header).toMatch(/flex-direction:\s*column/);
        // Must NOT still be a horizontal row, or the eyebrow would sit inline
        // beside the name instead of above it.
        expect(header).not.toMatch(/flex-direction:\s*row/);
        // A flex block that truncates a long name needs a min-width floor.
        expect(header).toMatch(/min-width:\s*0/);
    });

    it('(b) the eyebrow (#mobileProjLabel) is shown as a small uppercase muted-monospace line', () => {
        const eyebrow = rule(desktopPillBlock(), '#mobileProjLabel');
        expect(eyebrow).not.toMatch(/display:\s*none/);
        expect(eyebrow).toMatch(/text-transform:\s*uppercase/);
        expect(eyebrow).toMatch(/font-family:\s*'SpaceMono'/);
        expect(eyebrow).toMatch(/color:\s*var\(--text-muted\)/);
        // Smaller than the name (14px) so the name reads as the larger line.
        expect(eyebrow).toMatch(/font-size:\s*10px/);
        // A long project count line still truncates rather than wrapping.
        expect(eyebrow).toMatch(/text-overflow:\s*ellipsis/);
    });

    it('(c) the name stays the larger purple monospace treatment on the second line', () => {
        // Regression guard shared with the desktop-pill tests: the name keeps
        // its 14px purple SpaceMono styling, so the eyebrow (10px, muted) reads
        // as the smaller line and the name as the larger.
        const name = rule(desktopPillBlock(), '#mobileProjName');
        expect(name).toMatch(/font-size:\s*14px/);
        expect(name).toMatch(/color:\s*#9D93EE/);
    });

    it('(d) the title row (name + ▾) stays a horizontal flex row', () => {
        // The two-line stack is header-level; within the second line the name
        // and its ▾ caret must still sit side-by-side.
        const titleRow = rule(desktopPillBlock(), '#mobileProjTitleRow');
        expect(titleRow).toMatch(/display:\s*flex/);
        expect(titleRow).toMatch(/flex-direction:\s*row/);
    });

    it('(e) the inline count badge is absent at desktop widths', () => {
        const badge = rule(desktopPillBlock(), '.mobileProjCountBadge');
        expect(badge).toMatch(/display:\s*none/);
    });

    it('(f) the mobile count-badge writer is untouched (mobile pill unchanged)', () => {
        // The count badge stays populated by updateMobileProjHeader for the
        // mobile pill; hiding it on desktop is CSS-only, so the JS write must
        // remain in place.
        expect(main).toMatch(
            /mobileProjCountBadge\.textContent\s*=\s*open\s*\+\s*['"]\/['"]\s*\+\s*\(open \+ done\)/
        );
    });

    it('(g) the eyebrow text is n-of-m from the ordered project list', () => {
        // n is the active project's 1-based index in listLogic.listProjectsArray()
        // (the same ordered list the sidebar renders), m the total. Reusing that
        // single source keeps the eyebrow and the sidebar in agreement.
        expect(main).toMatch(/const\s+projects\s*=\s*\(listLogic\.listProjectsArray[\s\S]{0,80}\)\s*\|\|\s*\[\]/);
        expect(main).toMatch(/const\s+total\s*=\s*projects\.length/);
        expect(main).toMatch(/const\s+activeIdx\s*=\s*activeName\s*\?\s*projects\.indexOf\(activeName\)/);
        expect(main).toMatch(
            /mobileProjLabel\.textContent\s*=\s*['"]PROJECT\s*['"]\s*\+\s*\(activeIdx\s*\+\s*1\)\s*\+\s*['"]\s*OF\s*['"]\s*\+\s*total/
        );
    });

    it('(h) the eyebrow re-renders on add / delete / switch via the shared counts writer', () => {
        // updateMobileProjHeader (which writes the eyebrow) is driven by
        // updateFooterCounts, itself fired by the footer MutationObserver — so
        // any project add / delete / rename / switch that repaints the counts
        // also recomputes n-of-m. No independent refresh path to drift.
        expect(footerCounts).toMatch(/updateMobileProjHeader\(name,\s*open,\s*done\)/);
        expect(main).toMatch(/new MutationObserver\(updateFooterCounts\)/);
    });

    it('(i) the eyebrow is aria-hidden so the pill accessible name is unchanged', () => {
        // With two visible lines the eyebrow would otherwise be announced ahead
        // of the project name; marking it aria-hidden keeps the accessible name
        // the project name alone, as before the two-line treatment.
        expect(main).toMatch(/mobileProjLabel\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
    });

    it('(j) the whole block still opens the project picker', () => {
        // Both lines are part of the one clickable pill: the header-level click
        // handler routes to activateProjectPicker (desktop dropdown), unchanged
        // by the two-line restyle.
        const idx = main.indexOf("mobileProjHeader.addEventListener('click'");
        expect(idx).toBeGreaterThan(-1);
        const handler = main.slice(idx, main.indexOf('});', idx) + 3);
        expect(handler).toMatch(/activateProjectPicker\(\)/);
    });
});
