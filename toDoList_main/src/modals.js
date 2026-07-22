// Confirm + changelog modals and the service-worker update cue.
//
// Per CLAUDE.md, destructive actions need a confirmation step (handled by
// showConfirmModal — an async, themed replacement for window.confirm), and
// modals must close on close-button, backdrop click, and Escape. Both modals
// here implement all three affordances.
//
// The footer version label opens showChangelogModal, which lists the entries
// from changelog.js. The footer also hosts a "new entries available" dot
// (#changelogDot) whose visibility is controlled by updateChangelogDot —
// driven by the changelog last-seen marker in prefs.js, plus an override for
// pending service-worker updates so the same visual cue surfaces both
// "new release notes" and "reload to apply update".

import { getNewestChangelogDate, renderChangelogEntries } from './changelog.js';
import { readChangelogLastSeen, writeChangelogLastSeen } from './prefs.js';
import { listLogic } from './listLogic.js';
import { makeInjectButton, refreshInjectButton, writeAssignmentToWorker, readAssignmentFromWorker, TODO_RUN_STATUS_EVENT } from './inject.js';
import { STATUS_META, STATUS_ORDER, normalizeStatus, refreshTodoStatusUI } from './todoStatus.js';
import { reorderToDoDOM, makeGenerateButton, syncGenerateControl } from './toDoRow.js';
import { derivePhase, PHASE_RAIL_ORDER, PHASE_RAIL_LABELS } from './phase.js';


// ── SHARED MODAL DISMISS WIRING ──
// The dismissible modals in this file all close the same three ways — an
// explicit close control, a backdrop click, and Escape — guarded so the close
// runs only once, tearing down the keydown listener and detaching the backdrop
// on the way out (CLAUDE.md: "modals must close on close-button, backdrop
// click, and Escape"). This helper centralizes that contract so the modals
// can't drift apart. Callers pass the backdrop, their close control(s) via
// `closeButtons`, and an optional `onClose` hook for the modal-specific tail
// (focus restoration, persistence) that runs after teardown. Returns the
// guarded close function so callers can invoke it from other handlers.
export function wireModalDismiss(options) {
    const backdrop = options.backdrop;
    const closeButtons = options.closeButtons || [];
    const onClose = options.onClose;

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (typeof onClose === 'function') onClose();
    }

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    }

    for (let i = 0; i < closeButtons.length; i++) {
        if (closeButtons[i]) closeButtons[i].addEventListener('click', close);
    }
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);

    return close;
}


// ── CONFIRM MODAL ──
// Async, themed replacement for window.confirm. Destructive actions (delete
// project, delete todo) require a confirmation step per CLAUDE.md; the native
// dialog breaks visual continuity and can't be styled. Closes on Cancel,
// backdrop click, or Escape — matching the modal conventions in CLAUDE.md.
export function showConfirmModal(options) {

    // Defensive: remove any stray prior modal so we never stack two.
    const prior = document.getElementById('confirmModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'confirmModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'confirmModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const msg = document.createElement('div');
    msg.id = 'confirmModalMessage';
    msg.textContent = options.message || '';

    const actions = document.createElement('div');
    actions.id = 'confirmModalActions';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'confirmModalCancel';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'confirmModalConfirm';
    confirmBtn.type = 'button';
    if (options.danger !== false) confirmBtn.classList.add('danger');
    confirmBtn.textContent = options.confirmLabel || 'Delete';

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(msg);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // Focus Cancel by default — the safer landing for a destructive action,
    // so an accidental Enter on modal-open dismisses instead of deleting.
    // Left/Right and Tab move focus to Delete; Enter on either fires it.
    cancelBtn.focus();

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
            return;
        }
        // Arrow keys swap focus between the two buttons. Trap Tab inside the
        // dialog so focus can never escape into the disabled background while
        // a destructive confirmation is pending.
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'ArrowLeft') cancelBtn.focus();
            else confirmBtn.focus();
            return;
        }
        if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            const next = document.activeElement === cancelBtn ? confirmBtn : cancelBtn;
            next.focus();
        }
    }

    cancelBtn.addEventListener('click', close);
    confirmBtn.addEventListener('click', function() {
        close();
        if (typeof options.onConfirm === 'function') options.onConfirm();
    });
    // Only backdrop clicks should dismiss — clicks inside the dialog should not.
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);
}


