import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract that at desktop widths (>=1024px) the chat pane's
// sub-header row — collapse button + CHAT/RUNS tabs + repo workspace pill — is
// a single horizontal row aligned with the task pane's view-tab sub-band
// (#desktopViewSubBand), so both panes have a peer "first row under the main
// header" at the same y. Previously the collapse `›` sat on its own row above
// the tabs, and the whole chat sub-header sat one sub-band height below the
// view tabs. Verified via source inspection because jsdom does no layout and
// main.js is too large to instantiate (per CLAUDE.md guidance).
describe('chat pane sub-header alignment (desktop)', () => {
    const css = read('style.css');
    const main = read('main.js');

    // The desktop (>=1024px) portion of the D2 two-pane region — the pane lift
    // and tab-row compaction. Sliced from the media query so the base
    // (mobile) #mainSplit / #desktopChatPane rules above it aren't matched.
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

    // The desktop header consolidation region holds the sub-band rules.
    function consolidationBlock() {
        const start = css.indexOf('DESKTOP HEADER CONSOLIDATION');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('D2 — DESKTOP TWO-PANE CHAT', start);
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

    it('(a) the chat pane is pulled up by exactly the sub-band height so the rows align', () => {
        // The lift magnitude must equal the band's height, or the two
        // sub-headers would not start at the same y. Pin both halves.
        const subBand = ruleBody(consolidationBlock(), '#desktopViewSubBand');
        const minH = subBand.match(/min-height:\s*(\d+)px/);
        expect(minH).not.toBeNull();
        const bandHeight = parseInt(minH[1], 10);

        const pane = ruleBody(d2Block(), '#desktopChatPane');
        const lift = pane.match(/margin-top:\s*-(\d+)px/);
        expect(lift).not.toBeNull();
        expect(parseInt(lift[1], 10)).toBe(bandHeight);
    });

    it('(b) the pane is position:relative so the collapse button can anchor to it', () => {
        const pane = ruleBody(d2Block(), '#desktopChatPane');
        expect(pane).toMatch(/position:\s*relative/);
    });

    it('(c) #mainSplit does not clip the pane overhang (overflow:visible at desktop)', () => {
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

    it('(f) the sub-band lets clicks fall through its empty area to the sub-header beneath', () => {
        const subBand = ruleBody(consolidationBlock(), '#desktopViewSubBand');
        expect(subBand).toMatch(/pointer-events:\s*none/);
        // ...while the view tabs themselves stay interactive.
        const viewSwitcher = ruleBody(consolidationBlock(), '#desktopViewSubBand #viewSwitcher');
        expect(viewSwitcher).toMatch(/pointer-events:\s*auto/);
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
