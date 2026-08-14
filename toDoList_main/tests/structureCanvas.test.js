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
    exitLiveView,
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
    // Snapshots are now keyed per repo; the self repo's buckets live under these keys.
    const MOBILE_KEY = 'todoapp_structureSnapshot_' + encodeURIComponent(SELF_REPO) + '_mobile';
    const DESKTOP_KEY = 'todoapp_structureSnapshot_' + encodeURIComponent(SELF_REPO) + '_desktop';

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

describe('structureCanvas — per-repo store, migration, guest guard', () => {
    const GUEST = 'rsterenchak/matchingGame-test';
    const LEGACY_MOBILE = 'todoapp_structureSnapshot_mobile';
    const LEGACY_DESKTOP = 'todoapp_structureSnapshot_desktop';
    const selfKey = (bucket) => 'todoapp_structureSnapshot_' + encodeURIComponent(SELF_REPO) + '_' + bucket;
    const repoKey = (repo, bucket) => 'todoapp_structureSnapshot_' + encodeURIComponent(repo) + '_' + bucket;
    const treeKey = (repo) => 'todoapp_structureTree_' + encodeURIComponent(repo);

    function setViewport(w, h) {
        Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: h || 800, configurable: true });
    }
    async function makeCanvas() {
        vi.resetModules();
        return await import('../src/structureCanvas.js');
    }
    function bucketPayload(handles) {
        return { capturedAt: '2026-06-30T12:00:00.000Z', viewport: { w: 1440, h: 900 }, handles: handles };
    }

    beforeEach(() => {
        localStorage.clear();
        setViewport(1440, 900);
        mountDom();
    });
    afterEach(() => {
        setViewport(1024, 800);
    });

    it('migrates the legacy single-pair keys into the self repo entry once, then removes them', async () => {
        localStorage.setItem(LEGACY_DESKTOP, JSON.stringify(bucketPayload({
            '#main': { rect: { x: 0, y: 60, width: 1440, height: 800 }, visible: true },
        })));
        const m = await makeCanvas();
        // Touching the store triggers hydrate → migration.
        expect(m.isGhostSelector('#main')).toBe(false);
        // Legacy key removed; the self repo's new key now holds the capture.
        expect(localStorage.getItem(LEGACY_DESKTOP)).toBe(null);
        expect(localStorage.getItem(selfKey('desktop'))).toBeTruthy();
        const parsed = JSON.parse(localStorage.getItem(selfKey('desktop')));
        expect(parsed.handles['#main']).toBeTruthy();
    });

    it('does not overwrite an existing new self key when a stale legacy key lingers', async () => {
        localStorage.setItem(selfKey('desktop'), JSON.stringify(bucketPayload({
            '#main': { rect: { x: 0, y: 60, width: 1440, height: 800 }, visible: true },
        })));
        // A stale legacy key with different data must not clobber the migrated entry.
        localStorage.setItem(LEGACY_DESKTOP, JSON.stringify(bucketPayload({
            '#appHeader': { rect: { x: 0, y: 0, width: 10, height: 10 }, visible: true },
        })));
        const m = await makeCanvas();
        m.getSnapshotInfo();
        const parsed = JSON.parse(localStorage.getItem(selfKey('desktop')));
        expect(parsed.handles['#main']).toBeTruthy();
        expect(parsed.handles['#appHeader']).toBeUndefined();
        expect(localStorage.getItem(LEGACY_DESKTOP)).toBe(null);
    });

    it('the self repo always mounts, even with no captured data', async () => {
        const m = await makeCanvas();
        const host = mountHost();
        const pane = m.renderStructureCanvas(host, { repo: m.SELF_REPO, tree: sampleTree(), onSelect: vi.fn() });
        expect(pane).toBeTruthy();
    });

    it('a guest repo with no stored data returns null (tree-only, as before)', async () => {
        const m = await makeCanvas();
        const host = mountHost();
        const pane = m.renderStructureCanvas(host, { repo: GUEST, tree: sampleTree(), onSelect: vi.fn() });
        expect(pane).toBe(null);
        expect(host.querySelector('.structureCanvasPane')).toBe(null);
    });

    it('a guest repo with stored buckets + tree mounts and renders from its stored tree', async () => {
        localStorage.setItem(repoKey(GUEST, 'desktop'), JSON.stringify(bucketPayload({
            '#appHeader': { rect: { x: 0, y: 0, width: 200, height: 60 }, visible: true },
            '#main': { rect: { x: 0, y: 60, width: 1440, height: 800 }, visible: true },
        })));
        localStorage.setItem(treeKey(GUEST), JSON.stringify(sampleTree()));
        const m = await makeCanvas();
        const host = mountHost();
        // No tree in opts → the canvas renders from the stored tree.
        const pane = m.renderStructureCanvas(host, { repo: GUEST, onSelect: vi.fn() });
        expect(pane).toBeTruthy();
        const blocks = Array.from(host.querySelectorAll('.structureCanvasBlock')).map((b) => b.dataset.selector).sort();
        expect(blocks).toEqual(['#appHeader', '#main']);
    });

    it('hides the ↻ re-measure chip and disables Locate for a guest repo', async () => {
        localStorage.setItem(repoKey(GUEST, 'desktop'), JSON.stringify(bucketPayload({
            '#main': { rect: { x: 0, y: 60, width: 1440, height: 800 }, visible: true },
        })));
        localStorage.setItem(treeKey(GUEST), JSON.stringify(sampleTree()));
        const m = await makeCanvas();
        const host = mountHost();
        m.renderStructureCanvas(host, { repo: GUEST, onSelect: vi.fn() });
        expect(host.querySelector('.structureCanvasSnapRefresh')).toBe(null);
        // #main resolves in the shared jsdom DOM, but Locate is gated off for guests.
        expect(m.canLocate('#main')).toBe(false);
    });

    it('keeps the ↻ chip and Locate for the self repo', async () => {
        const m = await makeCanvas();
        m.captureSnapshot(sampleTree(), m.SELF_REPO);
        const host = mountHost();
        m.renderStructureCanvas(host, { repo: m.SELF_REPO, tree: sampleTree(), onSelect: vi.fn() });
        expect(host.querySelector('.structureCanvasSnapRefresh')).toBeTruthy();
        expect(m.canLocate('#main')).toBe(true);
    });

    it('keeps each repo\'s snapshot isolated — no cross-repo bleed', async () => {
        // Self: #aside visible. Guest: #aside a zero-size ghost.
        localStorage.setItem(selfKey('desktop'), JSON.stringify(bucketPayload({
            '#aside': { rect: { x: 200, y: 60, width: 100, height: 300 }, visible: true },
        })));
        localStorage.setItem(repoKey(GUEST, 'desktop'), JSON.stringify(bucketPayload({
            '#aside': { rect: { x: 0, y: 0, width: 0, height: 0 }, visible: false },
        })));
        localStorage.setItem(treeKey(GUEST), JSON.stringify(sampleTree()));
        const m = await makeCanvas();

        const selfHost = mountHost();
        m.renderStructureCanvas(selfHost, { repo: m.SELF_REPO, tree: sampleTree(), onSelect: vi.fn() });
        expect(m.isGhostSelector('#aside')).toBe(false);

        const guestHost = mountHost();
        m.renderStructureCanvas(guestHost, { repo: GUEST, onSelect: vi.fn() });
        expect(m.isGhostSelector('#aside')).toBe(true);
    });

    it('round-trips the handle tree captured for the self repo', async () => {
        const m = await makeCanvas();
        m.captureSnapshot(sampleTree(), m.SELF_REPO);
        const raw = localStorage.getItem(treeKey(SELF_REPO));
        expect(raw).toBeTruthy();
        expect(JSON.parse(raw)).toEqual(sampleTree());
    });
});

