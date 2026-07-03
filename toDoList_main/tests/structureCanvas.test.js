import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

import {
    SELF_REPO,
    captureSnapshot,
    getSnapshotInfo,
    isGhostSelector,
    renderStructureCanvas,
    resetCanvasState,
    revealSelector,
    applyCanvasFilter,
    markGhostRows,
    setLocateTabSwitch,
    snapshotMetaFor,
    canLocate,
    locateHandle,
} from '../src/structureCanvas.js';

// The block canvas measures block proportions from a live-DOM snapshot; jsdom's
// getBoundingClientRect returns zeros, so we stub it per element to give handles
// real sizes (and thus mark them visible / not-ghost).
function stubRect(el, w, h, x, y) {
    el.getBoundingClientRect = function () {
        return { left: x || 0, top: y || 0, width: w, height: h, right: (x || 0) + w, bottom: (y || 0) + h };
    };
}

// A sample DOM whose ids match the handle tree below. #gone is intentionally
// absent (unresolvable → ghost); #bottomSheet is an overlay id (always ghost).
function mountDom() {
    document.body.innerHTML =
        '<div id="appHeader"></div>' +
        '<div id="main">' +
        '  <div id="list"><div id="row"></div></div>' +
        '  <div id="aside"></div>' +
        '</div>' +
        '<div id="bottomSheet"></div>';
    stubRect(document.getElementById('appHeader'), 200, 60, 0, 0);
    stubRect(document.getElementById('main'), 300, 400, 0, 60);
    stubRect(document.getElementById('list'), 200, 300, 0, 60);
    stubRect(document.getElementById('row'), 200, 40, 0, 60);
    stubRect(document.getElementById('aside'), 100, 300, 200, 60);
    stubRect(document.getElementById('bottomSheet'), 300, 200, 0, 0);
}

// Handle tree in the structureView/buildUiTree node shape.
function sampleTree() {
    return [
        { type: 'region', label: 'App Header', selector: '#appHeader', visible: true, children: [] },
        {
            type: 'region', label: 'Main', selector: '#main', visible: true, children: [
                {
                    type: 'region', label: 'List', selector: '#list', visible: true, children: [
                        { type: 'region', label: 'Row', selector: '#row', visible: true, children: [] },
                    ],
                },
                { type: 'region', label: 'Aside', selector: '#aside', visible: true, children: [] },
            ],
        },
        { type: 'region', label: 'Overlay', selector: '#bottomSheet', visible: true, children: [] },
        { type: 'region', label: 'Gone', selector: '#gone', visible: true, children: [] },
    ];
}

function mountHost() {
    const host = document.createElement('div');
    host.className = 'structureTree';
    document.body.appendChild(host);
    return host;
}

function render(host, overrides) {
    return renderStructureCanvas(host, Object.assign({
        repo: SELF_REPO,
        tree: sampleTree(),
        onSelect: vi.fn(),
        onReference: vi.fn(),
        onViewCode: vi.fn(),
    }, overrides));
}

beforeEach(() => {
    resetCanvasState();
    mountDom();
    captureSnapshot(sampleTree());
});

describe('structureCanvas — snapshot + ghosts', () => {
    it('captures a rect per resolvable handle and stamps a time', () => {
        const info = getSnapshotInfo();
        // #appHeader, #main, #list, #row, #aside, #bottomSheet, #gone (as ghost).
        expect(info.size).toBe(7);
        expect(info.at instanceof Date).toBe(true);
    });

    it('marks overlay ids, unresolvable, and zero-size handles as ghosts', () => {
        expect(isGhostSelector('#appHeader')).toBe(false);
        expect(isGhostSelector('#main')).toBe(false);
        expect(isGhostSelector('#bottomSheet')).toBe(true); // overlay id
        expect(isGhostSelector('#gone')).toBe(true);        // never resolved
    });

    it('a partial re-measure keeps prior rects for handles that no longer resolve', () => {
        document.getElementById('appHeader').remove();
        captureSnapshot(sampleTree(), { partial: true });
        // The removed handle keeps its prior (non-ghost) measurement.
        expect(isGhostSelector('#appHeader')).toBe(false);
    });
});

