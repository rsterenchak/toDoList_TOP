import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Tests for the onboard sub-modal's Check action — the report-only preflight
// that dispatches the same onboard.yml with ONBOARD_PREFLIGHT=1, writes
// nothing, and renders what it found. Two layers here:
//
//   • preflightRepo's Worker payload, driven through a mocked fetch.
//   • the sub-modal itself, driven in jsdom: the settings modal is mounted,
//     #injectOnboardCard clicked to open the sub-modal, and the realtime
//     `run_outputs` rows fed in through a captured subscribeRunOutputs
//     callback (supabaseClient is mocked with the same surface its own stub
//     client exposes, plus a spy on removeChannel for the teardown assertions).

let capturedOnRow = null;
const returnedChannel = { id: 'ch-preflight' };
const removeChannel = vi.fn();
const channelFor = vi.fn();

vi.mock('../src/supabaseClient.js', () => {
    const noopQuery = {
        select: function () { return Promise.resolve({ data: [], error: null }); },
        insert: function () { return Promise.resolve({ data: null, error: null }); },
        update: function () { return this; },
        delete: function () { return this; },
        eq: function () { return Promise.resolve({ data: null, error: null }); },
        order: function () { return Promise.resolve({ data: [], error: null }); },
    };
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
            from: function () { return noopQuery; },
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

import { preflightRepo, showInjectSettingsModal, initInjectConfig } from '../src/inject.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

let fetchSpy;
let realFetch;
let realInnerWidth;

function lastPreflightBody() {
    const call = fetchSpy.mock.calls.find((c) => {
        try { return JSON.parse(c[1].body).preflight; } catch (e) { return false; }
    });
    return call ? JSON.parse(call[1].body) : null;
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

    realInnerWidth = window.innerWidth;
    capturedOnRow = null;
    removeChannel.mockClear();
    channelFor.mockClear();
    document.body.innerHTML = '';
});

afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    initInjectConfig();
    Object.defineProperty(window, 'innerWidth', {
        value: realInnerWidth, writable: true, configurable: true,
    });
    document.body.innerHTML = '';
});

function setViewportWidth(px) {
    Object.defineProperty(window, 'innerWidth', {
        value: px, writable: true, configurable: true,
    });
}

// Mount the settings modal and open the onboard sub-modal from its card.
function openOnboardModal() {
    showInjectSettingsModal();
    document.getElementById('injectOnboardCard').click();
    return document.getElementById('injectOnboardModal');
}

// Open the sub-modal, fill the repo field, and run Check to the point where the
// realtime subscription is live and the dispatch has resolved.
async function runCheck(repo, options) {
    const opts = options || {};
    openOnboardModal();
    document.getElementById('injectOnboardRepoInput').value = repo;
    if (opts.purpose) {
        document.querySelector('.injectOnboardPurposeSeg[data-purpose="' + opts.purpose + '"]').click();
    }
    if (opts.shape) document.getElementById('injectOnboardShapeSelect').value = opts.shape;
    document.getElementById('injectOnboardCheck').click();
    await flush();
}

// Feed one live `run_outputs` row. subscribeRunOutputs registers a wrapper that
// reads `payload.new`, so the row is delivered in that envelope.
async function emitRow(row) {
    capturedOnRow({ new: row });
    await flush();
}

// Feed a terminal `run_outputs` row carrying `report` as its stdout JSON.
async function settleWith(report, status) {
    await emitRow({ status: status || 'done', stdout: JSON.stringify(report) });
}

