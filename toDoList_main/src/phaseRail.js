// Shared builder for the read-only pipeline phase rail — the four-node
// IDEA · DRAFT · REVIEW · DONE instrument that leads both the mobile
// description-editor modal and the desktop `#descSibling` description panel.
//
// The rail was originally inlined in `modals.js`'s `renderRail`. It is extracted
// here so the two hosts render ONE rail from one implementation rather than two
// copies that could drift — the same extraction the file picker (`filePicker.js`)
// needed. This module is DOM-only: it takes an already-derived phase and returns
// (or repaints) the rail element. Phase derivation stays in `phase.js` /
// `derivePhase`; this file never reaches for the queue or the marker cache.
//
// The node classes are host-neutral (`phaseRail*`), not the modal-scoped names
// they carried before, since both hosts now share them. Host-specific chrome
// (the modal's side padding, the panel's grid placement) is layered on by each
// host's own selector, not baked in here.

import { PHASE, PHASE_RAIL_ORDER, PHASE_RAIL_LABELS } from './phase.js';

// Repaint an existing rail element for a (possibly changed) derived phase.
// Idempotent — clears and rebuilds the nodes, so callers use it on every live
// phase change while a rail is mounted. A queue-derived phase (`asking`,
// `drafted`, `stuck`, `mockup`) is not a rail node; resolve it to its underlying
// DRAFT stage so the rail never has to invent a fifth node.
export function paintPhaseRail(rail, phase) {
    const railPhase = PHASE_RAIL_ORDER.indexOf(phase) === -1 ? PHASE.DRAFT : phase;
    const currentIndex = PHASE_RAIL_ORDER.indexOf(railPhase);
    rail.innerHTML = '';
    PHASE_RAIL_ORDER.forEach(function(p, i) {
        // Connector rule linking the previous node to this one. It paints in
        // accent when it leads into a passed-or-current node (i <= current), so
        // the accent "progress" fills the rail up to the current dot. Purely
        // decorative — aria-hidden, no chrome, no listener.
        if (i > 0) {
            const connector = document.createElement('span');
            connector.className = 'phaseRailConnector'
                + (i <= currentIndex ? ' is-filled' : '');
            connector.setAttribute('aria-hidden', 'true');
            rail.appendChild(connector);
        }
        // Each node is an inert column — a dot above an uppercase caption. Plain
        // spans, never a button: no role, tabindex, or listener, so the rail
        // cannot be focused, hovered, or pressed. Phase is derived, so there is
        // nothing a tap could mean.
        const node = document.createElement('span');
        node.className = 'phaseRailNode'
            + (i < currentIndex ? ' is-filled' : '')
            + (i === currentIndex ? ' is-current' : '');
        node.setAttribute('data-phase', p);
        const dot = document.createElement('span');
        dot.className = 'phaseRailDot';
        dot.setAttribute('aria-hidden', 'true');
        const caption = document.createElement('span');
        caption.className = 'phaseRailCaption';
        caption.textContent = PHASE_RAIL_LABELS[p];
        node.appendChild(dot);
        node.appendChild(caption);
        rail.appendChild(node);
    });
    rail.setAttribute('aria-label', 'Pipeline phase: ' + PHASE_RAIL_LABELS[railPhase]);
}

// Build a fresh rail element for a derived phase and return it. The container
// carries the host-neutral `phaseRail` class and `role="img"` (it is a single
// display-only graphic, not a set of controls); a host may add its own id/class
// for placement afterwards.
export function buildPhaseRail(phase) {
    const rail = document.createElement('div');
    rail.className = 'phaseRail';
    rail.setAttribute('role', 'img');
    paintPhaseRail(rail, phase);
    return rail;
}