// ── DESC EDITOR MODAL ──
// Touch-device editor for the per-todo `desc` field. The in-row descSibling
// pattern uses a single-line `<input>` that's unsuitable for drafting
// multi-line TODO.md backlog entries on a phone, so on `(pointer: coarse)`
// we route description editing through this full modal: monospace textarea,
// 16px font (CLAUDE.md mobile-input rule against iOS auto-zoom), markdown
// formatting preserved as-is, and a toolbar with a "Copy as TODO.md entry"
// primary action plus a confirmation-gated "Clear". Save is implicit on
// close — any close path persists the textarea value back to item.desc and
// fires the optional refresh callback so the row's indicator stays in sync.
//
// Closes on the close X, the backdrop, or Escape (CLAUDE.md modal contract).
// The Clear destructive-action path routes through showConfirmModal.
export function showDescEditorModal(item, options) {

    if (!item) return;
    const opts = options || {};

    const prior = document.getElementById('descEditorModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'descEditorModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'descEditorModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    // The accessible name resolves to the task title element specifically —
    // not the whole title shell — so screen readers announce the task title
    // rather than the static "Description" eyebrow that precedes it.
    dialog.setAttribute('aria-labelledby', 'descEditorModalTitleText');

    const header = document.createElement('div');
    header.id = 'descEditorModalHeader';

    const title = document.createElement('div');
    title.id = 'descEditorModalTitle';
    // Two-tier title shell: a static "Description" eyebrow row carrying the
    // pencil rename affordance, and beneath it the actual task title rendered
    // in the proportional body font so long titles wrap to two lines and stay
    // readable instead of ellipsising mid-word in the old uppercase monospace.
    // The hidden input swaps in over the task title on tap so titles are
    // renamable from the touch-device editor (the desktop inline-rename flow
    // is unreachable on mobile because the row's input never gets focused on
    // `(pointer: coarse)`).
    const eyebrow = document.createElement('div');
    eyebrow.id = 'descEditorModalTitleEyebrow';

    const eyebrowLabel = document.createElement('span');
    eyebrowLabel.id = 'descEditorModalTitleEyebrowLabel';
    eyebrowLabel.textContent = 'Description';

    const titleEdit = document.createElement('span');
    titleEdit.id = 'descEditorModalTitleEdit';
    titleEdit.setAttribute('aria-hidden', 'true');
    titleEdit.textContent = '✎';

    eyebrow.appendChild(eyebrowLabel);
    eyebrow.appendChild(titleEdit);

    const titleText = document.createElement('span');
    titleText.id = 'descEditorModalTitleText';
    titleText.textContent = (item && item.tit) ? item.tit : 'Description';

    const titleInput = document.createElement('input');
    titleInput.id = 'descEditorModalTitleInput';
    titleInput.type = 'text';
    titleInput.setAttribute('aria-label', 'Todo title');
    titleInput.autocomplete = 'off';
    titleInput.spellcheck = false;
    titleInput.value = (item && item.tit) ? item.tit : '';
    titleInput.style.display = 'none';

    title.appendChild(eyebrow);
    title.appendChild(titleText);
    title.appendChild(titleInput);

    const closeX = document.createElement('button');
    closeX.id = 'descEditorModalClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close description editor');
    closeX.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeX);

    // Title rename — tap-to-edit. The static text + pencil flip to an input
    // prefilled with the current value (focused and selected) on tap. Enter or
    // blur commits, Escape reverts. Empty titles revert to the previous value
    // rather than blocking, matching the desktop snap-back semantics in
    // toDoRow.js's toDoInput blur handler. The renameHandledByEnter flag
    // mirrors the projChild rename in main.js so Enter's commit path and the
    // ensuing blur don't both run the same handler.
    let titleRenameHandledByEnter = false;
    function enterTitleEditMode() {
        titleInput.value = item.tit || '';
        titleText.style.display = 'none';
        titleEdit.style.display = 'none';
        titleInput.style.display = '';
        try {
            titleInput.focus();
            titleInput.select();
        } catch (e) { /* defensive */ }
    }
    function exitTitleEditMode() {
        titleInput.style.display = 'none';
        titleText.style.display = '';
        titleEdit.style.display = '';
    }
    function commitTitle() {
        const newVal = titleInput.value.trim();
        const prior = item.tit || '';
        if (newVal.length === 0 || newVal === prior) {
            titleInput.value = prior;
            exitTitleEditMode();
            return;
        }
        item.tit = newVal;
        titleText.textContent = newVal;
        listLogic.saveToStorage();
        if (typeof opts.onTitleSave === 'function') opts.onTitleSave(newVal);
        exitTitleEditMode();
    }
    titleText.addEventListener('click', enterTitleEditMode);
    titleEdit.addEventListener('click', enterTitleEditMode);
    titleInput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            titleRenameHandledByEnter = true;
            commitTitle();
            return;
        }
        if (event.key === 'Escape') {
            // Reverting the title is a softer cancel than closing the whole
            // modal — stop the event so the document-level Escape handler
            // doesn't also fire and tear the modal down.
            event.preventDefault();
            event.stopPropagation();
            titleInput.value = item.tit || '';
            exitTitleEditMode();
        }
    });
    titleInput.addEventListener('blur', function() {
        if (titleRenameHandledByEnter) {
            titleRenameHandledByEnter = false;
            return;
        }
        commitTitle();
    });

    // ── PHASE RAIL ──
    // A read-only, four-node rail — IDEA · DRAFT · REVIEW · DONE — leading the
    // modal so the mobile detail surface reads as the pipeline instrument the
    // rest of the design uses (below 1024px the on-row status badge is hidden, so
    // this modal is where a task is actually read). Nodes before the current
    // phase render filled, the current one highlighted, the rest empty. It is
    // display-only: phase is derived from TODO.md via derivePhase, so there is
    // nothing a tap could mean — the rail carries no click handler.
    const rail = document.createElement('div');
    rail.id = 'descEditorModalRail';
    rail.setAttribute('role', 'img');

    function renderRail() {
        const phase = derivePhase(item);
        // `asking` is a triage-queue fact, not a rail node — resolve it to its
        // underlying DRAFT stage so the rail never has to invent a fifth node.
        const railPhase = PHASE_RAIL_ORDER.indexOf(phase) === -1 ? 'draft' : phase;
        const currentIndex = PHASE_RAIL_ORDER.indexOf(railPhase);
        rail.innerHTML = '';
        PHASE_RAIL_ORDER.forEach(function(p, i) {
            // Connector rule linking the previous node to this one. It paints in
            // accent when it leads into a passed-or-current node (i <= current),
            // so the accent "progress" fills the rail up to the current dot.
            // Purely decorative — aria-hidden, no chrome, no listener.
            if (i > 0) {
                const connector = document.createElement('span');
                connector.className = 'descEditorModalRailConnector'
                    + (i <= currentIndex ? ' is-filled' : '');
                connector.setAttribute('aria-hidden', 'true');
                rail.appendChild(connector);
            }
            // Each node is an inert column — a dot above an uppercase caption.
            // Plain spans, never a button: no role, tabindex, or listener, so the
            // rail cannot be focused, hovered, or pressed. Phase is derived from
            // TODO.md, so there is nothing a tap could mean.
            const node = document.createElement('span');
            node.className = 'descEditorModalRailNode'
                + (i < currentIndex ? ' is-filled' : '')
                + (i === currentIndex ? ' is-current' : '');
            node.setAttribute('data-phase', p);
            const dot = document.createElement('span');
            dot.className = 'descEditorModalRailDot';
            dot.setAttribute('aria-hidden', 'true');
            const caption = document.createElement('span');
            caption.className = 'descEditorModalRailCaption';
            caption.textContent = PHASE_RAIL_LABELS[p];
            node.appendChild(dot);
            node.appendChild(caption);
            rail.appendChild(node);
        });
        rail.setAttribute('aria-label', 'Pipeline phase: ' + PHASE_RAIL_LABELS[railPhase]);
    }
    renderRail();

    // Repaint the rail when the phase changes while the modal is open — an entry
    // can ship or be acknowledged from another surface mid-session. The row layer
    // already refreshes on this same event via refreshDescStatusDots; the modal
    // subscribes alongside it and tears the listener down on close (see
    // onDescEditorClose) so a dismissed modal leaves nothing attached.
    function onRailPhaseChange() { renderRail(); }
    document.addEventListener(TODO_RUN_STATUS_EVENT, onRailPhaseChange);

    const body = document.createElement('div');
    body.id = 'descEditorModalBody';

    // Label the entry field with the same SpaceMono uppercase treatment the rest
    // of the pipeline surfaces use, so the textarea reads as THE ENTRY panel of an
    // instrument, not an unlabelled form field.
    const entryLabel = document.createElement('span');
    entryLabel.id = 'descEditorModalEntryLabel';
    entryLabel.textContent = 'The entry';
    body.appendChild(entryLabel);

    const textarea = document.createElement('textarea');
    textarea.id = 'descEditorModalTextarea';
    textarea.setAttribute('aria-label', 'Description text');
    textarea.spellcheck = false;
    textarea.autocapitalize = 'off';
    textarea.autocomplete = 'off';
    // iOS Safari honors `autocorrect="off"` to skip the smart-substitution
    // pass that would otherwise rewrite `--` to em-dash, `"foo"` to curly
    // quotes, or `...` to an ellipsis — all of which corrupt the markdown a
    // user is drafting for paste into TODO.md.
    textarea.setAttribute('autocorrect', 'off');
    textarea.value = (item && typeof item.desc === 'string') ? item.desc : '';
    body.appendChild(textarea);

    const actions = document.createElement('div');
    actions.id = 'descEditorModalActions';

    const clearBtn = document.createElement('button');
    clearBtn.id = 'descEditorModalClear';
    clearBtn.type = 'button';
    clearBtn.className = 'descEditorModalBtn';
    clearBtn.textContent = 'Clear';

    const copyBtn = document.createElement('button');
    copyBtn.id = 'descEditorModalCopy';
    copyBtn.type = 'button';
    copyBtn.className = 'descEditorModalBtn descEditorModalBtnPrimary';
    copyBtn.textContent = 'Copy entry';

    // Inject-to-TODO.md button — mirror of the desktop description-panel
    // affordance. Reuses the same factory so all state transitions (hidden /
    // unconfigured / no-target / ready / injected) flow through one code
    // path. Hidden by refreshInjectButton when the textarea is empty and
    // the project already has a routing target.
    const injectBtn = makeInjectButton(item, { projectName: opts.projectName || '' });
    injectBtn.classList.add('descEditorModalBtn');

    // Generate — mirror of the desktop description-panel action, so both hosts
    // drive one code path (makeGenerateButton / syncGenerateControl). On mobile
    // this modal is the primary host, since the on-row Generate badge is CSS-
    // hidden below 1024px. Flags the task + fires the triage sweep; the finished
    // draft lands into this textarea for review. The resolvers hand the shared
    // sync the modal's textarea + inject button (read-only + disabled while
    // generating); onLanded reflects the landed text through the textarea's own
    // input listener, which re-syncs item.desc and the inject button.
    const generateBtn = makeGenerateButton(item, {
        projectName: opts.projectName || '',
        resolveTextarea: function() { return textarea; },
        resolveInjectBtn: function() { return injectBtn; },
        onLanded: function(draft) {
            textarea.value = draft;
            textarea.dispatchEvent(new Event('input'));
        },
    });
    generateBtn.classList.add('descEditorModalBtn');

    // Caption beneath Generate naming which budget the dispatch spends. Generate
    // flags the task and fires the triage sweep, which dispatches an agentic run
    // (claude-triage.yml) billed to the Max-plan subscription quota — not the
    // Console-billed chat budget — so the line makes the cost explicit before a
    // tap. Sits directly under Generate via explicit CSS order.
    const generateSpend = document.createElement('span');
    generateSpend.id = 'descEditorModalGenerateSpend';
    generateSpend.textContent = 'Dispatches an agent run — spends your Max-plan quota.';

    // Explicit stacking order for the whole actions block: Generate, its spend
    // caption, Inject, then the Clear / Copy pair on one row. Each child carries
    // its own `order` in CSS rather than layering another override onto a basis
    // hack, so the sequence is readable with all four controls present.
    actions.appendChild(clearBtn);
    actions.appendChild(injectBtn);
    actions.appendChild(generateBtn);
    actions.appendChild(generateSpend);
    actions.appendChild(copyBtn);
    // Reflect the linked queue row's current state (Generating…/failure) and land
    // a draft that finished while the modal was closed. Live pushes re-sync via
    // the shared sweep in refreshDescStatusDots (every `.generateBtn`).
    syncGenerateControl(generateBtn);

    // ── STATUS SEGMENTED CONTROL ──
    // On mobile the on-row status badge (`.todoStatusLabel` → showStatusPopover)
    // is hidden in favor of the left-edge color tab, so status is visible but
    // not settable from the row. Surface a three-segment selector here — the
    // same vocabulary the desktop popover uses, pulled from STATUS_META /
    // STATUS_ORDER so the labels and order stay single-sourced. The selected
    // segment fills with its status color, matched to the row edge tab.
    //
    // It sits BELOW the actions (last in the dialog) under its own label. The
    // rail above renders the DERIVED pipeline phase; this control is the user's
    // OWN annotation, so the label reads "Manual status" to keep the two from
    // being read as one stacked control (their vocabularies even overlap — the
    // rail's IDEA node vs. the status Idea option).
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
        const projectName = opts.projectName || '';
        // Route through the same mutation channel the desktop badge uses, so the
        // localStorage write and the Supabase mirror both fire. A no-op (already
        // this status) is harmless — setToDoStatus early-returns.
        listLogic.setToDoStatus(projectName, item, status);
        updateStatusSegments(status);
        // Reflect the change on the underlying (still-mounted) row live: find it
        // by its item identity in #mainList, repaint its status UI, then re-sort
        // / re-filter the list so it moves to its new place when sort = Status.
        if (!projectName) return;
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
        reorderToDoDOM(projectName);
    }

    STATUS_ORDER.forEach(function(status) {
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'descEditorModalStatusSeg' + (status === currentStatus ? ' selected' : '');
        seg.setAttribute('role', 'radio');
        seg.setAttribute('data-status', status);
        seg.setAttribute('aria-checked', status === currentStatus ? 'true' : 'false');
        seg.textContent = STATUS_META[status].label;
        seg.addEventListener('click', function() { selectStatus(status); });
        statusControl.appendChild(seg);
    });

    statusRow.appendChild(statusLabel);
    statusRow.appendChild(statusControl);

    // Order: header, phase rail, entry body, actions (Generate / Inject /
    // Clear / Copy), then the manual STATUS control last — the derived phase now
    // leads and the manual annotation is demoted below the actions.
    dialog.appendChild(header);
    dialog.appendChild(rail);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    dialog.appendChild(statusRow);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const previouslyFocused = document.activeElement;

    function persist() {
        // Preserve markdown formatting (backticks, indentation, multi-line)
        // by storing the raw textarea value — no trim, no normalization.
        // Matches the descInput.blur handler's "treat textarea contents as
        // the source of truth on save" semantics but without the trim.
        item.desc = textarea.value;
        listLogic.saveToStorage();
        if (typeof opts.onSave === 'function') opts.onSave();
    }

    // Save is implicit on any close — no separate Save button — then focus
    // returns to whatever opened the editor.
    function onDescEditorClose() {
        // Detach the phase-rail live-repaint listener so a dismissed modal leaves
        // nothing attached to the document.
        document.removeEventListener(TODO_RUN_STATUS_EVENT, onRailPhaseChange);
        persist();
        if (previouslyFocused &&
            typeof previouslyFocused.focus === 'function' &&
            document.contains(previouslyFocused)) {
            try { previouslyFocused.focus(); } catch (e) { /* defensive */ }
        }
    }

    wireModalDismiss({
        backdrop: backdrop,
        closeButtons: [closeX],
        onClose: onDescEditorClose
    });

    copyBtn.addEventListener('click', function() {
        const text = textarea.value;
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(function() {
                flashCopyFeedback(copyBtn);
            }).catch(function() { /* swallow — no feedback flip */ });
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
            if (ok) flashCopyFeedback(copyBtn);
        } catch (e) { /* swallow */ }
    });

    clearBtn.addEventListener('click', function() {
        // Empty textarea: nothing to confirm, but a no-op feels broken — just
        // refocus so the user knows the button registered.
        if (textarea.value.length === 0) {
            textarea.focus();
            return;
        }
        showConfirmModal({
            message: 'Clear description? This cannot be undone.',
            confirmLabel: 'Clear',
            onConfirm: function() {
                textarea.value = '';
                item.desc = '';
                refreshInjectButton(injectBtn, item, opts.projectName || '');
                textarea.focus();
            }
        });
    });

    // Keep item.desc in sync on every keystroke so the inject button can
    // read the current draft (it reads item.desc directly) and so its
    // empty / non-empty visibility tracks what's actually in the textarea.
    // persist() on close still does the final localStorage write.
    textarea.addEventListener('input', function() {
        item.desc = textarea.value;
        refreshInjectButton(injectBtn, item, opts.projectName || '');
    });

    // Mobile keyboards land focus more reliably if the focus call is deferred
    // a tick — the modal element has just been inserted, and Safari sometimes
    // races the focus against its own layout pass. Defer so the textarea is
    // definitely paint-ready.
    setTimeout(function() {
        try { textarea.focus(); } catch (e) { /* defensive */ }
    }, 0);
}

