import './style.css';
import { listLogic } from './listLogic.js';
import button from './addProj_button.svg';


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
        item.completed = checkToDo.checked;
        if (checkToDo.checked) {
            toDoChild.classList.add("completed");
        } else {
            toDoChild.classList.remove("completed");
        }
        listLogic.saveToStorage();
    });

    return checkToDo;
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


// ── HELPER: set default due-date placeholders to one week from today ──
// Replaces the legacy hardcoded 1/1/2023 default so that if a user commits a
// todo without touching the date fields, the saved due date is today + 7 days.
function setDueDatePlaceholders(month, day, year) {
    const future = new Date();
    future.setDate(future.getDate() + 7);
    month.placeholder = future.getMonth() + 1;
    day.placeholder   = future.getDate();
    year.placeholder  = future.getFullYear();
}


// ── HELPER: wire Enter-to-save on month/day/year inputs for a given todo item ──
// Call after building each todo row so date changes persist even when the
// user presses Enter while focused on a date field rather than the title.
function wireDateInputs(month, day, year, item, toDoName) {

    function saveDate() {
        const m = month.value || month.placeholder || 1;
        const d = day.value   || day.placeholder   || 1;
        const y = year.value  || year.placeholder  || 2023;
        item["due"] = m + "-" + d + "-" + y;
        listLogic.saveToStorage();
    }

    [month, day, year].forEach(function(input) {
        input.addEventListener("keydown", function(event) {
            if (event.key === "Enter") {
                saveDate();
                input.blur();
            }
        });
        // save on every keystroke so partial values are never lost
        input.addEventListener("keyup", function() {
            saveDate();
        });
        // also save on blur so tabbing away or tapping elsewhere persists the value
        input.addEventListener("blur", function() {
            saveDate();
        });
    });
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
// and unnamed project rows set `draggable="false"` so drop-index math ignores them.
function draggableSiblings(container, itemSelector) {
    return Array.prototype.slice.call(container.querySelectorAll(itemSelector))
        .filter(function(s) { return s.getAttribute('draggable') === 'true'; });
}

// Returns the index a dragged row would land at if dropped at clientY,
// using splice semantics: the dragged row's current slot is first ignored,
// then the new index is the count of remaining rows whose midpoint is above clientY.
function computeDropIndex(draggedEl, container, itemSelector, clientY) {
    const siblings = draggableSiblings(container, itemSelector);
    let idx = 0;
    for (let i = 0; i < siblings.length; i++) {
        const s = siblings[i];
        if (s === draggedEl) continue;
        const rect = s.getBoundingClientRect();
        if (clientY > rect.top + rect.height / 2) idx++;
    }
    return idx;
}

// Position the indicator as an absolutely-positioned overlay inside the
// container. Avoids consuming a grid-row slot when the list uses a fixed
// grid template. The container must be position: relative.
function showDropIndicator(draggedEl, container, itemSelector, clientY) {
    const indicator = getDropIndicator();
    const siblings  = draggableSiblings(container, itemSelector)
        .filter(function(s) { return s !== draggedEl; });

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
function setupRowDrag(row, cfg) {

    // Caller sets/unsets row.draggable based on row state — blank placeholder
    // rows stay non-draggable so they don't participate in reorder index math.
    // We still bind all listeners so the row can be re-enabled later by the caller.

    // ── HTML5 drag (desktop) ──
    row.addEventListener('dragstart', function(event) {
        if (!cfg.isDraggable()) { event.preventDefault(); return; }
        row.classList.add('dragging');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            // Firefox requires setData to initiate a drag.
            try { event.dataTransfer.setData('text/plain', ''); } catch (e) { /* ignore */ }
        }
    });

    row.addEventListener('dragend', function() {
        row.classList.remove('dragging');
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

    // ── Touch drag (mobile) ──
    // Holds for TOUCH_ARM_MS to arm; movement before arming cancels (native scroll stays).
    // Once armed, subsequent moves drive the indicator and preventDefault to stop scroll.
    row.addEventListener('touchstart', function(event) {
        if (event.touches.length !== 1) return;
        if (!cfg.isDraggable()) return;

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
            armTimer: setTimeout(function() { state.armed = true; }, TOUCH_ARM_MS)
        };

        touchDragState = state;
    }, { passive: true });

    row.addEventListener('touchmove', function(event) {
        const state = touchDragState;
        if (!state || state.row !== row) return;

        const t = event.touches[0];

        if (!state.armed) {
            // Pre-arm: movement beyond threshold cancels — user is scrolling, not dragging.
            if (Math.abs(t.clientX - state.startX) > TOUCH_ARM_MOVE_PX ||
                Math.abs(t.clientY - state.startY) > TOUCH_ARM_MOVE_PX) {
                clearTimeout(state.armTimer);
                touchDragState = null;
            }
            return;
        }

        // Armed — suppress native scroll and drive the indicator.
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


// ── PROJECT CONTEXT MENU ──
// Right-click (or long-press on touch) a project row to open a custom menu
// with Edit and Delete options. Replaces the removed `×` delete button.

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

function showProjectContextMenu(x, y, onEdit, onDelete) {

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

    if (!window.confirm(message)) return;

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
            if (nextItems) addAllToDo_DOM(nextItems, nextName);
            updateItemButton_restore(nextName);
        }
    }
}

// Wire drag reordering on a todo row. Keeps `row.draggable` in sync with
// the title state so blank placeholder rows never participate in reorder
// math, and text selection inside the title input isn't hijacked by the
// browser's drag handler during editing.
function attachToDoDrag(toDoChild, toDoInput, project) {

    setupRowDrag(toDoChild, {
        container: document.getElementById('mainList'),
        itemSelector: '#toDoChild',
        isDraggable: function() {
            return !!(toDoInput && toDoInput.value && toDoInput.value.trim().length > 0);
        },
        onReorder: function(fromIdx, toIdx) {
            listLogic.reorderToDo(project, fromIdx, toIdx);
            const mainDiv = document.getElementById('mainList');
            while (mainDiv.firstChild) mainDiv.removeChild(mainDiv.firstChild);
            const remaining = listLogic.listItems(project);
            if (remaining) addAllToDo_DOM(remaining, project);
            updateItemButton_restore(project);
        }
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
        const hasReal = items && items.some(function(i){ return i.tit !== ''; });
        if (hasReal) {
            addToDos_restore(items, name);
        } else if (items) {
            addAllToDo_DOM(items, name);
        }
        updateItemButton_restore(name);
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

    // desktop right-click
    projChild.addEventListener('contextmenu', function(event) {
        event.preventDefault();
        showProjectContextMenu(event.clientX, event.clientY, onEdit, onDelete);
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
            showProjectContextMenu(lpStartX, lpStartY, onEdit, onDelete);
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

// AddToDo Item function
// should just do the job of adding the DOM element
// add to button and event listeners after 
function addAllToDo_DOM(items, name){

    console.log("Called addAllToDo_DOM");

    // project name
    let toDoArray = items; //  items array [] without project name
    let toDoName = name;
    let counter = 0;

    // guard against undefined or null — blank placeholder arrays are still valid
    if(!toDoArray) return;


    // declare elements needed, make similar to the adding projects version
    const mainListDiv = document.getElementById("mainList");
    const toDoChild = document.createElement("div");

    const toDoInput = document.createElement("input");
    const dueInput = document.createElement("div");

    const dateText = document.createElement("div");

    const month = document.createElement("input");
    const dash = document.createElement("div");
    const day = document.createElement("input");
    const dash2 = document.createElement("div");
    const year = document.createElement("input");

    const closeButtonToDo = document.createElement("div");
    const descToggle = document.createElement("div");
    const spacer = document.createElement("div");

    // ** DESCRIPTION ** - creates and reference description div element //
    const descSibling = document.createElement('div');

    const descSpacer1 = document.createElement('div');
    const descInput = document.createElement('input');
    const descSpacer2 = document.createElement('div');

    toDoChild.style.border = "0.5px solid black";
    toDoChild.id = "toDoChild";

    dateText.id = "dateText";
    dateText.textContent = "Due:";

    dueInput.id = "dueInput";
    dueInput.style.fontSize = "10px"; // - NEW
    
    month.id = "month";
        month.autocomplete = "off";

    day.id = "day";
        day.autocomplete = "off";

    year.id = "year";
        year.autocomplete = "off";

    setDueDatePlaceholders(month, day, year);

    dash.id = "dash";
    dash.textContent = "/";

    dash2.id = "dash";
    dash2.textContent = "/";

    spacer.id = "spacer";

    // First Project Input
    toDoInput.type = "text";
    toDoInput.autocomplete = "off";
        
    toDoInput.id = "toDoInput";
    toDoInput.placeholder = "New Item";
    toDoInput.style.fontSize = "14px"; // - NEW
    
    toDoInput.value = "";
    toDoInput.style.border = "none";

    closeButtonToDo.id = "closeButtonToDo";

    descToggle.id = "descToggle";
    // hide toggle until the row has a committed title — blank rows have nothing to describe
    descToggle.style.display = "none";

    descSibling.id ="descSibling";

    descSpacer1.id = "descSpacer1";
    descInput.id = "descInput";
    descSpacer2.id = "descSpacer2";

    descInput.type ="text";
    descInput.autocomplete = "off";
    descInput.placeholder = "Type description here...";
    descInput.style.fontSize = "12px"; // - NEW

    descInput.value = "";
    descInput.style.border = "none";



    if(((toDoArray[0].tit).length) > 0){


        while(counter < toDoArray.length){


            regenToDos(toDoArray[counter], counter); // designates project item, along with array position
                
            counter++;
        }            

    }

    else{

/*             console.log("passed into initialToDo,");
        console.log(toDoArray[counter]); */
        addInitialToDo(toDoArray[counter], counter); // designates project item, along with array position
        
        counter++;
    }




    // Meant for newToDos
    function addInitialToDo(item, index){

        console.log("Called addAllToDo_DOM > addInitialToDo");

        mainListDiv.appendChild(toDoChild);
        toDoChild.appendChild(toDoInput);
        toDoChild.appendChild(dateText);
        toDoChild.appendChild(dueInput);

        dueInput.appendChild(month);
        dueInput.appendChild(dash);
        dueInput.appendChild(day);
        dueInput.appendChild(dash2);
        dueInput.appendChild(year);
        wireDateInputs(month, day, year, item, toDoName);


        toDoChild.appendChild(spacer);
        toDoChild.appendChild(descToggle);
        toDoChild.appendChild(closeButtonToDo);

        wireDescToggle(descToggle, toDoChild, descSibling, descSpacer1, descInput, descSpacer2, item);

        const checkToDo = wireCheckbox(toDoChild, toDoInput, item);

        attachToDoDrag(toDoChild, toDoInput, toDoName);

        toDoChild.setAttribute('data-value', toDoName); // sets the first toDo data-value

        // EDITS TITLE & DATE OF ITEM ELEMENT
        toDoInput.addEventListener("keydown", function(event) {

            toDoChild.setAttribute('data-value', toDoName); // sets the first toDo data-value

            // need to re-reference item being the first item of a project
            item = toDoArray[0];


            let enteredText = "";
            let trimmedText = "";
            let projectItems = [];
            let projects = [];

            if (event.key === "Enter") {
                enteredText = toDoInput.value;

                console.log("Entered initialToDo keydown function: " + enteredText);

                toDoInput.blur();

            }

            // if title entered has a length > 0 characters
            if (enteredText.length > 0){

                // console.log("entered value > 0, initialToDo");
                // console.log(item);

                trimmedText = enteredText.trim();
                
                toDoInput.textContent = trimmedText; // - NEW
                toDoInput.value = trimmedText; // - NEW - ensures text is moved to the middle of div
                toDoInput.style.fontSize = "14px"; // - NEW
                

                let monthValue = month.value || month.placeholder || 1;
                let dayValue = day.value || day.placeholder || 1;
                let yearValue = year.value || year.placeholder || 2023;

                let dateSet = (monthValue + '-' + dayValue + '-' + yearValue);

                item["due"] = dateSet;
                item["pri"] = 2;
                item["tit"] = trimmedText;

                listLogic.saveToStorage();

                projectItems = listLogic.listItems(toDoName);

                updateItemButton_restore(toDoName);

                // row has a title now — reveal the description dropdown toggle and checkbox
                descToggle.style.display = "flex";
                checkToDo.style.display = "";

                // spawn next blank row automatically
                appendNewToDoRow(toDoName);
            }


        }); // Ends "Enter" keydown function

        // descInput keydown — handles Enter key UX (blur + border feedback)
        descInput.addEventListener("keydown", function(event) {

            if (event.key !== "Enter") return;

            const descText = descInput.value;
            console.log("Entered descInput keydown function: " + descText);
            descInput.blur();

            const descTrimmed = descText.trim();

            if (descTrimmed.length > 0){
                descInput.textContent = descTrimmed;
                descInput.value = descTrimmed;
                descInput.style.fontSize = "12px";
                item["desc"] = descTrimmed;
                listLogic.saveToStorage();
                toDoArray = listLogic.listItems(toDoName);
                descInput.style.border = "none";
            } else {
                descInput.style.border = "1px solid red";
            }
        });

        // descInput keyup — saves on every keystroke so value is never lost
        descInput.addEventListener("keyup", function() {
            const val = descInput.value.trim();
            if (val.length > 0) {
                item["desc"] = val;
                listLogic.saveToStorage();
            }
        });

        closeButtonToDo.addEventListener("click", function(){

            let project = toDoName;
            let title   = toDoInput.value;

            // remove descSibling if open
            if(toDoChild.nextSibling != null && toDoChild.nextSibling.id === 'descSibling'){
                toDoChild.parentElement.removeChild(toDoChild.nextSibling);
            }

            // remove by title — immune to index drift caused by appendNewToDoRow
            listLogic.removeToDoByTitle(project, title);

            // wipe ALL DOM rows and re-render cleanly from logic — prevents ghost rows
            const mainDiv = document.getElementById('mainList');
            while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }

            const remaining = listLogic.listItems(project);
            addAllToDo_DOM(remaining, project);
            updateItemButton_restore(project);

        });


        closeButtonToDo.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.border = "0.05px solid black";
        });
        
        closeButtonToDo.addEventListener("mouseleave", function() {
            this.style.boxShadow = "none";
            this.style.border = "none";
        });

    }

    // Meant for oldToDos re-generation, passes in array[i] and starting index of 0
    function regenToDos(item, index){ 

        console.log("Called addAllToDo_DOM > regenToDos");


        // declare elements needed, make similar to the adding projects version
        const mainListDiv = document.getElementById("mainList");
        const toDoChild = document.createElement("div");

        const toDoInput = document.createElement("input");
        const dueInput = document.createElement("div");

        const dateText = document.createElement("div");

        const month = document.createElement("input");
        const dash = document.createElement("div");
        const day = document.createElement("input");
        const dash2 = document.createElement("div");
        const year = document.createElement("input");

        const closeButtonToDo = document.createElement("div");
        const descToggle = document.createElement("div");
        const spacer = document.createElement("div");

        // ** DESCRIPTION ** - creates and reference description div element //
        const descSibling = document.createElement('div');

        const descSpacer1 = document.createElement('div');
        const descInput = document.createElement('input');
        const descSpacer2 = document.createElement('div');


        toDoChild.style.border = "0.5px solid black";
        toDoChild.id = "toDoChild";

        dateText.id = "dateText";
        dateText.textContent = "Due:";

        dueInput.id = "dueInput";
        dueInput.style.fontSize = "10px"; // - NEW

        month.id = "month";
        month.autocomplete = "off";

        day.id = "day";
        day.autocomplete = "off";

        year.id = "year";
        year.autocomplete = "off";

        setDueDatePlaceholders(month, day, year);

        dash.id = "dash";
        dash.textContent = "/";

        dash2.id = "dash";
        dash2.textContent = "/";

        spacer.id = "spacer";

        // First Project Input
        toDoInput.type = "text";
        toDoInput.autocomplete = "off";

        toDoInput.id = "toDoInput";
        toDoInput.placeholder = "New Item";
        toDoInput.style.fontSize = "14px"; // - NEW

        toDoInput.value = "";
        toDoInput.style.border = "none";

        closeButtonToDo.id = "closeButtonToDo";

        descToggle.id = "descToggle";

        descSibling.id ="descSibling";

        descSpacer1.id = "descSpacer1";
        descInput.id = "descInput";
        descSpacer2.id = "descSpacer2";

        descInput.type ="text";
        descInput.autocomplete = "off";
        descInput.placeholder = "Type description here...";
        descInput.style.fontSize = "12px"; // - NEW

        descInput.value = "";
        descInput.style.border = "none";


        mainListDiv.appendChild(toDoChild);
        toDoChild.appendChild(toDoInput);
        toDoChild.appendChild(dateText);
        toDoChild.appendChild(dueInput);

        dueInput.appendChild(month);
        dueInput.appendChild(dash);
        dueInput.appendChild(day);
        dueInput.appendChild(dash2);
        dueInput.appendChild(year);
        wireDateInputs(month, day, year, item, toDoName);


        toDoChild.appendChild(spacer);
        toDoChild.appendChild(descToggle);
        toDoChild.appendChild(closeButtonToDo);

        wireDescToggle(descToggle, toDoChild, descSibling, descSpacer1, descInput, descSpacer2, item);

        wireCheckbox(toDoChild, toDoInput, item);

        attachToDoDrag(toDoChild, toDoInput, toDoName);

        toDoChild.setAttribute('data-value', toDoName);


        toDoInput.textContent = item.tit;
        toDoInput.value = item.tit;


        let dateSet = item["due"] || "";
        
        const dateSplit = dateSet.split('-');
        const monthSet = parseInt(dateSplit[0], 10);
        const daySet   = parseInt(dateSplit[1], 10);
        const yearSet  = parseInt(dateSplit[2], 10);

        if (!isNaN(monthSet) && !isNaN(daySet) && !isNaN(yearSet)) {
            month.value = monthSet;
            day.value   = daySet;
            year.value  = yearSet;
        }


        item["due"] = dateSet;            
        item["tit"] = item.tit;

        closeButtonToDo.dataset.info = index;

        // EDITS TITLE OF ITEM ELEMENT
        toDoInput.addEventListener("keydown", function(event) {

            toDoChild.setAttribute('data-value', toDoName); // sets the first toDo data-value

            // need to re-reference item being the first item of a project
            item = toDoArray[0];

            let enteredText = "";
            let trimmedText = "";

            if (event.key === "Enter") {
                enteredText = toDoInput.value;

                console.log("You entered: " + enteredText);
                toDoInput.blur();

            }

            // if title entered has a length > 0 characters
            if (enteredText.length > 0){

                trimmedText = enteredText.trim();

                toDoInput.textContent = trimmedText; // - NEW
                toDoInput.value = trimmedText; // - NEW - ensures text is moved to the middle of div
                toDoInput.style.fontSize = "14px"; // - NEW

                let monthValue = month.value || month.placeholder || 1;
                let dayValue = day.value || day.placeholder || 1;
                let yearValue = year.value || year.placeholder || 2023;

                let dateSet = (monthValue + '-' + dayValue + '-' + yearValue);

                item["due"] = dateSet;
                item["tit"] = trimmedText;

                listLogic.saveToStorage();

                closeButtonToDo.dataset.info = index;

                // spawn next blank row automatically
                appendNewToDoRow(toDoName);

            }


        }); // Ends "Enter" keydown function

        // save title on every keystroke — no Enter required
        toDoInput.addEventListener("keyup", function() {
            const val = toDoInput.value.trim();
            if (val.length > 0) {
                item["tit"] = val;
                listLogic.saveToStorage();
            }
        });

        // snap-back: capture title on focus, restore it on blur if field is left empty
        let savedTitle = item["tit"] || "";
        toDoInput.addEventListener("focus", function() {
            savedTitle = item["tit"] || toDoInput.value.trim();
        });
        toDoInput.addEventListener("blur", function() {
            if (toDoInput.value.trim().length === 0 && savedTitle.length > 0) {
                toDoInput.value = savedTitle;
                item["tit"] = savedTitle;
                listLogic.saveToStorage();
            }
        });

        // descInput keydown — handles Enter key UX (blur + border feedback)
        descInput.addEventListener("keydown", function(event) {

            if (event.key !== "Enter") return;

            const descText = descInput.value;
            console.log("Entered descInput keydown function: " + descText);
            descInput.blur();

            const descTrimmed = descText.trim();

            if (descTrimmed.length > 0){
                descInput.textContent = descTrimmed;
                descInput.value = descTrimmed;
                descInput.style.fontSize = "12px";
                item["desc"] = descTrimmed;
                listLogic.saveToStorage();
                toDoArray = listLogic.listItems(toDoName);
                descInput.style.border = "none";
            } else {
                descInput.style.border = "1px solid red";
            }
        });

        // descInput keyup — saves on every keystroke so value is never lost
        descInput.addEventListener("keyup", function() {
            const val = descInput.value.trim();
            if (val.length > 0) {
                item["desc"] = val;
                listLogic.saveToStorage();
            }
        });

        closeButtonToDo.addEventListener("click", function(){

            console.log("Entered regenToDo closeButton function");

            let project = toDoName;
            let title   = toDoInput.value;

            // remove descSibling if open
            if((toDoChild.nextSibling != null) && (toDoChild.nextSibling.id === 'descSibling')){
                mainListDiv.removeChild(toDoChild.nextSibling);
            }

            // remove by title — immune to index drift caused by appendNewToDoRow
            listLogic.removeToDoByTitle(project, title);

            // wipe ALL DOM rows and re-render cleanly from logic — prevents ghost rows
            const mainDiv = document.getElementById('mainList');
            while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }

            const remaining = listLogic.listItems(project);
            addAllToDo_DOM(remaining, project);
            updateItemButton_restore(project);

        });


        closeButtonToDo.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.border = "0.05px solid black";
        });
        
        closeButtonToDo.addEventListener("mouseleave", function() {
            this.style.boxShadow = "none";
            this.style.border = "none";
        });            
    
    }

};    

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

    const addItem = document.createElement('div');
    const itemButton = document.createElement('div');

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

    addItem.id = 'addItem';
    itemButton.id = 'itemButton';

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

    base.appendChild(nav);
    base.appendChild(main);
    base.appendChild(foot);
    base.appendChild(sidebarOverlay);

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
    mainTitle.appendChild(addItem);
    addItem.appendChild(itemButton);

    mainHead.textContent = 'toDo Items';
    sideHead.textContent = 'Projects';

    itemButton.style.pointerEvents = "none";

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

    // *** HELPER: single source of truth for itemButton state ***
    function updateItemButton(project) {
        const items = listLogic.listItems(project);
        if(!items || items.length === 0){
            itemButton.style.pointerEvents = "none";
            return;
        }
        const lastItem = items[items.length - 1];
        if(lastItem.tit === ""){
            itemButton.style.pointerEvents = "none";
        } else {
            itemButton.style.pointerEvents = "auto";
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

            // on click should temporarily disable ability to continue clicking
            itemButton.style.pointerEvents = "none";

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


                // Based on the designated allProjects array, take those items and add them to the DOM in 
                // the form of toDo items
                addAllToDo_DOM(projectArray, projectName);
                


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

                        if(arrayValues){
                            addAllToDo_DOM(arrayValues, innerValue);
                        }

                        updateItemButton(innerValue);
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
            projChild.style.background = "#1C1C1C";
        });

        projChild.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.background = "#222222";
        });

        projChild.addEventListener("mouseleave", function() {
            this.style.boxShadow = "none";
            this.style.background = "transparent";
        });

        attachProjectContextMenu(projChild, titleInput);
        attachProjectDrag(projChild, titleInput);

    });

    // Click Listener: That adds new item element
    itemButton.addEventListener("click", function() { 

        console.log("Called itemButton");

        // on click should temporarily disable ability to continue clicking
        itemButton.style.pointerEvents = "none";

        // get currentProject based on the 'selectedElement'
        const selectedEl = document.querySelector('.selectedProject');
        const currentProject = selectedEl
            ? (selectedEl.querySelector('#projInput')
                ? selectedEl.querySelector('#projInput').value
                : selectedEl.dataset.project)
            : "";

        console.log(currentProject);
        // const currentProject = (mainList.childNodes[1]).getAttribute('data-value');

        // declare elements needed, make similar to the adding projects version
        const mainListDiv = document.getElementById("mainList");
        const toDoChild = document.createElement("div");

        const toDoInput = document.createElement("input");
        const dueInput = document.createElement("div");

        const dateText = document.createElement("div");

        const month = document.createElement("input");
        const dash = document.createElement("div");
        const day = document.createElement("input");
        const dash2 = document.createElement("div");
        const year = document.createElement("input");

        const closeButtonToDo = document.createElement("div");
        const descToggle = document.createElement("div");
        const spacer = document.createElement("div");



        // ** DESCRIPTION ** - creates and reference description div element //
        const descSibling = document.createElement('div');

        const descSpacer1 = document.createElement('div');
        const descInput = document.createElement('input');
        const descSpacer2 = document.createElement('div');



        toDoChild.style.border = "0.5px solid black";
        toDoChild.id = "toDoChild";

        dateText.id = "dateText";
        dateText.textContent = "Due:";

        dueInput.id = "dueInput";
        dueInput.style.fontSize = "10px"; // - NEW
        
        month.id = "month";
        month.autocomplete = "off";

        day.id = "day";
        day.autocomplete = "off";

        year.id = "year";
        year.autocomplete = "off";

        setDueDatePlaceholders(month, day, year);

        dash.id = "dash";
        dash.textContent = "/";

        dash2.id = "dash";
        dash2.textContent = "/";

        spacer.id = "spacer";

        // First Project Input
        toDoInput.type = "text";
        toDoInput.autocomplete = "off";

        toDoInput.id = "toDoInput";
        toDoInput.placeholder = "New Item";
        toDoInput.style.fontSize = "14px"; // - NEW
        
        toDoInput.value = "";
        toDoInput.style.border = "none";

        closeButtonToDo.id = "closeButtonToDo";

        descToggle.id = "descToggle";
        // hide toggle until the row has a committed title — blank rows have nothing to describe
        descToggle.style.display = "none";

        descSibling.id ="descSibling";

        descSpacer1.id = "descSpacer1";
        descInput.id = "descInput";
        descSpacer2.id = "descSpacer2";

        descInput.type ="text";
        descInput.autocomplete = "off";
        descInput.placeholder = "Type description here...";
        descInput.style.fontSize = "12px"; // - NEW

        descInput.value = "";
        descInput.style.border = "none";


        mainListDiv.appendChild(toDoChild);
        toDoChild.appendChild(toDoInput);
        toDoChild.appendChild(dateText);
        toDoChild.appendChild(dueInput);

        dueInput.appendChild(month);
        dueInput.appendChild(dash);
        dueInput.appendChild(day);
        dueInput.appendChild(dash2);
        dueInput.appendChild(year);

        toDoChild.appendChild(spacer);
        toDoChild.appendChild(descToggle);
        toDoChild.appendChild(closeButtonToDo);

        // build a hidden checkbox now; wire it once arraySlot (the item) is known below
        const checkToDo = document.createElement("input");
        checkToDo.type = "checkbox";
        checkToDo.id   = "checkToDo";
        checkToDo.style.display = "none";
        toDoChild.insertBefore(checkToDo, toDoInput);

        attachToDoDrag(toDoChild, toDoInput, currentProject);

        toDoChild.setAttribute('data-value', currentProject);



        let counter = 1;

        // Need logic to edit current DOM info
        toDoInput.addEventListener("keydown", function(event) {

            console.log("Called itemButton > toDoInput");
            
            // console.log("Pressed enter for new item - " + counter);
            // console.log("Project name - " + toDoName);

            let enteredText = "";
            let trimmedText = "";

            let arraySlot = "";
            let toDoArray = [];
            let toDoName = "";
            let toDoLength = "";
            let projectItems = [];
            let toDoItems = [];

            

            if (event.key === "Enter") {
                enteredText = toDoInput.value;

                console.log("Entered newToDo keydown function: " + enteredText);

                toDoInput.blur();

            }


            // if title entered has a length > 0 characters
            if (enteredText.length > 0){


                // ********************************* ISSUES STEM FROM HERE ********************************* //
                
                // newToDo elements are being added to the [1] index instead of 

                // let currentProjectLength = listLogic.projectLength(currentProject); 
                // console.log("currentProjectLength: " + currentProjectLength);

                toDoArray = listLogic.listItems(currentProject); // project array
                toDoName = currentProject; // projectName
                toDoLength = listLogic.projectLength(currentProject); // >>> 2


                if(toDoArray[0]["tit"].length > 0){ //  --> this should mean it's assigned a title already

                    toDoItems = listLogic.addToDo(currentProject, enteredText);

                    toDoArray = toDoItems.array; // project array
                    toDoName = toDoItems.string; // projectName
                    toDoLength = toDoItems.lengths; // >>> 2
                }
                
                else{ 

                    toDoArray = listLogic.listItems(currentProject); // project array
                    toDoName = currentProject; // projectName
                    toDoLength = listLogic.projectLength(currentProject); // >>> 2

                    // updateItemButton(currentProject);
                }


                // ***************************************************************************************** //



                arraySlot = toDoArray[toDoLength - 1];

                // now that arraySlot is known, wire date inputs to save on Enter/blur
                wireDateInputs(month, day, year, arraySlot, currentProject);

                trimmedText = enteredText.trim();

                toDoInput.textContent = trimmedText; // - NEW
                toDoInput.value = trimmedText; // - NEW - ensures text is moved to the middle of div
                toDoInput.style.fontSize = "14px"; // - NEW

                let monthValue = month.value || month.placeholder || 1;
                let dayValue = day.value || day.placeholder || 1;
                let yearValue = year.value || year.placeholder || 2023;

                let dateSet = (monthValue + '-' + dayValue + '-' + yearValue);

                arraySlot["due"] = dateSet;
                arraySlot["tit"] = trimmedText;

                listLogic.saveToStorage();

                closeButtonToDo.dataset.info = (toDoLength - 1);

                projectItems = listLogic.listItems(currentProject);
                updateItemButton(currentProject);

                // wire the dropdown toggle now that arraySlot is known, then reveal it
                wireDescToggle(descToggle, toDoChild, descSibling, descSpacer1, descInput, descSpacer2, arraySlot);
                descToggle.style.display = "flex";

                // wire the checkbox now that arraySlot is known
                checkToDo.checked = !!arraySlot.completed;
                if (arraySlot.completed) toDoChild.classList.add("completed");
                checkToDo.addEventListener("change", function() {
                    arraySlot.completed = checkToDo.checked;
                    if (checkToDo.checked) toDoChild.classList.add("completed");
                    else toDoChild.classList.remove("completed");
                    listLogic.saveToStorage();
                });
                checkToDo.style.display = "";

                // wire description edits once — old code re-wired on every open, leaking listeners
                descInput.addEventListener("keydown", function(event) {
                    if (event.key !== "Enter") return;
                    const val = descInput.value.trim();
                    if (val.length > 0) {
                        descInput.value = val;
                        arraySlot["desc"] = val;
                        listLogic.saveToStorage();
                        descInput.style.border = "none";
                    } else {
                        descInput.style.border = "1px solid red";
                    }
                    descInput.blur();
                });

                descInput.addEventListener("keyup", function() {
                    const val = descInput.value.trim();
                    if (val.length > 0) {
                        arraySlot["desc"] = val;
                        listLogic.saveToStorage();
                    }
                });

                // spawn next blank row automatically
                appendNewToDoRow(currentProject);

            }


        }); // Ends "Enter" keydown function

        closeButtonToDo.addEventListener("click", function(){

            console.log("Called itemButton > closeButtonToDo");
                
 
                // store index of toDo item in variable
                let pos = closeButtonToDo.dataset.info;
                let project = currentProject;
                
                let currentLength = listLogic.projectLength(project);// need function to return current length of the project array


                // if currentLength is 1, clear div information
                if(currentLength === 1){

                    if((toDoChild.nextSibling != null) && (toDoChild.nextSibling.id === 'descSibling')){
                        mainListDiv.removeChild(toDoChild.nextSibling);
                    }

                    toDoInput.value = "";
                    listLogic.removeToDo(project, 0, currentLength);
                    updateItemButton(project);
                }

                else{

                    if((toDoChild.nextSibling != null) && (toDoChild.nextSibling.id === 'descSibling')){
                        mainListDiv.removeChild(toDoChild.nextSibling);
                    }

                    // snapshot before removal so indices are correct
                    const closeButtonElements = document.querySelectorAll('#closeButtonToDo');

                    mainListDiv.removeChild(toDoChild);
                    listLogic.removeToDo(project, pos, currentLength);
                    listLogic.listItems(project);

                    let pos_int = parseInt(pos, 10);
                    let adjustedValue = pos_int;
                    while(closeButtonElements[adjustedValue + 1] != null){
                        closeButtonElements[adjustedValue + 1].dataset.info = adjustedValue;
                        adjustedValue++;
                    }

                    updateItemButton(project);
                }


        });

        closeButtonToDo.addEventListener("mouseenter", function() {
                this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
                this.style.border = "0.05px solid black";
        });
            
        closeButtonToDo.addEventListener("mouseleave", function() {
                this.style.boxShadow = "none";
                this.style.border = "none";
        });            


    });




    // ********************** SHADOW LISTENERS ********************** //

    // addProj Shadow listener
    projButton.addEventListener("mouseenter", function() {
        this.style.boxShadow = "0 3px 8px rgba(0, 0, 0, 0.2)";
      });
      
    projButton.addEventListener("mouseleave", function() {
        this.style.boxShadow = "none";
    });

    // addItem Shadow listener
    itemButton.addEventListener("mouseenter", function() {
        this.style.boxShadow = "0 3px 8px rgba(0, 0, 0, 0.2)";
      });
      
    itemButton.addEventListener("mouseleave", function() {
        this.style.boxShadow = "none";
    });









    return base; 

};

