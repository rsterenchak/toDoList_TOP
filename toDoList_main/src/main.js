import './style.css';
import { listLogic } from './listLogic.js';
import { changelog, getNewestChangelogDate } from './changelog.js';
import button from './addProj_button.svg';


// ── THEME (light / dark) ──
// Dark is the default; light is a user-toggleable alternative. The chosen
// theme is expressed as a `data-theme` attribute on <html>, which CSS
// variable overrides in style.css key off. Applied at module load (before
// component() builds the DOM) so the first paint already matches the saved
// preference — no dark-to-light flash on reload.
const THEME_KEY = 'todoapp_theme';

function readStoredTheme() {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        return saved === 'light' || saved === 'dark' ? saved : null;
    } catch (e) {
        return null;
    }
}

function resolveInitialTheme() {
    const saved = readStoredTheme();
    if (saved) return saved;
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
    }
    return 'dark';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

// Runs during import, before component() — sets data-theme on <html> before
// any rendering happens.
applyTheme(resolveInitialTheme());


// Returns whole days from today until dueStr. Negative = overdue.
// Returns null for missing/invalid/blank dates. Storage format is "M-D-YYYY".
function daysUntilDue(dueStr) {
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
function applyDueUrgency(toDoChild, item) {
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
function setItemDue(item, toDoChild, m, d, y) {
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
function setRowDateOffset(item, toDoChild, offsetDays) {
    const target = new Date();
    target.setDate(target.getDate() + offsetDays);
    setItemDue(item, toDoChild, target.getMonth() + 1, target.getDate(), target.getFullYear());
}

// Parse the stored M-D-YYYY string into {m, d, y} numbers, or null when
// no valid date is set. Matches daysUntilDue's guard for consistency.
function parseItemDue(item) {
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
function formatPillAbsolute(m, d) {
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
function updateDuePillLabel(pill, item) {
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


// ── HELPER: build and wire the check-off checkbox for a todo row ──
// Inserts the checkbox as the left-most child of toDoChild, reflects the item's
// stored completed state, and persists changes. Blank placeholder rows pass the
// row through untouched — callers reveal the checkbox after a title is committed.
function wireCheckbox(toDoChild, toDoInput, item) {

    const checkToDo = document.createElement("input");
    checkToDo.type = "checkbox";
    checkToDo.id   = "checkToDo";
    checkToDo.checked = !!item.completed;

    toDoChild.insertBefore(checkToDo, toDoInput);

    if (!item.tit || item.tit === "") {
        checkToDo.style.display = "none";
    }

    if (item.completed) {
        toDoChild.classList.add("completed");
    }

    checkToDo.addEventListener("change", function() {
        const wasCompleted = !!item.completed;
        item.completed = checkToDo.checked;
        if (checkToDo.checked) {
            toDoChild.classList.add("completed");
        } else {
            toDoChild.classList.remove("completed");
        }

        // Celebratory micro-interaction — only on the unchecked → checked
        // edge, and only on committed rows (blank placeholders hide the
        // checkbox via CSS but guard here too for robustness).
        if (checkToDo.checked && !wasCompleted && item.tit) {
            if (isCoarsePointer() && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(10); } catch (_) { /* noop */ }
            }
            if (!prefersReducedMotion()) {
                toDoChild.classList.add('just-completed');
                setTimeout(function() {
                    toDoChild.classList.remove('just-completed');
                }, 300);
            }
        }

        applyDueUrgency(toDoChild, item);

        // Partition completed entries to the bottom of this project's list,
        // then slide the row (plus any open description panel) into its new
        // slot in-place so listeners stay attached.
        const projectName = toDoChild.dataset.value;
        if (projectName) {
            listLogic.sortCompletedToBottom(projectName);
            reorderToDoDOM(projectName);
        } else {
            listLogic.saveToStorage();
        }
    });

    return checkToDo;
}


// Walk the persisted project order and re-append each `#toDoChild` row in
// that sequence. Any open `#descSibling` panel directly after a row is moved
// with it. Uses `appendChild` on existing DOM nodes so event listeners stay
// attached — mirrors the in-place move pattern in `attachToDoDrag`.
// Keyed by the row's attached data-item reference rather than its title so
// that a newly committed title colliding with an existing completed item
// still maps 1:1 to its own DOM row.
function reorderToDoDOM(projectName) {
    const mainDiv = document.getElementById('mainList');
    if (!mainDiv) return;
    const items = listLogic.listItems(projectName);
    if (!items) return;

    const rowsByItem = new Map();
    const rows = mainDiv.querySelectorAll('#toDoChild');
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].__item) rowsByItem.set(rows[i].__item, rows[i]);
    }

    items.forEach(function(item) {
        let row = rowsByItem.get(item);
        if (!row) row = buildToDoRow(item, projectName);
        const descSibling = (row.nextSibling && row.nextSibling.id === 'descSibling')
            ? row.nextSibling : null;
        mainDiv.appendChild(row);
        if (descSibling) mainDiv.appendChild(descSibling);
    });

    updateCompletedSection(mainDiv);
}


// Persisted UI preference: open/closed state of the Completed section.
// Default is closed on first load; the value survives reloads and is shared
// across projects (one global toggle, not per-project).
const COMPLETED_SECTION_KEY = 'todoapp_completedSectionOpen';

function isCompletedSectionOpen() {
    return localStorage.getItem(COMPLETED_SECTION_KEY) === 'true';
}

function setCompletedSectionOpen(open) {
    localStorage.setItem(COMPLETED_SECTION_KEY, open ? 'true' : 'false');
}

// Insert a collapsible "Completed (N)" header before the first completed row
// in mainList, or remove it entirely if no completed rows exist. Applies the
// collapsed class to mainList so CSS can hide the completed rows (and any
// open description panels directly beneath them) while the section is closed.
// Safe to call repeatedly — each invocation rebuilds the header from scratch,
// so it can be called after every render or DOM reorder.
function updateCompletedSection(mainListDiv) {
    if (!mainListDiv) mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;

    const existing = mainListDiv.querySelector('#completedHeader');
    if (existing) mainListDiv.removeChild(existing);

    const completedRows = mainListDiv.querySelectorAll('#toDoChild.completed');
    if (completedRows.length === 0) {
        mainListDiv.classList.remove('completedCollapsed');
        updateEmptyState(mainListDiv);
        return;
    }

    const open = isCompletedSectionOpen();
    mainListDiv.classList.toggle('completedCollapsed', !open);

    const header = document.createElement('div');
    header.id = 'completedHeader';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', open ? 'true' : 'false');

    const caret = document.createElement('span');
    caret.className = 'completedCaret';
    caret.textContent = open ? '▼' : '▶';
    caret.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'completedLabel';
    label.textContent = 'Completed (' + completedRows.length + ')';

    header.appendChild(caret);
    header.appendChild(label);

    function toggle() {
        const nowOpen = !isCompletedSectionOpen();
        setCompletedSectionOpen(nowOpen);
        mainListDiv.classList.toggle('completedCollapsed', !nowOpen);
        caret.textContent = nowOpen ? '▼' : '▶';
        header.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
    }

    header.addEventListener('click', toggle);
    header.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
        }
    });

    mainListDiv.insertBefore(header, completedRows[0]);
    updateEmptyState(mainListDiv);
}


// Insert a friendly empty-state block when the selected project has no
// open (uncompleted, committed) todos. Two variants:
//  • done > 0  → "All caught up" celebratory message
//  • done === 0 → "No todos yet" welcome hint
// The block contains a centered input — typing there and pressing Enter
// creates a new todo via the same path as the normal placeholder row.
// Idempotent; safe to call from every render path.
function updateEmptyState(mainListDiv) {
    if (!mainListDiv) mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;

    // Preserve focus state across idempotent re-renders so the user can keep
    // typing if updateEmptyState fires mid-keystroke (e.g. via the MutationObserver).
    const prior = mainListDiv.querySelector('#emptyState');
    const priorInput = prior ? prior.querySelector('#emptyStateInput') : null;
    const wasFocused = priorInput && document.activeElement === priorInput;
    const priorValue = priorInput ? priorInput.value : '';
    const priorSelStart = priorInput ? priorInput.selectionStart : null;
    const priorSelEnd   = priorInput ? priorInput.selectionEnd   : null;

    if (prior) prior.remove();

    const rows = mainListDiv.querySelectorAll('#toDoChild');

    // Case A — no todo rows at all means no project is selected/exists. The
    // only path to a todo is via a project, so this variant has no input; it
    // simply points the user at the + button in the Projects sidebar.
    if (rows.length === 0) {
        mainListDiv.classList.add('emptyStatePresent');

        const block = document.createElement('div');
        block.id = 'emptyState';
        block.classList.add('emptyStateNoProjects');

        const icon = document.createElement('div');
        icon.className = 'emptyStateIcon';
        icon.textContent = '✦';

        const title = document.createElement('div');
        title.className = 'emptyStateTitle';
        title.textContent = 'No projects yet';

        const sub = document.createElement('div');
        sub.className = 'emptyStateSub';
        sub.textContent = 'Create your first project to start tracking todos.';

        const createBtn = document.createElement('button');
        createBtn.id = 'emptyStateCreateBtn';
        createBtn.type = 'button';
        createBtn.textContent = 'CREATE YOUR FIRST PROJECT';
        createBtn.addEventListener('click', function() {
            const projBtn = document.getElementById('projButton');
            if (projBtn) projBtn.click();
            // focus the newly-appended project input so the user can type immediately
            const sideMaDiv = document.getElementById('sideMa');
            if (sideMaDiv) {
                const inputs = sideMaDiv.querySelectorAll('#projInput');
                const last = inputs[inputs.length - 1];
                if (last) last.focus();
            }
        });

        block.appendChild(icon);
        block.appendChild(title);
        block.appendChild(sub);
        block.appendChild(createBtn);
        mainListDiv.appendChild(block);
        return;
    }

    // Case B/C — project has rows; decide between "no todos yet" and "all caught up".
    let open = 0, done = 0;
    rows.forEach(function(row) {
        const input = row.querySelector('#toDoInput');
        const val = input ? input.value.trim() : '';
        if (!val) return;
        if (row.classList.contains('completed')) done++; else open++;
    });

    if (open > 0) {
        mainListDiv.classList.remove('emptyStatePresent');
        return;
    }

    mainListDiv.classList.add('emptyStatePresent');

    const block = document.createElement('div');
    block.id = 'emptyState';

    const icon = document.createElement('div');
    icon.className = 'emptyStateIcon';

    const title = document.createElement('div');
    title.className = 'emptyStateTitle';

    const sub = document.createElement('div');
    sub.className = 'emptyStateSub';

    if (done === 0) {
        icon.textContent  = '✦';
        title.textContent = 'No todos yet';
        sub.textContent   = 'Type below to add your first one.';
    } else {
        icon.textContent  = '✓';
        title.textContent = 'All caught up';
        sub.textContent   = done === 1
            ? '1 todo completed in this project.'
            : done + ' todos completed in this project.';
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'emptyStateInput';
    input.autocomplete = 'off';
    input.placeholder = 'New item';
    input.value = priorValue;

    // Commit-on-Enter — delegate to the hidden placeholder row's input so the
    // real commit path (date defaults, blank-row rebuild, reveal controls,
    // re-render) runs unchanged.
    input.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter') return;
        const val = input.value.trim();
        if (!val) return;
        // Find the placeholder row among all #toDoChild nodes — it's the one whose
        // own #toDoInput is currently blank. Use that specific input to commit.
        const allRows = mainListDiv.querySelectorAll('#toDoChild');
        let target = null;
        for (let i = 0; i < allRows.length; i++) {
            const pi = allRows[i].querySelector('#toDoInput');
            if (pi && pi.value.trim() === '') { target = pi; break; }
        }
        if (!target) return;
        target.value = val;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    block.appendChild(icon);
    block.appendChild(title);
    block.appendChild(sub);
    block.appendChild(input);

    // Insert at the top of mainList. The placeholder row is hidden via CSS
    // (#mainList.emptyStatePresent #toDoChild:first-of-type) so the block
    // visually occupies the slot where the placeholder would be.
    mainListDiv.insertBefore(block, mainListDiv.firstChild);

    if (wasFocused) {
        input.focus();
        if (priorSelStart !== null && priorSelEnd !== null) {
            try { input.setSelectionRange(priorSelStart, priorSelEnd); } catch (e) { /* ignore */ }
        }
    }
}


// ── HELPER: wire click-to-activate then click-to-edit on a todo row ──
// First click on a committed row marks it todo-active (enabling pointer-events on
// the input). Second click on the input then focuses it for editing.
// Blank placeholder rows skip straight to focus on first click.
function wireToDoRowClick(toDoChild, toDoInput) {
    toDoChild.addEventListener('click', function(e) {
        // Let dedicated controls handle their own clicks without interference
        if (e.target.id === 'checkToDo'      ||
            e.target.id === 'closeButtonToDo' ||
            e.target.id === 'descToggle'      ||
            e.target.closest('#duePill')      ||
            e.target.closest('#dueDatePopover') ||
            e.target.closest('#descSibling')) return;

        // Blank rows: focus immediately (user intends to type a new item)
        if (!toDoInput.value.trim()) {
            toDoInput.focus();
            return;
        }

        // Committed rows: activate this row, deactivate all others
        document.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
            if (el !== toDoChild) el.classList.remove('todo-active');
        });
        toDoChild.classList.add('todo-active');

        // one-click editing — focus with caret at end rather than selecting text
        if (document.activeElement !== toDoInput) {
            const end = toDoInput.value.length;
            toDoInput.focus();
            toDoInput.setSelectionRange(end, end);
        }
    });
}


