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
import { buildManualStatusControl, invokeReviewBadgeTap } from './todoStatus.js';
import {
    makeGenerateButton,
    syncGenerateControl,
    buildAskingBlock,
    buildDispatchBlock,
    buildReviewBlock,
    buildReviewActions,
    mountRunReportBlock,
    invokeIterateTask,
} from './toDoRow.js';
import { derivePhase, isBlockedPhase, PHASE } from './phase.js';
import { buildPhaseRail, paintPhaseRail } from './phaseRail.js';
import { getQueueRowForTodo, onQueueChange, stuckReasonText } from './agentQueueStore.js';
// The A/B/C mockup flow — the SAME implementation the Agent board and the desktop
// detail pane mount. The mobile modal reuses it in its tabbed layout (three OPTION
// A/B/C tabs above one scaled preview) rather than reimplementing generation,
// variant parsing, or the Use path here.
import { buildMockupSecondary } from './mockupFlow.js';
// The File:-path picker (trigger chip + searchable manifest panel) and its
// `File:`-line insertion logic are shared with the desktop description panel
// (toDoRow.js) so the two hosts can never diverge — modals.js only mounts the
// picker and supplies its post-pick side effects. insertFilePathIntoEntry is
// re-exported below to preserve its existing import path for callers/tests.
import { createFilePicker, insertFilePathIntoEntry } from './filePicker.js';

export { insertFilePathIntoEntry };

// The shared modal dismiss wiring (close-button / backdrop / Escape + focus
// restoration) lives in its own leaf module so it can be reused without dragging
// modals.js's view import graph along. Imported here for this file's own modals
// AND re-exported to preserve the existing `from './modals.js'` import path for
// all its callers/tests.
import { wireModalDismiss } from './modalDismiss.js';
export { wireModalDismiss };


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

// The eyebrow label each blocked phase shows in place of the static
// "Description" — the phase's own name, rendered uppercase by the eyebrow's
// text-transform. `accept` reads REVIEW to match the badge / rail vocabulary.
// Keyed by the literal PHASE string VALUES rather than `PHASE.*` refs because
// this map is built at module-eval time and phase.js → inject.js → modals.js is
// a circular import — `PHASE` is still in its temporal dead zone here, so a
// computed `[PHASE.ASKING]` key would read undefined.ASKING and throw.
const PHASE_EYEBROW_LABELS = Object.freeze({
    asking: 'Asking',
    drafted: 'Drafted',
    stuck: 'Stuck',
    mockup: 'Mockup',
    accept: 'Review',
});

