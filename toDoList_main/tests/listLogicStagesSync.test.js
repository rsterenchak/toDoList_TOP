// Behavioural coverage for syncing per-project Conceive stages to Supabase.
//
// Stages and lifecycle live on the existing `projects` row (a `stages`
// jsonb column + a `lifecycle` text column), so they ride the project's
// existing reconciliation — there is no new table and no separate sync
// path. These tests exercise the three seams the sync threads through:
//
//   1. Write — editing a stage mirrors to the project's Supabase row via
//      toProjectRowPayload (whole-row UPDATE), the same way color does.
//   2. Read  — hydrate maps a server row's stages/lifecycle back into the
//      local cache, and backfills the default shape (Iterative) when the
//      server row predates the column and returns null.
//   3. Realtime — a stage edit from another device arrives as a project
//      UPDATE and applies live (with the same null→Iterative backfill).

import { vi } from 'vitest';

import { listLogic } from '../src/listLogic.js';
import { supabase } from '../src/supabaseClient.js';

const SDLC = ['Why', 'Concept', 'Requirements', 'Design', 'Build plan'];
// The default shape new/legacy projects seed when no stages are stored.
const ITERATIVE = ['Why', 'Concept', 'Next up', 'Iterations'];

// Stub a signed-in Supabase session plus a from() builder that serves the
// given remote rows from .order() and captures every write so a test can
// assert what was mirrored. update() is the projects stage-mirror path;
// insert() is the local-only push / replaceAllProjects fan-out.
function mockBackend(remoteProjects, remoteTodos) {
    const writes = { insert: [], update: [] };
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: { id: 'user-1' } } },
        error: null,
    });
    vi.spyOn(supabase, 'from').mockImplementation(function(table) {
        const builder = {
            select: function() { return builder; },
            eq: function() { return builder; },
            order: function() {
                return Promise.resolve({
                    data: table === 'projects' ? remoteProjects : remoteTodos,
                    error: null,
                });
            },
            insert: function(row) {
                writes.insert.push({ table: table, row: row });
                return Promise.resolve({ data: [row], error: null });
            },
            update: function(row) {
                return {
                    eq: function() {
                        writes.update.push({ table: table, row: row });
                        return Promise.resolve({ data: [row], error: null });
                    },
                };
            },
            delete: function() {
                return { eq: function() { return Promise.resolve({ data: [], error: null }); } };
            },
        };
        return builder;
    });
    return writes;
}

// persistMutation is async fire-and-forget — let its getSession await and
// the subsequent network call drain before asserting on captured writes.
function flush() {
    return new Promise(function(resolve) { setTimeout(resolve, 0); });
}

// Capture the realtime handlers subscribeToRealtime wires onto the
// channels so a test can drive an incoming project UPDATE.
function wireRealtimeHandlers() {
    const handlers = {};
    vi.spyOn(supabase, 'removeChannel').mockImplementation(function() {});
    vi.spyOn(supabase, 'channel').mockImplementation(function(name) {
        const chan = {
            on: function(_evt, _filter, cb) { handlers[name] = cb; return chan; },
            subscribe: function() { return chan; },
        };
        return chan;
    });
    listLogic.handleSignOut();
    listLogic.subscribeToRealtime();
    return handlers;
}


describe('listLogic — per-project stages sync to Supabase', () => {
    beforeEach(() => {
        listLogic._reset();
        vi.spyOn(console, 'warn').mockImplementation(function() {});
        vi.spyOn(console, 'log').mockImplementation(function() {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        listLogic._reset();
    });

    it('mirrors a stage edit to the project Supabase row, carrying the stages through toProjectRowPayload', async () => {
        const writes = mockBackend([], []);
        listLogic.addProject('Launch');
        const stageId = listLogic.getProjectStages('Launch')[1].id; // Concept

        listLogic.setProjectStageBody('Launch', stageId, 'mirror me');
        await flush();

        const stageUpdate = writes.update
            .filter(function(w) { return w.table === 'projects'; })
            .find(function(w) {
                return Array.isArray(w.row.stages)
                    && w.row.stages.some(function(s) {
                        return s.id === stageId && s.body === 'mirror me';
                    });
            });
        expect(stageUpdate, 'a projects UPDATE should carry the edited stage body').toBeTruthy();
        expect(stageUpdate.row.lifecycle).toBe('iterative');
    });

    it('maps a server row\'s stored stages and lifecycle back into allProjects on hydrate', async () => {
        const serverStages = SDLC.map(function(label, i) {
            return { id: 'st-' + i, label: label, body: i === 0 ? 'why body' : '' };
        });
        mockBackend(
            [{
                id: 'p1', name: 'Synced', color: null, target_id: null, position: 0,
                stages: serverStages, lifecycle: 'SDLC',
                updated_at: '2026-06-20T00:00:00Z',
            }],
            []
        );

        await listLogic.hydrateFromSupabase();

        const stages = listLogic.getProjectStages('Synced');
        expect(stages.map(function(s) { return s.label; })).toEqual(SDLC);
        expect(stages[0].body).toBe('why body');
        expect(listLogic.getProjectLifecycle('Synced')).toBe('SDLC');
    });

    it('backfills the Iterative default when a server row predates the column (null stages)', async () => {
        mockBackend(
            [{
                id: 'p2', name: 'Legacy', color: null, target_id: null, position: 0,
                stages: null, lifecycle: null,
                updated_at: '2026-06-20T00:00:00Z',
            }],
            []
        );

        await listLogic.hydrateFromSupabase();

        expect(listLogic.getProjectStages('Legacy').map(function(s) { return s.label; }))
            .toEqual(ITERATIVE);
        expect(listLogic.getProjectLifecycle('Legacy')).toBe('iterative');
    });

    it('applies a stage edit arriving live as a project UPDATE from another device', () => {
        const handlers = wireRealtimeHandlers();
        const projHandler = handlers['public:projects'];

        const remoteStages = SDLC.map(function(label, i) {
            return { id: 'rt-' + i, label: label, body: i === 2 ? 'remote req' : '' };
        });
        projHandler({
            eventType: 'INSERT',
            new: {
                id: 'p3', name: 'Live', color: null, target_id: null,
                stages: remoteStages, lifecycle: 'SDLC',
            },
        });

        const stages = listLogic.getProjectStages('Live');
        expect(stages.map(function(s) { return s.label; })).toEqual(SDLC);
        expect(stages[2].body).toBe('remote req');
        expect(listLogic.getProjectLifecycle('Live')).toBe('SDLC');
    });

    it('backfills the Iterative default on a realtime project row that omits stages', () => {
        const handlers = wireRealtimeHandlers();
        const projHandler = handlers['public:projects'];

        projHandler({
            eventType: 'INSERT',
            new: { id: 'p4', name: 'BareLive', color: null, target_id: null },
        });

        expect(listLogic.getProjectStages('BareLive').map(function(s) { return s.label; }))
            .toEqual(ITERATIVE);
        expect(listLogic.getProjectLifecycle('BareLive')).toBe('iterative');
    });
});
