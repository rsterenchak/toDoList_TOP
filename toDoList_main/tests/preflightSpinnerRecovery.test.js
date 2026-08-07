import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Regression tests for the preflight Check that never resolved on mobile.
//
// Both Check surfaces — the onboard sub-modal's and the INJECT TARGETS row's
// drift check — used to subscribe with subscribeRunOutputs and then wait for a
// terminal row with no direct read and no timeout, so a single missed realtime
// event left the spinner running forever. Realtime rides a WebSocket and iOS
// Safari drops those when the tab backgrounds, the screen locks, or the network
// moves between cellular and wifi. The `run_outputs` row settles correctly
// either way, so the result exists and was simply never read.
//
// The recovery has four parts, all exercised here WITHOUT any realtime event
// ever firing: a direct read once the dispatch resolves, a re-read when the
// document becomes visible again, a give-up timer that reads once more and then
// reports which case it found, and a Retry that re-reads rather than
// re-dispatching (a second run against the same correlation id 409s on the
// unique constraint).

let capturedOnRow = null;
const returnedChannel = { id: 'ch-preflight-recovery' };
const removeChannel = vi.fn();

// The `run_outputs` read the recovery paths make. `runOutputRow` is the row the
// table currently holds for any correlation id; `runOutputReads` records every
// id read so a test can assert a re-read happened (or didn't).
let runOutputRow = null;
let runOutputError = false;
let runOutputReads = [];

const TARGETS = [
    {
        id: 't1',
        nickname: 'wgu-dsa-prep',
        repo: 'rsterenchak/wgu-dsa-prep',
        file_path: 'TODO.md',
        enabled: true,
        shape: 'console',
    },
];

vi.mock('../src/supabaseClient.js', () => {
    function runOutputsQuery() {
        const chain = {
            select: function () { return chain; },
            eq: function (col, value) {
                if (col === 'correlation_id') runOutputReads.push(value);
                return chain;
            },
            limit: function () {
                if (runOutputError) return Promise.resolve({ data: null, error: { message: 'boom' } });
                return Promise.resolve({ data: runOutputRow ? [runOutputRow] : [], error: null });
            },
        };
        return chain;
    }
    function query(table) {
        if (table === 'run_outputs') return runOutputsQuery();
        return {
            select: function () {
                if (table === 'inject_targets') {
                    return {
                        order: function () {
                            return Promise.resolve({ data: TARGETS.map((t) => ({ ...t })), error: null });
                        },
                    };
                }
                return Promise.resolve({ data: [], error: null });
            },
            insert: function () { return Promise.resolve({ data: null, error: null }); },
            update: function () { return this; },
            delete: function () { return this; },
            eq: function () { return Promise.resolve({ data: null, error: null }); },
            order: function () { return Promise.resolve({ data: [], error: null }); },
        };
    }
    return {
        supabase: {
            auth: {
                getSession: function () {
                    return Promise.resolve({ data: { session: null }, error: null });
                },
                onAuthStateChange: function () {
                    return { data: { subscription: { unsubscribe: function () {} } } };
                },
            },
            from: function (table) { return query(table); },
            channel: function () {
                return {
                    on: function (event, filter, cb) { capturedOnRow = cb; return this; },
                    subscribe: function () { return returnedChannel; },
                };
            },
            removeChannel: function (...a) { return removeChannel(...a); },
        },
    };
});

import { readRunOutput, showInjectSettingsModal, initInjectConfig } from '../src/inject.js';

// Matches PREFLIGHT_GIVE_UP_MS in inject.js — the wait before a Check stops
// trusting the socket and reports what it can read.
const GIVE_UP_MS = 45000;

const REPORT = {
    repo: 'rsterenchak/new-repo',
    shape: 'console',
    purpose: 'personal',
    warnings: [],
    create: ['.claude/routine.md', 'TODO.md'],
};

function terminalRow(report, status) {
    return { status: status || 'done', stdout: JSON.stringify(report || REPORT) };
}

