import { vi } from 'vitest';

// Regression coverage for the nav "● Agent" dot lagging 30-45s behind a triage
// sweep dispatch. The persistent working watch (startAgentWorkingWatch) toggles
// body.agentWorking; previously it only ever learned about a sweep from its slow
// remote active-runs probe, which is gated by claude-triage.yml registration lag
// plus the 15s poll tick — so the dot stayed dark for tens of seconds after a
// user dispatched a sweep. The fix seeds the watch from startSweepTracking (the
// shared chokepoint for the Run button and the cross-device mount seed), lighting
// the dot synchronously and holding it through the registration window. These
// tests drive the flow with a controllable fake Supabase + inject.js (no network)
// and a triage probe that is scripted to report the run NOT yet registered, so a
// lit dot can only have come from the optimistic seed, not the probe.

// ── Supabase stub ────────────────────────────────────────────────────
let queueRows = [];

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => Promise.resolve({ data: queueRows, error: null }),
            }),
            insert: (row) => Promise.resolve({ data: [row], error: null }),
            update: (patch) => ({
                eq: () => Promise.resolve({ data: [patch], error: null }),
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
// dispatchTriage is scriptable (ok/failure); the triage active-runs probe is
// scripted to report the run inactive by default, standing in for registration
// lag — so any lit dot proves the seed, not the probe.
let triageResult = { ok: true, dispatched: true };
let activeRunsQueue = [{ ok: true, active: false }];

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'corr-seed',
    embedEntryMarker: (text, id) => String(text) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: () => Promise.resolve({ ok: true, id: 'e' }),
    dispatchRun: () => Promise.resolve({ ok: true }),
    dispatchTriage: () => Promise.resolve(triageResult),
    pollRunStatus: () => Promise.resolve({ ok: true, found: false }),
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    fetchActiveRuns: () => {
        const next = activeRunsQueue.length > 1 ? activeRunsQueue.shift() : activeRunsQueue[0];
        return Promise.resolve(next || { ok: true, active: false });
    },
    readTodoMdFromWorker: () => Promise.resolve({ ok: false, reason: 'No target' }),
    findTargetById: () => null,
    showInjectToast: () => {},
}));

// agentView imports openChatWithSeed from claudeSheet.js; stub it so the real
// chat surface isn't pulled into jsdom.
vi.mock('../src/claudeSheet.js', () => ({
    openChatWithSeed: () => {},
}));

import { listLogic } from '../src/listLogic.js';
import {
    subscribeAgentView,
    unsubscribeAgentView,
    startAgentWorkingWatch,
} from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) {
    for (let i = 0; i < n; i++) await tick();
}

function mountDom(projectName) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>' +
        '<div id="agentView"></div>';
}

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    triageResult = { ok: true, dispatched: true };
    activeRunsQueue = [{ ok: true, active: false }];
    // NOTE: body.className is intentionally NOT reset — the watch's
    // setAgentWorkingClass only toggles on change, so the module's remembered
    // working state and the body class must stay in sync across tests. Each test
    // drives a genuine transition to its asserted value.
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribeAgentView();
    const toast = document.getElementById('agentViewToast');
    if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
});

describe('nav agent-working dot — seeded from sweep dispatch', () => {
    it('lights body.agentWorking the instant Run is tapped and keeps it lit across tab exit', async () => {
        listLogic.addProject('Alpha');
        mountDom('Alpha');
        // A queue with no dispatched/running ROW state, and the probe reports the
        // triage run not yet registered — so nothing but the optimistic seed can
        // light the dot.
        queueRows = [{ id: '1', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];

        startAgentWorkingWatch();
        subscribeAgentView();
        await flush();
        // Baseline: no sweep, no in-flight row, probe inactive → dark.
        expect(document.body.classList.contains('agentWorking')).toBe(false);

        document.querySelector('.agentRunBtn').click();
        await flush();

        // The seed lit the dot immediately, despite the probe still reporting the
        // run unregistered — this is the 30-45s lag the fix removes.
        expect(document.body.classList.contains('agentWorking')).toBe(true);

        // Leaving the Agent tab tears down the board subscription and the mounted
        // sweep tracking, but the persistent watch owns the dot from dispatch
        // time — so it must NOT blink off on tab exit.
        unsubscribeAgentView();
        await flush();
        expect(document.body.classList.contains('agentWorking')).toBe(true);
    });

    it('clears body.agentWorking when the Run dispatch fails (no run will register)', async () => {
        listLogic.addProject('Beta');
        mountDom('Beta');
        queueRows = [{ id: '1', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];
        triageResult = { ok: false, reason: 'Server error 500' };

        startAgentWorkingWatch();
        subscribeAgentView();
        await flush();

        document.querySelector('.agentRunBtn').click();
        await flush();

        // A failed dispatch must not leave the dot stuck lit through the grace
        // window — the seed is dropped and the dot settles dark.
        expect(document.body.classList.contains('agentWorking')).toBe(false);
    });

    it('lights the dot on mount when a sweep is already running (cross-device seed)', async () => {
        listLogic.addProject('Gamma');
        mountDom('Gamma');
        queueRows = [{ id: '1', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];
        // The Worker reports a triage run already in flight before any tap here.
        activeRunsQueue = [{ ok: true, active: true }];

        startAgentWorkingWatch();
        subscribeAgentView();
        await flush();

        // The mount seed (seedSweepState → startSweepTracking) lights the dot even
        // though this client never tapped Run.
        expect(document.body.classList.contains('agentWorking')).toBe(true);
    });
});
