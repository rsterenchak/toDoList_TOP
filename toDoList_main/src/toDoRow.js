// Todo-row construction layer. Builds and fully wires a single todo row for
// the given item and project name.
//
// Public surface:
//   buildToDoRow(item, toDoName, deps)
//
// `deps` carries the lifecycle helpers that still live in main.js:
//   ensureCompanion      — singleton accessor for the desktop ghost
//   reorderToDoDOM       — re-render a project's rows after sort changes
//   attachToDoDrag       — wire mouse + touch reorder on the row
//   addAllToDo_DOM       — re-render the project after a delete
//   appendNewToDoRow     — pin a fresh blank placeholder to the top
//   focusBlankToDoInput  — focus the existing blank placeholder's input
//
// The follow-up PR moves those helpers into this module and the deps bag
// goes away — mirrors the staged precedent set by projectRow.js.

import { listLogic } from './listLogic.js';
import { isCoarsePointer, prefersReducedMotion } from './dragDrop.js';
import {
    applyDueUrgency,
    parseItemDue,
    updateDuePillLabel,
    showDueDatePopover,
    hideDueDatePopover,
} from './dueDate.js';
import { showConfirmModal } from './modals.js';


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
function wireCheckbox(toDoChild, toDoInput, item, deps) {

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
            const companionInstance = deps.ensureCompanion();
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
            deps.reorderToDoDOM(projectName);
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
export function buildToDoRow(item, toDoName, deps) {

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
    const checkToDo = wireCheckbox(toDoChild, toDoInput, item, deps);
    deps.attachToDoDrag(toDoChild, toDoInput, toDoName, { checkToDo: checkToDo, closeButtonToDo: closeButtonToDo });
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
            deps.appendNewToDoRow(toDoName);
        } else {
            deps.focusBlankToDoInput();
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

                deps.addAllToDo_DOM(listLogic.listItems(toDoName), toDoName);
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