describe('structureCanvas — unified capture/re-capture chip button', () => {
    const GUEST = 'rsterenchak/matchingGame-test';

    it('self repo: the chip renders the live ↻ AND the deployed Capture/Re-capture button', () => {
        const host = mountHost();
        // beforeEach captured the self snapshot, so the active bucket has data.
        render(host, { onRecapture: vi.fn() });
        const chip = host.querySelector('.structureCanvasSnapChip');
        expect(chip).toBeTruthy();
        expect(chip.querySelector('.structureCanvasSnapRefresh')).toBeTruthy();
        const btn = chip.querySelector('.structureCanvasRecapture');
        expect(btn).toBeTruthy();
        expect(btn.textContent).toBe('Re-capture');
    });

    it('guest repo: the chip renders the Capture/Re-capture button but no live ↻', () => {
        // Seed guest geometry + tree so its canvas (and chip) mount.
        captureSnapshot(sampleTree(), GUEST);
        const host = mountHost();
        renderStructureCanvas(host, {
            repo: GUEST, tree: sampleTree(), onSelect: vi.fn(), onRecapture: vi.fn(),
        });
        const chip = host.querySelector('.structureCanvasSnapChip');
        expect(chip).toBeTruthy();
        // A guest has no live DOM to re-measure → no ↻, only the deployed capture button.
        expect(chip.querySelector('.structureCanvasSnapRefresh')).toBe(null);
        const btn = chip.querySelector('.structureCanvasRecapture');
        expect(btn).toBeTruthy();
        expect(btn.textContent).toBe('Re-capture');
    });

    it('labels the button "Capture" when the active bucket has no geometry yet', async () => {
        // A fresh module with empty storage → the self canvas mounts but has no capture.
        localStorage.clear();
        vi.resetModules();
        const m = await import('../src/structureCanvas.js');
        const host = mountHost();
        m.renderStructureCanvas(host, {
            repo: m.SELF_REPO, tree: sampleTree(), onSelect: vi.fn(), onRecapture: vi.fn(),
        });
        const btn = host.querySelector('.structureCanvasSnapChip .structureCanvasRecapture');
        expect(btn).toBeTruthy();
        expect(btn.textContent).toBe('Capture');
    });

    it('routes a tap through onRecapture', () => {
        const onRecapture = vi.fn();
        const host = mountHost();
        render(host, { onRecapture });
        const btn = host.querySelector('.structureCanvasSnapChip .structureCanvasRecapture');
        btn.click();
        expect(onRecapture).toHaveBeenCalledTimes(1);
    });

    it('omits the capture button when no onRecapture is wired', () => {
        const host = mountHost();
        render(host); // default helper wires no onRecapture
        expect(host.querySelector('.structureCanvasRecapture')).toBe(null);
    });
});

