import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the fix for the TODO.md viewer entry text crushing to one character per
// line in the narrow ~308px queue rail. `.todoMdViewerCheckRow` is a flex row
// holding checkbox → label → per-entry action buttons (Run / Revert /
// Acknowledge / delete). Before the fix the row had no `flex-wrap`, so when the
// buttons could not fit beside the label the browser shrank the label — whose
// `word-break: break-word` removed its min-content floor — toward zero width,
// rendering its text one glyph per line instead of wrapping the buttons.
//
// The fix is a paired CSS change and NEITHER half works alone: `flex-wrap: wrap`
// on the row so buttons can drop to their own line, AND a `min-width` floor on
// `.todoMdViewerCheckText` so flex-shrink can't compress it (which is what forces
// the wrap to trigger instead of the label collapsing). jsdom does not compute
// layout, so — per CLAUDE.md and the sibling header-wrap test — we assert the CSS
// contract by source inspection rather than instantiating a layout engine.
describe('TODO.md viewer entry text wraps instead of crushing in the narrow rail', () => {
    const css = read('style.css');

    function block(selectorRe) {
        const m = css.match(selectorRe);
        return m ? m[0] : null;
    }

    it('lets the check row wrap so action buttons drop to a second line', () => {
        const rule = block(/\.todoMdViewerCheckRow\s*\{[^}]*\}/);
        expect(rule).toBeTruthy();
        expect(rule).toMatch(/flex-wrap:\s*wrap/);
    });

    it('gives the check row a row-gap so a wrapped button row is not flush with the text', () => {
        const rule = block(/\.todoMdViewerCheckRow\s*\{[^}]*\}/);
        expect(rule).toBeTruthy();
        // Either an explicit row-gap or the two-value `gap: <row> <col>` shorthand
        // provides the vertical spacing between the text line and a wrapped row.
        expect(rule).toMatch(/row-gap:\s*\d|gap:\s*\d+\w*\s+\d/);
    });

    it('gives the label a min-width floor so flex-shrink cannot crush it', () => {
        const rule = block(/\n\.todoMdViewerCheckText\s*\{[^}]*\}/);
        expect(rule).toBeTruthy();
        expect(rule).toMatch(/min-width:\s*\d/);
    });

    it('keeps word-break on the label so a long unbroken path still cannot overflow', () => {
        const rule = block(/\n\.todoMdViewerCheckText\s*\{[^}]*\}/);
        expect(rule).toBeTruthy();
        expect(rule).toMatch(/word-break:\s*break-word/);
    });
});
