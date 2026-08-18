import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Tests for the per-row drift check on the INJECT TARGETS rows — the same
// report-only preflight the onboard sub-modal's Check runs, aimed at an
// already-onboarded repo to see which scaffold files have gone missing since.
//
// The settings modal is mounted in jsdom against a mocked supabaseClient whose
// `inject_targets` read returns a fixed two-row registry, and the realtime
// `run_outputs` rows are fed in through the captured subscribeRunOutputs
// callback — the same harness shape onboardPreflight.test.js uses.

let capturedOnRow = null;
const returnedChannel = { id: 'ch-row-preflight' };
const removeChannel = vi.fn();
const channelFor = vi.fn();

const TARGETS = [
    {
        id: 't1',
        nickname: 'wgu-dsa-prep',
        repo: 'rsterenchak/wgu-dsa-prep',
        file_path: 'TODO.md',
        enabled: true,
        shape: 'console',
    },
    {
        id: 't2',
        nickname: 'test-repo-only',
        repo: 'rsterenchak/test-repo-only',
        file_path: 'TODO.md',
        enabled: true,
    },
    // Carries the `purpose` column the registry row now serializes — an
    // assignment repo expects five more scaffold files than a personal one.
    {
        id: 't3',
        nickname: 'wgu-coursework',
        repo: 'rsterenchak/wgu-coursework',
        file_path: 'TODO.md',
        enabled: true,
        shape: 'web',
        purpose: 'assignment',
    },
];

vi.mock('../src/supabaseClient.js', () => {
    function query(table) {
        const chain = {
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
            channel: function (name) {
                channelFor(name);
                return {
                    on: function (event, filter, cb) { capturedOnRow = cb; return this; },
                    subscribe: function () { return returnedChannel; },
                };
            },
            removeChannel: function (...a) { return removeChannel(...a); },
        },
    };
});

import { showInjectSettingsModal, initInjectConfig } from '../src/inject.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

let fetchSpy;
let realFetch;

function lastPreflightBody() {
    const calls = fetchSpy.mock.calls.filter((c) => {
        try { return JSON.parse(c[1].body).preflight; } catch (e) { return false; }
    });
    return calls.length ? JSON.parse(calls[calls.length - 1][1].body) : null;
}

beforeEach(() => {
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
    removeChannel.mockClear();
    channelFor.mockClear();
    document.body.innerHTML = '';
});

afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    initInjectConfig();
    document.body.innerHTML = '';
});

// Mount the settings modal and let the async target load settle so the rows
// are rendered from the registry.
async function openSettings() {
    showInjectSettingsModal();
    await flush();
    return document.getElementById('injectTargetsList');
}

function rows() {
    return Array.from(document.querySelectorAll('#injectTargetsList .injectTargetRow'));
}

function checkButtons() {
    return Array.from(document.querySelectorAll('#injectTargetsList .injectTargetRow'))
        .map((row) => row.querySelector('[aria-label^="Check "]'));
}

// Feed one live `run_outputs` row through the captured subscription wrapper,
// which reads `payload.new`.
async function emitRow(row) {
    capturedOnRow({ new: row });
    await flush();
}

async function settleWith(report, status) {
    await emitRow({ status: status || 'done', stdout: JSON.stringify(report) });
}

const DRIFT = {
    repo: 'rsterenchak/wgu-dsa-prep',
    shape: 'console',
    purpose: 'personal',
    warnings: [],
    create: ['.claude/routine.md', 'TODO.md', 'scripts/gen-src-manifest.js'],
};