let fetchSpy;
let realFetch;

// Fake timers drive the give-up path; advanceTimersByTimeAsync also drains the
// microtask queue, so it doubles as the async flush the modal code needs.
async function flush(ms) {
    await vi.advanceTimersByTimeAsync(ms === undefined ? 1 : ms);
}

function preflightPosts() {
    return fetchSpy.mock.calls.filter((c) => {
        try { return JSON.parse(c[1].body).preflight; } catch (e) { return false; }
    });
}

function lastCorrelationId() {
    const calls = preflightPosts();
    return calls.length ? JSON.parse(calls[calls.length - 1][1].body).correlation_id : null;
}

function setVisibilityState(state) {
    Object.defineProperty(document, 'visibilityState', {
        value: state, writable: true, configurable: true,
    });
}

function setVisibility(state) {
    setVisibilityState(state);
    document.dispatchEvent(new Event('visibilitychange'));
}

// jsdom's document is shared across tests, so a modal left mounted would keep
// its visibilitychange listener into the next one. Close through the real
// controls rather than blanking the body, which is also what a leak would look
// like in the app.
function closeOpenModals() {
    const onboardCancel = document.getElementById('injectOnboardCancel');
    if (onboardCancel) onboardCancel.click();
    const settingsClose = document.getElementById('injectSettingsClose');
    if (settingsClose) settingsClose.click();
}

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();

    realFetch = globalThis.fetch;
    fetchSpy = vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ dispatched: true }),
    }));
    globalThis.fetch = fetchSpy;

    capturedOnRow = null;
    runOutputRow = null;
    runOutputError = false;
    runOutputReads = [];
    removeChannel.mockClear();
    document.body.innerHTML = '';
    setVisibilityState('visible');
});

afterEach(() => {
    closeOpenModals();
    globalThis.fetch = realFetch;
    localStorage.clear();
    initInjectConfig();
    document.body.innerHTML = '';
    vi.useRealTimers();
});

// ── ONBOARD SUB-MODAL HARNESS ──

function verdictHost() {
    return document.getElementById('injectOnboardVerdict');
}

function verdictText() {
    const host = verdictHost();
    return host ? host.textContent : '';
}

function isSpinning() {
    const host = verdictHost();
    return !!(host && host.querySelector('.injectOnboardSpinner'));
}

function retryButton() {
    const host = verdictHost();
    return host ? host.querySelector('.injectOnboardVerdictRetry') : null;
}

// Open the sub-modal and run Check to the point where the dispatch has resolved
// and the direct read (if any) has settled. NO realtime row is ever emitted.
async function runOnboardCheck(repo) {
    showInjectSettingsModal();
    await flush();
    document.getElementById('injectOnboardCard').click();
    document.getElementById('injectOnboardRepoInput').value = repo || 'rsterenchak/new-repo';
    document.getElementById('injectOnboardCheck').click();
    await flush();
}

describe('readRunOutput — direct read of a run_outputs row', () => {
    it('returns the row for a correlation id', async () => {
        runOutputRow = terminalRow();
        const row = await readRunOutput('corr-1');
        expect(row).toEqual(terminalRow());
        expect(runOutputReads).toEqual(['corr-1']);
    });

    it('returns null when no row exists for that correlation id', async () => {
        runOutputRow = null;
        expect(await readRunOutput('corr-2')).toBeNull();
    });

    it('returns null when the read errors, rather than throwing', async () => {
        runOutputError = true;
        expect(await readRunOutput('corr-3')).toBeNull();
    });

    it('does not read at all without a correlation id', async () => {
        expect(await readRunOutput('')).toBeNull();
        expect(runOutputReads).toEqual([]);
    });
});

