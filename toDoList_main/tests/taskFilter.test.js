import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import { buildTaskFilterBar, applyTaskFilter } from '../src/taskFilter.js';
import { getTaskFilter, setTaskFilter, getTaskSort, setTaskSort } from '../src/prefs.js';


// taskFilter.js's only dependency is prefs (localStorage), so the slice is
// exercised directly against light jsdom rows that mirror the relevant subset
// of buildToDoRow's output: a #toDoChild with an __item anchor carrying the
// title + status, plus the blank-placeholder case (empty title).
//
// The bar is a SINGLE cycle pill (all → active → ideas → all …): each click
// advances the persisted filter one step and repaints the pill's label + count
// in place. The helpers below drive that cycle and read the rendered pill.

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

// The one and only filter control in the bar.
function cyclePill(bar) {
    return bar.querySelector('.taskCyclePill');
}

function pillLabel(bar) {
    return cyclePill(bar).querySelector('.taskFilterPillLabel').textContent;
}

function pillCount(bar) {
    return cyclePill(bar).querySelector('.taskFilterCount').textContent;
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


// (1) DOM shape — the destructive half: exactly one cycle pill, none of the
// old three-pill control set.
describe('buildTaskFilterBar — single cycle pill', () => {
    it('renders exactly one cycle pill and none of the old three filter pills', () => {
        const bar = buildTaskFilterBar();
        // The new control class appears exactly once …
        expect(bar.querySelectorAll('.taskCyclePill').length).toBe(1);
        // … and there are no extra pill buttons hanging around (the old build
        // rendered three .taskFilterPill buttons; now there is one).
        expect(bar.querySelectorAll('.taskFilterPill').length).toBe(1);
        // The old per-filter buttons are gone: no separate all/active/ideas set.
        const filters = bar.querySelectorAll('[data-filter]');
        expect(filters.length).toBe(1);
        expect(bar.querySelectorAll('button').length).toBe(1);
    });

    // (2) Default state proves the prefs round-trip still drives the pill.
    it('paints the default (ALL) filter when no preference is stored', () => {
        const bar = buildTaskFilterBar();
        expect(getTaskFilter()).toBe('all');
        expect(pillLabel(bar)).toBe('ALL');
        expect(cyclePill(bar).getAttribute('data-filter')).toBe('all');
        // The cue glyph is always the trailing character.
        expect(cyclePill(bar).textContent.endsWith('›')).toBe(true);
    });

    it('paints the persisted filter set ahead of mount', () => {
        setTaskFilter('ideas');
        const bar = buildTaskFilterBar();
        expect(pillLabel(bar)).toBe('Ideas');
        expect(cyclePill(bar).getAttribute('data-filter')).toBe('ideas');
        expect(cyclePill(bar).textContent.endsWith('›')).toBe(true);
    });
});


// (3) Cycle order: all → active → ideas → all, and from any start the wrap is
// modulo 3. Each transition writes the new value through prefs (verified via
// the getTaskFilter round-trip) and repaints the pill label in place.
describe('cycle order', () => {
    it('advances all → active → ideas → all on successive clicks', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        expect(getTaskFilter()).toBe('all');
        expect(pillLabel(bar)).toBe('ALL');

        cyclePill(bar).click();
        expect(getTaskFilter()).toBe('active');
        expect(pillLabel(bar)).toBe('Active');

        cyclePill(bar).click();
        expect(getTaskFilter()).toBe('ideas');
        expect(pillLabel(bar)).toBe('Ideas');

        cyclePill(bar).click();
        expect(getTaskFilter()).toBe('all');
        expect(pillLabel(bar)).toBe('ALL');
    });

    it('wraps modulo 3 starting from a persisted active filter', () => {
        setTaskFilter('active');
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // active → ideas
        expect(getTaskFilter()).toBe('ideas');
        cyclePill(bar).click(); // ideas → all
        expect(getTaskFilter()).toBe('all');
        cyclePill(bar).click(); // all → active
        expect(getTaskFilter()).toBe('active');
    });
});


