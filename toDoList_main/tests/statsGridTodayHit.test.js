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

// Regression coverage for the "today completed should count as a hit"
// fix: today's grid cell needs to render with both the hit fill AND the
// today ring outline when a clone for today exists in the project's
// items. Without the overlay, the user's first completion of the day
// vanishes from the chart until midnight rolls over.
describe('contributions grid renders today as filled-plus-ring when hit', () => {
    const toDoRow = read('toDoRow.js');
    const css = read('style.css');

    it('exposes a single cellClasses helper that both grid renders consume', () => {
        // Both buildContributionsGrid and buildFallbackStrip used to
        // inline the class-resolution branch — keeping them in sync is
        // a regression hazard. The fix extracts a shared helper.
        expect(toDoRow).toMatch(/function\s+cellClasses\s*\(/);
        const grid = extractFunction(toDoRow, 'function buildContributionsGrid(');
        const strip = extractFunction(toDoRow, 'function buildFallbackStrip(');
        expect(grid).toMatch(/cellClasses\s*\(/);
        expect(strip).toMatch(/cellClasses\s*\(/);
    });

    it('cellClasses tags today-with-hit with both the hit fill class and the today ring class', () => {
        const fn = extractFunction(toDoRow, 'function cellClasses(');
        // When the key matches todayKey AND stats.hits.has(key), the
        // result must include statsCellHit (fill) AND statsCellTodayHit
        // (ring overlay). Without both, the cell can't be visually
        // distinguished from a vanilla hit or a vanilla today.
        expect(fn).toMatch(/statsCellHit[^'"\n]*statsCellTodayHit|statsCellTodayHit[^'"\n]*statsCellHit/);
        // When today has no clone yet, only the ring class applies —
        // the fill stays empty so the cell reads as "in flight".
        expect(fn).toMatch(/statsCellToday\b/);
    });

    it('cellClasses never adds statsCellTodayHit to past or future cells', () => {
        const fn = extractFunction(toDoRow, 'function cellClasses(');
        // statsCellTodayHit must appear exactly once — guarded by the
        // today-key branch. If it leaked into the generic hit branch the
        // ring overlay would render on every historic hit too.
        const matches = fn.match(/statsCellTodayHit/g) || [];
        expect(matches.length).toBe(1);
    });

    it('cellTitleLabel announces "today, completed" when today is a hit', () => {
        const fn = extractFunction(toDoRow, 'function cellTitleLabel(');
        // Tooltip wording change keeps screen-reader / hover users in
        // sync with the visual: a filled-plus-ring cell labelled "today"
        // alone would be ambiguous (filled? not filled?).
        expect(fn).toMatch(/today,\s*completed/);
        expect(fn).toMatch(/stats\.hits\.has\(/);
    });

    it('style.css carries a .statsCellTodayHit rule that strokes the filled cell', () => {
        // The fill comes from .statsCellHit; the overlay rule only needs
        // to add a visible stroke so the today cell reads distinctly
        // from a generic hit cell. 1.5px stroke matches the non-hit
        // today ring so the two treatments feel like one design family.
        const ruleMatch = css.match(/\.statsGrid\s+\.statsCellTodayHit\s*\{([\s\S]*?)\}/);
        expect(ruleMatch).not.toBeNull();
        const body = ruleMatch[1];
        expect(body).toMatch(/stroke:\s*[^;]+;/);
        expect(body).toMatch(/stroke-width:\s*1\.5\s*;/);
    });
});
