import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the fix for the due-date pill bottom-border clip bug. The pill
// (calendar icon + date + chevron) sits inside #toDoChild, which has a fixed
// height and clips overflow to keep horizontal swipe panes from leaking past
// the row edge. With `overflow: hidden`, sub-pixel rounding from
// `align-items: center` plus the pill's 0.5px borders caused the bottom edge
// of the pill to be cropped flush against the row's bottom, so only three
// sides of the rounded rectangle were visible. Switching to `overflow: clip`
// with a 1px `overflow-clip-margin` keeps the swipe-pane clipping intact
// while giving the pill border enough breathing room to paint fully.
describe('todo row clip rule preserves the due-date pill bottom border', () => {
    const css = read('style.css');

    function extractTopLevelRule(selector) {
        // Walk the file ignoring nested @media blocks so we only return the
        // top-level (desktop default) declaration block for `selector`.
        // Match only when `selector` STARTS a top-level rule — preceded by
        // start-of-file, `}`, or `,` (after whitespace) — so substrings inside
        // compound selectors like `html[...] #toDoChild #duePill` don't match.
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
            // `/` covers the case where the preceding non-whitespace is the
            // closing `*/` of a CSS comment immediately before the rule.
            if (prev !== '' && prev !== '}' && prev !== ',' && prev !== '/') continue;
            const blockStart = css.indexOf('{', i);
            const blockEnd = css.indexOf('}', blockStart);
            return css.slice(blockStart + 1, blockEnd);
        }
        throw new Error(`Top-level rule for "${selector}" not found`);
    }

    const rowRule = extractTopLevelRule('#toDoChild');
    const pillRule = extractTopLevelRule('#duePill');

    it('uses overflow: clip rather than overflow: hidden on #toDoChild', () => {
        expect(rowRule).toMatch(/overflow:\s*clip\s*;/);
        expect(rowRule).not.toMatch(/overflow:\s*hidden\s*;/);
    });

    it('declares overflow-clip-margin of at least 1px so the pill border can paint', () => {
        const match = rowRule.match(/overflow-clip-margin:\s*(\d+(?:\.\d+)?)px\s*;/);
        expect(match).not.toBeNull();
        expect(parseFloat(match[1])).toBeGreaterThanOrEqual(1);
    });

    // The pill is centered inside a 44px row by `align-items: center`, which
    // puts its top/bottom edges on a half-pixel Y offset. A 0.5px border at
    // that sub-pixel position rounds to zero device pixels on DPR=1 displays
    // and the bottom edge disappears. A 1px border always rasterizes to at
    // least one physical pixel on every DPR, so the pill keeps a fully
    // enclosed outline. Lock the width in here so a future "harmonize with
    // other hairlines" refactor cannot silently regress the bug.
    it('uses a 1px (or thicker) border on #duePill to avoid DPR=1 hairline dropout', () => {
        const match = pillRule.match(/border:\s*(\d+(?:\.\d+)?)px\s+solid/);
        expect(match).not.toBeNull();
        expect(parseFloat(match[1])).toBeGreaterThanOrEqual(1);
    });
});
