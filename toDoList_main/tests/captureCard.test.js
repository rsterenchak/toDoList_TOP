import { describe, it, expect, beforeEach, vi } from 'vitest';

// Tests for the RUN & CAPTURE card (captureCard.js). The card returns a container
// synchronously in the idle state, and on Run mints a correlation id, opens a
// realtime channel via subscribeRunOutputs, dispatches via dispatchCapture, and
// renders optimistically — then re-renders from each live `run_outputs` row
// (running → done/failed), tearing the channel down on a terminal status. Both
// inject.js and supabaseClient.js are mocked so every branch is scriptable
// without the Worker or Supabase.

let dispatchResult = { ok: true, dispatched: true };
let cachedTargets = [];
let capturedOnRow = null;
const returnedChannel = { id: 'ch-1' };

const mintEntryId = vi.fn(() => 'corr-fixed');
const getCachedTargets = vi.fn(() => cachedTargets);
const dispatchCapture = vi.fn(() => Promise.resolve(dispatchResult));
const subscribeRunOutputs = vi.fn((corr, onRow) => {
    capturedOnRow = onRow;
    return returnedChannel;
});

vi.mock('../src/inject.js', () => ({
    mintEntryId: (...a) => mintEntryId(...a),
    getCachedTargets: (...a) => getCachedTargets(...a),
    dispatchCapture: (...a) => dispatchCapture(...a),
    subscribeRunOutputs: (...a) => subscribeRunOutputs(...a),
}));

const removeChannel = vi.fn();
vi.mock('../src/supabaseClient.js', () => ({
    supabase: { removeChannel: (...a) => removeChannel(...a) },
}));

// listLogic.loadLatestCapture is the on-mount reader — defaults to "no stored
// row" so the card stays idle unless a test scripts a row.
let loadResult = { ok: true, row: null };
const loadLatestCapture = vi.fn(() => Promise.resolve(loadResult));
vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        loadLatestCapture: (...a) => loadLatestCapture(...a),
    },
}));

import { renderCaptureCard } from '../src/captureCard.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

beforeEach(() => {
    dispatchResult = { ok: true, dispatched: true };
    cachedTargets = [];
    capturedOnRow = null;
    loadResult = { ok: true, row: null };
    mintEntryId.mockClear();
    getCachedTargets.mockClear();
    dispatchCapture.mockClear();
    subscribeRunOutputs.mockClear();
    removeChannel.mockClear();
    loadLatestCapture.mockClear();
});

describe('renderCaptureCard — synchronous idle shell', () => {
    it('returns a .captureCard element in the lean idle state', () => {
        const card = renderCaptureCard('o/r');
        expect(card).toBeInstanceOf(HTMLElement);
        expect(card.className).toBe('captureCard');
        expect(card.querySelector('.captureCardEyebrowLabel').textContent).toBe('RUN & CAPTURE');
        const input = card.querySelector('.captureCardArgs');
        expect(input).toBeTruthy();
        expect(input.placeholder).toBe('args — e.g. 95 88 72');
        expect(card.querySelector('.captureCardRun').textContent).toBe('Run');
        expect(card.querySelector('.captureCardHint').textContent).toBe('output appears here');
        // No terminal block at rest — the card stays lean until a run starts.
        expect(card.querySelector('.captureCardTerm')).toBeNull();
    });

    it('hides the card entirely when there is no repo', () => {
        const card = renderCaptureCard('');
        expect(card.style.display).toBe('none');
        expect(card.querySelector('.captureCardArgs')).toBeNull();
    });
});

describe('renderCaptureCard — Run dispatch', () => {
    it('mints a correlation id, opens the channel, and dispatches with the typed args + resolved target', async () => {
        cachedTargets = [{ repo: 'o/r', file_path: 'docs/TODO.md' }];
        const card = renderCaptureCard('o/r');
        card.querySelector('.captureCardArgs').value = '95 88 72';
        card.querySelector('.captureCardRun').click();
        await flush();

        expect(mintEntryId).toHaveBeenCalledTimes(1);
        // Channel opened before dispatch, keyed by the minted id.
        expect(subscribeRunOutputs).toHaveBeenCalledTimes(1);
        expect(subscribeRunOutputs.mock.calls[0][0]).toBe('corr-fixed');
        expect(dispatchCapture).toHaveBeenCalledTimes(1);
        const opts = dispatchCapture.mock.calls[0][0];
        expect(opts.correlationId).toBe('corr-fixed');
        expect(opts.args).toBe('95 88 72');
        expect(opts.project).toBe('');
        expect(opts.target).toEqual({ repo: 'o/r', file_path: 'docs/TODO.md' });
    });

    it('renders the running state optimistically (spinner pill, disabled Run, running terminal line)', async () => {
        const card = renderCaptureCard('o/r');
        card.querySelector('.captureCardRun').click();
        await flush();

        expect(card.querySelector('.captureCardRunning')).toBeTruthy();
        expect(card.querySelector('.captureCardSpinner')).toBeTruthy();
        expect(card.querySelector('.captureCardRun').disabled).toBe(true);
        expect(card.querySelector('.captureCardArgs').disabled).toBe(true);
        const term = card.querySelector('.captureCardTerm');
        expect(term).toBeTruthy();
        expect(term.textContent).toContain('running…');
    });

    it('falls back to a repo-only target when the cache has no match', async () => {
        cachedTargets = [{ repo: 'other/repo', file_path: 'x' }];
        const card = renderCaptureCard('o/r');
        card.querySelector('.captureCardRun').click();
        await flush();
        expect(dispatchCapture.mock.calls[0][0].target).toEqual({ repo: 'o/r' });
    });

    it('does not fire a second dispatch on a double-tap while a capture is in flight', async () => {
        const card = renderCaptureCard('o/r');
        const run = card.querySelector('.captureCardRun');
        run.click();
        // A second click on the (now stale) reference is a no-op: the button is
        // both disabled and guarded by the in-flight flag.
        run.click();
        await flush();
        expect(dispatchCapture).toHaveBeenCalledTimes(1);
    });
});

