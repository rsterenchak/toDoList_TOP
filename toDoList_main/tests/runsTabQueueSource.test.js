import { vi } from 'vitest';
import { mountClaudeSheet } from '../src/claudeSheet.js';
import {
    setQueueRows,
    getQueueRows,
    notifyQueueChange,
} from '../src/agentQueueStore.js';
import { listLogic } from '../src/listLogic.js';

// claudeSheet → inject → supabaseClient, and agentQueueStore → supabaseClient.
// Stub the shared client so importing these modules never reaches the network;
// this mirrors the minimal surface the other claudeSheet tests rely on. The queue
// rows the Runs tab reads are seeded directly through setQueueRows (an in-memory
// cache write), so no query result needs to be mocked here.
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

// A shipped queue row's draft is derived to its title, so seeding a draft entry
// is the simplest way to give a row a predictable title.
function draftFor(title) {
    return '- [ ] **[MEDIUM]** ' + title + '\n  - Type: feature\n  <!-- id: x -->';
}

function titles() {
    return Array.from(document.querySelectorAll('.claudeRunTitle')).map(function(el) { return el.textContent; });
}

function badges() {
    return Array.from(document.querySelectorAll('.claudeRunBadge')).map(function(el) { return el.textContent; });
}

describe('Runs tab — sourced from the agent_queue store (cross-device)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        // Reset the shared store cache so a prior test's rows never leak in.
        setQueueRows([], null);
    });

    afterEach(() => {
        localStorage.clear();
        setQueueRows([], null);
        mountClaudeSheet(document.createElement('div'));
    });

    it('lists a shipped run from a queue row with no local record, and makes it iterable', () => {
        setQueueRows([
            { id: 'row-1', project_id: 1, state: 'shipped', entry_id: 'e-ship', correlation_id: 'corr-1', draft: draftFor('Shipped from another device'), created_at: '2026-07-31T10:00:00Z' },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        const rows = document.querySelectorAll('.claudeRunRow');
        expect(rows.length).toBe(1);
        expect(rows[0].querySelector('.claudeRunTitle').textContent).toBe('Shipped from another device');
        expect(rows[0].querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        // A shipped run is the door into iterate mode and can be rolled back.
        expect(rows[0].classList.contains('claudeRunRow--iterable')).toBe(true);
        expect(rows[0].querySelector('.claudeRunRevertBtn')).toBeTruthy();
    });

    it('maps queue states to run statuses and skips pre-dispatch (non-run) rows', () => {
        setQueueRows([
            { id: 'r1', state: 'dispatched', entry_id: 'e1', correlation_id: 'c1', draft: draftFor('Queued run'), created_at: '2026-07-31T10:05:00Z' },
            { id: 'r2', state: 'running', entry_id: 'e2', correlation_id: 'c2', draft: draftFor('Running run'), created_at: '2026-07-31T10:04:00Z' },
            { id: 'r3', state: 'shipped', entry_id: 'e3', correlation_id: 'c3', draft: draftFor('Shipped run'), created_at: '2026-07-31T10:03:00Z' },
            { id: 'r4', state: 'failed', entry_id: 'e4', correlation_id: 'c4', draft: draftFor('Failed run'), created_at: '2026-07-31T10:02:00Z' },
            { id: 'r5', state: 'no_change', entry_id: 'e5', correlation_id: 'c5', draft: draftFor('No-change run'), created_at: '2026-07-31T10:01:00Z' },
            // Pre-dispatch states are not runs and must not appear.
            { id: 'r6', state: 'drafted', entry_id: 'e6', draft: draftFor('Just a draft'), created_at: '2026-07-31T10:06:00Z' },
            { id: 'r7', state: 'needs_words', draft: draftFor('Triage question'), created_at: '2026-07-31T10:07:00Z' },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        // Newest-first by created_at among the five run rows.
        expect(titles()).toEqual(['Queued run', 'Running run', 'Shipped run', 'Failed run', 'No-change run']);
        expect(badges()).toEqual(['Queued', 'Running', 'Shipped', 'Failed', 'No change']);
    });

    it('surfaces a no-change run summary from the row without a fetch', () => {
        setQueueRows([
            { id: 'r1', state: 'no_change', entry_id: 'e1', correlation_id: 'c1', draft: draftFor('Nothing shipped'), failure_reason: 'The entry was already satisfied.', created_at: '2026-07-31T10:00:00Z' },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        const row = document.querySelector('.claudeRunRow--nochange');
        expect(row).toBeTruthy();
        // Expanding the accordion renders the cached summary (from failure_reason).
        row.click();
        expect(document.querySelector('.claudeRunResultText').textContent).toBe('The entry was already satisfied.');
    });

    it('derives a run title from the linked todo when the row has no draft', () => {
        listLogic.addProject('ProjA');
        listLogic.addToDo('ProjA', 'Todo-derived title');
        const items = listLogic.listItems('ProjA').filter(function(i) { return i.tit === 'Todo-derived title'; });
        const todoId = items[items.length - 1].id;

        setQueueRows([
            { id: 'r1', state: 'shipped', entry_id: 'e1', correlation_id: 'c1', todo_id: todoId, created_at: '2026-07-31T10:00:00Z' },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        expect(document.querySelector('.claudeRunTitle').textContent).toBe('Todo-derived title');
    });

    it('repaints live on onQueueChange while the Runs tab is active', () => {
        mountClaudeSheet(document.body);
        // Switch to the (empty) Runs tab.
        document.getElementById('claudeTabRuns').click();
        expect(document.querySelectorAll('.claudeRunRow').length).toBe(0);

        // A run dispatched on another device lands in the queue and pushes a change.
        setQueueRows([
            { id: 'r1', state: 'running', entry_id: 'e1', correlation_id: 'c1', draft: draftFor('Live run'), created_at: '2026-07-31T10:00:00Z' },
        ], 'ProjA');
        notifyQueueChange();

        let rows = document.querySelectorAll('.claudeRunRow');
        expect(rows.length).toBe(1);
        expect(rows[0].querySelector('.claudeRunBadge').textContent).toBe('Running');

        // The row settles to shipped; the badge updates on the next change.
        setQueueRows([
            { id: 'r1', state: 'shipped', entry_id: 'e1', correlation_id: 'c1', draft: draftFor('Live run'), created_at: '2026-07-31T10:00:00Z' },
        ], 'ProjA');
        notifyQueueChange();
        rows = document.querySelectorAll('.claudeRunRow');
        expect(rows.length).toBe(1);
        expect(rows[0].querySelector('.claudeRunBadge').textContent).toBe('Shipped');
    });

    it('dedupes a local record against a matching queue row and prunes the local copy', () => {
        // A local fallback record and a queue row describe the SAME dispatch (same
        // entry id). The queue row is the cross-device truth, so only it renders and
        // the redundant local copy is pruned from localStorage.
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e-dup', correlationId: 'c-old', title: 'Local copy', status: 'RUNNING', dispatchedAt: Date.parse('2026-07-31T10:00:00Z') },
        ]));
        setQueueRows([
            { id: 'r1', state: 'shipped', entry_id: 'e-dup', correlation_id: 'c-new', draft: draftFor('Queue copy'), created_at: '2026-07-31T10:00:00Z' },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        const rows = document.querySelectorAll('.claudeRunRow');
        expect(rows.length).toBe(1);
        expect(rows[0].querySelector('.claudeRunTitle').textContent).toBe('Queue copy');
        // The matched local record was pruned.
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored.length).toBe(0);
    });

    it('keeps a local record with no matching queue row (fallback for chat-shipped runs)', () => {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e-chat', correlationId: 'c-chat', title: 'Chat-shipped run', status: 'SHIPPED', dispatchedAt: Date.parse('2026-07-31T09:00:00Z') },
        ]));
        setQueueRows([
            { id: 'r1', state: 'shipped', entry_id: 'e-queue', correlation_id: 'c1', draft: draftFor('Queue run'), created_at: '2026-07-31T10:00:00Z' },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        // Both render, newest-first by dispatch time.
        expect(titles()).toEqual(['Queue run', 'Chat-shipped run']);
        // The unmatched local record survives.
        expect(JSON.parse(localStorage.getItem('todoapp_claudeRuns')).length).toBe(1);
    });

    it('opens iterate mode from a shipped queue row', () => {
        // startIterateFromRun switches to the chat tab and fires a seed turn; stub
        // fetch so the outgoing turn never reaches the network.
        globalThis.fetch = vi.fn(function() { return new Promise(function() {}); });
        setQueueRows([
            { id: 'r1', state: 'shipped', entry_id: 'e1', correlation_id: 'c1', draft: draftFor('Iterate me'), created_at: '2026-07-31T10:00:00Z' },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        document.querySelector('.claudeRunRow').click();
        // The tab switch is synchronous, before the seed turn awaits its reply.
        const sheet = document.getElementById('claudeSheet');
        expect(sheet.getAttribute('data-tab')).toBe('chat');
    });
});
