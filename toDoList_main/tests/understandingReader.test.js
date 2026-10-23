import { vi } from 'vitest';

// The Understanding reader: one chapter at a time from src-book.json — text and
// ref chips, the AHEAD callout, prev/next, the back chip, chip taps opening the
// code viewer, and the reading position recorded as paragraphs scroll by. The
// real view renders against mocked repo resolution, book loading, manifest and
// code viewer; the progress store is real, with Supabase stubbed out.

const mocks = vi.hoisted(() => ({ book: null, observers: [] }));

vi.mock('../src/seedTasksModal.js', () => ({
    resolveProjectRepo: vi.fn(() => 'owner/repo'),
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
    getCachedTargets: vi.fn(() => []),
    fetchActiveRuns: vi.fn(() => Promise.resolve({ ok: true, active: false })),
    dispatchBook: vi.fn(),
    mintEntryId: vi.fn(() => 'cid-1'),
    isInjectConfigured: vi.fn(() => false),
}));

vi.mock('../src/modals.js', () => ({ showConfirmModal: vi.fn() }));

vi.mock('../src/structureRemoteCapture.js', () => ({ pagesUrlFor: vi.fn(() => '') }));

vi.mock('../src/claudeSheet.js', () => ({
    loadManifest: vi.fn(() => Promise.resolve({ ok: true, files: [], srcRoot: 'toDoList_main/src' })),
    openChatWithBookScope: vi.fn(),
}));

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: null } })) },
        from: vi.fn(),
    },
}));

vi.mock('../src/codeViewer.js', () => ({
    renderCodeViewer: vi.fn(),
    clearCodeViewer: vi.fn(),
    onCodeViewerChange: vi.fn(),
    setCodeViewerCloseHandler: vi.fn(),
}));

import { renderUnderstandingView, exitUnderstandingView, resetUnderstandingRun, openBookRefInReader } from '../src/understandingView.js';
import { renderCodeViewer, setCodeViewerCloseHandler, clearCodeViewer } from '../src/codeViewer.js';
import { loadManifest, openChatWithBookScope } from '../src/claudeSheet.js';
import { showConfirmModal } from '../src/modals.js';
import { getBookProgress } from '../src/prefs.js';
import { resetBookProgress } from '../src/bookProgress.js';

// Captured at import, before any clearAllMocks.
const closeHandler = setCodeViewerCloseHandler.mock.calls[0][0];

const REF = { label: 'bootApp', file: 'index.js', symbol: 'bootApp', parent: null, line: 40, end: 72 };
const FILE_REF = { label: 'sw.js', file: 'sw.js', symbol: null, parent: null, line: 1, end: null };

const BOOK = {
    title: 'Understanding Void',
    chapters: [
        {
            id: 'app-starts', index: 1, title: 'How the app starts', minutes: 4, stale: false,
            paragraphs: [
                [{ t: 'Everything begins in ' }, { ref: REF }, { t: ' when the page loads.' }],
                [{ t: 'The worker lives in ' }, { ref: FILE_REF }, { t: '.' }],
                [{ t: 'Third paragraph.' }],
                [{ t: 'Fourth paragraph.' }],
            ],
            ahead: { chapter: 'pipeline', title: 'The pipeline', note: 'Runs are the third chapter.' },
        },
        {
            id: 'data', index: 2, title: 'Where the data lives', minutes: 6, stale: false,
            paragraphs: [[{ t: 'Data one.' }], [{ t: 'Data two.' }]],
            ahead: { chapter: 'pipeline', title: 'The pipeline', note: 'Short chapters put it last.' },
        },
        {
            id: 'pipeline', index: 3, title: 'The pipeline', minutes: 5, stale: false,
            paragraphs: [[{ t: 'Pipe one.' }], [{ t: 'Pipe two.' }]],
            ahead: null,
        },
    ],
};

class FakeObserver {
    constructor(cb, opts) {
        this.cb = cb;
        this.opts = opts;
        this.targets = [];
        mocks.observers.push(this);
    }
    observe(el) { this.targets.push(el); }
    disconnect() { this.targets = []; }
    // Report paragraphs `indices` as half visible and every other one as hidden.
    show(indices) {
        this.cb(this.targets.map((el) => {
            const on = indices.includes(Number(el.dataset.paraIndex));
            return { target: el, isIntersecting: on, intersectionRatio: on ? 0.6 : 0 };
        }));
    }
}

