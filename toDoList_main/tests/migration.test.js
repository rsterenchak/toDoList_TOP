// Phase 6 — first-login migration of localStorage data to Supabase
// + sign-out localStorage wipe.
//
// These behavioural tests stub supabase.auth.getSession and supabase.from
// so the migration runs against a deterministic fake backend.

import { vi } from 'vitest';

import { supabase } from '../src/supabaseClient.js';
import { listLogic } from '../src/listLogic.js';
import {
    maybeMigrateLocalToSupabase,
    wipeLocalUserDataOnSignOut,
} from '../src/migration.js';

const USER_ID = 'user-abc-123';
const MARKER_KEY = 'migrated_user_' + USER_ID;

function buildSupabaseMock(opts) {
    const probeResult = opts && opts.probeResult
        ? opts.probeResult
        : { data: [], error: null };
    const insertResolver = (opts && opts.insertResolver)
        || (function() { return Promise.resolve({ data: null, error: null }); });

    const inserts = { projects: [], todos: [] };

    const buildSelectChain = function() {
        return {
            select: function() {
                return {
                    eq: function() {
                        return {
                            limit: function() {
                                return Promise.resolve(probeResult);
                            },
                        };
                    },
                };
            },
        };
    };

    const fromMock = vi.fn(function(table) {
        const chain = buildSelectChain();
        chain.insert = function(row) {
            if (table === 'projects') inserts.projects.push(row);
            else if (table === 'todos') inserts.todos.push(row);
            return insertResolver(table, row);
        };
        return chain;
    });

    return { fromMock, inserts };
}


