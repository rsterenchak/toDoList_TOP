import { vi } from 'vitest';

// bookBookmarks.js: bookmarked paragraphs in the Understanding reader — the label
// a bookmark keeps, the local copy that works signed out, the merge with
// Supabase's `book_bookmarks` rows, and how a bookmark anchors to a regenerated
// book whose chapter or paragraph has gone.

const mocks = vi.hoisted(() => ({ session: null, rows: [], insert: null, deletes: [], deleteError: null }));

vi.mock('../src/supabaseClient.js', () => {
    function deleteChain() {
        const filters = {};
        const chain = {
            eq: vi.fn((col, val) => { filters[col] = val; return chain; }),
            then: (resolve) => { mocks.deletes.push(filters); resolve({ error: mocks.deleteError }); },
        };
        return chain;
    }
    return {
        supabase: {
            auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: mocks.session } })) },
            from: vi.fn(() => ({
                insert: mocks.insert,
                delete: vi.fn(deleteChain),
                select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: mocks.rows, error: null })) })),
            })),
        },
    };
});

import {
    bookmarkLabel,
    toggleBookmark,
    listBookmarks,
    isBookmarked,
    mergeBookmarks,
    loadBookmarks,
    removeBookmark,
    anchorBookmarks,
} from '../src/bookBookmarks.js';
import { getBookBookmarks, setBookBookmarks, BOOK_BOOKMARKS_KEY } from '../src/prefs.js';
import { supabase } from '../src/supabaseClient.js';

const REPO = 'owner/repo';

beforeEach(() => {
    localStorage.clear();
    mocks.session = null;
    mocks.rows = [];
    mocks.deletes = [];
    mocks.deleteError = null;
    mocks.insert = vi.fn(() => Promise.resolve({ error: null }));
    vi.clearAllMocks();
});

describe('label', () => {
    test('a short paragraph is its whole text, ref chips flattened to their labels', () => {
        const segs = [{ t: 'Everything begins in ' }, { ref: { label: 'bootApp', file: 'index.js' } }, { t: '  when it loads.' }];
        expect(bookmarkLabel(segs)).toBe('Everything begins in bootApp when it loads.');
    });

    test('a long paragraph is cut at a word boundary within 60 characters, with an ellipsis', () => {
        const segs = [
            { t: 'The worker in ' },
            { ref: { label: 'serviceWorkerRegistration', file: 'sw.js' } },
            { t: ' caches every hashed bundle so the next load is instant.' },
        ];
        const label = bookmarkLabel(segs);
        expect(label).toBe('The worker in serviceWorkerRegistration caches every hashed…');
        expect(label.length - 1).toBeLessThanOrEqual(60);
    });

    test('a cut that lands on a space keeps the whole last word', () => {
        const text = 'a'.repeat(59) + 'b ' + 'tail words here';
        expect(bookmarkLabel([{ t: text }])).toBe('a'.repeat(59) + 'b…');
    });

    test('a ref with no label falls back to its symbol, then its file', () => {
        expect(bookmarkLabel([{ ref: { symbol: 'loadBook', file: 'codeBook.js' } }, { t: ' and ' }, { ref: { file: 'sw.js' } }]))
            .toBe('loadBook and sw.js');
    });
});

describe('local write', () => {
    test('marking writes the record to todoapp_bookBookmarks keyed by repo, unmarking removes it', async () => {
        const res = toggleBookmark(REPO, 'data', 2, [{ t: 'Data two.' }]);
        expect(res.marked).toBe(true);
        await res.sync;
        const store = JSON.parse(localStorage.getItem(BOOK_BOOKMARKS_KEY));
        expect(store[REPO]).toHaveLength(1);
        expect(store[REPO][0]).toMatchObject({ repo: REPO, chapterId: 'data', paraIndex: 2, label: 'Data two.' });
        expect(typeof store[REPO][0].createdAt).toBe('string');
        expect(isBookmarked(REPO, 'data', 2)).toBe(true);

        expect(toggleBookmark(REPO, 'data', 2, null).marked).toBe(false);
        expect(isBookmarked(REPO, 'data', 2)).toBe(false);
        expect(localStorage.getItem(BOOK_BOOKMARKS_KEY)).toBe('{}');
    });

    test('signed out, no Supabase call is made', async () => {
        await toggleBookmark(REPO, 'data', 0, [{ t: 'x' }]).sync;
        await loadBookmarks(REPO);
        expect(supabase.from).not.toHaveBeenCalled();
        expect(listBookmarks(REPO)).toHaveLength(1);
    });

    test('signed in, a mark is inserted and flagged synced', async () => {
        mocks.session = { user: { id: 'user-1' } };
        await toggleBookmark(REPO, 'data', 1, [{ t: 'Data two.' }]).sync;
        expect(supabase.from).toHaveBeenCalledWith('book_bookmarks');
        expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
            user_id: 'user-1', repo: REPO, chapter_id: 'data', para_index: 1, label: 'Data two.',
        }));
        expect(getBookBookmarks(REPO)[0].synced).toBe(true);
    });

    test('a failing insert never throws and leaves the mark local, unsynced', async () => {
        mocks.session = { user: { id: 'user-1' } };
        mocks.insert = vi.fn(() => { throw new Error('offline'); });
        const res = toggleBookmark(REPO, 'data', 1, [{ t: 'x' }]);
        await expect(res.sync).resolves.toBeUndefined();
        expect(listBookmarks(REPO)).toHaveLength(1);
        expect(getBookBookmarks(REPO)[0].synced).toBeUndefined();
    });

    test('unmarking a synced bookmark deletes its row; a failed delete keeps it pending', async () => {
        mocks.session = { user: { id: 'user-1' } };
        await toggleBookmark(REPO, 'data', 1, [{ t: 'x' }]).sync;
        mocks.deleteError = { message: 'offline' };
        await toggleBookmark(REPO, 'data', 1, null).sync;
        expect(mocks.deletes[0]).toEqual({ user_id: 'user-1', repo: REPO, chapter_id: 'data', para_index: 1 });
        expect(listBookmarks(REPO)).toHaveLength(0);
        expect(getBookBookmarks(REPO)[0]).toMatchObject({ deleted: true });

        mocks.deleteError = null;
        mocks.rows = [{ user_id: 'user-1', repo: REPO, chapter_id: 'data', para_index: 1, label: 'x', created_at: '2026-10-01T00:00:00.000Z' }];
        await loadBookmarks(REPO);
        expect(mocks.deletes).toHaveLength(2);
        expect(getBookBookmarks(REPO)).toEqual([]);
    });
});