describe('structureCanvas — render + repo gating', () => {
    it('renders nothing for a non-self repo', () => {
        const host = mountHost();
        const pane = render(host, { repo: 'rsterenchak/matchingGame-test' });
        expect(pane).toBe(null);
        expect(host.querySelector('.structureCanvasPane')).toBe(null);
    });

    it('renders the snapshot chip, breadcrumb, and one block per non-ghost child', () => {
        const host = mountHost();
        render(host);
        expect(host.querySelector('.structureCanvasSnapChip')).toBeTruthy();
        expect(host.querySelector('.structureCanvasSnapLabel').textContent).toMatch(/captured/);

        const crumbs = Array.from(host.querySelectorAll('.structureCanvasCrumb')).map((c) => c.textContent);
        expect(crumbs).toEqual(['App']);

        // Top-level non-ghost children: #appHeader, #main (bottomSheet + gone are ghosts).
        const blocks = Array.from(host.querySelectorAll('.structureCanvasBlock'));
        expect(blocks.map((b) => b.dataset.selector).sort()).toEqual(['#appHeader', '#main']);
    });

    it('a parent block previews its children and shows a drill chip; a leaf shows neither', () => {
        const host = mountHost();
        render(host);
        const main = host.querySelector('.structureCanvasBlock[data-selector="#main"]');
        const header = host.querySelector('.structureCanvasBlock[data-selector="#appHeader"]');
        expect(main.querySelector('.structureCanvasDrillChip')).toBeTruthy();
        expect(main.querySelectorAll('.structureCanvasMini').length).toBe(2); // #list, #aside
        expect(header.querySelector('.structureCanvasDrillChip')).toBe(null);
    });
});

describe('structureCanvas — true-to-layout positioning', () => {
    // The outer beforeEach captures at jsdom's default viewport (1024 × 768), so
    // the root parent box is { x:0, y:0, width:1024, height:768 }.
    it('positions and sizes each block from its rect as parent-relative percentages', () => {
        const host = mountHost();
        render(host);

        const header = host.querySelector('.structureCanvasBlock[data-selector="#appHeader"]');
        // #appHeader is 200 × 60 at (0, 0) within the 1024 × 768 viewport.
        expect(header.style.left).toBe('0%');
        expect(header.style.top).toBe('0%');
        expect(parseFloat(header.style.width)).toBeCloseTo((200 / 1024) * 100, 4);
        expect(parseFloat(header.style.height)).toBeCloseTo((60 / 768) * 100, 4);

        const main = host.querySelector('.structureCanvasBlock[data-selector="#main"]');
        // #main is 300 × 400 at (0, 60).
        expect(main.style.left).toBe('0%');
        expect(parseFloat(main.style.top)).toBeCloseTo((60 / 768) * 100, 4);
        expect(parseFloat(main.style.width)).toBeCloseTo((300 / 1024) * 100, 4);
        expect(parseFloat(main.style.height)).toBeCloseTo((400 / 768) * 100, 4);
    });

    it('paints blocks largest-first so small overlays land on top', () => {
        const host = mountHost();
        render(host);
        // #main (300 × 400 = 120000) has a larger area than #appHeader (200 × 60 =
        // 12000), so it is appended first and small blocks paint over it.
        const order = Array.from(host.querySelectorAll('.structureCanvasBlock')).map((b) => b.dataset.selector);
        expect(order).toEqual(['#main', '#appHeader']);
    });

    it('flags a block tiny on both axes and leaves larger siblings untouched', () => {
        const host = mountHost();
        // Shrink #aside to a tiny overlay inside #main's box, then re-measure.
        stubRect(document.getElementById('aside'), 20, 20, 10, 70);
        captureSnapshot(sampleTree());
        render(host);
        host.querySelector('.structureCanvasBlock[data-selector="#main"] .structureCanvasDrillChip').click();

        // Inside #main's 300 × 400 box: #aside is 6.7% × 5% → tiny; #list is not.
        const aside = host.querySelector('.structureCanvasBlock[data-selector="#aside"]');
        const list = host.querySelector('.structureCanvasBlock[data-selector="#list"]');
        expect(aside.classList.contains('structureCanvasBlock--tiny')).toBe(true);
        expect(list.classList.contains('structureCanvasBlock--tiny')).toBe(false);
    });
});

