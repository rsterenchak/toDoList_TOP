import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import { buildTaskFilterBar, applyTaskFilter } from '../src/taskFilter.js';
import { getTaskFilter, setTaskFilter } from '../src/prefs.js';


// taskFilter.js's only dependency is prefs (localStorage), so the slice is
// exercised directly against light jsdom rows that mirror the relevant subset
// of buildToDoRow's output: a #toDoChild with an __item anchor carrying the
// title + status, plus the blank-placeholder case (empty title).

function makeMainList() {
    const ml = document.createElement('div');
    ml.id = 'mainList';
    document.body.appendChild(ml);
    return ml;
}

function makeRow(tit, status) {
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = { tit: tit, status: status };
    row.setAttribute('data-value', 'Inbox');
    return row;
}

function pill(bar, key) {
    return bar.querySelector('.taskFilterPill[data-filter="' + key + '"]');
}

function countFor(bar, key) {
    return pill(bar, key).querySelector('.taskFilterCount').textContent;
}

function isHidden(row) {
    return row.classList.contains('taskFilterHidden');
}

beforeEach(() => {
    document.body.innerHTML = '';
    try { localStorage.clear(); } catch (e) { /* ignore */ }
});

afterEach(() => {
    vi.restoreAllMocks();
});


describe('buildTaskFilterBar', () => {
    it('renders three pills with labels and zeroed counts, ALL selected by default', () => {
        const bar = buildTaskFilterBar();
        const pills = bar.querySelectorAll('.taskFilterPill');
        expect(pills.length).toBe(3);
        expect(pill(bar, 'all').querySelector('.taskFilterPillLabel').textContent).toBe('ALL');
        expect(pill(bar, 'active').querySelector('.taskFilterPillLabel').textContent).toBe('Active');
        expect(pill(bar, 'ideas').querySelector('.taskFilterPillLabel').textContent).toBe('Ideas');
        expect(pill(bar, 'all').classList.contains('selected')).toBe(true);
        expect(pill(bar, 'all').getAttribute('aria-pressed')).toBe('true');
    });

    it('marks the persisted filter as the initial selection', () => {
        setTaskFilter('ideas');
        const bar = buildTaskFilterBar();
        expect(pill(bar, 'ideas').classList.contains('selected')).toBe(true);
        expect(pill(bar, 'all').classList.contains('selected')).toBe(false);
    });
});


describe('applyTaskFilter — visible subset (a)', () => {
    it('ALL shows every committed row', () => {
        const ml = makeMainList();
        const a = makeRow('A', 'active');
        const b = makeRow('B', 'in_progress');
        const c = makeRow('C', 'idea');
        ml.append(a, b, c);
        document.body.appendChild(buildTaskFilterBar());

        applyTaskFilter();
        expect(isHidden(a)).toBe(false);
        expect(isHidden(b)).toBe(false);
        expect(isHidden(c)).toBe(false);
    });

    it('Active shows active + in_progress, hides ideas', () => {
        const ml = makeMainList();
        const a = makeRow('A', 'active');
        const b = makeRow('B', 'in_progress');
        const c = makeRow('C', 'idea');
        ml.append(a, b, c);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        pill(bar, 'active').click();
        expect(isHidden(a)).toBe(false);
        expect(isHidden(b)).toBe(false);
        expect(isHidden(c)).toBe(true);
    });

    it('Ideas shows only idea rows', () => {
        const ml = makeMainList();
        const a = makeRow('A', 'active');
        const b = makeRow('B', 'in_progress');
        const c = makeRow('C', 'idea');
        ml.append(a, b, c);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        pill(bar, 'ideas').click();
        expect(isHidden(a)).toBe(true);
        expect(isHidden(b)).toBe(true);
        expect(isHidden(c)).toBe(false);
    });

    it('never hides the blank placeholder row (empty title), under any filter', () => {
        const ml = makeMainList();
        const blank = makeRow('', 'active');
        const idea = makeRow('Idea', 'idea');
        ml.append(blank, idea);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        pill(bar, 'ideas').click();
        expect(isHidden(blank)).toBe(false);
        expect(isHidden(idea)).toBe(false);
    });

    it('carries a row\'s open description / stats drawer with it when hiding', () => {
        const ml = makeMainList();
        const row = makeRow('A', 'active');
        const desc = document.createElement('div');
        desc.id = 'descSibling';
        const stats = document.createElement('div');
        stats.id = 'statsSibling';
        ml.append(row, desc, stats);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        pill(bar, 'ideas').click();
        expect(isHidden(row)).toBe(true);
        expect(desc.classList.contains('taskFilterHidden')).toBe(true);
        expect(stats.classList.contains('taskFilterHidden')).toBe(true);

        pill(bar, 'all').click();
        expect(desc.classList.contains('taskFilterHidden')).toBe(false);
        expect(stats.classList.contains('taskFilterHidden')).toBe(false);
    });
});


