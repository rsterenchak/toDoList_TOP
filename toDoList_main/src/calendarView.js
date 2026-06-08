import { listLogic } from './listLogic.js';
import { applyDueUrgency, updateDuePillLabel } from './dueDate.js';
import { prefersReducedMotion } from './dragDrop.js';

// Injected back-edge: jumpToProjectTodo needs applyActiveView, which lives
// in main.js and itself calls renderCalendarView. Importing it directly
// would create a circular import, so main.js hands it in via
// initCalendarView({ applyActiveView }) once at module load.
let applyActiveView = null;

export function initCalendarView(deps) {
    deps = deps || {};
    if (typeof deps.applyActiveView === 'function') {
        applyActiveView = deps.applyActiveView;
    }
}

// buildTodayRow renders a cross-project todo row used by the Calendar
// view's day-detail panel. Despite the "Today" naming there is no Today
// view; the builder lives here because it is reachable only from
// renderCalendarDayPanel.
//   options.hideDuePill — Calendar's day-detail panel shares this builder
//     but omits the due pill, since the date is implied by the selected
//     calendar cell. Pass an `onAfterToggle` callback when the caller's
//     surrounding view needs a custom re-render (e.g. the calendar
//     redraws the dot density on the toggled date).
// TODO: extract shared due-pill builder so both views render through the
// same factory rather than duplicating the markup invariants.
function buildTodayRow(entry, bucket, options) {
    options = options || {};
    const row = document.createElement('div');
    row.className = 'todayRow todoRowCard';
    row.setAttribute('data-bucket', bucket);
    // tabindex="-1" lets the view-aware arrow-nav handler programmatically
    // focus the row container without putting it in the browser tab order.
    // Tab still walks the checkbox / title button per their natural order;
    // ArrowUp/ArrowDown walk row containers via the global handler.
    row.setAttribute('tabindex', '-1');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'todayRowCheck';
    checkbox.checked = !!entry.item.completed;
    checkbox.setAttribute('aria-label', 'Mark ' + entry.item.tit + ' complete');
    checkbox.addEventListener('click', function(e) {
        e.stopPropagation();
    });
    checkbox.addEventListener('change', function() {
        handleTodayCheckboxToggle(entry, checkbox, options.onAfterToggle);
    });

    const projectPill = document.createElement('span');
    projectPill.className = 'todayRowProjectPill';
    projectPill.textContent = entry.project;
    projectPill.title = entry.project;

    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'todayRowTitle';
    title.textContent = entry.item.tit;
    title.title = entry.item.tit;

    row.appendChild(checkbox);
    row.appendChild(projectPill);
    row.appendChild(title);

    if (!options.hideDuePill) {
        const duePill = document.createElement('span');
        duePill.className = 'todayRowDuePill';
        duePill.setAttribute('aria-hidden', 'true');
        updateDuePillLabel(duePill, entry.item);
        row.appendChild(duePill);

        // .due-soon / .due-overdue keyed on daysUntilDue — the same urgency
        // classes the Projects-view rows use, so the shared CSS rules recolor
        // the due pill (amber for today / due-in-N-days ≤3, red for overdue).
        applyDueUrgency(row, entry.item);
    }

    // Row-level click jumps to the parent project. Clicks on the checkbox
    // stop propagation in its own handler; the pills are pointer-events:
    // none in CSS so they pass through. The title is a <button> so keyboard
    // Enter activates jump natively — mouse clicks on the title bubble up
    // to this listener.
    row.addEventListener('click', function(e) {
        if (e.target.closest('.todayRowCheck')) return;
        jumpToProjectTodo(entry.project, entry.item);
    });

    return row;
}

