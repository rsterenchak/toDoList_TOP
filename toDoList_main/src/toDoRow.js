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

import { listLogic, sortItemsByDueForRender, sortItemsByStatusForRender } from './listLogic.js';
import { getTaskSort } from './prefs.js';
import { setupRowDrag, isCoarsePointer, prefersReducedMotion } from './dragDrop.js';
import {
    applyDueUrgency,
    parseItemDue,
    updateDuePillLabel,
    showDueDatePopover,
    hideDueDatePopover,
    updateRecurringGlyph,
} from './dueDate.js';
import { showConfirmModal, showMissedDatesModal, showDescEditorModal } from './modals.js';
import { showUndoToast } from './undoToast.js';
import { updateCompletedSection } from './emptyState.js';
import { ensureCompanion } from './companion.js';
import {
    attachMobileCreateChips,
    createPasteChipTrigger,
    applyChosenDueToItem,
    markChainingActive,
    isChainingActive,
} from './mobileTaskCreate.js';
import {
    makeInjectButton,
    refreshInjectButton,
    refreshShippedMarkersForProject,
    TODO_RUN_STATUS_EVENT,
    revertEntry,
    fetchRunResult,
} from './inject.js';
import { buildStatusLabel, applyTodoStatusClass, refreshTodoStatusUI, buildManualStatusControl, invokeReviewBadgeTap } from './todoStatus.js';
import { derivePhase, PHASE, isBlockedPhase } from './phase.js';
import {
    getQueueRowForTodo,
    pendingAnswers,
    loadQueueRows,
    fireTriageSweep,
    startAgentQueueSubscription,
    onQueueChange,
} from './agentQueueStore.js';
import { applyTaskFilter, setBlockedItemResolver, setItemPhaseResolver } from './taskFilter.js';
import { dispatchDraft, resolveDispatchTarget } from './dispatchDraft.js';
import { refreshViewerExpandedHeight } from './todoMdViewer.js';
import { dismissDesktopTodoViewer } from './todoMdViewer.js';
import { promptRunInjectedEntry } from './todoMdViewer.js';
import { mountMicButton } from './voiceInput.js';
import { createFilePicker, parseFilePathsFromEntry } from './filePicker.js';
import { buildPhaseRail, paintPhaseRail } from './phaseRail.js';
import { buildAuthoringModeStrip, setAuthoringModeStripActive } from './authoringModeStrip.js';
import { parsePastedEntry, recognizedEntryFields } from './entryParse.js';
import { buildMockupSecondary } from './mockupFlow.js';
import { createStatsDrawer } from './statsDrawerPanel.js';


// The row-side "Discuss" action opens the Claude sheet scoped to this task.
// claudeSheet.js can't be imported here directly (toDoRow → claudeSheet →
// modals → toDoRow would close an import cycle inject.js documents and
// deliberately avoids), so main.js — which imports both — registers the opener
// through this slot, exactly as setViewerCardTapHandler bridges the viewer card.
let discussTaskHandler = null;
export function setDiscussTaskHandler(fn) {
    discussTaskHandler = typeof fn === 'function' ? fn : null;
}

// The ACCEPT-face "Iterate" control opens the Claude chat in iterate mode seeded
// from a shipped entry's diff, scoped to the task's repo. Reusing the Claude
// sheet's own iterate entry point means importing claudeSheet.js, which this
// layer must not do (the toDoRow → claudeSheet → modals → toDoRow cycle), so
// main.js registers the opener through this slot exactly as setDiscussTaskHandler
// bridges Discuss. The opener is called with (entryId, repo). invokeIterateTask
// is exported so the mobile description-editor modal can trigger it AFTER
// dismissing itself (mirroring how onOpenInViewer defers invokeReviewBadgeTap),
// keeping the chat sheet from stacking over an open modal.
let iterateTaskHandler = null;
export function setIterateTaskHandler(fn) {
    iterateTaskHandler = typeof fn === 'function' ? fn : null;
}
export function invokeIterateTask(entryId, repo) {
    if (entryId && iterateTaskHandler) iterateTaskHandler(entryId, repo);
}

// The desktop description panel's STUCK failure-reason block reuses the exact
// copy the Agent view and the mobile modal show (stuckReasonText, owned by
// agentQueueStore.js). It resolves through a registered seam rather than a direct
// import so the row layer keeps a minimal import surface, exactly as
// setDiscussTaskHandler bridges the Claude sheet. main.js registers the single
// resolver; until it's wired the panel simply omits the reason text (never throws).
let stuckReasonResolver = null;
export function setStuckReasonResolver(fn) {
    stuckReasonResolver = typeof fn === 'function' ? fn : null;
}

// The blocked-on-you filter chip in the task filter bar keys off a row's derived
// phase, but taskFilter.js can't import phase.js without closing an import cycle
// (taskFilter → phase → inject → modals → toDoRow → taskFilter). toDoRow.js
// already imports both, so it registers the blocked-phase test as the dependency
// seam — the chip's count and membership resolve through this resolver.
setBlockedItemResolver(function (item) {
    return isBlockedPhase(derivePhase(item));
});

// The desktop queue-rail phase filter (ALL / ACTIVE / RUNNING / DONE) keys off a
// row's derived phase. taskFilter.js can't import phase.js (the same cycle the
// blocked resolver dodges), so register derivePhase here as the phase seam.
setItemPhaseResolver(derivePhase);


// Default due-date offset used when a row is committed without a user-chosen
// date. A new task with no chosen date lands on today (today + 0), matching
// the mobile inline-create default so both platforms agree.
const DEFAULT_DUE_OFFSET_DAYS = 0;

function defaultDueParts() {
    const future = new Date();
    future.setDate(future.getDate() + DEFAULT_DUE_OFFSET_DAYS);
    return { m: future.getMonth() + 1, d: future.getDate(), y: future.getFullYear() };
}


// Tabler-style copy SVG and a matching checkmark SVG used to telegraph
// "copied" feedback on the mobile per-row copy-title button. currentColor
// lets the purple accent on the button paint the strokes; the checkmark
// reuses the same dimensions so swapping innerHTML doesn't reflow the row.
const COPY_GLYPH_SVG = '<svg class="copyTitleIcon" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.25" y="3.25" width="7.5" height="9" rx="1.25"/><path d="M5.75 3.25V2.25a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7"/></svg>';
const CHECK_GLYPH_SVG = '<svg class="copyTitleIcon copyTitleIcon-done" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.75 7.25L5.75 10.25L11.5 4.25"/></svg>';

// How long the checkmark stays after a successful copy before the button
// reverts to the copy glyph. Matched to the ~1s the task brief calls for.
const COPY_FEEDBACK_MS = 1000;

// Swap the copy-title button between its idle (copy glyph) and confirmed
// (checkmark) states. Centralized so the click path, the timeout restore,
// and any future re-render reset all reach for the same SVG strings.
function setCopyBtnGlyph(copyBtn, done) {
    copyBtn.innerHTML = done ? CHECK_GLYPH_SVG : COPY_GLYPH_SVG;
    if (done) {
        copyBtn.setAttribute('data-copied', 'true');
    } else {
        copyBtn.removeAttribute('data-copied');
    }
}

// Click handler for the mobile per-row copy-title button. Writes the row's
// title to the clipboard, flips the icon to the checkmark, then restores
// the copy glyph after COPY_FEEDBACK_MS. The clipboard write goes through
// navigator.clipboard.writeText when available — the only path that works
// from a button activation on mobile Safari. The legacy execCommand path
// is preserved as a fallback for environments without the async API
// (jsdom in particular). A clipboard-write failure leaves the icon on the
// idle copy glyph so the user can retry without a stale checkmark sitting.
function copyTitleToClipboard(item, copyBtn) {
    const text = (item && typeof item.tit === 'string') ? item.tit : '';
    if (!text) return;

    function showCopied() {
        setCopyBtnGlyph(copyBtn, true);
        // Stash the timer on the button so a fresh click within the window
        // resets the countdown rather than racing two pending restores.
        if (copyBtn.__copyResetTimer) {
            clearTimeout(copyBtn.__copyResetTimer);
        }
        copyBtn.__copyResetTimer = setTimeout(function() {
            setCopyBtnGlyph(copyBtn, false);
            copyBtn.__copyResetTimer = null;
        }, COPY_FEEDBACK_MS);
    }

    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(showCopied).catch(function() {});
        return;
    }

    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) showCopied();
    } catch (e) { /* swallow — no feedback flip, button stays on copy glyph */ }
}


// Inline SVG for the two run-status glyphs that occupy the leading slot
// (`#descIndicator`) after the checkbox. The shipped glyph is a filled
// check-in-circle whose check is knocked out in the row fill; the pending glyph
// is a dashed ring. Both paint in `currentColor` (set per state in CSS to the
// feature-green / warning-amber token), so no inline color attributes are used.
const RUN_STATUS_SHIPPED_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.3l2.1 2.1 4.3-4.7" fill="none" stroke="var(--bg-row)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const RUN_STATUS_PENDING_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2.4 2.2" stroke-linecap="round"/></svg>';


// Render the run-status glyph in the leading `#descIndicator` slot, driven by the
// row's single derived pipeline phase (see `derivePhase` in phase.js) rather than
// re-resolving the entry id here — so the glyph and the REVIEW badge can never
// state the row's pipeline position out of step. The phase is resolved against
// the shared TODO.md marker cache, not a device-local run store, so the glyph
// agrees across devices. Because 'draft' requires the marker to actually be
// present in TODO.md, a task's glyph is briefly absent on first load until its
// project's marker read resolves — correctness (never a stuck/wrong amber) over
// the flash. It never touches the inject button's own glyph.
//
// Map a derived pipeline phase to the run-status glyph state the leading slot
// paints. The badge and the glyph are two views of one pipeline position, so
// only one of them marks it per phase:
//   'draft'  → 'pending' (amber dashed ring)
//   'done'   → 'shipped' (green filled check)
//   'accept' → '' — the amber ⌁ REVIEW badge is the row's single pipeline mark
//              until it is acknowledged, so the glyph is suppressed here rather
//              than duplicating the shipped fact alongside REVIEW.
//   'drafted'→ '' — the amber ⌁ DRAFTED badge is the row's single mark while a
//              landed draft is unread, so the glyph stays empty (as for 'accept').
//   'asking' → '' — the ⌁ ASKING badge is the row's single mark; no glyph.
//   'stuck'  → '' — the ⌁ STUCK badge is the row's single mark; no glyph.
//   'mockup' → '' — the ⌁ MOCKUP badge is the row's single mark; no glyph.
//   'none'   → '' — nothing to show.
function glyphStateForPhase(phase) {
    // RUNNING is a queue-derived overlay on what would otherwise read as DRAFT
    // (a dispatched run's injected marker). It carries no row badge of its own,
    // so it paints the same pending glyph DRAFT does — keeping a running task's
    // row and rail visually identical to before RUNNING existed.
    if (phase === PHASE.DRAFT || phase === PHASE.RUNNING) return 'pending';
    if (phase === PHASE.DONE) return 'shipped';
    return '';
}


// Map a derived phase to the status-label overlay the badge renders. The badge
// paints exactly one derived overlay per phase, keyed off the SAME phase the
// glyph reads so the two can never disagree:
//   'asking'  → '⌁ ASKING'  (amber) — triage has a pending question for this task
//   'drafted' → '⌁ DRAFTED' (amber) — a landed draft this task hasn't been opened for
//   'accept'  → '⌁ REVIEW'  (amber) — shipped, unacknowledged
//   'stuck'   → '⌁ STUCK'   (danger red) — the linked run failed or changed nothing
//   'mockup'  → '⌁ MOCKUP'  (amber) — the linked run is awaiting a mockup decision
//   everything else → null (the manual status shows through)
function overlayForPhase(phase) {
    if (phase === PHASE.ASKING) return 'asking';
    if (phase === PHASE.DRAFTED) return 'drafted';
    if (phase === PHASE.ACCEPT) return 'review';
    if (phase === PHASE.STUCK) return 'stuck';
    if (phase === PHASE.MOCKUP) return 'mockup';
    return null;
}


// A self-contained, body-level toast for a non-blocking notice from the row
// layer — e.g. an answer that saved but whose triage sweep couldn't dispatch.
// Appended to document.body so it survives the row rebuild that clears the
// answered row's ASKING badge, and auto-removed after a few seconds. Reuses the
// Agent board's toast styling (`.agentViewToast`) rather than inventing a token.
function showRowToast(message) {
    if (typeof document === 'undefined') return;
    const prior = document.getElementById('todoRowToast');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);
    const toast = document.createElement('div');
    toast.id = 'todoRowToast';
    toast.className = 'agentViewToast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
}


// ── DESKTOP DETAIL PANE ──
// At desktop widths (≥1024px) the open task's description panel lives in a
// dedicated right-hand column (#descDetailPane) rather than expanding the row
// inline in #mainList — inline expansion pushes every row below it down and off
// screen. Below 1024px the panel mounts inline as a row sibling exactly as
// before. placeDescPanel() resolves the host by breakpoint (mirroring
// placeChatContent() for the chat surface); the pane host is created in main.js.
const DETAIL_MOBILE_MAX_WIDTH = 1023;

// The single description panel currently mounted in the detail pane, tracked so
// opening a different row can evict it (only one detail is shown at a time) and
// a resize / reconcile can re-place or clear it. Null in inline mode and whenever
// no panel is open. Shape: { toggle, descSibling, toDoChild, close }.
let openDetail = null;

function getDescDetailPane() {
    return typeof document === 'undefined'
        ? null
        : document.getElementById('descDetailPane');
}

// Detail-pane mode is active only when BOTH the viewport is desktop-width AND the
// pane host exists. Gating on the host's presence keeps unit tests that build
// bare rows (no pane) in inline mode even at jsdom's default 1024px width, so the
// inline insert path and its assertions are unaffected.
function isDetailPaneMode() {
    return typeof window !== 'undefined'
        && window.innerWidth > DETAIL_MOBILE_MAX_WIDTH
        && !!getDescDetailPane();
}

// Toggle the pane's empty-state message: shown when no panel occupies the pane,
// hidden when one is mounted. An empty column reads as a rendering failure, so
// the pane always says what it is waiting for when nothing is open.
function updateDetailPaneEmptyState() {
    const pane = getDescDetailPane();
    if (!pane) return;
    const empty = pane.querySelector('.descDetailEmpty');
    if (empty) empty.hidden = !!pane.querySelector('#descSibling');
    syncDetailPaneHeader();
}

// Mount / refresh / clear the detail-pane HEADER — a title + entry-marker line
// shown ABOVE the relocated #descSibling panel so a master-detail layout names
// the open task without the user cross-referencing which queue row is active.
// The header is a SIBLING of the panel, never a #descSibling child: a child would
// travel with the panel to the mobile inline host and duplicate the modal's own
// title, and would owe an explicit grid-column plus a DESC_PANEL_CHILD_SELECTORS
// entry. Pane-owned keeps it desktop-only (the pane is display:none below 1024px)
// and out of that contract entirely. Populated from the panel's owner row's
// __item so the two can never disagree about which task is open, and removed
// whenever the pane is empty — it rides the same empty-state toggle that calls it,
// so it clears on close, on a full row rebuild, and when the open task is gone.
// The marker line reads item.entryId in full (a truncated id is useless for the
// diagnostic case of comparing it against a marker in TODO.md); a task not yet
// injected shows a "not yet injected" note in place of an id rather than a blank.
export function syncDetailPaneHeader() {
    const pane = getDescDetailPane();
    if (!pane) return;
    const panel = pane.querySelector('#descSibling');
    const item = panel && panel.__ownerRow ? panel.__ownerRow.__item : null;
    let header = pane.querySelector('.descDetailHeader');
    if (!panel || !item) {
        if (header) header.remove();
        return;
    }
    if (!header) {
        header = document.createElement('div');
        header.className = 'descDetailHeader';
        const title = document.createElement('h2');
        title.className = 'descDetailHeaderTitle';
        const marker = document.createElement('div');
        marker.className = 'descDetailHeaderMarker';
        header.appendChild(title);
        header.appendChild(marker);
    }
    // The header must lead the pane, directly before the panel — assert it on
    // every sync so an adoption / re-place that appended the panel after a stale
    // header still ends with header → panel order.
    if (header.parentNode !== pane || header.nextSibling !== panel) {
        pane.insertBefore(header, panel);
    }
    header.querySelector('.descDetailHeaderTitle').textContent = item.tit || '';
    const marker = header.querySelector('.descDetailHeaderMarker');
    marker.textContent = '';
    const label = document.createElement('span');
    label.className = 'descDetailHeaderMarkerLabel';
    label.textContent = 'Entry';
    marker.appendChild(label);
    if (item.entryId) {
        const id = document.createElement('code');
        id.className = 'descDetailHeaderMarkerId';
        id.textContent = item.entryId;
        marker.appendChild(id);
    } else {
        const none = document.createElement('span');
        none.className = 'descDetailHeaderMarkerNone';
        none.textContent = 'not yet injected';
        marker.appendChild(none);
    }
}

// Mark the panel's entry textarea as sized BY ITS HOST rather than by its own
// content, and keep the two sizing models from fighting over the same element.
// In the detail pane CSS makes the textarea a flex-fill child (it takes the
// height between the authoring strip and the docked footer, then scrolls
// internally); inline it auto-grows to its content instead. The auto-grow writes
// `style.height`, and an inline height beats any CSS fill — so entering the pane
// clears whatever height the inline host left behind and gates further writes off
// (autoGrowDescInput reads this class), while leaving the pane hands sizing back
// by re-measuring against the current value. Called from the single host-resolving
// funnel below, so both the open path and the resize path stay in step.
function setDescEditorFill(descSibling, fill) {
    const descInput = descSibling ? descSibling.querySelector('#descInput') : null;
    if (!descInput) return;
    const wasFill = descInput.classList.contains('descEditorFill');
    descInput.classList.toggle('descEditorFill', fill);
    if (fill) {
        descInput.style.height = '';
    } else if (wasFill) {
        // Auto-grow reads scrollHeight off the synthetic input event.
        descInput.dispatchEvent(new Event('input'));
    }
}

// Mount an OPEN row's description panel into the host matching the current
// breakpoint. Desktop → the detail pane (moved with appendChild so handlers,
// scroll position, and in-flight state survive); mobile (or no pane host) →
// inline, directly after the row past the blank placeholder's leading siblings
// (the mobile chip row and, when open, the paste-entry panel). Idempotent: a
// no-op when the panel already lives in the resolved host.
export function placeDescPanel(descSibling, toDoChild) {
    if (isDetailPaneMode()) {
        const pane = getDescDetailPane();
        if (descSibling.parentNode !== pane) pane.appendChild(descSibling);
        setDescEditorFill(descSibling, true);
        return;
    }
    setDescEditorFill(descSibling, false);
    const mainList = toDoChild.parentElement;
    if (!mainList) return;
    let descAnchor = toDoChild.nextSibling;
    while (descAnchor && (descAnchor.id === 'createChipRow' || descAnchor.id === 'pasteEntryPanel')) {
        descAnchor = descAnchor.nextSibling;
    }
    if (descSibling.parentNode !== mainList || descSibling.nextSibling !== descAnchor) {
        mainList.insertBefore(descSibling, descAnchor);
    }
}

// Tear down whatever panel occupies the detail pane and reset the open-detail
// tracker. Called on a full row rebuild (project switch, delete re-render), where
// the previously-open panel belongs to a now-detached row element.
export function clearDetailPane() {
    const pane = getDescDetailPane();
    if (pane) {
        const panel = pane.querySelector('#descSibling');
        if (panel && panel.parentNode === pane) pane.removeChild(panel);
    }
    if (openDetail && openDetail.toggle) openDetail.toggle.classList.remove('open');
    openDetail = null;
    updateDetailPaneEmptyState();
}

// After a reorder (sort / filter / status flip reuses row elements), confirm the
// open detail's row still lives in the list; if it was rebuilt or removed, clear
// the pane so it never shows a task that no longer exists.
export function reconcileDetailPane() {
    if (!openDetail) { updateDetailPaneEmptyState(); return; }
    const mainList = typeof document !== 'undefined'
        ? document.getElementById('mainList') : null;
    if (!mainList || !mainList.contains(openDetail.toDoChild)) {
        clearDetailPane();
    } else {
        updateDetailPaneEmptyState();
    }
}

// Re-place the currently open panel into the host matching the current
// breakpoint — the resize counterpart to placeChatContent()'s viewport handler.
// Moves the panel between the inline slot and the detail pane and keeps the
// row's selected marker in step, without losing handlers or in-flight state.
export function syncDetailPaneForViewport() {
    if (typeof document === 'undefined') return;
    // Find the open panel wherever it currently lives: tracked in the pane
    // (preserve its existing tracker so its close/eviction hook survives a
    // non-crossing resize), or walked from an inline-open row.
    let existing = openDetail;
    let descSibling = null;
    let toDoChild = null;
    if (existing) {
        descSibling = existing.descSibling;
        toDoChild = existing.toDoChild;
    } else {
        const mainList = document.getElementById('mainList');
        const inlinePanel = mainList ? mainList.querySelector('#descSibling') : null;
        if (inlinePanel && inlinePanel.__ownerRow) {
            descSibling = inlinePanel;
            toDoChild = inlinePanel.__ownerRow;
        }
    }
    if (!descSibling || !toDoChild) return;
    placeDescPanel(descSibling, toDoChild);
    const paneMode = isDetailPaneMode();
    toDoChild.classList.toggle('todo-detail-open', paneMode);
    if (!paneMode) {
        openDetail = null;
    } else if (existing) {
        openDetail = existing;
    } else {
        // Adopting an inline-opened panel crossing into pane mode: build a
        // self-contained close so a later open of another row can still evict it.
        openDetail = {
            toggle: toDoChild.querySelector('#descToggle'),
            descSibling: descSibling,
            toDoChild: toDoChild,
            close: function() {
                if (descSibling.parentNode) descSibling.parentNode.removeChild(descSibling);
                const tg = toDoChild.querySelector('#descToggle');
                if (tg) tg.classList.remove('open');
                toDoChild.classList.remove('todo-detail-open');
                if (openDetail && openDetail.toDoChild === toDoChild) openDetail = null;
                updateDetailPaneEmptyState();
            },
        };
    }
    updateDetailPaneEmptyState();
}

// Locate the OPEN description panel (`#descSibling`) belonging to a row, or null
// when the row's panel isn't expanded. In detail-pane mode the panel lives in
// #descDetailPane (linked to its row via `__ownerRow` / `__descSibling`), not
// after the row; inline it is inserted directly after the row — or past the
// blank placeholder's leading siblings (the mobile chip row and, when open, the
// paste-entry panel) — mirroring wireDescToggle's own insert/remove traversal.
export function openDescSiblingFor(toDoChild) {
    const own = toDoChild.__descSibling;
    const pane = getDescDetailPane();
    if (own && pane && own.parentNode === pane) return own;
    let node = toDoChild.nextSibling;
    while (node && (node.id === 'createChipRow' || node.id === 'pasteEntryPanel')) {
        node = node.nextSibling;
    }
    return (node && node.id === 'descSibling') ? node : null;
}


// Open a committed row in the desktop detail pane by driving the SAME chevron
// path a descToggle click uses, so placeDescPanel, openDescSiblingFor, the
// ASKING/STUCK syncs, and the phase-switch layout all run identically regardless
// of what initiated the open. Shared by the row-click branch and the keyboard
// focus path so the two can never drift. Idempotent and self-gating:
//   - a no-op outside detail-pane mode (inline mode owns its own open),
//   - a no-op when the row has no toggle,
//   - a no-op when this row's panel is ALREADY the one mounted in the pane —
//     the load-bearing guard, since without it a re-trigger on the open row
//     would call descToggle.click() and toggle it CLOSED.
// Because the open runs through descToggle.click(), one interaction that both
// clicks and focuses the row results in a single open: the first call opens and
// records openDetail, the second sees it and returns.
export function openRowInDetailPane(toDoChild, descToggle) {
    if (!isDetailPaneMode()) return;
    if (!descToggle) descToggle = toDoChild.querySelector('#descToggle');
    if (!descToggle) return;
    // Already the mounted detail (tracked) or already flagged open → nothing to do.
    if (openDetail && openDetail.toDoChild === toDoChild) return;
    if (descToggle.classList.contains('open')) return;
    descToggle.click();
}


// A single delegated focusin listener on #mainList opens the focused committed
// row in the desktop detail pane, so moving keyboard focus into a row — via Tab
// or the arrow-key nav that focuses the row element — walks the pane with it.
// Unlike the click path it must NOT set data-title-edit or focus the title
// input: arrowing down the queue must not drop a caret into every title. The
// open is idempotent (openRowInDetailPane), so a mouse click — which both fires
// focusin on the input and runs the click branch's own open — still results in a
// single open. Attached once behind a module flag: main.js evaluates twice across
// the four webpack entry bundles, and a double-bound delegated listener on the
// shared #mainList would open the pane twice per focus.
let detailPaneFocusinAttached = false;
export function ensureDetailPaneFocusListener() {
    if (detailPaneFocusinAttached || typeof document === 'undefined') return;
    const mainList = document.getElementById('mainList');
    if (!mainList) return;
    detailPaneFocusinAttached = true;
    mainList.addEventListener('focusin', function(e) {
        // Gate on pane mode so the handler no-ops (never throws) inline.
        if (!isDetailPaneMode()) return;
        const row = e.target && e.target.closest ? e.target.closest('#toDoChild') : null;
        if (!row) return;
        // The blank placeholder / compose row never opens the pane.
        if (row.dataset && row.dataset.originalBlank === 'true') return;
        const input = row.querySelector('#toDoInput');
        if (!input || !input.value.trim()) return;
        openRowInDetailPane(row, row.querySelector('#descToggle'));
    });
}