export function showDescEditorModal(item, options) {

    if (!item) return;
    const opts = options || {};

    // Clear the derived DRAFTED badge the moment the description editor opens: the
    // badge means "a generated draft landed here and you haven't looked at it yet",
    // and opening the editor IS the look. Gate on the phase actually being DRAFTED
    // so an unconditional stamp doesn't write on every task the user ever opens.
    // The stamp routes through listLogic like every other mutation (so it syncs
    // and survives reload); TODO_RUN_STATUS_EVENT then repaints the row's badge
    // behind the modal.
    if (derivePhase(item) === PHASE.DRAFTED && item.id) {
        listLogic.markDraftSeen(item.id);
        document.dispatchEvent(new CustomEvent(TODO_RUN_STATUS_EVENT));
    }

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
    // The rail markup + repaint live in the shared phaseRail.js builder so this
    // modal and the desktop #descSibling panel render one rail, never two that
    // drift. buildPhaseRail sets role="img" and the phaseRail* classes; the modal
    // only adds its own id for host-specific padding.
    const rail = buildPhaseRail(derivePhase(item));
    rail.id = 'descEditorModalRail';

    function renderRail() {
        const phase = derivePhase(item);
        paintPhaseRail(rail, phase);
        return phase;
    }

    // Repaint the phase-dependent UI from a single derived phase: renderRail
    // computes derivePhase(item) once and returns it, and every phase block reuses
    // that value rather than resolving it a second time in the same render. The
    // blocks are the touch-device homes for the same controls the desktop
    // `#descSibling` panel mounts — the ASKING question + answer, the Dispatch /
    // Retry action, the STUCK reason, the MOCKUP flow, and the WHAT CHANGED review
    // card + decide actions — so a phone tap on a phase badge reaches them here
    // rather than in an inline accordion. renderDispatchBlock takes no phase: it
    // gates on the linked queue row's state directly, because opening the modal
    // stamps draftSeenAt (clearing PHASE.DRAFTED) before this runs. Order matters:
    // renderStuckBlock mounts the reason card before renderDispatchBlock, whose
    // Retry variant anchors beneath it.
    function refreshPhaseUI() {
        const phase = renderRail();
        renderAskingBlock(phase);
        renderStuckBlock(phase);
        renderDispatchBlock();
        renderMockupBlock(phase);
        renderReviewBlock(phase);
        applyPhaseChrome(phase);
        renderEntryDisclosure(phase);
    }

    // Repaint when the phase changes while the modal is open — an entry can ship
    // or be acknowledged from another surface mid-session (TODO_RUN_STATUS_EVENT),
    // and the linked agent_queue row can enter or leave failed/no_change via a
    // realtime push (onQueueChange), both of which move the rail, toggle the REVIEW
    // action, and mount/clear the STUCK block. The row layer already refreshes on
    // both signals via refreshDescStatusDots; the modal points its one handler at
    // both and tears them down on close (see onDescEditorClose) so a dismissed
    // modal leaves nothing attached.
    function onRailPhaseChange() { refreshPhaseUI(); }
    document.addEventListener(TODO_RUN_STATUS_EVENT, onRailPhaseChange);
    const unsubscribeQueueChange = onQueueChange(onRailPhaseChange);

    const body = document.createElement('div');
    body.id = 'descEditorModalBody';

    // Label the entry field with the same SpaceMono uppercase treatment the rest
    // of the pipeline surfaces use, so the textarea reads as THE ENTRY panel of an
    // instrument, not an unlabelled form field.
    const entryLabel = document.createElement('span');
    entryLabel.id = 'descEditorModalEntryLabel';
    entryLabel.textContent = 'The entry';
    body.appendChild(entryLabel);

    // ── ASKING QUESTION BLOCK ──
    // When the task's derived phase is `asking` (its linked agent_queue row is in
    // needs_words), triage has a pending question. Mount the SHARED ASKING block —
    // buildAskingBlock from toDoRow.js, the same builder the desktop `#descSibling`
    // panel uses — at the top of the body: triage's question, the answer textarea
    // (16px, iOS-zoom-safe), and the Send control that routes the answer through
    // listLogic.answerAgentTask. Idempotent, mirroring renderStuckBlock: mount only
    // in the asking phase and clear the moment the queue row moves on, but KEEP an
    // already-mounted block for the SAME queue row (data-answer-row guard) so a live
    // repaint doesn't drop the user's unsent answer text.
    function renderAskingBlock(phase) {
        const existing = body.querySelector('.askingBlock');
        const queueRow = (phase === PHASE.ASKING && item && item.id)
            ? getQueueRowForTodo(item.id) : null;
        if (!queueRow) {
            if (existing) existing.remove();
            return;
        }
        if (existing && existing.getAttribute('data-answer-row') === String(queueRow.id)) return;
        if (existing) existing.remove();
        body.insertBefore(buildAskingBlock(item, opts.projectName || '', queueRow), body.firstChild);
    }

    // ── STUCK REASON BLOCK ──
    // When the task's derived phase is `stuck` (its linked agent_queue row is in
    // failed / no_change), surface the run's failure reason as a read-only block at
    // the top of the editor — the same shape and position the row's ASKING block
    // uses for triage's question, so the badge tap leads somewhere that explains
    // itself. The reason text reuses the store's single fallback resolver
    // (stuckReasonText) rather than a second copy of the copy. It mounts only in the
    // stuck phase and clears the moment the queue row moves on; repainted from
    // refreshPhaseUI (which runs on both TODO_RUN_STATUS_EVENT and onQueueChange).
    // Idempotent: it refreshes the mounted block's text rather than rebuilding.
    function renderStuckBlock(phase) {
        const existing = body.querySelector('#descEditorModalStuck');
        if (phase !== PHASE.STUCK) {
            if (existing) existing.remove();
            return;
        }
        const queueRow = item && item.id ? getQueueRowForTodo(item.id) : null;
        const reason = stuckReasonText(queueRow);
        if (existing) {
            const reasonEl = existing.querySelector('.descEditorModalStuckReason');
            if (reasonEl && reasonEl.textContent !== reason) reasonEl.textContent = reason;
            return;
        }
        const block = document.createElement('div');
        block.id = 'descEditorModalStuck';
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

        body.insertBefore(block, body.firstChild);
    }

    // ── MOCKUP FLOW BLOCK ──
    // When the task's derived phase is `mockup` (its linked agent_queue row is in
    // needs_mockup), the run is waiting on a visual direction before its entry can
    // be authored. Mount the SHARED A/B/C mockup flow at the top of the body, above
    // the authoring textarea — mirroring the desktop pane — but in the TABBED layout
    // (options.tabbed): three OPTION A/B/C tabs above a single scaled preview, since
    // three frames across at phone width are unreadable and stacking them would blow
    // the modal's height cap. Choosing a variant produces its finished entry and
    // moves the row to `drafted`, identical to the pane and the board.
    //
    // Idempotent, mirroring renderStuckBlock: mount only in the mockup phase and
    // clear the moment the queue row moves on, but keep an already-mounted block for
    // the SAME queue row so a live repaint (refreshPhaseUI runs on every
    // TODO_RUN_STATUS_EVENT / onQueueChange) never wipes an in-flight Generate or the
    // rendered previews — buildMockupSecondary repaints its own previews internally.
    // The block sits at body.firstChild; STUCK and MOCKUP are different phases, so
    // the two blocks never contend for that slot.
    function renderMockupBlock(phase) {
        const existing = body.querySelector('#descEditorModalMockup');
        const queueRow = (phase === PHASE.MOCKUP && item && item.id)
            ? getQueueRowForTodo(item.id) : null;
        if (!queueRow) {
            if (existing) existing.remove();
            return;
        }
        // Same queue row already mounted — leave the block (and any in-flight
        // Generate / rendered previews) untouched so a repaint doesn't thrash it.
        if (existing && existing.getAttribute('data-mockup-row') === String(queueRow.id)) return;
        if (existing) existing.remove();

        const block = document.createElement('div');
        block.id = 'descEditorModalMockup';
        block.className = 'descEditorModalMockup';
        block.setAttribute('data-mockup-row', String(queueRow.id));

        const intro = document.createElement('p');
        intro.className = 'descEditorModalMockupIntro';
        intro.textContent = 'Triage needs a visual direction before this entry can be written. '
            + 'Generate A/B/C mockups, then choose one to finish the entry.';
        block.appendChild(intro);

        block.appendChild(buildMockupSecondary(queueRow, { tabbed: true }));

        body.insertBefore(block, body.firstChild);
    }

    // ── DISPATCH / RETRY ACTION ──
    // A landed draft (linked queue row `drafted`) shows a Dispatch control; a broken
    // / no-change run (`failed` / `no_change`) shows a Retry control beneath the
    // STUCK reason card. Both are the SHARED buildDispatchBlock from toDoRow.js — the
    // touch home for the row-side Dispatch / Retry the desktop `#descSibling` panel
    // mounts. Gated on the queue row's STATE, not the derived phase: opening this
    // modal stamps draftSeenAt, which clears PHASE.DRAFTED, so a phase gate would
    // wipe the Dispatch control before it ever mounts (the green-but-does-nothing
    // failure this codebase pins deliberately). Idempotent: keep an in-flight
    // (pending) button across a repaint when the row + mode are unchanged.
    function renderDispatchBlock() {
        const existing = body.querySelector('.descDispatchBlock');
        const queueRow = item && item.id ? getQueueRowForTodo(item.id) : null;
        const state = queueRow && queueRow.state;
        const mode = state === 'drafted' ? 'dispatch'
            : ((state === 'failed' || state === 'no_change') ? 'retry' : null);
        if (!mode) {
            if (existing) existing.remove();
            return;
        }
        if (existing) {
            if (existing.getAttribute('data-dispatch-row') === String(queueRow.id)
                && existing.getAttribute('data-dispatch-mode') === mode) return;
            existing.remove();
        }
        const block = buildDispatchBlock(item, queueRow, mode);
        // Retry sits beneath the STUCK reason card; Dispatch beneath the entry
        // textarea. Fall back to appending at the body's end.
        const anchorAfter = mode === 'retry'
            ? body.querySelector('#descEditorModalStuck')
            : body.querySelector('#descEditorModalTextarea');
        if (anchorAfter) body.insertBefore(block, anchorAfter.nextSibling);
        else body.appendChild(block);
    }

    // ── REVIEW (ACCEPT-PHASE) DECISION SURFACE ──
    // When the task's derived phase is `accept` (shipped, not yet acknowledged),
    // mount the SHARED WHAT CHANGED card (buildReviewBlock) and the ACCEPT / REVERT /
    // OPEN IN TODO.MD action row (buildReviewActions) at the top of the body — the
    // touch home for the decide surface the desktop detail pane mounts inline.
    // OPEN IN TODO.MD hands buildReviewActions an onOpenInViewer that dismisses this
    // modal FIRST, then defers the anchored viewer open a tick (an open modal over
    // the viewer lands the anchor scroll behind a scrim) — the exact close-then-defer
    // the modal's old REVIEW button did. Idempotent, mirroring syncReviewPanel: keep
    // the mounted controls (and any in-flight Revert) when the same entry is already
    // shown so a live repaint doesn't thrash the DOM.
    function renderReviewBlock(phase) {
        const existingBlock = body.querySelector('.descReviewBlock');
        const existingActions = body.querySelector('.descReviewActions');
        if (phase !== PHASE.ACCEPT) {
            if (existingBlock) existingBlock.remove();
            if (existingActions) existingActions.remove();
            return;
        }
        const entryKey = String((item && (item.entryId || item.id)) || '');
        if (existingActions && existingActions.getAttribute('data-review-entry') === entryKey) return;
        if (existingBlock) existingBlock.remove();
        if (existingActions) existingActions.remove();
        const queueRow = item && item.id ? getQueueRowForTodo(item.id) : null;
        const projectName = opts.projectName || '';
        const actionsRow = buildReviewActions(item, projectName, {
            onOpenInViewer: function () {
                const entryId = item && item.entryId;
                closeDescEditor();
                setTimeout(function () {
                    invokeReviewBadgeTap(entryId, projectName);
                }, 0);
            },
            // Opening the chat sheet means sliding it up OVER this modal. Dismiss
            // the modal first, then defer the iterate open a tick — the same
            // close-then-defer the OPEN IN TODO.MD route uses — so the sheet never
            // stacks on top of a still-open modal.
            onIterate: function (entryId, repo) {
                closeDescEditor();
                setTimeout(function () {
                    invokeIterateTask(entryId, repo);
                }, 0);
            },
        });
        // WHAT CHANGED card first, the action row right after it.
        body.insertBefore(actionsRow, body.firstChild);
        body.insertBefore(buildReviewBlock(item, queueRow), body.firstChild);
        // The run's closing summary is fetched async and mounted BETWEEN the WHAT
        // CHANGED card and the action row once (if) it resolves. The modal body
        // already scrolls under its 92vh cap, so no expanded-height re-snapshot is
        // needed here (that is the desktop viewer's concern). A run with no summary,
        // or a failed fetch, mounts nothing.
        mountRunReportBlock(body, item, queueRow, actionsRow, null);
    }

    // ── PHASE CHROME (blocked-phase eyebrow + dialog accent) ──
    // In a blocked phase the header eyebrow drops "Description" for the phase name
    // and both it and the dialog border take the phase accent — amber for the
    // waiting-on-you phases, danger red for `stuck` — so the modal reads as the
    // phase surface it now leads with. Driven by a `data-phase` attribute on the
    // dialog rather than inline styles, so the color rules live in style.css. Non-
    // blocked phases restore the static "Description" eyebrow and clear the accent,
    // keeping those layouts byte-for-byte their prior selves.
    function applyPhaseChrome(phase) {
        if (isBlockedPhase(phase)) {
            dialog.setAttribute('data-phase', phase);
            eyebrowLabel.textContent = PHASE_EYEBROW_LABELS[phase] || 'Description';
        } else {
            dialog.removeAttribute('data-phase');
            eyebrowLabel.textContent = 'Description';
        }
    }

    // ── THE ENTRY DISCLOSURE (blocked-phase collapse) ──
    // When a task is parked in a blocked phase, the thing the user opened the modal
    // for is the phase block above — the question, the stuck reason, the shipped
    // diff — not the TODO.md entry text. Collapse THE ENTRY region (its label, the
    // file picker, and the 180px textarea) behind ONE disclosure row pinned below
    // the phase block, so a short phone shows the phase block without scrolling past
    // the textarea. In every non-blocked phase no disclosure renders and the entry
    // region stays expanded — the pre-existing layout, unchanged.
    //
    // Collapse toggles the `hidden` attribute on the region's own elements (each
    // backed by an explicit `[hidden] { display: none !important }` guard in
    // style.css, since author-level `display` outranks the bare UA `[hidden]` rule),
    // never an inline style write. The disclosure is a real <button> with
    // aria-expanded / aria-controls and a 44px tap target. State is transient: a
    // fresh modal starts collapsed (entryExpanded = false) and a mid-session repaint
    // preserves whatever the user last chose — it is never persisted.
    function applyEntryVisibility(collapsed) {
        entryLabel.hidden = collapsed;
        filePicker.trigger.hidden = collapsed;
        textarea.hidden = collapsed;
        // Closing the picker dropdown on collapse is harmless (a later tap reopens
        // it); never force it OPEN on expand — the picker owns its own hidden state,
        // so leave a closed panel closed rather than popping it on every expand.
        if (collapsed) filePicker.panel.hidden = true;
    }
    function paintDisclosure() {
        const btn = body.querySelector('#descEditorModalEntryDisclosure');
        if (!btn) return;
        const hint = btn.querySelector('.descEditorModalEntryDisclosureHint');
        btn.setAttribute('aria-expanded', entryExpanded ? 'true' : 'false');
        if (hint) hint.textContent = entryExpanded ? 'tap to collapse ▴' : 'tap to expand ▾';
    }
    function renderEntryDisclosure(phase) {
        const existing = body.querySelector('#descEditorModalEntryDisclosure');
        if (!isBlockedPhase(phase)) {
            if (existing) existing.remove();
            applyEntryVisibility(false);
            return;
        }
        if (!existing) {
            const btn = document.createElement('button');
            btn.id = 'descEditorModalEntryDisclosure';
            btn.type = 'button';
            btn.className = 'descEditorModalEntryDisclosure';
            btn.setAttribute('aria-controls',
                'descEditorModalEntryLabel descEditorModalTargetPick descEditorModalTextarea descEditorModalTargetPanel');

            const label = document.createElement('span');
            label.className = 'descEditorModalEntryDisclosureLabel';
            label.textContent = 'The entry';

            const hint = document.createElement('span');
            hint.className = 'descEditorModalEntryDisclosureHint';
            hint.setAttribute('aria-hidden', 'true');

            btn.appendChild(label);
            btn.appendChild(hint);
            btn.addEventListener('click', function () {
                entryExpanded = !entryExpanded;
                applyEntryVisibility(!entryExpanded);
                paintDisclosure();
                if (entryExpanded) {
                    // Bring the freshly-expanded region into view on a short phone.
                    try { textarea.scrollIntoView({ block: 'nearest' }); } catch (e) { /* defensive */ }
                }
            });
            // Sits right above the entry region so an expand reveals it directly
            // beneath the disclosure, and below any phase block (which mount at
            // body.firstChild), so the phase block keeps the top of the body.
            body.insertBefore(btn, entryLabel);
            paintDisclosure();
        }
        applyEntryVisibility(!entryExpanded);
    }

    // Transient disclosure state — a fresh modal always starts collapsed; never
    // persisted (see renderEntryDisclosure).
    let entryExpanded = false;

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

    // ── FILE:-PATH PICKER ──
    // A target-picker chip beside THE ENTRY that lists the active project's
    // source files (from the manifest structureView already fetched and cached)
    // and, on selection, writes the chosen path into the entry's `File:` line —
    // removing the one authoring step that depended on holding repo paths in
    // your head. The chip + its searchable panel are the shared createFilePicker
    // implementation (filePicker.js) — one code path with the desktop
    // description panel so the two can't diverge. The chip sits above the
    // textarea; its panel drops in below it. After a pick, persist so the
    // description survives a reload (the picker already re-synced item.desc and
    // the inject button by dispatching the textarea's `input` event).
    const filePicker = createFilePicker({
        projectName: opts.projectName || '',
        textarea: textarea,
        triggerId: 'descEditorModalTargetPick',
        panelId: 'descEditorModalTargetPanel',
        onInsert: function () { listLogic.saveToStorage(); },
    });
    body.insertBefore(filePicker.trigger, textarea);
    body.appendChild(filePicker.panel);

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

    // The REVIEW (accept-phase) decide surface no longer lives in the actions row.
    // In the `accept` phase renderReviewBlock mounts the WHAT CHANGED card plus the
    // ACCEPT / REVERT / OPEN IN TODO.MD action row at the TOP of the body (the shared
    // buildReviewBlock / buildReviewActions the desktop detail pane uses), so the
    // mobile user can decide in place rather than only routing out to the viewer.

    // Explicit stacking order for the whole actions block: Generate, its spend
    // caption, Inject, then the Clear / Copy pair on one row. Each child carries its
    // own `order` in CSS rather than layering another override onto a basis hack, so
    // the sequence is readable.
    actions.appendChild(clearBtn);
    actions.appendChild(injectBtn);
    actions.appendChild(generateBtn);
    actions.appendChild(generateSpend);
    actions.appendChild(copyBtn);
    // Reflect the linked queue row's current state (Generating…/failure) and land
    // a draft that finished while the modal was closed. Live pushes re-sync via
    // the shared sweep in refreshDescStatusDots (every `.generateBtn`).
    syncGenerateControl(generateBtn);

    // First paint of the rail + every phase block now that the body + textarea
    // exist (the TODO_RUN_STATUS_EVENT / onQueueChange subscriptions above only
    // repaint on later changes).
    refreshPhaseUI();

    // ── STATUS SEGMENTED CONTROL ──
    // On mobile the on-row status badge (`.todoStatusLabel` → showStatusPopover)
    // is hidden in favor of the left-edge color tab, so status is visible but
    // not settable from the row. Surface the shared three-segment selector here.
    // It is built by buildManualStatusControl (todoStatus.js) so the desktop
    // detail pane, which mounts the very same control, can never drift from it.
    // It sits BELOW the actions (last in the dialog) under its own label; the
    // rail above renders the DERIVED pipeline phase, this control is the user's
    // OWN annotation, so the label reads "Manual status".
    const statusRow = buildManualStatusControl(item, opts.projectName || '');

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
        // Detach the phase-rail live-repaint listeners so a dismissed modal leaves
        // nothing attached — both the run-status event and the agent-queue store.
        document.removeEventListener(TODO_RUN_STATUS_EVENT, onRailPhaseChange);
        if (typeof unsubscribeQueueChange === 'function') unsubscribeQueueChange();
        persist();
        if (previouslyFocused &&
            typeof previouslyFocused.focus === 'function' &&
            document.contains(previouslyFocused)) {
            try { previouslyFocused.focus(); } catch (e) { /* defensive */ }
        }
    }

    const closeDescEditor = wireModalDismiss({
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
// On success it closes and calls `options.onSaved(content, sha)` with the text it
// just wrote and the returned sha, so the caller can repaint the card
// (unfilled → filled) from the saved content rather than re-reading it. On a 409
// conflict it reloads the latest
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
                // Hand the caller the exact text that was just written (plus the
                // new sha) so it can apply the save directly. Re-reading the file
                // to learn what it now holds is what made the card repaint from
                // stale content when a layer between here and GitHub served the
                // pre-edit version.
                if (typeof opts.onSaved === 'function') opts.onSaved(textarea.value, res.sha);
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

