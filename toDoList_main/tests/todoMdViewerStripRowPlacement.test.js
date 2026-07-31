import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// TODO.md desktop rail strip — grid row placement.
//
// `.todoMdViewerStrip` is a direct child of `#mainBar`, inserted just before
// `#taskFilterBar` (see placeViewerCardDesktop in todoMdViewer.js). `#mainBar`
// is an explicit grid. When the strip carried no `grid-row`, it auto-placed into
// the list's `1fr` track and — as a stretch-aligned grid item — grew to fill the
// track's height, so on a short list it ballooned and its own `align-items:
// center` floated the file name + actions in the middle of an oversized box. This
// is the recurring unplaced-child-in-an-explicit-grid defect.
//
// The fix adds a third `auto` track to `#mainBar` at desktop and pins every child
// explicitly: filter bar row 1, strip row 2, list row 3. This test pins that
// layout so a future unplaced child cannot reintroduce the stretch — critically,
// the strip must resolve to a DIFFERENT row than the scrollable list. Desktop
// only: the strip lives inside `@media (min-width: 1024px)`.
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

// Read the `grid-row` value declared inside `selector`'s rule. Scans every rule
// matching the selector in `body` and returns the grid-row from whichever one
// declares it, so it is robust to a selector appearing more than once.
function gridRowOf(body, selector) {
    const re = new RegExp(
        selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}',
        'g',
    );
    let m;
    while ((m = re.exec(body)) !== null) {
        const gr = m[1].match(/(?:^|;)\s*grid-row:\s*([^;]+)/);
        if (gr) return gr[1].trim();
    }
    return null;
}

describe('TODO.md rail strip — pinned in its own grid row, not the list track', () => {
    const block = media1024BlockContaining('.todoMdViewerStrip');

    it('declares the strip inside the desktop @media block', () => {
        expect(block).not.toBeNull();
    });

    it('#mainBar defines three row tracks so the strip has an explicit home', () => {
        // auto (filter bar) auto (strip) 1fr (scrollable list).
        expect(block).toMatch(
            /#mainBar\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+1fr[^}]*\}/,
        );
    });

    it('places the filter bar in row 1, the strip in row 2, and the list in row 3', () => {
        expect(gridRowOf(block, '#taskFilterBar')).toBe('1');
        expect(gridRowOf(block, '.todoMdViewerStrip')).toBe('2');
        expect(gridRowOf(block, '#mainList')).toBe('3');
    });

    it('resolves the strip to a different row than the scrollable list, so it cannot stretch to fill it', () => {
        const stripRow = gridRowOf(block, '.todoMdViewerStrip');
        const listRow = gridRowOf(block, '#mainList');
        expect(stripRow).not.toBeNull();
        expect(listRow).not.toBeNull();
        expect(stripRow).not.toBe(listRow);
    });
});
