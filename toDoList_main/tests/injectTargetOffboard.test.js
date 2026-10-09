import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Deleting an inject target can also offboard its repo. The target row's
// Delete confirm carries one "offboard" checkbox (with purge / force options
// revealed beneath it); when it's checked the offboard is dispatched FIRST and
// the row is deleted only if that succeeded. Unchecked, the flow is plain
// Delete. Driven in jsdom against a stubbed Supabase client and a captured
// fetch so the Worker payload and the delete call are both observable.

let targetRows = [];
const deleteEq = vi.fn(() => Promise.resolve({ data: null, error: null }));

vi.mock('../src/supabaseClient.js', () => {
    const query = {
        select: function () { return this; },
        order: function () { return Promise.resolve({ data: targetRows, error: null }); },
        delete: function () { return { eq: function (...a) { return deleteEq(...a); } }; },
        insert: function () { return Promise.resolve({ data: null, error: null }); },
        update: function () { return this; },
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

import { offboardRepo, showInjectSettingsModal, initInjectConfig } from '../src/inject.js';
import { showConfirmModal } from '../src/modals.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) { for (let i = 0; i < n; i++) await tick(); }

let fetchSpy;
let realFetch;
let offboardReply;

function offboardBodies() {
    return fetchSpy.mock.calls
        .map((c) => { try { return JSON.parse(c[1].body); } catch (e) { return null; } })
        .filter((b) => b && b.offboard);
}

beforeEach(() => {
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
});

afterEach(() => {
    globalThis.fetch = realFetch;
    document.body.innerHTML = '';
    localStorage.clear();
    initInjectConfig();
});

describe('offboardRepo', () => {
    it('posts the offboard payload with literal booleans', async () => {
        const res = await offboardRepo('owner/game', 'yes', undefined);
        expect(res.ok).toBe(true);
        expect(offboardBodies()).toEqual([
            { offboard: true, target_repo: 'owner/game', purge: true, force: false },
        ]);
    });

    it('returns { ok: false, reason } when the Worker rejects', async () => {
        offboardReply = { ok: false, status: 500, body: { ok: false, error: 'boom' } };
        const res = await offboardRepo('owner/game', false, false);
        expect(res.ok).toBe(false);
        expect(typeof res.reason).toBe('string');
        expect(res.reason.length).toBeGreaterThan(0);
    });
});

describe('showConfirmModal body option', () => {
    it('mounts the body between message and actions and hands it to onConfirm', () => {
        const body = document.createElement('div');
        body.id = 'extra';
        const onConfirm = vi.fn();
        showConfirmModal({ message: 'Sure?', body: body, onConfirm: onConfirm });
        const dialog = document.getElementById('confirmModal');
        const kids = Array.from(dialog.children).map((n) => n.id);
        expect(kids).toEqual(['confirmModalMessage', 'extra', 'confirmModalActions']);
        document.getElementById('confirmModalConfirm').click();
        expect(onConfirm).toHaveBeenCalledWith(body);
    });

    it('Tab cycles into the body controls and stays trapped in the dialog', () => {
        const body = document.createElement('div');
        const box = document.createElement('input');
        box.type = 'checkbox';
        body.appendChild(box);
        showConfirmModal({ message: 'Sure?', body: body });
        const cancel = document.getElementById('confirmModalCancel');
        const confirm = document.getElementById('confirmModalConfirm');
        expect(document.activeElement).toBe(cancel);
        const tab = (shift) => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: !!shift, bubbles: true }));
        tab();
        expect(document.activeElement).toBe(confirm);
        tab();
        expect(document.activeElement).toBe(box);
        tab(true);
        expect(document.activeElement).toBe(confirm);
    });

    it('callers without a body keep the two-button modal unchanged', () => {
        const onConfirm = vi.fn();
        showConfirmModal({ message: 'Sure?', onConfirm: onConfirm });
        const dialog = document.getElementById('confirmModal');
        expect(dialog.children.length).toBe(2);
        document.getElementById('confirmModalConfirm').click();
        expect(onConfirm).toHaveBeenCalledWith(null);
    });
});

describe('target Delete confirm — offboard option', () => {
    async function openConfirm() {
        showInjectSettingsModal();
        await flush();
        const trash = document.querySelector('[aria-label="Delete target game"]');
        expect(trash).not.toBeNull();
        trash.click();
        return {
            main: document.getElementById('injectOffboardCheck'),
            purge: document.getElementById('injectOffboardPurge'),
            force: document.getElementById('injectOffboardForce'),
            subs: document.querySelector('.injectOffboardSubs'),
            confirm: document.getElementById('confirmModalConfirm'),
        };
    }

    function check(input, on) {
        input.checked = on;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    it('starts unchecked with the sub-options hidden and a plain Delete label', async () => {
        const c = await openConfirm();
        expect(c.main.checked).toBe(false);
        expect(c.subs.hidden).toBe(true);
        expect(c.confirm.textContent).toBe('Delete');
    });

    it('checking reveals purge / force and relabels; unchecking hides and clears them', async () => {
        const c = await openConfirm();
        check(c.main, true);
        expect(c.subs.hidden).toBe(false);
        expect(c.confirm.textContent).toBe('Delete + offboard');
        check(c.purge, true);
        check(c.force, true);
        check(c.main, false);
        expect(c.subs.hidden).toBe(true);
        expect(c.purge.checked).toBe(false);
        expect(c.force.checked).toBe(false);
        expect(c.confirm.textContent).toBe('Delete');
    });

    it('unchecked: deletes without dispatching an offboard', async () => {
        const c = await openConfirm();
        c.confirm.click();
        await flush();
        expect(offboardBodies()).toHaveLength(0);
        expect(deleteEq).toHaveBeenCalledWith('id', 't1');
        expect(document.getElementById('injectToast').textContent).toBe('Target deleted');
    });

    it('checked: dispatches the offboard first, then deletes', async () => {
        const c = await openConfirm();
        check(c.main, true);
        check(c.purge, true);
        c.confirm.click();
        await flush();
        expect(offboardBodies()).toEqual([
            { offboard: true, target_repo: 'owner/game', purge: true, force: false },
        ]);
        expect(deleteEq).toHaveBeenCalledWith('id', 't1');
        expect(document.getElementById('injectToast').textContent).toBe('Target deleted · offboard dispatched');
    });

    it('checked but the offboard fails: toasts the reason and leaves the target in place', async () => {
        offboardReply = { ok: false, status: 500, body: { ok: false, error: 'boom' } };
        const c = await openConfirm();
        check(c.main, true);
        c.confirm.click();
        await flush();
        expect(offboardBodies()).toHaveLength(1);
        expect(deleteEq).not.toHaveBeenCalled();
        const toast = document.getElementById('injectToast');
        expect(toast.classList.contains('injectToast--error')).toBe(true);
    });
});
