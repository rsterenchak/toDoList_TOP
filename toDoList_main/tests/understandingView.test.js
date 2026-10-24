import { vi } from 'vitest';

// The Understanding view renders the selected project's code book as a shelf:
// the header (repo chip, chapter count + minutes, one generate/stale control),
// a continue card resuming the saved reading position, and the ordered chapter
// rows that open the reader. These tests render fixture books through the real
// view against mocked repo resolution, book loading, Supabase and Worker calls.

const mocks = vi.hoisted(() => ({
    repo: 'owner/repo',
    book: null,
    active: false,
    remote: undefined,
    remoteMarks: undefined,
    tours: null,
    cached: false,
    fresh: undefined,
    loaded: true,
}));

vi.mock('../src/seedTasksModal.js', () => ({
    resolveProjectRepo: vi.fn(() => mocks.repo),
}));

vi.mock('../src/codeBook.js', async () => {
    const actual = await vi.importActual('../src/codeBook.js');
    return {
        bookStats: actual.bookStats,
        loadBook: vi.fn(() => Promise.resolve(mocks.book)),
        // `mocks.fresh` stands for the published copy: unset means unchanged; a
        // book (or null) is swapped in as the cached book and reads as changed.
        revalidateBook: vi.fn(() => {
            if (mocks.fresh === undefined) return Promise.resolve({ book: mocks.book, changed: false });
            mocks.book = mocks.fresh;
            mocks.fresh = undefined;
            return Promise.resolve({ book: mocks.book, changed: true });
        }),
        isBookCached: vi.fn(() => mocks.cached),
        resetBookCache: vi.fn(),
    };
});

vi.mock('../src/inject.js', () => ({
    getCachedTargets: vi.fn(() => [{ repo: 'owner/repo', file_path: 'TODO.md' }]),
    targetsLoaded: vi.fn(() => mocks.loaded),
    fetchActiveRuns: vi.fn(() => Promise.resolve({ ok: true, active: mocks.active })),
    dispatchBook: vi.fn(() => Promise.resolve({ ok: true, dispatched: true, book: true })),
    mintEntryId: vi.fn(() => 'cid-1'),
    isInjectConfigured: vi.fn(() => true),
    showInjectToast: vi.fn(),
}));

vi.mock('../src/modals.js', () => ({
    showConfirmModal: vi.fn(),
}));

vi.mock('../src/claudeSheet.js', () => ({
    loadManifest: vi.fn(() => Promise.resolve({ ok: true, files: [], srcRoot: 'src' })),
    getCachedManifest: vi.fn(() => null),
    openChatWithBookScope: vi.fn(),
}));

// The tours loader would fetch src-tours.json from Pages; feed it from
// `mocks.tours` instead, keeping the real pure helpers.
vi.mock('../src/codeTours.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, loadTours: vi.fn(() => Promise.resolve(mocks.tours)) };
});

vi.mock('../src/tourPlayer.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, openTourPlayer: vi.fn(actual.openTourPlayer) };
});

// The symbols index would load from Pages; nothing is loaded unless a test says so.
vi.mock('../src/codeTrace.js', () => ({
    loadSymbols: vi.fn(() => Promise.resolve(null)),
    getLoadedSymbols: vi.fn(() => undefined),
}));

vi.mock('../src/codeViewer.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, renderCodeViewer: vi.fn() };
});

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: null } })) },
        from: vi.fn(),
    },
}));

vi.mock('../src/bookBookmarks.js', async () => {
    const actual = await vi.importActual('../src/bookBookmarks.js');
    const prefs = await vi.importActual('../src/prefs.js');
    return {
        ...actual,
        // The synced list, stored locally the way the real merge stores it.
        loadBookmarks: vi.fn((repo) => {
            if (mocks.remoteMarks !== undefined) prefs.setBookBookmarks(repo, mocks.remoteMarks);
            return Promise.resolve(actual.listBookmarks(repo));
        }),
    };
});

vi.mock('../src/bookProgress.js', async () => {
    const actual = await vi.importActual('../src/bookProgress.js');
    return {
        ...actual,
        flushProgress: vi.fn(() => Promise.resolve({ ok: false, skipped: true })),
        loadProgress: vi.fn((repo) => Promise.resolve(mocks.remote !== undefined ? mocks.remote : actual.readLocalProgress(repo))),
    };
});

import { renderUnderstandingView, exitUnderstandingView, resetUnderstandingRun, buildBookScope } from '../src/understandingView.js';
import { loadBook, revalidateBook, isBookCached } from '../src/codeBook.js';
import { fetchActiveRuns, dispatchBook, showInjectToast } from '../src/inject.js';
import { showConfirmModal } from '../src/modals.js';
import { setBookProgress, setBookBookmarks, setBookFlags, getBookFlags, setBookAbandon, getTourProgress, setTourProgress, isTourCardHidden } from '../src/prefs.js';
import { loadTours } from '../src/codeTours.js';
import { openTourPlayer, closeTourPlayer } from '../src/tourPlayer.js';
import { renderCodeViewer } from '../src/codeViewer.js';

const CLEAN = {
    title: 'Understanding Void',
    chapters: [
        { id: 'app-starts', index: 1, title: 'How the app starts', minutes: 4, stale: false },
        { id: 'data', index: 2, title: 'Where the data lives', minutes: 6, stale: false },
        { id: 'pipeline', index: 3, title: 'The pipeline', minutes: 5, stale: false },
    ],
};
const STALE = {
    title: 'Understanding Void',
    chapters: [
        { id: 'app-starts', index: 1, title: 'How the app starts', minutes: 4, stale: false },
        { id: 'data', index: 2, title: 'Where the data lives', minutes: 6, stale: true },
        { id: 'pipeline', index: 3, title: 'The pipeline', minutes: 5, stale: true },
    ],
};

function mountShell(projectName) {
    document.body.innerHTML =
        '<div id="mainBar" data-view="understanding"><div id="understandingView"></div></div>' +
        (projectName === null ? '' :
            '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>');
}

