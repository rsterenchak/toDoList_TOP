// ── Mobile bottom sheets (completed-section + TODO.md viewer) ──
// Two slide-up bottom sheets that replace inline surfaces that fail to
// render reliably on touch at the ≤1023px breakpoint. They share the
// touch swipe-down dismiss wiring (attachCompletedSheetSwipeDown), so
// they live together in one module. Everything reaches DOM via
// getElementById/createElement at call time (no closure capture), and
// nothing here calls back into main.js — main.js imports the openers and
// the isAnyMobileSheetOpen accessor, and registers the viewer card tap
// handler that calls openViewerMobileSheet.

import { updateCompletedSection } from './emptyState.js';
import { placeViewerCard } from './todoMdViewer.js';
import { isMobileViewport } from './viewport.js';

// ── Mobile completed-section bottom sheet ──
// The inline accordion that reveals the COMPLETED list (and the TODO.md
// viewer card with its Rendered / Raw tabs nested beneath it) fails to
// render reliably on touch at the ≤1023px breakpoint. Tapping the
// COMPLETED header on mobile opens this slide-up sheet instead, which
// hosts the existing completed rows + viewer card via DOM move so all
// their event listeners stay live. Three-affordance close per CLAUDE.md
// — X button, backdrop tap, Escape — plus a touch swipe-down on the
// drag handle as the fourth touch-native affordance.

let completedMobileSheetState = null;

function collectCompletedNodesForSheet(mainListDiv, sheetBody) {
    const moved = [];
    if (!mainListDiv || !sheetBody) return moved;
    const completedRows = Array.from(mainListDiv.querySelectorAll('#toDoChild.completed'));
    completedRows.forEach(function(row) {
        moved.push({ node: row, kind: 'row' });
        // Pull adjacent description / stats panels along with the row so
        // an open description on a completed item stays attached when the
        // user opens the sheet.
        let next = row.nextSibling;
        sheetBody.appendChild(row);
        while (next && (next.id === 'descSibling' || next.id === 'statsSibling')) {
            const after = next.nextSibling;
            moved.push({ node: next, kind: 'aux' });
            sheetBody.appendChild(next);
            next = after;
        }
    });
    const viewerCard = mainListDiv.querySelector('#todoMdViewerCard');
    if (viewerCard) {
        moved.push({ node: viewerCard, kind: 'viewer' });
        sheetBody.appendChild(viewerCard);
    }
    return moved;
}

function refreshCompletedMobileSheetContent() {
    if (!completedMobileSheetState || !completedMobileSheetState.open) return;
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    // Discard whatever currently lives in the sheet body — re-renders may
    // have built fresh rows in #mainList that supersede the moved ones,
    // so we drop the orphans and re-collect from the canonical source.
    completedMobileSheetState.body.innerHTML = '';
    const moved = collectCompletedNodesForSheet(mainListDiv, completedMobileSheetState.body);
    completedMobileSheetState.moved = moved;
    const rowCount = moved.filter(function(e) { return e.kind === 'row'; }).length;
    if (completedMobileSheetState.titleEl) {
        completedMobileSheetState.titleEl.textContent = 'Completed (' + rowCount + ')';
    }
    if (rowCount === 0 && !moved.some(function(e) { return e.kind === 'viewer'; })) {
        closeCompletedMobileSheet();
    }
}

function attachCompletedSheetSwipeDown(targetEl, sheetEl, onCommit) {
    if (!targetEl || !sheetEl) return;
    const COMMIT_PX = 60;
    const VELOCITY_PX_PER_MS = 0.5;
    let startY = 0;
    let startT = 0;
    let active = false;
    let resolved = false;

    function reset() {
        sheetEl.style.transition = '';
        sheetEl.style.transform = '';
    }

    targetEl.addEventListener('touchstart', function(e) {
        if (!e.touches || e.touches.length !== 1) return;
        active = true;
        resolved = false;
        startY = e.touches[0].clientY;
        startT = Date.now();
        sheetEl.style.transition = 'none';
    }, { passive: true });

    targetEl.addEventListener('touchmove', function(e) {
        if (!active || resolved) return;
        const dy = e.touches[0].clientY - startY;
        if (dy < 0) {
            sheetEl.style.transform = '';
            return;
        }
        sheetEl.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });

    targetEl.addEventListener('touchend', function(e) {
        if (!active || resolved) return;
        resolved = true;
        active = false;
        const endY = (e.changedTouches && e.changedTouches[0])
            ? e.changedTouches[0].clientY
            : startY;
        const dy = endY - startY;
        const dt = Math.max(1, Date.now() - startT);
        const velocity = dy / dt;
        if (dy >= COMMIT_PX || velocity >= VELOCITY_PX_PER_MS) {
            reset();
            if (typeof onCommit === 'function') onCommit();
        } else {
            reset();
        }
    });

    targetEl.addEventListener('touchcancel', function() {
        if (!active) return;
        active = false;
        resolved = true;
        reset();
    });
}

