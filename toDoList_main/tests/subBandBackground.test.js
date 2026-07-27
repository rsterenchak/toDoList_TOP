import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract that the desktop view-tab sub-band (#desktopViewSubBand)
// has been RETIRED: the STREAM / STRUCTURE view tabs now ride inside the top
// header row (#navBar) rather than in a dedicated sub-band beneath it. This
// suite previously pinned the sub-band's --bg-base paint and its box-shadow
// row-fill; it is rewritten to pin the removal — no #desktopViewSubBand rule
// survives anywhere, and the view tabs keep the base bordered-pill treatment
// (the flat underlined-text override was retired) now that they are
// #navBar-scoped. Verified via source inspection because jsdom does no layout
// and main.js is too large to instantiate (per CLAUDE.md guidance).
describe('desktop view sub-band retired (view tabs moved into the header)', () => {
    const css = read('style.css');

    // The desktop header consolidation media region (>= 1024px) that used to
    // hold the sub-band rule now holds the header-scoped view-tab styling.
    function consolidationBlock() {
        const start = css.indexOf('DESKTOP HEADER CONSOLIDATION');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('D2 — DESKTOP TWO-PANE CHAT', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    it('(a) no #desktopViewSubBand rule remains anywhere in the stylesheet', () => {
        // The whole element is gone — not merely hidden. A future refactor that
        // re-introduces the band (and its chat-pane overhang collision) is
        // caught here.
        expect(css).not.toMatch(/#desktopViewSubBand\s*\{/);
    });

    it('(b) the view tabs are seated in #navBar and clear their base auto margin', () => {
        // #viewSwitcher rides inside the top header row. Its base
        // margin-right:auto is cleared at desktop so it hugs the workspace pill;
        // the chip cluster stays right-anchored via #pomodoroToggle alone.
        const block = consolidationBlock();
        const m = block.match(/#navBar\s+#viewSwitcher\s*\{([^}]*)\}/);
        expect(m).not.toBeNull();
        expect(m[1]).toMatch(/margin-right:\s*0/);
    });

    it('(c) the view tabs keep the base bordered-pill treatment, with no #navBar override', () => {
        // The flat underlined-text override (#navBar .viewPill / .active /
        // .active::after) is retired; the tabs fall through to the base
        // .viewPill bordered-pill rules so they read as pills beside the
        // bordered project block.
        const block = consolidationBlock();
        expect(block).not.toMatch(/#navBar\s+\.viewPill\s*\{/);
        expect(block).not.toMatch(/\.viewPill\.active::after/);
        // The base active-pill treatment carries the accent — a filled tint,
        // accent text, and a solid purple border.
        const active = css.match(/\n\.viewPill\.active\s*\{([^}]*)\}/);
        expect(active).not.toBeNull();
        expect(active[1]).toMatch(/color:\s*#9D93EE/);
        expect(active[1]).toMatch(/border-color:\s*#6C5DF5/);
    });

    it('(d) main.js seats #viewSwitcher in #navBar, never in a sub-band', () => {
        const js = read('main.js');
        // The tablist is inserted into the header row before the chip cluster.
        expect(js).toMatch(/nav\.insertBefore\(viewSwitcher,\s*pomodoroToggle\)/);
        // The retired sub-band element is not constructed or appended.
        expect(js).not.toMatch(/desktopViewSubBand/);
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
