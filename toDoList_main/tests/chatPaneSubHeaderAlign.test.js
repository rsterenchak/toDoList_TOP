import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract that at desktop widths (>=1024px) the chat pane's
// sub-header row — collapse button + CHAT/RUNS tabs + repo workspace pill —
// sits FLUSH with the task pane's top edge: both panes start at #mainSplit's
// top (grid row 3, directly under the header) with no compensating offset.
// This suite previously pinned the pane's -32px lift into a dedicated view-tab
// sub-band and the z-index / pointer-events plumbing that alignment required;
// with the sub-band retired (the view tabs moved into the header row) it is
// rewritten to pin the DECOUPLING — no negative top margin, no z-index raise,
// no #desktopViewSubBand rule — while position:relative and the collapse
// button's inline placement survive. Verified via source inspection because
// jsdom does no layout and main.js is too large to instantiate (per CLAUDE.md
// guidance).
describe('chat pane sub-header alignment (desktop)', () => {
    const css = read('style.css');
    const main = read('main.js');

    // The desktop (>=1024px) portion of the D2 two-pane region — the pane
    // decoupling and tab-row compaction. Sliced from the media query so the
    // base (mobile) #mainSplit / #desktopChatPane rules above it aren't matched.
    function d2Block() {
        const regionStart = css.indexOf('D2 — DESKTOP TWO-PANE CHAT');
        expect(regionStart).toBeGreaterThan(-1);
        const start = css.indexOf('@media (min-width: 1024px)', regionStart);
        expect(start).toBeGreaterThan(regionStart);
        const end = css.indexOf('D3 — DESKTOP CHAT PANE COLLAPSE', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    // The D3 region holds the collapse button placement.
    function d3Block() {
        const start = css.indexOf('D3 — DESKTOP CHAT PANE COLLAPSE');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('PHONE ≤ 420px', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    function ruleBody(block, selector) {
        const re = new RegExp(
            selector.replace(/[#.]/g, m => '\\' + m).replace(/\s+/g, '\\s+') +
                '\\s*\\{([^}]*)\\}'
        );
        const m = block.match(re);
        expect(m).not.toBeNull();
        return m[1];
    }

    it('(a) the chat pane is flush with the task pane top — no negative lift, no z-index raise', () => {
        // With the sub-band gone there is nothing to lift the pane into: the
        // old margin-top:-32px alignment offset and the z-10 raise that kept the
        // CHAT/RUNS tabs above the band are both removed.
        const pane = ruleBody(d2Block(), '#desktopChatPane');
        expect(pane).not.toMatch(/margin-top:\s*-\d+px/);
        expect(pane).not.toMatch(/z-index:/);
        // ...and the retired band leaves no rule behind.
        expect(css).not.toMatch(/#desktopViewSubBand\s*\{/);
    });

    it('(b) the pane is position:relative so the collapse button can anchor to it', () => {
        const pane = ruleBody(d2Block(), '#desktopChatPane');
        expect(pane).toMatch(/position:\s*relative/);
    });

    it('(c) #mainSplit does not clip the pane left-edge separator (overflow:visible at desktop)', () => {
        const split = ruleBody(d2Block(), '#mainSplit');
        expect(split).toMatch(/overflow:\s*visible/);
    });

    it('(d) the collapse button sits inline (absolute) rather than on its own row', () => {
        const btn = ruleBody(d3Block(), '#chatCollapseButton');
        expect(btn).toMatch(/position:\s*absolute/);
        // The old own-row flow positioning is gone.
        expect(btn).not.toMatch(/align-self:\s*flex-start/);
    });

    it('(e) the tab row is a centered single row that reserves room for the collapse button', () => {
        const tabs = ruleBody(d2Block(), '#desktopChatPane #claudeSheetTabs');
        expect(tabs).toMatch(/align-items:\s*center/);
        // Left padding must clear the collapse button (left:8px + 28px wide).
        const pad = tabs.match(/padding:\s*[^;]*\s(\d+)px\s*;/);
        expect(pad).not.toBeNull();
        expect(parseInt(pad[1], 10)).toBeGreaterThanOrEqual(36);
    });

    it('(f) the left-edge separator stripe survives the decoupling', () => {
        // The 1px vertical seam between the task pane and chat pane is a
        // hard-edged box-shadow painted outside the pane's left edge (never a
        // border-left). The gap-fill overhang shadow that used to lead the
        // declaration is gone with the sub-band, so the separator is now the
        // only shadow.
        const pane = ruleBody(d2Block(), '#desktopChatPane');
        expect(pane).toMatch(/box-shadow:[^;]*-1px\s+0\s+0\s+0\s+rgba\(108,\s*93,\s*245,\s*0\.18\)/);
        expect(pane).not.toMatch(/border-left:\s*1px\s+solid/);
    });

    it('(g) mobile is untouched — the base tab row keeps its full 12px padding', () => {
        // The base (non-media) .claudeSheetTabs rule still pads 12px all round;
        // the compacted padding only applies inside the desktop media query
        // scoped to #desktopChatPane, where the slide-up sheet's tab row never
        // lives at mobile widths.
        const base = css.match(/\.claudeSheetTabs\s*\{([^}]*)\}/);
        expect(base).not.toBeNull();
        expect(base[1]).toMatch(/padding:\s*12px/);
        // The lift, tab compaction, and collapse placement are all desktop-gated.
        expect(d2Block()).toMatch(/@media\s*\(\s*min-width:\s*1024px\s*\)/);
    });

    it('(h) the collapse toggle behavior is preserved (still wired to the body class + prefs)', () => {
        // Regression guard: only the button's visual position changed, not its
        // click-to-collapse wiring.
        expect(main).toMatch(/chatCollapseBtn\.addEventListener\(\s*['"]click['"][\s\S]*?applyChatPaneCollapsed\(true\)/);
        expect(main).toMatch(/setChatPaneCollapsed\(collapsed\)/);
    });
});
