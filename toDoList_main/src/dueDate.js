// Due-date pill, urgency styling, and the anchored month-view popover. The
// pill button on each todo row opens a calendar; selection writes through
// `setItemDue` so the data model, urgency classes, persistence, and pill
// label all update on the existing path. Dismiss on: selection, Escape, or
// outside click.
//
// Storage format for `item.due` is "M-D-YYYY" (single-digit month/day are
// fine). Empty/blank values are normalized to '' on write.

import { listLogic, sanitizeRecurrence } from './listLogic.js';


// ── DATE HELPERS ──

// Returns whole days from today until dueStr. Negative = overdue.
// Returns null for missing/invalid/blank dates. Storage format is "M-D-YYYY".
export function daysUntilDue(dueStr) {
    if (!dueStr || dueStr === '--' || dueStr === 'X-X-XXXX') return null;
    const parts = dueStr.split('-');
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
    const due = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((due - today) / 86400000);
}

// Applies/removes .due-soon and .due-overdue on a row based on its item's
// due date. Completed rows and blank placeholders never get urgency classes.
export function applyDueUrgency(toDoChild, item) {
    toDoChild.classList.remove('due-soon', 'due-overdue');
    if (!item || !item.tit || item.completed) return;
    const days = daysUntilDue(item.due);
    if (days === null) return;
    if (days < 0) {
        toDoChild.classList.add('due-overdue');
    } else if (days <= 3) {
        toDoChild.classList.add('due-soon');
    }
}

// Write a due date into the data model, persist, and refresh the
// due-urgency styling + pill label so the row recolors immediately.
// Pass m/d/y as numbers or null-ish to clear the date.
//
// Dispatches `todoDueDateChanged` on document after the write so the
// renderer can rerun its sort-by-due projection without coupling
// dueDate.js to the row-rendering layer. Without this signal a row's
// due-date edit while "Sort by Due" was active stayed in its original
// DOM slot — the new ordering only surfaced on the next manual sort
// toggle or page reload.
export function setItemDue(item, toDoChild, m, d, y) {
    if (m == null || d == null || y == null) {
        item.due = '';
    } else {
        item.due = m + '-' + d + '-' + y;
    }
    listLogic.saveToStorage();
    if (typeof applyDueUrgency === 'function') applyDueUrgency(toDoChild, item);
    const pill = toDoChild.querySelector('#duePill');
    if (pill) updateDuePillLabel(pill, item);

    const projectName = toDoChild && toDoChild.dataset
        ? toDoChild.dataset.value || null
        : null;
    if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
        try {
            document.dispatchEvent(new CustomEvent('todoDueDateChanged', {
                detail: { project: projectName, item: item },
            }));
        } catch (e) { /* CustomEvent unsupported — listener-side reorders skipped */ }
    }
}

// Set a row's due date to today + offsetDays. Shim retained as the canonical
// "write-through" entry point referenced throughout main.js.
export function setRowDateOffset(item, toDoChild, offsetDays) {
    const target = new Date();
    target.setDate(target.getDate() + offsetDays);
    setItemDue(item, toDoChild, target.getMonth() + 1, target.getDate(), target.getFullYear());
}

// Parse the stored M-D-YYYY string into {m, d, y} numbers, or null when
// no valid date is set. Matches daysUntilDue's guard for consistency.
export function parseItemDue(item) {
    if (!item || !item.due || item.due === '--' || item.due === 'X-X-XXXX') return null;
    const parts = String(item.due).split('-');
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
    return { m: m, d: d, y: y };
}

// Render a date as "Apr 30" — used for the pill label when no urgency class
// is firing. Matches the SpaceMono uppercase treatment via CSS.
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function formatPillAbsolute(m, d) {
    return MONTH_SHORT[m - 1] + ' ' + d;
}

