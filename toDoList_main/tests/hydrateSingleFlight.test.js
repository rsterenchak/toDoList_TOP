// Behavioural regression for the hydrateFromSupabase single-flight
// guard. After a magic-link sign-in lands in a new tab, the initial
// boot path and the SIGNED_IN auth state listener both invoke
// hydrateFromSupabase in the same tick. Without the guard, the two
// concurrent runs can race through the merge → dispatch sequence and
// wipe the sidebar mid-execution. The guard is a module-scoped flag
// flipped before the first await and released in a finally block, so a
// second *concurrent* call short-circuits but a later *sequential*
// call still runs.

import { vi } from 'vitest';

import { listLogic } from '../src/listLogic.js';
import { supabase } from '../src/supabaseClient.js';


describe('listLogic — hydrateFromSupabase single-flight guard (behaviour)', () => {
    let getSessionSpy;

    afterEach(() => {
        if (getSessionSpy) {
            getSessionSpy.mockRestore();
            getSessionSpy = null;
        }
    });

    it('a second concurrent call short-circuits before re-invoking supabase.auth.getSession', async () => {
        let resolveSession;
        const sessionPromise = new Promise(function(resolve) {
            resolveSession = resolve;
        });

        getSessionSpy = vi.spyOn(supabase.auth, 'getSession')
            .mockImplementation(function() { return sessionPromise; });

        const p1 = listLogic.hydrateFromSupabase();
        const p2 = listLogic.hydrateFromSupabase();

        // Release the first call's session fetch (null session — the
        // function exits at the !session check, but only after the
        // guard has already short-circuited the second call).
        resolveSession({ data: { session: null }, error: null });

        await Promise.all([p1, p2]);

        expect(getSessionSpy).toHaveBeenCalledTimes(1);
    });

    it('a subsequent non-overlapping call still runs after the first one finishes', async () => {
        getSessionSpy = vi.spyOn(supabase.auth, 'getSession')
            .mockResolvedValue({ data: { session: null }, error: null });

        await listLogic.hydrateFromSupabase();
        await listLogic.hydrateFromSupabase();

        // Two sequential calls → two getSession invocations. The flag
        // must be released between them or this fails.
        expect(getSessionSpy).toHaveBeenCalledTimes(2);
    });

    it('releases the flag even when the awaited fetch rejects', async () => {
        // First call rejects; afterEach restores the spy; a second call
        // through the original (stubbed) getSession must still run. If
        // the flag stayed true after a rejection, every subsequent
        // hydrate attempt in the user's session would short-circuit.
        let rejectSession;
        const rejectingPromise = new Promise(function(_resolve, reject) {
            rejectSession = reject;
        });
        getSessionSpy = vi.spyOn(supabase.auth, 'getSession')
            .mockImplementationOnce(function() { return rejectingPromise; })
            .mockResolvedValueOnce({ data: { session: null }, error: null });

        const p1 = listLogic.hydrateFromSupabase();
        rejectSession(new Error('network down'));
        await p1;

        await listLogic.hydrateFromSupabase();

        expect(getSessionSpy).toHaveBeenCalledTimes(2);
    });
});
