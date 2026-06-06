import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract that, at desktop widths (>=1024px), the 16px gap above the
// chat pane's sub-header row is painted with the pane's own background instead
// of the lighter #outerContainer (--bg-elevated) shade that shows through the
// gap by default. The fix is a hard-edged box-shadow on #desktopChatPane: it
// extends the pane's --bg-base up over the strip without altering the 16px gap
// (#desktopViewSubBand's margin-top) or the pane lift/alignment, and is not
// clipped by the pane's own overflow:hidden. Verified via source inspection
// because jsdom does no layout and main.js is too large to instantiate (per
// CLAUDE.md guidance).
describe('navbar gap painted with chat pane background (desktop)', () => {
    const css = read('style.css');

    // The #desktopChatPane desktop rule lives in the D2 two-pane media region.
    function d2Block() {
        const regionStart = css.indexOf('D2 — DESKTOP TWO-PANE CHAT');
        expect(regionStart).toBeGreaterThan(-1);
        const start = css.indexOf('@media (min-width: 1024px)', regionStart);
        expect(start).toBeGreaterThan(regionStart);
        const end = css.indexOf('D3 — DESKTOP CHAT PANE COLLAPSE', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

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

    it('(a) the chat pane paints the gap above it with its own --bg-base', () => {
        const pane = ruleBody(d2Block(), '#desktopChatPane');
        // Background of the pane content is --bg-base...
        expect(pane).toMatch(/background:\s*var\(--bg-base\)/);
        // ...and a box-shadow lifted UP fills the gap above it with the SAME
        // colour, so the strip matches the pane content (no lighter seam).
        const shadow = pane.match(/box-shadow:\s*0\s+-(\d+)px\s+0\s+0\s+var\(--bg-base\)/);
        expect(shadow).not.toBeNull();
        // The painted strip covers the full 16px gap.
        expect(parseInt(shadow[1], 10)).toBe(16);
    });

    it('(b) the 16px gap itself is preserved — no spacing alteration', () => {
        // The gap is #desktopViewSubBand's margin-top; this entry is cosmetic
        // only, so that spacing must stay (>=12px).
        const subBand = ruleBody(consolidationBlock(), '#desktopViewSubBand');
        const gap = subBand.match(/margin-top:\s*(\d+)px/);
        expect(gap).not.toBeNull();
        expect(parseInt(gap[1], 10)).toBeGreaterThanOrEqual(12);
    });

    it('(c) sub-header alignment is untouched — pane lift equals band height', () => {
        const subBand = ruleBody(consolidationBlock(), '#desktopViewSubBand');
        const minH = subBand.match(/min-height:\s*(\d+)px/);
        expect(minH).not.toBeNull();
        const pane = ruleBody(d2Block(), '#desktopChatPane');
        const lift = pane.match(/margin-top:\s*-(\d+)px/);
        expect(lift).not.toBeNull();
        expect(parseInt(lift[1], 10)).toBe(parseInt(minH[1], 10));
    });

    it('(d) the gap fill is desktop-scoped and hidden at mobile', () => {
        // The box-shadow lives inside the >=1024px media region...
        expect(d2Block()).toMatch(/@media\s*\(\s*min-width:\s*1024px\s*\)/);
        // ...and the pane it sits on is display:none at mobile widths, so no
        // strip is painted there (regression guard for the slide-up sheet).
        const basePane = css.match(/#desktopChatPane\s*\{([^}]*)\}/);
        expect(basePane).not.toBeNull();
        expect(basePane[1]).toMatch(/display:\s*none/);
    });
});
