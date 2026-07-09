// Status filter pills (ALL / Active / Ideas) above the task list.
//
// The pill row is a pure VIEW concern: it never re-queries Supabase and never
// mutates the data model. It reads the workflow `status` field already present
// on each committed row's `__item` anchor and toggles row visibility with a
// CSS class, leaving every row's listeners and state untouched. The selected
// filter persists via prefs (`todoapp_taskFilter`) so a filtered session is
// restored on reload.
//
//   • ALL    — every task, regardless of status.
//   • Active — status `active` OR `in_progress` (the committed work).
//   • Ideas  — status `idea`.
//
// Counts in the pills are computed from the FULL current task list (every
// committed row), not the filtered subset, so all three numbers are always
// visible at once. Pill clicks route through a single delegated handler on the
// bar — matching the module-level-listener-avoidance pattern used elsewhere
// (see todoStatus.js). Row hiding uses a class rather than an inline style so
// the known fragile inline-style override pattern is avoided.

import { getTaskFilter, setTaskFilter } from './prefs.js';
import { sizeMainListGhostSpacer } from './emptyState.js';


// Known workflow statuses. Mirrors listLogic/todoStatus normalisation so a
// cached row predating the field (status undefined) reads as 'active'. Inlined
// rather than imported to keep this module's only dependency `prefs` — the
// status-change path imports applyTaskFilter from here, and a back-import would
// form a cycle.
const KNOWN_STATUSES = { active: true, in_progress: true, idea: true };
function normalizeStatus(status) {
    return KNOWN_STATUSES[status] ? status : 'active';
}


// Order + display label for each pill. `match` decides whether a given status
// is visible under that filter; ALL matches everything. `seg` is the
// normal-case label used by the mobile segmented control (the desktop cycle
// pill keeps the uppercase `label`).
const FILTERS = [
    { key: 'all',    label: 'ALL',    seg: 'All',    match: function () { return true; } },
    { key: 'active', label: 'Active', seg: 'Active', match: function (s) { return s === 'active' || s === 'in_progress'; } },
    { key: 'ideas',  label: 'Ideas',  seg: 'Ideas',  match: function (s) { return s === 'idea'; } },
];

// Empty-state copy shown when the active filter hides every task (but the
// project still has tasks under other filters). ALL is omitted — it can only
// be empty when the project itself is empty, which the project empty-state
// already covers.
const EMPTY_MESSAGES = {
    active: 'Nothing active right now.',
    ideas: 'No ideas captured yet.',
};

const HIDDEN_CLASS = 'taskFilterHidden';


// Is this row a committed task row (has a real title), as opposed to the blank
// "type the next…" placeholder that must always stay visible?
function isCommittedRow(row) {
    return !!(row && row.__item && row.__item.tit);
}

function rowStatus(row) {
    return normalizeStatus(row.__item && row.__item.status);
}


// Look up a FILTERS entry by key, falling back to the first (ALL) when the
// stored value is unrecognised.
function filterFor(key) {
    return FILTERS.filter(function (f) { return f.key === key; })[0] || FILTERS[0];
}