function handleTodayCheckboxToggle(entry, checkbox, onAfter) {
    const item = entry.item;
    const project = entry.project;
    const wasCompleted = !!item.completed;

    // Recurring branch mirrors the projects-view checkbox: when the
    // user checks a recurring todo, advance its due date instead of
    // marking it complete. Fall through to the standard completion
    // path when there's no recurrence or the next due exceeds endDate.
    if (checkbox.checked && !wasCompleted && item.recurrence) {
        const advanced = listLogic.advanceRecurringTodo(project, item, new Date());
        if (advanced) {
            if (typeof onAfter === 'function') onAfter();
            return;
        }
    }

    // Route through listLogic so the localStorage write fires
    // unconditionally and the Supabase mirror update runs — the
    // follow-up sortCompletedToBottom short-circuits when the
    // partition order is already canonical (e.g. checking the last
    // open task from the Today view), so its built-in persist path
    // can't be relied on to flush this mutation on its own.
    listLogic.setToDoCompleted(project, item, checkbox.checked);
    listLogic.sortCompletedToBottom(project);

    // Open → done plays the slide-out fade on the row before the view
    // re-renders. Without the deferred re-render the row would be
    // unmounted before the animation could play. Done → open and
    // reduced-motion users re-render immediately, matching prior behavior.
    const animate = checkbox.checked && !wasCompleted && item.tit
        && !prefersReducedMotion();
    const row = checkbox.closest && checkbox.closest('.todayRow.todoRowCard');
    if (animate && row) {
        row.classList.add('completed', 'todoCompleting');
        row.addEventListener('animationend', function onSlideEnd(e) {
            if (e.animationName !== 'todoCompletingSlideFade') return;
            row.classList.remove('todoCompleting');
            row.removeEventListener('animationend', onSlideEnd);
            if (typeof onAfter === 'function') onAfter();
        });
        return;
    }

    if (typeof onAfter === 'function') onAfter();
}

// Switch to PROJECTS, select the named project (delegating to its
// projChild click handler so accent, sidebar state, and rendering all
// run through the canonical path), then scroll the matching todo row
// into view.
function jumpToProjectTodo(projectName, item) {
    const projRows = document.querySelectorAll('#projChild');
    let target = null;
    projRows.forEach(function(row) {
        const input = row.querySelector('#projInput');
        if (input && input.value === projectName) target = row;
    });
    if (!target) {
        if (applyActiveView) applyActiveView('projects');
        return;
    }

    if (!target.classList.contains('selectedProject')) {
        target.click();
    } else {
        // Already selected — just flip the view back.
        if (applyActiveView) applyActiveView('projects');
    }

    // Wait one frame so the row DOM is rebuilt before scrolling.
    requestAnimationFrame(function() {
        const mainList = document.getElementById('mainList');
        if (!mainList) return;
        const rows = mainList.querySelectorAll('#toDoChild');
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].__item === item) {
                try {
                    rows[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch (_) {
                    rows[i].scrollIntoView();
                }
                break;
            }
        }
    });
}


// ── CALENDAR VIEW ──────────────────────────────────────────────────
// Visible month + selected date for the Calendar view. Module-scope so
// the prev/next month buttons and individual cell-click handlers can
// mutate the state without threading refs through every callback. Both
// values reset to today on every entry to the Calendar view — neither
// is persisted across reloads (the spec is explicit: "Selected date is
// not persisted across page reloads — always resets to today on load").
let calendarVisibleYear  = null;
let calendarVisibleMonth = null; // 0..11
let calendarSelectedKey  = null; // 'YYYY-MM-DD'

// Accessor for the currently selected calendar date key. main.js's
// Calendar arrow-key re-focus block reads this through the accessor
// rather than the module-local var directly.
export function getCalendarSelectedKey() {
    return calendarSelectedKey;
}

export function resetCalendarStateToToday() {
    const today = new Date();
    calendarVisibleYear  = today.getFullYear();
    calendarVisibleMonth = today.getMonth();
    calendarSelectedKey  = formatCalendarKeyForDate(today);
}

export function shiftCalendarMonth(delta) {
    if (calendarVisibleYear === null || calendarVisibleMonth === null) {
        resetCalendarStateToToday();
    }
    const target = new Date(calendarVisibleYear, calendarVisibleMonth + delta, 1);
    calendarVisibleYear  = target.getFullYear();
    calendarVisibleMonth = target.getMonth();
    // The selected date persists across month nav — it just becomes a
    // leading/trailing day in the new month's grid (or falls outside
    // the visible cells entirely).
    renderCalendarView();
}

// Local-time YYYY-MM-DD formatter. Mirrors listLogic.formatCalendarKey;
// duplicated here because this module does not currently import private
// helpers from listLogic (only the public IIFE methods). Keep in sync.
export function formatCalendarKeyForDate(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return y + '-' + (m < 10 ? '0' + m : '' + m) + '-' + (d < 10 ? '0' + d : '' + d);
}

function parseCalendarKey(key) {
    if (!key || typeof key !== 'string') return null;
    const parts = key.split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m - 1, d);
}

const CALENDAR_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CALENDAR_WEEKDAY_NAMES = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];

