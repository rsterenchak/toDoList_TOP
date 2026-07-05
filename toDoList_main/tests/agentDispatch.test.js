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
// TODO.md read used by both the pre-dispatch on-main visibility check and the
// checkbox-based ship reconcile. Default { ok: false } so tests that don't
// script a body fall through to the resolveEntryByMarker fallback (the
// pre-checkbox behavior); tests exercising the checkbox path set a `content`
// string here. `readTodoResults`, when set to an array, is consumed one entry
// per call (visibility poll first, then reconcile) so a test can script the
// two reads independently; once drained it falls back to `readTodoResult`.
let readTodoResult = { ok: false, reason: 'No target' };
let readTodoResults = null;
let injectCalls = [];
let dispatchCalls = [];
let pollCalls = [];
let resolveCalls = [];
let readTodoCalls = [];

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'mint-' + (mintCounter++),
    embedEntryMarker: (text, id) => String(text) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: (opts) => { injectCalls.push(opts); return Promise.resolve(injectResult); },
    dispatchRun: (opts) => { dispatchCalls.push(opts); return Promise.resolve(dispatchResult); },
    pollRunStatus: (opts) => { pollCalls.push(opts); return Promise.resolve(pollResult); },
    resolveEntryByMarker: (id) => { resolveCalls.push(id); return Promise.resolve(resolveResult); },
    fetchRunResult: () => Promise.resolve(runResultResult),
    fetchActiveRuns: () => Promise.resolve({ ok: true, active: false }),
    readTodoMdFromWorker: (target) => {
        readTodoCalls.push(target);
        if (Array.isArray(readTodoResults) && readTodoResults.length) {
            return Promise.resolve(readTodoResults.shift());
        }
        return Promise.resolve(readTodoResult);
    },
    findTargetById: () => null,
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
    readTodoResult = { ok: false, reason: 'No target' };
    readTodoResults = null;
    injectCalls = [];
    dispatchCalls = [];
    pollCalls = [];
    resolveCalls = [];
    readTodoCalls = [];
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

    it('writes the draft key so the needs_mockup launcher can stash a pasted entry', async () => {
        const res = await listLogic.setAgentRunState('row-m', {
            draft: '- [ ] **[HIGH]** Do the thing',
            state: 'drafted',
        });
        expect(res.ok).toBe(true);
        expect(updateCalls.length).toBe(1);
        expect(updateCalls[0].id).toBe('row-m');
        expect(updateCalls[0].patch).toEqual({
            draft: '- [ ] **[HIGH]** Do the thing',
            state: 'drafted',
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
        // The injected entry is visible on main, so the pre-dispatch race check
        // passes on the first read and the run fires.
        readTodoResult = { ok: true, content: todoBody('mint-0', false) };
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
        // First read (pre-dispatch visibility) sees the marker on main; the
        // second read (ship reconcile) falls through so the merged-PR search
        // decides shipped.
        readTodoResults = [{ ok: true, content: todoBody('mint-0', false) }, { ok: false }];
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
        // Visibility read sees the marker; reconcile read falls through so the
        // (empty) merged-PR search yields no_change.
        readTodoResults = [{ ok: true, content: todoBody('mint-0', false) }, { ok: false }];
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
        // Entry visible on main so the run fires; the failure path never
        // consults the checkbox.
        readTodoResult = { ok: true, content: todoBody('mint-0', false) };
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

    // Regression: the confirm-on-main poll is a best-effort head start, NOT a
    // gate. GitHub's write→read propagation can lag past the window even though
    // inject committed, and the run's own boot latency covers propagation — so
    // when the marker never surfaces we dispatch anyway rather than block a
    // legitimate run.
    it('dispatches anyway when the entry never appears on main within the window', async () => {
        queueRows = [{ id: 'd1', state: 'drafted', context: { title: 'Ship it' }, draft: 'My entry' }];
        // The inject succeeds, but the on-main read never surfaces the marker
        // within the attempt budget — the entry hasn't propagated to main yet.
        injectResult = { ok: true, id: 'e' };
        readTodoResult = { ok: false, reason: 'not visible' };
        pollResult = { ok: true, found: false };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await loadBoard();

        const btn = document.querySelector('.agentDispatchButton');
        vi.useFakeTimers();
        btn.click();
        // Drive the full ~8-attempt / 1000ms backoff to exhaustion.
        await vi.advanceTimersByTimeAsync(8 * 1000 + 100);
        vi.useRealTimers();
        await flush();

        // The read was retried across the attempt budget, not fatal on first miss.
        expect(readTodoCalls.length).toBeGreaterThan(1);
        // Inject happened AND the run fired despite the missed confirmation.
        expect(injectCalls.length).toBe(1);
        expect(dispatchCalls.length).toBe(1);
        expect(dispatchCalls[0]).toMatchObject({ mode: 'entry', entryId: 'mint-0' });
        // The row moves to dispatched, carrying the entry_id (so Retry reuses it).
        const dispatched = updateCalls.find((c) => c.patch.state === 'dispatched');
        expect(dispatched).toBeTruthy();
        expect(dispatched.id).toBe('d1');
        expect(dispatched.patch.entry_id).toBe('mint-0');
        // A console.warn flagged the unconfirmed dispatch; no blocking error shown.
        expect(warnSpy).toHaveBeenCalled();
        const err = document.querySelector('.agentDraftError');
        expect(err.hidden).toBe(true);
        warnSpy.mockRestore();
    });

    // Regression: a transient miss (marker not yet propagated / read error) is
    // retried rather than treated as fatal, and the run fires once the marker
    // shows up on main.
    it('retries misses then dispatches once the marker appears on main', async () => {
        queueRows = [{ id: 'd1', state: 'drafted', context: { title: 'Ship it' }, draft: 'My entry' }];
        pollResult = { ok: true, found: false };
        // First read misses (not propagated), second read surfaces the marker.
        readTodoResults = [
            { ok: false, reason: 'not visible yet' },
            { ok: true, content: todoBody('mint-0', false) },
        ];
        await loadBoard();

        const btn = document.querySelector('.agentDispatchButton');
        vi.useFakeTimers();
        btn.click();
        await vi.advanceTimersByTimeAsync(2 * 1000 + 100);
        vi.useRealTimers();
        await flush();

        // Two reads: the initial miss, then the hit — after which the run fires.
        expect(readTodoCalls.length).toBeGreaterThanOrEqual(2);
        expect(dispatchCalls.length).toBe(1);
        expect(dispatchCalls[0]).toMatchObject({ mode: 'entry', entryId: 'mint-0' });
        const dispatched = updateCalls.find((c) => c.patch.state === 'dispatched');
        expect(dispatched).toBeTruthy();
    });

    // Regression: re-dispatching a row that already carries an entry_id (e.g.
    // after a prior confirm-on-main timeout persisted the id) must REUSE that id
    // rather than minting a fresh one — otherwise inject appends a second copy of
    // the entry instead of dedup-skipping the already-present marker.
    it('reuses the row stored entry_id on Dispatch instead of minting a duplicate', async () => {
        queueRows = [{
            id: 'd1', state: 'drafted', context: { title: 'Ship it' },
            draft: 'My entry', entry_id: 'prior-id',
        }];
        // Marker already visible on main so the run fires on the first read.
        readTodoResult = { ok: true, content: todoBody('prior-id', false) };
        await loadBoard();

        document.querySelector('.agentDispatchButton').click();
        await flush();

        // Inject reused the stored id — no fresh mint for the entry marker.
        expect(injectCalls.length).toBe(1);
        expect(injectCalls[0].id).toBe('prior-id');
        expect(injectCalls[0].entry).toContain('<!-- id: prior-id -->');
        // The dispatch targets the same reused id.
        expect(dispatchCalls.length).toBe(1);
        expect(dispatchCalls[0]).toMatchObject({ mode: 'entry', entryId: 'prior-id' });
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

// A TODO.md body carrying one entry with the given id marker and checkbox state.
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

describe('AGENT view — checkbox is the ship signal on poll completion', () => {
    beforeEach(() => {
        listLogic.addProject('Boxly');
        mountDom('Boxly');
    });

    it('ships from a checked box on main even when the PR search still misses the merge', async () => {
        queueRows = [{ id: 'd1', state: 'drafted', context: { title: 'Ship it' }, draft: 'My entry' }];
        pollResult = { ok: true, found: true, status: 'completed', conclusion: 'success', runId: 111 };
        // The lagging closed-PR index hasn't surfaced the merge yet…
        resolveResult = { ok: true, found: false };
        // …but the entry's box is already checked on main (the dispatch mints
        // entry id 'mint-0'), so the completed poll still settles it to shipped.
        readTodoResult = { ok: true, content: todoBody('mint-0', true) };
        await loadBoard();

        document.querySelector('.agentDispatchButton').click();
        await flush();

        const shipped = updateCalls.find((c) => c.patch.state === 'shipped');
        expect(shipped).toBeTruthy();
        expect(shipped.id).toBe('d1');
        // No spurious no_change transition despite the empty PR-search result.
        expect(updateCalls.some((c) => c.patch.state === 'no_change')).toBe(false);
    });

    it('settles no_change from an unchecked box on main', async () => {
        queueRows = [{ id: 'd1', state: 'drafted', context: { title: 'Ship it' }, draft: 'My entry' }];
        pollResult = { ok: true, found: true, status: 'completed', conclusion: 'success', runId: 111 };
        readTodoResult = { ok: true, content: todoBody('mint-0', false) };
        runResultResult = { ok: true, result: 'Nothing to change.' };
        await loadBoard();

        document.querySelector('.agentDispatchButton').click();
        await flush();

        const noChange = updateCalls.find((c) => c.patch.state === 'no_change');
        expect(noChange).toBeTruthy();
        expect(noChange.patch.failure_reason).toBe('Nothing to change.');
        expect(updateCalls.some((c) => c.patch.state === 'shipped')).toBe(false);
    });
});

describe('AGENT view — mount-time settle of in-flight rows', () => {
    beforeEach(() => {
        listLogic.addProject('Resumely');
        mountDom('Resumely');
    });

    it('settles a dispatched row to shipped when its box is checked on main, with no completed poll', async () => {
        // A run dispatched earlier; the poll never surfaces a completion (it aged
        // out of the status window while the tab was closed).
        queueRows = [{
            id: 'r1', state: 'dispatched', context: { title: 'Away run' },
            entry_id: 'ent-away', correlation_id: 'corr-away',
        }];
        pollResult = { ok: true, found: false };
        readTodoResult = { ok: true, content: todoBody('ent-away', true) };

        await loadBoard();
        await flush();

        const shipped = updateCalls.find((c) => c.patch.state === 'shipped');
        expect(shipped).toBeTruthy();
        expect(shipped.id).toBe('r1');
        // The read hit the worker exactly for this mount settle.
        expect(readTodoCalls.length).toBeGreaterThan(0);
    });

    it('leaves a dispatched row alone at mount when its box is still unchecked', async () => {
        queueRows = [{
            id: 'r1', state: 'dispatched', context: { title: 'Still running' },
            entry_id: 'ent-run', correlation_id: 'corr-run',
        }];
        pollResult = { ok: true, found: false };
        readTodoResult = { ok: true, content: todoBody('ent-run', false) };

        await loadBoard();
        await flush();

        // An unchecked in-flight row may simply still be running — never settle
        // it to shipped or no_change from the mount pass.
        expect(updateCalls.some((c) => c.patch.state === 'shipped')).toBe(false);
        expect(updateCalls.some((c) => c.patch.state === 'no_change')).toBe(false);
    });

    it('does not read TODO.md at mount when no row is in-flight', async () => {
        queueRows = [{ id: 's1', state: 'shipped', context: { title: 'Done' }, pr_number: 5 }];
        await loadBoard();
        await flush();

        expect(readTodoCalls.length).toBe(0);
    });
});
