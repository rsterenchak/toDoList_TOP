import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract that the desktop view-tab sub-band (#desktopViewSubBand)
// has no distinct background or borders. Previously the band carried a
// slightly-lighter background (#08080d) plus a 1px top border to mark its
// region; once vertical breathing room was added below it, that background
// showed as a visible "stripe" of lighter color between the view tabs and the
// filter pills. The tabs now sit directly on the page background. Verified via
// source inspection because jsdom does no layout and main.js is too large to
// instantiate (per CLAUDE.md guidance).
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

    it('(a) the sub-band has no distinct background color — transparent', () => {
        const rule = subBandRule();
        // No lighter band background remains; an explicit transparent is fine.
        expect(rule).not.toMatch(/background:\s*#08080d/);
        expect(rule).toMatch(/background:\s*transparent/);
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
