import { describe, it, expect, beforeEach, vi } from 'vitest';

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

describe('structureCanvas — selection detail bar', () => {
    it('selecting a block fills the detail bar and calls onSelect with a descriptor', () => {
        const host = mountHost();
        const onSelect = vi.fn();
        render(host, { onSelect });

        host.querySelector('.structureCanvasBlock[data-selector="#main"]').click();

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0]).toMatchObject({ kind: 'live', label: 'Main', value: '#main' });

        expect(host.querySelector('.structureCanvasDetailName').textContent).toBe('Main');
        expect(host.querySelector('.structureCanvasDetailId').textContent).toBe('#main');
        expect(host.querySelector('.structureCanvasDetailDims').textContent).toBe('300 × 400');
        expect(host.querySelector('.structureCanvasDetailBadge--visible')).toBeTruthy();
    });

    it('View code and Reference fire their callbacks', () => {
        const host = mountHost();
        const onViewCode = vi.fn();
        const onReference = vi.fn();
        render(host, { onViewCode, onReference });

        host.querySelector('.structureCanvasBlock[data-selector="#main"]').click();
        host.querySelector('.structureCanvasDetailViewCode').click();
        host.querySelector('.structureCanvasDetailReference').click();

        expect(onViewCode).toHaveBeenCalledWith('#main');
        expect(onReference).toHaveBeenCalledWith(expect.objectContaining({ value: '#main' }));
    });
});

describe('structureCanvas — Locate action', () => {
    let tabSwitch;
    beforeEach(() => {
        tabSwitch = vi.fn();
        setLocateTabSwitch(tabSwitch);
    });

    it('renders an enabled Locate button for a live-visible, non-overlay handle', () => {
        const host = mountHost();
        render(host);

        host.querySelector('.structureCanvasBlock[data-selector="#main"]').click();

        const locate = host.querySelector('.structureCanvasDetailLocate');
        expect(locate).toBeTruthy();
        expect(locate.disabled).toBe(false);
        expect(host.querySelector('.structureCanvasDetailLocateHint')).toBe(null);
    });

    it('clicking Locate switches to Tasks View and pulses the live element', () => {
        const host = mountHost();
        render(host);
        // Run the queued frame synchronously so the pulse lands within the test.
        const raf = global.requestAnimationFrame;
        global.requestAnimationFrame = (cb) => { cb(); return 0; };

        host.querySelector('.structureCanvasBlock[data-selector="#main"]').click();
        host.querySelector('.structureCanvasDetailLocate').click();

        global.requestAnimationFrame = raf;
        expect(tabSwitch).toHaveBeenCalledTimes(1);
        expect(document.getElementById('main').classList.contains('locate-pulse')).toBe(true);
    });

    it('renders no Locate button for overlay handles', () => {
        const host = mountHost();
        render(host);

        revealSelector('#bottomSheet');

        expect(host.querySelector('.structureCanvasDetailLocate')).toBe(null);
    });

    it('disables Locate with a helper note when the handle is absent from the live DOM', () => {
        const host = mountHost();
        render(host);

        revealSelector('#gone'); // never resolves in the live DOM

        const locate = host.querySelector('.structureCanvasDetailLocate');
        expect(locate).toBeTruthy();
        expect(locate.disabled).toBe(true);
        expect(host.querySelector('.structureCanvasDetailLocateHint').textContent).toBe('hidden in this viewport');
    });

    it('disables Locate when the handle resolves but has no on-screen box', () => {
        const host = mountHost();
        render(host);
        stubRect(document.getElementById('aside'), 0, 0, 0, 0); // present but hidden

        revealSelector('#aside');

        const locate = host.querySelector('.structureCanvasDetailLocate');
        expect(locate.disabled).toBe(true);
        expect(host.querySelector('.structureCanvasDetailLocateHint').textContent).toBe('hidden in this viewport');
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
