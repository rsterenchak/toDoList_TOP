import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the fix for: typing into the blank "Add a task" placeholder, then
// switching projects before pressing Enter, was leaving the typed text behind
// AND revealing the row's chrome (delete X, due pill, checkbox, expand caret)
// on return — because the keyup handler unconditionally wrote item.tit on
// every keystroke. The fix stamps `data-original-blank='true'` on rows built
// as blank placeholders and short-circuits the keyup persistence block while
// that marker is present. The Enter commit handler clears the marker so
// chained edits after commit keystroke-save like any other committed row.
describe('blank-placeholder keyup does not persist partial titles', () => {
    const toDoRow = read('toDoRow.js');

    function extractRange(startNeedle, endNeedle) {
        const startIdx = toDoRow.indexOf(startNeedle);
        expect(startIdx).toBeGreaterThan(-1);
        const endIdx = toDoRow.indexOf(endNeedle, startIdx + startNeedle.length);
        expect(endIdx).toBeGreaterThan(-1);
        return toDoRow.slice(startIdx, endIdx);
    }

    it('stamps data-original-blank="true" on blank rows in buildToDoRow', () => {
        // The marker must be set at build time when `!item.tit`, before any
        // listeners attach. It needs to survive until the row is rebuilt or
        // the Enter commit handler clears it.
        const build = extractRange('export function buildToDoRow', 'toDoInput.type');
        expect(build).toMatch(
            /if\s*\(\s*!item\.tit\s*\)\s*\{\s*toDoChild\.dataset\.originalBlank\s*=\s*["']true["']\s*;?\s*\}/
        );
    });

    it('skips the keyup persistence write while the original-blank marker is present', () => {
        // The handler must short-circuit before mutating item.tit OR calling
        // saveToStorage — both writes are what leak the partial title into the
        // data model and re-render the row as committed after a project switch.
        const keyup = extractRange(
            'toDoInput keyup',
            '// snap-back'
        );
        // Marker check returns early.
        expect(keyup).toMatch(
            /if\s*\(\s*toDoChild\.dataset\.originalBlank\s*===\s*["']true["']\s*\)\s*return/
        );
        // And the early return appears before item.tit is touched.
        const earlyReturnIdx = keyup.search(
            /if\s*\(\s*toDoChild\.dataset\.originalBlank\s*===\s*["']true["']\s*\)\s*return/
        );
        const titWriteIdx = keyup.indexOf('item.tit = val');
        expect(earlyReturnIdx).toBeGreaterThan(-1);
        expect(titWriteIdx).toBeGreaterThan(-1);
        expect(earlyReturnIdx).toBeLessThan(titWriteIdx);
    });

    it('clears the original-blank marker in the Enter commit handler', () => {
        // After commit, the row is a real todo. Subsequent edits to its
        // title must keystroke-save like any other committed row — the
        // marker has to come off before the keyup handler runs again.
        const enter = extractRange(
            'toDoInput keydown — Enter to commit title',
            '// toDoInput keyup'
        );
        // Marker is removed after item.tit is set (delete or removeAttribute
        // both work — accept either).
        const removesDataset = /delete\s+toDoChild\.dataset\.originalBlank/.test(enter);
        const removesAttr = /toDoChild\.removeAttribute\(\s*['"]data-original-blank['"]\s*\)/.test(enter);
        expect(removesDataset || removesAttr).toBe(true);

        // Removal happens after item.tit = val (otherwise the very keyup that
        // triggered the commit cycle would still be blocked when chained).
        const titIdx = enter.indexOf('item.tit = val');
        const removeIdx = removesDataset
            ? enter.search(/delete\s+toDoChild\.dataset\.originalBlank/)
            : enter.search(/toDoChild\.removeAttribute\(\s*['"]data-original-blank['"]\s*\)/);
        expect(titIdx).toBeGreaterThan(-1);
        expect(removeIdx).toBeGreaterThan(titIdx);
    });

    it('only assigns the marker inside the !item.tit guard so committed rows skip it', () => {
        // The marker must be gated on `!item.tit` so re-rendering an existing
        // committed row (project switch back, reorder, etc.) never re-stamps
        // it — that would silently freeze keystroke-saving on committed rows.
        // Count every assignment and make sure each one sits inside such a
        // guard within the buildToDoRow body.
        const build = extractRange('export function buildToDoRow', 'toDoInput.type');
        const assignments = [...build.matchAll(/toDoChild\.dataset\.originalBlank\s*=\s*["']true["']/g)];
        expect(assignments.length).toBeGreaterThan(0);
        for (const match of assignments) {
            const before = build.slice(0, match.index);
            // Walk backwards through the slice and find the nearest open `{`
            // that has no matching close before our position — that's the
            // enclosing block. Its header should mention `!item.tit`.
            let depth = 0;
            let blockOpenIdx = -1;
            for (let i = before.length - 1; i >= 0; i--) {
                const c = before[i];
                if (c === '}') depth++;
                else if (c === '{') {
                    if (depth === 0) { blockOpenIdx = i; break; }
                    depth--;
                }
            }
            expect(blockOpenIdx).toBeGreaterThan(-1);
            const header = build.slice(Math.max(0, blockOpenIdx - 60), blockOpenIdx);
            expect(header).toMatch(/!\s*item\.tit/);
        }
    });
});