const view = () => document.getElementById('understandingView');
const title = () => view().querySelector('.understandingReaderTitle').textContent;
const flush = () => new Promise((r) => setTimeout(r, 0));
const latestObserver = () => mocks.observers[mocks.observers.length - 1];

function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
}

async function openChapter(i) {
    await renderUnderstandingView();
    view().querySelectorAll('.understandingChapterBtn')[i].click();
}

beforeEach(() => {
    mocks.book = BOOK;
    mocks.observers = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    localStorage.clear();
    vi.clearAllMocks();
    setWidth(1300);
    document.body.innerHTML =
        '<div id="mainBar" data-view="understanding"><div id="understandingView"></div></div>' +
        '<div class="selectedProject"><input id="projInput" value="Void"></div>';
});

afterEach(() => {
    exitUnderstandingView();
    resetUnderstandingRun();
    resetBookProgress();
    vi.unstubAllGlobals();
});

describe('paragraphs', () => {
    test('text segments render as text and refs as labelled chips', async () => {
        await openChapter(0);
        const paras = view().querySelectorAll('.understandingPara');
        expect(paras).toHaveLength(4);
        expect(paras[0].textContent).toBe('Everything begins in bootApp when the page loads.');
        const chip = paras[0].querySelector('button.bookRef');
        expect(chip.textContent).toBe('bootApp');
        expect(chip.getAttribute('aria-label')).toBe('Open bootApp in code');
        expect(paras[2].querySelector('.bookRef')).toBeNull();
    });

    test('the top bar shows the back chip, repo, whole-book position and minutes left', async () => {
        await openChapter(1);
        expect(view().querySelector('.understandingBackChip')).not.toBeNull();
        expect(view().querySelector('.understandingReaderTop .understandingRepoChip').textContent).toBe('owner/repo');
        expect(view().querySelector('.understandingReaderPos').textContent).toBe('CH 2 OF 3 · 33%');
        expect(view().querySelector('.understandingReaderLeft').textContent).toBe('~11 MIN LEFT');
        expect(view().querySelector('.understandingReaderBar').getAttribute('aria-valuenow')).toBe('33');
    });
});

describe('ahead callout', () => {
    test('sits after the second paragraph and jumps to its chapter', async () => {
        await openChapter(0);
        const ahead = view().querySelector('.understandingAhead');
        expect(ahead.querySelector('.understandingAheadEyebrow').textContent).toBe('AHEAD → CH 3');
        expect(ahead.querySelector('.understandingAheadNote').textContent).toBe('Runs are the third chapter.');
        expect(ahead.previousElementSibling.dataset.paraIndex).toBe('1');
        expect(ahead.nextElementSibling.dataset.paraIndex).toBe('2');
        ahead.click();
        expect(title()).toBe('The pipeline');
    });

    test('goes at the end of a chapter with fewer than three paragraphs', async () => {
        await openChapter(1);
        const ahead = view().querySelector('.understandingAhead');
        expect(ahead.previousElementSibling.dataset.paraIndex).toBe('1');
        expect(ahead.nextElementSibling).toBeNull();
    });
});

describe('prev / next', () => {
    test('chapter 1 hides prev and names the next chapter', async () => {
        await openChapter(0);
        expect(view().querySelector('.understandingNavPrev').hidden).toBe(true);
        const next = view().querySelector('.understandingNavNext');
        expect(next.textContent).toBe('CH 2 ›Where the data lives');
        next.click();
        expect(title()).toBe('Where the data lives');
        const prev = view().querySelector('.understandingNavPrev');
        expect(prev.hidden).toBe(false);
        expect(prev.textContent).toBe('‹ CH 1How the app starts');
        prev.click();
        expect(title()).toBe('How the app starts');
    });

    test('the last chapter reads Back to shelf and returns to the shelf', async () => {
        await openChapter(2);
        const next = view().querySelector('.understandingNavNext');
        expect(next.textContent).toBe('Back to shelf');
        next.click();
        await flush();
        expect(view().classList.contains('is-reading')).toBe(false);
        expect(view().querySelector('.understandingShelf')).not.toBeNull();
    });

    test('switching chapters records the new chapter at its top', async () => {
        await openChapter(0);
        latestObserver().show([2, 3]);
        view().querySelector('.understandingNavNext').click();
        expect(getBookProgress('owner/repo')).toMatchObject({ chapterId: 'data', paraIndex: 0, pct: 0 });
    });
});

