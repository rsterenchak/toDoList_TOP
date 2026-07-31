import { vi } from 'vitest';
import { mountClaudeSheet } from '../src/claudeSheet.js';
import {
    setQueueRows,
    notifyQueueChange,
} from '../src/agentQueueStore.js';
import {
    initInjectConfig,
    loadInjectTargets,
    refreshShippedMarkers,
} from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

// The Runs tab's spine is every shipped (`[x]`) entry in the project repo's
// TODO.md — the complete, cross-device record of what shipped, including runs
// dispatched via Run backlog or an entry's own Run pill that never get an
// agent_queue row. This exercises that spine end to end: a shipped marker with no
// queue row must appear (titled from its linked todo) and open iterate; a queue
// row for the same entry must win (no double-listing); an in-flight queue row
// must survive alongside the shipped set; and a marker-cache refresh must repaint.

// claudeSheet → inject → supabaseClient. `hoisted.rows` backs the inject_targets
// query so a test can populate the targets cache via loadInjectTargets.
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

// A fresh repo per test keeps the module-level per-repo marker cache from letting
// one test's shipped set leak into another's within the 60s TTL.
let repoSeq = 0;
function freshRepo() {
    repoSeq += 1;
    return 'me/ShipRepo-' + repoSeq;
}

// Point fetch at a TODO.md body so refreshShippedMarkers can populate its cache.
function mockTodoMd(content) {
    globalThis.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: content }),
    }));
}

async function seedTargets(rows) {
    hoisted.rows = rows;
    await loadInjectTargets();
}

// Route `project` to `repo`, add a todo carrying `entryId` (and optional
// shippedAt for ordering), and return the created item.
function seedShippedTodo(project, targetId, entryId, title, shippedAt) {
    listLogic.addToDo(project, title);
    const items = listLogic.listItems(project);
    const item = items[items.length - 1];
    item.entryId = entryId;
    if (shippedAt) item.shippedAt = shippedAt;
    return item;
}

function titles() {
    return Array.from(document.querySelectorAll('.claudeRunTitle')).map(function(el) { return el.textContent; });
}

async function seedShippedMarker(repo, markdown) {
    mockTodoMd(markdown);
    await refreshShippedMarkers({ repo: repo, file_path: 'TODO.md' }, true);
}

