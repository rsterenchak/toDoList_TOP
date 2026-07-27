import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    buildTaskFilterBar,
    applyTaskFilter,
    setItemPhaseResolver,
} from '../src/taskFilter.js';
import {
    getTaskFilter, setTaskFilter,
    getPhaseFilter, setPhaseFilter,
} from '../src/prefs.js';

// The DESKTOP queue rail filters on a row's DERIVED phase through four always-
// visible pills (ALL / IDEAS / RUNNING / DONE), a separate vocabulary and a
// separate persisted key from the mobile status cycle pill. taskFilter.js never
// imports phase.js (import cycle), so the phase test is injected through
// setItemPhaseResolver — mirroring how toDoRow.js injects `derivePhase` in the
// real app. These tests register a light resolver reading a `ph` string off the
// row's __item.

const realInnerWidth = window.innerWidth;
function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

function makeMainList() {
    const ml = document.createElement('div');
    ml.id = 'mainList';
    document.body.appendChild(ml);
    return ml;
}

// A committed row whose derived phase is `ph` (and manual status `status`, used
// only to prove the desktop predicate ignores status).
function makeRow(tit, ph, opts) {
    const o = opts || {};
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = { tit: tit, status: o.status || 'active', ph: ph, completed: !!o.completed };
    row.setAttribute('data-value', 'Inbox');
    return row;
}

function phasePill(bar, key) {
    return Array.from(bar.querySelectorAll('.taskPhaseFilterPill'))
        .filter(p => p.getAttribute('data-phase') === key)[0];
}
function phaseCount(bar, key) {
    return phasePill(bar, key).querySelector('.taskPhaseFilterCount').textContent;
}
function isPhaseSelected(bar, key) {
    return phasePill(bar, key).classList.contains('selected');
}
function isHidden(row) {
    return row.classList.contains('taskFilterHidden');
}

beforeEach(() => {
    document.body.innerHTML = '';
    try { localStorage.clear(); } catch (e) { /* ignore */ }
    setWidth(1280); // desktop
    // Resolver reads the row's __item.ph string, mirroring derivePhase's output.
    setItemPhaseResolver(item => (item ? item.ph : null));
});

afterEach(() => {
    vi.restoreAllMocks();
    setItemPhaseResolver(null);
    setWidth(realInnerWidth);
});


describe('desktop phase pills — DOM shape', () => {
    it('renders four phase pills in order (ALL / IDEAS / RUNNING / DONE)', () => {
        const bar = buildTaskFilterBar();
        const pills = bar.querySelectorAll('.taskPhaseFilterPill');
        expect(pills.length).toBe(4);
        expect(Array.from(pills).map(p => p.getAttribute('data-phase')))
            .toEqual(['all', 'ideas', 'running', 'done']);
        expect(Array.from(pills).map(p => p.querySelector('.taskPhaseFilterLabel').textContent))
            .toEqual(['ALL', 'IDEAS', 'RUNNING', 'DONE']);
        pills.forEach(p => expect(p.querySelector('.taskPhaseFilterCount')).not.toBeNull());
    });

    it('leaves the blocked chip as the bar\'s last child (Sort still appends after it)', () => {
        const bar = buildTaskFilterBar();
        expect(bar.lastElementChild).toBe(bar.querySelector('.taskFilterBlockedChip'));
    });

    it('paints the default (ALL) phase and the persisted phase ahead of mount', () => {
        expect(getPhaseFilter()).toBe('all');
        let bar = buildTaskFilterBar();
        expect(isPhaseSelected(bar, 'all')).toBe(true);

        setPhaseFilter('running');
        bar = buildTaskFilterBar();
        expect(isPhaseSelected(bar, 'running')).toBe(true);
        expect(isPhaseSelected(bar, 'all')).toBe(false);
    });
});


