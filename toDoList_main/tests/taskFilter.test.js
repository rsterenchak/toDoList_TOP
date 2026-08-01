import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    buildTaskFilterBar,
    applyTaskFilter,
    setItemPhaseResolver,
} from '../src/taskFilter.js';
import { getPhaseFilter, setPhaseFilter, getTaskSort, setTaskSort } from '../src/prefs.js';


// taskFilter.js's only prefs dependency is the phase filter (localStorage), so
// the slice is exercised directly against light jsdom rows that mirror the
// relevant subset of buildToDoRow's output: a #toDoChild with an __item anchor
// carrying the title + manual status + derived phase, plus the blank-placeholder
// case (empty title).
//
// The MOBILE control is a SINGLE cycle pill (all → inprogress → done → all …):
// each click advances the persisted filter one step and repaints the pill's
// label + count in place. The filter vocabulary is now shared with desktop
// (ALL / IN PROGRESS / DONE), so the pill mixes manual status and derived phase.
// taskFilter.js never imports phase.js (import cycle), so the phase test is
// injected through setItemPhaseResolver — mirroring how toDoRow.js injects
// `derivePhase` in the real app. These helpers drive the cycle and read the pill.

function makeMainList() {
    const ml = document.createElement('div');
    ml.id = 'mainList';
    document.body.appendChild(ml);
    return ml;
}

// A committed row with manual status, derived phase `ph`, and completed flag.
function makeRow(tit, opts) {
    const o = opts || {};
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = { tit: tit, status: o.status || 'active', ph: o.ph || 'none', completed: !!o.completed };
    if (o.completed) row.classList.add('completed');
    row.setAttribute('data-value', 'Inbox');
    return row;
}

// The one and only visible filter control on mobile.
function cyclePill(bar) {
    return bar.querySelector('.taskCyclePill');
}

function pillLabel(bar) {
    return cyclePill(bar).querySelector('.taskFilterPillLabel').textContent;
}

function pillCount(bar) {
    return cyclePill(bar).querySelector('.taskFilterCount').textContent;
}

// The trailing position indicator: 3 dots (one per filter), the active filter's
// dot carrying the --on modifier.
function dots(bar) {
    return Array.from(cyclePill(bar).querySelectorAll('.taskFilterDot'));
}

function activeDotIndex(bar) {
    return dots(bar).findIndex(d => d.classList.contains('taskFilterDot--on'));
}

function isHidden(row) {
    return row.classList.contains('taskFilterHidden');
}

// applyTaskFilter now runs ONE predicate at both breakpoints. jsdom defaults to
// 1024, but these tests exercise the mobile cycle pill, so pin a mobile width for
// realism; the predicate is identical either way after the consolidation.
const realInnerWidth = window.innerWidth;
function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

beforeEach(() => {
    document.body.innerHTML = '';
    try { localStorage.clear(); } catch (e) { /* ignore */ }
    setWidth(800);
    // Resolver reads the row's __item.ph string, mirroring derivePhase's output.
    setItemPhaseResolver(item => (item ? item.ph : null));
});

afterEach(() => {
    vi.restoreAllMocks();
    setItemPhaseResolver(null);
    setWidth(realInnerWidth);
});


// (1) DOM shape — the mobile cycle pill plus the segmented control, both now
// rendering the shared phase vocabulary (all / inprogress / done).
describe('buildTaskFilterBar — cycle pill + segmented control', () => {
    it('renders exactly one cycle pill (the mobile control)', () => {
        const bar = buildTaskFilterBar();
        expect(bar.querySelectorAll('.taskCyclePill').length).toBe(1);
        // … and it is the only .taskFilterPill (the segments use their own class).
        expect(bar.querySelectorAll('.taskFilterPill').length).toBe(1);
        // Only the cycle pill carries data-filter; segments key off data-seg.
        expect(bar.querySelectorAll('[data-filter]').length).toBe(1);
    });

    it('renders the segmented control with one segment per phase filter', () => {
        const bar = buildTaskFilterBar();
        expect(bar.querySelectorAll('.taskFilterSegmented').length).toBe(1);
        const segs = bar.querySelectorAll('.taskFilterSeg');
        expect(segs.length).toBe(3);
        expect(Array.from(segs).map(s => s.getAttribute('data-seg')))
            .toEqual(['all', 'inprogress', 'done']);
        // Each segment carries a normal-case label and a count slot.
        expect(Array.from(segs).map(s => s.querySelector('.taskFilterSegLabel').textContent))
            .toEqual(['All', 'In progress', 'Done']);
        segs.forEach(s => {
            expect(s.querySelector('.taskFilterSegCount')).not.toBeNull();
        });
        // Cycle pill (1) + three segments (3) + three desktop pills (3) +
        // blocked-on-you chip (1) = eight buttons total (the mobile Sort trigger is
        // appended later by main.js, not by buildTaskFilterBar).
        expect(bar.querySelectorAll('button').length).toBe(8);
    });

    // (2) Default state proves the prefs round-trip still drives the pill.
    it('paints the default (ALL) filter when no preference is stored', () => {
        const bar = buildTaskFilterBar();
        expect(getPhaseFilter()).toBe('all');
        expect(pillLabel(bar)).toBe('ALL');
        expect(cyclePill(bar).getAttribute('data-filter')).toBe('all');
        // Position dots: three dots, the ALL dot (index 0) filled.
        expect(dots(bar).length).toBe(3);
        expect(activeDotIndex(bar)).toBe(0);
    });

    it('paints the persisted filter set ahead of mount', () => {
        setPhaseFilter('done');
        const bar = buildTaskFilterBar();
        expect(pillLabel(bar)).toBe('DONE');
        expect(cyclePill(bar).getAttribute('data-filter')).toBe('done');
        // DONE is index 2, so the third (last) dot is the filled one.
        expect(activeDotIndex(bar)).toBe(2);
    });
});