// The single insertion anchor for the panel's leading blocks. The phase rail
// always leads the panel; the ASKING and STUCK blocks mount immediately AFTER
// it, and THE ENTRY label sits after those. Returning `rail.nextSibling` (the
// label, once mounted) keeps that order regardless of which sync runs last —
// `syncAskingPanel`, `syncStuckPanel`, and `mountDescRail` can be called in any
// order without the rail ending up below a block. Falls back to `firstChild`
// when no rail is present (e.g. a panel mid-build before mountDescRail runs).
export function descPanelTopAnchor(panel) {
    const rail = panel.querySelector('.phaseRail');
    return rail ? rail.nextSibling : panel.firstChild;
}


// The panel's docked bottom stack: the filter panel, the actions row, the FILE
// readout and the MANUAL STATUS control, grouped into one `.descPanelFooter`
// wrapper so the detail pane can pin them to its floor (margin-top: auto) while
// the entry textarea absorbs the leftover height between the top cluster and the
// footer. Returns the wrapper for a panel that has one, else null.
export function descPanelFooterHost(panel) {
    return panel ? panel.querySelector('.descPanelFooter') : null;
}


// The mirror of descPanelTopAnchor for blocks that fall back to "append at the
// panel's end": the footer is the LAST panel child, so appending would drop the
// block below the docked stack. Returning the footer (or null when there is
// none) makes `panel.insertBefore(block, descPanelBottomAnchor(panel))` land the
// block above the footer and degrade to a plain append on a footer-less panel.
export function descPanelBottomAnchor(panel) {
    return descPanelFooterHost(panel);
}


// Mount (idempotently) the read-only phase rail and THE ENTRY section label at
// the head of an OPEN description panel, and repaint the rail for the row's
// current derived phase. The desktop counterpart to the mobile modal's rail +
// entry label, driven by the same shared phaseRail.js builder so the two hosts
// can never diverge.
//
// #descSibling is a persistent per-row node whose children survive close (the
// same fact behind the file-picker reopen-duplication bug), so a fresh
// createElement on every open would stack duplicate rails/labels — mount the
// pair once, then reuse and only repaint. The rail is the panel's firstChild and
// the label sits immediately after it; ASKING/STUCK blocks land between them via
// descPanelTopAnchor. Both carry `grid-column: 1 / -1` in style.css so neither
// collapses into a 14px gutter. refreshViewerExpandedHeight() runs on first mount
// (which changes the panel's height) but not on a pure repaint (same height).
export function mountDescRail(descSibling, item) {
    const phase = derivePhase(item);
    let rail = descSibling.querySelector('.phaseRail');
    if (rail) {
        paintPhaseRail(rail, phase);
    } else {
        rail = buildPhaseRail(phase);
        descSibling.insertBefore(rail, descSibling.firstChild);
        refreshViewerExpandedHeight();
    }
    if (!descSibling.querySelector('.descSiblingEntryLabel')) {
        const label = document.createElement('span');
        label.className = 'descSiblingEntryLabel';
        label.textContent = 'The entry';
        descSibling.insertBefore(label, rail.nextSibling);
        refreshViewerExpandedHeight();
    }
}


// The complete set of elements that can mount into the #descSibling description
// panel, as CSS selector needles. The panel is a 3-column grid (14px 1fr 14px);
// EVERY child must carry an explicit grid-column or it auto-places into a 14px
// gutter — the defect that crushed the inject button, the ASKING block, and
// #descInput in turn (four separate layout failures in one day). This list is the
// single source of truth for that contract: the structural guard test asserts (a)
// every needle here has a grid-column rule in style.css, and (b) every
// `descSibling.appendChild(` / `descSibling.insertBefore(` call site in this file
// mounts one of these. Adding a new panel child means adding it here. The
// Inject / Generate / Discuss buttons are NOT direct grid children — they live
// inside the `.descActionsRow` wrapper (grid-column: 2) that groups them into one
// horizontal row, so the wrapper carries the placement and the buttons flow
// inside it at natural width.
export const DESC_PANEL_CHILD_SELECTORS = Object.freeze([
    '#descInput',
    '#descSibling .phaseRail',
    '#descSibling .descSiblingEntryLabel',
    '#descSibling .askingBlock',
    '#descSibling .descEditorModalStuck',
    '#descSibling .descDispatchBlock',
    '#descSibling .filePickTrigger',
    '#descSibling .filePickPanel',
    '#descSibling .descActionsRow',
    '#descSibling .descFileReadout',
    '#descSibling .generateFailure',
    '#descSibling #descEditorModalStatusRow',
    '#descSibling .descModeStrip',
    '#descSibling .descPasteBody',
    '#descSibling .descGenerateBody',
    '#descSibling .descTriageBlock',
    '#descSibling .descReviewBlock',
    '#descSibling .descReviewActions',
    '#descSibling .descReviewEntryView',
    '#descSibling .descRunReportBlock',
    '#descSibling .descMockupBlock',
    '#descSibling .descPanelFooter',
]);


// The authoring-control subset of the description panel: the WRITE/PASTE/GENERATE
// mode strip and its PASTE / GENERATE mode bodies, the entry textarea, the
// File:-path picker (trigger + panel), Generate (and its failure notice), Inject,
// and the TRIAGE RUNNING block that replaces the entry region while a derive is in
// flight. These are the controls that only make sense while a task's entry is
// still being authored, so all of them are hidden together in the terminal `done`
// phase. The phase rail, THE ENTRY label, the ASKING/STUCK blocks, and Discuss are
// deliberately NOT in this group.
const DESC_AUTHORING_GROUP_SELECTORS = Object.freeze([
    '#descInput',
    '.filePickTrigger',
    '.filePickPanel',
    '.generateBtn',
    '.generateFailure',
    '.injectBtn',
    '.descModeStrip',
    '.descPasteBody',
    '.descGenerateBody',
    '.descTriageBlock',
]);


// Gate the panel's authoring group by ONE derived phase — the first slice of
// turning #descSibling into a per-phase face. The group is hidden in the terminal
// `done` phase (a shipped-and-acknowledged entry, nothing left to author) AND in
// the `accept` phase (a shipped entry awaiting a decision — the WHAT CHANGED card
// and the decision actions take the space, and a shipped entry cannot be usefully
// edited from a local copy; OPEN IN TODO.MD routes to the real text). Both leave
// the phase rail, the REVIEW / ASKING / STUCK blocks, and Discuss; every other
// phase (`none`, `draft`, `asking`, `drafted`, `stuck`, `mockup`) renders the group
// exactly as before. THE ENTRY section label is hidden alongside the group in those
// two phases (there is no entry to author).
//
// Hides via the `[hidden]` attribute — never inline `style.display`, which would
// fight refreshInjectButton's own display gating. The two compose cleanly:
// applyPhaseLayout gates the WHOLE group by phase, refreshInjectButton gates
// Inject WITHIN the shown case. The CSS `#descSibling …[hidden] { display: none }`
// guards outrank the controls' author-level `display`, and refreshInjectButton
// only ever sets inline display to '' or 'none' (never a visible value), so the
// phase gate wins in `done`; outside `done` the [hidden] attribute is cleared and
// refreshInjectButton's empty-description hide governs Inject as before.
//
// One switch, keyed by phase, in one place — deliberately not per-control
// conditionals scattered through the mount block. Idempotent and repaint-safe:
// called on panel open and on the live-refresh sweep, so a panel whose task
// transitions into or out of `done` re-derives its layout without a re-render.
export function applyPhaseLayout(descSibling, phase) {
    if (!descSibling) return;
    const hideAuthoring = phase === PHASE.DONE || phase === PHASE.ACCEPT;
    DESC_AUTHORING_GROUP_SELECTORS.forEach(function(selector) {
        descSibling.querySelectorAll(selector).forEach(function(el) {
            el.hidden = hideAuthoring;
        });
    });
    const label = descSibling.querySelector('.descSiblingEntryLabel');
    if (label) label.hidden = hideAuthoring;
}


// Build the ASKING question + answer block for a row's description panel. It
// carries triage's pending question above a textarea, a Send action, and an
// inline error slot. Sending routes the answer through listLogic.answerAgentTask
// (the single agent_queue write path) and fires the shared triage sweep — exactly
// as the Agent board's answer control does — then reloads the shared store so the
// row leaves needs_words and its badge clears. Unsent text is mirrored into the
// shared `pendingAnswers` map (keyed by the linked queue-row id, the same key the
// board uses) so it survives a row rebuild and shows on whichever surface the user
// opens next.
export function buildAskingBlock(item, projectName, queueRow) {
    const block = document.createElement('div');
    block.className = 'askingBlock';
    block.setAttribute('data-answer-row', String(queueRow.id));

    const question = (queueRow.question || '').trim();
    if (question) {
        const q = document.createElement('p');
        q.className = 'askingQuestion';
        q.textContent = question;
        block.appendChild(q);
    }

    const input = document.createElement('textarea');
    input.className = 'askingAnswerInput';
    input.rows = 2;
    input.placeholder = 'Answer to continue…';
    input.setAttribute('aria-label', 'Answer triage');
    // 16px avoids iOS Safari's focus auto-zoom (per the mobile input convention).
    input.style.fontSize = '16px';
    if (pendingAnswers.has(queueRow.id)) input.value = pendingAnswers.get(queueRow.id);
    input.addEventListener('input', function() {
        pendingAnswers.set(queueRow.id, input.value);
    });
    input.addEventListener('click', function(e) { e.stopPropagation(); });
    block.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'askingAnswerActions';

    const errorEl = document.createElement('p');
    errorEl.className = 'askingAnswerError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    actions.appendChild(errorEl);

    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'askingAnswerSend';
    send.textContent = 'Send';
    actions.appendChild(send);
    block.appendChild(actions);

    function submitAnswer() {
        if (send.disabled) return;
        const text = (input.value || '').trim();
        if (!text) return;
        errorEl.hidden = true;
        errorEl.textContent = '';
        send.disabled = true;
        input.disabled = true;
        send.classList.add('is-pending');
        send.textContent = 'Sending…';
        Promise.resolve(listLogic.answerAgentTask(queueRow.id, text, queueRow.thread)).then(function(res) {
            if (res && res.ok) {
                input.value = '';
                pendingAnswers.delete(queueRow.id);
                // Reload the shared store so the row leaves needs_words and its
                // ASKING badge clears even where realtime isn't observed; then
                // repaint every row's derived badge + panel from the fresh cache.
                Promise.resolve(loadQueueRows(projectName)).then(refreshDescStatusDots);
                // Auto-fire the sweep now the row is back in triaging — exactly as
                // the board does. The answer is already saved, so a failed dispatch
                // only means a manual Run is needed; surface it as a toast, never a
                // block. Shares the store's in-flight guard with the board.
                Promise.resolve(fireTriageSweep(projectName)).then(function(tr) {
                    if (tr && tr.ok === false) {
                        showRowToast('Answer saved, but triage didn’t start — Run it from the Agent tab.');
                    }
                });
                return;
            }
            send.disabled = false;
            input.disabled = false;
            send.classList.remove('is-pending');
            send.textContent = 'Send';
            errorEl.textContent = (res && res.error) || 'Could not send. Try again.';
            errorEl.hidden = false;
        }).catch(function() {
            send.disabled = false;
            input.disabled = false;
            send.classList.remove('is-pending');
            send.textContent = 'Send';
            errorEl.textContent = 'Could not send. Try again.';
            errorEl.hidden = false;
        });
    }

    send.addEventListener('click', function(e) {
        e.stopPropagation();
        submitAnswer();
    });
    return block;
}


// Keep a row's open description panel in sync with its ASKING phase. Mounts the
// question + answer block at the top of the panel when the row's linked
// agent_queue row is in needs_words, and removes it otherwise — so a realtime
// push that answers or re-queues the task adds/clears the block live. No-op when
// the panel isn't open (the block mounts on open via wireDescToggle) or when the
// asking state is unchanged (idempotent, so live sweeps don't thrash the DOM).
// Re-applies the panel-height snapshot whenever the block is added or removed.
// Mounts immediately after the phase rail (via descPanelTopAnchor) so the rail
// always leads the panel.
function syncAskingPanel(toDoChild, item, projectName) {
    const panel = openDescSiblingFor(toDoChild);
    if (!panel) return;
    const existing = panel.querySelector('.askingBlock');
    const queueRow = item && item.id ? getQueueRowForTodo(item.id) : null;
    const wantAsking = !!(queueRow && queueRow.state === 'needs_words');
    if (wantAsking) {
        if (existing) {
            // Already mounted for the same queue row — refresh the draft only so a
            // repaint doesn't drop unsent text; rebuild if it points elsewhere.
            if (existing.getAttribute('data-answer-row') === String(queueRow.id)) return;
            existing.remove();
        }
        panel.insertBefore(buildAskingBlock(item, projectName, queueRow), descPanelTopAnchor(panel));
        refreshViewerExpandedHeight();
    } else if (existing) {
        existing.remove();
        refreshViewerExpandedHeight();
    }
}


// Resolve the STUCK reason text through the registered resolver (the store's
// stuckReasonText, wired by main.js). Falls back to the empty string only when
// the resolver isn't wired yet, so the block never throws and never invents a
// second copy of the fallback strings.
function resolveStuckReason(queueRow) {
    return stuckReasonResolver ? stuckReasonResolver(queueRow) : '';
}

// Build the STUCK failure-reason block for a row's description panel — the same
// read-only danger-red card the description-editor modal mounts, reusing the
// modal's class names (so the CSS treatment is shared, not copied) and the
// modal's single copy resolver (`stuckReasonText`). Kept structurally identical
// to modals.js's renderStuckBlock so the two hosts read as one control.
function buildStuckBlock(reason) {
    const block = document.createElement('div');
    block.className = 'descEditorModalStuck';
    block.setAttribute('role', 'status');

    const label = document.createElement('span');
    label.className = 'descEditorModalStuckLabel';
    label.textContent = '⌁ STUCK';
    block.appendChild(label);

    const reasonEl = document.createElement('p');
    reasonEl.className = 'descEditorModalStuckReason';
    reasonEl.textContent = reason;
    block.appendChild(reasonEl);

    return block;
}


// Keep a row's open description panel in sync with its STUCK phase — the chevron
// counterpart to the STUCK-badge tap, which routes to the modal's own stuck
// block. Mirrors syncAskingPanel exactly: same open-panel guard, same
// insert-after-the-rail position (via descPanelTopAnchor), the same idempotent
// early-return (refresh the mounted block's reason text rather than rebuild) so
// live sweeps don't thrash the DOM, and the same removal path when the phase
// clears. Re-applies the panel-height snapshot on both add and remove. ASKING and
// STUCK are mutually exclusive phases (needs_words vs failed/no_change), so the
// two mounts never collide.
function syncStuckPanel(toDoChild, item) {
    const panel = openDescSiblingFor(toDoChild);
    if (!panel) return;
    const existing = panel.querySelector('.descEditorModalStuck');
    const wantStuck = !!(item && item.id) && derivePhase(item) === PHASE.STUCK;
    if (wantStuck) {
        const queueRow = getQueueRowForTodo(item.id);
        const reason = resolveStuckReason(queueRow);
        if (existing) {
            const reasonEl = existing.querySelector('.descEditorModalStuckReason');
            if (reasonEl && reasonEl.textContent !== reason) reasonEl.textContent = reason;
            return;
        }
        panel.insertBefore(buildStuckBlock(reason), descPanelTopAnchor(panel));
        refreshViewerExpandedHeight();
    } else if (existing) {
        existing.remove();
        refreshViewerExpandedHeight();
    }
}


// Build the Dispatch (drafted) / Retry (stuck) action block for a row's
// description panel — the row-side counterpart to the Agent board's Dispatch and
// Retry, so a generated draft can be shipped and a failed run retried without
// leaving the list. Both run the SAME shared dispatch (dispatchDraft), passing the
// row's existing `entry_id`: Retry MUST, so injectEntry dedup-skips the
// already-present marker rather than appending a duplicate; Dispatch passes it too,
// matching the board. No board tail is passed — the row's phase advances through
// the shared queue store's realtime subscription and this action clears on the
// next repaint, so nothing polls. In flight the button shows a pending label; a
// failure surfaces inline beneath it without losing the panel's state.
//
// `mode` is 'dispatch' (drafted), 'retry' (stuck), or 'retriage' (stuck with
// nothing to dispatch). Retry can proceed on the stored entry_id alone (the marker
// is already in TODO.md); Dispatch needs the generated draft text to inject — the
// same empty-case guard the board applies. Retriage needs neither: it re-runs
// triage rather than shipping an entry (see isRetriageRow), so it never touches
// dispatchDraft and takes `projectName` to fire the project-wide sweep.
export function buildDispatchBlock(item, queueRow, mode, projectName) {
    const isRetriage = mode === 'retriage';
    const isRetry = mode === 'retry';
    const block = document.createElement('div');
    block.className = 'descDispatchBlock';
    block.setAttribute('data-dispatch-row', String(queueRow.id));
    block.setAttribute('data-dispatch-mode', mode);

    const actions = document.createElement('div');
    actions.className = 'descDispatchActions';

    const errorEl = document.createElement('p');
    errorEl.className = 'descDispatchError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    actions.appendChild(errorEl);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'descDispatchButton' + ((isRetry || isRetriage) ? ' descDispatchButton--retry' : '');
    const idleLabel = isRetriage ? 'Retry triage' : (isRetry ? 'Retry' : 'Dispatch');
    const pendingLabel = (isRetry || isRetriage) ? 'Retrying…' : 'Dispatching…';
    btn.textContent = idleLabel;
    actions.appendChild(btn);
    block.appendChild(actions);

    const draftText = (queueRow.draft || '').trim();
    // Retry proceeds on the stored entry_id alone; Dispatch needs the draft text.
    // Retriage needs neither — the sweep is what produces them.
    const canRun = isRetriage ? true
        : (isRetry ? !!(queueRow.entry_id || draftText) : !!draftText);
    btn.disabled = !canRun;

    function fail(message) {
        btn.disabled = !canRun;
        btn.classList.remove('is-pending');
        btn.textContent = idleLabel;
        errorEl.textContent = message || (isRetriage ? 'Could not retry triage. Try again.'
            : (isRetry ? 'Could not retry. Try again.' : 'Could not dispatch. Try again.'));
        errorEl.hidden = false;
    }

    // Surface a message WITHOUT reverting the button or the row's state — used by
    // the retriage path once the row is already back at `triaging`. Restoring the
    // idle label there would invite a second sweep for a row that is already queued.
    function note(message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
    }

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (btn.disabled) return;
        // Retriage never reaches the draft guard or dispatchDraft — the row it
        // mounts on has no entry and no draft, which is exactly why it re-runs
        // triage instead of dispatching one.
        if (isRetriage) { startPending(); runRetriage(); return; }
        // Guard the empty case the board guards: no draft to dispatch fails with a
        // message rather than dispatching nothing.
        if (!isRetry && !draftText) { fail('No draft to dispatch.'); return; }
        startPending();
        Promise.resolve(dispatchDraft(queueRow, draftText, queueRow.entry_id)).then(function (res) {
            if (res && res.ok) {
                // The shared queue store's realtime subscription moves the row on
                // and this action clears on the next repaint; nothing to do here.
                return;
            }
            fail(res && res.error);
        }).catch(function () {
            fail(isRetry ? 'Could not retry. Try again.' : 'Could not dispatch. Try again.');
        });
    });

    function startPending() {
        errorEl.hidden = true;
        errorEl.textContent = '';
        btn.disabled = true;
        btn.classList.add('is-pending');
        btn.textContent = pendingLabel;
    }

    // Re-run triage for a row whose sweep died before it wrote a verdict. The row
    // goes back to `triaging` FIRST (clearing the reaper's failure reason), then the
    // project-wide sweep fires through the store's shared guard — the same call the
    // row's Generate button and the ASKING answer path make. Once the state write
    // lands the row has left STUCK, so a sweep that never starts is surfaced inline
    // rather than rolled back: the reaper re-marks it failed if the sweep it is
    // waiting on settles without touching it.
    function runRetriage() {
        Promise.resolve(listLogic.setAgentRunState(queueRow.id, {
            state: 'triaging',
            failure_reason: null,
        })).then(function (res) {
            if (!res || !res.ok) { fail(res && res.error); return; }
            return Promise.resolve(fireTriageSweep(projectName)).then(function (tr) {
                // A null result means the store's in-flight guard swallowed the
                // call — a sweep is already running and will pick this row up.
                if (tr == null) {
                    note('A sweep is already running — this task will be picked up on the next one.');
                    return;
                }
                if (tr.ok === false) {
                    note('Triage didn’t start — Run it from the Agent tab.');
                }
                // Otherwise the row is triaging and this action clears on the next
                // repaint, exactly as dispatch and retry do.
            });
        }).catch(function () {
            fail('Could not retry triage. Try again.');
        });
    }

    return block;
}


// A STUCK row with neither a stored entry marker nor a generated draft has nothing
// for dispatchDraft to ship — its triage run died before writing a verdict, so
// buildDispatchBlock's Retry would mount permanently disabled (canRun is false) and
// even enabled would dispatch claude-run.yml, the wrong recovery for a row that
// never got an entry. Those rows take the retriage mode instead. Shared by both
// hosts (the row panel and the mobile modal) so the two can never disagree about
// which control a stuck row gets.
export function isRetriageRow(queueRow) {
    return !!queueRow && !queueRow.entry_id && !((queueRow.draft || '').trim());
}


// Keep a row's open description panel in sync with its DRAFTED / STUCK phase —
// mounts a Dispatch action beneath the generated entry text when the row's linked
// agent_queue row is `drafted`, and a Retry (or Retry triage, when the row has
// neither an entry nor a draft) action beneath the STUCK failure-reason block when
// it is `failed` / `no_change`; removes the action in every other phase.
// Mirrors syncAskingPanel / syncStuckPanel: open-panel guard, idempotent early
// return (keep the mounted block if it already matches this row + mode so a live
// sweep doesn't thrash the DOM or drop an in-flight button), and a
// refreshViewerExpandedHeight() on add and remove. Repaints live off the same
// onQueueChange sweep, so the action appears and clears as the phase changes while
// the panel is open. Not part of DESC_AUTHORING_GROUP_SELECTORS, so applyPhaseLayout
// never hides it (drafted / stuck are never the terminal `done` phase).
function syncDispatchPanel(toDoChild, item) {
    const panel = openDescSiblingFor(toDoChild);
    if (!panel) return;
    const existing = panel.querySelector('.descDispatchBlock');
    const phase = item && item.id ? derivePhase(item) : PHASE.NONE;
    const baseMode = phase === PHASE.DRAFTED ? 'dispatch'
        : (phase === PHASE.STUCK ? 'retry' : null);
    const queueRow = baseMode ? getQueueRowForTodo(item.id) : null;
    if (!baseMode || !queueRow) {
        if (existing) {
            existing.remove();
            refreshViewerExpandedHeight();
        }
        return;
    }
    // A stuck row with no entry and no draft has nothing to dispatch — it re-runs
    // triage instead. Resolved after the queue row, which carries the evidence.
    const mode = (baseMode === 'retry' && isRetriageRow(queueRow)) ? 'retriage' : baseMode;
    if (existing) {
        // Idempotent: keep the mounted block if it already matches this row + mode
        // so a repaint doesn't drop an in-flight (pending) button or its error.
        if (existing.getAttribute('data-dispatch-row') === String(queueRow.id)
            && existing.getAttribute('data-dispatch-mode') === mode) return;
        existing.remove();
    }
    const block = buildDispatchBlock(item, queueRow, mode, (toDoChild.dataset && toDoChild.dataset.value) || '');
    // Dispatch sits beneath the generated entry text (#descInput); Retry and Retry
    // triage beneath the STUCK failure-reason block. Fall back to appending at the
    // panel's end.
    let anchorAfter;
    if (mode !== 'dispatch') {
        anchorAfter = panel.querySelector('.descEditorModalStuck');
    } else {
        anchorAfter = panel.querySelector('#descInput');
    }
    if (anchorAfter) panel.insertBefore(block, anchorAfter.nextSibling);
    else panel.insertBefore(block, descPanelBottomAnchor(panel));
    refreshViewerExpandedHeight();
}


// ── REVIEW (ACCEPT-PHASE) DECISION SURFACE ───────────────────────────────
// A task in the `accept` phase (shipped, unacknowledged) can be accepted or
// reverted straight from the desktop detail pane, without routing to the TODO.md
// viewer first. Two grid children: a WHAT CHANGED card (the PR number, the entry's
// own Description as a change summary, and a note that deciding is free) and an
// action row — ACCEPT & CLOSE, REVERT, and OPEN IN TODO.MD. Both reuse the
// EXISTING writers so there is exactly one path each: acknowledging goes through
// listLogic.markEntryReviewed (the same writer the viewer's Acknowledge pill uses)
// and reverting through revertEntry (the same Worker `revert` route the viewer's
// Revert pill uses). OPEN IN TODO.MD reaches the viewer through the shared
// invokeReviewBadgeTap entry point the REVIEW badge already uses. Desktop-only —
// syncReviewPanel gates on detail-pane mode so nothing mounts on mobile, where the
// modal keeps its single route action.

// Pull ONLY the `- Description:` sub-bullet text out of a full TODO.md entry blob.
// `item.desc` holds the ENTIRE entry (headline, Type, Description, Implementation
// notes, Out of scope, File, Completed, marker), so the WHAT CHANGED card must not
// render it verbatim — that dumps the whole entry and duplicates the textarea below.
// parsePastedEntry does NOT help here: its `description` field is the whole
// fence-stripped blob, not the Description sub-bullet, so reusing it would reproduce
// the very bug. Tolerant of leading whitespace and a `-`/`*` bullet marker; folds
// wrapped continuation lines that follow the Description line until the next
// labelled sub-bullet, a checkbox headline, or the id marker. Returns '' when there
// is no Description line, so the caller omits the summary rather than falling back
// to the raw entry.
export function extractEntryDescription(raw) {
    const text = String(raw == null ? '' : raw);
    const lines = text.split('\n');
    const descRe = /^\s*[-*]?\s*Description:\s*(.*)$/i;
    // A new labelled sub-bullet (`- Type:`, `- File:`, `- Out of scope:`), a task
    // checkbox headline, or the id marker ends the Description; any other line that
    // follows it is a wrapped continuation of the same paragraph.
    const stopRe = /^\s*(?:[-*]\s+[A-Za-z][\w /]*:|- \[[ xX]\]|<!-- id:)/;
    let start = -1;
    let first = '';
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(descRe);
        if (m) { start = i; first = m[1]; break; }
    }
    if (start === -1) return '';
    const parts = [first];
    for (let i = start + 1; i < lines.length; i++) {
        if (stopRe.test(lines[i])) break;
        parts.push(lines[i]);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}


