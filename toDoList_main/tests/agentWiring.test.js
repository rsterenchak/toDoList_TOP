import { vi } from 'vitest';

// The mockup flow, the assignment / coverage subsystem, and the triage-sweep /
// derive run trackers are configured by injected board-side callbacks. That
// injection used to run as a module-load side effect of the Agent board
// (agentView.js). Since main.js was severed from the board, the board no longer
// loads in the app, so the wiring moved to agentWiring.js — a leaf main.js imports
// on boot.
//
// This test asserts the run trackers are wired THROUGH THE NEW PATH — importing
// agentWiring.js, NOT the view. It is the assertion that would have caught the
// regression: five other test files import agentView.js purely for these side
// effects, so they keep passing whether or not the app is wired. Here the board is
// never imported; if agentWiring failed to configure the trackers, seedSweepState()
// would be an unconfigured no-op and the Worker probe below would never fire.

// ── supabase stub ────────────────────────────────────────────────────
vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
            update: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
            insert: (row) => Promise.resolve({ data: [row], error: null }),
            delete: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

// ── inject.js stub ───────────────────────────────────────────────────
// The wiring forwards the Worker probes from inject.js; stub them so the probe is
// observable and never touches the network. fetchActiveRuns reports a run in flight
// so seedSweepState begins tracking.
const fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: true }));
const pollRunStatus = vi.fn(() => Promise.resolve({ ok: true, found: false }));
const dispatchDerive = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock('../src/inject.js', () => ({
    fetchActiveRuns: (...a) => fetchActiveRuns(...a),
    pollRunStatus: (...a) => pollRunStatus(...a),
    dispatchDerive: (...a) => dispatchDerive(...a),
    showInjectToast: vi.fn(),
    mintEntryId: () => 'corr-test',
    findTargetById: () => null,
    readAssignmentFromWorker: () => Promise.resolve({ ok: false }),
    readRepoFile: () => Promise.resolve({ ok: false }),
    chatWithWorker: () => Promise.resolve({ reply: '' }),
}));

import { listLogic } from '../src/listLogic.js';
// Importing agentWiring.js runs the three configure* calls as a load side effect —
// the same thing that must happen on app boot.
import '../src/agentWiring.js';
import {
    seedSweepState,
    isSweepActive,
    stopSweepTracking,
    startDeriveTracking,
    isDeriveActive,
    stopDeriveTracking,
} from '../src/agentQueueStore.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) {
    for (let i = 0; i < n; i++) await tick();
}
function setSelected(name) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>';
}

beforeEach(() => {
    listLogic._reset();
    fetchActiveRuns.mockClear();
    pollRunStatus.mockClear();
    dispatchDerive.mockClear();
    document.body.innerHTML = '';
});

afterEach(() => {
    stopSweepTracking();
    stopDeriveTracking(true);
});

describe('agentWiring — boot wiring for the extracted agent subsystems', () => {
    it('configures the run trackers via the new path: seedSweepState probes triage without the board', async () => {
        listLogic.addProject('Alpha');
        setSelected('Alpha');

        seedSweepState();
        await flush();

        // The store's tracker reached the injected Worker probe — proof the wiring
        // ran. Unconfigured (the bug), this call would never happen.
        expect(fetchActiveRuns.mock.calls.some((c) => c[1] === 'triage')).toBe(true);
        expect(isSweepActive()).toBe(true);
    });

    it('configures the derive tracker via the new path: startDeriveTracking probes derive', async () => {
        listLogic.addProject('Alpha');
        setSelected('Alpha');

        startDeriveTracking();
        await flush();

        expect(isDeriveActive()).toBe(true);
        expect(fetchActiveRuns.mock.calls.some((c) => c[1] === 'derive')).toBe(true);
    });

    it('omits the board-only pill/repaint callbacks without throwing (no board is mounted)', async () => {
        listLogic.addProject('Alpha');
        setSelected('Alpha');

        // startDeriveTracking → stopDeriveTracking exercises the paint() call site,
        // and the sweep path exercises refreshStatusPill — both guarded, so a wiring
        // that omits them must not throw.
        expect(() => {
            startDeriveTracking();
            stopDeriveTracking();
            seedSweepState();
        }).not.toThrow();
        await flush();
    });
});
