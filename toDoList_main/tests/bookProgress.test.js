import { vi } from 'vitest';

// bookProgress.js: the Understanding reader's position, written locally on every
// change and upserted to Supabase's `book_progress` on a 2s debounce — the newer
// `updatedAt` winning when the two are merged, and no Supabase call at all while
// signed out.

const mocks = vi.hoisted(() => ({ session: null, upsert: null, rows: [] }));

vi.mock('../src/supabaseClient.js', () => {
    return {
        supabase: {
            auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: mocks.session } })) },
            from: vi.fn(() => ({
                upsert: mocks.upsert,
                select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: mocks.rows, error: null })) })),
            })),
        },
    };
});

import {
    recordProgress,
    flushProgress,
    mergeProgress,
    loadProgress,
    resetBookProgress,
    BOOK_PROGRESS_DEBOUNCE_MS,
} from '../src/bookProgress.js';
import { getBookProgress, setBookProgress, BOOK_PROGRESS_KEY } from '../src/prefs.js';
import { supabase } from '../src/supabaseClient.js';

beforeEach(() => {
    localStorage.clear();
    mocks.session = null;
    mocks.rows = [];
    mocks.upsert = vi.fn(() => Promise.resolve({ error: null }));
    vi.clearAllMocks();
});

afterEach(() => {
    resetBookProgress();
    vi.useRealTimers();
});

describe('local write', () => {
    test('every paragraph change is written to todoapp_bookProgress keyed by repo', () => {
        recordProgress('owner/repo', { chapterId: 'data', paraIndex: 1, pct: 0.25 });
        expect(getBookProgress('owner/repo')).toMatchObject({ chapterId: 'data', paraIndex: 1, pct: 0.25 });
        recordProgress('owner/repo', { chapterId: 'data', paraIndex: 2, pct: 0.5 });
        const store = JSON.parse(localStorage.getItem(BOOK_PROGRESS_KEY));
        expect(store['owner/repo']).toMatchObject({ chapterId: 'data', paraIndex: 2, pct: 0.5 });
        expect(typeof store['owner/repo'].updatedAt).toBe('string');
    });

    test('a malformed stored value reads as no record', () => {
        localStorage.setItem(BOOK_PROGRESS_KEY, JSON.stringify({ 'owner/repo': { paraIndex: 3 } }));
        expect(getBookProgress('owner/repo')).toBeNull();
    });
});

describe('merge rule', () => {
    const older = { chapterId: 'a', paraIndex: 0, pct: 0, updatedAt: '2026-10-01T00:00:00.000Z' };
    const newer = { chapterId: 'b', paraIndex: 1, pct: 0.5, updatedAt: '2026-10-02T00:00:00.000Z' };

    test('the newest updatedAt wins', () => {
        expect(mergeProgress(older, newer)).toBe(newer);
        expect(mergeProgress(newer, older)).toBe(newer);
    });

    test('local wins a tie', () => {
        const tie = Object.assign({}, newer, { chapterId: 'c' });
        expect(mergeProgress(newer, tie)).toBe(newer);
    });

    test('either side may be missing', () => {
        expect(mergeProgress(null, newer)).toBe(newer);
        expect(mergeProgress(older, null)).toBe(older);
        expect(mergeProgress(null, null)).toBeNull();
    });
});

describe('debounced upsert', () => {
    test('signed in: one upsert of the latest record after the debounce', async () => {
        vi.useFakeTimers();
        mocks.session = { user: { id: 'user-1' } };
        recordProgress('owner/repo', { chapterId: 'data', paraIndex: 1, pct: 0.25 });
        const last = recordProgress('owner/repo', { chapterId: 'data', paraIndex: 2, pct: 0.5 });
        await vi.advanceTimersByTimeAsync(BOOK_PROGRESS_DEBOUNCE_MS - 1);
        expect(mocks.upsert).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(supabase.from).toHaveBeenCalledWith('book_progress');
        expect(mocks.upsert).toHaveBeenCalledTimes(1);
        expect(mocks.upsert).toHaveBeenCalledWith({
            user_id: 'user-1',
            repo: 'owner/repo',
            chapter_id: 'data',
            para_index: 2,
            pct: 0.5,
            updated_at: last.updatedAt,
        }, { onConflict: 'user_id,repo' });
    });

    test('flushProgress sends the pending record at once (reader exit)', async () => {
        mocks.session = { user: { id: 'user-1' } };
        recordProgress('owner/repo', { chapterId: 'data', paraIndex: 1, pct: 0.25 });
        await flushProgress();
        expect(mocks.upsert).toHaveBeenCalledTimes(1);
        await flushProgress();
        expect(mocks.upsert).toHaveBeenCalledTimes(1);
    });

    test('signed out: no upsert, the local record alone stands', async () => {
        recordProgress('owner/repo', { chapterId: 'data', paraIndex: 1, pct: 0.25 });
        const res = await flushProgress();
        expect(res.skipped).toBe(true);
        expect(supabase.from).not.toHaveBeenCalled();
        expect(getBookProgress('owner/repo').chapterId).toBe('data');
    });

    test('a failing Supabase call never throws', async () => {
        mocks.session = { user: { id: 'user-1' } };
        mocks.upsert = vi.fn(() => { throw new Error('offline'); });
        recordProgress('owner/repo', { chapterId: 'data', paraIndex: 1, pct: 0.25 });
        await expect(flushProgress()).resolves.toMatchObject({ ok: false });
    });
});

describe('loadProgress', () => {
    test('a newer remote row wins and is copied locally', async () => {
        mocks.session = { user: { id: 'user-1' } };
        setBookProgress('owner/repo', { chapterId: 'a', paraIndex: 0, pct: 0, updatedAt: '2026-10-01T00:00:00.000Z' });
        mocks.rows = [{ user_id: 'user-1', repo: 'owner/repo', chapter_id: 'b', para_index: 2, pct: 0.5, updated_at: '2026-10-02T00:00:00.000Z' }];
        const rec = await loadProgress('owner/repo');
        expect(rec).toMatchObject({ chapterId: 'b', paraIndex: 2, pct: 0.5 });
        expect(getBookProgress('owner/repo').chapterId).toBe('b');
    });

    test('signed out it resolves to the local record without a query', async () => {
        setBookProgress('owner/repo', { chapterId: 'a', paraIndex: 1, pct: 0.2, updatedAt: '2026-10-01T00:00:00.000Z' });
        const rec = await loadProgress('owner/repo');
        expect(rec.chapterId).toBe('a');
        expect(supabase.from).not.toHaveBeenCalled();
    });
});
