// Todo-row construction layer + the row-lifecycle helpers that used to live
// in main.js. After the carve-out completes, this module owns everything
// "todo-row-shaped":
//
//   buildToDoRow(item, toDoName)         — construct + wire a single row
//   addAllToDo_DOM(items, name)          — render a project from scratch
//   addToDos_restore(items, name)        — sort-then-render path used by restoreFromStorage
//   reorderToDoDOM(projectName)          — re-append rows to match the data-model order
//   attachToDoDrag(row, input, project,  — wire mouse + touch drag/swipe on a row
//                  swipeTargets)
//   appendNewToDoRow(toDoName)           — pin a fresh blank placeholder + focus it
//   focusBlankToDoInput()                — focus the existing blank placeholder's input
//   focusBlankToDoInputIfDesktop()       — desktop-only variant; deferred to next tick
//
// Function declarations are hoisted, so the order of definitions inside this
// file is purely for readability — every helper can call the others without
// regard to their position. The ghost-companion singleton is reached through
// `ensureCompanion()` from companion.js (no deps bag involved).

import { listLogic } from './listLogic.js';
import { setupRowDrag, isCoarsePointer, prefersReducedMotion } from './dragDrop.js';
import {
    applyDueUrgency,
    parseItemDue,
    updateDuePillLabel,
    showDueDatePopover,
    hideDueDatePopover,
    updateRecurringGlyph,
} from './dueDate.js';
import { showConfirmModal } from './modals.js';
import { updateCompletedSection } from './emptyState.js';
import { ensureCompanion } from './companion.js';


// Default due-date offset used when a row is committed without a user-chosen
// date. Matches the legacy placeholder behavior (today + 7 days).
const DEFAULT_DUE_OFFSET_DAYS = 7;

function defaultDueParts() {
    const future = new Date();
    future.setDate(future.getDate() + DEFAULT_DUE_OFFSET_DAYS);
    return { m: future.getMonth() + 1, d: future.getDate(), y: future.getFullYear() };
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
        const projectName = toDoChild.dataset.value;

        // Recurring branch: when the user checks a recurring todo, do NOT
        // mark it complete. Advance its due date to the next occurrence
        // and flash the checkbox so the user gets feedback that the
        // action registered. If advanceRecurringTodo returns false (no
        // recurrence, or the next due exceeds endDate), fall through to
        // the standard completion path so the task terminates cleanly.
        if (checkToDo.checked && !wasCompleted && item.tit && item.recurrence && projectName) {
            const advanced = listLogic.advanceRecurringTodo(projectName, item, new Date());
            if (advanced) {
                if (!prefersReducedMotion()) {
                    toDoChild.classList.add('recurring-flash');
                    setTimeout(function() {
                        toDoChild.classList.remove('recurring-flash');
                        checkToDo.checked = false;
                    }, 250);
                } else {
                    checkToDo.checked = false;
                }
                applyDueUrgency(toDoChild, item);
                const pill = toDoChild.querySelector('#duePill');
                if (pill) updateDuePillLabel(pill, item);
                if (isCoarsePointer() && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    try { navigator.vibrate(10); } catch (_) { /* noop */ }
                }
                // advanceRecurringTodo spawned a completed clone in the model;
                // re-render so it lands in the Completed section immediately.
                listLogic.sortCompletedToBottom(projectName);
                reorderToDoDOM(projectName);
                return;
            }
        }

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
        if (projectName) {
            listLogic.sortCompletedToBottom(projectName);
            reorderToDoDOM(projectName);
        } else {
            listLogic.saveToStorage();
        }
    });

    return checkToDo;
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


