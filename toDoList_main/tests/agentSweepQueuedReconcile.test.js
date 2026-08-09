import { vi } from 'vitest';

// Regression: a triage run that is QUEUED behind claude-triage.yml's
// `concurrency: { group: claude-triage, cancel-in-progress: false }` must never be
// reconciled to `failed` (the ⌁ STUCK badge) before it has had a real chance to start.
//
// The sweep tracker settles the header pill off the Worker's `active_runs` probe, and
// `finishSweep` used to hand straight to `reconcileStuckTriaging`, which flips every
// still-'triaging' row for the swept project to `failed`. But the probe reports a run
// as active only once GitHub promotes it out of the concurrency queue, so a Generate
// click fired while an earlier sweep is still running settles the tracker (grace
// elapsed, or the earlier run finished) while the dispatched run is sitting QUEUED —
// and the reconcile wrongly failed a row whose run had not even started.
//
// The fix puts a quiet window between the settle and the reconcile: rows are only
// flipped after SWEEP_RECONCILE_QUIET_MS of *confirmed* inactivity. A probe that
// reports a run in flight during that window resumes tracking instead, and a window
// where every probe errored writes nothing at all.

// ── supabase stub ────────────────────────────────────────────────────
// Mirrors agentRunTrackers.test.js: `select().eq('project_id', id)` serves that
// project's rows, `update().eq('id', rowId)` records the patch so a stuck-row flip
// (or its absence) is observable.
let updateCalls = [];
let rowsByProjectId = {};

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: (col, val) => Promise.resolve({ data: rowsByProjectId[val] || [], error: null }),
            }),
            update: (patch) => ({
                eq: (col, id) => {
                    updateCalls.push({ id, patch });
                    return Promise.resolve({ data: [patch], error: null });
                },
            }),
            insert: (row) => Promise.resolve({ data: [row], error: null }),
            delete: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

import { listLogic } from '../src/listLogic.js';
import {
    configureRunTrackers,
    startSweepTracking,
    stopSweepTracking,
    isSweepActive,
    SWEEP_GRACE_MS,
    SWEEP_RECONCILE_QUIET_MS,
} from '../src/agentQueueStore.js';

const POLL_MS = 5000;
const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) {
    for (let i = 0; i < n; i++) await tick();
}
function setSelected(name) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>';
}
function failedFlips() {
    return updateCalls.filter((c) => c.patch && c.patch.state === 'failed');
}

let deps;
beforeEach(() => {
    listLogic._reset();
    updateCalls = [];
    rowsByProjectId = {};
    deps = {
        refreshStatusPill: vi.fn(),
        paint: vi.fn(),
        refreshAgentQueue: vi.fn(),
        fetchActiveRuns: vi.fn(() => Promise.resolve({ ok: true, active: false })),
        pollRunStatus: vi.fn(() => Promise.resolve({ ok: true, found: false })),
        resolveDispatchTarget: vi.fn(() => ({ repo: 'owner/repo', file_path: 'TODO.md' })),
        showInjectToast: vi.fn(),
    };
    configureRunTrackers(deps);
    document.body.innerHTML = '';
});

afterEach(() => {
    stopSweepTracking();
    vi.useRealTimers();
});