describe('renderCaptureCard — live row re-render', () => {
    async function startRun(card) {
        card.querySelector('.captureCardRun').click();
        await flush();
    }

    it('holds the running state on a live running row', async () => {
        const card = renderCaptureCard('o/r');
        await startRun(card);
        capturedOnRow({ status: 'running' });
        expect(card.querySelector('.captureCardRunning')).toBeTruthy();
        expect(card.querySelector('.captureCardTerm').textContent).toContain('running…');
        // Still in flight — no channel teardown yet.
        expect(removeChannel).not.toHaveBeenCalled();
    });

    it('renders the done readout on exit 0, tears the channel down, and omits stderr when empty', async () => {
        const card = renderCaptureCard('o/r');
        await startRun(card);
        capturedOnRow({
            status: 'done',
            exit_code: 0,
            command: 'python3 main.py 95 88 72',
            stdout: 'AVG: 85.0',
            stderr: '',
            updated_at: new Date().toISOString(),
        });

        const badge = card.querySelector('.captureCardExit');
        expect(badge.textContent).toBe('exit 0');
        expect(badge.classList.contains('captureCardExit--ok')).toBe(true);
        expect(card.querySelector('.captureCardCommand').textContent).toBe('python3 main.py 95 88 72');
        expect(card.querySelector('.captureCardTerm').textContent).toBe('AVG: 85.0');
        // stderr empty → no stderr view.
        expect(card.querySelector('.captureCardStderr')).toBeNull();
        expect(card.querySelector('.captureCardFooter')).toBeTruthy();
        // Terminal status tore the channel down.
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
    });

    it('renders a danger exit badge and the stderr view on a nonzero exit', async () => {
        const card = renderCaptureCard('o/r');
        await startRun(card);
        capturedOnRow({
            status: 'failed',
            exit_code: 2,
            command: 'python3 main.py',
            stdout: '',
            stderr: 'Traceback: boom',
            updated_at: new Date().toISOString(),
        });

        const badge = card.querySelector('.captureCardExit');
        expect(badge.textContent).toBe('exit 2');
        expect(badge.classList.contains('captureCardExit--fail')).toBe(true);
        const stderr = card.querySelector('.captureCardStderr');
        expect(stderr).toBeTruthy();
        expect(stderr.textContent).toBe('Traceback: boom');
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
    });
});

describe('renderCaptureCard — load on mount', () => {
    it('reads the repo\'s last stored capture on mount', async () => {
        renderCaptureCard('o/r');
        await flush();
        expect(loadLatestCapture).toHaveBeenCalledWith('o/r');
    });

    it('renders the done readout from a terminal stored row', async () => {
        loadResult = {
            ok: true,
            row: {
                status: 'done',
                exit_code: 0,
                command: 'python3 main.py -- 95 88 72',
                stdout: 'AVG: 85.0',
                stderr: '',
                created_at: new Date().toISOString(),
            },
        };
        const card = renderCaptureCard('o/r');
        await flush();
        expect(card.querySelector('.captureCardExit').textContent).toBe('exit 0');
        expect(card.querySelector('.captureCardTerm').textContent).toBe('AVG: 85.0');
        // The done state carries an editable args input (no standalone ⟳ button),
        // seeded from the stored command's post-` -- ` args, plus a Run button.
        const input = card.querySelector('.captureCardArgs');
        expect(input).toBeTruthy();
        expect(input.disabled).toBe(false);
        expect(input.value).toBe('95 88 72');
        expect(card.querySelector('.captureCardRun')).toBeTruthy();
        expect(card.querySelector('.captureCardRerun')).toBeNull();
    });

    it('re-subscribes and shows running for an in-flight stored row', async () => {
        loadResult = {
            ok: true,
            row: {
                status: 'running',
                correlation_id: 'corr-resumed',
                command: 'python3 main.py -- 1 2',
            },
        };
        const card = renderCaptureCard('o/r');
        await flush();
        expect(subscribeRunOutputs).toHaveBeenCalledWith('corr-resumed', expect.any(Function));
        expect(card.querySelector('.captureCardRunning')).toBeTruthy();
        // The resumed channel settles live when the run finishes.
        capturedOnRow({ status: 'done', exit_code: 0, command: 'python3 main.py -- 1 2', stdout: 'ok', stderr: '' });
        expect(card.querySelector('.captureCardExit').textContent).toBe('exit 0');
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
    });

    it('stays idle when there is no stored row', async () => {
        loadResult = { ok: true, row: null };
        const card = renderCaptureCard('o/r');
        await flush();
        expect(card.querySelector('.captureCardHint').textContent).toBe('output appears here');
        expect(card.querySelector('.captureCardExit')).toBeNull();
        expect(subscribeRunOutputs).not.toHaveBeenCalled();
    });

    it('stays idle (no error surface) when the read fails', async () => {
        loadResult = { ok: false, error: 'boom' };
        const card = renderCaptureCard('o/r');
        await flush();
        expect(card.querySelector('.captureCardHint')).toBeTruthy();
        expect(card.querySelector('.captureCardError')).toBeNull();
    });

    it('does not clobber a Run tapped before the load resolves', async () => {
        loadResult = {
            ok: true,
            row: { status: 'done', exit_code: 0, command: 'x -- old', stdout: 'stale', stderr: '' },
        };
        const card = renderCaptureCard('o/r');
        // Tap Run synchronously, before fillFromLatest's async read resolves.
        card.querySelector('.captureCardRun').click();
        await flush();
        // The in-flight guard held: still running, no stale done readout painted.
        expect(card.querySelector('.captureCardRunning')).toBeTruthy();
        expect(card.querySelector('.captureCardExit')).toBeNull();
    });
});

