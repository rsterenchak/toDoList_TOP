import { describe, it, expect, beforeEach, vi } from 'vitest';

// Tests for the NEXT REFACTOR card (refactorCard.js). The card returns a
// container synchronously and fills it asynchronously: resolve the repo's last
// scan, probe the Worker's scan route, persist on new bytes, and render the top
// not-yet-dismissed candidate. inject.js (scanRefactor) and listLogic.js (the
// three refactor_scans functions) are fully mocked so each branch and the
// in-flight dedup can be scripted without network or Supabase.

let scanResult = { ok: true, found: false, all_under_budget: true };
let scanImpl = null; // when set, called instead of returning scanResult
let loadResult = { ok: true, row: null };

const scanRefactor = vi.fn(function () {
    if (scanImpl) return scanImpl();
    return Promise.resolve(scanResult);
});
const saveRefactorScan = vi.fn(function () { return Promise.resolve({ ok: true }); });
const dismissRefactorCandidate = vi.fn(function () { return Promise.resolve({ ok: true }); });
const loadLatestRefactorScan = vi.fn(function () { return Promise.resolve(loadResult); });

vi.mock('../src/inject.js', () => ({
    scanRefactor: (...a) => scanRefactor(...a),
    getCachedTargets: () => [],
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        loadLatestRefactorScan: (...a) => loadLatestRefactorScan(...a),
        saveRefactorScan: (...a) => saveRefactorScan(...a),
        dismissRefactorCandidate: (...a) => dismissRefactorCandidate(...a),
    },
}));

import { renderRefactorCard, _resetRefactorCard } from '../src/refactorCard.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) { for (let i = 0; i < n; i++) await tick(); }

beforeEach(() => {
    _resetRefactorCard();
    scanResult = { ok: true, found: false, all_under_budget: true };
    scanImpl = null;
    loadResult = { ok: true, row: null };
    scanRefactor.mockClear();
    saveRefactorScan.mockClear();
    dismissRefactorCandidate.mockClear();
    loadLatestRefactorScan.mockClear();
});

const FOUND = {
    ok: true,
    found: true,
    target_file: 'src/agentView.js',
    target_sha: 'sha-1',
    candidates: [
        {
            name: 'buildMockupSecondary',
            lines: 120,
            closure_refs: ['ctx', 'row'],
            suggested_module: 'src/agentMockup.js',
            cluster_with: ['renderMockupPreviews'],
            rationale: 'Self-contained mockup rendering.',
        },
        {
            name: 'buildDiscussSeed',
            lines: 40,
            closure_refs: [],
            suggested_module: 'src/agentHandoff.js',
            cluster_with: [],
            rationale: 'Pure seed assembly.',
        },
    ],
};

describe('renderRefactorCard — synchronous shell', () => {
    it('returns an element immediately showing the scanning state', () => {
        const card = renderRefactorCard('o/r');
        expect(card).toBeInstanceOf(HTMLElement);
        expect(card.className).toBe('refactorCard');
        expect(card.querySelector('.refactorCardEyebrowLabel').textContent).toBe('NEXT REFACTOR');
        expect(card.querySelector('.refactorCardEyebrowMeta').textContent).toBe('scanning…');
    });

    it('hides the card entirely when there is no repo', () => {
        const card = renderRefactorCard('');
        expect(card.style.display).toBe('none');
        expect(scanRefactor).not.toHaveBeenCalled();
    });
});

