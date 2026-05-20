import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for keyboard navigation on the Today and Calendar
// views. The two dashboards share a single global keydown listener that
// branches off #mainBar's data-view attribute:
//   • Today    — ArrowUp/Down walk .todayRow.todoRowCard rows in
//                #todaySections (no wrap, clamp). Enter on a focused row
//                fires the row click (jump to project).
//   • Calendar — .calendarCell elements in #calendarGrid form a 7-column
//                grid. Left/Right ±1 cell, Up/Down ±7 cells (clamp, no
//                auto-advance across months). Enter fires the cell click.
// Guards mirror the Projects-view handler: skip on modifier keys, when a
// modal/popover is open, and when focus is in an editable surface
// outside the navigable region.
describe('view-aware arrow-key navigation — Today and Calendar', () => {
    const main = read('main.js');

    // Extract the Today/Calendar handler by its distinguishing pattern:
    // branches on data-view === 'today' / 'calendar' and uses the
    // calendarGrid + todaySections containers.
    function extractViewArrowHandler() {
        const re = /document\.addEventListener\(\s*['"]keydown['"]\s*,\s*function\s*\([^)]*\)\s*\{/g;
        let match;
        while ((match = re.exec(main)) !== null) {
            const bodyStart = match.index + match[0].length - 1;
            let depth = 0;
            for (let i = bodyStart; i < main.length; i++) {
                const c = main[i];
                if (c === '{') depth++;
                else if (c === '}') {
                    depth--;
                    if (depth === 0) {
                        const body = main.slice(bodyStart + 1, i);
                        if (/todaySections/.test(body) && /calendarGrid/.test(body) && /['"]today['"]/.test(body) && /['"]calendar['"]/.test(body)) {
                            return body;
                        }
                        break;
                    }
                }
            }
        }
        throw new Error('view-aware arrow-nav keydown handler not found in main.js');
    }

    it('buildTodayRow gives every row tabindex="-1" so it can be focused for nav', () => {
        // The row element itself must be programmatically focusable so the
        // arrow-nav handler can hand it focus without putting it in the
        // browser tab order. Pinned at the buildTodayRow site.
        const buildRowRegion = main.slice(main.indexOf('function buildTodayRow'));
        expect(buildRowRegion).toMatch(/row\.setAttribute\(\s*["']tabindex["']\s*,\s*["']-1["']\s*\)/);
    });

    it('handles ArrowUp, ArrowDown, ArrowLeft, ArrowRight, and Enter', () => {
        const body = extractViewArrowHandler();
        expect(body).toMatch(/['"]ArrowUp['"]/);
        expect(body).toMatch(/['"]ArrowDown['"]/);
        expect(body).toMatch(/['"]ArrowLeft['"]/);
        expect(body).toMatch(/['"]ArrowRight['"]/);
        expect(body).toMatch(/['"]Enter['"]/);
    });

    it('branches off #mainBar data-view (today vs calendar)', () => {
        const body = extractViewArrowHandler();
        expect(body).toMatch(/getElementById\(\s*['"]mainBar['"]\s*\)/);
        expect(body).toMatch(/getAttribute\(\s*['"]data-view['"]\s*\)/);
        expect(body).toMatch(/['"]today['"]/);
        expect(body).toMatch(/['"]calendar['"]/);
    });

    it('skips on modifier keys and when any modal/popover is open', () => {
        const body = extractViewArrowHandler();
        expect(body).toMatch(/ctrlKey/);
        expect(body).toMatch(/metaKey/);
        expect(body).toMatch(/altKey/);
        expect(body).toMatch(/shiftKey/);
        expect(body).toMatch(/isAnyModalOrPopoverOpen\(\s*\)/);
    });

    it('skips when focus is in an editable surface outside the navigable region', () => {
        const body = extractViewArrowHandler();
        expect(body).toMatch(/['"]INPUT['"]/);
        expect(body).toMatch(/['"]TEXTAREA['"]/);
        expect(body).toMatch(/isContentEditable/);
    });

    it('Today: walks .todayRow.todoRowCard rows inside #todaySections', () => {
        const body = extractViewArrowHandler();
        expect(body).toMatch(/getElementById\(\s*['"]todaySections['"]\s*\)/);
        expect(body).toMatch(/\.todayRow\.todoRowCard/);
    });

    it('Today: clamps row navigation at the boundaries (no wrap)', () => {
        const body = extractViewArrowHandler();
        // Up: Math.max(idx - 1, 0); Down: Math.min(idx + 1, rows.length - 1).
        expect(body).toMatch(/Math\.max\(\s*idx\s*-\s*1\s*,\s*0\s*\)/);
        expect(body).toMatch(/Math\.min\(\s*idx\s*\+\s*1\s*,\s*rows\.length\s*-\s*1\s*\)/);
    });

    it('Today: Enter on a focused row fires its click handler', () => {
        const body = extractViewArrowHandler();
        // Enter should dispatch the row's existing click so the user jumps
        // to the parent project via the same path the mouse uses.
        expect(body).toMatch(/currentRow\.click\(\s*\)/);
    });

    it('Calendar: walks .calendarCell elements inside #calendarGrid', () => {
        const body = extractViewArrowHandler();
        expect(body).toMatch(/getElementById\(\s*['"]calendarGrid['"]\s*\)/);
        expect(body).toMatch(/\.calendarCell/);
    });

    it('Calendar: arrow stride is ±1 for left/right and ±7 for up/down', () => {
        const body = extractViewArrowHandler();
        // The 7-column grid stride is the load-bearing invariant — pinning
        // a literal `7` keeps a future renderer change from silently
        // breaking the up/down step.
        expect(body).toMatch(/idx\s*-\s*1/);
        expect(body).toMatch(/idx\s*\+\s*1/);
        expect(body).toMatch(/idx\s*-\s*7/);
        expect(body).toMatch(/idx\s*\+\s*7/);
    });

    it('Calendar: clamps at the rendered range — no auto-advance to other months', () => {
        const body = extractViewArrowHandler();
        // Left/Right clamp at 0 and cells.length - 1. Up/Down stay put when
        // a ±7 jump would leave the grid (the `(idx - 7) >= 0 ? ... : idx`
        // and `(idx + 7) < cells.length ? ... : idx` patterns).
        expect(body).toMatch(/Math\.max\(\s*idx\s*-\s*1\s*,\s*0\s*\)/);
        expect(body).toMatch(/Math\.min\(\s*idx\s*\+\s*1\s*,\s*cells\.length\s*-\s*1\s*\)/);
        expect(body).toMatch(/idx\s*-\s*7[\s\S]{0,40}>=?\s*0/);
        expect(body).toMatch(/idx\s*\+\s*7[\s\S]{0,40}<\s*cells\.length/);
    });

    it('Calendar: Enter on a focused cell fires its click handler', () => {
        const body = extractViewArrowHandler();
        expect(body).toMatch(/currentCell\.click\(\s*\)/);
    });

    it('preventDefault is called so the arrow keys do not also scroll the page', () => {
        const body = extractViewArrowHandler();
        const matches = body.match(/preventDefault\(\s*\)/g) || [];
        // At least one preventDefault in each of the Today-arrow / Calendar-
        // arrow / Today-Enter / Calendar-Enter branches → expect ≥ 3.
        expect(matches.length).toBeGreaterThanOrEqual(3);
    });

    it('the existing Projects-view arrow-nav handler is gated to projects view', () => {
        // The legacy Up/Down/Enter/Delete handler that drives #toDoChild
        // navigation must bail when view !== 'projects'; otherwise it would
        // grab focus on Today / Calendar and yank it back to a stale
        // .todo-active row in the hidden #mainList.
        const re = /document\.addEventListener\(\s*['"]keydown['"]\s*,\s*function\s*\([^)]*\)\s*\{/g;
        let match;
        let found = false;
        while ((match = re.exec(main)) !== null) {
            const bodyStart = match.index + match[0].length - 1;
            let depth = 0;
            for (let i = bodyStart; i < main.length; i++) {
                const c = main[i];
                if (c === '{') depth++;
                else if (c === '}') {
                    depth--;
                    if (depth === 0) {
                        const body = main.slice(bodyStart + 1, i);
                        if (/isArrowDown/.test(body) && /closeButtonToDo/.test(body)) {
                            expect(body).toMatch(/getActiveView\(\s*\)\s*!==\s*['"]projects['"]/);
                            found = true;
                        }
                        break;
                    }
                }
            }
        }
        if (!found) throw new Error('legacy todo arrow-nav handler not located');
    });

    it('the cross-pane ArrowLeft/ArrowRight handler is gated to projects view', () => {
        // ArrowLeft / ArrowRight on Calendar must reach the grid-traversal
        // branch above, not the cross-pane focus shortcut that moves focus
        // to a project rail icon or the new-task input.
        const re = /document\.addEventListener\(\s*['"]keydown['"]\s*,\s*function\s*\([^)]*\)\s*\{/g;
        let match;
        let found = false;
        while ((match = re.exec(main)) !== null) {
            const bodyStart = match.index + match[0].length - 1;
            let depth = 0;
            for (let i = bodyStart; i < main.length; i++) {
                const c = main[i];
                if (c === '{') depth++;
                else if (c === '}') {
                    depth--;
                    if (depth === 0) {
                        const body = main.slice(bodyStart + 1, i);
                        if (/focusBlankToDoInput/.test(body) && /#projChild\.selectedProject/.test(body)) {
                            expect(body).toMatch(/getActiveView\(\s*\)\s*!==\s*['"]projects['"]/);
                            found = true;
                        }
                        break;
                    }
                }
            }
        }
        if (!found) throw new Error('cross-pane ArrowLeft/Right handler not located');
    });
});
