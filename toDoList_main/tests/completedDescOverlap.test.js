import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression: when the COMPLETED section was expanded and a todo's description
// was open at the same time, the two regions collided visually because
// #descSibling used a negative top margin (`-9px`) that pulled the panel out
// of normal document flow. The fix keeps the panel as a regular grid item so
// adjacent siblings (including the COMPLETED header and completed rows below)
// reflow around it without overlap.

describe('description panel and COMPLETED section stack without overlap', () => {

    const css = read('style.css');

    // Extract a single top-level rule body (outside any @media block) by
    // bracket-counting. Lets us assert on the base #descSibling rule without
    // matching the mobile-only overrides further down in the file.
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

    it('#descSibling base rule does not use a negative top margin', () => {
        const rule = extractTopLevelRule('#descSibling');
        // Pull whatever margin declaration is in the rule and verify the
        // top component is not negative. Both shorthand (`margin: ...`) and
        // longhand (`margin-top: ...`) forms must be checked.
        const marginTopLong = rule.match(/margin-top:\s*(-?\d+(?:\.\d+)?)px/);
        if (marginTopLong) {
            expect(parseFloat(marginTopLong[1])).toBeGreaterThanOrEqual(0);
        }
        const marginShort = rule.match(/(?:^|\s|;)margin:\s*([^;]+);/);
        if (marginShort) {
            const parts = marginShort[1].trim().split(/\s+/);
            const top = parseFloat(parts[0]);
            expect(Number.isNaN(top) ? 0 : top).toBeGreaterThanOrEqual(0);
        }
    });

    it('#descSibling base rule uses static positioning so it contributes to layout height', () => {
        const rule = extractTopLevelRule('#descSibling');
        // Absolute/fixed positioning would take the panel out of normal flow
        // and let adjacent siblings render on top of it. The default position
        // is `static` — anything explicitly absolute or fixed would reintroduce
        // the overlap.
        expect(rule).not.toMatch(/position:\s*(absolute|fixed)\b/);
    });

    it('#descSibling base rule does not pin a fixed height that would clip its content', () => {
        const rule = extractTopLevelRule('#descSibling');
        // The panel must be free to grow with its description content. A
        // `min-height` floor is fine; a fixed `height: <px>` would prevent
        // it from expanding and force overflow into adjacent rows.
        expect(rule).not.toMatch(/(^|;|\s)height:\s*\d+px/);
    });

    it('#completedHeader uses static positioning so it sits below the description in flow', () => {
        const rule = extractTopLevelRule('#completedHeader');
        expect(rule).not.toMatch(/position:\s*(absolute|fixed)\b/);
    });

    it('#completedHeader does not use a negative top margin that would pull it up over a preceding panel', () => {
        const rule = extractTopLevelRule('#completedHeader');
        const marginTopLong = rule.match(/margin-top:\s*(-?\d+(?:\.\d+)?)px/);
        if (marginTopLong) {
            expect(parseFloat(marginTopLong[1])).toBeGreaterThanOrEqual(0);
        }
        const marginShort = rule.match(/(?:^|\s|;)margin:\s*([^;]+);/);
        if (marginShort) {
            const parts = marginShort[1].trim().split(/\s+/);
            const top = parseFloat(parts[0]);
            expect(Number.isNaN(top) ? 0 : top).toBeGreaterThanOrEqual(0);
        }
    });
});