// (4) Filter application: each click re-applies the filter so the correct row
// subset carries the hidden class for the new state.
describe('applyTaskFilter — visible subset', () => {
    it('ALL (default) shows every committed row', () => {
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

        cyclePill(bar).click(); // all → active
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

        cyclePill(bar).click(); // all → active
        cyclePill(bar).click(); // active → ideas
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

        cyclePill(bar).click(); // all → active
        cyclePill(bar).click(); // active → ideas
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

        cyclePill(bar).click(); // all → active
        cyclePill(bar).click(); // active → ideas (hides the active row)
        expect(isHidden(row)).toBe(true);
        expect(desc.classList.contains('taskFilterHidden')).toBe(true);
        expect(stats.classList.contains('taskFilterHidden')).toBe(true);

        cyclePill(bar).click(); // ideas → all (everything visible again)
        expect(desc.classList.contains('taskFilterHidden')).toBe(false);
        expect(stats.classList.contains('taskFilterHidden')).toBe(false);
    });
});


// (4 cont.) Counts come from the full list and are shown for the active filter.
describe('cycle pill count', () => {
    it('shows the active filter\'s count, updating as the filter cycles', () => {
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
        expect(pillLabel(bar)).toBe('ALL');
        expect(pillCount(bar)).toBe('6');

        cyclePill(bar).click(); // → active (2 active + 1 in_progress)
        expect(pillLabel(bar)).toBe('Active');
        expect(pillCount(bar)).toBe('3');

        cyclePill(bar).click(); // → ideas
        expect(pillLabel(bar)).toBe('Ideas');
        expect(pillCount(bar)).toBe('3');
    });

    it('treats a row with a missing status as active in the count', () => {
        const ml = makeMainList();
        ml.append(makeRow('A', undefined), makeRow('B', 'idea'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → active
        expect(pillCount(bar)).toBe('1');
    });
});


// (5) The › cue is present in every cycle state — never hidden, never replaced.
describe('cycle cue invariant', () => {
    it('keeps the › glyph as the trailing character in every state', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        for (let i = 0; i < 3; i++) {
            expect(cyclePill(bar).textContent.endsWith('›')).toBe(true);
            cyclePill(bar).click();
        }
        // Back to the start, still present.
        expect(cyclePill(bar).textContent.endsWith('›')).toBe(true);
    });
});


// (6) Composition with the sort dropdown: cycling the filter leaves the sort
// selection untouched.
describe('composition with sort', () => {
    it('cycling the filter does not perturb the persisted sort', () => {
        setTaskSort('due');
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click();
        cyclePill(bar).click();
        expect(getTaskSort()).toBe('due');
    });
});


// (c) Persistence across reloads — a cycled filter survives a fresh bar.
describe('filter persistence across reloads', () => {
    it('persists the selected filter so a fresh bar restores it', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // all → active
        expect(getTaskFilter()).toBe('active');

        // Simulate a reload: tear down the DOM, keep localStorage, rebuild.
        document.body.innerHTML = '';
        makeMainList();
        const reloadedBar = buildTaskFilterBar();
        document.body.appendChild(reloadedBar);
        expect(pillLabel(reloadedBar)).toBe('Active');
        expect(cyclePill(reloadedBar).getAttribute('data-filter')).toBe('active');
    });
});


// (d) No data re-fetch on filter change.
describe('no data re-fetch on filter change', () => {
    it('cycling the filter makes no network calls', () => {
        const fetchSpy = vi.fn();
        const original = global.fetch;
        global.fetch = fetchSpy;
        try {
            const ml = makeMainList();
            ml.append(makeRow('A', 'active'), makeRow('B', 'idea'));
            const bar = buildTaskFilterBar();
            document.body.appendChild(bar);

            applyTaskFilter();
            cyclePill(bar).click();
            cyclePill(bar).click();
            cyclePill(bar).click();

            expect(fetchSpy).not.toHaveBeenCalled();
        } finally {
            global.fetch = original;
        }
    });
});


// (7) Empty-state handoff: the existing filter-specific empty message still
// surfaces when the active filter hides every committed row.
describe('filter-specific empty state', () => {
    it('shows a message when the active filter hides every task, then clears it', () => {
        const ml = makeMainList();
        ml.append(makeRow('A', 'active'), makeRow('B', 'in_progress'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → active (rows visible, no empty state)
        cyclePill(bar).click(); // → ideas (no idea rows → empty state)
        const empty = document.getElementById('taskFilterEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('No ideas captured yet.');

        cyclePill(bar).click(); // → all (everything visible again)
        expect(document.getElementById('taskFilterEmpty')).toBeNull();
    });

    it('does not show the filter empty state when the project has no tasks at all', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → active
        cyclePill(bar).click(); // → ideas
        expect(document.getElementById('taskFilterEmpty')).toBeNull();
    });
});
