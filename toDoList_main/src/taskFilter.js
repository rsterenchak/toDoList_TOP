// Task filter (ALL / IN PROGRESS / DONE) above the task list.
//
// The filter bar is a pure VIEW concern: it never re-queries Supabase and never
// mutates the data model. It reads each committed row's `__item` anchor —
// manual `status`, derived pipeline phase, and the checkbox-completed flag — and
// toggles row visibility with a CSS class, leaving every row's listeners and
// state untouched. The selected filter persists via prefs (`todoapp_phaseFilter`)
// so a filtered session is restored on reload.
//
//   • ALL         — every task that is NOT checked off (open work of any status).
//   • IN PROGRESS — manual status `in_progress`, OR derived phase `draft`/`running`;
//                   never a task whose phase is `done`.
//   • DONE        — derived phase `done` AND not checked off.
//
// This ONE vocabulary now drives BOTH breakpoints: the desktop three-pill control
// and the mobile cycle pill (with its segmented sibling) share a single persisted
// key, so crossing the breakpoint keeps the same filter active. Counts in the
// controls are computed from the FULL current task list (every committed row),
// not the filtered subset, so all three numbers are always visible at once. Pill
// clicks route through a single delegated handler on the bar — matching the
// module-level-listener-avoidance pattern used elsewhere (see todoStatus.js). Row
// hiding uses a class rather than an inline style so the known fragile
// inline-style override pattern is avoided.

import {
    getPhaseFilter, setPhaseFilter,
    getBlockedFilter, setBlockedFilter,
} from './prefs.js';
import { sizeMainListGhostSpacer } from './emptyState.js';


// The bar hosts ONE filter vocabulary (ALL / IN PROGRESS / DONE) rendered by two
// interchangeable controls, gated by CSS so exactly one shows per breakpoint:
//   • Mobile (≤1023px): a single cycle pill (tap to advance) plus a segmented
//     sibling, both cycling the three phase-aware filters.
//   • Desktop (≥1024px): a three-pill control, one pill per filter.
// Both controls persist under the same `todoapp_phaseFilter` key and run the same
// predicate, so crossing the breakpoint keeps the same filter active — there is no
// longer a second status vocabulary that a resize could desync. The blocked-on-you
// chip is a width-agnostic overlay filter present at both breakpoints.


// The filter keys off a row's DERIVED phase, but taskFilter.js
// must not import phase.js — that would close the same import cycle the blocked
// resolver dodges (taskFilter → phase → inject → modals → toDoRow → taskFilter).
// toDoRow.js, which already imports both, registers `derivePhase` here. Until it
// does, the resolver is absent and every phase resolves to null, so IN PROGRESS
// and DONE count zero and ALL still shows everything (never hides the list).
let itemPhaseResolver = null;

export function setItemPhaseResolver(fn) {
    itemPhaseResolver = typeof fn === 'function' ? fn : null;
}

function phaseOf(item) {
    if (!itemPhaseResolver || !item) return null;
    try {
        return itemPhaseResolver(item);
    } catch (e) {
        return null;
    }
}


// The blocked-on-you chip filters on a row's DERIVED phase (see phase.js's
// isBlockedPhase). This module must not import phase.js directly: that would
// close an import cycle — taskFilter → phase → inject → modals → toDoRow →
// taskFilter — so the phase test is injected instead. A module that already
// depends on both (toDoRow.js) registers the resolver once via
// setBlockedItemResolver; until it does, the chip resolves to zero blocked rows
// and stays inert. Keeping `prefs` as the only hard dependency preserves the
// same acyclic property the status filter relies on.
let blockedItemResolver = null;

export function setBlockedItemResolver(fn) {
    blockedItemResolver = typeof fn === 'function' ? fn : null;
}