// Inline SVGs use currentColor so they inherit the pill's text color —
// that keeps urgency recolors (due-soon/overdue/completed) and theme swaps
// cascading to the icons with no extra rules.
const CALENDAR_SVG = '<svg class="duePillIcon" viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="3" width="11" height="9.5" rx="1.5"/><path d="M4.5 1.5V4"/><path d="M9.5 1.5V4"/><path d="M1.5 6h11"/></svg>';
const CHEVRON_SVG = '<svg class="duePillChevron" viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4L5 6.5L7.5 4"/></svg>';

// Pill label reflects the item's due state:
//   empty → calendar icon + "Set date"
//   set, no urgency → absolute "Apr 30"
//   set, due-soon → "Due in Nd" (or "Due today" on the same day)
//   set, overdue → "Nd overdue"
// Urgency classes on #toDoChild color the text via CSS — this function only
// chooses the string. Calendar icon (left) and chevron (right) are always
// rendered so the pill reads as a button regardless of state.
//
// The pill also exposes a `data-short-label` attribute carrying a condensed
// version of the same state ("Set date" / "Nd" / "Today" / "Apr 30"). The
// mobile media query swaps to it via CSS so the pill takes less horizontal
// room on narrow screens; desktop ignores the attribute and keeps the long
// label. Both stay in sync because they're written from the same branches.
export function updateDuePillLabel(pill, item) {
    const parsed = parseItemDue(item);
    let labelText;
    let shortLabel;
    // Single-digit count painted inside the yellow calendar icon on
    // mobile via the @media (max-width: 700px) ::after rule. Only set
    // when the row is in the 1-3 day "approaching" window — today,
    // overdue, future, and completed rows leave the attribute off so
    // the badge stays scoped to the yellow state.
    let dayBadge = '';
    if (!parsed) {
        pill.setAttribute('data-empty', 'true');
        labelText = 'Set date';
        shortLabel = 'Set date';
    } else {
        pill.removeAttribute('data-empty');
        const days = daysUntilDue(item.due);
        if (item.completed || days === null) {
            labelText = formatPillAbsolute(parsed.m, parsed.d);
            shortLabel = labelText;
        } else if (days < 0) {
            labelText = Math.abs(days) + 'd overdue';
            shortLabel = Math.abs(days) + 'd';
        } else if (days === 0) {
            labelText = 'Due today';
            shortLabel = 'Today';
        } else if (days <= 3) {
            labelText = 'Due in ' + days + 'd';
            shortLabel = days + 'd';
            dayBadge = String(days);
        } else {
            labelText = formatPillAbsolute(parsed.m, parsed.d);
            shortLabel = labelText;
        }
    }
    pill.setAttribute('data-short-label', shortLabel);
    if (dayBadge) {
        pill.setAttribute('data-days-until-due', dayBadge);
    } else {
        pill.removeAttribute('data-days-until-due');
    }
    pill.innerHTML = '';
    pill.insertAdjacentHTML('beforeend', CALENDAR_SVG);
    const label = document.createElement('span');
    label.className = 'duePillLabel';
    label.textContent = labelText;
    pill.appendChild(label);
    pill.insertAdjacentHTML('beforeend', CHEVRON_SVG);
}


// ── DUE DATE POPOVER ──
// A single pill button per row opens an anchored month-view calendar.
// Selection writes through setItemDue so item.due, applyDueUrgency,
// persistence, and the footer counter all update on the existing path.
// Dismiss on: selection, Escape, outside click. Mirrors showProjectContextMenu.

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_FULL = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
];

// ── REPEAT SECTION ──
// Inline recurrence config attached to the bottom of the popover. Reads
// the item's existing recurrence config (if any), exposes a pattern
// dropdown, custom interval inputs, basis toggle, and an optional end
// date. The collected config is committed to the data model when the
// popover is dismissed, mirroring how the popover persists the date.

const REPEAT_PATTERN_OPTIONS = [
    { value: '',         label: 'Never' },
    { value: 'daily',    label: 'Daily' },
    { value: 'weekdays', label: 'Weekdays' },
    { value: 'weekly',   label: 'Weekly' },
    { value: 'monthly',  label: 'Monthly' },
    { value: 'yearly',   label: 'Yearly' },
    { value: 'custom',   label: 'Custom' },
];

