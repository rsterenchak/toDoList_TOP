import './style.css';
import { listLogic } from './listLogic.js';
import { createCompanion, isCompanionEnabled, setCompanionEnabled, supportsDesktopCompanion } from './companion.js';
import {
    isCompactTitlesOn,
    setCompactTitlesOn,
    readSidebarWidthPref,
    writeSidebarWidthPref,
    hasSidebarWidthPref,
} from './prefs.js';
import {
    applyTheme,
    resolveInitialTheme,
    createThemeToggleButton,
} from './theme.js';
import {
    showConfirmModal,
    showChangelogModal,
    updateChangelogDot,
    notifyUpdateAvailable,
    applyPendingUpdate,
} from './modals.js';
import {
    updateCompletedSection,
    updateEmptyState,
} from './emptyState.js';
import {
    applyProjectAccent,
    showProjectContextMenu,
    hideProjectContextMenu,
} from './projectMenu.js';
import {
    isCoarsePointer,
    prefersReducedMotion,
    setupRowDrag,
} from './dragDrop.js';
import {
    applyDueUrgency,
    parseItemDue,
    updateDuePillLabel,
    showDueDatePopover,
    hideDueDatePopover,
} from './dueDate.js';
import button from './addProj_button.svg';

// Single shared companion instance. Lazily constructed by `ensureCompanion()`
// from inside the first mountable context (component() has built the DOM by
// the time anything triggers a cheer). Stays null when disabled or when the
// viewport doesn't qualify — callers must null-guard before invoking.
let companion = null;
function ensureCompanion() {
    if (companion) return companion;
    if (!isCompanionEnabled()) return null;
    if (!supportsDesktopCompanion()) return null;
    companion = createCompanion(document);
    return companion;
}


// Apply the saved theme during import, before component() — sets data-theme
// on <html> before any rendering happens. See theme.js for the persistence
// key, the matchMedia fallback, and the toggle button factory.
applyTheme(resolveInitialTheme());


