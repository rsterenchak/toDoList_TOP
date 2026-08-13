import { describe, it, expect, beforeEach, vi } from 'vitest';

// Runtime tests for listLogic.markComplexityHotspotPushed — the write behind the
// Code lens's tighten / relax dial push, which retires a hotspot once its entry
// has shipped. Driven through the same controllable fake Supabase client the
// refactor_scans pins use. `complexity_scans` is keyed on `user_id` directly (the
// inject_targets pattern, NOT the todos table), so these pins verify `user_id`
// rides on both the read and the write, that the row is scoped by `file_path`,
// and that the append is non-destructive and idempotent.

let sessionUser = { id: 'u1' };
let selectResult = { data: [], error: null };
let updateResult = { data: null, error: null };

let capturedFilters = [];
let capturedLimit = null;
let capturedSelectCols;
let capturedUpdate = null;
let capturedTables = [];
let updateCalled = false;

function makeBuilder() {
    const builder = {
        _result: selectResult,
        select(cols) { capturedSelectCols = cols; this._result = selectResult; return this; },
        update(patch) { capturedUpdate = patch; updateCalled = true; this._result = updateResult; return this; },
        eq(col, val) { capturedFilters.push([col, val]); return this; },
        order() { return this; },
        limit(n) { capturedLimit = n; return this; },
        then(resolve, reject) { return Promise.resolve(this._result).then(resolve, reject); },
    };
    return builder;
}

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        auth: {
            getSession: () => Promise.resolve({
                data: { session: sessionUser ? { user: sessionUser } : null },
                error: null,
            }),
        },
        from: (table) => { capturedTables.push(table); return makeBuilder(); },
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

import { listLogic } from '../src/listLogic.js';

beforeEach(() => {
    sessionUser = { id: 'u1' };
    selectResult = { data: [], error: null };
    updateResult = { data: null, error: null };
    capturedFilters = [];
    capturedLimit = null;
    capturedSelectCols = undefined;
    capturedUpdate = null;
    capturedTables = [];
    updateCalled = false;
});

describe('listLogic.markComplexityHotspotPushed', () => {
    it('appends the name to the row pushed array, scoped by user/repo/file_path', async () => {
        selectResult = { data: [{ pushed: ['old'] }], error: null };
        const res = await listLogic.markComplexityHotspotPushed('o/r', 'src/a.js', 'computeStreak');
        expect(res.ok).toBe(true);
        expect(capturedTables).toEqual(['complexity_scans', 'complexity_scans']);
        expect(capturedSelectCols).toBe('pushed');
        expect(capturedLimit).toBe(1);
        expect(capturedUpdate).toEqual({ pushed: ['old', 'computeStreak'] });
        expect(capturedFilters).toContainEqual(['user_id', 'u1']);
        expect(capturedFilters).toContainEqual(['repo', 'o/r']);
        expect(capturedFilters).toContainEqual(['file_path', 'src/a.js']);
        // user_id is threaded onto BOTH the read and the write, not just the read.
        expect(capturedFilters.filter(function (f) { return f[0] === 'user_id'; })).toHaveLength(2);
    });

    it('is idempotent — a hotspot already pushed writes nothing', async () => {
        selectResult = { data: [{ pushed: ['dup'] }], error: null };
        const res = await listLogic.markComplexityHotspotPushed('o/r', 'src/a.js', 'dup');
        expect(res.ok).toBe(true);
        expect(updateCalled).toBe(false);
    });

    it('starts from an empty array when the row has no pushed yet', async () => {
        selectResult = { data: [{}], error: null };
        const res = await listLogic.markComplexityHotspotPushed('o/r', 'src/a.js', 'first');
        expect(res.ok).toBe(true);
        expect(capturedUpdate).toEqual({ pushed: ['first'] });
    });

    it('surfaces a read error and a write error as ok:false', async () => {
        selectResult = { data: null, error: { message: 'read boom' } };
        const read = await listLogic.markComplexityHotspotPushed('o/r', 'src/a.js', 'n');
        expect(read.ok).toBe(false);
        expect(read.error).toBe('read boom');
        expect(updateCalled).toBe(false);

        selectResult = { data: [{ pushed: [] }], error: null };
        updateResult = { data: null, error: { message: 'write boom' } };
        const write = await listLogic.markComplexityHotspotPushed('o/r', 'src/a.js', 'n');
        expect(write.ok).toBe(false);
        expect(write.error).toBe('write boom');
    });

    it('rejects missing arguments and a signed-out session', async () => {
        expect((await listLogic.markComplexityHotspotPushed('', 'src/a.js', 'n')).ok).toBe(false);
        expect((await listLogic.markComplexityHotspotPushed('o/r', '', 'n')).ok).toBe(false);
        expect((await listLogic.markComplexityHotspotPushed('o/r', 'src/a.js', '')).ok).toBe(false);
        sessionUser = null;
        expect((await listLogic.markComplexityHotspotPushed('o/r', 'src/a.js', 'n')).ok).toBe(false);
    });
});
