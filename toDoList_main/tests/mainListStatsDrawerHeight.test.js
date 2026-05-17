import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the fix for the recurring-task stats drawer being clipped to 54px.
// #mainList is a CSS grid. The previous declaration
//   grid-template-rows: repeat(auto-fit, minmax(54px, 54px))
// pinned every implicit row track to exactly 54px, which clipped the
// stat-card strip, window toggle, contributions grid, and missed-dates list
// inside #statsSibling. #descSibling happened to fit by coincidence because
// its content rarely exceeds 34px. Switching to
//   grid-auto-rows: minmax(54px, auto)
// preserves the 54px minimum for normal todo rows while letting drawers grow
// to their natural height.
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

    it('uses grid-auto-rows with a 54px minimum that allows rows to grow to fit content', () => {
        const match = rule.match(/grid-auto-rows:\s*minmax\(\s*54px\s*,\s*([^)]+?)\s*\)\s*;/);
        expect(match).not.toBeNull();
        // The max must allow growth — `auto`, `max-content`, or `min-content`
        // (not a fixed pixel value that would re-cap the row).
        expect(match[1]).toMatch(/^(auto|max-content|min-content)$/);
    });
});