describe('structureCanvas — drilling + breadcrumb', () => {
    it('the drill chip descends a level and grows the breadcrumb; a crumb navigates back up', () => {
        const host = mountHost();
        render(host);
        host.querySelector('.structureCanvasBlock[data-selector="#main"] .structureCanvasDrillChip').click();

        let crumbs = Array.from(host.querySelectorAll('.structureCanvasCrumb')).map((c) => c.textContent);
        expect(crumbs).toEqual(['App', 'Main']);
        // Now showing #main's children as blocks.
        const blocks = Array.from(host.querySelectorAll('.structureCanvasBlock')).map((b) => b.dataset.selector).sort();
        expect(blocks).toEqual(['#aside', '#list']);

        // Tap the root "App" crumb to climb back.
        host.querySelectorAll('.structureCanvasCrumb')[0].click();
        crumbs = Array.from(host.querySelectorAll('.structureCanvasCrumb')).map((c) => c.textContent);
        expect(crumbs).toEqual(['App']);
    });
});

describe('structureCanvas — block selection', () => {
    it('selecting a block calls onSelect with a live descriptor', () => {
        const host = mountHost();
        const onSelect = vi.fn();
        render(host, { onSelect });

        host.querySelector('.structureCanvasBlock[data-selector="#main"]').click();

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0]).toMatchObject({ kind: 'live', label: 'Main', value: '#main' });
        // The detail bar is gone — the shared toolbar (structureView) surfaces the
        // dims / visibility / Locate now, so no detail nodes render here.
        expect(host.querySelector('.structureCanvasDetail')).toBe(null);
    });
});

describe('structureCanvas — snapshotMetaFor + canLocate', () => {
    it('returns rounded dims and visible=true for a captured, on-screen handle', () => {
        expect(snapshotMetaFor('#main')).toEqual({ width: 300, height: 400, visible: true });
    });

    it('returns null for a selector that was never captured', () => {
        expect(snapshotMetaFor('#neverCaptured')).toBe(null);
    });

    it('reports a ghost handle as zero-size and not visible (still captured)', () => {
        // #gone never resolves → captured as a rect-less ghost entry.
        expect(snapshotMetaFor('#gone')).toEqual({ width: 0, height: 0, visible: false });
    });

    it('canLocate is true for a live-visible handle, false when absent or zero-size', () => {
        expect(canLocate('#main')).toBe(true);
        expect(canLocate('#gone')).toBe(false); // not in the live DOM
        stubRect(document.getElementById('aside'), 0, 0, 0, 0); // present but 0×0
        expect(canLocate('#aside')).toBe(false);
    });
});

describe('structureCanvas — locateHandle', () => {
    let tabSwitch;
    beforeEach(() => {
        tabSwitch = vi.fn();
        setLocateTabSwitch(tabSwitch);
    });

    it('switches to Tasks View and pulses the live element', () => {
        // Run the queued frame synchronously so the pulse lands within the test.
        const raf = global.requestAnimationFrame;
        global.requestAnimationFrame = (cb) => { cb(); return 0; };

        locateHandle('#main');

        global.requestAnimationFrame = raf;
        expect(tabSwitch).toHaveBeenCalledTimes(1);
        expect(document.getElementById('main').classList.contains('locate-pulse')).toBe(true);
    });

    it('is a no-op when the handle has no on-screen box in the live DOM', () => {
        stubRect(document.getElementById('aside'), 0, 0, 0, 0);
        locateHandle('#aside');
        expect(tabSwitch).not.toHaveBeenCalled();
    });
});

