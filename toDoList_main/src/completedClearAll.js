// "Clear all" control for the COMPLETED section: one danger pill, mounted in
// both the mobile completed sheet's header and the desktop inline
// #completedHeader, that deletes every completed task in the current project
// after a confirm naming the count and project. The mutation goes through
// listLogic.removeCompletedToDos (one save, one batched Supabase delete); the
// list then re-renders through addAllToDo_DOM, whose mainListRendered event
// lets the mobile sheet re-collect its rows and close once none are left.

import { listLogic } from './listLogic.js';
import { showConfirmModal } from './modals.js';
import { showInjectToast } from './inject.js';
import { addAllToDo_DOM } from './toDoRow.js';

function completedTaskPhrase(n) {
    return n + ' completed ' + (n === 1 ? 'task' : 'tasks');
}

// The project a completed row belongs to — every #toDoChild carries its
// project name in data-value, and the COMPLETED section only ever holds the
// selected project's rows.
export function completedSectionProjectName() {
    const row = document.querySelectorAll('#toDoChild.completed[data-value]')[0];
    return row ? row.getAttribute('data-value') : '';
}

export function countCompletedToDos(projectName) {
    const items = listLogic.listItems(projectName) || [];
    return items.filter(function(i) { return i.tit !== '' && !!i.completed; }).length;
}

// Confirm, then delete every completed task in `projectName`. Cancel (button,
// backdrop, Escape) leaves the project untouched.
export function confirmClearCompleted(projectName) {
    const n = countCompletedToDos(projectName);
    if (!projectName || n === 0) return;

    const body = document.createElement('div');
    body.className = 'completedClearAllConfirmBody';
    body.textContent = 'Delete ' + completedTaskPhrase(n) + ' in ' + projectName + '? This can\'t be undone.';

    showConfirmModal({
        message: 'Delete completed tasks?',
        body: body,
        confirmLabel: 'Delete ' + n,
        onConfirm: function() {
            const removed = listLogic.removeCompletedToDos(projectName);
            const mainDiv = document.getElementById('mainList');
            if (mainDiv) {
                while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }
                addAllToDo_DOM(listLogic.listItems(projectName), projectName);
            }
            showInjectToast(completedTaskPhrase(removed) + ' deleted');
        },
    });
}

// The pill's leading 13×13 trash glyph, stroked in the pill's text colour.
function buildTrashIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'completedClearAllIcon');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3');
    svg.appendChild(path);
    return svg;
}

// Build the pill. Its click stops propagation so the inline accordion header
// (or the sheet header's swipe wiring) never sees it as a toggle.
export function buildClearCompletedPill() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'completedClearAllBtn';
    btn.setAttribute('aria-label', 'Delete all completed tasks');
    btn.appendChild(buildTrashIcon());
    const label = document.createElement('span');
    label.className = 'completedClearAllLabel';
    label.textContent = 'Clear all';
    btn.appendChild(label);
    btn.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        confirmClearCompleted(completedSectionProjectName());
    });
    btn.addEventListener('keydown', function(event) {
        // Keep Enter / Space on the pill from bubbling into the header's
        // keyboard toggle; the button's own default click still fires.
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    return btn;
}
