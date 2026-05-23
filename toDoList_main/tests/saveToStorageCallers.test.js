// Lint-style static scan: every function in listLogic.js that calls
// saveToStorage must either accept an `opts` parameter (the sync-safe
// path that forwards opts to saveToStorage) OR be annotated with a
// `// @user-mutation-only` comment on the line immediately above the
// function declaration.
//
// Background: the Drive import pipeline writes lastDriveSyncedAt before
// it dispatches the data replace. If any post-replace code path calls
// saveToStorage without forwarding the fromSync flag, the resulting
// writeLastLocalMutationAt bump lands AFTER lastDriveSyncedAt and the
// sync indicator reads 'ahead' even though the local state has just
// been pulled from Drive. This bug already shipped once via
// sortCompletedToBottom in the rebuildAfterImport loop; this test
// exists so the next new caller can't repeat the audit miss silently.
//
// Baseline (current source — keep in sync if the function set changes):
//   sync-safe (accept opts):    sortCompletedToBottom, replaceAllProjects
//   @user-mutation-only:        addProject, removeProject, addToDo,
//                               removeToDo, removeToDoByItem,
//                               insertToDoAt, editProject, reorderProject,
//                               reorderToDo, setProjectColor, setRecurrence,
//                               advanceRecurringTodo, seedSampleProject,
//                               seedSampleTodos

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const SRC = readFileSync(resolve(srcDir, 'listLogic.js'), 'utf8');

// Locate every `function NAME(...)` declaration in the file, capturing
// the leading comment lines so the annotation rule can be checked.
function collectFunctionDeclarations(src) {
    const out = [];
    const re = /(^|\n)\s*function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
    let match;
    while ((match = re.exec(src)) !== null) {
        const declStart = match.index + match[1].length;
        const name = match[2];
        const params = match[3];
        const openBrace = src.indexOf('{', match.index + match[0].length - 1);
        // Walk braces to find the matching close so the body is exact.
        let depth = 0;
        let bodyEnd = openBrace;
        for (let i = openBrace; i < src.length; i++) {
            const ch = src[i];
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) { bodyEnd = i; break; }
            }
        }
        const body = src.slice(openBrace + 1, bodyEnd);
        // Capture up to ~8 lines of preceding comment so the
        // @user-mutation-only annotation can sit alongside an existing
        // doc block.
        const before = src.slice(0, declStart);
        const beforeLines = before.split('\n');
        const preceding = beforeLines.slice(Math.max(0, beforeLines.length - 9), beforeLines.length - 1).join('\n');
        out.push({ name, params, body, preceding });
    }
    return out;
}

const FUNCTIONS = collectFunctionDeclarations(SRC);

function callsSaveToStorage(body) {
    return /\bsaveToStorage\s*\(/.test(body);
}

function acceptsOpts(params) {
    // The opts contract is positional — any param literally named `opts`
    // counts as the sync-safe contract. The scan deliberately doesn't
    // try to look inside the body to confirm forwarding; that's covered
    // by the per-function unit tests in listLogic.test.js. The signature
    // check just makes the contract visible at the call boundary.
    return /(^|,)\s*opts\s*(,|$)/.test(params);
}

function isUserMutationAnnotated(preceding) {
    // Allow the annotation on any of the preceding comment lines, not
    // strictly the immediate line above, so an existing doc block can
    // wrap around it.
    return /\/\/\s*@user-mutation-only\b/.test(preceding);
}


describe('listLogic — saveToStorage caller audit', () => {

    it('found at least one saveToStorage caller (sanity)', () => {
        // If this trips, the scan is failing to parse listLogic.js and
        // the rest of the assertions below would silently pass.
        const callers = FUNCTIONS.filter(function(fn) {
            return callsSaveToStorage(fn.body);
        });
        expect(callers.length).toBeGreaterThan(5);
    });

    // One assertion per function so failures point at the offending
    // function name in the test output.
    FUNCTIONS.forEach(function(fn) {
        if (!callsSaveToStorage(fn.body)) return;
        it('"' + fn.name + '" either accepts `opts` or is marked @user-mutation-only', () => {
            const optsOk = acceptsOpts(fn.params);
            const annotatedOk = isUserMutationAnnotated(fn.preceding);
            // The combined assertion message names the function so a
            // future contributor adding a new caller without one or
            // the other sees exactly what's missing.
            expect(
                optsOk || annotatedOk,
                fn.name + ' calls saveToStorage but neither accepts `opts` nor carries a `// @user-mutation-only` annotation. '
                    + 'Either forward opts through saveToStorage(opts) (sync-safe), '
                    + 'or annotate the function as deliberately user-mutation-only.'
            ).toBe(true);
        });
    });

    // Pin the known sync-safe set so a future rename or accidental
    // removal of the opts parameter from sortCompletedToBottom or
    // replaceAllProjects fails loudly here instead of waiting for the
    // sync indicator regression to land in production.
    it('sortCompletedToBottom is on the sync-safe (accepts opts) list', () => {
        const fn = FUNCTIONS.find(function(f) { return f.name === 'sortCompletedToBottom'; });
        expect(fn).toBeTruthy();
        expect(acceptsOpts(fn.params)).toBe(true);
    });

    it('replaceAllProjects is on the sync-safe (accepts opts) list', () => {
        const fn = FUNCTIONS.find(function(f) { return f.name === 'replaceAllProjects'; });
        expect(fn).toBeTruthy();
        expect(acceptsOpts(fn.params)).toBe(true);
    });
});
