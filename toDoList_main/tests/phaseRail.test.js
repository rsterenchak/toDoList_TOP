import { describe, it, expect } from 'vitest';

// The read-only pipeline phase rail was extracted from the mobile
// description-editor modal into a shared DOM builder (phaseRail.js) so the modal
// and the desktop #descSibling description panel render ONE rail from one
// implementation. Unlike the modal's source-inspection pins, this exercises the
// builder end-to-end in jsdom — building real nodes and asserting their marking.

import { buildPhaseRail, paintPhaseRail } from '../src/phaseRail.js';
import { PHASE, PHASE_RAIL_ORDER, PHASE_RAIL_LABELS } from '../src/phase.js';

describe('phaseRail — structure', () => {
    it('builds a display-only rail: role="img", four labelled nodes, no controls', () => {
        const rail = buildPhaseRail(PHASE.DRAFT);
        expect(rail.classList.contains('phaseRail')).toBe(true);
        expect(rail.getAttribute('role')).toBe('img');

        const nodes = rail.querySelectorAll('.phaseRailNode');
        expect(nodes).toHaveLength(PHASE_RAIL_ORDER.length);
        // The labels read left → right in pipeline order (IDEA · DRAFT · …).
        const captions = [...rail.querySelectorAll('.phaseRailCaption')].map((c) => c.textContent);
        expect(captions).toEqual(PHASE_RAIL_ORDER.map((p) => PHASE_RAIL_LABELS[p]));

        // Inert: never a button, no tabindex, no interactive role on the nodes.
        expect(rail.querySelector('button')).toBeNull();
        nodes.forEach((n) => {
            expect(n.tagName.toLowerCase()).toBe('span');
            expect(n.hasAttribute('tabindex')).toBe(false);
            expect(n.hasAttribute('role')).toBe(false);
        });
        // One fewer connector than nodes, all aria-hidden decoration.
        const connectors = rail.querySelectorAll('.phaseRailConnector');
        expect(connectors).toHaveLength(PHASE_RAIL_ORDER.length - 1);
        connectors.forEach((c) => expect(c.getAttribute('aria-hidden')).toBe('true'));
    });
});

describe('phaseRail — phase marking', () => {
    it('marks nodes before the current phase filled and the current one highlighted', () => {
        // ACCEPT is index 2 of NONE·DRAFT·ACCEPT·DONE.
        const rail = buildPhaseRail(PHASE.ACCEPT);
        const nodes = [...rail.querySelectorAll('.phaseRailNode')];
        const current = PHASE_RAIL_ORDER.indexOf(PHASE.ACCEPT);
        nodes.forEach((node, i) => {
            expect(node.classList.contains('is-filled')).toBe(i < current);
            expect(node.classList.contains('is-current')).toBe(i === current);
        });
        // Connectors up to and including the current node are filled.
        const connectors = [...rail.querySelectorAll('.phaseRailConnector')];
        connectors.forEach((c, idx) => {
            // Connector idx sits before node (idx + 1).
            expect(c.classList.contains('is-filled')).toBe(idx + 1 <= current);
        });
        expect(rail.getAttribute('aria-label')).toBe(
            'Pipeline phase: ' + PHASE_RAIL_LABELS[PHASE.ACCEPT]
        );
    });

    it('resolves a queue-derived phase (asking/stuck/…) to its underlying DRAFT node', () => {
        // ASKING has no rail node — it must render as DRAFT (index 1), never as a
        // fifth node or a missing highlight.
        const rail = buildPhaseRail(PHASE.ASKING);
        const nodes = [...rail.querySelectorAll('.phaseRailNode')];
        const draftIdx = PHASE_RAIL_ORDER.indexOf(PHASE.DRAFT);
        expect(nodes[draftIdx].classList.contains('is-current')).toBe(true);
        expect(nodes.filter((n) => n.classList.contains('is-current'))).toHaveLength(1);
        expect(rail.getAttribute('aria-label')).toBe(
            'Pipeline phase: ' + PHASE_RAIL_LABELS[PHASE.DRAFT]
        );
    });
});

describe('phaseRail — repaint is idempotent', () => {
    it('paintPhaseRail rebuilds in place without stacking nodes across repaints', () => {
        const rail = buildPhaseRail(PHASE.NONE);
        paintPhaseRail(rail, PHASE.DONE);
        paintPhaseRail(rail, PHASE.DONE);
        expect(rail.querySelectorAll('.phaseRailNode')).toHaveLength(PHASE_RAIL_ORDER.length);
        const current = PHASE_RAIL_ORDER.indexOf(PHASE.DONE);
        const nodes = [...rail.querySelectorAll('.phaseRailNode')];
        expect(nodes[current].classList.contains('is-current')).toBe(true);
        // Advancing then rewinding leaves exactly one current node.
        paintPhaseRail(rail, PHASE.NONE);
        const rewound = [...rail.querySelectorAll('.phaseRailNode')];
        expect(rewound.filter((n) => n.classList.contains('is-current'))).toHaveLength(1);
        expect(rewound[0].classList.contains('is-current')).toBe(true);
    });
});