describe('preflightRepo — worker preflight payload', () => {
    it('POSTs { preflight, target_repo, shape, purpose, correlation_id }', async () => {
        const res = await preflightRepo('rsterenchak/new-repo', 'build', 'assignment', 'corr-1');
        const body = lastPreflightBody();
        expect(body).toBeTruthy();
        expect(body.preflight).toBe(true);
        expect(body.target_repo).toBe('rsterenchak/new-repo');
        expect(body.shape).toBe('build');
        expect(body.purpose).toBe('assignment');
        expect(body.correlation_id).toBe('corr-1');
        expect(res.ok).toBe(true);
    });

    it('sends the shape as selected, including auto', async () => {
        await preflightRepo('rsterenchak/new-repo', 'auto', 'personal', 'corr-2');
        expect(lastPreflightBody().shape).toBe('auto');
    });

    it('sends purpose explicitly rather than leaving it to the Worker default', async () => {
        await preflightRepo('rsterenchak/new-repo', 'auto', 'personal', 'corr-3');
        const body = lastPreflightBody();
        expect('purpose' in body).toBe(true);
        expect(body.purpose).toBe('personal');
    });

    it('normalizes an unknown purpose to personal', async () => {
        await preflightRepo('rsterenchak/new-repo', 'auto', 'bogus', 'corr-4');
        expect(lastPreflightBody().purpose).toBe('personal');
    });

    it('returns { ok: false, reason } when the Worker call fails', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') }));
        const res = await preflightRepo('rsterenchak/new-repo', 'auto', 'personal', 'corr-5');
        expect(res.ok).toBe(false);
        expect(typeof res.reason).toBe('string');
    });

    it('returns { ok: false } without POSTing when inject is unconfigured', async () => {
        localStorage.clear();
        initInjectConfig();
        const res = await preflightRepo('rsterenchak/new-repo', 'auto', 'personal', 'corr-6');
        expect(res.ok).toBe(false);
        expect(lastPreflightBody()).toBeNull();
    });
});

