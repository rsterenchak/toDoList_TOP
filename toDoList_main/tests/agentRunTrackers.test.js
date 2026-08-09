import { vi } from 'vitest';

// The triage-sweep and derive-run trackers were relocated out of the Agent board
// (agentView.js) into the shared queue store (agentQueueStore.js), so they now track
// a run whether or not the board is mounted — the same mount-independence the dispatch
// reconciler and the working watch already have. These tests drive the trackers
// DIRECTLY through the store's exported functions, with NO board rendered: they assert
// the accessors reflect state, the pill/Worker callbacks are invoked through
// configureRunTrackers, the working watch (now a store-local module, no longer a
// tracker DI callback) is seeded — observable as the `body.agentWorking` class — a
// sweep reconciles the project captured at start (not whatever is selected when it
// settles), a derive run resolves its conclusion, and both stop polling once settled.

// ── supabase stub ────────────────────────────────────────────────────
// `select().eq('project_id', id)` returns that project's rows and records the id it was
// queried with (so a reconcile can be attributed to the originating project);
// `update().eq('id', rowId)` records the patch (so a stuck-row flip is observable).
let selectEqProjectIds = [];
let updateCalls = [];
let rowsByProjectId = {};

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: (col, val) => {
                    selectEqProjectIds.push(val);
                    return Promise.resolve({ data: rowsByProjectId[val] || [], error: null });
                },
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
    seedSweepState,
    isSweepActive,
    startDeriveTracking,
    stopDeriveTracking,
    setDeriveCorrelationId,
    isDeriveActive,
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

let deps;
beforeEach(() => {
    listLogic._reset();
    selectEqProjectIds = [];
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
    // Ensure no interval survives a test even if one asserted mid-flight.
    stopSweepTracking();
    stopDeriveTracking(true);
});

describe('run trackers (relocated to the store) — triage sweep', () => {
    it('starts tracking with no board mounted: flips the accessor, seeds the working watch, and probes triage', async () => {
        listLogic.addProject('Alpha');
        setSelected('Alpha');

        startSweepTracking(false);

        expect(isSweepActive()).toBe(true);
        // The store-local working watch is seeded from dispatch time: the nav dot
        // lights immediately (body.agentWorking), no longer a tracker DI callback.
        expect(document.body.classList.contains('agentWorking')).toBe(true);
        expect(deps.refreshStatusPill).toHaveBeenCalled();
        await flush();
        expect(deps.fetchActiveRuns.mock.calls.some((c) => c[1] === 'triage')).toBe(true);

        stopSweepTracking();
        expect(isSweepActive()).toBe(false);
    });

    it('settles to Idle and stops polling when the confirmed run finishes', async () => {
        listLogic.addProject('Alpha');
        setSelected('Alpha');
        let n = 0;
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: n++ === 0 }));

        vi.useFakeTimers();
        startSweepTracking(false);
        await vi.advanceTimersByTimeAsync(0); // one-shot poll confirms in flight
        expect(isSweepActive()).toBe(true);

        await vi.advanceTimersByTimeAsync(POLL_MS + 50); // next tick → gone → settle
        expect(isSweepActive()).toBe(false);

        // The pill settled at once, but the reconcile's quiet window keeps probing for
        // a run queued behind the claude-triage concurrency group. Once that window
        // closes with nothing in flight, all probing stops.
        await vi.advanceTimersByTimeAsync(SWEEP_RECONCILE_QUIET_MS + POLL_MS * 2);
        deps.fetchActiveRuns.mockClear();
        await vi.advanceTimersByTimeAsync(POLL_MS * 4);
        expect(deps.fetchActiveRuns).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('reconciles the ORIGINATING project after a mid-sweep project switch', async () => {
        listLogic.addProject('Alpha');
        listLogic.addProject('Beta');
        const aId = listLogic.getProjectId('Alpha');
        const bId = listLogic.getProjectId('Beta');
        rowsByProjectId[aId] = [{ id: 'stuck-1', state: 'triaging' }];
        setSelected('Alpha');
        let n = 0;
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: n++ === 0 }));

        vi.useFakeTimers();
        startSweepTracking(false); // captures Alpha as the swept project
        await vi.advanceTimersByTimeAsync(0);

        // The user navigates to Beta while the sweep is still running.
        setSelected('Beta');
        await vi.advanceTimersByTimeAsync(POLL_MS + 50); // run finishes → pill settles
        // The reconcile waits out the quiet window first (nothing queued behind the
        // concurrency group here, so it closes on confirmed inactivity and fires).
        await vi.advanceTimersByTimeAsync(SWEEP_RECONCILE_QUIET_MS + POLL_MS * 2);
        vi.useRealTimers();
        await flush();

        // The reconcile queried Alpha's rows (captured at start), never Beta's, and
        // flipped the still-'triaging' row to failed.
        expect(selectEqProjectIds).toContain(aId);
        expect(selectEqProjectIds).not.toContain(bId);
        expect(updateCalls.some((c) => c.id === 'stuck-1' && c.patch.state === 'failed')).toBe(true);
    });

    it('seedSweepState begins tracking when a triage run is already in flight', async () => {
        listLogic.addProject('Alpha');
        setSelected('Alpha');
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: true }));

        seedSweepState();
        await flush();

        expect(isSweepActive()).toBe(true);
        // The mount seed (alreadyConfirmed=true) also seeds the store-local watch,
        // lighting the nav dot — observed via the body flag rather than a DI callback.
        expect(document.body.classList.contains('agentWorking')).toBe(true);
        stopSweepTracking();
    });
});

