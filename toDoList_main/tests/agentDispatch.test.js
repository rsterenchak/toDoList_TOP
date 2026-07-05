import { vi } from 'vitest';

// The Agent view's Dispatch control ships a `drafted` card's entry through the
// run pipeline: mint an id, embed the marker, inject the entry, dispatch
// claude-run.yml in entry mode, then poll the run to a terminal outcome —
// persisting the row's state (dispatched → running → shipped / failed /
// no_change) at each step. These tests drive that flow with a controllable fake
// Supabase client (update observation) and a fully mocked inject.js so no
// network is touched and each Worker call's result can be scripted.

// ── Supabase stub ────────────────────────────────────────────────────
let queueRows = [];
let queueError = null;
let updateCalls = [];
let updateError = null;

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
let injectCalls = [];
let dispatchCalls = [];
let pollCalls = [];
let resolveCalls = [];

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'mint-' + (mintCounter++),
    embedEntryMarker: (text, id) => String(text) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: (opts) => { injectCalls.push(opts); return Promise.resolve(injectResult); },
    dispatchRun: (opts) => { dispatchCalls.push(opts); return Promise.resolve(dispatchResult); },
    pollRunStatus: (opts) => { pollCalls.push(opts); return Promise.resolve(pollResult); },
    resolveEntryByMarker: (id) => { resolveCalls.push(id); return Promise.resolve(resolveResult); },
    fetchRunResult: () => Promise.resolve(runResultResult),
}));

import { listLogic } from '../src/listLogic.js';
import {
    renderAgentView,
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

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    queueError = null;
    updateCalls = [];
    updateError = null;
    mintCounter = 0;
    injectResult = { ok: true, id: 'e' };
    dispatchResult = { ok: true, runId: 111 };
    pollResult = { ok: true, found: false };
    resolveResult = { ok: true, found: false };
    runResultResult = { ok: true, result: '' };
    injectCalls = [];
    dispatchCalls = [];
    pollCalls = [];
    resolveCalls = [];
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribeAgentView();
});

describe('listLogic.setAgentRunState', () => {
    it('writes only the allowed keys that are present, scoped to the row id', async () => {
        const res = await listLogic.setAgentRunState('row-1', {
            state: 'shipped',
            pr_url: 'https://example.com/pr/1',
            run_id: 7,
            bogus: 'drop me',
            failure_reason: undefined,
        });
        expect(res.ok).toBe(true);
        expect(updateCalls.length).toBe(1);
        expect(updateCalls[0].id).toBe('row-1');
        expect(updateCalls[0].patch).toEqual({
            state: 'shipped',
            pr_url: 'https://example.com/pr/1',
            run_id: 7,
        });
    });

    it('rejects a missing row id and writes nothing', async () => {
        const res = await listLogic.setAgentRunState('', { state: 'running' });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/row id/i);
        expect(updateCalls.length).toBe(0);
    });

    it('rejects an empty patch and writes nothing', async () => {
        const res = await listLogic.setAgentRunState('row-2', {});
        expect(res.ok).toBe(false);
        expect(updateCalls.length).toBe(0);
    });

    it('surfaces a Supabase error', async () => {
        updateError = { message: 'update boom' };
        const res = await listLogic.setAgentRunState('row-3', { state: 'failed' });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/boom/);
    });
});

describe('AGENT view — drafted card', () => {
    beforeEach(() => {
        listLogic.addProject('Draftly');
        mountDom('Draftly');
    });

    it('renders the draft in a read-only block plus a Dispatch button', async () => {
        queueRows = [{ id: 'd1', state: 'drafted', context: { title: 'Ship a thing' }, draft: 'The entry text' }];
        await loadBoard();
        const block = document.querySelector('.agentDraftBlock');
        expect(block).toBeTruthy();
        expect(block.textContent).toBe('The entry text');
        const btn = document.querySelector('.agentDispatchButton');
        expect(btn).toBeTruthy();
        expect(btn.disabled).toBe(false);
        // The drafted card lives in the In progress bucket.
        expect(document.querySelector('.agentBucket--in-progress')).toBeTruthy();
    });
});

