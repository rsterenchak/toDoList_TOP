import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression: in the full-screen mobile TODO.md viewer sheet the card's header
// inherited the inline card's `background: var(--bg-elevated)` — a band darker
// than the card's `--bg-surface` interior. Stacked under the sheet's own header
// it read as a rogue black bar across the card's content area. The fix clears
// the header background inside the sheet so the interior reads uniform, scoped
// to the sheet's @media block so the desktop inline card's elevated header is
// untouched. Source-inspection per CLAUDE.md (style.css is large; we assert the
// CSS contract rather than instantiating a layout engine).
describe('Mobile TODO.md viewer sheet — no black bar across the header', () => {
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

    function block(selectorRe) {
        const m = css.match(selectorRe);
        return m ? m[0] : null;
    }

    it('clears the elevated background on the card header inside the sheet', () => {
        const re = /#todoMdViewerMobileSheet\s+\.todoMdViewerHeader\s*\{[^}]*\}/;
        const rule = block(re);
        expect(rule).toBeTruthy();
        // The header fills with the card surface (no darker band).
        expect(rule).toMatch(/background:\s*transparent/);
        // And specifically does NOT re-assert the darker elevated fill.
        expect(rule).not.toMatch(/background:\s*var\(--bg-elevated\)/);
        // Scoped to the mobile media block so desktop is untouched.
        expect(inMobileMediaBlock(css.search(re))).toBe(true);
    });

    it('keeps the desktop inline card header on its elevated background', () => {
        // The base (non-mobile) rule still gives the inline card its header
        // chrome — the fix must not strip that.
        const re = /(^|\n)\.todoMdViewerHeader\s*\{[^}]*\}/;
        const rule = block(re);
        expect(rule).toBeTruthy();
        expect(rule).toMatch(/background:\s*var\(--bg-elevated\)/);
        // The base rule lives outside the mobile media block.
        expect(inMobileMediaBlock(css.search(re))).toBe(false);
    });
});
