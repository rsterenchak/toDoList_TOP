import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}


// Locks in the fix for: pressing Enter on the blank "Add a task"
// placeholder was only writing to localStorage and skipping the
// Supabase INSERT. The placeholder is filtered from every prior
// write because its title is empty, and the Enter handler promotes
// it by mutating item.tit in place rather than re-routing through
// addToDo — so without an explicit commit call the row never lands
// in the backend, and the followup sortCompletedToBottom fires
// UPDATEs against an id Supabase has never seen (silently 204s).
// The fix wires a listLogic.commitBlankPlaceholder call between
// saveToStorage and the appendNewToDoRow / focusBlankToDoInput
// branch in the Enter handler so the INSERT fires first.
//
// buildToDoRow is too heavily wired for a full jsdom instantiation
// here (see mobileCopyTitleAndSlimDuePill.test.js for the same
// caveat), so the regression is pinned at the source level — the
// behaviour test in listLogicSupabase.test.js covers the listLogic
// side of the contract.
describe('toDoRow Enter-to-commit fires a Supabase INSERT via commitBlankPlaceholder', () => {
    const toDoRow = read('toDoRow.js');

    function extractRange(startNeedle, endNeedle) {
        const startIdx = toDoRow.indexOf(startNeedle);
        expect(startIdx).toBeGreaterThan(-1);
        const endIdx = toDoRow.indexOf(endNeedle, startIdx + startNeedle.length);
        expect(endIdx).toBeGreaterThan(-1);
        return toDoRow.slice(startIdx, endIdx);
    }

    it('the Enter keydown handler in buildToDoRow calls listLogic.commitBlankPlaceholder with toDoName and item', () => {
        const enter = extractRange(
            'toDoInput keydown — Enter to commit title',
            '// toDoInput keyup'
        );
        expect(enter).toMatch(
            /listLogic\.commitBlankPlaceholder\s*\(\s*toDoName\s*,\s*item\s*\)/
        );
    });

    it('the commitBlankPlaceholder call lands between saveToStorage and the appendNewToDoRow / focusBlankToDoInput branch', () => {
        // INSERT must fire before sortCompletedToBottom (called from
        // appendNewToDoRow) so the UPDATEs that follow have a real
        // row to update — otherwise Supabase silently 204s every
        // UPDATE because the id never existed on the backend.
        const enter = extractRange(
            'toDoInput keydown — Enter to commit title',
            '// toDoInput keyup'
        );
        const saveIdx = enter.search(/listLogic\.saveToStorage\s*\(\s*\)/);
        const commitIdx = enter.search(/listLogic\.commitBlankPlaceholder\s*\(/);
        const appendIdx = enter.search(/appendNewToDoRow\s*\(/);
        const focusIdx  = enter.search(/focusBlankToDoInput\s*\(/);
        expect(saveIdx).toBeGreaterThan(-1);
        expect(commitIdx).toBeGreaterThan(-1);
        expect(appendIdx).toBeGreaterThan(-1);
        expect(focusIdx).toBeGreaterThan(-1);
        expect(saveIdx).toBeLessThan(commitIdx);
        expect(commitIdx).toBeLessThan(appendIdx);
        expect(commitIdx).toBeLessThan(focusIdx);
    });

    it('the commit call appears exactly once in the Enter handler so no double-INSERT is possible', () => {
        const enter = extractRange(
            'toDoInput keydown — Enter to commit title',
            '// toDoInput keyup'
        );
        const matches = enter.match(/listLogic\.commitBlankPlaceholder\s*\(/g) || [];
        expect(matches.length).toBe(1);
    });
});


// Regression: toggling a todo description open/closed inserts or removes
// #descSibling directly into #mainList, shifting every row below it —
// including an expanded TODO.md viewer card's header. The viewer card caches
// its body height from a one-time snapshot (applyExpandedHeight), recomputed
// only on window resize or its own collapse toggle, so without a nudge the
// card's body overruns the room actually left and collides with neighboring
// rows. wireDescToggle must call refreshViewerExpandedHeight() after the
// insert/remove so the cached height tracks the live layout.
describe('wireDescToggle nudges the viewer card to recompute its expanded height', () => {
    const toDoRow = read('toDoRow.js');
    const viewer = read('todoMdViewer.js');

    function wireDescToggleBody() {
        const startIdx = toDoRow.indexOf('function wireDescToggle');
        expect(startIdx).toBeGreaterThan(-1);
        // Up to (but not into) the next top-level export/function after it.
        const endIdx = toDoRow.indexOf('export function buildToDoRow', startIdx);
        expect(endIdx).toBeGreaterThan(-1);
        return toDoRow.slice(startIdx, endIdx);
    }

    it('imports refreshViewerExpandedHeight from todoMdViewer.js', () => {
        expect(toDoRow).toMatch(
            /import\s*\{\s*refreshViewerExpandedHeight\s*\}\s*from\s*['"]\.\/todoMdViewer\.js['"]/
        );
    });

    it('calls refreshViewerExpandedHeight() inside the descToggle click handler', () => {
        const body = wireDescToggleBody();
        expect(body).toMatch(/refreshViewerExpandedHeight\s*\(\s*\)/);
    });

    it('makes the recompute call after the descSibling insert and remove, so it fires for both open and close', () => {
        const body = wireDescToggleBody();
        const insertIdx = body.indexOf('insertBefore(descSibling');
        const removeIdx = body.indexOf('removeChild(descNode');
        const refreshIdx = body.indexOf('refreshViewerExpandedHeight()');
        expect(insertIdx).toBeGreaterThan(-1);
        expect(removeIdx).toBeGreaterThan(-1);
        expect(refreshIdx).toBeGreaterThan(-1);
        // The single refresh call sits after both mutation branches.
        expect(refreshIdx).toBeGreaterThan(insertIdx);
        expect(refreshIdx).toBeGreaterThan(removeIdx);
    });

    it('todoMdViewer.js exports refreshViewerExpandedHeight, which drives the resize handler (the applyExpandedHeight seam)', () => {
        expect(viewer).toMatch(
            /export\s+function\s+refreshViewerExpandedHeight\s*\(\s*\)\s*\{[\s\S]{0,200}viewerResizeHandler\s*\(\s*\)/
        );
    });
});
