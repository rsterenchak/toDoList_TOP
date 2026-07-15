import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the fix for drawer rows (#statsSibling, #descSibling) being clipped
// to 54px. #mainList is a CSS grid. An early declaration
//   grid-template-rows: repeat(auto-fit, minmax(54px, 54px))
// pinned every implicit row track to exactly 54px, which clipped the
// stat-card strip, window toggle, contributions grid, and missed-dates list.
// The follow-up `grid-auto-rows: minmax(54px, auto)` looked like it let drawers
// grow, but the `auto` maximum stops growing once the grid overflows its
// fixed-height scroll container — so with enough items to scroll, an open
// drawer was still frozen at the 54px floor and bled over the row below.
// `grid-auto-rows: min-content` sizes each track to its own content: a normal
// todo row's margin-box is already 54px so the list pitch is unchanged, while
// the drawers grow to their natural height and reflow the rows beneath them.
describe('#mainList grid track sizing lets drawer rows grow past 54px', () => {
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

    const rule = extractTopLevelRule('#mainList');

    it('does not lock row tracks to exactly 54px via grid-template-rows', () => {
        expect(rule).not.toMatch(/grid-template-rows:\s*repeat\([^)]*minmax\(\s*54px\s*,\s*54px\s*\)[^)]*\)\s*;/);
    });

    it('uses content-based grid-auto-rows so drawer rows grow to fit their content', () => {
        const match = rule.match(/grid-auto-rows:\s*([^;]+?)\s*;/);
        expect(match).not.toBeNull();
        // Must be a content-sizing keyword that keeps growing even after the
        // grid overflows its scroll container. A `minmax(<fixed>, auto)` shape
        // re-caps the track to the fixed floor once the list scrolls, which is
        // exactly the regression this guards against.
        expect(match[1]).toMatch(/^(min-content|max-content)$/);
        expect(match[1]).not.toMatch(/minmax\(\s*\d+px\s*,/);
    });
});