export { component, restoreFromStorage };

// appendNewToDoRow — focuses the existing blank row if one exists, or creates a new one. //
function appendNewToDoRow(toDoName) {

    const mainListDiv = document.getElementById("mainList");

    // guard against invalid or missing project name
    if (!toDoName || !listLogic.listItems(toDoName)) {
        console.error("appendNewToDoRow: invalid project —", toDoName);
        return;
    }

    // if a blank input row already exists in the DOM, just focus it — don't add another
    const existingInputs = mainListDiv.querySelectorAll('#toDoInput');
    for (let i = 0; i < existingInputs.length; i++) {
        if (existingInputs[i].value === "") {
            existingInputs[i].focus();
            return;
        }
    }

    // no blank row exists — add one to logic and render it
    const newItems  = listLogic.addToDo(toDoName, "");
    const toDoArray = newItems.array;
    const newIndex  = newItems.lengths - 1;
    const item      = toDoArray[newIndex];

    // build DOM elements
    const toDoChild       = document.createElement("div");
    const toDoInput       = document.createElement("input");
    const dueInput        = document.createElement("div");
    const dateText        = document.createElement("div");
    const month           = document.createElement("input");
    const dash            = document.createElement("div");
    const day             = document.createElement("input");
    const dash2           = document.createElement("div");
    const year            = document.createElement("input");
    const closeButtonToDo = document.createElement("div");
    const descToggle      = document.createElement("div");
    const spacer          = document.createElement("div");
    const descSibling     = document.createElement("div");
    const descSpacer1     = document.createElement("div");
    const descInput       = document.createElement("input");
    const descSpacer2     = document.createElement("div");

    toDoChild.id           = "toDoChild";
    toDoChild.style.border = "0.5px solid black";
    toDoChild.setAttribute("data-value", toDoName);

    dateText.id          = "dateText";
    dateText.textContent = "Due:";
    dueInput.id          = "dueInput";
    dueInput.style.fontSize = "10px";

    month.id = "month";
        month.autocomplete = "off";
    day.id   = "day";
    year.id  = "year";
    setDueDatePlaceholders(month, day, year);
    dash.id  = "dash";  dash.textContent  = "/";
    dash2.id = "dash";  dash2.textContent = "/";
    spacer.id = "spacer";

    toDoInput.type        = "text";
    toDoInput.autocomplete = "off";
    toDoInput.id          = "toDoInput";
    toDoInput.placeholder = "New Item";
    toDoInput.style.fontSize = "14px";
    toDoInput.value       = "";
    toDoInput.style.border = "none";

    closeButtonToDo.id = "closeButtonToDo";
    closeButtonToDo.dataset.info = newIndex;

    descToggle.id = "descToggle";
    // hide toggle until the row has a committed title — blank rows have nothing to describe
    descToggle.style.display = "none";

    descSibling.id = "descSibling";
    descSpacer1.id = "descSpacer1";
    descInput.id   = "descInput";
    descSpacer2.id = "descSpacer2";
    descInput.type = "text";
    descInput.autocomplete = "off";

    descInput.placeholder = "Type description here...";
    descInput.style.fontSize = "12px";
    descInput.value = "";
    descInput.style.border = "none";

    mainListDiv.appendChild(toDoChild);
    toDoChild.appendChild(toDoInput);
    toDoChild.appendChild(dateText);
    toDoChild.appendChild(dueInput);
    dueInput.appendChild(month);
    dueInput.appendChild(dash);
    dueInput.appendChild(day);
    dueInput.appendChild(dash2);
    dueInput.appendChild(year);
    wireDateInputs(month, day, year, item, toDoName);
    toDoChild.appendChild(spacer);
    toDoChild.appendChild(descToggle);
    toDoChild.appendChild(closeButtonToDo);

    wireDescToggle(descToggle, toDoChild, descSibling, descSpacer1, descInput, descSpacer2, item);

    const checkToDo = wireCheckbox(toDoChild, toDoInput, item);

    attachToDoDrag(toDoChild, toDoInput, toDoName);

    // focus the new row so user can type immediately
    toDoInput.focus();

    // submit title on Enter
    toDoInput.addEventListener("keydown", function(event) {

        if (event.key !== "Enter") return;

        const val = toDoInput.value.trim();
        if (val.length === 0) return;

        toDoInput.value = val;
        item["tit"] = val;

        const mv = month.value || month.placeholder || 1;
        const dv = day.value   || day.placeholder   || 1;
        const yv = year.value  || year.placeholder  || 2023;
        item["due"] = mv + "-" + dv + "-" + yv;
        item["pri"] = 2;

        listLogic.saveToStorage();
        updateItemButton_restore(toDoName);

        // row has a title now — reveal the description dropdown toggle and checkbox
        descToggle.style.display = "flex";
        checkToDo.style.display = "";

        toDoInput.blur();

        // chain: spawn the next blank row
        appendNewToDoRow(toDoName);

    });

    // save title on every keystroke — no Enter required
    toDoInput.addEventListener("keyup", function() {
        const val = toDoInput.value.trim();
        if (val.length > 0) {
            item["tit"] = val;
            listLogic.saveToStorage();
        }
    });

    // descInput keydown — handles Enter key UX (blur + border feedback)
    descInput.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        const val = descInput.value.trim();
        if (val.length > 0) {
            descInput.value = val;
            item["desc"] = val;
            listLogic.saveToStorage();
            descInput.style.border = "none";
        } else {
            descInput.style.border = "1px solid red";
        }
        descInput.blur();
    });

    // descInput keyup — saves on every keystroke so value is never lost
    descInput.addEventListener("keyup", function() {
        const val = descInput.value.trim();
        if (val.length > 0) {
            item["desc"] = val;
            listLogic.saveToStorage();
        }
    });

    // delete this row
    closeButtonToDo.addEventListener("click", function() {

        const title = toDoInput.value;

        if (toDoChild.nextSibling && toDoChild.nextSibling.id === "descSibling") {
            mainListDiv.removeChild(toDoChild.nextSibling);
        }

        // remove by title — immune to index drift
        listLogic.removeToDoByTitle(toDoName, title);

        // wipe and re-render cleanly
        const mainDiv = document.getElementById('mainList');
        while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }

        const remaining = listLogic.listItems(toDoName);
        addAllToDo_DOM(remaining, toDoName);
        updateItemButton_restore(toDoName);

    });

    closeButtonToDo.addEventListener("mouseenter", function() {
        this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
        this.style.border = "0.05px solid black";
    });
    closeButtonToDo.addEventListener("mouseleave", function() {
        this.style.boxShadow = "none";
        this.style.border = "none";
    });

}

