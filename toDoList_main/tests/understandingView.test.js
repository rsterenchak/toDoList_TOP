import { vi } from 'vitest';

// The Understanding view renders the selected project's code book as a shelf:
// the header (repo chip, chapter count + minutes, one generate/stale control),
// a continue card for chapter 1, and the ordered chapter rows — inert in this
// iteration. These tests render fixture books through the real view against
// mocked repo resolution, book loading and Worker calls.

const mocks = vi.hoisted(() => ({
    repo: 'owner/repo',
    book: null,
    active: false,
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
}));

vi.mock('../src/modals.js', () => ({
    showConfirmModal: vi.fn(),
}));

import { renderUnderstandingView, exitUnderstandingView, resetUnderstandingRun } from '../src/understandingView.js';
import { loadBook, resetBookCache } from '../src/codeBook.js';
import { fetchActiveRuns, dispatchBook } from '../src/inject.js';
import { showConfirmModal } from '../src/modals.js';

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

    test('rows and the Read button are inert', async () => {
        mocks.book = CLEAN;
        await renderUnderstandingView();
        const before = view().innerHTML;
        view().querySelector('.understandingChapterRow').click();
        view().querySelector('.understandingReadBtn').click();
        await flush();
        expect(view().innerHTML).toBe(before);
        expect(view().querySelector('.understandingChapterRow button, .understandingChapterRow a')).toBeNull();
        expect(dispatchBook).not.toHaveBeenCalled();
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