// Is this row's item blocked on the user? Delegates to the injected resolver and
// degrades to "not blocked" when the resolver is absent or throws, so a resolver
// failure can never hide the list or throw on the render path.
function isBlockedItem(item) {
    if (!blockedItemResolver || !item) return false;
    try {
        return !!blockedItemResolver(item);
    } catch (e) {
        return false;
    }
}

// Re-entrancy guard for the zero-count auto-release: flipping the pref repaints,
// which recomputes the count and could re-enter applyTaskFilter. The guard makes
// the release perform exactly one pass and stop rather than loop.
let releasingBlocked = false;


// Known workflow statuses. Mirrors listLogic/todoStatus normalisation so a
// cached row predating the field (status undefined) reads as 'active'. Inlined
// rather than imported to keep this module's only dependency `prefs` — the
// status-change path imports applyTaskFilter from here, and a back-import would
// form a cycle.
const KNOWN_STATUSES = { active: true, in_progress: true, idea: true };
function normalizeStatus(status) {
    return KNOWN_STATUSES[status] ? status : 'active';
}


// The one filter vocabulary, shared by every control at both breakpoints. Each
// `match` receives the ITEM and derives what it needs inside — manual status,
// derived phase, and the checkbox-completed flag — because the three filters mix
// those facts on purpose (the phase strings mirror phase.js's PHASE map, inlined
// rather than imported to keep this module's only hard dependency `prefs`):
//   • ALL         — every task that is NOT checked off (open work of any status).
//   • IN PROGRESS — manual status `in_progress`, OR derived phase `draft`
//                   (an entry injected and awaiting its run) or `running` (a run
//                   in flight); checked-off rows are excluded, and so is any task
//                   whose phase already derives to `done` — a leftover manual
//                   status must not keep shipped work here alongside DONE.
//   • DONE        — shipped-and-acknowledged (phase `done`) AND NOT checked off:
//                   exactly the rows carrying the shipped glyph that you have not
//                   yet filed away. DONE is a strict SUBSET of ALL (both exclude
//                   checked-off rows), not its complement — checked-off tasks live
//                   in the collapsed COMPLETED section and no filter reveals them.
// ALL keys off `completed` alone, so an item with no phase resolver still lands in
// ALL; IN PROGRESS and DONE also consult the derived phase. `label` is the
// uppercase text the desktop pills and the mobile cycle pill render; `seg` is the
// normal-case label the mobile segmented control uses.
const PHASE_FILTERS = [
    { key: 'all',        label: 'ALL',         seg: 'All',         match: function (item) { return !(item && item.completed); } },
    { key: 'inprogress', label: 'IN PROGRESS', seg: 'In progress', match: function (item) {
        if (!item || item.completed) return false;
        const phase = phaseOf(item);
        // Phase `done` wins over the manual status. Accepting a shipped task
        // ("Accept & close" → markEntryReviewed) stamps the review time and by
        // design never clears `status`, so a task that was set to in_progress
        // before it shipped keeps that value forever. Without this guard the
        // leftover status keeps matching here and the row shows under IN
        // PROGRESS and DONE at once instead of moving cleanly into DONE.
        if (phase === 'done') return false;
        return normalizeStatus(item.status) === 'in_progress' || phase === 'draft' || phase === 'running';
    } },
    { key: 'done',       label: 'DONE',        seg: 'Done',        match: function (item) {
        if (!item || item.completed) return false;
        return phaseOf(item) === 'done';
    } },
];

// Empty-state copy shown when the active filter hides every task (but the
// project still has tasks under other filters). ALL is omitted — it can only be
// empty when the project itself is empty, which the project empty-state already
// covers. `inprogress` and `done` are the shared filter vocabulary (both
// breakpoints); the retired mobile `active`/`ideas` keys are gone. DONE means
// shipped-and-acknowledged work still open in the list (checked-off tasks are
// excluded), so its copy speaks to that single sense.
const EMPTY_MESSAGES = {
    inprogress: 'Nothing in progress right now.',
    done: 'Nothing shipped is waiting.',
    blocked: 'Nothing is blocked on you right now.',
};