describe('structureCanvas — filter + two-way sync', () => {
    it('applyCanvasFilter dims non-matching blocks and clears on empty query', () => {
        const host = mountHost();
        render(host);
        applyCanvasFilter('main');
        const header = host.querySelector('.structureCanvasBlock[data-selector="#appHeader"]');
        const main = host.querySelector('.structureCanvasBlock[data-selector="#main"]');
        expect(header.classList.contains('structureCanvasBlock--dim')).toBe(true);
        expect(main.classList.contains('structureCanvasBlock--dim')).toBe(false);

        applyCanvasFilter('');
        expect(header.classList.contains('structureCanvasBlock--dim')).toBe(false);
    });

    it('revealSelector drills to the handle’s parent and selects it', () => {
        const host = mountHost();
        render(host);
        // #row lives under #main → #list; revealing it should drill two levels.
        revealSelector('#row');
        const crumbs = Array.from(host.querySelectorAll('.structureCanvasCrumb')).map((c) => c.textContent);
        expect(crumbs).toEqual(['App', 'Main', 'List']);
        expect(host.querySelector('.structureCanvasBlock[data-selector="#row"]').classList.contains('is-selected')).toBe(true);
    });
});

describe('structureCanvas — per-viewport buckets + toggle', () => {
    const MOBILE_KEY = 'todoapp_structureSnapshot_mobile';
    const DESKTOP_KEY = 'todoapp_structureSnapshot_desktop';

    function setViewport(w, h) {
        Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: h || 800, configurable: true });
    }

    // A fresh module instance (hydrated: false, empty buckets) so each test fully
    // controls localStorage → in-memory hydration and viewport-bucket state.
    async function makeCanvas() {
        vi.resetModules();
        return await import('../src/structureCanvas.js');
    }

    function renderWith(m, host, overrides) {
        return m.renderStructureCanvas(host, Object.assign({
            repo: m.SELF_REPO,
            tree: sampleTree(),
            onSelect: vi.fn(),
            onReference: vi.fn(),
            onViewCode: vi.fn(),
        }, overrides));
    }

    beforeEach(() => {
        localStorage.clear();
        setViewport(1024, 800);
        mountDom();
    });

    afterEach(() => {
        setViewport(1024, 800);
    });

    it('captures into the bucket for the current live viewport and persists it', async () => {
        const m = await makeCanvas();
        setViewport(500, 900);
        m.captureSnapshot(sampleTree());

        // Wrote only the mobile bucket; the desktop bucket is untouched.
        expect(localStorage.getItem(MOBILE_KEY)).toBeTruthy();
        expect(localStorage.getItem(DESKTOP_KEY)).toBe(null);

        const parsed = JSON.parse(localStorage.getItem(MOBILE_KEY));
        expect(parsed.viewport).toEqual({ w: 500, h: 900 });
        expect(parsed.handles['#main']).toBeTruthy();
        expect(parsed.handles['#main'].visible).toBe(true);
    });

    it('renders a Mobile/Desktop toggle; the uncaptured segment is disabled with a helper line', async () => {
        const m = await makeCanvas();
        setViewport(1024, 800);
        m.captureSnapshot(sampleTree()); // desktop bucket only

        const host = mountHost();
        renderWith(m, host);

        const segs = host.querySelectorAll('.structureCanvasViewSeg');
        expect(segs.length).toBe(2);
        const desktop = host.querySelector('.structureCanvasViewSeg[data-bucket="desktop"]');
        const mobile = host.querySelector('.structureCanvasViewSeg[data-bucket="mobile"]');
        expect(desktop.classList.contains('is-active')).toBe(true);
        expect(mobile.disabled).toBe(true);
        expect(mobile.classList.contains('is-disabled')).toBe(true);

        const hint = host.querySelector('.structureCanvasViewHint');
        expect(hint).toBeTruthy();
        expect(hint.textContent).toMatch(/mobile/i);
    });

    it('switching the toggle renders from the other bucket, flipping ghosts', async () => {
        const m = await makeCanvas();
        // Desktop capture: #aside visible.
        setViewport(1024, 800);
        mountDom();
        m.captureSnapshot(sampleTree());
        // Mobile capture: #aside collapsed to zero size → a ghost in that bucket.
        setViewport(500, 900);
        stubRect(document.getElementById('aside'), 0, 0, 0, 0);
        m.captureSnapshot(sampleTree());

        const host = mountHost();
        renderWith(m, host);

        // Default tracks the live (mobile) viewport: #aside reads as a ghost.
        expect(m.isGhostSelector('#aside')).toBe(true);
        expect(host.querySelector('.structureCanvasViewSeg[data-bucket="mobile"]').classList.contains('is-active')).toBe(true);

        // Toggle to desktop: the same handle un-ghosts from the desktop bucket.
        host.querySelector('.structureCanvasViewSeg[data-bucket="desktop"]').click();
        expect(m.isGhostSelector('#aside')).toBe(false);
        expect(host.querySelector('.structureCanvasViewSeg[data-bucket="desktop"]').classList.contains('is-active')).toBe(true);
    });

    it('fits the canvas to the selected bucket viewport aspect ratio', async () => {
        const m = await makeCanvas();
        setViewport(1440, 900);
        m.captureSnapshot(sampleTree());

        const host = mountHost();
        renderWith(m, host);

        const canvas = host.querySelector('.structureCanvasBlocks');
        expect(canvas.style.aspectRatio).toBe('1440 / 900');
    });

    it('caps a tall drilled level via the height clamp while keeping the true ratio; a wide root stays full-width', async () => {
        const m = await makeCanvas();
        setViewport(1440, 900);
        // #main is a tall, narrow column so drilling into it yields a tall parent box.
        stubRect(document.getElementById('main'), 300, 4000, 0, 60);
        stubRect(document.getElementById('list'), 300, 3000, 0, 60);
        stubRect(document.getElementById('aside'), 300, 800, 0, 60);
        m.captureSnapshot(sampleTree());

        const host = mountHost();
        renderWith(m, host);

        // Root level takes the wide 1440x900 viewport: plain aspect-ratio, and its
        // ratio var is < 1 so the clamped height resolves to the full-width term.
        const root = host.querySelector('.structureCanvasBlocks');
        expect(root.style.aspectRatio).toBe('1440 / 900');
        expect(root.style.getPropertyValue('--structure-canvas-ratio')).toBe(String(900 / 1440));

        // Drill into the tall #main (reveal a child so the drill path becomes #main):
        // the canvas keeps #main's true 300x4000 ratio, and the ratio var it feeds the
        // CSS height clamp reflects that tall box (4000/300), so a 300x4000 column
        // renders capped, not several screens tall.
        m.revealSelector('#list');
        const drilled = host.querySelector('.structureCanvasBlocks');
        expect(drilled.style.aspectRatio).toBe('300 / 4000');
        expect(drilled.style.getPropertyValue('--structure-canvas-ratio')).toBe(String(4000 / 300));
    });

    it('wires the height clamp (min(60vh, 680px)) to the ratio var in style.css', () => {
        const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');
        const block = css.match(/\.structureCanvasBlocks\s*\{[^}]*\}/);
        expect(block).toBeTruthy();
        const rule = block[0];
        // The cap is driven off the inline ratio var and clamped to min(60vh, 680px).
        expect(rule).toMatch(/height:\s*min\(\s*calc\(\s*100cqw\s*\*\s*var\(--structure-canvas-ratio/);
        expect(rule).toContain('60vh');
        expect(rule).toContain('680px');
        // Width derives back from the definite height + aspect-ratio, centered.
        expect(rule).toMatch(/width:\s*auto/);
        // The width is bounded to the pane so a floor-engaged wide/short level can
        // never derive an over-wide canvas that pushes right-side blocks off-pane.
        expect(rule).toContain('min-height');
        expect(rule).toMatch(/max-width:\s*100%/);
        // The pane is an inline-size container so 100cqw resolves to the pane width.
        expect(css).toMatch(/\.structureCanvasPane\s*\{[^}]*container-type:\s*inline-size/);
    });

    it('stacks the drill chip above the block head and enlarges its hit area', () => {
        const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');
        // The chip needs a z-index so it always wins the stacking contest against
        // the full-width block head (z-index: 1) that would otherwise steal taps.
        const chip = css.match(/\.structureCanvasDrillChip\s*\{[^}]*\}/);
        expect(chip).toBeTruthy();
        expect(chip[0]).toMatch(/z-index:\s*2/);
        // A ::after pseudo-element extends the tap target past the 26px visual.
        // jsdom does no hit-testing, so assert the rule text is present.
        const after = css.match(/\.structureCanvasDrillChip::after\s*\{[^}]*\}/);
        expect(after).toBeTruthy();
        expect(after[0]).toMatch(/content:\s*''/);
        expect(after[0]).toMatch(/position:\s*absolute/);
        expect(after[0]).toMatch(/inset:\s*-6px/);
    });

    it('keeps a right-positioned child at its true normalized left/width in a wide-short level', async () => {
        const m = await makeCanvas();
        setViewport(1440, 900);
        // #main is a wide, short strip (1400 × 48). #aside sits at the right edge of
        // that strip; #list fills the left. Drilling into #main must place #aside at
        // its true normalized left/width — the max-width: 100% fix ensures the strip
        // canvas never over-widens and pushes the right block off-pane.
        stubRect(document.getElementById('main'), 1400, 48, 0, 60);
        stubRect(document.getElementById('list'), 200, 15, 0, 60);
        stubRect(document.getElementById('aside'), 136, 15, 1264, 60);
        m.captureSnapshot(sampleTree());

        const host = mountHost();
        renderWith(m, host);

        // Drill into #main by revealing one of its children.
        m.revealSelector('#list');

        const aside = host.querySelector('.structureCanvasBlock[data-selector="#aside"]');
        // #aside at x=1264, w=136 within #main's { x:0, w:1400 } box: left = 1264/1400,
        // width = 136/1400 — the right edge lands at ~100%, on-pane, not off-screen.
        expect(parseFloat(aside.style.left)).toBeCloseTo((1264 / 1400) * 100, 4);
        expect(parseFloat(aside.style.width)).toBeCloseTo((136 / 1400) * 100, 4);
    });

    it('renders the empty state and a helper when no bucket is captured', async () => {
        const m = await makeCanvas();
        const host = mountHost();
        renderWith(m, host);

        expect(host.querySelector('.structureCanvasEmpty')).toBeTruthy();
        expect(host.querySelectorAll('.structureCanvasBlock').length).toBe(0);
        expect(host.querySelector('.structureCanvasViewHint')).toBeTruthy();
        // Both buckets empty → both segments disabled.
        expect(host.querySelectorAll('.structureCanvasViewSeg.is-disabled').length).toBe(2);
    });

    it('rehydrates a persisted bucket on a fresh load and renders it without a live capture', async () => {
        // Seed a desktop bucket as if it were captured earlier on another device.
        const payload = {
            capturedAt: '2026-06-30T12:00:00.000Z',
            viewport: { w: 1440, h: 900 },
            handles: {
                '#appHeader': { rect: { x: 0, y: 0, width: 200, height: 60 }, visible: true },
                '#main': { rect: { x: 0, y: 60, width: 1440, height: 800 }, visible: true },
            },
        };
        localStorage.setItem(DESKTOP_KEY, JSON.stringify(payload));

        // Fresh load on a mobile viewport with no desktop layout to measure live.
        setViewport(500, 900);
        const m = await makeCanvas();

        const host = mountHost();
        renderWith(m, host);

        // Mobile bucket empty → falls back to the populated desktop bucket, whose
        // persisted rects mark #main visible.
        expect(m.isGhostSelector('#main')).toBe(false);
        expect(host.querySelector('.structureCanvasViewSeg[data-bucket="desktop"]').classList.contains('is-active')).toBe(true);
        expect(host.querySelector('.structureCanvasViewSeg[data-bucket="mobile"]').disabled).toBe(true);
    });

    it('discards a corrupt persisted bucket instead of rendering from it', async () => {
        localStorage.setItem(DESKTOP_KEY, '{not valid json');
        setViewport(1024, 800);
        const m = await makeCanvas();
        // Touching the buckets triggers hydration, which drops the corrupt entry.
        expect(m.getSnapshotInfo().size).toBe(0);
        expect(localStorage.getItem(DESKTOP_KEY)).toBe(null);
    });
});

