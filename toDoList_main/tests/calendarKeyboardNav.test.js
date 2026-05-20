import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pressing Enter on a focused .calendarCell fires the cell's click
// handler, which reassigns calendarSelectedKey and calls
// renderCalendarView(). That function tears down #calendarGrid and
// rebuilds every cell as a fresh <button> — the focused DOM node is
// discarded, focus falls back to <body>, and the Calendar arrow-nav /
// Enter / Backspace handlers all bail because they cannot resolve a
// "current cell" without an active cell as a starting point. The user
// is stranded with no way back into the grid.
//
// The fix in renderCalendarView captures whether focus is inside the
// current grid (via document.activeElement.closest('.calendarCell'))
// before the teardown, and after the rebuild re-focuses the cell whose
// data-date matches calendarSelectedKey. The capture is gated on the
// element being inside the grid so non-keyboard interactions on mobile
// — where the cell never received focus — don't auto-focus and summon
// the on-screen keyboard.
describe('calendar keyboard nav — focus survives Enter re-render', () => {
    const main = read('main.js');

    function extractRenderCalendarView() {
        const idx = main.indexOf('function renderCalendarView');
        if (idx < 0) throw new Error('renderCalendarView not found in main.js');
        const braceStart = main.indexOf('{', idx);
        let depth = 0;
        for (let i = braceStart; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) return main.slice(braceStart + 1, i);
            }
        }
        throw new Error('renderCalendarView body not closed');
    }

    it('captures whether a .calendarCell currently holds focus before the grid teardown', () => {
        const body = extractRenderCalendarView();
        // The capture must happen BEFORE the teardown loop so the
        // pre-teardown active element is observable.
        const teardownIdx = body.search(/while\s*\(\s*grid\.firstChild\s*\)/);
        expect(teardownIdx).toBeGreaterThan(-1);
        const preTeardown = body.slice(0, teardownIdx);
        // Reads document.activeElement and walks up to a .calendarCell.
        expect(preTeardown).toMatch(/document\.activeElement/);
        expect(preTeardown).toMatch(/closest\(\s*['"]\.calendarCell['"]\s*\)/);
    });

    it('restricts the focus capture to cells inside the current #calendarGrid', () => {
        const body = extractRenderCalendarView();
        const teardownIdx = body.search(/while\s*\(\s*grid\.firstChild\s*\)/);
        const preTeardown = body.slice(0, teardownIdx);
        // Without grid.contains() (or equivalent ancestor check), focus
        // on a calendar cell from a stale prior render or another grid
        // would falsely trigger the post-rebuild re-focus. The contains
        // check also doubles as the "only on keyboard contexts" gate —
        // mobile taps on a <button> do not focus the element, so the
        // active element stays on <body> and the gate stays false.
        expect(preTeardown).toMatch(/grid\.contains\(/);
    });

    it('after the rebuild, re-focuses the cell whose data-date matches calendarSelectedKey', () => {
        const body = extractRenderCalendarView();
        const teardownIdx = body.search(/while\s*\(\s*grid\.firstChild\s*\)/);
        const postTeardown = body.slice(teardownIdx);
        // Selects the freshly-rendered cell by data-date attribute,
        // matching calendarSelectedKey — the same string the cell click
        // handler just wrote — and calls focus() on it.
        expect(postTeardown).toMatch(/querySelector\(\s*['"`][^'"`]*\.calendarCell\[data-date=/);
        expect(postTeardown).toMatch(/calendarSelectedKey/);
        expect(postTeardown).toMatch(/\.focus\(\s*\)/);
    });

    it('the post-rebuild focus call is gated on the pre-teardown capture', () => {
        const body = extractRenderCalendarView();
        // A single boolean (captured before teardown, consumed after
        // rebuild) gates the re-focus. Without the gate, the rebuild
        // would steal focus from unrelated surfaces — the day-detail
        // task list, the month-nav arrows, etc. — every time the
        // calendar re-renders for an unrelated reason (e.g. a todo
        // toggle inside the day-detail panel calling renderCalendarView
        // via onAfterToggle).
        const captureMatch = body.match(/(?:const|let|var)\s+(\w+)\s*=\s*[^;]*closest\(\s*['"]\.calendarCell['"]\s*\)[^;]*grid\.contains\(/);
        expect(captureMatch).not.toBeNull();
        const captureName = captureMatch[1];
        const teardownIdx = body.search(/while\s*\(\s*grid\.firstChild\s*\)/);
        const postTeardown = body.slice(teardownIdx);
        // The same identifier guards the post-rebuild focus block.
        expect(postTeardown).toMatch(new RegExp('\\b' + captureName + '\\b'));
    });
});