describe('structureCanvas — guest root-relative normalization', () => {
    const GUEST = 'rsterenchak/matchingGame-test';
    const bucketKey = (repo, bucket) => 'todoapp_structureSnapshot_' + encodeURIComponent(repo) + '_' + bucket;
    const treeKey = (repo) => 'todoapp_structureTree_' + encodeURIComponent(repo);

    // A guest layout in ROOT (#app) coordinate space: #app is the 1000 × 1200
    // root, logoSection sits mid-page, and logoContainer2 carries a negative
    // margin that pulls it ABOVE logoSection's own top — so it is NOT geometrically
    // contained by its DOM parent (the matchingGame case). Under parent-relative
    // normalization its top would clamp to 0 (a misaligned full-width band); under
    // root-relative it lands at its true position.
    const ROOT = { x: 0, y: 0, width: 1000, height: 1200 };
    function guestHandles() {
        return {
            '#app': { rect: ROOT, visible: true },
            'div.navSection': { rect: { x: 0, y: 0, width: 1000, height: 200 }, visible: true },
            'div.logoSection': { rect: { x: 0, y: 200, width: 1000, height: 400 }, visible: true },
            'img.logoContainer2': { rect: { x: 300, y: 150, width: 400, height: 300 }, visible: true },
        };
    }
    function guestTree() {
        return [
            {
                type: 'region', label: 'App', selector: '#app', visible: true, children: [
                    { type: 'region', label: 'Nav Section', selector: 'div.navSection', visible: true, children: [] },
                    {
                        type: 'region', label: 'Logo Section', selector: 'div.logoSection', visible: true, children: [
                            { type: 'region', label: 'Logo Container 2', selector: 'img.logoContainer2', visible: true, children: [] },
                        ],
                    },
                ],
            },
        ];
    }
    function payload(handles) {
        return { capturedAt: '2026-07-01T00:00:00.000Z', viewport: { w: 1000, h: 1200 }, handles: handles };
    }
    async function makeCanvas() {
        vi.resetModules();
        return await import('../src/structureCanvas.js');
    }

    beforeEach(() => {
        localStorage.clear();
        Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    });
    afterEach(() => {
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    });

    it('normalizes a drilled guest level against the ROOT box, not the drilled parent', async () => {
        localStorage.setItem(bucketKey(GUEST, 'desktop'), JSON.stringify(payload(guestHandles())));
        localStorage.setItem(treeKey(GUEST), JSON.stringify(guestTree()));
        const m = await makeCanvas();
        const host = mountHost();
        m.renderStructureCanvas(host, { repo: GUEST, onSelect: vi.fn() });

        // Drill App → Logo Section, then read logoContainer2's placement.
        host.querySelector('.structureCanvasBlock[data-selector="#app"] .structureCanvasDrillChip').click();
        host.querySelector('.structureCanvasBlock[data-selector="div.logoSection"] .structureCanvasDrillChip').click();

        const logo = host.querySelector('.structureCanvasBlock[data-selector="img.logoContainer2"]');
        // Root-relative against #app (1000 × 1200): top is 150/1200, NOT clamped to
        // 0 by a parent-relative (logoSection y=200) crop.
        expect(parseFloat(logo.style.top)).toBeCloseTo((150 / 1200) * 100, 4);
        expect(parseFloat(logo.style.left)).toBeCloseTo((300 / 1000) * 100, 4);
        expect(parseFloat(logo.style.width)).toBeCloseTo((400 / 1000) * 100, 4);
        expect(parseFloat(logo.style.height)).toBeCloseTo((300 / 1200) * 100, 4);
        // The parent-relative crop would have clamped top to 0 — assert it didn't.
        expect(logo.style.top).not.toBe('0%');
    });

    it('paints the guest root level and its children against the same root box', async () => {
        localStorage.setItem(bucketKey(GUEST, 'desktop'), JSON.stringify(payload(guestHandles())));
        localStorage.setItem(treeKey(GUEST), JSON.stringify(guestTree()));
        const m = await makeCanvas();
        const host = mountHost();
        m.renderStructureCanvas(host, { repo: GUEST, onSelect: vi.fn() });

        // Drill into #app: navSection/logoSection sit at their true root-relative
        // positions (nav spans the top, logo directly beneath), not clamped bands.
        host.querySelector('.structureCanvasBlock[data-selector="#app"] .structureCanvasDrillChip').click();
        const nav = host.querySelector('.structureCanvasBlock[data-selector="div.navSection"]');
        const logoSec = host.querySelector('.structureCanvasBlock[data-selector="div.logoSection"]');
        expect(nav.style.top).toBe('0%');
        expect(parseFloat(nav.style.height)).toBeCloseTo((200 / 1200) * 100, 4);
        expect(parseFloat(logoSec.style.top)).toBeCloseTo((200 / 1200) * 100, 4);
        expect(parseFloat(logoSec.style.height)).toBeCloseTo((400 / 1200) * 100, 4);
    });

    it('the self repo still normalizes a drilled level against its immediate parent', async () => {
        const m = await makeCanvas();
        mountDom();
        m.captureSnapshot(sampleTree(), m.SELF_REPO);
        const host = mountHost();
        m.renderStructureCanvas(host, { repo: m.SELF_REPO, tree: sampleTree(), onSelect: vi.fn() });
        host.querySelector('.structureCanvasBlock[data-selector="#main"] .structureCanvasDrillChip').click();

        const list = host.querySelector('.structureCanvasBlock[data-selector="#list"]');
        // #list (200 × 300 at 0,60) against #main's OWN box (300 × 400 at 0,60):
        // parent-relative, so width is 200/300 and height 300/400 — not root-relative.
        expect(parseFloat(list.style.width)).toBeCloseTo((200 / 300) * 100, 4);
        expect(parseFloat(list.style.height)).toBeCloseTo((300 / 400) * 100, 4);
        expect(list.style.top).toBe('0%'); // (60 - 60) / 400
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

describe('structureCanvas — captureSnapshot with a foreign document + explicit bucket', () => {
    const GUEST = 'rsterenchak/matchingGame-test';
    function bucketKey(repo, bucket) {
        return 'todoapp_structureSnapshot_' + encodeURIComponent(repo) + '_' + bucket;
    }
    // A detached document (a stand-in for a guest repo's deployed page in an
    // iframe) whose #alpha is absent from the host document, so a capture that
    // resolves it proves selectors resolved against the passed doc, not the host.
    function foreignDoc() {
        const doc = document.implementation.createHTMLDocument('guest');
        doc.body.innerHTML = '<main id="alpha"></main>';
        stubRect(doc.body.querySelector('#alpha'), 120, 90);
        return doc;
    }

    it('measures selectors against the passed doc and writes the forced bucket only', () => {
        localStorage.removeItem(bucketKey(GUEST, 'mobile'));
        localStorage.removeItem(bucketKey(GUEST, 'desktop'));
        expect(document.querySelector('#alpha')).toBe(null); // not in the host DOM

        const tree = [{ type: 'region', label: 'Alpha', selector: '#alpha', visible: true, children: [] }];
        // Force the mobile bucket even though the host viewport (jsdom = 1024px)
        // reads as desktop — proving the explicit bucket override, not the host width.
        captureSnapshot(tree, GUEST, { doc: foreignDoc(), bucket: 'mobile', viewport: { w: 390, h: 844 } });

        const mobile = JSON.parse(localStorage.getItem(bucketKey(GUEST, 'mobile')));
        expect(mobile.handles['#alpha'].rect.width).toBe(120);
        expect(mobile.handles['#alpha'].rect.height).toBe(90);
        expect(mobile.viewport).toEqual({ w: 390, h: 844 });
        // The forced bucket is the only one written — the host viewport is irrelevant.
        expect(localStorage.getItem(bucketKey(GUEST, 'desktop'))).toBe(null);
    });
});

describe('structureCanvas — degenerate full-capture guard', () => {
    const MOBILE_KEY = 'todoapp_structureSnapshot_' + encodeURIComponent(SELF_REPO) + '_mobile';

    function setViewport(w, h) {
        Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: h || 800, configurable: true });
    }

    // A fresh module instance so each test controls its own hydration / buckets.
    async function makeCanvas() {
        vi.resetModules();
        return await import('../src/structureCanvas.js');
    }

    // Zero out the descendant regions (#list, #row, #aside), leaving the roots
    // (#appHeader, #main) measuring real — the mobile view-switch degenerate shape.
    function zeroDescendants() {
        stubRect(document.getElementById('list'), 0, 0, 0, 0);
        stubRect(document.getElementById('row'), 0, 0, 0, 0);
        stubRect(document.getElementById('aside'), 0, 0, 0, 0);
    }

    beforeEach(() => {
        localStorage.clear();
        setViewport(500, 900); // mobile bucket
        mountDom();
    });

    it('does not create a bucket from a capture whose root is real but all children are zero', async () => {
        const m = await makeCanvas();
        zeroDescendants();
        m.captureSnapshot(sampleTree());

        // Nothing persisted and no in-memory bucket — the tab keeps its no-capture state.
        expect(localStorage.getItem(MOBILE_KEY)).toBe(null);
        expect(m.getSnapshotInfo().size).toBe(0);
    });

    it('does not overwrite a prior good bucket with a degenerate capture', async () => {
        const m = await makeCanvas();
        // First: a genuine capture with real descendant rects.
        m.captureSnapshot(sampleTree());
        expect(m.isGhostSelector('#list')).toBe(false);
        const goodSize = m.getSnapshotInfo().size;

        // Then: the descendants collapse to zero (the mobile teardown) — rejected.
        zeroDescendants();
        m.captureSnapshot(sampleTree());

        // The prior good rects survive; #list is still a non-ghost block.
        expect(m.isGhostSelector('#list')).toBe(false);
        expect(m.getSnapshotInfo().size).toBe(goodSize);
        const parsed = JSON.parse(localStorage.getItem(MOBILE_KEY));
        expect(parsed.handles['#list'].visible).toBe(true);
    });

    it('commits normally when at least one descendant measures a real rect', async () => {
        const m = await makeCanvas();
        zeroDescendants();
        // #list alone keeps a real rect — a genuinely sparse layout, not degenerate.
        stubRect(document.getElementById('list'), 200, 300, 0, 60);
        m.captureSnapshot(sampleTree());

        expect(localStorage.getItem(MOBILE_KEY)).toBeTruthy();
        expect(m.isGhostSelector('#list')).toBe(false);
        expect(m.isGhostSelector('#row')).toBe(true); // zero-size → ghost, but capture committed
    });

    it('leaves the partial re-measure path untouched — prior rects are preserved', async () => {
        const m = await makeCanvas();
        m.captureSnapshot(sampleTree());
        // A partial re-measure while a handle no longer resolves keeps its prior rect.
        document.getElementById('appHeader').remove();
        m.captureSnapshot(sampleTree(), SELF_REPO, { partial: true });
        expect(m.isGhostSelector('#appHeader')).toBe(false);
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

describe('structureCanvas — display:contents pass-through hoisting', () => {
    // #outer wraps a boxless #mainSplit (a display:contents shell on mobile) that
    // holds two real-boxed regions. The boxless-parent / boxed-children shape is
    // the pass-through signature the canvas must see through.
    function mountPassthroughDom(childrenReal) {
        document.body.innerHTML =
            '<div id="outer">' +
            '  <div id="mainSplit">' +
            '    <div id="mainSec"></div>' +
            '    <div id="tabBar"></div>' +
            '  </div>' +
            '</div>';
        stubRect(document.getElementById('outer'), 400, 800, 0, 0);
        stubRect(document.getElementById('mainSplit'), 0, 0, 0, 0); // display:contents → no box
        if (childrenReal) {
            stubRect(document.getElementById('mainSec'), 400, 720, 0, 0);
            stubRect(document.getElementById('tabBar'), 400, 60, 0, 740);
        } else {
            stubRect(document.getElementById('mainSec'), 0, 0, 0, 0);
            stubRect(document.getElementById('tabBar'), 0, 0, 0, 0);
        }
    }

    function passthroughTree() {
        return [
            {
                type: 'region', label: 'Outer', selector: '#outer', visible: true, children: [
                    {
                        type: 'region', label: 'Main Split', selector: '#mainSplit', visible: true, children: [
                            { type: 'region', label: 'Main Section', selector: '#mainSec', visible: true, children: [] },
                            { type: 'region', label: 'Tab Bar', selector: '#tabBar', visible: true, children: [] },
                        ],
                    },
                ],
            },
        ];
    }

    function renderTree(host, tree) {
        return renderStructureCanvas(host, {
            repo: SELF_REPO, tree, onSelect: vi.fn(),
        });
    }

    it('hoists a boxless pass-through node’s real children up, so drilling in is not an empty canvas and the node is no ghost', () => {
        mountPassthroughDom(true);
        const tree = passthroughTree();
        captureSnapshot(tree);
        const host = mountHost();
        renderTree(host, tree);

        // Drill into #outer — its only direct child is the boxless #mainSplit.
        host.querySelector('.structureCanvasBlock[data-selector="#outer"] .structureCanvasDrillChip').click();

        // The hoisted real children render as blocks (not an empty canvas), and
        // the pass-through node is neither a block nor a ghost-tray chip.
        const blocks = Array.from(host.querySelectorAll('.structureCanvasBlock'))
            .map((b) => b.dataset.selector).sort();
        expect(blocks).toEqual(['#mainSec', '#tabBar']);
        expect(host.querySelector('.structureCanvasEmpty')).toBe(null);
        expect(host.querySelector('.structureCanvasGhostTray')).toBe(null);
        expect(host.querySelector('[data-selector="#mainSplit"]')).toBe(null);
    });

    it('leaves a boxed container nesting normally (desktop case — no hoist)', () => {
        mountPassthroughDom(true);
        // Desktop: #mainSplit HAS a box, so it is a normal container, not pass-through.
        stubRect(document.getElementById('mainSplit'), 400, 800, 0, 0);
        const tree = passthroughTree();
        captureSnapshot(tree);
        const host = mountHost();
        renderTree(host, tree);

        host.querySelector('.structureCanvasBlock[data-selector="#outer"] .structureCanvasDrillChip').click();

        // #mainSplit renders as its own block with a drill chip; its children stay
        // one level deeper (not hoisted).
        const split = host.querySelector('.structureCanvasBlock[data-selector="#mainSplit"]');
        expect(split).toBeTruthy();
        expect(split.querySelector('.structureCanvasDrillChip')).toBeTruthy();
        expect(host.querySelector('.structureCanvasBlock[data-selector="#mainSec"]')).toBe(null);
    });

    it('keeps a truly hidden boxless node (no boxed children) in the ghost tray', () => {
        mountPassthroughDom(false); // #mainSplit AND its children all zero-size
        // A real sibling so the capture commits (the degenerate-capture guard needs
        // at least one real non-root region), while #mainSplit stays genuinely hidden.
        document.getElementById('outer').insertAdjacentHTML('beforeend', '<div id="sibling"></div>');
        stubRect(document.getElementById('sibling'), 400, 200, 0, 0);
        const tree = passthroughTree();
        tree[0].children.push({ type: 'region', label: 'Sibling', selector: '#sibling', visible: true, children: [] });
        captureSnapshot(tree);
        const host = mountHost();
        renderTree(host, tree);

        host.querySelector('.structureCanvasBlock[data-selector="#outer"] .structureCanvasDrillChip').click();

        // #mainSplit's descendants are all boxless → it is hidden, not pass-through:
        // it stays a ghost chip and is NOT hoisted, while the real sibling renders.
        expect(host.querySelector('.structureCanvasGhostChip[data-selector="#mainSplit"]')).toBeTruthy();
        expect(host.querySelector('.structureCanvasBlock[data-selector="#sibling"]')).toBeTruthy();
        expect(host.querySelector('.structureCanvasBlock[data-selector="#mainSec"]')).toBe(null);
    });
});

// ── LIVE VIEW MODE ───────────────────────────────────────────────────────────
// The UI lens's second rendering of the same region model: the repo's deployed
// page in a same-origin iframe with the region overlay painted over it. jsdom
// never navigates the iframe, so these tests stand in for the guest by defining
// `contentDocument` / `contentWindow` on the mounted frame and firing `load` —
// which is exactly the seam the module's own load handler uses.

// A standalone document playing the deployed page, with real rects stubbed on
// the two regions the walk will keep.
function makeGuestDoc() {
    const doc = document.implementation.createHTMLDocument('guest');
    doc.body.innerHTML =
        '<div id="app"><div id="hud"></div></div>';
    stubRect(doc.getElementById('app'), 400, 900, 0, 0);
    stubRect(doc.getElementById('hud'), 400, 80, 0, 0);
    return doc;
}

// A minimal same-origin window stub: scroll offsets the overlay translates by,
// plus the scroll listener registry teardown must unwind.
function makeGuestWin(doc) {
    const listeners = [];
    return {
        document: doc,
        scrollX: 0,
        scrollY: 0,
        listeners: listeners,
        addEventListener: function (type, fn) { listeners.push([type, fn]); },
        removeEventListener: function (type, fn) {
            for (let i = listeners.length - 1; i >= 0; i--) {
                if (listeners[i][0] === type && listeners[i][1] === fn) listeners.splice(i, 1);
            }
        },
    };
}

// Hand the mounted frame a guest document/window and fire its load event.
function loadGuest(host, doc, win, throwOnDoc) {
    const frame = host.querySelector('.structureLiveFrame');
    Object.defineProperty(frame, 'contentDocument', {
        configurable: true,
        get: function () {
            if (throwOnDoc) throw new Error('cross-origin');
            return doc;
        },
    });
    Object.defineProperty(frame, 'contentWindow', { configurable: true, get: function () { return win; } });
    frame.dispatchEvent(new Event('load'));
    return frame;
}

function enterLive(host) {
    host.querySelector('.structureCanvasLiveChip').click();
}

// jsdom lays nothing out, so the live wrapper's measured box (what the
// scale-to-fit reads) is stubbed the way rects are elsewhere in this file.
function stubClientBox(el, w, h) {
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: function () { return w; } });
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: function () { return h; } });
}

// Give the mounted viewport a measured box and re-run the host-resize path.
function resizeLiveHost(host, w, h) {
    stubClientBox(host.querySelector('.structureLiveViewport'), w, h);
    window.dispatchEvent(new Event('resize'));
}

describe('structureCanvas — live view mode', () => {
    it('offers the Live chip beside the canvas controls and starts in canvas mode', () => {
        const host = mountHost();
        render(host, { onRecapture: vi.fn() });
        const chip = host.querySelector('.structureCanvasSnapChip');
        expect(chip.querySelector('.structureCanvasLiveChip')).toBeTruthy();
        // Canvas mode: the full chip, and no iframe mounted without an explicit tap.
        expect(chip.querySelector('.structureCanvasSnapRefresh')).toBeTruthy();
        expect(chip.querySelector('.structureCanvasRecapture')).toBeTruthy();
        expect(chip.querySelector('.structureCanvasViewToggle')).toBeTruthy();
        expect(host.querySelector('.structureLiveFrame')).toBe(null);
    });

    it('the chip swaps the pane to the deployed page and narrows the chip row', () => {
        const host = mountHost();
        render(host, { onRecapture: vi.fn() });
        enterLive(host);

        const frame = host.querySelector('.structureLiveFrame');
        expect(frame).toBeTruthy();
        expect(frame.getAttribute('src')).toMatch(
            /^https:\/\/rsterenchak\.github\.io\/toDoList_TOP\/\?v=\d+$/
        );
        // The block canvas is gone; the live viewport and reload chip replace it.
        expect(host.querySelector('.structureCanvasBlocks')).toBe(null);
        expect(host.querySelector('.structureCanvasBreadcrumb')).toBe(null);
        expect(host.querySelector('.structureLiveViewport')).toBeTruthy();
        expect(host.querySelector('.structureLiveReload')).toBeTruthy();

        // Chip: repo-named label, engaged Live chip, and the three capture-geometry
        // controls dropped (they're inert against a real pane-width render).
        const chip = host.querySelector('.structureCanvasSnapChip');
        expect(chip.querySelector('.structureCanvasSnapLabel').textContent).toBe('live · toDoList_TOP');
        expect(chip.querySelector('.structureCanvasLiveChip').classList.contains('is-live')).toBe(true);
        expect(chip.querySelector('.structureCanvasSnapRefresh')).toBe(null);
        expect(chip.querySelector('.structureCanvasRecapture')).toBe(null);
        expect(chip.querySelector('.structureCanvasViewToggle')).toBe(null);
    });

    it('toggling the chip back restores the block canvas and the full chip', () => {
        const host = mountHost();
        render(host, { onRecapture: vi.fn() });
        enterLive(host);
        enterLive(host);

        expect(host.querySelector('.structureLiveViewport')).toBe(null);
        expect(host.querySelector('.structureCanvasBlocks')).toBeTruthy();
        const chip = host.querySelector('.structureCanvasSnapChip');
        expect(chip.querySelector('.structureCanvasSnapRefresh')).toBeTruthy();
        expect(chip.querySelector('.structureCanvasViewToggle')).toBeTruthy();
        expect(chip.querySelector('.structureCanvasLiveChip').classList.contains('is-live')).toBe(false);
    });

    it('never persists the mode: nothing is written and a session exit starts on the canvas', () => {
        const host = mountHost();
        render(host, { onRecapture: vi.fn() });
        const before = Object.keys(localStorage).sort();
        enterLive(host);
        expect(Object.keys(localStorage).sort()).toEqual(before);

        // The mode is session-only: leaving the Structure tab runs the full exit, so
        // the next mount is back on the canvas with no iframe loaded. (A same-repo
        // re-mount WITHOUT that exit keeps live mode — see the regression below.)
        exitLiveView();
        const host2 = mountHost();
        render(host2, { onRecapture: vi.fn() });
        expect(host2.querySelector('.structureLiveFrame')).toBe(null);
        expect(host2.querySelector('.structureCanvasBlocks')).toBeTruthy();
    });

    // REGRESSION: the UI lens re-mounts this canvas from async continuations (the
    // guest's published-map fetch, the self repo's capture merge), which can land
    // seconds after the user tapped Live. Those re-mounts used to run the full
    // exit, so the pane reverted to the block canvas on its own.
    it('a same-repo re-mount keeps live mode and remounts the frame', () => {
        const host = mountHost();
        render(host, { onRecapture: vi.fn() });
        enterLive(host);
        expect(host.querySelector('.structureLiveFrame')).toBeTruthy();

        // What the late continuation does: mount the canvas again for the same repo.
        const host2 = mountHost();
        render(host2, { onRecapture: vi.fn() });

        expect(host2.querySelector('.structureLiveFrame')).toBeTruthy();
        expect(host2.querySelector('.structureCanvasBlocks')).toBe(null);
        expect(host2.querySelector('.structureCanvasLiveChip').classList.contains('is-live')).toBe(true);
        // The suspended frame went with the pane it lived in — no orphan iframe.
        expect(host.querySelector('.structureLiveFrame')).toBe(null);
    });

    it('a repo switch still fully exits live mode', () => {
        const host = mountHost();
        render(host, { onRecapture: vi.fn() });
        enterLive(host);

        // resetCanvasState is what a project/repo switch runs before the repaint.
        resetCanvasState();
        expect(host.querySelector('.structureLiveFrame')).toBe(null);

        const host2 = mountHost();
        render(host2, { onRecapture: vi.fn() });
        expect(host2.querySelector('.structureLiveFrame')).toBe(null);
        expect(host2.querySelector('.structureCanvasBlocks')).toBeTruthy();
    });

    it('mounting another repo’s canvas fully exits live mode', () => {
        const host = mountHost();
        render(host, { onRecapture: vi.fn() });
        enterLive(host);

        // A guest repo with no stored geometry mounts nothing, but the mode must
        // still drop — live view is scoped to the repo it was entered on.
        render(mountHost(), { repo: 'rsterenchak/matchingGame-test', onRecapture: vi.fn() });
        expect(host.querySelector('.structureLiveFrame')).toBe(null);

        const host3 = mountHost();
        render(host3, { onRecapture: vi.fn() });
        expect(host3.querySelector('.structureLiveFrame')).toBe(null);
        expect(host3.querySelector('.structureCanvasBlocks')).toBeTruthy();
    });

    it('paints one outline box per walked region once the guest loads', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        const doc = makeGuestDoc();
        loadGuest(host, doc, makeGuestWin(doc));

        const boxes = Array.from(host.querySelectorAll('.structureLiveRegion'));
        expect(boxes.map((b) => b.dataset.selector)).toEqual(['#app', '#hud']);
        const app = boxes[0];
        // Guest-document coordinates, taken straight off the guest's own rects.
        expect(app.style.width).toBe('400px');
        expect(app.style.height).toBe('900px');
        expect(app.style.top).toBe('0px');
    });

    it('a tap on an outline box selects it and drives the shared toolbar', () => {
        const onSelect = vi.fn();
        const host = mountHost();
        render(host, { onSelect });
        enterLive(host);
        const doc = makeGuestDoc();
        loadGuest(host, doc, makeGuestWin(doc));

        host.querySelector('.structureLiveRegion[data-selector="#hud"]').click();

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0]).toMatchObject({
            kind: 'live',
            label: 'Hud',
            value: '#hud',
            copyLabel: 'Copy selector',
            repo: SELF_REPO,
            visible: true,
        });
        expect(
            host.querySelector('.structureLiveRegion[data-selector="#hud"]').classList.contains('is-selected')
        ).toBe(true);
    });

    it('mirroring a tree selection re-marks the overlay without reloading the iframe', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        const doc = makeGuestDoc();
        loadGuest(host, doc, makeGuestWin(doc));
        const src = host.querySelector('.structureLiveFrame').getAttribute('src');

        revealSelector('#hud');

        expect(host.querySelector('.structureLiveFrame').getAttribute('src')).toBe(src);
        expect(
            host.querySelector('.structureLiveRegion[data-selector="#hud"]').classList.contains('is-selected')
        ).toBe(true);
    });

    it('translates the overlay layer by the guest’s own scroll offsets', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        const doc = makeGuestDoc();
        const win = makeGuestWin(doc);
        loadGuest(host, doc, win);

        const layer = host.querySelector('.structureLiveOverlayLayer');
        expect(layer.style.transform).toBe('translate(0px, 0px)');

        win.scrollY = 240;
        win.listeners.filter((l) => l[0] === 'scroll').forEach((l) => l[1]());
        expect(layer.style.transform).toBe('translate(0px, -240px)');
    });

    it('inspect is active by default; interact hides the overlay and flipping back re-walks', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        const doc = makeGuestDoc();
        loadGuest(host, doc, makeGuestWin(doc));

        const overlay = host.querySelector('.structureLiveOverlay');
        const inspect = host.querySelector('.structureLivePill[data-live-mode="inspect"]');
        const interact = host.querySelector('.structureLivePill[data-live-mode="interact"]');
        expect(inspect.classList.contains('is-active')).toBe(true);
        expect(overlay.hidden).toBe(false);

        interact.click();
        expect(interact.classList.contains('is-active')).toBe(true);
        expect(inspect.classList.contains('is-active')).toBe(false);
        expect(overlay.hidden).toBe(true);

        // Flipping back to inspect re-walks the guest, so a region added while the
        // page was being interacted with shows up.
        doc.getElementById('app').insertAdjacentHTML('beforeend', '<div id="late"></div>');
        stubRect(doc.getElementById('late'), 400, 40, 0, 100);
        inspect.click();
        expect(overlay.hidden).toBe(false);
        expect(host.querySelector('.structureLiveRegion[data-selector="#late"]')).toBeTruthy();
    });

    it('falls back to interact-only with a muted notice when the guest document throws', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        loadGuest(host, null, null, true);

        const inspect = host.querySelector('.structureLivePill[data-live-mode="inspect"]');
        const interact = host.querySelector('.structureLivePill[data-live-mode="interact"]');
        expect(inspect.disabled).toBe(true);
        expect(inspect.classList.contains('is-disabled')).toBe(true);
        expect(interact.classList.contains('is-active')).toBe(true);
        expect(host.querySelector('.structureLiveOverlay').hidden).toBe(true);
        const notice = host.querySelector('.structureLiveNotice');
        expect(notice.hidden).toBe(false);
        expect(notice.textContent).toMatch(/can’t inspect this page/i);
        // The disabled inspect pill can't claw the mode back.
        inspect.click();
        expect(interact.classList.contains('is-active')).toBe(true);
    });

    it('the reload chip remounts the iframe on a fresh cache-busting query', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        const first = host.querySelector('.structureLiveFrame');
        const firstSrc = first.getAttribute('src');

        host.querySelector('.structureLiveReload').click();

        const second = host.querySelector('.structureLiveFrame');
        expect(second).not.toBe(first);
        expect(first.parentNode).toBe(null);          // the old frame is unmounted
        expect(second.getAttribute('src')).toMatch(/\?v=\d+$/);
        expect(host.querySelector('.structureCanvasSnapLabel').textContent).toBe('live · toDoList_TOP');
        expect(firstSrc).toBeTruthy();
    });

    it('exitLiveView unmounts the frame and unwinds the guest scroll listener', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        const doc = makeGuestDoc();
        const win = makeGuestWin(doc);
        const frame = loadGuest(host, doc, win);
        expect(win.listeners.length).toBe(1);

        exitLiveView();

        expect(frame.parentNode).toBe(null);
        expect(win.listeners.length).toBe(0);
    });

    it('reverts to the canvas with the capture flow’s copy when the page can’t be reached', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        host.querySelector('.structureLiveFrame').dispatchEvent(new Event('error'));

        expect(host.querySelector('.structureLiveViewport')).toBe(null);
        expect(host.querySelector('.structureCanvasBlocks')).toBeTruthy();
        const status = host.querySelector('.structureCaptureStatus--error');
        expect(status).toBeTruthy();
        expect(status.textContent).toBe('Couldn’t reach a deployed site for this repo.');
    });

    // ── SCALE-TO-FIT ─────────────────────────────────────────────────────────
    // A phone host measures ~360 CSS px, narrower than the guest page's own mobile
    // viewport, so laying the guest out at the wrapper's width clipped fixed-width
    // clusters at the right edge. The frame is held at a 390px virtual viewport
    // and the scaler shrinks it to fit instead.

    it('scales a 390px virtual viewport down to fit a narrow host', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        resizeLiveHost(host, 360, 600);

        const scaler = host.querySelector('.structureLiveScaler');
        expect(scaler).toBeTruthy();
        expect(scaler.style.width).toBe('390px');
        // 600 / (360/390) — the guest gets proportionally MORE viewport height,
        // so the painted box is exactly the wrapper's 360×600.
        expect(scaler.style.height).toBe('650px');
        expect(scaler.style.transform).toBe('scale(' + (360 / 390) + ')');
    });

    it('scales the frame and the overlay together, leaving the pills and notice at wrapper level', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        resizeLiveHost(host, 360, 600);

        const scaler = host.querySelector('.structureLiveScaler');
        // Both scaled surfaces live inside the scaler...
        expect(scaler.contains(host.querySelector('.structureLiveFrame'))).toBe(true);
        expect(scaler.contains(host.querySelector('.structureLiveOverlayLayer'))).toBe(true);
        // ...while the chrome that must stay full-size does not.
        expect(scaler.contains(host.querySelector('.structureLivePills'))).toBe(false);
        expect(scaler.contains(host.querySelector('.structureLiveNotice'))).toBe(false);
        expect(host.querySelector('.structureLiveReload').closest('.structureLiveViewport')).toBe(null);
    });

    it('never scales up: a host at or above the virtual width stays untransformed', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        const scaler = host.querySelector('.structureLiveScaler');

        // Unmeasured (jsdom's 0×0 default, or a pane not yet in the document).
        expect(scaler.style.transform).toBe('');

        resizeLiveHost(host, 390, 600);       // exactly the virtual width
        expect(scaler.style.transform).toBe('');
        expect(scaler.style.width).toBe('');
        expect(scaler.style.height).toBe('');

        resizeLiveHost(host, 900, 600);       // the desktop detail column
        expect(scaler.style.transform).toBe('');
        expect(scaler.style.width).toBe('');
        expect(scaler.style.height).toBe('');
    });

    it('drops the scale when the host widens back (rotation, breakpoint re-home)', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        resizeLiveHost(host, 360, 600);
        const scaler = host.querySelector('.structureLiveScaler');
        expect(scaler.style.transform).toBe('scale(' + (360 / 390) + ')');

        resizeLiveHost(host, 780, 400);       // landscape
        expect(scaler.style.transform).toBe('');
        expect(scaler.style.width).toBe('');
        expect(scaler.style.height).toBe('');
    });

    it('fits the viewport on the guest’s load, not only on a later resize', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        stubClientBox(host.querySelector('.structureLiveViewport'), 360, 600);
        const doc = makeGuestDoc();
        loadGuest(host, doc, makeGuestWin(doc));

        expect(host.querySelector('.structureLiveScaler').style.transform).toBe(
            'scale(' + (360 / 390) + ')'
        );
    });

    it('keeps overlay boxes in guest-document units under the transform', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        const doc = makeGuestDoc();
        const win = makeGuestWin(doc);
        loadGuest(host, doc, win);
        resizeLiveHost(host, 360, 600);

        // The scaler carries the transform, so no rect is pre-multiplied by k —
        // the boxes stay exactly the guest's own rects.
        const app = host.querySelector('.structureLiveRegion[data-selector="#app"]');
        expect(app.style.width).toBe('400px');
        expect(app.style.height).toBe('900px');
        // ...and the scroll sync still translates in those same units.
        win.scrollY = 240;
        win.listeners.filter((l) => l[0] === 'scroll').forEach((l) => l[1]());
        expect(host.querySelector('.structureLiveOverlayLayer').style.transform).toBe(
            'translate(0px, -240px)'
        );
    });

    it('still routes the overlay walk’s interact flip to the wrapper, not the scaler', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        // The unreachable-guest fallback is the one path where the overlay walk is
        // the ONLY thing applying the interact state, so it pins which element the
        // walk reaches for — the frame's own parent is now the scaler.
        loadGuest(host, null, null, true);

        expect(host.querySelector('.structureLiveViewport').classList.contains('is-interact')).toBe(true);
        expect(host.querySelector('.structureLiveScaler').classList.contains('is-interact')).toBe(false);
    });

    it('unmounts the scaler with the frame on teardown', () => {
        const host = mountHost();
        render(host);
        enterLive(host);
        const scaler = host.querySelector('.structureLiveScaler');
        const frame = host.querySelector('.structureLiveFrame');

        exitLiveView();

        expect(frame.parentNode).toBe(null);
        expect(scaler.parentNode).toBe(null);
        expect(host.querySelector('.structureLiveScaler')).toBe(null);
    });

    it('a guest repo with stored geometry gets the same Live chip', () => {
        const GUEST = 'rsterenchak/matchingGame-test';
        captureSnapshot(sampleTree(), GUEST);
        const host = mountHost();
        renderStructureCanvas(host, { repo: GUEST, tree: sampleTree(), onSelect: vi.fn() });
        enterLive(host);
        expect(host.querySelector('.structureCanvasSnapLabel').textContent).toBe('live · matchingGame-test');
        expect(host.querySelector('.structureLiveFrame').getAttribute('src')).toMatch(
            /^https:\/\/rsterenchak\.github\.io\/matchingGame-test\/\?v=\d+$/
        );
    });
});