// Briefly swap the Copy button label to a "Copied ✓" confirmation. Mirrors
// the per-row copy-title button's checkmark feedback so the two surfaces
// feel consistent. Restores after ~1.2s.
function flashCopyFeedback(btn) {
    const original = btn.textContent;
    if (btn.__copyResetTimer) clearTimeout(btn.__copyResetTimer);
    btn.textContent = 'Copied ✓';
    btn.setAttribute('data-copied', 'true');
    btn.__copyResetTimer = setTimeout(function() {
        btn.textContent = original;
        btn.removeAttribute('data-copied');
        btn.__copyResetTimer = null;
    }, 1200);
}


// ── ASSIGNMENT EDITOR MODAL ──
// Full editor for a routed repo's `assignment.md`, opened by tapping the AGENT
// board's assignment card. Mirrors showDescEditorModal's header/textarea/actions
// shell and reuses wireModalDismiss for the three-way close (close X, backdrop,
// Escape — CLAUDE.md modal contract). Unlike the desc editor (save-on-close),
// this modal saves explicitly: Save writes the whole file back through the
// Worker's `write` branch, using the open-time `sha` as the concurrency token.
// On success it closes and calls `options.onSaved` so the caller can re-read and
// repaint the card (unfilled → filled). On a 409 conflict it reloads the latest
// content + sha into the textarea and asks the user to reapply; on any other
// error it surfaces the reason and stays open. The textarea keeps a 16px font
// (CLAUDE.md mobile-input rule) and `pre-wrap` so the seeded stub's sections and
// HTML-comment hints load verbatim.
export function showAssignmentEditorModal(target, content, sha, options) {
    const opts = options || {};
    let currentSha = sha;

    const prior = document.getElementById('assignmentEditorModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'assignmentEditorModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'assignmentEditorModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'assignmentEditorModalTitleText');

    const header = document.createElement('div');
    header.id = 'assignmentEditorModalHeader';

    const title = document.createElement('div');
    title.id = 'assignmentEditorModalTitle';

    const eyebrow = document.createElement('span');
    eyebrow.id = 'assignmentEditorModalEyebrow';
    eyebrow.textContent = 'ASSIGNMENT';

    const titleText = document.createElement('span');
    titleText.id = 'assignmentEditorModalTitleText';
    titleText.textContent = (target && target.repo) ? target.repo : 'assignment.md';

    title.appendChild(eyebrow);
    title.appendChild(titleText);

    const closeX = document.createElement('button');
    closeX.id = 'assignmentEditorModalClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close assignment editor');
    closeX.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'assignmentEditorModalBody';

    const textarea = document.createElement('textarea');
    textarea.id = 'assignmentEditorModalTextarea';
    textarea.setAttribute('aria-label', 'Assignment text');
    textarea.spellcheck = false;
    textarea.autocapitalize = 'off';
    textarea.autocomplete = 'off';
    // As with the desc editor, keep iOS smart-substitution off so the markdown
    // the user is editing isn't rewritten (`--` → em-dash, straight → curly
    // quotes, etc.).
    textarea.setAttribute('autocorrect', 'off');
    textarea.value = typeof content === 'string' ? content : '';
    body.appendChild(textarea);

    // Inline status line for conflict / error feedback, so the message lives in
    // the modal (which stays open on failure) rather than only in a transient
    // toast. Hidden until something needs saying.
    const status = document.createElement('div');
    status.id = 'assignmentEditorModalStatus';
    status.setAttribute('role', 'status');
    status.hidden = true;

    const actions = document.createElement('div');
    actions.id = 'assignmentEditorModalActions';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'assignmentEditorModalCancel';
    cancelBtn.type = 'button';
    cancelBtn.className = 'assignmentEditorModalBtn';
    cancelBtn.textContent = 'Cancel';

    const saveBtn = document.createElement('button');
    saveBtn.id = 'assignmentEditorModalSave';
    saveBtn.type = 'button';
    saveBtn.className = 'assignmentEditorModalBtn assignmentEditorModalBtnPrimary';
    saveBtn.textContent = 'Save';

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(status);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const previouslyFocused = document.activeElement;

    const close = wireModalDismiss({
        backdrop: backdrop,
        closeButtons: [closeX, cancelBtn],
        onClose: function() {
            if (previouslyFocused &&
                typeof previouslyFocused.focus === 'function' &&
                document.contains(previouslyFocused)) {
                try { previouslyFocused.focus(); } catch (e) { /* defensive */ }
            }
        }
    });

    function showStatus(message) {
        status.hidden = false;
        status.textContent = message;
    }

    let saving = false;
    saveBtn.addEventListener('click', function() {
        if (saving) return;
        saving = true;
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        const prevLabel = saveBtn.textContent;
        saveBtn.textContent = 'Saving…';
        status.hidden = true;
        writeAssignmentToWorker(target, textarea.value, currentSha).then(function(res) {
            if (res && res.ok) {
                close();
                if (typeof opts.onSaved === 'function') opts.onSaved();
                return;
            }
            // Failure — re-enable the controls and keep the modal open so the
            // user's edit isn't lost.
            saving = false;
            saveBtn.disabled = false;
            cancelBtn.disabled = false;
            saveBtn.textContent = prevLabel;
            if (res && res.conflict) {
                // Reload the latest content + sha so the user can reapply their
                // edit against the newer base rather than clobbering it.
                readAssignmentFromWorker(target).then(function(fresh) {
                    if (fresh && fresh.ok) {
                        textarea.value = fresh.content;
                        currentSha = fresh.sha;
                        showStatus('assignment.md changed since you opened it — the latest version is loaded. Reapply your changes and Save again.');
                    } else {
                        showStatus('assignment.md changed since you opened it, and reloading the latest failed. Close and reopen the editor.');
                    }
                });
                return;
            }
            showStatus('Save failed: ' + ((res && res.reason) || 'Unknown error') + '.');
        });
    });

    // Defer focus a tick so the textarea is paint-ready before mobile keyboards
    // land on it (same rationale as the desc editor).
    setTimeout(function() {
        try { textarea.focus(); } catch (e) { /* defensive */ }
    }, 0);
}