// ── DUE DATE HELPERS + PILL ──
// Extracted to dueDate.js. Imported helpers: applyDueUrgency, parseItemDue,
// updateDuePillLabel, showDueDatePopover, hideDueDatePopover.


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
            // Desktop ghost companion — cheer on every item completion. The
            // "big" variant fires when this toggle leaves zero open items in
            // the project, i.e. the project just became fully done.
            const companionInstance = ensureCompanion();
            if (companionInstance) {
                const projectForCount = toDoChild.dataset.value;
                const items = projectForCount ? (listLogic.listItems(projectForCount) || []) : [];
                const remainingOpen = items.filter(function(i) {
                    return i && i.tit && !i.completed;
                }).length;
                companionInstance.cheer(remainingOpen === 0);
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


// Persisted UI preference: compact-titles mode. When on, long todo titles are
// visually truncated with a trailing ellipsis instead of overflowing or
// wrapping. The underlying data is unchanged; CSS keys off
// `data-compact-titles="on"` on <html> to apply text-overflow.
//
// The completed-section open/closed flag, compact-titles flag, sidebar width,
// and changelog last-seen marker are all persisted via prefs.js — keys and
// getters/setters consolidated there. The completed-section flag is consumed
// by emptyState.js; the rest are imported at the top of this file.

function applyCompactTitles(on) {
    document.documentElement.setAttribute('data-compact-titles', on ? 'on' : 'off');
}

// Apply the saved preference before component() builds the DOM so the very
// first paint already matches the saved state — same pattern as applyTheme.
applyCompactTitles(isCompactTitlesOn());


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
// Extracted to dragDrop.js. Imported helpers: setupRowDrag, resetSwipeRow,
// isCoarsePointer, prefersReducedMotion.


// ── DUE DATE POPOVER ──
// Extracted to dueDate.js. Imported helpers: showDueDatePopover,
// hideDueDatePopover.


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
    // Mirror the full title onto the native browser tooltip so compact-titles
    // mode can rely on hover to reveal text that the ellipsis would clip.
    toDoInput.title       = item.tit || "";

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
        toDoInput.title = val;
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
            toDoInput.title = val;
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
        toDoInput.title = item.tit || "";
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

    // ── companion toggle (desktop only) ──
    // Pill-switch hidden on mobile via CSS so the control only appears on
    // viewports where the companion actually runs. Clicking it flips the
    // persisted pref in localStorage and mounts or destroys the companion
    // DOM element accordingly.
    const companionToggle      = document.createElement('button');
    const companionToggleThumb = document.createElement('span');

    companionToggle.id   = 'companionToggle';
    companionToggle.type = 'button';
    companionToggle.setAttribute('role', 'switch');
    companionToggle.setAttribute('aria-label', 'Toggle desktop companion');
    companionToggleThumb.className = 'companionToggleThumb';
    companionToggle.appendChild(companionToggleThumb);

    function syncCompanionToggle() {
        companionToggle.setAttribute('aria-checked', isCompanionEnabled() ? 'true' : 'false');
    }
    syncCompanionToggle();

    companionToggle.addEventListener('click', function () {
        const next = !isCompanionEnabled();
        setCompanionEnabled(next);
        if (next) {
            ensureCompanion();
        } else if (companion) {
            companion.destroy();
            companion = null;
        }
        syncCompanionToggle();
    });

    nav.appendChild(companionToggle);

    // ── theme toggle (far right of nav, sits to the right of the ghost) ──
    // Configured button comes from theme.js — owns the inline SVG glyphs,
    // aria state, persistence, and the cross-fade timing.
    const themeToggle = createThemeToggleButton();
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

    // Compact-titles toggle — pixel-art stacked-lines glyph (three horizontal
    // bars, each shorter than the last). Sits immediately to the LEFT of the
    // Expand All control so the two display-only viewport controls live
    // together. Outline (off) / filled accent (on) is driven by aria-pressed
    // in style.css; persisted state is reapplied in applyCompactTitles().
    const COMPACT_TITLES_SVG =
        '<svg class="compactTitlesIcon" viewBox="0 0 7 7" width="14" height="14" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">' +
        '<rect x="0" y="1" width="7" height="1"/>' +
        '<rect x="0" y="3" width="5" height="1"/>' +
        '<rect x="0" y="5" width="3" height="1"/>' +
        '</svg>';

    const compactTitlesBtn = document.createElement('button');
    compactTitlesBtn.type = 'button';
    compactTitlesBtn.id   = 'compactTitlesToggle';
    compactTitlesBtn.className = 'compactTitlesBtn';
    compactTitlesBtn.title = 'Compact titles';
    compactTitlesBtn.setAttribute('aria-label', 'Compact titles');
    compactTitlesBtn.innerHTML = COMPACT_TITLES_SVG;

    function syncCompactTitlesBtn() {
        compactTitlesBtn.setAttribute('aria-pressed', isCompactTitlesOn() ? 'true' : 'false');
    }
    syncCompactTitlesBtn();

    compactTitlesBtn.addEventListener('click', function () {
        const next = !isCompactTitlesOn();
        setCompactTitlesOn(next);
        applyCompactTitles(next);
        syncCompactTitlesBtn();
    });

    bulkDescActions.appendChild(compactTitlesBtn);

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
    // and the Todo Items panel. Width is persisted via localStorage (see
    // prefs.js for the read/write helpers) so it survives reloads. On mobile
    // viewports the sidebar is a drawer, so the handle is hidden via CSS and
    // we bail out here too.
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

    const savedWidth = readSidebarWidthPref();
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
        writeSidebarWidthPref(readSidebarWidth());
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
            if (hasSidebarWidthPref()) {
                writeSidebarWidthPref(readSidebarWidth());
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

        // Set when Enter triggers the explicit blur on line ~2679 so the
        // blur handler below doesn't re-enter the commit path.
        let committingViaEnter = false;

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
                committingViaEnter = true;

                // Empty rename on an already-committed project: refuse to
                // commit and revert the input to its last good name. Without
                // this, the input keeps the empty value visually while the
                // data still lives under currentProperty — re-selecting the
                // project then reads "" and fails to render any todos.
                if (firstTime !== 0 && enteredText.trim().length === 0) {
                    titleInput.value = currentProperty;
                    titleInput.style.color = "";
                    titleInput.style.pointerEvents = "none";
                    titleInput.style.cursor = "default";
                    titleInput.blur();
                    return;
                }

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

        // Click-away while the input is still in its initial unsubmitted
        // state: a non-empty value commits the project (same effect as
        // pressing Enter); an empty value silently discards the half-built
        // row so the user isn't left with a stranded, unselectable project.
        titleInput.addEventListener("blur", function() {
            if (committingViaEnter) {
                committingViaEnter = false;
                return;
            }
            // Once the row is committed, the only blur concern here is
            // catching a cleared-input strand: revert to the last good
            // name so the input stays in sync with the project's data key.
            if (firstTime !== 0) {
                if (titleInput.value.trim().length === 0) {
                    titleInput.value = currentProperty;
                    titleInput.style.color = "";
                }
                return;
            }

            const trimmed = titleInput.value.trim();
            if (trimmed.length === 0) {
                if (projChild.parentNode) {
                    projChild.parentNode.removeChild(projChild);
                }
                projButton.style.pointerEvents = "auto";
                return;
            }

            // Re-dispatch as Enter so the existing commit path (duplicate
            // check, addProject, selectProject, DOM wiring) runs once and
            // stays in one place.
            titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
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

        // Focus the new input synchronously inside this same user-gesture
        // tick. iOS Safari only summons the soft keyboard when .focus() is
        // called during the tap's gesture; deferring it (setTimeout, await,
        // requestAnimationFrame) drops the keyboard silently.
        titleInput.focus();

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

    // Mount the desktop companion on first boot when the pref allows and
    // the viewport qualifies. Deferred by a tick so document.body exists
    // (index.js appends the component right after component() returns).
    setTimeout(ensureCompanion, 0);

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
            // Empty rename: refuse to commit and snap the input back to the
            // last good name. Letting an empty value linger in titleInput
            // detaches the row from the project's data key, which downstream
            // click/render paths read directly off titleInput.value.
            if (newName.length === 0) {
                titleInput.value = currentProperty;
                titleInput.style.color = "";
                titleInput.style.pointerEvents = "none";
                titleInput.style.cursor = "default";
                renameHandledByEnter = true;
                titleInput.blur();
                return;
            }

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
            // Empty value on blur: revert the input to the last good name so
            // the row stays in sync with its data key. Without this, clicking
            // away from a cleared input strands the project — the title shows
            // nothing, and the next click reads "" as the lookup key.
            if (newName.length === 0) {
                titleInput.value = currentProperty;
                titleInput.style.color = "";
                return;
            }
            if (newName === currentProperty) return;

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
