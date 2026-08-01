import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The NEXT REFACTOR card's request-scan control (refactorCard.js). The card is a
// pure reader; this control asks the Worker to run a FRESH scan (claude-scan.yml in
// CI) for the active project's repo, then observes the shared scan tracker
// (agentQueueStore) for the run's lifecycle and re-reads the stored scan when it
// settles. These tests mock inject.js (dispatchScan / mintEntryId / isInjectConfigured)
// and listLogic, and drive the REAL scan tracker via configureRunTrackers so the
// pending state and the settle re-read are exercised end to end.

let loadResult = { ok: true, row: null };
let injectConfigured = true;
let projectTargetId = 'target-1';

const dispatchScan = vi.fn(function () { return Promise.resolve({ ok: true }); });
const mintEntryId = vi.fn(function () { return 'scan-corr-1'; });
const loadLatestRefactorScan = vi.fn(function () { return Promise.resolve(loadResult); });
const dismissRefactorCandidate = vi.fn(function () { return Promise.resolve({ ok: true }); });

vi.mock('../src/inject.js', () => ({
    getCachedTargets: () => [{ repo: 'o/r', file_path: 'TODO.md' }],
    fetchActiveRuns: (...a) => fetchActiveRuns(...a),
    dispatchScan: (...a) => dispatchScan(...a),
    mintEntryId: (...a) => mintEntryId(...a),
    isInjectConfigured: () => injectConfigured,
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        loadLatestRefactorScan: (...a) => loadLatestRefactorScan(...a),
        dismissRefactorCandidate: (...a) => dismissRefactorCandidate(...a),
        getProjectTargetId: () => projectTargetId,
    },
}));

// A stub for the tracker's active-runs probe, controlled per-test.
let activeRunsResult = { ok: true, active: false };
const fetchActiveRuns = vi.fn(function () { return Promise.resolve(activeRunsResult); });

import { renderRefactorCard } from '../src/refactorCard.js';
import {
    configureRunTrackers,
    stopScanTracking,
    isScanActive,
} from '../src/agentQueueStore.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) { for (let i = 0; i < n; i++) await tick(); }

function makeCleanRow(scannedAt) {
    return {
        repo: 'o/r',
        status: 'clean',
        largest_file: 'src/big.js',
        largest_bytes: 12800,
        budget_bytes: 61440,
        eligible_count: 42,
        scanned_at: scannedAt || '2026-08-01T00:00:00.000Z',
    };
}

beforeEach(() => {
    loadResult = { ok: true, row: null };
    injectConfigured = true;
    projectTargetId = 'target-1';
    activeRunsResult = { ok: true, active: false };
    dispatchScan.mockClear();
    mintEntryId.mockClear();
    loadLatestRefactorScan.mockClear();
    fetchActiveRuns.mockClear();
    configureRunTrackers({
        fetchActiveRuns: (...a) => fetchActiveRuns(...a),
        resolveDispatchTarget: () => ({ repo: 'o/r', file_path: 'TODO.md' }),
    });
    document.body.innerHTML = '';
});

afterEach(() => {
    stopScanTracking();
});

// Mount a card into the DOM so its self-cleaning scan-change listener sees
// card.isConnected === true and repaints on tracker transitions.
function mountCard(repo, projectName) {
    const card = renderRefactorCard(repo, projectName);
    document.body.appendChild(card);
    return card;
}

describe('refactor card — request-scan control gating', () => {
    it('shows the control when the project routes to an inject target', async () => {
        const card = mountCard('o/r', 'Alpha');
        await flush();
        expect(card.querySelector('.refactorCardScan')).toBeTruthy();
    });

    it('shows no control when the project has no routed target', async () => {
        projectTargetId = null;
        const card = mountCard('o/r', 'Alpha');
        await flush();
        expect(card.querySelector('.refactorCardScan')).toBeFalsy();
    });

    it('shows no control when inject is not configured', async () => {
        injectConfigured = false;
        const card = mountCard('o/r', 'Alpha');
        await flush();
        expect(card.querySelector('.refactorCardScan')).toBeFalsy();
    });

    it('shows no control when there is no project name', async () => {
        const card = mountCard('o/r', '');
        await flush();
        expect(card.querySelector('.refactorCardScan')).toBeFalsy();
    });
});

describe('refactor card — request-scan dispatch', () => {
    it('dispatches once with a minted correlation id and disables while in flight', async () => {
        const card = mountCard('o/r', 'Alpha');
        await flush();
        const btn = card.querySelector('.refactorCardScan');
        expect(btn.disabled).toBe(false);

        // Keep the probe reporting active so the tracker stays pending after dispatch.
        activeRunsResult = { ok: true, active: true };
        btn.click();
        await flush();

        expect(dispatchScan).toHaveBeenCalledTimes(1);
        expect(dispatchScan.mock.calls[0][0]).toBe('scan-corr-1');
        expect(dispatchScan.mock.calls[0][1]).toEqual({ repo: 'o/r', file_path: 'TODO.md' });
        expect(isScanActive()).toBe(true);

        // The card repainted to its pending state: the control is disabled + "Scanning…".
        const pendingBtn = card.querySelector('.refactorCardScan');
        expect(pendingBtn.disabled).toBe(true);
        expect(pendingBtn.textContent).toMatch(/scanning/i);
    });

    it('surfaces a failed dispatch inline and does not begin tracking', async () => {
        dispatchScan.mockImplementationOnce(function () {
            return Promise.resolve({ ok: false, reason: 'Server error 502' });
        });
        const card = mountCard('o/r', 'Alpha');
        await flush();
        card.querySelector('.refactorCardScan').click();
        await flush();

        expect(isScanActive()).toBe(false);
        const err = card.querySelector('.refactorCardScanError');
        expect(err).toBeTruthy();
        expect(err.textContent).toContain('Server error 502');
        // The control is re-enabled so the user can retry.
        expect(card.querySelector('.refactorCardScan').disabled).toBe(false);
    });

    it('re-reads the stored scan and repaints when the run settles', async () => {
        loadResult = { ok: true, row: null }; // no scan yet
        const card = mountCard('o/r', 'Alpha');
        await flush();
        expect(card.querySelector('.refactorCardNote').textContent).toMatch(/no refactor scan yet/i);

        // First poll confirms in flight; the next reports it gone → settle.
        let n = 0;
        activeRunsResult = { ok: true, active: true };
        fetchActiveRuns.mockImplementation(function () {
            return Promise.resolve({ ok: true, active: n++ === 0 });
        });

        vi.useFakeTimers();
        card.querySelector('.refactorCardScan').click();
        await vi.advanceTimersByTimeAsync(0); // dispatch + first poll (confirms active)
        // The Worker has now written a clean scan; the settle re-read will pick it up.
        loadResult = { ok: true, row: makeCleanRow() };
        await vi.advanceTimersByTimeAsync(5000 + 50); // next poll → gone → settle → re-read
        vi.useRealTimers();
        await flush();

        expect(isScanActive()).toBe(false);
        // The card re-read the freshly-written scan and now renders the clean note.
        expect(card.querySelector('.refactorCardNote').textContent).toMatch(/clean/i);
        expect(card.querySelector('.refactorCardScan').disabled).toBe(false);
    });
});
