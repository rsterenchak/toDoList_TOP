// Workflow-status indicator + status-change popover for committed todo rows.
//
// Each committed row carries a small status badge (`.todoStatusLabel`) that
// both DISPLAYS the task's workflow status and ACTS as the tap target to
// change it — there is no separate icon or button, the label is the control.
// Tapping it opens an anchored popover with the three status choices; the
// selection routes through `listLogic.setToDoStatus`, the same CRUD path every
// other todo mutation uses, so persistence and the Supabase mirror come for
// free.
//
// The label click is handled by a SINGLE delegated listener installed once on
// #mainList (see `wireStatusLabelDelegation`), not by a per-row listener. This
// is deliberate: main.js's webpack-entry evaluation can register module-level
// listeners more than once, so a per-row binding risks double-firing. One
// delegated handler on the list parent sidesteps that cleanly and matches the
// pattern the rest of the row interactions follow.
//
// Row-level treatment (the in-progress left-stripe, the idea muting) is driven
// entirely by a modifier class in style.css — JS never sets a background or
// text color inline, since that override pattern is a known fragile area here.

import { listLogic } from './listLogic.js';
import { reorderToDoDOM } from './toDoRow.js';


// Display metadata per status. The glyph + uppercase label match the Option C
// mockups; `rowClass` is the modifier that style.css keys the stripe /
// background / muting off of.
export const STATUS_META = {
    active:      { label: '○ ACTIVE',      rowClass: 'todo-row--active' },
    in_progress: { label: '⏵ IN PROGRESS', rowClass: 'todo-row--in_progress' },
    idea:        { label: '○ IDEA',        rowClass: 'todo-row--idea' },
};

// Render order for the popover options and the class-clearing sweep. Exported
// so other surfaces (e.g. the mobile description editor's status selector)
// render the same vocabulary in the same order rather than re-hardcoding it.
export const STATUS_ORDER = ['active', 'in_progress', 'idea'];

// Derived, non-settable display state. A committed row whose entry has shipped
// but hasn't been acknowledged renders this label instead of its manual status.
// It is deliberately absent from STATUS_META / STATUS_ORDER: REVIEW never
// appears in the popover, is never written to `status`, and never drives the
// row-level stripe/muting — it is purely a display overlay that a tap clears.
// The caller supplies the `needsReview` boolean (resolved from the shared
// marker cache at the row layer, which owns the inject.js dependency); this
// module only renders and acts on it.
export const REVIEW_LABEL = '⌁ REVIEW';

// A second derived, non-settable overlay: a committed row whose linked
// `agent_queue` row is parked in `needs_words` (triage has a pending question)
// renders this amber label instead of its manual status. Like REVIEW it never
// appears in the popover, is never written to `status`, and never drives the
// row-level stripe/muting — it is purely a display overlay. Its tap opens the
// row's description panel (where the question + answer field live) rather than
// the status popover. The caller supplies the derived overlay descriptor
// (resolved from the shared agent-queue cache via derivePhase at the row layer).
export const ASKING_LABEL = '⌁ ASKING';

// A third derived, non-settable overlay: a committed row whose linked
// `agent_queue` row is in `drafted` and whose landed draft the user hasn't
// dispatched yet renders this amber label instead of its manual status. Like
// REVIEW and ASKING it never appears in the popover, is never written to
// `status`, and never drives the row-level stripe/muting — it is purely a display
// overlay. Its tap routes to the Agent board scrolled to this task's card, where
// the Dispatch control lives (the draft text stays reachable via the row's
// description chevron); the overlay clears once the linked row leaves drafted. The
// caller supplies the derived overlay descriptor (resolved from the shared
// agent-queue cache via derivePhase at the row layer).
export const DRAFTED_LABEL = '⌁ DRAFTED';

// A fourth derived, non-settable overlay: a committed row whose linked
// `agent_queue` row is in `failed` or `no_change` — a run that broke or completed
// without changing anything. Unlike REVIEW / ASKING / DRAFTED (amber "waiting on
// you"), this paints in danger red — "this went wrong" — but is otherwise the same
// kind of overlay: never in the popover, never written to `status`, and never
// driving the row stripe. Its tap routes to the Agent board scrolled to this
// task's card, where the Retry / re-dispatch controls live (the failure reason
// stays reachable via the row's description chevron). The caller supplies the
// derived overlay descriptor (resolved from the shared agent-queue cache via
// derivePhase at the row layer).
export const STUCK_LABEL = '⌁ STUCK';

