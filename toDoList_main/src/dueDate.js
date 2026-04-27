// Due-date pill, urgency styling, and the anchored month-view popover. The
// pill button on each todo row opens a calendar; selection writes through
// `setItemDue` so the data model, urgency classes, persistence, and pill
// label all update on the existing path. Dismiss on: selection, Escape, or
// outside click.
//
// Storage format for `item.due` is "M-D-YYYY" (single-digit month/day are
// fine). Empty/blank values are normalized to '' on write.

import { listLogic } from './listLogic.js';


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

// Applies/removes .due-today, .due-soon, and .due-overdue on a row based on
// its item's due date. Completed rows and blank placeholders never get
// urgency classes. The .due-today class is applied for days === 0 so the
// pill recolor (warm coral) can fire for today as well as overdue rows
// without conflating them with .due-soon (1–3 days out, no urgency color).
export function applyDueUrgency(toDoChild, item) {
    toDoChild.classList.remove('due-today', 'due-soon', 'due-overdue');
    if (!item || !item.tit || item.completed) return;
    const days = daysUntilDue(item.due);
    if (days === null) return;
    if (days < 0) {
        toDoChild.classList.add('due-overdue');
    } else if (days === 0) {
        toDoChild.classList.add('due-today');
    } else if (days <= 3) {
        toDoChild.classList.add('due-soon');
    }
}

// Write a due date into the data model, persist, and refresh the
// due-urgency styling + pill label so the row recolors immediately.
// Pass m/d/y as numbers or null-ish to clear the date.
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
export function updateDuePillLabel(pill, item) {
    const parsed = parseItemDue(item);
    let labelText;
    if (!parsed) {
        pill.setAttribute('data-empty', 'true');
        labelText = 'Set date';
    } else {
        pill.removeAttribute('data-empty');
        const days = daysUntilDue(item.due);
        if (item.completed || days === null) {
            labelText = formatPillAbsolute(parsed.m, parsed.d);
        } else if (days < 0) {
            labelText = Math.abs(days) + 'd overdue';
        } else if (days === 0) {
            labelText = 'Due today';
        } else if (days <= 3) {
            labelText = 'Due in ' + days + 'd';
        } else {
            labelText = formatPillAbsolute(parsed.m, parsed.d);
        }
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

export function hideDueDatePopover() {
    const existing = document.getElementById('dueDatePopover');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
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

    popover.appendChild(header);
    popover.appendChild(quickRow);
    popover.appendChild(weekdays);
    popover.appendChild(grid);
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