const view = () => document.getElementById('understandingView');
const control = () => view().querySelector('.understandingControl');
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    mocks.repo = 'owner/repo';
    mocks.book = null;
    mocks.active = false;
    mocks.remote = undefined;
    mocks.remoteMarks = undefined;
    mocks.tours = null;
    mocks.cached = false;
    mocks.fresh = undefined;
    mocks.loaded = true;
    localStorage.clear();
    vi.clearAllMocks();
    mountShell('Void');
});

afterEach(() => {
    exitUnderstandingView();
    resetUnderstandingRun();
});

describe('empty states', () => {
    test('no selected project', async () => {
        mountShell(null);
        await renderUnderstandingView();
        expect(view().querySelector('.structureEmptyState').textContent).toMatch(/Select a project/);
        expect(loadBook).not.toHaveBeenCalled();
    });

    test('project without a linked repo', async () => {
        mocks.repo = null;
        await renderUnderstandingView();
        expect(view().querySelector('.structureEmptyState').textContent).toMatch(/isn’t linked to a repo/);
        expect(loadBook).not.toHaveBeenCalled();
    });
});

// A cold start on this view renders before the inject-targets cache has loaded,
// so an unresolved repo there means "not loaded yet", not "not linked".
describe('targets not loaded yet', () => {
    beforeEach(() => {
        localStorage.setItem('todoapp_active_view', 'understanding');
    });

    test('shows a loading state, then the shelf once the targets land', async () => {
        mocks.repo = null;
        mocks.loaded = false;
        mocks.book = CLEAN;
        await renderUnderstandingView();
        expect(view().querySelector('.structureEmptyState')).toBeNull();
        expect(view().querySelector('.understandingLoading').textContent).toBe('Loading…');
        expect(loadBook).not.toHaveBeenCalled();

        mocks.repo = 'owner/repo';
        mocks.loaded = true;
        document.dispatchEvent(new CustomEvent('injectTargetsLoaded'));
        await flush();
        expect(loadBook).toHaveBeenCalledWith('owner/repo');
        expect(view().querySelectorAll('.understandingChapterRow')).toHaveLength(3);
    });

    test('loaded targets with no link for the project show the no-repo state', async () => {
        mocks.repo = null;
        mocks.loaded = false;
        await renderUnderstandingView();
        mocks.loaded = true;
        document.dispatchEvent(new CustomEvent('injectTargetsLoaded'));
        await flush();
        expect(view().querySelector('.structureEmptyState').textContent).toMatch(/isn’t linked to a repo/);
    });

    test('a target linked mid-session resolves the no-repo state', async () => {
        mocks.repo = null;
        await renderUnderstandingView();
        expect(view().querySelector('.structureEmptyState')).not.toBeNull();
        mocks.repo = 'owner/repo';
        mocks.book = CLEAN;
        document.dispatchEvent(new CustomEvent('injectTargetsChanged'));
        await flush();
        expect(view().querySelector('.structureEmptyState')).toBeNull();
        expect(view().querySelectorAll('.understandingChapterRow')).toHaveLength(3);
    });

    test('an open reader or a populated shelf survives both events', async () => {
        mocks.book = CLEAN;
        await renderUnderstandingView();
        const shelf = view().querySelector('.understandingShelf');
        document.dispatchEvent(new CustomEvent('injectTargetsLoaded'));
        document.dispatchEvent(new CustomEvent('injectTargetsChanged'));
        await flush();
        expect(view().querySelector('.understandingShelf')).toBe(shelf);

        view().querySelectorAll('.understandingChapterBtn')[1].click();
        loadBook.mockClear();
        document.dispatchEvent(new CustomEvent('injectTargetsLoaded'));
        document.dispatchEvent(new CustomEvent('injectTargetsChanged'));
        await flush();
        expect(view().classList.contains('is-reading')).toBe(true);
        expect(view().querySelector('.understandingReaderTitle').textContent).toBe('Where the data lives');
        expect(loadBook).not.toHaveBeenCalled();
    });

    test('a hidden view is not re-rendered by the events', async () => {
        mocks.repo = null;
        mocks.loaded = false;
        await renderUnderstandingView();
        localStorage.setItem('todoapp_active_view', 'projects');
        mocks.repo = 'owner/repo';
        mocks.loaded = true;
        document.dispatchEvent(new CustomEvent('injectTargetsLoaded'));
        await flush();
        expect(loadBook).not.toHaveBeenCalled();
    });
});

