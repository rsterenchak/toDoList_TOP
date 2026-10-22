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

import { renderUnderstandingView, exitUnderstandingView, resetUnderstandingRun } from '../src/understandingView.js';
import { renderCodeViewer, setCodeViewerCloseHandler, clearCodeViewer } from '../src/codeViewer.js';
import { loadManifest } from '../src/claudeSheet.js';
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
