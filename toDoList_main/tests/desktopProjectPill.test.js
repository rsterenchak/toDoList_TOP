import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the D1c contract: at desktop widths (>=1024px) the project header
// (#mobileProjHeader) is revealed as a compact project pill — the active
// project name + a ▾ dropdown indicator — that sits at the top-left of the
// main pane and opens the unified slide-in drawer (D1b). The hamburger
// (#sidebarToggle) is hidden at desktop because the pill is now the single
// drawer trigger; the ‹ › carousel chevrons stay mobile-only. Mobile UX is
// unchanged. Verified via source inspection because main.js is too large to
// instantiate in jsdom (per CLAUDE.md guidance).
describe('D1c — desktop project pill', () => {
    const css = read('style.css');
    const main = read('main.js');

    // Slice the dedicated D1c desktop block so assertions can't accidentally
    // read the mobile compressed-header rules (which share selector names).
    function desktopPillBlock() {
        const start = css.indexOf('D1c — DESKTOP PROJECT PILL');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('PHONE ≤ 420px', start);
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

    // The desktop block carries two #mobileProjHeader rules — a one-line grid
    // placement (grid-row: 1) and the full styling rule. Grab the styling one
    // (the rule body that declares display:inline-flex) explicitly.
    function pillStyleRule() {
        const block = desktopPillBlock();
        const m = block.match(/#mobileProjHeader\s*\{([^}]*display:\s*inline-flex[^}]*)\}/);
        expect(m).not.toBeNull();
        return m[1];
    }

    it('(a) #mobileProjHeader is NOT display:none at desktop — it is revealed as the pill', () => {
        // The old desktop-hide rule is gone entirely...
        expect(css).not.toMatch(
            /@media \(min-width:\s*1024px\)\s*\{[\s\S]*?#mobileProjHeader\s*\{\s*display:\s*none\s*;?\s*\}/
        );
        // ...and the pill renders as an inline-flex, content-sized box capped
        // at a reasonable max-width with ellipsis-friendly chrome.
        const header = pillStyleRule();
        expect(header).toMatch(/display:\s*inline-flex/);
        expect(header).toMatch(/max-width:\s*280px/);
        expect(header).toMatch(/justify-self:\s*start/);
        expect(header).toMatch(/cursor:\s*pointer/);
    });

    it('(b) the hamburger (#sidebarToggle) is display:none at desktop', () => {
        expect(rule(desktopPillBlock(), '#sidebarToggle')).toMatch(/display:\s*none/);
    });

    it('(c) the ‹ › carousel chevrons are hidden at desktop (pill is name + ▾ only)', () => {
        const block = desktopPillBlock();
        // #mobileProjPrev / #mobileProjNext both carry the .mobileProjChev
        // class, which is set to display:none in the pill block alongside the
        // PROJECT N OF M label and the open/done counts (mobile affordances).
        expect(block).toMatch(
            /#mobileProjLabel,\s*\.mobileProjChev,\s*#mobileProjStats\s*\{\s*display:\s*none/
        );
        // The dropdown indicator (▾) stays visible — it advertises the drawer.
        expect(rule(block, '.mobileProjDropdownChev')).not.toMatch(/display:\s*none/);
    });

    it('(d) the pill tap still opens the drawer at every breakpoint', () => {
        // openMobileDrawer is wired on the name and the ▾ chevron, and it
        // opens the unified drawer by adding sidebar-open — no viewport gate.
        expect(main).toMatch(/mobileProjName\.addEventListener\(\s*['"]click['"]\s*,\s*openMobileDrawer\s*\)/);
        expect(main).toMatch(/mobileProjChevron\.addEventListener\(\s*['"]click['"]\s*,\s*openMobileDrawer\s*\)/);
        const fnIdx = main.indexOf('function openMobileDrawer(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fnBody = main.slice(fnIdx, main.indexOf('}', main.indexOf('{', fnIdx)) + 1);
        expect(fnBody).toMatch(/classList\.add\(\s*['"]sidebar-open['"]\s*\)/);
        expect(fnBody).not.toMatch(/isMobile\(\)/);
    });

    it('(e) the pill text reflects the active project name at all breakpoints', () => {
        // updateMobileProjHeader writes the active project name into the pill,
        // and clears it / marks the header empty when there is no active
        // project — the single source of truth for the pill label.
        expect(main).toMatch(/mobileProjName\.textContent\s*=\s*activeName/);
        expect(main).toMatch(/mobileProjHeader\.setAttribute\(\s*['"]data-empty['"]\s*,\s*['"]true['"]\s*\)/);
    });

    it('hides the empty-state pill at desktop (no bare pill without an active project)', () => {
        const block = desktopPillBlock();
        expect(block).toMatch(/#mobileProjHeader\[data-empty="true"\]\s*\{\s*display:\s*none/);
    });

    it('gives the pill its own grid row above the filter pills', () => {
        const block = desktopPillBlock();
        expect(rule(block, '#mainBar')).toMatch(/grid-template-rows:\s*auto auto 1fr/);
        expect(block).toMatch(/#mobileProjHeader\s*\{\s*grid-row:\s*1\s*;?\s*\}/);
        expect(block).toMatch(/#taskFilterBar\s*\{\s*grid-row:\s*2\s*;?\s*\}/);
        expect(block).toMatch(/#mainList\s*\{\s*grid-row:\s*3\s*;?\s*\}/);
    });
});