describe('onboard Check — resolves from a direct read when realtime never fires', () => {
    it('renders the report from the row that already settled, with no realtime event', async () => {
        runOutputRow = terminalRow();
        await runOnboardCheck();
        expect(runOutputReads).toContain(lastCorrelationId());
        expect(isSpinning()).toBe(false);
        expect(verdictText()).toContain('rsterenchak/new-repo');
        expect(document.getElementById('injectOnboardCheck').disabled).toBe(false);
    });

    it('disposes the channel once the direct read settles it', async () => {
        runOutputRow = terminalRow();
        await runOnboardCheck();
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
    });

    it('keeps waiting when the row is still running', async () => {
        runOutputRow = { status: 'running', stdout: '' };
        await runOnboardCheck();
        expect(isSpinning()).toBe(true);
        expect(document.getElementById('injectOnboardCheck').disabled).toBe(true);
    });

    it('does not render twice when a realtime event arrives after the read settled', async () => {
        runOutputRow = terminalRow();
        await runOnboardCheck();
        const before = verdictText();
        capturedOnRow({ new: terminalRow({ ...REPORT, repo: 'rsterenchak/other' }) });
        await flush();
        expect(verdictText()).toBe(before);
        expect(verdictText()).not.toContain('rsterenchak/other');
    });
});

describe('onboard Check — visibilitychange re-read', () => {
    it('re-reads on returning to the tab and settles on a terminal row', async () => {
        runOutputRow = { status: 'running', stdout: '' };
        await runOnboardCheck();
        expect(isSpinning()).toBe(true);
        const reads = runOutputReads.length;

        runOutputRow = terminalRow();
        setVisibility('visible');
        await flush();

        expect(runOutputReads.length).toBeGreaterThan(reads);
        expect(isSpinning()).toBe(false);
        expect(verdictText()).toContain('rsterenchak/new-repo');
    });

    it('does not re-read when the document is going hidden', async () => {
        runOutputRow = { status: 'running', stdout: '' };
        await runOnboardCheck();
        const reads = runOutputReads.length;
        setVisibility('hidden');
        await flush();
        expect(runOutputReads.length).toBe(reads);
    });

    it('removes the listener on close, so a closed modal stops re-reading', async () => {
        runOutputRow = { status: 'running', stdout: '' };
        await runOnboardCheck();
        document.getElementById('injectOnboardCancel').click();
        await flush();
        const reads = runOutputReads.length;
        setVisibility('visible');
        await flush();
        expect(runOutputReads.length).toBe(reads);
    });
});

describe('onboard Check — give-up timer', () => {
    it('reports the run may still be in flight when the row is still running', async () => {
        runOutputRow = { status: 'running', stdout: '' };
        await runOnboardCheck();
        await flush(GIVE_UP_MS);
        expect(isSpinning()).toBe(false);
        expect(verdictText()).toContain('may still be in flight');
        expect(document.getElementById('injectOnboardCheck').disabled).toBe(false);
    });

    it('reports nothing was recorded when there is no row at all', async () => {
        runOutputRow = null;
        await runOnboardCheck();
        await flush(GIVE_UP_MS);
        expect(isSpinning()).toBe(false);
        expect(verdictText()).toContain('nothing was recorded');
    });

    it('renders the report instead of an error when the give-up read finds it terminal', async () => {
        runOutputRow = { status: 'running', stdout: '' };
        await runOnboardCheck();
        runOutputRow = terminalRow();
        await flush(GIVE_UP_MS);
        expect(verdictText()).toContain('rsterenchak/new-repo');
        expect(verdictText()).not.toContain('nothing was recorded');
        expect(retryButton()).toBeNull();
    });

    it('offers a Retry that re-reads without re-dispatching', async () => {
        runOutputRow = null;
        await runOnboardCheck();
        await flush(GIVE_UP_MS);
        const retry = retryButton();
        expect(retry).toBeTruthy();

        const dispatches = preflightPosts().length;
        const reads = runOutputReads.length;
        runOutputRow = terminalRow();
        retry.click();
        await flush();

        expect(preflightPosts().length).toBe(dispatches);
        expect(runOutputReads.length).toBeGreaterThan(reads);
        expect(verdictText()).toContain('rsterenchak/new-repo');
    });

    it('re-offers Retry when the re-read still finds nothing', async () => {
        runOutputRow = null;
        await runOnboardCheck();
        await flush(GIVE_UP_MS);
        retryButton().click();
        await flush();
        expect(verdictText()).toContain('nothing was recorded');
        expect(retryButton()).toBeTruthy();
    });

    it('does not fire after a realtime row already settled the check', async () => {
        runOutputRow = { status: 'running', stdout: '' };
        await runOnboardCheck();
        capturedOnRow({ new: terminalRow() });
        await flush();
        expect(verdictText()).toContain('rsterenchak/new-repo');
        await flush(GIVE_UP_MS);
        expect(verdictText()).toContain('rsterenchak/new-repo');
        expect(verdictText()).not.toContain('may still be in flight');
    });

    it('is cleared on close, so a closed modal never renders a give-up verdict', async () => {
        runOutputRow = { status: 'running', stdout: '' };
        await runOnboardCheck();
        document.getElementById('injectOnboardCancel').click();
        await flush(GIVE_UP_MS);
        expect(document.getElementById('injectOnboardModal')).toBeNull();
    });
});