describe('triage sweep — queued-behind runs are not reconciled to STUCK', () => {
    it('leaves the row triaging and resumes tracking when the queued run registers inside the quiet window', async () => {
        listLogic.addProject('Alpha');
        const aId = listLogic.getProjectId('Alpha');
        rowsByProjectId[aId] = [{ id: 'queued-1', state: 'triaging' }];
        setSelected('Alpha');

        // Probe timeline: the EARLIER sweep is in flight (active), then it finishes and
        // our dispatch is still sitting in the concurrency queue (inactive — the probe
        // cannot see a queued run), then GitHub promotes it and it shows up as active.
        let n = 0;
        deps.fetchActiveRuns = vi.fn(() => {
            n += 1;
            return Promise.resolve({ ok: true, active: n === 1 || n >= 4 });
        });

        vi.useFakeTimers();
        startSweepTracking(false);
        await vi.advanceTimersByTimeAsync(0);      // probe 1 → earlier sweep active
        await vi.advanceTimersByTimeAsync(POLL_MS + 50); // probe 2 → gone → settle pill

        // The pill settled, but the reconcile must NOT have run yet — the dispatched
        // run could still be queued behind the group.
        expect(failedFlips()).toHaveLength(0);

        // Quiet-window probes: 3 is still inactive (queued), 4 sees it promoted.
        await vi.advanceTimersByTimeAsync(POLL_MS * 3 + 50);
        vi.useRealTimers();
        await flush();

        // The run is alive, so no row was ever failed and the tracker picked it back up.
        expect(failedFlips()).toHaveLength(0);
        expect(isSweepActive()).toBe(true);
        stopSweepTracking();
    });

    it('does not reconcile within the old 30s grace window when the run never registers', async () => {
        listLogic.addProject('Alpha');
        const aId = listLogic.getProjectId('Alpha');
        rowsByProjectId[aId] = [{ id: 'queued-2', state: 'triaging' }];
        setSelected('Alpha');
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: false }));

        vi.useFakeTimers();
        startSweepTracking(false);
        // Grace elapses → pill settles. Under the old behaviour the row flipped to
        // failed right here, ~30s after the Generate click.
        await vi.advanceTimersByTimeAsync(SWEEP_GRACE_MS + POLL_MS + 50);
        vi.useRealTimers();
        await flush();
        expect(isSweepActive()).toBe(false);
        expect(failedFlips()).toHaveLength(0);
    });

    it('still reconciles an abandoned sweep once the quiet window closes with no run in flight', async () => {
        listLogic.addProject('Alpha');
        const aId = listLogic.getProjectId('Alpha');
        rowsByProjectId[aId] = [{ id: 'abandoned-1', state: 'triaging' }];
        setSelected('Alpha');
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: false }));

        vi.useFakeTimers();
        startSweepTracking(false);
        await vi.advanceTimersByTimeAsync(
            SWEEP_GRACE_MS + SWEEP_RECONCILE_QUIET_MS + POLL_MS * 2 + 50);
        vi.useRealTimers();
        await flush();

        expect(failedFlips().some((c) => c.id === 'abandoned-1')).toBe(true);
        expect(deps.refreshAgentQueue).toHaveBeenCalledWith('Alpha');
    });

    it('writes nothing when every probe inside the quiet window errors — no evidence, no STUCK', async () => {
        listLogic.addProject('Alpha');
        const aId = listLogic.getProjectId('Alpha');
        rowsByProjectId[aId] = [{ id: 'unknown-1', state: 'triaging' }];
        setSelected('Alpha');

        // Confirmed in flight, then the run disappears (settle), then the Worker probe
        // starts failing for the whole quiet window.
        let n = 0;
        deps.fetchActiveRuns = vi.fn(() => {
            n += 1;
            if (n === 1) return Promise.resolve({ ok: true, active: true });
            if (n === 2) return Promise.resolve({ ok: true, active: false });
            return Promise.resolve({ ok: false, reason: 'network' });
        });

        vi.useFakeTimers();
        startSweepTracking(false);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(
            POLL_MS + SWEEP_RECONCILE_QUIET_MS + POLL_MS * 2 + 50);
        vi.useRealTimers();
        await flush();

        // Only a reading taken INSIDE the window licenses a reconcile — the settle's own
        // inactive reading is what opened the window, not evidence the run stayed gone.
        // Every window probe errored, so there is no evidence either way and nothing is
        // written: a row left Triaging is recoverable, a row wrongly marked STUCK is not.
        expect(failedFlips()).toHaveLength(0);
    });

    it('never flips rows when the probe fails from the very first tick', async () => {
        listLogic.addProject('Alpha');
        const aId = listLogic.getProjectId('Alpha');
        rowsByProjectId[aId] = [{ id: 'unknown-2', state: 'triaging' }];
        setSelected('Alpha');
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: false, reason: 'network' }));

        vi.useFakeTimers();
        startSweepTracking(false);
        // The hard cap force-stops the wedged poller; the quiet window then runs with
        // no successful probe, so there is no evidence the run is gone.
        await vi.advanceTimersByTimeAsync(
            5 * 60 * 1000 + SWEEP_RECONCILE_QUIET_MS + POLL_MS * 2 + 50);
        vi.useRealTimers();
        await flush();

        expect(failedFlips()).toHaveLength(0);
    });

    it('reconciles the project captured at dispatch even when tracking resumes mid-window', async () => {
        listLogic.addProject('Alpha');
        listLogic.addProject('Beta');
        const aId = listLogic.getProjectId('Alpha');
        rowsByProjectId[aId] = [{ id: 'alpha-1', state: 'triaging' }];
        setSelected('Alpha');

        vi.useFakeTimers();
        const t0 = Date.now();
        // Wall-clock timeline rather than call counts: the earlier sweep holds the slot
        // for 5s, our dispatch is queued and invisible until 10s, runs to 20s, then the
        // group is genuinely empty.
        deps.fetchActiveRuns = vi.fn(() => {
            const t = Date.now() - t0;
            return Promise.resolve({ ok: true, active: t < 5000 || (t >= 10000 && t < 20000) });
        });

        startSweepTracking(false); // captures Alpha
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(5050); // earlier sweep gone → pill settles
        setSelected('Beta');                     // user navigates away
        await vi.advanceTimersByTimeAsync(10000); // our run registers → tracking resumes
        expect(isSweepActive()).toBe(true);
        expect(failedFlips()).toHaveLength(0);

        // The resumed run finishes and its quiet window closes with nothing in flight.
        await vi.advanceTimersByTimeAsync(SWEEP_RECONCILE_QUIET_MS + POLL_MS * 4);
        vi.useRealTimers();
        await flush();

        // Alpha's row — the project captured at dispatch — is the one reconciled, even
        // though Beta is on screen when the sweep finally settles.
        expect(failedFlips().some((c) => c.id === 'alpha-1')).toBe(true);
    });
});
