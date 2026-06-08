// Workflow-status indicator + status-change popover for committed todo rows.
//
// Each committed row carries a small status badge (`.todoStatusLabel`) that
// both DISPLAYS the task's workflow status and ACTS as the tap target to
// change it — there is no separate icon or button, the label is the control.
// Tapping it opens an anchored popover with the three status choices; the
// selection routes through `listLogic.setToDoStatus`, the same CRUD path every
// other todo mutation uses, so persistence and the Supabase mirror come for
// free.
//
// The label click is handled by a SINGLE delegated listener installed once on
// #mainList (see `wireStatusLabelDelegation`), not by a per-row listener. This
// is deliberate: main.js's webpack-entry evaluation can register module-level
// listeners more than once, so a per-row binding risks double-firing. One
// delegated handler on the list parent sidesteps that cleanly and matches the
// pattern the rest of the row interactions follow.
//
// Row-level treatment (the in-progress left-stripe, the idea muting) is driven
// entirely by a modifier class in style.css — JS never sets a background or
// text color inline, since that override pattern is a known fragile area here.

import { listLogic } from './listLogic.js';
import { reorderToDoDOM } from './toDoRow.js';


// Display metadata per status. The glyph + uppercase label match the Option C
// mockups; `rowClass` is the modifier that style.css keys the stripe /
// background / muting off of.
export const STATUS_META = {
    active:      { label: '○ ACTIVE',      rowClass: 'todo-row--active' },
    in_progress: { label: '⏵ IN PROGRESS', rowClass: 'todo-row--in_progress' },
    idea:        { label: '○ IDEA',        rowClass: 'todo-row--idea' },
};

// Render order for the popover options and the class-clearing sweep.
const STATUS_ORDER = ['active', 'in_progress', 'idea'];
const ALL_ROW_CLASSES = STATUS_ORDER.map(function (s) { return STATUS_META[s].rowClass; });


// Coerce an arbitrary status to a known one. Mirrors listLogic's
// normalizeTodoStatus so the UI never renders an out-of-vocabulary badge — a
// cached todo predating the field (status undefined) reads as 'active'.
export function normalizeStatus(status) {
    return STATUS_META[status] ? status : 'active';
}


// Apply the status modifier class to a row, clearing any prior one first. Pure
// DOM — no persistence. Used on initial build and after an in-place change.
export function applyTodoStatusClass(toDoChild, status) {
    if (!toDoChild) return;
    ALL_ROW_CLASSES.forEach(function (cls) { toDoChild.classList.remove(cls); });
    toDoChild.classList.add(STATUS_META[normalizeStatus(status)].rowClass);
}


// Build the status label element for a committed row. The label both shows the
// status and is the tap target (aria-haspopup="menu"); the delegated handler
// reads the owning row's `__item` to resolve the live status on click, so this
// element only needs to reflect the value at build time.
export function buildStatusLabel(item) {
    const status = normalizeStatus(item && item.status);
    const label = document.createElement('button');
    label.type = 'button';
    label.id = 'todoStatusLabel';
    label.className = 'todoStatusLabel';
    label.setAttribute('data-status', status);
    label.setAttribute('aria-haspopup', 'menu');
    label.setAttribute('aria-expanded', 'false');
    label.setAttribute('aria-label', 'Change task status');
    label.setAttribute('tabindex', '0');
    label.textContent = STATUS_META[status].label;
    return label;
}


// Refresh a row's label text + modifier class in place after a status change,
// avoiding a full re-render that would disturb the row's other in-flight state.
export function refreshTodoStatusUI(toDoChild, item) {
    if (!toDoChild) return;
    const status = normalizeStatus(item && item.status);
    applyTodoStatusClass(toDoChild, status);
    const label = toDoChild.querySelector('.todoStatusLabel');
    if (label) {
        label.setAttribute('data-status', status);
        label.textContent = STATUS_META[status].label;
    }
}


// ── STATUS-CHANGE POPOVER ──
// Anchored menu opened from a label tap. Dismiss on: option selection, outside
// click, right-click elsewhere, Escape, resize, or scroll — mirroring the
// due-date popover's affordances.

export function hideStatusPopover() {
    const existing = document.getElementById('todoStatusPopover');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    document.removeEventListener('click',       onStatusPopoverOutsideClick, true);
    document.removeEventListener('contextmenu', onStatusPopoverOutsideClick, true);
    document.removeEventListener('keydown',     onStatusPopoverKeydown,      true);
    window.removeEventListener('resize', hideStatusPopover);
    window.removeEventListener('scroll', hideStatusPopover, true);
    const openLabel = document.querySelector('.todoStatusLabel[aria-expanded="true"]');
    if (openLabel) openLabel.setAttribute('aria-expanded', 'false');
}