// Build the WHAT CHANGED card for the review surface. PR number/link comes from the
// linked queue row (mirroring the Agent board's shipped secondary); the change
// summary is the entry's own `- Description:` line (extractEntryDescription — no
// network fetch, the honest local source), omitted when the entry carries no
// Description line. Always carries the costs-nothing note.
export function buildReviewBlock(item, queueRow) {
    const block = document.createElement('div');
    block.className = 'descReviewBlock';

    const heading = document.createElement('span');
    heading.className = 'descReviewHeading';
    heading.textContent = 'What changed';
    block.appendChild(heading);

    const prNumber = queueRow && queueRow.pr_number;
    const prUrl = queueRow && queueRow.pr_url;
    if (prUrl) {
        const a = document.createElement('a');
        a.className = 'descReviewPr';
        a.href = prUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = prNumber ? ('PR #' + prNumber) : 'View PR';
        a.addEventListener('click', function (e) { e.stopPropagation(); });
        block.appendChild(a);
    } else {
        const p = document.createElement('p');
        p.className = 'descReviewPr descReviewPrMuted';
        p.textContent = prNumber ? ('PR #' + prNumber) : 'Shipped';
        block.appendChild(p);
    }

    // Change summary from the entry's `- Description:` line only (not the whole
    // entry blob) — no per-open GitHub request. Omitted when the entry has no
    // Description line; the PR line + note remain.
    const summary = extractEntryDescription(item && item.desc);
    if (summary) {
        const s = document.createElement('p');
        s.className = 'descReviewSummary';
        s.textContent = summary;
        block.appendChild(s);
    }

    const note = document.createElement('p');
    note.className = 'descReviewNote';
    note.textContent = 'Deciding costs nothing — the run is already paid for.';
    block.appendChild(note);

    return block;
}


// Build the read-only ENTRY view for the review surface — the block that fills the
// pane's flex-fill middle while a shipped entry awaits a decision. The authoring
// group (textarea included) is hidden in `accept`, so without this the slot between
// the review furniture and the docked footer is a void and the shipped entry text is
// nowhere readable in the pane.
//
// Read-only is STRICT: a plain div, not a disabled textarea. Text stays selectable so
// it can be copied, but no edit affordance exists — Iterate is the change path for a
// shipped entry, and OPEN IN TODO.MD routes to the real text. Returns null for an
// empty entry so the caller mounts nothing and the middle reads as it does today.
export function buildReviewEntryView(item) {
    const text = (item && item.desc) || '';
    if (!text.trim()) return null;

    const block = document.createElement('div');
    block.className = 'descReviewEntryView';

    const eyebrow = document.createElement('span');
    eyebrow.className = 'descReviewEntryViewEyebrow';
    eyebrow.textContent = 'Entry · Shipped · Read only';
    block.appendChild(eyebrow);

    // `textContent` + `white-space: pre-wrap` renders the entry VERBATIM — every
    // newline and run of indentation the entry carries, exactly as #descInput shows
    // it while the entry is still being authored.
    const body = document.createElement('div');
    body.className = 'descReviewEntryViewText';
    body.textContent = text;
    block.appendChild(body);

    return block;
}


// Confirm, then roll a shipped change back through the SAME Worker `revert` route
// the viewer's and the Agent board's Revert controls use (revertEntry), targeting
// the active project's dispatch target. Handles the three Worker outcomes exactly
// as performRevert / performAgentRevert do: `merged:true` ships the rollback and
// leaves the control disabled (a new build is deploying); `merged:false` opens the
// pending revert PR and surfaces the reason; `ok:false` surfaces the error and
// re-enables the control so it can retry.
function performReviewRevert(item, btn, errorEl) {
    errorEl.hidden = true;
    errorEl.textContent = '';
    const idleLabel = btn.textContent;
    btn.disabled = true;
    btn.classList.add('is-pending');
    btn.textContent = 'Reverting…';
    return Promise.resolve(revertEntry(item.entryId, resolveDispatchTarget())).then(function (res) {
        if (res && res.ok && res.merged === true) {
            // Rollback merged — a new build is deploying. Leave the control
            // disabled so it can't be triggered a second time (a second merged
            // revert re-applies the original change).
            showRowToast('Reverted — new build shipping');
            return;
        }
        if (res && res.ok && res.merged === false) {
            // The revert PR opened but didn't auto-merge — open it so the user can
            // finish it in GitHub, and re-enable so a genuine retry is possible.
            if (res.revert_pr_url) {
                try { window.open(res.revert_pr_url, '_blank', 'noopener'); } catch (e) { /* popup blocked */ }
            }
            btn.disabled = false;
            btn.classList.remove('is-pending');
            btn.textContent = idleLabel;
            errorEl.textContent = res.reason
                ? ('Revert needs attention: ' + res.reason)
                : 'Revert PR opened — finish it in GitHub';
            errorEl.hidden = false;
            return;
        }
        btn.disabled = false;
        btn.classList.remove('is-pending');
        btn.textContent = idleLabel;
        errorEl.textContent = (res && res.reason) ? ('Revert failed: ' + res.reason) : 'Revert failed';
        errorEl.hidden = false;
    }).catch(function () {
        btn.disabled = false;
        btn.classList.remove('is-pending');
        btn.textContent = idleLabel;
        errorEl.textContent = 'Revert failed';
        errorEl.hidden = false;
    });
}


// Build the review action row: ACCEPT & CLOSE (amber, primary), REVERT (danger
// red), OPEN IN TODO.MD (ghost). Tagged with the entry id so syncReviewPanel's
// idempotent guard can keep an in-flight Revert button across a live repaint.
//
// Host-neutral: the desktop detail pane calls it with (item, projectName) and the
// OPEN IN TODO.MD button routes straight through the shared invokeReviewBadgeTap
// entry point. The mobile description-editor modal passes an `options.onOpenInViewer`
// callback so it can dismiss ITSELF first (an open modal over the viewer would land
// the anchored scroll behind a scrim) before opening the anchored viewer a tick
// later — the exact close-then-defer the modal's old REVIEW button did.
export function buildReviewActions(item, projectName, options) {
    const opts2 = options || {};
    const actions = document.createElement('div');
    actions.className = 'descReviewActions';
    actions.setAttribute('data-review-entry', String((item && (item.entryId || item.id)) || ''));

    const errorEl = document.createElement('p');
    errorEl.className = 'descReviewError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    actions.appendChild(errorEl);

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'descReviewBtn descReviewBtn--accept';
    accept.textContent = 'Accept & close';
    accept.addEventListener('click', function (e) {
        e.stopPropagation();
        if (accept.disabled || !item || !item.id) return;
        // The SAME writer the viewer's Acknowledge pill uses — one path for
        // entry_reviewed_at. Emitting the run-status event re-derives the row's
        // phase to `done`; the sweep then clears this block via syncReviewPanel.
        listLogic.markEntryReviewed(item.id);
        document.dispatchEvent(new CustomEvent(TODO_RUN_STATUS_EVENT));
    });
    actions.appendChild(accept);

    const revert = document.createElement('button');
    revert.type = 'button';
    revert.className = 'descReviewBtn descReviewBtn--revert';
    revert.textContent = 'Revert';
    revert.addEventListener('click', function (e) {
        e.stopPropagation();
        if (revert.disabled) return;
        if (!item || !item.entryId) {
            errorEl.textContent = 'No entry to revert.';
            errorEl.hidden = false;
            return;
        }
        const named = item.tit ? ' “' + item.tit + '”' : '';
        showConfirmModal({
            message: 'Revert this change' + named + '? This ships a rollback — a new build will deploy.',
            confirmLabel: 'Revert',
            onConfirm: function () { performReviewRevert(item, revert, errorEl); },
        });
    });
    actions.appendChild(revert);

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'descReviewBtn descReviewBtn--open';
    open.textContent = 'Open in TODO.md';
    open.addEventListener('click', function (e) {
        e.stopPropagation();
        // The modal host supplies its own close-then-open route (dismiss the modal
        // first, defer the anchored viewer a tick); the desktop detail pane has no
        // modal to close, so it takes the shared registered entry point directly —
        // the project's TODO.md viewer, anchored to this entry.
        if (typeof opts2.onOpenInViewer === 'function') {
            opts2.onOpenInViewer();
            return;
        }
        invokeReviewBadgeTap(item && item.entryId, projectName);
    });
    actions.appendChild(open);

    // COPY CONTEXT — a ghost secondary path beside OPEN IN TODO.MD (not competing
    // with ACCEPT & CLOSE). Copies a plain-text block for iterating on this shipped
    // change in an outside conversation. Mounted for BOTH hosts — the desktop detail
    // pane and the mobile description-editor modal — since one copy control is a
    // single ghost button with no supporting content, and the phone is the surface
    // where pasting into an outside conversation most often happens. Both hosts share
    // this ONE builder + handler, so the block can never drift between them. Reads
    // only: the entry (item), the linked queue row's PR fields fetched fresh from the
    // shared store at click time, and the active project's repo. It never mutates the
    // task, the entry, or the row.
    const copyCtx = document.createElement('button');
    copyCtx.type = 'button';
    copyCtx.className = 'descReviewBtn descReviewBtn--copyctx';
    copyCtx.textContent = 'Copy context';
    copyCtx.addEventListener('click', function (e) {
        e.stopPropagation();
        const queueRow = item && item.id ? getQueueRowForTodo(item.id) : null;
        const target = resolveDispatchTarget();
        // The run's closing summary rides along only if it has already resolved
        // (the ACCEPT face kicks the fetch off on mount); reading it synchronously
        // keeps the clipboard write inside this user gesture.
        copyIterateContext(buildIterateContextBlock(
            item, queueRow, target && target.repo, cachedRunSummary(item, queueRow)));
    });
    actions.appendChild(copyCtx);

    // ITERATE — a THIRD ghost route beside OPEN IN TODO.MD and COPY CONTEXT (never
    // competing with ACCEPT & CLOSE, the primary decision). Opens the Claude chat
    // in iterate mode seeded from this entry's shipped diff, scoped to the task's
    // repo, so a change is adjusted from the task itself rather than only from a
    // RUNS-tab record. Reads only — it never mutates the task, entry, or row.
    // Needs a shipped entry marker (item.entryId) to seed the diff, so it no-ops
    // without one. The registered opener (main.js → claudeSheet's iterate entry
    // point) switches the workspace to `repo` before seeding. On the mobile modal
    // host the opts2.onIterate hook dismisses the modal FIRST so the chat sheet
    // doesn't stack over it; the desktop detail pane has no modal and fires the
    // registered opener directly.
    const iterate = document.createElement('button');
    iterate.type = 'button';
    iterate.className = 'descReviewBtn descReviewBtn--iterate';
    iterate.textContent = 'Iterate';
    iterate.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!item || !item.entryId) return;
        const target = resolveDispatchTarget();
        const repo = target && target.repo;
        if (typeof opts2.onIterate === 'function') {
            opts2.onIterate(item.entryId, repo);
            return;
        }
        invokeIterateTask(item.entryId, repo);
    });
    actions.appendChild(iterate);

    return actions;
}


// Assemble the plain-text context block for iterating on a shipped change in an
// outside conversation, in this exact order and with NO markdown fences so it
// survives pasting anywhere:
//   `Iterating on a shipped change in <owner>/<repo>.` then a blank line;
//   `ENTRY <marker uuid>`;
//   `PR #<number> — <pr_url>` — omitted entirely when the row carries neither;
//   `FILES <comma-separated paths>` from the entry's `- File:` line, parsed with
//     the SAME tolerant matcher the FILE readout uses — omitted when it names none;
//   a blank line, `--- the entry as shipped ---`, then item.desc VERBATIM (marker
//     comment and all — the marker is what lets any follow-up trace back, so
//     stripping it would defeat the block's purpose);
//   a blank line, `--- what the run reported ---`, then the run's closing summary
//     — included ONLY when `summary` is a non-empty string, so a run with none (or
//     one whose fetch never resolved) omits the heading entirely rather than
//     emitting an empty section;
//   a blank line, `--- what I want changed ---`, then a single placeholder line —
//     the point of the block, prompting the description that makes the paste
//     actionable, so it is never omitted.
// The run summary sits AFTER the entry and BEFORE the placeholder so the block reads
// as: what shipped, what the run said about it, then your request.
// Pure: the repo is resolved by the caller and both the queue row and the summary
// are passed in, so this stays testable with a fabricated item + row + summary.
export function buildIterateContextBlock(item, queueRow, repo, summary) {
    const lines = [];
    lines.push('Iterating on a shipped change in ' + (repo || 'this repo') + '.');
    lines.push('');
    lines.push('ENTRY ' + ((item && item.entryId) || ''));
    const prNumber = queueRow && queueRow.pr_number;
    const prUrl = queueRow && queueRow.pr_url;
    if (prNumber && prUrl) lines.push('PR #' + prNumber + ' — ' + prUrl);
    else if (prNumber) lines.push('PR #' + prNumber);
    else if (prUrl) lines.push('PR — ' + prUrl);
    const files = parseFilePathsFromEntry((item && item.desc) || '');
    if (files.length) lines.push('FILES ' + files.join(', '));
    lines.push('');
    lines.push('--- the entry as shipped ---');
    lines.push((item && item.desc) || '');
    const summaryText = String(summary == null ? '' : summary).trim();
    if (summaryText) {
        lines.push('');
        lines.push('--- what the run reported ---');
        lines.push(summaryText);
    }
    lines.push('');
    lines.push('--- what I want changed ---');
    lines.push('Describe the change you want here.');
    return lines.join('\n');
}


// A completed run leaves a closing summary — the agent's verdict on what it did and
// anything it noticed but deliberately did not fix. For a SHIPPED run that summary
// is not persisted on the queue row (only the no_change / failed reconcile path
// stores it, in `failure_reason`), so the ACCEPT face fetches it on demand through
// the SAME Worker `run_result` route the store's no_change path uses (fetchRunResult
// — no second fetch mechanism). Keyed by the queue row's numeric `run_id` when
// known, else its `correlation_id` (the Worker resolves either), scoped to the
// active project's dispatch target. Results are cached per run so reopening the
// panel does not re-fetch; a successful read (even an empty summary) is cached, but
// a transient failure is NOT, so a later open can retry. Degrades to '' on any
// failure — an absent summary is a normal state the caller renders as nothing.
const _runSummaryCache = new Map();

function runSummaryKey(item, queueRow) {
    if (queueRow && queueRow.run_id != null && queueRow.run_id !== '') return 'run:' + queueRow.run_id;
    if (queueRow && queueRow.correlation_id) return 'corr:' + queueRow.correlation_id;
    if (item && item.entryId) return 'entry:' + item.entryId;
    return '';
}

// Synchronous read of an already-fetched summary for a run — '' when not yet cached.
// COPY CONTEXT uses this so its clipboard write stays inside the user gesture rather
// than awaiting a fetch; the summary is normally already resolved because the panel
// kicks the fetch off when the ACCEPT face mounts.
function cachedRunSummary(item, queueRow) {
    const key = runSummaryKey(item, queueRow);
    return (key && _runSummaryCache.has(key)) ? _runSummaryCache.get(key) : '';
}

function fetchShippedRunSummary(item, queueRow) {
    const runKey = (queueRow && queueRow.run_id != null && queueRow.run_id !== '')
        ? queueRow.run_id
        : (queueRow && queueRow.correlation_id);
    if (!runKey) return Promise.resolve('');
    const cacheKey = runSummaryKey(item, queueRow);
    if (cacheKey && _runSummaryCache.has(cacheKey)) return Promise.resolve(_runSummaryCache.get(cacheKey));
    const target = resolveDispatchTarget();
    return Promise.resolve(fetchRunResult(runKey, target || null)).then(function (res) {
        if (res && res.ok && typeof res.result === 'string') {
            const summary = res.result.trim();
            if (cacheKey) _runSummaryCache.set(cacheKey, summary);
            return summary;
        }
        return ''; // not cached — a transient failure can retry on the next open
    }, function () { return ''; });
}


// The routine's closing summary comes in three parts: a one-sentence verdict, a
// line beginning exactly `Follow-ups:`, then a blank line and the full detail
// paragraph. Split on the `Follow-ups:` LABEL rather than on paragraph position, so
// a verdict that wraps across several lines still resolves cleanly: everything up to
// and including that line is the collapsed content, and everything after the blank
// line that follows it is the detail. Returns null when no `Follow-ups:` line is
// present — the caller then treats the whole summary as detail and clamps it as
// before, rather than guessing a split point that could hide content. Pure.
function splitRunSummary(text) {
    const lines = text.split('\n');
    let fi = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*Follow-ups:/i.test(lines[i])) { fi = i; break; }
    }
    if (fi === -1) return null;
    const verdict = lines.slice(0, fi).join('\n').trim();
    const followupsLine = lines[fi].trim();
    // Skip the blank line(s) separating the follow-ups line from the detail paragraph.
    let di = fi + 1;
    while (di < lines.length && lines[di].trim() === '') di += 1;
    const detail = lines.slice(di).join('\n').trim();
    const followContent = followupsLine.replace(/^Follow-ups:/i, '').trim();
    const isNone = /^none\.?$/i.test(followContent);
    return { verdict, followupsLine, detail, isNone };
}

// Build the "WHAT THE RUN REPORTED" block for the review surface — the run's own
// closing summary, rendered as a distinct block labelled as the run's report rather
// than as part of the entry (the WHAT CHANGED card, by contrast, shows the entry's
// Description line). Returns null when there is no summary, so the caller mounts
// nothing rather than an empty block.
//
// When the summary matches the routine's three-part shape (splitRunSummary), the
// collapsed card shows the verdict sentence and the `Follow-ups:` line — enough to
// glance at whether the run flagged anything — with the detail paragraph behind a
// Show more / Show less toggle. `Follow-ups: none.` renders at reduced emphasis so a
// bare "nothing to see" reads differently from a line carrying real content. When
// the summary does NOT match that shape (older runs, or any run that deviates), the
// whole thing renders in the body clamped to a few lines, with the toggle revealed
// by clampRunReportBlock only when the clamped body actually overflows — the prior
// behavior, preserved as the fallback.
export function buildRunReportBlock(summaryText) {
    const text = String(summaryText == null ? '' : summaryText).trim();
    if (!text) return null;
    const block = document.createElement('div');
    block.className = 'descRunReportBlock';

    const heading = document.createElement('span');
    heading.className = 'descRunReportHeading';
    heading.textContent = 'What the run reported';
    block.appendChild(heading);

    function makeToggle() {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'descRunReportToggle';
        toggle.textContent = 'Show more';
        toggle.addEventListener('click', function (e) {
            e.stopPropagation();
            const expanded = block.classList.toggle('is-expanded');
            toggle.textContent = expanded ? 'Show less' : 'Show more';
        });
        return toggle;
    }

    const parts = splitRunSummary(text);
    if (parts) {
        block.classList.add('descRunReportBlock--split');

        const verdictEl = document.createElement('p');
        verdictEl.className = 'descRunReportBody';
        verdictEl.textContent = parts.verdict;
        block.appendChild(verdictEl);

        const followEl = document.createElement('p');
        followEl.className = 'descRunReportFollowups';
        if (parts.isNone) followEl.classList.add('is-none');
        followEl.textContent = parts.followupsLine;
        block.appendChild(followEl);

        // The detail paragraph is optional — a three-part summary with an empty
        // detail shows verdict + follow-ups with no toggle rather than a dead control.
        if (parts.detail) {
            const detailEl = document.createElement('p');
            detailEl.className = 'descRunReportDetail';
            detailEl.textContent = parts.detail;
            block.appendChild(detailEl);

            block.appendChild(makeToggle());
        }
        return block;
    }

    const bodyEl = document.createElement('p');
    bodyEl.className = 'descRunReportBody';
    bodyEl.textContent = text;
    block.appendChild(bodyEl);

    const toggle = makeToggle();
    toggle.hidden = true;
    block.appendChild(toggle);

    return block;
}

// Reveal the Show more toggle only when the clamped body overflows its line clamp.
// Must run after the block is in the document (clientHeight/scrollHeight need
// layout). A short summary keeps the toggle hidden. No-op for a split block: its
// toggle governs the detail paragraph, whose visibility is fixed at build time, not
// the clamped body's overflow.
function clampRunReportBlock(block) {
    if (!block || block.classList.contains('descRunReportBlock--split')) return;
    const bodyEl = block.querySelector('.descRunReportBody');
    const toggle = block.querySelector('.descRunReportToggle');
    if (!bodyEl || !toggle) return;
    toggle.hidden = !(bodyEl.scrollHeight - bodyEl.clientHeight > 1);
}

// Async-mount the run-report block into `host`, immediately before `anchor` when
// that anchor is still a child of `host` (else appended). Fetches the shipped run's
// closing summary and mounts the block ONLY once a non-empty summary resolves — a
// missing summary or a failed fetch mounts nothing, never an empty block or an
// error. Idempotent by entry key: a block already mounted for this entry is left in
// place. Because the fetch is async, it re-checks before mounting that the ACCEPT
// face for this same entry is still present (the task may have been accepted or the
// panel reused for another entry while the fetch was in flight) and drops the result
// otherwise. options.onRender fires after a successful mount so the desktop pane can
// re-snapshot its expanded height (the block arrives after the initial paint).
export function mountRunReportBlock(host, item, queueRow, anchor, options) {
    if (!host) return Promise.resolve(null);
    const opts = options || {};
    const entryKey = String((item && (item.entryId || item.id)) || '');
    const existing = host.querySelector('.descRunReportBlock');
    if (existing && existing.getAttribute('data-run-report-entry') === entryKey) {
        return Promise.resolve(existing);
    }
    if (existing) existing.remove();
    return fetchShippedRunSummary(item, queueRow).then(function (summary) {
        if (!summary) return null;
        // The ACCEPT face for this entry must still be mounted — if it was accepted
        // (moved to done) or the panel was reused for a different entry while the
        // fetch was in flight, drop the stale summary rather than mounting it.
        const actions = host.querySelector('.descReviewActions');
        if (!actions || actions.getAttribute('data-review-entry') !== entryKey) return null;
        const dupe = host.querySelector('.descRunReportBlock');
        if (dupe) dupe.remove();
        const block = buildRunReportBlock(summary);
        if (!block) return null;
        block.setAttribute('data-run-report-entry', entryKey);
        if (anchor && anchor.parentNode === host) host.insertBefore(block, anchor);
        else host.appendChild(block);
        clampRunReportBlock(block);
        if (typeof opts.onRender === 'function') opts.onRender();
        return block;
    });
}


// Copy the iterate context block to the clipboard, confirming with the shared row
// toast. Mirrors copyTitleToClipboard's two-tier path: navigator.clipboard.writeText
// when available — guarded by BOTH a try/catch for a synchronous throw AND a
// .catch for a rejected promise — falling back to selecting the text in a temporary
// element and execCommand('copy') so a manual copy still works from a user gesture.
// Every terminal path says what happened in the toast rather than failing silently.
function copyIterateContext(text) {
    function fallback() {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            ta.style.pointerEvents = 'none';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand && document.execCommand('copy');
            document.body.removeChild(ta);
            showRowToast(ok
                ? 'Copied context for iterating'
                : 'Couldn’t copy — select and copy the block manually');
        } catch (e) {
            showRowToast('Couldn’t copy — select and copy the block manually');
        }
    }
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
            navigator.clipboard.writeText(text)
                .then(function () { showRowToast('Copied context for iterating'); })
                .catch(fallback);
            return;
        } catch (e) { /* synchronous throw — fall through to the temp-element path */ }
    }
    fallback();
}


// Keep a row's open detail pane in sync with its ACCEPT phase — mounts the WHAT
// CHANGED card and the accept/revert/open action row when the row's derived phase
// is `accept` (shipped but unacknowledged), and removes both in every other phase.
// DESKTOP-ONLY: gated on detail-pane mode so nothing mounts on mobile, where the
// description-editor modal keeps its single route action (inlining these controls
// would push the authoring region below the fold in a 92vh-capped dialog). Mirrors
// syncDispatchPanel: open-panel guard, idempotent early return (keep the mounted
// controls if they already point at this entry so a live sweep doesn't drop an
// in-flight Revert button), and a refreshViewerExpandedHeight() on add and remove.
// Repaints live off the same refreshDescStatusDots sweep (TODO_RUN_STATUS_EVENT +
// onQueueChange), so accepting from the viewer on another device clears it here.
// NOT part of DESC_AUTHORING_GROUP_SELECTORS — accepting is what moves a task INTO
// `done`, so sweeping these in would make them vanish mid-interaction.
function syncReviewPanel(toDoChild, item, projectName) {
    if (!isDetailPaneMode()) return;
    const panel = openDescSiblingFor(toDoChild);
    if (!panel) return;
    const existingBlock = panel.querySelector('.descReviewBlock');
    const existingActions = panel.querySelector('.descReviewActions');
    const existingEntryView = panel.querySelector('.descReviewEntryView');
    const phase = item && item.id ? derivePhase(item) : PHASE.NONE;
    const wantReview = phase === PHASE.ACCEPT;
    if (!wantReview) {
        let changed = false;
        if (existingBlock) { existingBlock.remove(); changed = true; }
        if (existingActions) { existingActions.remove(); changed = true; }
        if (existingEntryView) { existingEntryView.remove(); changed = true; }
        if (changed) refreshViewerExpandedHeight();
        return;
    }
    const entryKey = String(item.entryId || item.id);
    if (existingActions && existingActions.getAttribute('data-review-entry') === entryKey) {
        // Same entry already mounted — leave the controls (and any in-flight
        // Revert) untouched so a repaint doesn't thrash the DOM.
        return;
    }
    if (existingBlock) existingBlock.remove();
    if (existingActions) existingActions.remove();
    if (existingEntryView) existingEntryView.remove();
    const queueRow = getQueueRowForTodo(item.id);
    // Both mount immediately after the phase rail (via descPanelTopAnchor): the
    // WHAT CHANGED card first, the action row right after it.
    const anchor = descPanelTopAnchor(panel);
    panel.insertBefore(buildReviewBlock(item, queueRow), anchor);
    const reviewActions = buildReviewActions(item, projectName);
    panel.insertBefore(reviewActions, anchor);
    // The read-only entry fills the pane's flex-fill middle — the slot the hidden
    // textarea occupies in every other phase. descPanelBottomAnchor lands it ABOVE
    // the docked footer (a plain append would drop it below the pinned stack), so it
    // takes the editor's place between the review furniture and the footer. Mounted
    // and torn down by this same branch as the review card, so leaving `accept`
    // restores the normal editor with no leftovers.
    const entryView = buildReviewEntryView(item);
    if (entryView) panel.insertBefore(entryView, descPanelBottomAnchor(panel));
    refreshViewerExpandedHeight();
    // The run's closing summary is fetched async and mounted BETWEEN the WHAT
    // CHANGED card and the action row once (if) it resolves — a run with none, or a
    // failed fetch, mounts nothing and never blocks the decision controls.
    mountRunReportBlock(panel, item, queueRow, reviewActions, { onRender: refreshViewerExpandedHeight });
}