export function openCompletedMobileSheet() {
    if (completedMobileSheetState && completedMobileSheetState.open) return;
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;

    const prior = document.getElementById('completedMobileSheetBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'completedMobileSheetBackdrop';

    const sheet = document.createElement('div');
    sheet.id = 'completedMobileSheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'completedMobileSheetTitle');

    const handle = document.createElement('span');
    handle.className = 'completedMobileSheetHandle';
    handle.setAttribute('aria-hidden', 'true');

    const headerEl = document.createElement('div');
    headerEl.className = 'completedMobileSheetHeader';

    const title = document.createElement('div');
    title.id = 'completedMobileSheetTitle';
    title.className = 'completedMobileSheetTitle';
    const initialCount = mainListDiv.querySelectorAll('#toDoChild.completed').length;
    title.textContent = 'Completed (' + initialCount + ')';

    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'completedMobileSheetClose';
    closeX.setAttribute('aria-label', 'Close completed items');
    closeX.textContent = '×';

    headerEl.appendChild(title);
    headerEl.appendChild(closeX);

    const body = document.createElement('div');
    body.className = 'completedMobileSheetBody';

    sheet.appendChild(handle);
    sheet.appendChild(headerEl);
    sheet.appendChild(body);
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);

    const moved = collectCompletedNodesForSheet(mainListDiv, body);
    const previouslyFocused = document.activeElement;

    completedMobileSheetState = {
        open: true,
        backdrop: backdrop,
        sheet: sheet,
        body: body,
        titleEl: title,
        moved: moved,
        previouslyFocused: previouslyFocused,
        onKeydown: null,
    };

    function onKeydown(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        closeCompletedMobileSheet();
    }
    completedMobileSheetState.onKeydown = onKeydown;

    closeX.addEventListener('click', closeCompletedMobileSheet);
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) closeCompletedMobileSheet();
    });
    document.addEventListener('keydown', onKeydown, true);

    attachCompletedSheetSwipeDown(handle, sheet, closeCompletedMobileSheet);
    attachCompletedSheetSwipeDown(headerEl, sheet, closeCompletedMobileSheet);

    requestAnimationFrame(function() {
        backdrop.classList.add('is-open');
    });

    try { closeX.focus(); } catch (_) { /* defensive */ }
}

function closeCompletedMobileSheet() {
    const state = completedMobileSheetState;
    if (!state || !state.open) return;
    state.open = false;
    if (state.onKeydown) {
        document.removeEventListener('keydown', state.onKeydown, true);
    }
    const mainListDiv = document.getElementById('mainList');
    // Return the moved nodes to #mainList so the inline rendering owns
    // them again. Their original sibling positions were anchors at the
    // moment of open and may have been pruned by later renders, so just
    // append and let updateCompletedSection (and any pending reorder)
    // normalize ordering on the next render pass.
    if (mainListDiv) {
        state.moved.forEach(function(entry) {
            if (entry.node && !mainListDiv.contains(entry.node)) {
                mainListDiv.appendChild(entry.node);
            }
        });
    }
    if (state.backdrop && state.backdrop.parentNode) {
        state.backdrop.parentNode.removeChild(state.backdrop);
    }
    if (mainListDiv) {
        try { updateCompletedSection(mainListDiv); } catch (_) { /* defensive */ }
    }
    completedMobileSheetState = null;
    const headerEl = document.getElementById('completedHeader');
    if (headerEl && typeof headerEl.focus === 'function') {
        try { headerEl.focus(); } catch (_) { /* defensive */ }
    } else if (state.previouslyFocused &&
               typeof state.previouslyFocused.focus === 'function' &&
               document.contains(state.previouslyFocused)) {
        try { state.previouslyFocused.focus(); } catch (_) { /* defensive */ }
    }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    // Re-renders that rebuild rows in #mainList (e.g. a swipe-complete
    // that calls reorderToDoDOM while the sheet is open) can leave the
    // sheet's moved rows orphaned. Re-collect on every render pass so
    // the sheet keeps showing the live completed list.
    document.addEventListener('mainListRendered', function() {
        if (completedMobileSheetState && completedMobileSheetState.open) {
            refreshCompletedMobileSheetContent();
        }
    });
    // Resize past the mobile breakpoint — the inline accordion path is
    // usable again, so dismiss the sheet so the user sees a consistent
    // affordance for the active viewport.
    window.addEventListener('resize', function() {
        if (completedMobileSheetState && completedMobileSheetState.open
                && !isMobileViewport()) {
            closeCompletedMobileSheet();
        }
    });
}


// ── Mobile TODO.md viewer bottom sheet ──
// Mirrors the COMPLETED-section sheet treatment: the inline viewer card
// is cramped on touch, so tapping the card on the ≤1023px breakpoint
// moves the whole card into a slide-up sheet (DOM move keeps its tab /
// Sync / expand listeners alive) and the user gets a full-height
// markdown surface. Shares attachCompletedSheetSwipeDown for the
// swipe-down dismiss so we don't duplicate the touch wiring.

