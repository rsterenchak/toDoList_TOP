// Shared drag-and-drop + swipe helpers powering both project-row and todo-row
// reordering. Uses native HTML5 drag on desktop and synthesised touch-drag on
// touch devices. A single drop-indicator line is reused across both contexts.
//
// `setupRowDrag` is the public entry point: it wires HTML5 drag listeners on
// the row plus container, and a parallel touch path that arms after a brief
// hold (vertical reorder) or promotes to swipe-to-delete on horizontal-dominant
// motion when the caller opts in via `cfg.swipe`.
//
// `resetSwipeRow` is also exported because callers reset rows after non-drag
// state changes (e.g. completing a todo via swipe right) and need to clear the
// transform without re-entering the touch handler.

import { hideProjectContextMenu } from './projectMenu.js';


// ── PUBLIC HELPERS ──

export function isCoarsePointer() {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

export function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export function resetSwipeRow(row) {
    row.classList.remove('swiping', 'swipe-releasing', 'swipe-right', 'swipe-left');
    row.style.removeProperty('--swipe-dx');
    row.style.removeProperty('--swipe-width');
    row.style.removeProperty('--swipe-progress');
}


// ── INTERNAL STATE ──

let dropIndicator = null;
let touchDragState = null;   // active touch-drag payload; null when idle
const TOUCH_ARM_MS         = 180;   // hold before a touch-drag arms
const TOUCH_ARM_MOVE_PX    = 8;     // pre-arm move that cancels the arm (treat as scroll)
const AUTOSCROLL_EDGE_PX   = 40;    // distance from edge that triggers auto-scroll
const AUTOSCROLL_STEP_PX   = 8;     // pixels scrolled per tick while in the edge zone
const SWIPE_THRESHOLD_PX   = 80;    // horizontal distance that commits a swipe action
const SWIPE_SNAPBACK_MS    = 260;   // release-below-threshold snap-back duration


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
export function setupRowDrag(row, cfg) {

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
