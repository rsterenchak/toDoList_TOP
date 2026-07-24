import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    buildTaskFilterBar,
    applyTaskFilter,
    setBlockedItemResolver,
} from '../src/taskFilter.js';
import {
    getTaskFilter,
    setTaskFilter,
    getBlockedFilter,
    setBlockedFilter,
} from '../src/prefs.js';
import { isBlockedPhase, PHASE } from '../src/phase.js';

// The blocked-on-you chip filters the list to rows whose DERIVED phase is blocked
// on the user (REVIEW / ASKING / DRAFTED). taskFilter.js never imports phase.js —
// it would close an import cycle — so the phase test is injected through
// setBlockedItemResolver. These tests register a light resolver that reads a
// `blk` flag off the row's __item, mirroring how toDoRow.js injects
// `item => isBlockedPhase(derivePhase(item))` in the real app.

function makeMainList() {
    const ml = document.createElement('div');
    ml.id = 'mainList';
    document.body.appendChild(ml);
    return ml;
}

function makeRow(tit, status, opts) {
    const o = opts || {};
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = { tit: tit, status: status, completed: !!o.completed, blk: !!o.blocked };
    row.setAttribute('data-value', 'Inbox');
    return row;
}

function chip(bar) {
    return bar.querySelector('.taskFilterBlockedChip');
}
function chipCount(bar) {
    return chip(bar).querySelector('.taskFilterBlockedCount').textContent;
}
function isHidden(row) {
    return row.classList.contains('taskFilterHidden');
}

beforeEach(() => {
    document.body.innerHTML = '';
    try { localStorage.clear(); } catch (e) { /* ignore */ }
    // Default resolver for these tests: a row is blocked iff its __item.blk flag
    // is set. Individual tests may override it.
    setBlockedItemResolver(item => !!(item && item.blk));
});

afterEach(() => {
    vi.restoreAllMocks();
    setBlockedItemResolver(null);
});


// (a) The blocked set is EXACTLY the three phases — the single definition in
// phase.js that the chip reads, so a fourth blocked state later lands in one
// place.
describe('isBlockedPhase — the blocked set is exactly {accept, asking, drafted}', () => {
    it('matches the three blocked phases and nothing else', () => {
        expect(isBlockedPhase(PHASE.ACCEPT)).toBe(true);
        expect(isBlockedPhase(PHASE.ASKING)).toBe(true);
        expect(isBlockedPhase(PHASE.DRAFTED)).toBe(true);

        expect(isBlockedPhase(PHASE.NONE)).toBe(false);
        expect(isBlockedPhase(PHASE.DRAFT)).toBe(false);
        expect(isBlockedPhase(PHASE.DONE)).toBe(false);
        expect(isBlockedPhase(undefined)).toBe(false);
    });
});