const HIDDEN_CLASS = 'taskFilterHidden';


// Is this row a committed task row (has a real title), as opposed to the blank
// "type the next…" placeholder that must always stay visible?
function isCommittedRow(row) {
    return !!(row && row.__item && row.__item.tit);
}

// Look up a PHASE_FILTERS entry by key, falling back to the first (ALL) when the
// stored value is unrecognised.
function phaseFilterFor(key) {
    return PHASE_FILTERS.filter(function (f) { return f.key === key; })[0] || PHASE_FILTERS[0];
}


// Build the pill row element. The bar holds TWO filter controls that share one
// persisted state (`getPhaseFilter`/`setPhaseFilter`), gated by CSS so exactly
// one status-vocabulary control is ever visible — mirroring the dual Sort-trigger
// pattern:
//   • Mobile: a SINGLE cycle pill that rotates through all → inprogress → done →
//     all … on each click, painting the active filter's label + count plus its
//     position dots. Its segmented sibling (built for the shared visual language)
//     sets the filter directly on tap.
//   • Desktop: a three-pill control, one pill per filter, set directly on tap.
// One delegated click handler routes all three: a pill/segment sets its filter
// directly, the cycle pill advances one step. Every control repaints together so
// the hidden ones stay in sync with the visible one. The bar lives in #mainBar
// (outside #mainList) so the list's clear-and-rebuild cycles never destroy it.
export function buildTaskFilterBar() {
    const bar = document.createElement('div');
    bar.id = 'taskFilterBar';
    bar.className = 'taskFilterBar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Filter tasks');

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
    PHASE_FILTERS.forEach(function () {
        const dot = document.createElement('span');
        dot.className = 'taskFilterDot';
        dots.appendChild(dot);
    });
    pill.appendChild(dots);

    bar.appendChild(pill);
    bar.appendChild(buildSegmentedControl());
    // The desktop phase-filter pills sit between the mobile status controls and
    // the blocked chip so the chip stays the bar's LAST child — main.js appends
    // the in-row Sort trigger directly after the chip, and that right-edge
    // cluster anchoring depends on the chip being last.
    bar.appendChild(buildPhaseFilterControl());
    bar.appendChild(buildBlockedChip());
    paintCyclePill(bar);
    paintSegmented(bar);
    paintPhasePills(bar);

    bar.addEventListener('click', function (event) {
        if (!event.target.closest) return;

        // Blocked-on-you chip — toggles the derived-phase filter. Inert at a zero
        // count (the disabled attribute), so a click only lands when at least one
        // task is blocked. Engaging snaps the filter to ALL so the two controls
        // never both filter (no invisible AND); releasing leaves it on ALL.
        const chip = event.target.closest('.taskFilterBlockedChip');
        if (chip && bar.contains(chip)) {
            if (chip.disabled) return;
            const engaging = !getBlockedFilter();
            setBlockedFilter(engaging);
            // Snap the (single) filter vocabulary to ALL so it doesn't compose
            // with the blocked overlay (no invisible AND).
            if (engaging) setPhaseFilter('all');
            paintCyclePill(bar);
            paintSegmented(bar);
            paintPhasePills(bar);
            applyTaskFilter();
            return;
        }

        // Desktop phase pill — set the filter directly. Selecting a filter
        // releases the blocked filter so the two never compose.
        const phasePill = event.target.closest('.taskPhaseFilterPill');
        if (phasePill && bar.contains(phasePill)) {
            const key = phasePill.getAttribute('data-phase');
            setBlockedFilter(false);
            if (key && key !== getPhaseFilter()) setPhaseFilter(key);
            paintCyclePill(bar);
            paintSegmented(bar);
            paintPhasePills(bar);
            applyTaskFilter();
            return;
        }

        // Mobile segment — set its filter directly, no cycling. Selecting a
        // filter releases the blocked filter so the two never compose.
        const seg = event.target.closest('.taskFilterSeg');
        if (seg && bar.contains(seg)) {
            const key = seg.getAttribute('data-seg');
            setBlockedFilter(false);
            if (!key || key === getPhaseFilter()) {
                // Still repaint to settle any stale visual state, then re-apply.
                paintCyclePill(bar);
                paintSegmented(bar);
                paintPhasePills(bar);
                applyTaskFilter();
                return;
            }
            setPhaseFilter(key);
            paintCyclePill(bar);
            paintSegmented(bar);
            paintPhasePills(bar);
            applyTaskFilter();
            return;
        }

        // Mobile cycle pill — advance one step. Cycling releases the blocked
        // filter so the two never compose.
        const clicked = event.target.closest('.taskCyclePill');
        if (!clicked || !bar.contains(clicked)) return;
        setBlockedFilter(false);
        const current = getPhaseFilter();
        let idx = PHASE_FILTERS.findIndex(function (f) { return f.key === current; });
        if (idx < 0) idx = 0;
        const next = PHASE_FILTERS[(idx + 1) % PHASE_FILTERS.length];
        setPhaseFilter(next.key);
        paintCyclePill(bar);
        paintSegmented(bar);
        paintPhasePills(bar);
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
        '.taskPhaseFilterPill, .taskCyclePill, .taskFilterSeg, #taskSortBtn, #taskSortBtnMobile'
    );
    for (let i = 0; i < candidates.length; i++) {
        if (isOnScreenFocusable(candidates[i])) return candidates[i];
    }
    return null;
}