const CUSTOM_UNIT_OPTIONS = [
    { value: 'day',   label: 'days' },
    { value: 'week',  label: 'weeks' },
    { value: 'month', label: 'months' },
    { value: 'year',  label: 'years' },
];

// Build the section DOM and stash a `__repeatState` property on the
// returned wrapper so commitRecurrenceFromPopover can read the final
// values when the popover closes.
function buildRepeatSection(item) {
    const wrapper = document.createElement('div');
    wrapper.className = 'dueRepeatSection';

    const heading = document.createElement('div');
    heading.className = 'dueRepeatHeading';
    heading.textContent = 'Repeat';
    wrapper.appendChild(heading);

    const initial = item && item.recurrence ? sanitizeRecurrence(item.recurrence) : null;

    // Row 1: pattern dropdown
    const patternRow = document.createElement('div');
    patternRow.className = 'dueRepeatRow';
    const patternSelect = document.createElement('select');
    patternSelect.className = 'dueRepeatSelect';
    patternSelect.setAttribute('aria-label', 'Repeat pattern');
    REPEAT_PATTERN_OPTIONS.forEach(function(opt) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        patternSelect.appendChild(o);
    });
    patternSelect.value = initial ? initial.pattern : '';
    patternRow.appendChild(patternSelect);
    wrapper.appendChild(patternRow);

    // Row 2: custom interval (visible only when pattern === 'custom')
    const customRow = document.createElement('div');
    customRow.className = 'dueRepeatRow dueRepeatCustom';
    const everyLabel = document.createElement('span');
    everyLabel.className = 'dueRepeatLabel';
    everyLabel.textContent = 'Every';
    const intervalInput = document.createElement('input');
    intervalInput.type = 'number';
    intervalInput.min = '1';
    intervalInput.className = 'dueRepeatNumber';
    intervalInput.setAttribute('aria-label', 'Interval');
    intervalInput.value = String(initial && initial.pattern === 'custom' ? initial.interval : 1);
    const unitSelect = document.createElement('select');
    unitSelect.className = 'dueRepeatSelect';
    unitSelect.setAttribute('aria-label', 'Interval unit');
    CUSTOM_UNIT_OPTIONS.forEach(function(opt) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        unitSelect.appendChild(o);
    });
    unitSelect.value = initial && initial.pattern === 'custom' ? initial.intervalUnit : 'day';
    customRow.appendChild(everyLabel);
    customRow.appendChild(intervalInput);
    customRow.appendChild(unitSelect);
    wrapper.appendChild(customRow);

    // Row 3: basis toggle ("Repeat from completion date")
    const basisRow = document.createElement('label');
    basisRow.className = 'dueRepeatRow dueRepeatBasis';
    const basisCheckbox = document.createElement('input');
    basisCheckbox.type = 'checkbox';
    basisCheckbox.className = 'dueRepeatCheckbox';
    basisCheckbox.checked = !!(initial && initial.basis === 'completionDate');
    const basisText = document.createElement('span');
    basisText.textContent = 'Repeat from completion date';
    basisRow.appendChild(basisCheckbox);
    basisRow.appendChild(basisText);
    wrapper.appendChild(basisRow);

    // Row 4: end-date control. Hidden behind an "Add end date" link until
    // the user clicks it (or until the existing recurrence already had
    // one). Clicking the link reveals a date input + "Remove" affordance.
    const endRow = document.createElement('div');
    endRow.className = 'dueRepeatRow dueRepeatEnd';
    const addEndLink = document.createElement('button');
    addEndLink.type = 'button';
    addEndLink.className = 'dueRepeatEndLink';
    addEndLink.textContent = 'Add end date';
    const endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.className = 'dueRepeatEndInput';
    endInput.setAttribute('aria-label', 'End on');
    const endLabel = document.createElement('span');
    endLabel.className = 'dueRepeatLabel';
    endLabel.textContent = 'End on';
    const removeEndLink = document.createElement('button');
    removeEndLink.type = 'button';
    removeEndLink.className = 'dueRepeatEndLink dueRepeatEndRemove';
    removeEndLink.textContent = 'Remove';
    endRow.appendChild(addEndLink);
    endRow.appendChild(endLabel);
    endRow.appendChild(endInput);
    endRow.appendChild(removeEndLink);
    wrapper.appendChild(endRow);

    function applyVisibility() {
        const pattern = patternSelect.value;
        if (pattern === '') {
            customRow.style.display = 'none';
            basisRow.style.display  = 'none';
            endRow.style.display    = 'none';
            return;
        }
        customRow.style.display = pattern === 'custom' ? 'flex' : 'none';
        basisRow.style.display  = 'flex';
        endRow.style.display    = 'flex';
        const hasEnd = !!endInput.value;
        addEndLink.style.display    = hasEnd ? 'none' : 'inline-flex';
        endLabel.style.display      = hasEnd ? 'inline-flex' : 'none';
        endInput.style.display      = hasEnd ? 'inline-flex' : 'none';
        removeEndLink.style.display = hasEnd ? 'inline-flex' : 'none';
    }

    if (initial && initial.endDate) endInput.value = initial.endDate;

    addEndLink.addEventListener('click', function(event) {
        event.stopPropagation();
        // Default the end date to today if none provided yet, so the
        // input doesn't sit empty after revealing.
        if (!endInput.value) {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            endInput.value = yyyy + '-' + mm + '-' + dd;
        }
        applyVisibility();
    });
    removeEndLink.addEventListener('click', function(event) {
        event.stopPropagation();
        endInput.value = '';
        applyVisibility();
    });
    patternSelect.addEventListener('change', applyVisibility);

    applyVisibility();

    wrapper.__repeatState = {
        item: item,
        getValue: function() {
            const pattern = patternSelect.value;
            if (!pattern) return null;
            return {
                pattern: pattern,
                interval: parseInt(intervalInput.value, 10) || 1,
                intervalUnit: unitSelect.value,
                basis: basisCheckbox.checked ? 'completionDate' : 'dueDate',
                endDate: endInput.value || null,
            };
        }
    };

    return wrapper;
}

