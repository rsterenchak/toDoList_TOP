import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Tests for the refresh actions on an INJECT TARGETS row's Check verdict —
// one button per onboard refresh level, each dispatching the same onboard
// call the sub-modal's Onboard sends, labelled by what it would do to the
// report it sits under.
//
// Same harness as injectTargetDriftCheck.test.js: the settings modal mounted
// in jsdom against a mocked supabaseClient, the realtime `run_outputs` rows
// fed through the captured subscription callback, and the Worker reached
// through a fetch spy whose onboard response each test can steer.

let capturedOnRow = null;
const returnedChannel = { id: 'ch-row-refresh' };
const targetsReads = vi.fn();

const TARGETS = [
    {
        id: 't1',
        nickname: 'wgu-dsa-prep',
        repo: 'rsterenchak/wgu-dsa-prep',
        file_path: 'TODO.md',
        enabled: true,
        shape: 'console',
        purpose: 'assignment',
    },
    {
        id: 't2',
        nickname: 'test-repo-only',
        repo: 'rsterenchak/test-repo-only',
        file_path: 'TODO.md',
        enabled: true,
    },
    // The global-defaults sentinel — never a real repo to refresh.
    {
        id: 't3',
        nickname: 'defaults',
        repo: '*',
        file_path: 'TODO.md',
        enabled: true,
    },
];

vi.mock('../src/supabaseClient.js', () => {
    function query(table) {
        const chain = {
            select: function () {
                if (table === 'inject_targets') {
                    targetsReads();
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
        return chain;
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
            removeChannel: function () {},
        },
    };
});

import { showInjectSettingsModal, initInjectConfig } from '../src/inject.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

let fetchSpy;
let realFetch;
// How the fetch spy answers an onboard dispatch: 'ok' or 'fail'.
let onboardOutcome;

function onboardBodies() {
    return fetchSpy.mock.calls
        .map((c) => { try { return JSON.parse(c[1].body); } catch (e) { return null; } })
        .filter((b) => b && b.onboard);
}

beforeEach(() => {
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();

    onboardOutcome = 'ok';
    realFetch = globalThis.fetch;
    fetchSpy = vi.fn((url, init) => {
        let body = null;
        try { body = JSON.parse(init.body); } catch (e) { /* not JSON */ }
        if (body && body.onboard && onboardOutcome === 'fail') {
            return Promise.reject(new Error('offline'));
        }
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ dispatched: true }),
        });
    });
    globalThis.fetch = fetchSpy;

    capturedOnRow = null;
    targetsReads.mockClear();
    document.body.innerHTML = '';
});

afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    initInjectConfig();
    document.body.innerHTML = '';
});

async function openSettings() {
    showInjectSettingsModal();
    await flush();
    return document.getElementById('injectTargetsList');
}

function rows() {
    return Array.from(document.querySelectorAll('#injectTargetsList .injectTargetRow'));
}

function rowFor(repo) {
    return rows().find((row) => row.querySelector('.injectTargetDetail').textContent.startsWith(repo + ' '));
}

async function checkRow(row, stdout) {
    row.querySelector('[aria-label^="Check "]').click();
    await flush();
    capturedOnRow({ new: { status: 'done', stdout: stdout } });
    await flush();
    return row.querySelector('.injectTargetVerdict');
}

const MIXED = {
    repo: 'rsterenchak/wgu-dsa-prep',
    shape: 'console',
    purpose: 'assignment',
    warnings: [],
    create: ['TODO.md'],
    stale: [
        { file: '.claude/routine.md', lines: 12, local_edits: 'no' },
        { file: '.claude/derive.md', lines: 40, local_edits: 'yes' },
    ],
};

function buttons(host) {
    return Array.from(host.querySelectorAll('.injectTargetRefreshActions .injectTargetRefreshBtn'));
}

