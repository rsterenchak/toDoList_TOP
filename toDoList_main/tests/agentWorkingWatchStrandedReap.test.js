import { vi } from 'vitest';

// Regression: a row flagged for the agent that never got a triage run behind it
// must not sit at `triaging` (Generating…) forever.
//
// The post-settle reconcile (verifyThenReconcile → reconcileStuckTriaging) only
// runs in the session that dispatched the sweep, so a dispatch swallowed by the
// in-flight guard, a row flagged from another device whose sweep has since
// settled, or a row stranded before the workflow-side reaper existed is never
// repaired. The persistent working watch already computes both halves of that
// condition every tick for the nav dot — the project owns a `triaging` row and
// the repo-wide triage probe reports nothing in flight — so it now reaps the row
// too, but only after SWEEP_RECONCILE_QUIET_MS of CONTINUOUS confirmed
// inactivity (claude-triage.yml serialises on its concurrency group, so a
// just-dispatched run is invisible to the probe for a while).
//
// These pins drive pollAgentWorkingWatch directly rather than through the
// interval, so each tick's reading is scripted exactly.

// ── supabase stub ────────────────────────────────────────────────────
// Mirrors agentSweepQueuedReconcile.test.js: `select().eq('project_id', id)`
// serves that project's rows and `update().eq('id', rowId)` records the patch, so
// a stuck-row flip (or its absence) is observable.
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
    pollAgentWorkingWatch,
    startSweepTracking,
    stopSweepTracking,
    clearWorkingWatchSweepSeed,
    SWEEP_RECONCILE_QUIET_MS,
} from '../src/agentQueueStore.js';

const BASE = new Date('2026-09-07T00:00:00Z').getTime();
let now = BASE;

// Move the mocked clock without running any interval (each test drives its own
// ticks), then run one watch evaluation to completion.
function advance(ms) {
    now += ms;
    vi.setSystemTime(new Date(now));
}
async function tick() {
    await pollAgentWorkingWatch();
}
function setSelected(name) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>';
}
function failedFlips() {
    return updateCalls.filter((c) => c.patch && c.patch.state === 'failed');
}
// A routed project owning a single stranded `triaging` row.
function strandedProject(name, rowId) {
    listLogic.addProject(name);
    listLogic.setProjectTargetId(name, 'tgt-1');
    rowsByProjectId[listLogic.getProjectId(name)] = [{ id: rowId, state: 'triaging' }];
    setSelected(name);
}

let deps;
beforeEach(() => {
    listLogic._reset();
    updateCalls = [];
    rowsByProjectId = {};
    now = BASE;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
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
    document.body.className = '';
    document.body.innerHTML = '';
});

afterEach(() => {
    stopSweepTracking();
    // The watch's seeded-sweep state is module-level, so a test that seeds it
    // must not leak that seed into the next one.
    clearWorkingWatchSweepSeed();
    vi.useRealTimers();
});

describe('working watch — reaping rows stranded at triaging', () => {
    it('does not reap before the quiet window has elapsed', async () => {
        strandedProject('Alpha', 'stranded-1');

        await tick();                                 // window opens here
        advance(SWEEP_RECONCILE_QUIET_MS - 1000);
        await tick();

        expect(failedFlips()).toHaveLength(0);
    });

    it('reaps once the window elapses, and only once', async () => {
        strandedProject('Bravo', 'stranded-2');

        await tick();
        advance(SWEEP_RECONCILE_QUIET_MS + 1000);
        await tick();
        await tick();   // window was cleared by the reap — a second tick restarts it

        const flips = failedFlips();
        expect(flips).toHaveLength(1);
        expect(flips[0].id).toBe('stranded-2');
        // The reason is the existing one, so the row shows STUCK + Retry triage.
        expect(flips[0].patch.failure_reason).toMatch(/Retry triage/);
        expect(deps.refreshAgentQueue).toHaveBeenCalledWith('Bravo');
    });

    it('restarts the window on a reading that shows a triage run in flight', async () => {
        strandedProject('Charlie', 'stranded-3');

        await tick();
        advance(SWEEP_RECONCILE_QUIET_MS - 1000);
        // The queued run finally registered — the row is being processed after all.
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: true }));
        await tick();
        // Back to quiet, but the window starts over from this reading.
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: false }));
        advance(2000);
        await tick();

        expect(failedFlips()).toHaveLength(0);
    });

    it('restarts the window on a probe error — absence of evidence never reaps', async () => {
        strandedProject('Delta', 'stranded-4');

        await tick();
        advance(SWEEP_RECONCILE_QUIET_MS - 1000);
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: false, reason: 'Worker 500' }));
        await tick();
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: false }));
        advance(2000);
        await tick();

        expect(failedFlips()).toHaveLength(0);
    });

    it('restarts the window when the selected project changes', async () => {
        strandedProject('Echo', 'stranded-5');
        await tick();
        advance(SWEEP_RECONCILE_QUIET_MS - 1000);

        // Switch to another project that ALSO owns a stranded row: the elapsed
        // time belongs to Echo, so Foxtrot must start its own window.
        strandedProject('Foxtrot', 'stranded-6');
        await tick();
        advance(2000);
        await tick();

        expect(failedFlips()).toHaveLength(0);
    });

    it('does not count ticks taken while a sweep is being tracked', async () => {
        strandedProject('Golf', 'stranded-7');

        // A live sweep for this project: the tracker is active and the watch holds
        // a local seed, so these ticks must not open the window even though the
        // probe still reports the run unregistered.
        startSweepTracking(false);
        await vi.advanceTimersByTimeAsync(0);
        await tick();
        advance(SWEEP_RECONCILE_QUIET_MS + 1000);
        await tick();
        expect(failedFlips()).toHaveLength(0);

        // Tracking ends with the row still triaging. The first unguarded tick only
        // OPENS the window — nothing is reaped until it has run its full length.
        stopSweepTracking();
        clearWorkingWatchSweepSeed();
        await tick();
        expect(failedFlips()).toHaveLength(0);

        advance(SWEEP_RECONCILE_QUIET_MS + 1000);
        await tick();
        expect(failedFlips()).toHaveLength(1);
    });
});