describe('back chip', () => {
    test('returns to a re-rendered shelf with the progress mark current', async () => {
        await openChapter(1);
        view().querySelector('.understandingBackChip').click();
        await flush();
        expect(view().querySelector('.understandingReader')).toBeNull();
        expect(view().querySelector('.understandingContinueEyebrow').textContent).toBe('CONTINUE · CH 2 OF 3');
        expect(view().querySelectorAll('.understandingChapterDone')).toHaveLength(1);
    });

    test('leaving the view drops the reader, so the tab reopens on the shelf', async () => {
        await openChapter(1);
        exitUnderstandingView();
        expect(view().classList.contains('is-reading')).toBe(false);
        await renderUnderstandingView();
        expect(view().querySelector('.understandingShelf')).not.toBeNull();
    });
});

describe('reading position', () => {
    test('the topmost half-visible paragraph is recorded with its pct', async () => {
        await openChapter(0);
        latestObserver().show([2, 3]);
        expect(getBookProgress('owner/repo')).toMatchObject({ chapterId: 'app-starts', paraIndex: 2, pct: 0.5 });
        expect(view().querySelector('.understandingReaderPos').textContent).toBe('CH 1 OF 3 · 17%');
    });

    test('Read resumes the saved paragraph', async () => {
        await openChapter(0);
        latestObserver().show([3]);
        view().querySelector('.understandingBackChip').click();
        await flush();
        view().querySelector('.understandingReadBtn').click();
        expect(title()).toBe('How the app starts');
        expect(getBookProgress('owner/repo').paraIndex).toBe(3);
    });
});

describe('ref chips open the code viewer', () => {
    test('a definition ref opens its file at the span, labelled, in a pane beside the column on desktop', async () => {
        await openChapter(0);
        view().querySelector('.bookRef').click();
        await flush();
        expect(loadManifest).toHaveBeenCalledWith('owner/repo');
        const pane = view().querySelector('.understandingCodePane');
        expect(pane).not.toBeNull();
        expect(pane.parentElement.classList.contains('has-code')).toBe(true);
        expect(renderCodeViewer).toHaveBeenCalledWith(pane, {
            target: { repo: 'owner/repo' },
            filePath: 'toDoList_main/src/index.js',
            srcRoot: 'toDoList_main/src',
            startLine: 40,
            endLine: 72,
            banner: 'bootApp',
        });
    });

    test('a file ref opens the file with no span', async () => {
        await openChapter(0);
        view().querySelectorAll('.bookRef')[1].click();
        await flush();
        const opts = renderCodeViewer.mock.calls[0][1];
        expect(opts.filePath).toBe('toDoList_main/src/sw.js');
        expect(opts.startLine).toBeUndefined();
        expect(opts.banner).toBeUndefined();
    });

    test('closing the desktop pane removes it and the reader widens back', async () => {
        await openChapter(0);
        view().querySelector('.bookRef').click();
        await flush();
        const pane = view().querySelector('.understandingCodePane');
        expect(closeHandler(pane)).toBe(true);
        expect(clearCodeViewer).toHaveBeenCalledWith(pane);
        expect(view().querySelector('.understandingCodePane')).toBeNull();
        expect(view().querySelector('.understandingReaderBody').classList.contains('has-code')).toBe(false);
        expect(closeHandler(document.createElement('div'))).toBe(false);
    });

    test('on mobile a ref opens the full-screen code sheet', async () => {
        setWidth(390);
        await openChapter(0);
        view().querySelector('.bookRef').click();
        await flush();
        const sheet = document.getElementById('understandingCodeSheet');
        expect(sheet).not.toBeNull();
        expect(sheet.className).toBe('structureCodeSheet');
        const host = sheet.querySelector('.structureCodeSheetPanel > .structureCodeSheetHost');
        expect(renderCodeViewer.mock.calls[0][0]).toBe(host);
        expect(view().querySelector('.understandingCodePane')).toBeNull();
        expect(closeHandler(host)).toBe(true);
        expect(sheet.hidden).toBe(true);
    });
});

