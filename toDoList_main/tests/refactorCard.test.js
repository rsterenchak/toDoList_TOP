import { describe, it, expect, beforeEach, vi } from 'vitest';

// Tests for the NEXT REFACTOR card (refactorCard.js). The card is a pure reader:
// it returns a container synchronously and fills it asynchronously by reading the
// repo's last stored scan (listLogic.loadLatestRefactorScan) and rendering the
// top not-yet-dismissed candidate. The Worker owns the scan and writes the row
// now, so the client never posts a scan and never saves a row. listLogic.js is
// fully mocked so each branch can be scripted without Supabase.

let loadResult = { ok: true, row: null };

const dismissRefactorCandidate = vi.fn(function () { return Promise.resolve({ ok: true }); });
const loadLatestRefactorScan = vi.fn(function () { return Promise.resolve(loadResult); });

vi.mock('../src/inject.js', () => ({
    getCachedTargets: () => [],
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        loadLatestRefactorScan: (...a) => loadLatestRefactorScan(...a),
        dismissRefactorCandidate: (...a) => dismissRefactorCandidate(...a),
    },
}));

import { renderRefactorCard } from '../src/refactorCard.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) { for (let i = 0; i < n; i++) await tick(); }

beforeEach(() => {
    loadResult = { ok: true, row: null };
    dismissRefactorCandidate.mockClear();
    loadLatestRefactorScan.mockClear();
});

const CANDIDATES = [
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
];

// A stored refactor_scans row — the shape loadLatestRefactorScan returns and the
// card reads directly (no scan, no save).
function makeRow(candidates) {
    return {
        repo: 'o/r',
        target_file: 'src/agentView.js',
        target_sha: 'sha-1',
        candidates: candidates || CANDIDATES,
        dismissed: [],
        scanned_at: new Date().toISOString(),
    };
}

describe('renderRefactorCard — synchronous shell', () => {
    it('returns an empty element immediately with no scanning label', () => {
        const card = renderRefactorCard('o/r');
        expect(card).toBeInstanceOf(HTMLElement);
        expect(card.className).toBe('refactorCard');
        // The card no longer scans from the browser, so there is no scanning
        // state — it renders nothing until the stored row resolves.
        expect(card.querySelector('.refactorCardNote')).toBeNull();
        expect(card.querySelector('.refactorCardEyebrowLabel')).toBeNull();
        expect(card.textContent).not.toContain('scanning');
        expect(card.textContent).not.toContain('minute and a half');
    });

    it('hides the card entirely when there is no repo', () => {
        const card = renderRefactorCard('');
        expect(card.style.display).toBe('none');
        expect(loadLatestRefactorScan).not.toHaveBeenCalled();
    });
});

describe('renderRefactorCard — stored candidates', () => {
    it('renders the top candidate from the stored row (no save)', async () => {
        loadResult = { ok: true, row: makeRow() };
        const card = renderRefactorCard('o/r');
        await flush();
        expect(loadLatestRefactorScan).toHaveBeenCalledWith('o/r');
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
        loadResult = { ok: true, row: makeRow([CANDIDATES[1]]) };
        const card = renderRefactorCard('o/r');
        await flush();
        const clean = card.querySelector('.refactorCardChip--clean');
        expect(clean).toBeTruthy();
        expect(clean.textContent).toBe('0 refs');
    });

    it('Skip dismisses the shown candidate and advances to the next', async () => {
        loadResult = { ok: true, row: makeRow() };
        const card = renderRefactorCard('o/r');
        await flush();
        expect(card.querySelector('.refactorCardTitle').textContent).toBe('buildMockupSecondary');
        card.querySelector('.refactorCardSkip').click();
        await flush();
        expect(dismissRefactorCandidate).toHaveBeenCalledWith('o/r', 'src/agentView.js', 'buildMockupSecondary');
        expect(card.querySelector('.refactorCardTitle').textContent).toBe('buildDiscussSeed');
    });

    it('shows the all-skipped note once every candidate is dismissed', async () => {
        loadResult = { ok: true, row: makeRow([CANDIDATES[0]]) };
        const card = renderRefactorCard('o/r');
        await flush();
        card.querySelector('.refactorCardSkip').click();
        await flush();
        expect(card.querySelector('.refactorCardTitle')).toBeFalsy();
        expect(card.querySelector('.refactorCardNote').textContent).toMatch(/skipped/i);
    });
});

describe('renderRefactorCard — no row / error', () => {
    it('renders the no-scan-yet note when the repo has no stored row', async () => {
        loadResult = { ok: true, row: null };
        const card = renderRefactorCard('o/r');
        await flush();
        expect(card.querySelector('.refactorCardTitle')).toBeFalsy();
        const note = card.querySelector('.refactorCardNote');
        expect(note).toBeTruthy();
        expect(note.textContent).toMatch(/no refactor scan yet/i);
        expect(note.textContent).toMatch(/after the next shipped run/i);
    });

    it('renders a quiet inline error when the read fails', async () => {
        loadResult = { ok: false, error: 'Server error 500' };
        const card = renderRefactorCard('o/r');
        await flush();
        const err = card.querySelector('.refactorCardError');
        expect(err).toBeTruthy();
        expect(err.textContent).toContain('Server error 500');
    });
});
