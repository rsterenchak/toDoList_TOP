// Behavioural regression for wake-recovery realtime re-subscription
// (regression for #resubscribe-to-realtime-on-wake).
//
// When the PWA is backgrounded (mobile suspend, laptop sleep) the realtime
// websocket can die and the channels are left stale with no recovery, so
// the app stops receiving live cross-device updates. resubscribeToRealtime
// tears the dead channels down and re-opens them via subscribeToRealtime so
// live push resumes on wake. The invariants pinned here:
//
//   * the prior channels are removed and fresh ones opened (the re-open
//     relies on _realtimeChannels being reset before subscribeToRealtime's
//     length-guard, or the re-open silently no-ops);
//   * the re-opened channels carry live handlers that apply incoming events;
//   * it is a no-op when signed out (no channels without a session);
//   * the self-echo id set SURVIVES the resubscribe — an id recorded before
//     the resubscribe still suppresses its own echoed event afterwards
//     (resubscribe must NOT clear _selfEchoIds, unlike sign-out).

import { vi } from 'vitest';

import { listLogic } from '../src/listLogic.js';
import { supabase } from '../src/supabaseClient.js';


// Mirror the wireRealtimeHandlers mock pattern from
// listLogicRenameReconcile.test.js, but additionally track every
// channel() name opened and every removeChannel() call so the teardown +
// re-open can be asserted directly.
function wireRealtime() {
    const state = { handlers: {}, channelNames: [], removed: [], channels: [] };
    vi.spyOn(supabase, 'removeChannel').mockImplementation(function(ch) {
        state.removed.push(ch);
    });
    vi.spyOn(supabase, 'channel').mockImplementation(function(name) {
        state.channelNames.push(name);
        const chan = {
            __name: name,
            on: function(_evt, _filter, cb) { state.handlers[name] = cb; return chan; },
            subscribe: function() { return chan; },
        };
        state.channels.push(chan);
        return chan;
    });
    return state;
}


describe('listLogic — resubscribeToRealtime (wake recovery)', () => {
    beforeEach(() => {
        listLogic._reset();
        vi.spyOn(console, 'warn').mockImplementation(function() {});
        vi.spyOn(console, 'log').mockImplementation(function() {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        listLogic._reset();
    });

    it('tears down the prior channels and re-opens fresh ones on wake', () => {
        const state = wireRealtime();
        // handleSignOut clears the subscribeToRealtime length-guard so the
        // initial subscribe (below) actually opens channels.
        listLogic.handleSignOut();
        listLogic.subscribeToRealtime();

        // Exactly two channels opened at boot (this test's spy only sees
        // its own channel() calls).
        expect(state.channelNames).toEqual(['public:projects', 'public:todos']);
        const firstChannels = state.channels.slice();
        const removedBefore = state.removed.length;

        listLogic.resubscribeToRealtime();

        // The two boot channels were removed...
        const newRemovals = state.removed.slice(removedBefore);
        expect(newRemovals).toEqual(firstChannels);
        // ...and two fresh channels were opened (4 channel() calls total).
        expect(state.channelNames).toEqual([
            'public:projects', 'public:todos',
            'public:projects', 'public:todos',
        ]);
        expect(state.channels.length).toBe(4);
    });

    it('the re-opened channels carry live handlers that apply incoming events', () => {
        const state = wireRealtime();
        listLogic.handleSignOut();
        listLogic.subscribeToRealtime();
        listLogic.resubscribeToRealtime();

        const projHandler = state.handlers['public:projects'];
        expect(typeof projHandler).toBe('function');

        // Drive an INSERT through the post-resubscribe handler — proves the
        // re-opened channel is wired to a live reconciler.
        projHandler({
            eventType: 'INSERT',
            new: { id: 'p-live-1', name: 'Resubscribed Project', color: null, target_id: null },
        });
        expect(listLogic.listProjectsArray()).toContain('Resubscribed Project');
    });

    it('is a no-op when signed out — never opens channels without a session', () => {
        const state = wireRealtime();
        // No subscribe has happened, so realtime is not "wanted".
        listLogic.handleSignOut();
        const before = state.channelNames.length;

        listLogic.resubscribeToRealtime();

        expect(state.channelNames.length).toBe(before);
        expect(state.channels.length).toBe(0);
    });

    it('preserves the self-echo id set across a resubscribe (an id recorded before still suppresses its echo)', async () => {
        const state = wireRealtime();
        // Stub a signed-in session and a no-op insert so persistMutation
        // runs to completion and records the written id in _selfEchoIds.
        vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
            data: { session: { user: { id: 'user-1' } } },
        });
        vi.spyOn(supabase, 'from').mockReturnValue({
            insert: function() { return { error: null }; },
        });

        listLogic.handleSignOut();
        listLogic.subscribeToRealtime();

        // Record a self-echo id by issuing a local write through the same
        // funnel the app uses — this adds 'p-echo' to _selfEchoIds.
        await listLogic.persistMutation({
            op: 'insert',
            table: 'projects',
            payload: { id: 'p-echo', name: 'EchoProj' },
        });

        // Wake: re-open the channels. This must NOT clear _selfEchoIds.
        listLogic.resubscribeToRealtime();

        // The server now echoes our own write back through the fresh
        // channel. Because the id survived the resubscribe, the handler
        // swallows it instead of re-applying it as a foreign project.
        const projHandler = state.handlers['public:projects'];
        expect(typeof projHandler).toBe('function');
        projHandler({
            eventType: 'INSERT',
            new: { id: 'p-echo', name: 'EchoProj', color: null, target_id: null },
        });

        expect(listLogic.listProjectsArray()).not.toContain('EchoProj');
    });
});