describe('merge rule', () => {
    const rec = (chapterId, paraIndex, extra) => Object.assign(
        { repo: REPO, chapterId, paraIndex, label: chapterId + paraIndex, createdAt: '2026-10-0' + (paraIndex + 1) + 'T00:00:00.000Z' },
        extra
    );

    test('union of both sides, with Supabase winning for rows on both', () => {
        const local = [rec('a', 0, { synced: true, label: 'old label' })];
        const remote = [rec('a', 0, { label: 'remote label' }), rec('b', 1)];
        const { list, insert, remove } = mergeBookmarks(local, remote);
        expect(list.map((b) => b.chapterId + b.paraIndex)).toEqual(['a0', 'b1']);
        expect(list[0].label).toBe('remote label');
        expect(list.every((b) => b.synced)).toBe(true);
        expect(insert).toEqual([]);
        expect(remove).toEqual([]);
    });

    test('a locally-added row missing remotely is kept and retried', () => {
        const local = [rec('a', 0)];
        const { list, insert } = mergeBookmarks(local, []);
        expect(list).toHaveLength(1);
        expect(insert).toEqual([local[0]]);
    });

    test('a synced row missing remotely was deleted elsewhere and is dropped', () => {
        const { list, insert } = mergeBookmarks([rec('a', 0, { synced: true })], []);
        expect(list).toEqual([]);
        expect(insert).toEqual([]);
    });

    test('loadBookmarks retries the unsynced insert and stores the merged list', async () => {
        mocks.session = { user: { id: 'user-1' } };
        setBookBookmarks(REPO, [rec('a', 0)]);
        mocks.rows = [{ user_id: 'user-1', repo: REPO, chapter_id: 'b', para_index: 3, label: 'remote', created_at: '2026-10-09T00:00:00.000Z' }];
        const list = await loadBookmarks(REPO);
        expect(mocks.insert).toHaveBeenCalledTimes(1);
        expect(list.map((b) => b.chapterId)).toEqual(['a', 'b']);
        expect(getBookBookmarks(REPO).every((b) => b.synced)).toBe(true);
    });
});

describe('anchoring', () => {
    const BOOK = {
        chapters: [
            { id: 'one', title: 'One', paragraphs: [[{ t: 'p0' }], [{ t: 'p1' }]] },
            { id: 'two', title: 'Two', paragraphs: [[{ t: 'q0' }], [{ t: 'q1' }], [{ t: 'q2' }]] },
        ],
    };
    const mk = (chapterId, paraIndex) => ({ repo: REPO, chapterId, paraIndex, label: chapterId + paraIndex, createdAt: '' });

    test('groups in book order with paragraphs in order', () => {
        const { groups, removed } = anchorBookmarks(BOOK, [mk('two', 2), mk('one', 1), mk('two', 0)]);
        expect(removed).toEqual([]);
        expect(groups.map((g) => g.index)).toEqual([0, 1]);
        expect(groups[1].items.map((i) => i.paraIndex)).toEqual([0, 2]);
    });

    test('a bookmark whose chapter is gone lands in removed, never dropped', () => {
        const gone = mk('gone', 0);
        const { groups, removed } = anchorBookmarks(BOOK, [gone, mk('one', 0)]);
        expect(removed).toEqual([gone]);
        expect(groups).toHaveLength(1);
    });

    test('a paragraph past the chapter end opens at the chapter top and keeps its label', () => {
        const { groups } = anchorBookmarks(BOOK, [mk('one', 7)]);
        expect(groups[0].items[0]).toMatchObject({ paraIndex: 0, inRange: false });
        expect(groups[0].items[0].bookmark.label).toBe('one7');
    });

    test('removeBookmark deletes a removed-chapter bookmark', async () => {
        setBookBookmarks(REPO, [mk('gone', 0)]);
        await removeBookmark(REPO, 'gone', 0);
        expect(listBookmarks(REPO)).toEqual([]);
    });
});
