// Bottom-anchored "Deleted X — UNDO" toast used by the STACK mobile
// swipe-left-to-delete flow. Per the mobile task-interactions spec in
// TODO.md, swipe-delete commits the destructive action immediately (no
// upfront confirm modal) and surfaces an undo affordance for 5 seconds —
// the recovery path required by CLAUDE.md's destructive-action rule.
//
// Singleton: at most one toast is on-screen at a time. Showing a new
// toast cancels any prior pending timer and replaces the content in
// place, so a rapid sequence of swipe-deletes always reflects the most
// recent removal.

const TOAST_DURATION_MS = 5000;
const TOAST_ID          = 'undoToast';

let activeToast      = null;
let activeTimer      = null;
let activeOnDismiss  = null;


function destroyActive() {
    if (activeTimer) {
        clearTimeout(activeTimer);
        activeTimer = null;
    }
    if (activeToast && activeToast.parentNode) {
        activeToast.parentNode.removeChild(activeToast);
    }
    activeToast     = null;
    activeOnDismiss = null;
}


// Dismiss any visible toast without firing its undo callback. Called by
// callers that need to clear the toast for an unrelated reason (project
// switch, app teardown).
export function dismissUndoToast() {
    if (activeOnDismiss) {
        const cb = activeOnDismiss;
        activeOnDismiss = null;
        try { cb(); } catch (_) { /* noop */ }
    }
    destroyActive();
}


// Show an undo toast. opts:
//   label      — the visible message, e.g. 'Deleted "buy milk"'
//   onUndo     — fired when the user taps UNDO (toast then disappears)
//   onDismiss  — fired when the 5s window elapses or the toast is
//                replaced. Use this to release any references the caller
//                was holding for the undo (e.g. drop a captured item).
export function showUndoToast(opts) {

    // Replace any existing toast — destroyActive fires the previous
    // onDismiss synchronously so the caller can drop its reference.
    if (activeOnDismiss) {
        const cb = activeOnDismiss;
        activeOnDismiss = null;
        try { cb(); } catch (_) { /* noop */ }
    }
    destroyActive();

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const labelEl = document.createElement('span');
    labelEl.className = 'undoToastLabel';
    labelEl.textContent = opts && opts.label ? String(opts.label) : 'Deleted';

    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'undoToastButton';
    undoBtn.textContent = 'UNDO';

    toast.appendChild(labelEl);
    toast.appendChild(undoBtn);

    // Anchor to body so the toast sits above the STACK content + bottom
    // sheet without inheriting their stacking context. Style is in
    // style.css.
    document.body.appendChild(toast);

    activeToast     = toast;
    activeOnDismiss = (opts && typeof opts.onDismiss === 'function') ? opts.onDismiss : null;

    undoBtn.addEventListener('click', function() {
        // Cancel onDismiss for THIS toast — UNDO supersedes the dismiss path.
        activeOnDismiss = null;
        if (opts && typeof opts.onUndo === 'function') {
            try { opts.onUndo(); } catch (_) { /* noop */ }
        }
        destroyActive();
    });

    activeTimer = setTimeout(function() {
        const cb = activeOnDismiss;
        activeOnDismiss = null;
        if (typeof cb === 'function') {
            try { cb(); } catch (_) { /* noop */ }
        }
        destroyActive();
    }, TOAST_DURATION_MS);

    return toast;
}
