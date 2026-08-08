import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

const cssRaw = readFileSync(resolve(srcDir, 'style.css'), 'utf8');
// Strip block comments before scanning — the prose around these rules names
// `env(safe-area-inset-bottom)` and `--mobile-bottom-inset` repeatedly, so a
// raw-text sweep would match the explanation rather than the declaration.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

// Grab the declaration block for `selector` scoped inside ANY
// `@media ${mediaQuery}` block. #mobileTabBar also exists at top level as a
// display:none desktop baseline, so we walk every media block and return the
// first match found inside one.
function extractRule(selector, mediaQuery) {
    const mediaOpener = `@media ${mediaQuery}`;
    const mediaBlocks = [];
    for (let i = 0; ; ) {
        const next = css.indexOf(mediaOpener, i);
        if (next < 0) break;
        const open = css.indexOf('{', next);
        let depth = 1;
        let j = open + 1;
        while (j < css.length && depth > 0) {
            if (css[j] === '{') depth++;
            else if (css[j] === '}') depth--;
            j++;
        }
        mediaBlocks.push({ start: open + 1, end: j - 1 });
        i = j;
    }
    expect(mediaBlocks.length).toBeGreaterThan(0);

    for (const { start, end } of mediaBlocks) {
        const sub = css.slice(start, end);
        const re = new RegExp(
            '(^|[\\s},])' + selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{'
        );
        const m = sub.match(re);
        if (!m) continue;
        const blockStart = start + m.index + m[0].length - 1;
        let depth = 1;
        let k = blockStart + 1;
        while (k < css.length && depth > 0) {
            if (css[k] === '{') depth++;
            else if (css[k] === '}') depth--;
            k++;
        }
        return css.slice(blockStart + 1, k - 1);
    }
    throw new Error(`no rule for ${selector} inside ${mediaOpener}`);
}

// Regression cover for the third and last iteration of the iOS standalone
// safe-area band — the one about PAINT rather than layout.
//
// The two prior fixes settled how much room the bar RESERVES (the capped
// --mobile-bottom-inset) and what its `bottom: 0` resolves against (the
// viewport, via position: fixed). Neither changed how far its surface color
// REACHES: the bar's box ends one capped inset below the labels, so on a
// device reporting the full ~34px home-indicator inset, whatever sits between
// the bar's bottom edge and the physical screen edge paints in the page
// background instead of the bar's own surface — a dead band under the tabs
// that reads as a colour seam.
//
// The fix separates the two concerns: the bar keeps reserving only the capped
// inset (so the labels stay flush and Safari is untouched), and a pseudo
// element hanging below its box paints the RAW inset in the same surface
// colour. Safari reports the inset as 0, so the element collapses to zero
// height there and that rendering is pixel-identical to before.
describe('mobile tab bar — safe-area paint-through', () => {
    it('paints a surface strip below the bar sized to the raw safe-area inset', () => {
        const rule = extractRule('#mobileTabBar::after', '(max-width: 1023px)');
        expect(rule).toMatch(/content:\s*''\s*;/);
        expect(rule).toMatch(/position:\s*absolute\s*;/);
        // Hangs directly off the bar's bottom edge, full width, so there is no
        // gap or offset where the page background could show through.
        expect(rule).toMatch(/top:\s*100%\s*;/);
        expect(rule).toMatch(/left:\s*0\s*;/);
        expect(rule).toMatch(/right:\s*0\s*;/);
    });

    it('sizes the strip from the RAW inset, not the capped reserve token', () => {
        const rule = extractRule('#mobileTabBar::after', '(max-width: 1023px)');
        // The capped token is deliberately too short to cover the inset — it
        // exists to keep the labels flush, not to paint. Using it here would
        // leave the very band this fix removes.
        expect(rule).toMatch(/height:\s*env\(safe-area-inset-bottom,\s*0px\)\s*;/);
        expect(rule).not.toMatch(/height:[^;]*--mobile-bottom-inset/);
    });

    it('paints in the bar\'s own surface colour so there is no seam', () => {
        const strip = extractRule('#mobileTabBar::after', '(max-width: 1023px)');
        const bar = extractRule('#mobileTabBar', '(max-width: 1023px)');
        const barBg = bar.match(/background:\s*([^;]+);/);
        expect(barBg).not.toBeNull();
        expect(strip).toMatch(
            new RegExp('background:\\s*' + barBg[1].trim().replace(/[(){}[\]*+?.\\^$|]/g, m => '\\' + m) + '\\s*;')
        );
        // Painted decoration only — it must never intercept a tap aimed at
        // the tabs or the home-indicator swipe.
        expect(strip).toMatch(/pointer-events:\s*none\s*;/);
        // A border here would draw the seam it exists to remove.
        expect(strip).not.toMatch(/border/);
    });

    it('leaves the bar\'s own layout — and therefore Safari — untouched', () => {
        // The tempting alternative fix is to grow the bar to the raw inset.
        // That paints the strip too, but lifts the labels ~34px off the screen
        // edge in standalone, which is the dead band the first fix removed.
        const rule = extractRule('#mobileTabBar', '(max-width: 1023px)');
        expect(rule).toMatch(/position:\s*fixed\s*;/);
        expect(rule).toMatch(/bottom:\s*0\s*;/);
        expect(rule).toMatch(/padding-bottom:\s*var\(--mobile-bottom-inset[^)]*\)/);
        expect(rule).not.toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom/);
        expect(rule).toMatch(
            /height:\s*calc\(\s*var\(--mobile-tab-h[^)]*\)\s*\+\s*var\(--mobile-bottom-inset[^)]*\)\s*\)/
        );
    });

    it('the strip is scoped to mobile and hides with the bar', () => {
        // Desktop already hides #mobileTabBar outright; keeping the rule inside
        // the ≤1023px block means it never even resolves above that breakpoint.
        const desktopBlock = css.slice(0, css.indexOf('@media (max-width: 1023px)'));
        expect(desktopBlock).not.toMatch(/#mobileTabBar::after/);
        // The strip is a child of the bar, so the drawer / empty-state
        // display:none rules take it down with the tabs rather than leaving a
        // stray band floating at the screen edge.
        expect(css).toMatch(
            /#mobileTabBar\.hidden-by-drawer,\s*#mobileTabBar\.hidden-by-empty\s*\{\s*display:\s*none;\s*\}/
        );
    });
});