// ── INJECT TARGET ROW DRIFT CHECK ──

async function openSettings() {
    showInjectSettingsModal();
    await flush();
}

function rowCheckButton() {
    return document.querySelector('#injectTargetsList [aria-label^="Check "]');
}

function rowVerdict() {
    const host = document.querySelector('#injectTargetsList .injectTargetVerdict');
    return host ? host.textContent : '';
}

async function runRowCheck() {
    await openSettings();
    rowCheckButton().click();
    await flush();
}

describe('target row drift check — same recovery', () => {
    it('resolves from the direct read when realtime never fires', async () => {
        runOutputRow = terminalRow({ ...REPORT, repo: 'rsterenchak/wgu-dsa-prep' });
        await runRowCheck();
        expect(runOutputReads).toContain(lastCorrelationId());
        expect(rowVerdict()).toContain('.claude/routine.md');
        expect(rowCheckButton().querySelector('.injectOnboardSpinner')).toBeNull();
    });

    it('re-reads on returning to the tab', async () => {
        runOutputRow = { status: 'running', stdout: '' };
        await runRowCheck();
        const reads = runOutputReads.length;
        runOutputRow = terminalRow({ ...REPORT, repo: 'rsterenchak/wgu-dsa-prep' });
        setVisibility('visible');
        await flush();
        expect(runOutputReads.length).toBeGreaterThan(reads);
        expect(rowVerdict()).toContain('.claude/routine.md');
    });

    it('gives up with the distinguishing reason and a Retry that re-reads', async () => {
        runOutputRow = null;
        await runRowCheck();
        await flush(GIVE_UP_MS);
        expect(rowVerdict()).toContain('nothing was recorded');

        const dispatches = preflightPosts().length;
        runOutputRow = terminalRow({ ...REPORT, repo: 'rsterenchak/wgu-dsa-prep' });
        document.querySelector('.injectOnboardVerdictRetry').click();
        await flush();
        expect(preflightPosts().length).toBe(dispatches);
        expect(rowVerdict()).toContain('.claude/routine.md');
    });

    it('re-enables the row Check button when it gives up', async () => {
        runOutputRow = { status: 'running', stdout: '' };
        await runRowCheck();
        expect(rowCheckButton().disabled).toBe(true);
        await flush(GIVE_UP_MS);
        expect(rowCheckButton().disabled).toBe(false);
        expect(rowVerdict()).toContain('may still be in flight');
    });

    it('drops its timer and listener when the settings modal closes', async () => {
        runOutputRow = { status: 'running', stdout: '' };
        await runRowCheck();
        document.getElementById('injectSettingsClose').click();
        await flush();
        const reads = runOutputReads.length;
        setVisibility('visible');
        await flush(GIVE_UP_MS);
        expect(runOutputReads.length).toBe(reads);
        expect(document.getElementById('injectSettingsModal')).toBeNull();
    });
});
