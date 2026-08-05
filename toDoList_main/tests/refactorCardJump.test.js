import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The NEXT REFACTOR card's jump chip. The scan reports a candidate's
// `start_line`/`end_line`, which used to reach the user only as prose inside the
// pushed entry's Description. As a chip it becomes a jump target: tapping it
// opens the candidate's file in the Structure view's detail-column code viewer,
// scrolled to and highlighting that span, so the code can be read before
// `Push entry` drafts an entry to extract it.
//
// The card resolves the detail column by selector rather than importing
// structureView.js (which imports THIS module), so these tests mount the column
// the same way structureView does and assert against it.

let loadResult = { ok: true, row: null };

const dismissRefactorCandidate = vi.fn(function () { return Promise.resolve({ ok: true }); });
const loadLatestRefactorScan = vi.fn(function () { return Promise.resolve(loadResult); });

const reads = [];

vi.mock('../src/inject.js', () => ({
    getCachedTargets: () => [{ repo: 'o/r', file_path: 'TODO.md' }],
    readRepoFile: vi.fn(function (target, filePath) {
        reads.push({ repo: target && target.repo, filePath });
        return Promise.resolve({ ok: true, content: 'a\nb\nc\nd\ne\nf', sha: 'sha-1' });
    }),
    // These tests pass a project name so the card renders its full candidate
    // face; isInjectConfigured false keeps the request-scan control inert.
    isInjectConfigured: () => false,
    dispatchScan: vi.fn(function () { return Promise.resolve({ ok: true }); }),
    mintEntryId: vi.fn(function () { return 'scan-corr-test'; }),
    fetchActiveRuns: vi.fn(function () { return Promise.resolve({ ok: true, active: false }); }),
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        loadLatestRefactorScan: (...a) => loadLatestRefactorScan(...a),
        dismissRefactorCandidate: (...a) => dismissRefactorCandidate(...a),
    },
}));

import { renderRefactorCard } from '../src/refactorCard.js';
import { getOpenCodeViewerFile, resetCodeViewer } from '../src/codeViewer.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) { for (let i = 0; i < n; i++) await tick(); }

const realInnerWidth = window.innerWidth;
function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

// The detail column, mounted exactly where structureView puts it.
function mountColumn() {
    document.body.innerHTML =
        '<div id="structureView"><div class="structureCanvasHost"></div></div>';
    return document.querySelector('#structureView > .structureCanvasHost');
}

function makeRow(candidate) {
    return {
        repo: 'o/r',
        target_file: 'src/agentView.js',
        target_sha: 'sha-1',
        candidates: [candidate],
        dismissed: [],
        scanned_at: new Date().toISOString(),
    };
}

const SPANNED = {
    name: 'buildMockupSecondary',
    lines: 120,
    closure_refs: [],
    suggested_module: 'agentMockup.js',
    cluster_with: [],
    start_line: 700,
    end_line: 820,
};

function jumpChip(card) {
    return card.querySelector('.refactorCardJump');
}

beforeEach(() => {
    setWidth(1280);
    mountColumn();
    reads.length = 0;
    resetCodeViewer();
    loadResult = { ok: true, row: makeRow(SPANNED) };
    dismissRefactorCandidate.mockClear();
    loadLatestRefactorScan.mockClear();
});

afterEach(() => {
    setWidth(realInnerWidth);
});

describe('NEXT REFACTOR — the jump chip', () => {
    it('reads "<file> : <start>–<end>" from the candidate’s span', async () => {
        const card = renderRefactorCard('o/r', 'My Project');
        document.body.appendChild(card);
        await flush();

        expect(jumpChip(card)).toBeTruthy();
        expect(jumpChip(card).textContent).toBe('agentView.js : 700–820');
    });

    it('sits in the chip row beside the candidate’s other chips', async () => {
        const card = renderRefactorCard('o/r', 'My Project');
        document.body.appendChild(card);
        await flush();

        expect(jumpChip(card).parentElement.className).toBe('refactorCardChips');
        expect(jumpChip(card).tagName).toBe('BUTTON');
        expect(jumpChip(card).type).toBe('button');
    });

    it('is absent when the scan reported no span', async () => {
        loadResult = { ok: true, row: makeRow({
            name: 'buildDiscussSeed', lines: 40, closure_refs: [], suggested_module: 'x.js',
        }) };
        const card = renderRefactorCard('o/r', 'My Project');
        document.body.appendChild(card);
        await flush();

        expect(card.querySelector('.refactorCardChips')).toBeTruthy();
        expect(jumpChip(card)).toBeNull();
    });

    it('is absent below 1024px, where there is no detail column to open into', async () => {
        setWidth(900);
        const card = renderRefactorCard('o/r', 'My Project');
        document.body.appendChild(card);
        await flush();

        expect(jumpChip(card)).toBeNull();
    });

    it('is absent when the Structure view has no detail column mounted', async () => {
        document.body.innerHTML = '';
        const card = renderRefactorCard('o/r', 'My Project');
        document.body.appendChild(card);
        await flush();

        expect(jumpChip(card)).toBeNull();
    });
});

describe('NEXT REFACTOR — tapping the jump chip', () => {
    it('opens the candidate’s file in the detail column at its full repo-relative path', async () => {
        const host = document.querySelector('#structureView > .structureCanvasHost');
        const card = renderRefactorCard('o/r', 'My Project');
        document.body.appendChild(card);
        await flush();

        jumpChip(card).click();
        await flush();

        // The scan reports `src/agentView.js`; the Worker's read route wants the
        // full repo-relative path, the same normalization the pushed entry uses.
        expect(reads).toEqual([{ repo: 'o/r', filePath: 'toDoList_main/src/agentView.js' }]);
        expect(getOpenCodeViewerFile()).toBe('toDoList_main/src/agentView.js');
        expect(host.querySelector(':scope > .codeViewerPane').hidden).toBe(false);
    });

    it('names the candidate in a dismissible banner over the span', async () => {
        const card = renderRefactorCard('o/r', 'My Project');
        document.body.appendChild(card);
        await flush();

        jumpChip(card).click();
        await flush();

        const banner = document.querySelector('.codeViewerBanner');
        expect(banner.hidden).toBe(false);
        expect(banner.textContent).toContain('buildMockupSecondary');

        document.querySelector('.codeViewerBannerDismiss').click();
        expect(banner.hidden).toBe(true);
        // Dismissing drops the highlight and leaves the file open.
        expect(document.querySelectorAll('.codeViewerLine--hit').length).toBe(0);
        expect(getOpenCodeViewerFile()).toBe('toDoList_main/src/agentView.js');
    });

    it('does not push, dismiss, or otherwise disturb the candidate', async () => {
        const card = renderRefactorCard('o/r', 'My Project');
        document.body.appendChild(card);
        await flush();

        jumpChip(card).click();
        await flush();

        expect(dismissRefactorCandidate).not.toHaveBeenCalled();
        expect(card.querySelector('.refactorCardTitle').textContent).toBe('buildMockupSecondary');
        expect(card.querySelector('.refactorCardPush')).toBeTruthy();
    });

    it('does nothing when the detail column has gone away since the card painted', async () => {
        const card = renderRefactorCard('o/r', 'My Project');
        document.body.appendChild(card);
        await flush();
        const chip = jumpChip(card);

        const view = document.getElementById('structureView');
        view.parentElement.removeChild(view);
        chip.click();
        await flush();

        expect(reads).toEqual([]);
        expect(getOpenCodeViewerFile()).toBeNull();
    });
});
