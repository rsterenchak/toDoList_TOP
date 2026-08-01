import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    buildTaskFilterBar,
    applyTaskFilter,
    setItemPhaseResolver,
} from '../src/taskFilter.js';
import {
    getPhaseFilter, setPhaseFilter,
    PHASE_FILTER_KEY,
} from '../src/prefs.js';

// The DESKTOP filter is three always-visible pills (ALL / IN PROGRESS / DONE)
// that mix manual status and derived phase deliberately. It is now the SAME filter
// vocabulary the mobile cycle pill uses, sharing one persisted key across both
// breakpoints. ALL is open work (every uncompleted task), IN PROGRESS is work you
// or the machine are doing (status in_progress, or phase draft/running), DONE is
// shipped-and-acknowledged work still open in the list (phase done AND NOT checked
// off — a strict subset of ALL, so checked-off rows never appear under it).
// taskFilter.js never imports phase.js (import cycle), so the phase test is
// injected through setItemPhaseResolver — mirroring how toDoRow.js injects
// `derivePhase` in the real app. These tests register a light resolver reading a
// `ph` string off the row's __item.

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

    it('ALL shows every uncompleted task and leaves the checked-off one to the COMPLETED collapse', () => {
        const { bar, idea, inprog, draft, running, accept, done, completed } = seed();
        applyTaskFilter();
        [idea, inprog, draft, running, accept, done].forEach(r => expect(isHidden(r)).toBe(false));
        // The desktop filter no longer hides completed rows — the COMPLETED
        // section's own collapse is their sole authority — so no taskFilterHidden.
        expect(isHidden(completed)).toBe(false);
        expect(phaseCount(bar, 'all')).toBe('6'); // completed still excluded from the ALL count
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
        // Completed rows are exempt from the desktop filter (COMPLETED collapse owns them).
        expect(isHidden(completed)).toBe(false);
        expect(phaseCount(bar, 'inprogress')).toBe('3');
    });

    it('DONE shows the shipped-and-acknowledged row and excludes the checked-off one from its count', () => {
        const { bar, idea, inprog, draft, running, accept, done, completed } = seed();
        phasePill(bar, 'done').click();
        expect(getPhaseFilter()).toBe('done');
        expect(isHidden(done)).toBe(false);
        // Checked-off rows are excluded from the DONE COUNT, but the filter no
        // longer hides them — the COMPLETED collapse governs their visibility.
        expect(isHidden(completed)).toBe(false);
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
        // The checked-off done-phase row is excluded from the DONE count, but the
        // filter leaves its visibility to the COMPLETED collapse (no taskFilterHidden).
        expect(isHidden(shippedThenChecked)).toBe(false);
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
        // The count matches exactly the OPEN rows the pill renders: non-completed
        // and not filter-hidden. Completed rows are exempt from the filter (the
        // COMPLETED collapse owns them), so they are excluded here by the completed
        // flag rather than by taskFilterHidden.
        const visible = Array.from(ml.querySelectorAll('#toDoChild'))
            .filter(r => r.__item && r.__item.tit && !r.__item.completed && !isHidden(r));
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


describe('desktop pills — completed rows exempt (COMPLETED collapse is sole authority)', () => {
    it('never filter-hides a completed row under ALL, IN PROGRESS, or DONE', () => {
        const ml = makeMainList();
        const completed = makeRow('C', 'done', { status: 'active', completed: true });
        ml.append(makeRow('Open', 'draft'), completed);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        ['all', 'inprogress', 'done'].forEach(key => {
            phasePill(bar, key).click();
            expect(isHidden(completed)).toBe(false);
        });
    });

    it('counts still exclude completed rows even though they are never hidden', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('Open', 'done'),
            makeRow('C1', 'done', { completed: true }),
            makeRow('C2', 'none', { status: 'in_progress', completed: true }),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        expect(phaseCount(bar, 'all')).toBe('1');        // only the open row
        expect(phaseCount(bar, 'inprogress')).toBe('0'); // completed in_progress excluded
        expect(phaseCount(bar, 'done')).toBe('1');       // only the open done row
    });

    it('exempts completed rows at the MOBILE breakpoint too (one shared predicate)', () => {
        // The mobile cycle pill now runs the same predicate as the desktop pills, so
        // completed rows are exempt at both widths — expanding COMPLETED on a phone
        // must reveal its rows under every filter, not leave them filter-hidden.
        const ml = makeMainList();
        const completed = makeRow('C', 'none', { status: 'active', completed: true });
        ml.append(makeRow('Idea', 'none', { status: 'idea' }), completed);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        // A non-ALL filter at mobile width never hides the completed row.
        setWidth(800);
        setPhaseFilter('inprogress');
        applyTaskFilter();
        expect(isHidden(completed)).toBe(false);

        // Same at desktop width.
        setWidth(1280);
        applyTaskFilter();
        expect(isHidden(completed)).toBe(false);
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


describe('one vocabulary, one key — shared across breakpoints', () => {
    it('the same predicate governs at both widths, so a filter survives a resize', () => {
        // A running row (phase running) and an idea row (phase none) under the
        // single IN PROGRESS filter. The mobile cycle pill and the desktop pills
        // now read one key and match identically, so the same row shows at both
        // widths — there is no second vocabulary to desync.
        setPhaseFilter('inprogress');
        const ml = makeMainList();
        const running = makeRow('Running', 'running', { status: 'active' });
        const idea = makeRow('Idea', 'none', { status: 'idea' });
        ml.append(running, idea);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        // Desktop width: only the in-progress (running) row shows.
        setWidth(1280);
        applyTaskFilter();
        expect(isHidden(running)).toBe(false);
        expect(isHidden(idea)).toBe(true);

        // Mobile width: identical result — the same key, the same predicate.
        setWidth(800);
        applyTaskFilter();
        expect(isHidden(running)).toBe(false);
        expect(isHidden(idea)).toBe(true);
        expect(getPhaseFilter()).toBe('inprogress');
    });

    it('the mobile cycle pill and the desktop pills drive the same persisted key', () => {
        setPhaseFilter('all');
        const ml = makeMainList();
        ml.append(makeRow('R', 'running'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        // Set via the desktop pill …
        phasePill(bar, 'inprogress').click();
        expect(getPhaseFilter()).toBe('inprogress');

        // … then advance via the mobile cycle pill: same key, one step on.
        bar.querySelector('.taskCyclePill').click(); // inprogress → done
        expect(getPhaseFilter()).toBe('done');
    });
});