// ── MOCKUP-PHASE FLOW (DETAIL PANE) ──────────────────────────────────────
// A task in the `mockup` phase (its linked agent_queue row is in needs_mockup)
// needs a visual direction chosen before its entry can be authored. The A/B/C
// mockup flow — the SAME buildMockupSecondary the Agent board mounts — now mounts
// in the desktop detail pane, above the authoring region, laid out three variants
// across (options.grid) so all three previews are visible at once. Choosing one
// produces its finished entry and moves the row to `drafted` exactly as the board
// does; the shared _mockupVariants cache means variants generated on either surface
// show on the other.

// Build the mockup block: a short intro naming why a direction is needed, above
// the shared flow. `options.grid` lays the three previews across and scales each
// to fit its narrow tile; `options.onRender` re-snapshots the expanded-viewer
// height when variants (re)render (three tiles are much taller than the empty
// Generate state), both routed through the one shared renderer so the pane and the
// board never diverge.
function buildMockupPanelBlock(queueRow) {
    const block = document.createElement('div');
    block.className = 'descMockupBlock';
    block.setAttribute('data-mockup-row', String(queueRow.id));

    const intro = document.createElement('p');
    intro.className = 'descMockupIntro';
    intro.textContent = 'Triage needs a visual direction before this entry can be written. '
        + 'Generate A/B/C mockups, then choose one to finish the entry.';
    block.appendChild(intro);

    block.appendChild(buildMockupSecondary(queueRow, {
        grid: true,
        onRender: refreshViewerExpandedHeight,
    }));
    return block;
}

// Keep a row's open detail pane in sync with its MOCKUP phase — mounts the block
// when the row's derived phase is `mockup`, and removes it in every other phase.
// DESKTOP-ONLY: gated on detail-pane mode so nothing mounts on mobile, where three
// variants across at phone width is unusable and the flow has no home yet (the
// Agent board stays the mobile route until a mobile arrangement ships — see the
// entry's Out of scope). Mirrors syncReviewPanel / syncDispatchPanel: open-panel
// guard, idempotent early return (keep the mounted block if it already points at
// this queue row so a live sweep doesn't drop an in-flight Generate / rendered
// previews), and a refreshViewerExpandedHeight() on add and remove. Repaints live
// off the same refreshDescStatusDots sweep (TODO_RUN_STATUS_EVENT + onQueueChange),
// so the block appears, updates, and clears as the row moves needs_mockup → drafted
// while the pane is open. NOT part of DESC_AUTHORING_GROUP_SELECTORS: `mockup` is
// never the terminal `done` / `accept` phase, so applyPhaseLayout never sweeps it,
// and the authoring region stays visible beneath it (the entry isn't written yet).
function syncMockupPanel(toDoChild, item) {
    if (!isDetailPaneMode()) return;
    const panel = openDescSiblingFor(toDoChild);
    if (!panel) return;
    const existing = panel.querySelector('.descMockupBlock');
    const phase = item && item.id ? derivePhase(item) : PHASE.NONE;
    const queueRow = phase === PHASE.MOCKUP ? getQueueRowForTodo(item.id) : null;
    if (!queueRow) {
        if (existing) {
            existing.remove();
            refreshViewerExpandedHeight();
        }
        return;
    }
    if (existing) {
        // Same queue row already mounted — leave the block (and any in-flight
        // Generate / rendered previews) untouched so a repaint doesn't thrash it.
        if (existing.getAttribute('data-mockup-row') === String(queueRow.id)) return;
        existing.remove();
    }
    // Mount immediately after the phase rail (via descPanelTopAnchor), above the
    // authoring region — matching where ASKING / STUCK / REVIEW lead the panel.
    panel.insertBefore(buildMockupPanelBlock(queueRow), descPanelTopAnchor(panel));
    refreshViewerExpandedHeight();
}


// ── TRIAGE-RUNNING BLOCK ─────────────────────────────────────────────────
// While a derive is in flight (the linked agent_queue row sits in `triaging`)
// the panel's entry region is REPLACED by a dedicated running block — a "TRIAGE
// RUNNING" heading, a live elapsed clock, an indeterminate activity bar, and a
// spend line naming which budget the run draws on — instead of only swapping the
// Generate button's label to "Generating…". The block is driven ENTIRELY by the
// queue row's state via the shared store's per-todo lookup: no second pending
// store, no localStorage key, no give-up timer — the row IS the state, so a
// close-and-reopen (or a dispatch from another device) shows it still running
// with the clock continuing. The Generate control is not shown separately in this
// state (syncGenerateControl hides the desktop panel button while triaging); the
// block is the state.

// Resolve the timestamp the elapsed clock counts up from. Prefers a
// state-transition timestamp (`updated_at`) when the schema carries one, since it
// bumps on a re-triage and so stays correct across the answer → triaging loop.
// Falls back to `created_at`, which equals dispatch time ONLY for a first
// Generate (it is stale after a re-triage). When only `created_at` is available
// and the row has been answered (a non-empty `thread` marks a re-triage), the
// elapsed would be misleading, so returns null and the block renders with no
// clock rather than a wrong one.
export function resolveTriageStart(row) {
    if (!row) return null;
    const iso = row.updated_at || row.created_at || null;
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!isFinite(t)) return null;
    const answered = Array.isArray(row.thread) && row.thread.length > 0;
    if (!row.updated_at && answered) return null;
    return t;
}

// Format an elapsed millisecond span as m:ss (minutes uncapped so a long run
// reads 74:05 rather than wrapping). Never negative.
export function formatTriageElapsed(ms) {
    const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return String(m) + ':' + String(s).padStart(2, '0');
}

// Repaint the block's elapsed label from its recorded start (data-triage-start).
// Hides the label when there is no start (the re-triage-without-a-transition-
// timestamp case), so the block shows without a misleading clock.
function paintTriageElapsed(block) {
    if (!block) return;
    const el = block.querySelector('.descTriageElapsed');
    if (!el) return;
    const startAttr = block.getAttribute('data-triage-start');
    const start = startAttr != null && startAttr !== '' ? Number(startAttr) : NaN;
    if (!isFinite(start)) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = formatTriageElapsed(Date.now() - start);
}

// Start the block's client-side clock (a 1s setInterval), idempotently — a block
// whose timer is already running, or which carries no start timestamp, is left
// alone. The tick self-terminates once the block is detached (any panel-close
// path removes #descSibling from the document), a belt-and-suspenders guard
// against a leaked interval ticking on a rebuilt/closed panel; clearTriageClock
// clears it explicitly on unmount and on close.
function startTriageClock(block) {
    if (!block || block._triageTimer) return;
    const startAttr = block.getAttribute('data-triage-start');
    if (startAttr == null || startAttr === '') return;
    paintTriageElapsed(block);
    if (typeof setInterval !== 'function') return;
    block._triageTimer = setInterval(function () {
        if (!block.isConnected) {
            clearInterval(block._triageTimer);
            block._triageTimer = null;
            return;
        }
        paintTriageElapsed(block);
    }, 1000);
}

// Clear the block's clock. Accepts either the block itself or a panel to search
// within, so callers can pass #descSibling directly (the close path).
function clearTriageClock(scope) {
    if (!scope) return;
    const block = scope.classList && scope.classList.contains('descTriageBlock')
        ? scope
        : (scope.querySelector ? scope.querySelector('.descTriageBlock') : null);
    if (block && block._triageTimer) {
        clearInterval(block._triageTimer);
        block._triageTimer = null;
    }
}

// Build the TRIAGE RUNNING block. Styled with the panel's existing SpaceMono
// uppercase treatment and accent tokens; the spend line reuses the Max-plan-quota
// wording the Generate control already carries.
function buildTriageBlock(row) {
    const block = document.createElement('div');
    block.className = 'descTriageBlock';
    block.setAttribute('role', 'status');
    block.setAttribute('data-triage-row', String(row.id));

    const heading = document.createElement('span');
    heading.className = 'descTriageHeading';
    heading.textContent = 'Triage running';
    block.appendChild(heading);

    const meta = document.createElement('div');
    meta.className = 'descTriageMeta';

    const bar = document.createElement('div');
    bar.className = 'descTriageBar';
    bar.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('span');
    fill.className = 'descTriageBarFill';
    bar.appendChild(fill);
    meta.appendChild(bar);

    const elapsed = document.createElement('span');
    elapsed.className = 'descTriageElapsed';
    elapsed.setAttribute('aria-live', 'off');
    elapsed.hidden = true;
    meta.appendChild(elapsed);

    block.appendChild(meta);

    const spend = document.createElement('p');
    spend.className = 'descTriageSpend';
    spend.textContent = 'Runs on Actions — spends your Max-plan quota. Nothing waits on it.';
    block.appendChild(spend);

    return block;
}

// Hide the entry region's textarea and File: picker while triage runs, so a
// landing draft can't overwrite text typed mid-flight. Uses the `[hidden]`
// attribute (never inline display) so it composes with applyPhaseLayout /
// applyAuthoringMode rather than fighting them: those run BEFORE syncTriageBlock
// at every call site, establishing the base visibility, and this re-asserts the
// triage hide on top — so when the run completes and this stops hiding, the base
// gates (applyAuthoringMode restoring WRITE's textarea) govern again.
function hideEntryRegionForTriage(panel) {
    if (!panel) return;
    const descInput = panel.querySelector('#descInput');
    const trigger = panel.querySelector('.filePickTrigger');
    const pickPanel = panel.querySelector('.filePickPanel');
    if (descInput) descInput.hidden = true;
    if (trigger) trigger.hidden = true;
    if (pickPanel) pickPanel.hidden = true;
}

// Keep a row's open description panel in sync with its `triaging` state — mounts
// the TRIAGE RUNNING block (and hides the entry region) when the linked queue row
// is in `triaging`, and removes it (clearing the clock) otherwise. Mirrors
// syncAskingPanel / syncDispatchPanel: open-panel guard, idempotent early return
// (keep the mounted block and its live clock when it already matches this run so a
// repaint doesn't reset the timer), and a refreshViewerExpandedHeight() on add and
// remove. Repaints live off the same onQueueChange sweep, so the block appears and
// clears as the row enters / leaves `triaging` while the panel is open. Runs AFTER
// applyAuthoringMode at every call site so its entry-region hide wins.
export function syncTriageBlock(toDoChild, item) {
    const panel = openDescSiblingFor(toDoChild);
    if (!panel) return;
    const existing = panel.querySelector('.descTriageBlock');
    const row = item && item.id ? getQueueRowForTodo(item.id) : null;
    const wantTriage = !!(row && row.state === 'triaging');
    if (wantTriage) {
        if (existing) {
            // Same run — keep the mounted block and its live clock (restart it if a
            // close cleared the interval), and re-assert the entry-region hide that
            // applyAuthoringMode may have un-done on this sweep.
            if (existing.getAttribute('data-triage-row') === String(row.id)) {
                startTriageClock(existing);
                hideEntryRegionForTriage(panel);
                return;
            }
            clearTriageClock(existing);
            existing.remove();
        }
        const block = buildTriageBlock(row);
        const startMs = resolveTriageStart(row);
        if (startMs != null) block.setAttribute('data-triage-start', String(startMs));
        // Sits where the entry region is — before the File: picker trigger /
        // textarea it replaces. Falls back to the panel's end, above the docked
        // footer stack (descPanelBottomAnchor) rather than below it.
        const anchor = panel.querySelector('.filePickTrigger') || panel.querySelector('#descInput');
        if (anchor) panel.insertBefore(block, anchor);
        else panel.insertBefore(block, descPanelBottomAnchor(panel));
        startTriageClock(block);
        hideEntryRegionForTriage(panel);
        refreshViewerExpandedHeight();
    } else if (existing) {
        clearTriageClock(existing);
        existing.remove();
        refreshViewerExpandedHeight();
    }
}


// Mount the shared File:-path picker into an OPEN description panel — the desktop
// counterpart to the mobile modal's picker (both build it through
// createFilePicker so the search filter, insertion logic, and manifest read are
// one implementation). The trigger chip sits above the textarea; its searchable
// panel drops in below it. Both are full-width in the panel's three-column grid
// via `#descSibling .filePickTrigger` / `.filePickPanel` — an auto-placed child
// would land in a 14px gutter, the same defect that crushed .askingBlock. The
// picker self-hides only when the project has no linked repo; otherwise the chip
// is present and the file list loads on demand the first time it opens. Called
// on every panel open (the panel is rebuilt by wireDescToggle each time), so the
// shown/hidden state is re-derived fresh. After a pick, persist through the same
// listLogic path descInput's own handlers use, refresh the inject button (a
// previously-empty description may now be non-empty), and recompute the viewer
// height since mounting the File: line shifts every row below. onRender does the
// same height recompute after the picker's own list (re)paints — the loading
// state and the populated list are different heights, so the panel shifts every
// row below it when the on-demand load resolves.
export function mountDescFilePicker(descSibling, descInput, item, projectName, injectBtn) {
    // Idempotent across reopens — drop any prior picker so opens don't stack duplicates.
    descSibling.querySelectorAll('.filePickTrigger, .filePickPanel').forEach(function (el) {
        el.remove();
    });
    const picker = createFilePicker({
        projectName: projectName || '',
        textarea: descInput,
        onInsert: function () {
            item.desc = descInput.value;
            listLogic.saveToStorage();
            if (projectName) listLogic.editToDoItem(projectName, item);
            if (injectBtn) refreshInjectButton(injectBtn, item, projectName);
            refreshViewerExpandedHeight();
        },
        onRender: function () {
            refreshViewerExpandedHeight();
        },
    });
    descSibling.insertBefore(picker.trigger, descInput);
    // The searchable panel is the "filter row" of the docked footer stack, so it
    // leads that wrapper (filter → actions → FILE → status). On a panel with no
    // footer (a bare test panel, or a host that never built one) it falls back to
    // its historic slot directly below the textarea. Placement in the pane comes
    // from the footer's flex column, and in the mobile grid host from the panel's
    // grid-column rules — this only sets DOM order.
    const footer = descPanelFooterHost(descSibling);
    if (footer) footer.insertBefore(picker.panel, footer.firstChild);
    else descSibling.insertBefore(picker.panel, descInput.nextSibling);
}


// ── READ-ONLY FILE READOUT ───────────────────────────────────────────────
// A read-only mirror of the entry's `- File:` line, sitting beneath the actions
// row so the target the entry will act on is visible without scrolling the
// textarea. The entry text is the single source of truth — this readout is never
// the source, only a reflection. It is a #descSibling grid child (grid-column: 2,
// aligning with the textarea) and is registered in DESC_PANEL_CHILD_SELECTORS.

// Build the readout's DOM once (a FILE label above a paths container). Populated
// by refreshFileReadout, which is called on mount and on every entry-text edit.
export function buildFileReadout() {
    const block = document.createElement('div');
    block.className = 'descFileReadout';
    const label = document.createElement('span');
    label.className = 'descFileReadoutLabel';
    label.textContent = 'File';
    const paths = document.createElement('div');
    paths.className = 'descFileReadoutPaths';
    block.appendChild(label);
    block.appendChild(paths);
    return block;
}

// Repaint the readout from the current entry text, parsed with the SAME matcher
// the picker inserts with (parseFilePathsFromEntry), so the readout can never
// disagree with what a pick writes. One path per line; a "no target set" note
// when the entry names none. No-op when the panel carries no readout (a blank
// placeholder, or a closed panel). Cheap enough to run on every keystroke — the
// height is only re-measured when the rendered path set actually changes, so a
// keystroke that doesn't touch the File: line does no layout work.
export function refreshFileReadout(descSibling, text) {
    if (!descSibling) return;
    const readout = descSibling.querySelector('.descFileReadout');
    if (!readout) return;
    const paths = parseFilePathsFromEntry(text);
    const signature = paths.join('\n');
    if (readout.getAttribute('data-paths') === signature) return;
    readout.setAttribute('data-paths', signature);
    const list = readout.querySelector('.descFileReadoutPaths');
    if (!list) return;
    list.textContent = '';
    if (!paths.length) {
        const none = document.createElement('span');
        none.className = 'descFileReadoutEmpty';
        none.textContent = 'No target set';
        list.appendChild(none);
    } else {
        paths.forEach(function (p) {
            const line = document.createElement('span');
            line.className = 'descFileReadoutPath';
            line.textContent = p;
            list.appendChild(line);
        });
    }
    refreshViewerExpandedHeight();
}


// ── WRITE / PASTE / GENERATE AUTHORING MODE STRIP ────────────────────────
// A three-segment strip above the entry region grouping the three ways an entry
// gets written: WRITE (today's textarea + File: picker), PASTE (parse a pasted
// entry into the open task), and GENERATE (render the agent's triage state large,
// with a dispatch / cancel). The strip is built by the shared authoringModeStrip
// module so the mobile modal can adopt it later without a second implementation.
// The mode is transient view state — never persisted per task — reset to WRITE on
// every open (see mountAuthoringModeStrip). Switching modes never touches the
// entry text: it only shows / hides entry-region bodies, so the textarea keeps its
// value across switches.

// Apply one authoring mode's entry-region visibility to an open panel. The strip
// and Inject / Discuss / MANUAL STATUS always stay (Inject/Discuss/status are not
// touched here — they show in every mode). This governs which entry-region body
// is shown for the active mode:
//   write    — the textarea + File: picker trigger + Generate (today's panel).
//   paste    — the paste field + Parse; textarea, picker, Generate hidden.
//   generate — the triage state body; textarea, picker, Generate hidden.
// Runs AFTER applyPhaseLayout at every call site (mount + live sweep): in a
// non-`done` phase applyPhaseLayout un-hides the whole authoring group and this
// re-hides the two inactive-mode elements; in `done` applyPhaseLayout hides
// everything and this is skipped, so the group stays hidden. Uses the [hidden]
// attribute (never inline display) so it composes with syncGenerateControl's own
// display gating, exactly as applyPhaseLayout does. Records the active mode on the
// panel (data-author-mode) so a live repaint can re-assert it with no state kept
// elsewhere. The File: picker trigger shows in WRITE only (no textarea to insert a
// path into in the other modes).
export function applyAuthoringMode(descSibling, mode) {
    if (!descSibling) return;
    const m = (mode === 'paste' || mode === 'generate') ? mode : 'write';
    descSibling.dataset.authorMode = m;
    const isWrite = m === 'write';
    setAuthoringModeStripActive(descSibling.querySelector('.descModeStrip'), m);
    const descInput = descSibling.querySelector('#descInput');
    const trigger = descSibling.querySelector('.filePickTrigger');
    const pickPanel = descSibling.querySelector('.filePickPanel');
    const genBtn = descSibling.querySelector('.generateBtn');
    const pasteBody = descSibling.querySelector('.descPasteBody');
    const genBody = descSibling.querySelector('.descGenerateBody');
    if (descInput) descInput.hidden = !isWrite;
    if (trigger) trigger.hidden = !isWrite;
    // Force-close the picker's searchable panel away from WRITE; in WRITE its own
    // open/close toggle governs, so leave it alone there.
    if (pickPanel && !isWrite) pickPanel.hidden = true;
    if (genBtn) genBtn.hidden = !isWrite;
    if (pasteBody) pasteBody.hidden = m !== 'paste';
    if (genBody) genBody.hidden = m !== 'generate';
}


// Parse a pasted entry and write it into the OPEN task's description — reusing the
// shared parser (entryParse.parsePastedEntry) and the same listLogic description
// path descInput's blur handler uses. Unlike the compose-row paste chip's
// commitEntryToActiveProject, this NEVER creates a new task: it fills the current
// item's desc, mirrors it into the live textarea (firing auto-grow), and
// re-evaluates Inject. Reports the recognised fields, then returns the panel to
// WRITE with the entry populated for review. Guards the empty case.
function applyPastedEntryToOpenTask(descSibling, descInput, item, projectName, injectBtn, raw, reportEl) {
    const parsed = parsePastedEntry(raw);
    if (!parsed.title && !(parsed.description || '').trim()) {
        if (reportEl) {
            reportEl.textContent = 'Nothing to parse — paste an entry first.';
            reportEl.hidden = false;
        }
        return;
    }
    item.desc = parsed.description;
    listLogic.saveToStorage();
    if (projectName) listLogic.editToDoItem(projectName, item);
    if (descInput) {
        descInput.value = parsed.description;
        // Auto-grow reads scrollHeight off the synthetic input event.
        descInput.dispatchEvent(new Event('input'));
    }
    if (injectBtn) refreshInjectButton(injectBtn, item, projectName);

    const fields = recognizedEntryFields(raw);
    const summary = fields.length
        ? 'Recognised: ' + fields.join(', ')
        : 'Entry filled — no labelled fields recognised.';
    if (reportEl) {
        reportEl.textContent = summary;
        reportEl.hidden = false;
    }
    showRowToast(summary);
    // Return to WRITE with the entry populated for review.
    applyAuthoringMode(descSibling, 'write');
    refreshViewerExpandedHeight();
}


// Build the PASTE mode body — a paste field + Parse action driving
// applyPastedEntryToOpenTask. Hidden unless PASTE is the active mode.
function buildPasteBody(descSibling, descInput, item, projectName, injectBtn) {
    const body = document.createElement('div');
    body.className = 'descPasteBody';
    body.hidden = true;

    const input = document.createElement('textarea');
    input.className = 'descPasteInput';
    input.rows = 4;
    input.placeholder = 'Paste a TODO.md entry here…';
    input.setAttribute('aria-label', 'Paste an entry');
    // 16px avoids iOS Safari's focus auto-zoom (per the mobile input convention).
    input.style.fontSize = '16px';
    input.spellcheck = false;
    input.setAttribute('autocorrect', 'off');
    input.autocapitalize = 'off';
    input.addEventListener('click', function(e) { e.stopPropagation(); });
    body.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'descPasteActions';

    const report = document.createElement('p');
    report.className = 'descPasteReport';
    report.setAttribute('role', 'status');
    report.hidden = true;
    actions.appendChild(report);

    const parseBtn = document.createElement('button');
    parseBtn.type = 'button';
    parseBtn.className = 'descPasteParse';
    parseBtn.textContent = 'Parse';
    actions.appendChild(parseBtn);
    body.appendChild(actions);

    parseBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        applyPastedEntryToOpenTask(descSibling, descInput, item, projectName, injectBtn, input.value, report);
    });

    return body;
}


// Build the GENERATE mode body — renders the linked agent_queue row's triage
// state LARGER (the mode does NOT own the state; the queue row is the state, and
// derivePhase already returns `drafted` when a draft lands). While a run is live
// it shows an in-flight line + a Cancel that returns to WRITE (the run keeps going
// and its draft lands into the textarea when ready); when idle it shows a one-line
// explanation + a Dispatch that triggers the EXISTING Generate path by clicking
// the panel's own Generate button — no second trigger, no second pending store.
// Its content is (re)painted by syncGenerateBody. Hidden unless GENERATE is active.
function buildGenerateBody(generateBtn) {
    const body = document.createElement('div');
    body.className = 'descGenerateBody';
    body.hidden = true;

    const state = document.createElement('p');
    state.className = 'descGenerateState';
    body.appendChild(state);

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'descGenerateAction';
    action.addEventListener('click', function(e) {
        e.stopPropagation();
        if (action.getAttribute('data-action') === 'cancel') {
            // Dismiss the generate view; the live run keeps going and lands into
            // the textarea when the draft is ready.
            const panel = body.closest('#descSibling') || body.parentNode;
            applyAuthoringMode(panel, 'write');
            refreshViewerExpandedHeight();
            return;
        }
        // Dispatch: reuse the existing Generate trigger (no second trigger).
        if (generateBtn) generateBtn.click();
    });
    body.appendChild(action);

    return body;
}


// Repaint the GENERATE mode body from the task's linked agent_queue row so it
// reflects the live triage state. No-op when the body isn't mounted. Reads the
// shared store synchronously, exactly as syncGenerateControl does.
export function syncGenerateBody(descSibling, item, projectName) {
    if (!descSibling) return;
    const body = descSibling.querySelector('.descGenerateBody');
    if (!body) return;
    const state = body.querySelector('.descGenerateState');
    const action = body.querySelector('.descGenerateAction');
    const row = item && item.id ? getQueueRowForTodo(item.id) : null;
    const generating = !!row && row.state === 'triaging';
    if (generating) {
        if (state) state.textContent = 'Generating an entry from this task…';
        if (action) {
            action.className = 'descGenerateAction descGenerateAction--cancel';
            action.setAttribute('data-action', 'cancel');
            action.textContent = 'Cancel';
        }
    } else {
        if (state) state.textContent = 'Have the agent draft an entry from this task’s title and description.';
        if (action) {
            action.className = 'descGenerateAction';
            action.setAttribute('data-action', 'dispatch');
            action.textContent = 'Generate';
        }
    }
}


