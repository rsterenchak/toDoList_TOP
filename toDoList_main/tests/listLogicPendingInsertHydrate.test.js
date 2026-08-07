// Behavioural regression for the "Run dispatched, but couldn't link this task
// to its entry" toast that fires when accepting a proposal races a re-hydrate.
//
// Bug symptom: accepting a proposal materializes a brand-new todo via
// addEntryTodo (pushed into allProjects optimistically, its INSERT fired
// fire-and-forget), then ships it and calls stampTodoEntryId to link the row
// to its entry id. If hydrateFromSupabase lands in that window — the
// visibilitychange re-hydrate or the 5-minute backstop — it rebuilds an
// already-synced project's items purely from the latest SELECT, which does not
// yet contain the unconfirmed INSERT. The fresh todo is silently dropped from
// local state and the stampTodoEntryId lookup fails even though the run
// dispatched fine.
//
// The fix tracks todo ids whose INSERT this session issued but that no SELECT
// has echoed back yet. Those rows are carried over into the merged tree rather
// than dropped. A row stops being pending the moment a hydrate observes it in
// the remote response, so the carry-over cannot resurrect a todo another device
// later deletes.

import { vi } from 'vitest';

import { listLogic } from '../src/listLogic.js';
import { supabase } from '../src/supabaseClient.js';

// Capture the realtime handlers that subscribeToRealtime wires onto the
// channels so a test can seed a project/todo with a known stable id
// (same approach as listLogicDeleteReconcile).
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

// Mock supabase.from so hydrates serve `remote.projects` / `remote.todos` from
// the .order() resolution and every .insert() row is captured. The remote rows
// are read through a mutable holder so a test can change what the server
// returns between two hydrates.
function mockBackend(remote) {
    const inserts = [];
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: { id: 'user-1' } } },
        error: null,
    });
    vi.spyOn(supabase, 'from').mockImplementation(function(table) {
        const builder = {
            select: function() { return builder; },
            eq: function() { return builder; },
            update: function() { return builder; },
            delete: function() { return builder; },
            order: function() {
                return Promise.resolve({
                    data: table === 'projects' ? remote.projects : remote.todos,
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

const REMOTE_PROJECT = {
    id: 'proj-1',
    name: 'Synced',
    color: null,
    target_id: null,
    position: 0,
    updated_at: '2026-08-01T00:00:00Z',
};


describe('listLogic — hydrate preserves a freshly created todo whose INSERT is still unconfirmed', () => {
    beforeEach(() => {
        listLogic._reset();
        vi.spyOn(console, 'warn').mockImplementation(function() {});
        vi.spyOn(console, 'log').mockImplementation(function() {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        listLogic._reset();
    });

    it('keeps the new todo (and its entry link) when a re-hydrate lands before the INSERT is echoed back', async () => {
        const handlers = wireRealtimeHandlers();
        handlers['public:projects']({
            eventType: 'INSERT',
            new: { id: 'proj-1', name: 'Synced', color: null, target_id: null },
        });

        // Server has the project but no todos yet.
        const remote = { projects: [REMOTE_PROJECT], todos: [] };
        mockBackend(remote);

        // Accepting a proposal materializes the todo optimistically.
        const todoId = listLogic.addEntryTodo('Synced', 'Fresh task', 'body', 'entry-1');
        expect(todoId).toBeTruthy();

        // The backstop re-hydrate lands before the INSERT surfaces in a SELECT.
        await listLogic.hydrateFromSupabase();

        const items = listLogic.listItems('Synced');
        const survivor = items.find(function(it) { return it.id === todoId; });
        expect(survivor).toBeTruthy();
        expect(survivor.tit).toBe('Fresh task');
        expect(survivor.desc).toBe('body');
        expect(survivor.entryId).toBe('entry-1');

        // …and the ship path can still link the row to its entry, so the
        // "couldn't link this task to its entry" toast never fires.
        expect(listLogic.stampTodoEntryId(todoId, 'entry-2')).toEqual({ ok: true });
    });

    it('stops carrying the todo once the server echoes it back, so a later remote deletion still lands', async () => {
        const handlers = wireRealtimeHandlers();
        handlers['public:projects']({
            eventType: 'INSERT',
            new: { id: 'proj-1', name: 'Synced', color: null, target_id: null },
        });

        const remote = { projects: [REMOTE_PROJECT], todos: [] };
        mockBackend(remote);

        const todoId = listLogic.addEntryTodo('Synced', 'Fresh task', 'body', 'entry-1');

        // First hydrate races the INSERT — the row is carried over.
        await listLogic.hydrateFromSupabase();
        expect(listLogic.listItems('Synced').some(function(it) { return it.id === todoId; })).toBe(true);

        // Second hydrate: the server now acknowledges the row.
        remote.todos = [{
            id: todoId, project_id: 'proj-1', title: 'Fresh task',
            description: 'body', due_date: null, priority: 1, position: 1,
            completed: false, recurrence: null, entry_id: 'entry-1',
        }];
        await listLogic.hydrateFromSupabase();
        const afterAck = listLogic.listItems('Synced').filter(function(it) { return it.id === todoId; });
        expect(afterAck.length).toBe(1);

        // Third hydrate: another device deleted the row. It is no longer
        // pending, so the carry-over must not resurrect it.
        remote.todos = [];
        await listLogic.hydrateFromSupabase();
        expect(listLogic.listItems('Synced').some(function(it) { return it.id === todoId; })).toBe(false);
    });

    it('does not carry over a todo the local session deleted before the hydrate', async () => {
        const handlers = wireRealtimeHandlers();
        handlers['public:projects']({
            eventType: 'INSERT',
            new: { id: 'proj-1', name: 'Synced', color: null, target_id: null },
        });

        const remote = { projects: [REMOTE_PROJECT], todos: [] };
        mockBackend(remote);

        const todoId = listLogic.addEntryTodo('Synced', 'Fresh task', 'body', 'entry-1');
        const items = listLogic.listItems('Synced');
        const idx = items.findIndex(function(it) { return it.id === todoId; });
        listLogic.removeToDo('Synced', idx);

        await listLogic.hydrateFromSupabase();

        expect(listLogic.listItems('Synced').some(function(it) { return it.id === todoId; })).toBe(false);
    });
});