describe('onboard sub-modal — Check action', () => {
    it('renders a Check button in #injectOnboardActions, left of Onboard', () => {
        openOnboardModal();
        const actions = document.getElementById('injectOnboardActions');
        const check = document.getElementById('injectOnboardCheck');
        expect(check).toBeTruthy();
        expect(check.textContent).toBe('Check');
        expect(check.parentNode).toBe(actions);
        const ids = Array.from(actions.children).map((el) => el.id);
        expect(ids.indexOf('injectOnboardCheck')).toBeLessThan(ids.indexOf('injectOnboardSubmit'));
    });

    it('mounts an empty, hidden verdict block last, below the shape and refresh fields', () => {
        openOnboardModal();
        const verdict = document.getElementById('injectOnboardVerdict');
        expect(verdict).toBeTruthy();
        expect(verdict.parentNode.id).toBe('injectOnboardBody');
        expect(verdict.hidden).toBe(true);
        expect(verdict.textContent).toBe('');
        const kids = Array.from(document.getElementById('injectOnboardBody').children);
        expect(kids.indexOf(verdict)).toBe(kids.length - 1);
        const shapeIdx = kids.findIndex((el) => el.contains(document.getElementById('injectOnboardShapeSelect')));
        const backfillIdx = kids.findIndex((el) => el.contains(document.getElementById('injectOnboardRefreshControl')));
        expect(shapeIdx).toBeGreaterThan(-1);
        expect(shapeIdx).toBeLessThan(backfillIdx);
        expect(backfillIdx).toBeLessThan(kids.indexOf(verdict));
    });

    it('validates the repo field with the same rules as Onboard and does not dispatch', async () => {
        openOnboardModal();
        document.getElementById('injectOnboardCheck').click();
        await flush();
        expect(document.getElementById('injectOnboardRepoError').textContent).toBe('Repository is required');
        expect(lastPreflightBody()).toBeNull();

        document.getElementById('injectOnboardRepoInput').value = 'not-a-repo';
        document.getElementById('injectOnboardCheck').click();
        await flush();
        expect(document.getElementById('injectOnboardRepoError').textContent).toBe('Use the format owner/name');
        expect(lastPreflightBody()).toBeNull();
    });

    it('subscribes on the minted correlation id and POSTs the same id', async () => {
        await runCheck('rsterenchak/new-repo');
        const body = lastPreflightBody();
        expect(body.correlation_id).toBeTruthy();
        expect(channelFor).toHaveBeenCalledWith('run_outputs:' + body.correlation_id);
        expect(capturedOnRow).toBeTypeOf('function');
    });

    it('sends the selected shape and purpose, not the defaults', async () => {
        await runCheck('rsterenchak/new-repo', { purpose: 'assignment', shape: 'served' });
        const body = lastPreflightBody();
        expect(body.purpose).toBe('assignment');
        expect(body.shape).toBe('served');
    });

    it('shows the shared spinner while the row is running', async () => {
        await runCheck('rsterenchak/new-repo');
        await emitRow({ status: 'running', stdout: '' });
        const verdict = document.getElementById('injectOnboardVerdict');
        expect(verdict.hidden).toBe(false);
        expect(verdict.querySelector('.injectOnboardSpinner')).toBeTruthy();
        expect(document.getElementById('injectOnboardCheck').disabled).toBe(true);
    });

    it('renders the collapsed strip from the terminal row with counts and a warning glyph', async () => {
        await runCheck('rsterenchak/new-repo');
        await settleWith({
            repo: 'rsterenchak/new-repo',
            shape: 'build',
            purpose: 'personal',
            warnings: ['No test script defined', 'Pages not enabled'],
            create: ['.claude/routine.md', 'TODO.md', 'scripts/gen-src-manifest.js'],
        });
        const verdict = document.getElementById('injectOnboardVerdict');
        expect(verdict.hidden).toBe(false);
        expect(verdict.querySelector('.injectOnboardVerdictGlyph--warn')).toBeTruthy();
        expect(verdict.querySelector('.injectOnboardVerdictGlyph--ok')).toBeNull();
        expect(verdict.querySelector('.injectOnboardVerdictRepo').textContent).toBe('rsterenchak/new-repo');
        expect(verdict.querySelector('.injectOnboardVerdictShape').textContent).toBe('build');
        expect(verdict.querySelector('.injectOnboardVerdictPurpose').textContent).toBe('personal');
        expect(verdict.querySelector('.injectOnboardVerdictCount--warn').textContent).toBe('2 warn');
        expect(verdict.querySelector('.injectOnboardVerdictCount--missing').textContent).toBe('3 missing');
        // Collapsed by default.
        expect(verdict.querySelector('.injectOnboardVerdictExpanded').hidden).toBe(true);
        expect(verdict.querySelector('.injectOnboardVerdictStrip').getAttribute('aria-expanded')).toBe('false');
        expect(document.getElementById('injectOnboardCheck').disabled).toBe(false);
    });

    it('shows the check glyph and omits both counts when the report is clean', async () => {
        await runCheck('rsterenchak/new-repo');
        await settleWith({ repo: 'rsterenchak/new-repo', shape: 'repo', purpose: 'personal', warnings: [], create: [] });
        const verdict = document.getElementById('injectOnboardVerdict');
        expect(verdict.querySelector('.injectOnboardVerdictGlyph--ok')).toBeTruthy();
        expect(verdict.querySelector('.injectOnboardVerdictCount--warn')).toBeNull();
        expect(verdict.querySelector('.injectOnboardVerdictCount--missing')).toBeNull();
    });

    it('counts stale routine files on the strip and drops the clean glyph for them', async () => {
        await runCheck('rsterenchak/new-repo');
        await settleWith({
            repo: 'rsterenchak/new-repo', shape: 'repo', purpose: 'personal',
            warnings: [], create: [],
            stale: [
                { file: '.claude/derive.md', lines: 87, src: 'src', test: 'tests' },
                { file: '.claude/routine.md', lines: null },
            ],
        });
        const verdict = document.getElementById('injectOnboardVerdict');
        expect(verdict.querySelector('.injectOnboardVerdictCount--stale').textContent).toBe('2 stale');
        expect(verdict.querySelector('.injectOnboardVerdictCount--warn')).toBeNull();
        expect(verdict.querySelector('.injectOnboardVerdictCount--missing')).toBeNull();
        // Files behind the template are not a clean report.
        expect(verdict.querySelector('.injectOnboardVerdictGlyph--ok')).toBeNull();
        expect(verdict.querySelector('.injectOnboardVerdictGlyph--warn')).toBeTruthy();
        expect(verdict.querySelectorAll('.injectOnboardVerdictStale').length).toBe(2);
        expect(verdict.querySelector('.injectOnboardVerdictClean')).toBeNull();
    });

    it('falls back to the resolved shape when the report echoes auto back as a real shape', async () => {
        await runCheck('rsterenchak/new-repo', { shape: 'auto' });
        await settleWith({ repo: 'rsterenchak/new-repo', shape: 'console', purpose: 'personal', warnings: [], create: [] });
        expect(document.querySelector('.injectOnboardVerdictShape').textContent).toBe('console');
    });

    it('expands on tapping the strip, listing each warning as a row and each create path as a chip', async () => {
        await runCheck('rsterenchak/new-repo');
        await settleWith({
            repo: 'rsterenchak/new-repo', shape: 'build', purpose: 'assignment',
            warnings: ['No test script defined'],
            create: ['TODO.md', 'CLAUDE.md'],
        });
        const strip = document.querySelector('.injectOnboardVerdictStrip');
        strip.click();
        const expanded = document.querySelector('.injectOnboardVerdictExpanded');
        expect(expanded.hidden).toBe(false);
        expect(strip.getAttribute('aria-expanded')).toBe('true');
        const warnRows = expanded.querySelectorAll('.injectOnboardVerdictWarning');
        expect(warnRows.length).toBe(1);
        expect(warnRows[0].textContent).toBe('No test script defined');
        const chips = expanded.querySelectorAll('.injectOnboardVerdictChip');
        expect(Array.from(chips).map((c) => c.textContent)).toEqual(['TODO.md', 'CLAUDE.md']);
        // Tapping again collapses.
        strip.click();
        expect(expanded.hidden).toBe(true);
    });

    it('keeps Onboard enabled regardless of what the verdict says', async () => {
        await runCheck('rsterenchak/new-repo');
        expect(document.getElementById('injectOnboardSubmit').disabled).toBe(false);
        await settleWith({ repo: 'rsterenchak/new-repo', shape: 'build', purpose: 'personal', warnings: ['bad'], create: ['TODO.md'] });
        expect(document.getElementById('injectOnboardSubmit').disabled).toBe(false);
    });

    it('replaces the prior verdict and its subscription when Check is re-run', async () => {
        await runCheck('rsterenchak/new-repo');
        await settleWith({ repo: 'rsterenchak/new-repo', shape: 'build', purpose: 'personal', warnings: ['first'], create: [] });
        document.querySelector('.injectOnboardVerdictStrip').click();
        expect(document.querySelectorAll('.injectOnboardVerdictWarning').length).toBe(1);

        removeChannel.mockClear();
        document.getElementById('injectOnboardCheck').click();
        await flush();
        // One strip only — the prior verdict is gone, not stacked.
        expect(document.querySelectorAll('.injectOnboardVerdictStrip').length).toBe(1);
        expect(document.querySelectorAll('.injectOnboardVerdictWarning').length).toBe(0);
        await settleWith({ repo: 'rsterenchak/new-repo', shape: 'build', purpose: 'personal', warnings: ['second', 'third'], create: [] });
        expect(document.querySelector('.injectOnboardVerdictCount--warn').textContent).toBe('2 warn');
    });

    it('disposes the realtime channel on the terminal row', async () => {
        await runCheck('rsterenchak/new-repo');
        expect(removeChannel).not.toHaveBeenCalled();
        await settleWith({ repo: 'rsterenchak/new-repo', shape: 'build', purpose: 'personal', warnings: [], create: [] });
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
    });

    it('disposes the realtime channel when the sub-modal closes mid-flight', async () => {
        await runCheck('rsterenchak/new-repo');
        expect(removeChannel).not.toHaveBeenCalled();
        document.getElementById('injectOnboardClose').click();
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
        expect(document.getElementById('injectOnboardBackdrop')).toBeNull();
    });

    it('renders a quiet failure — never raw JSON — when stdout is not a report', async () => {
        await runCheck('rsterenchak/new-repo');
        await emitRow({ status: 'done', stdout: 'Run onboard.sh\nexit 0' });
        const verdict = document.getElementById('injectOnboardVerdict');
        expect(verdict.querySelector('.injectOnboardVerdictStrip--static')).toBeTruthy();
        expect(verdict.textContent).toContain('readable report');
        expect(verdict.querySelector('.injectOnboardVerdictExpanded')).toBeNull();
        expect(document.getElementById('injectOnboardCheck').disabled).toBe(false);
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
    });

    it('reads the report out of a stdout carrying surrounding log noise', async () => {
        await runCheck('rsterenchak/new-repo');
        await emitRow({
            status: 'done',
            stdout: '::group::preflight\n{"repo":"rsterenchak/new-repo","shape":"sql","purpose":"personal","warnings":[],"create":["TODO.md"]}\n::endgroup::',
        });
        expect(document.querySelector('.injectOnboardVerdictShape').textContent).toBe('sql');
        expect(document.querySelector('.injectOnboardVerdictCount--missing').textContent).toBe('1 missing');
    });

    it('surfaces a dispatch failure in the verdict and re-enables Check', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('boom') }));
        await runCheck('rsterenchak/new-repo');
        const verdict = document.getElementById('injectOnboardVerdict');
        expect(verdict.hidden).toBe(false);
        expect(verdict.querySelector('.injectOnboardSpinner')).toBeNull();
        expect(verdict.querySelector('.injectOnboardVerdictGlyph--warn')).toBeTruthy();
        expect(document.getElementById('injectOnboardCheck').disabled).toBe(false);
        expect(removeChannel).toHaveBeenCalledWith(returnedChannel);
    });
});