// ── HELPER: wire the dropdown toggle button that opens/closes a row's description ──
// Replaces the old behaviour where clicking anywhere on the todo row expanded the description.
function wireDescToggle(descToggle, toDoChild, descSibling, descSpacer1, descInput, descSpacer2, item) {

    let switcher = 0;

    descToggle.addEventListener("click", function(event) {
        event.stopPropagation();

        const mainList = toDoChild.parentElement;
        if (!mainList) return;

        if (switcher === 0) {
            mainList.insertBefore(descSibling, toDoChild.nextSibling);
            descSibling.appendChild(descSpacer1);
            descSibling.appendChild(descInput);
            descSibling.appendChild(descSpacer2);
            descInput.value = item["desc"] || "";
            descToggle.classList.add("open");
            switcher = 1;
        } else {
            if (toDoChild.nextSibling && toDoChild.nextSibling.id === 'descSibling') {
                mainList.removeChild(toDoChild.nextSibling);
            }
            descToggle.classList.remove("open");
            switcher = 0;
        }
    });
}


// Default due-date offset used when a row is committed without a user-chosen
// date. Matches the legacy placeholder behavior (today + 7 days).
const DEFAULT_DUE_OFFSET_DAYS = 7;

function defaultDueParts() {
    const future = new Date();
    future.setDate(future.getDate() + DEFAULT_DUE_OFFSET_DAYS);
    return { m: future.getMonth() + 1, d: future.getDate(), y: future.getFullYear() };
}


// ── DRAG-AND-DROP REORDERING ──
// Shared helpers powering both project-row and todo-row drag reordering.
// Uses native HTML5 drag on desktop and synthesised touch-drag on touch devices.
// A single drop indicator line is reused across both contexts.

let dropIndicator = null;
let touchDragState = null;   // active touch-drag payload; null when idle
const TOUCH_ARM_MS         = 180;   // hold before a touch-drag arms
const TOUCH_ARM_MOVE_PX    = 8;     // pre-arm move that cancels the arm (treat as scroll)
const AUTOSCROLL_EDGE_PX   = 40;    // distance from edge that triggers auto-scroll
const AUTOSCROLL_STEP_PX   = 8;     // pixels scrolled per tick while in the edge zone
const SWIPE_THRESHOLD_PX   = 80;    // horizontal distance that commits a swipe action
const SWIPE_SNAPBACK_MS    = 260;   // release-below-threshold snap-back duration

function isCoarsePointer() {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function resetSwipeRow(row) {
    row.classList.remove('swiping', 'swipe-releasing', 'swipe-right', 'swipe-left');
    row.style.removeProperty('--swipe-dx');
    row.style.removeProperty('--swipe-width');
    row.style.removeProperty('--swipe-progress');
}

function getDropIndicator() {
    if (!dropIndicator) {
        dropIndicator = document.createElement('div');
        dropIndicator.className = 'dropIndicator';
    }
    return dropIndicator;
}

function removeDropIndicator() {
    if (dropIndicator && dropIndicator.parentNode) {
        dropIndicator.parentNode.removeChild(dropIndicator);
    }
}

// Return only the rows that are currently draggable — blank placeholder rows
// and unnamed project rows set `draggable="false"` so drop-index math ignores
// them. Also skip rows hidden via CSS (e.g. completed rows tucked inside a
// collapsed Completed section): their zeroed bounding rects would otherwise
// poison computeDropIndex.
function draggableSiblings(container, itemSelector) {
    return Array.prototype.slice.call(container.querySelectorAll(itemSelector))
        .filter(function(s) {
            return s.getAttribute('draggable') === 'true' && s.offsetParent !== null;
        });
}

// Returns the index a dragged row would land at if dropped at clientY,
// using splice semantics: the dragged row's current slot is first ignored,
// then the new index is the count of remaining rows whose midpoint is above clientY.
// Uncompleted rows are clamped to stay above the completed partition (and vice
// versa) so a drop never crosses the Completed boundary.
function computeDropIndex(draggedEl, container, itemSelector, clientY) {
    const siblings = draggableSiblings(container, itemSelector);
    let idx = 0;
    for (let i = 0; i < siblings.length; i++) {
        const s = siblings[i];
        if (s === draggedEl) continue;
        const rect = s.getBoundingClientRect();
        if (clientY > rect.top + rect.height / 2) idx++;
    }
    const draggedCompleted = draggedEl.classList.contains('completed');
    const uncompletedCount = siblings.filter(function(s) {
        return s !== draggedEl && !s.classList.contains('completed');
    }).length;
    if (draggedCompleted) {
        if (idx < uncompletedCount) idx = uncompletedCount;
    } else {
        if (idx > uncompletedCount) idx = uncompletedCount;
    }
    return idx;
}

// Position the indicator as an absolutely-positioned overlay inside the
// container. Avoids consuming a grid-row slot when the list uses a fixed
// grid template. The container must be position: relative.
function showDropIndicator(draggedEl, container, itemSelector, clientY) {
    const indicator = getDropIndicator();
    const draggedCompleted = draggedEl.classList.contains('completed');
    // Only consider same-section siblings so the indicator never points into
    // the opposite partition (uncompleted vs. completed). Project rows never
    // carry `.completed`, so this filter is a no-op for them.
    const siblings  = draggableSiblings(container, itemSelector)
        .filter(function(s) {
            return s !== draggedEl &&
                   s.classList.contains('completed') === draggedCompleted;
        });

    const containerRect = container.getBoundingClientRect();
    let top = 0;

    if (siblings.length === 0) {
        top = 0;
    } else {
        let insertBefore = null;
        for (let i = 0; i < siblings.length; i++) {
            const rect = siblings[i].getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) { insertBefore = siblings[i]; break; }
        }
        if (insertBefore) {
            const r = insertBefore.getBoundingClientRect();
            top = r.top - containerRect.top + container.scrollTop;
        } else {
            const r = siblings[siblings.length - 1].getBoundingClientRect();
            top = r.bottom - containerRect.top + container.scrollTop;
        }
    }

    if (indicator.parentNode !== container) container.appendChild(indicator);
    indicator.style.top = top + 'px';
    // Remember the container so endTouchDrag knows which context this indicator belongs to.
    indicator.__container = container;
}

// Auto-scroll the given container if pointer is near its top/bottom edge.
function autoScrollIfNeeded(scrollEl, clientY) {
    if (!scrollEl) return;
    const rect = scrollEl.getBoundingClientRect();
    if (clientY - rect.top < AUTOSCROLL_EDGE_PX) {
        scrollEl.scrollTop -= AUTOSCROLL_STEP_PX;
    } else if (rect.bottom - clientY < AUTOSCROLL_EDGE_PX) {
        scrollEl.scrollTop += AUTOSCROLL_STEP_PX;
    }
}