// ── CHANGELOG MODAL ──
// Footer version label opens this: a dismissible dialog listing version
// history from changelog.js. Mirrors showConfirmModal's backdrop + Escape +
// backdrop-click dismissal, but swaps the confirm/cancel footer for a single
// Close button and adds an explicit corner X.
//
// The last-seen marker key/getters/setters live in prefs.js.

// ISO YYYY-MM-DD strings sort lexicographically, so string compare suffices.
function hasUnseenChangelog() {
    const newest = getNewestChangelogDate();
    if (!newest) return false;
    const lastSeen = readChangelogLastSeen();
    if (!lastSeen) return true;
    return newest > lastSeen;
}

export function updateChangelogDot() {
    const dot = document.getElementById('changelogDot');
    if (!dot) return;
    // When a pending service-worker update exists, the dot is forced on to
    // surface the reload cue regardless of changelog-seen state.
    const show = hasUnseenChangelog() || pendingUpdateRegistration !== null;
    dot.style.display = show ? 'inline-block' : 'none';
}

// ── SERVICE WORKER UPDATE CUE ──
// index.js registers the service worker and calls notifyUpdateAvailable()
// once a new worker reaches the `waiting` state. The footer version label
// reuses the #changelogDot visual vocabulary to signal the update, and its
// click handler switches from "open changelog" to "skipWaiting + reload".
//
// The desktop footer is hidden on mobile (≤1023px), so notifyUpdateAvailable
// also dispatches an `appUpdateAvailable` CustomEvent on document. The mobile
// Settings modal's About → Version row listens for it, and the mobile
// chrome's #drawerSettingsBtn adopts a small dot via the same event so the
// cue surfaces without the user having to open Settings.
let pendingUpdateRegistration = null;