// Ordered, on-screen filter/sort controls for Left/Right roving focus. The bar
// pairs a status filter with a Sort trigger; the horizontal arrows walk between
// them left-to-right. Desktop resolves to [phase pill…, #taskSortBtn]; mobile to
// [segment…, #taskSortBtnMobile]. The desktop Sort trigger lives in the sibling
// #bulkDescActions overlay (not inside the bar), so it is looked up by id here
// rather than queried within the bar. Only on-screen, focusable controls are
// included, so the CSS-hidden breakpoint complement is never an arrow stop.
function taskFilterArrowOrder() {
    const order = [];
    const bar = document.getElementById('taskFilterBar');
    if (bar) {
        // Desktop: the four phase pills are the on-screen filter group.
        const phasePills = bar.querySelectorAll('.taskPhaseFilterPill');
        phasePills.forEach(function (p) {
            if (isOnScreenFocusable(p)) order.push(p);
        });
        // Mobile: the cycle pill (or, when it is the on-screen control, the
        // segments). These are CSS-hidden on desktop, so only one group lands.
        const pill = bar.querySelector('.taskCyclePill');
        if (isOnScreenFocusable(pill)) {
            order.push(pill);
        } else if (order.length === 0) {
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


// Build the mobile three-segment filter control: one segment per PHASE_FILTERS
// entry, each carrying its normal-case `seg` label and a live count. CSS keeps it
// hidden (the cycle pill owns the mobile breakpoint and the pills own desktop);
// it stays in the DOM for the shared segmented-control visual language. Tapping a
// segment sets that filter directly through the bar's delegated handler.
function buildSegmentedControl() {
    const seg = document.createElement('div');
    seg.className = 'taskFilterSegmented';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Filter tasks');

    PHASE_FILTERS.forEach(function (f) {
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


// Build the desktop phase-filter control: three always-visible pills (ALL /
// IN PROGRESS / DONE), each with its own live count, that set the phase
// filter directly on tap. CSS hides the whole group on mobile (the cycle pill
// owns that breakpoint) and reveals it on desktop, where the cycle pill hides —
// so exactly one status-vocabulary control is visible per breakpoint. Tapping a
// pill routes through the bar's delegated handler.
function buildPhaseFilterControl() {
    const group = document.createElement('div');
    group.className = 'taskPhaseFilters';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Filter tasks by phase');

    PHASE_FILTERS.forEach(function (f) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'taskPhaseFilterPill';
        btn.setAttribute('data-phase', f.key);
        btn.setAttribute('aria-pressed', 'false');

        const label = document.createElement('span');
        label.className = 'taskPhaseFilterLabel';
        label.textContent = f.label;
        btn.appendChild(label);

        const count = document.createElement('span');
        count.className = 'taskPhaseFilterCount';
        count.textContent = '0';
        btn.appendChild(count);

        group.appendChild(btn);
    });

    return group;
}


// Build the blocked-on-you chip: a single amber control that filters the list to
// tasks whose derived phase is blocked on the user (REVIEW / ASKING / DRAFTED).
// Unlike the status controls it is visible at BOTH breakpoints (never CSS-gated
// by width) and is ALWAYS mounted — at a zero count it renders dimmed and inert
// (the --empty modifier + disabled) so the bar's geometry never shifts. Its live
// count, pressed state, and aria-label are painted by updateBlockedChip.
function buildBlockedChip() {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'taskFilterBlockedChip taskFilterBlockedChip--empty';
    chip.disabled = true;
    chip.setAttribute('aria-pressed', 'false');
    chip.setAttribute('aria-label', 'Blocked on you: 0. Nothing needs you.');

    // Glyph only — no word. The accessible name is carried entirely by the
    // button's aria-label (painted below and in updateBlockedChip), so both the
    // glyph and the count are hidden from screen readers to avoid announcing a
    // bare symbol and number on top of the label.
    const label = document.createElement('span');
    label.className = 'taskFilterBlockedLabel';
    label.textContent = '⌁';
    label.setAttribute('aria-hidden', 'true');
    chip.appendChild(label);

    const count = document.createElement('span');
    count.className = 'taskFilterBlockedCount';
    count.textContent = '0';
    count.setAttribute('aria-hidden', 'true');
    chip.appendChild(count);

    return chip;
}


// Reflect the persisted filter onto the cycle pill's label, data-filter, and
// aria state. The count is refreshed separately by applyTaskFilter → updateCounts.
function paintCyclePill(bar) {
    const pill = bar.querySelector('.taskCyclePill');
    if (!pill) return;
    const filter = phaseFilterFor(getPhaseFilter());
    pill.setAttribute('data-filter', filter.key);
    pill.setAttribute('aria-label', 'Filter: ' + filter.label + '. Tap to cycle filters.');
    const labelSpan = pill.querySelector('.taskFilterPillLabel');
    if (labelSpan) labelSpan.textContent = filter.label;
    // Position dots: fill the dot at the active filter's index (all=0,
    // inprogress=1, done=2) and clear the rest, so the two hidden filters stay
    // discoverable.
    const idx = PHASE_FILTERS.findIndex(function (f) { return f.key === filter.key; });
    const dots = pill.querySelectorAll('.taskFilterDot');
    dots.forEach(function (dot, i) {
        dot.classList.toggle('taskFilterDot--on', i === idx);
    });
}


// Reflect the persisted filter onto the mobile segmented control: tint the
// active segment and update aria-pressed. Runs in lockstep with paintCyclePill
// so the hidden control matches the visible one regardless of breakpoint.
function paintSegmented(bar) {
    const active = phaseFilterFor(getPhaseFilter()).key;
    const segs = bar.querySelectorAll('.taskFilterSeg');
    segs.forEach(function (seg) {
        const isActive = seg.getAttribute('data-seg') === active;
        seg.classList.toggle('selected', isActive);
        seg.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}


// Reflect the persisted phase filter onto the desktop pills: tint the active
// pill and set aria-pressed. Counts are refreshed separately by applyTaskFilter →
// updateCounts. Runs in lockstep with the status paints so a repaint keeps every
// control consistent regardless of which breakpoint is visible.
function paintPhasePills(bar) {
    const active = phaseFilterFor(getPhaseFilter()).key;
    const pills = bar.querySelectorAll('.taskPhaseFilterPill');
    pills.forEach(function (pill) {
        const isActive = pill.getAttribute('data-phase') === active;
        pill.classList.toggle('selected', isActive);
        pill.setAttribute('aria-pressed', isActive ? 'true' : 'false');
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

    const blockedActive = getBlockedFilter();
    // ONE filter vocabulary now governs both breakpoints (see PHASE_FILTERS), so
    // the running predicate no longer varies by viewport width — the mobile cycle
    // pill and the desktop pills read the same key and match the same way.
    const phaseKey = getPhaseFilter();
    const activePhaseFilter = phaseFilterFor(phaseKey);

    const phaseCounts = { all: 0, inprogress: 0, done: 0 };
    const allPhase = phaseFilterFor('all');
    const inProgressPhase = phaseFilterFor('inprogress');
    const donePhase = phaseFilterFor('done');
    let blockedCount = 0;
    let total = 0;      // committed, non-completed rows (blocked gate)
    let totalAll = 0;   // committed rows including completed (empty-state gate)
    let shown = 0;      // non-completed rows shown by the active filter/overlay

    const rows = mainList.querySelectorAll('#toDoChild');
    rows.forEach(function (row) {
        if (!isCommittedRow(row)) return;
        const item = row.__item;
        // Completed rows keep their original `status` (so un-completing restores
        // the category). They belong to the COMPLETED section, and every phase
        // predicate excludes them (see PHASE_FILTERS) — so although the counts run
        // over the FULL committed set below, completed rows contribute zero.
        const isCompleted = !!(item && item.completed);
        // Blocked membership is computed from the FULL committed, non-completed
        // set — matching how the filter counts are computed — not the visible
        // subset.
        const blocked = !isCompleted && isBlockedItem(item);

        totalAll += 1;
        if (!isCompleted) {
            total += 1;
            if (blocked) blockedCount += 1;
        }
        // Filter counts: each filter's own predicate over the item, so the counts
        // and the visibility decision below read from ONE definition
        // (PHASE_FILTERS). Every predicate excludes completed rows, so the counts
        // describe the OPEN list only and never fold in the COMPLETED section.
        if (allPhase.match(item)) phaseCounts.all += 1;
        if (inProgressPhase.match(item)) phaseCounts.inprogress += 1;
        if (donePhase.match(item)) phaseCounts.done += 1;

        // Visibility. Completed rows are exempt from the filter at BOTH breakpoints:
        // the COMPLETED section's own collapse (#mainList.completedCollapsed) is
        // their sole authority, so expanding it reveals its rows under every filter
        // rather than the filter suppressing them. Clear any stale taskFilterHidden
        // so a completed row is never stranded hidden while the section is open.
        // These rows are not tallied into `shown` — the empty-state describes the
        // OPEN list only.
        if (isCompleted) {
            setRowHidden(row, false);
            return;
        }
        // When the blocked filter is engaged the filter is on ALL, so visibility
        // keys purely on blocked membership; otherwise the active filter governs.
        const show = blockedActive ? blocked : activePhaseFilter.match(item);
        setRowHidden(row, !show);
        if (show) shown += 1;
    });

    updateCounts(phaseCounts);
    updatePhaseCounts(phaseCounts);
    updateBlockedChip(blockedCount, blockedActive);
    const emptyKey = blockedActive ? 'blocked' : phaseKey;
    // The filter empty-state weighs the FULL committed set (completed rows
    // included) against the shown tally, so a project holding only checked-off
    // rows still reports the filter's empty copy rather than a blank list; the
    // blocked overlay keeps the non-completed gate it has always used.
    const emptyTotal = blockedActive ? total : totalAll;
    const emptyVisible = shown;
    updateFilterEmptyState(mainList, emptyKey, emptyTotal, emptyVisible);

    // Filtering hides/shows rows via a class with no DOM mutation or resize, so
    // re-size the ghost spacer here too — otherwise hiding rows could shrink the
    // list below the viewport without the spacer re-expanding to fill the void.
    sizeMainListGhostSpacer(mainList);

    // Auto-release: a blocked filter whose count has fallen to zero (the last
    // item acknowledged or answered) releases itself so the user is never
    // stranded in an empty filtered view. Gated on `total > 0` so the boot-time
    // call against an unrendered list can't clear a stored-active preference
    // before its rows exist; a stored-active preference that resolves to zero
    // once rows ARE present does release, as specified. The re-entrancy guard
    // makes the release repaint once and stop rather than loop.
    if (blockedActive && total > 0 && blockedCount === 0 && !releasingBlocked) {
        releasingBlocked = true;
        try {
            setBlockedFilter(false);
            applyTaskFilter();
        } finally {
            releasingBlocked = false;
        }
    }
}


// Paint the blocked chip's live count, pressed state, and disabled/dimmed state
// from the current blocked count and whether the filter is engaged. Idempotent —
// every write is guarded on a value change so a repaint that changes nothing
// performs zero DOM writes (the auto-release relies on this to settle in one
// pass). At a zero count the chip goes dimmed + inert (--empty + disabled) so the
// bar's geometry never shifts and "nothing needs you" reads as a state.
function updateBlockedChip(count, active) {
    const bar = document.getElementById('taskFilterBar');
    if (!bar) return;
    const chip = bar.querySelector('.taskFilterBlockedChip');
    if (!chip) return;

    const countSpan = chip.querySelector('.taskFilterBlockedCount');
    if (countSpan) {
        const next = String(count);
        if (countSpan.textContent !== next) countSpan.textContent = next;
    }

    const isEmpty = count === 0;
    if (chip.classList.contains('taskFilterBlockedChip--empty') !== isEmpty) {
        chip.classList.toggle('taskFilterBlockedChip--empty', isEmpty);
    }
    if (chip.disabled !== isEmpty) chip.disabled = isEmpty;
    if (chip.classList.contains('selected') !== active) chip.classList.toggle('selected', active);

    const pressed = active ? 'true' : 'false';
    if (chip.getAttribute('aria-pressed') !== pressed) chip.setAttribute('aria-pressed', pressed);

    let label;
    if (active) label = 'Blocked on you: ' + count + '. Showing only blocked tasks. Tap to show all.';
    else if (isEmpty) label = 'Blocked on you: 0. Nothing needs you.';
    else label = 'Blocked on you: ' + count + '. Tap to show only blocked tasks.';
    if (chip.getAttribute('aria-label') !== label) chip.setAttribute('aria-label', label);
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


// Mobile cycle pill + segmented control — driven by the same phase-count tally as
// the desktop pills, so every control shows accurate live counts regardless of
// which one is on screen. `counts` is keyed all/inprogress/done.
function updateCounts(counts) {
    const bar = document.getElementById('taskFilterBar');
    if (!bar) return;

    // Mobile cycle pill — shows only the active filter's count.
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


// Desktop phase pills — every pill shows its own live count, drawn from the full
// committed set. Called from applyTaskFilter with the phase-count tally so all
// three pills stay accurate whether or not they are the visible control.
function updatePhaseCounts(phaseCounts) {
    const bar = document.getElementById('taskFilterBar');
    if (!bar) return;
    const pills = bar.querySelectorAll('.taskPhaseFilterPill');
    pills.forEach(function (pill) {
        const key = pill.getAttribute('data-phase');
        const countSpan = pill.querySelector('.taskPhaseFilterCount');
        if (countSpan) countSpan.textContent = String(phaseCounts[key] != null ? phaseCounts[key] : 0);
    });
}


// Show a small centred message when the active filter (IN PROGRESS / DONE) hides
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
