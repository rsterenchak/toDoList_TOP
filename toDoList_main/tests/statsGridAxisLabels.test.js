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

// The recurring-task stats contributions grid shipped without axis labels,
// which left a user staring at an unlabeled S-grid with no way to tell which
// row is which weekday. The fix adds a left gutter of weekday letters and a
// top gutter of month abbreviations, shifting cells by the gutter offsets so
// they still line up under the right column header.
describe('contributions grid renders weekday and month axis labels', () => {
    const toDoRow = read('toDoRow.js');
    const css = read('style.css');
    const fn = extractFunction(toDoRow, 'function buildContributionsGrid(');

    it('declares dedicated gutter constants so future tuning is one-line', () => {
        expect(fn).toMatch(/const\s+labelGutterX\s*=\s*14\s*;/);
        expect(fn).toMatch(/const\s+labelGutterY\s*=\s*14\s*;/);
    });

    it('expands the SVG width and height to absorb the gutters', () => {
        // width and height must include the gutter offsets so the labels
        // are inside the visible viewBox rather than clipped to the cell
        // grid's old bounds.
        expect(fn).toMatch(/const\s+width\s*=\s*labelGutterX\s*\+/);
        expect(fn).toMatch(/const\s+height\s*=\s*labelGutterY\s*\+/);
    });

    it('reserves a right-side gutter in the SVG width so the last column\'s month label is not clipped', () => {
        // A month label drawn at the last column's left edge extends past
        // the cell's right edge — without a right gutter folded into the
        // SVG width, the UA-default overflow:hidden on <svg> clips it to
        // the first letter or two on single-column 14d grids.
        expect(fn).toMatch(/const\s+labelGutterRight\s*=\s*\d+\s*;/);
        expect(fn).toMatch(/const\s+width\s*=\s*labelGutterX\s*\+\s*gridWidth\s*\+\s*labelGutterRight\s*;/);
    });

    it('shifts every cell by the gutter offsets so cells stay aligned to their column header', () => {
        // Looking for `labelGutterX + col * (cellSize + gap)` and
        // `labelGutterY + row * (cellSize + gap)` in the cell-placement
        // arithmetic. Without the shift, cells overlap the gutter labels.
        const xLine = fn.match(/const\s+x\s*=\s*([^;]+);/);
        const yLine = fn.match(/const\s+y\s*=\s*([^;]+);/);
        expect(xLine).not.toBeNull();
        expect(yLine).not.toBeNull();
        expect(xLine[1]).toMatch(/labelGutterX/);
        expect(yLine[1]).toMatch(/labelGutterY/);
    });

    it('emits seven weekday <text> labels Sunday-first to match d.getDay() row math', () => {
        // Sunday is index 0 in `d.getDay()`, so the weekday gutter must
        // start with S and end with S — anything else and the letter under
        // each row would be wrong.
        expect(fn).toMatch(/\[\s*['"]S['"]\s*,\s*['"]M['"]\s*,\s*['"]T['"]\s*,\s*['"]W['"]\s*,\s*['"]T['"]\s*,\s*['"]F['"]\s*,\s*['"]S['"]\s*\]/);
        // The vertical centering pattern: y = labelGutterY + row * step + cellSize / 2
        expect(fn).toMatch(/labelGutterY\s*\+\s*row\s*\*\s*\(\s*cellSize\s*\+\s*gap\s*\)\s*\+\s*cellSize\s*\/\s*2/);
        // dominant-baseline middle so the letter sits at the row center
        // rather than its top — without this, letters drift above each row.
        expect(fn).toMatch(/setAttribute\(\s*['"]dominant-baseline['"]\s*,\s*['"]middle['"]\s*\)/);
    });

    it('emits a month label at column 0 and at every month transition, without repeating consecutive same-month columns', () => {
        // The first column always gets a label, regardless of whether the
        // window happens to start mid-month. Subsequent columns label only
        // when the month index changes from the last labeled column —
        // otherwise the gutter would repeat "May May May" across consecutive
        // weeks.
        expect(fn).toMatch(/let\s+lastLabeledMonth\s*=\s*-1\s*;/);
        expect(fn).toMatch(/col\s*===\s*0\s*\|\|\s*monthIdx\s*!==\s*lastLabeledMonth/);
        // Locale-short month name via toLocaleString({ month: 'short' }).
        expect(fn).toMatch(/toLocaleString\(\s*[^,]*,\s*\{\s*month:\s*['"]short['"]\s*\}\s*\)/);
        // lastLabeledMonth must update after emission so the next iteration
        // can compare against the latest labeled month.
        expect(fn).toMatch(/lastLabeledMonth\s*=\s*monthIdx\s*;/);
    });

    it('tags labels with the statsGridLabel class so styling lives in CSS', () => {
        expect(fn).toMatch(/setAttribute\(\s*['"]class['"]\s*,\s*['"]statsGridLabel['"]\s*\)/);
    });

    it('style.css carries a .statsGridLabel rule with muted fill and compact font size', () => {
        // The labels are chrome — they must use the muted text color so they
        // don't compete with the cells for attention, and a 9px size to keep
        // the gutter footprint tight (~14px).
        const ruleMatch = css.match(/\.statsGrid\s+\.statsGridLabel\s*\{([\s\S]*?)\}/);
        expect(ruleMatch).not.toBeNull();
        const body = ruleMatch[1];
        expect(body).toMatch(/fill:\s*var\(--text-muted\)/);
        expect(body).toMatch(/font-size:\s*9px/);
    });

    it('does not touch buildFallbackStrip — month/year cadences have no weekday axis to label', () => {
        // The fallback strip is a single horizontal row of last-12
        // occurrences; weekday letters and month gutters don't apply.
        const fallback = extractFunction(toDoRow, 'function buildFallbackStrip(');
        expect(fallback).not.toMatch(/labelGutterX/);
        expect(fallback).not.toMatch(/labelGutterY/);
        expect(fallback).not.toMatch(/statsGridLabel/);
    });
});