describe('applyTaskFilter — counts from the full list regardless of filter (b)', () => {
    it('counts reflect the full task list and do not change when the filter changes', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('A', 'active'),
            makeRow('B', 'active'),
            makeRow('C', 'in_progress'),
            makeRow('D', 'idea'),
            makeRow('E', 'idea'),
            makeRow('F', 'idea'),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        expect(countFor(bar, 'all')).toBe('6');
        expect(countFor(bar, 'active')).toBe('3'); // 2 active + 1 in_progress
        expect(countFor(bar, 'ideas')).toBe('3');

        // Selecting a filter must not change the displayed counts.
        pill(bar, 'ideas').click();
        expect(countFor(bar, 'all')).toBe('6');
        expect(countFor(bar, 'active')).toBe('3');
        expect(countFor(bar, 'ideas')).toBe('3');
    });

    it('treats a row with a missing status as active in the counts', () => {
        const ml = makeMainList();
        ml.append(makeRow('A', undefined), makeRow('B', 'idea'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        expect(countFor(bar, 'all')).toBe('2');
        expect(countFor(bar, 'active')).toBe('1');
        expect(countFor(bar, 'ideas')).toBe('1');
    });
});


describe('filter persistence across reloads (c)', () => {
    it('persists the selected filter so a fresh bar restores it', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        pill(bar, 'active').click();
        expect(getTaskFilter()).toBe('active');

        // Simulate a reload: tear down the DOM, keep localStorage, rebuild.
        document.body.innerHTML = '';
        makeMainList();
        const reloadedBar = buildTaskFilterBar();
        document.body.appendChild(reloadedBar);
        expect(pill(reloadedBar, 'active').classList.contains('selected')).toBe(true);

        applyTaskFilter();
        expect(getTaskFilter()).toBe('active');
    });
});


describe('no data re-fetch on filter change (d)', () => {
    it('selecting a filter and applying it makes no network calls', () => {
        const fetchSpy = vi.fn();
        const original = global.fetch;
        global.fetch = fetchSpy;
        try {
            const ml = makeMainList();
            ml.append(makeRow('A', 'active'), makeRow('B', 'idea'));
            const bar = buildTaskFilterBar();
            document.body.appendChild(bar);

            applyTaskFilter();
            pill(bar, 'active').click();
            pill(bar, 'ideas').click();
            pill(bar, 'all').click();

            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            global.fetch = original;
        }
    });
});


describe('filter-specific empty state', () => {
    it('shows a message when the active filter hides every task, then clears it', () => {
        const ml = makeMainList();
        ml.append(makeRow('A', 'active'), makeRow('B', 'in_progress'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        pill(bar, 'ideas').click();
        const empty = document.getElementById('taskFilterEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('No ideas captured yet.');

        pill(bar, 'all').click();
        expect(document.getElementById('taskFilterEmpty')).toBeNull();
    });

    it('does not show the filter empty state when the project has no tasks at all', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        pill(bar, 'ideas').click();
        expect(document.getElementById('taskFilterEmpty')).toBeNull();
    });
});
