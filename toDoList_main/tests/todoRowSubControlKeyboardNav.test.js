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

    // ── Backspace-as-exit on row sub-controls ──
    // Keyboard users who Tab into a row's chrome (checkbox, due pill,
    // expand caret, stats caret, delete X) get a one-key way to back out
    // of inner chrome and return to row-level nav mode (focus on the row
    // itself, .todo-active set) — so the next ArrowUp/ArrowDown moves
    // between rows without first dropping into title-editing mode.
    describe('Backspace-as-exit on row sub-controls', () => {
        it('defines a shared wireSubControlBackspaceExit helper', () => {
            // A single helper keeps the contract uniform across all five
            // sub-controls — any future tweak to the exit behavior
            // applies everywhere at once. The toDoInput parameter was
            // dropped when the contract changed from focus-input to
            // focus-row, so the signature is (subControl, toDoChild).
            expect(toDoRow).toMatch(
                /function\s+wireSubControlBackspaceExit\s*\(\s*subControl\s*,\s*toDoChild\s*\)/
            );
        });

        it('the helper fires only on unmodified Backspace and bounces focus to the row itself in nav mode', () => {
            // Ctrl/Cmd/Alt/Shift+Backspace must fall through so the global
            // Ctrl+Backspace sidebar shortcut still works from a focused
            // sub-control. The handler calls preventDefault to suppress
            // the browser's default "go back" navigation, then focuses
            // the row element (tabindex="-1") and marks it .todo-active
            // so the next ArrowUp/ArrowDown resolves "current row = this
            // row" via the focus-based path in main.js's arrow-nav
            // handler. The title input is NOT focused — the user is in
            // nav mode, not edit mode.
            const fn = extractFunction(toDoRow, 'function wireSubControlBackspaceExit(');
            expect(fn).toMatch(/addEventListener\(\s*['"]keydown['"]/);
            expect(fn).toMatch(/event\.key\s*!==\s*['"]Backspace['"]/);
            expect(fn).toMatch(/event\.ctrlKey\s*\|\|\s*event\.metaKey\s*\|\|\s*event\.altKey\s*\|\|\s*event\.shiftKey/);
            expect(fn).toMatch(/event\.preventDefault\(\s*\)/);
            expect(fn).toMatch(/toDoChild\.focus\(\s*\)/);
            expect(fn).toMatch(/toDoChild\.classList\.add\(\s*['"]todo-active['"]\s*\)/);
            // Strip .todo-active from any other row so the arrow-nav
            // handler's fallback can't resolve to a stale row.
            expect(fn).toMatch(/classList\.remove\(\s*['"]todo-active['"]\s*\)/);
            // The title input is never the focus target — that would
            // drop the user into edit mode, which is the bug this
            // change fixes.
            expect(fn).not.toMatch(/toDoInput\.focus\(\s*\)/);
        });

        it('the helper bails on duePill when the date popover is open so the capture-phase handler owns the keystroke', () => {
            // Belt-and-suspenders: the popover's capture-phase handler calls
            // stopPropagation on Backspace, so this bubble-phase listener
            // never sees the keystroke while the popover is open. The
            // popover-element re-check guards against a future change in
            // listener ordering bouncing focus away mid-edit in the
            // calendar.
            const fn = extractFunction(toDoRow, 'function wireSubControlBackspaceExit(');
            expect(fn).toMatch(/subControl\.id\s*===\s*['"]duePill['"]/);
            expect(fn).toMatch(/document\.getElementById\(\s*['"]dueDatePopover['"]\s*\)/);
        });

        it('the helper skips wiring on blank placeholder rows so we do not pay for unreachable listeners', () => {
            // Chrome is display:none on blank rows (the `!item.tit` branches
            // in buildToDoRow), so the listener could never fire there.
            // The wire-time guard avoids the addEventListener call entirely.
            const fn = extractFunction(toDoRow, 'function wireSubControlBackspaceExit(');
            expect(fn).toMatch(/toDoChild\.dataset\.originalBlank\s*===\s*['"]true['"]/);
            // The guard must be an early return before the addEventListener
            // call — otherwise the listener still attaches.
            const guardIdx = fn.indexOf("toDoChild.dataset.originalBlank === 'true'");
            const addListenerIdx = fn.indexOf('addEventListener');
            expect(guardIdx).toBeGreaterThan(-1);
            expect(addListenerIdx).toBeGreaterThan(guardIdx);
        });

        it('buildToDoRow wires the helper for every sub-control: checkToDo, duePill, statsToggle, closeButtonToDo', () => {
            // All four chrome controls share the same one-key exit. The
            // title input itself is NOT wired — its native Backspace must
            // still delete characters.
            const fn = extractFunction(toDoRow, 'export function buildToDoRow(');
            expect(fn).toMatch(/wireSubControlBackspaceExit\(\s*checkToDo\s*,\s*toDoChild\s*\)/);
            expect(fn).toMatch(/wireSubControlBackspaceExit\(\s*duePill\s*,\s*toDoChild\s*\)/);
            expect(fn).toMatch(/wireSubControlBackspaceExit\(\s*statsToggle\s*,\s*toDoChild\s*\)/);
            expect(fn).toMatch(/wireSubControlBackspaceExit\(\s*closeButtonToDo\s*,\s*toDoChild\s*\)/);
            // toDoInput is never the first argument — wiring Backspace on
            // the title input would steal character-deletion from the
            // user's typing.
            expect(fn).not.toMatch(/wireSubControlBackspaceExit\(\s*toDoInput\s*,/);
        });

        // ── Runtime smoke tests ──
        // Source-grep covers the static contract; these exercise the helper
        // against real DOM nodes to confirm focus actually moves on
        // Backspace and stays put when modifiers or the open popover are
        // present.
        describe('runtime focus behavior', () => {
            let helper;

            beforeAll(async () => {
                // Spin up an in-memory ES module that re-exports the helper.
                // We can't import toDoRow.js directly — it pulls in the full
                // app surface (listLogic, dueDate, modals, companion, …) —
                // so re-derive the helper from source via Function. The
                // source-grep tests above pin the exact body shape, so this
                // mirror can't drift silently.
                const src = read('toDoRow.js');
                const fnStart = src.indexOf('function wireSubControlBackspaceExit(');
                const bodyStart = src.indexOf('{', fnStart);
                let depth = 0;
                let end = -1;
                for (let i = bodyStart; i < src.length; i++) {
                    if (src[i] === '{') depth++;
                    else if (src[i] === '}') {
                        depth--;
                        if (depth === 0) { end = i + 1; break; }
                    }
                }
                const body = src.slice(fnStart, end);
                helper = new Function('document', body + '; return wireSubControlBackspaceExit;')(document);
            });

            beforeEach(() => {
                document.body.innerHTML = '';
                const pop = document.getElementById('dueDatePopover');
                if (pop) pop.remove();
            });

            function buildRow({ blank = false, subId = 'checkToDo', inList = true } = {}) {
                // Real rows live inside #mainList — the helper queries the
                // row's parent to strip stale .todo-active markers from
                // siblings, so we mirror that structure here.
                const mainList = inList ? document.createElement('div') : null;
                if (mainList) {
                    mainList.id = 'mainList';
                    document.body.appendChild(mainList);
                }
                const row = document.createElement('div');
                row.id = 'toDoChild';
                // tabindex="-1" so the row can receive programmatic focus
                // for nav mode — matches the real attribute set in
                // buildToDoRow.
                row.setAttribute('tabindex', '-1');
                if (blank) row.dataset.originalBlank = 'true';
                const input = document.createElement('input');
                input.type = 'text';
                input.id = 'toDoInput';
                const sub = subId === 'checkToDo'
                    ? Object.assign(document.createElement('input'), { type: 'checkbox', id: subId })
                    : Object.assign(document.createElement('div'), { id: subId });
                if (sub.tagName === 'DIV') sub.setAttribute('tabindex', '0');
                row.appendChild(input);
                row.appendChild(sub);
                (mainList || document.body).appendChild(row);
                return { row, input, sub, mainList };
            }

            it('moves focus from a focused sub-control to the row itself in nav mode on Backspace', () => {
                const { sub, row } = buildRow({ subId: 'closeButtonToDo' });
                helper(sub, row);
                sub.focus();
                expect(document.activeElement).toBe(sub);
                const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
                sub.dispatchEvent(ev);
                // The row element itself receives focus — not the input —
                // so the user is in row-level nav mode, ready for
                // ArrowUp / ArrowDown traversal without first having to
                // escape edit mode.
                expect(document.activeElement).toBe(row);
                expect(row.classList.contains('todo-active')).toBe(true);
                expect(ev.defaultPrevented).toBe(true);
            });

            it('strips .todo-active from any other row in the main list before marking this row active', () => {
                // The cleanup pattern mirrors the arrow-nav handler in
                // main.js — leaving a stale .todo-active marker on a
                // different row would let the focus-fallback path resolve
                // the next ArrowDown to the wrong starting position.
                const { sub, row, mainList } = buildRow({ subId: 'descToggle' });
                const stale = document.createElement('div');
                stale.id = 'toDoChild';
                stale.classList.add('todo-active');
                mainList.appendChild(stale);
                helper(sub, row);
                sub.focus();
                const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
                sub.dispatchEvent(ev);
                expect(stale.classList.contains('todo-active')).toBe(false);
                expect(row.classList.contains('todo-active')).toBe(true);
            });

            it('leaves focus alone on Ctrl+Backspace so the global sidebar shortcut still wins', () => {
                const { sub, row } = buildRow({ subId: 'descToggle' });
                helper(sub, row);
                sub.focus();
                const ev = new KeyboardEvent('keydown', {
                    key: 'Backspace', ctrlKey: true, bubbles: true, cancelable: true,
                });
                sub.dispatchEvent(ev);
                expect(document.activeElement).toBe(sub);
                expect(ev.defaultPrevented).toBe(false);
                // The row is NOT marked active when the handler bails —
                // Ctrl+Backspace must look identical to no Backspace at all.
                expect(row.classList.contains('todo-active')).toBe(false);
            });

            it('leaves focus alone on duePill while the date popover is open', () => {
                const { sub, row } = buildRow({ subId: 'duePill' });
                helper(sub, row);
                const popover = document.createElement('div');
                popover.id = 'dueDatePopover';
                document.body.appendChild(popover);
                sub.focus();
                const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
                sub.dispatchEvent(ev);
                expect(document.activeElement).toBe(sub);
                expect(ev.defaultPrevented).toBe(false);
                // No reshuffle of .todo-active either — the capture-phase
                // popover handler owns the keystroke end-to-end.
                expect(row.classList.contains('todo-active')).toBe(false);
            });

            it('still bounces focus from duePill to the row when the popover is NOT open', () => {
                const { sub, row } = buildRow({ subId: 'duePill' });
                helper(sub, row);
                sub.focus();
                const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
                sub.dispatchEvent(ev);
                expect(document.activeElement).toBe(row);
                expect(row.classList.contains('todo-active')).toBe(true);
                expect(ev.defaultPrevented).toBe(true);
            });

            it('attaches no listener on blank placeholder rows (wire-time guard)', () => {
                const { sub, row } = buildRow({ blank: true, subId: 'statsToggle' });
                helper(sub, row);
                sub.focus();
                const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
                sub.dispatchEvent(ev);
                // Focus stays on the sub-control — the wire-time guard
                // skipped the addEventListener call, so the handler never
                // ran to bounce focus.
                expect(document.activeElement).toBe(sub);
                expect(ev.defaultPrevented).toBe(false);
                expect(row.classList.contains('todo-active')).toBe(false);
            });
        });
    });
});