// Mount (idempotently) the WRITE / PASTE / GENERATE strip and its PASTE / GENERATE
// mode bodies into an OPEN description panel. #descSibling children survive a
// close, so drop any prior strip + bodies first (the file-picker duplication
// lesson) and rebuild — which also resets the transient mode to WRITE on every
// open. The strip leads the entry region (mounted after THE ENTRY label); the two
// mode bodies mount in the entry region beside the textarea. Every node carries an
// explicit grid-column (style.css) and is listed in DESC_PANEL_CHILD_SELECTORS.
// The caller applies the initial mode (applyAuthoringMode) AFTER applyPhaseLayout
// so it wins over the group un-hide.
export function mountAuthoringModeStrip(descSibling, descInput, item, projectName, injectBtn, generateBtn) {
    descSibling.querySelectorAll('.descModeStrip, .descPasteBody, .descGenerateBody')
        .forEach(function(el) { el.remove(); });

    const modeStrip = buildAuthoringModeStrip(function(mode) {
        applyAuthoringMode(descSibling, mode);
        if (mode === 'generate') syncGenerateBody(descSibling, item, projectName);
        refreshViewerExpandedHeight();
    });
    const pasteBody = buildPasteBody(descSibling, descInput, item, projectName, injectBtn);
    const generateBody = buildGenerateBody(generateBtn);

    // Strip leads the entry region: after THE ENTRY label when present (so the
    // phase rail + ASKING/STUCK blocks still lead the panel), else before the
    // textarea.
    const label = descSibling.querySelector('.descSiblingEntryLabel');
    descSibling.insertBefore(modeStrip, label ? label.nextSibling : descInput);
    // The mode bodies replace the textarea visually, so mount them right after it.
    descSibling.insertBefore(pasteBody, descInput.nextSibling);
    descSibling.insertBefore(generateBody, pasteBody.nextSibling);

    descSibling.dataset.authorMode = 'write';
}


// ── GENERATE-WITH-TRIAGE CONTROL ─────────────────────────────────────────
// A "Generate" action that sits beside Inject in a task's description panel.
// Tapping it flags the task for the agent (listLogic.flagTaskForAgent) and fires
// the SAME batch triage sweep the Agent board uses (fireTriageSweep), then the
// finished draft lands back into the task's description for review — Generate
// never injects, so derived text is always read before it becomes an entry.
//
// The control carries NO state of its own: the linked agent_queue row IS the
// state. `triaging` means generating (spinner shown, Inject disabled, textarea
// read-only); `drafted` means the draft is ready to land; `failed` / `no_change`
// are terminal. Every transition arrives through the shared store's realtime
// subscription, which re-derives the button on each push (see the sweep in
// refreshDescStatusDots). Both hosts — the desktop description panel and the
// mobile description-editor modal — build the button through makeGenerateButton
// and drive it through syncGenerateControl, so they share one code path.

// Sparkle glyph for the idle Generate action, and a spinner for the in-flight
// Generating… state. Inline SVG/markup matching the icon approach used across
// the row layer rather than importing an asset.
const GENERATE_GLYPH_SVG = '<svg class="generateBtnIcon" viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 1.5 L8.15 5.85 L12.5 7 L8.15 8.15 L7 12.5 L5.85 8.15 L1.5 7 L5.85 5.85 Z"/></svg>';

// Session-scoped set of agent_queue row ids whose finished draft has already
// been landed into a task description. A drafted row lingers in the store (the
// Agent board can still Dispatch it), so without this guard a later repaint —
// or a subsequent user edit to the description — would re-land the draft and
// clobber the edit. Keyed by queue-row id; the newly-landed row is never
// re-landed. Module-level so the desktop panel and the mobile modal, which can
// both observe the same drafted row, agree on landing it exactly once.
const landedGenerateDrafts = new Set();

// Paint the Generate button for one of its three visual states. 'idle' is the
// tappable accent-outlined action; 'generating' is a disabled spinner; 'hidden'
// removes it (no resolved inject target, or a queue row already owns the task's
// lifecycle). Idempotent enough to call on every store push.
function setGenerateVisual(btn, state) {
    if (!btn) return;
    if (state === 'hidden') {
        btn.style.display = 'none';
        btn.disabled = true;
        return;
    }
    btn.style.display = '';
    if (state === 'generating') {
        btn.disabled = true;
        btn.classList.add('is-generating');
        btn.innerHTML = '<span class="generateBtnSpinner" aria-hidden="true"></span><span class="generateBtnLabel">Generating…</span>';
        btn.setAttribute('aria-label', 'Generating an entry with the agent');
        btn.title = 'The agent is generating an entry from this task';
        return;
    }
    // idle
    btn.disabled = false;
    btn.classList.remove('is-generating');
    btn.innerHTML = GENERATE_GLYPH_SVG + '<span class="generateBtnLabel">Generate</span>';
    btn.setAttribute('aria-label', 'Generate an entry from this task with the agent');
    btn.title = 'Have the agent draft an entry from this task’s title and description';
}

// Mount (or refresh) a dismissible failure notice as a sibling directly after
// the Generate button, for a queue row that landed in `failed` / `no_change`.
// Dismissing it records the row id on the button so a subsequent store push for
// the SAME failed row doesn't re-surface it; a genuinely new failure (different
// row id) shows again. Kept idempotent — an existing notice for the same row is
// left in place with only its text refreshed.
// Resolve where a Generate-adjacent sibling (the failure notice) mounts. In the
// desktop panel the Generate button lives inside the `.descActionsRow` wrapper,
// but the failure notice is a full-width #descSibling grid child, so it must sit
// AFTER the wrapper, not inside it. In the mobile modal (no wrapper) it sits
// directly after the button as before.
function generateNoticeAnchor(btn) {
    const row = btn && btn.closest ? btn.closest('.descActionsRow') : null;
    if (row && row.parentNode) return { parent: row.parentNode, before: row.nextSibling };
    return { parent: btn ? btn.parentNode : null, before: btn ? btn.nextSibling : null };
}

function showGenerateFailure(btn, message, rowId) {
    if (!btn) return;
    const anchor = generateNoticeAnchor(btn);
    if (!anchor.parent) return;
    let notice = anchor.parent.querySelector('.generateFailure');
    if (notice && notice.getAttribute('data-generate-failure') === String(rowId)) {
        const text = notice.querySelector('.generateFailureText');
        if (text) text.textContent = message;
        return;
    }
    if (notice) notice.remove();
    notice = document.createElement('div');
    notice.className = 'generateFailure';
    notice.setAttribute('role', 'status');
    notice.setAttribute('data-generate-failure', String(rowId));

    const text = document.createElement('span');
    text.className = 'generateFailureText';
    text.textContent = message;
    notice.appendChild(text);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'generateFailureDismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', function(e) {
        e.stopPropagation();
        btn._genFailureDismissed = String(rowId);
        notice.remove();
        refreshViewerExpandedHeight();
    });
    notice.appendChild(dismiss);

    anchor.parent.insertBefore(notice, anchor.before);
    refreshViewerExpandedHeight();
}

// Remove any mounted failure notice for this button (the row left the failed
// state, or the panel is idle again).
function clearGenerateFailure(btn) {
    if (!btn) return;
    const anchor = generateNoticeAnchor(btn);
    if (!anchor.parent) return;
    const notice = anchor.parent.querySelector('.generateFailure');
    if (notice) {
        notice.remove();
        refreshViewerExpandedHeight();
    }
}

// Write a finished draft into the task's description through listLogic — the
// same persistence path descInput's blur handler uses (saveToStorage +
// editToDoItem so the Supabase mirror fires). Then hand the host a chance to
// reflect the text in its live editor and re-evaluate Inject. Never reads
// Actions output or a second derive pipeline — the draft is exactly the
// `agent_queue.draft` field the board renders behind its Dispatch gate.
function landGeneratedDraft(btn, item, projectName, row) {
    const draft = (row && typeof row.draft === 'string') ? row.draft : '';
    if (!draft) return;
    item.desc = draft;
    listLogic.saveToStorage();
    if (projectName) listLogic.editToDoItem(projectName, item);
    if (typeof btn._genOnLanded === 'function') {
        try { btn._genOnLanded(draft); } catch (e) { /* defensive */ }
    }
}

// Fire the Generate flow: flag the task for the agent, then kick the shared
// triage sweep. Mirrors the Agent board's flag path (flagTaskForAgent) plus the
// row ASKING answer path's sweep (fireTriageSweep) — one queue, one guard. The
// button is disabled immediately so a double-tap can't double-flag; the store's
// realtime push (and the explicit reload) then repaints it into Generating….
function onGenerateClick(btn) {
    if (!btn || btn.disabled) return;
    const item = btn._genItem;
    const projectName = btn._genProjectName || '';
    if (!item || !item.id) return;
    // A fresh Generate clears any stale dismissed-failure marker so a later
    // failure of THIS run can surface.
    btn._genFailureDismissed = null;
    clearGenerateFailure(btn);
    btn.disabled = true;
    setGenerateVisual(btn, 'generating');
    Promise.resolve(listLogic.flagTaskForAgent(item.id)).then(function(res) {
        if (!res || res.ok === false) {
            // Flag failed (offline, or the task is already queued) — return to
            // idle and surface the reason inline.
            setGenerateVisual(btn, 'idle');
            btn.disabled = false;
            showGenerateFailure(btn, (res && res.error) || 'Could not start. Try again.', 'flag-error');
            return;
        }
        // Reload the shared store so the new triaging row is visible even where
        // realtime isn't observed, then repaint every Generate control from the
        // fresh cache (the desktop badges + this button flip to Generating…).
        Promise.resolve(loadQueueRows(projectName)).then(refreshDescStatusDots);
        // Auto-fire the sweep now the row is queued — exactly as the board's Run
        // does, sharing the store's in-flight guard. The flag already succeeded,
        // so a failed dispatch only means a manual Run is needed; surface it as a
        // toast, never a block.
        Promise.resolve(fireTriageSweep(projectName)).then(function(tr) {
            if (tr && tr.ok === false) {
                showRowToast('Flagged, but triage didn’t start — Run it from the Agent tab.');
            }
        });
    }).catch(function() {
        setGenerateVisual(btn, 'idle');
        btn.disabled = false;
        showGenerateFailure(btn, 'Could not start. Try again.', 'flag-error');
    });
}

// Build a Generate button for a host (the desktop description panel or the
// mobile description-editor modal). `options.resolveInjectBtn` / `resolveTextarea`
// let the shared sync reach the host's paired controls (to disable Inject and
// make the textarea read-only while generating); `options.onLanded(draft)` lets
// the host reflect the landed text in its live editor. State is applied by
// syncGenerateControl — the caller syncs once after mounting, and the store's
// realtime sweep re-syncs on every push.
export function makeGenerateButton(item, options) {
    const opts = options || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'generateBtn';
    btn._genItem = item;
    btn._genProjectName = typeof opts.projectName === 'string' ? opts.projectName : '';
    btn._genResolveTextarea = typeof opts.resolveTextarea === 'function' ? opts.resolveTextarea : null;
    btn._genResolveInjectBtn = typeof opts.resolveInjectBtn === 'function' ? opts.resolveInjectBtn : null;
    btn._genOnLanded = typeof opts.onLanded === 'function' ? opts.onLanded : null;
    setGenerateVisual(btn, 'idle');
    btn.addEventListener('click', function(event) {
        event.stopPropagation();
        onGenerateClick(btn);
    });
    return btn;
}

// Re-derive one Generate button from its task's linked agent_queue row. Reads
// the shared store synchronously (getQueueRowForTodo), applies the three
// generating effects (spinner / Inject disabled / textarea read-only) only while
// the row sits in `triaging`, lands a `drafted` row's text exactly once, and
// surfaces a dismissible notice for a `failed` / `no_change` row. Hidden with no
// resolved inject target (matching Inject's no-target gate) or when a queue row
// already owns the task's lifecycle, since Generate never regenerates.
export function syncGenerateControl(btn) {
    if (!btn || !btn._genItem) return;
    const item = btn._genItem;
    const projectName = btn._genProjectName || '';
    const injectBtn = typeof btn._genResolveInjectBtn === 'function' ? btn._genResolveInjectBtn() : null;
    const textarea = typeof btn._genResolveTextarea === 'function' ? btn._genResolveTextarea() : null;

    const hasTarget = !!(item.id && projectName && listLogic.getProjectTargetId(projectName));
    const row = item.id ? getQueueRowForTodo(item.id) : null;
    const state = row ? row.state : null;
    const generating = state === 'triaging';

    // Read-only textarea + disabled Inject hold ONLY while triaging. Restore
    // Inject through its own refresh when leaving the generating state so it
    // returns to whatever state item.desc dictates.
    if (textarea) textarea.readOnly = generating;
    if (injectBtn) {
        if (generating) {
            injectBtn.disabled = true;
            injectBtn.classList.add('injectBtn--generating');
        } else if (injectBtn.classList.contains('injectBtn--generating')) {
            injectBtn.classList.remove('injectBtn--generating');
            refreshInjectButton(injectBtn, item, projectName);
        }
    }

    // Land a finished draft exactly once (guarded by the module-level set), then
    // fall through to the idle/hidden visuals below.
    if (state === 'drafted' && row && !landedGenerateDrafts.has(row.id)) {
        landedGenerateDrafts.add(row.id);
        landGeneratedDraft(btn, item, projectName, row);
    }

    // Dismissible failure notice for a terminal-failed row.
    if ((state === 'failed' || state === 'no_change') && btn._genFailureDismissed !== String(row.id)) {
        const reason = (row.failure_reason || '').trim();
        showGenerateFailure(btn, reason || (state === 'no_change'
            ? 'The agent didn’t produce an entry from this task.'
            : 'Couldn’t generate an entry — retry from the Agent tab.'), row.id);
    } else {
        clearGenerateFailure(btn);
    }

    // Visuals: while triaging, the desktop description panel shows the in-flight
    // state through the dedicated TRIAGE RUNNING block (syncTriageBlock), so the
    // Generate button is HIDDEN there rather than showing a "Generating…" label —
    // the block is the state. The mobile description-editor modal has no such
    // block, so its button keeps the Generating… label. Hidden when no target or
    // when a queue row already owns the lifecycle (drafted/failed/needs_words/
    // dispatched/…); the plain Generate action only in the true idle state.
    const inDescPanel = !!(btn.closest && btn.closest('#descSibling'));
    if (!hasTarget) {
        setGenerateVisual(btn, 'hidden');
    } else if (generating) {
        setGenerateVisual(btn, inDescPanel ? 'hidden' : 'generating');
    } else if (row) {
        setGenerateVisual(btn, 'hidden');
    } else {
        setGenerateVisual(btn, 'idle');
    }
}

// Re-sync every mounted Generate button in one pass — the desktop panels and,
// when open, the mobile modal's button (all `.generateBtn`). Driven by the same
// triggers that repaint the row badges, so a store push flips Generating… →
// landed / failed live without a re-render.
function syncAllGenerateControls() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.generateBtn').forEach(function(btn) {
        syncGenerateControl(btn);
    });
}


function applyRunStatusGlyph(descIndicator, phase) {
    if (!descIndicator) return;
    const state = glyphStateForPhase(phase);
    const current = descIndicator.classList.contains('runStatusGlyph--shipped')
        ? 'shipped'
        : descIndicator.classList.contains('runStatusGlyph--pending')
            ? 'pending'
            : '';
    // Idempotent — no-ops when the resolved state already matches so live
    // refreshes never thrash the DOM. The guard covers the empty state too, so
    // an 'accept' (or 'none') row's glyph is cleared exactly once and left alone
    // on every subsequent sweep.
    if (current === state) return;
    descIndicator.classList.remove('runStatusGlyph--shipped', 'runStatusGlyph--pending');
    if (!state) {
        descIndicator.innerHTML = '';
        return;
    }
    descIndicator.classList.add('runStatusGlyph--' + state);
    descIndicator.innerHTML = state === 'shipped' ? RUN_STATUS_SHIPPED_SVG : RUN_STATUS_PENDING_SVG;
}


// Re-evaluate every rendered row's run-status glyph in one pass, resolving
// each live `#descIndicator` back to its row's `__item`. Called on the
// run-status event so glyphs flip pending → shipped without a full re-render.
// Also kicks a shipped-marker refresh for every project with an injected entry
// on screen; the refresh is TTL-cached per repo (so repeated calls coalesce)
// and re-emits the run-status event when it resolves, re-running this sweep
// against the fresh cache to flip amber → green cross-device.
export function refreshDescStatusDots() {
    if (typeof document === 'undefined') return;
    const projectsToRefresh = new Set();
    document.querySelectorAll('#descIndicator').forEach(function(indicator) {
        const row = indicator.closest('#toDoChild');
        if (row && row.__item) {
            // One phase per row, computed once, drives BOTH the glyph and the
            // badge in the same pass so the two can never repaint out of step.
            const phase = derivePhase(row.__item);
            applyRunStatusGlyph(indicator, phase);
            // Refresh the derived badge alongside the glyph so a draft → accept
            // flip lights REVIEW, or a needs_words push lights ASKING, live and
            // without a re-render. Committed rows only — blank placeholders carry
            // no status label.
            if (row.querySelector('.todoStatusLabel')) {
                refreshTodoStatusUI(row, row.__item, overlayForPhase(phase));
            }
            // Repaint an open description panel's phase rail so a draft → accept
            // flip (or a queue-row transition) advances the rail live while the
            // panel is open. Runs before the ASKING/STUCK syncs so the rail is
            // present as their insertion anchor. No-op when the panel isn't open.
            const openPanel = openDescSiblingFor(row);
            if (openPanel) mountDescRail(openPanel, row.__item);
            // Keep an open description panel's ASKING question block in step with
            // the row's live phase (mounts / clears the answer field as the linked
            // queue row enters / leaves needs_words).
            syncAskingPanel(row, row.__item, row.getAttribute('data-value'));
            // Keep an open panel's STUCK failure-reason block in step with the
            // row's live phase too, so a re-triage that leaves failed/no_change
            // clears it while the panel is open (and a fresh failure mounts it).
            syncStuckPanel(row, row.__item);
            // Keep the Dispatch (drafted) / Retry (stuck) action in step with the
            // row's live phase so it appears when a draft lands / a run fails and
            // clears when the phase moves on — live, while the panel is open.
            syncDispatchPanel(row, row.__item);
            // Keep the REVIEW (accept-phase) decision surface in step too, so a
            // draft → accept flip mounts it and an acknowledge from the viewer (or
            // another device) clears it — live, while the pane is open. Desktop-
            // pane-only; a no-op below the breakpoint and outside the accept phase.
            syncReviewPanel(row, row.__item, row.getAttribute('data-value'));
            // Keep the MOCKUP-phase A/B/C flow in step so it mounts when a run parks
            // in needs_mockup and clears once a mockup is chosen (needs_mockup →
            // drafted) — live, while the pane is open. Desktop-pane-only; a no-op
            // below the breakpoint and outside the mockup phase.
            syncMockupPanel(row, row.__item);
            // Re-gate the authoring controls by the row's live phase so a panel
            // whose task transitions into `done` (its entry acknowledged elsewhere)
            // hides them on the next sweep, and one leaving `done` restores them —
            // without a re-render. No-op when the panel isn't open. Hiding/showing
            // the group changes the panel height, so re-snapshot an expanded viewer
            // card below to match, mirroring mountDescRail / the sync panels.
            if (openPanel) {
                applyPhaseLayout(openPanel, phase);
                // Re-assert the active authoring mode after the phase gate (which
                // un-hides the whole group in a non-terminal phase) so the two
                // inactive-mode bodies stay hidden, and repaint the GENERATE body
                // from the live queue-row state (triaging → idle). Skipped in `done`
                // AND `accept`, where the whole group stays hidden for the decision
                // surface — re-asserting would re-show the controls the gate hid.
                if (phase !== PHASE.DONE && phase !== PHASE.ACCEPT) {
                    applyAuthoringMode(openPanel, openPanel.dataset.authorMode || 'write');
                    syncGenerateBody(openPanel, row.__item, row.getAttribute('data-value'));
                }
                // Replace the entry region with the TRIAGE RUNNING block live as the
                // row enters `triaging`, and restore the authoring layout when it
                // leaves — the row is the state, so a dispatch from another device
                // flips this too. Runs after applyAuthoringMode so its hide wins.
                syncTriageBlock(row, row.__item);
                refreshViewerExpandedHeight();
            }
            if (row.__item.entryId && row.dataset && row.dataset.value) {
                projectsToRefresh.add(row.dataset.value);
            }
        }
    });
    projectsToRefresh.forEach(function(name) {
        // Force past the 60s TTL: a row may render (or re-render on reload) with a
        // stale pre-ship marker cache, and a shipped fact must be trusted
        // immediately rather than served from that stale entry.
        refreshShippedMarkersForProject(name, true);
    });
    // Re-derive every mounted Generate button from the fresh queue-row cache so
    // a triaging → drafted / failed transition lands / clears live. Covers the
    // desktop panels and, when open, the mobile modal's button.
    syncAllGenerateControls();
    // The blocked-on-you chip counts derived phases, so the same marker/queue
    // sweep that flips a row's badge must refresh the chip's count and (when the
    // blocked filter is engaged) the visible membership. This sweep runs on both
    // TODO_RUN_STATUS_EVENT and onQueueChange, so hanging the repaint here keeps
    // the chip live off both signals without adding a new event.
    applyTaskFilter();
}

// Load a project's agent_queue rows into the shared store on a full project
// render, then repaint the derived badges once the fetch resolves. Ensures the
// realtime subscription is open first (idempotent) so subsequent pushes keep the
// badges live. Guarded on a project name; a fetch failure degrades to no badge
// (fetchQueueRows resolves to []), never a throw.
function loadQueueRowsForRender(projectName) {
    if (!projectName || typeof document === 'undefined') return;
    startAgentQueueSubscription();
    Promise.resolve(loadQueueRows(projectName)).then(refreshDescStatusDots);
}


// A single delegated document listener drives the live refresh when an inject
// stamps a pending entry or a run reconciles to SHIPPED. Attached lazily on the
// first row build (idempotent) rather than at module eval: like every other
// inject.js import in this file, the run-status exports are only dereferenced at
// call time, so importing this module never touches them — matching the
// lazy-access contract the wider row layer already relies on.
let runStatusListenerAttached = false;
function ensureRunStatusDotListener() {
    if (runStatusListenerAttached || typeof document === 'undefined') return;
    runStatusListenerAttached = true;
    document.addEventListener(TODO_RUN_STATUS_EVENT, refreshDescStatusDots);
    // A realtime agent_queue push (or a store reload) re-derives every row's
    // phase through the same sweep, so an ASKING badge lights / clears live as
    // triage parks a question or the answer re-queues the task. The store owns
    // the subscription; opening it here (idempotent) ensures it's live on the
    // list view even before the Agent tab is ever mounted.
    startAgentQueueSubscription();
    onQueueChange(refreshDescStatusDots);
}


