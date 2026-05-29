// Behavioural regression for project-rename duplication across devices
// (regression for #fix-project-rename-duplicate-cross-device).
//
// Bug symptom: renaming a project on Device A leaves a duplicate on
// Device B (the old name AND the new name, both sharing one stable id)
// after B syncs. The rename push itself is correct — editProject issues
// an UPDATE keyed by id, preserving the project's stable id. The
// duplication is born on the receiving side because both reconcilers in
// listLogic.js keyed projects by NAME instead of id:
//
//   * hydrateFromSupabase adopted the remote (new name) fresh while the
//     local entry (old name, same id) was treated as local-only — kept
//     AND re-INSERTed, which collided on the id primary key (silent 409).
//   * handleProjectsRealtime looked up an incoming UPDATE by name, missed
//     the renamed row, and created a second entry — orphaning the old one.
//
// The fix reconciles by stable id in both paths (mirroring the DELETE
// branches, which already matched by id).

import { vi } from 'vitest';

import { listLogic } from '../src/listLogic.js';
import { supabase } from '../src/supabaseClient.js';


// Capture the realtime handlers that subscribeToRealtime wires onto the
// channels, so the tests can drive INSERT/UPDATE events directly without
// reaching into the module's private scope. handleProjectsRealtime and
// handleTodosRealtime are not exported, but they ARE the callbacks the
// subscription registers — grabbing them off the mock is the cleanest way
// to exercise the realtime reconciliation behaviourally.
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
    // handleSignOut clears the module-scoped _realtimeChannels array so
    // the subscribeToRealtime length-guard doesn't short-circuit when an
    // earlier test already subscribed.
    listLogic.handleSignOut();
    listLogic.subscribeToRealtime();
    return handlers;
}


describe('listLogic — project rename reconciliation by stable id (regression for #fix-project-rename-duplicate-cross-device)', () => {
    let warnSpy;

    beforeEach(() => {
        listLogic._reset();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(function() {});
        vi.spyOn(console, 'log').mockImplementation(function() {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        listLogic._reset();
    });

    it('a realtime UPDATE that only changes name renames the existing entry in place (no second entry)', () => {
        const handlers = wireRealtimeHandlers();
        const projHandler = handlers['public:projects'];
        const todoHandler = handlers['public:todos'];
        expect(typeof projHandler).toBe('function');
        expect(typeof todoHandler).toBe('function');

        // Seed Device B's local cache: a project "OldName" with a stable
        // id, carrying one committed todo.
        projHandler({
            eventType: 'INSERT',
            new: { id: 'proj-1', name: 'OldName', color: null, target_id: null },
        });
        todoHandler({
            eventType: 'INSERT',
            new: {
                id: 'todo-1',
                project_id: 'proj-1',
                title: 'Existing task',
                description: '',
                due_date: null,
                priority: 1,
                position: 1,
                completed: false,
                recurrence: null,
            },
        });

        expect(listLogic.listProjectsArray()).toEqual(['OldName']);
        expect(listLogic.listItems('OldName').some(function(i) {
            return i.id === 'todo-1';
        })).toBe(true);

        // Device A renamed the project → an UPDATE arrives carrying the
        // SAME id under the NEW name.
        projHandler({
            eventType: 'UPDATE',
            new: { id: 'proj-1', name: 'NewName', color: null, target_id: null },
        });

        // Exactly one project, under the new name, old name gone.
        expect(listLogic.listProjectsArray()).toEqual(['NewName']);
        expect(listLogic.listItems('OldName')).toBeUndefined();
        // Items survived the rename-in-place.
        const renamedItems = listLogic.listItems('NewName');
        expect(renamedItems.some(function(i) { return i.id === 'todo-1'; })).toBe(true);
    });

    it('hydrateFromSupabase merges a renamed remote project by id — old local name does not survive and no duplicate INSERT fires', async () => {
        const handlers = wireRealtimeHandlers();
        const projHandler = handlers['public:projects'];

        // Seed Device B's local cache via a realtime INSERT so the local
        // entry carries a known stable id ("proj-1") under the OLD name.
        projHandler({
            eventType: 'INSERT',
            new: { id: 'proj-1', name: 'OldName', color: null, target_id: null },
        });
        expect(listLogic.listProjectsArray()).toEqual(['OldName']);

        // Remote state after the rename on Device A: the same id, NEW name,
        // with one todo attached.
        const remoteProjects = [
            { id: 'proj-1', name: 'NewName', color: null, target_id: null, position: 0, updated_at: '2026-05-29T00:00:00Z' },
        ];
        const remoteTodos = [
            {
                id: 'todo-remote',
                project_id: 'proj-1',
                title: 'Remote task',
                description: '',
                due_date: null,
                priority: 1,
                position: 0,
                completed: false,
                recurrence: null,
            },
        ];

        vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
            data: { session: { user: { id: 'user-1' } } },
            error: null,
        });

        const inserts = [];
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

        await listLogic.hydrateFromSupabase();

        // Exactly one project, under the NEW name, carrying the remote todo.
        expect(listLogic.listProjectsArray()).toEqual(['NewName']);
        expect(listLogic.listItems('OldName')).toBeUndefined();
        expect(listLogic.listItems('NewName').some(function(i) {
            return i.id === 'todo-remote';
        })).toBe(true);

        // The duplicate re-INSERT (and its PK-collision 409) must not fire:
        // the local entry's id already exists remotely, so the local-only
        // push must skip it rather than re-inserting under the old name.
        const reinserted = inserts.some(function(c) {
            return c.table === 'projects' && c.row && c.row.id === 'proj-1';
        });
        expect(reinserted).toBe(false);
    });
});
