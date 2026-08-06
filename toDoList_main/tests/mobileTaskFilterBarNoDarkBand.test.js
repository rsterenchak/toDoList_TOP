import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression: on mobile the task pane is repainted from the desktop --bg-base
// canvas to --bg-elevated so it merges into the surrounding frame. That repaint
// covered #mainBar and #mainList but not #taskFilterBar, which declares its own
// `background: var(--bg-base)` to match #mainBar on desktop. Left behind, the
// pill row painted --bg-base (#0e0f14) over an --bg-elevated (#14151b) pane and
// read as a full-width dark band across the top of the task column, directly
// above the list that hosts the TODO.md viewer card — visible on mobile only,
// since desktop paints both from the same token. The fix adds #taskFilterBar to
// the mobile repaint. Source-inspection per CLAUDE.md (style.css is large; we
// assert the CSS contract rather than instantiating a layout engine).
describe('Mobile task pane — no dark band above the TODO.md viewer list', () => {
    const css = read('style.css');

    // True when `pos` falls inside a @media (max-width: 1023px) block.
    function inMobileMediaBlock(pos) {
        const mediaIdx = css.lastIndexOf('@media (max-width: 1023px)', pos);
        if (mediaIdx === -1) return false;
        let depth = 0;
        let openSeen = false;
        for (let i = css.indexOf('{', mediaIdx); i < css.length; i++) {
            if (css[i] === '{') { depth++; openSeen = true; }
            else if (css[i] === '}') {
                depth--;
                if (openSeen && depth === 0) return pos <= i;
            }
        }
        return false;
    }

    it('repaints the filter pill row with the same mobile canvas as the pane', () => {
        const re = /#mainBar,\s*\n\s*#mainList,\s*\n\s*#taskFilterBar\s*\{[^}]*\}/;
        const rule = css.match(re);
        expect(rule).toBeTruthy();
        // The whole canvas — pane, list, and pill row — lands on one token.
        expect(rule[0]).toMatch(/background:\s*var\(--bg-elevated\)/);
        // And specifically not the darker desktop canvas token.
        expect(rule[0]).not.toMatch(/background:\s*var\(--bg-base\)/);
        // Scoped to the mobile media block so desktop is untouched.
        expect(inMobileMediaBlock(css.search(re))).toBe(true);
    });

    it('leaves the desktop filter-bar canvas on --bg-base', () => {
        // The base rule still paints the pill row with the desktop canvas token,
        // where #mainBar carries the same fill and the seam is invisible.
        const re = /(^|\n)#taskFilterBar\s*\{[^}]*background:\s*var\(--bg-base\)[^}]*\}/;
        const rule = css.match(re);
        expect(rule).toBeTruthy();
        // That base rule lives outside the mobile media block.
        expect(inMobileMediaBlock(css.search(re))).toBe(false);
    });
});
