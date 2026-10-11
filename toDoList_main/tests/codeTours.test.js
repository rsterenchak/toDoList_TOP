import { vi } from 'vitest';

// codeTours.js loads a repo's src-tours.json once per session (failing soft to
// null) and answers the tour surfaces' questions: a tour's area, the next
// unfinished tour, and overall progress. Progress itself round-trips through
// the prefs accessors.

vi.mock('../src/structureRemoteCapture.js', () => ({
    pagesUrlFor: vi.fn(function (repo) {
        const parts = String(repo || '').split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
        return 'https://' + parts[0] + '.github.io/' + parts[1] + '/';
    }),
}));

import { loadTours, resetTourCache, tourArea, nextUnfinished, orderedTours, tourStats } from '../src/codeTours.js';
import { getTourProgress, setTourProgress, TOUR_PROGRESS_KEY, isTourCardHidden, setTourCardHidden } from '../src/prefs.js';

const step = (area) => ({ file: 'a.js', symbol: 's', line: 1, area: area, snippet: [] });

const DATA = {
    sections: [{ id: 'foundations', title: 'Foundations' }, { id: 'tasks', title: 'Tasks' }],
    tours: [
        { id: 't-tasks', section: 'tasks', title: 'Tasks tour', steps: [step('tasks'), step('tasks'), step('tasks'), step('tasks')] },
        { id: 't-found-1', section: 'foundations', title: 'F1', steps: [step('shell'), step('shell'), step('shell')] },
        { id: 't-found-2', section: 'foundations', title: 'F2', steps: [step('data'), step('data'), step('data')] },
    ],
};

afterEach(() => {
    resetTourCache();
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe('loadTours', () => {
    test('fetches src-tours.json from the repo Pages URL once per repo', async () => {
        const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(DATA) }));
        vi.stubGlobal('fetch', fetchMock);
        const a = await loadTours('owner/repo');
        const b = await loadTours('owner/repo');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('https://owner.github.io/repo/src-tours.json');
        expect(a.tours).toHaveLength(3);
        expect(b).toBe(a);
    });

    test('a 404 yields null', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404 })));
        await expect(loadTours('owner/repo')).resolves.toBeNull();
    });

    test('a parse failure yields null', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('bad')) })));
        await expect(loadTours('owner/repo')).resolves.toBeNull();
    });

    test('a network failure or a document without tours yields null', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
        await expect(loadTours('owner/a')).resolves.toBeNull();
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: 1 }) })));
        await expect(loadTours('owner/b')).resolves.toBeNull();
    });

    test('a malformed repo yields null without fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(loadTours('not-a-repo')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('tourArea', () => {
    test('the most common area wins', () => {
        expect(tourArea({ steps: [step('shell'), step('tasks'), step('tasks')] })).toBe('tasks');
    });

    test('a tie goes to the first step\'s area', () => {
        expect(tourArea({ steps: [step('shell'), step('tasks'), step('tasks'), step('shell')] })).toBe('shell');
        expect(tourArea({ steps: [step('tasks'), step('shell')] })).toBe('tasks');
    });

    test('a tie the first step is not part of goes to the tied area seen first', () => {
        expect(tourArea({ steps: [step('data'), step('shell'), step('tasks'), step('tasks'), step('shell')] })).toBe('shell');
    });

    test('steps without an area are ignored; none at all is null', () => {
        expect(tourArea({ steps: [step(null), step('tasks')] })).toBe('tasks');
        expect(tourArea({ steps: [step(null)] })).toBeNull();
    });
});

describe('nextUnfinished', () => {
    test('orders by section, then file order', () => {
        expect(orderedTours(DATA).map((t) => t.id)).toEqual(['t-found-1', 't-found-2', 't-tasks']);
        expect(nextUnfinished(DATA, {}).id).toBe('t-found-1');
    });

    test('skips done tours, not ones in progress', () => {
        expect(nextUnfinished(DATA, { 't-found-1': { step: 2, done: true }, 't-found-2': { step: 1, done: false } }).id).toBe('t-found-2');
        expect(nextUnfinished(DATA, { 't-found-1': { step: 0, done: true }, 't-found-2': { step: 0, done: true } }).id).toBe('t-tasks');
    });

    test('null once every tour is done, or with no tours', () => {
        const all = {};
        DATA.tours.forEach((t) => { all[t.id] = { step: 0, done: true }; });
        expect(nextUnfinished(DATA, all)).toBeNull();
        expect(nextUnfinished(null, {})).toBeNull();
    });

    test('tours in an unknown section come last', () => {
        const data = { sections: DATA.sections, tours: [{ id: 'x', section: 'nope', title: 'X', steps: [step('a')] }].concat(DATA.tours) };
        expect(orderedTours(data).map((t) => t.id)).toEqual(['t-found-1', 't-found-2', 't-tasks', 'x']);
    });
});

describe('tourStats', () => {
    test('counts done tours and ~1 minute per 4 remaining steps', () => {
        expect(tourStats(DATA, {})).toEqual({ done: 0, total: 3, minutesLeft: 3 });
        expect(tourStats(DATA, { 't-found-1': { step: 0, done: true }, 't-tasks': { step: 3, done: false } }))
            .toEqual({ done: 1, total: 3, minutesLeft: 1 });
    });
});

describe('tour progress prefs', () => {
    test('round-trips per repo under one todoapp_tourProgress key', () => {
        setTourProgress('o/a', { t1: { step: 3, done: false } });
        setTourProgress('o/b', { t1: { step: 0, done: true } });
        expect(getTourProgress('o/a')).toEqual({ t1: { step: 3, done: false } });
        expect(getTourProgress('o/b')).toEqual({ t1: { step: 0, done: true } });
        expect(Object.keys(JSON.parse(localStorage.getItem(TOUR_PROGRESS_KEY)))).toEqual(['o/a', 'o/b']);
        expect(TOUR_PROGRESS_KEY).toBe('todoapp_tourProgress');
    });

    test('a missing or corrupt store reads as empty', () => {
        expect(getTourProgress('o/a')).toEqual({});
        localStorage.setItem(TOUR_PROGRESS_KEY, '{not json');
        expect(getTourProgress('o/a')).toEqual({});
    });

    test('card dismissal is per repo', () => {
        setTourCardHidden('o/a', true);
        expect(isTourCardHidden('o/a')).toBe(true);
        expect(isTourCardHidden('o/b')).toBe(false);
        setTourCardHidden('o/a', false);
        expect(isTourCardHidden('o/a')).toBe(false);
    });
});
