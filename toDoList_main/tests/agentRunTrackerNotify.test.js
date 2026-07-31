import { vi } from 'vitest';

// Regression: the derive-run tracker announced its Working/Idle transitions ONLY
// through the board's refreshStatusPill / paint callbacks. When the Agent board was
// severed from main.js those callbacks were deliberately dropped (no board to repaint),
// which silently swallowed the tracker's only signal — the Coverage tab's Derive action
// stayed on "Deriving…" and the nav dot never moved for a derive.
//
// The fix is a store-owned notification: the derive tracker fires notifyQueueChange()
// on each state transition (the Coverage tab observes it via onQueueChange) and drives
// the nav working dot's body.agentWorking class directly, since the persistent watch
// polls independently and does not observe onQueueChange. These tests drive the tracker
// with NO board mounted and with the board-only pill/paint callbacks OMITTED (exactly as
// the app wiring configures them), so they assert the surface signal survives the
// board's absence — the one assertion that would have caught the regression.
//
// The SWEEP tracker deliberately does NOT notify: it only runs while the Agent board is
// mounted (the app's triage dispatcher is board-owned), so a sweep notify would reach
// only the board, whose full-paint listener clobbers the Run button's transient label.

let rowsByProjectId = {};
vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: (col, val) => Promise.resolve({ data: rowsByProjectId[val] || [], error: null }),
            }),
            update: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

import { listLogic } from '../src/listLogic.js';
import {
    configureRunTrackers,
    onQueueChange,
    startSweepTracking,
    stopSweepTracking,
    startDeriveTracking,
    stopDeriveTracking,
    isDeriveActive,
    isSweepActive,
    pollAgentWorkingWatch,
    clearWorkingWatchSweepSeed,
} from '../src/agentQueueStore.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) {
    for (let i = 0; i < n; i++) await tick();
}
function setSelected(name) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>';
}

// Wire the trackers the way agentWiring.js does in the running app: the live Worker
// probes and queue reload, but NO refreshStatusPill and NO paint — there is no board.
function wireBoardless() {
    configureRunTrackers({
        refreshAgentQueue: vi.fn(),
        fetchActiveRuns: vi.fn(() => Promise.resolve({ ok: true, active: false })),
        pollRunStatus: vi.fn(() => Promise.resolve({ ok: true, found: false })),
        resolveDispatchTarget: vi.fn(() => ({ repo: 'owner/repo', file_path: 'TODO.md' })),
        showInjectToast: vi.fn(),
    });
}

let unsub;
beforeEach(async () => {
    listLogic._reset();
    rowsByProjectId = {};
    document.body.innerHTML = '';
    wireBoardless();
    // Resync the persistent watch's nav-dot state to a known idle baseline. Its
    // _workingWatchState is module-level and setAgentWorkingClass() dedups on it, so
    // a prior test that lit the dot would otherwise desync the class from the state
    // (clearing the class alone wouldn't flip the flag). Drive it back to false
    // through the real recompute: nothing selected → both probes false → dot off.
    stopSweepTracking();
    stopDeriveTracking(true);
    clearWorkingWatchSweepSeed(); // drop any leftover sweep seed still in its grace window
    await pollAgentWorkingWatch();
    document.body.className = '';
});

afterEach(() => {
    if (unsub) { unsub(); unsub = null; }
    stopSweepTracking();
    stopDeriveTracking(true);
});

describe('derive tracker notifies the store on transition (board-independent surface signal)', () => {
    it('the sweep tracker does NOT notify (its only surface is the mounted board)', async () => {
        // Notifying on a sweep transition would clobber the board's transient Run
        // button; the sweep pill is covered by the board's own refreshStatusPill.
        listLogic.addProject('Alpha');
        setSelected('Alpha');
        const seen = vi.fn();
        unsub = onQueueChange(seen);

        startSweepTracking(false);
        expect(isSweepActive()).toBe(true);
        stopSweepTracking();
        expect(isSweepActive()).toBe(false);
        expect(seen).not.toHaveBeenCalled();
    });

    it('derive start lights the nav dot and notifies; settle clears the dot and notifies', async () => {
        listLogic.addProject('Alpha');
        setSelected('Alpha');
        const seen = vi.fn();
        unsub = onQueueChange(seen);

        startDeriveTracking();
        expect(isDeriveActive()).toBe(true);
        expect(seen).toHaveBeenCalled();
        // The nav dot lights from dispatch time — no board, no pill, no project switch.
        expect(document.body.classList.contains('agentWorking')).toBe(true);

        seen.mockClear();
        stopDeriveTracking(); // real settle (not silent)
        expect(isDeriveActive()).toBe(false);
        expect(seen).toHaveBeenCalled();
        // The dot recompute is async (it re-probes); nothing else is in flight, so it clears.
        await flush();
        expect(document.body.classList.contains('agentWorking')).toBe(false);
    });

    it('a silent derive teardown does NOT notify the store', async () => {
        listLogic.addProject('Alpha');
        setSelected('Alpha');
        startDeriveTracking();
        await flush();
        const seen = vi.fn();
        unsub = onQueueChange(seen);

        stopDeriveTracking(true); // board teardown, not a run finishing
        expect(isDeriveActive()).toBe(false);
        expect(seen).not.toHaveBeenCalled();
    });
});
