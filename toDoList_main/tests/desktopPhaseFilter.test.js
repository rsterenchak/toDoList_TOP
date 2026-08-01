import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    buildTaskFilterBar,
    applyTaskFilter,
    setItemPhaseResolver,
} from '../src/taskFilter.js';
import {
    getTaskFilter, setTaskFilter,
    getPhaseFilter, setPhaseFilter,
    PHASE_FILTER_KEY,
} from '../src/prefs.js';

// The DESKTOP filter is three always-visible pills (ALL / IN PROGRESS / DONE)
// that mix manual status and derived phase deliberately — a separate vocabulary
// and a separate persisted key from the mobile status cycle pill. ALL is open
// work (every uncompleted task), IN PROGRESS is work you or the machine are doing
// (status in_progress, or phase draft/running), DONE is shipped-and-acknowledged
// work still open in the list (phase done AND NOT checked off — a strict subset of
// ALL, so checked-off rows never appear under it). taskFilter.js
// never imports phase.js (import cycle), so the phase test is injected through
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

// A committed row whose derived phase is `ph`, manual status `status`, and
// checkbox-completed flag `completed`. Completed rows carry the `completed` class
// the real render path adds, so the COMPLETED-section machinery sees them.
function makeRow(tit, ph, opts) {
    const o = opts || {};
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = { tit: tit, status: o.status || 'active', ph: ph, completed: !!o.completed };
    if (o.completed) row.classList.add('completed');
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


describe('desktop pills — DOM shape', () => {
    it('renders three pills in order (ALL / IN PROGRESS / DONE)', () => {
        const bar = buildTaskFilterBar();
        const pills = bar.querySelectorAll('.taskPhaseFilterPill');
        expect(pills.length).toBe(3);
        expect(Array.from(pills).map(p => p.getAttribute('data-phase')))
            .toEqual(['all', 'inprogress', 'done']);
        expect(Array.from(pills).map(p => p.querySelector('.taskPhaseFilterLabel').textContent))
            .toEqual(['ALL', 'IN PROGRESS', 'DONE']);
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

        setPhaseFilter('done');
        bar = buildTaskFilterBar();
        expect(isPhaseSelected(bar, 'done')).toBe(true);
        expect(isPhaseSelected(bar, 'all')).toBe(false);
    });
});


describe('desktop pills — filtering', () => {
    function seed() {
        const ml = makeMainList();
        const idea = makeRow('Idea', 'none', { status: 'idea' });
        const inprog = makeRow('InProg', 'none', { status: 'in_progress' });
        const draft = makeRow('Draft', 'draft', { status: 'active' });
        const running = makeRow('Running', 'running', { status: 'active' });
        const accept = makeRow('Accept', 'accept', { status: 'active' });
        const done = makeRow('Done', 'done', { status: 'active' });
        const completed = makeRow('Completed', 'none', { status: 'active', completed: true });
        ml.append(idea, inprog, draft, running, accept, done, completed);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        return { ml, bar, idea, inprog, draft, running, accept, done, completed };
    }

    it('ALL shows every uncompleted task and hides the checked-off one', () => {
        const { bar, idea, inprog, draft, running, accept, done, completed } = seed();
        applyTaskFilter();
        [idea, inprog, draft, running, accept, done].forEach(r => expect(isHidden(r)).toBe(false));
        expect(isHidden(completed)).toBe(true);
        expect(phaseCount(bar, 'all')).toBe('6'); // completed excluded from ALL
    });

    it('IN PROGRESS shows in_progress status + draft/running phase, excludes idle ideas and done', () => {
        const { bar, idea, inprog, draft, running, accept, done, completed } = seed();
        phasePill(bar, 'inprogress').click();
        expect(getPhaseFilter()).toBe('inprogress');
        expect(isHidden(inprog)).toBe(false);
        expect(isHidden(draft)).toBe(false);
        expect(isHidden(running)).toBe(false);
        expect(isHidden(idea)).toBe(true);
        expect(isHidden(accept)).toBe(true);
        expect(isHidden(done)).toBe(true);
        expect(isHidden(completed)).toBe(true);
        expect(phaseCount(bar, 'inprogress')).toBe('3');
    });

    it('DONE shows the shipped-and-acknowledged row and hides the checked-off one', () => {
        const { bar, idea, inprog, draft, running, accept, done, completed } = seed();
        phasePill(bar, 'done').click();
        expect(getPhaseFilter()).toBe('done');
        expect(isHidden(done)).toBe(false);
        expect(isHidden(completed)).toBe(true); // checked-off excluded from DONE
        [idea, inprog, draft, running, accept].forEach(r => expect(isHidden(r)).toBe(true));
        expect(phaseCount(bar, 'done')).toBe('1'); // only the open phase-done row
    });

    it('DONE excludes a checked-off row even when its phase is done', () => {
        const ml = makeMainList();
        const openDone = makeRow('OpenDone', 'done', { status: 'active' });
        const shippedThenChecked = makeRow('Filed', 'done', { status: 'active', completed: true });
        ml.append(openDone, shippedThenChecked);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        phasePill(bar, 'done').click();
        expect(isHidden(openDone)).toBe(false);
        expect(isHidden(shippedThenChecked)).toBe(true);
        expect(phaseCount(bar, 'done')).toBe('1');
    });

    it('DONE never reveals the collapsed COMPLETED section', () => {
        const { ml, bar } = seed();
        ml.classList.add('completedCollapsed');
        phasePill(bar, 'done').click();
        expect(ml.classList.contains('phaseFilterRevealCompleted')).toBe(false);
    });

    it('DONE count agrees with the rows it renders (completed rows excluded)', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('P1', 'none', { status: 'in_progress' }),
            makeRow('D1', 'draft'),
            makeRow('R1', 'running'),
            makeRow('Done1', 'done'),
            makeRow('C1', 'none', { completed: true }),
            makeRow('C2', 'done', { completed: true }),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        phasePill(bar, 'done').click();
        expect(phaseCount(bar, 'all')).toBe('4');        // 4 uncompleted
        expect(phaseCount(bar, 'inprogress')).toBe('3'); // in_progress + draft + running
        expect(phaseCount(bar, 'done')).toBe('1');       // only the open phase-done row
        // The count matches exactly the visible, non-hidden committed rows.
        const visible = Array.from(ml.querySelectorAll('#toDoChild'))
            .filter(r => r.__item && r.__item.tit && !isHidden(r));
        expect(visible.length).toBe(1);
        expect(visible[0].__item.tit).toBe('Done1');
    });

    it('never hides the blank placeholder row under any filter', () => {
        const ml = makeMainList();
        const blank = makeRow('', 'none');
        blank.__item.tit = ''; // placeholder
        const done = makeRow('Done', 'done');
        ml.append(blank, done);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        phasePill(bar, 'inprogress').click();
        expect(isHidden(blank)).toBe(false);
    });

    it('shows the IN PROGRESS empty state when nothing is in progress', () => {
        const ml = makeMainList();
        ml.append(makeRow('Idea', 'none', { status: 'idea' }), makeRow('Done', 'done'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        phasePill(bar, 'inprogress').click(); // no in-progress rows
        const empty = document.getElementById('taskFilterEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('Nothing in progress right now.');
    });

    it('shows the DONE empty state when no open shipped row exists', () => {
        const ml = makeMainList();
        ml.append(makeRow('Idea', 'none', { status: 'idea' }), makeRow('Draft', 'draft'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        phasePill(bar, 'done').click(); // nothing shipped-and-open
        const empty = document.getElementById('taskFilterEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('Nothing shipped is waiting.');
    });

    it('DONE is empty when only checked-off rows would otherwise satisfy it', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('Draft', 'draft'),
            makeRow('C1', 'done', { completed: true }),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        phasePill(bar, 'done').click();
        // The done-phase row is checked off, so DONE now excludes it and reports empty.
        const empty = document.getElementById('taskFilterEmpty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe('Nothing shipped is waiting.');
    });
});


describe('retired-token migration', () => {
    it('a stored `running` preference resolves to ALL', () => {
        localStorage.setItem(PHASE_FILTER_KEY, 'running');
        expect(getPhaseFilter()).toBe('all');
    });

    it('a stored `active` preference resolves to ALL', () => {
        localStorage.setItem(PHASE_FILTER_KEY, 'active');
        expect(getPhaseFilter()).toBe('all');
    });
});


describe('two vocabularies, two keys — breakpoint independence', () => {
    it('setting the desktop filter never touches the status filter, and vice versa', () => {
        setTaskFilter('ideas');    // mobile status vocabulary
        setPhaseFilter('done');    // desktop vocabulary
        expect(getTaskFilter()).toBe('ideas');
        expect(getPhaseFilter()).toBe('done');

        const ml = makeMainList();
        ml.append(makeRow('R', 'running'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        phasePill(bar, 'inprogress').click();
        expect(getPhaseFilter()).toBe('inprogress');
        expect(getTaskFilter()).toBe('ideas'); // untouched
    });

    it('crossing the breakpoint swaps the predicate but preserves both selections', () => {
        // A running row (status active) and an idea row (phase none). Desktop
        // filter = inprogress, mobile status filter = ideas.
        setPhaseFilter('inprogress');
        setTaskFilter('ideas');
        const ml = makeMainList();
        const running = makeRow('Running', 'running', { status: 'active' });
        const idea = makeRow('Idea', 'none', { status: 'idea' });
        ml.append(running, idea);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        // Desktop: the desktop predicate governs — only the running row shows.
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
        expect(getPhaseFilter()).toBe('inprogress');
        expect(getTaskFilter()).toBe('ideas');
    });
});
