// Shared builder for the description panel's WRITE / PASTE / GENERATE authoring
// mode strip — the three-segment control that groups the ways an entry gets
// written into one place. Kept in its own leaf module (like phaseRail.js and the
// file picker) so the desktop detail panel and, later, the mobile
// description-editor modal can adopt ONE implementation rather than growing a
// second copy that drifts. This module builds ONLY the strip DOM and reports the
// chosen mode through a callback; the host owns what each mode shows, so no host
// wiring, DOM ids, or grid placement leak in here.

// The three authoring modes, in strip order. WRITE is always the default — the
// mode is transient view state, never persisted per task, so a host resets to
// this whenever the panel opens.
export const AUTHORING_MODES = Object.freeze(['write', 'paste', 'generate']);

const MODE_LABELS = Object.freeze({
    write: 'Write',
    paste: 'Paste',
    generate: 'Generate',
});

// Build the segmented mode strip. `onSelect(mode)` fires on a segment tap with
// the tapped mode string; the host applies the visual switch (which segment
// reads active is applied by the host too, via setAuthoringModeStripActive, so
// the strip stays a pure builder and the active state can be re-derived on a
// live repaint). Each segment stops click propagation so tapping the strip never
// bubbles to the row's activate/one-click-edit handler.
export function buildAuthoringModeStrip(onSelect) {
    const strip = document.createElement('div');
    strip.className = 'descModeStrip';
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', 'Entry authoring mode');

    AUTHORING_MODES.forEach(function(mode) {
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'descModeStripSeg';
        seg.setAttribute('data-mode', mode);
        seg.setAttribute('role', 'tab');
        seg.setAttribute('aria-selected', 'false');
        seg.textContent = MODE_LABELS[mode];
        seg.addEventListener('click', function(event) {
            event.stopPropagation();
            if (typeof onSelect === 'function') onSelect(mode);
        });
        strip.appendChild(seg);
    });

    return strip;
}

// Reflect the active mode on a strip's segments (active class + aria-selected).
// Split out from the builder so a host can re-assert the active segment on a
// live repaint without rebuilding the strip. No-op when the strip is absent.
export function setAuthoringModeStripActive(strip, mode) {
    if (!strip) return;
    strip.querySelectorAll('.descModeStripSeg').forEach(function(seg) {
        const on = seg.getAttribute('data-mode') === mode;
        seg.classList.toggle('is-active', on);
        seg.setAttribute('aria-selected', on ? 'true' : 'false');
    });
}