// ── HELPER: install Backspace-as-exit on a todo-row sub-control ──
// Keyboard users who Tab into a row's sub-controls (checkbox, due pill,
// expand caret, stats caret, delete X) get a one-key way to back out of the
// row's inner chrome and return to row-level nav mode. The next ArrowUp /
// ArrowDown then resolves "current row = this row" via the focus-based
// path in the global keydown handler, so the user transitions cleanly from
// sub-control focus → row nav mode → arrow-key traversal — without ever
// dropping into title-editing mode. Mirrors the Backspace-closes-popover
// convention shared by the due-date, pomodoro, and music popovers.
// Modified Backspace (Ctrl / Cmd / Alt / Shift) falls through so the global
// Ctrl+Backspace sidebar shortcut still works from a focused sub-control.
function wireSubControlBackspaceExit(subControl, toDoChild) {
    // Blank placeholder rows hide every sub-control via display:none until
    // the row commits, so the listener could never fire there — skip the
    // wire-up entirely. The Enter commit path rebuilds the row on the next
    // render, at which point the marker is gone and the listener attaches.
    if (toDoChild.dataset.originalBlank === 'true') return;

    subControl.addEventListener('keydown', function(event) {
        if (event.key !== 'Backspace') return;
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        // Belt-and-suspenders: the popover's capture-phase keydown handler
        // calls stopPropagation on Backspace, so this bubble-phase listener
        // never sees the keystroke while the popover is open. Re-check the
        // popover element here so a future change in listener ordering can't
        // bounce focus away while the user is still inside the calendar.
        if (subControl.id === 'duePill' && document.getElementById('dueDatePopover')) return;
        event.preventDefault();
        // Clear .todo-active from any other row first so the arrow-nav
        // handler's .todo-active fallback can't resolve to a stale row.
        // Mirrors the cleanup pattern in main.js's arrow-nav handler and
        // wireCloseButton's post-deletion focus logic.
        const mainList = toDoChild.parentElement;
        if (mainList) {
            mainList.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
                if (el !== toDoChild) el.classList.remove('todo-active');
            });
        }
        toDoChild.classList.add('todo-active');
        // toDoChild carries tabindex="-1" specifically so it can receive
        // programmatic focus for row nav mode — the user is now between
        // rows, ready for ArrowUp/ArrowDown, not inside the title input.
        toDoChild.focus();
    });
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
                // reorderToDoDOM re-parents each row via appendChild, which
                // cancels any in-flight CSS animation on it. Defer the
                // reorder inside the flash's setTimeout so the keyframe
                // gets to play; under reduced-motion there's no animation
                // to protect and the reorder fires synchronously.
                if (!prefersReducedMotion()) {
                    toDoChild.classList.add('recurring-flash');
                    setTimeout(function() {
                        toDoChild.classList.remove('recurring-flash');
                        checkToDo.checked = false;
                        listLogic.sortCompletedToBottom(projectName);
                        reorderToDoDOM(projectName);
                    }, 250);
                } else {
                    checkToDo.checked = false;
                    listLogic.sortCompletedToBottom(projectName);
                    reorderToDoDOM(projectName);
                }
                applyDueUrgency(toDoChild, item);
                const pill = toDoChild.querySelector('#duePill');
                if (pill) updateDuePillLabel(pill, item);
                if (isCoarsePointer() && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    try { navigator.vibrate(10); } catch (_) { /* noop */ }
                }
                return;
            }
        }

        // Route the toggle through listLogic so the localStorage write
        // fires unconditionally. The follow-up sortCompletedToBottom
        // short-circuits when the array order is already canonical
        // (e.g. swiping right on the last uncompleted item), so its
        // built-in persist path can't be relied on to flush this
        // mutation — the swipe-right completion would survive in memory
        // but reappear unchecked on the next page load. Falling back to
        // the direct mutation when no projectName preserves the
        // pre-existing behaviour for transient rows the data model
        // doesn't yet own.
        if (projectName) {
            listLogic.setToDoCompleted(projectName, item, checkToDo.checked);
        } else {
            item.completed = checkToDo.checked;
        }
        if (checkToDo.checked) {
            toDoChild.classList.add("completed");
        } else {
            toDoChild.classList.remove("completed");
        }

        // Snapshot whether the slide-fade was kicked off on this tick.
        // The reorder below must be deferred until its animationend fires
        // — reorderToDoDOM re-parents the row via appendChild, which
        // restarts an in-flight CSS animation from frame 0 in the new DOM
        // slot, so the user would see the slide-fade play at the bottom
        // of the list on a row that had just been moved there instead of
        // on the row they actually clicked.
        let didAddSlideFade = false;

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
            if (!prefersReducedMotion()) {
                toDoChild.classList.add('todoCompleting');
                didAddSlideFade = true;
                toDoChild.addEventListener('animationend', function onSlideEnd(e) {
                    if (e.animationName !== 'todoCompletingSlideFade') return;
                    toDoChild.classList.remove('todoCompleting');
                    toDoChild.removeEventListener('animationend', onSlideEnd);
                });
            }
        }

        applyDueUrgency(toDoChild, item);

        // Partition completed entries to the bottom of this project's list,
        // then slide the row (plus any open description panel) into its new
        // slot in-place so listeners stay attached.
        function commitReorder() {
            if (projectName) {
                listLogic.sortCompletedToBottom(projectName);
                reorderToDoDOM(projectName);
            } else {
                listLogic.saveToStorage();
            }
        }

        if (didAddSlideFade) {
            toDoChild.addEventListener('animationend', function onSlideEndReorder(e) {
                if (e.animationName !== 'todoCompletingSlideFade') return;
                toDoChild.removeEventListener('animationend', onSlideEndReorder);
                commitReorder();
            });
        } else {
            commitReorder();
        }
    });

    return checkToDo;
}


// ── HELPER: wire click-to-activate then click-to-edit on a todo row ──
// First click on a committed row marks it todo-active (enabling pointer-events on
// the input). Second click on the input then focuses it for editing.
// Blank placeholder rows skip straight to focus on first click.
//
// Mobile (≤1023px) replaces the desktop one-tap-to-edit with a two-stage
// tap-to-view / tap-to-edit flow on committed rows: the first tap on a
// collapsed row programmatically opens the description panel via the
// existing descToggle (so descSibling appears below) and marks the row
// `data-mobile-read="true"` WITHOUT focusing the input — the user can read
// the description without summoning the soft keyboard. A second tap on the
// title input area falls through to the focus path below and enters edit
// mode. The auto-opened state is auto-collapsed when the user taps outside
// the row+descSibling unit (handled in main.js's document click listener).
//
// On `(pointer: coarse)` devices the click handler short-circuits to the
// mobile description editor modal instead — the descSibling's single-line
// input can't host the multi-line markdown drafting the task brief calls
// for. Extracted helpers keep the branch body small so the existing
// 4000-char source-inspection windows in mobileReadModeTitleVisible.test.js
// still cover the data-title-edit + toDoInput.focus() lines below.
function isCoarsePointerTap() {
    return typeof window !== 'undefined'
        && !!window.matchMedia
        && window.matchMedia('(pointer: coarse)').matches;
}
function openDescEditorForRow(toDoChild) {
    document.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
        if (el !== toDoChild) el.classList.remove('todo-active');
    });
    toDoChild.classList.add('todo-active');
    const item = toDoChild.__item;
    if (!item) return;
    const projectName = toDoChild.dataset.value || '';
    showDescEditorModal(item, {
        projectName: projectName,
        onSave: function() {
            // Route through listLogic so Supabase persistMutation fires —
            // saveToStorage in the modal only writes localStorage, which
            // the next hydrate would overwrite with the backend snapshot.
            if (projectName) listLogic.editToDoItem(projectName, item);
        },
        onTitleSave: function(newTitle) {
            // Sync the row's visible title cells with the saved value so the
            // rename shows up immediately on modal close, and route the
            // mutation through listLogic so the Supabase persistMutation
            // gate fires (saveToStorage in the modal only writes localStorage).
            const toDoInput = toDoChild.querySelector('#toDoInput');
            const toDoTitleDisplay = toDoChild.querySelector('#toDoTitleDisplay');
            if (toDoInput) {
                toDoInput.value = newTitle;
                toDoInput.title = newTitle;
            }
            if (toDoTitleDisplay) toDoTitleDisplay.textContent = newTitle;
            if (projectName) listLogic.editToDoItem(projectName, item);
        }
    });
}
// Open the mobile description-editor modal for a committed row identified by its
// todo id — the entry point the on-row phase badges (ASKING / DRAFTED / STUCK /
// MOCKUP / REVIEW) reach on `(pointer: coarse)`, where the badge routes to the
// modal (which mounts the asking / dispatch / review blocks) rather than the
// inline #descSibling panel the mobile design never intended. Resolves the live
// row in #mainList by item identity and reuses openDescEditorForRow so the modal's
// onSave / onTitleSave wiring and the row's todo-active treatment are identical to
// a direct row-body tap. No-op when no matching row is mounted.
export function openDescEditorForTodoId(todoId) {
    if (!todoId) return;
    const mainList = document.getElementById('mainList');
    if (!mainList) return;
    const rows = mainList.querySelectorAll('#toDoChild');
    for (let i = 0; i < rows.length; i++) {
        const item = rows[i].__item;
        if (item && item.id === todoId) {
            openDescEditorForRow(rows[i]);
            return;
        }
    }
}
export function wireToDoRowClick(toDoChild, toDoInput, descToggle) {
    toDoChild.addEventListener('click', function(e) {
        // Let dedicated controls handle their own clicks without interference.
        // The status label is a sub-control like copyBtn: skipping the row's
        // focus/activate here stops the focus-into-view scroll from tearing
        // down the popover its own delegated #mainList handler just mounted.
        if (e.target.id === 'checkToDo'      ||
            e.target.id === 'closeButtonToDo' ||
            e.target.id === 'descToggle'      ||
            e.target.closest('#statsToggle')  ||
            e.target.closest('#duePill')      ||
            e.target.closest('.copyTitleBtn') ||
            e.target.closest('.todoStatusLabel') ||
            e.target.closest('#dueDatePopover') ||
            e.target.closest('#descSibling')  ||
            e.target.closest('#statsSibling')) return;

        // Blank rows: focus immediately (user intends to type a new item)
        if (!toDoInput.value.trim()) {
            toDoInput.focus();
            return;
        }

        // Touch-device description editor — opens the modal in place of the
        // descSibling's single-line input on `(pointer: coarse)` devices.
        if (isCoarsePointerTap()) {
            openDescEditorForRow(toDoChild);
            return;
        }

        const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
        const descOpen = !!(descToggle && descToggle.classList.contains('open'));

        // Mobile tap-to-view: first tap on a collapsed committed row enters
        // read mode (descSibling appears below) without summoning the
        // keyboard. Subsequent taps on the title area fall through to the
        // focus path so the user can edit.
        if (isMobile && !descOpen && descToggle) {
            // Only one row stays in mobile-read at a time — collapse any
            // other rows that were auto-expanded by a previous tap.
            document.querySelectorAll('#toDoChild[data-mobile-read="true"]').forEach(function(other) {
                if (other === toDoChild) return;
                const otherToggle = other.querySelector('#descToggle');
                if (otherToggle && otherToggle.classList.contains('open')) {
                    otherToggle.click();
                }
            });
            descToggle.click();
            toDoChild.setAttribute('data-mobile-read', 'true');
            // Mark .todo-active so the input is interactive on the next tap
            // (matches the existing committed-row activation rule), but do
            // NOT call .focus() — that would summon the soft keyboard.
            document.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
                if (el !== toDoChild) el.classList.remove('todo-active');
            });
            toDoChild.classList.add('todo-active');
            return;
        }

        // Committed rows: activate this row, deactivate all others
        document.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
            if (el !== toDoChild) el.classList.remove('todo-active');
        });
        toDoChild.classList.add('todo-active');
        openRowInDetailPane(toDoChild, descToggle); // also show it in the detail pane

        // one-click editing — focus with caret at end rather than selecting text
        if (document.activeElement !== toDoInput) {
            // Set data-title-edit BEFORE focus(): the input is opacity:0 /
            // pointer-events:none until this attribute flips the CSS swap, so
            // focus() without it is a no-op. Set at every width — the swap now
            // hosts the ellipsized title span in the desktop rail too, not just
            // on phones (at 421–1023px no swap rule matches, so it is inert).
            toDoChild.setAttribute('data-title-edit', 'true');
            const end = toDoInput.value.length;
            toDoInput.focus();
            toDoInput.setSelectionRange(end, end);
            // Caret-at-end keeps typing appending at the end, but the browser
            // scrolls the input to reveal that caret, so at the 308px rail the
            // start of a long title is hidden and the selected row shows only
            // its tail. Reset the horizontal scroll so the title reads from the
            // beginning while the caret stays parked at the end. The reset must
            // run AFTER focus()/setSelectionRange(), and focus scrolling settles
            // on the next frame, so defer it with requestAnimationFrame (not a
            // timeout) as well as setting it now. Only this programmatic
            // caret-at-end branch resets scroll; clicking directly on a
            // character sets the caret there and never runs this block.
            toDoInput.scrollLeft = 0;
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(function() { toDoInput.scrollLeft = 0; });
            }
        }
    });

    // Whenever the description panel closes — manually via descToggle or
    // programmatically via the outside-tap collapse — clear the
    // mobile-read marker so the row's state stays in sync with what the
    // user can actually see. Without this the next tap would skip the
    // open-and-stay-in-read step and jump straight to focus.
    if (descToggle) {
        descToggle.addEventListener('click', function() {
            if (!descToggle.classList.contains('open')) {
                toDoChild.removeAttribute('data-mobile-read');
                // Defensive: closing the description always collapses the
                // row fully, regardless of whether the title was in edit
                // mode. The blur handler on toDoInput clears this too;
                // doing it here as well covers the case where the user
                // closes the description without ever blurring the input.
                toDoChild.removeAttribute('data-title-edit');
            }
        });
    }

    // Attach the keyboard-focus → detail-pane delegation once (idempotent, lazy so
    // it runs past #mainList's creation). Placed after the per-row listeners so it
    // stays out of the click-handler body the source-inspection windows scan.
    ensureDetailPaneFocusListener();
}


// Number of missed dates a recurring task may accumulate inside the
// stats window before the drawer swaps the inline pill list for a
// 5-pill preview + a `+ N more` chip that opens the full-list modal.
// One-line tunable so the cutoff can be revisited without hunting the
// render logic. The pattern callout above the list always renders,
// regardless of count.
const MISS_PILL_THRESHOLD = 7;

// ── HELPER: wire the chart-icon toggle that opens/closes the recurring-task stats surface ──
// Desktop (>420px) keeps the inline `#statsSibling` drawer pattern — opens a
// new panel directly beneath the row (after `#descSibling` if that one is
// also open), closes on a second click. Mobile (≤420px) routes to a
// full-screen `#statsModal` instead: the inline drawer fought #mainList's
// grid track sizing too hard at phone widths, so the modal sidesteps the
// containment problem entirely and gives the contributions grid room to
// render at desktop size. Both surfaces render the same payload — stat-card
// strip, window selector (14d / 30d / 90d / All — default 30d), contributions
// grid (or a fallback strip for month-/year-cadence recurrences), miss-pattern
// callout, and missed-dates pill list. Enter activates the chart icon
// from keyboard focus.
function wireStatsToggle(statsToggle, toDoChild, item) {

    // Shared mutable surface state. This object is passed by reference into
    // the extracted stats-drawer factory AND read/written by the click
    // handler below, so both sides observe the same values:
    //   currentWindow — active stats window (14d/30d/90d/all; default 30d).
    //   openMode      — where the payload is rendered (null | 'drawer' | 'modal'),
    //                   so window-toggle re-renders target the right container.
    //   modalBody     — the mobile modal's body element while it is open.
    const state = { currentWindow: '30d', openMode: null, modalBody: null };

    // renderStatsContent / replaceContentInPlace / openStatsModal now live in
    // ./statsDrawerPanel.js; the factory binds them to this row's context and
    // the shared `state` above. Behaviour is identical to the former inline
    // closure — the toDoRow-local builders are handed over as `deps`.
    const { renderStatsContent, openStatsModal } = createStatsDrawer({
        statsToggle,
        toDoChild,
        item,
        state,
        deps: {
            buildContributionsGrid,
            buildFallbackStrip,
            buildInfoGlyph,
            formatShortDate,
            formatCadenceSubtitle,
            MISS_PILL_THRESHOLD,
        },
    });

    statsToggle.addEventListener('click', function(event) {
        event.stopPropagation();
        // Defensive: button is CSS-hidden when no recurrence, but if a
        // keyboard activation slips through, no-op rather than render an
        // empty drawer.
        if (!item.recurrence) return;
        const mainList = toDoChild.parentElement;
        if (!mainList) return;

        // Mobile (≤420px) gets a full-screen modal; the inline drawer
        // fights #mainList's grid track sizing too hard at that width.
        // The branch is at click time so a resize after the initial
        // render doesn't strand a half-open drawer in the wrong mode.
        const useModal =
            typeof window !== 'undefined' &&
            window.matchMedia &&
            window.matchMedia('(max-width: 420px)').matches;
        if (useModal) {
            openStatsModal();
            return;
        }

        // Check if a stats drawer for this row is already open. The
        // drawer lives directly after the row OR after descSibling if
        // both are open.
        let existing = toDoChild.nextSibling;
        while (existing && existing.id !== 'statsSibling') {
            if (existing.id !== 'descSibling') {
                existing = null;
                break;
            }
            existing = existing.nextSibling;
        }

        if (existing && existing.id === 'statsSibling') {
            mainList.removeChild(existing);
            state.openMode = null;
            statsToggle.classList.remove('open');
            statsToggle.setAttribute('aria-expanded', 'false');
            statsToggle.setAttribute('aria-label', 'Show stats');
            return;
        }

        state.openMode = 'drawer';
        const drawer = renderStatsContent(false);
        if (!drawer) {
            state.openMode = null;
            return;
        }
        // Slot after descSibling when it's open so both panels stack
        // beneath the row in a deterministic order. Otherwise slot
        // directly under the row.
        const descBelow = (toDoChild.nextSibling && toDoChild.nextSibling.id === 'descSibling')
            ? toDoChild.nextSibling
            : null;
        const anchor = descBelow || toDoChild;
        mainList.insertBefore(drawer, anchor.nextSibling);
        statsToggle.classList.add('open');
        statsToggle.setAttribute('aria-expanded', 'true');
        statsToggle.setAttribute('aria-label', 'Hide stats');
    });

    statsToggle.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        statsToggle.click();
    });
}


// Cadence subtitle for the mobile stats modal — surfaces the recurrence
// pattern and end-date alongside the title so users coming straight from a
// chart-icon tap see the cadence they're looking at. Examples:
//   "DAILY · ENDS NEVER"
//   "EVERY 3 WEEKS · ENDS JUN 14, 2026"
function formatCadenceSubtitle(recurrence) {
    if (!recurrence) return '';
    let pattern;
    if (recurrence.pattern === 'custom') {
        const n = recurrence.interval || 1;
        const unit = recurrence.intervalUnit || 'day';
        const plural = n === 1 ? unit : unit + 's';
        pattern = 'EVERY ' + n + ' ' + plural.toUpperCase();
    } else {
        pattern = (recurrence.pattern || '').toUpperCase();
    }
    const end = formatCadenceEndDate(recurrence.endDate);
    return pattern + ' · ENDS ' + end;
}

const CADENCE_MONTH_SHORT = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];
function formatCadenceEndDate(endDateStr) {
    if (!endDateStr) return 'NEVER';
    // Recurrence end dates are stored as "M-D-YYYY"; parse defensively so a
    // malformed value falls back to the literal string rather than NaN.
    const parts = String(endDateStr).split('-');
    if (parts.length === 3) {
        const m = parseInt(parts[0], 10);
        const d = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (!isNaN(m) && !isNaN(d) && !isNaN(y) && m >= 1 && m <= 12) {
            return CADENCE_MONTH_SHORT[m - 1] + ' ' + d + ', ' + y;
        }
    }
    return String(endDateStr).toUpperCase();
}


// Build the contributions-grid SVG for daily / weekdays / weekly /
// custom-day / custom-week recurrences. Layout is weeks-as-columns,
// weekday-as-rows (Sun..Sat). Cells are 14×14 with 4px gaps. Only
// expected-occurrence dates are filled — non-expected days in the window
// remain blank so the grid surfaces the cadence visually.
function buildContributionsGrid(stats) {
    const wrapper = document.createElement('div');
    wrapper.className = 'statsGridWrapper';

    const cellSize = 14;
    const gap = 4;
    // Gutters host weekday letters down the left edge and month
    // abbreviations along the top. Cells are shifted by these offsets so
    // they visually align under their column's month label and beside
    // their row's weekday letter.
    const labelGutterX = 14;
    const labelGutterY = 14;
    // Right gutter gives a month label that starts at the last column room
    // to extend past the last cell's right edge; without it, a single-column
    // grid clips "May"/"Sept"/etc. to one or two letters.
    const labelGutterRight = 24;
    const expected = stats.expectedDates;
    if (expected.length === 0) {
        wrapper.classList.add('statsGridEmpty');
        wrapper.textContent = 'No expected occurrences in this window yet.';
        return wrapper;
    }

    // Back-align the first expected date to Sunday so weekday rows stay
    // visually consistent across windows.
    const first = expected[0];
    const dowOffset = first.getDay();
    const alignedStart = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    alignedStart.setDate(alignedStart.getDate() - dowOffset);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = isoKey(today);

    // Total columns = weeks from alignedStart through today inclusive.
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysSpan = Math.floor((today.getTime() - alignedStart.getTime()) / msPerDay) + 1;
    const totalCols = Math.max(1, Math.ceil(daysSpan / 7));

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    const gridWidth  = totalCols * cellSize + (totalCols - 1) * gap;
    const gridHeight = 7 * cellSize + 6 * gap;
    const width  = labelGutterX + gridWidth + labelGutterRight;
    const height = labelGutterY + gridHeight;
    svg.setAttribute('width',  width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'statsGrid');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Recurring task hit grid');

    // Weekday letters down the left gutter, Sunday-first to match the
    // `row = d.getDay()` math used for cell placement.
    const weekdayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    for (let row = 0; row < 7; row++) {
        const label = document.createElementNS(svgNS, 'text');
        label.setAttribute('x', 0);
        label.setAttribute('y', labelGutterY + row * (cellSize + gap) + cellSize / 2);
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('class', 'statsGridLabel');
        label.textContent = weekdayLetters[row];
        svg.appendChild(label);
    }

    // Month abbreviations along the top gutter. First column is always
    // labeled; subsequent columns are labeled only when their first
    // day-of-week falls in a different calendar month than the previous
    // column's, so consecutive same-month columns don't repeat.
    let lastLabeledMonth = -1;
    for (let col = 0; col < totalCols; col++) {
        const colStart = new Date(alignedStart.getTime() + col * 7 * msPerDay);
        const monthIdx = colStart.getMonth();
        if (col === 0 || monthIdx !== lastLabeledMonth) {
            const label = document.createElementNS(svgNS, 'text');
            label.setAttribute('x', labelGutterX + col * (cellSize + gap));
            label.setAttribute('y', 10);
            label.setAttribute('class', 'statsGridLabel');
            label.textContent = colStart.toLocaleString(undefined, { month: 'short' });
            svg.appendChild(label);
            lastLabeledMonth = monthIdx;
        }
    }

    expected.forEach(function(d) {
        const dayIdx = Math.floor((d.getTime() - alignedStart.getTime()) / msPerDay);
        const col = Math.floor(dayIdx / 7);
        const row = d.getDay();
        const x = labelGutterX + col * (cellSize + gap);
        const y = labelGutterY + row * (cellSize + gap);

        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', cellSize);
        rect.setAttribute('height', cellSize);
        rect.setAttribute('rx', 2);
        rect.setAttribute('ry', 2);

        const key = isoKey(d);
        rect.setAttribute('class', cellClasses(key, d, today, todayKey, stats));

        const titleEl = document.createElementNS(svgNS, 'title');
        titleEl.textContent = formatShortDate(d) +
            ' — ' + cellTitleLabel(key, d, today, stats);
        rect.appendChild(titleEl);
        svg.appendChild(rect);
    });

    wrapper.appendChild(svg);
    return wrapper;
}

// Fallback horizontal strip for monthly / yearly / custom-month /
// custom-year cadences — a weekday grid would be too sparse to read at
// those intervals, so the last 12 expected occurrences are rendered as
// a single row of 18×18 cells.
function buildFallbackStrip(stats) {
    const wrapper = document.createElement('div');
    wrapper.className = 'statsGridWrapper statsFallbackStrip';

    const cellSize = 18;
    const gap = 4;
    const maxCells = 12;
    const expected = stats.expectedDates.slice(-maxCells);
    if (expected.length === 0) {
        wrapper.classList.add('statsGridEmpty');
        wrapper.textContent = 'No expected occurrences in this window yet.';
        return wrapper;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = isoKey(today);

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    const rows = 1;
    const width  = expected.length * cellSize + (expected.length - 1) * gap;
    const height = rows * cellSize;
    svg.setAttribute('width',  width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'statsGrid');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Recurring task occurrence strip');

    expected.forEach(function(d, idx) {
        const col = idx;
        const x = col * (cellSize + gap);
        const y = 0;
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', cellSize);
        rect.setAttribute('height', cellSize);
        rect.setAttribute('rx', 2);
        rect.setAttribute('ry', 2);

        const key = isoKey(d);
        rect.setAttribute('class', cellClasses(key, d, today, todayKey, stats));

        const titleEl = document.createElementNS(svgNS, 'title');
        titleEl.textContent = formatShortDate(d) +
            ' — ' + cellTitleLabel(key, d, today, stats);
        rect.appendChild(titleEl);
        svg.appendChild(rect);
    });

    wrapper.appendChild(svg);
    return wrapper;
}

// Class string for a grid cell. Today's cell gets the hit fill AND the
// today stroke when a clone for today exists in the project's items — so
// the user can see "I did the thing today" as a filled cell with the
// today ring overlaid on top. When today has no matching clone yet, the
// cell falls back to the ring-only treatment.
function cellClasses(key, d, today, todayKey, stats) {
    let cls = 'statsCell';
    if (key === todayKey) {
        if (stats.hits.has(key)) cls += ' statsCellHit statsCellTodayHit';
        else cls += ' statsCellToday';
    } else if (d.getTime() > today.getTime()) {
        cls += ' statsCellFuture';
    } else if (stats.hits.has(key)) {
        cls += ' statsCellHit';
    } else {
        cls += ' statsCellMiss';
    }
    return cls;
}

// Tooltip label for a grid cell — read aloud via title text on hover.
function cellTitleLabel(key, d, today, stats) {
    if (key === isoKey(today)) {
        return stats.hits.has(key) ? 'today, completed' : 'today';
    }
    if (d.getTime() > today.getTime()) return 'upcoming';
    if (stats.hits.has(key)) return 'hit';
    return 'missed';
}

// Local-time ISO key (YYYY-MM-DD). Mirrors listLogic.formatCalendarKey
// so cell hits compare against the same keys produced by the stats
// helper, without an import cycle through the module's internal helper.
function isoKey(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return y + '-' + (m < 10 ? '0' + m : '' + m) + '-' + (d < 10 ? '0' + d : '' + d);
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatShortDate(d) {
    return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate();
}

// Inline-SVG info glyph (circle with a dot above a vertical line) for
// the miss-pattern callout. Sized 14×14 to match the stroke / size
// rhythm of `.recurringGlyph` in style.css so the meta strip and the
// drawer's accent visuals read as the same family.
function buildInfoGlyph() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'statsMissCalloutIcon');
    svg.setAttribute('width', 14);
    svg.setAttribute('height', 14);
    svg.setAttribute('viewBox', '0 0 14 14');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', 7);
    circle.setAttribute('cy', 7);
    circle.setAttribute('r', 6);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', 1.2);
    svg.appendChild(circle);

    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', 7);
    dot.setAttribute('cy', 4);
    dot.setAttribute('r', 0.9);
    dot.setAttribute('fill', 'currentColor');
    svg.appendChild(dot);

    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', 7);
    line.setAttribute('y1', 6.2);
    line.setAttribute('x2', 7);
    line.setAttribute('y2', 10.5);
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', 1.2);
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);

    return svg;
}