// Wire drag reordering on a single row. Works for both projects and todos.
// cfg:
//   container       — scrollable parent that holds sibling rows
//   itemSelector    — CSS selector for sibling draggable rows (e.g. '#projChild')
//   getIndex        — () => current index of this row among siblings
//   isDraggable     — () => boolean, row is eligible to drag right now
//                     (blank placeholder or not-yet-committed rows return false)
//   onReorder       — (fromIdx, toIdx) => void, commits the reorder to the model
//                     and/or re-renders the DOM
//   swipe           — optional { onRight, onLeft } — enables horizontal swipe
//                     gestures on touch devices. Same isDraggable gate applies.
function setupRowDrag(row, cfg) {

    // Caller sets/unsets row.draggable based on row state — blank placeholder
    // rows stay non-draggable so they don't participate in reorder index math.
    // We still bind all listeners so the row can be re-enabled later by the caller.

    // ── HTML5 drag (desktop) ──
    row.addEventListener('dragstart', function(event) {
        if (!cfg.isDraggable()) { event.preventDefault(); return; }
        row.classList.add('dragging');
        document.body.classList.add('row-dragging');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            // Firefox requires setData to initiate a drag.
            try { event.dataTransfer.setData('text/plain', ''); } catch (e) { /* ignore */ }
        }
    });

    row.addEventListener('dragend', function() {
        row.classList.remove('dragging');
        document.body.classList.remove('row-dragging');
        removeDropIndicator();
    });

    // dragover on the container handles indicator + auto-scroll.
    // Wire it only once per container to avoid stacked listeners.
    if (!cfg.container.__dragWired) {
        cfg.container.__dragWired = true;
        cfg.container.addEventListener('dragover', function(event) {
            const dragging = cfg.container.querySelector('.dragging');
            if (!dragging) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            showDropIndicator(dragging, cfg.container, cfg.itemSelector, event.clientY);
            autoScrollIfNeeded(cfg.container, event.clientY);
        });
        cfg.container.addEventListener('drop', function(event) {
            const dragging = cfg.container.querySelector('.dragging');
            if (!dragging) return;
            event.preventDefault();
            const siblings = draggableSiblings(cfg.container, cfg.itemSelector);
            const toIdx    = computeDropIndex(dragging, cfg.container, cfg.itemSelector, event.clientY);
            const fromIdx  = siblings.indexOf(dragging);
            removeDropIndicator();
            dragging.classList.remove('dragging');
            if (fromIdx !== -1 && fromIdx !== toIdx) cfg.onReorder(fromIdx, toIdx);
        });
        cfg.container.addEventListener('dragleave', function(event) {
            // only remove indicator when leaving the container entirely
            if (event.target === cfg.container) removeDropIndicator();
        });
    }

    // ── Touch drag + swipe (mobile) ──
    // Holds for TOUCH_ARM_MS to arm a vertical reorder drag; movement before arming
    // is normally treated as native scroll. On swipe-enabled rows, horizontal-dominant
    // pre-arm motion promotes the gesture into swipe mode instead. Once either mode
    // commits, the other is locked out for that gesture.
    row.addEventListener('touchstart', function(event) {
        if (event.touches.length !== 1) return;
        if (!cfg.isDraggable()) return;

        // A new gesture cancels any pending swipe snap-back on this row so
        // the starting transform snaps to the user's finger cleanly.
        if (row._swipeReleaseTimer) {
            clearTimeout(row._swipeReleaseTimer);
            row._swipeReleaseTimer = null;
            resetSwipeRow(row);
        }

        const t = event.touches[0];
        const startX = t.clientX;
        const startY = t.clientY;

        const state = {
            row: row,
            cfg: cfg,
            startX: startX,
            startY: startY,
            lastY:  startY,
            armed: false,
            moved: false,  // first-move flag — visual state applied only then
            mode: null,    // null | 'swipe'; drag mode uses `armed + moved` flags
            swipeDx: 0,
            swipeCfg: (cfg.swipe && isCoarsePointer()) ? cfg.swipe : null,
            armTimer: setTimeout(function() { state.armed = true; }, TOUCH_ARM_MS)
        };

        touchDragState = state;
    }, { passive: true });

    row.addEventListener('touchmove', function(event) {
        const state = touchDragState;
        if (!state || state.row !== row) return;

        const t = event.touches[0];

        if (state.mode !== 'swipe' && !state.armed) {
            const dx = t.clientX - state.startX;
            const dy = t.clientY - state.startY;
            const adx = Math.abs(dx);
            const ady = Math.abs(dy);

            if (adx <= TOUCH_ARM_MOVE_PX && ady <= TOUCH_ARM_MOVE_PX) return;

            clearTimeout(state.armTimer);

            // Horizontal-dominant intent on a swipe-enabled row takes over.
            // Vertical-dominant motion surrenders to native scroll, and once
            // that happens swipe can't reclaim the gesture either.
            if (state.swipeCfg && adx > ady) {
                state.mode = 'swipe';
                row.classList.add('swiping');
                row.classList.toggle('swipe-right', dx > 0);
                row.classList.toggle('swipe-left',  dx < 0);
            } else {
                touchDragState = null;
                return;
            }
        }

        if (state.mode === 'swipe') {
            if (event.cancelable) event.preventDefault();
            const dx = t.clientX - state.startX;
            state.swipeDx = dx;
            // Switch direction classes if the user reverses mid-gesture so
            // only the correct action pane is ever visible.
            row.classList.toggle('swipe-right', dx > 0);
            row.classList.toggle('swipe-left',  dx < 0);
            row.style.setProperty('--swipe-dx', dx + 'px');
            row.style.setProperty('--swipe-width', Math.abs(dx) + 'px');
            const progress = Math.min(Math.abs(dx) / SWIPE_THRESHOLD_PX, 1);
            row.style.setProperty('--swipe-progress', progress.toFixed(3));
            return;
        }

        // Armed drag — suppress native scroll and drive the indicator.
        if (event.cancelable) event.preventDefault();
        state.lastY = t.clientY;
        if (!state.moved) {
            state.moved = true;
            row.classList.add('dragging');
            // A move after arm confirms the user wanted to drag, not long-press —
            // close any open project context menu so they don't stack.
            if (typeof hideProjectContextMenu === 'function') hideProjectContextMenu();
        }
        showDropIndicator(row, cfg.container, cfg.itemSelector, t.clientY);
        autoScrollIfNeeded(cfg.container, t.clientY);
    }, { passive: false });

    function endTouchDrag() {
        const state = touchDragState;
        if (!state || state.row !== row) return;
        clearTimeout(state.armTimer);

        if (state.mode === 'swipe') {
            const dx = state.swipeDx || 0;
            const past = Math.abs(dx) >= SWIPE_THRESHOLD_PX;

            if (past) {
                // Reset visual state first so the row doesn't linger translated
                // while a follow-up modal (delete confirm) or sort (complete)
                // animates in. Actions reuse the existing change/click paths.
                resetSwipeRow(row);
                if (dx > 0 && state.swipeCfg.onRight) state.swipeCfg.onRight();
                else if (dx < 0 && state.swipeCfg.onLeft) state.swipeCfg.onLeft();
            } else if (prefersReducedMotion()) {
                resetSwipeRow(row);
            } else {
                row.classList.remove('swiping');
                row.classList.add('swipe-releasing');
                row.style.setProperty('--swipe-dx', '0px');
                row.style.setProperty('--swipe-width', '0px');
                row.style.setProperty('--swipe-progress', '0');
                row._swipeReleaseTimer = setTimeout(function() {
                    row._swipeReleaseTimer = null;
                    if (row.classList.contains('swipe-releasing')) {
                        resetSwipeRow(row);
                    }
                }, SWIPE_SNAPBACK_MS);
            }

            touchDragState = null;
            return;
        }

        if (state.armed && state.moved) {
            const siblings = draggableSiblings(cfg.container, cfg.itemSelector);
            const fromIdx  = siblings.indexOf(row);
            const toIdx    = computeDropIndex(row, cfg.container, cfg.itemSelector, state.lastY);
            removeDropIndicator();
            row.classList.remove('dragging');
            if (fromIdx !== -1 && fromIdx !== toIdx) cfg.onReorder(fromIdx, toIdx);
        }

        touchDragState = null;
    }

    row.addEventListener('touchend',    endTouchDrag);
    row.addEventListener('touchcancel', endTouchDrag);
}


// ── PROJECT ACCENT COLORS ──
// Concrete hex values for each per-project color key in listLogic's palette.
// Both light and dark themes share the same swatches — values are picked to
// read cleanly on either surface. A null key means "use the theme accent",
// which the CSS `var(--proj-accent, var(--accent))` fallback resolves.
const PROJECT_COLOR_HEX = {
    red:    '#e06a7a',
    orange: '#e29050',
    yellow: '#d9b86a',
    green:  '#7ac481',
    blue:   '#6ab5e0',
    purple: '#b779e0'
};

// Apply a project's accent color to an element via CSS custom property.
// Passing null removes the property so the theme accent takes over.
function applyProjectAccent(el, colorKey) {
    if (!el) return;
    if (colorKey && PROJECT_COLOR_HEX[colorKey]) {
        el.style.setProperty('--proj-accent', PROJECT_COLOR_HEX[colorKey]);
    } else {
        el.style.removeProperty('--proj-accent');
    }
}


// ── PROJECT CONTEXT MENU ──
// Right-click (or long-press on touch) a project row to open a custom menu
// with Edit, a color picker, and Delete options. Replaces the removed `×`
// delete button.

function hideProjectContextMenu() {
    const existing = document.getElementById('projContextMenu');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    document.removeEventListener('click', onProjContextOutsideClick, true);
    document.removeEventListener('contextmenu', onProjContextOutsideCtx, true);
    document.removeEventListener('keydown', onProjContextKeydown, true);
    window.removeEventListener('resize', hideProjectContextMenu);
    window.removeEventListener('scroll', hideProjectContextMenu, true);
}

function onProjContextOutsideClick(event) {
    const menu = document.getElementById('projContextMenu');
    if (menu && !menu.contains(event.target)) hideProjectContextMenu();
}

function onProjContextOutsideCtx(event) {
    const menu = document.getElementById('projContextMenu');
    if (menu && !menu.contains(event.target)) hideProjectContextMenu();
}

function onProjContextKeydown(event) {
    if (event.key === 'Escape') hideProjectContextMenu();
}

// Build the inline color-picker strip that sits between Edit and Delete in
// the project context menu. Single click on any swatch assigns the color
// and closes the menu — matching how Edit and Delete already behave.
function buildColorPicker(currentColorKey, onSelect) {
    const picker = document.createElement('div');
    picker.className = 'projContextColorPicker';

    // Reset (theme accent) slot first so it's the leftmost option.
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'projContextColorSwatch reset';
    resetBtn.setAttribute('aria-label', 'Reset to theme accent');
    if (!currentColorKey) resetBtn.classList.add('active');
    resetBtn.addEventListener('click', function() {
        hideProjectContextMenu();
        onSelect(null);
    });
    picker.appendChild(resetBtn);

    listLogic.PROJECT_COLOR_KEYS.forEach(function(key) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'projContextColorSwatch';
        btn.style.setProperty('--swatch-color', PROJECT_COLOR_HEX[key]);
        btn.setAttribute('aria-label', 'Set project color: ' + key);
        if (currentColorKey === key) btn.classList.add('active');
        btn.addEventListener('click', function() {
            hideProjectContextMenu();
            onSelect(key);
        });
        picker.appendChild(btn);
    });

    return picker;
}