// A fifth derived, non-settable overlay: a committed row whose linked
// `agent_queue` row is parked in `needs_mockup` — the run is waiting on a mockup
// decision. Like REVIEW / ASKING / DRAFTED it paints amber ("waiting on you") and
// never appears in the popover, is never written to `status`, and never drives the
// row-level stripe/muting. Its tap opens the row's description panel (the same
// destination ASKING / DRAFTED / STUCK use), where the choose-a-mockup A/B/C flow
// mounts above the authoring region — three variants across in the desktop detail
// pane, an OPTION A/B/C tab strip in the mobile description-editor modal. The caller
// supplies the derived overlay descriptor (resolved from the shared agent-queue
// cache via derivePhase at the row layer).
export const MOCKUP_LABEL = '⌁ MOCKUP';
const ALL_ROW_CLASSES = STATUS_ORDER.map(function (s) { return STATUS_META[s].rowClass; });


// Handler that opens the project's TODO.md viewer anchored to a shipped entry
// when its `⌁ REVIEW` badge is tapped. Registered by main.js (which owns the
// mobile bottom-sheet host + the viewer's open-and-anchor entry point), the same
// indirection setViewerCardTapHandler uses — so this module never imports
// todoMdViewer.js or main.js and stays free of the inject.js/module-cycle
// concerns the file header documents. Invoked with (entryId, projectName).
let reviewBadgeTapHandler = null;
export function setReviewBadgeTapHandler(fn) {
    reviewBadgeTapHandler = typeof fn === 'function' ? fn : null;
}

// Invoke the registered review-badge handler from another surface (the mobile
// description editor's REVIEW action reaches the viewer through the same entry
// point rather than importing todoMdViewer.js / main.js itself). Returns true
// when a handler was registered and invoked, false otherwise — so a caller can
// gate its own affordance on the same registration and never leave a dead
// control that opens nothing.
export function invokeReviewBadgeTap(entryId, projectName) {
    if (!reviewBadgeTapHandler) return false;
    reviewBadgeTapHandler(entryId, projectName);
    return true;
}


// Handler that opens the mobile description-editor modal for a task's row when one
// of its phase badges is tapped on a touch device — `⌁ ASKING`, `⌁ DRAFTED`,
// `⌁ STUCK`, `⌁ MOCKUP`, and `⌁ REVIEW` all route here on `(pointer: coarse)`, where
// the modal mounts the asking / dispatch / review blocks the inline `#descSibling`
// panel would otherwise host (an accordion drop-down the mobile design never
// intended). Registered by main.js (which owns the modal opener + resolves the row
// from the todo id), the same indirection setReviewBadgeTapHandler /
// setLocateTabSwitch use — so this module never imports modals.js / toDoRow.js's
// opener and stays free of the module-cycle concerns the file header documents.
// Invoked with (todoId, projectName). On desktop (fine pointer) the badge taps
// fall through to their existing destinations instead — the inline `#descSibling`
// panel (asking / drafted / stuck / mockup) or the TODO.md viewer (review).
let agentRouteBadgeTapHandler = null;
export function setAgentRouteBadgeTapHandler(fn) {
    agentRouteBadgeTapHandler = typeof fn === 'function' ? fn : null;
}

// True on touch/coarse-pointer viewports, where the phase badges open the
// description-editor modal rather than the inline `#descSibling` panel. Mirrors
// toDoRow.js's isCoarsePointerTap so both surfaces read the same media query, and
// tolerates a jsdom/SSR host with no matchMedia (returns false → the desktop
// fall-through path).
function isCoarsePointer() {
    return typeof window !== 'undefined'
        && !!window.matchMedia
        && window.matchMedia('(pointer: coarse)').matches;
}

// Route a phase badge to the modal on a touch device. Returns true when the tap
// was handled (coarse pointer AND a modal-opener handler is registered), so the
// caller returns early; false leaves the desktop fall-through path in charge.
function routeBadgeToModalOnTouch(item, projectName) {
    if (!isCoarsePointer() || !agentRouteBadgeTapHandler) return false;
    agentRouteBadgeTapHandler(item.id, projectName);
    return true;
}