// ── HELPER: wire the dropdown toggle button that opens/closes a row's description ──
// Replaces the old behaviour where clicking anywhere on the todo row expanded the description.
function wireDescToggle(descToggle, toDoChild, descSibling, descInput, injectBtn, generateBtn, discussBtn, item, projectName) {

    // Mount every panel child once the panel is in its host. Placement is
    // handled by placeDescPanel (pane vs inline); this only fills the panel.
    function mountPanelContents() {
        // Every child is placed explicitly via CSS grid-column (see
        // #descInput / #descSibling in style.css), so mount order no longer
        // affects layout — the two gutter-filler spacers this panel used to
        // carry are gone.
        descSibling.appendChild(descInput);
        // The docked footer stack. In the detail pane the panel is a flex column
        // whose textarea absorbs the leftover height, so anything left as a plain
        // panel child after it would float directly beneath the entry rather than
        // sitting at the pane floor. Grouping the trailing sections — the picker's
        // filter panel, the actions row, the FILE readout and MANUAL STATUS — into
        // one wrapper gives the pane a single element to pin (margin-top: auto).
        // Reuse the persistent wrapper across reopens (panel children survive
        // close) and re-append it so it stays LAST even after descInput's own
        // re-append above moved it to the end.
        let footer = descSibling.querySelector('.descPanelFooter');
        if (!footer) {
            footer = document.createElement('div');
            footer.className = 'descPanelFooter';
        }
        descSibling.appendChild(footer);
        // Group Inject / Generate / Discuss into ONE horizontal actions row so
        // they sit side by side at their natural label width, rather than each
        // spanning the panel full-width as its own stacked bar. The wrapper takes
        // grid-column: 2 (the content column, aligning with the textarea) and the
        // buttons flow inside it with wrap. Reuse the persistent wrapper across
        // reopens (children survive close) and clear it before refilling so opens
        // never stack duplicates.
        let actionsRow = descSibling.querySelector('.descActionsRow');
        if (!actionsRow) {
            actionsRow = document.createElement('div');
            actionsRow.className = 'descActionsRow';
        }
        while (actionsRow.firstChild) actionsRow.removeChild(actionsRow.firstChild);
        if (injectBtn) {
            actionsRow.appendChild(injectBtn);
        }
        // Generate sits beside Inject, but only for a committed row — a blank
        // placeholder has no task for the agent to draft from yet.
        if (generateBtn && item.id) {
            actionsRow.appendChild(generateBtn);
        }
        // Discuss sits after inject, but only for a committed row — a blank
        // placeholder has no task to scope a conversation to yet.
        if (discussBtn && item.id) {
            actionsRow.appendChild(discussBtn);
        }
        footer.appendChild(actionsRow);
        if (injectBtn) {
            refreshInjectButton(injectBtn, item, projectName);
        }
        // Sync Generate from the linked queue row now the button is in the DOM
        // (mounts Generating…/failure and lands a pending draft) — its dismissible
        // failure notice slots in as a #descSibling child after the actions row,
        // not inside it (see generateNoticeAnchor).
        if (generateBtn && item.id) {
            syncGenerateControl(generateBtn);
        }
        // Read-only FILE readout beneath the actions row, mirroring the entry's
        // `- File:` line so the target is visible without scrolling the textarea.
        // Committed rows only (a placeholder has no entry to target). Reuse the
        // persistent node across reopens, then populate from the entry text.
        if (item.tit) {
            let fileReadout = descSibling.querySelector('.descFileReadout');
            if (!fileReadout) fileReadout = buildFileReadout();
            footer.appendChild(fileReadout);
        }
        descInput.value = item["desc"] || "";
        // Trigger the textarea's auto-grow handler now that it's in the
        // DOM — scrollHeight is only meaningful for an attached element.
        descInput.dispatchEvent(new Event("input"));
        // Mount the shared File:-path picker above the textarea. Its manifest
        // loads ON DEMAND (only when the picker panel opens), so mounting is
        // cheap even in the `done` phase where applyPhaseLayout hides it below:
        // a hidden picker never opens, so nothing loads, and the element is
        // present to un-hide if the panel later leaves `done`.
        mountDescFilePicker(descSibling, descInput, item, projectName, injectBtn);
        // Mount the read-only phase rail + THE ENTRY label at the head of the
        // panel (the desktop counterpart to the mobile modal's rail), driven
        // by the shared phaseRail.js builder. Runs before the ASKING/STUCK
        // syncs so those blocks land immediately after the rail via
        // descPanelTopAnchor.
        mountDescRail(descSibling, item);
        // Mount triage's ASKING question + answer block right after the rail
        // when this task's linked agent_queue row is in needs_words. No-op for
        // every other row.
        syncAskingPanel(toDoChild, item, projectName);
        // Mount triage's STUCK failure-reason block at the top of the panel
        // when this task's linked agent_queue row is in failed / no_change —
        // the chevron-path equivalent of the modal's stuck block. No-op for
        // every other row (and mutually exclusive with the ASKING block).
        syncStuckPanel(toDoChild, item);
        // Mount the Dispatch (drafted) / Retry (stuck) action so a draft can be
        // shipped and a failed run retried without leaving the row. No-op in every
        // other phase; runs the shared dispatch the Agent board uses.
        syncDispatchPanel(toDoChild, item);
        // Mount the REVIEW (accept-phase) decision surface — the WHAT CHANGED card
        // plus Accept / Revert / Open-in-TODO.md — so a shipped change can be
        // decided from the detail pane. Desktop-pane-only and accept-phase-only;
        // reuses the viewer's acknowledge writer and the shared revert route.
        syncReviewPanel(toDoChild, item, projectName);
        // Mount the MOCKUP-phase A/B/C flow — the shared board flow laid out three
        // variants across — above the authoring region for a `needs_mockup` task,
        // so a visual direction can be chosen from the detail pane. Desktop-pane-only
        // and mockup-phase-only; a no-op in every other phase and below the breakpoint.
        syncMockupPanel(toDoChild, item);
        // Mount the WRITE / PASTE / GENERATE authoring mode strip above the entry
        // region and its PASTE / GENERATE bodies beside the textarea. Committed
        // rows only — a blank placeholder has no task to paste into or generate
        // from. Resets to WRITE on every open (the mode is transient view state).
        if (item.id) {
            mountAuthoringModeStrip(descSibling, descInput, item, projectName, injectBtn, generateBtn);
        }
        // Gate the authoring controls by the derived phase — hidden in `done`,
        // fully shown everywhere else. Runs after every authoring control it
        // toggles (including the mode strip + bodies) is mounted.
        const derivedPhase = derivePhase(item);
        applyPhaseLayout(descSibling, derivedPhase);
        // Apply the active authoring mode AFTER the phase gate so it wins over the
        // group un-hide in a non-terminal phase (the strip + inactive-mode bodies are
        // in the authoring group). In `done` AND `accept` the whole group stays
        // hidden — the decision surface owns the space — so skip, or applyAuthoringMode
        // would re-show the textarea/picker/Generate the phase gate just hid.
        if (item.id && derivedPhase !== PHASE.DONE && derivedPhase !== PHASE.ACCEPT) {
            applyAuthoringMode(descSibling, 'write');
            syncGenerateBody(descSibling, item, projectName);
        }
        // Replace the entry region with the TRIAGE RUNNING block while the linked
        // queue row is in `triaging` — a running heading, a live elapsed clock, an
        // indeterminate bar, and the spend line — instead of only swapping
        // Generate's label. Hides the textarea + picker so a landing draft can't
        // overwrite text typed mid-flight. Runs AFTER applyAuthoringMode so its
        // entry-region hide wins; a no-op in every non-triaging state. Committed
        // rows only — a blank placeholder has no queue row to be triaging.
        if (item.id) {
            syncTriageBlock(toDoChild, item);
        }
        // Mount the shared MANUAL STATUS control at the FOOT of the footer stack,
        // below the action buttons — the desktop counterpart to the mobile modal's
        // last-in-dialog placement. Committed rows only: a blank placeholder has
        // no task to annotate yet. It reuses buildManualStatusControl so the two
        // hosts stay in step. Deliberately NOT in DESC_AUTHORING_GROUP_SELECTORS,
        // so applyPhaseLayout leaves it visible in `done` — manual status stays
        // settable on a completed task. Reuse the existing node across reopens
        // (children survive close — the file-picker duplication lesson) but
        // re-append it so it stays last even after the actions above are moved
        // back to the end by their own re-appends on reopen.
        if (item.tit) {
            let manualStatusRow = descSibling.querySelector('#descEditorModalStatusRow');
            if (!manualStatusRow) manualStatusRow = buildManualStatusControl(item, projectName);
            footer.appendChild(manualStatusRow);
        }
    }

    function openPanel() {
        // Opening a task claims the detail pane, so dismiss the TODO.md viewer if
        // it is currently expanded into the pane — otherwise the pane would hold
        // both. This restores whatever the viewer had stashed before we mount the
        // task, hooking the existing row-open path rather than adding a listener.
        dismissDesktopTodoViewer();
        // Only one detail is shown at a time in pane mode — evict any other
        // open panel and clear its selection before mounting this one.
        if (isDetailPaneMode() && openDetail && openDetail.toggle !== descToggle && openDetail.close) {
            openDetail.close();
        }
        // Resolve the host by breakpoint (detail pane on desktop, inline slot on
        // mobile). On the blank placeholder the inline slot sits past the chip
        // row and the paste-entry panel (the CSS reveal keys off that adjacency).
        placeDescPanel(descSibling, toDoChild);
        mountPanelContents();
        descToggle.classList.add("open");
        if (isDetailPaneMode()) {
            toDoChild.classList.add('todo-detail-open');
            openDetail = { toggle: descToggle, descSibling, toDoChild, close: closePanel };
        }
        updateDetailPaneEmptyState();
    }

    function closePanel() {
        // Stop the TRIAGE RUNNING block's elapsed clock before detaching the panel
        // — #descSibling's children survive a close, so a leaked interval would
        // keep ticking on the removed panel. syncTriageBlock restarts it on reopen
        // if the run is still live.
        clearTriageClock(descSibling);
        // Remove the panel from wherever it lives — the detail pane or the inline
        // slot — via its parent, so one path covers both modes.
        if (descSibling.parentNode) descSibling.parentNode.removeChild(descSibling);
        descToggle.classList.remove("open");
        toDoChild.classList.remove('todo-detail-open');
        if (openDetail && openDetail.toggle === descToggle) openDetail = null;
        updateDetailPaneEmptyState();
    }

    descToggle.addEventListener("click", function(event) {
        event.stopPropagation();

        const mainList = toDoChild.parentElement;
        if (!mainList) return;

        if (!descToggle.classList.contains("open")) {
            openPanel();
        } else {
            closePanel();
        }

        // Inserting/removing #descSibling shifts every row below it in
        // #mainList, including an expanded TODO.md viewer card's header. That
        // card caches its body height from a one-time snapshot, so nudge it to
        // recompute against the live layout — otherwise its body overruns the
        // room actually left and collides with neighboring rows. In detail-pane
        // mode the panel no longer occupies list space, so this is a harmless
        // no-op for the list (it re-snapshots the same height).
        refreshViewerExpandedHeight();
    });

    // Enter on the focused expand caret routes through the same click handler
    // so keyboard activation toggles the description panel identically to a
    // mouse click. Focus stays on the caret either way: on expand, Tab steps
    // naturally into the new description input; on collapse, the caret keeps
    // focus so the user can re-open with Enter again.
    descToggle.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        descToggle.click();
    });
}


