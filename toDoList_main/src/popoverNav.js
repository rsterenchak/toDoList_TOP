// Shared popover-keyboard helpers, extracted verbatim from main.js's
// component(). These are cross-cutting: `isFocusInTextInput` is used by the
// pomodoro (still inline in main.js), music, and settings popovers, and
// `popoverArrowNav` is used by the music popover. Centralizing them here gives
// each one home and removes the inject-the-same-helper-three-ways pattern.
// Both are self-contained (DOM queries only) — no component() closure capture.

// True when focus sits in a text-entry surface where Backspace must keep
// its native delete-character meaning. Used by the popover Backspace-to-
// close handlers to avoid hijacking the user's typing in inline edit fields
// (countdown, paste-URL form, etc.).
export function isFocusInTextInput() {
    const ae = document.activeElement;
    if (!ae) return false;
    if (ae.tagName === 'TEXTAREA' || ae.isContentEditable) return true;
    if (ae.tagName !== 'INPUT') return false;
    const t = (ae.type || '').toLowerCase();
    return t === 'text' || t === 'url' || t === 'search' || t === 'tel' ||
           t === 'email' || t === 'password' || t === 'number';
}

// Shared arrow-key navigation for the pomodoro and music popovers. Walks
// visible focusable controls inside `popover` with wrap-around. Returns
// true when the keystroke was consumed so the caller can skip its own
// handling. Defers to native semantics when focus is on a control whose
// own arrow keys matter (range slider for ±value, text/textarea/CE for
// caret movement). The settings menu uses its own [role="menuitem"]-only
// walk in onSettingsKeydown — this helper covers the looser dialog-style
// popovers where any visible button/input can be a stop.
export function popoverArrowNav(popover, event) {
    const isUp   = event.key === 'ArrowUp';
    const isDown = event.key === 'ArrowDown';
    const isHome = event.key === 'Home';
    const isEnd  = event.key === 'End';
    if (!isUp && !isDown && !isHome && !isEnd) return false;

    const ae = document.activeElement;
    if (ae) {
        const tag = ae.tagName;
        if (tag === 'TEXTAREA' || ae.isContentEditable) return false;
        if (tag === 'INPUT') {
            const t = (ae.type || '').toLowerCase();
            // Range step ↑↓; text-like inputs use ↑↓ for caret/history.
            if (t === 'range' || t === 'text' || t === 'url' || t === 'search' ||
                t === 'tel' || t === 'email' || t === 'password' || t === 'number') {
                return false;
            }
        }
    }

    const sel = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const items = Array.from(popover.querySelectorAll(sel)).filter(function(el) {
        // getClientRects is empty for display:none (and any display:none
        // ancestor), filtering out the hidden countdown-edit input and
        // the collapsed paste-URL form without a brittle style check.
        return el.getClientRects().length > 0 && el.tabIndex !== -1;
    });
    if (!items.length) return false;

    event.preventDefault();
    event.stopPropagation();

    const currentIdx = items.indexOf(ae);
    let nextIdx;
    if (isHome) nextIdx = 0;
    else if (isEnd) nextIdx = items.length - 1;
    else if (currentIdx === -1) nextIdx = isDown ? 0 : items.length - 1;
    else nextIdx = (currentIdx + (isDown ? 1 : -1) + items.length) % items.length;

    items[nextIdx].focus();
    return true;
}
