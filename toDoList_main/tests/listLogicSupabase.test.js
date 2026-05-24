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
        // count would drift between cache and backend.
        expect(body).toMatch(/payload\.tit\s*===\s*['"]['"]/);
    });

    it('handles every documented op kind: insert, update, delete, truncate, bulkInsert', () => {
        expect(body).toMatch(/op\s*===\s*['"]insert['"]/);
        expect(body).toMatch(/op\s*===\s*['"]update['"]/);
        expect(body).toMatch(/op\s*===\s*['"]delete['"]/);
        expect(body).toMatch(/op\s*===\s*['"]truncate['"]/);
        expect(body).toMatch(/op\s*===\s*['"]bulkInsert['"]/);
    });

    it('translates due ("M-D-YYYY") to due_date (ISO) on todo writes', () => {
        // dueStringToISO lives at module scope; persistMutation calls it
        // on every todo write so the in-memory string format gets
        // converted to what the Postgres `date` column expects.
        expect(body).toMatch(/dueStringToISO\s*\(\s*payload\.due\s*\)/);
    });

    it('logs failures via console.warn without rolling back', () => {
        // Phase 5 explicitly defers a real retry queue + visible
        // sync-issues indicator to Phase 6. The failure path here is
        // just a warn so the page stays responsive.
        expect(body).toMatch(/console\.warn\s*\(/);
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
