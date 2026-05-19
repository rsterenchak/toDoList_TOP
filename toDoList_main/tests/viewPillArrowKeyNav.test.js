import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the ArrowDown / ArrowUp boundary between the three
// view-switcher pills (PROJECTS / TODAY / CALENDAR) and the visible main
// pane below them. Mirrors the sidebarToggle ↔ first-project-row pattern
// so keyboard users can flow vertically out of the header chrome into
// the rendered items without grabbing the mouse:
//   • ArrowDown from any of the three pills drops focus into the visible
//     main pane's first focusable element (placeholder #toDoInput in
//     PROJECTS, first todayRow title in TODAY, first day cell in CALENDAR).
//   • ArrowUp from the blank-placeholder #toDoInput or #emptyStateInput in
//     #mainList escapes back up to the active view pill.
describe('view-pill arrow-key navigation into and out of the main pane', () => {
    const main = read('main.js');

    function extractBlock(signature) {
        const start = main.indexOf(signature);
        if (start === -1) throw new Error('signature not found: ' + signature);
        const bodyStart = main.indexOf('{', start);
        let depth = 0;
        for (let i = bodyStart; i < main.length; i++) {
            const c = main[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return main.slice(bodyStart, i + 1);
            }
        }
        throw new Error('unterminated block for: ' + signature);
    }

    function extractViewPillKeydown() {
        // The handler is wired on all three pills via a shared function;
        // identify it by the inner ArrowDown branch and the call to
        // isAnyModalOrPopoverOpen (both are required guards).
        const re = /function\s+([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{[\s\S]*?ArrowDown[\s\S]*?isAnyModalOrPopoverOpen[\s\S]*?\}/g;
        let match;
        while ((match = re.exec(main)) !== null) {
            const candidate = match[0];
            if (/preventDefault/.test(candidate) && /stopPropagation/.test(candidate)) {
                return { name: match[1], body: candidate };
            }
        }
        throw new Error('view-pill ArrowDown handler not found in main.js');
    }

    function extractTodoArrowNavHandler() {
        // Identify the document-level todo arrow-nav handler by its
        // branching on ArrowUp/ArrowDown plus the committed-rows filter.
        // The sibling ArrowLeft/ArrowRight cross-pane handler doesn't
        // match because it doesn't touch committed/#toDoInput.
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
                        if (/ArrowUp/.test(body) && /ArrowDown/.test(body) && /committed/.test(body)) {
                            return body;
                        }
                        break;
                    }
                }
            }
        }
        throw new Error('todo arrow-nav handler not found in main.js');
    }

    it('wires a keydown listener on viewPillToday that runs the pill-down handler', () => {
        // Without a dedicated handler, the document-level todo arrow-nav
        // handler at best lands focus on a stale .todo-active row and at
        // worst silently no-ops — leaving the rendered items unreachable
        // from the Today pill.
        expect(main).toMatch(/viewPillToday\.addEventListener\(\s*['"]keydown['"]/);
    });

    it('wires a keydown listener on viewPillCalendar that runs the pill-down handler', () => {
        // Mirror of the Today wiring — keyboard users arriving at the
        // Calendar pill via ArrowLeft/ArrowRight need the same vertical
        // drop-in into the visible content beneath.
        expect(main).toMatch(/viewPillCalendar\.addEventListener\(\s*['"]keydown['"]/);
    });

    it('the pill drop-in handler bails on ArrowDown only and ignores modifier-key chords', () => {
        const { body } = extractViewPillKeydown();
        // Unmodified ArrowDown only — Shift/Ctrl/Meta/Alt+Arrow are
        // reserved for native selection and OS-level chords. Other keys
        // (Up/Left/Right/Enter/etc.) must pass through so the sibling
        // handlers (nav ArrowLeft/Right walk, pill click activation) own
        // them.
        expect(body).toMatch(/['"]ArrowDown['"]/);
        expect(body).toMatch(/ctrlKey/);
        expect(body).toMatch(/metaKey/);
        expect(body).toMatch(/altKey/);
        expect(body).toMatch(/shiftKey/);
    });

    it('the pill drop-in handler bails when any modal or popover is open', () => {
        const { body } = extractViewPillKeydown();
        // While a popover/modal is open, the in-popover focus management
        // owns the keystrokes — same gate the sidebarToggle and nav
        // handlers already use.
        expect(body).toMatch(/isAnyModalOrPopoverOpen\(\s*\)/);
    });

    it('the pill drop-in handler stops propagation so the document arrow handler does not also fire', () => {
        const { body } = extractViewPillKeydown();
        // Without stopPropagation, the document-level todo arrow-nav
        // handler would also fire and clobber the focus we just placed
        // (e.g., jumping to a stale .todo-active row or to committed
        // rows even in TODAY view where mainList is hidden).
        expect(body).toMatch(/stopPropagation\(\s*\)/);
        expect(body).toMatch(/preventDefault\(\s*\)/);
    });

    it('the pill drop-in handler picks its target from the active view', () => {
        const { body, name } = extractViewPillKeydown();
        // Resolving the target via getActiveView() means the pill ArrowDown
        // lands on whichever surface is currently visible — placeholder
        // input in PROJECTS, first today row in TODAY, first day cell in
        // CALENDAR. A view-agnostic mainList target would drop focus on a
        // hidden node when TODAY or CALENDAR is the active view.
        // The handler delegates to a helper that consults getActiveView().
        // Search both the immediate body and the surrounding source for
        // the active-view-aware target selection (the helper is module-
        // scope so a separate function call from the handler is allowed).
        const usesGetActiveView = /getActiveView\(\s*\)/.test(body) ||
            new RegExp(name + '[\\s\\S]{0,4000}getActiveView\\(\\s*\\)').test(main) ||
            /firstFocusableInActiveMainView/.test(main);
        expect(usesGetActiveView).toBe(true);
    });

    it('the pill drop-in target includes the blank-placeholder #toDoInput in #mainList for PROJECTS', () => {
        // The blank placeholder at the top of #mainList is the canonical
        // "first focusable" of the projects view — same target that
        // ArrowUp from the first committed row already lands on. The
        // pill ArrowDown must reach the same node so the entry path
        // and the intra-list ArrowUp path agree on what "first row"
        // means.
        const usesPlaceholder = /querySelector\(\s*['"]#emptyStateInput['"]/.test(main) &&
            /['"]#addGlyph['"]/.test(main) &&
            /['"]#toDoInput['"]/.test(main);
        expect(usesPlaceholder).toBe(true);
    });

    it('document arrow-nav handler escapes ArrowUp from the placeholder / empty-state input to a .viewPill.active', () => {
        const body = extractTodoArrowNavHandler();
        // Mirrors the ArrowDown drop-in wired on each pill. Without this
        // escape the user has no way to return to the header chrome from
        // the new-task input without clicking — pressing ArrowUp from
        // the placeholder currently falls through to the committed-list
        // logic and jumps to the last committed row, which is the wrong
        // direction.
        expect(body).toMatch(/viewPill\.active|\.viewPill\.active/);
        expect(body).toMatch(/['"]#emptyStateInput['"]|emptyStateInput/);
    });

    it('the placeholder ArrowUp escape preventDefaults and stops propagation', () => {
        const body = extractTodoArrowNavHandler();
        const idx = body.indexOf('viewPill.active');
        expect(idx).toBeGreaterThan(-1);
        const window = body.slice(idx, Math.min(body.length, idx + 400));
        // Without preventDefault, the keystroke would still scroll the
        // page on browsers that bind ArrowUp to page-scroll when the
        // active element is not scrollable. Without stopPropagation, the
        // page-level arrow handlers would re-fire and could yank focus.
        expect(window).toMatch(/preventDefault\(\s*\)/);
        expect(window).toMatch(/stopPropagation\(\s*\)/);
    });
});