describe('inject target row — refresh actions', () => {
    it('renders one button per level with the counts, primary on safe and danger on all', async () => {
        await openSettings();
        const host = await checkRow(rowFor('rsterenchak/wgu-dsa-prep'), JSON.stringify(MIXED));
        const btns = buttons(host);
        expect(btns.map((b) => b.textContent)).toEqual(['Create 1 missing', 'Refresh 1 safe', 'Refresh all 2']);
        btns.forEach((b) => {
            expect(b.type).toBe('button');
            expect(b.classList.contains('injectSettingsBtn')).toBe(true);
        });
        expect(btns[1].classList.contains('injectSettingsBtn--primary')).toBe(true);
        expect(btns[2].classList.contains('injectSettingsBtn--danger')).toBe(true);
        expect(btns[2].title).toBe('Overwrites every stale file, local edits included.');
        expect(btns[1].title).toBe('Refresh 1 stale file nobody edited; also creates 1 missing');
        // Sits after the verdict body and before the dismiss.
        const kids = Array.from(host.children);
        const actions = host.querySelector('.injectTargetRefreshActions');
        const dismiss = host.querySelector('.injectTargetVerdictDismiss');
        expect(kids.indexOf(actions)).toBeLessThan(kids.indexOf(dismiss));
    });

    it('renders only the safe refresh when every stale file is unedited and nothing is missing', async () => {
        await openSettings();
        const host = await checkRow(rowFor('rsterenchak/wgu-dsa-prep'), JSON.stringify({
            ...MIXED,
            create: [],
            stale: [
                { file: '.claude/routine.md', lines: 12, local_edits: 'no' },
                { file: '.claude/derive.md', lines: 40, local_edits: 'no' },
            ],
        }));
        expect(buttons(host).map((b) => b.textContent)).toEqual(['Refresh 2 safe']);
    });

    it('renders no actions on a clean report', async () => {
        await openSettings();
        const host = await checkRow(rowFor('rsterenchak/wgu-dsa-prep'), JSON.stringify({
            ...MIXED, create: [], stale: [],
        }));
        expect(host.querySelector('.injectOnboardVerdictClean')).toBeTruthy();
        expect(host.querySelector('.injectTargetRefreshActions')).toBeNull();
    });

    it('renders no actions on an error verdict', async () => {
        await openSettings();
        const host = await checkRow(rowFor('rsterenchak/wgu-dsa-prep'), 'not json');
        expect(host.hidden).toBe(false);
        expect(host.querySelector('.injectTargetRefreshActions')).toBeNull();
    });

    it('renders no actions on the global-defaults sentinel row', async () => {
        await openSettings();
        const row = rowFor('*');
        expect(row).toBeTruthy();
        const host = await checkRow(row, JSON.stringify({ ...MIXED, repo: '*' }));
        expect(host.querySelector('.injectOnboardVerdictChip')).toBeTruthy();
        expect(host.querySelector('.injectTargetRefreshActions')).toBeNull();
    });

    it('sends each button\'s level with the registry row\'s shape and purpose', async () => {
        for (const [label, level] of [['Refresh 1 safe', 'stale'], ['Refresh all 2', 'all'], ['Create 1 missing', 'none']]) {
            document.body.innerHTML = '';
            fetchSpy.mockClear();
            await openSettings();
            const host = await checkRow(rowFor('rsterenchak/wgu-dsa-prep'), JSON.stringify(MIXED));
            buttons(host).find((b) => b.textContent === label).click();
            await flush();
            const sent = onboardBodies();
            expect(sent.length).toBe(1);
            expect(sent[0].target_repo).toBe('rsterenchak/wgu-dsa-prep');
            expect(sent[0].shape).toBe('console');
            expect(sent[0].purpose).toBe('assignment');
            expect(sent[0].refresh).toBe(level);
            document.getElementById('injectSettingsClose').click();
        }
    });

    it('falls back to auto / personal when the registry row carries neither', async () => {
        await openSettings();
        const host = await checkRow(rowFor('rsterenchak/test-repo-only'), JSON.stringify({
            ...MIXED, repo: 'rsterenchak/test-repo-only',
        }));
        buttons(host)[0].click();
        await flush();
        const sent = onboardBodies();
        expect(sent[0].shape).toBe('auto');
        expect(sent[0].purpose).toBe('personal');
    });

    it('replaces the actions with the started line and toasts, without polling the registry', async () => {
        await openSettings();
        const host = await checkRow(rowFor('rsterenchak/wgu-dsa-prep'), JSON.stringify(MIXED));
        const readsBefore = targetsReads.mock.calls.length;
        buttons(host)[1].click();
        await flush(8);
        expect(host.querySelector('.injectTargetRefreshActions')).toBeNull();
        const started = host.querySelector('.injectTargetRefreshStarted');
        expect(started).toBeTruthy();
        expect(started.textContent).toBe('Refresh started — run Check again in about a minute to confirm.');
        const toast = document.getElementById('injectToast');
        expect(toast.textContent).toBe('Refresh started for wgu-dsa-prep');
        expect(toast.classList.contains('injectToast--error')).toBe(false);
        expect(targetsReads.mock.calls.length).toBe(readsBefore);
        // The dismiss still clears the verdict.
        host.querySelector('.injectTargetVerdictDismiss').click();
        expect(host.hidden).toBe(true);
    });

    it('disables the buttons while dispatching, then re-enables them and toasts the error on failure', async () => {
        onboardOutcome = 'fail';
        await openSettings();
        const host = await checkRow(rowFor('rsterenchak/wgu-dsa-prep'), JSON.stringify(MIXED));
        const btns = buttons(host);
        btns[0].click();
        expect(btns.every((b) => b.disabled)).toBe(true);
        await flush();
        expect(btns.every((b) => b.disabled === false)).toBe(true);
        expect(host.querySelector('.injectTargetRefreshStarted')).toBeNull();
        const toast = document.getElementById('injectToast');
        expect(toast.classList.contains('injectToast--error')).toBe(true);
        expect(toast.textContent).toBeTruthy();
    });

    it('leaves the row\'s Check enabled while a refresh dispatch is pending', async () => {
        await openSettings();
        const row = rowFor('rsterenchak/wgu-dsa-prep');
        const host = await checkRow(row, JSON.stringify(MIXED));
        buttons(host)[0].click();
        expect(row.querySelector('[aria-label^="Check "]').disabled).toBe(false);
        await flush();
    });
});