export function hasPendingUpdate() {
    return pendingUpdateRegistration !== null;
}

export function notifyUpdateAvailable(registration) {
    pendingUpdateRegistration = registration || null;
    const footVersion = document.getElementById('footVersion');
    if (footVersion) {
        footVersion.classList.add('hasUpdate');
        footVersion.setAttribute('title', 'Update available — reload to apply');
        footVersion.setAttribute('aria-label', 'Update available — reload to apply');
    }
    updateChangelogDot();
    // Mobile surfaces (Settings modal About row, gear-button dot) live
    // outside the footer and listen for this event to flip into their
    // "update available" appearance.
    document.dispatchEvent(new CustomEvent('appUpdateAvailable'));
}

export function applyPendingUpdate() {
    const registration = pendingUpdateRegistration;
    if (!registration) return false;
    const worker = registration.waiting || registration.installing;
    if (worker && typeof worker.postMessage === 'function') {
        worker.postMessage({ type: 'SKIP_WAITING' });
    } else {
        // Fallback — nothing to message, just reload so the user sees the cue clear.
        window.location.reload();
    }
    return true;
}

export function showChangelogModal() {
    const prior = document.getElementById('changelogModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'changelogModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'changelogModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'changelogModalTitle');

    const header = document.createElement('div');
    header.id = 'changelogModalHeader';

    const title = document.createElement('div');
    title.id = 'changelogModalTitle';
    title.textContent = 'Changelog';

    const closeX = document.createElement('button');
    closeX.id = 'changelogModalClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close changelog');
    closeX.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'changelogModalBody';

    renderChangelogEntries(body);

    const actions = document.createElement('div');
    actions.id = 'changelogModalActions';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'changelogModalCloseBtn';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';

    actions.appendChild(closeBtn);
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // Capture whatever held focus before we hijack it for the Close button,
    // so we can hand focus back when the modal closes. Without this, focus
    // collapses to <body> on close — and any keyboard affordance the opener
    // depended on (e.g., Enter on the auto-focused empty-state Create
    // button) silently breaks until the user clicks something.
    const previouslyFocused = document.activeElement;

    closeBtn.focus();

    // Mark the newest entry as seen the moment the modal opens. Drop the dot
    // immediately so returning from the modal shows its new baseline state.
    const newest = getNewestChangelogDate();
    if (newest) writeChangelogLastSeen(newest);
    updateChangelogDot();

    function onChangelogClose() {
        // When the no-projects empty state is showing, its Create button is
        // the single keyboard affordance on the page (Enter creates the
        // first project). Prefer it over `previouslyFocused`, which is
        // typically the footer version label that opened this modal —
        // restoring focus there would mean Enter just re-opens the
        // changelog instead of creating a project.
        const createBtn = document.getElementById('emptyStateCreateBtn');
        if (createBtn) {
            createBtn.focus();
            return;
        }
        if (previouslyFocused &&
            typeof previouslyFocused.focus === 'function' &&
            document.contains(previouslyFocused)) {
            previouslyFocused.focus();
        }
    }

    wireModalDismiss({
        backdrop: backdrop,
        closeButtons: [closeX, closeBtn],
        onClose: onChangelogClose
    });
}


