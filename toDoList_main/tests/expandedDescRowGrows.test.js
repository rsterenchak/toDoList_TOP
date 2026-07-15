import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression: expanding a todo's description opened an inline #descSibling
// panel (the textarea plus the "Set inject target" row) as its own grid row
// inside #mainList. #mainList used `grid-auto-rows: minmax(54px, auto)`, which
// looks like it lets drawer rows grow — but the `auto` maximum STOPS growing
// once the grid overflows its fixed-height scroll container (there is no free
// space left to distribute to the tracks). So whenever a project had enough
// items to make #mainList scroll, the panel's track stayed pinned to the 54px
// floor and the panel bled down over the following todo row instead of pushing
// it down. `min-content` sizes every track to its own content: a normal todo
// row's margin-box is already 54px so the list pitch is unchanged, while the
// description / stats drawers grow to their real height and reflow the rows
// below. See the #todoMdViewerCard rule for the same overflow-freeze story.

describe('#mainList sizes rows by content so an expanded description grows its row', () => {

    const css = read('style.css');

    // Extract a single top-level (outside any @media block) rule body by
    // bracket-counting, so the base #mainList rule is matched rather than the
    // mobile override further down the file.
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

    it('the base #mainList rule sizes auto rows by content, not a fixed floor + auto max', () => {
        const rule = extractTopLevelRule('#mainList');
        const match = rule.match(/grid-auto-rows:\s*([^;]+);/);
        expect(match).not.toBeNull();
        const value = match[1].trim();
        expect(value).toBe('min-content');
        // The old `minmax(<fixed>, auto)` shape is exactly what froze the
        // drawer's track once the list overflowed — guard against a regression
        // back to it.
        expect(value).not.toMatch(/minmax\(\s*\d+px\s*,\s*auto\s*\)/);
    });

    it('the mobile #mainList override also sizes auto rows by content', () => {
        // The compact mobile rule lives inside the max-width media block as a
        // single-line `#mainList { grid-auto-rows: ...; }` override.
        const overrides = [...css.matchAll(/#mainList\s*\{\s*grid-auto-rows:\s*([^;]+);\s*\}/g)]
            .map((m) => m[1].trim());
        expect(overrides.length).toBeGreaterThanOrEqual(1);
        for (const value of overrides) {
            expect(value).toBe('min-content');
            expect(value).not.toMatch(/minmax\(\s*\d+px\s*,\s*auto\s*\)/);
        }
    });
});