// Read the repeat section's current values out of the open popover and
// write them through to the data model via listLogic.setRecurrence. Safe
// to call even when the popover wasn't built with a repeat section
// (older callers / tests).
function commitRecurrenceFromPopover(popover) {
    const wrapper = popover.querySelector('.dueRepeatSection');
    if (!wrapper || !wrapper.__repeatState) return;
    const state = wrapper.__repeatState;
    const item = state.item;
    if (!item) return;

    const next = state.getValue();

    // Find the project this item belongs to so setRecurrence can persist.
    // The popover state stores the row element, which carries its project
    // name in data-value. Fall back to the item's recurrence pass-through
    // (no persistence) if we somehow can't find the project — better to
    // mutate the in-memory item than to lose the user's input outright.
    let project = null;
    const popoverState = popover.__state;
    if (popoverState && popoverState.toDoChild) {
        project = popoverState.toDoChild.dataset.value || null;
    }

    if (project) {
        listLogic.setRecurrence(project, item, next);
    } else {
        item.recurrence = next ? sanitizeRecurrence(next) : null;
    }

    // Refresh the row glyph so the ↻ marker appears/disappears immediately.
    if (popoverState && popoverState.toDoChild) {
        updateRecurringGlyph(popoverState.toDoChild, item);
    }
}


