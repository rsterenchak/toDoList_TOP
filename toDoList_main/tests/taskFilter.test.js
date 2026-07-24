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

function makeRow(tit, status, completed) {
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = { tit: tit, status: status, completed: !!completed };
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

// The trailing position indicator replaced the old `›` cycle cue: 3 dots (one
// per filter), the active filter's dot carrying the --on modifier.
function dots(bar) {
    return Array.from(cyclePill(bar).querySelectorAll('.taskFilterDot'));
}

function activeDotIndex(bar) {
    return dots(bar).findIndex(d => d.classList.contains('taskFilterDot--on'));
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


// (1) DOM shape — the desktop cycle pill plus the mobile segmented control.
// The bar now carries BOTH filter controls (CSS gates which is visible per
// breakpoint), sharing one persisted filter state.
describe('buildTaskFilterBar — cycle pill + segmented control', () => {
    it('renders exactly one cycle pill (the desktop control)', () => {
        const bar = buildTaskFilterBar();
        // The cycle pill class appears exactly once …
        expect(bar.querySelectorAll('.taskCyclePill').length).toBe(1);
        // … and it is the only .taskFilterPill (the segments use their own
        // class, not the old three-pill .taskFilterPill set).
        expect(bar.querySelectorAll('.taskFilterPill').length).toBe(1);
        // Only the cycle pill carries data-filter; segments key off data-seg.
        expect(bar.querySelectorAll('[data-filter]').length).toBe(1);
    });

    it('renders the mobile segmented control with one segment per filter', () => {
        const bar = buildTaskFilterBar();
        expect(bar.querySelectorAll('.taskFilterSegmented').length).toBe(1);
        const segs = bar.querySelectorAll('.taskFilterSeg');
        expect(segs.length).toBe(3);
        expect(Array.from(segs).map(s => s.getAttribute('data-seg')))
            .toEqual(['all', 'active', 'ideas']);
        // Each segment carries a label and a count slot.
        segs.forEach(s => {
            expect(s.querySelector('.taskFilterSegLabel')).not.toBeNull();
            expect(s.querySelector('.taskFilterSegCount')).not.toBeNull();
        });
        // Cycle pill (1) + three segments (3) + blocked-on-you chip (1) = five
        // buttons total (the mobile Sort trigger is appended later by main.js,
        // not by buildTaskFilterBar).
        expect(bar.querySelectorAll('button').length).toBe(5);
    });

    // (2) Default state proves the prefs round-trip still drives the pill.
    it('paints the default (ALL) filter when no preference is stored', () => {
        const bar = buildTaskFilterBar();
        expect(getTaskFilter()).toBe('all');
        expect(pillLabel(bar)).toBe('ALL');
        expect(cyclePill(bar).getAttribute('data-filter')).toBe('all');
        // Position dots: three dots, the ALL dot (index 0) filled.
        expect(dots(bar).length).toBe(3);
        expect(activeDotIndex(bar)).toBe(0);
    });

    it('paints the persisted filter set ahead of mount', () => {
        setTaskFilter('ideas');
        const bar = buildTaskFilterBar();
        expect(pillLabel(bar)).toBe('Ideas');
        expect(cyclePill(bar).getAttribute('data-filter')).toBe('ideas');
        // Ideas is index 2, so the third (last) dot is the filled one.
        expect(activeDotIndex(bar)).toBe(2);
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


// (2b) Mobile segmented control: sets the filter DIRECTLY on tap (no cycling),
// shows every segment's live count at once, tints the active segment, and stays
// in lockstep with the desktop cycle pill (both share one persisted state).
describe('segmented control — direct set + sync', () => {
    function segment(bar, key) {
        return Array.from(bar.querySelectorAll('.taskFilterSeg'))
            .filter(s => s.getAttribute('data-seg') === key)[0];
    }
    function segCount(bar, key) {
        return segment(bar, key).querySelector('.taskFilterSegCount').textContent;
    }
    function isSegSelected(bar, key) {
        return segment(bar, key).classList.contains('selected');
    }

    it('sets the tapped filter directly rather than cycling', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        // From ALL, tapping Ideas jumps straight to ideas (not the next cycle step).
        expect(getTaskFilter()).toBe('all');
        segment(bar, 'ideas').click();
        expect(getTaskFilter()).toBe('ideas');

        // From ideas, tapping Active jumps straight to active.
        segment(bar, 'active').click();
        expect(getTaskFilter()).toBe('active');

        // Re-tapping the active segment is a no-op (stays put).
        segment(bar, 'active').click();
        expect(getTaskFilter()).toBe('active');
    });

    it('paints the active segment and keeps the cycle pill in sync', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        segment(bar, 'ideas').click();
        expect(isSegSelected(bar, 'ideas')).toBe(true);
        expect(isSegSelected(bar, 'all')).toBe(false);
        expect(isSegSelected(bar, 'active')).toBe(false);
        // The hidden cycle pill tracks the same state.
        expect(pillLabel(bar)).toBe('Ideas');

        // Cycling the (hidden-on-mobile) pill repaints the segments too.
        cyclePill(bar).click(); // ideas → all
        expect(getTaskFilter()).toBe('all');
        expect(isSegSelected(bar, 'all')).toBe(true);
        expect(isSegSelected(bar, 'ideas')).toBe(false);
    });

    it('shows every segment\'s live count at once', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('A', 'active'),
            makeRow('B', 'in_progress'),
            makeRow('C', 'idea'),
            makeRow('D', 'idea'),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        // all = 4, active (active+in_progress) = 2, ideas = 2 — all visible together.
        expect(segCount(bar, 'all')).toBe('4');
        expect(segCount(bar, 'active')).toBe('2');
        expect(segCount(bar, 'ideas')).toBe('2');
    });

    it('persists a segment selection so a fresh bar restores it', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        segment(bar, 'active').click();

        document.body.innerHTML = '';
        makeMainList();
        const reloaded = buildTaskFilterBar();
        document.body.appendChild(reloaded);
        expect(getTaskFilter()).toBe('active');
        expect(isSegSelected(reloaded, 'active')).toBe(true);
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


// Bug-1 regression guard: a reported symptom claimed the project-page IDEAS
// filter rendered ZERO cards even though the pill counted ideas (e.g. "IDEAS 7"
// with an empty body + empty-state ghost). The pill count and the row
// visibility are driven by the SAME single DOM scan in applyTaskFilter, so a
// non-zero idea count provably implies that many idea rows are un-hidden — the
// described state is structurally impossible. These tests pin that invariant so
// any future change that decouples the count from visibility fails loudly.
describe('IDEAS filter renders every idea row (bug-1 invariant)', () => {
    function visibleCommitted(ml) {
        return Array.from(ml.querySelectorAll('#toDoChild')).filter(function (row) {
            return row.__item && row.__item.tit && !isHidden(row);
        });
    }

    it('renders exactly K idea cards when K idea entries exist and IDEAS is active', () => {
        const ml = makeMainList();
        const ideas = [];
        for (let i = 0; i < 7; i++) {
            const r = makeRow('Idea ' + i, 'idea');
            ideas.push(r);
            ml.append(r);
        }
        // A couple of non-idea rows to prove they're filtered OUT, not the ideas.
        ml.append(makeRow('Active task', 'active'), makeRow('WIP task', 'in_progress'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // all → active
        cyclePill(bar).click(); // active → ideas

        // The pill count and the rendered-card count must agree …
        expect(pillCount(bar)).toBe('7');
        expect(visibleCommitted(ml).length).toBe(7);
        ideas.forEach(function (r) { expect(isHidden(r)).toBe(false); });
        // … and the filter empty-state must NOT appear while ideas are visible.
        expect(document.getElementById('taskFilterEmpty')).toBeNull();
    });

    it('shows the empty-state only when there are genuinely zero idea entries', () => {
        const ml = makeMainList();
        ml.append(makeRow('Active task', 'active'), makeRow('WIP task', 'in_progress'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // all → active
        cyclePill(bar).click(); // active → ideas (no idea rows here)

        expect(pillCount(bar)).toBe('0');
        expect(visibleCommitted(ml).length).toBe(0);
        const empty = document.getElementById('taskFilterEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('No ideas captured yet.');
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


// (8) Completed items must not inflate the pill counts. A completed row keeps
// its original `status` field (so un-completing restores its category), so the
// count loop has to exclude `__item.completed === true` rows from every count
// while still applying filter-match hiding to them.
describe('completed items excluded from pill counts', () => {
    it('ACTIVE count ignores completed active rows', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('A1', 'active', false),
            makeRow('A2', 'active', false),
            makeRow('A3', 'in_progress', false),
            makeRow('C1', 'active', true),
            makeRow('C2', 'active', true),
            makeRow('C3', 'active', true),
            makeRow('C4', 'in_progress', true),
            makeRow('C5', 'active', true),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → active
        expect(pillLabel(bar)).toBe('Active');
        expect(pillCount(bar)).toBe('3');
    });

    it('IDEAS count ignores completed idea rows', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('I1', 'idea', false),
            makeRow('I2', 'idea', false),
            makeRow('IC1', 'idea', true),
            makeRow('IC2', 'idea', true),
            makeRow('IC3', 'idea', true),
            makeRow('IC4', 'idea', true),
            makeRow('IC5', 'idea', true),
            makeRow('IC6', 'idea', true),
            makeRow('IC7', 'idea', true),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → active
        cyclePill(bar).click(); // → ideas
        expect(pillLabel(bar)).toBe('Ideas');
        expect(pillCount(bar)).toBe('2');
    });

    it('ALL count ignores all completed rows', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('A', 'active', false),
            makeRow('B', 'idea', false),
            makeRow('C', 'active', true),
            makeRow('D', 'idea', true),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        expect(pillLabel(bar)).toBe('ALL');
        expect(pillCount(bar)).toBe('2');
    });

    it('fires the filter empty-state when the only active rows are completed but other non-completed work exists', () => {
        // total > 0 (the two non-completed ideas) but visible === 0 under the
        // ACTIVE filter (the only active rows are completed and excluded) → the
        // filter-specific empty message surfaces.
        const ml = makeMainList();
        ml.append(
            makeRow('I1', 'idea', false),
            makeRow('I2', 'idea', false),
            makeRow('C1', 'active', true),
            makeRow('C2', 'active', true),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → active
        const empty = document.getElementById('taskFilterEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('Nothing active right now.');
    });

    it('does not fire the filter empty-state when every row is completed (project empty-state owns that)', () => {
        // All rows completed → total === 0, so the FILTER empty-state stays
        // dormant; the project-level empty-state governs the genuinely-empty case.
        const ml = makeMainList();
        ml.append(
            makeRow('C1', 'active', true),
            makeRow('C2', 'active', true),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → active
        expect(document.getElementById('taskFilterEmpty')).toBeNull();
    });

    it('still applies filter-match hiding to completed rows (setRowHidden unchanged)', () => {
        const ml = makeMainList();
        const completedActive = makeRow('CA', 'active', true);
        const completedIdea = makeRow('CI', 'idea', true);
        ml.append(makeRow('A', 'active', false), completedActive, completedIdea);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → active
        // Completed rows are still hidden/shown by filter-status match: the
        // completed active row matches Active (not hidden), the completed idea
        // row does not (hidden) — exactly as before the count fix.
        expect(isHidden(completedActive)).toBe(false);
        expect(isHidden(completedIdea)).toBe(true);
    });

    it('recounts when a completed item is un-completed in place', () => {
        const ml = makeMainList();
        const flipper = makeRow('Flip', 'active', true);
        ml.append(
            makeRow('A1', 'active', false),
            makeRow('A2', 'active', false),
            makeRow('A3', 'active', false),
            flipper,
            makeRow('C2', 'active', true),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → active
        expect(pillCount(bar)).toBe('3');

        // Un-complete one of the completed-active rows and re-apply.
        flipper.__item.completed = false;
        applyTaskFilter();
        expect(pillCount(bar)).toBe('4');
    });
});


// (5) The position dots are present in every cycle state — always exactly three
// dots with exactly one filled, and the filled dot tracks the active filter's
// index (all=0, active=1, ideas=2) as the pill cycles.
describe('position dots invariant', () => {
    it('keeps three dots with the active filter\'s dot filled in every state', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        // Starts at ALL (index 0), then advances one index per click, wrapping.
        const expectedOrder = [0, 1, 2, 0];
        for (let i = 0; i < expectedOrder.length; i++) {
            expect(dots(bar).length).toBe(3);
            // Exactly one dot filled at any time.
            expect(dots(bar).filter(d => d.classList.contains('taskFilterDot--on')).length).toBe(1);
            expect(activeDotIndex(bar)).toBe(expectedOrder[i]);
            cyclePill(bar).click();
        }
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