// Coerce an arbitrary status to a known one. Mirrors listLogic's
// normalizeTodoStatus so the UI never renders an out-of-vocabulary badge — a
// cached todo predating the field (status undefined) reads as 'active'.
export function normalizeStatus(status) {
    return STATUS_META[status] ? status : 'active';
}


// Apply the status modifier class to a row, clearing any prior one first. Pure
// DOM — no persistence. Used on initial build and after an in-place change.
export function applyTodoStatusClass(toDoChild, status) {
    if (!toDoChild) return;
    ALL_ROW_CLASSES.forEach(function (cls) { toDoChild.classList.remove(cls); });
    toDoChild.classList.add(STATUS_META[normalizeStatus(status)].rowClass);
}


// Normalize a caller's overlay argument to one of the derived-overlay states.
// Back-compat: a boolean `true` (the old `needsReview` signal) maps to 'review';
// a string 'review'/'asking' passes through; anything else is no overlay (null).
function normalizeOverlay(overlay) {
    if (overlay === true || overlay === 'review') return 'review';
    if (overlay === 'asking') return 'asking';
    if (overlay === 'drafted') return 'drafted';
    if (overlay === 'stuck') return 'stuck';
    if (overlay === 'mockup') return 'mockup';
    return null;
}


// Build the status label element for a committed row. The label both shows the
// status and is the tap target (aria-haspopup="menu"); the delegated handler
// reads the owning row's `__item` to resolve the live status on click, so this
// element only needs to reflect the value at build time. When `overlay` is a
// derived state the label renders that overlay (`⌁ REVIEW` / `⌁ ASKING` /
// `⌁ DRAFTED`) instead
// of the manual status, and its tap behaves per-overlay rather than opening the
// popover — the ARIA reflects that. The manual status is untouched underneath,
// so clearing the overlay reverts the label to it.
export function buildStatusLabel(item, overlay) {
    const status = normalizeStatus(item && item.status);
    const label = document.createElement('button');
    label.type = 'button';
    label.id = 'todoStatusLabel';
    label.className = 'todoStatusLabel';
    label.setAttribute('aria-expanded', 'false');
    label.setAttribute('tabindex', '0');
    applyStatusLabelState(label, status, overlay);
    return label;
}


// Set a label's rendered state — data-status, text, and the overlay-specific
// ARIA — for either a derived overlay (review / asking) or the manual status.
// Shared by build and refresh so the two paths can never drift.
function applyStatusLabelState(label, status, overlay) {
    const derived = normalizeOverlay(overlay);
    if (derived === 'review') {
        label.setAttribute('data-status', 'review');
        label.removeAttribute('aria-haspopup');
        label.setAttribute('aria-label', 'Acknowledge shipped task');
        label.textContent = REVIEW_LABEL;
    } else if (derived === 'asking') {
        label.setAttribute('data-status', 'asking');
        label.removeAttribute('aria-haspopup');
        label.setAttribute('aria-label', 'Triage is asking a question — open to answer');
        label.textContent = ASKING_LABEL;
    } else if (derived === 'drafted') {
        label.setAttribute('data-status', 'drafted');
        label.removeAttribute('aria-haspopup');
        label.setAttribute('aria-label', 'A draft landed — open the description panel to dispatch it');
        label.textContent = DRAFTED_LABEL;
    } else if (derived === 'stuck') {
        label.setAttribute('data-status', 'stuck');
        label.removeAttribute('aria-haspopup');
        label.setAttribute('aria-label', 'This run went wrong — open the description panel to retry');
        label.textContent = STUCK_LABEL;
    } else if (derived === 'mockup') {
        label.setAttribute('data-status', 'mockup');
        label.removeAttribute('aria-haspopup');
        label.setAttribute('aria-label', 'Waiting on a mockup decision — open the description panel to choose one');
        label.textContent = MOCKUP_LABEL;
    } else {
        label.setAttribute('data-status', status);
        label.setAttribute('aria-haspopup', 'menu');
        label.setAttribute('aria-label', 'Change task status');
        label.textContent = STATUS_META[status].label;
    }
}


