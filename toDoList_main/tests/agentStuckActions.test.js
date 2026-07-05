import { vi } from 'vitest';

// The Agent view's Stuck cards (`failed` / `no_change`) carry two actions:
// "Shelve + unflag" — delete the queue row so the task returns to Not-assigned —
// and "Retry" — re-dispatch the task's existing entry through the run pipeline,
// reusing the row's stored entry_id so injectEntry dedup-skips the already-present
// marker rather than appending a duplicate TODO.md entry. These tests drive that
// flow with a controllable fake Supabase client (delete + update observation) and
// a fully mocked inject.js so no network is touched.

// ── Supabase stub ────────────────────────────────────────────────────
let queueRows = [];
let queueError = null;
let updateCalls = [];
let updateError = null;
let deleteCalls = [];
let deleteError = null;

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => Promise.resolve({ data: queueRows, error: queueError }),
            }),
            insert: (row) => Promise.resolve({ data: [row], error: null }),
            update: (patch) => ({
                eq: (col, val) => {
                    updateCalls.push({ patch, id: val });
                    return Promise.resolve({ data: updateError ? null : [patch], error: updateError });
                },
            }),
            delete: () => ({
                eq: (col, val) => {
                    deleteCalls.push({ id: val });
                    return Promise.resolve({ data: deleteError ? null : [], error: deleteError });
                },
            }),
        }),
        channel: () => ({
            on() { return this; },
            subscribe() { return this; },
        }),
        removeChannel: () => {},
    },
}));

// ── inject.js stub ───────────────────────────────────────────────────
let mintCounter = 0;
let injectResult = { ok: true, id: 'e' };
let dispatchResult = { ok: true, runId: 111 };
let pollResult = { ok: true, found: false };
let resolveResult = { ok: true, found: false };
let runResultResult = { ok: true, result: '' };
let readTodoResult = { ok: false, reason: 'No target' };
let injectCalls = [];
let dispatchCalls = [];
let readTodoCalls = [];

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'mint-' + (mintCounter++),
    embedEntryMarker: (text, id) => String(text) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: (opts) => { injectCalls.push(opts); return Promise.resolve(injectResult); },
    dispatchRun: (opts) => { dispatchCalls.push(opts); return Promise.resolve(dispatchResult); },
    pollRunStatus: () => Promise.resolve(pollResult),
    resolveEntryByMarker: () => Promise.resolve(resolveResult),
    fetchRunResult: () => Promise.resolve(runResultResult),
    dispatchTriage: () => Promise.resolve({ ok: true }),
    readTodoMdFromWorker: (target) => { readTodoCalls.push(target); return Promise.resolve(readTodoResult); },
    findTargetById: () => null,
    showInjectToast: () => {},
}));

import { listLogic } from '../src/listLogic.js';
import {
    subscribeAgentView,
    unsubscribeAgentView,
} from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) {
    for (let i = 0; i < n; i++) await tick();
}

function mountDom(projectName) {
    document.body.innerHTML =
        (projectName
            ? '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>'
            : '') +
        '<div id="agentView"></div>';
}

async function loadBoard() {
    subscribeAgentView();
    await flush();
}

function todoBody(entryId, checked) {
    return [
        '# TODO LIST',
        '',
        (checked ? '- [x]' : '- [ ]') + ' **[MEDIUM]** Ship a thing',
        '  - Type: feature',
        '  - Description: do the thing',
        '  <!-- id: ' + entryId + ' -->',
        '',
    ].join('\n');
}

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    queueError = null;
    updateCalls = [];
    updateError = null;
    deleteCalls = [];
    deleteError = null;
    mintCounter = 0;
    injectResult = { ok: true, id: 'e' };
    dispatchResult = { ok: true, runId: 111 };
    pollResult = { ok: true, found: false };
    resolveResult = { ok: true, found: false };
    runResultResult = { ok: true, result: '' };
    readTodoResult = { ok: false, reason: 'No target' };
    injectCalls = [];
    dispatchCalls = [];
    readTodoCalls = [];
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribeAgentView();
});