let viewerMobileSheetState = null;

function refreshViewerMobileSheetContent() {
    if (!viewerMobileSheetState || !viewerMobileSheetState.open) return;
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    const liveCard = mainListDiv.querySelector('#todoMdViewerCard');
    if (!liveCard) {
        // Active project no longer has a viewer (project switched away or
        // its inject target was dropped) — close the orphaned sheet.
        closeViewerMobileSheet();
        return;
    }
    if (liveCard === viewerMobileSheetState.movedCard) return;
    viewerMobileSheetState.body.innerHTML = '';
    viewerMobileSheetState.body.appendChild(liveCard);
    viewerMobileSheetState.movedCard = liveCard;
}

export function openViewerMobileSheet(card) {
    if (viewerMobileSheetState && viewerMobileSheetState.open) return;
    if (!card) return;

    const prior = document.getElementById('todoMdViewerMobileSheetBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'todoMdViewerMobileSheetBackdrop';

    const sheet = document.createElement('div');
    sheet.id = 'todoMdViewerMobileSheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'todoMdViewerMobileSheetTitle');

    const handle = document.createElement('span');
    handle.className = 'completedMobileSheetHandle';
    handle.setAttribute('aria-hidden', 'true');

    const headerEl = document.createElement('div');
    headerEl.className = 'completedMobileSheetHeader';

    const title = document.createElement('div');
    title.id = 'todoMdViewerMobileSheetTitle';
    title.className = 'completedMobileSheetTitle';
    title.textContent = 'TODO.md';

    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'completedMobileSheetClose';
    closeX.setAttribute('aria-label', 'Close TODO.md viewer');
    closeX.textContent = '×';

    headerEl.appendChild(title);
    headerEl.appendChild(closeX);

    const body = document.createElement('div');
    body.className = 'completedMobileSheetBody';

    sheet.appendChild(handle);
    sheet.appendChild(headerEl);
    sheet.appendChild(body);
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);

    body.appendChild(card);
    const previouslyFocused = document.activeElement;

    viewerMobileSheetState = {
        open: true,
        backdrop: backdrop,
        sheet: sheet,
        body: body,
        movedCard: card,
        previouslyFocused: previouslyFocused,
        onKeydown: null,
    };

    function onKeydown(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        closeViewerMobileSheet();
    }
    viewerMobileSheetState.onKeydown = onKeydown;

    closeX.addEventListener('click', closeViewerMobileSheet);
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) closeViewerMobileSheet();
    });
    document.addEventListener('keydown', onKeydown, true);

    attachCompletedSheetSwipeDown(handle, sheet, closeViewerMobileSheet);
    attachCompletedSheetSwipeDown(headerEl, sheet, closeViewerMobileSheet);

    requestAnimationFrame(function() {
        backdrop.classList.add('is-open');
    });

    try { closeX.focus(); } catch (_) { /* defensive */ }
}

function closeViewerMobileSheet() {
    const state = viewerMobileSheetState;
    if (!state || !state.open) return;
    state.open = false;
    if (state.onKeydown) {
        document.removeEventListener('keydown', state.onKeydown, true);
    }
    const mainListDiv = document.getElementById('mainList');
    // Return the viewer card to #mainList so the inline rendering owns
    // it again. placeViewerCard puts it back before the ghost spacer to
    // match its normal position below the Completed section.
    if (mainListDiv && state.movedCard && !mainListDiv.contains(state.movedCard)) {
        try { placeViewerCard(state.movedCard, mainListDiv); }
        catch (_) { mainListDiv.appendChild(state.movedCard); }
    }
    if (state.backdrop && state.backdrop.parentNode) {
        state.backdrop.parentNode.removeChild(state.backdrop);
    }
    viewerMobileSheetState = null;
    if (state.previouslyFocused &&
        typeof state.previouslyFocused.focus === 'function' &&
        document.contains(state.previouslyFocused)) {
        try { state.previouslyFocused.focus(); } catch (_) { /* defensive */ }
    }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    // mainListRendered may rebuild the viewer card in #mainList (e.g.
    // project switch) while the sheet is open — re-collect so the sheet
    // body always shows the live viewer card.
    document.addEventListener('mainListRendered', function() {
        if (viewerMobileSheetState && viewerMobileSheetState.open) {
            refreshViewerMobileSheetContent();
        }
    });
    // Resize past the mobile breakpoint — the inline card is usable
    // again on desktop, so dismiss the sheet so the affordance matches
    // the active viewport.
    window.addEventListener('resize', function() {
        if (viewerMobileSheetState && viewerMobileSheetState.open
                && !isMobileViewport()) {
            closeViewerMobileSheet();
        }
    });
}

// True when either mobile sheet is currently open. main.js's viewer card
// tap handler uses this to bail before opening a second sheet on top of
// an already-open one.
export function isAnyMobileSheetOpen() {
    return !!(
        (viewerMobileSheetState && viewerMobileSheetState.open) ||
        (completedMobileSheetState && completedMobileSheetState.open)
    );
}
