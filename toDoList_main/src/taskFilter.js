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
// is visible under that filter; ALL matches everything.
const FILTERS = [
    { key: 'all',    label: 'ALL',    match: function () { return true; } },
    { key: 'active', label: 'Active', match: function (s) { return s === 'active' || s === 'in_progress'; } },
    { key: 'ideas',  label: 'Ideas',  match: function (s) { return s === 'idea'; } },
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


// Build the pill row element. The bar holds a SINGLE cycle pill that rotates
// through all → active → ideas → all … on each click; it paints the currently
// active filter's label + count plus a muted trailing `›` as the cycle hint.
// One delegated click handler advances the persisted filter and repaints in
// place. The bar lives in #mainBar (outside #mainList) so the list's
// clear-and-rebuild cycles never destroy it.
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

    // Muted trailing glyph hinting the control cycles rather than toggles. Kept
    // as a real text node (not a ::after) so the cue rides in the pill's
    // textContent in every state.
    const cueSpan = document.createElement('span');
    cueSpan.className = 'taskFilterCycleCue';
    cueSpan.setAttribute('aria-hidden', 'true');
    cueSpan.textContent = '›';
    pill.appendChild(cueSpan);

    bar.appendChild(pill);
    paintCyclePill(bar);

    bar.addEventListener('click', function (event) {
        const clicked = event.target.closest && event.target.closest('.taskFilterPill');
        if (!clicked || !bar.contains(clicked)) return;
        const current = getTaskFilter();
        let idx = FILTERS.findIndex(function (f) { return f.key === current; });
        if (idx < 0) idx = 0;
        const next = FILTERS[(idx + 1) % FILTERS.length];
        setTaskFilter(next.key);
        paintCyclePill(bar);
        applyTaskFilter();
    });

    return bar;
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
        total += 1;
        counts.all += 1;
        if (status === 'active' || status === 'in_progress') counts.active += 1;
        if (status === 'idea') counts.ideas += 1;

        const show = activeFilter.match(status);
        if (show) visible += 1;
        setRowHidden(row, !show);
    });

    updateCounts(counts);
    updateFilterEmptyState(mainList, active, total, visible);
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
    const pill = bar.querySelector('.taskCyclePill');
    if (!pill) return;
    const key = pill.getAttribute('data-filter');
    const countSpan = pill.querySelector('.taskFilterCount');
    if (countSpan) countSpan.textContent = String(counts[key] != null ? counts[key] : 0);
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
