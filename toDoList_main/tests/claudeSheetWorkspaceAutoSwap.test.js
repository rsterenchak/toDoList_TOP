import { vi } from 'vitest';
import { mountClaudeSheet, syncClaudeSheetForProject } from '../src/claudeSheet.js';
import { initInjectConfig, loadInjectTargets } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

// claudeSheet → inject → supabaseClient. Stub the shared client so module import
// doesn't reach the network. `hoisted.rows` backs the inject_targets query, so a
// test can populate the targets cache by setting it and calling loadInjectTargets.
const hoisted = vi.hoisted(() => ({ rows: [] }));

vi.mock('../src/supabaseClient.js', () => {
    function makeQuery() {
        const q = {
            select: function() { return q; },
            order: function() { return Promise.resolve({ data: hoisted.rows, error: null }); },
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

function setInjectConfigured() {
    localStorage.setItem(URL_KEY, 'https://worker.example');
    localStorage.setItem(SECRET_KEY, 'shh');
    initInjectConfig();
}

function seedProject(name, targetId) {
    listLogic.addProject(name);
    if (targetId) listLogic.setProjectTargetId(name, targetId);
}

// Set the inject-targets cache the workspace resolver reads.
async function seedTargets(rows) {
    hoisted.rows = rows;
    await loadInjectTargets();
}

function pillText() {
    const pill = document.querySelector('#claudeWorkspacePill');
    return pill ? pill.textContent : '';
}

// Auto-swapping the chat workspace to the active project's configured inject
// repo on a project switch. Unlike the manual pill switch, this preserves the
// conversation: chatHistory, attachments, and on-screen messages survive.
describe('syncClaudeSheetForProject — auto-swap chat workspace to the project repo', () => {
    beforeEach(async () => {
        localStorage.clear();
        document.body.innerHTML = '';
        document.body.className = '';
        listLogic._reset();
        // Start every test from an empty cache so mount doesn't inherit a prior
        // test's targets (mountClaudeSheet projects from the cache synchronously).
        await seedTargets([]);
        mountClaudeSheet(document.body);
        setInjectConfigured();
    });

    it('repaints the workspace to the project\'s configured repo on switch', async () => {
        await seedTargets([
            { id: 't1', repo: 'me/RepoA' },
            { id: 't2', repo: 'me/RepoB' },
        ]);
        seedProject('Alpha', 't1');

        syncClaudeSheetForProject('Alpha');
        expect(pillText()).toContain('RepoA');
    });

    it('re-points the workspace each time the active project changes', async () => {
        await seedTargets([
            { id: 't1', repo: 'me/RepoA' },
            { id: 't2', repo: 'me/RepoB' },
        ]);
        seedProject('Alpha', 't1');
        seedProject('Beta', 't2');

        syncClaudeSheetForProject('Alpha');
        expect(pillText()).toContain('RepoA');

        syncClaudeSheetForProject('Beta');
        expect(pillText()).toContain('RepoB');
    });

    it('preserves the conversation across an auto-swap (no chat wipe)', async () => {
        await seedTargets([{ id: 't1', repo: 'me/RepoA' }]);
        seedProject('Alpha', 't1');

        // Plant an on-screen message; a destructive switch would clear it.
        const surface = document.querySelector('#claudeChatSurface');
        const bubble = document.createElement('div');
        bubble.className = 'claudeMsg';
        bubble.textContent = 'hello';
        surface.appendChild(bubble);

        syncClaudeSheetForProject('Alpha');

        expect(pillText()).toContain('RepoA');
        expect(document.querySelector('#claudeChatSurface').textContent).toContain('hello');
    });

    it('leaves the workspace untouched when the project has no target', async () => {
        await seedTargets([{ id: 't1', repo: 'me/RepoA' }]);
        seedProject('Alpha', 't1');
        seedProject('NoRepo', null);

        syncClaudeSheetForProject('Alpha');
        expect(pillText()).toContain('RepoA');

        // Switching to a repo-less project must not change the workspace.
        syncClaudeSheetForProject('NoRepo');
        expect(pillText()).toContain('RepoA');
    });

    it('leaves the workspace untouched when the target is no longer cached', async () => {
        await seedTargets([{ id: 't1', repo: 'me/RepoA' }]);
        seedProject('Alpha', 't1');
        seedProject('Ghost', 'missing-id');

        syncClaudeSheetForProject('Alpha');
        expect(pillText()).toContain('RepoA');

        // A target_id that no longer resolves leaves the active workspace as-is.
        syncClaudeSheetForProject('Ghost');
        expect(pillText()).toContain('RepoA');
    });

    it('is a no-op when the project repo already equals the active workspace', async () => {
        await seedTargets([
            { id: 't1', repo: 'me/RepoA' },
            { id: 't2', repo: 'me/RepoB' },
        ]);
        seedProject('Alpha', 't1');
        seedProject('Alpha2', 't1');

        syncClaudeSheetForProject('Alpha');
        expect(pillText()).toContain('RepoA');

        // Same repo on a second project — workspace stays on RepoA, no throw.
        syncClaudeSheetForProject('Alpha2');
        expect(pillText()).toContain('RepoA');
    });
});