describe('renderCaptureCard — re-run from the done state', () => {
    it('re-fires the same run from the persistent done-state Run button', async () => {
        const card = renderCaptureCard('o/r');
        card.querySelector('.captureCardArgs').value = '95 88 72';
        card.querySelector('.captureCardRun').click();
        await flush();
        capturedOnRow({
            status: 'done', exit_code: 0, command: 'python3 main.py -- 95 88 72',
            stdout: 'AVG: 85.0', stderr: '', created_at: new Date().toISOString(),
        });
        expect(dispatchCapture).toHaveBeenCalledTimes(1);
        // No standalone ⟳ control — the persistent Run button re-fires instead.
        expect(card.querySelector('.captureCardRerun')).toBeNull();

        // The done-state args input is present, editable, and seeded from the
        // last run; tapping Run repeats the run one-tap.
        const input = card.querySelector('.captureCardArgs');
        expect(input.disabled).toBe(false);
        expect(input.value).toBe('95 88 72');
        card.querySelector('.captureCardRun').click();
        await flush();
        expect(dispatchCapture).toHaveBeenCalledTimes(2);
        expect(dispatchCapture.mock.calls[1][0].args).toBe('95 88 72');
    });

    it('runs edited args from the done state', async () => {
        const card = renderCaptureCard('o/r');
        card.querySelector('.captureCardArgs').value = '95 88 72';
        card.querySelector('.captureCardRun').click();
        await flush();
        capturedOnRow({
            status: 'done', exit_code: 0, command: 'python3 main.py -- 95 88 72',
            stdout: 'AVG: 85.0', stderr: '', created_at: new Date().toISOString(),
        });
        // Edit the args in the done state, then Run — the new args dispatch.
        const input = card.querySelector('.captureCardArgs');
        input.value = '1 2 3';
        card.querySelector('.captureCardRun').click();
        await flush();
        expect(dispatchCapture).toHaveBeenCalledTimes(2);
        expect(dispatchCapture.mock.calls[1][0].args).toBe('1 2 3');
    });
});

describe('renderCaptureCard — teardown hook', () => {
    it('exposes _captureTeardown that disposes a mid-run channel', async () => {
        const card = renderCaptureCard('o/r');
        card.querySelector('.captureCardRun').click();
        await flush();
        expect(typeof card._captureTeardown).toBe('function');
        card._captureTeardown();
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
    });
});

describe('renderCaptureCard — dispatch failure', () => {
    it('surfaces a quiet inline error, tears the channel down, and re-enables Run', async () => {
        dispatchResult = { ok: false, reason: 'Server error 500' };
        const card = renderCaptureCard('o/r');
        card.querySelector('.captureCardArgs').value = '1 2 3';
        card.querySelector('.captureCardRun').click();
        await flush();

        const err = card.querySelector('.captureCardError');
        expect(err).toBeTruthy();
        expect(err.textContent).toContain('Server error 500');
        // Back to idle: Run re-enabled and the typed args preserved.
        const run = card.querySelector('.captureCardRun');
        expect(run.disabled).toBe(false);
        expect(card.querySelector('.captureCardArgs').value).toBe('1 2 3');
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);

        // Retry works — a fresh dispatch fires.
        dispatchResult = { ok: true, dispatched: true };
        run.click();
        await flush();
        expect(dispatchCapture).toHaveBeenCalledTimes(2);
    });
});
