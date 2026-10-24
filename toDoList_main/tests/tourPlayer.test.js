import { vi } from 'vitest';

// tourPlayer.js plays one code tour: a step's place, title, why and snippet,
// Back / Next within bounds, a tappable segment bar, the recap, and Done. Every
// move saves the step through prefs; Escape closes; "Open in code viewer" hands
// the highlighted span to the caller.

// The code viewer is stood in for by a small fake that keeps one open file per
// host, so viewer mode can be checked by what it asked the viewer to do.
const { cv } = vi.hoisted(() => ({ cv: { open: null, host: null, listeners: new Set() } }));

vi.mock('../src/codeViewer.js', () => {
    function paneOf(host) {
        let pane = host.querySelector(':scope > .codeViewerPane');
        if (!pane) {
            pane = document.createElement('div');
            pane.className = 'codeViewerPane';
            pane.appendChild(Object.assign(document.createElement('div'), { className: 'codeViewerBannerSlot' }));
            host.appendChild(pane);
        }
        return pane;
    }
    const notify = () => cv.listeners.forEach((fn) => fn());
    return {
        renderCodeViewer: vi.fn((host, opts) => {
            const pane = paneOf(host);
            pane.hidden = false;
            cv.open = opts.filePath;
            cv.host = host;
            cv.span = { start: opts.startLine, end: opts.endLine };
            notify();
            return pane;
        }),
        clearCodeViewer: vi.fn((host) => {
            paneOf(host).hidden = true;
            cv.open = null;
            notify();
        }),
        setCodeViewerHighlight: vi.fn((host, start, end) => {
            if (cv.host !== host || !cv.open) return false;
            cv.span = { start, end };
            return true;
        }),
        setBanner: vi.fn((host, el) => {
            const slot = paneOf(host).querySelector('.codeViewerBannerSlot');
            slot.replaceChildren(el);
        }),
        clearBanner: vi.fn((host) => {
            const pane = host.querySelector(':scope > .codeViewerPane');
            if (pane) pane.querySelector('.codeViewerBannerSlot').replaceChildren();
        }),
        getOpenCodeViewerFile: vi.fn(() => cv.open),
        getOpenCodeViewerRef: vi.fn(() => (cv.open ? { repo: 'owner/repo', filePath: cv.open, startLine: cv.span.start, endLine: cv.span.end } : null)),
        onCodeViewerChange: vi.fn((fn) => { cv.listeners.add(fn); return () => cv.listeners.delete(fn); }),
    };
});

import { openTourPlayer, closeTourPlayer, isTourPlayerOpen, nextLabel, highlightSpan } from '../src/tourPlayer.js';
import { getTourProgress } from '../src/prefs.js';
import {
    renderCodeViewer, clearCodeViewer, setCodeViewerHighlight, setBanner, clearBanner,
} from '../src/codeViewer.js';

const REPO = 'owner/repo';

function makeTour(overrides) {
    return Object.assign({
        id: 'add-task',
        title: 'Adding a task',
        recap: [{ title: 'One rule', body: 'listLogic changes data.' }],
        steps: [
            {
                file: 'listLogic.js', symbol: 'addToDo', line: 10, area: 'tasks', next: 'buildToDoRow',
                title: 'Step one', why: 'Why one.',
                snippet: [
                    { n: 9, t: 'before', hi: false },
                    { n: 10, t: 'match one', hi: true },
                    { n: 11, t: 'after', hi: false },
                    { gap: true },
                    { n: 20, t: 'match two', hi: true },
                ],
            },
            {
                file: 'toDoRow.js', symbol: 'buildToDoRow', line: 40, area: 'tasks', next: 'buildToDoRow',
                title: 'Step two', why: 'Why two.', snippet: [{ n: 40, t: 'x', hi: true }],
            },
            {
                file: 'main.js', symbol: 'onHydrate', line: 99, area: 'shell', next: null,
                title: 'Step three', why: 'Why three.', snippet: [{ n: 99, t: 'y', hi: true }],
            },
        ],
    }, overrides || {});
}