describe('onboard sub-modal — expanded verdict layout', () => {
    const REPORT = {
        repo: 'rsterenchak/new-repo', shape: 'build', purpose: 'personal',
        warnings: ['No test script defined'],
        create: ['TODO.md', 'CLAUDE.md'],
    };

    function fieldWraps() {
        return Array.from(document.getElementById('injectOnboardBody').children)
            .filter((el) => el.classList.contains('injectFieldLabel'));
    }

    it('appends inline above the breakpoint, leaving the form in place', async () => {
        setViewportWidth(1280);
        await runCheck('rsterenchak/new-repo');
        await settleWith(REPORT);
        document.querySelector('.injectOnboardVerdictStrip').click();
        expect(fieldWraps().every((el) => el.hidden === false)).toBe(true);
        expect(document.getElementById('injectOnboardVerdict').classList.contains('injectOnboardVerdict--full')).toBe(false);
        expect(document.querySelector('.injectOnboardVerdictBack').hidden).toBe(true);
    });

    it('replaces the form below the breakpoint, with a back control that restores it', async () => {
        setViewportWidth(430);
        await runCheck('rsterenchak/new-repo');
        await settleWith(REPORT);
        const verdict = document.getElementById('injectOnboardVerdict');
        const strip = document.querySelector('.injectOnboardVerdictStrip');

        // Collapsed is inline on mobile too — the form is still visible.
        expect(fieldWraps().every((el) => el.hidden === false)).toBe(true);

        strip.click();
        expect(fieldWraps().every((el) => el.hidden === true)).toBe(true);
        expect(verdict.classList.contains('injectOnboardVerdict--full')).toBe(true);
        const back = document.querySelector('.injectOnboardVerdictBack');
        expect(back.hidden).toBe(false);

        back.click();
        expect(fieldWraps().every((el) => el.hidden === false)).toBe(true);
        expect(verdict.classList.contains('injectOnboardVerdict--full')).toBe(false);
        expect(document.querySelector('.injectOnboardVerdictExpanded').hidden).toBe(true);
        expect(back.hidden).toBe(true);
        // The actions row is still mounted and usable.
        expect(document.getElementById('injectOnboardSubmit').disabled).toBe(false);
    });

    it('restores the form when a mobile takeover is replaced by a re-run', async () => {
        setViewportWidth(430);
        await runCheck('rsterenchak/new-repo');
        await settleWith(REPORT);
        document.querySelector('.injectOnboardVerdictStrip').click();
        expect(fieldWraps().every((el) => el.hidden === true)).toBe(true);

        document.getElementById('injectOnboardCheck').click();
        await flush();
        expect(fieldWraps().every((el) => el.hidden === false)).toBe(true);
    });
});

