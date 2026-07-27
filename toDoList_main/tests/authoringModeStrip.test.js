import { describe, it, expect, vi } from 'vitest';

import {
    AUTHORING_MODES,
    buildAuthoringModeStrip,
    setAuthoringModeStripActive,
} from '../src/authoringModeStrip.js';

// The shared WRITE / PASTE / GENERATE mode strip builder. Kept a pure DOM builder
// (no host wiring, ids, or grid placement) so the desktop detail panel and, later,
// the mobile modal can adopt ONE implementation.

describe('authoring mode strip — shared builder', () => {
    it('exposes exactly the three modes in strip order, WRITE first', () => {
        expect(AUTHORING_MODES).toEqual(['write', 'paste', 'generate']);
    });

    it('builds a tablist with one segment per mode, each carrying its data-mode', () => {
        const strip = buildAuthoringModeStrip(() => {});
        expect(strip.classList.contains('descModeStrip')).toBe(true);
        expect(strip.getAttribute('role')).toBe('tablist');
        const segs = [...strip.querySelectorAll('.descModeStripSeg')];
        expect(segs.map((s) => s.getAttribute('data-mode'))).toEqual(['write', 'paste', 'generate']);
        expect(segs.map((s) => s.textContent)).toEqual(['Write', 'Paste', 'Generate']);
    });

    it('fires onSelect with the tapped mode and stops propagation to the row', () => {
        const onSelect = vi.fn();
        const strip = buildAuthoringModeStrip(onSelect);
        const rowClick = vi.fn();
        const host = document.createElement('div');
        host.addEventListener('click', rowClick);
        host.appendChild(strip);

        strip.querySelector('[data-mode="paste"]').dispatchEvent(
            new MouseEvent('click', { bubbles: true })
        );
        expect(onSelect).toHaveBeenCalledWith('paste');
        // Tapping a segment must not bubble to the row's activate/one-click-edit.
        expect(rowClick).not.toHaveBeenCalled();
    });

    it('setAuthoringModeStripActive marks exactly the active segment', () => {
        const strip = buildAuthoringModeStrip(() => {});
        setAuthoringModeStripActive(strip, 'generate');
        const active = [...strip.querySelectorAll('.descModeStripSeg')]
            .filter((s) => s.classList.contains('is-active'));
        expect(active).toHaveLength(1);
        expect(active[0].getAttribute('data-mode')).toBe('generate');
        expect(active[0].getAttribute('aria-selected')).toBe('true');
        // Switching moves the marker rather than accumulating it.
        setAuthoringModeStripActive(strip, 'write');
        const active2 = [...strip.querySelectorAll('.descModeStripSeg')]
            .filter((s) => s.classList.contains('is-active'));
        expect(active2).toHaveLength(1);
        expect(active2[0].getAttribute('data-mode')).toBe('write');
    });

    it('setAuthoringModeStripActive is a no-op guard on a null strip', () => {
        expect(() => setAuthoringModeStripActive(null, 'write')).not.toThrow();
    });
});