describe('shelf', () => {
    test('renders the header, continue card and one row per chapter', async () => {
        mocks.book = CLEAN;
        await renderUnderstandingView();
        expect(loadBook).toHaveBeenCalledWith('owner/repo');
        expect(view().querySelector('.understandingRepoChip').textContent).toBe('owner/repo');
        expect(view().querySelector('.understandingStats').textContent).toBe('3 CH · 15 MIN');
        expect(view().querySelector('.understandingContinueEyebrow').textContent).toBe('START · CH 1 OF 3');
        expect(view().querySelector('.understandingContinueTitle').textContent).toBe('How the app starts');
        expect(view().querySelector('.understandingProgress').getAttribute('aria-valuenow')).toBe('0');
        expect(view().querySelector('.understandingContinueMinutes').textContent).toBe('~4 MIN');
        const rows = view().querySelectorAll('.understandingChapterRow');
        expect(rows).toHaveLength(3);
        expect(rows[0].querySelector('.understandingChapterNum').textContent).toBe('01');
        expect(rows[1].querySelector('.understandingChapterTitle').textContent).toBe('Where the data lives');
        expect(rows[1].querySelector('.understandingChapterMinutes').textContent).toBe('6 MIN');
    });

    test('a stale chapter shows STALE in place of its minutes', async () => {
        mocks.book = STALE;
        await renderUnderstandingView();
        const rows = view().querySelectorAll('.understandingChapterRow');
        expect(rows[0].querySelector('.understandingChapterStale')).toBeNull();
        expect(rows[1].querySelector('.understandingChapterStale').textContent).toBe('STALE');
        expect(rows[1].querySelector('.understandingChapterMinutes')).toBeNull();
    });

    test('a chapter stale only from drift shows DRIFT; any other warning keeps STALE', async () => {
        mocks.book = {
            title: 'Understanding Void',
            chapters: [
                { id: 'app-starts', index: 1, title: 'How the app starts', minutes: 4, stale: true,
                    warnings: ['drift: bootApp body changed'], drift: [{ ref: 'index.js:bootApp', reason: 'body' }] },
                { id: 'data', index: 2, title: 'Where the data lives', minutes: 6, stale: true,
                    warnings: ['drift: save body changed', 'reference "gone" names no definition'], drift: [{ ref: 'a.js:save', reason: 'body' }] },
                { id: 'pipeline', index: 3, title: 'The pipeline', minutes: 5, stale: false, warnings: [], drift: [] },
            ],
        };
        await renderUnderstandingView();
        const rows = view().querySelectorAll('.understandingChapterRow');
        expect(rows[0].querySelector('.understandingChapterStale').textContent).toBe('DRIFT');
        expect(rows[1].querySelector('.understandingChapterStale').textContent).toBe('STALE');
        expect(rows[2].querySelector('.understandingChapterStale')).toBeNull();
        // Drift chapters still count toward the stale control.
        expect(view().querySelector('.understandingControl').textContent).toBe('2 STALE');
    });

    test('the reader header tags a drifted chapter DRIFT with a chip per changed symbol', async () => {
        mocks.book = {
            title: 'Understanding Void',
            chapters: [
                { id: 'app-starts', index: 1, title: 'How the app starts', minutes: 4, stale: true, paragraphs: [[{ t: 'One.' }]],
                    warnings: ['drift: bootApp body changed', 'drift: listLogic.addItem importers changed', 'drift: sw.js body changed'],
                    drift: [{ ref: 'index.js:bootApp', reason: 'body' }, { ref: 'listLogic.js:listLogic.addItem', reason: 'importers' }, { ref: 'sw.js', reason: 'body' }] },
                { id: 'data', index: 2, title: 'Where the data lives', minutes: 6, stale: false, paragraphs: [[{ t: 'Two.' }]], warnings: [], drift: [] },
            ],
        };
        await renderUnderstandingView();
        view().querySelectorAll('.understandingChapterBtn')[0].click();
        expect(view().querySelector('.understandingReaderStaleTag').textContent).toBe('DRIFT');
        const chips = Array.from(view().querySelectorAll('.understandingDriftChip'));
        expect(chips.map((c) => c.textContent)).toEqual(['bootApp', 'listLogic.addItem', 'sw.js']);
        expect(chips[1].title).toBe('listLogic.js:listLogic.addItem — importers changed');
        // A clean chapter carries no flag.
        view().querySelector('.understandingReaderNav button:last-child').click();
        expect(view().querySelector('.understandingReaderTitle').textContent).toBe('Where the data lives');
        expect(view().querySelector('.understandingReaderStale')).toBeNull();
    });

    test('a chapter row and the Read button open the reader', async () => {
        mocks.book = CLEAN;
        await renderUnderstandingView();
        expect(view().querySelectorAll('.understandingChapterRow button')).toHaveLength(3);
        view().querySelectorAll('.understandingChapterBtn')[1].click();
        expect(view().classList.contains('is-reading')).toBe(true);
        expect(view().querySelector('.understandingReaderTitle').textContent).toBe('Where the data lives');
        expect(view().querySelector('.understandingShelf')).toBeNull();

        // Opening chapter 2 recorded it, so the shelf's Read resumes there.
        await renderUnderstandingView({ force: true });
        expect(view().querySelector('.understandingContinueEyebrow').textContent).toBe('CONTINUE · CH 2 OF 3');
        view().querySelector('.understandingReadBtn').click();
        expect(view().querySelector('.understandingReaderTitle').textContent).toBe('Where the data lives');

        localStorage.clear();
        await renderUnderstandingView({ force: true });
        view().querySelector('.understandingReadBtn').click();
        expect(view().querySelector('.understandingReaderTitle').textContent).toBe('How the app starts');
        expect(dispatchBook).not.toHaveBeenCalled();
    });
});

describe('continue — resumed position', () => {
    test('Continue shows the saved chapter, its bar and minutes left, and checks earlier rows', async () => {
        mocks.book = CLEAN;
        setBookProgress('owner/repo', { chapterId: 'data', paraIndex: 1, pct: 0.5, updatedAt: '2026-10-01T00:00:00.000Z' });
        await renderUnderstandingView();
        expect(view().querySelector('.understandingContinueEyebrow').textContent).toBe('CONTINUE · CH 2 OF 3');
        expect(view().querySelector('.understandingContinueTitle').textContent).toBe('Where the data lives');
        expect(view().querySelector('.understandingProgress').getAttribute('aria-valuenow')).toBe('50');
        // Half of chapter 2's 6 minutes plus chapter 3's 5.
        expect(view().querySelector('.understandingContinueMinutes').textContent).toBe('~8 MIN LEFT');
        const rows = view().querySelectorAll('.understandingChapterRow');
        expect(rows[0].querySelector('.understandingChapterDone').textContent).toBe('✓');
        expect(rows[0].querySelector('.understandingChapterMinutes')).toBeNull();
        expect(rows[1].querySelector('.understandingChapterMinutes').textContent).toBe('6 MIN');
        expect(rows[2].querySelector('.understandingChapterDone')).toBeNull();
    });

    test('a newer synced record repaints the shelf', async () => {
        mocks.book = CLEAN;
        setBookProgress('owner/repo', { chapterId: 'app-starts', paraIndex: 0, pct: 0, updatedAt: '2026-10-01T00:00:00.000Z' });
        mocks.remote = { chapterId: 'pipeline', paraIndex: 0, pct: 0, updatedAt: '2026-10-02T00:00:00.000Z' };
        await renderUnderstandingView();
        expect(view().querySelector('.understandingContinueEyebrow').textContent).toBe('CONTINUE · CH 3 OF 3');
        expect(view().querySelectorAll('.understandingChapterDone')).toHaveLength(2);
    });

    test('a record for a chapter no longer in the book starts from chapter 1', async () => {
        mocks.book = CLEAN;
        setBookProgress('owner/repo', { chapterId: 'gone', paraIndex: 2, pct: 0.4, updatedAt: '2026-10-01T00:00:00.000Z' });
        await renderUnderstandingView();
        expect(view().querySelector('.understandingContinueEyebrow').textContent).toBe('START · CH 1 OF 3');
        expect(view().querySelector('.understandingChapterDone')).toBeNull();
    });
});

