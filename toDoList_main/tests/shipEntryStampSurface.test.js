import { describe, it, expect, beforeEach, vi } from 'vitest';

// Regression test for shipEntry.js surfacing a stamp failure instead of
// swallowing it. The dispatch path injects a drafted entry into TODO.md and
// then writes the entry id back onto the source todo via stampTodoEntryId. That
// write used to be `Promise.resolve(...).catch(function () {})`, which discarded
// both a rejection AND an ok:false result — the same silent-orphan failure the
// inject button had. Now a failed stamp raises the inject toast.
//
// inject.js and listLogic.js are mocked so the ship path runs without network
// or Supabase; the marker is made visible on the first read so the visibility
// poll doesn't sleep.

let stampResult;
let stampImpl;
const stampTodoEntryId = vi.fn(function (...a) {
    if (stampImpl) return stampImpl(...a);
    return stampResult;
});

const showInjectToast = vi.fn(function () {});
const injectEntry = vi.fn(function () { return Promise.resolve({ ok: true }); });
const dispatchRun = vi.fn(function () { return Promise.resolve({ ok: true }); });
const readTodoMdFromWorker = vi.fn(function (t) {
    // Echo back content already carrying the entry marker so the head-start
    // visibility poll resolves on the first attempt (no setTimeout sleeps).
    return Promise.resolve({ ok: true, content: 'x <!-- id: fixed-entry-id -->' });
});
const markEntryPresentLocally = vi.fn(function () {});
const refreshShippedMarkers = vi.fn(function () {});

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'fixed-entry-id',
    embedEntryMarker: (text, id) => String(text) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: (...a) => injectEntry(...a),
    dispatchRun: (...a) => dispatchRun(...a),
    readTodoMdFromWorker: (...a) => readTodoMdFromWorker(...a),
    markEntryPresentLocally: (...a) => markEntryPresentLocally(...a),
    refreshShippedMarkers: (...a) => refreshShippedMarkers(...a),
    showInjectToast: (...a) => showInjectToast(...a),
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        stampTodoEntryId: (...a) => stampTodoEntryId(...a),
    },
}));

import { shipEntryForTodo } from '../src/shipEntry.js';

const target = { repo: 'owner/name', file_path: 'TODO.md' };

function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('shipEntry — surfaces a stamp failure instead of swallowing it', () => {

    beforeEach(() => {
        stampResult = { ok: true };
        stampImpl = null;
        stampTodoEntryId.mockClear();
        showInjectToast.mockClear();
    });

    it('a successful stamp raises no toast', async () => {
        stampResult = { ok: true };
        const res = await shipEntryForTodo({ todoId: 'todo-1', entryText: 'Do it', target });
        await flush();
        expect(res.ok).toBe(true);
        expect(stampTodoEntryId).toHaveBeenCalledWith('todo-1', 'fixed-entry-id');
        expect(showInjectToast).not.toHaveBeenCalled();
    });

    it('an ok:false stamp raises a link-failure toast that does not read as a failed dispatch', async () => {
        stampResult = { ok: false, error: 'Todo not found.' };
        await shipEntryForTodo({ todoId: 'todo-1', entryText: 'Do it', target });
        await flush();
        expect(showInjectToast).toHaveBeenCalledTimes(1);
        const [msg, variant] = showInjectToast.mock.calls[0];
        expect(msg).toMatch(/link/i);
        expect(msg).not.toMatch(/^Run failed/);
        expect(variant).toBe('error');
    });

    it('a rejected stamp surfaces rather than resolving silently', async () => {
        stampImpl = () => Promise.reject(new Error('boom'));
        await shipEntryForTodo({ todoId: 'todo-1', entryText: 'Do it', target });
        await flush();
        expect(showInjectToast).toHaveBeenCalledTimes(1);
        expect(showInjectToast.mock.calls[0][0]).toMatch(/link/i);
    });
});