// restoreFromStorage — call this AFTER component() is appended to document.body
// so that getElementById calls resolve against the live DOM.
function restoreFromStorage() {

    const savedProjects = listLogic.listProjectsArray();

    if (savedProjects.length === 0) return;

    savedProjects.forEach(function(projectName) {

        const sideMaDiv = document.getElementById("sideMa");
        const mainListDiv = document.getElementById("mainList");
        const projButton  = document.getElementById("projButton");

        const projChild   = document.createElement("div");
        const titleInput  = document.createElement("input");
        const spacer      = document.createElement("div");

        projChild.classList.add("unselectedProject");
        projChild.id = "projChild";

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
                updateItemButton_restore(newName);
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
                updateItemButton_restore(newName);
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

                const hasRealItems = items && items.some(function(i){ return i.tit !== ""; });
                if (hasRealItems) {
                    addToDos_restore(items, name);
                } else if (items) {
                    addAllToDo_DOM(items, name);
                }

                updateItemButton_restore(name);
                return;
            }

            // already selected — any click unlocks the input for editing
            titleInput.style.pointerEvents = "auto";
            titleInput.style.cursor = "text";
            titleInput.focus();
        });

        projChild.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.background = "#222222";
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

    const lastItems       = listLogic.listItems(lastProject);
    const lastHasReal     = lastItems && lastItems.some(function(i){ return i.tit !== ""; });
    if (lastHasReal) {
        addToDos_restore(lastItems, lastProject);
    } else if (lastItems) {
        addAllToDo_DOM(lastItems, lastProject);
    }
    updateItemButton_restore(lastProject);

}

