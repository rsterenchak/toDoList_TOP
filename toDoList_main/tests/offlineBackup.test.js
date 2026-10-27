// Export / Import without an account, and the offline backup nudge.
//
// The contract pinned here:
//
//   • in local mode Export builds the file from the in-memory snapshot (tagged
//     `mode: 'local'`, same filename convention) and never asks Supabase for a
//     session; it stamps `todoapp_lastExportAt`
//   • in local mode Import replaces the projects and writes localStorage
//   • a signed-in Supabase export restores offline, and an offline export
//     replays through replaceAllProjects when imported signed in
//   • the nudge shows on a never-exported (or >7 days stale) offline list with
//     todos, hides on × for 7 days, and never renders with data-access="account"

import { vi } from 'vitest';

const h = vi.hoisted(() => ({
    getSession: null,
}));

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        auth: {
            getSession: (...args) => h.getSession(...args),
        },
        from: () => { throw new Error('Supabase must not be touched'); },
    },
}));
vi.mock('../src/modals.js', () => ({
    showConfirmModal: (opts) => opts.onConfirm(),
}));

import { listLogic } from '../src/listLogic.js';
import { chooseLocalMode, chooseAccountMode, ACCESS_MODE_KEY } from '../src/accessMode.js';
import {
    exportToJson,
    openImportPicker,
    importFromJson,
    LAST_EXPORT_KEY,
} from '../src/jsonImportExport.js';
import {
    BACKUP_NUDGE_DISMISSED_KEY,
    BACKUP_NUDGE_INTERVAL_MS,
    shouldShowBackupNudge,
    refreshBackupNudge,
    mountBackupNudge,
} from '../src/backupNudge.js';

const DAY = 24 * 60 * 60 * 1000;

let downloads;

function readBlob(blob) {
    return new Promise(function(resolve) {
        const reader = new FileReader();
        reader.onload = function() { resolve(reader.result); };
        reader.readAsText(blob);
    });
}

function flush() {
    return new Promise(function(resolve) { setTimeout(resolve, 20); });
}

function pickFile(contents) {
    const realCreate = document.createElement.bind(document);
    let input = null;
    vi.spyOn(document, 'createElement').mockImplementation(function(tag) {
        const el = realCreate(tag);
        if (tag === 'input') {
            input = el;
            el.click = function() {};
        }
        return el;
    });
    openImportPicker(function() {});
    document.createElement.mockRestore();
    const file = new File([contents], 'todolist-export.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
}

beforeEach(() => {
    localStorage.clear();
    listLogic._reset();
    h.getSession = vi.fn(() => Promise.resolve({ data: { session: null } }));
    downloads = [];
    URL.createObjectURL = vi.fn(function(blob) {
        downloads.push({ blob: blob });
        return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function() {
        downloads[downloads.length - 1].filename = this.download;
    });
    document.body.innerHTML = '';
    chooseLocalMode();
});

afterEach(() => {
    vi.restoreAllMocks();
    delete document.documentElement.dataset.access;
    localStorage.removeItem(ACCESS_MODE_KEY);
});


describe('offline export', () => {

    it('downloads the in-memory snapshot without asking Supabase for a session', async () => {
        listLogic.addProject('Groceries');
        listLogic.addToDo('Groceries', 'Milk');
        h.getSession.mockClear();

        await exportToJson();

        expect(h.getSession).not.toHaveBeenCalled();
        expect(downloads).toHaveLength(1);
        expect(downloads[0].filename).toMatch(/^todolist-export-\d{4}-\d{2}-\d{2}\.json$/);
        const payload = JSON.parse(await readBlob(downloads[0].blob));
        expect(payload.version).toBe(1);
        expect(payload.mode).toBe('local');
        expect(payload.projects[0].name).toBe('Groceries');
        expect(payload.projects[0].items.map(i => i.tit)).toContain('Milk');
    });

    it('stamps todoapp_lastExportAt on success', async () => {
        expect(localStorage.getItem(LAST_EXPORT_KEY)).toBeNull();
        await exportToJson();
        expect(Number(localStorage.getItem(LAST_EXPORT_KEY))).toBeGreaterThan(0);
    });
});


describe('offline import', () => {

    it('replaces the projects and writes localStorage', async () => {
        listLogic.addProject('Old');
        const file = JSON.stringify({
            version: 1,
            exportedAt: '2026-10-01T00:00:00.000Z',
            mode: 'local',
            projects: [{ name: 'Imported', color: null, items: [
                { tit: 'From file', desc: '', due: '', pri: 1, completed: false },
            ] }],
        });

        pickFile(file);
        await flush();

        expect(listLogic.listProjectsArray()).toEqual(['Imported']);
        const stored = JSON.parse(localStorage.getItem('allProjects'));
        expect(Object.keys(stored)).toEqual(['Imported']);
        expect(stored.Imported.items.map(i => i.tit)).toContain('From file');
    });

    it('restores a signed-in (Supabase rows) export', async () => {
        const file = JSON.stringify({
            version: 1,
            exportedAt: '2026-10-01T00:00:00.000Z',
            projects: [
                { id: 'p2', name: 'Second', position: 1 },
                { id: 'p1', name: 'First', position: 0, color: null },
            ],
            todos: [
                { id: 't2', project_id: 'p1', title: 'Later', position: 1, due_date: '2026-11-05' },
                { id: 't1', project_id: 'p1', title: 'Sooner', position: 0, completed: true },
                { id: 't3', project_id: 'p2', title: 'Other', position: 0 },
            ],
        });

        pickFile(file);
        await flush();

        expect(listLogic.listProjectsArray()).toEqual(['First', 'Second']);
        const first = listLogic.listItems('First').filter(i => i.tit);
        expect(first.map(i => i.tit).sort()).toEqual(['Later', 'Sooner']);
        expect(first.find(i => i.tit === 'Later').due).toBe('11-5-2026');
        expect(first.find(i => i.tit === 'Sooner').completed).toBe(true);
        expect(listLogic.listItems('Second').map(i => i.tit)).toContain('Other');
    });

    it('an offline file imported signed in replays through replaceAllProjects', async () => {
        chooseAccountMode();
        const spy = vi.spyOn(listLogic, 'replaceAllProjects');
        const file = new File([JSON.stringify({
            version: 1,
            exportedAt: '2026-10-01T00:00:00.000Z',
            mode: 'local',
            projects: [{ name: 'Carried', items: [{ tit: 'Up' }] }],
        })], 'x.json');

        await importFromJson(file);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0][0].name).toBe('Carried');
    });
});