describe('header control — four states', () => {
    test('no book: a Generate button that dispatches scope all', async () => {
        mocks.book = null;
        await renderUnderstandingView();
        expect(view().textContent).toMatch(/No book yet/);
        expect(view().textContent).toMatch(/~1 min/);
        expect(view().querySelector('.understandingStats').textContent).toBe('0 CH · 0 MIN');
        expect(control().textContent).toBe('Generate');
        control().click();
        await flush();
        expect(dispatchBook).toHaveBeenCalledWith('all', 'cid-1', { repo: 'owner/repo', file_path: 'TODO.md' });
    });

    test('a 404 book behaves as no book', async () => {
        mocks.book = null;
        await renderUnderstandingView();
        expect(view().querySelector('.understandingChapterRow')).toBeNull();
        expect(view().querySelector('.understandingContinue')).toBeNull();
    });

    test('stale chapters: an amber <n> STALE chip that dispatches scope stale', async () => {
        mocks.book = STALE;
        await renderUnderstandingView();
        expect(control().textContent).toBe('2 STALE');
        expect(control().classList.contains('is-stale')).toBe(true);
        control().click();
        await flush();
        expect(dispatchBook).toHaveBeenCalledWith('stale', 'cid-1', expect.objectContaining({ repo: 'owner/repo' }));
    });

    test('clean book: a muted Regenerate chip that confirms before dispatching scope all', async () => {
        mocks.book = CLEAN;
        await renderUnderstandingView();
        expect(control().textContent).toBe('Regenerate');
        expect(control().classList.contains('is-regenerate')).toBe(true);
        control().click();
        await flush();
        expect(showConfirmModal).toHaveBeenCalledTimes(1);
        expect(dispatchBook).not.toHaveBeenCalled();
        showConfirmModal.mock.calls[0][0].onConfirm();
        await flush();
        expect(dispatchBook).toHaveBeenCalledWith('all', 'cid-1', expect.objectContaining({ repo: 'owner/repo' }));
    });

    test('in flight: the control is disabled and reads Generating…', async () => {
        mocks.book = CLEAN;
        await renderUnderstandingView();
        control().click();
        showConfirmModal.mock.calls[0][0].onConfirm();
        await flush();
        await flush();
        expect(control().textContent).toBe('Generating…');
        expect(control().disabled).toBe(true);
    });

    test('a book run already active on entry reads Generating…', async () => {
        mocks.book = STALE;
        mocks.active = true;
        await renderUnderstandingView();
        await flush();
        await flush();
        expect(fetchActiveRuns).toHaveBeenCalledWith(expect.objectContaining({ repo: 'owner/repo' }), 'book');
        expect(control().textContent).toBe('Generating…');
    });
});