describe('inject target rows — Check control', () => {
    it('renders a Check icon button on each row, left of the edit pencil', async () => {
        await openSettings();
        const list = rows();
        expect(list.length).toBe(3);
        list.forEach((row, i) => {
            const check = row.querySelector('[aria-label="Check ' + TARGETS[i].nickname + '"]');
            expect(check).toBeTruthy();
            expect(check.classList.contains('injectTargetIconBtn')).toBe(true);
            const kids = Array.from(row.children);
            const edit = row.querySelector('[aria-label^="Edit target"]');
            const trash = row.querySelector('[aria-label^="Delete target"]');
            expect(kids.indexOf(check)).toBeLessThan(kids.indexOf(edit));
            expect(kids.indexOf(edit)).toBeLessThan(kids.indexOf(trash));
        });
    });

    it('mounts an empty, hidden verdict host inside the row', async () => {
        await openSettings();
        const host = rows()[0].querySelector('.injectTargetVerdict');
        expect(host).toBeTruthy();
        expect(host.parentNode).toBe(rows()[0]);
        expect(host.hidden).toBe(true);
        expect(host.textContent).toBe('');
    });

    it('dispatches preflight for that row\'s repo with the registry shape and purpose', async () => {
        await openSettings();
        checkButtons()[2].click();
        await flush();
        const body = lastPreflightBody();
        expect(body.preflight).toBe(true);
        expect(body.target_repo).toBe('rsterenchak/wgu-coursework');
        expect(body.shape).toBe('web');
        expect(body.purpose).toBe('assignment');
        expect(body.correlation_id).toBeTruthy();
        expect(channelFor).toHaveBeenCalledWith('run_outputs:' + body.correlation_id);
    });

    it('falls back to personal when the registry row carries no purpose', async () => {
        await openSettings();
        checkButtons()[0].click();
        await flush();
        const body = lastPreflightBody();
        expect(body.target_repo).toBe('rsterenchak/wgu-dsa-prep');
        expect(body.shape).toBe('console');
        expect(body.purpose).toBe('personal');
    });

    it('falls back to auto when the registry row carries no shape', async () => {
        await openSettings();
        checkButtons()[1].click();
        await flush();
        const body = lastPreflightBody();
        expect(body.target_repo).toBe('rsterenchak/test-repo-only');
        expect(body.shape).toBe('auto');
    });

    it('swaps the icon for a spinner and disables every row\'s Check while running', async () => {
        await openSettings();
        const [first, second] = checkButtons();
        first.click();
        await flush();
        expect(first.querySelector('.injectOnboardSpinner')).toBeTruthy();
        expect(first.querySelector('svg')).toBeNull();
        expect(first.disabled).toBe(true);
        expect(second.disabled).toBe(true);

        await settleWith(DRIFT);
        expect(first.querySelector('.injectOnboardSpinner')).toBeNull();
        expect(first.querySelector('svg')).toBeTruthy();
        expect(first.disabled).toBe(false);
        expect(second.disabled).toBe(false);
    });

    it('expands the verdict beneath the row in its expanded form, listing drift as chips', async () => {
        await openSettings();
        checkButtons()[0].click();
        await flush();
        await settleWith(DRIFT);

        const host = rows()[0].querySelector('.injectTargetVerdict');
        expect(host.hidden).toBe(false);
        const expanded = host.querySelector('.injectOnboardVerdictExpanded');
        expect(expanded).toBeTruthy();
        // Expanded form only — no collapsed summary strip to tap open.
        expect(expanded.hidden).toBe(false);
        expect(host.querySelector('.injectOnboardVerdictStrip[aria-expanded]')).toBeNull();
        expect(Array.from(host.querySelectorAll('.injectOnboardVerdictChip')).map((c) => c.textContent))
            .toEqual(['.claude/routine.md', 'TODO.md', 'scripts/gen-src-manifest.js']);
        // The other row is untouched.
        expect(rows()[1].querySelector('.injectTargetVerdict').hidden).toBe(true);
    });

    it('shows a single up-to-date line when nothing is missing', async () => {
        await openSettings();
        checkButtons()[1].click();
        await flush();
        await settleWith({
            repo: 'rsterenchak/test-repo-only', shape: 'repo', purpose: 'personal',
            warnings: [], create: [],
        });
        const host = rows()[1].querySelector('.injectTargetVerdict');
        const clean = host.querySelectorAll('.injectOnboardVerdictClean');
        expect(clean.length).toBe(1);
        expect(clean[0].textContent).toContain('Up to date');
        expect(host.querySelector('.injectOnboardVerdictChip')).toBeNull();
    });

    // The check now sends the row's own purpose, so the count is right for the
    // repo as registered and the caveat that used to hedge it is gone.
    it('renders no purpose caveat on the verdict', async () => {
        await openSettings();
        checkButtons()[0].click();
        await flush();
        await settleWith(DRIFT);
        expect(rows()[0].querySelector('.injectOnboardVerdictNote')).toBeNull();
    });

    it('renders warnings as rows alongside the missing-file chips', async () => {
        await openSettings();
        checkButtons()[0].click();
        await flush();
        await settleWith({
            repo: 'rsterenchak/wgu-dsa-prep', shape: 'console', purpose: 'personal',
            warnings: ['No test script defined'], create: ['TODO.md'],
        });
        const host = rows()[0].querySelector('.injectTargetVerdict');
        const warnRows = host.querySelectorAll('.injectOnboardVerdictWarning');
        expect(warnRows.length).toBe(1);
        expect(warnRows[0].textContent).toBe('No test script defined');
        expect(host.querySelectorAll('.injectOnboardVerdictChip').length).toBe(1);
    });

    it('renders one stale row per entry, between the warnings and the missing chips', async () => {
        await openSettings();
        checkButtons()[0].click();
        await flush();
        await settleWith({
            repo: 'rsterenchak/wgu-dsa-prep', shape: 'console', purpose: 'personal',
            warnings: ['No test script defined'],
            create: ['TODO.md'],
            stale: [
                { file: '.claude/derive.md', lines: 87, src: 'src', test: 'tests' },
                { file: '.claude/routine.md', lines: 12, src: 'src', test: 'tests' },
            ],
        });
        const host = rows()[0].querySelector('.injectTargetVerdict');
        const staleRows = Array.from(host.querySelectorAll('.injectOnboardVerdictStale'));
        expect(staleRows.length).toBe(2);
        expect(staleRows[0].textContent).toContain('.claude/derive.md — 87 lines behind');
        expect(staleRows[1].textContent).toContain('.claude/routine.md — 12 lines behind');
        // The inferred directories ride along in their own dimmer span.
        const dirs = staleRows[0].querySelector('.injectOnboardVerdictStaleDirs');
        expect(dirs.textContent).toBe('src src · test tests');
        // Rows, not chips — the missing-file chips still list only TODO.md.
        expect(Array.from(host.querySelectorAll('.injectOnboardVerdictChip')).map((c) => c.textContent))
            .toEqual(['TODO.md']);
        // Ordered warnings → stale → missing chips inside the expanded section.
        const expanded = host.querySelector('.injectOnboardVerdictExpanded');
        const kids = Array.from(expanded.children);
        expect(kids.indexOf(expanded.querySelector('.injectOnboardVerdictWarning')))
            .toBeLessThan(kids.indexOf(staleRows[0]));
        expect(kids.indexOf(staleRows[1]))
            .toBeLessThan(kids.indexOf(expanded.querySelector('.injectOnboardVerdictChips')));
    });

    it('shows a stale entry\'s reason in place of the line count', async () => {
        await openSettings();
        checkButtons()[0].click();
        await flush();
        await settleWith({
            repo: 'rsterenchak/wgu-dsa-prep', shape: 'console', purpose: 'personal',
            warnings: [], create: [],
            stale: [
                { file: '.claude/style.md', lines: null, reason: 'predates the id marker' },
                { file: '.claude/routine.md', lines: null },
            ],
        });
        const staleRows = rows()[0].querySelectorAll('.injectOnboardVerdictStale');
        expect(staleRows[0].textContent).toBe('.claude/style.md — predates the id marker');
        // No reason and no count — the file simply predates the template.
        expect(staleRows[1].textContent).toBe('.claude/routine.md — predates the current template');
    });

    it('is not clean when the report carries only stale entries', async () => {
        await openSettings();
        checkButtons()[0].click();
        await flush();
        await settleWith({
            repo: 'rsterenchak/wgu-dsa-prep', shape: 'console', purpose: 'personal',
            warnings: [], create: [],
            stale: [{ file: '.claude/derive.md', lines: 87 }],
        });
        const host = rows()[0].querySelector('.injectTargetVerdict');
        expect(host.querySelector('.injectOnboardVerdictClean')).toBeNull();
        expect(host.querySelectorAll('.injectOnboardVerdictStale').length).toBe(1);
    });

    // An older onboard.sh sends no `stale` key at all.
    it('renders a report without a stale key exactly as before', async () => {
        await openSettings();
        checkButtons()[1].click();
        await flush();
        await settleWith({
            repo: 'rsterenchak/test-repo-only', shape: 'repo', purpose: 'personal',
            warnings: [], create: [],
        });
        const host = rows()[1].querySelector('.injectTargetVerdict');
        expect(host.querySelectorAll('.injectOnboardVerdictStale').length).toBe(0);
        const clean = host.querySelectorAll('.injectOnboardVerdictClean');
        expect(clean.length).toBe(1);
        expect(clean[0].textContent).toBe('Up to date — nothing missing, nothing behind.');
    });

    it('persists the verdict until dismissed', async () => {
        await openSettings();
        checkButtons()[0].click();
        await flush();
        await settleWith(DRIFT);
        const host = rows()[0].querySelector('.injectTargetVerdict');
        expect(host.hidden).toBe(false);

        const dismiss = host.querySelector('.injectTargetVerdictDismiss');
        expect(dismiss.getAttribute('aria-label')).toBe('Dismiss check result for wgu-dsa-prep');
        dismiss.click();
        expect(host.hidden).toBe(true);
        expect(host.textContent).toBe('');
    });

    it('replaces the prior verdict when Check is re-run on that row', async () => {
        await openSettings();
        checkButtons()[0].click();
        await flush();
        await settleWith(DRIFT);
        expect(rows()[0].querySelectorAll('.injectOnboardVerdictChip').length).toBe(3);

        checkButtons()[0].click();
        await flush();
        // The prior verdict is cleared while the re-run is in flight, not stacked.
        expect(rows()[0].querySelector('.injectTargetVerdict').hidden).toBe(true);
        await settleWith({
            repo: 'rsterenchak/wgu-dsa-prep', shape: 'console', purpose: 'personal',
            warnings: [], create: ['TODO.md'],
        });
        expect(rows()[0].querySelectorAll('.injectOnboardVerdictChip').length).toBe(1);
    });

    it('renders a quiet failure — never raw JSON — when stdout is not a report', async () => {
        await openSettings();
        checkButtons()[0].click();
        await flush();
        await emitRow({ status: 'done', stdout: 'Run onboard.sh\nexit 0' });
        const host = rows()[0].querySelector('.injectTargetVerdict');
        expect(host.querySelector('.injectOnboardVerdictStrip--static')).toBeTruthy();
        expect(host.textContent).toContain('readable report');
        expect(host.querySelector('.injectOnboardVerdictExpanded')).toBeNull();
        expect(checkButtons()[0].disabled).toBe(false);
    });

    it('surfaces a dispatch failure on the row and re-enables the buttons', async () => {
        await openSettings();
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: false, status: 500, text: () => Promise.resolve('boom'),
        }));
        checkButtons()[0].click();
        await flush();
        const host = rows()[0].querySelector('.injectTargetVerdict');
        expect(host.hidden).toBe(false);
        expect(host.querySelector('.injectOnboardVerdictGlyph--warn')).toBeTruthy();
        expect(checkButtons()[0].disabled).toBe(false);
        expect(checkButtons()[1].disabled).toBe(false);
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
    });
});