function showProjectContextMenu(x, y, onEdit, onDelete, colorContext) {

    hideProjectContextMenu();

    const menu = document.createElement('div');
    menu.id = 'projContextMenu';
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    const editOpt = document.createElement('div');
    editOpt.className = 'projContextMenuItem';
    editOpt.textContent = 'Edit';
    editOpt.addEventListener('click', function() {
        hideProjectContextMenu();
        onEdit();
    });

    const delOpt = document.createElement('div');
    delOpt.className = 'projContextMenuItem danger';
    delOpt.textContent = 'Delete';
    delOpt.addEventListener('click', function() {
        hideProjectContextMenu();
        onDelete();
    });

    menu.appendChild(editOpt);
    if (colorContext && typeof colorContext.onSelect === 'function') {
        menu.appendChild(buildColorPicker(colorContext.currentColor || null, colorContext.onSelect));
    }
    menu.appendChild(delOpt);
    document.body.appendChild(menu);

    // clamp to viewport so the menu is fully visible
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth)  menu.style.left = Math.max(0, window.innerWidth  - rect.width  - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top  = Math.max(0, window.innerHeight - rect.height - 4) + 'px';

    // capture-phase listeners so outside interactions always close the menu
    document.addEventListener('click',      onProjContextOutsideClick, true);
    document.addEventListener('contextmenu', onProjContextOutsideCtx,  true);
    document.addEventListener('keydown',    onProjContextKeydown,      true);
    window.addEventListener('resize', hideProjectContextMenu);
    window.addEventListener('scroll', hideProjectContextMenu, true);
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

function hideDueDatePopover() {
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

function showDueDatePopover(anchor, item, toDoChild) {
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


// ── CONFIRM MODAL ──
// Async, themed replacement for window.confirm. Destructive actions (delete
// project, delete todo) require a confirmation step per CLAUDE.md; the native
// dialog breaks visual continuity and can't be styled. Closes on Cancel,
// backdrop click, or Escape — matching the modal conventions in CLAUDE.md.
function showConfirmModal(options) {

    // Defensive: remove any stray prior modal so we never stack two.
    const prior = document.getElementById('confirmModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'confirmModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'confirmModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const msg = document.createElement('div');
    msg.id = 'confirmModalMessage';
    msg.textContent = options.message || '';

    const actions = document.createElement('div');
    actions.id = 'confirmModalActions';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'confirmModalCancel';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'confirmModalConfirm';
    confirmBtn.type = 'button';
    if (options.danger !== false) confirmBtn.classList.add('danger');
    confirmBtn.textContent = options.confirmLabel || 'Delete';

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(msg);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // Focus the confirm button so keyboard users can Enter-to-confirm
    // immediately and Escape-to-cancel works without a tab first.
    confirmBtn.focus();

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    }

    cancelBtn.addEventListener('click', close);
    confirmBtn.addEventListener('click', function() {
        close();
        if (typeof options.onConfirm === 'function') options.onConfirm();
    });
    // Only backdrop clicks should dismiss — clicks inside the dialog should not.
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);
}

// ── CHANGELOG MODAL ──
// Footer version label opens this: a dismissible dialog listing version
// history from changelog.js. Mirrors showConfirmModal's backdrop + Escape +
// backdrop-click dismissal, but swaps the confirm/cancel footer for a single
// Close button and adds an explicit corner X.
const CHANGELOG_LAST_SEEN_KEY = 'todoapp_changelogLastSeen';

function readChangelogLastSeen() {
    try {
        return localStorage.getItem(CHANGELOG_LAST_SEEN_KEY);
    } catch (e) {
        return null;
    }
}

function writeChangelogLastSeen(dateStr) {
    try {
        localStorage.setItem(CHANGELOG_LAST_SEEN_KEY, dateStr);
    } catch (e) {
        // localStorage can throw in private-browsing or quota-exceeded states;
        // the dot re-appears next load, which is acceptable.
    }
}

// ISO YYYY-MM-DD strings sort lexicographically, so string compare suffices.
function hasUnseenChangelog() {
    const newest = getNewestChangelogDate();
    if (!newest) return false;
    const lastSeen = readChangelogLastSeen();
    if (!lastSeen) return true;
    return newest > lastSeen;
}

function updateChangelogDot() {
    const dot = document.getElementById('changelogDot');
    if (!dot) return;
    // When a pending service-worker update exists, the dot is forced on to
    // surface the reload cue regardless of changelog-seen state.
    const show = hasUnseenChangelog() || pendingUpdateRegistration !== null;
    dot.style.display = show ? 'inline-block' : 'none';
}

// ── SERVICE WORKER UPDATE CUE ──
// index.js registers the service worker and calls notifyUpdateAvailable()
// once a new worker reaches the `waiting` state. The footer version label
// reuses the #changelogDot visual vocabulary to signal the update, and its
// click handler switches from "open changelog" to "skipWaiting + reload".
let pendingUpdateRegistration = null;

function notifyUpdateAvailable(registration) {
    pendingUpdateRegistration = registration || null;
    const footVersion = document.getElementById('footVersion');
    if (footVersion) {
        footVersion.classList.add('hasUpdate');
        footVersion.setAttribute('title', 'Update available — reload to apply');
        footVersion.setAttribute('aria-label', 'Update available — reload to apply');
    }
    updateChangelogDot();
}

function applyPendingUpdate() {
    const registration = pendingUpdateRegistration;
    if (!registration) return false;
    const worker = registration.waiting || registration.installing;
    if (worker && typeof worker.postMessage === 'function') {
        worker.postMessage({ type: 'SKIP_WAITING' });
    } else {
        // Fallback — nothing to message, just reload so the user sees the cue clear.
        window.location.reload();
    }
    return true;
}

function showChangelogModal() {
    const prior = document.getElementById('changelogModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'changelogModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'changelogModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'changelogModalTitle');

    const header = document.createElement('div');
    header.id = 'changelogModalHeader';

    const title = document.createElement('div');
    title.id = 'changelogModalTitle';
    title.textContent = 'Changelog';

    const closeX = document.createElement('button');
    closeX.id = 'changelogModalClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close changelog');
    closeX.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'changelogModalBody';

    changelog.forEach(function(entry) {
        const block = document.createElement('section');
        block.className = 'changelogEntry';

        const heading = document.createElement('div');
        heading.className = 'changelogEntryHeading';

        const ver = document.createElement('span');
        ver.className = 'changelogEntryVersion';
        ver.textContent = 'v' + entry.version;

        const date = document.createElement('span');
        date.className = 'changelogEntryDate';
        date.textContent = entry.date;

        heading.appendChild(ver);
        heading.appendChild(date);
        block.appendChild(heading);

        [
            ['Added',   entry.added],
            ['Changed', entry.changed],
            ['Fixed',   entry.fixed]
        ].forEach(function(pair) {
            const label = pair[0];
            const bullets = pair[1];
            if (!bullets || !bullets.length) return;

            const groupLabel = document.createElement('div');
            groupLabel.className = 'changelogGroupLabel';
            groupLabel.textContent = label;

            const list = document.createElement('ul');
            list.className = 'changelogBullets';
            bullets.forEach(function(text) {
                const li = document.createElement('li');
                li.textContent = text;
                list.appendChild(li);
            });

            block.appendChild(groupLabel);
            block.appendChild(list);
        });

        body.appendChild(block);
    });

    const actions = document.createElement('div');
    actions.id = 'changelogModalActions';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'changelogModalCloseBtn';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';

    actions.appendChild(closeBtn);
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    closeBtn.focus();

    // Mark the newest entry as seen the moment the modal opens. Drop the dot
    // immediately so returning from the modal shows its new baseline state.
    const newest = getNewestChangelogDate();
    if (newest) writeChangelogLastSeen(newest);
    updateChangelogDot();

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    }

    closeX.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);
}


function countRealToDos(projectName) {
    const items = listLogic.listItems(projectName);
    if (!items) return 0;
    return items.filter(function(i){ return i.tit !== ''; }).length;
}

function deleteProjectFlow(projChild, projectName) {

    // New rows that haven't been named yet aren't in the data model —
    // just drop the placeholder row and re-enable the add-project button.
    if (!projectName) {
        if (projChild.parentNode) projChild.parentNode.removeChild(projChild);
        const btn = document.getElementById('projButton');
        if (btn) btn.style.pointerEvents = 'auto';
        return;
    }

    const count = countRealToDos(projectName);
    const message = count > 0
        ? 'Delete project "' + projectName + '" and its ' + count + ' todo item' + (count === 1 ? '' : 's') + '? This cannot be undone.'
        : 'Delete project "' + projectName + '"? This cannot be undone.';

    showConfirmModal({
        message: message,
        onConfirm: function() {
            const mainListEl = document.getElementById('mainList');
            const projButton = document.getElementById('projButton');
            const wasSelected = projChild.classList.contains('selectedProject');

            if (projChild.parentNode) projChild.parentNode.removeChild(projChild);

            if (wasSelected && mainListEl) {
                while (mainListEl.firstChild) mainListEl.removeChild(mainListEl.firstChild);
            }

            listLogic.removeProject(projectName);
            listLogic.listProjects();
            if (projButton) projButton.style.pointerEvents = 'auto';

            if (wasSelected) {
                const nextRow = document.querySelector('#projChild');
                if (nextRow) {
                    nextRow.classList.remove('unselectedProject');
                    nextRow.classList.add('selectedProject');
                    const nextInput = nextRow.querySelector('#projInput');
                    const nextName  = nextInput ? nextInput.value : nextRow.dataset.project;
                    const nextItems = listLogic.listItems(nextName);
                    applyProjectAccent(mainListEl, listLogic.getProjectColor(nextName));
                    if (nextItems) addAllToDo_DOM(nextItems, nextName);
                    focusBlankToDoInputIfDesktop();
                } else {
                    applyProjectAccent(mainListEl, null);
                    updateEmptyState(mainListEl);
                }
            }
        }
    });
}

// Wire drag reordering on a todo row. Keeps `row.draggable` in sync with
// the title state so blank placeholder rows never participate in reorder
// math, and text selection inside the title input isn't hijacked by the
// browser's drag handler during editing.
// `swipeTargets` (optional) wires horizontal swipe-to-complete / swipe-to-delete
// on touch devices. Reuses the existing checkbox change and close-button click
// paths so persistence and delete confirmation stay identical.
function attachToDoDrag(toDoChild, toDoInput, project, swipeTargets) {

    const swipeCfg = swipeTargets ? {
        onRight: function() {
            const cb = swipeTargets.checkToDo;
            if (!cb || cb.style.display === 'none') return;
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
        },
        onLeft: function() {
            const btn = swipeTargets.closeButtonToDo;
            if (!btn || btn.style.display === 'none') return;
            btn.click();
        }
    } : null;

    setupRowDrag(toDoChild, {
        container: document.getElementById('mainList'),
        itemSelector: '#toDoChild',
        isDraggable: function() {
            return !!(toDoInput && toDoInput.value && toDoInput.value.trim().length > 0);
        },
        onReorder: function(fromIdx, toIdx) {
            const mainDiv = document.getElementById('mainList');
            // Read current project from DOM — the closed-over `project` may be
            // stale if the user switched projects after this listener was wired.
            const anyRow = mainDiv.querySelector('[data-value]');
            const activeProject = anyRow ? anyRow.dataset.value : project;
            listLogic.reorderToDo(activeProject, fromIdx, toIdx);
            // Re-render from the model. reorderToDo re-partitions completed
            // items to the bottom, so the user's drop position may be
            // clamped — the DOM must reflect the model rather than where
            // the user released. Existing rows are moved (not recreated),
            // so listeners and any open description panels are preserved.
            reorderToDoDOM(activeProject);
        },
        swipe: swipeCfg
    });

    function syncDraggable() {
        toDoChild.setAttribute(
            'draggable',
            toDoInput.value.trim().length > 0 ? 'true' : 'false'
        );
    }
    syncDraggable();
    toDoInput.addEventListener('keyup', syncDraggable);
    toDoInput.addEventListener('blur',  syncDraggable);
    // disable drag while typing so mouse-drag text selection inside the
    // input still works; re-enabled on blur
    toDoInput.addEventListener('focus', function() {
        toDoChild.setAttribute('draggable', 'false');
    });
}


// Reorder the DOM of project rows to match the persisted order.
// After a drag-drop the data model is authoritative; this walks the saved
// project order and re-appends `#projChild` nodes in-place. Existing event
// wiring on each row is preserved because we move the same DOM nodes.
function reorderProjectDOM() {
    const sideMaDiv = document.getElementById('sideMa');
    if (!sideMaDiv) return;
    const order = listLogic.listProjectsArray();
    const rowsByName = {};
    const rows = sideMaDiv.querySelectorAll('#projChild');
    for (let i = 0; i < rows.length; i++) {
        const input = rows[i].querySelector('#projInput');
        if (input && input.value) rowsByName[input.value] = rows[i];
    }
    order.forEach(function(name) {
        const row = rowsByName[name];
        if (row) sideMaDiv.appendChild(row);
    });
}

// Wire drag reordering on a project row. Only committed rows (those whose
// name exists in the data model) are draggable, so unnamed or mid-edit rows
// never participate in reorder index math.
function attachProjectDrag(projChild, titleInput) {

    function isCommitted() {
        const name = titleInput.value.trim();
        if (name.length === 0) return false;
        return listLogic.listProjectsArray().indexOf(name) !== -1;
    }

    setupRowDrag(projChild, {
        container: document.getElementById('sideMa'),
        itemSelector: '#projChild',
        isDraggable: isCommitted,
        onReorder: function(fromIdx, toIdx) {
            listLogic.reorderProject(fromIdx, toIdx);
            reorderProjectDOM();
        }
    });

    function syncDraggable() {
        projChild.setAttribute('draggable', isCommitted() ? 'true' : 'false');
    }
    syncDraggable();
    titleInput.addEventListener('keyup', syncDraggable);
    titleInput.addEventListener('blur',  syncDraggable);
    // while typing, disable drag so mouse text selection inside the input
    // isn't hijacked
    titleInput.addEventListener('focus', function() {
        projChild.setAttribute('draggable', 'false');
    });
}