// (3) Cycle order: all → inprogress → done → all, and from any start the wrap is
// modulo 3. Each transition writes the new value through prefs (verified via the
// getPhaseFilter round-trip) and repaints the pill label in place.
describe('cycle order', () => {
    it('advances all → inprogress → done → all on successive clicks', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        expect(getPhaseFilter()).toBe('all');
        expect(pillLabel(bar)).toBe('ALL');

        cyclePill(bar).click();
        expect(getPhaseFilter()).toBe('inprogress');
        expect(pillLabel(bar)).toBe('IN PROGRESS');

        cyclePill(bar).click();
        expect(getPhaseFilter()).toBe('done');
        expect(pillLabel(bar)).toBe('DONE');

        cyclePill(bar).click();
        expect(getPhaseFilter()).toBe('all');
        expect(pillLabel(bar)).toBe('ALL');
    });

    it('wraps modulo 3 starting from a persisted inprogress filter', () => {
        setPhaseFilter('inprogress');
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // inprogress → done
        expect(getPhaseFilter()).toBe('done');
        cyclePill(bar).click(); // done → all
        expect(getPhaseFilter()).toBe('all');
        cyclePill(bar).click(); // all → inprogress
        expect(getPhaseFilter()).toBe('inprogress');
    });
});


// (2b) Segmented control: sets the filter DIRECTLY on tap (no cycling), shows
// every segment's live count at once, tints the active segment, and stays in
// lockstep with the cycle pill (both share one persisted state).
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

        // From ALL, tapping Done jumps straight to done (not the next cycle step).
        expect(getPhaseFilter()).toBe('all');
        segment(bar, 'done').click();
        expect(getPhaseFilter()).toBe('done');

        // From done, tapping In progress jumps straight to inprogress.
        segment(bar, 'inprogress').click();
        expect(getPhaseFilter()).toBe('inprogress');

        // Re-tapping the active segment is a no-op (stays put).
        segment(bar, 'inprogress').click();
        expect(getPhaseFilter()).toBe('inprogress');
    });

    it('paints the active segment and keeps the cycle pill in sync', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        segment(bar, 'done').click();
        expect(isSegSelected(bar, 'done')).toBe(true);
        expect(isSegSelected(bar, 'all')).toBe(false);
        expect(isSegSelected(bar, 'inprogress')).toBe(false);
        // The cycle pill tracks the same state.
        expect(pillLabel(bar)).toBe('DONE');

        // Cycling the pill repaints the segments too.
        cyclePill(bar).click(); // done → all
        expect(getPhaseFilter()).toBe('all');
        expect(isSegSelected(bar, 'all')).toBe(true);
        expect(isSegSelected(bar, 'done')).toBe(false);
    });

    it('shows every segment\'s live count at once', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('A', { status: 'active' }),
            makeRow('B', { status: 'in_progress' }),
            makeRow('C', { ph: 'draft' }),
            makeRow('D', { ph: 'done' }),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        // all = 4 uncompleted; inprogress = in_progress status + draft phase = 2;
        // done = phase done = 1 — all visible together.
        expect(segCount(bar, 'all')).toBe('4');
        expect(segCount(bar, 'inprogress')).toBe('2');
        expect(segCount(bar, 'done')).toBe('1');
    });

    it('persists a segment selection so a fresh bar restores it', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        segment(bar, 'inprogress').click();

        document.body.innerHTML = '';
        makeMainList();
        const reloaded = buildTaskFilterBar();
        document.body.appendChild(reloaded);
        expect(getPhaseFilter()).toBe('inprogress');
        expect(isSegSelected(reloaded, 'inprogress')).toBe(true);
    });
});


