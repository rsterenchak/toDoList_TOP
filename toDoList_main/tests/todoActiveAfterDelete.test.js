import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for shifting `.todo-active` to a neighbor after a todo
// deletion. Without this, the deletion handler re-renders the list and leaves
// every row inactive — breaking the keyboard arrow-nav flow that resolves the
// current row from `.todo-active` when nothing is focused. The expected shift
// is: next row below, falling back to previous if the deleted row was last,
// and clearing entirely when only the blank placeholder remains.
describe('todo-active focus shifts to neighbor after todo deletion', () => {
    const toDoRow = read('toDoRow.js');

    function extractDeleteHandler() {
        const re = /closeButtonToDo\.addEventListener\(\s*['"]click['"]\s*,\s*function\s*\([^)]*\)\s*\{/;
        const match = re.exec(toDoRow);
        if (!match) throw new Error('closeButtonToDo click handler not found in toDoRow.js');
        const bodyStart = match.index + match[0].length - 1;
        let depth = 0;
        for (let i = bodyStart; i < toDoRow.length; i++) {
            const c = toDoRow[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return toDoRow.slice(bodyStart + 1, i);
            }
        }
        throw new Error('closeButtonToDo click handler body not closed');
    }

    it('captures the deleted row index before invoking removeToDoByItem', () => {
        // The position of the deleted row among `#toDoChild` siblings has to
        // be read from the DOM *before* the row is spliced out, so the post-
        // re-render lookup can target the same slot.
        const body = extractDeleteHandler();
        const removeIdx = body.search(/listLogic\.removeToDoByItem/);
        expect(removeIdx).toBeGreaterThan(-1);
        const before = body.slice(0, removeIdx);
        expect(before).toMatch(/indexOf\(\s*toDoChild\s*\)/);
    });

    it('applies .todo-active to the post-render row at the captured index after re-render', () => {
        const body = extractDeleteHandler();
        // The active-shift logic must run on the freshly-rendered rows, so
        // the addAllToDo_DOM re-render call has to come before it.
        const renderIdx = body.search(/addAllToDo_DOM\s*\(/);
        expect(renderIdx).toBeGreaterThan(-1);
        const after = body.slice(renderIdx);
        expect(after).toMatch(/classList\.add\(\s*['"]todo-active['"]\s*\)/);
    });

    it('falls back to the last row when the captured index is past the new end', () => {
        const body = extractDeleteHandler();
        const renderIdx = body.search(/addAllToDo_DOM\s*\(/);
        const after = body.slice(renderIdx);
        // length - 1 fallback covers the "deleted item was last" case.
        expect(after).toMatch(/length\s*-\s*1/);
    });

    it('skips the blank placeholder so an emptied list ends up with no active row', () => {
        const body = extractDeleteHandler();
        const renderIdx = body.search(/addAllToDo_DOM\s*\(/);
        const after = body.slice(renderIdx);
        // The blank placeholder row has `__item.tit === ''`. Checking the
        // target's title is non-empty before adding the class prevents the
        // last-committed-deletion case from marking the blank row active.
        expect(after).toMatch(/__item/);
        expect(after).toMatch(/\.tit/);
    });
});