describe('signed-in export', () => {

    it('still reads Supabase (asks for the session)', async () => {
        chooseAccountMode();
        await exportToJson();
        expect(h.getSession).toHaveBeenCalled();
        expect(downloads).toHaveLength(0);
    });
});


describe('backup nudge', () => {

    function withTodo() {
        listLogic.addProject('Home');
        listLogic.addToDo('Home', 'Water plants');
    }

    function mountList() {
        const list = document.createElement('div');
        list.id = 'mainList';
        document.body.appendChild(list);
        return list;
    }

    it('shows on a never-exported offline list with todos', () => {
        withTodo();
        const list = mountList();
        mountBackupNudge(list);

        const nudge = list.querySelector('#backupNudge');
        expect(nudge).not.toBeNull();
        expect(list.firstChild).toBe(nudge);
        expect(nudge.textContent).toContain('your tasks live in this browser. Export a backup.');
        expect(nudge.querySelector('.backupNudgeExport')).not.toBeNull();
        expect(nudge.querySelector('.backupNudgeDismiss')).not.toBeNull();
    });

    it('stays hidden with no todos', () => {
        listLogic.addProject('Empty');
        expect(shouldShowBackupNudge()).toBe(false);
    });

    it('shows again once the last export is older than 7 days', () => {
        withTodo();
        const now = Date.now();
        localStorage.setItem(LAST_EXPORT_KEY, String(now - 2 * DAY));
        expect(shouldShowBackupNudge(now)).toBe(false);
        localStorage.setItem(LAST_EXPORT_KEY, String(now - 8 * DAY));
        expect(shouldShowBackupNudge(now)).toBe(true);
    });

    it('× hides it and keeps it hidden for 7 days', () => {
        withTodo();
        const list = mountList();
        mountBackupNudge(list);

        list.querySelector('.backupNudgeDismiss').click();

        expect(list.querySelector('#backupNudge')).toBeNull();
        const dismissedAt = Number(localStorage.getItem(BACKUP_NUDGE_DISMISSED_KEY));
        expect(dismissedAt).toBeGreaterThan(0);
        expect(shouldShowBackupNudge(dismissedAt + 6 * DAY)).toBe(false);
        expect(shouldShowBackupNudge(dismissedAt + BACKUP_NUDGE_INTERVAL_MS + 1)).toBe(true);
    });

    it('Export runs the local export, stamps the key and hides the row', async () => {
        withTodo();
        const list = mountList();
        mountBackupNudge(list);
        await flush();
        h.getSession.mockClear();

        list.querySelector('.backupNudgeExport').click();
        await flush();

        expect(downloads).toHaveLength(1);
        expect(h.getSession).not.toHaveBeenCalled();
        expect(Number(localStorage.getItem(LAST_EXPORT_KEY))).toBeGreaterThan(0);
        expect(list.querySelector('#backupNudge')).toBeNull();
    });

    it('re-places itself after the list is wiped and rebuilt', async () => {
        withTodo();
        const list = mountList();
        mountBackupNudge(list);

        while (list.firstChild) list.removeChild(list.firstChild);
        list.appendChild(document.createElement('div'));
        await flush();

        expect(list.querySelector('#backupNudge')).not.toBeNull();
    });

    it('never renders with data-access="account"', () => {
        withTodo();
        chooseAccountMode();
        const list = mountList();
        mountBackupNudge(list);
        refreshBackupNudge(list);

        expect(shouldShowBackupNudge()).toBe(false);
        expect(list.querySelector('#backupNudge')).toBeNull();
    });
});