// Factory function — builds and fully wires a single todo row for the given
// item and project name. Does NOT append to mainList — that's the caller's job.
export function buildToDoRow(item, toDoName) {

    // Per-project display preference: when on, this project's rows render with
    // no due-date pill and no overdue/urgency tint. The stored `due` is never
    // read for display while hidden, but is never cleared, so toggling back on
    // restores the pills untouched.
    const hideDates = listLogic.getProjectHideDates(toDoName);

    // create elements
    const toDoChild       = document.createElement("div");
    const toDoTitleDisplay = document.createElement("span");
    const toDoInput       = document.createElement("input");
    const copyBtn         = document.createElement("button");
    const duePill         = document.createElement("button");
    const closeButtonToDo = document.createElement("div");
    const descToggle      = document.createElement("div");
    const statsToggle     = document.createElement("div");
    const spacer          = document.createElement("div");
    const descSibling     = document.createElement("div");
    const descInput       = document.createElement("textarea");

    // set IDs and initial styles
    toDoChild.id           = "toDoChild";
    // tabindex="-1" lets the global Up/Down arrow handler programmatically
    // focus the row in keyboard-navigation mode (without putting it in the
    // tab order). Enter on a focused row hands focus to the input.
    toDoChild.setAttribute("tabindex", "-1");

    // Marker for rows built as blank placeholders. The keyup persistence
    // block consults this flag so typing into a blank doesn't bake a
    // partial title into the data model — a project switch before Enter
    // would otherwise leave the typed text behind and reveal the row's
    // chrome as though it were a committed todo. The Enter commit handler
    // strips the marker once the row becomes a real item.
    if (!item.tit) {
        toDoChild.dataset.originalBlank = "true";
    }

    duePill.id       = "duePill";
    duePill.type     = "button";
    duePill.setAttribute('aria-haspopup', 'dialog');
    duePill.setAttribute('aria-expanded', 'false');

    spacer.id = "spacer";

    // Wrappable display element for the title. On ≤420px the span is the
    // visible title and the input is visually hidden until focus; long
    // titles can wrap to multiple lines when the row enters mobile-read
    // mode, which a single-line <input> cannot do by HTML spec. Desktop /
    // tablet keep the input as the visible title — CSS hides this span at
    // those breakpoints.
    toDoTitleDisplay.id        = "toDoTitleDisplay";
    toDoTitleDisplay.className = "toDoTitleDisplay";
    toDoTitleDisplay.textContent = item.tit || "";
    if (!item.tit) toDoTitleDisplay.style.display = "none";

    toDoInput.type        = "text";
    toDoInput.autocomplete = "off";
    toDoInput.id          = "toDoInput";
    toDoInput.placeholder = "Add a task — press Enter";
    // Mobile widths (isMobile(), <1024) drop the desktop "press Enter"
    // affordance hint — there's no Enter key affordance on touch — so a
    // blank placeholder row reads simply "Add a task". Desktop keeps the
    // full hint above; the chained-entry override below still wins on mobile.
    if (!item.tit && typeof window !== 'undefined' && window.innerWidth < 1024) {
        toDoInput.placeholder = "Add a task";
    }
    // Blank placeholders built after the user's first mobile commit in
    // this project session switch to the "Type the next…" copy so the
    // chained-entry flow reads as a continuous stream. The desktop
    // affordance string above remains the default; only chained mobile
    // blanks override it.
    if (!item.tit && isChainingActive()) {
        toDoInput.placeholder = "Type the next…";
    }
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

    // Voice capture — a mic button at the trailing edge of the blank
    // placeholder row that dictates a new todo into this row's #toDoInput.
    // Speech recognition, the shared listening overlay, the single-session
    // lifecycle, and the iOS first-grant retry all live in voiceInput.js
    // (also driving the Claude composer mic). mountMicButton returns null on
    // browsers without SpeechRecognition, so the affordance is simply absent
    // there. The mic listens continuously (onFinal makes voiceInput.js set
    // continuous=true), so a speech pause no longer ends it; tapping the overlay
    // adds the todo via onFinal, which dispatches a synthetic Enter keydown on
    // #toDoInput so the transcript flows through the existing commit handler
    // below (mobile due-chip stamp, commitBlankPlaceholder, fresh placeholder,
    // status badge, persistence) exactly as a typed Enter would — never through
    // listLogic.addToDo, which would bypass those side effects. This fixes iOS
    // Safari refusing to reopen the keyboard after the async recognition-end
    // event, which stranded the transcript with no reachable Enter. Cancelling
    // (Escape / surface-close) suppresses onFinal, so it discards rather than
    // commits. focusTarget reveals the input (which the ≤420px layout hides until
    // focus) so the transcript is visible; stopPropagation keeps the tap from
    // also firing the row's focus/commit click handler.
    const micBtn = !item.tit
        ? mountMicButton(toDoInput, {
            id: 'addTaskMic',
            className: 'micButton addTaskMic',
            ariaLabel: 'Add task by voice',
            overlay: true,
            focusTarget: true,
            stopPropagation: true,
            onFinal: function() {
                toDoInput.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', bubbles: true,
                }));
            },
        })
        : null;

    // 📋 paste-entry trigger — like the mic, it belongs only to the blank
    // "Add a task" placeholder (guarded on !item.tit), sits in the input row
    // immediately left of the mic (appended before it below), and is stripped in
    // the same commit-cleanup block the mic is. It toggles the inline paste panel
    // (openPastePanel), whose wiring is unchanged by this relocation.
    const pasteChip = !item.tit ? createPasteChipTrigger(toDoChild, item) : null;

    closeButtonToDo.id = "closeButtonToDo";
    // Hide delete on blank placeholder rows — deleting the only available
    // input slot would leave the user with no way to create new items.
    if (!item.tit) closeButtonToDo.style.display = "none";
    // tabindex + role mirror the descToggle treatment so keyboard users can
    // tab to the delete button and press Enter to fire the same confirm-delete
    // flow the mouse path uses. Hidden placeholder rows skip it via display:none.
    closeButtonToDo.setAttribute("tabindex", "0");
    closeButtonToDo.setAttribute("role", "button");
    closeButtonToDo.setAttribute("aria-label", "Delete todo");

    // Blank placeholder rows hide the due-date pill for the same reason the
    // checkbox / toggle / close button hide above: there's no committed item
    // yet, so the "Set date" trigger would be visual noise. Revealed on commit.
    // Projects with the hide-dates preference on hide the pill unconditionally.
    if (!item.tit || hideDates) {
        duePill.style.display = "none";
    }

    // COPY-TITLE BUTTON — mobile-only chrome that lets the user tap to copy
    // the todo's title to the clipboard. The button is in the DOM for every
    // committed row but only paints at ≤1023px via CSS; desktop rows never
    // surface it. Blank placeholder rows skip it entirely (display:none)
    // because there's no title to copy yet. On click the SVG swaps from the
    // Tabler copy glyph to a checkmark for ~1s as feedback, then restores.
    copyBtn.id = "copyTitleBtn";
    copyBtn.type = "button";
    copyBtn.className = "copyTitleBtn";
    copyBtn.setAttribute("aria-label", "Copy todo title");
    copyBtn.setAttribute("tabindex", "0");
    copyBtn.title = "Copy todo title";
    if (!item.tit) copyBtn.style.display = "none";
    setCopyBtnGlyph(copyBtn, false);

    descToggle.id            = "descToggle";
    descToggle.style.display = item.tit ? "flex" : "none";
    // The chevron is a headless toggle now — CSS hides it at every width (on
    // desktop the copy-title button takes its slot; on touch the row itself
    // opens the description via wireToDoRowClick). So it is no longer a tab
    // stop or an ARIA button — dropping tabindex/role stops it being an
    // invisible tab stop on every row. It keeps its aria-label and the Enter
    // keydown handler (both harmless while unreachable) and its inline
    // style.display writes (main.js's bulk-dispatch placeholder guard reads
    // them); it is the open MECHANISM the callers still click(), not painted UI.
    descToggle.setAttribute("aria-label", "Toggle description");

    // Stats toggle — chart-icon button that opens the recurring-task
    // stats drawer. Always present in the DOM but CSS-hidden unless the
    // row carries `data-has-recurrence` (set by updateRecurringGlyph), so
    // non-recurring rows never surface the icon.
    statsToggle.id = "statsToggle";
    statsToggle.className = "statsToggle";
    statsToggle.setAttribute("tabindex", "0");
    statsToggle.setAttribute("role", "button");
    statsToggle.setAttribute("aria-label", "Show stats");
    statsToggle.setAttribute("aria-expanded", "false");
    statsToggle.title = "Show recurring-task stats";
    statsToggle.innerHTML = '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="12" x2="12" y2="12"/><rect x="3" y="7" width="1.8" height="4"/><rect x="6.1" y="4" width="1.8" height="7"/><rect x="9.2" y="2" width="1.8" height="9"/></svg>';

    descSibling.id  = "descSibling";
    descInput.id    = "descInput";
    // Cross-link the row and its panel so the detail pane (where the panel no
    // longer sits as the row's sibling) can resolve one from the other:
    // openDescSiblingFor walks row → panel, syncDetailPaneForViewport walks
    // panel → row. Every row builds its own #descSibling (they share the id but
    // only one is ever mounted at a time), so this link is unique per row.
    toDoChild.__descSibling = descSibling;
    descSibling.__ownerRow = toDoChild;

    // Inject-to-TODO.md button — appears at the bottom of the description
    // panel and posts the description text to a
    // user-configured Cloudflare Worker. Hidden when the description is
    // empty; the keyup/blur handlers below refresh its state. The button
    // itself manages its five visual states (hidden, unconfigured,
    // no-target, ready, injected) via refreshInjectButton — see inject.js.
    // The project name flows through so the no-target / ready states can
    // resolve the project's per-project inject target.
    // A successful inject leaves the entry sitting in TODO.md undispatched, so
    // offer to run it straight away — scoped to that one entry, never backlog.
    const injectBtn = makeInjectButton(item, {
        projectName: toDoName,
        onInjected: function(injectedItem, injectTarget) {
            promptRunInjectedEntry(injectedItem, injectTarget, toDoName);
        },
    });

    // GENERATE BUTTON — sits beside Inject in the description panel. Flags the
    // task for the agent and fires the triage sweep; the finished draft lands
    // back into this row's description for review (Generate never injects). The
    // resolvers hand syncGenerateControl this row's textarea + inject button so
    // it can make the textarea read-only and disable Inject while generating,
    // and onLanded reflects the landed text and re-evaluates Inject. Committed
    // rows only — wireDescToggle skips mounting it for a blank placeholder.
    const generateBtn = makeGenerateButton(item, {
        projectName: toDoName,
        resolveTextarea: function() { return descInput; },
        resolveInjectBtn: function() { return injectBtn; },
        onLanded: function(draft) {
            descInput.value = draft;
            // Auto-grow reads scrollHeight off the synthetic input event.
            descInput.dispatchEvent(new Event("input"));
            refreshInjectButton(injectBtn, item, toDoName);
            // A draft landing from GENERATE mode returns the strip to WRITE with
            // the generated entry in the textarea; a no-op if already in WRITE.
            applyAuthoringMode(descSibling, "write");
            refreshViewerExpandedHeight();
        },
    });

    // DISCUSS BUTTON — opens the Claude sheet with this task attached (scoped)
    // so the whole conversation stays anchored to it. Sits beside the inject
    // button at the bottom of the description panel. Committed rows only: the
    // panel is only reachable once the row has a title, and a blank id is
    // guarded below, so a placeholder never surfaces a live Discuss action. The
    // opener is reached through the registered handler (main.js wires it) to
    // avoid an import cycle back into claudeSheet.js.
    const discussBtn = document.createElement("button");
    discussBtn.type = "button";
    discussBtn.className = "discussBtn";
    discussBtn.setAttribute("aria-label", "Discuss this task with Claude");
    discussBtn.title = "Discuss this task with Claude";
    discussBtn.innerHTML = '<span class="discussBtnGlyph" aria-hidden="true">💬</span><span class="discussBtnLabel">Discuss</span>';
    discussBtn.addEventListener("click", function(event) {
        event.stopPropagation();
        if (item.id && discussTaskHandler) discussTaskHandler(item.id);
    });

    descInput.autocomplete = "off";
    descInput.placeholder = "Type description here...";
    descInput.style.fontSize = "12px";
    descInput.value = "";
    descInput.style.border = "none";
    // Match the mobile desc-editor modal: a textarea preserves multi-line
    // markdown drafts byte-for-byte through paste / save / reload / copy.
    // Disabling smart substitutions stops iOS / Safari from rewriting `--`
    // to em-dash, straight quotes to curly, `...` to ellipsis — all of
    // which corrupt the markdown a user is drafting for TODO.md.
    descInput.spellcheck = false;
    descInput.autocapitalize = "off";
    descInput.setAttribute("autocorrect", "off");
    descInput.rows = 1;

    // Auto-grow the textarea to fit its content so a single-line description
    // looks as compact as the old <input> did, while multi-line markdown
    // expands the panel to show every line. `scrollHeight` requires the
    // element to be in the DOM, so wireDescToggle fires a synthetic `input`
    // event after the panel is first attached and the value is assigned.
    // In the desktop detail pane the textarea is a flex-fill child instead
    // (the `descEditorFill` marker placeDescPanel sets): CSS gives it the
    // height between the authoring strip and the docked footer and scrolls it
    // internally past that. An inline height would win over that fill and cap
    // the editor at its content, so there the handler writes nothing and
    // clears any height a previous host left behind. The gate is keyed to this
    // one textarea in this one context — every other auto-grow input (the
    // add-task composer, the mobile desc-editor sheet) is untouched.
    function autoGrowDescInput() {
        if (descInput.classList.contains("descEditorFill")) {
            descInput.style.height = "";
            return;
        }
        descInput.style.height = "auto";
        descInput.style.height = descInput.scrollHeight + "px";
    }
    descInput.addEventListener("input", autoGrowDescInput);

    // Keep the read-only FILE readout in step with the entry text. Both edit
    // paths — keystrokes and the file picker's insertion — dispatch `input` on
    // the textarea, so one listener covers both. Cheap: it re-measures the panel
    // height only when the parsed File: path set actually changes.
    descInput.addEventListener("input", function() {
        refreshFileReadout(descSibling, descInput.value);
    });

    // Run-status indicator — occupies the leading slot between the checkbox and
    // the title. Empty at build time; `applyRunStatusGlyph` fills it with the
    // shipped (green check) or pending (amber dashed ring) glyph, or leaves it
    // empty when the task carries no entry id. CSS gates its display on the
    // presence of a `runStatusGlyph--*` state class. Tap routes through the
    // parent row click handler — no separate listener.
    const descIndicator = document.createElement("span");
    descIndicator.id = "descIndicator";
    descIndicator.setAttribute("aria-hidden", "true");

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

    // assemble DOM tree. The read-mode title span (#toDoTitleDisplay) is NOT
    // appended here: the checkbox, phase badge, and status glyph all insert
    // themselves before #toDoInput further down, so appending the span now
    // would leave it stranded ahead of the checkbox while the edit-mode input
    // sits after the badge — the two title slots would render at different
    // positions and the read/edit swap would visibly reorder the row. Instead
    // the span is slotted immediately before #toDoInput after those leading
    // controls are in place (see below), so span and input are adjacent
    // siblings and the swap is a pure visibility toggle.
    toDoChild.appendChild(swipePaneLeft);
    toDoChild.appendChild(swipePaneRight);
    if (addGlyph) toDoChild.appendChild(addGlyph);
    toDoChild.appendChild(toDoInput);
    // Paste trigger renders to the mic's left: appended before it, both on the
    // row's trailing side.
    if (pasteChip) toDoChild.appendChild(pasteChip);
    if (micBtn) toDoChild.appendChild(micBtn);
    toDoChild.appendChild(duePill);
    toDoChild.appendChild(spacer);
    toDoChild.appendChild(statsToggle);
    // The copy-title button sits in the retired chevron's slot, so the desktop
    // trailing cluster reads due pill → stats toggle → copy → ×. Mobile order
    // is fixed by explicit `order` rules in the ≤1023px block, so this DOM move
    // leaves mobile layout unchanged.
    toDoChild.appendChild(copyBtn);
    toDoChild.appendChild(descToggle);
    toDoChild.appendChild(closeButtonToDo);

    updateDuePillLabel(duePill, item);
    // Skip the overdue/urgency row tint when the project hides dates — the
    // stored `due` isn't read for display at all. applyDueUrgency already
    // clears both classes up front, so this leaves the row untinted.
    if (hideDates) {
        toDoChild.classList.remove('due-soon', 'due-overdue');
    } else {
        applyDueUrgency(toDoChild, item);
    }
    updateRecurringGlyph(toDoChild, item);

    // STACK mobile inline-expand chips — only the blank placeholder gets
    // the chip row, since it's the only row the chip controls (Today /
    // Tomorrow / calendar / description toggle) make sense on. The chip
    // row is visually surfaced via CSS at the ≤1023px breakpoint when the
    // row is focus-within.
    attachMobileCreateChips(toDoChild, item);

    duePill.addEventListener('click', function(event) {
        event.stopPropagation();
        if (document.getElementById('dueDatePopover')) {
            hideDueDatePopover();
        } else {
            showDueDatePopover(duePill, item, toDoChild);
        }
    });
    wireSubControlBackspaceExit(duePill, toDoChild);

    // Copy-title button: writes item.tit to the clipboard and briefly swaps
    // the icon to a checkmark as confirmation. stopPropagation prevents the
    // row's click-anywhere-to-focus-input handler from stealing focus when
    // the user taps the icon.
    copyBtn.addEventListener('click', function(event) {
        event.stopPropagation();
        event.preventDefault();
        copyTitleToClipboard(item, copyBtn);
    });
    wireSubControlBackspaceExit(copyBtn, toDoChild);

    // wire helpers
    wireDescToggle(descToggle, toDoChild, descSibling, descInput, injectBtn, generateBtn, discussBtn, item, toDoName);
    wireSubControlBackspaceExit(descToggle, toDoChild);
    wireStatsToggle(statsToggle, toDoChild, item);
    wireSubControlBackspaceExit(statsToggle, toDoChild);
    const checkToDo = wireCheckbox(toDoChild, toDoInput, item);
    // Slot the descIndicator into the row right after the checkbox — visual
    // order on desktop becomes: checkbox · status glyph · title. Insertion has
    // to wait until wireCheckbox runs so the checkbox is already in place;
    // inserting before toDoInput puts the indicator just past the checkbox.
    toDoChild.insertBefore(descIndicator, toDoInput);
    // Render the run-status glyph (shipped / pending / none) in the indicator,
    // and make sure the live-refresh listener is attached so the glyph updates
    // as runs reconcile without a full re-render.
    ensureRunStatusDotListener();
    // One derived phase drives both the glyph and the REVIEW badge below, so the
    // row states its pipeline position exactly once rather than resolving it
    // twice through separate code paths.
    const phase = derivePhase(item);
    applyRunStatusGlyph(descIndicator, phase);
    // Kick a shipped-marker refresh for this project's routed target so the
    // glyph flips to green once the entry's TODO.md checkbox is [x]. Force past
    // the 60s TTL: a run may ship while this project isn't rendered (or the tab
    // reloads after shipping), so the row would otherwise paint from a stale
    // pre-ship cache entry until the TTL lapses — a shipped fact must be trusted
    // immediately.
    if (item.entryId) refreshShippedMarkersForProject(toDoName, true);

    // Workflow-status badge — committed rows only. Sits right after the
    // checkbox, ahead of the title, and is itself the tap target for the
    // status-change popover (the delegated handler on #mainList resolves the
    // click). The matching modifier class drives the row's stripe / muting in
    // CSS. Blank placeholder rows skip both: there is no committed task to tag.
    if (item.tit) {
        applyTodoStatusClass(toDoChild, item.status);
        toDoChild.insertBefore(buildStatusLabel(item, overlayForPhase(phase)), descIndicator);
    }
    // Slot the read-mode title span immediately before #toDoInput, now that the
    // checkbox, phase badge, and status glyph have all been inserted ahead of
    // the input. This keeps the span and the input adjacent siblings at the same
    // position in the row, so the read↔edit swap only changes which element is
    // visible — never the row's left-to-right order (checkbox · badge · glyph ·
    // title). Built once at construction and only repositioned here, so it is
    // not re-created on each blur.
    toDoChild.insertBefore(toDoTitleDisplay, toDoInput);
    attachToDoDrag(toDoChild, toDoInput, toDoName, {
        checkToDo: checkToDo,
        closeButtonToDo: closeButtonToDo,
        item: item
    });
    wireToDoRowClick(toDoChild, toDoInput, descToggle);

    // Browsers natively toggle a checkbox on Space but NOT on Enter. Adding
    // Enter→toggle here keeps the keyboard contract uniform with the row's
    // other sub-controls (title, due pill, expand caret, delete X, description),
    // each of which activates on Enter when focused.
    checkToDo.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        checkToDo.checked = !checkToDo.checked;
        checkToDo.dispatchEvent(new Event("change"));
    });
    wireSubControlBackspaceExit(checkToDo, toDoChild);

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
        toDoTitleDisplay.textContent = val;
        toDoTitleDisplay.style.display = "";
        item.tit = val;
        item.pri = 2;
        // Row is no longer a blank placeholder — clear the marker so the
        // keyup persistence block resumes saving keystroke edits to this
        // now-committed row's title.
        delete toDoChild.dataset.originalBlank;
        // STACK mobile inline-expand: if the user picked Today / Tomorrow
        // from the chip row (or left the default Today), stamp that date
        // before the desktop fallback. The chip module no-ops on Custom
        // chip selection — the popover already wrote item.due in that
        // path, so parseItemDue catches it below and the fallback skips.
        if (window.innerWidth < 1024 && !parseItemDue(item)) {
            applyChosenDueToItem(item, toDoChild);
        }
        // If no due date is set yet, default to today so the urgency
        // classes and footer counter have something meaningful to key off.
        if (!parseItemDue(item)) {
            const fallback = defaultDueParts();
            item.due = fallback.m + "-" + fallback.d + "-" + fallback.y;
        }

        listLogic.saveToStorage();
        if (isFirstCommit) {
            listLogic.commitBlankPlaceholder(toDoName, item);
        } else {
            listLogic.editToDoItem(toDoName, item);
        }
        applyDueUrgency(toDoChild, item);
        updateDuePillLabel(duePill, item);

        // Idempotent — no-op when already visible; safely covers first-commit reveal.
        descToggle.style.display      = "flex";
        checkToDo.style.display       = "";
        closeButtonToDo.style.display = "";
        duePill.style.display         = "";
        copyBtn.style.display         = "";
        // Strip the blank-row affordance cue — once committed, this row is a
        // real todo and the leading `+` glyph would be misleading.
        if (addGlyph && addGlyph.parentElement) addGlyph.remove();
        // Same for the voice-dictation mic: it only belongs on the blank
        // "Add a task" placeholder, so remove it once this row is committed.
        if (micBtn && micBtn.parentElement) micBtn.remove();
        // And the 📋 paste-entry trigger, which shares the mic's blank-only
        // lifecycle — drop it so a committed row carries neither control.
        if (pasteChip && pasteChip.parentElement) pasteChip.remove();
        // When the project hides due dates, undo the pill reveal and urgency
        // tint the default block above just applied — committing a task must
        // not surface a pill this project has opted out of. The stored `due`
        // is untouched, so toggling dates back on restores it.
        if (hideDates) {
            duePill.style.display = "none";
            toDoChild.classList.remove('due-soon', 'due-overdue');
        }
        // The row was built as a blank placeholder, so it has no status badge
        // yet — add one now that it's a committed task. Guard against a repeat
        // insert if the same row somehow re-commits.
        if (!toDoChild.querySelector('.todoStatusLabel')) {
            applyTodoStatusClass(toDoChild, item.status);
            toDoChild.insertBefore(buildStatusLabel(item, overlayForPhase(derivePhase(item))), descIndicator);
        }

        // Strip the blank-placeholder marker and the chip row now that this
        // row is a real todo. This runs at EVERY width: the 📋 paste-entry
        // chip surfaces on desktop too, so a committed desktop row must shed
        // its chip sibling and marker just like a mobile one — otherwise the
        // marker (and, on desktop, the now-visible chip row) lingers and the
        // next blank placeholder stacks a second one beneath it.
        toDoChild.removeAttribute('data-blank-placeholder');
        toDoChild.removeAttribute('data-paste-open');
        toDoChild.classList.remove('mobile-create-row');
        // The chip row lives as the row's next sibling (its own grid row),
        // not a child, so reach it there to strip it on commit. The paste
        // chip's inline panel (mounted right after the chip row) must go too —
        // committing via a typed title while it is open would otherwise leave
        // it orphaned beneath a now-committed row.
        let chipRow = null;
        let pastePanel = null;
        let scan = toDoChild.nextSibling;
        while (scan && (scan.id === 'createChipRow' || scan.id === 'pasteEntryPanel')) {
            if (scan.id === 'createChipRow') chipRow = scan;
            if (scan.id === 'pasteEntryPanel') pastePanel = scan;
            scan = scan.nextSibling;
        }
        if (chipRow) chipRow.remove();
        if (pastePanel) pastePanel.remove();

        // STACK mobile commit accent — 700ms fading purple left-edge so the
        // user sees their just-committed task land — plus the session flip
        // into "chaining" mode so the next blank placeholder built by
        // appendNewToDoRow uses the "Type the next…" copy. Both are part of
        // the mobile inline-expand flow, not the desktop paste affordance, so
        // they stay gated to the ≤1023px breakpoint.
        if (window.innerWidth < 1024) {
            if (!prefersReducedMotion()) {
                toDoChild.classList.add('justCommittedMobile');
                setTimeout(function() {
                    toDoChild.classList.remove('justCommittedMobile');
                }, 700);
            }
            markChainingActive();
        }

        toDoInput.blur();
        if (isFirstCommit) {
            appendNewToDoRow(toDoName);
        } else {
            focusBlankToDoInput();
        }
    });

    // toDoInput keyup — save on every keystroke. Skip the persistence write
    // entirely for rows still flagged as blank placeholders: a partial title
    // baked into item.tit would re-render as a committed row (chrome and all)
    // after a project switch, since buildToDoRow keys its placeholder branches
    // off `!item.tit`. The Enter commit handler clears the flag, so chained
    // edits after commit keystroke-save like any other committed row.
    toDoInput.addEventListener("keyup", function() {
        if (toDoChild.dataset.originalBlank === "true") return;
        const val = toDoInput.value.trim();
        if (val.length > 0) {
            item.tit = val;
            toDoInput.title = val;
            toDoTitleDisplay.textContent = val;
            listLogic.saveToStorage();
            // Keep the detail-pane header's title in step with a live rename —
            // it reads this row's __item, so a stale header after a rename is the
            // most likely defect. No-op unless this row is the one open in the pane.
            syncDetailPaneHeader();
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
        toDoTitleDisplay.textContent = item.tit || "";
        syncDetailPaneHeader();
        // Hand the visible slot back to the wrappable display span —
        // clearing data-title-edit re-applies the opacity:0 swap so the
        // span (now showing the updated item.tit) is what the user sees,
        // on phones and in the desktop queue rail alike.
        toDoChild.removeAttribute('data-title-edit');
    });

    // Escape on the title cancels the in-progress edit by restoring the
    // value captured on the last focus, then blurs so the user can move on.
    // Mirrors the standard inline-edit cancel pattern used by other apps.
    toDoInput.addEventListener("keydown", function(event) {
        if (event.key !== "Escape") return;
        toDoInput.value = savedTitle;
        item.tit = savedTitle;
        listLogic.saveToStorage();
        toDoInput.title = savedTitle;
        toDoTitleDisplay.textContent = savedTitle;
        syncDetailPaneHeader();
        toDoInput.blur();
        event.preventDefault();
    });

    // descInput keydown — Ctrl/Cmd+Enter commits and exits. Plain Enter is
    // left alone so the textarea inserts a newline naturally — multi-line
    // markdown drafts (the whole point of this surface) need real \n chars
    // in the stored desc string, not collapsed whitespace.
    descInput.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        item.desc = descInput.value;
        listLogic.saveToStorage();
        descInput.style.border = "none";
        refreshInjectButton(injectBtn, item, toDoName);
        descInput.blur();
    });

    // descInput keyup — save on every keystroke (empty saves too). No trim:
    // leading / trailing newlines and indentation are part of the user's
    // markdown draft and must survive save → reload round-trips.
    descInput.addEventListener("keyup", function() {
        item.desc = descInput.value;
        listLogic.saveToStorage();
        refreshInjectButton(injectBtn, item, toDoName);
    });

    // descInput blur — persist on click-away so cleared values aren't lost.
    // Route the desc write through listLogic.editToDoItem in addition to
    // saveToStorage so the Supabase mirror fires. Without that, the desc
    // edit only landed in localStorage and the next hydrateFromSupabase
    // pull overwrote it with the canonical backend snapshot — i.e. an
    // empty desc — making the user's draft silently disappear after a
    // hard refresh. Mirrors the mobile descriptor modal's onSave path.
    // Ctrl+Enter and Escape both call descInput.blur(), so this single
    // boundary covers every exit path without flooding Supabase on every
    // keystroke the way attaching to keyup would.
    descInput.addEventListener("blur", function() {
        item.desc = descInput.value;
        listLogic.saveToStorage();
        if (toDoName) listLogic.editToDoItem(toDoName, item);
        refreshInjectButton(injectBtn, item, toDoName);
        // A programmatic revert (Escape) sets .value without firing `input`, so
        // repaint the readout here too — blur is the other persist signal.
        refreshFileReadout(descSibling, descInput.value);
    });

    // Escape on the description cancels the in-progress edit by restoring
    // the value captured on the last focus, then blurs. Matches the title's
    // Escape semantics so both inline-edit surfaces feel the same.
    let savedDesc = item.desc || "";
    descInput.addEventListener("focus", function() {
        savedDesc = item.desc || "";
    });
    descInput.addEventListener("keydown", function(event) {
        if (event.key !== "Escape") return;
        descInput.value = savedDesc;
        item.desc = savedDesc;
        listLogic.saveToStorage();
        descInput.blur();
        event.preventDefault();
    });

    // closeButtonToDo click — confirm, then remove this todo item and re-render.
    // Deletes by item reference so duplicate titles or a cleared input value
    // can't misroute the splice onto a different row.
    closeButtonToDo.addEventListener("click", function() {
        const label = (item.tit || "").trim() || "this todo";
        showConfirmModal({
            message: 'Delete "' + label + '"? This cannot be undone.',
            onConfirm: function() {
                // Capture the deleted row's slot among `#toDoChild` siblings
                // before splicing it out, so after re-render we can shift
                // `.todo-active` to whatever row now occupies that slot —
                // keeping a visible anchor for arrow-key nav instead of
                // leaving the list with no active row.
                const mainDiv = document.getElementById('mainList');
                const priorRows = mainDiv
                    ? Array.prototype.slice.call(mainDiv.querySelectorAll('#toDoChild'))
                    : [];
                const deletedIdx = priorRows.indexOf(toDoChild);

                listLogic.removeToDoByItem(toDoName, item);

                while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }

                addAllToDo_DOM(listLogic.listItems(toDoName), toDoName);

                if (deletedIdx >= 0) {
                    const newRows = Array.prototype.slice.call(
                        mainDiv.querySelectorAll('#toDoChild')
                    );
                    // Prefer the row that now occupies the deleted slot
                    // (a neighbor below). If the deleted row was the last
                    // one, fall back to the previous row. If the only
                    // remaining row is the blank placeholder — i.e. the
                    // user just deleted the last committed todo — let it
                    // receive `.todo-active` so the list still has a
                    // visible anchor for arrow-key nav.
                    const target = newRows[deletedIdx] || newRows[newRows.length - 1];
                    if (target) {
                        // Defer to the next task so the modal's confirm-
                        // click finishes bubbling before we mark the row.
                        // The document-level listener in main.js strips
                        // `.todo-active` from every row on any click that
                        // isn't inside a `#toDoChild` — including the
                        // modal button — so adding the class synchronously
                        // here would be wiped out a moment later.
                        setTimeout(function() {
                            mainDiv.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
                                if (el !== target) el.classList.remove('todo-active');
                            });
                            target.classList.add('todo-active');
                            // Focus the row itself (tabindex="-1") so the
                            // `:focus-within` highlight kicks in — the
                            // visible outline that the user expects after
                            // deletion comes from focus, not the class.
                            // Mirrors the arrow-nav handler in main.js.
                            target.focus();
                        }, 0);
                    }
                }
            }
        });
    });

    // Enter on the focused delete button routes through the same click
    // handler so keyboard users get the same confirm-then-delete modal flow
    // as a mouse click — the row is never deleted without confirmation.
    closeButtonToDo.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        closeButtonToDo.click();
    });
    wireSubControlBackspaceExit(closeButtonToDo, toDoChild);

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


// Map the global task-sort preference to a render order. Returns a NEW array
// for the 'due' / 'status' modes (the helpers never mutate the input or the
// underlying `pos` field) and the original array untouched for 'none', so
// switching the sort back to None restores the user's manual order. The sort
// is a pure render concern — the data model is never reordered.
function renderOrderForSort(items) {
    const mode = getTaskSort();
    if (mode === 'due') return sortItemsByDueForRender(items);
    if (mode === 'status') return sortItemsByStatusForRender(items);
    return items;
}


// Render every persisted item for `name` into #mainList. Used on the bulk
// add path (project switch from a fresh project, post-delete re-render).
// `items` is the array returned by listLogic.listItems(name).
export function addAllToDo_DOM(items, name) {
    if (!items) return;
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    // A full rebuild replaces every row element, so any panel open in the detail
    // pane belongs to a now-detached row (its task may not even exist post-render,
    // e.g. after a delete or project switch) — clear it so the pane never shows a
    // stale detail.
    clearDetailPane();
    const renderOrder = renderOrderForSort(items);
    renderOrder.forEach(function(item) {
        mainListDiv.appendChild(buildToDoRow(item, name));
    });
    updateCompletedSection(mainListDiv);
    applyTaskFilter();
    // Load this project's agent_queue rows into the shared store so any task
    // whose linked row is in needs_words lights its ASKING badge (and can be
    // answered inline) — even if the Agent tab is never opened. Repaints the
    // derived badges once the cache resolves.
    loadQueueRowsForRender(name);
}


// Re-render a project's rows from persisted data. Re-sorts first so the
// blank placeholder is pinned to the top of the list, then renders every
// item — including the blank — so the user always has a ready-to-type
// slot at the top of the list. Used by the restoreFromStorage path on boot
// and by selectProject when a previously visited project becomes active.
//
// `opts.fromSync: true` forwards onto listLogic.sortCompletedToBottom so
// the post-import rebuild — which re-sorts every project on the way
// through — flags itself as reconciliation work and skips per-row
// Supabase mirror writes. The user-triggered callers (project select,
// post-rename re-render, app boot) keep their existing behaviour by
// omitting opts.
export function addToDos_restore(toDoArray, toDoName, opts) {
    if (!toDoArray || toDoArray.length === 0) return;
    listLogic.sortCompletedToBottom(toDoName, opts);
    const items = listLogic.listItems(toDoName);
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    // Full rebuild — drop any open detail pane panel (its row is being replaced).
    clearDetailPane();
    const renderOrder = renderOrderForSort(items);
    renderOrder.forEach(function(item) {
        mainListDiv.appendChild(buildToDoRow(item, toDoName));
    });
    updateCompletedSection(mainListDiv);
    applyTaskFilter();
    loadQueueRowsForRender(toDoName);
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

    const renderOrder = renderOrderForSort(items);
    renderOrder.forEach(function(item) {
        let row = rowsByItem.get(item);
        if (!row) row = buildToDoRow(item, projectName);
        // Collect any auxiliary panels that belong to this row (the
        // description panel, the recurring-task stats drawer, the blank
        // placeholder's mobile chip row, and the paste-entry panel can be
        // present). They sit as consecutive siblings beneath the row.
        const auxiliary = [];
        let next = row.nextSibling;
        while (next && (next.id === 'descSibling' || next.id === 'statsSibling' || next.id === 'createChipRow' || next.id === 'pasteEntryPanel')) {
            auxiliary.push(next);
            next = next.nextSibling;
        }
        mainDiv.appendChild(row);
        auxiliary.forEach(function(node) { mainDiv.appendChild(node); });
    });

    updateCompletedSection(mainDiv);
    applyTaskFilter();
    // Reorder reuses row elements (selection class persists on them), but a row
    // that had to be rebuilt — or the selected task being removed — leaves the
    // detail pane pointing at a detached row; reconcile clears it in that case.
    reconcileDetailPane();
}


// Wire drag reordering on a todo row. Keeps `row.draggable` in sync with
// the title state so blank placeholder rows never participate in reorder
// math, and text selection inside the title input isn't hijacked by the
// browser's drag handler during editing.
// `swipeTargets` (optional) wires horizontal swipe-to-complete / swipe-to-delete
// on touch devices. Swipe-right reuses the existing checkbox change path so
// persistence is identical. Swipe-left commits the delete immediately (no
// confirm modal — the mobile flow uses a 5s UNDO toast for recovery per
// the STACK mobile task-interactions spec) and surfaces an undo affordance
// the user can tap to restore the row at its original position.
export function attachToDoDrag(toDoChild, toDoInput, project, swipeTargets) {

    const swipeCfg = swipeTargets ? {
        onRight: function() {
            const cb = swipeTargets.checkToDo;
            if (!cb || cb.style.display === 'none') return;
            // Capture direction BEFORE toggling so the center-screen
            // confirmation flash only fires on the complete direction —
            // swiping right on an already-completed row to uncomplete it
            // stays silent.
            const willComplete = !cb.checked;
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
            if (willComplete) {
                document.dispatchEvent(new CustomEvent('todoSwipeRightComplete'));
            }
        },
        onLeft: function() {
            const btn = swipeTargets.closeButtonToDo;
            if (!btn || btn.style.display === 'none') return;
            const item = swipeTargets.item;
            // Resolve the live project name from the row — the closed-over
            // `project` value may be stale if the user navigated away and
            // back, but the row's data-value is kept in sync by selectProject.
            const projectName = toDoChild.dataset && toDoChild.dataset.value
                ? toDoChild.dataset.value
                : project;
            if (!item || !projectName) {
                // Fall back to the existing confirm-modal path when we can't
                // identify the item — keeps the safety net intact for any
                // unexpected wiring instead of silently dropping the action.
                btn.click();
                return;
            }
            const items = listLogic.listItems(projectName) || [];
            const originalIndex = items.indexOf(item);
            if (originalIndex === -1) return;

            const label = (item.tit || '').trim() || 'todo';

            listLogic.removeToDoByItem(projectName, item);

            const mainDiv = document.getElementById('mainList');
            if (mainDiv) {
                while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }
                addAllToDo_DOM(listLogic.listItems(projectName), projectName);
            }

            showUndoToast({
                label: 'Deleted "' + label + '"',
                onUndo: function() {
                    listLogic.insertToDoAt(projectName, item, originalIndex);
                    const md = document.getElementById('mainList');
                    if (md) {
                        while (md.firstChild) { md.removeChild(md.firstChild); }
                        addAllToDo_DOM(listLogic.listItems(projectName), projectName);
                    }
                }
            });
        }
    } : null;

    setupRowDrag(toDoChild, {
        container: document.getElementById('mainList'),
        itemSelector: '#toDoChild',
        isDraggable: function() {
            // An active sort (Due / Status) overrides manual order, so drag
            // would reshuffle to nothing the moment the row re-renders. Pin
            // the row to non-draggable while a sort is applied.
            if (getTaskSort() !== 'none') return false;
            return !!(toDoInput && toDoInput.value && toDoInput.value.trim().length > 0);
        },
        isSwipeable: function() {
            // Swipe-to-complete / swipe-to-delete stay available on any
            // committed row regardless of the active sort — completing or
            // deleting via swipe doesn't conflict with a sort the way manual
            // reorder does. On mobile the per-row checkbox and delete button
            // are display:none, so swipe is the only touch path for these
            // actions; gating it behind the sort would strand them. Blank
            // placeholder rows (no committed title) stay non-swipeable.
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
        const sortLocked = getTaskSort() !== 'none';
        toDoChild.setAttribute(
            'draggable',
            (!sortLocked && toDoInput.value.trim().length > 0) ? 'true' : 'false'
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