import { vi } from 'vitest';

// Regression coverage for the nav "● Agent" dot hanging on the previous
// project's state across a project switch. The persistent working watch
// (startAgentWorkingWatch) only recomputes body.agentWorking on its 15s interval
// or an agent_queue realtime push — never on a project switch. Because the signal
// is scoped to the selected project, switching from a project with an in-flight
// sweep to one without (or the reverse) left the dot showing the old project's
// state for up to WORKING_WATCH_POLL_MS. The fix routes the project-switch hook
// syncAgentAvailabilityForProject() through pollAgentWorkingWatch() so the dot
// recomputes for the newly selected project the instant the switch happens. These
// tests drive the watch with a fake Supabase + inject.js (no network) and a routed
// target so the sweep probe actually runs.

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
let activeRuns = { ok: true, active: true };
let injectConfigured = true;

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
    isInjectConfigured: () => injectConfigured,
    showInjectToast: () => {},
}));

// agentView imports openChatWithSeed from claudeSheet.js; stub it so the real
// chat surface isn't pulled into jsdom.
vi.mock('../src/claudeSheet.js', () => ({
    openChatWithSeed: () => {},
}));

import { listLogic } from '../src/listLogic.js';
import {
    startAgentWorkingWatch,
    syncAgentAvailabilityForProject,
} from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) {
    for (let i = 0; i < n; i++) await tick();
}

// A project with a routed inject target, mounted as the selected project so
// resolveDispatchTarget returns non-null and pollAgentWorkingWatch's sweep probe
// is exercised for it.
function selectRoutedProject(projectName) {
    if (!listLogic.getProjectId(projectName)) {
        listLogic.addProject(projectName);
        listLogic.setProjectTargetId(projectName, 'tgt-1');
    }
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>';
}

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    activeRuns = { ok: true, active: true };
    injectConfigured = true;
    document.body.className = '';
    document.body.innerHTML = '';
});

describe('nav agent-working dot — recomputes immediately on project switch', () => {
    it('goes dark the instant syncAgentAvailabilityForProject switches to a quiet project', async () => {
        // Start with Alpha lit: it owns an in-flight triaging row while the repo
        // triage run is active, so the dot lights.
        selectRoutedProject('Alpha');
        queueRows = [{ id: '1', state: 'triaging', project_id: listLogic.getProjectId('Alpha') }];
        startAgentWorkingWatch();
        await flush();
        expect(document.body.classList.contains('agentWorking')).toBe(true);

        // Switch to Bravo, which owns no in-flight rows. Drive ONLY the project-
        // switch hook — no interval tick, no realtime push. Before the fix the dot
        // would hang lit (Alpha's state) until the next 15s tick.
        selectRoutedProject('Bravo');
        queueRows = [{ id: '2', state: 'shipped', project_id: listLogic.getProjectId('Bravo') }];
        syncAgentAvailabilityForProject('Bravo');
        await flush();
        expect(document.body.classList.contains('agentWorking')).toBe(false);
    });

    it('lights the instant syncAgentAvailabilityForProject switches to a busy project', async () => {
        // Charlie is quiet; the dot starts dark.
        selectRoutedProject('Charlie');
        queueRows = [{ id: '3', state: 'shipped', project_id: listLogic.getProjectId('Charlie') }];
        startAgentWorkingWatch();
        await flush();
        expect(document.body.classList.contains('agentWorking')).toBe(false);

        // Switch to Delta, which owns a dispatched ship run. The switch hook alone
        // must recompute and light the dot without waiting on the interval.
        selectRoutedProject('Delta');
        queueRows = [{ id: '4', state: 'dispatched', project_id: listLogic.getProjectId('Delta') }];
        syncAgentAvailabilityForProject('Delta');
        await flush();
        expect(document.body.classList.contains('agentWorking')).toBe(true);
    });
});
