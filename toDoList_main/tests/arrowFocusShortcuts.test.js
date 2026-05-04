import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the cross-pane focus shortcuts that replaced the
// retired `\` toggle and `Ctrl+\` chord. ArrowLeft jumps focus to the
// active project's rail icon; ArrowRight jumps focus to the visible new-
// task input. Both bindings ignore the keystroke when focus is already in
// an editable input/textarea/contentEditable, so the arrow keys still move
// the caret while the user is typing.
describe('cross-pane focus shortcuts — ArrowLeft / ArrowRight', () => {
    const main = read('main.js');
    const modals = read('modals.js');

    function extractArrowFocusHandler() {
        // Identify the handler by its branching on both ArrowLeft and
        // ArrowRight (the existing arrow-nav handler in todoRowKeyboardNav
        // branches on ArrowUp/ArrowDown, so the two are disjoint).
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
                        if (/ArrowLeft/.test(body) && /ArrowRight/.test(body)) return body;
                        break;
                    }
                }
            }
        }
        throw new Error('arrow-focus keydown handler not found in main.js');
    }

    it('wires a global keydown listener that handles ArrowLeft and ArrowRight', () => {
        const body = extractArrowFocusHandler();
        expect(body).toMatch(/['"]ArrowLeft['"]/);
        expect(body).toMatch(/['"]ArrowRight['"]/);
    });

    it('skips when modifier keys are involved or any modal/popover is open', () => {
        const body = extractArrowFocusHandler();
        // The shortcut is unmodified arrow keys only — chords like
        // Shift+Arrow (text selection) and Ctrl+Arrow (word jumps) must
        // pass through untouched.
        expect(body).toMatch(/ctrlKey/);
        expect(body).toMatch(/metaKey/);
        expect(body).toMatch(/altKey/);
        expect(body).toMatch(/shiftKey/);
        expect(body).toMatch(/isAnyModalOrPopoverOpen\(\s*\)/);
    });

    it('skips when focus is inside any editable input, textarea, or contentEditable', () => {
        const body = extractArrowFocusHandler();
        // Same input-guard primitives as the `n` / `?` shortcuts. The arrow
        // keys must continue to move the caret while the user is typing.
        expect(body).toMatch(/['"]INPUT['"]/);
        expect(body).toMatch(/['"]TEXTAREA['"]/);
        expect(body).toMatch(/isContentEditable/);
    });

    it('ArrowLeft focuses the active project rail icon (or the first project as a fallback)', () => {
        const body = extractArrowFocusHandler();
        // Prefer the selected project; fall back to the first project so the
        // shortcut still works on a fresh load before any selection.
        expect(body).toMatch(/#projChild\.selectedProject/);
        expect(body).toMatch(/#projChild/);
        expect(body).toMatch(/target\.focus\(\s*\)/);
    });

    it('ArrowRight routes through focusBlankToDoInput so the visible task input wins', () => {
        const body = extractArrowFocusHandler();
        // focusBlankToDoInput prefers `#emptyStateInput` when the project is
        // empty and falls back to the placeholder `#toDoInput` otherwise, so
        // routing through it picks the correct surface in both states.
        expect(body).toMatch(/focusBlankToDoInput\(\s*\)/);
        expect(main).toMatch(/import\s*\{[\s\S]*?focusBlankToDoInput\b[\s\S]*?\}\s*from\s*['"]\.\/toDoRow\.js['"]/);
    });

    it('preventDefault is called on each branch so the caret-move default does not also fire', () => {
        const body = extractArrowFocusHandler();
        // Both ArrowLeft and ArrowRight branches preventDefault — when focus
        // is on the body or a tabindex=0/-1 element the default would do
        // nothing useful, but a focused #toDoChild or #projChild should not
        // also scroll the page.
        const matches = body.match(/preventDefault\(\s*\)/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('the help modal documents the new ArrowLeft / ArrowRight bindings', () => {
        // The modal is the single source of truth for what the keyboard
        // does; adding bindings without listing them defeats the purpose.
        expect(modals).toMatch(/keys:\s*\[\s*['"]←['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]→['"]\s*\]/);
    });
});
