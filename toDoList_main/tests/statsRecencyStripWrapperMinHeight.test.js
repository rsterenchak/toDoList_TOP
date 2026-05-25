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

// On phone-width viewports (≤420px) the recurring-task stats drawer
// rendered its two-row recency strip but the drawer's row track in
// #mainList did not grow to fit. The strip's SVG declared explicit
// width/height attributes, yet inside the flex-column wrapper the SVG's
// reported block size collapsed below the rendered children — the
// auto-sized grid row track sized to that smaller value and the bottom
// of the drawer (second strip row + MISSED pill list) leaked past the
// drawer's bottom border, with the next #toDoChild overlapping. The fix
// declares an explicit pixel min-height on the wrapping div in the
// mobile branch, computed from the strip's row count, the caption row,
// the labels row, and the inter-row gaps — mirroring the lock-in
// pattern from statsGridAxisLabels.test.js.
describe('mobile recency-strip wrapper declares an explicit min-height', () => {
    const toDoRow = read('toDoRow.js');
    const fn = extractFunction(toDoRow, 'function buildFallbackStrip(');

    it('assigns wrapper.style.minHeight inside buildFallbackStrip', () => {
        expect(fn).toMatch(/wrapper\.style\.minHeight\s*=/);
    });

    it('the min-height expression references the strip layout dimensions', () => {
        // Without referencing the strip's height, a hardcoded pixel
        // value would silently desync if the cell size or row count
        // ever changed. Either reusing the `height` variable
        // (rows * cellSize + (rows - 1) * gap) or referencing
        // `rows * cellSize` directly keeps the lower bound tied to the
        // actual SVG layout.
        const stmt = fn.match(/wrapper\.style\.minHeight\s*=[^;]+;/);
        expect(stmt).not.toBeNull();
        const expr = stmt[0];
        const referencesLayout =
            /\bheight\b/.test(expr) || /rows\s*\*\s*cellSize/.test(expr);
        expect(referencesLayout).toBe(true);
    });

    it('the min-height assignment is gated by the mobile flag', () => {
        // Desktop (single-row, month/year cadence) must not carry an
        // inline min-height — it has no two-row wrap to protect, and
        // an inline value would compete with style.css.
        const minHeightIdx = fn.indexOf('wrapper.style.minHeight');
        expect(minHeightIdx).toBeGreaterThan(-1);
        const before = fn.slice(0, minHeightIdx);
        const lastIf = before.lastIndexOf('if (');
        expect(lastIf).toBeGreaterThan(-1);
        const ifLine = before.slice(lastIf, lastIf + 80);
        expect(ifLine).toMatch(/if\s*\(\s*mobile\s*\)/);
    });
});