// Factory function — builds and fully wires a single todo row for the given
// item and project name. Does NOT append to mainList — that's the caller's job.
export function buildToDoRow(item, toDoName) {

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
    // tabindex="-1" lets the global Up/Down arrow handler programmatically
    // focus the row in keyboard-navigation mode (without putting it in the
    // tab order). Enter on a focused row hands focus to the input.
    toDoChild.setAttribute("tabindex", "-1");

    duePill.id       = "duePill";
    duePill.type     = "button";
    duePill.setAttribute('aria-haspopup', 'dialog');
    duePill.setAttribute('aria-expanded', 'false');

    spacer.id = "spacer";

    toDoInput.type        = "text";
    toDoInput.autocomplete = "off";
    toDoInput.id          = "toDoInput";
    toDoInput.placeholder = "Add a task — press Enter";
    toDoInput.style.fontSize = "14px";
    toDoInput.value       = item.tit || "";
    toDoInput.style.border = "none";
    // Mirror the full title onto the native browser tooltip so compact-titles
    // mode can rely on hover to reveal text that the ellipsis would clip.
    toDoInput.title       = item.tit || "";

    // Affordance cue only on the blank placeholder row: a leading purple `+`
    // glyph. Decorative (aria-hidden, pointer-events: none in CSS) so click-
    // anywhere on the row still falls through to wireToDoRowClick → focus the
    // input.
    const addGlyph = !item.tit ? document.createElement("span") : null;
    if (addGlyph) {
        addGlyph.id = "addGlyph";
        addGlyph.setAttribute('aria-hidden', 'true');
        addGlyph.textContent = "+";
    }

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
    if (addGlyph) toDoChild.appendChild(addGlyph);
    toDoChild.appendChild(toDoInput);
    toDoChild.appendChild(duePill);
    toDoChild.appendChild(spacer);
    toDoChild.appendChild(descToggle);
    toDoChild.appendChild(closeButtonToDo);

    updateDuePillLabel(duePill, item);
    applyDueUrgency(toDoChild, item);
    updateRecurringGlyph(toDoChild, item);

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
        // Strip the blank-row affordance cue — once committed, this row is a
        // real todo and the leading `+` glyph would be misleading.
        if (addGlyph && addGlyph.parentElement) addGlyph.remove();

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


// ── ROW LIFECYCLE HELPERS ──
// These were threaded through `toDoRowDeps` and `projectRowDeps` while they
// lived in main.js. With the carve-out complete they import directly from
// here; the deps bags are gone.


// Render every persisted item for `name` into #mainList. Used on the bulk
// add path (project switch from a fresh project, post-delete re-render).
// `items` is the array returned by listLogic.listItems(name).
export function addAllToDo_DOM(items, name) {
    if (!items) return;
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    items.forEach(function(item) {
        mainListDiv.appendChild(buildToDoRow(item, name));
    });
    updateCompletedSection(mainListDiv);
}


// Re-render a project's rows from persisted data. Re-sorts first so the
// blank placeholder is pinned to the top of the list, then renders every
// item — including the blank — so the user always has a ready-to-type
// slot at the top of the list. Used by the restoreFromStorage path on boot
// and by selectProject when a previously visited project becomes active.
export function addToDos_restore(toDoArray, toDoName) {
    if (!toDoArray || toDoArray.length === 0) return;
    listLogic.sortCompletedToBottom(toDoName);
    const items = listLogic.listItems(toDoName);
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    items.forEach(function(item) {
        mainListDiv.appendChild(buildToDoRow(item, toDoName));
    });
    updateCompletedSection(mainListDiv);
}


// Walk the persisted project order and re-append each `#toDoChild` row in
// that sequence. Any open `#descSibling` panel directly after a row is moved
// with it. Uses `appendChild` on existing DOM nodes so event listeners stay
// attached — mirrors the in-place move pattern in `attachToDoDrag`.
// Keyed by the row's attached data-item reference rather than its title so
// that a newly committed title colliding with an existing completed item
// still maps 1:1 to its own DOM row.
export function reorderToDoDOM(projectName) {
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


// Wire drag reordering on a todo row. Keeps `row.draggable` in sync with
// the title state so blank placeholder rows never participate in reorder
// math, and text selection inside the title input isn't hijacked by the
// browser's drag handler during editing.
// `swipeTargets` (optional) wires horizontal swipe-to-complete / swipe-to-delete
// on touch devices. Reuses the existing checkbox change and close-button click
// paths so persistence and delete confirmation stay identical.
export function attachToDoDrag(toDoChild, toDoInput, project, swipeTargets) {

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


// appendNewToDoRow — ensure a blank placeholder is pinned at the top of the
// project's list (creating one if the user just committed the previous blank)
// and focus it so the next todo can be typed immediately.
export function appendNewToDoRow(toDoName) {
    if (!toDoName || !listLogic.listItems(toDoName)) {
        console.error('appendNewToDoRow: invalid project —', toDoName);
        return;
    }

    // sortCompletedToBottom also re-creates the blank placeholder if one is
    // missing, so this single call both pins the placeholder to index 0 and
    // guarantees its existence before we sync the DOM.
    listLogic.sortCompletedToBottom(toDoName);
    reorderToDoDOM(toDoName);

    focusBlankToDoInput();
}


// focusBlankToDoInput — move focus to the existing blank placeholder row's
// input without touching the data model or DOM structure. Used on re-commit
// of an already-committed row, where rebuilding the list would be wasteful.
// Prefers the empty-state input when present (it absorbs the placeholder's
// affordance while the project has no open todos).
export function focusBlankToDoInput() {
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    const esInput = mainListDiv.querySelector('#emptyStateInput');
    if (esInput) { esInput.focus(); return; }
    const inputs = mainListDiv.querySelectorAll('#toDoInput');
    for (let i = 0; i < inputs.length; i++) {
        if (inputs[i].value === '') { inputs[i].focus(); return; }
    }
}


// Auto-focus the empty input when a project is entered. On touch/mobile
// skips the focus call so the soft keyboard doesn't open uninvited — users
// on those devices tap the input directly when they're ready to type.
// Deferred to the next microtask so the call lands after any in-progress
// `.blur()` (from the project-row click handler) has fully settled.
export function focusBlankToDoInputIfDesktop() {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    // Wait for the current event loop to flush pending blur/focus churn
    // before we place our focus. Rendering a list synchronously can cause
    // race conditions where an immediately-following blur wins.
    setTimeout(focusBlankToDoInput, 0);
}