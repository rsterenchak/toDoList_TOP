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
    readTodoMdFromWorker: () => Promise.resolve({ ok: false, reason: 'No target' }),
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
    triageResult = { ok: true, dispatched: true };
    triageCalls = [];
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
