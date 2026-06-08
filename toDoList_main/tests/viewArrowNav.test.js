import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for keyboard navigation on the Inbox and Calendar
// views. The two dashboards share a single global keydown listener that
// branches off #mainBar's data-view attribute:
//   • Inbox    — ArrowUp/Down walk .todayRow.todoRowCard rows in
//                #inboxSections (no wrap, clamp). Enter on a focused row
//                fires the row click (jump to project). (The .todayRow
//                class is the shared task-row card, also used by the
//                Calendar day-detail panel.)
//   • Calendar — .calendarCell elements in #calendarGrid form a 7-column
//                grid. Left/Right ±1 cell, Up/Down ±7 cells (clamp, no
//                auto-advance across months). Enter fires the cell click.
// Guards mirror the Projects-view handler: skip on modifier keys, when a
// modal/popover is open, and when focus is in an editable surface
// outside the navigable region.
describe('view-aware arrow-key navigation — Inbox and Calendar', () => {
    const main = read('main.js');

    // Extract the Inbox/Calendar handler by its distinguishing pattern:
    // branches on data-view === 'inbox' / 'calendar' and uses the
    // calendarGrid + inboxSections containers.
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
                        if (/inboxSections/.test(body) && /calendarGrid/.test(body) && /['"]inbox['"]/.test(body) && /['"]calendar['"]/.test(body)) {
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
        // browser tab order. Pinned at the buildTodayRow site, which lives
        // in calendarView.js (extracted from main.js).
        const calendar = read('calendarView.js');
        const buildRowRegion = calendar.slice(calendar.indexOf('function buildTodayRow'));
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

    it('branches off #mainBar data-view (inbox vs calendar)', () => {
        const body = extractViewArrowHandler();
        expect(body).toMatch(/getElementById\(\s*['"]mainBar['"]\s*\)/);
        expect(body).toMatch(/getAttribute\(\s*['"]data-view['"]\s*\)/);
        expect(body).toMatch(/['"]inbox['"]/);
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

    it('Inbox: walks .todayRow.todoRowCard rows inside #inboxSections', () => {
        const body = extractViewArrowHandler();
        expect(body).toMatch(/getElementById\(\s*['"]inboxSections['"]\s*\)/);
        expect(body).toMatch(/\.todayRow\.todoRowCard/);
    });

    it('Inbox: clamps row navigation at the boundaries (no wrap)', () => {
        const body = extractViewArrowHandler();
        // Up: Math.max(idx - 1, 0); Down: Math.min(idx + 1, rows.length - 1).
        expect(body).toMatch(/Math\.max\(\s*idx\s*-\s*1\s*,\s*0\s*\)/);
        expect(body).toMatch(/Math\.min\(\s*idx\s*\+\s*1\s*,\s*rows\.length\s*-\s*1\s*\)/);
    });

    it('Inbox: Enter on a focused row fires its click handler', () => {
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

    it('Calendar day-detail panel: ArrowUp/Down walk .todayRow.todoRowCard rows inside #calendarDayList', () => {
        // Mirrors the Today view's row-walk branch but scoped to the
        // day-detail panel. Without this branch, ArrowDown on a focused
        // panel row was a no-op — the handler only knew the panel→grid
        // ArrowUp boundary, so users were stranded on the first row.
        const body = extractViewArrowHandler();
        expect(body).toMatch(/getElementById\(\s*['"]calendarDayList['"]\s*\)/);
        // The walk operates on the full list of panel rows, not just the
        // first one, so the indexed step works for any current row.
        expect(body).toMatch(/querySelectorAll\(\s*['"]\.todayRow\.todoRowCard['"]\s*\)/);
    });

    it('Calendar day-detail panel: row walk clamps at the ends (no wrap)', () => {
        const body = extractViewArrowHandler();
        // Down clamps at panelRows.length - 1, Up clamps at 0. Pinning the
        // panelRows reference keeps a future variable rename from silently
        // changing the clamp target.
        expect(body).toMatch(/Math\.min\(\s*idx\s*\+\s*1\s*,\s*panelRows\.length\s*-\s*1\s*\)/);
        expect(body).toMatch(/Math\.max\(\s*idx\s*-\s*1\s*,\s*0\s*\)/);
    });

    it('Calendar day-detail panel: Enter on a focused row fires the row click (jump to project)', () => {
        const body = extractViewArrowHandler();
        // Same contract as Today's Enter: the row click handler is the
        // jump-to-project path the mouse uses, so reusing it keeps the
        // keyboard and pointer flows in lockstep.
        expect(body).toMatch(/panelRow\.click\(\s*\)/);
    });

    it('Calendar day-detail panel: descendant focus anchors to the row container with .todo-active', () => {
        // When focus is on a sub-control of a panel row (e.g., the
        // .todayRowTitle button), the next ArrowUp/Down anchors to the
        // row div with .todo-active before walking — the same nav-mode
        // contract Today's row branch provides.
        const body = extractViewArrowHandler();
        // The anchor branch lives in the day-detail block (panelRow + dayList).
        expect(body).toMatch(/ae\s*!==\s*panelRow/);
        // The same .todo-active class committed Projects/Today rows use.
        expect(body).toMatch(/classList\.add\(\s*['"]todo-active['"]\s*\)/);
        expect(body).toMatch(/panelRow\.focus\(\s*\)/);
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