describe('structureCanvas — ghost tray', () => {
    it('classifies #claudeSheet as a ghost via the overlay list', () => {
        expect(isGhostSelector('#claudeSheet')).toBe(true);
    });

    it('lists ghost children as labeled chips at the current level, and none when the level has no ghosts', () => {
        const host = mountHost();
        render(host);
        // Root-level ghosts: #bottomSheet (overlay id) and #gone (unresolvable).
        const tray = host.querySelector('.structureCanvasGhostTray');
        expect(tray).toBeTruthy();
        const chips = Array.from(host.querySelectorAll('.structureCanvasGhostChip'));
        expect(chips.map((c) => c.dataset.selector).sort()).toEqual(['#bottomSheet', '#gone']);
        const labels = Array.from(host.querySelectorAll('.structureCanvasGhostName')).map((n) => n.textContent).sort();
        expect(labels).toEqual(['Gone', 'Overlay']);

        // Drill into #main — its children (#list, #aside) are all measurable, so no tray.
        host.querySelector('.structureCanvasBlock[data-selector="#main"] .structureCanvasDrillChip').click();
        expect(host.querySelector('.structureCanvasGhostTray')).toBe(null);
    });

    it('a chip tap fires the same onSelect mirroring as a block tap', () => {
        const host = mountHost();
        const onSelect = vi.fn();
        render(host, { onSelect });
        host.querySelector('.structureCanvasGhostChip[data-selector="#bottomSheet"]').click();
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0]).toMatchObject({
            kind: 'live', label: 'Overlay', value: '#bottomSheet', visible: false,
        });
    });

    it('a ghost with region children exposes a drill chip', () => {
        const host = mountHost();
        const tree = [
            {
                type: 'region', label: 'Sheet', selector: '#claudeSheet', visible: true, children: [
                    { type: 'region', label: 'Sheet Inner', selector: '#sheetInner', visible: true, children: [] },
                ],
            },
        ];
        render(host, { tree });
        const chip = host.querySelector('.structureCanvasGhostChip[data-selector="#claudeSheet"]');
        expect(chip).toBeTruthy();
        expect(chip.querySelector('.structureCanvasDrillChip')).toBeTruthy();
    });
});

describe('structureCanvas — markGhostRows', () => {
    it('flags live tree rows whose handle is a ghost', () => {
        const treeEl = document.createElement('div');
        treeEl.innerHTML =
            '<div class="structureRegionRow" data-handle-kind="live" data-handle-value="#main"></div>' +
            '<div class="structureRegionRow" data-handle-kind="live" data-handle-value="#bottomSheet"></div>' +
            '<div class="structureRegionRow" data-handle-kind="published" data-handle-value="#main"></div>';
        document.body.appendChild(treeEl);
        markGhostRows(treeEl);
        const rows = treeEl.querySelectorAll('.structureRegionRow');
        expect(rows[0].classList.contains('structureRegionRow--ghost')).toBe(false); // #main visible
        expect(rows[1].classList.contains('structureRegionRow--ghost')).toBe(true);  // overlay
        expect(rows[2].classList.contains('structureRegionRow--ghost')).toBe(false); // not a live row
    });
});