describe('run trackers (relocated to the store) — derive run', () => {
    it('tracks a derive run board-closed and surfaces a failure conclusion on completion', async () => {
        listLogic.addProject('Alpha');
        setSelected('Alpha');
        let n = 0;
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: n++ === 0 }));
        deps.pollRunStatus = vi.fn(() =>
            Promise.resolve({ ok: true, status: 'completed', conclusion: 'failure' }));

        vi.useFakeTimers();
        startDeriveTracking();
        setDeriveCorrelationId('corr-1');
        await vi.advanceTimersByTimeAsync(0);
        expect(isDeriveActive()).toBe(true);
        expect(deps.fetchActiveRuns.mock.calls.some((c) => c[1] === 'derive')).toBe(true);

        await vi.advanceTimersByTimeAsync(POLL_MS + 50); // run finishes
        vi.useRealTimers();
        await flush();

        expect(isDeriveActive()).toBe(false);
        expect(deps.pollRunStatus).toHaveBeenCalledWith(
            expect.objectContaining({ correlationId: 'corr-1' }));
        // A failure conclusion raises the toast and still refreshes the queue.
        expect(deps.showInjectToast).toHaveBeenCalled();
        expect(deps.refreshAgentQueue).toHaveBeenCalled();
        // The settle painted the board so the Draft button drops "Drafting…".
        expect(deps.paint).toHaveBeenCalled();
    });

    it('settles silently and stops polling when the derive run never registers', async () => {
        listLogic.addProject('Alpha');
        setSelected('Alpha');
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: false }));

        vi.useFakeTimers();
        startDeriveTracking();
        setDeriveCorrelationId('corr-2');
        // Grace window (30s) elapses with no confirmation → settle, no conclusion fetch.
        await vi.advanceTimersByTimeAsync(30 * 1000 + POLL_MS + 50);
        expect(isDeriveActive()).toBe(false);

        deps.fetchActiveRuns.mockClear();
        await vi.advanceTimersByTimeAsync(POLL_MS * 4);
        expect(deps.fetchActiveRuns).not.toHaveBeenCalled();
        vi.useRealTimers();

        expect(deps.pollRunStatus).not.toHaveBeenCalled();
        expect(deps.showInjectToast).not.toHaveBeenCalled();
    });

    it('stopDeriveTracking(true) tears down silently without a settle paint', async () => {
        listLogic.addProject('Alpha');
        setSelected('Alpha');
        startDeriveTracking();
        await flush();
        expect(isDeriveActive()).toBe(true);

        deps.paint.mockClear();
        stopDeriveTracking(true);
        expect(isDeriveActive()).toBe(false);
        expect(deps.paint).not.toHaveBeenCalled();
    });
});
