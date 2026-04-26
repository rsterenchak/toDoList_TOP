import { listLogic } from '../src/listLogic.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the fix for the empty-project-name corruption bug. Reproduction
// of the original failure: create a project, add a todo, edit the project
// title to an empty string and confirm, click into a different project, then
// click back. Items vanished and the new-item input/placeholder disappeared
// because the empty name was being treated as a real key, breaking lookup
// after the rename. The fix: never let an empty rename commit; the input
// reverts to the project's last-known good name on blur or Enter.

describe('listLogic — empty project name guards', () => {
    beforeEach(() => {
        listLogic._reset();
    });

    it('editProject is a no-op when the new name is empty', () => {
        listLogic.addProject('Old');
        listLogic.addToDo('Old', 'Milk');

        listLogic.editProject('Old', '');

        // Old still exists with its items; no '' key was created.
        expect(listLogic.listProjectsArray()).toContain('Old');
        expect(listLogic.listProjectsArray()).not.toContain('');
        const titles = listLogic.listItems('Old').map(i => i.tit);
        expect(titles).toContain('Milk');
    });

    it('editProject is a no-op when the new name is whitespace only', () => {
        listLogic.addProject('Old');
        listLogic.addToDo('Old', 'Milk');

        listLogic.editProject('Old', '   ');

        expect(listLogic.listProjectsArray()).toContain('Old');
        expect(listLogic.listProjectsArray()).not.toContain('   ');
        expect(listLogic.listProjectsArray()).not.toContain('');
        const titles = listLogic.listItems('Old').map(i => i.tit);
        expect(titles).toContain('Milk');
    });

    it('addProject is a no-op when the name is empty or whitespace only', () => {
        listLogic.addProject('');
        listLogic.addProject('   ');

        expect(listLogic.listProjectsArray()).not.toContain('');
        expect(listLogic.listProjectsArray()).not.toContain('   ');
        expect(listLogic.listProjectsArray()).toEqual([]);
    });
});


describe('main.js — empty rename UI safeguards', () => {
    const js = read('main.js');

    // Find the rename Enter handler inside restoreFromStorage. It's the one
    // that consults `currentProperty` and calls `editProject`; the new-project
    // flow's keydown also calls editProject but lives inside the projButton
    // click listener, which has its own explicit marker.
    function extractRestoreRenameEnterHandler() {
        const restoreMarker = 'function restoreFromStorage';
        const start = js.indexOf(restoreMarker);
        expect(start).toBeGreaterThan(-1);
        const re = /titleInput\.addEventListener\(\s*["']keydown["']\s*,\s*function\s*\([^)]*\)\s*\{/g;
        re.lastIndex = start;
        const match = re.exec(js);
        expect(match).not.toBeNull();
        const bodyStart = match.index + match[0].length - 1;
        let depth = 0;
        for (let i = bodyStart; i < js.length; i++) {
            const c = js[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return js.slice(bodyStart + 1, i);
            }
        }
        throw new Error('unterminated keydown listener');
    }

    function extractRestoreRenameBlurHandler() {
        const restoreMarker = 'function restoreFromStorage';
        const start = js.indexOf(restoreMarker);
        expect(start).toBeGreaterThan(-1);
        const re = /titleInput\.addEventListener\(\s*["']blur["']\s*,\s*function\s*\([^)]*\)\s*\{/g;
        re.lastIndex = start;
        const match = re.exec(js);
        expect(match).not.toBeNull();
        const bodyStart = match.index + match[0].length - 1;
        let depth = 0;
        for (let i = bodyStart; i < js.length; i++) {
            const c = js[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return js.slice(bodyStart + 1, i);
            }
        }
        throw new Error('unterminated blur listener');
    }

    it('rename Enter handler restores the input to currentProperty on empty input', () => {
        const body = extractRestoreRenameEnterHandler();
        // Empty branch must restore the input value to the last good name —
        // not just early-return, which leaves the input visibly empty while
        // the data still lives under the old name.
        expect(body).toMatch(/titleInput\.value\s*=\s*currentProperty/);
    });

    it('rename blur handler restores the input to currentProperty on empty input', () => {
        const body = extractRestoreRenameBlurHandler();
        expect(body).toMatch(/titleInput\.value\s*=\s*currentProperty/);
    });
});
