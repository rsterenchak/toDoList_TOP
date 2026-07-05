import { vi } from 'vitest';

// The Agent view can fire the triage sweep from inside the tab: a project-level
// Run button in the header dispatches claude-triage.yml for the active project,
// and answering a needs_words card auto-fires a sweep after the answer persists.
// Both go through inject.js's dispatchTriage (Worker `dispatch_triage` route) as
// fire-and-forget — no polling; the realtime subscription surfaces verdicts.
// These tests drive that flow with a controllable fake Supabase client (update
// observation) and a mocked inject.js so no network is touched and each
// dispatchTriage result can be scripted.

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
// Only dispatchTriage matters here; the rest are inert stubs so the module's
// other imports resolve. mintEntryId returns a stable value used for the
// (UI-irrelevant) correlation id.
let triageResult = { ok: true, dispatched: true };
let triageCalls = [];
// Scriptable triage active_runs probe: the header pill is driven from this. Each
// element is returned in turn (then the last repeats), so a test can script an
// arc like [inactive-lag, active, inactive-done]. Calls are recorded so a test
// can assert the probe was triage-scoped.
let activeRunsQueue = [];
let activeRunsCalls = [];

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'corr-1',
    embedEntryMarker: (text, id) => String(text) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: () => Promise.resolve({ ok: true, id: 'e' }),
    dispatchRun: () => Promise.resolve({ ok: true }),
    dispatchTriage: (projectId, correlationId) => {
        triageCalls.push({ projectId, correlationId });
        return Promise.resolve(triageResult);
    },
    pollRunStatus: () => Promise.resolve({ ok: true, found: false }),
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    fetchActiveRuns: (target, workflow) => {
        activeRunsCalls.push({ target, workflow });
        const next = activeRunsQueue.length > 1 ? activeRunsQueue.shift() : activeRunsQueue[0];
        return Promise.resolve(next || { ok: true, active: false });
    },
    readTodoMdFromWorker: () => Promise.resolve({ ok: false, reason: 'No target' }),
    findTargetById: () => null,
    showInjectToast: () => {},
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
    triageResult = { ok: true, dispatched: true };
    triageCalls = [];
    activeRunsQueue = [{ ok: true, active: false }];
    activeRunsCalls = [];
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribeAgentView();
    const toast = document.getElementById('agentViewToast');
    if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
});

