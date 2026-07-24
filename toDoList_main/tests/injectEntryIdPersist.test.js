import { vi } from 'vitest';
import { toDo } from '../src/toDo.js';
import { initInjectConfig, makeInjectButton } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

// Regression tests for the inject-button entry-id persistence bug: the Inject
// button minted `item.entryId` and wrote it to localStorage via saveToStorage()
// but never persisted it to the `todos.entry_id` Supabase column, so a task
// injected on one device was orphaned from its entry on every other device.
// The fix routes the persistence through listLogic.stampTodoEntryId, mirroring
// the Agent dispatch path. These tests exercise the click handler end-to-end
// with the Worker fetch mocked and the stamp spied.

describe('inject button — persists entry id to Supabase via stampTodoEntryId', () => {

    let fetchSpy;
    let realFetch;
    let stampSpy;

    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();

        realFetch = globalThis.fetch;
        fetchSpy = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({}),
        }));
        globalThis.fetch = fetchSpy;

        stampSpy = vi.spyOn(listLogic, 'stampTodoEntryId');
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        stampSpy.mockRestore();
        // Clear any toast left mounted by a prior assertion.
        const toast = document.getElementById('injectToast');
        if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
        localStorage.clear();
    });

    function clickReady(btn) {
        // Bypass the state machine so the click hits the POST branch even
        // without a configured project target, then flush the awaited chain.
        btn.dataset.state = 'ready';
        btn.disabled = false;
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    it('a successful inject calls stampTodoEntryId with the item id and the minted entry id', async () => {
        stampSpy.mockReturnValue({ ok: true });
        const item = toDo('Persist id', 'A description', '5-27-2026', null, 0);
        item.id = 'todo-persist-1';

        const btn = makeInjectButton(item, {});
        await clickReady(btn);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(item.entryId).toBeTruthy();
        expect(stampSpy).toHaveBeenCalledTimes(1);
        expect(stampSpy).toHaveBeenCalledWith('todo-persist-1', item.entryId);

        // A clean link reports plain success, not the link-failure warning.
        const toast = document.getElementById('injectToast');
        expect(toast).toBeTruthy();
        expect(toast.textContent).toBe('Injected to TODO.md');
        expect(toast.classList.contains('injectToast--ok')).toBe(true);
    });

    it('a failed inject (Worker POST rejects) never issues a stampTodoEntryId call', async () => {
        stampSpy.mockReturnValue({ ok: true });
        // Worker returns a 500 so postToWorker throws before the stamp.
        fetchSpy.mockImplementation(() => Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({}),
        }));
        const item = toDo('No stamp on fail', 'A description', '5-27-2026', null, 0);
        item.id = 'todo-persist-2';

        const btn = makeInjectButton(item, {});
        await clickReady(btn);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(stampSpy).not.toHaveBeenCalled();

        const toast = document.getElementById('injectToast');
        expect(toast).toBeTruthy();
        expect(toast.textContent).toMatch(/^Inject failed/);
        expect(toast.classList.contains('injectToast--error')).toBe(true);
    });

    it('a stamp that reports ok:false surfaces a link-failure toast that does not read as a failed inject', async () => {
        stampSpy.mockReturnValue({ ok: false, error: 'Todo not found.' });
        const item = toDo('Link failed', 'A description', '5-27-2026', null, 0);
        item.id = 'todo-persist-3';

        const btn = makeInjectButton(item, {});
        await clickReady(btn);

        expect(stampSpy).toHaveBeenCalledTimes(1);
        const toast = document.getElementById('injectToast');
        expect(toast).toBeTruthy();
        // The entry landed; only the link failed — the message must say so and
        // must not read as a failed inject.
        expect(toast.textContent).toContain('Injected to TODO.md');
        expect(toast.textContent).toMatch(/link/i);
        expect(toast.textContent).not.toMatch(/^Inject failed/);
    });

    it('a stamp that rejects surfaces rather than resolving silently', async () => {
        stampSpy.mockImplementation(() => Promise.reject(new Error('boom')));
        const item = toDo('Link rejected', 'A description', '5-27-2026', null, 0);
        item.id = 'todo-persist-4';

        const btn = makeInjectButton(item, {});
        await clickReady(btn);

        expect(stampSpy).toHaveBeenCalledTimes(1);
        const toast = document.getElementById('injectToast');
        expect(toast).toBeTruthy();
        expect(toast.textContent).toContain('Injected to TODO.md');
        expect(toast.textContent).toMatch(/link/i);
    });
});
