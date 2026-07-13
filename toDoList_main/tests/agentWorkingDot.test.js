import { vi } from 'vitest';

// The persistent agent-working watch (startAgentWorkingWatch) drives the nav
// "● Agent" dot by toggling a body.agentWorking class. Unlike the board
// subscription, it is mount-independent — started once at app init and never
// torn down — so the dot stays lit after the user leaves the Agent tab while a
// run is in flight. These tests drive it with a controllable fake Supabase
// client (no network) and assert the class tracks whether any dispatched/running
// row exists for the selected project. The triage active-runs probe is a no-op
// here because the mounted project carries no routed inject target (so
// resolveDispatchTarget returns null and the sweep probe is skipped).

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
        }),
        channel: () => ({
            on(event, filter, cb) { realtimeCb = cb; return this; },
            subscribe() { return this; },
        }),
        removeChannel: () => {},
    },
}));

// agentView imports openChatWithSeed from claudeSheet.js; stub it so the real
// chat surface isn't pulled into jsdom.
vi.mock('../src/claudeSheet.js', () => ({
    openChatWithSeed: () => {},
}));

import { listLogic } from '../src/listLogic.js';
import { startAgentWorkingWatch } from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) {
    for (let i = 0; i < n; i++) await tick();
}

function mountProject(projectName) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>';
}

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    // NOTE: realtimeCb is intentionally NOT reset here — the watch opens its
    // channel exactly once (double-init guard), so the callback is captured on
    // the first start and must survive across tests in this file.
    document.body.className = '';
    document.body.innerHTML = '';
});

describe('startAgentWorkingWatch', () => {
    it('sets body.agentWorking when a dispatched/running row exists for the project', async () => {
        listLogic.addProject('Alpha');
        mountProject('Alpha');
        queueRows = [{ id: 'r1', state: 'running', project_id: listLogic.getProjectId('Alpha') }];

        startAgentWorkingWatch();
        await flush();

        expect(document.body.classList.contains('agentWorking')).toBe(true);
    });

    it('clears body.agentWorking on a realtime push once no in-flight row remains', async () => {
        // The watch is idempotent (module-level guard), so it was started in the
        // previous test; the captured realtime callback re-evaluates on demand.
        expect(typeof realtimeCb).toBe('function');

        listLogic.addProject('Alpha');
        mountProject('Alpha');
        // No dispatched/running rows now — only a shipped (terminal) row.
        queueRows = [{ id: 'r1', state: 'shipped', project_id: listLogic.getProjectId('Alpha') }];

        realtimeCb();
        await flush();

        expect(document.body.classList.contains('agentWorking')).toBe(false);
    });

    it('re-lights body.agentWorking when a row goes back in-flight', async () => {
        listLogic.addProject('Alpha');
        mountProject('Alpha');
        queueRows = [{ id: 'r2', state: 'dispatched', project_id: listLogic.getProjectId('Alpha') }];

        realtimeCb();
        await flush();

        expect(document.body.classList.contains('agentWorking')).toBe(true);
    });
});
