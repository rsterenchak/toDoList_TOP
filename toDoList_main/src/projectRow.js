// Project-row interaction wiring: drag-and-drop reordering, right-click /
// long-press context menu, and the delete-with-confirmation flow.
//
// Public surface mirrors the call sites in main.js — projects are constructed
// there and wired through these two helpers:
//   attachProjectDrag(projChild, titleInput)
//   attachProjectContextMenu(projChild, titleInput)
//
// The todo-row helpers used to come in via a `deps` parameter while they
// still lived in main.js. After the carve-out they're proper exports of
// toDoRow.js, so this module imports them directly and the deps bag is gone.

import { listLogic } from './listLogic.js';
import { setupRowDrag } from './dragDrop.js';
import { showProjectContextMenu, applyProjectAccent } from './projectMenu.js';
import { showConfirmModal } from './modals.js';
import { updateEmptyState } from './emptyState.js';
import { isInjectConfigured } from './inject.js';
import {
    addAllToDo_DOM,
    addToDos_restore,
    focusBlankToDoInputIfDesktop,
} from './toDoRow.js';


// Amber ⚡ shown at the start of a project row's title while that specific
// project has a configured inject target. The trailing variation selector
// (U+FE0E) forces text-style (monochrome) rendering so the glyph honors the
// CSS `color` (amber accent) instead of falling back to a platform emoji.
const INJECT_BOLT_CHAR = '⚡︎';

// Attach (once per row) the inject-target thunderbolt indicator. The bolt
// lives in its own leading grid cell, surfaced by toggling `hasInjectBolt` on
// the row — so it never disturbs the title input's ellipsis truncation, and
// its CSS `pointer-events: none` lets taps / long-presses fall straight
// through to the row's own click, drag, and context-menu handlers. It is
// shown only when this row's project has a per-project inject target routed
// (a non-null `target_id`) — not merely when inject is configured globally —
// so rows with no routing stay bare. It renders identically at every
// breakpoint (no mobile/desktop guard). It is hidden whenever the title is
// mid-rename (the input holds focus) and shown again on blur, and it reacts
// live to the `injectConfigChanged` / `injectTargetsChanged` events so
// saving/clearing config or routing a project updates every row without a
// reload.
export function attachProjectInjectIndicator(projChild, titleInput) {
    let bolt = projChild.querySelector('.projInjectBolt');
    if (!bolt) {
        bolt = document.createElement('span');
        bolt.className = 'projInjectBolt';
        bolt.textContent = INJECT_BOLT_CHAR;
        bolt.setAttribute('aria-hidden', 'true');
        // first child → lands in the row's leading grid column
        projChild.insertBefore(bolt, projChild.firstChild);
    }

    function sync() {
        const editing = document.activeElement === titleInput;
        // Per-project gate: only show the bolt when THIS project has a routed
        // inject target, not merely when inject is configured globally. A
        // project with no routing (null target_id) shows no bolt.
        const hasTarget = isInjectConfigured()
            && !!listLogic.getProjectTargetId(titleInput.value);
        projChild.classList.toggle('hasInjectBolt', hasTarget && !editing);
    }

    sync();

    // hide while renaming, restore once the edit ends
    titleInput.addEventListener('focus', sync);
    titleInput.addEventListener('blur', sync);

    // reflect inject config save/clear and per-project routing changes live
    // (no reload)
    document.addEventListener('injectConfigChanged', sync);
    document.addEventListener('injectTargetsChanged', sync);
}


// One-shot inject-bolt sync for a project row that has no live rename <input>
// of its own — notably the desktop project-picker dropdown rows, which carry a
// `.projectPickerName` span rather than a `#projInput` and are rebuilt from
// scratch on every open. It inserts the same leading ⚡ (once) and toggles
// `hasInjectBolt` using the same per-project gate as the sidebar indicator: the
// bolt shows only when inject is configured AND this project has a routed
// `target_id`. No persistent event listeners are attached here — the caller
// rebuilds these rows on each open, so the bolt state is always recomputed
// fresh and there are no leaked closures over discarded rows.
export function syncProjectRowInjectBolt(row, projectName) {
    let bolt = row.querySelector('.projInjectBolt');
    if (!bolt) {
        bolt = document.createElement('span');
        bolt.className = 'projInjectBolt';
        bolt.textContent = INJECT_BOLT_CHAR;
        bolt.setAttribute('aria-hidden', 'true');
        // first child → lands ahead of the project name
        row.insertBefore(bolt, row.firstChild);
    }
    const hasTarget = isInjectConfigured()
        && !!listLogic.getProjectTargetId(projectName);
    row.classList.toggle('hasInjectBolt', hasTarget);
}


function countRealToDos(projectName) {
    const items = listLogic.listItems(projectName);
    if (!items) return 0;
    return items.filter(function(i){ return i.tit !== ''; }).length;
}


export function deleteProjectFlow(projChild, projectName) {

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
export function attachProjectDrag(projChild, titleInput) {

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


// Select a project row (loading its todos into the main list) unless it is
// already the selected project. Lifted to module scope so both the sidebar's
// Edit item and the desktop project-picker's Rename item route their
// selection through one path.
function selectProjectRow(projChild, titleInput) {
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

// Drop a project into the rename / edit-name flow: select it if needed, then
// make its title input editable and focused with its text selected. Shared by
// the sidebar context menu's Edit item and the desktop project-picker
// dropdown's Rename item so both surfaces produce identical results.
export function beginProjectRename(projChild, titleInput) {
    selectProjectRow(projChild, titleInput);
    titleInput.style.pointerEvents = 'auto';
    titleInput.style.cursor = 'text';
    titleInput.focus();
    if (typeof titleInput.select === 'function') titleInput.select();
}


export function attachProjectContextMenu(projChild, titleInput) {

    function onEdit() {
        beginProjectRename(projChild, titleInput);
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