function onStatusPopoverOutsideClick(event) {
    const popover = document.getElementById('todoStatusPopover');
    if (!popover) return;
    if (popover.contains(event.target)) return;
    // The label that opened it owns its own toggle; let that handle re-taps.
    if (event.target.closest && event.target.closest('.todoStatusLabel')) return;
    hideStatusPopover();
}

function onStatusPopoverKeydown(event) {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('todoStatusPopover')) return;
    event.stopPropagation();
    hideStatusPopover();
}

export function showStatusPopover(anchor, item, projectName, toDoChild) {
    hideStatusPopover();
    anchor.setAttribute('aria-expanded', 'true');

    const popover = document.createElement('div');
    popover.id = 'todoStatusPopover';
    popover.className = 'todoStatusPopover';
    popover.setAttribute('role', 'menu');
    popover.setAttribute('aria-label', 'Set task status');
    popover.tabIndex = -1;

    const current = normalizeStatus(item && item.status);
    STATUS_ORDER.forEach(function (status) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'todoStatusOption' + (status === current ? ' selected' : '');
        opt.setAttribute('role', 'menuitemradio');
        opt.setAttribute('aria-checked', status === current ? 'true' : 'false');
        opt.setAttribute('data-status', status);
        opt.textContent = STATUS_META[status].label;
        opt.addEventListener('click', function (event) {
            event.stopPropagation();
            // Single update channel — same path as any other todo mutation.
            listLogic.setToDoStatus(projectName, item, status);
            refreshTodoStatusUI(toDoChild, item);
            // Re-sort + re-render the list so the row moves to its new sorted
            // position when sort = Status (a no-op for sort = None/Due). This
            // also re-applies the status filter — reorderToDoDOM runs the
            // filter pass internally — so the pill counts and visibility stay
            // correct.
            reorderToDoDOM(projectName);
            hideStatusPopover();
        });
        popover.appendChild(opt);
    });

    document.body.appendChild(popover);

    // Anchor below the label, left-aligned; flip above if it would overflow the
    // bottom, and clamp within the viewport. Coordinates are viewport-relative
    // (getBoundingClientRect) so the popover is positioned `position: fixed`.
    const rect      = anchor.getBoundingClientRect();
    const popWidth  = popover.offsetWidth;
    const popHeight = popover.offsetHeight;
    let left = rect.left;
    let top  = rect.bottom + 6;
    if (top + popHeight > window.innerHeight - 4) {
        top = rect.top - popHeight - 6;
    }
    if (left < 4) left = 4;
    if (left + popWidth > window.innerWidth - 4) {
        left = Math.max(4, window.innerWidth - popWidth - 4);
    }
    if (top < 4) top = 4;
    popover.style.left = left + 'px';
    popover.style.top  = top  + 'px';

    document.addEventListener('click',       onStatusPopoverOutsideClick, true);
    document.addEventListener('contextmenu', onStatusPopoverOutsideClick, true);
    document.addEventListener('keydown',     onStatusPopoverKeydown,      true);
    window.addEventListener('resize', hideStatusPopover);
    window.addEventListener('scroll', hideStatusPopover, true);

    try { popover.focus({ preventScroll: true }); } catch (e) { popover.focus(); }
}


// Install the single delegated click handler. Call once on app boot with
// #mainList. Detects taps on a `.todoStatusLabel`, resolves the owning row's
// item + project from the row dataset, and toggles the status popover anchored
// to the tapped label. A guard flag makes repeat installs (e.g. a re-evaluated
// entry bundle) idempotent.
export function wireStatusLabelDelegation(container) {
    if (!container || container.__statusDelegationWired) return;
    container.__statusDelegationWired = true;
    container.addEventListener('click', function (event) {
        const label = event.target.closest && event.target.closest('.todoStatusLabel');
        if (!label || !container.contains(label)) return;
        const row = label.closest('#toDoChild');
        if (!row) return;
        const item = row.__item;
        const projectName = row.getAttribute('data-value');
        if (!item || !projectName) return;
        event.stopPropagation();
        // Toggle off ONLY when the open popover belongs to THIS label; for any
        // other label (including when nothing is open) mount its popover.
        // showStatusPopover's own hideStatusPopover() call tears down a popover
        // anchored to a different label, so a cross-label tap swaps in one click
        // rather than requiring a second.
        if (label.getAttribute('aria-expanded') === 'true') {
            hideStatusPopover();
        } else {
            showStatusPopover(label, item, projectName, row);
        }
    });
}
