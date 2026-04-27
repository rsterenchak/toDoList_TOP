// Project-row interaction wiring: drag-and-drop reordering, right-click /
// long-press context menu, and the delete-with-confirmation flow.
//
// Public surface mirrors the call sites that lived in main.js — projects are
// constructed there and wired through these two helpers:
//   attachProjectDrag(projChild, titleInput)
//   attachProjectContextMenu(projChild, titleInput, deps)
//
// `deps` carries the todo-row helpers that still live in main.js
// (`addAllToDo_DOM`, `addToDos_restore`, `focusBlankToDoInputIfDesktop`).
// Once the planned `toDoRow.js` carve-out lands, those move out of main.js
// and this module can import them directly instead of receiving them as a
// parameter.

import { listLogic } from './listLogic.js';
import { setupRowDrag } from './dragDrop.js';
import { showProjectContextMenu, applyProjectAccent } from './projectMenu.js';
import { showConfirmModal } from './modals.js';
import { updateEmptyState } from './emptyState.js';


function countRealToDos(projectName) {
    const items = listLogic.listItems(projectName);
    if (!items) return 0;
    return items.filter(function(i){ return i.tit !== ''; }).length;
}


function deleteProjectFlow(projChild, projectName, deps) {

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
                    if (nextItems) deps.addAllToDo_DOM(nextItems, nextName);
                    deps.focusBlankToDoInputIfDesktop();
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


export function attachProjectContextMenu(projChild, titleInput, deps) {

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
            deps.addToDos_restore(items, name);
        } else if (items) {
            deps.addAllToDo_DOM(items, name);
        }
        deps.focusBlankToDoInputIfDesktop();
    }

    function onEdit() {
        selectIfNeeded();
        titleInput.style.pointerEvents = 'auto';
        titleInput.style.cursor = 'text';
        titleInput.focus();
        if (typeof titleInput.select === 'function') titleInput.select();
    }

    function onDelete() {
        deleteProjectFlow(projChild, titleInput.value, deps);
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
