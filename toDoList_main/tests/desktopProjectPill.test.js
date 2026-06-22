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
        // PROJECT N OF M label. The open/done counts (#mobileProjStats) are NO
        // longer hidden here — the desktop header consolidation lifts them out
        // of the pill and seats them inline in the top header.
        expect(block).toMatch(
            /#mobileProjLabel,\s*\.mobileProjChev\s*\{\s*display:\s*none/
        );
        // The dropdown indicator (▾) stays visible — it advertises the drawer.
        expect(rule(block, '.mobileProjDropdownChev')).not.toMatch(/display:\s*none/);
    });

    it('(d) the pill tap activates the project picker (drawer at mobile, dropdown at desktop)', () => {
        // activateProjectPicker is wired on the name and the ▾ chevron and
        // branches on viewport: <1024px opens the unified drawer (sidebar-open
        // via openMobileDrawer), ≥1024px opens the anchored dropdown picker.
        expect(main).toMatch(/mobileProjName\.addEventListener\(\s*['"]click['"]\s*,\s*activateProjectPicker\s*\)/);
        expect(main).toMatch(/mobileProjChevron\.addEventListener\(\s*['"]click['"]\s*,\s*activateProjectPicker\s*\)/);
        const fnIdx = main.indexOf('function openMobileDrawer(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fnBody = main.slice(fnIdx, main.indexOf('}', main.indexOf('{', fnIdx)) + 1);
        expect(fnBody).toMatch(/classList\.add\(\s*['"]sidebar-open['"]\s*\)/);
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

    it('leaves the pill content-sized (no grid row in #mainBar) now that it rides in the top header', () => {
        // The desktop header consolidation lifts the pill out of #mainBar into
        // #navBar via placeDesktopHeader(), so the D1c block no longer reserves
        // a #mainBar grid row for it — #mainBar keeps its base two-track layout
        // (status-filter row, then the list). The styling rule stays (the pill
        // is still a content-sized inline-flex box), just without grid placement.
        const block = desktopPillBlock();
        expect(block).not.toMatch(/#mainBar\s*\{\s*grid-template-rows:\s*auto auto 1fr/);
        expect(block).not.toMatch(/#mobileProjHeader\s*\{\s*grid-row:\s*1\s*;?\s*\}/);
        expect(pillStyleRule()).toMatch(/display:\s*inline-flex/);
    });
});

// The desktop header consolidation: at >=1024px the workspace pill + open/done
// counts move up into the top header (#navBar), the view tabs move into a thin
// sub-band below it (restyled as underlined text), and SORT BY DUE / EXPAND ALL
// drop onto the status-filter row. Verified via source + CSS inspection because
// main.js is too large to instantiate in jsdom (per CLAUDE.md guidance).
describe('desktop header consolidation', () => {
    const css  = read('style.css');
    const main = read('main.js');

    // Slice the dedicated consolidation block so assertions read its rules and
    // not similarly-named rules elsewhere.
    function consolidationBlock() {
        const start = css.indexOf('DESKTOP HEADER CONSOLIDATION');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('D2 — DESKTOP TWO-PANE CHAT', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    it('(a) the desktop view sub-band is visible (display != none) at desktop', () => {
        const block = consolidationBlock();
        const m = block.match(/#desktopViewSubBand\s*\{([^}]*)\}/);
        expect(m).not.toBeNull();
        expect(m[1]).toMatch(/display:\s*flex/);
        expect(m[1]).toMatch(/grid-row:\s*3/);
        // And it's hidden at mobile widths.
        expect(css).toMatch(/@media \(max-width:\s*1023px\)[\s\S]*?#desktopViewSubBand\s*\{\s*display:\s*none/);
    });

    it('(b) the workspace pill is moved into the top header (#navBar) at desktop', () => {
        // placeDesktopHeader() re-parents #mobileProjHeader into #navBar at
        // desktop widths (and back into #mainBar at mobile). The pill is MOVED,
        // not duplicated, so its drawer/swipe wiring survives.
        const fnIdx = main.indexOf('function placeDesktopHeader(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = main.slice(fnIdx, main.indexOf('placeDesktopHeader();', fnIdx));
        expect(fn).toMatch(/window\.innerWidth\s*>=\s*1024/);
        expect(fn).toMatch(/nav\.insertBefore\(\s*mobileProjHeader\s*,\s*pomodoroToggle\s*\)/);
        // Mobile branch returns it to the task pane (#mainBar / main2).
        expect(fn).toMatch(/main2\.insertBefore\(\s*mobileProjHeader\s*,\s*taskFilterBar\s*\)/);
        // Re-placed on every viewport-crossing resize.
        expect(main).toMatch(/addEventListener\(\s*['"]resize['"]\s*,\s*placeDesktopHeader\s*\)/);
    });

    it('(c) the active view tab is purple with an underline at desktop', () => {
        const block = consolidationBlock();
        const active = block.match(/#desktopViewSubBand\s+\.viewPill\.active\s*\{([^}]*)\}/);
        expect(active).not.toBeNull();
        expect(active[1]).toMatch(/color:\s*#9D93EE/);
        // The underline is drawn with an ::after pseudo-element (purple, 2px).
        const after = block.match(/#desktopViewSubBand\s+\.viewPill\.active::after\s*\{([^}]*)\}/);
        expect(after).not.toBeNull();
        expect(after[1]).toMatch(/height:\s*2px/);
        expect(after[1]).toMatch(/background:\s*#9D93EE/);
    });

    it('(d) the counts are relocated into the header beside the pill', () => {
        // updateMobileProjHeader stays the single writer of the count text;
        // placeDesktopHeader() just relocates #mobileProjStats into #navBar at
        // desktop and the consolidation block styles it inline there.
        const block = consolidationBlock();
        expect(block).toMatch(/#navBar\s+#mobileProjStats\s*\{[^}]*display:\s*inline-flex/);
        const fnIdx = main.indexOf('function placeDesktopHeader(');
        const fn = main.slice(fnIdx, main.indexOf('placeDesktopHeader();', fnIdx));
        expect(fn).toMatch(/nav\.insertBefore\(\s*mobileProjStats\s*,\s*pomodoroToggle\s*\)/);
        expect(fn).toMatch(/mobileProjHeader\.appendChild\(\s*mobileProjStats\s*\)/);
    });

    it('(e) the SORT BY DUE / EXPAND ALL overlay drops onto the filter row, body data-view mirror hides the pill in conceive', () => {
        const block = consolidationBlock();
        // The overlay is pulled up to align on the ~36px status-filter row.
        expect(block).toMatch(/#bulkDescActions\s*\{[^}]*top:\s*0/);
        // The pill + counts hide in CONCEIVE via the body[data-view] mirror
        // (they no longer live under #mainBar at desktop widths). Conceive is
        // the only surviving view where the project-context pill must hide.
        expect(block).toMatch(/body\[data-view="conceive"\]\s+#mobileProjHeader/);
        expect(main).toMatch(/document\.body\.setAttribute\(\s*['"]data-view['"]/);
    });

    it('(f) clicking a view tab still updates the active state', () => {
        // The restyle is CSS-only; the click handlers and the active-class
        // toggle in applyActiveView are untouched, so a tab tap still flips
        // which tab is active (and thus which one paints the underline).
        expect(main).toMatch(/viewPillConceive\.addEventListener\(\s*['"]click['"][\s\S]{0,120}applyActiveView\(\s*['"]conceive['"]/);
        const fnIdx = main.indexOf('function applyActiveView(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = main.slice(fnIdx, fnIdx + 1400);
        expect(fn).toMatch(/pillProjects\.classList\.toggle\(\s*['"]active['"]/);
        expect(fn).toMatch(/pillConceive\.classList\.toggle\(\s*['"]active['"]/);
    });

    it('(regression) the mobile bottom tab bar keeps its own pill styling, untouched by the desktop restyle', () => {
        // The underlined-text restyle is scoped to #desktopViewSubBand .viewPill
        // only; the mobile #mobileTabBar / .mobileTab buttons are a separate
        // element set and must not be affected. Guard that .mobileTab still
        // carries its own styling and is not pulled into the sub-band scope.
        expect(css).toMatch(/\.mobileTab\s*\{/);
        const block = consolidationBlock();
        expect(block).not.toMatch(/mobileTab/);
    });
});
