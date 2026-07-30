import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// TODO.md desktop rail strip: the pinned strip's content sat too close to its own
// border — 8px horizontal padding is tighter than the 12px inset the rail's other
// elements use (#taskFilterBar, the strip's direct sibling below it, pads
// `8px 12px 6px`), so the file name crowded the left border and the overflow
// control nearly touched the right. The fix raises the strip's horizontal padding
// to 12px so its content lines up with the filter pills and task rows beneath it,
// while keeping vertical padding modest (height comes out of the visible row
// count). Desktop-only: the strip lives inside `@media (min-width: 1024px)`.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Return the comment-stripped body of the first `@media (min-width: 1024px)`
// block whose declarations mention `needle`. Naive brace matching, matching the
// other CSS-pinning tests in this suite.
function media1024BlockContaining(needle) {
    let idx = 0;
    while ((idx = css.indexOf('@media (min-width: 1024px)', idx)) !== -1) {
        const start = css.indexOf('{', idx);
        let depth = 0;
        let end = css.length;
        for (let i = start; i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
        const body = css.slice(start + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');
        if (body.includes(needle)) return body;
        idx = end;
    }
    return null;
}

function rule(body, selector) {
    const re = new RegExp(selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}');
    const m = body.match(re);
    return m ? m[1] : null;
}

describe('TODO.md rail strip — content breathing room from its border', () => {
    const block = media1024BlockContaining('.todoMdViewerStrip');

    it('declares the strip inside the desktop @media block', () => {
        expect(block).not.toBeNull();
    });

    it('insets the strip content 12px horizontally to match the rail inset', () => {
        const decl = rule(block, '.todoMdViewerStrip');
        expect(decl).not.toBeNull();
        // padding: <vertical> 12px — horizontal padding matches #taskFilterBar's
        // 12px inset so the file name and controls line up with the rows below.
        const m = decl.match(/padding:\s*(\d+)px\s+(\d+)px/);
        expect(m).not.toBeNull();
        expect(Number(m[2])).toBe(12);
    });

    it('keeps the vertical padding modest so the pinned strip stays short', () => {
        const decl = rule(block, '.todoMdViewerStrip');
        const m = decl.match(/padding:\s*(\d+)px\s+(\d+)px/);
        expect(Number(m[1])).toBeLessThanOrEqual(8);
    });
});