// ── HELP MODAL ──
// Opens from the floating `?` help button (bottom-right of the viewport),
// from the global `?` keydown, and from the "Help" item in the ghost menu.
// Mirrors showChangelogModal for close-on-X, close-on-backdrop, and
// close-on-Escape. The body is a stack of topic-based sections explaining
// the app's chrome — Tasks, Projects, Ghost Menu — followed by a Keyboard
// Shortcuts table. When new UI or bindings are added, append entries here
// so the modal stays the single source of truth for "what the chrome does".
const HELP_TOPICS = [
    {
        category: 'Tasks',
        items: [
            'Type in the new-task input and press Enter to add a task to the selected project.',
            'Click a task title (or press Enter on a focused row) to edit it inline; click again to commit.',
            'Click the chevron beside a task to expand its description panel; the EXPAND ALL button toggles every open task at once.',
            'Drag the dotted handle at the right of a row to reorder; check the box to mark a task done; right-click (long-press on touch) for the context menu.',
            'Tasks support a due date — open the date popover from the row to set or clear it.',
        ],
    },
    {
        category: 'Projects',
        items: [
            'Click a rail icon in the left sidebar to switch projects; hover a rail icon for the full project name.',
            'Use the + button at the top of the sidebar (or the empty-state Create button) to add a new project.',
            'Right-click (long-press on touch) a project row to rename, recolor, or delete it.',
            'Drag a project up or down in the sidebar to reorder; the active project keeps its accent color in the breadcrumb row.',
        ],
    },
    {
        category: 'Ghost Menu',
        items: [
            'Click the small ghost icon at the top-right of the nav to open the global menu.',
            'The menu hosts Export JSON, Import JSON, Theme (light/dark), Toggle floating ghost, and Help.',
            'Click outside the menu, press Escape, or click the ghost again to close it.',
        ],
    },
    {
        category: 'Music',
        items: [
            'Click the equalizer button (between the pomodoro and the ghost menu) to open the focus-music popover.',
            'Pick a curated lofi/ambient station, or paste a YouTube watch / playlist / live URL to add your own. Custom stations sit at the top of the picker; remove one with its × button.',
            'Audio plays through a small embedded YouTube iframe — internet connection required. Live streams play continuously; non-live playlists may include YouTube ads.',
            'When a Pomodoro session ends, music auto-pauses so the chime cuts through; it resumes after you acknowledge the alert if you were playing.',
        ],
    },
];