describe('onboard sub-modal — refresh managed files level', () => {
    function lastOnboardBody() {
        const call = fetchSpy.mock.calls.find((c) => {
            try { return JSON.parse(c[1].body).onboard; } catch (e) { return false; }
        });
        return call ? JSON.parse(call[1].body) : null;
    }

    async function submitOnboard(repo) {
        document.getElementById('injectOnboardRepoInput').value = repo;
        document.getElementById('injectOnboardSubmit').click();
        await flush();
        return lastOnboardBody();
    }

    function chip(value) {
        return document.querySelector('.injectOnboardRefreshSeg[data-refresh="' + value + '"]');
    }

    it('renders a none / stale / all radiogroup with a label, none selected by default', () => {
        openOnboardModal();
        const control = document.getElementById('injectOnboardRefreshControl');
        expect(control.getAttribute('role')).toBe('radiogroup');
        const labelId = control.getAttribute('aria-labelledby');
        expect(document.getElementById(labelId).textContent).toBe('Refresh managed files');
        const segs = Array.from(control.querySelectorAll('.injectOnboardRefreshSeg'));
        expect(segs.map((s) => s.textContent)).toEqual(['none', 'stale', 'all']);
        segs.forEach((s) => {
            expect(s.tagName).toBe('BUTTON');
            expect(s.type).toBe('button');
            expect(s.getAttribute('role')).toBe('radio');
        });
        expect(chip('none').getAttribute('aria-checked')).toBe('true');
        expect(chip('none').classList.contains('selected')).toBe(true);
        expect(chip('all').getAttribute('aria-checked')).toBe('false');
        // It hides with the rest of the form on a mobile takeover.
        expect(control.closest('.injectFieldLabel')).toBeTruthy();
        expect(document.getElementById('injectOnboardBackfill')).toBeNull();
    });

    it('swaps the hint line with the selection', () => {
        openOnboardModal();
        const hint = document.getElementById('injectOnboardRefreshHint');
        expect(hint.textContent).toBe('Create what’s missing only');
        chip('stale').click();
        expect(hint.textContent).toBe('Also overwrite stale files nobody edited');
        chip('all').click();
        expect(hint.textContent).toBe(
            'Overwrite every stale managed file, local edits included — authored files are never touched');
        expect(chip('all').getAttribute('aria-checked')).toBe('true');
        expect(chip('none').getAttribute('aria-checked')).toBe('false');
    });

    it('never persists — reopening the sub-modal brings it back to none', () => {
        openOnboardModal();
        chip('all').click();
        document.getElementById('injectOnboardCancel').click();

        openOnboardModal();
        expect(chip('none').getAttribute('aria-checked')).toBe('true');
        expect(chip('all').getAttribute('aria-checked')).toBe('false');
        expect(Object.keys(localStorage).filter((k) => /refresh|backfill/i.test(k))).toEqual([]);
    });

    it.each(['none', 'stale', 'all'])('sends refresh: "%s" and no backfill_stale', async (value) => {
        openOnboardModal();
        chip(value).click();
        const body = await submitOnboard('rsterenchak/new-repo');
        expect(body).toBeTruthy();
        expect(body.refresh).toBe(value);
        expect('backfill_stale' in body).toBe(false);
    });

    it('has no effect on Check — preflight never refreshes', async () => {
        openOnboardModal();
        chip('all').click();
        document.getElementById('injectOnboardRepoInput').value = 'rsterenchak/new-repo';
        document.getElementById('injectOnboardCheck').click();
        await flush();
        expect('refresh' in lastPreflightBody()).toBe(false);
        expect('backfill_stale' in lastPreflightBody()).toBe(false);
    });
});

