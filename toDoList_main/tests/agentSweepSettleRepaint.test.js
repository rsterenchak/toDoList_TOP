import { vi } from 'vitest';

// Regression: when a triage sweep finishes, the main section's task row must
// repaint WITHOUT depending on the `public:agent_queue` realtime push.
//
// claude-triage.yml flips the row to `drafted` on GitHub and the row layer
// repaints only via notifyQueueChange() → refreshDescStatusDots(). On the success
// path the sole caller of notifyQueueChange was that one realtime push, so a push
// missed (socket dropped while the app was backgrounded on iOS, or a reconnect
// without replay) left the row painted Generating… until the user refreshed or
// switched projects and back — finishSweep() only settled the pill, and
// verifyThenReconcile reloads rows solely in its stuck-`triaging` failure branch.
//
// Two independent repairs are pinned here, both push-free:
//   (1) finishSweep() reloads the swept project's rows the moment the run is
//       confirmed finished.
//   (2) pollAgentWorkingWatch() already fetches the selected project's rows every
//       tick for the nav dot and used to discard them; it now adopts them into the
//       render cache and notifies whenever their `id:state` signature has moved,
//       so a missed push self-heals within one poll interval.

// ── supabase stub ────────────────────────────────────────────────────
// Mirrors agentSweepQueuedReconcile.test.js: `select().eq('project_id', id)` serves
// that project's rows, so flipping `rowsByProjectId` mid-test simulates the
// workflow writing a verdict server-side with no push delivered to this client.
let rowsByProjectId = {};

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: (col, val) => Promise.resolve({ data: rowsByProjectId[val] || [], error: null }),
            }),
            update: (patch) => ({ eq: () => Promise.resolve({ data: [patch], error: null }) }),
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
    clearWorkingWatchSweepSeed,
    pollAgentWorkingWatch,
    loadQueueRows,
    setQueueRows,
    getQueueRows,
    notifyQueueChange,
    onQueueChange,
} from '../src/agentQueueStore.js';

const POLL_MS = 5000;
function setSelected(name) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>';
}
// A routed project, selected, owning whatever rows the caller hands over.
function routedProject(name, rows) {
    listLogic.addProject(name);
    listLogic.setProjectTargetId(name, 'tgt-1');
    rowsByProjectId[listLogic.getProjectId(name)] = rows;
    setSelected(name);
    return listLogic.getProjectId(name);
}
function states() {
    return getQueueRows().map((r) => r.state);
}

let deps;
let repaints;
let unsubscribe;
beforeEach(() => {
    listLogic._reset();
    rowsByProjectId = {};
    setQueueRows([], null);
    repaints = vi.fn();
    unsubscribe = onQueueChange(repaints);
    deps = {
        refreshStatusPill: vi.fn(),
        paint: vi.fn(),
        // The app's real wiring (agentWiring.js): reload the project's rows, then
        // notify only while it is still the loaded one.
        refreshAgentQueue: vi.fn((name) => loadQueueRows(name).then(() => notifyQueueChange())),
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
    unsubscribe();
    stopSweepTracking();
    clearWorkingWatchSweepSeed();
    vi.useRealTimers();
});

describe('a settled triage sweep repaints without a realtime push', () => {
    it('reloads and notifies the swept project when the run is confirmed finished', async () => {
        const pid = routedProject('Alpha', [{ id: 'row-1', state: 'triaging' }]);
        await loadQueueRows('Alpha');
        expect(states()).toEqual(['triaging']);

        // Probe timeline: the sweep registers, then finishes. While it ran, the
        // workflow wrote its verdict — no push reaches this client.
        let n = 0;
        deps.fetchActiveRuns = vi.fn(() => {
            n += 1;
            if (n === 1) return Promise.resolve({ ok: true, active: true });
            rowsByProjectId[pid] = [{ id: 'row-1', state: 'drafted' }];
            return Promise.resolve({ ok: true, active: false });
        });

        vi.useFakeTimers();
        startSweepTracking(false);
        await vi.advanceTimersByTimeAsync(0);            // probe 1 → run in flight
        repaints.mockClear();
        await vi.advanceTimersByTimeAsync(POLL_MS + 50); // probe 2 → gone → settle
        await vi.advanceTimersByTimeAsync(0);
        vi.useRealTimers();

        expect(deps.refreshAgentQueue).toHaveBeenCalledWith('Alpha');
        expect(states()).toEqual(['drafted']);
        expect(repaints).toHaveBeenCalled();
    });

    it('does not reload when no sweep was actually being tracked', async () => {
        routedProject('Bravo', [{ id: 'row-2', state: 'triaging' }]);
        // A settle-shaped teardown with nothing tracked must stay a pure no-op.
        stopSweepTracking();
        await Promise.resolve();

        expect(deps.refreshAgentQueue).not.toHaveBeenCalled();
    });
});

describe('working watch — a missed push self-heals from the watch fetch', () => {
    it('adopts rows whose state moved server-side and notifies once per change', async () => {
        const pid = routedProject('Charlie', [{ id: 'row-3', state: 'triaging' }]);
        await loadQueueRows('Charlie');
        repaints.mockClear();

        // The sweep finished on GitHub and the row is now drafted; the push that
        // would have told this client never arrived.
        rowsByProjectId[pid] = [{ id: 'row-3', state: 'drafted' }];

        await pollAgentWorkingWatch();
        expect(states()).toEqual(['drafted']);
        expect(repaints).toHaveBeenCalledTimes(1);

        // Nothing moved since — the cache now matches, so no further repaints. This
        // is what keeps the board's transient Run-button label from being clobbered
        // on every tick.
        await pollAgentWorkingWatch();
        await pollAgentWorkingWatch();
        expect(repaints).toHaveBeenCalledTimes(1);
    });

    it('reads a reordered but unchanged result as no change', async () => {
        const pid = routedProject('Delta', [
            { id: 'row-a', state: 'drafted' },
            { id: 'row-b', state: 'proposed' },
        ]);
        await loadQueueRows('Delta');
        repaints.mockClear();

        rowsByProjectId[pid] = [
            { id: 'row-b', state: 'proposed' },
            { id: 'row-a', state: 'drafted' },
        ];
        await pollAgentWorkingWatch();

        expect(repaints).not.toHaveBeenCalled();
    });

    it('never writes another project’s rows into the selected project’s cache', async () => {
        routedProject('Echo', [{ id: 'row-4', state: 'triaging' }]);
        routedProject('Foxtrot', [{ id: 'row-5', state: 'drafted' }]);
        // Foxtrot is on screen, but Echo's rows are the loaded ones — the tick's
        // fetch belongs to Foxtrot and must be dropped rather than cached.
        await loadQueueRows('Echo');
        repaints.mockClear();
        setSelected('Foxtrot');

        await pollAgentWorkingWatch();

        expect(states()).toEqual(['triaging']);
        expect(repaints).not.toHaveBeenCalled();
    });
});