// (4) Filter application: each click re-applies the filter so the correct row
// subset carries the hidden class for the new state.
describe('applyTaskFilter — visible subset', () => {
    it('ALL (default) shows every uncompleted committed row', () => {
        const ml = makeMainList();
        const a = makeRow('A', { status: 'active' });
        const b = makeRow('B', { status: 'in_progress' });
        const c = makeRow('C', { status: 'idea' });
        ml.append(a, b, c);
        document.body.appendChild(buildTaskFilterBar());

        applyTaskFilter();
        expect(isHidden(a)).toBe(false);
        expect(isHidden(b)).toBe(false);
        expect(isHidden(c)).toBe(false);
    });

    it('IN PROGRESS shows in_progress status + draft/running phase, hides idle ideas', () => {
        const ml = makeMainList();
        const wip = makeRow('WIP', { status: 'in_progress' });
        const draft = makeRow('Draft', { ph: 'draft' });
        const running = makeRow('Running', { ph: 'running' });
        const idea = makeRow('Idea', { status: 'idea' });
        ml.append(wip, draft, running, idea);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // all → inprogress
        expect(isHidden(wip)).toBe(false);
        expect(isHidden(draft)).toBe(false);
        expect(isHidden(running)).toBe(false);
        expect(isHidden(idea)).toBe(true);
    });

    it('DONE shows only phase-done rows that are not checked off', () => {
        const ml = makeMainList();
        const done = makeRow('Done', { ph: 'done' });
        const draft = makeRow('Draft', { ph: 'draft' });
        const idea = makeRow('Idea', { status: 'idea' });
        ml.append(done, draft, idea);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // all → inprogress
        cyclePill(bar).click(); // inprogress → done
        expect(isHidden(done)).toBe(false);
        expect(isHidden(draft)).toBe(true);
        expect(isHidden(idea)).toBe(true);
    });

    it('never hides the blank placeholder row (empty title), under any filter', () => {
        const ml = makeMainList();
        const blank = makeRow('', { status: 'active' });
        const idea = makeRow('Idea', { status: 'idea' });
        ml.append(blank, idea);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // all → inprogress
        cyclePill(bar).click(); // inprogress → done
        expect(isHidden(blank)).toBe(false);
    });

    it('carries a row\'s open description / stats drawer with it when hiding', () => {
        const ml = makeMainList();
        const row = makeRow('Idea', { status: 'idea' });
        const desc = document.createElement('div');
        desc.id = 'descSibling';
        const stats = document.createElement('div');
        stats.id = 'statsSibling';
        ml.append(row, desc, stats);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // all → inprogress (hides the idle idea row)
        expect(isHidden(row)).toBe(true);
        expect(desc.classList.contains('taskFilterHidden')).toBe(true);
        expect(stats.classList.contains('taskFilterHidden')).toBe(true);

        cyclePill(bar).click(); // inprogress → done (still hidden)
        cyclePill(bar).click(); // done → all (everything visible again)
        expect(desc.classList.contains('taskFilterHidden')).toBe(false);
        expect(stats.classList.contains('taskFilterHidden')).toBe(false);
    });
});