describe('preflight verdict — per-file local-edits phrase', () => {
    async function staleRows(stale) {
        await runCheck('rsterenchak/new-repo');
        await settleWith({
            repo: 'rsterenchak/new-repo', shape: 'repo', purpose: 'personal',
            warnings: [], create: [], stale: stale,
        });
        return Array.from(document.querySelectorAll('.injectOnboardVerdictStale'));
    }

    it('renders "no local edits — will refresh" for local_edits: "no"', async () => {
        const rows = await staleRows([{ file: '.claude/derive.md', lines: 12, local_edits: 'no' }]);
        const edits = rows[0].querySelector('.injectOnboardVerdictStaleEdits');
        expect(edits.textContent).toBe('no local edits — will refresh');
        expect(edits.dataset.edits).toBe('no');
        // Trailing — it comes after the path and the inferred dirs.
        expect(rows[0].lastElementChild).toBe(edits);
    });

    it('renders "has local edits — hand merge" for local_edits: "yes"', async () => {
        const rows = await staleRows([{ file: '.claude/routine.md', lines: 4, local_edits: 'yes' }]);
        const edits = rows[0].querySelector('.injectOnboardVerdictStaleEdits');
        expect(edits.textContent).toBe('has local edits — hand merge');
        expect(edits.dataset.edits).toBe('yes');
    });

    it('renders "local edits unknown" for "unknown" and for a missing field', async () => {
        const rows = await staleRows([
            { file: '.claude/a.md', lines: 3, local_edits: 'unknown' },
            { file: '.claude/b.md', lines: null },
        ]);
        rows.forEach((row) => {
            const edits = row.querySelector('.injectOnboardVerdictStaleEdits');
            expect(edits.textContent).toBe('local edits unknown');
            expect(edits.dataset.edits).toBe('unknown');
        });
    });
});