describe('inject target rows — Check teardown', () => {
    it('disposes the row channel on the terminal row', async () => {
        await openSettings();
        removeChannel.mockClear();
        checkButtons()[0].click();
        await flush();
        expect(removeChannel).not.toHaveBeenCalled();
        await settleWith(DRIFT);
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
    });

    it('disposes an in-flight row channel when the settings modal closes', async () => {
        await openSettings();
        removeChannel.mockClear();
        checkButtons()[0].click();
        await flush();
        expect(removeChannel).not.toHaveBeenCalled();
        document.getElementById('injectSettingsClose').click();
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
        expect(document.getElementById('injectSettingsBackdrop')).toBeNull();
    });

    it('disposes an in-flight row channel when the target list repaints', async () => {
        await openSettings();
        removeChannel.mockClear();
        checkButtons()[0].click();
        await flush();
        expect(removeChannel).not.toHaveBeenCalled();
        // An onboard dispatch repaints the list to show its pending
        // placeholder, rebuilding every row — the host the verdict would render
        // into goes with them, so the subscription must not outlive it.
        document.getElementById('injectOnboardCard').click();
        document.getElementById('injectOnboardRepoInput').value = 'rsterenchak/brand-new';
        document.getElementById('injectOnboardSubmit').click();
        await flush(8);
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
        // Fresh rows come back enabled rather than stuck behind the lost run.
        expect(checkButtons().every((b) => b.disabled === false)).toBe(true);
    });
});

