import { vi } from 'vitest';

// Regression coverage for the nav "● Agent" dot lighting up for a project with
// no triage sweep of its own in flight. The persistent working watch
// (startAgentWorkingWatch) computes the sweep half of body.agentWorking from a
// probe that was previously the repo-wide triage active-runs check — so any
// project sharing the target repo (or the null default target) read the same
// repo-wide flag and lit the dot even when nothing was running for the project
// on screen. The fix scopes the sweep half to the selected project the same way
// the ship half is scoped: the repo-wide probe is now gated on the project
// owning an in-flight 'triaging' agent_queue row. These tests drive the watch
// with a fake Supabase + inject.js (no network) and a routed target so the sweep
// probe actually runs (unlike the seed tests, whose null target skips it).

// ── Supabase stub ────────────────────────────────────────────────────
let queueRows = [];
// Captured realtime callback so a test can simulate an agent_queue push and
// re-run the watch's evaluation on demand rather than waiting on the interval.
let realtimeCb = null;

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
            on(event, filter, cb) { realtimeCb = cb; return this; },
            subscribe() { return this; },
        }),
        removeChannel: () => {},
    },
}));

// ── inject.js stub ───────────────────────────────────────────────────
// findTargetById returns a truthy target so resolveDispatchTarget resolves
// non-null and the sweep probe actually runs; fetchActiveRuns is scriptable to
// report whether the repo-wide triage run is in flight.
let activeRuns = { ok: true, active: true };

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'corr',
    embedEntryMarker: (t, id) => String(t) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: () => Promise.resolve({ ok: true, id: 'e' }),
    dispatchRun: () => Promise.resolve({ ok: true }),
    dispatchTriage: () => Promise.resolve({ ok: true }),
    pollRunStatus: () => Promise.resolve({ ok: true, found: false }),
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    fetchActiveRuns: () => Promise.resolve(activeRuns),
    readTodoMdFromWorker: () => Promise.resolve({ ok: false, reason: 'No target' }),
    findTargetById: (id) => (id ? { id: id, repo: 'owner/repo' } : null),
    showInjectToast: () => {},
}));

// agentView imports openChatWithSeed from claudeSheet.js; stub it so the real
// chat surface isn't pulled into jsdom.
vi.mock('../src/claudeSheet.js', () => ({
    openChatWithSeed: () => {},
}));

import { listLogic } from '../src/listLogic.js';
import { startAgentWorkingWatch } from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) {
    for (let i = 0; i < n; i++) await tick();
}

function mountProject(projectName) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>';
}

// A project with a routed inject target, so resolveDispatchTarget returns
// non-null and pollAgentWorkingWatch's sweep probe is exercised.
function routedProject(projectName) {
    listLogic.addProject(projectName);
    listLogic.setProjectTargetId(projectName, 'tgt-1');
    mountProject(projectName);
}

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    activeRuns = { ok: true, active: true };
    // NOTE: realtimeCb is intentionally NOT reset — the watch opens its channel
    // exactly once (double-init guard), so the callback is captured on the first
    // start and must survive across tests in this file.
    document.body.className = '';
    document.body.innerHTML = '';
});

describe('nav agent-working dot — sweep half scoped to the selected project', () => {
    it('stays dark when the repo has a triage run in flight but the selected project owns no triaging row', async () => {
        routedProject('Delta');
        // The repo-wide sweep is active, but Delta's own rows are all terminal —
        // the run belongs to some OTHER project sharing this target. Before the
        // fix the repo-wide probe alone lit the dot here.
        queueRows = [{ id: '1', state: 'shipped', project_id: listLogic.getProjectId('Delta') }];

        startAgentWorkingWatch();
        await flush();

        expect(document.body.classList.contains('agentWorking')).toBe(false);
    });

    it('lights when the selected project owns a triaging row while the repo triage run is in flight', async () => {
        // The watch is idempotent (module-level guard), so it was started in the
        // previous test; the captured realtime callback re-evaluates on demand.
        expect(typeof realtimeCb).toBe('function');

        routedProject('Echo');
        queueRows = [{ id: '2', state: 'triaging', project_id: listLogic.getProjectId('Echo') }];

        realtimeCb();
        await flush();

        expect(document.body.classList.contains('agentWorking')).toBe(true);
    });

    it('stays dark when the project owns a triaging row but the repo has no triage run in flight', async () => {
        routedProject('Foxtrot');
        // A flagged-but-not-swept task leaves a 'triaging' row; with no repo-wide
        // run in flight the gate holds the dot dark rather than lighting on the
        // mere presence of a queued task.
        activeRuns = { ok: true, active: false };
        queueRows = [{ id: '3', state: 'triaging', project_id: listLogic.getProjectId('Foxtrot') }];

        realtimeCb();
        await flush();

        expect(document.body.classList.contains('agentWorking')).toBe(false);
    });
});