describe('AGENT view — header Run button (triage dispatch)', () => {
    it('renders a Run button in the header for a selected project', async () => {
        listLogic.addProject('Alpha');
        mountDom('Alpha');
        queueRows = [{ id: '1', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];
        await loadBoard();
        const runBtn = document.querySelector('.agentRunBtn');
        expect(runBtn).toBeTruthy();
        expect(runBtn.textContent).toBe('Run');
    });

    it('dispatches a triage sweep for the active project id on tap', async () => {
        listLogic.addProject('Beta');
        mountDom('Beta');
        queueRows = [{ id: '1', state: 'triaging', context: { title: 'X' } }];
        await loadBoard();

        document.querySelector('.agentRunBtn').click();
        await flush();

        expect(triageCalls.length).toBe(1);
        expect(triageCalls[0].projectId).toBe(listLogic.getProjectId('Beta'));
        // A brief queued acknowledgment shows on the button.
        expect(document.querySelector('.agentRunBtn').textContent).toBe('Queued');
    });

    it('coalesces a rapid double-tap into a single sweep (in-flight guard)', async () => {
        listLogic.addProject('Gamma');
        mountDom('Gamma');
        queueRows = [{ id: '1', state: 'triaging', context: { title: 'X' } }];
        await loadBoard();

        // Two taps before the first settles: the module in-flight guard should
        // drop the second. (The button also disables, but the guard is the real
        // backstop across repaints.)
        const runBtn = document.querySelector('.agentRunBtn');
        runBtn.click();
        runBtn.click();
        await flush();

        expect(triageCalls.length).toBe(1);
    });

    it('shows a retry acknowledgment when the dispatch fails', async () => {
        listLogic.addProject('Delta');
        mountDom('Delta');
        queueRows = [{ id: '1', state: 'triaging', context: { title: 'X' } }];
        triageResult = { ok: false, reason: 'Server error 500' };
        await loadBoard();

        document.querySelector('.agentRunBtn').click();
        await flush();

        expect(triageCalls.length).toBe(1);
        expect(document.querySelector('.agentRunBtn').textContent).toBe('Try again');
    });
});

describe('AGENT view — auto-fire triage on answer', () => {
    it('dispatches a triage sweep after a needs_words answer persists', async () => {
        listLogic.addProject('Mu');
        mountDom('Mu');
        queueRows = [{
            id: 'nw1',
            state: 'needs_words',
            context: { title: 'Add a toggle' },
            question: 'Which label?',
            thread: [],
        }];
        await loadBoard();

        const input = document.querySelector('.agentAnswerInput');
        input.value = 'Use "Done"';
        document.querySelector('.agentAnswerSend').click();
        await flush();

        // The answer write happened (row -> triaging) AND a triage sweep fired.
        expect(updateCalls.length).toBe(1);
        expect(updateCalls[0].patch.state).toBe('triaging');
        expect(triageCalls.length).toBe(1);
        expect(triageCalls[0].projectId).toBe(listLogic.getProjectId('Mu'));
    });

    it('does not dispatch triage when the answer write fails', async () => {
        listLogic.addProject('Nu');
        mountDom('Nu');
        queueRows = [{ id: 'nw2', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];
        updateError = { message: 'update boom' };
        await loadBoard();

        const input = document.querySelector('.agentAnswerInput');
        input.value = 'answer text';
        document.querySelector('.agentAnswerSend').click();
        await flush();

        expect(triageCalls.length).toBe(0);
    });

    it('surfaces a non-blocking toast when the auto-fired sweep fails to dispatch', async () => {
        listLogic.addProject('Xi');
        mountDom('Xi');
        queueRows = [{ id: 'nw3', state: 'needs_words', context: { title: 'X' }, question: 'Q?', thread: [] }];
        triageResult = { ok: false, reason: 'Network error' };
        await loadBoard();

        const input = document.querySelector('.agentAnswerInput');
        input.value = 'answer text';
        document.querySelector('.agentAnswerSend').click();
        await flush();

        // Answer still saved; a toast invites a manual Run.
        expect(updateCalls.length).toBe(1);
        expect(triageCalls.length).toBe(1);
        const toast = document.getElementById('agentViewToast');
        expect(toast).toBeTruthy();
        expect(toast.textContent).toMatch(/triage/i);
    });
});

describe('AGENT view — status pill driven by the real triage-run state', () => {
    function pillState() {
        const pill = document.getElementById('agentStatusPill');
        if (!pill) return null;
        const label = pill.querySelector('.agentStatusLabel');
        return { working: pill.classList.contains('agentStatusPill--working'), label: label ? label.textContent : '' };
    }

    it('flips the pill to Working the instant Run is tapped (optimistic), not just from row states', async () => {
        listLogic.addProject('Pill1');
        mountDom('Pill1');
        // A queue with no in-flight ROW state — previously this left the pill IDLE
        // through the whole sweep. needs_words isn't dispatched/running.
        queueRows = [{ id: '1', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];
        await loadBoard();
        expect(pillState().label).toBe('Idle');

        document.querySelector('.agentRunBtn').click();
        await flush();

        // The sweep is tracked optimistically → Working, even with no dispatched/
        // running row and the probe reporting the run not yet registered.
        expect(pillState()).toEqual({ working: true, label: 'Working' });
    });

    it('scopes the active_runs probe to the triage workflow', async () => {
        listLogic.addProject('Pill2');
        mountDom('Pill2');
        queueRows = [{ id: '1', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];
        await loadBoard();

        document.querySelector('.agentRunBtn').click();
        await flush();

        expect(activeRunsCalls.length).toBeGreaterThan(0);
        expect(activeRunsCalls.every((c) => c.workflow === 'triage')).toBe(true);
    });

    it('clears the optimistic Working state when the Run dispatch fails', async () => {
        listLogic.addProject('Pill3');
        mountDom('Pill3');
        queueRows = [{ id: '1', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];
        triageResult = { ok: false, reason: 'Server error 500' };
        await loadBoard();

        document.querySelector('.agentRunBtn').click();
        await flush();

        // A failed dispatch must not leave the pill falsely showing Working.
        expect(pillState().label).toBe('Idle');
    });

    it('seeds the pill to Working on mount when a sweep is already running (cross-device)', async () => {
        listLogic.addProject('Pill4');
        mountDom('Pill4');
        queueRows = [{ id: '1', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];
        // The Worker reports a triage run already in flight before any tap here.
        activeRunsQueue = [{ ok: true, active: true }];
        await loadBoard();

        expect(pillState()).toEqual({ working: true, label: 'Working' });
    });

    it('still shows Working from an in-flight ship run (dispatched/running row), no sweep needed', async () => {
        listLogic.addProject('Pill5');
        mountDom('Pill5');
        queueRows = [{ id: '1', state: 'running', context: { title: 'X' } }];
        await loadBoard();

        // No triage sweep here — the pill reflects the running ship row.
        expect(pillState()).toEqual({ working: true, label: 'Working' });
    });
});
