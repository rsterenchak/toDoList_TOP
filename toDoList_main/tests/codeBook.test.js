import { vi } from 'vitest';

// codeBook.js loads a repo's src-book.json once per session (failing soft to
// null) and answers the shelf's questions: chapter count, reading minutes, and
// how many chapters are stale.

vi.mock('../src/structureRemoteCapture.js', () => ({
    pagesUrlFor: vi.fn(function (repo) {
        const parts = String(repo || '').split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
        return 'https://' + parts[0] + '.github.io/' + parts[1] + '/';
    }),
}));

import { loadBook, revalidateBook, isBookCached, resetBookCache, bookStats } from '../src/codeBook.js';

const BOOK = {
    version: 1,
    title: 'Understanding Void',
    chapters: [
        { id: 'one', index: 1, title: 'One', minutes: 4, stale: false },
        { id: 'two', index: 2, title: 'Two', minutes: 6, stale: true },
        { id: 'three', index: 3, title: 'Three', minutes: 3, stale: false },
    ],
};

afterEach(() => {
    resetBookCache();
    vi.unstubAllGlobals();
});

describe('loadBook', () => {
    test('fetches src-book.json from the repo Pages URL once per repo', async () => {
        const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(BOOK) }));
        vi.stubGlobal('fetch', fetchMock);
        const a = await loadBook('owner/repo');
        const b = await loadBook('owner/repo');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('https://owner.github.io/repo/src-book.json');
        expect(a.title).toBe('Understanding Void');
        expect(a.chapters).toHaveLength(3);
        expect(b).toBe(a);
    });

    test('resetBookCache forces a fresh fetch', async () => {
        const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(BOOK) }));
        vi.stubGlobal('fetch', fetchMock);
        await loadBook('owner/repo');
        resetBookCache();
        await loadBook('owner/repo');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('a 404 yields null', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
        await expect(loadBook('owner/repo')).resolves.toBeNull();
    });

    test('bad JSON yields null', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('bad')) })));
        await expect(loadBook('owner/repo')).resolves.toBeNull();
    });

    test('a network failure or a document without a chapters array yields null', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
        await expect(loadBook('owner/a')).resolves.toBeNull();
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ chapters: 'nope' }) })));
        await expect(loadBook('owner/b')).resolves.toBeNull();
    });

    test('an unresolvable repo yields null without fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(loadBook('not-a-repo')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('drops chapters without a string id', async () => {
        const doc = { title: 'T', chapters: [{ id: 'ok', minutes: 1 }, { id: 7 }, null, { title: 'no id' }, { id: '' }] };
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(doc) })));
        const book = await loadBook('owner/repo');
        expect(book.chapters.map((c) => c.id)).toEqual(['ok']);
    });
});

function res(doc, etag, status) {
    return {
        ok: !status || status === 200,
        status: status || 200,
        headers: { get: (name) => (name === 'ETag' ? etag || null : null) },
        json: () => Promise.resolve(doc),
    };
}

describe('revalidateBook', () => {
    const NEXT = { ...BOOK, chapters: BOOK.chapters.slice(0, 2) };

    test('a 304 on the stored ETag is unchanged and keeps the cached book', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(res(BOOK, 'W/"v1"'))
            .mockResolvedValueOnce(res(null, null, 304));
        vi.stubGlobal('fetch', fetchMock);
        const first = await loadBook('owner/repo');
        const out = await revalidateBook('owner/repo');
        expect(fetchMock.mock.calls[1][1]).toEqual({ cache: 'no-cache', headers: { 'If-None-Match': 'W/"v1"' } });
        expect(out).toEqual({ book: first, changed: false });
        expect(await loadBook('owner/repo')).toBe(first);
    });

    test('an identical body (no ETag) is unchanged by its hash', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(res(JSON.parse(JSON.stringify(BOOK)))));
        vi.stubGlobal('fetch', fetchMock);
        const first = await loadBook('owner/repo');
        const out = await revalidateBook('owner/repo');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][1]).toEqual({ cache: 'no-cache' });
        expect(out.changed).toBe(false);
        expect(out.book).toBe(first);
    });

    test('a different body is changed, returns the new book and replaces the cache', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(res(BOOK, '"v1"'))
            .mockResolvedValueOnce(res(NEXT, '"v2"'))
            .mockResolvedValueOnce(res(null, null, 304)));
        await loadBook('owner/repo');
        const out = await revalidateBook('owner/repo');
        expect(out.changed).toBe(true);
        expect(out.book.chapters).toHaveLength(2);
        expect(await loadBook('owner/repo')).toBe(out.book);
        // The new ETag is the one sent next time.
        const again = await revalidateBook('owner/repo');
        expect(fetch.mock.calls[2][1].headers).toEqual({ 'If-None-Match': '"v2"' });
        expect(again).toEqual({ book: out.book, changed: false });
    });

    test('a book appearing where there was none is changed', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 404 })
            .mockResolvedValueOnce(res(BOOK)));
        expect(await loadBook('owner/repo')).toBeNull();
        const out = await revalidateBook('owner/repo');
        expect(out.changed).toBe(true);
        expect(out.book.chapters).toHaveLength(3);
    });

    test('still no book is unchanged; a network failure keeps the cache and reports failed', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
        await loadBook('owner/a');
        await expect(revalidateBook('owner/a')).resolves.toEqual({ book: null, changed: false });

        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res(BOOK)).mockRejectedValueOnce(new Error('offline')));
        const first = await loadBook('owner/b');
        await expect(revalidateBook('owner/b')).resolves.toEqual({ book: first, changed: false, failed: true });
        expect(await loadBook('owner/b')).toBe(first);
    });

    test('with nothing cached it is a plain load; loadBook({ revalidate: true }) is the same call', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(res(BOOK))
            .mockResolvedValueOnce(res(NEXT));
        vi.stubGlobal('fetch', fetchMock);
        expect(isBookCached('owner/repo')).toBe(false);
        const first = await loadBook('owner/repo', { revalidate: true });
        expect(first.changed).toBe(false);
        expect(first.book.chapters).toHaveLength(3);
        expect(isBookCached('owner/repo')).toBe(true);
        const second = await loadBook('owner/repo', { revalidate: true });
        expect(second.changed).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('bookStats', () => {
    test('counts chapters, sums minutes and counts stale chapters', () => {
        expect(bookStats(BOOK)).toEqual({ chapters: 3, minutes: 13, stale: 1 });
    });

    test('an empty or missing book is all zeros', () => {
        expect(bookStats(null)).toEqual({ chapters: 0, minutes: 0, stale: 0 });
        expect(bookStats({ chapters: [] })).toEqual({ chapters: 0, minutes: 0, stale: 0 });
    });

    test('ignores non-numeric minutes and only counts stale === true', () => {
        const data = { chapters: [{ id: 'a', minutes: 'x', stale: 'yes' }, { id: 'b', minutes: 2 }] };
        expect(bookStats(data)).toEqual({ chapters: 2, minutes: 2, stale: 0 });
    });
});
