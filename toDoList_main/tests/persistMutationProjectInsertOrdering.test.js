// Behavioural regression for the FK ordering gate in persistMutation.
//
// Bug symptom: on mobile, creating a new project and immediately
// committing a todo into it caused the project to rehydrate empty
// after a reload. The two persistMutation calls (project INSERT,
// todo INSERT) fire back-to-back without awaits between them, and
// the network can reorder them — when the child todo INSERT lands
// first, Supabase rejects it with a foreign-key constraint violation
// because the parent project row does not yet exist. The todo was
// silently dropped, the project came back without it.
//
// Fix: persistMutation registers each project INSERT's in-flight
// promise in a module-scoped map keyed by project id. Any todo
// operation whose payload references that project id awaits the
// project INSERT promise before issuing its own request, so the
// parent always lands first regardless of network reordering.

import { vi } from 'vitest';

import { listLogic } from '../src/listLogic.js';
import { supabase } from '../src/supabaseClient.js';


describe('listLogic — persistMutation FK ordering gate (regression for #fix-new-project-todos-mobile)', () => {
    let sessionSpy;
    let fromSpy;
    let warnSpy;

    beforeEach(() => {
        listLogic._reset();
        sessionSpy = vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
            data: { session: { user: { id: 'user-abc-123' } } },
            error: null,
        });
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(function() {});
    });

    afterEach(() => {
        if (sessionSpy) sessionSpy.mockRestore();
        if (fromSpy) fromSpy.mockRestore();
        if (warnSpy) warnSpy.mockRestore();
        sessionSpy = null;
        fromSpy = null;
        warnSpy = null;
    });

    it('a todo INSERT with project_id matching an in-flight project INSERT waits for the project INSERT to land first', async () => {
        let resolveProjectInsert;
        const projectInsertGate = new Promise(function(resolve) {
            resolveProjectInsert = resolve;
        });

        const callOrder = [];
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(function(table) {
            return {
                insert: function(row) {
                    callOrder.push({ table: table, id: row.id });
                    if (table === 'projects') {
                        // Stall until the test releases the gate so the
                        // todo INSERT below has a chance to race past it.
                        return projectInsertGate.then(function() {
                            return { data: [row], error: null };
                        });
                    }
                    return Promise.resolve({ data: [row], error: null });
                },
            };
        });

        const p1 = listLogic.persistMutation({
            op: 'insert',
            table: 'projects',
            payload: {
                id: 'proj-new',
                name: 'Work',
                color: null,
                position: 0,
                target_id: null,
            },
        });

        // Yield enough microtasks for the project INSERT to reach the
        // supabase mock and register itself in the pending map.
        await Promise.resolve();
        await Promise.resolve();

        const p2 = listLogic.persistMutation({
            op: 'insert',
            table: 'todos',
            payload: {
                id: 'todo-new',
                project_id: 'proj-new',
                title: 'Buy milk',
                description: null,
                due_date: null,
                priority: '1',
                position: 0,
                completed: false,
                recurrence: null,
            },
        });

        // Pump microtasks so the todo INSERT reaches the gate. Without
        // the fix, the todo INSERT would race past and hit the mock
        // before the project INSERT resolved — the call log would
        // already contain a todos entry at this point.
        for (let i = 0; i < 5; i++) await Promise.resolve();
        const todosBefore = callOrder.filter(function(c) { return c.table === 'todos'; });
        expect(todosBefore.length).toBe(0);

        resolveProjectInsert();
        await Promise.all([p1, p2]);

        // Final ordering: project INSERT first, then todo INSERT.
        const projectIdx = callOrder.findIndex(function(c) {
            return c.table === 'projects' && c.id === 'proj-new';
        });
        const todoIdx = callOrder.findIndex(function(c) {
            return c.table === 'todos' && c.id === 'todo-new';
        });
        expect(projectIdx).toBeGreaterThanOrEqual(0);
        expect(todoIdx).toBeGreaterThan(projectIdx);
    });

    it('a todo INSERT for a project that is not in flight fires immediately (no spurious wait)', async () => {
        const callOrder = [];
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(function(table) {
            return {
                insert: function(row) {
                    callOrder.push({ table: table, id: row.id });
                    return Promise.resolve({ data: [row], error: null });
                },
            };
        });

        await listLogic.persistMutation({
            op: 'insert',
            table: 'todos',
            payload: {
                id: 'todo-orphan',
                project_id: 'proj-not-in-flight',
                title: 'Standalone',
                description: null,
                due_date: null,
                priority: '1',
                position: 0,
                completed: false,
                recurrence: null,
            },
        });

        const todoIdx = callOrder.findIndex(function(c) {
            return c.table === 'todos' && c.id === 'todo-orphan';
        });
        expect(todoIdx).toBeGreaterThanOrEqual(0);
    });

    it('once the project INSERT completes, subsequent todo INSERTs no longer wait on it', async () => {
        const callOrder = [];
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(function(table) {
            return {
                insert: function(row) {
                    callOrder.push({ table: table, id: row.id });
                    return Promise.resolve({ data: [row], error: null });
                },
            };
        });

        await listLogic.persistMutation({
            op: 'insert',
            table: 'projects',
            payload: {
                id: 'proj-settled',
                name: 'Work',
                color: null,
                position: 0,
                target_id: null,
            },
        });

        // Now that the project INSERT has settled, a follow-up todo
        // INSERT should not be queued behind anything — the map entry
        // is released in the finally block on the project insert path.
        await listLogic.persistMutation({
            op: 'insert',
            table: 'todos',
            payload: {
                id: 'todo-after',
                project_id: 'proj-settled',
                title: 'Follow up',
                description: null,
                due_date: null,
                priority: '1',
                position: 0,
                completed: false,
                recurrence: null,
            },
        });

        expect(callOrder.map(function(c) { return c.table; })).toEqual([
            'projects',
            'todos',
        ]);
    });

    it('releases the pending entry even when the project INSERT rejects, so the todo write does not deadlock', async () => {
        let rejectProjectInsert;
        const projectInsertGate = new Promise(function(_resolve, reject) {
            rejectProjectInsert = reject;
        });

        const callOrder = [];
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(function(table) {
            return {
                insert: function(row) {
                    callOrder.push({ table: table, id: row.id });
                    if (table === 'projects') {
                        return projectInsertGate;
                    }
                    return Promise.resolve({ data: [row], error: null });
                },
            };
        });

        const p1 = listLogic.persistMutation({
            op: 'insert',
            table: 'projects',
            payload: {
                id: 'proj-doomed',
                name: 'Work',
                color: null,
                position: 0,
                target_id: null,
            },
        });

        await Promise.resolve();
        await Promise.resolve();

        const p2 = listLogic.persistMutation({
            op: 'insert',
            table: 'todos',
            payload: {
                id: 'todo-doomed',
                project_id: 'proj-doomed',
                title: 'Buy milk',
                description: null,
                due_date: null,
                priority: '1',
                position: 0,
                completed: false,
                recurrence: null,
            },
        });

        rejectProjectInsert(new Error('network down'));
        await Promise.all([p1, p2]);

        // The todo INSERT still ran (the gate's catch lets it fall
        // through) — without the catch, the gate's await would
        // propagate the rejection and the todo would never be issued.
        const todoIdx = callOrder.findIndex(function(c) {
            return c.table === 'todos' && c.id === 'todo-doomed';
        });
        expect(todoIdx).toBeGreaterThanOrEqual(0);
    });
});
