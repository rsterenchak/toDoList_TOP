import { vi } from 'vitest';

// tourPlayer.js plays one code tour: a step's place, title, why and snippet,
// Back / Next within bounds, a tappable segment bar, the recap, and Done. Every
// move saves the step through prefs; Escape closes; "Open in code viewer" hands
// the highlighted span to the caller.

import { openTourPlayer, closeTourPlayer, isTourPlayerOpen, nextLabel, highlightSpan } from '../src/tourPlayer.js';
import { getTourProgress } from '../src/prefs.js';

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

    test('docked in a host it hides the host contents until it closes', () => {
        const host = document.createElement('div');
        host.innerHTML = '<div class="codeViewerPane"></div>';
        document.body.appendChild(host);
        openTourPlayer({ tour: makeTour(), repo: REPO, host: host });
        expect(host.querySelector('.tourPlayer--docked')).toBeTruthy();
        expect(host.classList.contains('is-touring')).toBe(true);
        closeTourPlayer();
        expect(host.querySelector('.tourPlayer')).toBeNull();
        expect(host.classList.contains('is-touring')).toBe(false);
        expect(host.querySelector('.codeViewerPane')).toBeTruthy();
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
