import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    if (start === -1) throw new Error('signature not found: ' + signature);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        const c = source[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error('unterminated function for: ' + signature);
}

// On phone-width viewports (≤420px) the recurring-task stats drawer's
// bottom edge leaked past the next #toDoChild — the previous two-row
// wrap strip had no intrinsic pixel height inside its flex-column
// wrapper, so the auto-sized #mainList grid track collapsed below the
// rendered children. The fix swaps the wrap for a single-row layout
// of 14 cells at 16×16 px (3 px gap) and pins explicit `width="263"`
// `height="16"` attributes on the SVG so it contributes a real pixel
// height to the grid track. This regression test mirrors the
// statsGridAxisLabels.test.js pattern — both lock in pixel-level SVG
// sizing inside an auto-sized grid track.
describe('mobile recency-strip SVG declares an explicit pixel height', () => {
    const toDoRow = read('toDoRow.js');
    const fn = extractFunction(toDoRow, 'function buildFallbackStrip(');

    it('mobile cell metrics resolve to a 16 px row — cellSize 16, gap 3, 14 cells', () => {
        // 14 × 16 + 13 × 3 = 263 px width; single row → 16 px height.
        // These constants are the contract every other assertion depends on.
        expect(fn).toMatch(/cellSize\s*=\s*mobile\s*\?\s*16\s*:\s*18/);
        expect(fn).toMatch(/gap\s*=\s*mobile\s*\?\s*3\s*:\s*4/);
        expect(fn).toMatch(/maxCells\s*=\s*mobile\s*\?\s*14\s*:\s*12/);
    });

    it('SVG sets an explicit pixel height attribute equal to one cell row', () => {
        // setAttribute('height', height) where height = rows * cellSize and
        // rows is the constant 1 — i.e. the SVG reports cellSize pixels
        // tall regardless of how CSS sizes its parent.
        expect(fn).toMatch(/rows\s*=\s*1\s*;/);
        expect(fn).toMatch(/height\s*=\s*rows\s*\*\s*cellSize\s*;/);
        expect(fn).toMatch(/setAttribute\(\s*['"]height['"]\s*,\s*height\s*\)/);
    });

    it('SVG sets an explicit pixel width attribute that matches the cell row footprint', () => {
        // width = cols * cellSize + (cols - 1) * gap. The attribute must
        // be set explicitly — relying on the viewBox alone leaves the SVG
        // at the user-agent default (300 px) inside a flex column.
        expect(fn).toMatch(/setAttribute\(\s*['"]width['"]\s*,\s*width\s*\)/);
    });

    it('viewBox starts at 0 0 and uses the computed width/height — no hardcoded "0 0 263 16" string', () => {
        // The viewBox is derived from `width` and `height` so the desktop
        // (single-row 12-cell 18 px) and mobile (single-row 14-cell 16 px)
        // branches share the same expression.
        expect(fn).toMatch(/viewBox['"]\s*,\s*['"]0 0 ['"]\s*\+\s*width\s*\+\s*['"] ['"]\s*\+\s*height/);
    });

    it('no longer leans on wrapper.style.minHeight — the SVG height attribute is the load-bearing fix', () => {
        // The legacy two-row wrap pushed a pixel min-height onto the
        // wrapping <div> to compensate for the SVG collapsing inside its
        // flex parent. The single-row layout makes that workaround
        // redundant; carrying both would just compete with style.css.
        expect(fn).not.toMatch(/wrapper\.style\.minHeight/);
    });
});