function q(sel) { return document.querySelector(sel); }
function text(sel) { const n = q(sel); return n ? n.textContent : null; }
function key(k) {
    q('.tourPlayer').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
}

beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    cv.open = null;
    cv.host = null;
    cv.listeners.clear();
    vi.clearAllMocks();
});

afterEach(() => {
    closeTourPlayer();
});

describe('step rendering', () => {
    test('shows the place, title, why, snippet and next hint', () => {
        openTourPlayer({ tour: makeTour(), repo: REPO, areaName: (id) => id === 'tasks' ? 'Tasks' : id });
        expect(q('.tourPlayer--sheet')).toBeTruthy();
        expect(text('.tourPlayerTourTitle')).toBe('Adding a task');
        expect(text('.tourPlayerCount')).toBe('1 / 3');
        expect(text('.tourPlayerArea')).toBe('Tasks');
        expect(text('.tourPlayerLoc')).toBe('listLogic.js › addToDo · 10');
        expect(text('.tourPlayerStepTitle')).toBe('Step one');
        expect(text('.tourPlayerWhy')).toBe('Why one.');
        expect(text('.tourPlayerNextHint')).toBe('Next it calls buildToDoRow');
    });

    test('renders highlighted rows and gap rows', () => {
        openTourPlayer({ tour: makeTour(), repo: REPO });
        const rows = document.querySelectorAll('.tourSnippet > *');
        expect(rows).toHaveLength(5);
        expect(rows[1].classList.contains('is-hi')).toBe(true);
        expect(rows[0].classList.contains('is-hi')).toBe(false);
        expect(rows[3].className).toBe('tourSnippetGap');
        expect(rows[3].textContent).toBe('⋯');
        expect(rows[4].querySelector('.tourSnippetNum').textContent).toBe('20');
        expect(rows[4].querySelector('.tourSnippetText').textContent).toBe('match two');
    });

    test('a next equal to the current symbol reads "further down"; the last step hides it', () => {
        openTourPlayer({ tour: makeTour(), repo: REPO, startStep: 1 });
        expect(text('.tourPlayerNextHint')).toBe('Next: further down in buildToDoRow');
        q('.tourPlayerNext').click();
        expect(q('.tourPlayerNextHint')).toBeNull();
        expect(nextLabel({ symbol: 'a', next: null })).toBe('');
    });
});