describe('maybeMigrateLocalToSupabase', () => {
    let sessionSpy;
    let fromSpy;
    let warnSpy;

    beforeEach(() => {
        localStorage.clear();
        sessionSpy = vi.spyOn(supabase.auth, 'getSession')
            .mockResolvedValue({
                data: { session: { user: { id: USER_ID } } },
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
        localStorage.clear();
    });

    it('uploads every project + todo when cloud is empty and local has data, then sets the marker', async () => {
        localStorage.setItem('allProjects', JSON.stringify({
            Work: {
                id: 'proj-work',
                color: 'red',
                items: [
                    { id: 'todo-1', tit: 'Ship feature', desc: '', due: '5-30-2026', pri: 1, pos: 0, completed: false, recurrence: null },
                    { id: 'todo-2', tit: 'Review PR',   desc: 'urgent', due: '', pri: 2, pos: 1, completed: false, recurrence: null },
                ],
            },
            Home: {
                id: 'proj-home',
                color: null,
                items: [
                    { id: 'todo-3', tit: 'Buy milk', desc: '', due: '', pri: 1, pos: 0, completed: false, recurrence: null },
                ],
            },
        }));

        const mock = buildSupabaseMock();
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        await maybeMigrateLocalToSupabase(USER_ID);

        expect(mock.inserts.projects.length).toBe(2);
        const projectIds = mock.inserts.projects.map(function(r) { return r.id; });
        expect(projectIds).toContain('proj-work');
        expect(projectIds).toContain('proj-home');

        expect(mock.inserts.todos.length).toBe(3);
        const todoTitles = mock.inserts.todos.map(function(r) { return r.title; });
        expect(todoTitles).toContain('Ship feature');
        expect(todoTitles).toContain('Review PR');
        expect(todoTitles).toContain('Buy milk');

        expect(localStorage.getItem(MARKER_KEY)).toBe('true');
    });

    it('skips upload when cloud already has data but still sets the marker', async () => {
        localStorage.setItem('allProjects', JSON.stringify({
            Stale: {
                id: 'proj-stale',
                color: null,
                items: [{ id: 'todo-stale', tit: 'Old', desc: '', due: '', pri: 1, pos: 0, completed: false, recurrence: null }],
            },
        }));

        const mock = buildSupabaseMock({
            probeResult: { data: [{ id: 'remote-proj-1' }], error: null },
        });
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        await maybeMigrateLocalToSupabase(USER_ID);

        expect(mock.inserts.projects.length).toBe(0);
        expect(mock.inserts.todos.length).toBe(0);
        expect(localStorage.getItem(MARKER_KEY)).toBe('true');
    });

    it('short-circuits without probing the cloud when the marker is already set', async () => {
        localStorage.setItem(MARKER_KEY, 'true');
        localStorage.setItem('allProjects', JSON.stringify({
            Work: { id: 'p', color: null, items: [{ id: 't', tit: 'foo', desc: '', due: '', pri: 1, pos: 0 }] },
        }));

        const mock = buildSupabaseMock();
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        await maybeMigrateLocalToSupabase(USER_ID);

        expect(mock.fromMock).not.toHaveBeenCalled();
        expect(mock.inserts.projects.length).toBe(0);
        expect(mock.inserts.todos.length).toBe(0);
    });

    it('generates a fresh UUID for projects/todos missing an id (defensive)', async () => {
        localStorage.setItem('allProjects', JSON.stringify({
            Legacy: {
                // no id field
                color: null,
                items: [
                    // no id field on the todo either
                    { tit: 'Pre-Phase-5 item', desc: '', due: '', pri: 1, pos: 0, completed: false, recurrence: null },
                ],
            },
        }));

        const mock = buildSupabaseMock();
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        await maybeMigrateLocalToSupabase(USER_ID);

        expect(mock.inserts.projects.length).toBe(1);
        expect(typeof mock.inserts.projects[0].id).toBe('string');
        expect(mock.inserts.projects[0].id.length).toBeGreaterThan(0);

        expect(mock.inserts.todos.length).toBe(1);
        expect(typeof mock.inserts.todos[0].id).toBe('string');
        expect(mock.inserts.todos[0].id.length).toBeGreaterThan(0);

        expect(localStorage.getItem(MARKER_KEY)).toBe('true');
    });

    it('does not set the marker when an insert fails with a non-conflict error', async () => {
        localStorage.setItem('allProjects', JSON.stringify({
            Work: {
                id: 'proj-work',
                color: null,
                items: [{ id: 'todo-1', tit: 'Ship', desc: '', due: '', pri: 1, pos: 0, completed: false, recurrence: null }],
            },
        }));

        const mock = buildSupabaseMock({
            insertResolver: function(table) {
                if (table === 'projects') {
                    return Promise.resolve({ data: null, error: { code: 'XX000', message: 'boom' } });
                }
                return Promise.resolve({ data: null, error: null });
            },
        });
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        await maybeMigrateLocalToSupabase(USER_ID);

        expect(localStorage.getItem(MARKER_KEY)).toBeNull();
    });

    it('treats a duplicate-key conflict (23505) as success and continues', async () => {
        localStorage.setItem('allProjects', JSON.stringify({
            Work: {
                id: 'proj-work',
                color: null,
                items: [{ id: 'todo-1', tit: 'Ship', desc: '', due: '', pri: 1, pos: 0, completed: false, recurrence: null }],
            },
        }));

        const mock = buildSupabaseMock({
            insertResolver: function() {
                return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
            },
        });
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        await maybeMigrateLocalToSupabase(USER_ID);

        expect(localStorage.getItem(MARKER_KEY)).toBe('true');
    });

    it('is a no-op when invoked without a userId', async () => {
        const mock = buildSupabaseMock();
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        await maybeMigrateLocalToSupabase(null);
        await maybeMigrateLocalToSupabase(undefined);
        await maybeMigrateLocalToSupabase('');

        expect(mock.fromMock).not.toHaveBeenCalled();
    });

    it('sets the marker when both cloud and local are empty (so next sign-in skips the probe)', async () => {
        // No allProjects in localStorage.
        const mock = buildSupabaseMock();
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        await maybeMigrateLocalToSupabase(USER_ID);

        expect(mock.inserts.projects.length).toBe(0);
        expect(mock.inserts.todos.length).toBe(0);
        expect(localStorage.getItem(MARKER_KEY)).toBe('true');
    });

    it('filters blank-placeholder todos so render artifacts never hit Supabase', async () => {
        localStorage.setItem('allProjects', JSON.stringify({
            Work: {
                id: 'proj-work',
                color: null,
                items: [
                    { id: 'placeholder', tit: '', desc: '', due: '', pri: 1, pos: 0 },
                    { id: 'real-todo',   tit: 'Real task', desc: '', due: '', pri: 1, pos: 1 },
                ],
            },
        }));

        const mock = buildSupabaseMock();
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        await maybeMigrateLocalToSupabase(USER_ID);

        expect(mock.inserts.todos.length).toBe(1);
        expect(mock.inserts.todos[0].title).toBe('Real task');
    });
});


describe('wipeLocalUserDataOnSignOut', () => {
    let sessionSpy;
    let warnSpy;

    beforeEach(() => {
        localStorage.clear();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(function() {});
    });

    afterEach(() => {
        if (sessionSpy) sessionSpy.mockRestore();
        if (warnSpy) warnSpy.mockRestore();
        sessionSpy = null;
        warnSpy = null;
        localStorage.clear();
    });

    it('removes allProjects and migrated_user_<userId> while preserving UI prefs', async () => {
        localStorage.setItem('allProjects', JSON.stringify({ Work: { id: 'p', items: [], color: null } }));
        localStorage.setItem(MARKER_KEY, 'true');
        localStorage.setItem('todoapp_theme', 'dark');
        localStorage.setItem('todoapp_sidebarWidth', '220');

        sessionSpy = vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
            data: { session: { user: { id: USER_ID } } },
            error: null,
        });

        await wipeLocalUserDataOnSignOut();

        expect(localStorage.getItem('allProjects')).toBeNull();
        expect(localStorage.getItem(MARKER_KEY)).toBeNull();
        expect(localStorage.getItem('todoapp_theme')).toBe('dark');
        expect(localStorage.getItem('todoapp_sidebarWidth')).toBe('220');
    });

    it('only wipes the signed-in user’s marker — leaves other users’ markers in place', async () => {
        localStorage.setItem('migrated_user_other-user', 'true');
        localStorage.setItem(MARKER_KEY, 'true');

        sessionSpy = vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
            data: { session: { user: { id: USER_ID } } },
            error: null,
        });

        await wipeLocalUserDataOnSignOut();

        expect(localStorage.getItem(MARKER_KEY)).toBeNull();
        expect(localStorage.getItem('migrated_user_other-user')).toBe('true');
    });

    it('still wipes allProjects when getSession returns no session', async () => {
        localStorage.setItem('allProjects', JSON.stringify({ Work: { id: 'p', items: [], color: null } }));

        sessionSpy = vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
            data: { session: null },
            error: null,
        });

        await wipeLocalUserDataOnSignOut();

        expect(localStorage.getItem('allProjects')).toBeNull();
    });
});