describe('Runs tab — shipped-entry spine from the TODO.md marker cache', () => {
    let realFetch;

    beforeEach(async () => {
        document.body.innerHTML = '';
        localStorage.clear();
        listLogic._reset();
        setQueueRows([], null);
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret');
        initInjectConfig();
        realFetch = globalThis.fetch;
        await seedTargets([]);
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        localStorage.clear();
        listLogic._reset();
        setQueueRows([], null);
        mountClaudeSheet(document.createElement('div'));
    });

    it('lists a shipped entry that has NO queue row and makes it iterable', async () => {
        const repo = freshRepo();
        await seedTargets([{ id: 't1', repo: repo, file_path: 'TODO.md' }]);
        listLogic.addProject('ProjA');
        listLogic.setProjectTargetId('ProjA', 't1');
        seedShippedTodo('ProjA', 't1', 'e-backlog', 'Shipped via Run backlog', '2026-07-31T10:00:00Z');
        await seedShippedMarker(repo, [
            '# TODO LIST',
            '- [x] Shipped via Run backlog',
            '  <!-- id: e-backlog -->',
        ].join('\n'));
        // No queue row exists for this entry — the queue never saw it.
        setQueueRows([], 'ProjA');

        mountClaudeSheet(document.body);

        const rows = document.querySelectorAll('.claudeRunRow');
        expect(rows.length).toBe(1);
        expect(rows[0].querySelector('.claudeRunTitle').textContent).toBe('Shipped via Run backlog');
        expect(rows[0].querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        // Shipped → iterable, and revertable.
        expect(rows[0].classList.contains('claudeRunRow--iterable')).toBe(true);
        expect(rows[0].querySelector('.claudeRunRevertBtn')).toBeTruthy();
    });

    it('does not double-list an entry that has both a shipped marker and a queue row', async () => {
        const repo = freshRepo();
        await seedTargets([{ id: 't1', repo: repo, file_path: 'TODO.md' }]);
        listLogic.addProject('ProjA');
        listLogic.setProjectTargetId('ProjA', 't1');
        seedShippedTodo('ProjA', 't1', 'e-both', 'Shipped with a queue row', '2026-07-31T10:00:00Z');
        await seedShippedMarker(repo, [
            '- [x] Shipped with a queue row',
            '  <!-- id: e-both -->',
        ].join('\n'));
        // A queue row exists for the SAME entry — it carries richer detail and wins.
        setQueueRows([
            { id: 'r1', project_id: 1, state: 'shipped', entry_id: 'e-both', correlation_id: 'c1', draft: '- [ ] Queue copy\n  - Type: feature\n  <!-- id: e-both -->', created_at: '2026-07-31T10:00:00Z' },
        ], 'ProjA');

        mountClaudeSheet(document.body);

        const rows = document.querySelectorAll('.claudeRunRow');
        expect(rows.length).toBe(1);
        // The queue row's derived title, not the marker spine's linked-todo title.
        expect(rows[0].querySelector('.claudeRunTitle').textContent).toBe('Queue copy');
    });

    it('unions the shipped set with an in-flight queue row (unchecked, not yet in the shipped set)', async () => {
        const repo = freshRepo();
        await seedTargets([{ id: 't1', repo: repo, file_path: 'TODO.md' }]);
        listLogic.addProject('ProjA');
        listLogic.setProjectTargetId('ProjA', 't1');
        seedShippedTodo('ProjA', 't1', 'e-done', 'Already shipped', '2026-07-31T09:00:00Z');
        await seedShippedMarker(repo, [
            '- [x] Already shipped',
            '  <!-- id: e-done -->',
        ].join('\n'));
        // A run in flight: its entry is unchecked in TODO.md (absent from the
        // shipped set) but present as a running queue row — it must still appear.
        setQueueRows([
            { id: 'r1', project_id: 1, state: 'running', entry_id: 'e-live', correlation_id: 'c1', draft: '- [ ] Running now\n  - Type: feature\n  <!-- id: e-live -->', created_at: '2026-07-31T11:00:00Z' },
        ], 'ProjA');

        mountClaudeSheet(document.body);

        // Newest-first: the running run (11:00) above the shipped entry (09:00).
        expect(titles()).toEqual(['Running now', 'Already shipped']);
        const badges = Array.from(document.querySelectorAll('.claudeRunBadge')).map(function(el) { return el.textContent; });
        expect(badges).toEqual(['Running', 'Shipped']);
    });

    it('skips a shipped marker with no linked todo in this project (another project sharing the repo)', async () => {
        const repo = freshRepo();
        await seedTargets([{ id: 't1', repo: repo, file_path: 'TODO.md' }]);
        listLogic.addProject('ProjA');
        listLogic.setProjectTargetId('ProjA', 't1');
        // ProjA has a todo for e-mine but NOT for e-theirs.
        seedShippedTodo('ProjA', 't1', 'e-mine', 'My shipped entry', '2026-07-31T10:00:00Z');
        await seedShippedMarker(repo, [
            '- [x] My shipped entry',
            '  <!-- id: e-mine -->',
            '- [x] Another project\'s entry',
            '  <!-- id: e-theirs -->',
        ].join('\n'));
        setQueueRows([], 'ProjA');

        mountClaudeSheet(document.body);

        // Only the entry scoped to this project (with a linked todo) is listed.
        expect(titles()).toEqual(['My shipped entry']);
    });

    it('repaints the Runs tab on a marker-cache refresh (TODO_RUN_STATUS_EVENT)', async () => {
        const repo = freshRepo();
        await seedTargets([{ id: 't1', repo: repo, file_path: 'TODO.md' }]);
        listLogic.addProject('ProjA');
        listLogic.setProjectTargetId('ProjA', 't1');
        seedShippedTodo('ProjA', 't1', 'e-late', 'Ships after mount', '2026-07-31T10:00:00Z');
        setQueueRows([], 'ProjA');

        mountClaudeSheet(document.body);
        // The tab-open auto-refresh reads an (empty) TODO.md — nothing shipped yet.
        mockTodoMd('# TODO LIST\n');
        document.getElementById('claudeTabRuns').click();
        // Let the tab-open refresh settle so its in-flight read can't swallow the
        // forced refresh below.
        await new Promise(function(r) { setTimeout(r, 0); });
        expect(document.querySelectorAll('.claudeRunRow').length).toBe(0);

        // The entry's run merges: the marker cache reconciles and fires the event,
        // which the Runs tab listens for (onQueueChange never sees this — there's
        // no queue row).
        await seedShippedMarker(repo, [
            '- [x] Ships after mount',
            '  <!-- id: e-late -->',
        ].join('\n'));

        const rows = document.querySelectorAll('.claudeRunRow');
        expect(rows.length).toBe(1);
        expect(rows[0].querySelector('.claudeRunTitle').textContent).toBe('Ships after mount');
    });

    it('opens iterate mode from a shipped-marker row', async () => {
        globalThis.fetch = vi.fn(function() { return new Promise(function() {}); });
        const repo = freshRepo();
        await seedTargets([{ id: 't1', repo: repo, file_path: 'TODO.md' }]);
        listLogic.addProject('ProjA');
        listLogic.setProjectTargetId('ProjA', 't1');
        seedShippedTodo('ProjA', 't1', 'e-iter', 'Iterate this shipped entry', '2026-07-31T10:00:00Z');
        await seedShippedMarker(repo, [
            '- [x] Iterate this shipped entry',
            '  <!-- id: e-iter -->',
        ].join('\n'));
        // Re-stub fetch to a never-resolving promise so the seed turn never lands.
        globalThis.fetch = vi.fn(function() { return new Promise(function() {}); });
        setQueueRows([], 'ProjA');

        mountClaudeSheet(document.body);

        document.querySelector('.claudeRunRow').click();
        const sheet = document.getElementById('claudeSheet');
        expect(sheet.getAttribute('data-tab')).toBe('chat');
    });
});