// ── listLogic.unflagAgentTask ────────────────────────────────────────
describe('listLogic.unflagAgentTask', () => {
    it('deletes the agent_queue row scoped to the given id', async () => {
        const res = await listLogic.unflagAgentTask('row-9');
        expect(res.ok).toBe(true);
        expect(deleteCalls.length).toBe(1);
        expect(deleteCalls[0].id).toBe('row-9');
    });

    it('rejects a missing row id and deletes nothing', async () => {
        const res = await listLogic.unflagAgentTask('');
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/row id/i);
        expect(deleteCalls.length).toBe(0);
    });

    it('surfaces a Supabase error', async () => {
        deleteError = { message: 'delete boom' };
        const res = await listLogic.unflagAgentTask('row-3');
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/boom/);
    });
});

// ── Stuck card actions ───────────────────────────────────────────────
describe('AGENT view — Stuck card actions', () => {
    beforeEach(() => {
        listLogic.addProject('Stuckly');
        mountDom('Stuckly');
    });

    it('renders Shelve + unflag and Retry buttons under the reason paragraph', async () => {
        queueRows = [{ id: 'f1', state: 'failed', context: { title: 'Broke' }, failure_reason: 'Tests failed', entry_id: 'ent-1' }];
        await loadBoard();
        expect(document.querySelector('.agentFailure').textContent).toBe('Tests failed');
        expect(document.querySelector('.agentStuckShelve')).toBeTruthy();
        expect(document.querySelector('.agentStuckRetry')).toBeTruthy();
    });

    it('also renders on a no_change row', async () => {
        queueRows = [{ id: 'n1', state: 'no_change', context: { title: 'Nada' }, failure_reason: 'Nothing changed', draft: 'x' }];
        await loadBoard();
        expect(document.querySelector('.agentStuckShelve')).toBeTruthy();
        expect(document.querySelector('.agentStuckRetry')).toBeTruthy();
    });

    it('Shelve + unflag deletes the row via listLogic.unflagAgentTask', async () => {
        queueRows = [{ id: 'f1', state: 'failed', context: { title: 'Broke' }, failure_reason: 'x', entry_id: 'ent-1' }];
        await loadBoard();
        document.querySelector('.agentStuckShelve').click();
        await flush();
        expect(deleteCalls.length).toBe(1);
        expect(deleteCalls[0].id).toBe('f1');
    });

    it('Retry re-dispatches reusing the stored entry_id — no fresh id minted for the marker, no duplicate append', async () => {
        queueRows = [{ id: 'f1', state: 'failed', context: { title: 'Broke' }, failure_reason: 'x', entry_id: 'ent-keep', draft: 'The draft entry' }];
        // The existing entry (its marker) is already on main, so the
        // pre-dispatch visibility check passes and the run fires.
        readTodoResult = { ok: true, content: todoBody('ent-keep', false) };
        await loadBoard();
        document.querySelector('.agentStuckRetry').click();
        await flush();

        // Inject reuses the row's own entry id, not a freshly minted one, so the
        // Worker dedup-skips the already-present marker instead of appending.
        expect(injectCalls.length).toBe(1);
        expect(injectCalls[0].id).toBe('ent-keep');
        expect(injectCalls[0].entry).toContain('<!-- id: ent-keep -->');

        // The run is dispatched in entry mode against the same id.
        expect(dispatchCalls.length).toBe(1);
        expect(dispatchCalls[0]).toMatchObject({ mode: 'entry', entryId: 'ent-keep' });

        // The row is walked back into the pipeline (dispatched) under the same id.
        const dispatched = updateCalls.find((c) => c.patch.state === 'dispatched');
        expect(dispatched).toBeTruthy();
        expect(dispatched.id).toBe('f1');
        expect(dispatched.patch.entry_id).toBe('ent-keep');
    });

    it('Retry is disabled when the row has neither an entry_id nor a draft', async () => {
        queueRows = [{ id: 'f1', state: 'failed', context: { title: 'Broke' }, failure_reason: 'x' }];
        await loadBoard();
        expect(document.querySelector('.agentStuckRetry').disabled).toBe(true);
        // Shelve stays available — the task can always be unflagged.
        expect(document.querySelector('.agentStuckShelve').disabled).toBe(false);
    });

    it('Retry is enabled when only a draft (no entry_id) is present', async () => {
        queueRows = [{ id: 'f1', state: 'no_change', context: { title: 'Broke' }, failure_reason: 'x', draft: 'draft only' }];
        await loadBoard();
        expect(document.querySelector('.agentStuckRetry').disabled).toBe(false);
    });
});
