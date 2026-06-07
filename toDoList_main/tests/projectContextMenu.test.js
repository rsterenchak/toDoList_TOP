import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Rename in the desktop #projectPickerDropdown context menu now edits the
// dropdown's OWN row in place instead of activating the sidebar's off-screen
// #projInput. main.js is too large to instantiate in jsdom (per CLAUDE.md and
// the rest of the project-picker suite), so the wiring invariants are pinned by
// source inspection; the shared rename mutation is exercised directly against
// listLogic.
describe('desktop project-picker inline rename', () => {
    const main = read('main.js');
    const css = read('style.css');

    // Slice a named function declaration's body from main.js.
    function fnBody(name) {
        const start = main.indexOf('function ' + name + '(');
        expect(start).toBeGreaterThan(-1);
        let i = main.indexOf('{', start);
        let depth = 0;
        for (; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) return main.slice(start, i + 1);
            }
        }
        throw new Error('unbalanced braces for ' + name);
    }

    it('swaps the row into a focused text input pre-populated with the current name', () => {
        const body = fnBody('enterRowEditMode');
        // a text input built with the rename-input class, valued from the name
        expect(body).toMatch(/createElement\(['"]input['"]\)/);
        expect(body).toMatch(/className\s*=\s*['"]projectPickerRenameInput['"]/);
        expect(body).toMatch(/input\.value\s*=\s*projectName/);
        // mounts focused and select-all'd so a single keypress replaces
        expect(body).toMatch(/input\.focus\(\)/);
        expect(body).toMatch(/input\.select\(\)/);
        // the row is flagged so its name/count are swapped out, not duplicated
        expect(body).toMatch(/classList\.add\(['"]editing['"]\)/);
    });

    it('commits through listLogic.editProject — the same mutation the sidebar #projInput commit uses', () => {
        const body = fnBody('enterRowEditMode');
        expect(body).toMatch(/listLogic\.editProject\(projectName,\s*trimmed\)/);
        // The sidebar's #projInput Enter-commit also routes rename through
        // listLogic.editProject — so both surfaces share one mutation site.
        expect(main).toMatch(/listLogic\.editProject\(currentProperty,\s*newProperty\)/);
    });

    it('restores the renamed project to its original sort position (editProject appends to the end)', () => {
        const body = fnBody('enterRowEditMode');
        expect(body).toMatch(/listLogic\.reorderProject\(movedIdx,\s*originalIdx\)/);
    });

    it('keeps the backing #projChild input in sync with the new name', () => {
        const body = fnBody('enterRowEditMode');
        expect(body).toMatch(/findProjChildByName\(projectName\)/);
        expect(body).toMatch(/backingInput\.value\s*=\s*trimmed/);
    });

    it('Enter commits and Escape cancels (Escape kept from also closing the dropdown)', () => {
        const body = fnBody('enterRowEditMode');
        // Enter → commit; Escape → preventDefault + stopPropagation + cancel.
        expect(body).toMatch(/e\.key\s*===\s*['"]Enter['"][\s\S]*?commit\(\)/);
        expect(body).toMatch(/e\.key\s*===\s*['"]Escape['"][\s\S]*?stopPropagation\(\)[\s\S]*?cancel\(\)/);
    });

    it('blur commits, deferred so a dropdown dismissal cancels first', () => {
        const body = fnBody('enterRowEditMode');
        expect(body).toMatch(/addEventListener\(['"]blur['"]/);
        // the blur handler defers via setTimeout and bails if already settled
        expect(body).toMatch(/setTimeout\([\s\S]*?if\s*\(settled\)\s*return;[\s\S]*?commit\(\)/);
    });

    it('rejects empty and duplicate names, keeping the editor open with an error treatment', () => {
        const body = fnBody('enterRowEditMode');
        // empty / whitespace-only → reject
        expect(body).toMatch(/trimmed\.length\s*===\s*0[\s\S]*?rejectAndStayOpen\(\)/);
        // duplicate name → reject
        expect(body).toMatch(/indexOf\(trimmed\)\s*!==\s*-1[\s\S]*?rejectAndStayOpen\(\)/);
        // the reject treatment adds an error class and keeps focus (editor open)
        const reject = body.slice(body.indexOf('function rejectAndStayOpen'));
        expect(reject).toMatch(/classList\.add\(['"]error['"]\)/);
        expect(reject).toMatch(/input\.focus\(\)/);
    });

    it('an unchanged value reverts cleanly with no write', () => {
        const body = fnBody('enterRowEditMode');
        // commit short-circuits to cancel() before calling editProject when the
        // trimmed value equals the original name.
        const commit = body.slice(body.indexOf('function commit'));
        const editIdx = commit.indexOf('editProject');
        const unchangedIdx = commit.indexOf('trimmed === projectName');
        expect(unchangedIdx).toBeGreaterThan(-1);
        expect(unchangedIdx).toBeLessThan(editIdx);
        expect(commit).toMatch(/trimmed\s*===\s*projectName[\s\S]*?cancel\(\)/);
    });

    it('dismissing the dropdown cancels any in-progress edit (no orphan input, no stale write)', () => {
        const close = fnBody('closeProjectPicker');
        expect(close).toMatch(/cancelActiveRowEditor\(\)/);
        const cancelHelper = fnBody('cancelActiveRowEditor');
        expect(cancelHelper).toMatch(/activeRowEditor\.cancel\(\)/);
    });

    it('after a successful commit the dropdown stays open and repaints', () => {
        const body = fnBody('enterRowEditMode');
        // commit rebuilds the rows + refreshes counts/pill — it never calls
        // closeProjectPicker, so the dropdown stays open. (Match the call form
        // with a paren so the blur comment's bare mention doesn't count.)
        const commit = body.slice(body.indexOf('function commit'));
        expect(commit).toMatch(/updateFooterCounts\(\)/);
        expect(commit).toMatch(/buildProjectPickerRows\(\)/);
        expect(body).not.toMatch(/closeProjectPicker\(/);
    });

    it('CSS styles the rename input to match the row (SpaceMono 13px, purple focus border) with a red error state', () => {
        const ruleIdx = css.indexOf('.projectPickerRenameInput');
        expect(ruleIdx).toBeGreaterThan(-1);
        const block = css.slice(ruleIdx, ruleIdx + 600);
        expect(block).toMatch(/font-size:\s*13px/);
        expect(block).toMatch(/SpaceMono/);
        expect(block).toMatch(/border:\s*1px solid #6C5DF5/);
        // error variant turns the border red
        expect(css).toMatch(/\.projectPickerRenameInput\.error\s*\{[\s\S]*?border-color:\s*#e5484d/);
    });
});

// Parity guard: the sidebar's Edit item still drives projectRow.js's
// beginProjectRename (unchanged by this entry). The dropdown's Rename moved off
// that helper to its own inline editor, but the sidebar surface must keep
// working exactly as before.
describe('sidebar project rename parity (unchanged)', () => {
    const projectRow = read('projectRow.js');

    it('projectRow.js exports beginProjectRename and the sidebar Edit routes through it', () => {
        expect(projectRow).toMatch(/export function beginProjectRename\(projChild,\s*titleInput\)/);
        const onEditIdx = projectRow.indexOf('function onEdit()');
        expect(onEditIdx).toBeGreaterThan(-1);
        const onEditBody = projectRow.slice(onEditIdx, onEditIdx + 120);
        expect(onEditBody).toMatch(/beginProjectRename\(projChild,\s*titleInput\)/);
    });
});
