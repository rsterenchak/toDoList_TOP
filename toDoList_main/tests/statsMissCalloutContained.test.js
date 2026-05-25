import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the fix for `.statsMissCallout` (and the `.statsMissedList`
// directly beneath it) painting past `#statsSibling`'s bottom border on
// ≤420px viewports. The callout previously used `display: flex` with
// `align-items: center`; when `.statsMissCalloutText` wrapped to two or
// three lines on narrow phones, the flex container's intrinsic block-size
// reported to #mainList's auto-sized grid track didn't include the wrapped
// text's full height, so the auto track resolved short and the callout +
// pill row overflowed the drawer.
//
// Switching the callout to `display: grid; grid-template-columns: auto 1fr`
// makes the row's content-height deterministic — the auto column holds the
// 14×14 info glyph, the 1fr column wraps the text freely, and the grid
// row's max-content height is what the parent grid track sees. The
// existing `mainListStatsDrawerHeight.test.js` already locks in
// `grid-auto-rows: minmax(54px, auto)` on #mainList — this test locks in
// the matching change on the band that was previously misreporting.
describe('.statsMissCallout stays inside #statsSibling on narrow viewports', () => {
    const css = read('style.css');

    function extractTopLevelRule(selector) {
        let depth = 0;
        for (let i = 0; i < css.length; i++) {
            const c = css[i];
            if (c === '{') { depth++; continue; }
            if (c === '}') { depth--; continue; }
            if (depth !== 0) continue;
            if (!css.startsWith(selector, i)) continue;
            const after = css[i + selector.length] || '';
            if (after !== '{' && after !== ',' && !/\s/.test(after)) continue;
            let j = i - 1;
            while (j >= 0 && /\s/.test(css[j])) j--;
            const prev = j < 0 ? '' : css[j];
            if (prev !== '' && prev !== '}' && prev !== ',' && prev !== '/') continue;
            const blockStart = css.indexOf('{', i);
            const blockEnd = css.indexOf('}', blockStart);
            return css.slice(blockStart + 1, blockEnd);
        }
        throw new Error(`Top-level rule for "${selector}" not found`);
    }

    const calloutRule = extractTopLevelRule('.statsMissCallout');

    it('uses grid layout so the auto-row reports the wrapped text height up to #mainList', () => {
        // Flex with align-items: center was the broken layout — assert it's
        // gone. The previous declaration combined `display: flex` with the
        // same `align-items: center` we keep below; only the display value
        // is the load-bearing change.
        expect(calloutRule).not.toMatch(/display:\s*flex\s*;/);
        expect(calloutRule).toMatch(/display:\s*grid\s*;/);
    });

    it('declares an `auto 1fr` two-column track so the icon and text get deterministic widths', () => {
        // `auto` for the icon column lets the 14px SVG glyph size to its
        // intrinsic width; `1fr` for the text column absorbs the remaining
        // width and wraps freely. Any other column shape (`1fr 1fr`,
        // explicit pixel columns, etc.) would break the icon/text rhythm.
        expect(calloutRule).toMatch(/grid-template-columns:\s*auto\s+1fr\s*;/);
    });

    it('keeps the icon vertically centered against the wrapped text via align-items: center', () => {
        // Without this, multi-line text would top-align the icon, which
        // reads as an unintended visual hierarchy. The grid row's height
        // is still resolved from max-content regardless of alignment.
        expect(calloutRule).toMatch(/align-items:\s*center\s*;/);
    });

    it('#statsSibling stays a flex column with no max-height or overflow clip on any viewport', () => {
        // Defensive — confirms the drawer itself never picks up a clip
        // that would hide overflowing children. A future mobile @media
        // block adding `max-height` or `overflow: hidden` to #statsSibling
        // would re-introduce the original bug shape (drawer renders short,
        // callout + pill list paint past its bottom border).
        const drawerRule = extractTopLevelRule('#statsSibling');
        expect(drawerRule).toMatch(/display:\s*flex\s*;/);
        expect(drawerRule).toMatch(/flex-direction:\s*column\s*;/);
        expect(drawerRule).not.toMatch(/max-height:/);
        expect(drawerRule).not.toMatch(/overflow:\s*(?:hidden|clip)\s*;/);
        expect(drawerRule).not.toMatch(/overflow-y:\s*(?:hidden|clip)\s*;/);

        // Walk every #statsSibling rule (including nested @media blocks)
        // and confirm none of them sneak in a max-height / overflow clip.
        const re = /#statsSibling\s*\{([^}]*)\}/g;
        let match;
        while ((match = re.exec(css)) !== null) {
            expect(match[1]).not.toMatch(/max-height:/);
            expect(match[1]).not.toMatch(/overflow:\s*(?:hidden|clip)\s*;/);
            expect(match[1]).not.toMatch(/overflow-y:\s*(?:hidden|clip)\s*;/);
        }
    });
});