describe('desktop phase pills — filtering', () => {
    function seed() {
        const ml = makeMainList();
        const idea = makeRow('Idea', 'none', { status: 'idea' });
        const running = makeRow('Running', 'running', { status: 'active' });
        const done = makeRow('Done', 'done', { status: 'active' });
        const draft = makeRow('Draft', 'draft', { status: 'active' });
        ml.append(idea, running, done, draft);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        return { ml, bar, idea, running, done, draft };
    }

    it('ALL shows every uncompleted task regardless of phase or status', () => {
        const { bar, idea, running, done, draft } = seed();
        applyTaskFilter();
        [idea, running, done, draft].forEach(r => expect(isHidden(r)).toBe(false));
        expect(phaseCount(bar, 'all')).toBe('4');
    });

    it('IDEAS shows only phase-none rows', () => {
        const { bar, idea, running, done, draft } = seed();
        phasePill(bar, 'ideas').click();
        expect(getPhaseFilter()).toBe('ideas');
        expect(isHidden(idea)).toBe(false);
        expect(isHidden(running)).toBe(true);
        expect(isHidden(done)).toBe(true);
        expect(isHidden(draft)).toBe(true);
    });

    it('RUNNING shows only phase-running rows', () => {
        const { bar, idea, running, done, draft } = seed();
        phasePill(bar, 'running').click();
        expect(getPhaseFilter()).toBe('running');
        expect(isHidden(running)).toBe(false);
        expect(isHidden(idea)).toBe(true);
        expect(isHidden(done)).toBe(true);
        expect(isHidden(draft)).toBe(true);
    });

    it('DONE shows only phase-done rows', () => {
        const { bar, idea, running, done, draft } = seed();
        phasePill(bar, 'done').click();
        expect(getPhaseFilter()).toBe('done');
        expect(isHidden(done)).toBe(false);
        expect(isHidden(idea)).toBe(true);
        expect(isHidden(running)).toBe(true);
        expect(isHidden(draft)).toBe(true);
    });

    it('counts come from the full committed set (excluding completed rows)', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('I1', 'none'),
            makeRow('I2', 'none'),
            makeRow('R1', 'running'),
            makeRow('D1', 'done'),
            makeRow('DoneCompleted', 'done', { completed: true }),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        expect(phaseCount(bar, 'all')).toBe('4');   // completed excluded
        expect(phaseCount(bar, 'ideas')).toBe('2');
        expect(phaseCount(bar, 'running')).toBe('1');
        expect(phaseCount(bar, 'done')).toBe('1');
    });

    it('never hides the blank placeholder row under any phase filter', () => {
        const ml = makeMainList();
        const blank = makeRow('', 'none');
        blank.__item.tit = ''; // placeholder
        const done = makeRow('Done', 'done');
        ml.append(blank, done);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        phasePill(bar, 'running').click();
        expect(isHidden(blank)).toBe(false);
    });

    it('shows the phase-specific empty state when the filter hides every task', () => {
        const ml = makeMainList();
        ml.append(makeRow('Idea', 'none'), makeRow('Draft', 'draft'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        phasePill(bar, 'running').click(); // no running rows
        const empty = document.getElementById('taskFilterEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('No runs in flight.');
    });
});


describe('two vocabularies, two keys — breakpoint independence', () => {
    it('setting the phase filter never touches the status filter, and vice versa', () => {
        setTaskFilter('ideas');   // mobile status vocabulary
        setPhaseFilter('running'); // desktop phase vocabulary
        expect(getTaskFilter()).toBe('ideas');
        expect(getPhaseFilter()).toBe('running');

        // Clicking a phase pill leaves the status filter intact.
        const ml = makeMainList();
        ml.append(makeRow('R', 'running'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        phasePill(bar, 'done').click();
        expect(getPhaseFilter()).toBe('done');
        expect(getTaskFilter()).toBe('ideas'); // untouched
    });

    it('crossing the breakpoint swaps the predicate but preserves both selections', () => {
        // Two rows: one whose phase is running (status active), one whose status
        // is idea (phase none). Phase filter = running, status filter = ideas.
        setPhaseFilter('running');
        setTaskFilter('ideas');
        const ml = makeMainList();
        const running = makeRow('Running', 'running', { status: 'active' });
        const idea = makeRow('Idea', 'none', { status: 'idea' });
        ml.append(running, idea);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        // Desktop: the phase predicate governs — only the running row shows.
        setWidth(1280);
        applyTaskFilter();
        expect(isHidden(running)).toBe(false);
        expect(isHidden(idea)).toBe(true);

        // Mobile: the status predicate governs — only the idea row shows. Both
        // stored selections survive the swap.
        setWidth(800);
        applyTaskFilter();
        expect(isHidden(idea)).toBe(false);
        expect(isHidden(running)).toBe(true);
        expect(getPhaseFilter()).toBe('running');
        expect(getTaskFilter()).toBe('ideas');
    });
});