// Bug-1 regression guard: a reported symptom claimed a filter rendered ZERO cards
// even though the pill counted matches. The pill count and the row visibility are
// driven by the SAME single DOM scan in applyTaskFilter, so a non-zero count
// provably implies that many rows are un-hidden — the described state is
// structurally impossible. These tests pin that invariant.
describe('IN PROGRESS filter renders every matching row (bug-1 invariant)', () => {
    function visibleCommitted(ml) {
        return Array.from(ml.querySelectorAll('#toDoChild')).filter(function (row) {
            return row.__item && row.__item.tit && !isHidden(row);
        });
    }

    it('renders exactly K in-progress cards when K exist and IN PROGRESS is active', () => {
        const ml = makeMainList();
        const wip = [];
        for (let i = 0; i < 7; i++) {
            const r = makeRow('WIP ' + i, { status: 'in_progress' });
            wip.push(r);
            ml.append(r);
        }
        // A couple of non-matching rows to prove they're filtered OUT.
        ml.append(makeRow('Idea', { status: 'idea' }), makeRow('Done', { ph: 'done' }));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // all → inprogress

        // The pill count and the rendered-card count must agree …
        expect(pillCount(bar)).toBe('7');
        expect(visibleCommitted(ml).length).toBe(7);
        wip.forEach(function (r) { expect(isHidden(r)).toBe(false); });
        // … and the filter empty-state must NOT appear while matches are visible.
        expect(document.getElementById('taskFilterEmpty')).toBeNull();
    });

    it('shows the empty-state only when there are genuinely zero in-progress entries', () => {
        const ml = makeMainList();
        ml.append(makeRow('Idea', { status: 'idea' }), makeRow('Done', { ph: 'done' }));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // all → inprogress (nothing in progress)

        expect(pillCount(bar)).toBe('0');
        expect(visibleCommitted(ml).length).toBe(0);
        const empty = document.getElementById('taskFilterEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('Nothing in progress right now.');
    });
});


// (4 cont.) Counts come from the full list and are shown for the active filter.
describe('cycle pill count', () => {
    it('shows the active filter\'s count, updating as the filter cycles', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('A', { status: 'active' }),
            makeRow('B', { status: 'in_progress' }),
            makeRow('C', { ph: 'draft' }),
            makeRow('D', { ph: 'done' }),
            makeRow('E', { status: 'idea' }),
            makeRow('F', { status: 'idea' }),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        expect(pillLabel(bar)).toBe('ALL');
        expect(pillCount(bar)).toBe('6');

        cyclePill(bar).click(); // → inprogress (in_progress + draft = 2)
        expect(pillLabel(bar)).toBe('IN PROGRESS');
        expect(pillCount(bar)).toBe('2');

        cyclePill(bar).click(); // → done (phase done = 1)
        expect(pillLabel(bar)).toBe('DONE');
        expect(pillCount(bar)).toBe('1');
    });

    it('counts a row with a missing status only under ALL, not IN PROGRESS', () => {
        const ml = makeMainList();
        ml.append(makeRow('A', { status: undefined }), makeRow('B', { status: 'idea' }));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        // ALL counts both uncompleted rows.
        applyTaskFilter();
        expect(pillCount(bar)).toBe('2');

        cyclePill(bar).click(); // → inprogress: neither is in_progress or draft/running
        expect(pillCount(bar)).toBe('0');
    });
});


