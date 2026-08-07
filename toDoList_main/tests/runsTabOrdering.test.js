import { vi } from 'vitest';
import { mountClaudeSheet } from '../src/claudeSheet.js';
import { setQueueRows } from '../src/agentQueueStore.js';

// claudeSheet → inject → supabaseClient, and agentQueueStore → supabaseClient.
// Stub the shared client so importing these modules never reaches the network;
// this mirrors the minimal surface the other claudeSheet tests rely on.
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

function draftFor(title) {
    return '- [ ] **[MEDIUM]** ' + title + '\n  - Type: feature\n  <!-- id: x -->';
}

function titles() {
    return Array.from(document.querySelectorAll('.claudeRunTitle')).map(function(el) { return el.textContent; });
}

function seedLocalRecords(records) {
    localStorage.setItem('todoapp_claudeRuns', JSON.stringify(records));
}

function at(iso) {
    return Date.parse(iso);
}

// The Runs tab used to pick between two orderings depending on which sources
// were loaded: a list with queue or shipped-spine records was sorted by dispatch
// time, but a LOCAL-ONLY list took an early return and rendered in whatever order
// `runRecords` happened to hold. Since those records are per-device localStorage,
// the split fell along dispatch origin — the device a run was started from could
// order its list differently from every other device viewing the same project.
// One sorted path now covers every combination.
describe('Runs tab — one ordering (newest-first) for every combination of sources', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        setQueueRows([], null);
    });

    afterEach(() => {
        localStorage.clear();
        setQueueRows([], null);
        mountClaudeSheet(document.createElement('div'));
    });

    it('orders a local-only list newest-first by dispatch time', () => {
        // Stored oldest-first: whatever order the records happen to sit in, the
        // rendered list is ordered by dispatchedAt descending.
        seedLocalRecords([
            { entryId: 'e-old', correlationId: 'c-old', title: 'Oldest run', status: 'SHIPPED', dispatchedAt: at('2026-08-01T09:00:00Z') },
            { entryId: 'e-mid', correlationId: 'c-mid', title: 'Middle run', status: 'FAILED', dispatchedAt: at('2026-08-01T10:00:00Z') },
            { entryId: 'e-new', correlationId: 'c-new', title: 'Newest run', status: 'SHIPPED', dispatchedAt: at('2026-08-01T11:00:00Z') },
        ]);
        mountClaudeSheet(document.body);

        expect(titles()).toEqual(['Newest run', 'Middle run', 'Oldest run']);
    });

    it('sorts a local-only list the same way it sorts a mixed list', () => {
        // Same three local records, now alongside a queue row — the ordering of
        // the local ones relative to each other must not change with the source mix.
        seedLocalRecords([
            { entryId: 'e-old', correlationId: 'c-old', title: 'Oldest run', status: 'SHIPPED', dispatchedAt: at('2026-08-01T09:00:00Z') },
            { entryId: 'e-mid', correlationId: 'c-mid', title: 'Middle run', status: 'FAILED', dispatchedAt: at('2026-08-01T10:00:00Z') },
            { entryId: 'e-new', correlationId: 'c-new', title: 'Newest run', status: 'SHIPPED', dispatchedAt: at('2026-08-01T11:00:00Z') },
        ]);
        setQueueRows([
            { id: 'r1', project_id: 1, state: 'shipped', entry_id: 'e-queue', correlation_id: 'c-q', draft: draftFor('Queue run'), created_at: '2026-08-01T10:30:00Z' },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        expect(titles()).toEqual(['Newest run', 'Queue run', 'Middle run', 'Oldest run']);
    });

    it('keeps a record with no dispatchedAt at the end rather than throwing', () => {
        // Shipped-spine records are built from a different source and a todo with
        // no shipped_at yields no timestamp; a missing key must sort predictably.
        seedLocalRecords([
            { entryId: 'e-none', correlationId: 'c-none', title: 'Undated run', status: 'SHIPPED' },
            { entryId: 'e-new', correlationId: 'c-new', title: 'Newest run', status: 'SHIPPED', dispatchedAt: at('2026-08-01T11:00:00Z') },
        ]);
        mountClaudeSheet(document.body);

        expect(titles()).toEqual(['Newest run', 'Undated run']);
    });

    it('keeps the Clear-completed affordance beneath the last run row', () => {
        seedLocalRecords([
            { entryId: 'e-old', correlationId: 'c-old', title: 'Oldest run', status: 'SHIPPED', dispatchedAt: at('2026-08-01T09:00:00Z') },
            { entryId: 'e-new', correlationId: 'c-new', title: 'Newest run', status: 'SHIPPED', dispatchedAt: at('2026-08-01T11:00:00Z') },
        ]);
        mountClaudeSheet(document.body);

        const list = document.getElementById('claudeRunsList');
        const last = list.lastElementChild;
        expect(last.classList.contains('claudeRunsClearWrap')).toBe(true);
        expect(titles()).toEqual(['Newest run', 'Oldest run']);
    });
});
