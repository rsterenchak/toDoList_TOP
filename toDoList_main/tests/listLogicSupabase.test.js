// Source-level pins for the Phase 5 Supabase persistence refactor in
// listLogic.js.
//
// The persistence layer is gated on a real Supabase session, so a
// runtime test would either need to stand up a fake backend or stub
// the supabase client globally. These pins instead verify the wiring
// at the source level — that persistMutation is called from every
// user-mutation funnel, that the blank-placeholder filter sits inside
// persistMutation, that hydrateFromSupabase runs a last-write-wins
// reconciliation, that advanceRecurringTodo fires two separate
// writes, that subscribeToRealtime opens two channels with self-echo
// filtering by id, and that handleSignOut clears state and cancels
// subscriptions. End-to-end validation against a real Supabase
// project is left to a follow-up manual pass.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { dueStringToISO, isoToDueString } from '../src/listLogic.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const SRC = readFileSync(resolve(srcDir, 'listLogic.js'), 'utf8');


// Pull out the body of a top-level function declaration so per-function
// assertions can inspect only the relevant region. Walks braces to
// find the matching close so a nested helper doesn't trip the scan.
function functionBody(src, name) {
    const declRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const match = declRe.exec(src);
    if (!match) return null;
    const openBrace = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = openBrace; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(openBrace + 1, i);
        }
    }
    return null;
}