// Refresh a row's label text + modifier class in place after a status change,
// avoiding a full re-render that would disturb the row's other in-flight state.
// `overlay` overlays the derived REVIEW / ASKING label; the row modifier class
// always tracks the MANUAL status, so the stripe/muting never keys off an overlay.
export function refreshTodoStatusUI(toDoChild, item, overlay) {
    if (!toDoChild) return;
    const status = normalizeStatus(item && item.status);
    applyTodoStatusClass(toDoChild, status);
    const label = toDoChild.querySelector('.todoStatusLabel');
    if (label) applyStatusLabelState(label, status, overlay);
}


// ── SHARED MANUAL-STATUS SEGMENTED CONTROL ──
// A labeled "Manual status" row with three connected segments (Active / In
// Progress / Idea), single-sourced from STATUS_META / STATUS_ORDER. It is the
// user's OWN annotation, distinct from the derived pipeline phase the rail
// renders — hence the "Manual status" label. Built here (not in a UI file) so
// the two surfaces that expose it stay in lockstep, the same extraction the
// phase rail and file picker already needed:
//   • the mobile description-editor modal (the on-row badge is hidden ≤1023px), and
//   • the desktop detail pane (the badge's manual values are hidden ≥1024px).
// Selecting a segment routes through listLogic.setToDoStatus — the same channel
// the on-row popover and every other todo mutation use, so the localStorage
// write and the Supabase mirror both come free — then repaints the live row in
// #mainList and re-sorts / re-filters via reorderToDoDOM so a sort = Status move
// and the status-filter counts stay correct. The markup + class names match the
// stylesheet block (#descEditorModalStatusRow / -Label / -Control /
// .descEditorModalStatusSeg) so one set of CSS styles both hosts.
export function buildManualStatusControl(item, projectName) {
    const statusRow = document.createElement('div');
    statusRow.id = 'descEditorModalStatusRow';

    const statusLabel = document.createElement('span');
    statusLabel.id = 'descEditorModalStatusLabel';
    statusLabel.textContent = 'Manual status';

    const statusControl = document.createElement('div');
    statusControl.id = 'descEditorModalStatusControl';
    statusControl.setAttribute('role', 'radiogroup');
    statusControl.setAttribute('aria-label', 'Task status');

    const currentStatus = normalizeStatus(item && item.status);

    function updateStatusSegments(status) {
        const segs = statusControl.querySelectorAll('.descEditorModalStatusSeg');
        for (let i = 0; i < segs.length; i++) {
            const on = segs[i].getAttribute('data-status') === status;
            segs[i].classList.toggle('selected', on);
            segs[i].setAttribute('aria-checked', on ? 'true' : 'false');
        }
    }

    function selectStatus(status) {
        const name = projectName || '';
        // Single mutation channel — same path the on-row popover uses. A no-op
        // (already this status) is harmless: setToDoStatus early-returns.
        listLogic.setToDoStatus(name, item, status);
        updateStatusSegments(status);
        // Reflect the change on the underlying (still-mounted) row live: find it
        // by item identity in #mainList, repaint its status UI, then re-sort /
        // re-filter the list so it moves to its new place when sort = Status.
        if (!name) return;
        const mainList = document.getElementById('mainList');
        if (mainList) {
            const rows = mainList.querySelectorAll('#toDoChild');
            for (let i = 0; i < rows.length; i++) {
                if (rows[i].__item === item) {
                    refreshTodoStatusUI(rows[i], item);
                    break;
                }
            }
        }
        reorderToDoDOM(name);
    }

    STATUS_ORDER.forEach(function (status) {
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'descEditorModalStatusSeg' + (status === currentStatus ? ' selected' : '');
        seg.setAttribute('role', 'radio');
        seg.setAttribute('data-status', status);
        seg.setAttribute('aria-checked', status === currentStatus ? 'true' : 'false');
        seg.textContent = STATUS_META[status].label;
        seg.addEventListener('click', function () { selectStatus(status); });
        statusControl.appendChild(seg);
    });

    statusRow.appendChild(statusLabel);
    statusRow.appendChild(statusControl);
    return statusRow;
}


// ── STATUS-CHANGE POPOVER ──
// Anchored menu opened from a label tap. Dismiss on: option selection, outside
// click, right-click elsewhere, Escape, resize, or scroll — mirroring the
// due-date popover's affordances.

