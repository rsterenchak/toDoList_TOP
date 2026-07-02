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