// (8) Completed items must not inflate the filter counts, and must stay EXEMPT
// from the filter at the mobile breakpoint — the COMPLETED section's own collapse
// is their sole authority, so expanding it reveals its rows under every filter.
describe('completed items — excluded from counts, exempt from hiding', () => {
    it('IN PROGRESS count ignores completed in-progress rows', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('A1', { status: 'in_progress' }),
            makeRow('A2', { ph: 'draft' }),
            makeRow('C1', { status: 'in_progress', completed: true }),
            makeRow('C2', { ph: 'draft', completed: true }),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → inprogress
        expect(pillLabel(bar)).toBe('IN PROGRESS');
        expect(pillCount(bar)).toBe('2');
    });

    it('DONE count ignores completed done rows', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('D1', { ph: 'done' }),
            makeRow('D2', { ph: 'done' }),
            makeRow('C1', { ph: 'done', completed: true }),
            makeRow('C2', { ph: 'done', completed: true }),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → inprogress
        cyclePill(bar).click(); // → done
        expect(pillLabel(bar)).toBe('DONE');
        expect(pillCount(bar)).toBe('2');
    });

    it('ALL count ignores all completed rows', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('A', { status: 'active' }),
            makeRow('B', { status: 'idea' }),
            makeRow('C', { status: 'active', completed: true }),
            makeRow('D', { status: 'idea', completed: true }),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        expect(pillLabel(bar)).toBe('ALL');
        expect(pillCount(bar)).toBe('2');
    });

    it('never filter-hides a completed row under ANY mobile filter (COMPLETED collapse owns it)', () => {
        const ml = makeMainList();
        const completedIdea = makeRow('CI', { status: 'idea', completed: true });
        const completedDone = makeRow('CD', { ph: 'done', completed: true });
        ml.append(makeRow('Open', { status: 'in_progress' }), completedIdea, completedDone);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        ['all', 'inprogress', 'done'].forEach(function () {
            cyclePill(bar).click();
            // Completed rows are never hidden by the filter, whatever the pill.
            expect(isHidden(completedIdea)).toBe(false);
            expect(isHidden(completedDone)).toBe(false);
        });
    });

    it('fires the filter empty-state when the only matches are completed but other work exists', () => {
        // total > 0 (the two non-completed ideas) but nothing matches IN PROGRESS
        // (the only in-progress rows are completed and excluded) → the empty message.
        const ml = makeMainList();
        ml.append(
            makeRow('I1', { status: 'idea' }),
            makeRow('I2', { status: 'idea' }),
            makeRow('C1', { status: 'in_progress', completed: true }),
            makeRow('C2', { status: 'in_progress', completed: true }),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → inprogress
        const empty = document.getElementById('taskFilterEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('Nothing in progress right now.');
    });

    it('recounts when a completed item is un-completed in place', () => {
        const ml = makeMainList();
        const flipper = makeRow('Flip', { status: 'in_progress', completed: true });
        ml.append(
            makeRow('A1', { status: 'in_progress' }),
            makeRow('A2', { status: 'in_progress' }),
            makeRow('A3', { ph: 'draft' }),
            flipper,
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → inprogress
        expect(pillCount(bar)).toBe('3');

        // Un-complete the completed in-progress row and re-apply.
        flipper.__item.completed = false;
        flipper.classList.remove('completed');
        applyTaskFilter();
        expect(pillCount(bar)).toBe('4');
    });
});


// (5) The position dots are present in every cycle state — always exactly three
// dots with exactly one filled, tracking the active filter's index (all=0,
// inprogress=1, done=2) as the pill cycles.
describe('position dots invariant', () => {
    it('keeps three dots with the active filter\'s dot filled in every state', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        const expectedOrder = [0, 1, 2, 0];
        for (let i = 0; i < expectedOrder.length; i++) {
            expect(dots(bar).length).toBe(3);
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

        cyclePill(bar).click(); // all → inprogress
        expect(getPhaseFilter()).toBe('inprogress');

        // Simulate a reload: tear down the DOM, keep localStorage, rebuild.
        document.body.innerHTML = '';
        makeMainList();
        const reloadedBar = buildTaskFilterBar();
        document.body.appendChild(reloadedBar);
        expect(pillLabel(reloadedBar)).toBe('IN PROGRESS');
        expect(cyclePill(reloadedBar).getAttribute('data-filter')).toBe('inprogress');
    });
});


// (c2) Retired-token migration — the mobile ALL/Active/Ideas vocabulary is gone,
// so a value left over from either the old mobile status key OR the old desktop
// four-pill set resolves to ALL rather than leaving the list blank after deploy.
describe('retired-token migration', () => {
    it('a stored `ideas` preference resolves to ALL', () => {
        localStorage.setItem('todoapp_phaseFilter', 'ideas');
        expect(getPhaseFilter()).toBe('all');
    });

    it('a stored `active` preference resolves to ALL', () => {
        localStorage.setItem('todoapp_phaseFilter', 'active');
        expect(getPhaseFilter()).toBe('all');
    });

    it('a value left under the retired mobile key never blanks the list (single key now)', () => {
        // The old mobile filter key is no longer read at all; the phase key alone
        // governs, and an unset phase key defaults to ALL — so a stale mobile
        // 'ideas' can't strand the list empty on first load after deploy.
        localStorage.setItem('todoapp_taskFilter', 'ideas'); // retired key
        expect(getPhaseFilter()).toBe('all');
        const bar = buildTaskFilterBar();
        expect(cyclePill(bar).getAttribute('data-filter')).toBe('all');
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
            ml.append(makeRow('A', { status: 'active' }), makeRow('B', { status: 'idea' }));
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


// (7) Empty-state handoff: the filter-specific empty message still surfaces when
// the active filter hides every committed row.
describe('filter-specific empty state', () => {
    it('shows a message when the active filter hides every task, then clears it', () => {
        const ml = makeMainList();
        ml.append(makeRow('A', { status: 'idea' }), makeRow('B', { status: 'idea' }));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → inprogress (no matches → empty state)
        const empty = document.getElementById('taskFilterEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('Nothing in progress right now.');

        cyclePill(bar).click(); // → done (still no matches, copy swaps)
        expect(document.getElementById('taskFilterEmpty').textContent).toBe('Nothing shipped is waiting.');

        cyclePill(bar).click(); // → all (everything visible again)
        expect(document.getElementById('taskFilterEmpty')).toBeNull();
    });

    it('does not show the filter empty state when the project has no tasks at all', () => {
        makeMainList();
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        cyclePill(bar).click(); // → inprogress
        cyclePill(bar).click(); // → done
        expect(document.getElementById('taskFilterEmpty')).toBeNull();
    });
});
