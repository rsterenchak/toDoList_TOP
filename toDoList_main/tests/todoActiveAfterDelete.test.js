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
// and falling back to the blank placeholder when the user just deleted the
// last committed todo so the list still has a visible anchor.
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

    it('does not gate the active-shift on the target having a non-empty title', () => {
        const body = extractDeleteHandler();
        const renderIdx = body.search(/addAllToDo_DOM\s*\(/);
        const after = body.slice(renderIdx);
        // Earlier behavior skipped the blank placeholder by checking
        // `target.__item.tit` before adding the class, leaving an emptied
        // list with no anchor. The current contract is: when the only
        // remaining row is the blank placeholder, it still receives
        // `.todo-active` so arrow-key nav has somewhere to resume from.
        // Asserting the absence of the old guard pins that intent.
        expect(after).not.toMatch(/target\.__item\s*&&\s*target\.__item\.tit/);
    });
});
