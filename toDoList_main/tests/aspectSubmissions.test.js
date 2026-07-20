import { describe, it, expect, beforeEach, vi } from 'vitest';

// Runtime tests for the aspect_submissions data-model functions in listLogic.js
// — getAspectSubmissions / setAspectSubmitted — driven through a controllable
// fake Supabase client. The `aspect_submissions` table is RLS-scoped to the
// user's projects via the project-ownership sub-select (no user_id column, like
// agent_queue/todos), so these pins verify the queries filter on project_id
// only, row-presence encodes committed (upsert to commit, delete to un-commit),
// and both degrade gracefully (empty Set / ok:false) on failure.

let selectResult = { data: [], error: null };
let upsertResult = { data: null, error: null };
let deleteResult = { data: [], error: null };

let capturedTable = null;
let capturedSelectCols = undefined;
let capturedFilters = [];
let capturedUpsert = null;
let capturedUpsertOpts = null;
let deleteCalled = false;

function makeBuilder(table) {
    const builder = {
        _result: selectResult,
        select(cols) { capturedSelectCols = cols; this._result = selectResult; return this; },
        upsert(row, opts) { capturedUpsert = row; capturedUpsertOpts = opts; this._result = upsertResult; return this; },
        delete() { deleteCalled = true; this._result = deleteResult; return this; },
        eq(col, val) { capturedFilters.push([col, val]); return this; },
        then(resolve, reject) { return Promise.resolve(this._result).then(resolve, reject); },
    };
    return builder;
}

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        auth: {
            getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null }),
        },
        from: (table) => { capturedTable = table; return makeBuilder(table); },
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

import { listLogic } from '../src/listLogic.js';

beforeEach(() => {
    selectResult = { data: [], error: null };
    upsertResult = { data: null, error: null };
    deleteResult = { data: [], error: null };
    capturedTable = null;
    capturedSelectCols = undefined;
    capturedFilters = [];
    capturedUpsert = null;
    capturedUpsertOpts = null;
    deleteCalled = false;
});

describe('listLogic.getAspectSubmissions', () => {
    it('returns a Set of committed aspect IDs, scoped to project_id', async () => {
        selectResult = { data: [{ aspect: 'A1' }, { aspect: 'B2' }], error: null };
        const set = await listLogic.getAspectSubmissions('proj-1');
        expect(set instanceof Set).toBe(true);
        expect(Array.from(set).sort()).toEqual(['A1', 'B2']);
        expect(capturedTable).toBe('aspect_submissions');
        expect(capturedSelectCols).toBe('aspect');
        expect(capturedFilters).toEqual([['project_id', 'proj-1']]);
    });

    it('trims and drops blank/non-string aspect values', async () => {
        selectResult = { data: [{ aspect: '  A1  ' }, { aspect: '' }, { aspect: null }, {}], error: null };
        const set = await listLogic.getAspectSubmissions('proj-1');
        expect(Array.from(set)).toEqual(['A1']);
    });

    it('returns an empty Set for a missing project id', async () => {
        const set = await listLogic.getAspectSubmissions('');
        expect(set instanceof Set).toBe(true);
        expect(set.size).toBe(0);
        // No query was issued.
        expect(capturedTable).toBe(null);
    });

    it('returns an empty Set (never throws) on a query error', async () => {
        selectResult = { data: null, error: { message: 'boom' } };
        const set = await listLogic.getAspectSubmissions('proj-1');
        expect(set instanceof Set).toBe(true);
        expect(set.size).toBe(0);
    });
});

describe('listLogic.setAspectSubmitted', () => {
    it('upserts the (project_id, aspect) row when committing', async () => {
        const res = await listLogic.setAspectSubmitted('proj-1', 'A1', true);
        expect(res).toEqual({ ok: true });
        expect(capturedTable).toBe('aspect_submissions');
        expect(capturedUpsert).toEqual({ project_id: 'proj-1', aspect: 'A1' });
        expect(capturedUpsertOpts).toEqual({ onConflict: 'project_id,aspect' });
        expect(deleteCalled).toBe(false);
    });

    it('deletes the row, scoped by project + aspect, when un-committing', async () => {
        const res = await listLogic.setAspectSubmitted('proj-1', 'A1', false);
        expect(res).toEqual({ ok: true });
        expect(deleteCalled).toBe(true);
        expect(capturedUpsert).toBe(null);
        expect(capturedFilters).toContainEqual(['project_id', 'proj-1']);
        expect(capturedFilters).toContainEqual(['aspect', 'A1']);
    });

    it('trims the aspect before writing', async () => {
        await listLogic.setAspectSubmitted('proj-1', '  A1 ', true);
        expect(capturedUpsert).toEqual({ project_id: 'proj-1', aspect: 'A1' });
    });

    it('rejects a missing project or aspect without querying', async () => {
        expect((await listLogic.setAspectSubmitted('', 'A1', true)).ok).toBe(false);
        expect((await listLogic.setAspectSubmitted('proj-1', '', true)).ok).toBe(false);
        expect((await listLogic.setAspectSubmitted('proj-1', '   ', true)).ok).toBe(false);
        expect(capturedTable).toBe(null);
    });

    it('surfaces an upsert error as ok:false with the message', async () => {
        upsertResult = { data: null, error: { message: 'nope' } };
        const res = await listLogic.setAspectSubmitted('proj-1', 'A1', true);
        expect(res.ok).toBe(false);
        expect(res.error).toBe('nope');
    });

    it('surfaces a delete error as ok:false', async () => {
        deleteResult = { data: null, error: { message: 'del-fail' } };
        const res = await listLogic.setAspectSubmitted('proj-1', 'A1', false);
        expect(res.ok).toBe(false);
        expect(res.error).toBe('del-fail');
    });
});
