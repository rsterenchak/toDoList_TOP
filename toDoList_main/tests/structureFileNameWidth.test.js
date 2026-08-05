import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Pins the fix for Structure-tab file names collapsing to one character plus an
// ellipsis (`Program.cs` rendering as `P.`) in the Code lens. `.structureFileRow`
// is a flex row holding icon → name → GitHub link (the per-row Explain button has
// since moved into the code viewer, which is what freed the width the name was
// short of). Its siblings are all `flex: 0 0 auto`, and `.structureFileName` sets
// `overflow: hidden` (which zeroes its automatic min-width floor), so the name is
// the only shrinkable item in the row and absorbed the entire space deficit.
//
// The fix is a paired change on `.structureFileName` and NEITHER half works
// alone: `flex: 1 1 auto` so flex-grow claims the row's free space (grow is
// resolved before auto margins, so the name — not the gap — gets the extra
// width), AND a `min-width` floor so flex-shrink can never crush it below a
// readable few characters. jsdom does not compute layout, so — per the sibling
// CSS-pinning tests — we assert the CSS contract by source inspection rather
// than instantiating a layout engine.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Return the declaration body of the rule for `selector`. Naive brace match,
// same as the other CSS-pinning tests.
function rule(selector) {
    const re = new RegExp('\\n' + selector.replace(/[#.:]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}');
    const m = css.match(re);
    return m ? m[1] : null;
}

describe('Structure tab — file names keep a readable width', () => {
    it('lets the file name grow into the row’s free space', () => {
        const decl = rule('.structureFileName');
        expect(decl).not.toBeNull();
        // flex-grow must be non-zero, otherwise the row's extra width banks into
        // the gap before the GitHub glyph rather than into the name.
        expect(decl).toMatch(/flex:\s*1\s+1\s+auto/);
    });

    it('gives the file name a min-width floor so flex-shrink cannot crush it', () => {
        const decl = rule('.structureFileName');
        expect(decl).not.toBeNull();
        expect(decl).toMatch(/min-width:\s*[1-9]/);
    });

    it('keeps end ellipsis on the file name for genuinely long names', () => {
        const decl = rule('.structureFileName');
        expect(decl).not.toBeNull();
        expect(decl).toMatch(/overflow:\s*hidden/);
        expect(decl).toMatch(/text-overflow:\s*ellipsis/);
        expect(decl).toMatch(/white-space:\s*nowrap/);
    });

    it('keeps the GitHub glyph unshrinkable so it holds its size at the right edge', () => {
        const decl = rule('.structureGithubLink--glyph');
        expect(decl).not.toBeNull();
        expect(decl).toMatch(/flex:\s*0\s+0\s+auto/);
    });

    it('no longer styles a per-row Explain button — the control moved to the viewer', () => {
        expect(rule('.structureExplainBtn')).toBeNull();
        expect(rule('.structureExplainResult')).toBeNull();
    });

    it('leaves the nesting indent on the file row untouched', () => {
        const decl = rule('.structureFolderRow,\\s*\\n\\s*.structureFileRow');
        expect(decl).not.toBeNull();
        expect(decl).toMatch(/padding-left:\s*calc\(4px \+ var\(--structure-depth,\s*0\)\s*\*\s*14px\)/);
    });
});
