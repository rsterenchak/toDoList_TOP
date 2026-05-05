import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the fix for the Delete key targeting the first todo when a project
// row is focused. After clicking a project (or arrow-navigating to one in
// the sidebar), Delete must route to the project-deletion confirmation flow
// — same as the project context menu's Delete action — not fall through to
// whichever todo carried the .todo-active class at the time.
//
// The fix lives in the same global keydown handler as the existing arrow /
// Enter / Delete todo-row navigation in main.js.
describe('Delete key — project row vs. todo row routing', () => {
    const main = read('main.js');
    const projectRow = read('projectRow.js');

    function extractArrowNavHandler() {
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
                        if (/ArrowDown/.test(body) && /Delete/.test(body)) return body;
                        break;
                    }
                }
            }
        }
        throw new Error('arrow-nav keydown handler not found in main.js');
    }

    it('projectRow.js exports deleteProjectFlow so main.js can invoke it', () => {
        // The function predates this fix as a private helper — exporting it
        // is what lets the global Delete handler reuse the exact same
        // confirmation-then-delete path the context menu already uses, so
        // the two affordances can never drift in copy or behavior.
        expect(projectRow).toMatch(/export\s+function\s+deleteProjectFlow\b/);
    });

    it('main.js imports deleteProjectFlow from projectRow.js', () => {
        expect(main).toMatch(/import\s*\{[\s\S]*?\bdeleteProjectFlow\b[\s\S]*?\}\s*from\s*['"]\.\/projectRow\.js['"]/);
    });

    it('Delete branch checks for a focused #projChild and routes to deleteProjectFlow', () => {
        const body = extractArrowNavHandler();
        // The handler must walk up from the active element to a project row
        // before deciding it's a todo-deletion event. The project branch
        // calls deleteProjectFlow with the row and its current name.
        expect(body).toMatch(/closest\(\s*['"]#projChild['"]\s*\)/);
        expect(body).toMatch(/deleteProjectFlow\s*\(/);
    });

    it('project-delete branch precedes the todo-delete branch', () => {
        const body = extractArrowNavHandler();
        // Order matters: if Delete on a focused projChild ran the todo
        // branch first, the .todo-active fallback would still fire and
        // delete the first todo before the project branch ever ran.
        const projIdx = body.search(/deleteProjectFlow\s*\(/);
        const todoIdx = body.search(/closeButtonToDo/);
        expect(projIdx).toBeGreaterThan(-1);
        expect(todoIdx).toBeGreaterThan(-1);
        expect(projIdx).toBeLessThan(todoIdx);
    });

    it('todo-delete branch no longer falls back to .todo-active — it requires focus on a #toDoChild', () => {
        const body = extractArrowNavHandler();
        // The bug was that `currentRow` fell back to
        // `mainList.querySelector('#toDoChild.todo-active')`, so Delete on
        // any non-todo focus target would still hit the first active todo.
        // The Delete branch now resolves its target row independently from
        // ae.closest('#toDoChild') — no .todo-active fallback for deletion.
        const deleteBranch = body.slice(body.search(/if\s*\(\s*isDelete\s*\)\s*\{[\s\S]*?closeButtonToDo/));
        expect(deleteBranch).toMatch(/closest\(\s*['"]#toDoChild['"]\s*\)/);
    });

    it('preventDefault fires on the project-delete branch so the keystroke does not also act on whatever was focused', () => {
        const body = extractArrowNavHandler();
        // Slice from the deleteProjectFlow call to the first `return` after
        // it; preventDefault must appear in that window.
        const projIdx = body.search(/deleteProjectFlow\s*\(/);
        expect(projIdx).toBeGreaterThan(-1);
        const after = body.slice(projIdx);
        const returnIdx = after.search(/\breturn\b/);
        expect(returnIdx).toBeGreaterThan(-1);
        const window = after.slice(0, returnIdx);
        expect(window).toMatch(/preventDefault\(\s*\)/);
    });
});