const SHORTCUT_GROUPS = [
    {
        category: 'Navigation',
        items: [
            { keys: ['←'],             description: 'Jump focus to the active project icon in the sidebar' },
            { keys: ['→'],             description: 'Jump focus to the new-task input in the active project' },
            { keys: ['Ctrl', 'Backspace'], description: 'Collapse or expand the projects sidebar (same toggle as the hamburger button)' },
            { keys: ['Ctrl', 'Enter'], description: 'Expand or collapse the description panel on every open task at once' },
            { keys: ['↑'],             description: 'Move focus to the previous todo row (or project row when in sidebar)' },
            { keys: ['↓'],             description: 'Move focus to the next todo row (or project row when in sidebar)' },
        ],
    },
    {
        category: 'Editing',
        items: [
            { keys: ['Enter'],  description: 'Commit the current title or description, or edit the focused row' },
            { keys: ['Delete'], description: 'Delete the focused todo row (with confirmation) — Backspace works the same on Mac keyboards that lack a dedicated Delete key' },
            { keys: ['Ctrl', 'Delete'], description: 'Expand or collapse the description panel of the focused todo' },
        ],
    },
    {
        category: 'Global',
        items: [
            { keys: ['?'],      description: 'Open this help modal' },
            { keys: ['Esc'],    description: 'Close the open modal, popover, or context menu' },
            { keys: ['Ctrl', 'Space'], description: 'Toggle the Pomodoro timer between play and pause from anywhere in the app' },
        ],
    },
];

export function showHelpModal() {
    const prior = document.getElementById('helpModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'helpModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'helpModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'helpModalTitle');

    const header = document.createElement('div');
    header.id = 'helpModalHeader';

    const title = document.createElement('div');
    title.id = 'helpModalTitle';
    title.textContent = 'Help';

    const closeX = document.createElement('button');
    closeX.id = 'helpModalClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close help');
    closeX.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'helpModalBody';

    // Topic sections (Tasks / Projects / Ghost Menu) — plain bullet lists
    // explaining the visible chrome.
    HELP_TOPICS.forEach(function(topic) {
        const block = document.createElement('section');
        block.className = 'helpTopic';

        const topicLabel = document.createElement('div');
        topicLabel.className = 'helpTopicLabel';
        topicLabel.textContent = topic.category;
        block.appendChild(topicLabel);

        const list = document.createElement('ul');
        list.className = 'helpTopicList';
        topic.items.forEach(function(text) {
            const li = document.createElement('li');
            li.textContent = text;
            list.appendChild(li);
        });
        block.appendChild(list);
        body.appendChild(block);
    });

    // Keyboard Shortcuts section — two-column table with monospace key-cap
    // pills. Subgroups (Navigation / Editing / Global) sit beneath the
    // top-level "Keyboard Shortcuts" label so the table stays scannable.
    const shortcutsBlock = document.createElement('section');
    shortcutsBlock.className = 'helpTopic helpShortcuts';

    const shortcutsLabel = document.createElement('div');
    shortcutsLabel.className = 'helpTopicLabel';
    shortcutsLabel.textContent = 'Keyboard Shortcuts';
    shortcutsBlock.appendChild(shortcutsLabel);

    SHORTCUT_GROUPS.forEach(function(group) {
        const sub = document.createElement('div');
        sub.className = 'shortcutsGroup';

        const groupLabel = document.createElement('div');
        groupLabel.className = 'shortcutsGroupLabel';
        groupLabel.textContent = group.category;
        sub.appendChild(groupLabel);

        const list = document.createElement('ul');
        list.className = 'shortcutsList';

        group.items.forEach(function(item) {
            const row = document.createElement('li');
            row.className = 'shortcutsRow';

            const keys = document.createElement('span');
            keys.className = 'shortcutsKeys';
            item.keys.forEach(function(k, i) {
                if (i > 0) {
                    const plus = document.createElement('span');
                    plus.className = 'shortcutsKeySep';
                    plus.textContent = '+';
                    keys.appendChild(plus);
                }
                const kbd = document.createElement('kbd');
                kbd.className = 'shortcutsKey';
                kbd.textContent = k;
                keys.appendChild(kbd);
            });

            const desc = document.createElement('span');
            desc.className = 'shortcutsDesc';
            desc.textContent = item.description;

            row.appendChild(keys);
            row.appendChild(desc);
            list.appendChild(row);
        });

        sub.appendChild(list);
        shortcutsBlock.appendChild(sub);
    });

    body.appendChild(shortcutsBlock);

    const actions = document.createElement('div');
    actions.id = 'helpModalActions';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'helpModalCloseBtn';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';

    actions.appendChild(closeBtn);
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // Capture focus before the modal hijacks it so close() can hand it
    // back. See showChangelogModal for the rationale.
    const previouslyFocused = document.activeElement;

    closeBtn.focus();

    function onHelpClose() {
        // Prefer the empty-state Create button when present — it's the
        // single keyboard affordance on that screen and Enter has to
        // route to it for the no-projects flow to work.
        const createBtn = document.getElementById('emptyStateCreateBtn');
        if (createBtn) {
            createBtn.focus();
            return;
        }
        if (previouslyFocused &&
            typeof previouslyFocused.focus === 'function' &&
            document.contains(previouslyFocused)) {
            previouslyFocused.focus();
        }
    }

    wireModalDismiss({
        backdrop: backdrop,
        closeButtons: [closeX, closeBtn],
        onClose: onHelpClose
    });
}