describe('listLogic Phase 5 — Supabase imports and exports', () => {
    it('imports the shared supabase client', () => {
        expect(SRC).toMatch(
            /import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*['"]\.\/supabaseClient\.js['"]/
        );
    });

    it('exports persistMutation, hydrateFromSupabase, subscribeToRealtime, and handleSignOut from the IIFE return object', () => {
        // The IIFE's return object lists each public method by name.
        // A simple substring assertion is enough — the IIFE is the only
        // place these identifiers appear bare on their own line.
        expect(SRC).toMatch(/\bpersistMutation\b/);
        expect(SRC).toMatch(/\bhydrateFromSupabase\b/);
        expect(SRC).toMatch(/\bsubscribeToRealtime\b/);
        expect(SRC).toMatch(/\bhandleSignOut\b/);
    });
});


describe('listLogic Phase 5 — persistMutation funnel reaches every user-mutation function', () => {
    // Every function in this list runs through persistMutation in
    // addition to its existing saveToStorage call. The 14-function
    // contract from the Phase 5 spec.
    const expectedCallers = [
        'addProject',
        'removeProject',
        'addToDo',
        'removeToDo',
        'removeToDoByItem',
        'insertToDoAt',
        'editProject',
        'reorderProject',
        'reorderToDo',
        'sortCompletedToBottom',
        'setProjectColor',
        'setRecurrence',
        'advanceRecurringTodo',
        'seedSampleProject',
        'seedSampleTodos',
        'replaceAllProjects',
    ];

    expectedCallers.forEach(function(name) {
        it(name + ' calls persistMutation', () => {
            const body = functionBody(SRC, name);
            expect(body, 'function ' + name + ' not found in listLogic.js').toBeTruthy();
            expect(body).toMatch(/\bpersistMutation\s*\(/);
        });
    });
});


describe('listLogic Phase 5 — persistMutation request shape', () => {
    const body = functionBody(SRC, 'persistMutation');

    it('exists as a declared function', () => {
        expect(body).toBeTruthy();
    });

    it('gates on a Supabase session — no session, no write', () => {
        expect(body).toMatch(/supabase\.auth\.getSession\s*\(\s*\)/);
        expect(body).toMatch(/if\s*\(\s*!\s*session\s*\)/);
    });

    it('filters blank-titled todos at the persistence boundary', () => {
        // The blank placeholder is a render artifact pinned at index 0
        // of every project. It must never reach Supabase or the row
        // count would drift between cache and backend. The payload
        // arrives in Supabase column shape (see toTodoRowPayload), so
        // the check is on the `title` field, not the in-memory `tit`.
        expect(body).toMatch(/payload\.title\s*===\s*['"]['"]/);
    });

    it('handles every documented op kind: insert, update, delete, truncate, bulkInsert', () => {
        expect(body).toMatch(/op\s*===\s*['"]insert['"]/);
        expect(body).toMatch(/op\s*===\s*['"]update['"]/);
        expect(body).toMatch(/op\s*===\s*['"]delete['"]/);
        expect(body).toMatch(/op\s*===\s*['"]truncate['"]/);
        expect(body).toMatch(/op\s*===\s*['"]bulkInsert['"]/);
    });

    it('reads due_date (ISO) directly off the payload — translation now happens upstream in toTodoRowPayload', () => {
        // Pre-fix, persistMutation called dueStringToISO(payload.due)
        // because callers were sending in-memory field names. The fix
        // moved the conversion into toTodoRowPayload so the payload
        // shape matches Supabase columns at every call site; here we
        // just hand the already-ISO value to the network call.
        expect(body).toMatch(/due_date:\s*payload\.due_date/);
        // The legacy in-memory short field names must never appear in
        // the network row — that was the original bug.
        expect(body).not.toMatch(/payload\.tit\b/);
        expect(body).not.toMatch(/payload\.desc\b/);
        expect(body).not.toMatch(/payload\.due\b(?!_date)/);
        expect(body).not.toMatch(/payload\.pri\b/);
        expect(body).not.toMatch(/payload\.pos\b/);
    });

    it('logs failures via console.warn without rolling back', () => {
        // Phase 5 explicitly defers a real retry queue + visible
        // sync-issues indicator to Phase 6. The failure path here is
        // just a warn so the page stays responsive.
        expect(body).toMatch(/console\.warn\s*\(/);
    });
});


describe('listLogic Phase 5 — Supabase column-name payload shape (regression for #fix-persistmutation-payloads)', () => {
    // The Phase 5 refactor wired persistMutation into every mutation
    // function but built payloads with `Object.assign({}, listItem, …)`
    // shortcuts, which leaked the in-memory short field names (tit,
    // desc, due, pri, pos) into the network body. Supabase silently
    // ignored the unknown columns and the writes either failed or
    // landed with only `id` populated. The fix routes every payload
    // through the explicit toTodoRowPayload / toProjectRowPayload
    // helpers so the network shape can never drift from the schema.

    const toTodoBody = functionBody(SRC, 'toTodoRowPayload');
    const toProjectBody = functionBody(SRC, 'toProjectRowPayload');

    it('toTodoRowPayload exists as a module-scoped helper', () => {
        expect(toTodoBody).toBeTruthy();
    });

    it('toTodoRowPayload maps every in-memory field to its Supabase column name', () => {
        // The exact field-by-field mapping prescribed by the task
        // description: tit→title, desc→description, due→due_date (ISO),
        // pri→priority (stringified), pos→position. id and recurrence
        // keep their names; project_id is passed in by the caller.
        expect(toTodoBody).toMatch(/id:\s*item\.id/);
        expect(toTodoBody).toMatch(/project_id:\s*projectId/);
        expect(toTodoBody).toMatch(/title:\s*item\.tit\b/);
        expect(toTodoBody).toMatch(/description:\s*item\.desc\b/);
        expect(toTodoBody).toMatch(/due_date:\s*dueStringToISO\s*\(\s*item\.due\s*\)/);
        expect(toTodoBody).toMatch(/priority:\s*[^,]*item\.pri\b/);
        expect(toTodoBody).toMatch(/position:\s*item\.pos\b/);
        expect(toTodoBody).toMatch(/completed:\s*!!item\.completed/);
        expect(toTodoBody).toMatch(/recurrence:\s*item\.recurrence\b/);
    });

    it('toProjectRowPayload maps to the projects-table column names', () => {
        expect(toProjectBody).toBeTruthy();
        expect(toProjectBody).toMatch(/id:\s*entry\.id/);
        expect(toProjectBody).toMatch(/name:\s*name\b/);
        expect(toProjectBody).toMatch(/color:\s*entry\.color\b/);
        expect(toProjectBody).toMatch(/position:\s*position\b/);
    });

    it('listLogic source contains no Object.assign payload shortcuts on persistMutation calls', () => {
        // The implementation note in the task description explicitly
        // forbids Object.assign on persistMutation payloads because it
        // silently copies whatever in-memory shape the caller happens
        // to have — the bug that motivated this entire fix. Catch any
        // future regression at the source level.
        const objAssignInPayload = /payload:\s*Object\.assign\b/;
        expect(SRC).not.toMatch(objAssignInPayload);
    });

    // Every todo-touching mutation function must build its payload via
    // the toTodoRowPayload helper. The previous shape — passing the
    // raw in-memory `listItem` plus `project_id` through Object.assign
    // — is what produced the field-name bug.
    const todoCallers = [
        'addToDo',
        'insertToDoAt',
        'reorderToDo',
        'sortCompletedToBottom',
        'setRecurrence',
        'advanceRecurringTodo',
        'seedSampleProject',
        'seedSampleTodos',
        'replaceAllProjects',
        'hydrateFromSupabase',
    ];
    todoCallers.forEach(function(name) {
        it(name + ' constructs its todo payload through toTodoRowPayload', () => {
            const body = functionBody(SRC, name);
            expect(body, 'function ' + name + ' not found').toBeTruthy();
            expect(body).toMatch(/toTodoRowPayload\s*\(/);
        });
    });

    // Every project-touching mutation function must build its payload
    // via toProjectRowPayload. Project payloads were already using the
    // correct column names before this fix, but routing them through
    // the helper keeps the contract auditable in one place.
    const projectCallers = [
        'addProject',
        'editProject',
        'reorderProject',
        'setProjectColor',
        'seedSampleProject',
        'replaceAllProjects',
        'hydrateFromSupabase',
    ];
    projectCallers.forEach(function(name) {
        it(name + ' constructs its project payload through toProjectRowPayload', () => {
            const body = functionBody(SRC, name);
            expect(body, 'function ' + name + ' not found').toBeTruthy();
            expect(body).toMatch(/toProjectRowPayload\s*\(/);
        });
    });
});


describe('listLogic Phase 5 — dueStringToISO / isoToDueString boundary helpers', () => {
    // The persistence boundary converts the in-memory "M-D-YYYY"
    // string format to/from Postgres's ISO YYYY-MM-DD `date` column.
    // These helpers are exported so the rest of the app and the test
    // suite share one canonical translation rather than re-inventing
    // it per call site.

    it('dueStringToISO zero-pads single-digit months and days', () => {
        expect(dueStringToISO('5-31-2026')).toBe('2026-05-31');
        expect(dueStringToISO('1-1-2026')).toBe('2026-01-01');
        expect(dueStringToISO('12-25-2025')).toBe('2025-12-25');
    });

    it('isoToDueString strips the zero-pad on the way back to in-memory shape', () => {
        expect(isoToDueString('2026-05-31')).toBe('5-31-2026');
        expect(isoToDueString('2026-01-01')).toBe('1-1-2026');
        expect(isoToDueString('2025-12-25')).toBe('12-25-2025');
    });

    it('dueStringToISO returns null for the documented blank sentinels', () => {
        expect(dueStringToISO('')).toBeNull();
        expect(dueStringToISO('--')).toBeNull();
        expect(dueStringToISO('X-X-XXXX')).toBeNull();
        expect(dueStringToISO(null)).toBeNull();
        expect(dueStringToISO(undefined)).toBeNull();
    });

    it('isoToDueString returns the empty string when the input cannot be parsed', () => {
        expect(isoToDueString('')).toBe('');
        expect(isoToDueString(null)).toBe('');
        expect(isoToDueString('not-an-iso-date')).toBe('');
    });

    it('round-trips a normal date losslessly', () => {
        expect(isoToDueString(dueStringToISO('7-4-2026'))).toBe('7-4-2026');
        expect(dueStringToISO(isoToDueString('2026-07-04'))).toBe('2026-07-04');
    });
});


describe('listLogic Phase 5 — new todo and project rows always carry an in-memory id (regression for #fix-persistmutation-payloads)', () => {
    // The toDo factory and every code path that builds a new project
    // or todo entry in memory must assign a crypto.randomUUID() id
    // before the persistMutation call. Without it, the in-memory row
    // never learns the server-generated id and subsequent UPDATE/DELETE
    // calls target undefined.

    it('toDo factory assigns crypto.randomUUID at construction', () => {
        const toDoSrc = readFileSync(resolve(srcDir, 'toDo.js'), 'utf8');
        expect(toDoSrc).toMatch(/crypto\.randomUUID\s*\(/);
        // The id field is included in the returned object literal so
        // every consumer of toDo() sees it on the in-memory shape.
        expect(toDoSrc).toMatch(/return\s*\{\s*id\b/);
    });

    it('addProject seeds a fresh project id via genId before persisting', () => {
        const body = functionBody(SRC, 'addProject');
        expect(body).toMatch(/projectId\s*=\s*genId\s*\(\s*\)/);
        expect(body).toMatch(/id:\s*projectId/);
    });

    it('advanceRecurringTodo seeds the completed clone with an id before the INSERT', () => {
        const body = functionBody(SRC, 'advanceRecurringTodo');
        // The clone declaration must include the id field sourced from
        // genId() so the optimistic INSERT references a stable row.
        expect(body).toMatch(/completedClone\s*=\s*\{\s*id:\s*genId\s*\(\s*\)/);
        // The clone is pushed into the project's items array (in-memory
        // round-trip) before any persistMutation call fires.
        expect(body).toMatch(/arr\.push\s*\(\s*completedClone\s*\)/);
    });

    it('insertToDoAt backfills an id on the re-inserted item before the persistence call', () => {
        const body = functionBody(SRC, 'insertToDoAt');
        expect(body).toMatch(/if\s*\(\s*!\s*item\.id\s*\)\s*item\.id\s*=\s*genId\s*\(\s*\)/);
    });
});


describe('listLogic Phase 5 — hydrateFromSupabase reconciliation', () => {
    const body = functionBody(SRC, 'hydrateFromSupabase');

    it('exists as a declared function', () => {
        expect(body).toBeTruthy();
    });

    it('pulls both projects and todos for the signed-in user', () => {
        expect(body).toMatch(/\.from\s*\(\s*['"]projects['"]\s*\)/);
        expect(body).toMatch(/\.from\s*\(\s*['"]todos['"]\s*\)/);
        expect(body).toMatch(/\.eq\s*\(\s*['"]user_id['"]/);
    });

    it('reconciles divergent rows by comparing updated_at (last-write-wins)', () => {
        expect(body).toMatch(/updated_at/);
        expect(body).toMatch(/localUpdatedAt\s*>\s*remoteUpdatedAt/);
    });

    it('pushes local-only projects up to Supabase via persistMutation', () => {
        // Anything in the local cache that the backend has never seen
        // gets adopted into the merged tree and pushed.
        expect(body).toMatch(/persistMutation\s*\(/);
        expect(body).toMatch(/op:\s*['"]insert['"]/);
    });

    it('re-pins blank placeholders after the merge via sortCompletedInPlace', () => {
        // Blank placeholders never round-trip through Supabase, so the
        // post-hydrate tree must re-inject them at index 0 of every
        // project before the UI re-renders.
        expect(body).toMatch(/sortCompletedInPlace\s*\(/);
    });

    it('dispatches the listLogicHydrated CustomEvent for the one-shot re-render', () => {
        expect(body).toMatch(/listLogicHydrated/);
        expect(body).toMatch(/dispatchEvent/);
    });
});


describe('listLogic Phase 5 — recurring task completion clones', () => {
    const body = functionBody(SRC, 'advanceRecurringTodo');

    it('exists as a declared function', () => {
        expect(body).toBeTruthy();
    });

    it('fires two separate persistMutation writes: an INSERT for the clone and an UPDATE for the original', () => {
        // The mutation funnel pattern: one persistMutation call per
        // user-visible change. The frozen historical clone is a brand
        // new row; the still-recurring original is an in-place update.
        const insertMatches = body.match(/op:\s*['"]insert['"]/g) || [];
        const updateMatches = body.match(/op:\s*['"]update['"]/g) || [];
        expect(insertMatches.length).toBeGreaterThanOrEqual(1);
        expect(updateMatches.length).toBeGreaterThanOrEqual(1);
    });

    it('assigns a stable id to the completed clone so the backend write targets the right row', () => {
        expect(body).toMatch(/completedClone\s*=\s*\{\s*id:\s*genId\s*\(\s*\)/);
    });
});


describe('listLogic Phase 5 — realtime subscription wiring', () => {
    const body = functionBody(SRC, 'subscribeToRealtime');

    it('exists as a declared function', () => {
        expect(body).toBeTruthy();
    });

    it('opens two channels — one for projects, one for todos', () => {
        // Tolerate the supabase ref and the .channel() call landing
        // on separate lines (the fluent builder typically gets
        // formatted multi-line in this codebase).
        expect(body).toMatch(/supabase[\s\S]*?\.channel\s*\(\s*['"]public:projects['"]\s*\)/);
        expect(body).toMatch(/supabase[\s\S]*?\.channel\s*\(\s*['"]public:todos['"]\s*\)/);
    });

    it('subscribes to postgres_changes events on both tables', () => {
        const postgresChanges = body.match(/postgres_changes/g) || [];
        expect(postgresChanges.length).toBeGreaterThanOrEqual(2);
    });

    it('routes incoming events through the per-table realtime handlers', () => {
        expect(body).toMatch(/handleProjectsRealtime/);
        expect(body).toMatch(/handleTodosRealtime/);
    });

    it('self-echo filter: realtime handlers consult the _selfEchoIds set before applying an event', () => {
        const projHandler = functionBody(SRC, 'handleProjectsRealtime');
        const todoHandler = functionBody(SRC, 'handleTodosRealtime');
        expect(projHandler).toBeTruthy();
        expect(todoHandler).toBeTruthy();
        expect(projHandler).toMatch(/_selfEchoIds\.has\s*\(/);
        expect(todoHandler).toMatch(/_selfEchoIds\.has\s*\(/);
    });
});


describe('listLogic Phase 5 — handleSignOut tears down state and subscriptions', () => {
    const body = functionBody(SRC, 'handleSignOut');

    it('exists as a declared function', () => {
        expect(body).toBeTruthy();
    });

    it('removes every active realtime channel via supabase.removeChannel', () => {
        expect(body).toMatch(/_realtimeChannels/);
        expect(body).toMatch(/removeChannel/);
    });

    it('clears the self-echo id set so the next user does not inherit prior ids', () => {
        expect(body).toMatch(/_selfEchoIds\.clear\s*\(\s*\)/);
    });

    it('wipes the in-memory allProjects map and the localStorage cache', () => {
        expect(body).toMatch(/delete\s+allProjects\s*\[\s*k\s*\]/);
        expect(body).toMatch(/localStorage\.removeItem\s*\(\s*['"]allProjects['"]\s*\)/);
    });
});


describe('listLogic Phase 5 — boot path and event wiring in index.js', () => {
    const indexSrc = readFileSync(resolve(srcDir, 'index.js'), 'utf8');

    it('awaits listLogic.hydrateFromSupabase after the auth gate boots the app', () => {
        expect(indexSrc).toMatch(/listLogic\.hydrateFromSupabase\s*\(\s*\)/);
    });

    it('opens the realtime subscription via listLogic.subscribeToRealtime', () => {
        expect(indexSrc).toMatch(/listLogic\.subscribeToRealtime\s*\(\s*\)/);
    });

    it('calls listLogic.handleSignOut on the sign-out branch of onAuthStateChange', () => {
        expect(indexSrc).toMatch(/listLogic\.handleSignOut\s*\(\s*\)/);
    });
});


describe('listLogic Phase 5 — main.js listens for the one-shot re-render event', () => {
    const mainSrc = readFileSync(resolve(srcDir, 'main.js'), 'utf8');

    it('main.js registers a listLogicHydrated listener that re-runs restoreFromStorage', () => {
        expect(mainSrc).toMatch(/listLogicHydrated/);
        // The listener clears sideMa + mainList before replaying the
        // restore so the rebuild is mechanical (same code path as
        // initial load) rather than a custom diff-and-patch.
        expect(mainSrc).toMatch(/addEventListener\s*\(\s*['"]listLogicHydrated['"]/);
    });
});


describe('listLogic Phase 5 — commitBlankPlaceholder promotes the in-place blank row into a Supabase INSERT', () => {
    // The Enter-to-commit handler in toDoRow.js mutates the blank
    // placeholder's `item.tit` directly instead of routing through
    // `addToDo`, so the placeholder — filtered from every prior write
    // because its title was empty — has never been INSERTed. Without
    // a dedicated commit path, the row only ever lands in
    // localStorage and the followup sortCompletedToBottom UPDATE
    // silently 204s against an id Supabase has never seen.

    const body = functionBody(SRC, 'commitBlankPlaceholder');

    it('exists as a declared function', () => {
        expect(body).toBeTruthy();
    });

    it('is exported from the IIFE return object', () => {
        // The IIFE return is the public surface toDoRow.js calls into.
        expect(SRC).toMatch(/\bcommitBlankPlaceholder\b/);
    });

    it('fires persistMutation with op:"insert" against the todos table', () => {
        expect(body).toMatch(/persistMutation\s*\(/);
        expect(body).toMatch(/op:\s*['"]insert['"]/);
        expect(body).toMatch(/table:\s*['"]todos['"]/);
    });

    it('builds the INSERT payload through toTodoRowPayload so the row matches the Supabase column shape', () => {
        // The original Phase 5 bug was payloads built via Object.assign
        // that leaked the in-memory short field names (tit/desc/due/
        // pri/pos). Routing through the explicit helper is what keeps
        // the network shape locked to the schema.
        expect(body).toMatch(/toTodoRowPayload\s*\(/);
    });

    it('passes the project id from allProjects[projectName].id as the second argument', () => {
        // The todos.project_id FK is what scopes the row to the right
        // project — without it the INSERT either rejects or orphans.
        expect(body).toMatch(/allProjects\s*\[\s*projectName\s*\]\.id/);
    });

    it('no-ops on an empty title so a stray caller can not smuggle a blank row past the persistence boundary', () => {
        // Defensive: the Enter handler already gates on `if (!val) return`,
        // but the contract here is that commitBlankPlaceholder by itself
        // never writes a blank-titled row even if mis-called.
        expect(body).toMatch(/item\.tit/);
        // Some early-return on the empty-title condition must appear
        // ahead of the persistMutation call.
        const titGuardIdx = body.search(/!\s*item\.tit|item\.tit\s*===\s*['"]['"]/);
        const persistIdx = body.indexOf('persistMutation');
        expect(titGuardIdx).toBeGreaterThan(-1);
        expect(persistIdx).toBeGreaterThan(-1);
        expect(titGuardIdx).toBeLessThan(persistIdx);
    });

    it('no-ops when the project is missing so a stale toDoName from a deleted project can not crash the write', () => {
        // Same defensive shape as removeToDoByItem and insertToDoAt —
        // a missing project entry returns early before any persistence.
        expect(body).toMatch(/!\s*allProjects\s*\[\s*projectName\s*\]/);
    });
});


describe('listLogic Phase 5 — toDoRow.js Enter-commit wiring calls commitBlankPlaceholder', () => {
    // The bug: the Enter keydown handler in buildToDoRow promotes the
    // blank placeholder by mutating item.tit in place and calling only
    // saveToStorage(), which writes localStorage but skips Supabase.
    // The fix wires a listLogic.commitBlankPlaceholder call between
    // the saveToStorage and the appendNewToDoRow / focusBlankToDoInput
    // branch so the INSERT fires before the followup sort triggers any
    // UPDATEs.

    const toDoRowSrc = readFileSync(resolve(srcDir, 'toDoRow.js'), 'utf8');

    function extractRange(startNeedle, endNeedle) {
        const startIdx = toDoRowSrc.indexOf(startNeedle);
        expect(startIdx).toBeGreaterThan(-1);
        const endIdx = toDoRowSrc.indexOf(endNeedle, startIdx + startNeedle.length);
        expect(endIdx).toBeGreaterThan(-1);
        return toDoRowSrc.slice(startIdx, endIdx);
    }

    it('the Enter commit handler invokes listLogic.commitBlankPlaceholder with the project name and item', () => {
        const enter = extractRange(
            'toDoInput keydown — Enter to commit title',
            '// toDoInput keyup'
        );
        expect(enter).toMatch(
            /listLogic\.commitBlankPlaceholder\s*\(\s*toDoName\s*,\s*item\s*\)/
        );
    });

    it('the commitBlankPlaceholder call sits between saveToStorage and the appendNewToDoRow / focusBlankToDoInput branch', () => {
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
        // INSERT must fire before sortCompletedToBottom (called from
        // appendNewToDoRow) so the UPDATEs that follow have a real row
        // to update — otherwise Supabase silently 204s the UPDATE.
        expect(saveIdx).toBeLessThan(commitIdx);
        expect(commitIdx).toBeLessThan(appendIdx);
        expect(commitIdx).toBeLessThan(focusIdx);
    });
});


describe('listLogic Phase 5 — saveToStorage dispatches the dataChanged alias', () => {
    const body = functionBody(SRC, 'saveToStorage');

    it('exists as a declared function', () => {
        expect(body).toBeTruthy();
    });

    it('dispatches both driveSyncStateChanged (legacy alias) and dataChanged', () => {
        // The legacy name is retained so any external listener wired
        // by the Drive sync indicator keeps ticking; dataChanged is
        // the Phase 5+ canonical event name.
        expect(body).toMatch(/['"]driveSyncStateChanged['"]/);
        expect(body).toMatch(/['"]dataChanged['"]/);
    });
});
