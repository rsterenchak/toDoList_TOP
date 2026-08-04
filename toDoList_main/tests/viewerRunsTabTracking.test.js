import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mountClaudeSheet, trackDispatchedRun } from '../src/claudeSheet.js';
import { setQueueRows } from '../src/agentQueueStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// claudeSheet → inject → supabaseClient, and agentQueueStore → supabaseClient.
// Stub the shared client so importing these modules never reaches the network
// (mirrors runsTabQueueSource.test.js).
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

const RUNS_KEY = 'todoapp_claudeRuns';

function storedRuns() {
    try {
        return JSON.parse(localStorage.getItem(RUNS_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function rowTitles() {
    return Array.from(document.querySelectorAll('.claudeRunTitle')).map(function(el) { return el.textContent; });
}

function rowBadges() {
    return Array.from(document.querySelectorAll('.claudeRunBadge')).map(function(el) { return el.textContent; });
}

// A run dispatched from the TODO.md viewer ("Run backlog" / "Run this entry")
// writes only the viewer's own active-run entry, so it drove the viewer's header
// pill and nothing else — the chat sheet's Runs tab stayed empty until the entry
// was checked off in TODO.md, at which point the shipped spine surfaced it as
// SHIPPED with no preceding QUEUED/RUNNING row. trackDispatchedRun is the seam
// that gives those dispatches a live row under the SAME correlation id.
describe('Runs tab — viewer-dispatched runs are tracked live', () => {
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

    it('renders a QUEUED row for an entry run and persists it under todoapp_claudeRuns', () => {
        const now = Date.now();
        mountClaudeSheet(document.body);
        trackDispatchedRun({
            correlationId: 'corr-entry-1',
            entryId: 'entry-1',
            title: 'Fix the run pill',
            repo: 'owner/repo',
            project: 'ProjA',
            dispatchedAt: now,
        });

        expect(rowTitles()).toEqual(['Fix the run pill']);
        expect(rowBadges()).toEqual(['Queued']);

        const stored = storedRuns();
        expect(stored.length).toBe(1);
        expect(stored[0]).toMatchObject({
            correlationId: 'corr-entry-1',
            entryId: 'entry-1',
            status: 'QUEUED',
            repo: 'owner/repo',
            project: 'ProjA',
            dispatchedAt: now,
        });
    });

    it('tracks a backlog run with no entry id (the routine picks the task itself)', () => {
        mountClaudeSheet(document.body);
        trackDispatchedRun({
            correlationId: 'corr-backlog-1',
            title: 'Backlog run',
            repo: 'owner/repo',
            project: 'ProjA',
            dispatchedAt: Date.now(),
        });

        expect(rowTitles()).toEqual(['Backlog run']);
        expect(rowBadges()).toEqual(['Queued']);
        expect(storedRuns()[0].entryId).toBe(null);
    });

    it('dedups by correlation id — one dispatch can never stack two rows', () => {
        mountClaudeSheet(document.body);
        const first = trackDispatchedRun({
            correlationId: 'corr-dupe',
            title: 'Only once',
            repo: 'owner/repo',
            project: 'ProjA',
            dispatchedAt: Date.now(),
        });
        const second = trackDispatchedRun({
            correlationId: 'corr-dupe',
            title: 'Only once',
            repo: 'owner/repo',
            project: 'ProjA',
            dispatchedAt: Date.now(),
        });

        expect(first).toBeTruthy();
        expect(second).toBe(null);
        expect(rowTitles()).toEqual(['Only once']);
        expect(storedRuns().length).toBe(1);
    });

    it('read-modify-writes the stored list, so a dispatch never clobbers existing records', () => {
        // A record written by another tab (or before this sheet ever mounted).
        localStorage.setItem(RUNS_KEY, JSON.stringify([
            { correlationId: 'corr-older', entryId: 'entry-older', title: 'Older run', status: 'SHIPPED', dispatchedAt: Date.now() - 5000, repo: 'owner/repo', project: 'ProjA' },
        ]));
        trackDispatchedRun({
            correlationId: 'corr-new',
            entryId: 'entry-new',
            title: 'Newer run',
            repo: 'owner/repo',
            project: 'ProjA',
            dispatchedAt: Date.now(),
        });

        const stored = storedRuns();
        expect(stored.map(function(r) { return r.correlationId; })).toEqual(['corr-new', 'corr-older']);
    });

    it('ignores a call with no correlation id — the poller has nothing to key on', () => {
        expect(trackDispatchedRun(null)).toBe(null);
        expect(trackDispatchedRun({ title: 'No id' })).toBe(null);
        expect(storedRuns().length).toBe(0);
    });
});

// The wiring half: both viewer dispatch paths must call the tracker on the
// SUCCESS branch, with the same correlation id they hand the viewer's own pill.
describe('TODO.md viewer — both dispatch paths feed the Runs tab', () => {
    const viewer = read('todoMdViewer.js');

    it('imports trackDispatchedRun from claudeSheet.js', () => {
        expect(viewer).toMatch(
            /import\s*\{\s*trackDispatchedRun\s*\}\s*from\s*['"]\.\/claudeSheet\.js['"]/
        );
    });

    it('runBacklog tracks the dispatch with the correlation id it started the pill with', () => {
        const start = viewer.indexOf('async function runBacklog');
        const block = viewer.slice(start, viewer.indexOf('runBacklogBtn.addEventListener', start));
        expect(block).toMatch(/trackDispatchedRun\s*\(\s*\{[\s\S]{0,400}correlationId:\s*correlationId/);
        expect(block).toMatch(/trackDispatchedRun\s*\(\s*\{[\s\S]{0,400}project:\s*projectName/);
        // Only on a successful dispatch — a failed one has no run to track.
        expect(block.indexOf('trackDispatchedRun')).toBeGreaterThan(block.indexOf('if (res.ok)'));
    });

    it('runEntry tracks the dispatch and carries the entry id', () => {
        const start = viewer.indexOf('async function runEntry');
        const block = viewer.slice(start, viewer.indexOf('function applyExpandedHeight', start));
        expect(block).toMatch(/trackDispatchedRun\s*\(\s*\{[\s\S]{0,400}correlationId:\s*correlationId/);
        expect(block).toMatch(/trackDispatchedRun\s*\(\s*\{[\s\S]{0,400}entryId:\s*entryId/);
        expect(block.indexOf('trackDispatchedRun')).toBeGreaterThan(block.indexOf('if (res.ok)'));
    });

    it('both paths share one dispatch timestamp between the pill record and the run record', () => {
        // The viewer's give-up clock and the Runs-tab poller measure from the
        // same instant; two separate Date.now() calls would drift them apart.
        const matches = viewer.match(/const dispatchedAt = Date\.now\(\);/g) || [];
        expect(matches.length).toBe(2);
    });
});
