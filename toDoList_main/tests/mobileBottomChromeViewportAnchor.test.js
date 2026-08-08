import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

const cssRaw = readFileSync(resolve(srcDir, 'style.css'), 'utf8');
// Strip block comments before scanning — the prose around these rules names
// both `position: absolute` and `env(safe-area-inset-bottom)`, so a raw-text
// sweep would match the explanation rather than the declaration.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

// Grab the declaration block for `selector` scoped inside ANY
// `@media ${mediaQuery}` block. Both selectors here also exist at top level
// as a display:none desktop baseline, so we walk every media block and
// return the first match found inside one.
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

// Regression cover for the iOS standalone safe-area BAND — the follow-on to
// the dead-band bug that --mobile-bottom-inset addressed.
//
// Capping the inset shrank the reserve the bar adds to its own box, but the
// band survived because it was never the bar's padding: the mobile bottom
// chrome was `position: absolute`, so it resolved against the initial
// containing block. In an installed PWA (display-mode: standalone) with
// `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style:
// black-translucent`, that block — the same box `height: 100%` resolves
// against — stops short of the physical screen edge, so `bottom: 0` parked
// the bar above the home-indicator zone. The page background (--bg-elevated
// on mobile, propagated to the canvas so it paints the full screen) then
// showed through underneath as a solid band, pushing the tabs up. Safari,
// whose toolbar already occupies that strip, looked correct.
//
// Anchoring the bottom chrome with `position: fixed` resolves it against the
// viewport itself, which viewport-fit=cover does extend to the screen edge.
// Nothing on mobile scrolls the document (body is overflow:hidden), so fixed
// and absolute render identically in Safari.
describe('mobile bottom chrome — viewport anchoring in standalone', () => {
    it('#mobileTabBar anchors to the viewport, not the initial containing block', () => {
        const rule = extractRule('#mobileTabBar', '(max-width: 1023px)');
        expect(rule).toMatch(/position:\s*fixed\s*;/);
        expect(rule).not.toMatch(/position:\s*absolute/);
        // Still pinned to the bottom edge — only what "bottom" resolves
        // against changes.
        expect(rule).toMatch(/bottom:\s*0\s*;/);
    });

    it('#bottomSheet anchors the same way so its layers stay glued to the tabs', () => {
        // The IDLE nub / PEEK strip rest on the tab bar's top edge via
        // `bottom: calc(--mobile-tab-h + --mobile-bottom-inset)`. If the sheet
        // kept resolving against a containing block that stops short of the
        // screen edge while the bar no longer does, every sheet layer would
        // float a safe-area's worth above the tabs it is meant to sit on.
        const rule = extractRule('#bottomSheet', '(max-width: 1023px)');
        expect(rule).toMatch(/position:\s*fixed\s*;/);
        expect(rule).not.toMatch(/position:\s*absolute/);
    });

    it('the tab bar still reserves only the capped home-indicator clearance', () => {
        // Anchoring is the fix for the band; the capped reserve is what keeps
        // the labels clear of the home-indicator pill. Both have to hold.
        const rule = extractRule('#mobileTabBar', '(max-width: 1023px)');
        expect(rule).toMatch(/padding-bottom:\s*var\(--mobile-bottom-inset[^)]*\)/);
        expect(rule).not.toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom/);
    });
});
