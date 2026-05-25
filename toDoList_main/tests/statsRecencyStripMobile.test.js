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

// On phone-width viewports (≤420px) the recurring-task stats contributions
// grid collapses to an unreadable sliver — 14px cells against the dark
// background lose contrast and the overflow-x: auto wrapper lets the SVG
// share horizontal space with surrounding chrome. The fix swaps the grid
// for the existing buildFallbackStrip output, parameterized with a
// `mobile` flag that lays the last 14 expected occurrences out as 22×22
// cells, 7 per row across 2 rows, framed by a LAST 14 caption and oldest
// / today labels.
describe('recurring-task stats use the recency strip on phone viewports', () => {
    const toDoRow = read('toDoRow.js');
    const css = read('style.css');

    it('buildFallbackStrip accepts a mobile flag that switches it to the recency layout', () => {
        const fn = extractFunction(toDoRow, 'function buildFallbackStrip(');
        expect(fn).toMatch(/function\s+buildFallbackStrip\s*\(\s*stats\s*,\s*mobile\s*\)/);
        // Mobile slice is the last 14; desktop slice stays at the last 12.
        expect(fn).toMatch(/slice\(\s*-\s*(?:maxCells|14)\s*\)/);
        // 22×22 cells when mobile, 18×18 when not.
        expect(fn).toMatch(/22/);
        // 7 cells per row in the mobile branch.
        expect(fn).toMatch(/(?:cellsPerRow|7)/);
        // Cells must still flow through the shared cellClasses helper so
        // hit / miss / today / future treatments match the desktop grid.
        expect(fn).toMatch(/cellClasses\s*\(/);
        // Tooltip labels still flow through cellTitleLabel, so the strip
        // and the desktop grid announce occurrences identically.
        expect(fn).toMatch(/cellTitleLabel\s*\(/);
    });

    it('mobile branch wraps to two rows of 7 — row math uses Math.floor(idx / cellsPerRow)', () => {
        const fn = extractFunction(toDoRow, 'function buildFallbackStrip(');
        // The Y coordinate must vary across rows in the mobile layout —
        // a literal `y = 0` (the legacy single-row behavior) would leave
        // every mobile cell stacked on top of the first row.
        expect(fn).toMatch(/Math\.floor\(\s*idx\s*\/\s*(?:cellsPerRow|7)\s*\)/);
        expect(fn).toMatch(/idx\s*%\s*(?:cellsPerRow|7)/);
        // The height computation must allow more than one row of cells.
        expect(fn).toMatch(/rows\s*\*\s*cellSize/);
    });

    it('mobile strip renders a LAST 14 caption above and oldest / today labels below', () => {
        const fn = extractFunction(toDoRow, 'function buildFallbackStrip(');
        expect(fn).toMatch(/statsFallbackStripCaption/);
        expect(fn).toMatch(/LAST 14/);
        expect(fn).toMatch(/statsFallbackStripLabels?/);
        // Oldest date sits in the first label, the literal "today" string
        // sits in the second — so the strip reads as a left-to-right
        // recency axis at a glance.
        expect(fn).toMatch(/formatShortDate\(\s*expected\[\s*0\s*\]\s*\)/);
        expect(fn).toMatch(/['"]today['"]/);
    });

    it('renderDrawer branches on matchMedia(max-width: 420px) so daily/weekly cadences use the strip on phones', () => {
        const fn = extractFunction(toDoRow, 'function renderDrawer(');
        // The viewport check uses the established 420px breakpoint.
        expect(fn).toMatch(/matchMedia\(\s*['"]\(max-width:\s*420px\)['"]\s*\)/);
        // The drawer must pass the mobile flag into buildFallbackStrip
        // for non-month/year cadences — otherwise the strip renders in
        // its desktop single-row 18×18 form and the squeeze persists.
        expect(fn).toMatch(/buildFallbackStrip\s*\(\s*stats\s*,\s*true\s*\)/);
    });

    it('month/year cadences still call buildFallbackStrip without the mobile flag — their layout is unchanged', () => {
        const fn = extractFunction(toDoRow, 'function renderDrawer(');
        // The useFallback-true branch keeps the original 1-arg call so the
        // existing single-row strip continues to ship on both desktop and
        // mobile for month/year cadences.
        expect(fn).toMatch(/useFallback[\s\S]{0,200}buildFallbackStrip\s*\(\s*stats\s*\)/);
    });

    it('style.css carries rules for the mobile strip caption, labels, and wrapper', () => {
        // The caption must be uppercased, letter-spaced, and muted so it
        // reads as chrome — matching the rhythm of .statsMissedLabel and
        // the surrounding muted-text rhythm in the drawer.
        const caption = css.match(/\.statsFallbackStripCaption\s*\{([\s\S]*?)\}/);
        expect(caption).not.toBeNull();
        expect(caption[1]).toMatch(/text-transform:\s*uppercase/);
        expect(caption[1]).toMatch(/color:\s*var\(--text-muted\)/);

        // The label container splits oldest / today across the strip's
        // full width — justify-content: space-between is the contract.
        const labels = css.match(/\.statsFallbackStripLabels\s*\{([\s\S]*?)\}/);
        expect(labels).not.toBeNull();
        expect(labels[1]).toMatch(/justify-content:\s*space-between/);
    });
});
