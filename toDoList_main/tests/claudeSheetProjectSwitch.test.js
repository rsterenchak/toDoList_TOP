import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';
import {
    mountClaudeSheet,
    syncClaudeSheetForProject,
    isClaudeUnavailable,
    isClaudeSheetOpen,
    CLAUDE_UNAVAILABLE_MSG,
} from '../src/claudeSheet.js';
import { initInjectConfig } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';
import { isChatPaneCollapsed, setChatPaneCollapsed } from '../src/prefs.js';

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

// The Claude chat surface on desktop is the docked pane (#desktopChatPane),
// shown/hidden by the `chatPaneCollapsed` body class that the chat expand /
// collapse buttons drive — NOT the mobile slide-up sheet. So a project switch
// must toggle that pane: repo-backed projects expand it, repo-less projects
// collapse it, and the choice persists via setChatPaneCollapsed.
describe('syncClaudeSheetForProject — auto-expand/collapse chat pane on project switch', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
        document.body.className = '';
        listLogic._reset();
        mountClaudeSheet(document.body);
    });

    it('expands the chat pane when a repo-backed project becomes active', () => {
        setInjectConfigured(true);
        seedProject('Repo', 'tgt-1');
        // Start from a collapsed pane to prove the switch expands it.
        document.body.classList.add('chatPaneCollapsed');
        setChatPaneCollapsed(true);

        syncClaudeSheetForProject('Repo');
        expect(document.body.classList.contains('chatPaneCollapsed')).toBe(false);
        expect(isChatPaneCollapsed()).toBe(false);
    });

    it('collapses the chat pane when the new project has no repo configured', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);
        expect(document.body.classList.contains('chatPaneCollapsed')).toBe(false);

        syncClaudeSheetForProject('NoRepo');
        expect(document.body.classList.contains('chatPaneCollapsed')).toBe(true);
        expect(isChatPaneCollapsed()).toBe(true);
    });

    it('collapses the pane when inject is unconfigured even if the project has a target', () => {
        // No bolt shows without global inject config, so no auto-expand either.
        setInjectConfigured(false);
        seedProject('Repo', 'tgt-1');

        syncClaudeSheetForProject('Repo');
        expect(document.body.classList.contains('chatPaneCollapsed')).toBe(true);
        expect(isChatPaneCollapsed()).toBe(true);
    });

    it('keeps an already-expanded repo-backed pane expanded (idempotent re-switch)', () => {
        setInjectConfigured(true);
        seedProject('Repo', 'tgt-1');
        syncClaudeSheetForProject('Repo');
        expect(document.body.classList.contains('chatPaneCollapsed')).toBe(false);

        syncClaudeSheetForProject('Repo');
        expect(document.body.classList.contains('chatPaneCollapsed')).toBe(false);
        expect(isChatPaneCollapsed()).toBe(false);
    });

    it('persists the collapsed preference so the pane state survives reload', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);

        syncClaudeSheetForProject('NoRepo');
        expect(isChatPaneCollapsed()).toBe(true);
    });
});

// A project with no routed repo must present the assistant's entry points as
// visible-but-inert: one `claudeUnavailable` body flag drives the dimmed CSS on
// the launcher and expand tab, flips their aria-disabled, and makes a tap a
// no-op-plus-tooltip instead of opening a chat against the wrong repo. The flag
// clears the moment a repo-backed project becomes active.
describe('syncClaudeSheetForProject — gate the assistant off with no repo', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
        document.body.className = '';
        listLogic._reset();
        mountClaudeSheet(document.body);
    });

    it('sets the claudeUnavailable flag when the project has no repo', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);

        syncClaudeSheetForProject('NoRepo');
        expect(document.body.classList.contains('claudeUnavailable')).toBe(true);
        expect(isClaudeUnavailable()).toBe(true);
    });

    it('clears the flag when a repo-backed project becomes active', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);
        seedProject('Repo', 'tgt-1');

        syncClaudeSheetForProject('NoRepo');
        expect(isClaudeUnavailable()).toBe(true);

        syncClaudeSheetForProject('Repo');
        expect(document.body.classList.contains('claudeUnavailable')).toBe(false);
        expect(isClaudeUnavailable()).toBe(false);
    });

    it('treats unconfigured inject as unavailable even with a target', () => {
        setInjectConfigured(false);
        seedProject('Repo', 'tgt-1');

        syncClaudeSheetForProject('Repo');
        expect(isClaudeUnavailable()).toBe(true);
    });

    it('marks the launcher aria-disabled with an explanatory title when unavailable', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);

        syncClaudeSheetForProject('NoRepo');
        const launcher = document.getElementById('claudeLauncher');
        expect(launcher.getAttribute('aria-disabled')).toBe('true');
        expect(launcher.getAttribute('title')).toBe(CLAUDE_UNAVAILABLE_MSG);
    });

    it('restores the launcher when a repo is routed', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);
        seedProject('Repo', 'tgt-1');

        syncClaudeSheetForProject('NoRepo');
        syncClaudeSheetForProject('Repo');
        const launcher = document.getElementById('claudeLauncher');
        expect(launcher.hasAttribute('aria-disabled')).toBe(false);
        // Original launcher title is restored, not the unavailable message.
        expect(launcher.getAttribute('title')).toBe('Claude');
    });

    it('tapping the launcher while unavailable is a no-op that shows a tooltip', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);

        syncClaudeSheetForProject('NoRepo');
        const launcher = document.getElementById('claudeLauncher');
        launcher.click();

        expect(isClaudeSheetOpen()).toBe(false);
        const tip = document.querySelector('.claudeUnavailableTooltip');
        expect(tip).not.toBeNull();
        expect(tip.textContent).toBe(CLAUDE_UNAVAILABLE_MSG);
    });

    it('tapping the launcher opens the sheet once a repo is routed', () => {
        setInjectConfigured(true);
        seedProject('Repo', 'tgt-1');

        syncClaudeSheetForProject('Repo');
        const launcher = document.getElementById('claudeLauncher');
        launcher.click();

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

    it('main.js gates the chat expand tab through isClaudeUnavailable', () => {
        const main = read('main.js');
        expect(main)
            .toMatch(/import\s*\{[^}]*isClaudeUnavailable[^}]*\}\s*from\s*['"]\.\/claudeSheet\.js['"]/);
        expect(main).toMatch(/isClaudeUnavailable\(\)/);
        expect(main).toMatch(/showClaudeUnavailableTooltip\(/);
    });
});