export function hideStatusPopover() {
    const existing = document.getElementById('todoStatusPopover');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    document.removeEventListener('click',       onStatusPopoverOutsideClick, true);
    document.removeEventListener('contextmenu', onStatusPopoverOutsideClick, true);
    document.removeEventListener('keydown',     onStatusPopoverKeydown,      true);
    window.removeEventListener('resize', hideStatusPopover);
    window.removeEventListener('scroll', hideStatusPopover, true);
    const openLabel = document.querySelector('.todoStatusLabel[aria-expanded="true"]');
    if (openLabel) openLabel.setAttribute('aria-expanded', 'false');
}

function onStatusPopoverOutsideClick(event) {
    const popover = document.getElementById('todoStatusPopover');
    if (!popover) return;
    if (popover.contains(event.target)) return;
    // The label that opened it owns its own toggle; let that handle re-taps.
    if (event.target.closest && event.target.closest('.todoStatusLabel')) return;
    hideStatusPopover();
}

function onStatusPopoverKeydown(event) {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('todoStatusPopover')) return;
    event.stopPropagation();
    hideStatusPopover();
}

export function showStatusPopover(anchor, item, projectName, toDoChild) {
    hideStatusPopover();
    anchor.setAttribute('aria-expanded', 'true');

    const popover = document.createElement('div');
    popover.id = 'todoStatusPopover';
    popover.className = 'todoStatusPopover';
    popover.setAttribute('role', 'menu');
    popover.setAttribute('aria-label', 'Set task status');
    popover.tabIndex = -1;

    const current = normalizeStatus(item && item.status);
    STATUS_ORDER.forEach(function (status) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'todoStatusOption' + (status === current ? ' selected' : '');
        opt.setAttribute('role', 'menuitemradio');
        opt.setAttribute('aria-checked', status === current ? 'true' : 'false');
        opt.setAttribute('data-status', status);
        opt.textContent = STATUS_META[status].label;
        opt.addEventListener('click', function (event) {
            event.stopPropagation();
            // Single update channel — same path as any other todo mutation.
            listLogic.setToDoStatus(projectName, item, status);
            refreshTodoStatusUI(toDoChild, item);
            // Re-sort + re-render the list so the row moves to its new sorted
            // position when sort = Status (a no-op for sort = None/Due). This
            // also re-applies the status filter — reorderToDoDOM runs the
            // filter pass internally — so the pill counts and visibility stay
            // correct.
            reorderToDoDOM(projectName);
            hideStatusPopover();
        });
        popover.appendChild(opt);
    });

    document.body.appendChild(popover);

    // Anchor below the label, left-aligned; flip above if it would overflow the
    // bottom, and clamp within the viewport. Coordinates are viewport-relative
    // (getBoundingClientRect) so the popover is positioned `position: fixed`.
    const rect      = anchor.getBoundingClientRect();
    const popWidth  = popover.offsetWidth;
    const popHeight = popover.offsetHeight;
    let left = rect.left;
    let top  = rect.bottom + 6;
    if (top + popHeight > window.innerHeight - 4) {
        top = rect.top - popHeight - 6;
    }
    if (left < 4) left = 4;
    if (left + popWidth > window.innerWidth - 4) {
        left = Math.max(4, window.innerWidth - popWidth - 4);
    }
    if (top < 4) top = 4;
    popover.style.left = left + 'px';
    popover.style.top  = top  + 'px';

    document.addEventListener('click',       onStatusPopoverOutsideClick, true);
    document.addEventListener('contextmenu', onStatusPopoverOutsideClick, true);
    document.addEventListener('keydown',     onStatusPopoverKeydown,      true);
    window.addEventListener('resize', hideStatusPopover);
    window.addEventListener('scroll', hideStatusPopover, true);

    try { popover.focus({ preventScroll: true }); } catch (e) { popover.focus(); }
}