// Update the recurring-row glyph next to the title input. Keeps the DOM
// in sync after the popover commits a recurrence config without needing
// a full row rebuild. Exported so toDoRow.js can call it on row build.
// Also flips `data-has-recurrence` on the row so CSS-keyed siblings (the
// stats-drawer chart button) can show/hide in lockstep with the glyph.
export function updateRecurringGlyph(toDoChild, item) {
    if (!toDoChild) return;
    const existing = toDoChild.querySelector('#recurringGlyph');
    if (!item || !item.recurrence) {
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        toDoChild.removeAttribute('data-has-recurrence');
        // If the user removed recurrence while the stats drawer was open,
        // tear the drawer down so it doesn't strand below the row.
        const mainList = toDoChild.parentElement;
        if (mainList) {
            let next = toDoChild.nextSibling;
            while (next && (next.id === 'descSibling' || next.id === 'statsSibling')) {
                const after = next.nextSibling;
                if (next.id === 'statsSibling') mainList.removeChild(next);
                next = after;
            }
        }
        const statsToggle = toDoChild.querySelector('#statsToggle');
        if (statsToggle) statsToggle.classList.remove('open');
        return;
    }
    toDoChild.setAttribute('data-has-recurrence', 'true');
    if (existing) return; // already present
    const glyph = document.createElement('span');
    glyph.id = 'recurringGlyph';
    glyph.className = 'recurringGlyph';
    glyph.setAttribute('aria-label', 'Recurring task');
    glyph.title = 'Recurring task';
    glyph.innerHTML = '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4.5A4 4 0 1 0 12 8"/><path d="M11 2v3h-3"/></svg>';
    // Slot the glyph between the title input and the due pill so it sits
    // immediately after the title text in reading order.
    const pill = toDoChild.querySelector('#duePill');
    if (pill) {
        toDoChild.insertBefore(glyph, pill);
    } else {
        toDoChild.appendChild(glyph);
    }
}


export function hideDueDatePopover() {
    const existing = document.getElementById('dueDatePopover');
    if (existing) {
        // Commit the recurrence config to the todo before tearing down the
        // popover. Closing the calendar — by selection, Escape, outside
        // click, or scroll — is the persistence boundary, matching the
        // task's "closing the popover commits the recurrence config" rule.
        commitRecurrenceFromPopover(existing);
        if (existing.parentNode) existing.parentNode.removeChild(existing);
    }
    document.removeEventListener('click',      onDuePopoverOutsideClick, true);
    document.removeEventListener('contextmenu', onDuePopoverOutsideClick, true);
    document.removeEventListener('keydown',    onDuePopoverKeydown,      true);
    window.removeEventListener('resize', hideDueDatePopover);
    window.removeEventListener('scroll', hideDueDatePopover, true);
    const openPill = document.querySelector('#duePill[aria-expanded="true"]');
    if (openPill) openPill.setAttribute('aria-expanded', 'false');
}

function onDuePopoverOutsideClick(event) {
    const popover = document.getElementById('dueDatePopover');
    if (!popover) return;
    if (popover.contains(event.target)) return;
    // Clicking the pill that opened it is handled by the pill's own toggle.
    if (event.target.closest && event.target.closest('#duePill')) return;
    hideDueDatePopover();
}

function onDuePopoverKeydown(event) {
    const popover = document.getElementById('dueDatePopover');
    if (!popover) return;
    if (event.key === 'Escape') {
        event.stopPropagation();
        hideDueDatePopover();
        return;
    }
    if (event.key === 'Backspace') {
        // Close the popover without applying any pending date change so
        // keyboard users can cancel out of the calendar without reaching
        // for Escape. Skip when focus is inside an editable control within
        // the popover (interval input, end-date input, pattern/unit selects)
        // — those still need Backspace to delete characters or change the
        // selected option. Outside the popover entirely, fall through so
        // Backspace retains its normal browser meaning.
        const ae = document.activeElement;
        const insideEditable = !!(ae && popover.contains(ae) &&
            (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
             ae.tagName === 'SELECT' || ae.isContentEditable));
        if (insideEditable) return;
        if (!popover.contains(ae) && ae !== document.body) return;
        event.preventDefault();
        event.stopPropagation();
        hideDueDatePopover();
        return;
    }
    const isNav = event.key === 'ArrowLeft' || event.key === 'ArrowRight' ||
                  event.key === 'ArrowUp'   || event.key === 'ArrowDown' ||
                  event.key === 'Enter';
    if (!isNav) return;
    if (!popover.contains(document.activeElement) &&
        document.activeElement !== document.body) return;
    event.preventDefault();
    if (event.key === 'Enter') {
        const focused = popover.querySelector('.dueDay.dueDay-focused');
        if (focused) focused.click();
        return;
    }
    const delta = event.key === 'ArrowLeft' ? -1 :
                  event.key === 'ArrowRight' ?  1 :
                  event.key === 'ArrowUp'   ? -7 : 7;
    shiftDueFocus(popover, delta);
}

