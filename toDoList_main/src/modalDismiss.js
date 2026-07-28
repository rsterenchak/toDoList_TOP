// ── SHARED MODAL DISMISS WIRING ──
// The dismissible modals across the app all close the same three ways — an
// explicit close control, a backdrop click, and Escape — guarded so the close
// runs only once, tearing down the keydown listener and detaching the backdrop
// on the way out (CLAUDE.md: "modals must close on close-button, backdrop
// click, and Escape"). This helper centralizes that contract so the modals
// can't drift apart. Callers pass the backdrop, their close control(s) via
// `closeButtons`, and an optional `onClose` hook for the modal-specific tail
// (focus restoration, persistence) that runs after teardown. Returns the
// guarded close function so callers can invoke it from other handlers.
//
// This lives in its own leaf module (no app imports) so it can be shared without
// dragging a view's import graph along: modals.js re-exports it for its existing
// callers, and mockupFlow.js imports it directly for the tap-to-enlarge overlay
// WITHOUT re-creating the modals ↔ mockupFlow cycle a static modals.js import
// would (modals.js already imports mockupFlow.js).
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
