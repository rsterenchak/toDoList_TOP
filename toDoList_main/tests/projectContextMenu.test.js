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

// Behavioral regression tests — the previous entry's source-inspection tests
// confirmed enterRowEditMode *exists* and is *wired*, but never exercised the
// real DOM, so a Rename that silently switched projects (the original bug) or
// landed its input off-screen would have passed them. These run the REAL
// dropdown functions — buildProjectPickerRows, the row context menu, and
// enterRowEditMode — sliced out of main.js and executed against live jsdom
// nodes, pinning the *visible* outcome: an input materializes ON the row, Enter
// commits through listLogic.editProject and repaints in place, Escape restores,
// a duplicate stays open in error, and a Rename never fires the row's project
// switch. main.js can't be imported whole (per CLAUDE.md), so the relevant
// region is extracted and given mocked dependencies — the same runtime-smoke
// pattern todoRowSubControlKeyboardNav.test.js uses.
describe('desktop project-picker inline rename — runtime behavior', () => {
    const main = read('main.js');

    // Slice the contiguous dropdown region (projectPickerIsOpen …
    // attachProjectPickerRowContextMenu) — every function the rename + context
    // menu flow touches lives in this span and references only injectable
    // externals.
    function sliceRegion(startSig, lastSig) {
        const start = main.indexOf(startSig);
        if (start === -1) throw new Error('start signature not found: ' + startSig);
        const lastStart = main.indexOf(lastSig);
        if (lastStart === -1) throw new Error('last signature not found: ' + lastSig);
        const braceStart = main.indexOf('{', lastStart);
        let depth = 0;
        for (let i = braceStart; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) return main.slice(start, i + 1);
            }
        }
        throw new Error('unterminated region for: ' + lastSig);
    }

    const region = sliceRegion(
        'function projectPickerIsOpen(',
        'function attachProjectPickerRowContextMenu('
    );

    // Build a fresh instance of the region's closure on every call so module
    // state (activeRowEditor, projRowContextMenu) never bleeds across tests.
    const makeApi = new Function(
        'document', 'window', 'listLogic', 'projectPickerDropdown', 'mobileProjName',
        'mobileProjHeader', 'mobileProjChevron', 'sideMain', 'navigateToProjectByIndex',
        'deleteProjectFlow', 'updateFooterCounts', 'applyProjectInitial',
        region +
        '\n; return { buildProjectPickerRows: buildProjectPickerRows,' +
        ' enterRowEditMode: enterRowEditMode,' +
        ' projectPickerIsOpen: projectPickerIsOpen,' +
        ' closeProjectPicker: closeProjectPicker };'
    );

    let api, dropdown, listLogic, navSpy, editSpy, reorderSpy, mobileProjName;

    // Stateful listLogic mock mirroring the real contract: editProject re-keys
    // the project (object insertion order moves the rename to the end), so the
    // commit path's reorderProject(movedIdx, originalIdx) is genuinely
    // exercised when restoring the row's slot.
    function makeListLogic(initial, counts) {
        let projects = initial.slice();
        editSpy = vi.fn(function (oldN, newN) {
            const t = (newN || '').trim();
            if (!t) return;
            const i = projects.indexOf(oldN);
            if (i !== -1) projects.splice(i, 1);
            projects.push(t);
        });
        reorderSpy = vi.fn(function (from, to) {
            from = parseInt(from, 10);
            to = parseInt(to, 10);
            const moved = projects.splice(from, 1)[0];
            projects.splice(to, 0, moved);
        });
        return {
            listProjectsArray: function () { return projects.slice(); },
            getProjectIncompleteCount: function (n) { return (counts && counts[n]) || 0; },
            editProject: editSpy,
            reorderProject: reorderSpy,
        };
    }

    function rowAt(idx) {
        return dropdown.querySelectorAll('.projectPickerRow')[idx];
    }
    function rowName(idx) {
        const el = rowAt(idx).querySelector('.projectPickerName');
        return el ? el.textContent : null;
    }

    // Open the row's context menu and click its "Rename" item — the real entry
    // point for the rename flow (not a direct enterRowEditMode call).
    function clickRenameFromMenu(row) {
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const menu = document.getElementById('projRowContextMenu');
        const items = menu.querySelectorAll('.projContextMenuItem');
        let rename = null;
        items.forEach(function (it) { if (it.textContent === 'Rename') rename = it; });
        rename.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return rename;
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        dropdown = document.createElement('div');
        dropdown.id = 'projectPickerDropdown';
        document.body.appendChild(dropdown);

        mobileProjName = document.createElement('span');
        mobileProjName.textContent = 'Alpha'; // active project
        const mobileProjHeader = document.createElement('div');
        const mobileProjChevron = document.createElement('span');
        const sideMain = document.createElement('div');
        document.body.append(mobileProjHeader, mobileProjChevron, sideMain);

        navSpy = vi.fn();
        listLogic = makeListLogic(['Alpha', 'Beta', 'Gamma'], { Alpha: 2, Beta: 0, Gamma: 5 });

        api = makeApi(
            document, window, listLogic, dropdown, mobileProjName,
            mobileProjHeader, mobileProjChevron, sideMain, navSpy,
            vi.fn(), vi.fn(), vi.fn()
        );
        api.buildProjectPickerRows();
    });

    it('clicking Rename mounts a focused input ON the dropdown row (not an off-screen field)', () => {
        const row = rowAt(1); // Beta
        clickRenameFromMenu(row);
        const input = row.querySelector('input');
        expect(input).not.toBeNull();
        expect(document.activeElement).toBe(input);
        expect(input.value).toBe('Beta');
        // the context menu is torn down once Rename is chosen
        expect(document.getElementById('projRowContextMenu')).toBeNull();
    });

    it('clicking Rename does NOT switch projects (the original bug)', () => {
        clickRenameFromMenu(rowAt(2)); // Gamma
        expect(navSpy).not.toHaveBeenCalled();
    });

    it('Enter commits through listLogic.editProject and repaints the row in place', () => {
        const row = rowAt(0); // Alpha, the active project at index 0
        clickRenameFromMenu(row);
        const input = row.querySelector('input');
        input.value = 'Renamed';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

        expect(editSpy).toHaveBeenCalledWith('Alpha', 'Renamed');
        // dropdown still has three rows, and the renamed project holds slot 0
        expect(dropdown.querySelectorAll('.projectPickerRow').length).toBe(3);
        expect(rowName(0)).toBe('Renamed');
        expect(rowName(1)).toBe('Beta');
        expect(rowName(2)).toBe('Gamma');
        // no stray input survives the commit
        expect(dropdown.querySelector('input')).toBeNull();
    });

    it('Escape cancels: the input is removed and the row shows the prior name', () => {
        const row = rowAt(1); // Beta
        clickRenameFromMenu(row);
        expect(row.querySelector('input')).not.toBeNull();
        row.querySelector('input').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
        expect(row.querySelector('input')).toBeNull();
        expect(rowName(1)).toBe('Beta');
        expect(editSpy).not.toHaveBeenCalled();
    });

    it('a duplicate-name commit keeps the input mounted with the error treatment and writes nothing', () => {
        const row = rowAt(0); // Alpha
        clickRenameFromMenu(row);
        const input = row.querySelector('input');
        input.value = 'Beta'; // collides with an existing project
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

        expect(row.querySelector('input')).not.toBeNull();
        expect(input.classList.contains('error')).toBe(true);
        expect(editSpy).not.toHaveBeenCalled();
    });
});