// Full Calendar view render: month label, 7×5-6 grid with density dots,
// and the right-side day-detail panel for the currently selected date.
// Reads through listLogic.getCalendarMonth(), which returns one entry
// per visible grid cell so this function can iterate the keys without
// computing offsets a second time.
export function renderCalendarView() {
    const grid       = document.getElementById('calendarGrid');
    const monthLabel = document.getElementById('calendarMonthLabel');
    if (!grid || !monthLabel) return;
    if (calendarVisibleYear === null || calendarVisibleMonth === null) {
        resetCalendarStateToToday();
    }

    monthLabel.textContent = CALENDAR_MONTH_NAMES[calendarVisibleMonth] + ' ' + calendarVisibleYear;

    // Capture whether focus is inside the current grid before the
    // teardown discards every cell node. The Calendar arrow-nav, Enter,
    // and Backspace handlers all key off a focused .calendarCell, so
    // without a re-focus pass the user is stranded on <body> after the
    // rebuild. grid.contains() restricts the gate to the live grid so
    // mobile taps — where the <button> never receives focus — don't
    // auto-focus a cell and summon the on-screen keyboard.
    const ae = document.activeElement;
    const hadFocusedCell = !!(ae && ae.closest && ae.closest('.calendarCell') && grid.contains(ae));

    while (grid.firstChild) grid.removeChild(grid.firstChild);

    const monthMap = listLogic.getCalendarMonth(calendarVisibleYear, calendarVisibleMonth);
    const keys = Object.keys(monthMap).sort(); // ISO sort = chronological

    const todayKey = formatCalendarKeyForDate(new Date());

    keys.forEach(function(key) {
        const dt = parseCalendarKey(key);
        if (!dt) return;

        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'calendarCell';
        cell.setAttribute('data-date', key);
        cell.setAttribute('role', 'gridcell');

        const inMonth = dt.getMonth() === calendarVisibleMonth && dt.getFullYear() === calendarVisibleYear;
        if (!inMonth) cell.classList.add('outOfMonth');
        if (key === todayKey) cell.classList.add('isToday');
        if (key === calendarSelectedKey) cell.classList.add('isSelected');

        const dayNum = document.createElement('span');
        dayNum.className = 'calendarCellDay';
        dayNum.textContent = String(dt.getDate());
        cell.appendChild(dayNum);

        // Density indicator — 1/2/3+ dots for the number of incomplete
        // todos due on that date. Capped at 3 per spec; cells with no
        // todos render no dot strip at all so the day number sits cleanly.
        const todos = monthMap[key] || [];
        if (todos.length > 0) {
            const dotsWrap = document.createElement('span');
            dotsWrap.className = 'calendarCellDots';
            dotsWrap.setAttribute('aria-hidden', 'true');
            const dotCount = Math.min(todos.length, 3);
            for (let i = 0; i < dotCount; i++) {
                const dot = document.createElement('span');
                dot.className = 'calendarCellDot';
                dotsWrap.appendChild(dot);
            }
            cell.appendChild(dotsWrap);
        }

        cell.addEventListener('click', function() {
            calendarSelectedKey = key;
            renderCalendarView();
        });

        grid.appendChild(cell);
    });

    if (hadFocusedCell && calendarSelectedKey) {
        const refocus = grid.querySelector('.calendarCell[data-date="' + calendarSelectedKey + '"]');
        if (refocus) refocus.focus();
    }

    renderCalendarDayPanel(monthMap);
}

// Day-detail panel renderer — reads the already-built monthMap so the
// task list mirrors exactly what the grid's dot densities counted, and
// updates the panel header / count / row list in a single pass. Reuses
// buildTodayRow with { hideDuePill: true }; checkbox toggles re-render
// the whole calendar so the dot count for the toggled date refreshes
// in lockstep.
function renderCalendarDayPanel(monthMap) {
    const headerEl = document.getElementById('calendarDayHeader');
    const countEl  = document.getElementById('calendarDayCount');
    const listEl   = document.getElementById('calendarDayList');
    if (!headerEl || !countEl || !listEl) return;

    const dt = parseCalendarKey(calendarSelectedKey);
    if (!dt) {
        headerEl.textContent = '';
        countEl.textContent = '';
        while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
        return;
    }

    headerEl.textContent =
        CALENDAR_WEEKDAY_NAMES[dt.getDay()] + ' ' +
        CALENDAR_MONTH_NAMES[dt.getMonth()].toUpperCase() + ' ' +
        dt.getDate();

    const entries = monthMap[calendarSelectedKey] || [];
    if (entries.length === 0) {
        countEl.textContent = 'No items on this day';
    } else if (entries.length === 1) {
        countEl.textContent = '1 item';
    } else {
        countEl.textContent = entries.length + ' items';
    }

    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

    entries.forEach(function(entry) {
        const row = buildTodayRow(entry, 'calendar', {
            hideDuePill: true,
            onAfterToggle: renderCalendarView,
        });
        listEl.appendChild(row);
    });
}
