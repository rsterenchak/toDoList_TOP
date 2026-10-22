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

import { loadBook, resetBookCache, bookStats } from '../src/codeBook.js';

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
