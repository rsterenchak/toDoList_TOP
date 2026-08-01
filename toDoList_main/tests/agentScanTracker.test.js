import { vi } from 'vitest';

// The refactor-scan tracker (agentQueueStore.js) drives the NEXT REFACTOR card's
// pending state from the real claude-scan.yml run. Unlike the sweep/derive trackers
// it writes no agent_queue row and has no post-settle reconcile — its only job is to
// poll the scan-scoped active_runs probe, flip isScanActive() on/off, and notify
// subscribers so the card can re-read its stored scan when the run settles. These
// tests drive it directly through the store's exported functions with NO card
// rendered, asserting the accessor, the scan-scoped probe, the notify on start and
// settle, and that a plain stop cancels the poller without a settle notification.

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
            update: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
            insert: (row) => Promise.resolve({ data: [row], error: null }),
            delete: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

import {
    configureRunTrackers,
    startScanTracking,
    stopScanTracking,
    isScanActive,
    getScanningRepo,
    onScanChange,
} from '../src/agentQueueStore.js';

const POLL_MS = 5000;
const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) { for (let i = 0; i < n; i++) await tick(); }

let deps;
beforeEach(() => {
    deps = {
        fetchActiveRuns: vi.fn(() => Promise.resolve({ ok: true, active: false })),
        resolveDispatchTarget: vi.fn(() => ({ repo: 'owner/repo', file_path: 'TODO.md' })),
    };
    configureRunTrackers(deps);
});

afterEach(() => {
    stopScanTracking();
});

describe('refactor-scan tracker', () => {
    it('starts tracking: flips the accessor, captures the repo, notifies, and probes with the scan workflow', async () => {
        const changed = vi.fn();
        const unsub = onScanChange(changed);

        startScanTracking('owner/repo');

        expect(isScanActive()).toBe(true);
        expect(getScanningRepo()).toBe('owner/repo');
        // The dispatch → pending transition notifies so a mounted card flips at once.
        expect(changed).toHaveBeenCalled();
        await flush();
        expect(deps.fetchActiveRuns.mock.calls.some((c) => c[1] === 'scan')).toBe(true);

        unsub();
        stopScanTracking();
        expect(isScanActive()).toBe(false);
    });

    it('settles to idle and notifies when the confirmed run finishes, then stops polling', async () => {
        let n = 0;
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: n++ === 0 }));
        const changed = vi.fn();
        onScanChange(changed);

        vi.useFakeTimers();
        startScanTracking('owner/repo');
        await vi.advanceTimersByTimeAsync(0); // one-shot poll confirms in flight
        expect(isScanActive()).toBe(true);
        changed.mockClear();

        await vi.advanceTimersByTimeAsync(POLL_MS + 50); // next tick → gone → settle
        expect(isScanActive()).toBe(false);
        // The settle transition notifies so the card re-reads its stored scan.
        expect(changed).toHaveBeenCalled();

        // The poller was cleared on settle — a further advance probes nothing more.
        deps.fetchActiveRuns.mockClear();
        await vi.advanceTimersByTimeAsync(POLL_MS * 4);
        expect(deps.fetchActiveRuns).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('settles after the grace window when the run never registers', async () => {
        deps.fetchActiveRuns = vi.fn(() => Promise.resolve({ ok: true, active: false }));

        vi.useFakeTimers();
        startScanTracking('owner/repo');
        // Grace window (30s) elapses with no confirmation → settle.
        await vi.advanceTimersByTimeAsync(30 * 1000 + POLL_MS + 50);
        expect(isScanActive()).toBe(false);
        vi.useRealTimers();
    });

    it('stopScanTracking cancels the poller WITHOUT a settle notification', async () => {
        const changed = vi.fn();
        onScanChange(changed);
        startScanTracking('owner/repo');
        await flush();
        expect(isScanActive()).toBe(true);

        changed.mockClear();
        stopScanTracking();
        expect(isScanActive()).toBe(false);
        // A plain stop (dispatch-failure cancel) does not fire onScanChange — the card
        // renders its own error and repaint on that path.
        expect(changed).not.toHaveBeenCalled();

        deps.fetchActiveRuns.mockClear();
        await flush();
        expect(deps.fetchActiveRuns).not.toHaveBeenCalled();
    });
});