describe('renderRefactorCard — found candidates', () => {
    it('persists the fresh scan and renders the top candidate', async () => {
        scanResult = FOUND;
        const card = renderRefactorCard('o/r');
        await flush();
        // Saved only the allowed fields.
        expect(saveRefactorScan).toHaveBeenCalledTimes(1);
        const saved = saveRefactorScan.mock.calls[0][0];
        expect(saved).toEqual({
            repo: 'o/r',
            target_file: 'src/agentView.js',
            target_sha: 'sha-1',
            candidates: FOUND.candidates,
        });
        // Top candidate is rendered.
        expect(card.querySelector('.refactorCardTitle').textContent).toBe('buildMockupSecondary');
        const chips = Array.from(card.querySelectorAll('.refactorCardChip')).map((c) => c.textContent);
        expect(chips).toContain('120 lines');
        expect(chips).toContain('2 refs');
        expect(chips).toContain('−120 from agentView.js');
        expect(card.querySelector('.refactorCardModule').textContent).toContain('src/agentMockup.js');
        expect(card.querySelector('.refactorCardCluster').textContent).toContain('renderMockupPreviews');
        expect(card.querySelector('.refactorCardRationale').textContent).toBe('Self-contained mockup rendering.');
        expect(card.querySelector('.refactorCardSkip')).toBeTruthy();
    });

    it('flags a zero-closure-ref candidate with the clean chip class', async () => {
        scanResult = { ...FOUND, candidates: [FOUND.candidates[1]] };
        const card = renderRefactorCard('o/r');
        await flush();
        const clean = card.querySelector('.refactorCardChip--clean');
        expect(clean).toBeTruthy();
        expect(clean.textContent).toBe('0 refs');
    });

    it('Skip dismisses the shown candidate and advances to the next', async () => {
        scanResult = FOUND;
        const card = renderRefactorCard('o/r');
        await flush();
        expect(card.querySelector('.refactorCardTitle').textContent).toBe('buildMockupSecondary');
        card.querySelector('.refactorCardSkip').click();
        await flush();
        expect(dismissRefactorCandidate).toHaveBeenCalledWith('o/r', 'src/agentView.js', 'buildMockupSecondary');
        expect(card.querySelector('.refactorCardTitle').textContent).toBe('buildDiscussSeed');
    });

    it('shows the all-skipped note once every candidate is dismissed', async () => {
        scanResult = { ...FOUND, candidates: [FOUND.candidates[0]] };
        const card = renderRefactorCard('o/r');
        await flush();
        card.querySelector('.refactorCardSkip').click();
        await flush();
        expect(card.querySelector('.refactorCardTitle')).toBeFalsy();
        expect(card.querySelector('.refactorCardNote').textContent).toMatch(/skipped/i);
    });
});

describe('renderRefactorCard — unchanged / terminal / error', () => {
    it('renders the stored candidates without a save when unchanged', async () => {
        loadResult = {
            ok: true,
            row: {
                repo: 'o/r',
                target_file: 'src/x.js',
                target_sha: 'sha-old',
                candidates: [{ name: 'stored', lines: 10, closure_refs: [], rationale: 'r' }],
                dismissed: [],
                scanned_at: new Date().toISOString(),
            },
        };
        scanResult = { ok: true, unchanged: true };
        const card = renderRefactorCard('o/r');
        await flush();
        // The stored sha was forwarded to the Worker.
        expect(scanRefactor.mock.calls[0][1]).toBe('sha-old');
        expect(saveRefactorScan).not.toHaveBeenCalled();
        expect(card.querySelector('.refactorCardTitle').textContent).toBe('stored');
    });

    it('renders the under-budget note as a terminal state', async () => {
        scanResult = { ok: true, found: false, all_under_budget: true };
        const card = renderRefactorCard('o/r');
        await flush();
        expect(card.querySelector('.refactorCardNote').textContent).toMatch(/under budget/i);
    });

    it('renders a quiet inline error on ok:false', async () => {
        scanResult = { ok: false, reason: 'Server error 500' };
        const card = renderRefactorCard('o/r');
        await flush();
        const err = card.querySelector('.refactorCardError');
        expect(err).toBeTruthy();
        expect(err.textContent).toContain('Server error 500');
    });
});

describe('renderRefactorCard — in-flight dedup', () => {
    it('reuses the pending scan when a second render lands mid-flight', async () => {
        let resolveScan;
        scanImpl = () => new Promise((r) => { resolveScan = r; });
        const cardA = renderRefactorCard('o/r');
        const cardB = renderRefactorCard('o/r');
        await flush(2);
        // Both renders share one Worker scan.
        expect(scanRefactor).toHaveBeenCalledTimes(1);
        resolveScan(FOUND);
        await flush();
        expect(cardA.querySelector('.refactorCardTitle').textContent).toBe('buildMockupSecondary');
        expect(cardB.querySelector('.refactorCardTitle').textContent).toBe('buildMockupSecondary');
    });
});
