import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { backlogRunTitle } from '../src/todoMdViewer.js';
import { mountClaudeSheet, trackDispatchedRun } from '../src/claudeSheet.js';
import { setQueueRows } from '../src/agentQueueStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// claudeSheet → inject → supabaseClient, and agentQueueStore → supabaseClient.
// Stub the shared client so importing these modules never reaches the network
// (mirrors viewerRunsTabTracking.test.js).
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

// Run backlog labelled every dispatch "Backlog run", so two projects running at
// once produced two indistinguishable Runs-tab rows. The dispatch does name a
// task row — `projectName` is already in scope and already handed to the same
// trackDispatchedRun call as `project` — so the row can say which project it is
// running for until the post-run diff names the entry the routine actually took.
describe('backlogRunTitle — a backlog run is labelled by its task row', () => {
    it('uses the project name as the run title', () => {
        expect(backlogRunTitle('toDoList_TOP')).toBe('toDoList_TOP');
    });

    it('trims surrounding whitespace off the name', () => {
        expect(backlogRunTitle('  Matching Game  ')).toBe('Matching Game');
    });

    it('falls back to the generic label when the name is empty or whitespace', () => {
        expect(backlogRunTitle('')).toBe('Backlog run');
        expect(backlogRunTitle('   ')).toBe('Backlog run');
    });

    it('falls back to the generic label when the name is missing or not a string', () => {
        expect(backlogRunTitle(null)).toBe('Backlog run');
        expect(backlogRunTitle(undefined)).toBe('Backlog run');
        expect(backlogRunTitle()).toBe('Backlog run');
        expect(backlogRunTitle(42)).toBe('Backlog run');
    });
});

describe('Runs tab — a tracked backlog dispatch reads as its project', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        setQueueRows([], null);
    });

    afterEach(() => {
        localStorage.clear();
        setQueueRows([], null);
        // Re-mount against a throwaway node so the module's in-memory records
        // don't leak into the next test's list.
        mountClaudeSheet(document.createElement('div'));
        document.body.innerHTML = '';
    });

    it('renders the project name, not the generic label, for two concurrent runs', () => {
        mountClaudeSheet(document.body);
        trackDispatchedRun({
            correlationId: 'corr-backlog-a',
            title: backlogRunTitle('ProjA'),
            repo: 'owner/repo',
            project: 'ProjA',
            dispatchedAt: Date.now(),
        });
        trackDispatchedRun({
            correlationId: 'corr-backlog-b',
            title: backlogRunTitle('ProjB'),
            repo: 'owner/other',
            project: 'ProjB',
            dispatchedAt: Date.now(),
        });

        const titles = Array.from(document.querySelectorAll('.claudeRunTitle'))
            .map(function(el) { return el.textContent; });
        expect(titles).toContain('ProjA');
        expect(titles).toContain('ProjB');
        expect(titles).not.toContain('Backlog run');
    });
});

describe('TODO.md viewer — runBacklog titles its Runs-tab row from the project', () => {
    const viewer = read('todoMdViewer.js');
    const block = viewer.slice(
        viewer.indexOf('async function runBacklog'),
        viewer.indexOf('runBacklogBtn.addEventListener')
    );

    it('exports the title helper so the fallback is testable in isolation', () => {
        expect(viewer).toMatch(/export\s+function\s+backlogRunTitle\s*\(/);
    });

    it('hands trackDispatchedRun the derived title rather than a hardcoded label', () => {
        expect(block).toMatch(/title:\s*backlogRunTitle\(projectName\)/);
        expect(block).not.toMatch(/title:\s*['"]Backlog run['"]/);
    });

    it('derives the title from the closure value, not the card dataset', () => {
        // `projectName` is what the rest of the dispatch already uses (the
        // active-run record, the run guards), so it cannot drift from the run
        // being started the way a re-rendered dataset attribute could.
        expect(block).not.toMatch(/backlogRunTitle\(\s*card\.dataset/);
    });

    it('leaves the dispatch-time snapshot in place so the post-run rename still wins', () => {
        // The project name is the label BEFORE the diff resolves which entry the
        // routine took — not instead of it.
        expect(block).toMatch(/todoSnapshot:\s*card\.dataset\.content/);
    });
});