// ── helpers used only by restoreFromStorage ──

function clearToDos_restore() {
    const mainDiv = document.getElementById('mainList');
    while (mainDiv.firstChild) {
        mainDiv.removeChild(mainDiv.firstChild);
    }
}

function updateItemButton_restore(project) {
    const itemButton = document.getElementById("itemButton");
    if (!itemButton) return;
    const items = listLogic.listItems(project);
    if (!items || items.length === 0) { itemButton.style.pointerEvents = "none"; return; }
    const last = items[items.length - 1];
    itemButton.style.pointerEvents = (last.tit === "") ? "none" : "auto";
}

// lightweight re-render — mirrors regenToDos inside addAllToDo_DOM
function addToDos_restore(toDoArray, toDoName) {

    if (!toDoArray || toDoArray.length === 0) return;

    const mainListDiv = document.getElementById("mainList");

    toDoArray.forEach(function(item, index) {

        if (!item || item.tit === "") return; // skip blank placeholder items

        const toDoChild       = document.createElement("div");
        const toDoInput       = document.createElement("input");
        const dueInput        = document.createElement("div");
        const dateText        = document.createElement("div");
        const month           = document.createElement("input");
        const dash            = document.createElement("div");
        const day             = document.createElement("input");
        const dash2           = document.createElement("div");
        const year            = document.createElement("input");
        const closeButtonToDo = document.createElement("div");
        const descToggle      = document.createElement("div");
        const spacer          = document.createElement("div");
        const descSibling     = document.createElement("div");
        const descSpacer1     = document.createElement("div");
        const descInput       = document.createElement("input");
        const descSpacer2     = document.createElement("div");

        toDoChild.id           = "toDoChild";
        toDoChild.style.border = "0.5px solid black";
        toDoChild.setAttribute('data-value', toDoName);

        dateText.id          = "dateText";
        dateText.textContent = "Due:";
        dueInput.id          = "dueInput";
        dueInput.style.fontSize = "10px";

        month.id          = "month";
        month.autocomplete = "off";
        day.id            = "day";
        year.id           = "year";
        setDueDatePlaceholders(month, day, year);
        dash.id           = "dash";   dash.textContent  = "/";
        dash2.id          = "dash";   dash2.textContent = "/";
        spacer.id         = "spacer";

        toDoInput.type        = "text";
        toDoInput.autocomplete = "off";
        toDoInput.id          = "toDoInput";
        toDoInput.placeholder = "New Item";
        toDoInput.style.fontSize = "14px";
        toDoInput.value       = item.tit;
        toDoInput.style.border = "none";

        closeButtonToDo.id = "closeButtonToDo";
        closeButtonToDo.dataset.info = index;

        descToggle.id = "descToggle";

        descSibling.id  = "descSibling";
        descSpacer1.id  = "descSpacer1";
        descInput.id    = "descInput";
        descSpacer2.id  = "descSpacer2";
        descInput.type  = "text";
        descInput.autocomplete = "off";
        descInput.placeholder = "Type description here...";
        descInput.style.fontSize = "12px";
        descInput.value = item.desc || "";
        descInput.style.border = "none";

        mainListDiv.appendChild(toDoChild);
        toDoChild.appendChild(toDoInput);
        toDoChild.appendChild(dateText);
        toDoChild.appendChild(dueInput);
        dueInput.appendChild(month);
        dueInput.appendChild(dash);
        dueInput.appendChild(day);
        dueInput.appendChild(dash2);
        dueInput.appendChild(year);
        wireDateInputs(month, day, year, item, toDoName);
        toDoChild.appendChild(spacer);
        toDoChild.appendChild(descToggle);
        toDoChild.appendChild(closeButtonToDo);

        wireDescToggle(descToggle, toDoChild, descSibling, descSpacer1, descInput, descSpacer2, item);

        wireCheckbox(toDoChild, toDoInput, item);

        attachToDoDrag(toDoChild, toDoInput, toDoName);

        // populate date fields
        if (item.due && item.due !== "--" && item.due !== "X-X-XXXX" && item.due !== "") {
            const parts = item.due.split('-');
            const m = parseInt(parts[0], 10);
            const d = parseInt(parts[1], 10);
            const y = parseInt(parts[2], 10);
            if (!isNaN(m)) month.value = m;
            if (!isNaN(d)) day.value   = d;
            if (!isNaN(y)) year.value  = y;
        }

        // descInput keydown — handles Enter key UX (blur + border feedback)
        descInput.addEventListener("keydown", function(event) {
            if (event.key === "Enter") {
                const val = descInput.value.trim();
                if (val.length > 0) {
                    descInput.value = val;
                    item.desc = val;
                    listLogic.saveToStorage();
                    descInput.style.border = "none";
                } else {
                    descInput.style.border = "1px solid red";
                }
                descInput.blur();
            }
        });

        // descInput keyup — saves on every keystroke so value is never lost
        descInput.addEventListener("keyup", function() {
            const val = descInput.value.trim();
            if (val.length > 0) {
                item.desc = val;
                listLogic.saveToStorage();
            }
        });

        // save title edits
        toDoInput.addEventListener("keydown", function(event) {
            if (event.key === "Enter") {
                const val = toDoInput.value.trim();
                if (val.length > 0) {
                    toDoInput.value = val;
                    item.tit = val;
                    listLogic.saveToStorage();

                    // spawn next blank row automatically
                    appendNewToDoRow(toDoName);
                }
                toDoInput.blur();
            }
        });

        // save title on every keystroke — no Enter required
        toDoInput.addEventListener("keyup", function() {
            const val = toDoInput.value.trim();
            if (val.length > 0) {
                item.tit = val;
                listLogic.saveToStorage();
            }
        });

        // snap-back: capture title on focus, restore it on blur if field is left empty
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

        // delete todo item
        closeButtonToDo.addEventListener("click", function() {

            const title = toDoInput.value;

            if (toDoChild.nextSibling && toDoChild.nextSibling.id === 'descSibling') {
                mainListDiv.removeChild(toDoChild.nextSibling);
            }

            // remove by title — immune to index drift
            listLogic.removeToDoByTitle(toDoName, title);

            // wipe and re-render cleanly
            const mainDiv = document.getElementById('mainList');
            while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }

            const remaining = listLogic.listItems(toDoName);
            addAllToDo_DOM(remaining, toDoName);
            updateItemButton_restore(toDoName);

        });

        closeButtonToDo.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.border = "0.05px solid black";
        });
        closeButtonToDo.addEventListener("mouseleave", function() {
            this.style.boxShadow = "none";
            this.style.border = "none";
        });

    });

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