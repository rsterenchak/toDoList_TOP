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
}));

vi.mock('../src/seedTasksModal.js', () => ({
    resolveProjectRepo: vi.fn(() => mocks.repo),
}));

vi.mock('../src/codeBook.js', async () => {
    const actual = await vi.importActual('../src/codeBook.js');
    return {
        bookStats: actual.bookStats,
        loadBook: vi.fn(() => Promise.resolve(mocks.book)),
        resetBookCache: vi.fn(),
    };
});

vi.mock('../src/inject.js', () => ({
    getCachedTargets: vi.fn(() => [{ repo: 'owner/repo', file_path: 'TODO.md' }]),
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
import { loadBook, resetBookCache } from '../src/codeBook.js';
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
    test('when the book run finishes the cache is reset and the shelf re-renders', async () => {
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
            mocks.book = CLEAN;
            await vi.advanceTimersByTimeAsync(5000);
            expect(resetBookCache).toHaveBeenCalled();
            expect(control().textContent).toBe('Regenerate');
            expect(view().querySelector('.understandingNote').textContent).toMatch(/~1 min/);
            expect(view().querySelectorAll('.understandingChapterRow')).toHaveLength(3);
        } finally {
            vi.useRealTimers();
        }
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

describe('tours on the shelf', () => {
    const tstep = (file, symbol, line, area) => ({
        file, symbol, line, area, next: null, title: symbol + ' title', why: symbol + ' why',
        snippet: [{ n: line, t: symbol + '()', hi: true }],
    });
    const TOURS = {
        sections: [{ id: 'tasks', title: 'Tasks & projects' }],
        tours: [
            {
                id: 'add-task', section: 'tasks', title: 'Adding a task', recap: [{ title: 'R', body: 'r' }],
                steps: [
                    tstep('listLogic.js', 'addToDo', 10, 'tasks'),
                    tstep('toDoRow.js', 'buildToDoRow', 20, 'tasks'),
                    tstep('inject.js', 'postToWorker', 30, 'pipeline'),
                    tstep('listLogic.js', 'persistMutation', 40, 'tasks'),
                ],
            },
            {
                id: 'second', section: 'tasks', title: 'Second tour', recap: [],
                steps: [tstep('listLogic.js', 'a', 1, 'tasks'), tstep('listLogic.js', 'b', 2, 'tasks'), tstep('listLogic.js', 'c', 3, 'tasks')],
            },
        ],
    };
    // The compiled book carries `{ id, title, steps }` refs; ids alone resolve too.
    const TOURED = {
        title: 'Understanding Void',
        chapters: [
            { id: 'app-starts', index: 1, title: 'How the app starts', minutes: 4, stale: false,
                tours: [{ id: 'add-task', title: 'Adding a task', steps: 4 }, 'gone-tour'] },
            { id: 'data', index: 2, title: 'Where the data lives', minutes: 6, stale: false, tours: [] },
            { id: 'pipeline', index: 3, title: 'The pipeline', minutes: 5, stale: false, tours: ['second'] },
        ],
    };
    const realInnerWidth = window.innerWidth;
    function setWidth(w) {
        Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
    }
    const card = () => view().querySelector('.tourStartCard');
    const chip = () => view().querySelector('.understandingTourChip');
    const sheet = () => document.getElementById('understandingToursSheet');
    async function render() {
        await renderUnderstandingView();
        await flush();
    }

    beforeEach(() => {
        mocks.book = TOURED;
        mocks.tours = TOURS;
        setWidth(500);
    });
    afterEach(() => {
        closeTourPlayer();
        if (sheet()) sheet().hidden = true;
        setWidth(realInnerWidth);
    });

    test('START HERE sits under the Continue card and the chip left of the control', async () => {
        await render();
        expect(loadTours).toHaveBeenCalledWith('owner/repo');
        expect(card().hidden).toBe(false);
        expect(card().previousElementSibling.classList.contains('understandingContinue')).toBe(true);
        expect(card().querySelector('.tourStartEyebrow').textContent).toBe('START HERE');
        expect(card().querySelector('.tourStartMeta').textContent).toBe('0 of 2 · ~2 min left');
        expect(card().querySelector('.tourStartNext').textContent).toBe('Next: Adding a task');
        expect(card().querySelectorAll('.tourStartDot')).toHaveLength(2);
        expect(chip().hidden).toBe(false);
        expect(chip().textContent).toBe('Tours 0/2');
        expect(chip().nextElementSibling).toBe(control());
    });

    test('a repo with no tours shows no card, chip or tour rows', async () => {
        mocks.tours = null;
        await render();
        expect(card().hidden).toBe(true);
        expect(chip().hidden).toBe(true);
        expect(view().querySelector('.understandingChapterTours')).toBeNull();
        expect(view().querySelectorAll('.understandingChapterRow button')).toHaveLength(3);
    });

    test('nested tour rows resolve from chapter.tours, in order, with their state', async () => {
        setTourProgress('owner/repo', { 'add-task': { step: 1, done: false }, second: { step: 2, done: true } });
        await render();
        const rows = view().querySelectorAll('.understandingChapterRow');
        const first = rows[0].querySelectorAll('.understandingTourRow');
        expect(first).toHaveLength(1);
        expect(first[0].querySelector('.understandingTourRowTitle').textContent).toBe('Adding a task');
        expect(first[0].querySelector('.understandingTourRowMeta').textContent).toBe('step 2 / 4');
        expect(first[0].querySelector('.tourGlyph').classList.contains('is-progress')).toBe(true);
        expect(rows[1].querySelector('.understandingChapterTours')).toBeNull();
        const third = rows[2].querySelectorAll('.understandingTourRow');
        expect(third).toHaveLength(1);
        expect(third[0].classList.contains('is-done')).toBe(true);
        expect(third[0].querySelector('.understandingTourRowMeta').textContent).toBe('3 STEPS');
        expect(chip().textContent).toBe('Tours 1/2');
    });

    test('Continue resumes the next tour at its saved step without opening the reader', async () => {
        setTourProgress('owner/repo', { 'add-task': { step: 2, done: false } });
        await render();
        card().querySelector('.tourStartContinue').click();
        const player = document.querySelector('.tourPlayer--sheet');
        expect(player).toBeTruthy();
        expect(player.querySelector('.tourPlayerCount').textContent).toBe('3 / 4');
        expect(view().classList.contains('is-reading')).toBe(false);
        expect(view().querySelector('.understandingShelf')).not.toBeNull();
    });

    test('dismissing the card is remembered; the chip opens All tours, whose row starts a tour', async () => {
        setTourProgress('owner/repo', { 'add-task': { step: 1, done: false }, second: { step: 0, done: true } });
        await render();
        card().querySelector('.tourStartHide').click();
        expect(isTourCardHidden('owner/repo')).toBe(true);
        expect(card().hidden).toBe(true);
        expect(chip().hidden).toBe(false);
        await render();
        expect(card().hidden).toBe(true);

        chip().click();
        expect(sheet().hidden).toBe(false);
        expect(sheet().classList.contains('understandingToursSheet')).toBe(true);
        expect(sheet().querySelector('.tourAllTitle').textContent).toBe('Learn this codebase');
        expect(sheet().querySelector('.tourAllSectionHead').textContent).toBe('Tasks & projects1 / 2');
        const rows = sheet().querySelectorAll('.tourAllRow');
        expect(rows[0].querySelector('.tourAllRowMeta').textContent).toBe('step 2 / 4');
        expect(rows[1].querySelector('.tourGlyph').classList.contains('is-done')).toBe(true);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(sheet().hidden).toBe(true);

        chip().click();
        sheet().querySelector('.tourAllClose').click();
        expect(sheet().hidden).toBe(true);

        chip().click();
        sheet().querySelectorAll('.tourAllRow')[1].click();
        expect(sheet().hidden).toBe(true);
        expect(document.querySelector('.tourPlayerTourTitle').textContent).toBe('Second tour');
        expect(getTourProgress('owner/repo').second.step).toBe(0);
    });

    test('a shelf tour docks in the shelf code pane on desktop and opens its code there', async () => {
        setWidth(1300);
        await render();
        view().querySelector('.understandingTourRow').click();
        const opts = openTourPlayer.mock.calls[0][0];
        const pane = view().querySelector('.understandingShelfBody > .understandingCodePane');
        expect(pane).not.toBeNull();
        expect(opts.host).toBe(pane);
        expect(opts.onStep).toBeUndefined();
        expect(typeof opts.onOpenInCode).toBe('function');
        expect(pane.classList.contains('is-touring')).toBe(true);
        expect(pane.querySelector('.tourPlayer--docked')).toBeTruthy();
        expect(view().classList.contains('is-reading')).toBe(false);

        // Open in code viewer closes the tour and renders the step's span in the pane.
        document.querySelector('.tourPlayerOpenCode').click();
        await flush();
        expect(pane.classList.contains('is-touring')).toBe(false);
        const call = renderCodeViewer.mock.calls[renderCodeViewer.mock.calls.length - 1];
        expect(call[0]).toBe(view().querySelector('.understandingShelfBody > .understandingCodePane'));
        expect(call[1]).toMatchObject({
            target: { repo: 'owner/repo' },
            filePath: 'src/listLogic.js',
            startLine: 10,
            endLine: 10,
            banner: 'addToDo title',
        });
    });

    test('on mobile the tour is a sheet, and closing it repaints the tour surfaces', async () => {
        await render();
        view().querySelectorAll('.understandingChapterRow')[2].querySelector('.understandingTourRow').click();
        expect(openTourPlayer.mock.calls[0][0].host).toBeNull();
        expect(view().querySelector('.understandingCodePane')).toBeNull();
        const next = () => document.querySelector('.tourPlayerNext');
        next().click();
        next().click();
        next().click(); // Done on the last step marks the tour done.
        expect(document.querySelector('.tourPlayer')).toBeFalsy();
        expect(chip().textContent).toBe('Tours 1/2');
        const done = view().querySelectorAll('.understandingChapterRow')[2].querySelector('.understandingTourRow');
        expect(done.classList.contains('is-done')).toBe(true);
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
});