describe('onboard sub-modal — Onboard button refresh count', () => {
    function label() {
        return document.getElementById('injectOnboardSubmit').querySelector('span').textContent;
    }

    async function checkWith(stale) {
        await runCheck('rsterenchak/new-repo');
        await settleWith({
            repo: 'rsterenchak/new-repo', shape: 'repo', purpose: 'personal',
            warnings: [], create: [], stale: stale,
        });
    }

    function toggleBackfill(on) {
        selectRefresh(on ? 'stale' : 'none');
    }

    function selectRefresh(value) {
        document.querySelector('.injectOnboardRefreshSeg[data-refresh="' + value + '"]').click();
    }

    function note() {
        const el = document.querySelector('#injectOnboardVerdict .injectOnboardVerdictNote');
        return el ? el.textContent : null;
    }

    it('reads "Onboard" before any Check, checked or not', () => {
        openOnboardModal();
        expect(label()).toBe('Onboard');
        toggleBackfill(true);
        expect(label()).toBe('Onboard');
    });

    it('counts only the "no" rows once the opt-in is checked', async () => {
        await checkWith([
            { file: '.claude/a.md', lines: 3, local_edits: 'no' },
            { file: '.claude/b.md', lines: 9, local_edits: 'yes' },
            { file: '.claude/c.md', lines: 1 },
        ]);
        expect(label()).toBe('Onboard');
        toggleBackfill(true);
        expect(label()).toBe('Onboard + refresh 1');
        toggleBackfill(false);
        expect(label()).toBe('Onboard');
    });

    it('stays "Onboard" when checked but no row is refreshable', async () => {
        await checkWith([{ file: '.claude/b.md', lines: 9, local_edits: 'yes' }]);
        toggleBackfill(true);
        expect(label()).toBe('Onboard');
    });

    it('recomputes when a later Check settles, and clears while one is in flight', async () => {
        await checkWith([
            { file: '.claude/a.md', lines: 3, local_edits: 'no' },
            { file: '.claude/b.md', lines: 5, local_edits: 'no' },
        ]);
        toggleBackfill(true);
        expect(label()).toBe('Onboard + refresh 2');

        document.getElementById('injectOnboardCheck').click();
        await flush();
        expect(label()).toBe('Onboard');

        await settleWith({
            repo: 'rsterenchak/new-repo', shape: 'repo', purpose: 'personal',
            warnings: [], create: [],
            stale: [{ file: '.claude/a.md', lines: 3, local_edits: 'no' }],
        });
        expect(label()).toBe('Onboard + refresh 1');
    });

    it('keeps the rocket glyph across a relabel', async () => {
        await checkWith([{ file: '.claude/a.md', lines: 3, local_edits: 'no' }]);
        toggleBackfill(true);
        expect(document.querySelector('#injectOnboardSubmit svg')).toBeTruthy();
    });

    it('counts every stale row at all, local edits or not', async () => {
        await checkWith([
            { file: '.claude/a.md', lines: 3, local_edits: 'no' },
            { file: '.claude/b.md', lines: 9, local_edits: 'yes' },
            { file: '.claude/c.md', lines: 1 },
        ]);
        selectRefresh('all');
        expect(label()).toBe('Onboard + refresh 3');
        selectRefresh('stale');
        expect(label()).toBe('Onboard + refresh 1');
    });

    it('adds the overwrite caveat to the verdict only while all is selected', async () => {
        await checkWith([
            { file: '.claude/a.md', lines: 3, local_edits: 'no' },
            { file: '.claude/b.md', lines: 9, local_edits: 'yes' },
        ]);
        expect(note()).toBeNull();
        selectRefresh('stale');
        expect(note()).toBeNull();

        const strip = document.querySelector('#injectOnboardVerdict .injectOnboardVerdictStrip');
        strip.click();
        selectRefresh('all');
        expect(note()).toBe('Refresh all will overwrite these 2 stale files regardless of local edits.');
        // An expanded verdict stays expanded across the re-render.
        expect(document.querySelector('#injectOnboardVerdict .injectOnboardVerdictStrip')
            .getAttribute('aria-expanded')).toBe('true');

        selectRefresh('none');
        expect(note()).toBeNull();
    });

    it('carries the caveat onto a report that settles while all is selected', async () => {
        openOnboardModal();
        selectRefresh('all');
        document.getElementById('injectOnboardRepoInput').value = 'rsterenchak/new-repo';
        document.getElementById('injectOnboardCheck').click();
        await flush();
        await settleWith({
            repo: 'rsterenchak/new-repo', shape: 'repo', purpose: 'personal',
            warnings: [], create: [],
            stale: [{ file: '.claude/a.md', lines: 3, local_edits: 'yes' }],
        });
        expect(note()).toBe('Refresh all will overwrite this 1 stale file regardless of local edits.');
    });

    it('adds no caveat at all when the verdict lists no stale files', async () => {
        await checkWith([]);
        selectRefresh('all');
        expect(note()).toBeNull();
        expect(label()).toBe('Onboard');
    });
});

