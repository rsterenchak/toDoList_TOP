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

});
