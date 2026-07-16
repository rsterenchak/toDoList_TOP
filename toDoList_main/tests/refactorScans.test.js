import { describe, it, expect, beforeEach, vi } from 'vitest';

// Runtime tests for the refactor_scans data-model functions in listLogic.js —
// loadLatestRefactorScan / saveRefactorScan / dismissRefactorCandidate — driven
// through a controllable fake Supabase client. The `refactor_scans` table is
// keyed on user_id directly (the inject_targets pattern), so these pins verify
// user_id is threaded onto every query and write, the upsert never writes
// `dismissed`, and dismiss appends non-destructively.

let sessionUser = { id: 'u1' };
let selectResult = { data: [], error: null };
let upsertResult = { data: null, error: null };
let updateResult = { data: null, error: null };

let capturedFilters = [];
let capturedOrder = null;
let capturedLimit = null;
let capturedSelectCols = undefined;
let capturedUpsert = null;
let capturedUpsertOpts = null;
let capturedUpdate = null;
let updateCalled = false;

function makeBuilder() {
    const builder = {
        _result: selectResult,
        select(cols) { capturedSelectCols = cols; this._result = selectResult; return this; },
        upsert(row, opts) { capturedUpsert = row; capturedUpsertOpts = opts; this._result = upsertResult; return this; },
        update(patch) { capturedUpdate = patch; updateCalled = true; this._result = updateResult; return this; },
        eq(col, val) { capturedFilters.push([col, val]); return this; },
        order(col, opts) { capturedOrder = [col, opts]; return this; },
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
        from: () => makeBuilder(),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

import { listLogic } from '../src/listLogic.js';

beforeEach(() => {
    sessionUser = { id: 'u1' };
    selectResult = { data: [], error: null };
    upsertResult = { data: null, error: null };
    updateResult = { data: null, error: null };
    capturedFilters = [];
    capturedOrder = null;
    capturedLimit = null;
    capturedSelectCols = undefined;
    capturedUpsert = null;
    capturedUpsertOpts = null;
    capturedUpdate = null;
    updateCalled = false;
});

describe('listLogic.loadLatestRefactorScan', () => {
    it('scopes the query to the user + repo, newest first, limit 1', async () => {
        const row = { repo: 'o/r', target_file: 'a.js', target_sha: 's1', candidates: [{ name: 'x' }], dismissed: [] };
        selectResult = { data: [row], error: null };
        const res = await listLogic.loadLatestRefactorScan('o/r');
        expect(res.ok).toBe(true);
        expect(res.row).toEqual(row);
        expect(capturedFilters).toContainEqual(['user_id', 'u1']);
        expect(capturedFilters).toContainEqual(['repo', 'o/r']);
        expect(capturedOrder).toEqual(['scanned_at', { ascending: false }]);
        expect(capturedLimit).toBe(1);
    });

    it('returns row:null when the repo has no stored scan', async () => {
        selectResult = { data: [], error: null };
        const res = await listLogic.loadLatestRefactorScan('o/r');
        expect(res.ok).toBe(true);
        expect(res.row).toBe(null);
    });

    it('surfaces a query error as ok:false', async () => {
        selectResult = { data: null, error: { message: 'boom' } };
        const res = await listLogic.loadLatestRefactorScan('o/r');
        expect(res.ok).toBe(false);
        expect(res.error).toBe('boom');
    });

    it('rejects a missing repo and a signed-out session', async () => {
        expect((await listLogic.loadLatestRefactorScan('')).ok).toBe(false);
        sessionUser = null;
        expect((await listLogic.loadLatestRefactorScan('o/r')).ok).toBe(false);
    });
});

describe('listLogic.saveRefactorScan', () => {
    it('upserts only the allowed fields + user_id + scanned_at, never dismissed', async () => {
        const res = await listLogic.saveRefactorScan({
            repo: 'o/r',
            target_file: 'a.js',
            target_sha: 's2',
            candidates: [{ name: 'x' }],
            dismissed: ['should-be-ignored'],
        });
        expect(res.ok).toBe(true);
        expect(capturedUpsert.user_id).toBe('u1');
        expect(capturedUpsert.repo).toBe('o/r');
        expect(capturedUpsert.target_file).toBe('a.js');
        expect(capturedUpsert.target_sha).toBe('s2');
        expect(capturedUpsert.candidates).toEqual([{ name: 'x' }]);
        expect(typeof capturedUpsert.scanned_at).toBe('string');
        expect('dismissed' in capturedUpsert).toBe(false);
        expect(capturedUpsertOpts).toEqual({ onConflict: 'user_id,repo,target_file' });
    });

    it('rejects a missing repo/file and surfaces an upsert error', async () => {
        expect((await listLogic.saveRefactorScan({ target_file: 'a.js' })).ok).toBe(false);
        upsertResult = { data: null, error: { message: 'dup' } };
        const res = await listLogic.saveRefactorScan({ repo: 'o/r', target_file: 'a.js' });
        expect(res.ok).toBe(false);
        expect(res.error).toBe('dup');
    });
});

describe('listLogic.dismissRefactorCandidate', () => {
    it('appends the name to the row dismissed array, scoped by user/repo/file', async () => {
        selectResult = { data: [{ dismissed: ['old'] }], error: null };
        const res = await listLogic.dismissRefactorCandidate('o/r', 'a.js', 'new');
        expect(res.ok).toBe(true);
        expect(capturedSelectCols).toBe('dismissed');
        expect(capturedUpdate).toEqual({ dismissed: ['old', 'new'] });
        expect(capturedFilters).toContainEqual(['user_id', 'u1']);
        expect(capturedFilters).toContainEqual(['repo', 'o/r']);
        expect(capturedFilters).toContainEqual(['target_file', 'a.js']);
    });

    it('is idempotent — a name already dismissed writes nothing', async () => {
        selectResult = { data: [{ dismissed: ['dup'] }], error: null };
        const res = await listLogic.dismissRefactorCandidate('o/r', 'a.js', 'dup');
        expect(res.ok).toBe(true);
        expect(updateCalled).toBe(false);
    });

    it('starts from an empty array when the row has no dismissed yet', async () => {
        selectResult = { data: [{}], error: null };
        const res = await listLogic.dismissRefactorCandidate('o/r', 'a.js', 'first');
        expect(res.ok).toBe(true);
        expect(capturedUpdate).toEqual({ dismissed: ['first'] });
    });

    it('rejects missing arguments', async () => {
        expect((await listLogic.dismissRefactorCandidate('', 'a.js', 'n')).ok).toBe(false);
        expect((await listLogic.dismissRefactorCandidate('o/r', '', 'n')).ok).toBe(false);
        expect((await listLogic.dismissRefactorCandidate('o/r', 'a.js', '')).ok).toBe(false);
    });
});
