import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract that, at desktop widths (>=1024px), the chat pane no
// longer needs a gap-fill box-shadow: with the view-tab sub-band retired there
// is no 16px margin gap above the pane's sub-header row to paint over, so the
// hard-edged `0 -16px 0 0 var(--bg-base)` overhang is gone. What remains is the
// pane's own --bg-base fill and the 1px left-edge separator stripe. This suite
// previously pinned the overhang and the sub-band margin it covered; it is
// rewritten to pin their REMOVAL. Verified via source inspection because jsdom
// does no layout and main.js is too large to instantiate (per CLAUDE.md
// guidance).
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

    function ruleBody(block, selector) {
        const re = new RegExp(
            selector.replace(/[#.]/g, m => '\\' + m).replace(/\s+/g, '\\s+') +
                '\\s*\\{([^}]*)\\}'
        );
        const m = block.match(re);
        expect(m).not.toBeNull();
        return m[1];
    }

    it('(a) the chat pane keeps its --bg-base fill but no longer paints a gap overhang', () => {
        const pane = ruleBody(d2Block(), '#desktopChatPane');
        // Background of the pane content stays --bg-base...
        expect(pane).toMatch(/background:\s*var\(--bg-base\)/);
        // ...but the upward gap-fill overhang (which covered the sub-band's
        // 16px margin) is gone — there is no gap to paint anymore.
        expect(pane).not.toMatch(/box-shadow:[^;]*0\s+-16px\s+0\s+0\s+var\(--bg-base\)/);
    });

    it('(b) the sub-band it filled is gone entirely', () => {
        // No #desktopViewSubBand rule survives, so no margin gap remains.
        expect(css).not.toMatch(/#desktopViewSubBand\s*\{/);
    });

    it('(c) the pane sits flush — no negative top margin remains', () => {
        const pane = ruleBody(d2Block(), '#desktopChatPane');
        expect(pane).not.toMatch(/margin-top:\s*-\d+px/);
    });

    it('(d) the pane is display:none at mobile (regression guard for the slide-up sheet)', () => {
        expect(d2Block()).toMatch(/@media\s*\(\s*min-width:\s*1024px\s*\)/);
        const basePane = css.match(/#desktopChatPane\s*\{([^}]*)\}/);
        expect(basePane).not.toBeNull();
        expect(basePane[1]).toMatch(/display:\s*none/);
    });
});
