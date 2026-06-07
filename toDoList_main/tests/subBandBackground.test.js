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
// also hosts the absolutely-positioned Sort dropdown overlay) paints the SAME
// colour as the view-tab sub-band directly above it, so the two read as one
// continuous band beneath the top project-switcher row (#navBar).
//
// Why an explicit --bg-elevated rather than `transparent`: the sub-band is
// transparent and sits directly in #outerContainer, so it paints the shell's
// --bg-elevated. #taskFilterBar, however, lives inside #mainBar — which is
// itself --bg-base — so clearing the filter band to transparent would leave it
// painting --bg-base and the seam would remain. Matching the sub-band's
// EFFECTIVE colour therefore means setting the filter band to --bg-elevated at
// desktop. Verified by pixel-sampling a Chromium render of the real cascade
// (jsdom does no stylesheet resolution, and main.js is too large to instantiate
// per CLAUDE.md guidance), so this is pinned by source inspection of the one
// rule whose own background is the band's topmost painted layer.
describe('desktop filter+sort band background matches the view sub-band', () => {
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

    it('(a) the filter+sort band paints the shell --bg-elevated at desktop, matching the transparent sub-band', () => {
        const rule = filterBarDesktopRule();
        expect(rule).toMatch(/background:\s*var\(--bg-elevated\)/);
        // It must NOT fall back to --bg-base at desktop (the base rule's value),
        // which is what produced the original seam.
        expect(rule).not.toMatch(/background:\s*var\(--bg-base\)/);
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
