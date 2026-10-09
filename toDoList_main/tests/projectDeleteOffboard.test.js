import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The project delete confirm can also remove the project's inject target and
// offboard its repo — but only when no other project routes to that target. A
// shared target is named in a muted line and left alone; a project with no
// target gets today's plain confirm. The project is always deleted first, so a
// failed offboard still removes it and only leaves the target in place.

let targetRows = [];
const deleteEq = vi.fn(() => Promise.resolve({ data: null, error: null }));

vi.mock('../src/supabaseClient.js', () => {
    const query = {
        select: function () { return this; },
        order: function () { return Promise.resolve({ data: targetRows, error: null }); },
        delete: function () { return { eq: function (...a) { return deleteEq(...a); } }; },
        insert: function () { return Promise.resolve({ data: null, error: null }); },
        update: function () { return this; },
        upsert: function () { return Promise.resolve({ data: null, error: null }); },
        eq: function () { return Promise.resolve({ data: null, error: null }); },
    };
    return {
        supabase: {
            auth: {
                getSession: function () {
                    return Promise.resolve({ data: { session: null }, error: null });
                },
                onAuthStateChange: function () {
                    return { data: { subscription: { unsubscribe: function () {} } } };
                },
            },
            from: function () { return query; },
            channel: function () {
                return { on: function () { return this; }, subscribe: function () { return {}; } };
            },
            removeChannel: function () {},
        },
    };
});

import { initInjectConfig, loadInjectTargets, buildOffboardChoice } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';
import { deleteProjectFlow } from '../src/projectRow.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) { for (let i = 0; i < n; i++) await tick(); }

let fetchSpy;
let realFetch;
let offboardReply;

function offboardBodies() {
    return fetchSpy.mock.calls
        .map((c) => { try { return JSON.parse(c[1].body); } catch (e) { return null; } })
        .filter((b) => b && b.offboard);
}

function check(input, on) {
    input.checked = on;
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

function addRoutedProject(name, targetId) {
    listLogic.addProject(name);
    if (targetId) listLogic.setProjectTargetId(name, targetId);
}

function openDelete(name) {
    const row = document.createElement('div');
    row.id = 'projChild';
    document.body.appendChild(row);
    deleteProjectFlow(row, name);
    return {
        dialog: document.getElementById('confirmModal'),
        main: document.getElementById('injectOffboardCheck'),
        purge: document.getElementById('injectOffboardPurge'),
        force: document.getElementById('injectOffboardForce'),
        confirm: document.getElementById('confirmModalConfirm'),
    };
}

beforeEach(async () => {
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();
    targetRows = [{ id: 't1', nickname: 'game', repo: 'owner/game', file_path: 'TODO.md' }];
    deleteEq.mockClear();
    offboardReply = { ok: true, status: 200, body: { ok: true, dispatched: true } };

    realFetch = globalThis.fetch;
    fetchSpy = vi.fn((url, init) => {
        let body = {};
        try { body = JSON.parse(init.body); } catch (e) { /* not JSON */ }
        const reply = body.offboard ? offboardReply : { ok: true, status: 200, body: { ok: true } };
        return Promise.resolve({
            ok: reply.ok,
            status: reply.status,
            json: () => Promise.resolve(reply.body),
            text: () => Promise.resolve(JSON.stringify(reply.body)),
        });
    });
    globalThis.fetch = fetchSpy;
    await loadInjectTargets();
});

afterEach(() => {
    globalThis.fetch = realFetch;
    listLogic.listProjectsArray().slice().forEach((n) => listLogic.removeProject(n));
    document.body.innerHTML = '';
    localStorage.clear();
    initInjectConfig();
});

describe('buildOffboardChoice', () => {
    it('returns { node, read } and takes a custom parent label', () => {
        const c = buildOffboardChoice(targetRows[0], { label: 'Custom label' });
        expect(c.node).toBeInstanceOf(HTMLElement);
        expect(c.node.textContent).toContain('Custom label');
        expect(c.read()).toEqual({ offboard: false, purge: false, force: false });
    });
});

describe('project delete confirm — target offboard', () => {
    it('no target: plain two-part confirm, no offboard body', () => {
        addRoutedProject('Alpha', null);
        const c = openDelete('Alpha');
        expect(c.dialog.children.length).toBe(2);
        expect(c.main).toBeNull();
        expect(c.confirm.textContent).toBe('Delete');
    });

    it('sole target: offers the offboard choice, unchecked, labelled with nickname + repo', () => {
        addRoutedProject('Alpha', 't1');
        const c = openDelete('Alpha');
        expect(c.main).not.toBeNull();
        expect(c.main.checked).toBe(false);
        expect(c.main.closest('label').textContent).toBe('Also delete target game and offboard owner/game');
        check(c.main, true);
        expect(c.confirm.textContent).toBe('Delete + offboard');
        check(c.main, false);
        expect(c.confirm.textContent).toBe('Delete');
    });

    it('shared target: muted note, no checkbox', () => {
        addRoutedProject('Alpha', 't1');
        addRoutedProject('Beta', 't1');
        const c = openDelete('Alpha');
        expect(c.main).toBeNull();
        const note = c.dialog.querySelector('.injectOffboardShared');
        expect(note.textContent).toBe('Target game is used by 1 other project — left in place');
    });

    it('unchecked: deletes only the project', async () => {
        addRoutedProject('Alpha', 't1');
        const c = openDelete('Alpha');
        c.confirm.click();
        await flush();
        expect(listLogic.listProjectsArray()).not.toContain('Alpha');
        expect(offboardBodies()).toHaveLength(0);
        expect(deleteEq).not.toHaveBeenCalled();
    });

    it('checked: deletes the project, dispatches the offboard, then deletes the target', async () => {
        addRoutedProject('Alpha', 't1');
        const c = openDelete('Alpha');
        check(c.main, true);
        check(c.force, true);
        c.confirm.click();
        expect(listLogic.listProjectsArray()).not.toContain('Alpha');
        await flush();
        expect(offboardBodies()).toEqual([
            { offboard: true, target_repo: 'owner/game', purge: false, force: true },
        ]);
        expect(deleteEq).toHaveBeenCalledWith('id', 't1');
        expect(document.getElementById('injectToast').textContent)
            .toBe('Project deleted · target removed · offboard dispatched');
    });

    it('checked but the offboard fails: project still deleted, target left, error toast', async () => {
        offboardReply = { ok: false, status: 500, body: { ok: false, error: 'boom' } };
        addRoutedProject('Alpha', 't1');
        const c = openDelete('Alpha');
        check(c.main, true);
        c.confirm.click();
        await flush();
        expect(listLogic.listProjectsArray()).not.toContain('Alpha');
        expect(offboardBodies()).toHaveLength(1);
        expect(deleteEq).not.toHaveBeenCalled();
        expect(document.getElementById('injectToast').classList.contains('injectToast--error')).toBe(true);
    });
});