describe('navigation', () => {
    test('Back is dimmed and inert on step 1; Next advances', () => {
        openTourPlayer({ tour: makeTour(), repo: REPO });
        const back = q('.tourPlayerBack');
        expect(back.disabled).toBe(true);
        expect(back.classList.contains('is-dim')).toBe(true);
        back.click();
        expect(text('.tourPlayerCount')).toBe('1 / 3');
        q('.tourPlayerNext').click();
        expect(text('.tourPlayerCount')).toBe('2 / 3');
        expect(q('.tourPlayerBack').disabled).toBe(false);
        q('.tourPlayerBack').click();
        expect(text('.tourPlayerCount')).toBe('1 / 3');
    });

    test('the last step offers Recap →, the recap offers Done, and Next stops there', () => {
        openTourPlayer({ tour: makeTour(), repo: REPO, startStep: 2 });
        expect(text('.tourPlayerNext')).toBe('Recap →');
        key('ArrowRight');
        expect(text('.tourPlayerCount')).toBe('Recap');
        expect(text('.tourRecapTitle')).toBe('One rule');
        expect(text('.tourPlayerNext')).toBe('Done');
        key('ArrowRight');
        expect(isTourPlayerOpen()).toBe(true);
        expect(text('.tourPlayerCount')).toBe('Recap');
    });

    test('ArrowLeft / ArrowRight step through the tour', () => {
        openTourPlayer({ tour: makeTour(), repo: REPO });
        key('ArrowRight');
        key('ArrowRight');
        expect(text('.tourPlayerCount')).toBe('3 / 3');
        key('ArrowLeft');
        expect(text('.tourPlayerCount')).toBe('2 / 3');
        key('ArrowLeft');
        key('ArrowLeft');
        expect(text('.tourPlayerCount')).toBe('1 / 3');
    });

    test('a segment tap jumps to that step, and the bar includes the recap', () => {
        const onStep = vi.fn();
        openTourPlayer({ tour: makeTour(), repo: REPO, onStep: onStep });
        const segs = document.querySelectorAll('.tourPlayerSeg');
        expect(segs).toHaveLength(4);
        segs[2].click();
        expect(text('.tourPlayerCount')).toBe('3 / 3');
        expect(segs[2].classList.contains('is-current')).toBe(true);
        expect(onStep).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'onHydrate' }), 2);
        segs[3].click();
        expect(text('.tourPlayerCount')).toBe('Recap');
    });

    test('a recap card without a body renders only its title', () => {
        openTourPlayer({ tour: makeTour({ recap: [{ title: 'Just a title', body: '' }] }), repo: REPO, startStep: 3 });
        const card = q('.tourRecapCard');
        expect(card.querySelector('.tourRecapTitle').textContent).toBe('Just a title');
        expect(card.querySelector('.tourRecapBody')).toBeNull();
        expect(card.children).toHaveLength(1);
    });

    test('a start step past the end clamps to the recap', () => {
        openTourPlayer({ tour: makeTour(), repo: REPO, startStep: 99 });
        expect(text('.tourPlayerCount')).toBe('Recap');
    });

    test('without recap cards the last step ends with Done', () => {
        openTourPlayer({ tour: makeTour({ recap: [] }), repo: REPO, startStep: 2 });
        expect(text('.tourPlayerNext')).toBe('Done');
        expect(document.querySelectorAll('.tourPlayerSeg')).toHaveLength(3);
    });
});

describe('progress and closing', () => {
    test('every move saves the step', () => {
        openTourPlayer({ tour: makeTour(), repo: REPO, startStep: 1 });
        expect(getTourProgress(REPO)['add-task']).toEqual({ step: 1, done: false });
        q('.tourPlayerNext').click();
        expect(getTourProgress(REPO)['add-task']).toEqual({ step: 2, done: false });
        q('.tourPlayerBack').click();
        expect(getTourProgress(REPO)['add-task']).toEqual({ step: 1, done: false });
        document.querySelectorAll('.tourPlayerSeg')[3].click();
        expect(getTourProgress(REPO)['add-task']).toEqual({ step: 3, done: false });
    });

    test('Done on the recap marks the tour done and closes', () => {
        const onDone = vi.fn();
        const onClose = vi.fn();
        openTourPlayer({ tour: makeTour(), repo: REPO, startStep: 3, onDone: onDone, onClose: onClose });
        q('.tourPlayerNext').click();
        expect(getTourProgress(REPO)['add-task']).toEqual({ step: 3, done: true });
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(q('.tourPlayer')).toBeNull();
        expect(isTourPlayerOpen()).toBe(false);
    });

    test('Escape closes and keeps progress', () => {
        const onClose = vi.fn();
        openTourPlayer({ tour: makeTour(), repo: REPO, startStep: 1, onClose: onClose });
        key('Escape');
        expect(q('.tourPlayer')).toBeNull();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(getTourProgress(REPO)['add-task']).toEqual({ step: 1, done: false });
    });

    test('the close button closes too', () => {
        openTourPlayer({ tour: makeTour(), repo: REPO });
        q('.tourPlayerClose').click();
        expect(q('.tourPlayer')).toBeNull();
    });

    test('Open in code viewer passes the highlighted span and closes, keeping progress', () => {
        const onOpenInCode = vi.fn(() => {
            // The player is already gone when the caller opens the file.
            expect(q('.tourPlayer')).toBeNull();
        });
        openTourPlayer({ tour: makeTour(), repo: REPO, onOpenInCode: onOpenInCode });
        q('.tourPlayerOpenCode').click();
        expect(onOpenInCode).toHaveBeenCalledWith(
            expect.objectContaining({ file: 'listLogic.js', symbol: 'addToDo' }),
            { startLine: 10, endLine: 20 }
        );
        expect(getTourProgress(REPO)['add-task']).toEqual({ step: 0, done: false });
        expect(highlightSpan({ line: 5, snippet: [] })).toEqual({ startLine: 5, endLine: 5 });
    });

    test('opening a second tour closes the first', () => {
        const onClose = vi.fn();
        openTourPlayer({ tour: makeTour(), repo: REPO, onClose: onClose });
        openTourPlayer({ tour: makeTour({ id: 'other', title: 'Other' }), repo: REPO });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(document.querySelectorAll('.tourPlayer')).toHaveLength(1);
        expect(text('.tourPlayerTourTitle')).toBe('Other');
    });
});