// Build the pill row element. The bar holds TWO filter controls that share one
// persisted state (`getTaskFilter`/`setTaskFilter`), gated by CSS so exactly
// one is ever visible — mirroring the dual Sort-trigger pattern:
//   • Desktop: a SINGLE cycle pill that rotates through all → active → ideas →
//     all … on each click, painting the active filter's label + count plus a
//     muted trailing `›` cycle hint.
//   • Mobile: a three-segment control (All · Active · Ideas, each with its live
//     count) that sets the filter directly on tap — no cycling.
// One delegated click handler routes both: a segment sets its filter directly,
// the cycle pill advances one step. Both repaint together so the hidden control
// stays in sync with the visible one. The bar lives in #mainBar (outside
// #mainList) so the list's clear-and-rebuild cycles never destroy it.
export function buildTaskFilterBar() {
    const bar = document.createElement('div');
    bar.id = 'taskFilterBar';
    bar.className = 'taskFilterBar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Filter tasks by status');

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'taskFilterPill taskCyclePill selected';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'taskFilterPillLabel';
    pill.appendChild(labelSpan);

    const countSpan = document.createElement('span');
    countSpan.className = 'taskFilterCount';
    countSpan.textContent = '0';
    pill.appendChild(countSpan);

    // Position indicator: one dot per filter, the active filter's dot filled, so
    // the two hidden filters stay discoverable as the pill cycles. Decorative
    // (aria-hidden) — the pill's aria-label already announces the active filter
    // + "tap to cycle". Replaces the earlier trailing `›` cycle cue.
    const dots = document.createElement('span');
    dots.className = 'taskFilterDots';
    dots.setAttribute('aria-hidden', 'true');
    FILTERS.forEach(function () {
        const dot = document.createElement('span');
        dot.className = 'taskFilterDot';
        dots.appendChild(dot);
    });
    pill.appendChild(dots);

    bar.appendChild(pill);
    bar.appendChild(buildSegmentedControl());
    paintCyclePill(bar);
    paintSegmented(bar);

    bar.addEventListener('click', function (event) {
        if (!event.target.closest) return;

        // Mobile segment — set its filter directly, no cycling.
        const seg = event.target.closest('.taskFilterSeg');
        if (seg && bar.contains(seg)) {
            const key = seg.getAttribute('data-seg');
            if (!key || key === getTaskFilter()) {
                // Still repaint to settle any stale visual state, then re-apply.
                paintCyclePill(bar);
                paintSegmented(bar);
                applyTaskFilter();
                return;
            }
            setTaskFilter(key);
            paintCyclePill(bar);
            paintSegmented(bar);
            applyTaskFilter();
            return;
        }

        // Desktop cycle pill — advance one step.
        const clicked = event.target.closest('.taskCyclePill');
        if (!clicked || !bar.contains(clicked)) return;
        const current = getTaskFilter();
        let idx = FILTERS.findIndex(function (f) { return f.key === current; });
        if (idx < 0) idx = 0;
        const next = FILTERS[(idx + 1) % FILTERS.length];
        setTaskFilter(next.key);
        paintCyclePill(bar);
        paintSegmented(bar);
        applyTaskFilter();
    });

    return bar;
}


// Is this control on-screen and focusable? getClientRects() is empty for a
// display:none element (and any display:none ancestor — including the whole bar
// in Agent/Structure views), so it doubles as the visibility test; a disabled
// or tabindex=-1 control is skipped. Shared by the arrow-key helpers below so
// the CSS-hidden breakpoint complement never becomes a focus stop.
function isOnScreenFocusable(el) {
    return !!el && !el.disabled && el.getClientRects().length > 0 && el.tabIndex !== -1;
}


// Return the first visible, focusable control inside #taskFilterBar so the
// arrow-key nav chain can land a stop on the status/sort bar between the view
// switcher and the todo list. The bar holds a desktop cycle pill, a mobile
// three-segment control, and the mobile Sort trigger; desktop and mobile
// controls are CSS-hidden complements of each other, so getClientRects()
// (empty for display:none and any display:none ancestor — including the whole
// bar in Agent/Structure views) selects only the on-screen one, the same
// visibility test popoverArrowNav uses. Returns null when nothing is on screen
// (e.g. the bar is hidden outside the Projects view), so callers fall through
// to their previous target.
export function firstFocusableInTaskFilterBar() {
    const bar = document.getElementById('taskFilterBar');
    if (!bar) return null;
    const candidates = bar.querySelectorAll(
        '.taskCyclePill, .taskFilterSeg, #taskSortBtn, #taskSortBtnMobile'
    );
    for (let i = 0; i < candidates.length; i++) {
        if (isOnScreenFocusable(candidates[i])) return candidates[i];
    }
    return null;
}


