import {
    safeSetItem,
    setStorageErrorHandler,
    keepNewest,
    trimToByteBudget,
    capBookNotesStore,
    jsonBytes,
    appStorageSizes,
    clearCaches,
    formatBytes,
} from '../src/storage.js';
import { setBookNotes, BOOK_NOTES_KEY } from '../src/prefs.js';

// storage.js guards every localStorage write against a full quota (iOS Safari
// caps the origin near 5MB) and caps the heavy cache keys so they can't starve
// allProjects of space.

describe('safeSetItem', () => {
    let errorSpy;
    beforeEach(() => {
        localStorage.clear();
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
        setStorageErrorHandler(null);
    });

    it('returns true and writes the value when setItem succeeds', () => {
        expect(safeSetItem('todoapp_x', 'hello')).toBe(true);
        expect(localStorage.getItem('todoapp_x')).toBe('hello');
    });

    it('returns false, logs, and reports to the handler when setItem throws', () => {
        const err = new DOMException('full', 'QuotaExceededError');
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw err; });
        const handler = vi.fn();
        setStorageErrorHandler(handler);

        expect(safeSetItem('todoapp_x', 'hello')).toBe(false);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(err, 'todoapp_x');
        expect(errorSpy).toHaveBeenCalled();
    });

    it('a throwing handler does not make safeSetItem throw', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
        setStorageErrorHandler(() => { throw new Error('handler bug'); });
        expect(() => safeSetItem('todoapp_x', 'v')).not.toThrow();
    });
});

describe('eviction helpers', () => {
    it('keepNewest keeps the tail of an oldest-first list', () => {
        expect(keepNewest([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
    });

    it('keepNewest keeps the head of a newest-first list', () => {
        expect(keepNewest([5, 4, 3, 2, 1], 3, true)).toEqual([5, 4, 3]);
    });

    it('keepNewest returns a copy unchanged when under the cap', () => {
        const list = [1, 2];
        const out = keepNewest(list, 5);
        expect(out).toEqual([1, 2]);
        expect(out).not.toBe(list);
    });

    it('trimToByteBudget drops the oldest items until the total fits', () => {
        const list = ['a', 'b', 'c', 'd'];
        const out = trimToByteBudget(list, 20, () => 10);
        expect(out).toEqual(['c', 'd']);
    });

    it('trimToByteBudget skips items canEvict rejects and evicts the next oldest', () => {
        const list = ['keep', 'b', 'c', 'd'];
        const out = trimToByteBudget(list, 20, () => 10, (x) => x !== 'keep');
        expect(out).toEqual(['keep', 'd']);
    });

    it('trimToByteBudget leaves a list already within budget alone', () => {
        expect(trimToByteBudget(['a', 'b'], 100, () => 10)).toEqual(['a', 'b']);
    });

    it('capBookNotesStore evicts the least recently updated synced notes first, never unsynced ones', () => {
        const big = 'x'.repeat(500);
        const store = {
            r1: [
                { createdAt: '1', updatedAt: '2026-01-01', body: big, synced: true },
                { createdAt: '2', updatedAt: '2026-01-02', body: big },               // never synced
                { createdAt: '3', updatedAt: '2026-01-05', body: big, synced: true },
            ],
            r2: [
                { createdAt: '4', updatedAt: '2026-01-03', body: big, synced: true, dirty: true },
                { createdAt: '5', updatedAt: '2026-01-04', body: big, synced: true },
            ],
        };
        const noteBytes = jsonBytes(store.r1[0]);
        // Room for three notes: the two oldest evictable ones (1, then 5) go.
        const out = capBookNotesStore(store, noteBytes * 3 + 10);
        expect(out.r1.map(n => n.createdAt)).toEqual(['2', '3']);
        expect(out.r2.map(n => n.createdAt)).toEqual(['4']);
    });

    it('setBookNotes writes through the byte cap', () => {
        localStorage.clear();
        const big = 'y'.repeat(100 * 1024);
        const notes = [0, 1, 2, 3].map(i => ({
            chapterId: 'c', paraIndex: i, body: big, createdAt: 't' + i,
            updatedAt: '2026-01-0' + (i + 1), synced: true,
        }));
        setBookNotes('repo', notes);
        const stored = JSON.parse(localStorage.getItem(BOOK_NOTES_KEY)).repo;
        // Four ~200KB notes exceed the 256KB budget; only the newest survives.
        expect(stored.map(n => n.createdAt)).toEqual(['t3']);
    });
});

describe('size report and Clear caches', () => {
    beforeEach(() => { localStorage.clear(); });

    it('appStorageSizes lists app keys largest first and ignores foreign keys', () => {
        localStorage.setItem('allProjects', 'x'.repeat(100));
        localStorage.setItem('todoapp_theme', 'dark');
        localStorage.setItem('someOtherLib', 'x'.repeat(1000));
        const sizes = appStorageSizes();
        expect(sizes.map(e => e.key)).toEqual(['allProjects', 'todoapp_theme']);
        expect(sizes[0].bytes).toBe(('allProjects'.length + 100) * 2);
    });

    it('clearCaches removes the cache keys and synced notes but keeps tasks, prefs and unsynced notes', () => {
        localStorage.setItem('allProjects', '{}');
        localStorage.setItem('todoapp_theme', 'dark');
        localStorage.setItem('todoapp_claudeChat', '{"r":[]}');
        localStorage.setItem('todoapp_claudeRuns', '[]');
        localStorage.setItem('todoapp_structureExplain', '{}');
        localStorage.setItem('todoapp_codeNotes', '{}');
        localStorage.setItem(BOOK_NOTES_KEY, JSON.stringify({
            r: [{ createdAt: '1', synced: true }, { createdAt: '2' }],
        }));

        expect(clearCaches()).toBeGreaterThan(0);

        expect(localStorage.getItem('allProjects')).toBe('{}');
        expect(localStorage.getItem('todoapp_theme')).toBe('dark');
        ['todoapp_claudeChat', 'todoapp_claudeRuns', 'todoapp_structureExplain', 'todoapp_codeNotes']
            .forEach(k => expect(localStorage.getItem(k)).toBeNull());
        expect(JSON.parse(localStorage.getItem(BOOK_NOTES_KEY)).r.map(n => n.createdAt)).toEqual(['2']);
    });

    it('formatBytes renders B / KB / MB', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(340 * 1024)).toBe('340 KB');
        expect(formatBytes(1.25 * 1024 * 1024)).toBe('1.3 MB');
    });
});