// ── MISSED DATES MODAL ──
// Surfaces the full list of missed recurring-task dates, grouped by
// month newest-first. The stats drawer hosts a `+ N more` chip beside
// its 5-pill preview; clicking it opens this modal. Shell mirrors
// showChangelogModal / showHelpModal — backdrop + dialog, header with
// an X, scrollable body, footer Close, and the trio of close
// affordances (X / backdrop / Escape) per CLAUDE.md.
export function showMissedDatesModal(taskTitle, misses) {
    const prior = document.getElementById('missedDatesModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'missedDatesModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'missedDatesModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'missedDatesModalTitle');

    const header = document.createElement('div');
    header.id = 'missedDatesModalHeader';

    const titleEl = document.createElement('div');
    titleEl.id = 'missedDatesModalTitle';
    titleEl.textContent = 'Missed: ' + (taskTitle || '');

    const closeX = document.createElement('button');
    closeX.id = 'missedDatesModalClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close missed dates');
    closeX.textContent = '×';

    header.appendChild(titleEl);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'missedDatesModalBody';

    // Sort misses newest-first so the modal header and month groups line up
    // visually. Defensive: the caller already passes a sorted slice, but
    // re-sorting here lets the modal trust its own ordering invariants.
    const sortedMisses = (Array.isArray(misses) ? misses.slice() : []).sort(function(a, b) {
        return b.getTime() - a.getTime();
    });

    const overview = document.createElement('div');
    overview.className = 'missedDatesOverview';
    if (sortedMisses.length > 0) {
        const newest = sortedMisses[0];
        const oldest = sortedMisses[sortedMisses.length - 1];
        const newestKey = newest.getFullYear() + '-' + newest.getMonth();
        const oldestKey = oldest.getFullYear() + '-' + oldest.getMonth();
        const newestLabel = formatMonthYear(newest);
        if (newestKey === oldestKey) {
            overview.textContent = sortedMisses.length
                + ' missed dates in ' + newestLabel;
        } else {
            overview.textContent = sortedMisses.length
                + ' missed dates across ' + formatMonthYear(oldest)
                + ' – ' + newestLabel;
        }
    } else {
        overview.textContent = 'No missed dates.';
    }
    body.appendChild(overview);

    // Bucket misses by ${year}-${month}. Walking the already-sorted array
    // keeps the buckets newest-first in iteration order, so the renderer
    // can append groups in encounter order without a second sort.
    const groups = [];
    const bucketByKey = {};
    sortedMisses.forEach(function(d) {
        const k = d.getFullYear() + '-' + d.getMonth();
        if (!bucketByKey[k]) {
            const bucket = {
                key: k,
                year: d.getFullYear(),
                month: d.getMonth(),
                dates: [],
            };
            bucketByKey[k] = bucket;
            groups.push(bucket);
        }
        bucketByKey[k].dates.push(d);
    });

    groups.forEach(function(group) {
        const section = document.createElement('section');
        section.className = 'missedDatesMonthGroup';

        const heading = document.createElement('div');
        heading.className = 'missedDatesMonthHeading';
        const monthName = new Date(group.year, group.month, 1)
            .toLocaleString(undefined, { month: 'long' });
        heading.textContent = monthName + ' ' + group.year
            + ' · ' + group.dates.length + ' missed';
        section.appendChild(heading);

        const pillRow = document.createElement('div');
        pillRow.className = 'statsMissedList';
        // Newest first within the month.
        const monthDates = group.dates.slice().sort(function(a, b) {
            return b.getTime() - a.getTime();
        });
        monthDates.forEach(function(d) {
            const pill = document.createElement('span');
            pill.className = 'statsMissedPill';
            pill.textContent = formatMissShortDate(d);
            pillRow.appendChild(pill);
        });
        section.appendChild(pillRow);

        body.appendChild(section);
    });

    const actions = document.createElement('div');
    actions.id = 'missedDatesModalActions';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'missedDatesModalCloseBtn';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';

    actions.appendChild(closeBtn);
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // Capture focus before the modal hijacks it so close() can hand it
    // back to whichever `+ N more` button opened the modal.
    const previouslyFocused = document.activeElement;
    closeBtn.focus();

    function onMissedDatesClose() {
        if (previouslyFocused &&
            typeof previouslyFocused.focus === 'function' &&
            document.contains(previouslyFocused)) {
            previouslyFocused.focus();
        }
    }

    wireModalDismiss({
        backdrop: backdrop,
        closeButtons: [closeX, closeBtn],
        onClose: onMissedDatesClose
    });
}

const MISSED_MODAL_MONTH_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];
function formatMissShortDate(d) {
    return MISSED_MODAL_MONTH_SHORT[d.getMonth()] + ' ' + d.getDate();
}
function formatMonthYear(d) {
    const monthName = d.toLocaleString(undefined, { month: 'long' });
    return monthName + ' ' + d.getFullYear();
}


// ── HELP FAB ──
// The floating circular `?` button sits at the bottom-right of the viewport
// on desktop and pointer-fine devices. CSS handles both visibility rules:
// the `pointer: coarse` media query hides it on touch viewports (where the
// shortcuts don't apply), and `body:has(...)` hides it whenever any modal,
// popover, or context menu is in the DOM so it never overlaps one. JS just
// creates the element and the `?` click handler — no visibility bookkeeping.
//
// The matching guard for the global `?` keydown lives in main.js and uses
// isAnyModalOrPopoverOpen so the shortcut is suppressed under the same
// conditions the FAB hides.
export function isAnyModalOrPopoverOpen() {
    // Music popover lives in the DOM at rest (the iframe inside it is the
    // audio source — destroying it on close would cut playback) so we test
    // for the `.open` class instead of element presence.
    return !!(
        document.getElementById('confirmModalBackdrop')   ||
        document.getElementById('changelogModalBackdrop') ||
        document.getElementById('descEditorModalBackdrop') ||
        document.getElementById('helpModalBackdrop')      ||
        document.getElementById('settingsModalBackdrop')  ||
        document.getElementById('missedDatesModalBackdrop') ||
        document.getElementById('statsModalBackdrop')     ||
        document.getElementById('authModalBackdrop')      ||
        document.getElementById('injectSettingsBackdrop') ||
        document.getElementById('injectTargetSubBackdrop') ||
        document.getElementById('coverageDetailModalBackdrop') ||
        document.getElementById('dueDatePopover')         ||
        document.getElementById('projContextMenu')        ||
        document.getElementById('settingsMenu')           ||
        document.getElementById('pomodoroPopover')        ||
        document.getElementById('coachmarkOverlay')       ||
        document.getElementById('welcomeCarouselBackdrop')||
        document.querySelector('#musicPopover.open')      ||
        document.querySelector('#bottomSheet[data-state="EXPANDED"]')
    );
}

