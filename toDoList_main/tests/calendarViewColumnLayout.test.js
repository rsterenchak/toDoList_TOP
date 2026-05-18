import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Walks the stylesheet top-level (depth-0) rules and returns the body of the
// first rule whose selector exactly matches `selector`. Matching the existing
// helper in mainListStatsDrawerHeight.test.js — kept inline rather than
// shared because the harness has no test util module yet.
function extractTopLevelRule(css, selector) {
    let depth = 0;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '{') { depth++; continue; }
        if (c === '}') { depth--; continue; }
        if (depth !== 0) continue;
        if (!css.startsWith(selector, i)) continue;
        const after = css[i + selector.length] || '';
        if (after !== '{' && after !== ',' && !/\s/.test(after)) continue;
        let j = i - 1;
        while (j >= 0 && /\s/.test(css[j])) j--;
        const prev = j < 0 ? '' : css[j];
        if (prev !== '' && prev !== '}' && prev !== ',' && prev !== '/') continue;
        const blockStart = css.indexOf('{', i);
        const blockEnd = css.indexOf('}', blockStart);
        return css.slice(blockStart + 1, blockEnd);
    }
    throw new Error(`Top-level rule for "${selector}" not found`);
}

// Locks in the calendar-view layout fixes: (1) the view stacks column-wise
// on every breakpoint — previously #calendarView used flex-direction: row
// with a fixed 300px right-hand day panel that squished the grid against
// the right edge on wide viewports; (2) the calendar grid and day-detail
// panel both fill 100% of the content area without a max-width cap, and
// each day cell is square via aspect-ratio: 1 / 1 so the grid scales
// proportionally with available width on every viewport.
describe('#calendarView stacks calendar grid above the day-detail panel', () => {
    const css = read('style.css');

    it('uses flex-direction: column on the top-level #calendarView rule', () => {
        const rule = extractTopLevelRule(css, '#calendarView');
        expect(rule).toMatch(/flex-direction:\s*column\s*;/);
        expect(rule).not.toMatch(/flex-direction:\s*row\s*;/);
    });

    it('lets the calendar grid wrapper fill the content area at 100% width with no max-width cap', () => {
        const rule = extractTopLevelRule(css, '#calendarGridSide');
        expect(rule).toMatch(/width:\s*100%\s*;/);
        expect(rule).not.toMatch(/max-width\s*:/);
    });

    it('drops the fixed 300px basis on the day panel so it fills remaining space below the grid at full width', () => {
        const rule = extractTopLevelRule(css, '#calendarDayPanel');
        expect(rule).not.toMatch(/flex:\s*0\s+0\s+300px\s*;/);
        expect(rule).toMatch(/flex:\s*1\s+1\s+auto\s*;/);
        expect(rule).toMatch(/width:\s*100%\s*;/);
        expect(rule).not.toMatch(/max-width\s*:/);
    });

    it('constrains each day cell to a 1:1 aspect ratio so cells grow proportionally with the grid width', () => {
        const rule = extractTopLevelRule(css, '.calendarCell');
        expect(rule).toMatch(/aspect-ratio:\s*1\s*\/\s*1\s*;/);
    });

    it('uses repeat(7, 1fr) for the calendar grid columns so all seven weekday slots share the row width', () => {
        const rule = extractTopLevelRule(css, '#calendarGrid');
        expect(rule).toMatch(/grid-template-columns:\s*repeat\(\s*7\s*,\s*1fr\s*\)\s*;/);
    });

    it('does not double-apply flex-direction: column inside the @media (max-width: 700px) block', () => {
        // Walk to the start of the `@media (max-width: 700px) {` block and
        // extract its full body, so we can assert the inner #calendarView
        // override no longer re-sets flex-direction. The block contains many
        // nested rules — track brace depth to find its matching close.
        const start = css.search(/@media\s*\(\s*max-width:\s*700px\s*\)\s*\{/);
        expect(start).toBeGreaterThan(-1);
        const bodyStart = css.indexOf('{', start) + 1;
        let depth = 1;
        let i = bodyStart;
        for (; i < css.length && depth > 0; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
        }
        const block = css.slice(bodyStart, i - 1);

        // Pull the #calendarView nested rule body from inside the @media.
        const innerMatch = block.match(/#calendarView\s*\{([^}]*)\}/);
        expect(innerMatch).not.toBeNull();
        const innerRule = innerMatch[1];
        expect(innerRule).not.toMatch(/flex-direction\s*:/);
    });
});
