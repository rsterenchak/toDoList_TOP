import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression: on narrow (mobile) viewports the todo rows and the sort button
// were clipped on the right edge with no horizontal scroll. The task pane
// (#mainBar) and the scrollable list (#mainList) are CSS grids with no
// explicit `grid-template-columns`, so their single implicit `auto` column
// grew to the widest row's max-content. A long todo title pushed the track
// past the viewport; because both wrappers are `overflow: hidden` /
// `overflow-x: hidden`, the right side of each row — and the right-aligned
// mobile sort button in #taskFilterBar, which stretches to #mainBar's column
// width — was cropped off-screen. Pinning each grid to a single
// `minmax(0, 1fr)` column caps the track at the container width (the `0`
// minimum lets long content truncate inside the row instead of overflowing).
describe('Main task pane grid columns are pinned to the container width', () => {
    const css = read('style.css');

    // Body of a top-level rule whose selector matches exactly (not inside an
    // @media block, no extra chars before the `{`).
    function topLevelRule(selector) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(
            '(?:^|}|\\*/)\\s*' + escaped + '\\s*\\{([^{}]*)\\}'
        );
        const match = css.match(re);
        if (!match) throw new Error(`Top-level rule for "${selector}" not found`);
        return match[1];
    }

    it('#mainBar declares a single minmax(0, 1fr) column so the pane never exceeds its width', () => {
        const rule = topLevelRule('#mainBar');
        expect(rule).toMatch(/grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*;/);
    });

    it('#mainList declares a single minmax(0, 1fr) column so long rows truncate instead of overflowing', () => {
        const rule = topLevelRule('#mainList');
        expect(rule).toMatch(/grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*;/);
    });

    it('keeps the list clipping horizontal overflow (no horizontal scroll on the list)', () => {
        // The column cap is what prevents content from overflowing; the
        // existing overflow-x:hidden stays so any residual sub-pixel spill is
        // clipped rather than producing a horizontal scrollbar.
        const rule = topLevelRule('#mainList');
        expect(rule).toMatch(/overflow-x:\s*hidden/);
    });
});