function shiftDueFocus(popover, deltaDays) {
    const state = popover.__state;
    if (!state) return;
    const current = state.focusDate ? new Date(state.focusDate) : new Date();
    current.setDate(current.getDate() + deltaDays);
    const newMonth = current.getMonth();
    const newYear  = current.getFullYear();
    state.focusDate = current;
    if (newMonth !== state.viewMonth || newYear !== state.viewYear) {
        state.viewMonth = newMonth;
        state.viewYear  = newYear;
    }
    renderDuePopoverBody(popover);
}

function renderDuePopoverBody(popover) {
    const state = popover.__state;
    const body  = popover.querySelector('.dueGrid');
    const title = popover.querySelector('.dueMonthTitle');
    if (!body || !title || !state) return;

    title.textContent = MONTH_FULL[state.viewMonth] + ' ' + state.viewYear;
    while (body.firstChild) body.removeChild(body.firstChild);

    const firstOfMonth = new Date(state.viewYear, state.viewMonth, 1);
    const startWeekday = firstOfMonth.getDay(); // 0=Sun
    const gridStart    = new Date(state.viewYear, state.viewMonth, 1 - startWeekday);
    const today        = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 42; i++) {
        const cellDate = new Date(gridStart);
        cellDate.setDate(gridStart.getDate() + i);
        cellDate.setHours(0, 0, 0, 0);

        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'dueDay';
        cell.tabIndex = -1;
        cell.textContent = cellDate.getDate();

        const inMonth = cellDate.getMonth() === state.viewMonth;
        if (!inMonth) cell.classList.add('dueDay-neighbor');
        if (cellDate.getTime() === today.getTime()) cell.classList.add('dueDay-today');
        if (state.selected &&
            cellDate.getFullYear() === state.selected.y &&
            cellDate.getMonth() === state.selected.m - 1 &&
            cellDate.getDate() === state.selected.d) {
            cell.classList.add('dueDay-selected');
        }
        if (state.focusDate &&
            cellDate.getFullYear() === state.focusDate.getFullYear() &&
            cellDate.getMonth() === state.focusDate.getMonth() &&
            cellDate.getDate() === state.focusDate.getDate()) {
            cell.classList.add('dueDay-focused');
        }

        cell.addEventListener('click', function(event) {
            event.stopPropagation();
            setItemDue(state.item, state.toDoChild,
                cellDate.getMonth() + 1, cellDate.getDate(), cellDate.getFullYear());
            hideDueDatePopover();
        });
        body.appendChild(cell);
    }
}

