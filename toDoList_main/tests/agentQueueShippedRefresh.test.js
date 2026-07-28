import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

// Regression coverage for the forced shipped-marker refresh the agent-queue
// store fires when a run merges on Actions. `derivePhase` only returns ACCEPT
// (the `⌁ REVIEW` badge) once the entry's marker reads as checked in the shipped-
// marker cache, which has a 60s TTL. A run that merges on Actions flips its
// queue row to `shipped` via a realtime push but never goes through the client
// ship path's forced refresh, so without forcing one on the transition the row
// repaints against a stale cache and keeps its pending glyph. The store must
// force a refresh — and ONLY on the transition edge, deduped per project.

// Minimal Supabase stub — the store and listLogic both import it, but these
// tests call refreshMarkersForShippedTransitions directly and never hit the
// network.
vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

import { listLogic } from '../src/listLogic.js';
import {
    refreshMarkersForShippedTransitions,
    setShippedMarkerRefresher,
} from '../src/agentQueueStore.js';

// The store calls its registered refresher (inject.js registers
// refreshShippedMarkersForProject in production); swap in a spy so we can assert
// exactly when — and for which project — a forced refresh fires.
const refreshSpy = vi.fn(() => Promise.resolve());

let alpha;
let beta;
beforeEach(() => {
    listLogic._reset();
    refreshSpy.mockClear();
    setShippedMarkerRefresher(refreshSpy);
    listLogic.addProject('Alpha');
    listLogic.addProject('Beta');
    alpha = listLogic.getProjectId('Alpha');
    beta = listLogic.getProjectId('Beta');
});
afterEach(() => {
    setShippedMarkerRefresher(null);
});

describe('refreshMarkersForShippedTransitions', () => {
    it('forces a refresh for a project whose row transitions into shipped', () => {
        refreshMarkersForShippedTransitions(
            [{ id: 'q1', project_id: alpha, state: 'running' }],
            [{ id: 'q1', project_id: alpha, state: 'shipped' }],
        );
        expect(refreshSpy).toHaveBeenCalledTimes(1);
        expect(refreshSpy).toHaveBeenCalledWith('Alpha', true);
    });

    it('does not refresh a row that was already shipped (no transition)', () => {
        refreshMarkersForShippedTransitions(
            [{ id: 'q1', project_id: alpha, state: 'shipped' }],
            [{ id: 'q1', project_id: alpha, state: 'shipped' }],
        );
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('does not refresh on a transition between two non-terminal states', () => {
        refreshMarkersForShippedTransitions(
            [{ id: 'q1', project_id: alpha, state: 'dispatched' }],
            [{ id: 'q1', project_id: alpha, state: 'running' }],
        );
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('dedups to one refresh per project when several of its rows ship together', () => {
        refreshMarkersForShippedTransitions(
            [
                { id: 'q1', project_id: alpha, state: 'running' },
                { id: 'q2', project_id: alpha, state: 'running' },
            ],
            [
                { id: 'q1', project_id: alpha, state: 'shipped' },
                { id: 'q2', project_id: alpha, state: 'shipped' },
            ],
        );
        expect(refreshSpy).toHaveBeenCalledTimes(1);
        expect(refreshSpy).toHaveBeenCalledWith('Alpha', true);
    });

    it('resolves the project from the row, refreshing one the user is not viewing', () => {
        // Beta's row ships while the user is elsewhere — the refresh must target
        // Beta, resolved from the row's own project_id, not the selected project.
        refreshMarkersForShippedTransitions(
            [{ id: 'q9', project_id: beta, state: 'running' }],
            [{ id: 'q9', project_id: beta, state: 'shipped' }],
        );
        expect(refreshSpy).toHaveBeenCalledTimes(1);
        expect(refreshSpy).toHaveBeenCalledWith('Beta', true);
    });

    it('fires once per project when two different projects ship in one push', () => {
        refreshMarkersForShippedTransitions(
            [
                { id: 'q1', project_id: alpha, state: 'running' },
                { id: 'q2', project_id: beta, state: 'running' },
            ],
            [
                { id: 'q1', project_id: alpha, state: 'shipped' },
                { id: 'q2', project_id: beta, state: 'shipped' },
            ],
        );
        expect(refreshSpy).toHaveBeenCalledTimes(2);
        const names = refreshSpy.mock.calls.map((c) => c[0]).sort();
        expect(names).toEqual(['Alpha', 'Beta']);
        refreshSpy.mock.calls.forEach((c) => expect(c[1]).toBe(true));
    });

    it('skips a shipped row whose project_id cannot be resolved, without throwing', () => {
        expect(() => refreshMarkersForShippedTransitions(
            [{ id: 'q1', project_id: 'unknown-pid', state: 'running' }],
            [{ id: 'q1', project_id: 'unknown-pid', state: 'shipped' }],
        )).not.toThrow();
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('treats a row that appears already shipped (no prior entry) as a transition', () => {
        refreshMarkersForShippedTransitions(
            [],
            [{ id: 'q1', project_id: alpha, state: 'shipped' }],
        );
        expect(refreshSpy).toHaveBeenCalledTimes(1);
        expect(refreshSpy).toHaveBeenCalledWith('Alpha', true);
    });

    it('is a no-op on non-array arguments', () => {
        expect(() => refreshMarkersForShippedTransitions(null, undefined)).not.toThrow();
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('is a safe no-op when no refresher is registered', () => {
        setShippedMarkerRefresher(null);
        expect(() => refreshMarkersForShippedTransitions(
            [{ id: 'q1', project_id: alpha, state: 'running' }],
            [{ id: 'q1', project_id: alpha, state: 'shipped' }],
        )).not.toThrow();
    });
});
