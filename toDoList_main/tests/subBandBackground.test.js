import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract that the desktop view-tab sub-band (#desktopViewSubBand)
// paints --bg-base so it matches the filter+sort band (#taskFilterBar) directly
// below it. Both bands must resolve to the same colour with no visible seam: the
// filter band is transparent and falls through to #mainBar's --bg-base, while
// the sub-band lives under #outerContainer (the greyer chrome) and so must
// paint --bg-base explicitly rather than rely on a transparent fall-through. A
// previous round left the sub-band transparent, so the two bands inherited
// different parent backgrounds and looked mismatched; an even earlier round gave
// it a lighter #08080d stripe. Neither is correct — it must be exactly
// var(--bg-base), the same token #mainBar paints. Verified via source inspection
// because jsdom does no layout and main.js is too large to instantiate (per
// CLAUDE.md guidance).
describe('desktop view sub-band background', () => {
    const css = read('style.css');

    // The desktop #desktopViewSubBand rule lives inside the desktop header
    // consolidation media region (>= 1024px). A separate base rule sets
    // display:none at mobile widths, so slice the consolidation block first to
    // target the desktop rule specifically.
    function consolidationBlock() {
        const start = css.indexOf('DESKTOP HEADER CONSOLIDATION');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('D2 — DESKTOP TWO-PANE CHAT', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    function subBandRule() {
        const block = consolidationBlock();
        const re = /#desktopViewSubBand\s*\{([^}]*)\}/;
        const m = block.match(re);
        expect(m).not.toBeNull();
        return m[1];
    }

    // The bare `#mainBar { ... }` rule, used as the anchor: the sub-band must
    // paint the SAME token #mainBar does, so the two bands can never drift apart.
    function mainBarRule() {
        const m = css.match(/(^|[\s}])#mainBar\s*\{([^}]*)\}/m);
        expect(m).not.toBeNull();
        return m[2];
    }

    it('(a) the sub-band paints var(--bg-base), the same token #mainBar paints', () => {
        const rule = subBandRule();
        // It must paint --bg-base explicitly — not transparent (which would fall
        // through to #outerContainer's greyer chrome and mismatch the filter
        // band) and not the lighter #08080d stripe an earlier round shipped.
        expect(rule).toMatch(/background:\s*var\(--bg-base\)/);
        expect(rule).not.toMatch(/background:\s*transparent/);
        expect(rule).not.toMatch(/background:\s*#08080d/);
        // Anchor against #mainBar: both bands resolve to the same colour. If a
        // future change repaints #mainBar, this forces the sub-band to follow.
        expect(mainBarRule()).toMatch(/background:\s*var\(--bg-base\)/);
    });

    it('(b) the sub-band declares no top or bottom border', () => {
        const rule = subBandRule();
        expect(rule).not.toMatch(/border-top/);
        expect(rule).not.toMatch(/border-bottom/);
    });

    it('(c) the view tabs keep their active accent styling (unchanged)', () => {
        // The active tab purple text + underline indicator are untouched.
        expect(css).toMatch(/#desktopViewSubBand \.viewPill\.active\s*\{[^}]*color:\s*#9D93EE/);
        expect(css).toMatch(/#desktopViewSubBand \.viewPill\.active::after\s*\{[^}]*background:\s*#9D93EE/);
    });

    it('(d) the sub-band keeps its grid-row:3 placement under #outerContainer', () => {
        // Pin the DOM parentage and grid placement so a future "actually relocate
        // the sub-band into #mainBar" refactor — which would re-introduce the
        // chat-pane overhang collision — is caught here rather than shipping a
        // broken alignment. The band is appended to `base` (#outerContainer) in
        // main.js and positioned by explicit grid-row, never moved into #mainBar.
        const rule = subBandRule();
        expect(rule).toMatch(/grid-row:\s*3/);

        const js = read('main.js');
        // `base` is the #outerContainer element; the sub-band is appended to it.
        expect(js).toMatch(/base\.id\s*=\s*'outerContainer'/);
        expect(js).toMatch(/base\.appendChild\(desktopViewSubBand\)/);
        // It must NOT be re-parented into #mainBar (the aborted relocation).
        expect(js).not.toMatch(/mainBar\.appendChild\(desktopViewSubBand\)/);
    });
});

// Pins the contract that the desktop filter+sort band (#taskFilterBar, which
// also hosts the absolutely-positioned Sort dropdown overlay) carries NO
// distinct background at desktop: it clears to `transparent` so it falls
// through to its parent #mainBar's --bg-base page bg, matching the view-tab
// sub-band directly above it rather than painting the greyer --bg-elevated
// chrome colour.
//
// A previous entry set this band to --bg-elevated on the theory that the band
// should match the sub-band's "effective" colour; that shipped the inverse of
// what was wanted and made the seam more pronounced. The band must be
// transparent (or, equivalently, match #mainBar's --bg-base) — never
// --bg-elevated. Verified by source inspection because jsdom does no stylesheet
// resolution and main.js is too large to instantiate per CLAUDE.md guidance.
describe('desktop filter+sort band background falls through to the page bg', () => {
    const css = read('style.css');

    function consolidationBlock() {
        const start = css.indexOf('DESKTOP HEADER CONSOLIDATION');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('D2 — DESKTOP TWO-PANE CHAT', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    function filterBarDesktopRule() {
        const block = consolidationBlock();
        // The bare `#taskFilterBar { ... }` rule inside the desktop consolidation
        // block — not the compound `#mainBar[data-view=...] #taskFilterBar` rules
        // (those live outside this block).
        const re = /(^|[\s}])#taskFilterBar\s*\{([^}]*)\}/m;
        const m = block.match(re);
        expect(m).not.toBeNull();
        return m[2];
    }

    it('(a) the filter+sort band clears to transparent at desktop, not the greyer --bg-elevated chrome', () => {
        const rule = filterBarDesktopRule();
        // It must clear to transparent so it inherits #mainBar's --bg-base.
        expect(rule).toMatch(/background:\s*transparent/);
        // It must NOT paint the --bg-elevated chrome colour — that was the
        // inverse the previous entry shipped, which made the seam worse.
        expect(rule).not.toMatch(/background:\s*var\(--bg-elevated\)/);
    });

    it('(b) the top project-switcher row (#navBar) keeps its greyer --bg-elevated chrome (unchanged)', () => {
        // Pin the top row so a future "match everything to the page bg" refactor
        // can't silently strip the chrome this entry intentionally preserves.
        // #navBar's background is declared once, in the base (non-media) rules.
        const m = css.match(/#navBar\s*\{([^}]*)\}/);
        expect(m).not.toBeNull();
        expect(m[1]).toMatch(/background:\s*var\(--bg-elevated\)/);
    });
});
