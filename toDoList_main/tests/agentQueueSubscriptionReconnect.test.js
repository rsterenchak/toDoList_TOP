import { vi } from 'vitest';

// Regression: the `public:agent_queue` realtime channel replays nothing when it
// reconnects, so every push that landed while the socket was down is lost — a task
// row the triage sweep flipped to `drafted` in that gap stays painted Generating…
// until the user refreshes or switches projects and back.
//
// startAgentQueueSubscription now watches the subscribe status: a
// CHANNEL_ERROR / TIMED_OUT / CLOSED marks the channel dropped, and the next
// SUBSCRIBED runs the same reload-and-notify a push would have, so the reconnect
// catches up. The FIRST SUBSCRIBED must stay silent — the caller's own initial load
// already covers it.

// ── supabase stub ────────────────────────────────────────────────────
// `channel()` hands back a recorder so the test can drive the status callback
// exactly as the realtime client would; `select().eq('project_id', id)` serves the
// project's rows so a catch-up reload is observable in the cache.
let rowsByProjectId = {};
let statusCb = null;

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
        channel: () => ({
            on() { return this; },
            subscribe(cb) { statusCb = cb; return this; },
        }),
        removeChannel: () => {},
    },
}));

import { listLogic } from '../src/listLogic.js';
import {
    startAgentQueueSubscription,
    stopAgentQueueSubscription,
    loadQueueRows,
    setQueueRows,
    getQueueRows,
    onQueueChange,
} from '../src/agentQueueStore.js';

function setSelected(name) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>';
}
// Let the two chained reloads (selected-project + all-projects) settle.
async function flush(n = 6) {
    for (let i = 0; i < n; i++) await Promise.resolve();
}
function states() {
    return getQueueRows().map((r) => r.state);
}

let repaints;
let unsubscribe;
beforeEach(() => {
    listLogic._reset();
    rowsByProjectId = {};
    statusCb = null;
    setQueueRows([], null);
    stopAgentQueueSubscription();
    repaints = vi.fn();
    unsubscribe = onQueueChange(repaints);
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribe();
    stopAgentQueueSubscription();
});

describe('agent_queue subscription — reconnect catches up on missed pushes', () => {
    it('reloads and notifies on a re-SUBSCRIBED after the socket dropped', async () => {
        listLogic.addProject('Alpha');
        const pid = listLogic.getProjectId('Alpha');
        rowsByProjectId[pid] = [{ id: 'row-1', state: 'triaging' }];
        setSelected('Alpha');
        await loadQueueRows('Alpha');

        startAgentQueueSubscription();
        expect(typeof statusCb).toBe('function');

        // First subscribe: the initial load already painted this, so stay quiet.
        statusCb('SUBSCRIBED');
        await flush();
        expect(repaints).not.toHaveBeenCalled();

        // Socket dies; the sweep finishes and writes `drafted` while it is down.
        statusCb('CHANNEL_ERROR');
        rowsByProjectId[pid] = [{ id: 'row-1', state: 'drafted' }];
        await flush();
        expect(states()).toEqual(['triaging']);

        // Reconnect — no replay from the server, so the catch-up has to do it.
        statusCb('SUBSCRIBED');
        await flush();

        expect(states()).toEqual(['drafted']);
        expect(repaints).toHaveBeenCalledTimes(1);
    });

    it('treats TIMED_OUT and CLOSED as drops too, and catches up only once each', async () => {
        listLogic.addProject('Bravo');
        rowsByProjectId[listLogic.getProjectId('Bravo')] = [{ id: 'row-2', state: 'proposed' }];
        setSelected('Bravo');
        await loadQueueRows('Bravo');

        startAgentQueueSubscription();
        statusCb('SUBSCRIBED');
        await flush();

        statusCb('TIMED_OUT');
        statusCb('SUBSCRIBED');
        await flush();
        expect(repaints).toHaveBeenCalledTimes(1);

        // A SUBSCRIBED with no drop in between must not reload again.
        statusCb('SUBSCRIBED');
        await flush();
        expect(repaints).toHaveBeenCalledTimes(1);

        statusCb('CLOSED');
        statusCb('SUBSCRIBED');
        await flush();
        expect(repaints).toHaveBeenCalledTimes(2);
    });
});
