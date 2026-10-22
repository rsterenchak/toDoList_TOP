// The full-screen mobile sheet a code viewer opens in below 1024px — one builder
// shared by every view that hosts the viewer, so the Structure tab and the
// Understanding reader dismiss, size and reveal their sheets identically.
//
// The code viewer takes its host as an argument, so giving it a mobile home is a
// matter of mounting a second container rather than teaching the viewer about
// breakpoints: desktop keeps its column, and below 1024px the same pane fills a
// full-screen sheet over the tab.
//
// The sheet is built once and left in the document, hidden, so the pane it hosts
// (and the viewer state pointing at it) survives a close. That is what lets a
// close return to the surface behind it with its selection intact: dismissing the
// sheet doesn't clear the viewer, it only stops showing it.

import { clearCodeViewer } from './codeViewer.js';

// `opts`:
//   • id        — the sheet's element id (`structureCodeSheet`, …).
//   • label     — the dialog's aria-label.
//   • isDesktop — the breakpoint test; the sheet is never revealed while it holds.
// Returns `{ ensure, host, hide, reset, sync, isOpen }`.
export function createCodeSheet(opts) {
    const o = opts || {};
    const isDesktop = typeof o.isDesktop === 'function' ? o.isDesktop : function () { return false; };
    let sheetEl = null;
    let sheetHost = null;

    // The viewer host inside the sheet, building the sheet on first use.
    function ensure() {
        // Rebuild when the node has been detached (a test harness resetting the
        // body); the closure guards below make the extra key listener a no-op.
        if (sheetEl && sheetEl.parentNode) return sheetHost;
        if (typeof document === 'undefined' || !document.body) return null;

        const backdrop = document.createElement('div');
        backdrop.id = o.id || '';
        backdrop.className = 'structureCodeSheet';
        backdrop.hidden = true;

        const panel = document.createElement('div');
        panel.className = 'structureCodeSheetPanel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', o.label || 'File source');

        const host = document.createElement('div');
        host.className = 'structureCodeSheetHost';
        panel.appendChild(host);
        backdrop.appendChild(panel);

        // Close affordances: the pane's own ✕ (claimed through the close handler
        // the owning view registers), the backdrop, and Escape.
        backdrop.addEventListener('click', function (event) {
            if (event.target === backdrop) hide();
        });
        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            if (!sheetEl || sheetEl.hidden) return;
            event.preventDefault();
            event.stopPropagation();
            hide();
        }, true);

        document.body.appendChild(backdrop);
        sheetEl = backdrop;
        sheetHost = host;
        return host;
    }

    function hide() {
        if (sheetEl) sheetEl.hidden = true;
    }

    // Dismiss the sheet AND drop what it was showing — for when the file is no
    // longer addressable from the surface behind it, as opposed to a plain close.
    function reset() {
        // Skip a detached sheet: clearing it would rebuild the viewer's shell inside
        // an element nothing can see.
        if (sheetHost && sheetEl && sheetEl.parentNode) clearCodeViewer(sheetHost);
        hide();
    }

    // Reveal or hide the sheet from what its host is actually showing, so every
    // opener reveals it just by rendering into the host. Desktop is gated here
    // rather than in CSS, so a full-screen overlay never lands on a wide layout.
    function sync() {
        if (!sheetEl || !sheetHost) return;
        const pane = sheetHost.querySelector(':scope > .codeViewerPane');
        if (pane && !pane.hidden && !isDesktop()) sheetEl.hidden = false;
        else hide();
    }

    return {
        ensure: ensure,
        host: function () { return sheetHost; },
        hide: hide,
        reset: reset,
        sync: sync,
        isOpen: function () { return !!sheetEl && !sheetEl.hidden; },
    };
}