function attachProjectContextMenu(projChild, titleInput) {

    function selectIfNeeded() {
        if (projChild.classList.contains('selectedProject')) return;

        const current = document.querySelector('.selectedProject');
        if (current) {
            const prevInput = current.querySelector('#projInput');
            if (prevInput) {
                prevInput.style.pointerEvents = 'none';
                prevInput.style.cursor = 'default';
                prevInput.blur();
            }
            current.classList.remove('selectedProject');
            current.classList.add('unselectedProject');
        }

        projChild.classList.remove('unselectedProject');
        projChild.classList.add('selectedProject');

        const name  = titleInput.value;
        const items = listLogic.listItems(name);
        const mainDiv = document.getElementById('mainList');
        if (mainDiv) {
            while (mainDiv.firstChild) mainDiv.removeChild(mainDiv.firstChild);
        }
        applyProjectAccent(mainDiv, listLogic.getProjectColor(name));
        const hasReal = items && items.some(function(i){ return i.tit !== ''; });
        if (hasReal) {
            addToDos_restore(items, name);
        } else if (items) {
            addAllToDo_DOM(items, name);
        }
        focusBlankToDoInputIfDesktop();
    }

    function onEdit() {
        selectIfNeeded();
        titleInput.style.pointerEvents = 'auto';
        titleInput.style.cursor = 'text';
        titleInput.focus();
        if (typeof titleInput.select === 'function') titleInput.select();
    }

    function onDelete() {
        deleteProjectFlow(projChild, titleInput.value);
    }

    function onColorSelect(colorKey) {
        const name = titleInput.value;
        if (!name || !listLogic.listProjectsArray().includes(name)) return;
        listLogic.setProjectColor(name, colorKey);
        applyProjectAccent(projChild, colorKey);
        // If this project is selected, propagate to the main list so its
        // duePills pick up the new accent via CSS variable inheritance.
        if (projChild.classList.contains('selectedProject')) {
            applyProjectAccent(document.getElementById('mainList'), colorKey);
        }
    }

    function buildColorContext() {
        const name = titleInput.value;
        if (!name || !listLogic.listProjectsArray().includes(name)) return null;
        return { currentColor: listLogic.getProjectColor(name), onSelect: onColorSelect };
    }

    // desktop right-click
    projChild.addEventListener('contextmenu', function(event) {
        event.preventDefault();
        showProjectContextMenu(event.clientX, event.clientY, onEdit, onDelete, buildColorContext());
    });

    // touch long-press (~500ms)
    let lpTimer  = null;
    let lpStartX = 0;
    let lpStartY = 0;
    let lpFired  = false;

    projChild.addEventListener('touchstart', function(event) {
        if (event.touches.length !== 1) return;
        const t = event.touches[0];
        lpStartX = t.clientX;
        lpStartY = t.clientY;
        lpFired  = false;
        lpTimer  = setTimeout(function() {
            lpFired = true;
            showProjectContextMenu(lpStartX, lpStartY, onEdit, onDelete, buildColorContext());
        }, 500);
    }, { passive: true });

    projChild.addEventListener('touchmove', function(event) {
        if (!lpTimer) return;
        const t = event.touches[0];
        if (Math.abs(t.clientX - lpStartX) > 10 || Math.abs(t.clientY - lpStartY) > 10) {
            clearTimeout(lpTimer);
            lpTimer = null;
        }
    }, { passive: true });

    projChild.addEventListener('touchend', function(event) {
        if (lpTimer) {
            clearTimeout(lpTimer);
            lpTimer = null;
        }
        if (lpFired) {
            // long-press already opened the menu — suppress the tap that would follow
            event.preventDefault();
            lpFired = false;
        }
    });

    projChild.addEventListener('touchcancel', function() {
        if (lpTimer) {
            clearTimeout(lpTimer);
            lpTimer = null;
        }
    });
}


// ********************** GLOBAL DOM FUNCTIONS ********************** //

// Factory function — builds and fully wires a single todo row for the given
// item and project name. Does NOT append to mainList — that's the caller's job.
function buildToDoRow(item, toDoName) {

    // create elements
    const toDoChild       = document.createElement("div");
    const toDoInput       = document.createElement("input");
    const duePill         = document.createElement("button");
    const closeButtonToDo = document.createElement("div");
    const descToggle      = document.createElement("div");
    const spacer          = document.createElement("div");
    const descSibling     = document.createElement("div");
    const descSpacer1     = document.createElement("div");
    const descInput       = document.createElement("input");
    const descSpacer2     = document.createElement("div");

    // set IDs and initial styles
    toDoChild.id           = "toDoChild";
    toDoChild.style.border = "0.5px solid black";

    duePill.id       = "duePill";
    duePill.type     = "button";
    duePill.setAttribute('aria-haspopup', 'dialog');
    duePill.setAttribute('aria-expanded', 'false');

    spacer.id = "spacer";

    toDoInput.type        = "text";
    toDoInput.autocomplete = "off";
    toDoInput.id          = "toDoInput";
    toDoInput.placeholder = "New Item";
    toDoInput.style.fontSize = "14px";
    toDoInput.value       = item.tit || "";
    toDoInput.style.border = "none";

    closeButtonToDo.id = "closeButtonToDo";
    // Hide delete on blank placeholder rows — deleting the only available
    // input slot would leave the user with no way to create new items.
    if (!item.tit) closeButtonToDo.style.display = "none";

    // Blank placeholder rows hide the due-date pill for the same reason the
    // checkbox / toggle / close button hide above: there's no committed item
    // yet, so the "Set date" trigger would be visual noise. Revealed on commit.
    if (!item.tit) {
        duePill.style.display = "none";
    }

    descToggle.id            = "descToggle";
    descToggle.style.display = item.tit ? "flex" : "none";

    descSibling.id  = "descSibling";
    descSpacer1.id  = "descSpacer1";
    descInput.id    = "descInput";
    descSpacer2.id  = "descSpacer2";
    descInput.type  = "text";
    descInput.autocomplete = "off";
    descInput.placeholder = "Type description here...";
    descInput.style.fontSize = "12px";
    descInput.value = "";
    descInput.style.border = "none";

    // Swipe action panes — absolute-positioned fills revealed behind the row
    // on touch horizontal swipe. Kept as the first children so a default
    // stacking context places them below the row content. Styling lives in
    // style.css; visibility is driven by `--swipe-dx` / `--swipe-progress`
    // CSS variables set on the row while a swipe gesture is active.
    const swipePaneLeft  = document.createElement('div');
    swipePaneLeft.className = 'swipeActionPane swipeActionLeft';
    swipePaneLeft.setAttribute('aria-hidden', 'true');
    const swipeGlyphLeft = document.createElement('span');
    swipeGlyphLeft.className = 'swipeActionGlyph';
    swipeGlyphLeft.textContent = '✓';
    swipePaneLeft.appendChild(swipeGlyphLeft);

    const swipePaneRight = document.createElement('div');
    swipePaneRight.className = 'swipeActionPane swipeActionRight';
    swipePaneRight.setAttribute('aria-hidden', 'true');
    const swipeGlyphRight = document.createElement('span');
    swipeGlyphRight.className = 'swipeActionGlyph';
    swipeGlyphRight.textContent = '✕';
    swipePaneRight.appendChild(swipeGlyphRight);

    // assemble DOM tree
    toDoChild.appendChild(swipePaneLeft);
    toDoChild.appendChild(swipePaneRight);
    toDoChild.appendChild(toDoInput);
    toDoChild.appendChild(duePill);
    toDoChild.appendChild(spacer);
    toDoChild.appendChild(descToggle);
    toDoChild.appendChild(closeButtonToDo);

    updateDuePillLabel(duePill, item);
    applyDueUrgency(toDoChild, item);

    duePill.addEventListener('click', function(event) {
        event.stopPropagation();
        if (document.getElementById('dueDatePopover')) {
            hideDueDatePopover();
        } else {
            showDueDatePopover(duePill, item, toDoChild);
        }
    });

    // wire helpers
    wireDescToggle(descToggle, toDoChild, descSibling, descSpacer1, descInput, descSpacer2, item);
    const checkToDo = wireCheckbox(toDoChild, toDoInput, item);
    attachToDoDrag(toDoChild, toDoInput, toDoName, { checkToDo: checkToDo, closeButtonToDo: closeButtonToDo });
    wireToDoRowClick(toDoChild, toDoInput);

    toDoChild.setAttribute("data-value", toDoName);
    // Anchor the DOM row to its data-model item so reorderToDoDOM can match
    // rows to items even when titles collide (e.g. a newly committed row
    // whose title matches an existing completed item).
    toDoChild.__item = item;

    // toDoInput keydown — Enter to commit title
    toDoInput.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        const val = toDoInput.value.trim();
        if (!val) return;

        // First-commit means the project has no blank placeholder above this
        // row — so Enter must spawn one. Check the data model directly rather
        // than savedTitle: the keyup handler mutates this row's item.tit as
        // the user types, so after a blur-and-return, savedTitle is captured
        // non-empty on the second focus and the old savedTitle === "" gate
        // would miss the missing-blank case.
        const siblingItems = (listLogic.listItems(toDoName) || []).filter(function(i) { return i !== item; });
        const hasBlankPlaceholder = siblingItems.some(function(i) { return !i.tit; });
        const isFirstCommit = !hasBlankPlaceholder;

        toDoInput.value = val;
        item.tit = val;
        item.pri = 2;
        // If no due date is set yet, default to today + 7 days so the urgency
        // classes and footer counter have something meaningful to key off.
        if (!parseItemDue(item)) {
            const fallback = defaultDueParts();
            item.due = fallback.m + "-" + fallback.d + "-" + fallback.y;
        }

        listLogic.saveToStorage();
        applyDueUrgency(toDoChild, item);
        updateDuePillLabel(duePill, item);

        // Idempotent — no-op when already visible; safely covers first-commit reveal.
        descToggle.style.display      = "flex";
        checkToDo.style.display       = "";
        closeButtonToDo.style.display = "";
        duePill.style.display         = "";

        toDoInput.blur();
        if (isFirstCommit) {
            appendNewToDoRow(toDoName);
        } else {
            focusBlankToDoInput();
        }
    });

    // toDoInput keyup — save on every keystroke
    toDoInput.addEventListener("keyup", function() {
        const val = toDoInput.value.trim();
        if (val.length > 0) {
            item.tit = val;
            listLogic.saveToStorage();
        }
    });

    // snap-back: restore last title if field is cleared and blurred
    let savedTitle = item.tit || "";
    toDoInput.addEventListener("focus", function() {
        savedTitle = item.tit || toDoInput.value.trim();
    });
    toDoInput.addEventListener("blur", function() {
        if (toDoInput.value.trim().length === 0 && savedTitle.length > 0) {
            toDoInput.value = savedTitle;
            item.tit = savedTitle;
            listLogic.saveToStorage();
        }
    });

    // descInput keydown — Enter to save (empty is a valid cleared state)
    descInput.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        const val = descInput.value.trim();
        descInput.value = val;
        item.desc = val;
        listLogic.saveToStorage();
        descInput.style.border = "none";
        descInput.blur();
    });

    // descInput keyup — save on every keystroke (empty saves too)
    descInput.addEventListener("keyup", function() {
        item.desc = descInput.value.trim();
        listLogic.saveToStorage();
    });

    // descInput blur — persist on click-away so cleared values aren't lost
    descInput.addEventListener("blur", function() {
        item.desc = descInput.value.trim();
        listLogic.saveToStorage();
    });

    // closeButtonToDo click — confirm, then remove this todo item and re-render.
    // Deletes by item reference so duplicate titles or a cleared input value
    // can't misroute the splice onto a different row.
    closeButtonToDo.addEventListener("click", function() {
        const label = (item.tit || "").trim() || "this todo";
        showConfirmModal({
            message: 'Delete "' + label + '"? This cannot be undone.',
            onConfirm: function() {
                listLogic.removeToDoByItem(toDoName, item);

                const mainDiv = document.getElementById('mainList');
                while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }

                addAllToDo_DOM(listLogic.listItems(toDoName), toDoName);
            }
        });
    });

    closeButtonToDo.addEventListener("mouseenter", function() {
        this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
        this.style.border = "0.05px solid black";
    });
    closeButtonToDo.addEventListener("mouseleave", function() {
        this.style.boxShadow = "none";
        this.style.border = "none";
    });

    return toDoChild;
}

