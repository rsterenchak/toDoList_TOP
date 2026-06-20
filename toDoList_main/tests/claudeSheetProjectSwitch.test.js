import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';
import {
    mountClaudeSheet,
    openClaudeSheet,
    closeClaudeSheet,
    isClaudeSheetOpen,
    syncClaudeSheetForProject,
} from '../src/claudeSheet.js';
import { initInjectConfig } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

// claudeSheet → inject → supabaseClient. Stub the shared client so module import
// doesn't reach the network; this mirrors the minimal surface other claudeSheet
// tests rely on (auth/from/channel/removeChannel).
vi.mock('../src/supabaseClient.js', () => {
    function makeQuery() {
        const q = {
            select: function() { return q; },
            order: function() { return Promise.resolve({ data: [], error: null }); },
            insert: function() { return Promise.resolve({ data: null, error: null }); },
            update: function() { return q; },
            delete: function() { return q; },
            eq: function() { return Promise.resolve({ data: null, error: null }); },
        };
        return q;
    }
    return {
        supabase: {
            auth: {
                getSession: function() { return Promise.resolve({ data: { session: null }, error: null }); },
                onAuthStateChange: function() { return { data: { subscription: { unsubscribe: function() {} } } }; },
                signInWithOtp: function() { return Promise.resolve({ data: null, error: { message: 'x' } }); },
                signOut: function() { return Promise.resolve({ error: null }); },
            },
            from: function() { return makeQuery(); },
            channel: function() { return { on: function() { return this; }, subscribe: function() { return this; }, unsubscribe: function() { return this; } }; },
            removeChannel: function() {},
        },
    };
});

const URL_KEY    = 'todoapp_injectWorkerUrl';
const SECRET_KEY = 'todoapp_injectSharedSecret';

// Drive isInjectConfigured() by seeding the per-device config keys, then loading
// them into the inject.js module cache exactly the way app boot does.
function setInjectConfigured(configured) {
    if (configured) {
        localStorage.setItem(URL_KEY, 'https://worker.example');
        localStorage.setItem(SECRET_KEY, 'shh');
    } else {
        localStorage.removeItem(URL_KEY);
        localStorage.removeItem(SECRET_KEY);
    }
    initInjectConfig();
}

// Create a project carrying (or not) a routed inject target — the same per-
// project association the sidebar thunderbolt reads.
function seedProject(name, targetId) {
    listLogic.addProject(name);
    if (targetId) listLogic.setProjectTargetId(name, targetId);
}

describe('syncClaudeSheetForProject — auto-open/close on project switch', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
        listLogic._reset();
        mountClaudeSheet(document.body);
    });

    it('opens the sheet when a repo-backed project becomes active', () => {
        setInjectConfigured(true);
        seedProject('Repo', 'tgt-1');
        expect(isClaudeSheetOpen()).toBe(false);

        syncClaudeSheetForProject('Repo');
        expect(isClaudeSheetOpen()).toBe(true);
    });

    it('closes an open sheet when the new project has no repo configured', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);
        openClaudeSheet();
        expect(isClaudeSheetOpen()).toBe(true);

        syncClaudeSheetForProject('NoRepo');
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('leaves a closed sheet closed when the new project has no repo', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);
        expect(isClaudeSheetOpen()).toBe(false);

        syncClaudeSheetForProject('NoRepo');
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('does NOT auto-open when inject is unconfigured even if the project has a target', () => {
        // No bolt shows without global inject config, so no auto-open either.
        setInjectConfigured(false);
        seedProject('Repo', 'tgt-1');

        syncClaudeSheetForProject('Repo');
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('closes the sheet for an unconfigured-inject project even with a target id set', () => {
        setInjectConfigured(false);
        seedProject('Repo', 'tgt-1');
        openClaudeSheet();
        expect(isClaudeSheetOpen()).toBe(true);

        syncClaudeSheetForProject('Repo');
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('keeps an already-open repo-backed sheet open (idempotent re-switch)', () => {
        setInjectConfigured(true);
        seedProject('Repo', 'tgt-1');
        openClaudeSheet();
        expect(isClaudeSheetOpen()).toBe(true);

        syncClaudeSheetForProject('Repo');
        expect(isClaudeSheetOpen()).toBe(true);
    });
});

// Static wiring guard: the helper is exported, and main.js routes project
// switches through it. Both projChild click handlers (component + restore) must
// call it so sidebar, dropdown, and prev/next navigation all auto-sync.
describe('project-switch auto-sync wiring', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const srcDir = resolve(here, '../src');
    const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

    it('claudeSheet.js exports syncClaudeSheetForProject', () => {
        expect(read('claudeSheet.js'))
            .toMatch(/export\s+function\s+syncClaudeSheetForProject\s*\(/);
    });

    it('main.js imports and calls syncClaudeSheetForProject', () => {
        const main = read('main.js');
        expect(main)
            .toMatch(/import\s*\{[^}]*syncClaudeSheetForProject[^}]*\}\s*from\s*['"]\.\/claudeSheet\.js['"]/);
        const calls = main.match(/syncClaudeSheetForProject\(/g) || [];
        // two click-handler call sites (the import reference has no paren)
        expect(calls.length).toBeGreaterThanOrEqual(2);
    });
});