// Ordered, on-screen filter/sort controls for Left/Right roving focus. The bar
// pairs a status filter with a Sort trigger; the horizontal arrows walk between
// them left-to-right. Desktop resolves to [cycle pill, #taskSortBtn]; mobile to
// [segment…, #taskSortBtnMobile]. The desktop Sort trigger lives in the sibling
// #bulkDescActions overlay (not inside the bar), so it is looked up by id here
// rather than queried within the bar. Only on-screen, focusable controls are
// included, so the CSS-hidden breakpoint complement is never an arrow stop.
function taskFilterArrowOrder() {
    const order = [];
    const bar = document.getElementById('taskFilterBar');
    if (bar) {
        const pill = bar.querySelector('.taskCyclePill');
        if (isOnScreenFocusable(pill)) {
            order.push(pill);
        } else {
            bar.querySelectorAll('.taskFilterSeg').forEach(function (seg) {
                if (isOnScreenFocusable(seg)) order.push(seg);
            });
        }
    }
    const desktopSort = document.getElementById('taskSortBtn');
    const mobileSort = document.getElementById('taskSortBtnMobile');
    if (isOnScreenFocusable(desktopSort)) order.push(desktopSort);
    else if (isOnScreenFocusable(mobileSort)) order.push(mobileSort);
    return order;
}


// Resolve where a Left/Right keystroke on a focused filter/sort control should
// send focus, or null when it should be left to the browser. Movement is
// clamped at both ends (no wrap): ArrowRight past the last control and ArrowLeft
// before the first return null so the keystroke passes through unchanged — this
// mirrors the header roving-focus pattern. Only ArrowLeft/ArrowRight are
// handled, so Enter/Space (activate) and the vertical ArrowUp/ArrowDown stops
// are untouched. Returns null unless the bar exposes at least two on-screen
// controls and the focused control is one of them.
export function taskFilterArrowTarget(focusedEl, key) {
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
    const order = taskFilterArrowOrder();
    if (order.length < 2) return null;
    const idx = order.indexOf(focusedEl);
    if (idx === -1) return null;
    const nextIdx = key === 'ArrowRight' ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= order.length) return null;
    return order[nextIdx];
}


// Build the mobile three-segment filter control: one segment per FILTERS entry,
// each carrying its normal-case label and a live count. CSS hides it on desktop
// (the cycle pill owns that breakpoint) and reveals it on mobile. Tapping a
// segment sets that filter directly through the bar's delegated handler.
function buildSegmentedControl() {
    const seg = document.createElement('div');
    seg.className = 'taskFilterSegmented';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Filter tasks by status');

    FILTERS.forEach(function (f) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'taskFilterSeg';
        btn.setAttribute('data-seg', f.key);
        btn.setAttribute('aria-pressed', 'false');

        const label = document.createElement('span');
        label.className = 'taskFilterSegLabel';
        label.textContent = f.seg;
        btn.appendChild(label);

        const count = document.createElement('span');
        count.className = 'taskFilterSegCount';
        count.textContent = '0';
        btn.appendChild(count);

        seg.appendChild(btn);
    });

    return seg;
}


// Reflect the persisted filter onto the cycle pill's label, data-filter, and
// aria state. The count is refreshed separately by applyTaskFilter → updateCounts.
function paintCyclePill(bar) {
    const pill = bar.querySelector('.taskCyclePill');
    if (!pill) return;
    const filter = filterFor(getTaskFilter());
    pill.setAttribute('data-filter', filter.key);
    pill.setAttribute('aria-label', 'Filter: ' + filter.label + '. Tap to cycle filters.');
    const labelSpan = pill.querySelector('.taskFilterPillLabel');
    if (labelSpan) labelSpan.textContent = filter.label;
    // Position dots: fill the dot at the active filter's index (all=0,
    // active=1, ideas=2) and clear the rest, so the two hidden filters stay
    // discoverable.
    const idx = FILTERS.findIndex(function (f) { return f.key === filter.key; });
    const dots = pill.querySelectorAll('.taskFilterDot');
    dots.forEach(function (dot, i) {
        dot.classList.toggle('taskFilterDot--on', i === idx);
    });
}