// AddToDo Item function — renders all items into mainList.
function addAllToDo_DOM(items, name) {
    if (!items) return;
    const mainListDiv = document.getElementById("mainList");
    items.forEach(function(item) {
        mainListDiv.appendChild(buildToDoRow(item, name));
    });
    updateCompletedSection(mainListDiv);
}


function component() {


    // GLOBAL VARIABLES

    
    console.log("Initialized DOM");

    const base = document.createElement('div');
    const nav = document.createElement('div');
    const main = document.createElement('div');
    const foot = document.createElement('div');

    const main1 = document.createElement('div');
    const main2 = document.createElement('div');

    const sideTitle = document.createElement('div');
    const sideMain = document.createElement('div');

    const sideHead = document.createElement('div');

    const addProj = document.createElement('div');
    const projButton = document.createElement('div');

    const mainTitle = document.createElement('div');
    const mainList = document.createElement('div');

    const mainHead = document.createElement('div');

    const sidebarToggle  = document.createElement('button');
    const sidebarOverlay = document.createElement('div');
    const sidebarResizer = document.createElement('div');

    base.id ='outerContainer';
    nav.id = 'navBar';
    main.id = 'mainSec';
    foot.id = 'footBar';

    main1.id = 'sideBar';
    main2.id = 'mainBar';

    sideTitle.id = 'sideTit';
    sideMain.id = 'sideMa';

    sideHead.id = 'sideHead';

    addProj.id = 'addProj';
    projButton.id = 'projButton';

    mainTitle.id = 'mainTitle';
    mainList.id = 'mainList';

    mainHead.id = 'mainHead';

    sidebarToggle.id        = 'sidebarToggle';
    sidebarToggle.innerHTML = '☰';
    sidebarToggle.setAttribute('aria-label', 'Toggle projects sidebar');

    sidebarOverlay.id = 'sidebarOverlay';

    sidebarResizer.id = 'sidebarResizer';
    sidebarResizer.setAttribute('role', 'separator');
    sidebarResizer.setAttribute('aria-orientation', 'vertical');
    sidebarResizer.setAttribute('aria-label', 'Resize projects sidebar');

    // sidebarToggle is first child of nav so nothing can overlap it
    nav.appendChild(sidebarToggle);

    // ── theme toggle (far right of nav, mirrors the ☰ on the left) ──
    // Pill-switch: track fills with accent and thumb slides right when
    // light theme is active. Click toggles data-theme on <html> — every
    // component recolors for free via the CSS variable ramp in style.css.
    const themeToggle      = document.createElement('button');
    const themeToggleThumb = document.createElement('span');

    themeToggle.id   = 'themeToggle';
    themeToggle.type = 'button';
    themeToggle.setAttribute('role', 'switch');
    themeToggle.setAttribute('aria-label', 'Toggle light theme');
    themeToggleThumb.className = 'themeToggleThumb';
    themeToggle.appendChild(themeToggleThumb);

    function syncThemeToggle() {
        themeToggle.setAttribute('aria-checked', getCurrentTheme() === 'light' ? 'true' : 'false');
    }
    syncThemeToggle();

    themeToggle.addEventListener('click', function () {
        const next = getCurrentTheme() === 'light' ? 'dark' : 'light';
        document.documentElement.classList.add('theme-transitioning');
        applyTheme(next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore quota/private-mode */ }
        syncThemeToggle();
        setTimeout(function () {
            document.documentElement.classList.remove('theme-transitioning');
        }, 220);
    });

    nav.appendChild(themeToggle);

    base.appendChild(nav);
    base.appendChild(main);
    base.appendChild(foot);
    base.appendChild(sidebarOverlay);

    // Footer — version label on the left, open/done counts for the selected
    // project on the right. Counts are recomputed by a MutationObserver that
    // watches #mainList (todo add/remove, .completed toggle) and #sideMa
    // (project selection class change), so they stay in sync without needing
    // hand-wired calls at every mutation site.
    const footVersion = document.createElement('span');
    const footCounts  = document.createElement('div');
    const footOpen    = document.createElement('span');
    const footDone    = document.createElement('span');

    footVersion.id = 'footVersion';
    footVersion.setAttribute('role', 'button');
    footVersion.setAttribute('tabindex', '0');
    footVersion.setAttribute('aria-haspopup', 'dialog');
    footVersion.setAttribute('aria-label', 'Open changelog');

    const footVersionLabel = document.createElement('span');
    footVersionLabel.id = 'footVersionLabel';
    footVersionLabel.textContent = 'task management v1.1';

    const changelogDot = document.createElement('span');
    changelogDot.id = 'changelogDot';
    changelogDot.setAttribute('aria-hidden', 'true');

    footVersion.appendChild(footVersionLabel);
    footVersion.appendChild(changelogDot);

    footVersion.addEventListener('click', function () {
        if (applyPendingUpdate()) return;
        showChangelogModal();
    });
    footVersion.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (applyPendingUpdate()) return;
            showChangelogModal();
        }
    });

    footCounts.id = 'footCounts';
    footOpen.id = 'footOpen';
    footDone.id = 'footDone';
    footOpen.textContent = '0 OPEN';
    footDone.textContent = '0 DONE';

    foot.appendChild(footVersion);
    footCounts.appendChild(footOpen);
    footCounts.appendChild(footDone);
    foot.appendChild(footCounts);

    // Initial unseen-indicator paint — deferred so the dot element is in the DOM.
    setTimeout(updateChangelogDot, 0);

    main.appendChild(main1);
    main.appendChild(sidebarResizer);
    main.appendChild(main2);

    main1.appendChild(sideTitle);
    main1.appendChild(sideMain);

    sideTitle.appendChild(sideHead);

    sideMain.appendChild(addProj);
    addProj.appendChild(projButton);

    main2.appendChild(mainTitle);
    main2.appendChild(mainList);

    mainTitle.appendChild(mainHead);

    mainHead.textContent = 'toDo Items';
    sideHead.textContent = 'Projects';

    // Bulk description control — single toggle in the Todo Items header,
    // right-aligned. Clicks are dispatched to each row's own #descToggle so
    // the per-row switcher state in wireDescToggle stays in sync with the DOM.
    const bulkDescActions = document.createElement('div');
    bulkDescActions.id = 'bulkDescActions';

    const bulkDescToggleBtn = document.createElement('button');
    bulkDescToggleBtn.type = 'button';
    bulkDescToggleBtn.id  = 'bulkDescToggle';
    bulkDescToggleBtn.className = 'bulkDescBtn';
    const bulkDescLabel = document.createElement('span');
    bulkDescLabel.className = 'bulkDescLabel';
    bulkDescLabel.textContent = 'Expand All';
    const bulkDescCaret = document.createElement('span');
    bulkDescCaret.className = 'bulkDescCaret';
    bulkDescCaret.textContent = '▾';
    bulkDescCaret.setAttribute('aria-hidden', 'true');
    bulkDescToggleBtn.appendChild(bulkDescLabel);
    bulkDescToggleBtn.appendChild(bulkDescCaret);

    bulkDescActions.appendChild(bulkDescToggleBtn);
    mainTitle.appendChild(bulkDescActions);

    bulkDescToggleBtn.addEventListener('click', function () {
        const expanded = bulkDescToggleBtn.classList.toggle('expanded');
        if (expanded) {
            expandAllDescriptions();
            bulkDescLabel.textContent = 'Collapse All';
        } else {
            collapseAllDescriptions();
            bulkDescLabel.textContent = 'Expand All';
        }
    });

    // ── sidebar toggle logic ──
    function isMobile() { return window.innerWidth <= 700; }

    function openSidebar() {
        if (isMobile()) {
            main1.classList.add('sidebar-open');
            sidebarOverlay.classList.add('visible');
        } else {
            main.classList.remove('sidebar-collapsed');
        }
    }

    function closeSidebar() {
        if (isMobile()) {
            main1.classList.remove('sidebar-open');
            sidebarOverlay.classList.remove('visible');
        } else {
            main.classList.add('sidebar-collapsed');
        }
    }

    function sidebarIsOpen() {
        return isMobile()
            ? main1.classList.contains('sidebar-open')
            : !main.classList.contains('sidebar-collapsed');
    }

    sidebarToggle.addEventListener('click', function() {
        sidebarIsOpen() ? closeSidebar() : openSidebar();
    });

    sidebarOverlay.addEventListener('click', closeSidebar);

    if (window.matchMedia('(pointer: coarse)').matches) {
        main1.addEventListener('click', function(e) {
            const onProjChild = e.target.closest('#projChild');
            const onInput     = e.target.tagName === 'INPUT';
            if (onProjChild && !onInput) { closeSidebar(); }
        });
    }

    // Clear todo-active on all rows when clicking outside any todo row
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#toDoChild')) {
            document.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
                el.classList.remove('todo-active');
            });
        }
    });

    // ── sidebar resize logic ──
    // Allows the user to drag the vertical divider between the Projects sidebar
    // and the Todo Items panel. Width is persisted via localStorage so it
    // survives reloads. On mobile viewports the sidebar is a drawer, so the
    // handle is hidden via CSS and we bail out here too.
    const SIDEBAR_WIDTH_KEY = 'todoapp_sidebarWidth';
    const SIDEBAR_MIN_W     = 120;

    function sidebarMaxWidth() {
        return Math.floor(window.innerWidth * 0.5);
    }

    function clampSidebarWidth(w) {
        return Math.max(SIDEBAR_MIN_W, Math.min(sidebarMaxWidth(), w));
    }

    function setSidebarWidth(w) {
        document.documentElement.style.setProperty('--sidebar-w', clampSidebarWidth(w) + 'px');
    }

    const savedWidth = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
    if (!isNaN(savedWidth)) setSidebarWidth(savedWidth);

    let resizeStartX = 0;
    let resizeStartW = 0;
    let resizing     = false;

    function readSidebarWidth() {
        const cs = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w');
        const px = parseInt(cs, 10);
        return isNaN(px) ? 200 : px;
    }

    function onResizeMove(e) {
        if (!resizing) return;
        const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
        setSidebarWidth(resizeStartW + (clientX - resizeStartX));
        if (e.cancelable) e.preventDefault();
    }

    function onResizeEnd() {
        if (!resizing) return;
        resizing = false;
        sidebarResizer.classList.remove('resizing');
        document.body.style.userSelect = '';
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(readSidebarWidth()));
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeEnd);
        document.removeEventListener('touchmove', onResizeMove);
        document.removeEventListener('touchend', onResizeEnd);
        document.removeEventListener('touchcancel', onResizeEnd);
    }

    function onResizeStart(e) {
        if (isMobile()) return;
        resizing = true;
        resizeStartX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
        resizeStartW = readSidebarWidth();
        sidebarResizer.classList.add('resizing');
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeEnd);
        document.addEventListener('touchmove', onResizeMove, { passive: false });
        document.addEventListener('touchend', onResizeEnd);
        document.addEventListener('touchcancel', onResizeEnd);
        if (e.cancelable) e.preventDefault();
    }

    sidebarResizer.addEventListener('mousedown', onResizeStart);
    sidebarResizer.addEventListener('touchstart', onResizeStart, { passive: false });

    // re-clamp on viewport resize so the sidebar can't exceed 50% of a newly
    // narrowed window (e.g. user rotates device or resizes browser).
    // Only touch the value if it's actually out of bounds so the responsive
    // default keeps applying when the user hasn't customised the width.
    window.addEventListener('resize', function() {
        if (isMobile()) return;
        const current = readSidebarWidth();
        const max     = sidebarMaxWidth();
        if (current > max) {
            setSidebarWidth(max);
            if (localStorage.getItem(SIDEBAR_WIDTH_KEY) !== null) {
                localStorage.setItem(SIDEBAR_WIDTH_KEY, String(readSidebarWidth()));
            }
        }
    });

    // *** HELPER: clears all toDo DOM elements from mainList (index 1 onward) ***
    function clearToDos_global() {
        const mainDiv = document.getElementById('mainList');
        while (mainDiv.firstChild) {
            mainDiv.removeChild(mainDiv.firstChild);
        }
    }

    // ********************** CLICK LISTENERS ********************** //

    // Click Listener: That adds new project element
    projButton.addEventListener("click", function(){

        console.log("Called projButton");

        // on click should temporarily disable ability to continue clicking
        projButton.style.pointerEvents = "none";
        
        
        // click ability returns dependent on if user successfully adds title to project

        // selects projects list div by ID
        const sideMaDiv = document.getElementById("sideMa");

        const projChild = document.createElement("div");

        const titleInput = document.createElement("input");
        const spacer = document.createElement("div");


        projChild.classList.add("unselectedProject");
        projChild.id = "projChild";

        // First Project Input
        titleInput.type = "text";
        titleInput.autocomplete = "off";
        titleInput.id = "projInput";
        titleInput.placeholder = "New Project";
        titleInput.value = "";
        titleInput.style.border = "none";
        // new rows start unlocked — user needs to type a name immediately
        titleInput.style.pointerEvents = "auto";
        titleInput.style.cursor = "text";


        // Create element with textbox for input
        sideMaDiv.appendChild(projChild);
        projChild.appendChild(titleInput);
        projChild.appendChild(spacer);
   
        // spacer.style.border = "1px solid red";
        spacer.style.width = "12px";

        let currentProperty = "";
        let newProperty = "";
        let firstTime = 0;

        let projectArray = [];
        let projectName = "";

        // ****** INPUT LISTENER ****** 
        // Press enter after Project title input to set element information
        titleInput.addEventListener("keydown", function(event) {

            console.log("Called projButton > titleInput");


            // Get Project names and store into an array using - logicList.js
            let projectsList = listLogic.listProjectsArray();

            let exists = 0;

            let count = 0;

            const mainDiv = document.querySelector('#mainList');

            var childNodes = mainDiv.childNodes;

            // querySelect all the projChild elements, change their classes to unselectedProject
            var projOnChild = document.querySelector('.selectedProject');

            let enteredText = "";
            let trimmedText = "";
            let projectItems = [];



            if (event.key === "Enter") {

                console.log("Clicked Enter");

                enteredText = titleInput.value;
                newProperty = titleInput.value;

                // console.log("You entered: " + enteredText);
                titleInput.blur();


                // CHECKER - name variable set to switch on/off when a project name match occurs - variable
                while(count < projectsList.length){

                    if(projectsList[count] === enteredText){


                        exists = 1;

                        titleInput.textContent = "INVALID";
                        titleInput.style.color = 'red';
                        
                        return;
                    }

                    count++;

                }

            }



            // if title entered has a length > 0 characters & there are no project name matches
            if ((enteredText.length > 0) && (exists === 0)){

                // projChild.style.backgroundColor = "none";
                titleInput.style.color = '';

                trimmedText = enteredText.trim();
                
                titleInput.textContent = trimmedText;
                titleInput.value = trimmedText;
                titleInput.style.fontSize = "14px";
                titleInput.style.pointerEvents = "none";
                titleInput.style.cursor = "default";
                
                

                if(firstTime === 0){

                    // - send title to addProject() in listLogic.js to add property to allProjects array
                    projectItems = listLogic.addProject(trimmedText); 
                    
                    projectArray = projectItems.array;
                    projectName = projectItems.string;


                    firstTime = 1;
                    currentProperty = titleInput.textContent;
                    
                    selectProject(); // changes selection to element
                    clearToDos();

                    // function returns updated project array for DOM
                    projectItems = listLogic.listItems(projectName); 
                    
                }

                else{
                    
                    // - send title to editToDo() in listLogic.js to edit currentProperty to allProjects array 
                    projectItems = listLogic.editProject(currentProperty, newProperty); 

                    projectArray = projectItems.array;
                    projectName = projectItems.string;

                    currentProperty = newProperty;

                    selectProject(); // changes selection to element
                    clearToDos();


                    // function returns updated project array for DOM
                    projectItems = listLogic.listItems(projectName);
                    
                }

                // re-arm drag — the earlier blur() ran before addProject/editProject,
                // so attachProjectDrag's blur sync saw an uncommitted name
                projChild.setAttribute('draggable', 'true');


                // Based on the designated allProjects array, take those items and add them to the DOM in
                // the form of toDo items
                addAllToDo_DOM(projectArray, projectName);
                focusBlankToDoInputIfDesktop();



                listLogic.listProjects();
                

                // On Click - should bring back ability to use add projects button 
                projButton.style.pointerEvents = "auto"; 
                
                // NOTE: projChild > titleInput


                // *** LISTENERS ***

                // when element is clicked change selection to that element
                projChild.addEventListener("click", function(event){

                    console.log("called project selection");

                    const alreadySelected = projChild.classList.contains('selectedProject');

                    if (!alreadySelected) {
                        // deselect whatever is currently selected
                        const current = document.querySelector('.selectedProject');
                        if (current) {
                            const prevInput = current.querySelector('#projInput');
                            if (prevInput) {
                                prevInput.style.pointerEvents = "none";
                                prevInput.style.cursor = "default";
                                prevInput.blur();
                            }
                            current.classList.remove("selectedProject");
                            current.classList.add("unselectedProject");
                        }

                        projChild.classList.remove("unselectedProject");
                        projChild.classList.add("selectedProject");

                        var innerValue = titleInput.value;
                        var arrayValues = listLogic.listItems(innerValue);

                        clearToDos();
                        applyProjectAccent(document.getElementById('mainList'), listLogic.getProjectColor(innerValue));

                        if(arrayValues){
                            addAllToDo_DOM(arrayValues, innerValue);
                        }
                        focusBlankToDoInputIfDesktop();

                        return;
                    }

                    // already selected — unlock the input for editing
                    titleInput.style.pointerEvents = "auto";
                    titleInput.style.cursor = "text";
                    titleInput.focus();

                });


                // *** FUNCTIONS ***

                // changes an elements selection
                function selectProject(){

                    if(projOnChild != null){

                        // console.log("selectedProject exists");

                        projOnChild.classList.remove("selectedProject");
                        projOnChild.classList.add("unselectedProject");

                    }
                    // changing ONLY the selected project
                    if(projChild.classList.contains("unselectedProject")){

                        projChild.classList.remove("unselectedProject");
                        projChild.classList.add("selectedProject");


                        // console.log("Class changed to selectedProject");

                    }

                    // Newly-committed projects default to null color; also
                    // covers editProject renames by re-reading current color.
                    applyProjectAccent(document.getElementById('mainList'), listLogic.getProjectColor(titleInput.value));

                }

                function clearToDos(){
                    clearToDos_global();
                }


            }


            
        }); // Ends "Enter" keydown function


        // ****** Focus/Shadow LISTENERS ******
        titleInput.addEventListener("focus", function() {
            if (titleInput.style.pointerEvents === "none") {
                titleInput.blur();
                return;
            }
            this.style.background = "rgba(0, 0, 0, 0)";
            projChild.style.boxShadow = "none";
            projChild.style.background = "var(--bg-active)";
        });

        projChild.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.background = "var(--bg-hover)";
        });

        projChild.addEventListener("mouseleave", function() {
            this.style.boxShadow = "none";
            this.style.background = "transparent";
        });

        attachProjectContextMenu(projChild, titleInput);
        attachProjectDrag(projChild, titleInput);

    });

    // ********************** SHADOW LISTENERS ********************** //

    // addProj Shadow listener
    projButton.addEventListener("mouseenter", function() {
        this.style.boxShadow = "0 3px 8px rgba(0, 0, 0, 0.2)";
      });

    projButton.addEventListener("mouseleave", function() {
        this.style.boxShadow = "none";
    });









    function updateFooterCounts() {
        const selected = sideMain.querySelector('.selectedProject');
        let open = 0, done = 0;
        if (selected) {
            const input = selected.querySelector('#projInput');
            const name = input ? input.value.trim() : '';
            const items = listLogic.listItems(name) || [];
            items.forEach(function(i) {
                if (!i.tit) return;
                if (i.completed) done++; else open++;
            });
        }
        footOpen.textContent = open + ' OPEN';
        footDone.textContent = done + ' DONE';
    }

    const footObserver = new MutationObserver(updateFooterCounts);
    footObserver.observe(mainList, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
    footObserver.observe(sideMain, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'value']
    });

    setTimeout(updateFooterCounts, 0);

    return base;

};