// The live view's own CSS contract. An author-level `display` declaration
// outranks the UA stylesheet's `[hidden] { display: none }`, so every live-view
// family that declares `display` AND is toggled through the `hidden` attribute
// needs an explicit re-assertion or the toggle is a silent no-op. Source
// inspection only — jsdom doesn't model the UA-vs-author cascade for `hidden`.
describe('structureCanvas — live view CSS contract', () => {
    const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

    // The overlay is hidden in interact mode; the notice is hidden until the
    // interact-only fallback fires.
    ['.structureLiveOverlay', '.structureLiveNotice'].forEach((selector) => {
        it(`${selector} declares display and re-asserts it under [hidden]`, () => {
            const base = css.indexOf(selector + ' {');
            expect(base).toBeGreaterThan(-1);
            const body = css.slice(css.indexOf('{', base), css.indexOf('}', base));
            expect(body).toMatch(/display:\s*(?:block|flex|inline-flex)/);
            const guard = css.indexOf(selector + '[hidden]');
            expect(guard).toBeGreaterThan(base);
            expect(css.slice(guard, guard + 60)).toMatch(/\[hidden\]\s*\{\s*display:\s*none/);
        });
    });

    it('contains the guest’s internal scrolling so iOS standalone can’t chain it into the shell', () => {
        const start = css.indexOf('.structureLiveViewport {');
        expect(start).toBeGreaterThan(-1);
        const body = css.slice(start, css.indexOf('}', start));
        expect(body).toMatch(/overscroll-behavior:\s*contain/);
        // Viewport-proportional height in the inline (mobile) placement.
        expect(body).toMatch(/height:\s*65dvh/);
    });

    it('absorbs the detail column instead of the dvh proportion at desktop widths', () => {
        const rule = css.indexOf('#structureView > .structureCanvasHost .structureLiveViewport');
        expect(rule).toBeGreaterThan(-1);
        const body = css.slice(css.indexOf('{', rule), css.indexOf('}', rule));
        expect(body).toMatch(/height:\s*auto/);
        expect(body).toMatch(/flex:\s*1 1 auto/);
    });

    // The scaler fills the wrapper at rest and anchors its transform top-left, so
    // an unscaled host renders exactly as it did before the scaler existed and a
    // scaled one can't drift part of the guest outside the wrapper.
    it('anchors the scaler at the wrapper’s top-left with a top-left transform origin', () => {
        const start = css.indexOf('.structureLiveScaler {');
        expect(start).toBeGreaterThan(-1);
        const body = css.slice(start, css.indexOf('}', start));
        expect(body).toMatch(/position:\s*absolute/);
        expect(body).toMatch(/left:\s*0/);
        expect(body).toMatch(/top:\s*0/);
        expect(body).toMatch(/width:\s*100%/);
        expect(body).toMatch(/height:\s*100%/);
        expect(body).toMatch(/transform-origin:\s*0 0/);
    });

    it('sizes the floating pills at 36×36 with a 10px radius', () => {
        const start = css.indexOf('.structureLivePill {');
        expect(start).toBeGreaterThan(-1);
        const body = css.slice(start, css.indexOf('}', start));
        expect(body).toMatch(/width:\s*36px/);
        expect(body).toMatch(/height:\s*36px/);
        expect(body).toMatch(/border-radius:\s*10px/);
    });
});
