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
        let depth = 0;
        for (let i = 0; i < css.length; i++) {
            const c = css[i];
            if (c === '{') { depth++; continue; }
            if (c === '}') { depth--; continue; }
            if (depth !== 0) continue;
            if (css.startsWith(selector, i) && /[\s{]/.test(css[i + selector.length] || '')) {
                const blockStart = css.indexOf('{', i);
                const blockEnd = css.indexOf('}', blockStart);
                return css.slice(blockStart + 1, blockEnd);
            }
        }
        throw new Error(`Top-level rule for "${selector}" not found`);
    }

    const rowRule = extractTopLevelRule('#toDoChild');

    it('uses overflow: clip rather than overflow: hidden on #toDoChild', () => {
        expect(rowRule).toMatch(/overflow:\s*clip\s*;/);
        expect(rowRule).not.toMatch(/overflow:\s*hidden\s*;/);
    });

    it('declares overflow-clip-margin of at least 1px so the pill border can paint', () => {
        const match = rowRule.match(/overflow-clip-margin:\s*(\d+(?:\.\d+)?)px\s*;/);
        expect(match).not.toBeNull();
        expect(parseFloat(match[1])).toBeGreaterThanOrEqual(1);
    });
});
