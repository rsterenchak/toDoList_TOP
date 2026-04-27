// Empty-state block + Completed section header for the main todo list.
//
// `updateEmptyState` decides what to show when the active project has no
// open todos: a "no projects yet" prompt with a Create-Project button when
// no projects exist at all, a "no todos yet" hint when the project is
// brand-new, or an "all caught up" message when every todo is completed.
// `updateCompletedSection` injects (or removes) the collapsible
// "Completed (N)" header that partitions completed rows at the bottom of
// the list and keeps it in sync with the persisted open/closed flag.
//
// Both helpers are idempotent — every render path (project switch, drag
// reorder, restoreFromStorage) calls them after touching #mainList, so they
// must rebuild from current DOM rather than diffing prior state.
//
// The completed-section open/closed flag is persisted via prefs.js
// (COMPLETED_SECTION_KEY) — these helpers only read/write through the
// imported getter/setter so the persisted surface stays consolidated there.

import { isCompletedSectionOpen, setCompletedSectionOpen } from './prefs.js';


// Insert a collapsible "Completed (N)" header before the first completed row
// in mainList, or remove it entirely if no completed rows exist. Applies the
// collapsed class to mainList so CSS can hide the completed rows (and any
// open description panels directly beneath them) while the section is closed.
// Safe to call repeatedly — each invocation rebuilds the header from scratch,
// so it can be called after every render or DOM reorder.
export function updateCompletedSection(mainListDiv) {
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
export function updateEmptyState(mainListDiv) {
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
            // On mobile the sidebar is a drawer translated off-screen; open it
            // synchronously so the new projInput is in-layout and iOS Safari
            // honors the .focus() call inside this same user-gesture tick.
            // Deferring the focus behind the slide transition drops the keyboard.
            if (window.innerWidth <= 700) {
                const sideBar = document.getElementById('sideBar');
                const overlay = document.getElementById('sidebarOverlay');
                if (sideBar) sideBar.classList.add('sidebar-open');
                if (overlay) overlay.classList.add('visible');
            } else {
                const mainSec = document.getElementById('mainSec');
                if (mainSec) mainSec.classList.remove('sidebar-collapsed');
            }
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