describe('run settle', () => {
    test('when the book run finishes the published book is re-checked and the shelf re-renders', async () => {
        vi.useFakeTimers();
        try {
            mocks.book = null;
            const p = renderUnderstandingView();
            await vi.advanceTimersByTimeAsync(0);
            await p;
            control().click();
            await vi.advanceTimersByTimeAsync(0);
            expect(control().textContent).toBe('Generating…');

            mocks.active = true;
            await vi.advanceTimersByTimeAsync(5000);
            expect(control().textContent).toBe('Generating…');

            mocks.active = false;
            await vi.advanceTimersByTimeAsync(5000);
            expect(revalidateBook).toHaveBeenCalledWith('owner/repo');
            expect(control().textContent).toBe('Generate');
            expect(view().querySelector('.understandingNote').textContent).toMatch(/~1 min/);

            // The published copy lands after the deploy: the next 30s check swaps it in.
            mocks.fresh = CLEAN;
            await vi.advanceTimersByTimeAsync(30000);
            expect(control().textContent).toBe('Regenerate');
            expect(view().querySelectorAll('.understandingChapterRow')).toHaveLength(3);
            expect(showInjectToast).toHaveBeenCalledWith('Book updated');
            expect(view().querySelector('.understandingNote').hidden).toBe(true);

            // Found it — the re-check stops.
            const calls = revalidateBook.mock.calls.length;
            await vi.advanceTimersByTimeAsync(120000);
            expect(revalidateBook.mock.calls.length).toBe(calls);
        } finally {
            vi.useRealTimers();
        }
    });

    test('the post-run re-check gives up after ten minutes', async () => {
        vi.useFakeTimers();
        try {
            mocks.book = CLEAN;
            mocks.active = true;
            const p = renderUnderstandingView();
            await vi.advanceTimersByTimeAsync(0);
            await p;
            expect(control().textContent).toBe('Generating…');
            mocks.active = false;
            await vi.advanceTimersByTimeAsync(5000);
            expect(control().textContent).toBe('Regenerate');
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
            const calls = revalidateBook.mock.calls.length;
            expect(calls).toBeGreaterThan(1);
            expect(calls).toBeLessThanOrEqual(22);
            await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
            expect(revalidateBook.mock.calls.length).toBe(calls);
        } finally {
            vi.useRealTimers();
        }
    });

    test('a book that lands while reading leaves the reader alone and dots the back chip', async () => {
        vi.useFakeTimers();
        try {
            mocks.book = CLEAN;
            mocks.active = true;
            const p = renderUnderstandingView();
            await vi.advanceTimersByTimeAsync(0);
            await p;
            view().querySelectorAll('.understandingChapterBtn')[1].click();
            await vi.advanceTimersByTimeAsync(0);

            mocks.active = false;
            mocks.fresh = STALE;
            await vi.advanceTimersByTimeAsync(5000);
            expect(view().querySelector('.understandingReaderTitle').textContent).toBe('Where the data lives');
            const back = view().querySelector('.understandingBackChip');
            expect(back.classList.contains('has-update')).toBe(true);
            expect(back.querySelector('.understandingBackDot')).not.toBeNull();
            expect(back.textContent).toContain('Shelf');
            expect(showInjectToast).not.toHaveBeenCalled();

            back.click();
            await vi.advanceTimersByTimeAsync(0);
            expect(view().querySelector('.understandingReader')).toBeNull();
            expect(control().textContent).toBe('2 STALE');
            expect(showInjectToast).toHaveBeenCalledWith('Book updated');
        } finally {
            vi.useRealTimers();
        }
    });

    test('when the open chapter is gone from the new book the back chip reads Book updated and returns to the shelf', async () => {
        vi.useFakeTimers();
        try {
            mocks.book = CLEAN;
            mocks.active = true;
            const p = renderUnderstandingView();
            await vi.advanceTimersByTimeAsync(0);
            await p;
            view().querySelectorAll('.understandingChapterBtn')[2].click();
            await vi.advanceTimersByTimeAsync(0);

            mocks.active = false;
            mocks.fresh = { title: 'Understanding Void', chapters: CLEAN.chapters.slice(0, 2) };
            await vi.advanceTimersByTimeAsync(5000);
            const back = view().querySelector('.understandingBackChip');
            expect(back.textContent).toContain('Book updated');
            back.click();
            await vi.advanceTimersByTimeAsync(0);
            expect(view().querySelector('.understandingReader')).toBeNull();
            expect(view().querySelectorAll('.understandingChapterRow')).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('re-checking the published book', () => {
    test('entering the tab with a cached book re-checks it; a change re-renders the shelf and toasts', async () => {
        mocks.book = STALE;
        mocks.cached = true;
        mocks.fresh = CLEAN;
        await renderUnderstandingView();
        await flush();
        expect(revalidateBook).toHaveBeenCalledWith('owner/repo');
        expect(control().textContent).toBe('Regenerate');
        expect(showInjectToast).toHaveBeenCalledWith('Book updated');
    });

    test('an unchanged book re-renders nothing and stays quiet', async () => {
        mocks.book = CLEAN;
        mocks.cached = true;
        await renderUnderstandingView();
        await flush();
        expect(revalidateBook).toHaveBeenCalledTimes(1);
        expect(showInjectToast).not.toHaveBeenCalled();
    });

    test('a first load does not re-check, nor does a re-render without leaving the tab', async () => {
        mocks.book = CLEAN;
        await renderUnderstandingView();
        await flush();
        expect(revalidateBook).not.toHaveBeenCalled();
        mocks.cached = true;
        await renderUnderstandingView();
        await flush();
        expect(revalidateBook).not.toHaveBeenCalled();
        exitUnderstandingView();
        await renderUnderstandingView();
        await flush();
        expect(revalidateBook).toHaveBeenCalledTimes(1);
    });

    test('returning to the shelf from the reader re-checks the book', async () => {
        mocks.book = CLEAN;
        await renderUnderstandingView();
        await flush();
        mocks.cached = true;
        view().querySelector('.understandingChapterBtn').click();
        await flush();
        expect(revalidateBook).not.toHaveBeenCalled();
        mocks.fresh = STALE;
        view().querySelector('.understandingBackChip').click();
        await flush();
        await flush();
        expect(revalidateBook).toHaveBeenCalledTimes(1);
        expect(control().textContent).toBe('2 STALE');
        expect(showInjectToast).toHaveBeenCalledWith('Book updated');
    });

    test('the repo chip is a button that re-checks on tap: Up to date when unchanged', async () => {
        mocks.book = CLEAN;
        await renderUnderstandingView();
        const chip = view().querySelector('.understandingRepoChip');
        expect(chip.tagName).toBe('BUTTON');
        chip.click();
        expect(chip.classList.contains('is-checking')).toBe(true);
        expect(chip.disabled).toBe(true);
        await flush();
        expect(revalidateBook).toHaveBeenCalledWith('owner/repo');
        expect(chip.classList.contains('is-checking')).toBe(false);
        expect(showInjectToast).toHaveBeenCalledWith('Up to date');
    });

    test('the repo chip re-renders the shelf and toasts when the book changed', async () => {
        mocks.book = null;
        await renderUnderstandingView();
        mocks.fresh = CLEAN;
        view().querySelector('.understandingRepoChip').click();
        await flush();
        await flush();
        expect(view().querySelectorAll('.understandingChapterRow')).toHaveLength(3);
        expect(showInjectToast).toHaveBeenCalledWith('Book updated');
    });

    test('a failed check says so instead of Up to date', async () => {
        mocks.book = CLEAN;
        await renderUnderstandingView();
        revalidateBook.mockImplementationOnce(() => Promise.resolve({ book: CLEAN, changed: false, failed: true }));
        view().querySelector('.understandingRepoChip').click();
        await flush();
        expect(showInjectToast).toHaveBeenCalledWith('Couldn’t check the book', 'error');
    });
});

describe('bookmarks section', () => {
    const BOOKED = {
        title: 'Understanding Void',
        chapters: [
            { id: 'app-starts', index: 1, title: 'How the app starts', minutes: 4, stale: false,
                paragraphs: [[{ t: 'One.' }], [{ t: 'Two.' }], [{ t: 'Three.' }]] },
            { id: 'data', index: 2, title: 'Where the data lives', minutes: 6, stale: false,
                paragraphs: [[{ t: 'Data one.' }], [{ t: 'Data two.' }]] },
        ],
    };
    const mark = (chapterId, paraIndex, label) => ({ repo: 'owner/repo', chapterId, paraIndex, label, createdAt: '' });
    const section = () => view().querySelector('.understandingBookmarkSection');

    test('hidden entirely at zero', async () => {
        mocks.book = BOOKED;
        await renderUnderstandingView();
        expect(section()).toBeNull();
    });

    test('BOOKMARKS · n after the chapter list, one row per bookmark in book order', async () => {
        mocks.book = BOOKED;
        setBookBookmarks('owner/repo', [mark('data', 1, 'Data two.'), mark('app-starts', 2, 'Three.')]);
        await renderUnderstandingView();
        expect(section().previousElementSibling.classList.contains('understandingChapters')).toBe(true);
        expect(section().querySelector('.understandingBookmarkHead').textContent).toBe('BOOKMARKS · 2');
        const rows = section().querySelectorAll('.understandingBookmarkRow');
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('.understandingBookmarkLabel').textContent).toBe('Three.');
        expect(rows[0].querySelector('.understandingBookmarkCh').textContent).toBe('CH 1');
        expect(rows[1].querySelector('.understandingBookmarkCh').textContent).toBe('CH 2');
        expect(rows[0].querySelector('.understandingBookmarkRibbon')).not.toBeNull();
    });

    test('a row opens the reader at that paragraph', async () => {
        mocks.book = BOOKED;
        setBookBookmarks('owner/repo', [mark('data', 1, 'Data two.')]);
        await renderUnderstandingView();
        section().querySelector('.understandingBookmarkBtn').click();
        expect(view().querySelector('.understandingReaderTitle').textContent).toBe('Where the data lives');
        const para = view().querySelectorAll('.understandingPara')[1];
        expect(para.classList.contains('is-bookmarked')).toBe(true);
        expect(para.classList.contains('is-pulse')).toBe(true);
    });

    test('synced bookmarks that differ repaint the section', async () => {
        mocks.book = BOOKED;
        mocks.remoteMarks = [mark('app-starts', 0, 'One.')];
        await renderUnderstandingView();
        expect(section().querySelector('.understandingBookmarkHead').textContent).toBe('BOOKMARKS · 1');
    });
});

describe('flags section', () => {
    const FLAGGED = {
        title: 'Understanding Void',
        chapters: [
            { id: 'app-starts', index: 1, title: 'How the app starts', minutes: 4, stale: false,
                paragraphs: [[{ t: 'One.' }], [{ t: 'Two.' }], [{ t: 'Three.' }]] },
            { id: 'data', index: 2, title: 'Where the data lives', minutes: 6, stale: false,
                paragraphs: [[{ t: 'Data one.' }], [{ t: 'Data two.' }]] },
        ],
    };
    const flag = (chapterId, paraIndex, kind, note, extra) => Object.assign({
        repo: 'owner/repo', chapterId, paraIndex, excerpt: 'Excerpt of ' + chapterId, refs: [], kind, note,
        bookSha: '', createdAt: '2026-10-0' + (paraIndex + 1) + 'T00:00:00.000Z', resolvedAt: null,
    }, extra);
    const section = () => view().querySelector('.understandingFlagSection');

    test('hidden at zero open flags (resolved ones do not count)', async () => {
        mocks.book = FLAGGED;
        setBookFlags('owner/repo', [flag('data', 0, 'why', 'x', { resolvedAt: '2026-10-10T00:00:00.000Z' })]);
        await renderUnderstandingView();
        expect(section()).toBeNull();
    });

    test('FLAGS · n after the bookmarks, grouped by chapter in book order with badge, note or excerpt and CH n ¶m', async () => {
        mocks.book = FLAGGED;
        setBookBookmarks('owner/repo', [{ repo: 'owner/repo', chapterId: 'data', paraIndex: 0, label: 'Data one.', createdAt: '' }]);
        setBookFlags('owner/repo', [flag('data', 1, 'wrong', 'Says sync, code is async'), flag('app-starts', 2, 'order', '')]);
        await renderUnderstandingView();
        expect(section().previousElementSibling.classList.contains('understandingBookmarkSection')).toBe(true);
        expect(section().querySelector('.understandingBookmarkHead').textContent).toBe('FLAGS · 2');
        expect(Array.from(section().querySelectorAll('.understandingBookmarkGroup')).map((g) => g.textContent))
            .toEqual(['CH 1 · How the app starts', 'CH 2 · Where the data lives']);
        const rows = section().querySelectorAll('.understandingFlagRow');
        expect(rows[0].querySelector('.understandingFlagBadge').textContent).toBe('ORDER');
        expect(rows[0].querySelector('.understandingBookmarkLabel').textContent).toBe('Excerpt of app-starts');
        expect(rows[0].querySelector('.understandingBookmarkCh').textContent).toBe('CH 1 ¶3');
        expect(rows[1].querySelector('.understandingFlagBadge').textContent).toBe('WRONG');
        expect(rows[1].querySelector('.understandingBookmarkLabel').textContent).toBe('Says sync, code is async');
        expect(rows[1].querySelector('.understandingBookmarkCh').textContent).toBe('CH 2 ¶2');
    });

    test('a row opens the reader at its paragraph with the pulse; the glyph shows there', async () => {
        mocks.book = FLAGGED;
        setBookFlags('owner/repo', [flag('data', 1, 'unclear', 'huh')]);
        await renderUnderstandingView();
        section().querySelector('.understandingFlagBtnRow').click();
        expect(view().querySelector('.understandingReaderTitle').textContent).toBe('Where the data lives');
        const para = view().querySelectorAll('.understandingPara')[1];
        expect(para.classList.contains('is-flagged')).toBe(true);
        expect(para.classList.contains('is-pulse')).toBe(true);
    });

    test('the resolve control resolves the flag and the section goes', async () => {
        mocks.book = FLAGGED;
        setBookFlags('owner/repo', [flag('data', 1, 'unclear', 'huh')]);
        await renderUnderstandingView();
        section().querySelector('.understandingFlagResolve').click();
        await flush();
        await flush();
        expect(getBookFlags('owner/repo')[0].resolvedAt).toEqual(expect.any(String));
        expect(section()).toBeNull();
    });

    test('Copy puts the open flags on the clipboard as markdown and toasts', async () => {
        mocks.book = FLAGGED;
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        setBookFlags('owner/repo', [
            flag('data', 1, 'wrong', 'Says sync', { refs: [{ label: 'loadBook', file: 'codeBook.js', symbol: 'loadBook', line: 3 }] }),
            flag('app-starts', 0, 'why', ''),
        ]);
        await renderUnderstandingView();
        section().querySelector('.understandingFlagCopy').click();
        await flush();
        expect(writeText).toHaveBeenCalledWith(
            '- CH 1 ¶1 · WHY · "Excerpt of app-starts"\n' +
            '- CH 2 ¶2 · WRONG · "Says sync" · refs: loadBook'
        );
        expect(showInjectToast).toHaveBeenCalledWith('Copied');
    });
});

describe('abandoned chapters', () => {
    test('a chapter left part-read shows a muted `left at ¶n` beside its minutes', async () => {
        mocks.book = CLEAN;
        setBookAbandon('owner/repo', { data: { chapter_id: 'data', para_index: 2, pct: 0.3 } });
        await renderUnderstandingView();
        const rows = view().querySelectorAll('.understandingChapterRow');
        expect(rows[0].querySelector('.understandingChapterLeft')).toBeNull();
        const left = rows[1].querySelector('.understandingChapterLeft');
        expect(left.textContent).toBe('left at ¶3');
        expect(left.nextElementSibling.textContent).toBe('6 MIN');
    });
});

describe('no tours on the shelf', () => {
    const TOURS = {
        sections: [{ id: 'tasks', title: 'Tasks & projects' }],
        tours: [
            {
                id: 'add-task', section: 'tasks', title: 'Adding a task', recap: [],
                steps: [{ file: 'listLogic.js', symbol: 'addToDo', line: 10, area: 'tasks', title: 't', why: 'w', snippet: [] }],
            },
        ],
    };
    const TOURED = {
        title: 'Understanding Void',
        chapters: [
            { id: 'app-starts', index: 1, title: 'How the app starts', minutes: 4, stale: false, tours: ['add-task'] },
            { id: 'data', index: 2, title: 'Where the data lives', minutes: 6, stale: false, tours: [] },
        ],
    };

    test('the shelf lists chapters only — no START HERE card, tours chip or nested tour rows', async () => {
        mocks.book = TOURED;
        mocks.tours = TOURS;
        await renderUnderstandingView();
        await flush();
        // The tours still load on shelf render, so the reader has them.
        expect(loadTours).toHaveBeenCalledWith('owner/repo');
        expect(view().querySelector('.tourStartCard')).toBeNull();
        expect(view().querySelector('.understandingTourChip')).toBeNull();
        expect(view().querySelector('.understandingChapterTours')).toBeNull();
        expect(view().querySelector('.understandingTourRow')).toBeNull();
        expect(view().querySelector('.understandingGoDeeper')).toBeNull();
        expect(view().querySelectorAll('.understandingChapterRow button')).toHaveLength(2);
        expect(view().querySelector('.understandingContinue')).not.toBeNull();
    });
});

describe('ask scope payload', () => {
    const A = { label: 'bootApp', file: 'index.js', symbol: 'bootApp', line: 40, end: 72 };
    const A2 = { label: 'bootApp()', file: 'index.js', symbol: 'bootApp', line: 40, end: 72 };
    const B = { label: 'sw.js', file: 'sw.js', symbol: null, line: 1, end: null };
    const SCOPE_BOOK = {
        chapters: [
            { id: 'one', title: 'First', paragraphs: [[{ t: 'x' }]] },
            {
                id: 'life', title: 'The life of a task',
                paragraphs: [
                    [{ t: 'It starts in ' }, { ref: A }, { t: ' and caches in ' }, { ref: B }, { t: '.' }],
                    [{ t: 'Later ' }, { ref: A2 }, { t: ' runs again.' }],
                ],
            },
            { id: 'three', title: 'Third', paragraphs: [] },
        ],
    };

    test('carries the chapter identity with a 1-based index and the total', () => {
        const scope = buildBookScope('o/r', SCOPE_BOOK, 1);
        expect(scope.repo).toBe('o/r');
        expect(scope.chapter).toEqual({ id: 'life', title: 'The life of a task', index: 2, total: 3 });
    });

    test('flattens each paragraph to plain text, reading ref chips as their labels', () => {
        const scope = buildBookScope('o/r', SCOPE_BOOK, 1);
        expect(scope.prose).toEqual([
            'It starts in bootApp and caches in sw.js.',
            'Later bootApp() runs again.',
        ]);
    });

    test('de-duplicates refs by file + symbol, keeping first-seen order', () => {
        const scope = buildBookScope('o/r', SCOPE_BOOK, 1);
        expect(scope.refs).toEqual([
            { file: 'index.js', symbol: 'bootApp', line: 40, end: 72, label: 'bootApp' },
            { file: 'sw.js', symbol: '', line: 1, label: 'sw.js' },
        ]);
    });

    test('is null for a chapter that does not exist', () => {
        expect(buildBookScope('o/r', SCOPE_BOOK, 7)).toBeNull();
        expect(buildBookScope('o/r', null, 0)).toBeNull();
    });
    test('without a context there are no referrers and no widen index', () => {
        const scope = buildBookScope('o/r', SCOPE_BOOK, 1);
        expect(scope.index).toBeUndefined();
        scope.refs.forEach((r) => expect(r.referrers).toBeUndefined());
    });
});

describe('ask scope referrers and widen index', () => {
    const ref = (file, symbol, line, end) => ({ ref: { label: symbol, file, symbol, line, end } });
    const BOOK = {
        chapters: [
            {
                id: 'map', kind: 'map', title: 'Map',
                paragraphs: [[ref('inject.js', 'dispatchRun', 10, 30)], [ref('index.js', 'bootApp', 40, 72)]],
            },
            {
                id: 'life', title: 'Life',
                paragraphs: [[{ t: 'It starts in ' }, ref('index.js', 'bootApp', 40, 72), { t: ' and ' }, ref('sw.js', 'cacheAll', 3, 9)]],
            },
        ],
    };
    const SYMBOLS = {
        files: {
            'index.js': {
                defs: [
                    { name: 'bootApp', kind: 'function', start: 40, end: 72, parent: null },
                    { name: 'inner', kind: 'function', start: 50, end: 60, parent: 'bootApp' },
                    { name: '_private', kind: 'function', start: 80, end: 82, parent: null },
                ],
                imports: {},
            },
            'sw.js': { defs: [{ name: 'cacheAll', kind: 'function', start: 3, end: 9, parent: null }], imports: {} },
            'inject.js': { defs: [{ name: 'dispatchRun', kind: 'function', start: 10, end: 30, parent: null }], imports: {} },
            'a.js': { defs: [{ name: 'helperA', kind: 'function', start: 1, end: 2, parent: null }], imports: { bootApp: { from: 'index.js', name: 'bootApp' } } },
            'b.js': {
                defs: [{ name: 'helperB', kind: 'function', start: 1, end: 2, parent: null }],
                imports: { start: { from: 'index.js', name: 'bootApp' }, helperA: { from: 'a.js', name: 'helperA' } },
            },
            'c.js': { defs: [], imports: { bootApp: { from: 'other.js', name: 'bootApp' } } },
        },
    };
    const TEXTS = {
        'a.js': ["import { bootApp } from './index.js';", 'bootApp();'],
        'b.js': ["import { bootApp as start } from './index.js';", 'start();', 'const x = 1;', 'start(x);', 'if (y) start();', 'start();'],
    };
    const ctx = (texts) => ({ symbols: SYMBOLS, files: Object.keys(SYMBOLS.files), getLines: (f) => (texts[f] || null) });

    test('web: referrers come from import bindings, with use lines from cached text, most uses first', () => {
        const scope = buildBookScope('o/r', BOOK, 1, ctx(TEXTS));
        const boot = scope.refs.find((r) => r.symbol === 'bootApp');
        // b.js aliases the import; c.js imports a different bootApp and is excluded.
        expect(boot.referrers).toEqual([
            { file: 'b.js', lines: [2, 4, 5] },
            { file: 'a.js', lines: [2] },
        ]);
        // Nobody imports cacheAll, so the ref carries no referrers key.
        expect(scope.refs.find((r) => r.symbol === 'cacheAll').referrers).toBeUndefined();
    });

    test('web: line numbers are omitted for files the viewer has not cached', () => {
        const scope = buildBookScope('o/r', BOOK, 1, ctx({}));
        expect(scope.refs.find((r) => r.symbol === 'bootApp').referrers).toEqual([{ file: 'a.js' }, { file: 'b.js' }]);
    });

    test('caps referrers at 8 per ref and 30 per scope', () => {
        const files = {};
        const refsP = [];
        for (let k = 0; k < 5; k++) {
            files['def' + k + '.js'] = { defs: [{ name: 'f' + k, kind: 'function', start: 1, end: 2, parent: null }], imports: {} };
            refsP.push(ref('def' + k + '.js', 'f' + k, 1, 2));
        }
        for (let i = 0; i < 12; i++) {
            const imports = {};
            for (let k = 0; k < 5; k++) imports['f' + k] = { from: 'def' + k + '.js', name: 'f' + k };
            files['use' + i + '.js'] = { defs: [], imports };
        }
        const book = { chapters: [{ id: 'c', title: 'C', paragraphs: [refsP] }] };
        const scope = buildBookScope('o/r', book, 0, { symbols: { files }, files: [], getLines: () => null });
        const counts = scope.refs.map((r) => (r.referrers || []).length);
        expect(counts).toEqual([8, 8, 8, 6, 0]);
    });

    test('csharp: referrers are cached files naming the symbol as a whole word', () => {
        const cs = {
            files: {
                'Login.cs': { defs: [{ name: 'IsLogOut', kind: 'property', start: 5, end: 5, parent: null }] },
                'Main.cs': { defs: [] },
                'Other.cs': { defs: [] },
                'Far.cs': { defs: [] },
            },
        };
        const texts = {
            'Main.cs': ['class Main {', '  if (form.IsLogOut) return;', '  IsLogOutX = 1;', '}'],
            'Other.cs': ['var y = IsLogOutNot;'],
        };
        const book = { chapters: [{ id: 'c', title: 'C', paragraphs: [[ref('Login.cs', 'IsLogOut', 5, 5)]] }] };
        const scope = buildBookScope('o/r', book, 0, { symbols: cs, files: Object.keys(cs.files), getLines: (f) => texts[f] || null });
        expect(scope.refs[0].referrers).toEqual([{ file: 'Main.cs', lines: [2] }]);
    });

    test('csharp: with nothing cached, files are matched by name and sent without lines', () => {
        const cs = { files: { 'LoginForm.cs': { defs: [] }, 'LoginForm.Designer.cs': { defs: [] }, 'Main.cs': { defs: [] } } };
        const book = { chapters: [{ id: 'c', title: 'C', paragraphs: [[ref('LoginForm.cs', 'LoginForm', 1, 40)]] }] };
        const scope = buildBookScope('o/r', book, 0, { symbols: cs, files: [], getLines: () => null });
        expect(scope.refs[0].referrers).toEqual([{ file: 'LoginForm.Designer.cs' }]);
    });

    test('the widen index lists top-level definitions outside the chapter, map picks first', () => {
        const scope = buildBookScope('o/r', BOOK, 1, ctx(TEXTS));
        expect(scope.index[0]).toEqual({ file: 'inject.js', symbol: 'dispatchRun', line: 10, end: 30 });
        const names = scope.index.map((e) => e.symbol);
        // Chapter refs, nested defs and `_` names are never in it.
        expect(names).not.toContain('bootApp');
        expect(names).not.toContain('cacheAll');
        expect(names).not.toContain('inner');
        expect(names).not.toContain('_private');
        // helperA is imported by b.js, so it ranks ahead of the unimported helperB.
        expect(names.slice(1)).toEqual(['helperA', 'helperB']);
        expect(scope.index[1]).toEqual({ file: 'a.js', symbol: 'helperA', line: 1, end: 2 });
    });

    test('the widen index is capped at 40', () => {
        const defs = [];
        for (let i = 0; i < 60; i++) defs.push({ name: 'n' + i, kind: 'function', start: i + 1, end: i + 1, parent: null });
        const book = { chapters: [{ id: 'c', title: 'C', paragraphs: [[{ t: 'x' }]] }] };
        const scope = buildBookScope('o/r', book, 0, { symbols: { files: { 'big.js': { defs, imports: {} } } }, files: [], getLines: () => null });
        expect(scope.index).toHaveLength(40);
    });
});