// Install the single delegated click handler. Call once on app boot with
// #mainList. Detects taps on a `.todoStatusLabel`, resolves the owning row's
// item + project from the row dataset, and toggles the status popover anchored
// to the tapped label. A guard flag makes repeat installs (e.g. a re-evaluated
// entry bundle) idempotent.
export function wireStatusLabelDelegation(container) {
    if (!container || container.__statusDelegationWired) return;
    container.__statusDelegationWired = true;
    container.addEventListener('click', function (event) {
        const label = event.target.closest && event.target.closest('.todoStatusLabel');
        if (!label || !container.contains(label)) return;
        const row = label.closest('#toDoChild');
        if (!row) return;
        const item = row.__item;
        const projectName = row.getAttribute('data-value');
        if (!item || !projectName) return;
        event.stopPropagation();
        // REVIEW badge: a badge in the derived review state no longer stamps the
        // acknowledgement itself — acknowledging now lives in exactly one place,
        // the viewer's Acknowledge pill. Instead the tap opens the project's
        // TODO.md viewer anchored to this entry's block (expanded inline on
        // desktop, in the mobile sheet on touch) so the shipped change can be
        // read before it is acknowledged. No `entry_reviewed_at` write happens
        // here; the badge clears via TODO_RUN_STATUS_EVENT once the entry is
        // acknowledged from the viewer. The viewer still opens unanchored if the
        // marker can't be found, so the tap is never a no-op. No popover mounts.
        if (label.getAttribute('data-status') === 'review') {
            // On touch the WHAT CHANGED card + decide actions live in the
            // description-editor modal, so route the tap there; on desktop the
            // badge still opens the project's TODO.md viewer anchored to the entry.
            if (routeBadgeToModalOnTouch(item, projectName)) return;
            if (reviewBadgeTapHandler) reviewBadgeTapHandler(item.entryId, projectName);
            return;
        }
        // ASKING badge: triage has a pending question for this task. The question
        // and its answer field live in the row's description panel, so a tap opens
        // that panel (via the row's expand caret) rather than the status popover.
        // No `status` write happens; the badge clears on its own once the answer
        // re-queues the linked agent_queue row out of needs_words. No-op when the
        // panel is already open so a second tap doesn't collapse it shut.
        if (label.getAttribute('data-status') === 'asking') {
            // On touch the question + answer field mount in the description-editor
            // modal; on desktop they mount in the inline `#descSibling` panel.
            if (routeBadgeToModalOnTouch(item, projectName)) return;
            const descToggle = row.querySelector('#descToggle');
            if (descToggle && !descToggle.classList.contains('open')) descToggle.click();
            return;
        }
        // DRAFTED badge: a landed draft this task hasn't been dispatched. The
        // Dispatch control now lives in the row's description panel (beneath the
        // generated entry text), so a tap opens that panel via the row's expand
        // caret — the same destination ASKING uses — rather than the Agent board
        // or the status popover. No `status` write happens; the badge clears on
        // its own once the linked agent_queue row leaves drafted (dispatched /
        // re-triaged). No-op when the panel is already open so a second tap
        // doesn't collapse it shut.
        // STUCK badge: the linked run failed or changed nothing. The Retry control
        // now lives in the description panel too (beneath its failure-reason
        // block), so its tap opens the same panel rather than the Agent board.
        // MOCKUP badge: the linked run is parked waiting on a mockup decision. The
        // choose-a-variant flow now mounts in the desktop detail pane's description
        // panel (above the authoring region), so its tap opens that same panel —
        // the destination ASKING uses — rather than routing to the Agent board. No
        // `status` write happens; the badge clears on its own once the linked
        // agent_queue row leaves drafted / failed / needs_mockup. No-op when the
        // panel is already open so a second tap doesn't collapse it shut.
        const routeStatus = label.getAttribute('data-status');
        if (routeStatus === 'drafted' || routeStatus === 'stuck' || routeStatus === 'mockup') {
            // On touch the Dispatch / Retry / choose-a-mockup controls mount in the
            // description-editor modal; on desktop they mount in the inline
            // `#descSibling` panel via the row's expand caret.
            if (routeBadgeToModalOnTouch(item, projectName)) return;
            const descToggle = row.querySelector('#descToggle');
            if (descToggle && !descToggle.classList.contains('open')) descToggle.click();
            return;
        }
        // Toggle off ONLY when the open popover belongs to THIS label; for any
        // other label (including when nothing is open) mount its popover.
        // showStatusPopover's own hideStatusPopover() call tears down a popover
        // anchored to a different label, so a cross-label tap swaps in one click
        // rather than requiring a second.
        if (label.getAttribute('aria-expanded') === 'true') {
            hideStatusPopover();
        } else {
            showStatusPopover(label, item, projectName, row);
        }
    });
}