export function showDueDatePopover(anchor, item, toDoChild) {
    hideDueDatePopover();
    anchor.setAttribute('aria-expanded', 'true');

    const popover = document.createElement('div');
    popover.id = 'dueDatePopover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Pick due date');
    popover.tabIndex = -1;

    // Header: prev | Month YYYY | next
    const header = document.createElement('div');
    header.className = 'dueHeader';
    const prev  = document.createElement('button');
    const next  = document.createElement('button');
    const title = document.createElement('div');
    prev.type = 'button';
    next.type = 'button';
    prev.className = 'dueNav';
    next.className = 'dueNav';
    prev.setAttribute('aria-label', 'Previous month');
    next.setAttribute('aria-label', 'Next month');
    prev.innerHTML = '<span class="completedCaret">‹</span>';
    next.innerHTML = '<span class="completedCaret">›</span>';
    title.className = 'dueMonthTitle';
    header.appendChild(prev);
    header.appendChild(title);
    header.appendChild(next);

    // Quick-date strip above the grid — reuses .quickDateBtn
    const quickRow = document.createElement('div');
    quickRow.className = 'dueQuickDates';
    [
        { label: 'Today',    offset: 0 },
        { label: 'Tomorrow', offset: 1 },
        { label: '+1w',      offset: 7 }
    ].forEach(function(def) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quickDateBtn';
        btn.textContent = def.label;
        btn.setAttribute('data-offset', String(def.offset));
        btn.setAttribute('aria-label', 'Set due date: ' + def.label);
        btn.addEventListener('click', function(event) {
            event.stopPropagation();
            setRowDateOffset(item, toDoChild, def.offset);
            hideDueDatePopover();
        });
        quickRow.appendChild(btn);
    });

    // Weekday row
    const weekdays = document.createElement('div');
    weekdays.className = 'dueWeekdays';
    WEEKDAY_LABELS.forEach(function(w) {
        const cell = document.createElement('div');
        cell.className = 'dueWeekday';
        cell.textContent = w;
        weekdays.appendChild(cell);
    });

    // Day grid
    const grid = document.createElement('div');
    grid.className = 'dueGrid';

    // Clear button
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'dueClearBtn';
    clear.textContent = 'Clear';
    clear.addEventListener('click', function(event) {
        event.stopPropagation();
        setItemDue(item, toDoChild, null, null, null);
        hideDueDatePopover();
    });

    const repeatSection = buildRepeatSection(item);

    popover.appendChild(header);
    popover.appendChild(quickRow);
    popover.appendChild(weekdays);
    popover.appendChild(grid);
    popover.appendChild(repeatSection);
    popover.appendChild(clear);

    // State init — seed view from the selected date if present, else today.
    const parsed = parseItemDue(item);
    const seed = parsed
        ? new Date(parsed.y, parsed.m - 1, parsed.d)
        : new Date();
    popover.__state = {
        item: item,
        toDoChild: toDoChild,
        viewMonth: seed.getMonth(),
        viewYear:  seed.getFullYear(),
        selected:  parsed ? { m: parsed.m, d: parsed.d, y: parsed.y } : null,
        focusDate: new Date(seed.getFullYear(), seed.getMonth(), seed.getDate())
    };

    prev.addEventListener('click', function(event) {
        event.stopPropagation();
        const s = popover.__state;
        let nm = s.viewMonth - 1, ny = s.viewYear;
        if (nm < 0) { nm = 11; ny--; }
        s.viewMonth = nm; s.viewYear = ny;
        renderDuePopoverBody(popover);
    });
    next.addEventListener('click', function(event) {
        event.stopPropagation();
        const s = popover.__state;
        let nm = s.viewMonth + 1, ny = s.viewYear;
        if (nm > 11) { nm = 0; ny++; }
        s.viewMonth = nm; s.viewYear = ny;
        renderDuePopoverBody(popover);
    });

    document.body.appendChild(popover);
    renderDuePopoverBody(popover);

    // Anchor below the pill, right-aligned so long labels don't push offscreen.
    const pillRect  = anchor.getBoundingClientRect();
    const popWidth  = popover.offsetWidth;
    const popHeight = popover.offsetHeight;
    let left = pillRect.right - popWidth;
    let top  = pillRect.bottom + 6;
    // If it would overflow below, flip above the pill.
    if (top + popHeight > window.innerHeight - 4) {
        top = pillRect.top - popHeight - 6;
    }
    // Clamp within viewport.
    if (left < 4) left = 4;
    if (left + popWidth > window.innerWidth - 4) {
        left = Math.max(4, window.innerWidth - popWidth - 4);
    }
    if (top < 4) top = 4;
    popover.style.left = left + 'px';
    popover.style.top  = top  + 'px';

    document.addEventListener('click',       onDuePopoverOutsideClick, true);
    document.addEventListener('contextmenu', onDuePopoverOutsideClick, true);
    document.addEventListener('keydown',     onDuePopoverKeydown,      true);
    window.addEventListener('resize', hideDueDatePopover);
    window.addEventListener('scroll', hideDueDatePopover, true);

    // Focus the popover so arrow-key nav is captured without leaking to the
    // page. Without this, focus stays on the pill button and Enter/Escape
    // still work but arrow keys wouldn't reach the grid.
    try { popover.focus({ preventScroll: true }); } catch (e) { popover.focus(); }
}