export { component, restoreFromStorage, notifyUpdateAvailable };

// Bulk open/close every committed row's description panel. Clicks the row's
// own #descToggle so the closure-scoped `switcher` inside wireDescToggle
// stays in sync with the DOM — individual per-row toggles keep working
// after a bulk action. Blank placeholder rows hide their #descToggle
// (display: none), so filtering on that skips them.
function expandAllDescriptions() {
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    mainListDiv.querySelectorAll('#descToggle').forEach(function(toggle) {
        if (toggle.style.display === 'none') return;
        if (!toggle.classList.contains('open')) toggle.click();
    });
}

function collapseAllDescriptions() {
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    mainListDiv.querySelectorAll('#descToggle').forEach(function(toggle) {
        if (toggle.classList.contains('open')) toggle.click();
    });
}


// focusBlankToDoInput — move focus to the existing blank placeholder row's
// input without touching the data model or DOM structure. Used on re-commit
// of an already-committed row, where rebuilding the list would be wasteful.
function focusBlankToDoInput() {
    const mainListDiv = document.getElementById("mainList");
    if (!mainListDiv) return;
    const esInput = mainListDiv.querySelector('#emptyStateInput');
    if (esInput) { esInput.focus(); return; }
    const inputs = mainListDiv.querySelectorAll('#toDoInput');
    for (let i = 0; i < inputs.length; i++) {
        if (inputs[i].value === "") { inputs[i].focus(); return; }
    }
}