describe('bookmarks', () => {
    const marks = () => JSON.parse(localStorage.getItem('todoapp_bookBookmarks') || '{}')['owner/repo'] || [];
    const chip = () => view().querySelector('.understandingMarksChip');
    const badge = () => chip().querySelector('.understandingMarksBadge');

    test('the ribbon toggles the paragraph class and the store, without moving the position', async () => {
        await openChapter(0);
        latestObserver().show([2]);
        const p = view().querySelectorAll('.understandingPara')[1];
        const ribbon = p.querySelector('.understandingRibbon');
        expect(ribbon.getAttribute('aria-pressed')).toBe('false');
        ribbon.click();
        expect(p.classList.contains('is-bookmarked')).toBe(true);
        expect(ribbon.getAttribute('aria-pressed')).toBe('true');
        expect(marks()).toEqual([expect.objectContaining({ chapterId: 'app-starts', paraIndex: 1, label: 'The worker lives in sw.js.' })]);
        expect(getBookProgress('owner/repo').paraIndex).toBe(2);
        ribbon.click();
        expect(p.classList.contains('is-bookmarked')).toBe(false);
        expect(marks()).toEqual([]);
    });

    test('a ~500ms long-press toggles the bookmark on touch', async () => {
        vi.useFakeTimers();
        try {
            setWidth(390);
            const p0 = renderUnderstandingView();
            await vi.advanceTimersByTimeAsync(0);
            await p0;
            view().querySelectorAll('.understandingChapterBtn')[0].click();
            const p = view().querySelectorAll('.understandingPara')[2];
            const touch = (type, x) => {
                const ev = new Event(type, { bubbles: true, cancelable: true });
                ev.touches = x === undefined ? [] : [{ clientX: x, clientY: 10 }];
                p.dispatchEvent(ev);
                return ev;
            };
            touch('touchstart', 10);
            vi.advanceTimersByTime(300);
            touch('touchend');
            expect(p.classList.contains('is-bookmarked')).toBe(false);

            touch('touchstart', 10);
            vi.advanceTimersByTime(500);
            expect(p.classList.contains('is-bookmarked')).toBe(true);
            expect(touch('touchend').defaultPrevented).toBe(true);
            expect(marks()[0]).toMatchObject({ chapterId: 'app-starts', paraIndex: 2 });

            touch('touchstart', 10);
            touch('touchmove', 40);
            vi.advanceTimersByTime(600);
            expect(p.classList.contains('is-bookmarked')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    test('the top-bar chip counts bookmarks, its badge hidden at zero', async () => {
        await openChapter(0);
        expect(badge().hidden).toBe(true);
        expect(chip().getAttribute('aria-label')).toBe('Bookmarks, 0 saved');
        view().querySelectorAll('.understandingRibbon')[0].click();
        view().querySelectorAll('.understandingRibbon')[3].click();
        expect(badge().hidden).toBe(false);
        expect(badge().textContent).toBe('2');
        expect(chip().getAttribute('aria-label')).toBe('Bookmarks, 2 saved');
    });

    test('a marked paragraph renders marked when its chapter reopens', async () => {
        await openChapter(1);
        view().querySelectorAll('.understandingRibbon')[1].click();
        view().querySelector('.understandingNavPrev').click();
        view().querySelector('.understandingNavNext').click();
        expect(view().querySelectorAll('.understandingPara')[1].classList.contains('is-bookmarked')).toBe(true);
        expect(view().querySelectorAll('.understandingPara')[0].classList.contains('is-bookmarked')).toBe(false);
    });

    test('the desktop list groups by chapter; a row opens its chapter, scrolls to and pulses the paragraph', async () => {
        const scrolled = [];
        const orig = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function () { scrolled.push(this); };
        try {
            await openChapter(2);
            view().querySelectorAll('.understandingRibbon')[1].click();
            view().querySelector('.understandingNavPrev').click();
            view().querySelectorAll('.understandingRibbon')[1].click();
            chip().click();
            const pop = view().querySelector('.understandingMarksPopover');
            expect(pop).not.toBeNull();
            expect(chip().getAttribute('aria-expanded')).toBe('true');
            expect(Array.from(pop.querySelectorAll('.understandingBookmarkGroup')).map((g) => g.textContent))
                .toEqual(['CH 2 · Where the data lives', 'CH 3 · The pipeline']);
            const rows = pop.querySelectorAll('.understandingBookmarkBtn');
            expect(rows[1].querySelector('.understandingBookmarkLabel').textContent).toBe('Pipe two.');
            expect(rows[1].querySelector('.understandingBookmarkCh').textContent).toBe('CH 3');
            rows[1].click();
            expect(view().querySelector('.understandingMarksPopover')).toBeNull();
            expect(title()).toBe('The pipeline');
            const target = view().querySelectorAll('.understandingPara')[1];
            expect(scrolled).toContain(target);
            expect(target.classList.contains('is-pulse')).toBe(true);
        } finally {
            Element.prototype.scrollIntoView = orig;
        }
    });

    test('the desktop list closes on its ✕, an outside click and Escape', async () => {
        await openChapter(0);
        chip().click();
        view().querySelector('.understandingMarksClose').click();
        expect(view().querySelector('.understandingMarksPopover')).toBeNull();
        chip().click();
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(view().querySelector('.understandingMarksPopover')).toBeNull();
        chip().click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(view().querySelector('.understandingMarksPopover')).toBeNull();
        expect(chip().getAttribute('aria-expanded')).toBe('false');
    });

    test('on mobile the list opens in the bottom sheet, which closes on its ✕, backdrop and Escape', async () => {
        setWidth(390);
        await openChapter(0);
        view().querySelectorAll('.understandingRibbon')[0].click();
        chip().click();
        const sheet = document.getElementById('understandingBookmarksSheet');
        expect(sheet.classList.contains('understandingBookmarksSheet')).toBe(true);
        expect(sheet.hidden).toBe(false);
        expect(sheet.querySelectorAll('.understandingBookmarkRow')).toHaveLength(1);
        sheet.querySelector('.understandingMarksClose').click();
        expect(sheet.hidden).toBe(true);
        chip().click();
        sheet.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(sheet.hidden).toBe(true);
        chip().click();
        expect(sheet.hidden).toBe(false);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(sheet.hidden).toBe(true);
    });

    test('a bookmark for a removed chapter is listed under REMOVED CHAPTER with a confirmed delete', async () => {
        localStorage.setItem('todoapp_bookBookmarks', JSON.stringify({
            'owner/repo': [{ repo: 'owner/repo', chapterId: 'gone', paraIndex: 0, label: 'Old words', createdAt: '' }],
        }));
        await openChapter(0);
        expect(badge().textContent).toBe('1');
        chip().click();
        const pop = view().querySelector('.understandingMarksPopover');
        expect(pop.querySelector('.understandingBookmarkGroup.is-removed').textContent).toBe('REMOVED CHAPTER');
        expect(pop.querySelector('.understandingBookmarkRow.is-removed .understandingBookmarkLabel').textContent).toBe('Old words');
        pop.querySelector('.understandingBookmarkDelete').click();
        expect(showConfirmModal).toHaveBeenCalledTimes(1);
        expect(marks()).toHaveLength(1);
        showConfirmModal.mock.calls[0][0].onConfirm();
        expect(marks()).toEqual([]);
        expect(badge().hidden).toBe(true);
    });

    test('a bookmark past its chapter end opens the chapter at the top, no pulse', async () => {
        localStorage.setItem('todoapp_bookBookmarks', JSON.stringify({
            'owner/repo': [{ repo: 'owner/repo', chapterId: 'pipeline', paraIndex: 9, label: 'Was here', createdAt: '' }],
        }));
        await openChapter(0);
        chip().click();
        view().querySelector('.understandingBookmarkBtn').click();
        expect(title()).toBe('The pipeline');
        expect(view().querySelector('.understandingPara.is-pulse')).toBeNull();
        expect(getBookProgress('owner/repo')).toMatchObject({ chapterId: 'pipeline', paraIndex: 0 });
    });
});

describe('ask about this chapter', () => {
    test('the Ask chip sits between the repo chip and the bookmarks chip', async () => {
        await openChapter(0);
        const ask = view().querySelector('.understandingReaderTop .understandingAskChip');
        expect(ask).not.toBeNull();
        expect(ask.getAttribute('aria-label')).toBe('Ask about this chapter');
        expect(ask.previousElementSibling.classList.contains('understandingRepoChip')).toBe(true);
        expect(ask.nextElementSibling.classList.contains('understandingMarksChip')).toBe(true);
    });

    test('tapping it opens the chat scoped to the chapter on screen', async () => {
        await openChapter(0);
        view().querySelector('.understandingNavNext').click();
        view().querySelector('.understandingAskChip').click();
        expect(openChatWithBookScope).toHaveBeenCalledTimes(1);
        const scope = openChatWithBookScope.mock.calls[0][0];
        expect(scope.repo).toBe('owner/repo');
        expect(scope.chapter).toEqual({ id: 'data', title: 'Where the data lives', index: 2, total: 3 });
        expect(scope.prose).toEqual(['Data one.', 'Data two.']);
    });

    test('a scoped reply chip opens in the reader pane while the reader shows its repo', async () => {
        await openChapter(0);
        const handled = openBookRefInReader({ repo: 'owner/repo', file: 'index.js', symbol: 'bootApp', line: 40, end: 72, label: 'bootApp' });
        expect(handled).toBe(true);
        await flush();
        expect(renderCodeViewer).toHaveBeenCalledTimes(1);
        const opts = renderCodeViewer.mock.calls[0][1];
        expect(opts.filePath).toBe('toDoList_main/src/index.js');
        expect(opts.startLine).toBe(40);
        expect(opts.endLine).toBe(72);
        expect(view().querySelector('.understandingCodePane')).not.toBeNull();
    });

    test('a chip for another repo, or with no reader open, falls back to the caller', async () => {
        expect(openBookRefInReader({ repo: 'owner/repo', file: 'index.js', symbol: 'x', line: 1, end: 2 })).toBe(false);
        await openChapter(0);
        expect(openBookRefInReader({ repo: 'other/repo', file: 'index.js', symbol: 'x', line: 1, end: 2 })).toBe(false);
        expect(renderCodeViewer).not.toHaveBeenCalled();
    });
});

describe('map chapter', () => {
    const MAP = {
        id: 'map', index: 1, kind: 'map', title: 'The names you will meet', minutes: 1, stale: false, ahead: null,
        paragraphs: [
            [{ ref: REF }, { t: ' — Builds the page once on load.' }],
            [{ ref: { label: 'saveAll', file: 'listLogic.js', symbol: 'saveAll', parent: null, line: 9, end: 20 } }, { t: ' — Writes every project.' }],
        ],
    };
    const withMap = () => ({ title: BOOK.title, chapters: [MAP].concat(BOOK.chapters) });

    test('renders chip · role rows and no <p> paragraphs', async () => {
        mocks.book = withMap();
        await openChapter(0);
        expect(view().querySelector('.understandingReaderEyebrow').textContent).toBe('MAP · 1 MIN');
        expect(view().querySelectorAll('.understandingReaderCol p')).toHaveLength(0);
        const rows = view().querySelectorAll('.understandingMap > li.understandingMapRow');
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('.understandingMapName button.bookRef').textContent).toBe('bootApp');
        expect(rows[0].querySelector('.understandingMapRole').textContent).toBe('Builds the page once on load.');
        expect(rows[1].dataset.paraIndex).toBe('1');
        expect(view().querySelector('.understandingRibbon')).toBeNull();
    });

    test('a hierarchical map renders area headers, file rows and symbol rows at three levels, and no <p>', async () => {
        const fileRef = (f) => ({ label: f, file: f, symbol: null, parent: null, line: 1, end: null });
        const saveAll = { label: 'saveAll', file: 'listLogic.js', symbol: 'saveAll', parent: null, line: 9, end: 20 };
        const tree = Object.assign({}, MAP, {
            paragraphs: [
                [{ ref: fileRef('index.js') }, { t: ' — Builds the page.' }],
                [{ ref: REF }, { t: ' — Builds the page once on load.' }],
                [{ ref: fileRef('listLogic.js') }, { t: ' — The data model.' }],
                [{ ref: saveAll }, { t: ' — Writes every project.' }],
                [{ ref: fileRef('undoToast.js') }],
            ],
            sections: [
                { area: { id: 'shell', name: 'Shell', purpose: 'The app frame.' }, files: [
                    { ref: fileRef('index.js'), purpose: 'Builds the page.', symbols: [{ ref: REF, role: 'Builds the page once on load.' }] },
                ] },
                { area: { id: 'tasks', name: 'Tasks', purpose: null }, files: [
                    { ref: fileRef('listLogic.js'), purpose: 'The data model.', symbols: [{ ref: saveAll, role: 'Writes every project.' }] },
                    { ref: fileRef('undoToast.js'), purpose: null, symbols: [] },
                ] },
            ],
        });
        mocks.book = { title: BOOK.title, chapters: [tree].concat(BOOK.chapters) };
        await openChapter(0);
        expect(view().querySelectorAll('.understandingReaderCol p')).toHaveLength(0);
        const areas = view().querySelectorAll('.understandingMapTree > section.understandingMapArea');
        expect(Array.from(areas).map((a) => a.querySelector('h3.understandingMapAreaName').textContent)).toEqual(['Shell', 'Tasks']);
        expect(areas[0].querySelector('.understandingMapAreaPurpose').textContent).toBe('The app frame.');
        expect(areas[1].querySelector('.understandingMapAreaPurpose')).toBeNull();
        const files = areas[1].querySelectorAll(':scope > ol.understandingMapFiles > li.understandingMapFile');
        expect(files).toHaveLength(2);
        const fileRow = files[0].querySelector(':scope > .understandingMapFileRow');
        expect(fileRow.querySelector('.understandingMapName button.bookRef').textContent).toBe('listLogic.js');
        expect(fileRow.querySelector('.understandingMapRole').textContent).toBe('The data model.');
        const sym = files[0].querySelector(':scope > ol.understandingMapSymbols > li.understandingMapSymbolRow');
        expect(sym.querySelector('.bookRef').textContent).toBe('saveAll');
        expect(sym.querySelector('.understandingMapRole').textContent).toBe('Writes every project.');
        expect(files[1].querySelector('.understandingMapRole')).toBeNull();
        expect(files[1].querySelector('.understandingMapSymbols')).toBeNull();
        // Rows carry the flat paragraph order: each file, then its names.
        const order = Array.from(view().querySelectorAll('.understandingMapTree [data-para-index]'))
            .map((el) => [el.dataset.paraIndex, el.querySelector('.bookRef').textContent]);
        expect(order).toEqual([['0', 'index.js'], ['1', 'bootApp'], ['2', 'listLogic.js'], ['3', 'saveAll'], ['4', 'undoToast.js']]);
        expect(view().querySelector('.understandingMap')).toBeNull();
        latestObserver().show([3]);
        expect(getBookProgress('owner/repo')).toMatchObject({ chapterId: 'map', paraIndex: 3 });
        sym.querySelector('.bookRef').click();
        await flush();
        expect(renderCodeViewer.mock.calls[0][1]).toMatchObject({ startLine: 9, endLine: 20, banner: 'saveAll' });
    });

    test('a map chip opens the code viewer like a paragraph chip', async () => {
        mocks.book = withMap();
        await openChapter(0);
        view().querySelector('.understandingMapRow .bookRef').click();
        await flush();
        expect(renderCodeViewer.mock.calls[0][1]).toMatchObject({ filePath: 'toDoList_main/src/index.js', startLine: 40, endLine: 72, banner: 'bootApp' });
    });

    test('the shelf numbers the map 00 and the prose chapters from 01', async () => {
        mocks.book = withMap();
        await renderUnderstandingView();
        const nums = Array.from(view().querySelectorAll('.understandingChapterNum')).map((n) => n.textContent);
        expect(nums).toEqual(['00', '01', '02', '03']);
        expect(view().querySelector('.understandingContinueEyebrow').textContent).toBe('START · CH 0 OF 3');
    });

    test('the reader keeps prose chapter numbers after the map', async () => {
        mocks.book = withMap();
        await openChapter(1);
        expect(view().querySelector('.understandingReaderEyebrow').textContent).toBe('CHAPTER 1 · 4 MIN');
        expect(view().querySelector('.understandingReaderPos').textContent).toMatch(/^CH 1 OF 3 · /);
        expect(view().querySelector('.understandingAheadEyebrow').textContent).toBe('AHEAD → CH 3');
        expect(view().querySelector('.understandingNavPrev').textContent).toBe('‹ CH 0The names you will meet');
        expect(view().querySelector('.understandingNavNext').textContent).toBe('CH 2 ›Where the data lives');
    });

    test('the reading position follows map rows as they scroll by', async () => {
        mocks.book = withMap();
        await openChapter(0);
        latestObserver().show([1]);
        expect(view().querySelector('.understandingReaderPos').textContent).toMatch(/^CH 0 OF 3 · /);
        expect(getBookProgress('owner/repo')).toMatchObject({ chapterId: 'map', paraIndex: 1 });
    });
});