// Reflect the persisted filter onto the mobile segmented control: tint the
// active segment and update aria-pressed. Runs in lockstep with paintCyclePill
// so the hidden control matches the visible one regardless of breakpoint.
function paintSegmented(bar) {
    const active = filterFor(getTaskFilter()).key;
    const segs = bar.querySelectorAll('.taskFilterSeg');
    segs.forEach(function (seg) {
        const isActive = seg.getAttribute('data-seg') === active;
        seg.classList.toggle('selected', isActive);
        seg.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}


// Apply the current filter to #mainList: update pill counts from the full task
// list, toggle each committed row's visibility (carrying any open description /
// stats drawer with it), and show a filter-specific empty state when the
// selection hides every task. Safe to call when the bar or list is absent —
// the render-path hooks fire on boot before either is guaranteed present.
export function applyTaskFilter() {
    const mainList = document.getElementById('mainList');
    if (!mainList) return;

    const active = getTaskFilter();
    const activeFilter = FILTERS.filter(function (f) { return f.key === active; })[0] || FILTERS[0];

    const counts = { all: 0, active: 0, ideas: 0 };
    let total = 0;
    let visible = 0;

    const rows = mainList.querySelectorAll('#toDoChild');
    rows.forEach(function (row) {
        if (!isCommittedRow(row)) return;
        const status = rowStatus(row);
        // Completed rows keep their original `status` (so un-completing restores
        // the category), but they belong to the COMPLETED section's own count —
        // excluding them here keeps the filter pills reporting non-completed
        // work only. Row hiding (setRowHidden) stays unconditional so the
        // filter-match partition still applies when COMPLETED is expanded.
        const isCompleted = !!(row.__item && row.__item.completed);
        if (!isCompleted) {
            total += 1;
            counts.all += 1;
            if (status === 'active' || status === 'in_progress') counts.active += 1;
            if (status === 'idea') counts.ideas += 1;
        }

        const show = activeFilter.match(status);
        if (show && !isCompleted) visible += 1;
        setRowHidden(row, !show);
    });

    updateCounts(counts);
    updateFilterEmptyState(mainList, active, total, visible);

    // Filtering hides/shows rows via a class with no DOM mutation or resize, so
    // re-size the ghost spacer here too — otherwise hiding rows could shrink the
    // list below the viewport without the spacer re-expanding to fill the void.
    sizeMainListGhostSpacer(mainList);
}


// Toggle the hidden class on a committed row and any drawer panels that trail
// it (an open description or recurring-stats panel sits as a consecutive
// sibling — mirror reorderToDoDOM's auxiliary-panel awareness).
function setRowHidden(row, hidden) {
    row.classList.toggle(HIDDEN_CLASS, hidden);
    let next = row.nextSibling;
    while (next && (next.id === 'descSibling' || next.id === 'statsSibling')) {
        if (next.classList) next.classList.toggle(HIDDEN_CLASS, hidden);
        next = next.nextSibling;
    }
}


function updateCounts(counts) {
    const bar = document.getElementById('taskFilterBar');
    if (!bar) return;

    // Desktop cycle pill — shows only the active filter's count.
    const pill = bar.querySelector('.taskCyclePill');
    if (pill) {
        const key = pill.getAttribute('data-filter');
        const countSpan = pill.querySelector('.taskFilterCount');
        if (countSpan) countSpan.textContent = String(counts[key] != null ? counts[key] : 0);
    }

    // Mobile segmented control — every segment shows its own live count.
    const segs = bar.querySelectorAll('.taskFilterSeg');
    segs.forEach(function (seg) {
        const segKey = seg.getAttribute('data-seg');
        const segCount = seg.querySelector('.taskFilterSegCount');
        if (segCount) segCount.textContent = String(counts[segKey] != null ? counts[segKey] : 0);
    });
}


// Show a small centred message when the active filter (Active / Ideas) hides
// every task while the project still holds tasks under another filter. Removed
// whenever something is visible, the list is genuinely empty (ALL / project
// empty-state owns that), or the filter is ALL.
function updateFilterEmptyState(mainList, active, total, visible) {
    const existing = document.getElementById('taskFilterEmpty');
    const message = EMPTY_MESSAGES[active];
    const shouldShow = !!message && total > 0 && visible === 0;

    if (!shouldShow) {
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        return;
    }

    if (existing) {
        existing.textContent = message;
        return;
    }

    const empty = document.createElement('div');
    empty.id = 'taskFilterEmpty';
    empty.className = 'taskFilterEmpty';
    empty.textContent = message;
    mainList.appendChild(empty);
}
