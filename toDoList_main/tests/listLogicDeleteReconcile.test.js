// Behavioural regression for cross-device project deletion resurrection
// (regression for #fix-hydrate-reinsert-deleted-projects).
//
// Bug symptom: a project deleted on Device A is resurrected on Device B
// after B's next hydrate — and worse, B re-INSERTs it back to Supabase,
// undoing the deletion across all devices. Root cause is the local-only
// push branch in hydrateFromSupabase: a local entry whose id is absent
// from the server response was treated identically to a project created
// while offline — kept in the merged tree and pushed via an insert.
//
// The fix snapshots the set of server-acknowledged project ids at the end
// of every successful hydrate (todoapp_lastSeenServerProjectIds). On the
// next hydrate's local-only loop, an id that WAS in the snapshot but is
// now absent from the remote response is a server-side deletion → dropped
// locally (cascade-dropping its todos) and never re-INSERTed. An id NOT in
// the snapshot is a genuinely offline-created project → pushed as before.

import { vi } from 'vitest';

import { listLogic } from '../src/listLogic.js';
import { supabase } from '../src/supabaseClient.js';

const SNAPSHOT_KEY = 'todoapp_lastSeenServerProjectIds';

// Capture the realtime handlers that subscribeToRealtime wires onto the
// channels so a test can seed Device B's local cache with a known stable
// id via an INSERT event (same approach as listLogicRenameReconcile).
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

// Mock supabase.from for a hydrate: serve the given remote rows from the
// .order() resolution and capture every .insert() row so the test can
// assert which (if any) projects were pushed back.
function mockHydrateBackend(remoteProjects, remoteTodos) {
    const inserts = [];
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
                inserts.push({ table: table, row: row });
                return Promise.resolve({ data: [row], error: null });
            },
        };
        return builder;
    });
    return inserts;
}


describe('listLogic — cross-device project deletion reconciliation (regression for #fix-hydrate-reinsert-deleted-projects)', () => {
    beforeEach(() => {
        listLogic._reset();
        vi.spyOn(console, 'warn').mockImplementation(function() {});
        vi.spyOn(console, 'log').mockImplementation(function() {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        listLogic._reset();
    });

    it('drops a locally-cached project the server deleted, does not re-INSERT it, and refreshes the snapshot', async () => {
        const handlers = wireRealtimeHandlers();
        const projHandler = handlers['public:projects'];
        const todoHandler = handlers['public:todos'];

        // Seed Device B's local cache: a project "Gone" (id proj-X) that
        // carries a committed todo, plus a survivor "Keep" (id proj-keep).
        projHandler({
            eventType: 'INSERT',
            new: { id: 'proj-X', name: 'Gone', color: null, target_id: null },
        });
        todoHandler({
            eventType: 'INSERT',
            new: {
                id: 'todo-X', project_id: 'proj-X', title: 'Doomed task',
                description: '', due_date: null, priority: 1, position: 1,
                completed: false, recurrence: null,
            },
        });
        projHandler({
            eventType: 'INSERT',
            new: { id: 'proj-keep', name: 'Keep', color: null, target_id: null },
        });
        expect(listLogic.listProjectsArray().sort()).toEqual(['Gone', 'Keep']);

        // Both ids were acknowledged by the server on the previous hydrate.
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(['proj-X', 'proj-keep']));

        // Server state now: "Gone" was deleted on Device A; only "Keep"
        // comes back.
        const remoteProjects = [
            { id: 'proj-keep', name: 'Keep', color: null, target_id: null, position: 0, updated_at: '2026-06-08T00:00:00Z' },
        ];
        const inserts = mockHydrateBackend(remoteProjects, []);

        await listLogic.hydrateFromSupabase();

        // (a) The deleted project is gone from the local tree (and its
        // todos cascade-dropped with it).
        expect(listLogic.listProjectsArray()).toEqual(['Keep']);
        expect(listLogic.listItems('Gone')).toBeUndefined();

        // (b) No insert fired for the deleted project — it must not be
        // resurrected back to Supabase.
        const reinserted = inserts.some(function(c) {
            return c.table === 'projects' && c.row && c.row.id === 'proj-X';
        });
        expect(reinserted).toBe(false);

        // (c) The snapshot now matches the server set this hydrate saw.
        expect(JSON.parse(localStorage.getItem(SNAPSHOT_KEY))).toEqual(['proj-keep']);
    });

    it('still pushes a genuinely offline-created project (id absent from the snapshot)', async () => {
        const handlers = wireRealtimeHandlers();
        const projHandler = handlers['public:projects'];

        // Local-only project created while offline; its id was never
        // acknowledged by the server (empty/absent snapshot).
        projHandler({
            eventType: 'INSERT',
            new: { id: 'proj-new', name: 'Offline', color: null, target_id: null },
        });
        // No snapshot entry for proj-new (localStorage cleared by _reset).

        const inserts = mockHydrateBackend([], []);

        await listLogic.hydrateFromSupabase();

        // The offline-created project survives and is pushed to Supabase.
        expect(listLogic.listProjectsArray()).toEqual(['Offline']);
        const pushed = inserts.some(function(c) {
            return c.table === 'projects' && c.row && c.row.id === 'proj-new';
        });
        expect(pushed).toBe(true);

        // The snapshot reflects the (empty) server set, not the local-only id.
        expect(JSON.parse(localStorage.getItem(SNAPSHOT_KEY))).toEqual([]);
    });
});
