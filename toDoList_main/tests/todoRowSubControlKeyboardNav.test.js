import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for keyboard navigation WITHIN a single committed todo
// row. Tab must reach every sub-control in visual order: checkbox → title →
// date pill → expand caret → delete X (and description after delete X when
// the row is expanded). Enter on each sub-control fires its primary action
// without yanking focus to the title input. Backspace inside the open due-
// date popover closes it without applying a date.
describe('todo row sub-control keyboard navigation', () => {
    const toDoRow = read('toDoRow.js');
    const main    = read('main.js');
    const dueDate = read('dueDate.js');

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

    it('descToggle gets tabindex="0" and a button role so the expand caret is keyboard-reachable', () => {
        // The caret is a <div>, which isn't natively focusable. tabindex="0"
        // puts it in the tab order; role="button" makes assistive tech
        // announce it correctly. Hidden placeholder rows skip it via
        // display:none, so we don't need a separate placeholder branch.
        const fn = extractFunction(toDoRow, 'export function buildToDoRow(');
        expect(fn).toMatch(/descToggle\.setAttribute\(\s*["']tabindex["']\s*,\s*["']0["']\s*\)/);
        expect(fn).toMatch(/descToggle\.setAttribute\(\s*["']role["']\s*,\s*["']button["']\s*\)/);
    });

    it('closeButtonToDo gets tabindex="0" and a button role so the delete X is keyboard-reachable', () => {
        const fn = extractFunction(toDoRow, 'export function buildToDoRow(');
        expect(fn).toMatch(/closeButtonToDo\.setAttribute\(\s*["']tabindex["']\s*,\s*["']0["']\s*\)/);
        expect(fn).toMatch(/closeButtonToDo\.setAttribute\(\s*["']role["']\s*,\s*["']button["']\s*\)/);
    });

    it('checkbox toggles on Enter via a dispatched change event so the existing change handler still persists', () => {
        // Browsers toggle checkboxes on Space but NOT on Enter. Without an
        // explicit handler, tabbing to the checkbox and pressing Enter is a
        // dead key — breaks the "Enter activates every focused sub-control"
        // contract. Dispatching change (rather than click) routes through
        // the same persistence + reorder path the mouse path uses.
        const fn = extractFunction(toDoRow, 'export function buildToDoRow(');
        // The Enter handler lives at the buildToDoRow level (after wireCheckbox
        // returns the checkbox) so the wireCheckbox helper itself stays compact.
        expect(fn).toMatch(/checkToDo\.addEventListener\(\s*["']keydown["']/);
        const handler = fn.slice(fn.indexOf("checkToDo.addEventListener(\"keydown\""));
        expect(handler).toMatch(/event\.key\s*!==\s*["']Enter["']/);
        expect(handler).toMatch(/checkToDo\.checked\s*=\s*!checkToDo\.checked/);
        expect(handler).toMatch(/dispatchEvent\(\s*new Event\(\s*["']change["']/);
    });

    it('descToggle Enter routes through its existing click handler', () => {
        // Reusing click() rather than duplicating the expand/collapse logic
        // keeps the keyboard path in lockstep with the mouse path — any
        // future tweak to the toggle's click handler automatically applies
        // to keyboard users too.
        const fn = extractFunction(toDoRow, 'function wireDescToggle(');
        expect(fn).toMatch(/descToggle\.addEventListener\(\s*["']keydown["']/);
        const handler = fn.slice(fn.indexOf("descToggle.addEventListener(\"keydown\""));
        expect(handler).toMatch(/event\.key\s*!==\s*["']Enter["']/);
        expect(handler).toMatch(/descToggle\.click\(\s*\)/);
        expect(handler).toMatch(/preventDefault\(\s*\)/);
    });

    it('closeButtonToDo Enter routes through its existing click handler so the delete confirmation still fires', () => {
        // The close button's click handler routes through showConfirmModal,
        // so reusing click() (rather than calling listLogic.removeToDoByItem
        // directly) keeps the keyboard delete behind the same confirmation
        // gate as the mouse delete.
        const fn = extractFunction(toDoRow, 'export function buildToDoRow(');
        expect(fn).toMatch(/closeButtonToDo\.addEventListener\(\s*["']keydown["']/);
        const handler = fn.slice(fn.lastIndexOf("closeButtonToDo.addEventListener(\"keydown\""));
        expect(handler).toMatch(/event\.key\s*!==\s*["']Enter["']/);
        expect(handler).toMatch(/closeButtonToDo\.click\(\s*\)/);
    });

    it('Escape on the title input restores the value captured at last focus', () => {
        // Inline-edit cancel pattern: Escape reverts the in-flight edit so
        // the user has a quick out without having to manually retype the
        // previous value or click away to trigger snap-back.
        const fn = extractFunction(toDoRow, 'export function buildToDoRow(');
        const idx = fn.indexOf('toDoInput.addEventListener("keydown"');
        // Two keydown handlers on toDoInput (Enter commit + Escape cancel)
        // — find the one that branches on Escape.
        const escapeHandler = fn.slice(fn.indexOf('event.key !== "Escape"'));
        expect(escapeHandler).toMatch(/toDoInput\.value\s*=\s*savedTitle/);
        expect(escapeHandler).toMatch(/toDoInput\.blur\(\s*\)/);
        expect(idx).toBeGreaterThan(-1);
    });

    it('Escape on the description input restores the value captured at last focus', () => {
        const fn = extractFunction(toDoRow, 'export function buildToDoRow(');
        const escapeBlock = fn.slice(fn.lastIndexOf('descInput.addEventListener("keydown"'));
        expect(escapeBlock).toMatch(/event\.key\s*!==\s*["']Escape["']/);
        expect(escapeBlock).toMatch(/descInput\.value\s*=\s*savedDesc/);
        expect(escapeBlock).toMatch(/descInput\.blur\(\s*\)/);
    });

    it('the document-level Enter handler bails when focus is on a sub-control rather than the row itself', () => {
        // The arrow-nav handler focuses the row element (tabindex=-1) so
        // the user is in nav mode. Enter from there hands focus to the
        // title input (existing behavior). When focus is on a sub-control
        // — the due pill button, the new tabindex divs, the checkbox —
        // Enter must NOT also fire the row-to-input handler; otherwise
        // pressing Enter on the due pill steals focus to the title and
        // suppresses the popover's own button-Enter behavior.
        const re = /document\.addEventListener\(\s*['"]keydown['"]\s*,\s*function\s*\([^)]*\)\s*\{/g;
        let arrowNavBody = null;
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
                        if (/ArrowDown/.test(body) && /focusedTodoRow/.test(body)) {
                            arrowNavBody = body;
                        }
                        break;
                    }
                }
            }
        }
        expect(arrowNavBody).not.toBeNull();
        // Find the Enter branch and check the ae-must-equal-row guard.
        const enterIdx = arrowNavBody.indexOf('isEnter');
        expect(enterIdx).toBeGreaterThan(-1);
        const enterBlock = arrowNavBody.slice(arrowNavBody.indexOf('if (isEnter)'));
        expect(enterBlock).toMatch(/ae\s*!==\s*focusedTodoRow/);
    });

    it('Backspace inside the open due-date popover closes it without modifying the date', () => {
        // The popover keydown handler runs in capture phase so it sees the
        // keystroke before any other listener. Backspace must close the
        // popover via hideDueDatePopover (which doesn't write item.due —
        // only an explicit cell click does), so cancel-by-Backspace ends
        // with the same date as before the popover was opened.
        const fn = extractFunction(dueDate, 'function onDuePopoverKeydown(');
        expect(fn).toMatch(/event\.key\s*===\s*["']Backspace["']/);
        const branch = fn.slice(fn.indexOf("event.key === 'Backspace'"));
        expect(branch).toMatch(/hideDueDatePopover\(\s*\)/);
        expect(branch).toMatch(/preventDefault\(\s*\)/);
        expect(branch).toMatch(/stopPropagation\(\s*\)/);
    });

    it('the popover Backspace branch skips when focus is in an editable control inside the popover', () => {
        // Without this guard, Backspace inside the interval number input or
        // the end-date input would close the popover instead of deleting a
        // character — a clear regression in the date-editing flow.
        const fn = extractFunction(dueDate, 'function onDuePopoverKeydown(');
        const branch = fn.slice(fn.indexOf("event.key === 'Backspace'"));
        expect(branch).toMatch(/INPUT/);
        expect(branch).toMatch(/SELECT/);
    });

    it('the popover Backspace handler does not hijack Backspace when no popover is open', () => {
        // hideDueDatePopover is called only when the popover element exists,
        // and the early-return guard at the top of the handler bails when
        // it doesn't. This keeps Backspace's normal browser meaning intact
        // outside the popover.
        const fn = extractFunction(dueDate, 'function onDuePopoverKeydown(');
        // The early `if (!popover) return;` guards every key path, including
        // Backspace, so popover-less Backspace presses fall through to the
        // browser's default behavior.
        expect(fn).toMatch(/if\s*\(\s*!popover\s*\)\s*return/);
    });
});