describe('viewer mode (docked in a code viewer host)', () => {
    // Steps in two files: steps 1 and 2 share listLogic.js, step 3 is in main.js.
    function viewerTour() {
        const t = makeTour();
        t.steps[1] = Object.assign({}, t.steps[1], { file: 'listLogic.js', snippet: [{ n: 34, t: 'z', hi: true }] });
        return t;
    }
    function mountHost(withViewer) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        if (withViewer) renderCodeViewer(host, { filePath: 'src/prior.js', startLine: 7, endLine: 9 });
        vi.clearAllMocks();
        return host;
    }
    function open(host, extra) {
        return openTourPlayer(Object.assign({ tour: viewerTour(), repo: REPO, host: host, srcRoot: 'src' }, extra || {}));
    }
    function bannerKey(k) {
        q('.tourPlayerBanner').dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    }

    test("renders the step's file with its span in the viewer, under the step banner", () => {
        const host = mountHost(false);
        open(host);
        expect(renderCodeViewer).toHaveBeenCalledTimes(1);
        expect(renderCodeViewer).toHaveBeenCalledWith(host, {
            target: { repo: REPO },
            filePath: 'src/listLogic.js',
            srcRoot: 'src',
            startLine: 10,
            endLine: 20,
        });
        const banner = host.querySelector('.codeViewerPane .codeViewerBannerSlot > .tourPlayerBanner');
        expect(banner).toBeTruthy();
        expect(setBanner).toHaveBeenCalledWith(host, banner);
        expect(banner.querySelector('.tourPlayerEyebrow').textContent).toBe('TOUR');
        expect(banner.querySelector('.tourPlayerCount').textContent).toBe('1 / 3');
        expect(banner.querySelector('.tourPlayerTourTitle').textContent).toBe('Adding a task');
        expect(banner.querySelectorAll('.tourPlayerSeg')).toHaveLength(4);
        expect(banner.querySelector('.tourPlayerStepTitle').textContent).toBe('Step one');
        expect(banner.querySelector('.tourPlayerWhy').textContent).toBe('Why one.');
        // It is the viewer: no snippet and no "Open in code viewer".
        expect(banner.querySelector('.tourSnippet')).toBeNull();
        expect(host.querySelector('.tourPlayerOpenCode')).toBeNull();
        expect(host.classList.contains('is-touring')).toBe(true);
        expect(document.activeElement).toBe(banner);
    });

    test('a step in the same file moves the highlight without re-rendering', () => {
        const host = mountHost(false);
        open(host);
        q('.tourPlayerNext').click();
        expect(text('.tourPlayerCount')).toBe('2 / 3');
        expect(renderCodeViewer).toHaveBeenCalledTimes(1);
        expect(setCodeViewerHighlight).toHaveBeenLastCalledWith(host, 34, 34);
    });

    test('a step in another file re-renders the viewer with that file', () => {
        const host = mountHost(false);
        open(host, { startStep: 1 });
        renderCodeViewer.mockClear();
        q('.tourPlayerNext').click();
        expect(renderCodeViewer).toHaveBeenCalledTimes(1);
        expect(renderCodeViewer.mock.calls[0][1]).toMatchObject({ filePath: 'src/main.js', startLine: 99, endLine: 99 });
        expect(renderCodeViewer.mock.calls[0][1].keepTrail).toBeUndefined();
        expect(host.querySelector('.tourPlayerBanner .tourPlayerStepTitle').textContent).toBe('Step three');
    });

    test('after wandering to another file, Next brings the step file back', () => {
        const host = mountHost(false);
        open(host);
        // The reader traced off into another file under the banner.
        cv.open = 'src/elsewhere.js';
        renderCodeViewer.mockClear();
        q('.tourPlayerNext').click();
        expect(renderCodeViewer).toHaveBeenCalledTimes(1);
        expect(renderCodeViewer.mock.calls[0][1]).toMatchObject({ filePath: 'src/listLogic.js', startLine: 34 });
    });

    test('ArrowLeft / ArrowRight step while the banner has focus, Escape closes', () => {
        const host = mountHost(false);
        open(host);
        bannerKey('ArrowRight');
        bannerKey('ArrowRight');
        expect(text('.tourPlayerCount')).toBe('3 / 3');
        bannerKey('ArrowLeft');
        expect(text('.tourPlayerCount')).toBe('2 / 3');
        bannerKey('Escape');
        expect(isTourPlayerOpen()).toBe(false);
        expect(q('.tourPlayerBanner')).toBeNull();
    });

    test('closing restores the file the viewer had before the tour', () => {
        const host = mountHost(true);
        const onClose = vi.fn();
        open(host, { onClose: onClose });
        expect(cv.open).toBe('src/listLogic.js');
        q('.tourPlayerClose').click();
        expect(clearBanner).toHaveBeenCalledWith(host);
        expect(renderCodeViewer).toHaveBeenLastCalledWith(host, { repo: 'owner/repo', filePath: 'src/prior.js', startLine: 7, endLine: 9 });
        expect(cv.open).toBe('src/prior.js');
        expect(host.classList.contains('is-touring')).toBe(false);
        expect(host.querySelector('.tourPlayerBanner')).toBeNull();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    test('closing with no file before clears the viewer and removes what the tour mounted', () => {
        const host = mountHost(false);
        open(host);
        closeTourPlayer();
        expect(clearCodeViewer).toHaveBeenCalledWith(host);
        expect(host.querySelector('.codeViewerPane')).toBeNull();
        expect(host.classList.contains('is-touring')).toBe(false);
    });

    test('the recap renders in the banner with Done, which marks the tour done', () => {
        const host = mountHost(false);
        open(host, { startStep: 3 });
        expect(text('.tourPlayerBanner .tourPlayerStepTitle')).toBe('Recap');
        expect(q('.tourPlayerBanner .tourRecapCard')).toBeTruthy();
        // The viewer still shows the last step's file beneath it.
        expect(cv.open).toBe('src/main.js');
        q('.tourPlayerNext').click();
        expect(getTourProgress(REPO)['add-task']).toEqual({ step: 3, done: true });
        expect(isTourPlayerOpen()).toBe(false);
    });

    test('the viewer closed out from under the tour closes the tour without restoring', () => {
        const host = mountHost(true);
        const onClose = vi.fn();
        open(host, { onClose: onClose });
        renderCodeViewer.mockClear();
        clearCodeViewer(host);
        expect(isTourPlayerOpen()).toBe(false);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(renderCodeViewer).not.toHaveBeenCalled();
    });

    test('a srcRoot promise defers the first render until it resolves', async () => {
        const host = mountHost(false);
        open(host, { srcRoot: Promise.resolve('toDoList_main/src') });
        expect(renderCodeViewer).not.toHaveBeenCalled();
        await Promise.resolve();
        await Promise.resolve();
        expect(renderCodeViewer).toHaveBeenCalledTimes(1);
        expect(renderCodeViewer.mock.calls[0][1].filePath).toBe('toDoList_main/src/listLogic.js');
    });
});
