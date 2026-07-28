import { describe, it, expect, vi } from 'vitest';

// The A/B/C mockup renderer is shared by two hosts: the Agent board (stacked,
// full-width, unscaled tiles) and the desktop detail pane (three variants across,
// each scaled to fit a narrow tile). These tests pin the renderer options that let
// one implementation serve both — `scaled` (wrap each frame in a clipping scaler)
// and `onRender` (host height re-snapshot hook) — and prove the board's default
// call is unchanged.
//
// mockupFlow imports inject.js; stub it so the named imports resolve without a
// network. listLogic is imported transitively but not exercised here.
vi.mock('../src/inject.js', () => ({
    findTargetById: () => null,
    chatWithWorker: () => Promise.resolve({ reply: '' }),
    showInjectToast: () => {},
}));

import { renderMockupPreviews, buildMockupSecondary } from '../src/mockupFlow.js';

const VARIANTS = { A: '<p>Alpha</p>', B: '<p>Bravo</p>', C: '<p>Charlie</p>' };

describe('mockupFlow — shared renderer, board (default) path', () => {
    it('renders three tiles with each frame mounted BARE in its tile (no scaler)', () => {
        const c = document.createElement('div');
        renderMockupPreviews(c, VARIANTS, null);
        expect(c.querySelectorAll('.agentMockupTile')).toHaveLength(3);
        expect(c.querySelectorAll('.agentMockupFrameScaler')).toHaveLength(0);
        const frame = c.querySelector('.agentMockupFrame');
        expect(frame.parentElement.classList.contains('agentMockupTile')).toBe(true);
    });

    it('buildMockupSecondary without options omits the three-across grid class', () => {
        const wrap = buildMockupSecondary({ id: 'r-board', context: {} });
        expect(wrap.classList.contains('agentMockup')).toBe(true);
        expect(wrap.classList.contains('agentMockup--grid')).toBe(false);
    });
});

describe('mockupFlow — shared renderer, detail-pane (scaled/grid) path', () => {
    it('scaled: wraps every frame in a clipping .agentMockupFrameScaler', () => {
        const c = document.createElement('div');
        renderMockupPreviews(c, VARIANTS, null, { scaled: true });
        expect(c.querySelectorAll('.agentMockupFrameScaler')).toHaveLength(3);
        const frame = c.querySelector('.agentMockupFrame');
        // The frame now lives inside the scaler, not directly in the tile.
        expect(frame.parentElement.classList.contains('agentMockupFrameScaler')).toBe(true);
        expect(frame.parentElement.parentElement.classList.contains('agentMockupTile')).toBe(true);
    });

    it('buildMockupSecondary({ grid: true }) adds the three-across grid class', () => {
        const wrap = buildMockupSecondary({ id: 'r-pane', context: {} }, { grid: true });
        expect(wrap.classList.contains('agentMockup--grid')).toBe(true);
    });

    it('onRender fires once, AFTER the tiles mount, with the container', () => {
        const c = document.createElement('div');
        const seen = [];
        renderMockupPreviews(c, VARIANTS, null, {
            onRender: (el) => seen.push({ el, tiles: el.querySelectorAll('.agentMockupTile').length }),
        });
        expect(seen).toHaveLength(1);
        expect(seen[0].el).toBe(c);
        expect(seen[0].tiles).toBe(3);
    });

    it('onRender fires even for an empty render, so a host can clear its height', () => {
        const c = document.createElement('div');
        let calls = 0;
        renderMockupPreviews(c, {}, null, { onRender: () => { calls += 1; } });
        expect(calls).toBe(1);
        expect(c.querySelectorAll('.agentMockupTile')).toHaveLength(0);
    });

    it('is safe when ResizeObserver is unavailable (no throw, tiles still render)', () => {
        const c = document.createElement('div');
        const had = 'ResizeObserver' in globalThis;
        const saved = globalThis.ResizeObserver;
        // eslint-disable-next-line no-undef
        delete globalThis.ResizeObserver;
        try {
            expect(() => renderMockupPreviews(c, VARIANTS, null, { scaled: true })).not.toThrow();
            expect(c.querySelectorAll('.agentMockupFrameScaler')).toHaveLength(3);
        } finally {
            if (had) globalThis.ResizeObserver = saved;
        }
    });
});