describe('inject target drift check — style.css', () => {
    it('guards the row verdict host and gives the row room to wrap', () => {
        expect(css).toMatch(/\.injectTargetVerdict\[hidden\]\s*\{\s*display:\s*none\s*!important/);
        expect(css).toMatch(/\.injectTargetRow\s*\{[^}]*flex-wrap:\s*wrap/);
    });

    it('styles the row verdict and its dismiss as classes', () => {
        expect(css).toMatch(/\.injectTargetVerdict\s*\{/);
        expect(css).toMatch(/\.injectTargetVerdictDismiss\s*\{/);
        expect(css).toMatch(/\.injectOnboardVerdictNote\s*\{/);
    });

    it('styles the stale rows, their directory span, and the stale count', () => {
        expect(css).toMatch(/\.injectOnboardVerdictStale\s*\{/);
        expect(css).toMatch(/\.injectOnboardVerdictStaleDirs\s*\{/);
        expect(css).toMatch(/\.injectOnboardVerdictCount--stale\s*\{/);
        expect(css).toMatch(/\.injectOnboardVerdictStale\[hidden\]\s*\{\s*display:\s*none\s*!important/);
        expect(css).toMatch(/\.injectOnboardVerdictStaleDirs\[hidden\]\s*\{\s*display:\s*none\s*!important/);
        expect(css).toMatch(/\.injectOnboardVerdictCount--stale\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    });
});