describe('onboard preflight — style.css hidden guards', () => {
    it('guards the verdict block, its expanded section, the back control, and the field wrappers', () => {
        expect(css).toMatch(/#injectOnboardVerdict\[hidden\]\s*\{\s*display:\s*none\s*!important/);
        expect(css).toMatch(/\.injectOnboardVerdictExpanded\[hidden\]\s*\{\s*display:\s*none\s*!important/);
        expect(css).toMatch(/\.injectOnboardVerdictBack\[hidden\]\s*\{\s*display:\s*none\s*!important/);
        expect(css).toMatch(/#injectOnboardBody\s+\.injectFieldLabel\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    });

    it('styles the verdict as classes, with no inline style writes in inject.js', () => {
        const inject = readFileSync(resolve(here, '../src/inject.js'), 'utf8');
        const slice = inject.slice(inject.indexOf('function showOnboardModal'), inject.indexOf('// ── SETTINGS MODAL ──'));
        expect(slice).not.toMatch(/\.style\.[a-zA-Z]+\s*=/);
        expect(css).toMatch(/\.injectOnboardVerdictStrip\s*\{/);
        expect(css).toMatch(/\.injectOnboardVerdictWarning\s*\{/);
        expect(css).toMatch(/\.injectOnboardVerdictChip\s*\{/);
    });

    it('colours the local-edits phrase by state and styles the refresh row', () => {
        expect(css).toMatch(/\.injectOnboardVerdictStaleEdits\[data-edits="no"\]/);
        expect(css).toMatch(/\.injectOnboardVerdictStaleEdits\[data-edits="yes"\]/);
        expect(css).toMatch(/\.injectOnboardVerdictStaleEdits\[data-edits="unknown"\]/);
        expect(css).toMatch(/\.injectOnboardRefreshSeg\s*\{/);
        expect(css).toMatch(/\.injectOnboardRefreshSeg\.selected\s*\{/);
        expect(css).toMatch(/\.injectOnboardRefreshHint\s*\{/);
        expect(css).not.toMatch(/\.injectOnboardBackfill/);
    });
});