// The chip is ALWAYS mounted (never conditionally), regardless of count.
describe('blocked chip — always present, dimmed + inert at zero', () => {
    it('mounts exactly one chip in the bar', () => {
        const bar = buildTaskFilterBar();
        expect(bar.querySelectorAll('.taskFilterBlockedChip').length).toBe(1);
    });

    it('renders dimmed, disabled, and showing 0 when no task is blocked', () => {
        const ml = makeMainList();
        ml.append(makeRow('A', 'active'), makeRow('B', 'idea'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        expect(chipCount(bar)).toBe('0');
        expect(chip(bar).disabled).toBe(true);
        expect(chip(bar).classList.contains('taskFilterBlockedChip--empty')).toBe(true);
        expect(chip(bar).getAttribute('aria-pressed')).toBe('false');
    });

    it('enables and counts the blocked tasks from the full committed set', () => {
        const ml = makeMainList();
        ml.append(
            makeRow('A', 'active', { blocked: true }),
            makeRow('B', 'idea', { blocked: true }),
            makeRow('C', 'active'),
            // Completed rows are excluded from the blocked count, matching the
            // status pill counts.
            makeRow('D', 'active', { blocked: true, completed: true }),
        );
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        expect(chipCount(bar)).toBe('2');
        expect(chip(bar).disabled).toBe(false);
        expect(chip(bar).classList.contains('taskFilterBlockedChip--empty')).toBe(false);
    });

    it('a click on the inert (zero-count) chip is a no-op', () => {
        const ml = makeMainList();
        ml.append(makeRow('A', 'active'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        chip(bar).click();
        expect(getBlockedFilter()).toBe(false);
    });
});


// (b) Tapping the chip filters to blocked rows only AND snaps the status pill to
// ALL, so the two controls are never both filtering.
describe('engaging the blocked filter', () => {
    it('shows only blocked rows and snaps the status pill to ALL', () => {
        setTaskFilter('ideas'); // start on a non-ALL status filter
        const ml = makeMainList();
        const blocked = makeRow('Blocked', 'active', { blocked: true });
        const idea = makeRow('Idea', 'idea');
        const active = makeRow('Active', 'active');
        ml.append(blocked, idea, active);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        chip(bar).click();

        expect(getBlockedFilter()).toBe(true);
        // Status pill snapped to ALL — the two controls never both filter.
        expect(getTaskFilter()).toBe('all');
        // Only the blocked row is visible.
        expect(isHidden(blocked)).toBe(false);
        expect(isHidden(idea)).toBe(true);
        expect(isHidden(active)).toBe(true);
        expect(chip(bar).classList.contains('selected')).toBe(true);
    });

    it('tapping again releases the filter, leaving the pill on ALL', () => {
        const ml = makeMainList();
        const blocked = makeRow('Blocked', 'active', { blocked: true });
        const active = makeRow('Active', 'active');
        ml.append(blocked, active);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        chip(bar).click();   // engage
        chip(bar).click();   // release

        expect(getBlockedFilter()).toBe(false);
        expect(getTaskFilter()).toBe('all');
        expect(isHidden(blocked)).toBe(false);
        expect(isHidden(active)).toBe(false);
    });

    it('persists across a reload alongside the status filter preference', () => {
        const ml = makeMainList();
        ml.append(makeRow('Blocked', 'active', { blocked: true }), makeRow('Other', 'active'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        applyTaskFilter();
        chip(bar).click();
        expect(getBlockedFilter()).toBe(true);

        // Simulate a reload: tear down the DOM, keep localStorage, rebuild with
        // the same still-blocked rows so the boot-time zero-count release doesn't
        // fire.
        document.body.innerHTML = '';
        const ml2 = makeMainList();
        ml2.append(makeRow('Blocked', 'active', { blocked: true }), makeRow('Other', 'active'));
        const bar2 = buildTaskFilterBar();
        document.body.appendChild(bar2);
        applyTaskFilter();

        expect(getBlockedFilter()).toBe(true);
        expect(chip(bar2).classList.contains('selected')).toBe(true);
    });
});


// Selecting a status filter releases the blocked filter — the two never compose
// (out of scope: a blocked filter AND a non-ALL status filter).
describe('status filter selection releases the blocked filter', () => {
    it('cycling the status pill releases an active blocked filter', () => {
        const ml = makeMainList();
        ml.append(makeRow('Blocked', 'active', { blocked: true }), makeRow('Idea', 'idea'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        chip(bar).click();
        expect(getBlockedFilter()).toBe(true);

        bar.querySelector('.taskCyclePill').click(); // all → active
        expect(getBlockedFilter()).toBe(false);
        expect(getTaskFilter()).toBe('active');
    });

    it('tapping a mobile segment releases an active blocked filter', () => {
        const ml = makeMainList();
        ml.append(makeRow('Blocked', 'active', { blocked: true }), makeRow('Idea', 'idea'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        chip(bar).click();
        expect(getBlockedFilter()).toBe(true);

        const ideasSeg = Array.from(bar.querySelectorAll('.taskFilterSeg'))
            .filter(s => s.getAttribute('data-seg') === 'ideas')[0];
        ideasSeg.click();
        expect(getBlockedFilter()).toBe(false);
        expect(getTaskFilter()).toBe('ideas');
    });
});


// (c) Auto-release when the count falls to zero, and it fires exactly once.
describe('auto-release on zero count', () => {
    it('releases when the last blocked task clears, and does not loop', () => {
        const resolver = vi.fn(item => !!(item && item.blk));
        setBlockedItemResolver(resolver);

        const ml = makeMainList();
        const r1 = makeRow('A', 'active', { blocked: true });
        const r2 = makeRow('B', 'active');
        ml.append(r1, r2);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        chip(bar).click(); // engage — one blocked row visible
        expect(getBlockedFilter()).toBe(true);
        expect(isHidden(r1)).toBe(false);
        expect(isHidden(r2)).toBe(true);

        // The blocked row is acknowledged → no longer blocked. A repaint recounts
        // and must auto-release rather than strand the user in an empty view.
        r1.__item.blk = false;
        resolver.mockClear();
        applyTaskFilter();

        expect(getBlockedFilter()).toBe(false);
        // Full list returns.
        expect(isHidden(r1)).toBe(false);
        expect(isHidden(r2)).toBe(false);
        // Fires exactly once: the resolver runs over the two non-completed rows
        // for the engaged pass and once more for the single auto-release pass — a
        // loop would blow far past 2 rows × 2 passes.
        expect(resolver.mock.calls.length).toBe(4);
    });

    it('a stored-active preference with a zero count boots released', () => {
        // Persisted active, but nothing is blocked once the rows render.
        setBlockedFilter(true);
        const ml = makeMainList();
        ml.append(makeRow('A', 'active'), makeRow('B', 'idea'));
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        expect(getBlockedFilter()).toBe(false);
        // Nothing hidden — the full list shows.
        expect(document.getElementById('taskFilterEmpty')).toBeNull();
    });

    it('does not release on the boot-time call against an unrendered list', () => {
        // main.js calls applyTaskFilter() once before any project rows exist.
        // A stored-active preference must survive that empty pass (total === 0)
        // so it can engage once the rows render.
        setBlockedFilter(true);
        makeMainList(); // empty list
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        expect(getBlockedFilter()).toBe(true);
    });
});


// (d) The blank placeholder row (empty title) always stays visible, even under
// the blocked filter.
describe('placeholder row visibility under the blocked filter', () => {
    it('never hides the blank placeholder row', () => {
        const ml = makeMainList();
        const blank = makeRow('', 'active');            // placeholder, not blocked
        const blocked = makeRow('Blocked', 'active', { blocked: true });
        ml.append(blank, blocked);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        applyTaskFilter();
        chip(bar).click(); // engage blocked-only

        expect(isHidden(blank)).toBe(false);
        expect(isHidden(blocked)).toBe(false);
    });
});


// A resolver that throws must never hide the list or throw on the render path —
// it degrades to "nothing blocked".
describe('resolver failure degrades gracefully', () => {
    it('renders the list in full and shows a zero count when the resolver throws', () => {
        setBlockedItemResolver(() => { throw new Error('boom'); });
        const ml = makeMainList();
        const a = makeRow('A', 'active');
        const b = makeRow('B', 'idea');
        ml.append(a, b);
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);

        expect(() => applyTaskFilter()).not.toThrow();
        expect(chipCount(bar)).toBe('0');
        expect(isHidden(a)).toBe(false);
        expect(isHidden(b)).toBe(false);
    });
});