// Auto-focus the empty input when a project is entered. On touch/mobile
// skips the focus call so the soft keyboard doesn't open uninvited — users
// on those devices tap the input directly when they're ready to type.
// Deferred to the next microtask so the call lands after any in-progress
// `.blur()` (from the project-row click handler) has fully settled.
function focusBlankToDoInputIfDesktop() {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    // Wait for the current event loop to flush pending blur/focus churn
    // before we place our focus. Rendering a list synchronously can cause
    // race conditions where an immediately-following blur wins.
    setTimeout(focusBlankToDoInput, 0);
}


// appendNewToDoRow — ensure a blank placeholder is pinned at the top of the
// project's list (creating one if the user just committed the previous blank)
// and focus it so the next todo can be typed immediately.
function appendNewToDoRow(toDoName) {

    if (!toDoName || !listLogic.listItems(toDoName)) {
        console.error("appendNewToDoRow: invalid project —", toDoName);
        return;
    }

    // sortCompletedToBottom also re-creates the blank placeholder if one is
    // missing, so this single call both pins the placeholder to index 0 and
    // guarantees its existence before we sync the DOM.
    listLogic.sortCompletedToBottom(toDoName);
    reorderToDoDOM(toDoName);

    focusBlankToDoInput();
}


// restoreFromStorage — call this AFTER component() is appended to document.body
// so that getElementById calls resolve against the live DOM.
function restoreFromStorage() {

    const savedProjects = listLogic.listProjectsArray();

    if (savedProjects.length === 0) {
        updateEmptyState(document.getElementById('mainList'));
        return;
    }

    savedProjects.forEach(function(projectName) {

        const sideMaDiv = document.getElementById("sideMa");
        const mainListDiv = document.getElementById("mainList");
        const projButton  = document.getElementById("projButton");

        const projChild   = document.createElement("div");
        const titleInput  = document.createElement("input");
        const spacer      = document.createElement("div");

        projChild.classList.add("unselectedProject");
        projChild.id = "projChild";
        applyProjectAccent(projChild, listLogic.getProjectColor(projectName));

        titleInput.type        = "text";
        titleInput.autocomplete = "off";
        titleInput.id          = "projInput";
        titleInput.value       = projectName;
        titleInput.style.border = "none";
        titleInput.style.fontSize = "14px";
        titleInput.style.pointerEvents = "none";
        titleInput.style.cursor = "default";

        spacer.style.width  = "12px";

        sideMaDiv.appendChild(projChild);
        projChild.appendChild(titleInput);
        projChild.appendChild(spacer);

        // track current name for rename
        let currentProperty = projectName;
        let renameHandledByEnter = false;

        // rename on Enter — mirrors the editProject flow for new projects
        titleInput.addEventListener("keydown", function(event) {

            if (event.key !== "Enter") return;

            const newName = titleInput.value.trim();
            if (newName.length === 0) return;

            // no-op if name hasn't changed
            if (newName === currentProperty) {
                titleInput.style.color = "";
                titleInput.style.pointerEvents = "none";
                titleInput.style.cursor = "default";
                renameHandledByEnter = true;
                titleInput.blur();
                return;
            }

            // check for duplicate names (excluding self)
            const existing = listLogic.listProjectsArray();
            const duplicate = existing.some(function(n) { return n === newName && n !== currentProperty; });
            if (duplicate) {
                titleInput.style.color = "red";
                return;
            }

            titleInput.style.color = "";
            listLogic.editProject(currentProperty, newName);
            currentProperty = newName;
            titleInput.value = newName;
            titleInput.style.pointerEvents = "none";
            titleInput.style.cursor = "default";
            renameHandledByEnter = true;
            titleInput.blur();

            // if this project is selected, re-render its todos under the new name
            if (projChild.classList.contains('selectedProject')) {
                const mainDiv = document.getElementById('mainList');
                while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }
                const items = listLogic.listItems(newName);
                if (items) {
                    const hasReal = items.some(function(i) { return i.tit !== ""; });
                    if (hasReal) {
                        addToDos_restore(items, newName);
                    } else {
                        addAllToDo_DOM(items, newName);
                    }
                }
                focusBlankToDoInputIfDesktop();
            }

        });

        titleInput.addEventListener("focus", function() {
            if (titleInput.style.pointerEvents === "none") {
                titleInput.blur();
                return;
            }
            titleInput.style.cursor = "text";
        });

        titleInput.addEventListener("blur", function() {
            titleInput.style.cursor = "default";

            // Enter already handled this rename — don't double-process
            if (renameHandledByEnter) {
                renameHandledByEnter = false;
                return;
            }

            // commit rename on blur (e.g. user clicks away without pressing Enter)
            const newName = titleInput.value.trim();
            if (newName.length === 0 || newName === currentProperty) return;

            // check for duplicate names (excluding self)
            const existing = listLogic.listProjectsArray();
            const duplicate = existing.some(function(n) { return n === newName && n !== currentProperty; });
            if (duplicate) {
                // revert to the last committed name
                titleInput.value = currentProperty;
                titleInput.style.color = "";
                return;
            }

            titleInput.style.color = "";
            listLogic.editProject(currentProperty, newName);
            currentProperty = newName;

            // re-render todos if this project is selected
            if (projChild.classList.contains('selectedProject')) {
                const mainDiv = document.getElementById('mainList');
                while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }
                const items = listLogic.listItems(newName);
                if (items) {
                    const hasReal = items.some(function(i) { return i.tit !== ""; });
                    if (hasReal) {
                        addToDos_restore(items, newName);
                    } else {
                        addAllToDo_DOM(items, newName);
                    }
                }
                focusBlankToDoInputIfDesktop();
            }
        });

        // select this project and show its todos
        projChild.addEventListener("click", function(event) {

            const alreadySelected = projChild.classList.contains('selectedProject');

            // first click — select the project
            if (!alreadySelected) {
                const current = document.querySelector('.selectedProject');
                if (current) {
                    // lock the previously selected project's input
                    const prevInput = current.querySelector('#projInput');
                    if (prevInput) {
                        prevInput.style.pointerEvents = "none";
                        prevInput.style.cursor = "default";
                        prevInput.blur();
                    }
                    current.classList.remove("selectedProject");
                    current.classList.add("unselectedProject");
                }
                projChild.classList.remove("unselectedProject");
                projChild.classList.add("selectedProject");

                const name  = titleInput.value;
                const items = listLogic.listItems(name);
                clearToDos_restore();
                applyProjectAccent(document.getElementById('mainList'), listLogic.getProjectColor(name));

                const hasRealItems = items && items.some(function(i){ return i.tit !== ""; });
                if (hasRealItems) {
                    addToDos_restore(items, name);
                } else if (items) {
                    addAllToDo_DOM(items, name);
                }
                focusBlankToDoInputIfDesktop();

                return;
            }

            // already selected — any click unlocks the input for editing
            titleInput.style.pointerEvents = "auto";
            titleInput.style.cursor = "text";
            titleInput.focus();
        });

        projChild.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.background = "var(--bg-hover)";
        });
        projChild.addEventListener("mouseleave", function() {
            this.style.boxShadow = "none";
            this.style.background = "transparent";
        });

        attachProjectContextMenu(projChild, titleInput);
        attachProjectDrag(projChild, titleInput);

    });

    // auto-select last project and render its todos
    const lastProject     = savedProjects[savedProjects.length - 1];
    const allProjChildren = document.querySelectorAll('#projChild');
    const lastChild       = allProjChildren[allProjChildren.length - 1];

    if (lastChild) {
        lastChild.classList.remove("unselectedProject");
        lastChild.classList.add("selectedProject");
    }
    applyProjectAccent(document.getElementById('mainList'), listLogic.getProjectColor(lastProject));

    const lastItems       = listLogic.listItems(lastProject);
    const lastHasReal     = lastItems && lastItems.some(function(i){ return i.tit !== ""; });
    if (lastHasReal) {
        addToDos_restore(lastItems, lastProject);
    } else if (lastItems) {
        addAllToDo_DOM(lastItems, lastProject);
    }
    focusBlankToDoInputIfDesktop();

}

// ── helpers used only by restoreFromStorage ──

function clearToDos_restore() {
    const mainDiv = document.getElementById('mainList');
    while (mainDiv.firstChild) {
        mainDiv.removeChild(mainDiv.firstChild);
    }
}

// Re-render a project's rows from persisted data. Re-sorts first so the
// blank placeholder is pinned to the top of the list, then renders every
// item — including the blank — so the user always has a ready-to-type
// slot at the top of the list.
function addToDos_restore(toDoArray, toDoName) {
    if (!toDoArray || toDoArray.length === 0) return;
    listLogic.sortCompletedToBottom(toDoName);
    const items = listLogic.listItems(toDoName);
    const mainListDiv = document.getElementById("mainList");
    items.forEach(function(item) {
        mainListDiv.appendChild(buildToDoRow(item, toDoName));
    });
    updateCompletedSection(mainListDiv);
}



// ********************************************** BUG BASHING ********************************************** //
/** 
 * FIXED - 1. When multiple projects are added, then all are removed, 
 *            it will not remove the last project to exist other than 'Default'.
 *            The existing properties will be { 'Default', 'Project 1' }
 *  
 * PROBLEM - 2. Having issues with deletion/addition of DOM/Array elements
 *         - issue is still present when deleting first element and adding new element,
 *         - two new DOM elements remain after deletion of each element 
 * 
 * FIXED - 3. When clicking on different projects the addToDo button will disable
 *              unnecessarily, leading to not being able to add new toDo items. 
 * 
 * FIXED - 4. When removing projects, the initial project is also removed BUT,
 *         -    all projects after the initial project remain and are unable to be
 *         -    removed.
 * 
 * PROBLEM - 5. When creating a new project with the same name as another the toDo items
 *              end up being deleted unexpectedly. I think the regen function takes the project name
 *              and regenerating the listed array according to that name.
 *           - use validation to prevent duplicate project names from being created mistakenly
 * 
 * FIXED - 6. Enable drop down to see toDo item descriptions
 * 
 * FIXED - 7. Pressing close button on initial toDo item causes description to populate 
 *              ISSUE: when pressing the closebutton it is also activating the toDoChild click for turning on/off the description leading to an error
 * 
 * FIXED - 8. Continuing toDo elements do not clear the descInput of the description element after removing 
 *            parent toDoChild node.
 * 
 * FIXED - 9. Unable to append descSibling elements to mainList after regenToDo is run, so after swapping
 *              between projects. 
 * 
 * FIXED - 10. When creating three toDo items, the first one with a desc and the third one with a desc, and
 *               clicking the closeButton of the second item, this removes it's 'sibling' being the third
 *               toDoChild. This shouldn't happen.
 * 
 * FIXED - 11. When clicking the closeButton of the 'initial toDo' it is also removing the next element,
 *               prevent this by manipulating your eventpropagation() commands. The if/else on the second one 
 *               is improper.
 * 
 * FIXED - 12. When clicking CloseButtonToDo on project 2 > item 1, descSibling element is not being removed 
 *               for some reason.
 * 
 * FIXED - 13. When clicking on CloseButtonToDo for project 2, not properly removing toDoChild.nextSibling 
 * 
 * 
 * 
 * 
*/
// ******************************************************************************************************** //