describe('AGENT view — Dispatch action', () => {
    beforeEach(() => {
        listLogic.addProject('Dispatchly');
        mountDom('Dispatchly');
    });

    it('injects the marked entry, dispatches entry mode, and persists dispatched + ids', async () => {
        queueRows = [{ id: 'd1', state: 'drafted', context: { title: 'Ship it' }, draft: 'My entry' }];
        // Keep the run unresolved so this test focuses on the kickoff.
        pollResult = { ok: true, found: false };
        await loadBoard();

        document.querySelector('.agentDispatchButton').click();
        await flush();

        expect(injectCalls.length).toBe(1);
        expect(injectCalls[0].id).toBe('mint-0');
        expect(injectCalls[0].entry).toContain('<!-- id: mint-0 -->');
        expect(injectCalls[0].entry).toContain('My entry');

        expect(dispatchCalls.length).toBe(1);
        expect(dispatchCalls[0]).toMatchObject({
            mode: 'entry',
            entryId: 'mint-0',
            correlationId: 'mint-1',
        });

        // First persisted transition: dispatched, carrying the ids.
        const dispatched = updateCalls.find((c) => c.patch.state === 'dispatched');
        expect(dispatched).toBeTruthy();
        expect(dispatched.id).toBe('d1');
        expect(dispatched.patch.entry_id).toBe('mint-0');
        expect(dispatched.patch.correlation_id).toBe('mint-1');
        expect(dispatched.patch.run_id).toBe(111);
    });

    it('walks to shipped with a PR link when the marker resolves to a merged PR', async () => {
        queueRows = [{ id: 'd1', state: 'drafted', context: { title: 'Ship it' }, draft: 'My entry' }];
        pollResult = { ok: true, found: true, status: 'completed', conclusion: 'success', runUrl: 'u', runId: 111 };
        resolveResult = { ok: true, found: true, merge_commit_sha: 'abc123', pr_number: 42, pr_url: 'https://github.com/o/r/pull/42' };
        await loadBoard();

        document.querySelector('.agentDispatchButton').click();
        await flush();

        expect(resolveCalls).toContain('mint-0');
        const shipped = updateCalls.find((c) => c.patch.state === 'shipped');
        expect(shipped).toBeTruthy();
        expect(shipped.patch.pr_url).toBe('https://github.com/o/r/pull/42');
        expect(shipped.patch.pr_number).toBe(42);
        expect(shipped.patch.run_id).toBe(111);
    });

    it('settles to no_change with the run summary when success merged nothing', async () => {
        queueRows = [{ id: 'd1', state: 'drafted', context: { title: 'Ship it' }, draft: 'My entry' }];
        pollResult = { ok: true, found: true, status: 'completed', conclusion: 'success', runUrl: 'u', runId: 111 };
        resolveResult = { ok: true, found: false };
        runResultResult = { ok: true, result: 'Entry was ineligible; nothing to do.' };
        await loadBoard();

        document.querySelector('.agentDispatchButton').click();
        await flush();

        const noChange = updateCalls.find((c) => c.patch.state === 'no_change');
        expect(noChange).toBeTruthy();
        expect(noChange.patch.failure_reason).toBe('Entry was ineligible; nothing to do.');
    });

    it('settles to failed with the run summary on a recognized failure conclusion', async () => {
        queueRows = [{ id: 'd1', state: 'drafted', context: { title: 'Ship it' }, draft: 'My entry' }];
        pollResult = { ok: true, found: true, status: 'completed', conclusion: 'failure', runUrl: 'u', runId: 111 };
        runResultResult = { ok: true, result: 'Tests failed after three iterations.' };
        await loadBoard();

        document.querySelector('.agentDispatchButton').click();
        await flush();

        const failed = updateCalls.find((c) => c.patch.state === 'failed');
        expect(failed).toBeTruthy();
        expect(failed.patch.failure_reason).toBe('Tests failed after three iterations.');
        // No ship/no-change transition on a hard failure.
        expect(updateCalls.some((c) => c.patch.state === 'shipped')).toBe(false);
    });

    it('re-enables the button and surfaces an error when inject fails, without dispatching', async () => {
        queueRows = [{ id: 'd1', state: 'drafted', context: { title: 'Ship it' }, draft: 'My entry' }];
        injectResult = { ok: false, reason: 'worker 500' };
        await loadBoard();

        const btn = document.querySelector('.agentDispatchButton');
        btn.click();
        await flush();

        expect(dispatchCalls.length).toBe(0);
        expect(btn.disabled).toBe(false);
        const err = document.querySelector('.agentDraftError');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toMatch(/worker 500/);
    });
});

describe('AGENT view — Stuck bucket includes no_change', () => {
    it('renders a no_change row in the Stuck bucket with its summary', async () => {
        listLogic.addProject('Stuckly');
        mountDom('Stuckly');
        queueRows = [{ id: 'n1', state: 'no_change', context: { title: 'Tried it' }, failure_reason: 'No change was needed.' }];
        await loadBoard();

        const labels = [...document.querySelectorAll('.agentBucketLabel')].map((n) => n.textContent);
        expect(labels).toContain('Stuck');
        expect(document.querySelector('.agentFailure').textContent).toBe('No change was needed.');
        // The chip reads "No change".
        expect(document.querySelector('.agentChip').textContent).toBe('No change');
    });
});
