import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Left-gutter guide lines for the Structure tab tree: each indented row paints
// a thin vertical line per ancestor level down its left gutter, keyed off the
// existing --structure-depth variable, so containment reads at a glance across
// the Code / live-UI / published-map lenses. Pure CSS, drawn as a ::before on
// the four indented row classes (never a row background, which :hover would
// wipe). These tests pin that CSS.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Return the declaration body of the first rule whose selector list contains
// `selector` immediately followed (possibly after other grouped selectors) by
// the opening brace. Naive brace match, same as the other CSS-pinning tests.
function rule(selector) {
    const re = new RegExp(selector.replace(/[#.:]/g, m => '\\' + m) + '[^{}]*\\{([^}]*)\\}');
    const m = css.match(re);
    return m ? m[1] : null;
}

const ROW_CLASSES = [
    '.structureFolderRow',
    '.structureFileRow',
    '.structureRegionRow',
    '.structureCollapsedRow',
];

describe('Structure tab — left-gutter guide lines', () => {
    it('makes every indented row class a positioning context for the guide', () => {
        // The guide ::before is absolutely positioned, so each row it attaches
        // to must establish `position: relative`.
        const decl = rule('.structureFolderRow,\\s*\\n\\s*.structureFileRow,\\s*\\n\\s*.structureRegionRow,\\s*\\n\\s*.structureCollapsedRow');
        expect(decl).not.toBeNull();
        expect(decl).toMatch(/position:\s*relative/);
    });

    it('draws the guide as a ::before on all four indented row classes', () => {
        // The selector list must name each row class with a ::before, so the
        // guide survives the rows' :hover { background } shorthand.
        const beforeBlock = css.match(/\.structureFolderRow::before[\s\S]*?\{([\s\S]*?)\}/);
        expect(beforeBlock).not.toBeNull();
        const selectorText = css.slice(
            css.indexOf('.structureFolderRow::before'),
            css.indexOf('{', css.indexOf('.structureFolderRow::before')),
        );
        for (const cls of ROW_CLASSES) {
            expect(selectorText).toContain(`${cls}::before`);
        }
    });

    it('widths the guide off --structure-depth at 14px per level', () => {
        const decl = rule('.structureFolderRow::before');
        expect(decl).not.toBeNull();
        // One 1px line per ancestor level on a 14px period; depth 0 → zero width.
        expect(decl).toMatch(/width:\s*calc\(var\(--structure-depth,\s*0\)\s*\*\s*14px\)/);
    });

    it('paints quiet 1px caret-purple lines on a 14px period via a repeating gradient', () => {
        const decl = rule('.structureFolderRow::before');
        expect(decl).not.toBeNull();
        expect(decl).toMatch(/background-image:\s*repeating-linear-gradient\(\s*to right,\s*rgba\(157,\s*147,\s*238,\s*0\.22\)\s*0\s*1px,\s*transparent\s*1px\s*14px\)/);
    });

    it('anchors the strip at the caret column and spans the full row height, click-through', () => {
        const decl = rule('.structureFolderRow::before');
        expect(decl).not.toBeNull();
        expect(decl).toMatch(/left:\s*10px/);
        expect(decl).toMatch(/top:\s*0/);
        expect(decl).toMatch(/bottom:\s*0/);
        expect(decl).toMatch(/pointer-events:\s*none/);
    });
});
