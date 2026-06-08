import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for keyboard navigation between committed todo rows in
// the active project. Up/Down move focus between committed rows (no wrap),
// Enter on the focused row enters edit mode by focusing the title input,
// and Delete fires the same showConfirmModal flow as the row's `×` button.
// The blank placeholder row at index 0 is reachable via `n` and direct click,
// so arrow-nav is for committed rows only. Guards mirror the existing `n`
// shortcut: skip when typing in non-todo inputs and when any modal/popover
// is open.
describe('todo row keyboard navigation — Up/Down/Enter/Delete', () => {
    const main = read('main.js');
    const toDoRow = read('toDoRow.js');
    const modals = read('modals.js');

    function extractArrowNavHandler() {
        // The arrow-nav handler is identifiable by branching on ArrowDown.
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
                        if (/ArrowDown/.test(body)) return body;
                        break;
                    }
                }
            }
        }
        throw new Error('arrow-nav keydown handler not found in main.js');
    }

    it('committed rows receive tabindex so they can be focused for keyboard nav', () => {
        // The row element itself must be programmatically focusable so the
        // arrow-nav handler can hand it focus without putting it in the
        // browser tab order.
        expect(toDoRow).toMatch(/toDoChild\.setAttribute\(\s*["']tabindex["']\s*,\s*["']-1["']\s*\)/);
    });

    it('wires a global keydown listener that handles ArrowUp, ArrowDown, Enter, and Delete', () => {
        const body = extractArrowNavHandler();
        expect(body).toMatch(/['"]ArrowUp['"]/);
        expect(body).toMatch(/['"]ArrowDown['"]/);
        expect(body).toMatch(/['"]Enter['"]/);
        expect(body).toMatch(/['"]Delete['"]/);
    });

    it('skips when modifier keys are involved or any modal/popover is open', () => {
        const body = extractArrowNavHandler();
        expect(body).toMatch(/ctrlKey/);
        expect(body).toMatch(/metaKey/);
        expect(body).toMatch(/altKey/);
        expect(body).toMatch(/isAnyModalOrPopoverOpen\(\s*\)/);
    });

    it('skips when the user is typing in a non-todo input surface', () => {
        const body = extractArrowNavHandler();
        // Same input-guard primitives as the `n` and `?` shortcuts.
        expect(body).toMatch(/['"]INPUT['"]/);
        expect(body).toMatch(/['"]TEXTAREA['"]/);
        expect(body).toMatch(/isContentEditable/);
        // Arrow keys still work when focus is in a #toDoInput so the user
        // can navigate rows mid-edit; Enter and Delete defer to the input's
        // own keydown handlers in that state.
        expect(body).toMatch(/toDoInput/);
    });

    it('only navigates between committed rows — the blank placeholder is skipped', () => {
        const body = extractArrowNavHandler();
        // Filter rows by non-empty input value so the index-0 blank placeholder
        // is excluded from the navigation set.
        expect(body).toMatch(/value\.trim\(\s*\)\.length\s*>\s*0/);
    });

    it('clamps at boundaries instead of wrapping', () => {
        const body = extractArrowNavHandler();
        // Up: Math.max(idx - 1, 0); Down: Math.min(idx + 1, committed.length - 1).
        expect(body).toMatch(/Math\.max\(\s*idx\s*-\s*1\s*,\s*0\s*\)/);
        expect(body).toMatch(/Math\.min\(\s*idx\s*\+\s*1/);
    });

    it('marks the navigated-to row with .todo-active and focuses it', () => {
        const body = extractArrowNavHandler();
        // .todo-active is the existing class shared with click-to-edit so the
        // visual state stays consistent with the rest of the app.
        expect(body).toMatch(/classList\.add\(\s*['"]todo-active['"]\s*\)/);
        expect(body).toMatch(/classList\.remove\(\s*['"]todo-active['"]\s*\)/);
        // The row itself is focused (tabindex="-1"), not its input — the user
        // is in nav mode, not edit mode.
        expect(body).toMatch(/target\.focus\(\s*\)/);
    });

    it('Enter on the focused row hands focus to the input with the caret at the end', () => {
        const body = extractArrowNavHandler();
        // Find the Enter branch and check it focuses the input + sets selection
        // to the end of the value (caret at end, not text-selected).
        expect(body).toMatch(/input\.focus\(\s*\)/);
        expect(body).toMatch(/setSelectionRange\(\s*end\s*,\s*end\s*\)/);
    });

    it('Delete on the focused row triggers the close button click (confirm-then-delete flow)', () => {
        const body = extractArrowNavHandler();
        // Reusing closeButtonToDo's click handler routes through showConfirmModal
        // so destructive deletes still get a confirmation step.
        expect(body).toMatch(/closeButtonToDo/);
        expect(body).toMatch(/closeBtn\.click\(\s*\)/);
    });

    it('preventDefault is called so the keystroke does not also act on whatever was focused', () => {
        const body = extractArrowNavHandler();
        expect(body).toMatch(/preventDefault\(\s*\)/);
    });

    it('shortcuts modal documents the new arrow nav, Enter, and Delete bindings', () => {
        // The modal is the single source of truth for what the keyboard does;
        // adding bindings without listing them defeats the purpose.
        expect(modals).toMatch(/keys:\s*\[\s*['"]↑['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]↓['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]Delete['"]\s*\]/);
    });

    // Reaches into the SECOND global keydown handler — the view-aware one
    // that branches off #mainBar's data-view for Inbox / Calendar. Identified
    // by referencing both #inboxSections and #calendarGrid; distinct from
    // the Projects-view handler above.
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
                        if (/inboxSections/.test(body) && /calendarGrid/.test(body)) {
                            return body;
                        }
                        break;
                    }
                }
            }
        }
        throw new Error('view-aware arrow-nav keydown handler not found in main.js');
    }

    it('Today: ArrowUp/Down on a descendant of a row anchors focus to the row div with .todo-active', () => {
        // When the user is on a sub-control of a today row (e.g., the
        // .todayRowTitle <button> that lands focus when the user drops in
        // from the TODAY pill), the next ArrowUp/Down must redirect focus
        // to the row container itself with .todo-active applied — the
        // same nav-mode behavior committed Projects-view rows have. The
        // title button stays reachable via Enter or Tab, but isn't the
        // default ArrowDown landing spot.
        const body = extractViewArrowHandler();
        // Detects descendant: ae !== currentRow inside the Today branch.
        expect(body).toMatch(/ae\s*!==\s*currentRow/);
        // Applies the same nav-mode class committed Projects-view rows use,
        // and clears stale instances from siblings.
        expect(body).toMatch(/classList\.add\(\s*['"]todo-active['"]\s*\)/);
        expect(body).toMatch(/classList\.remove\(\s*['"]todo-active['"]\s*\)/);
        // The row container is focused (not the descendant) — nav mode,
        // not edit mode.
        expect(body).toMatch(/currentRow\.focus\(\s*\)/);
    });

    it('Calendar: ArrowDown off the last grid row jumps into the first day-detail row', () => {
        // The Calendar grid clamps ±7 moves to the rendered range, so
        // ArrowDown from the last row used to do nothing even though
        // #calendarDayList contains focusable .todayRow.todoRowCard
        // children just below the grid. The boundary check computes
        // "last row" from grid.children.length so a 5-row month and a
        // 6-row month behave identically, and treats outOfMonth cells in
        // the trailing row the same as in-month cells.
        const body = extractViewArrowHandler();
        // "Last row" is computed from totalCells, not from cells.length —
        // the rule must use the full grid child count so the trailing
        // outOfMonth cells participate in the boundary.
        expect(body).toMatch(/grid\.children\.length/);
        // idx >= totalCells - 7 is the explicit last-row predicate.
        expect(body).toMatch(/idx\s*>=\s*totalCells\s*-\s*7/);
        // The landing target is the first .todayRow.todoRowCard inside
        // #calendarDayList; querySelector returns the first match.
        expect(body).toMatch(/getElementById\(\s*['"]calendarDayList['"]\s*\)/);
        expect(body).toMatch(/querySelector\(\s*['"]\.todayRow\.todoRowCard['"]\s*\)/);
        // Both transitions preventDefault and stopPropagation.
        expect(body).toMatch(/firstPanelRow\.focus\(\s*\)/);
    });

    it('Calendar: ArrowUp from the first day-detail row jumps back to a calendar cell', () => {
        // Mirrors the grid→panel ArrowDown above. The fallback chain for
        // picking the landing cell — calendarSelectedKey → today key →
        // last cell — matches the post-rebuild re-focus logic in
        // renderCalendarView so a freshly-loaded calendar with no prior
        // selection still lands on a visible day.
        const body = extractViewArrowHandler();
        // The selected key is read through the getCalendarSelectedKey()
        // accessor exported by calendarView.js (the calendar state moved
        // out of main.js).
        expect(body).toMatch(/getCalendarSelectedKey\(\s*\)/);
        // Today-key fallback uses the existing formatCalendarKeyForDate helper.
        expect(body).toMatch(/formatCalendarKeyForDate\(\s*new Date\(\s*\)\s*\)/);
        // Last-cell fallback so the cold-start case never strands focus.
        expect(body).toMatch(/cells\[\s*cells\.length\s*-\s*1\s*\]/);
        // The boundary only fires when the active element is the FIRST
        // panel row — subsequent rows would be served by row-nav between
        // them, which is a separate concern.
        expect(body).toMatch(/panelRow\s*===\s*panelRows\[\s*0\s*\]/);
    });
});
