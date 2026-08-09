import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Injecting a single todo used to end the flow silently: the entry landed in
// TODO.md and nothing offered to run it. The inject button now hands its hosts
// the resolved target alongside the item, and both hosts answer a successful
// inject with a confirmation prompt that dispatches a run scoped to ONLY that
// entry (entry mode — never backlog, which would let the routine pick some
// other pending entry). The dispatch body itself is shared with the viewer's
// existing "Run this entry" control so neither surface can drift from the
// other's guards.
//
// dispatchRun / showInjectToast / trackDispatchedRun are partial-mocked over
// the real modules so the prompt runs without network or the Runs-tab store;
// everything else (the confirm modal, the per-project run state) is real.

const dispatchRun = vi.fn(function () { return Promise.resolve({ ok: true }); });
const showInjectToast = vi.fn(function () {});
const trackDispatchedRun = vi.fn(function () {});

vi.mock('../src/inject.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        dispatchRun: (...a) => dispatchRun(...a),
        showInjectToast: (...a) => showInjectToast(...a),
    };
});

vi.mock('../src/claudeSheet.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        trackDispatchedRun: (...a) => trackDispatchedRun(...a),
    };
});

const { dispatchEntryRun, promptRunInjectedEntry } =
    await import('../src/todoMdViewer.js');
const { readActiveRun, clearActiveRun, writeActiveRun, writeActiveRedeploy, clearActiveRedeploy } =
    await import('../src/runState.js');

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

const PROJECT = 'Injected Project';
const TARGET = { repo: 'owner/name', file_path: 'TODO.md' };

function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function resetRunState() {
    clearActiveRun(PROJECT);
    clearActiveRedeploy(PROJECT);
}

describe('post-inject run prompt — shared entry-run dispatch', () => {

    beforeEach(() => {
        dispatchRun.mockClear();
        showInjectToast.mockClear();
        trackDispatchedRun.mockClear();
        dispatchRun.mockImplementation(() => Promise.resolve({ ok: true }));
        resetRunState();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        resetRunState();
    });

    it('dispatches entry mode — never backlog — for the named entry', async () => {
        const res = await dispatchEntryRun({
            entryId: 'entry-1',
            projectName: PROJECT,
            target: TARGET,
            title: 'Do the thing',
        });

        expect(res.ok).toBe(true);
        expect(dispatchRun).toHaveBeenCalledTimes(1);
        const payload = dispatchRun.mock.calls[0][0];
        expect(payload.mode).toBe('entry');
        expect(payload.entryId).toBe('entry-1');
        expect(payload.target).toBe(TARGET);
        expect(payload.correlationId).toBe(res.correlationId);
    });

    it('persists the active-run record and mirrors the run into the Runs tab', async () => {
        const res = await dispatchEntryRun({
            entryId: 'entry-2',
            projectName: PROJECT,
            target: TARGET,
            title: 'Do the thing',
        });

        const rec = readActiveRun(PROJECT);
        expect(rec).not.toBeNull();
        expect(rec.correlationId).toBe(res.correlationId);
        expect(rec.project).toBe(PROJECT);
        expect(rec.target).toEqual({ repo: 'owner/name', file_path: 'TODO.md' });

        expect(trackDispatchedRun).toHaveBeenCalledTimes(1);
        const tracked = trackDispatchedRun.mock.calls[0][0];
        expect(tracked.entryId).toBe('entry-2');
        expect(tracked.correlationId).toBe(res.correlationId);
        expect(tracked.title).toBe('Do the thing');
        expect(tracked.project).toBe(PROJECT);
        expect(tracked.repo).toBe('owner/name');
    });

    it('refuses a second run while the project already has one in flight', async () => {
        writeActiveRun(PROJECT, {
            correlationId: 'already-running',
            project: PROJECT,
            dispatchedAt: Date.now(),
        });

        const res = await dispatchEntryRun({
            entryId: 'entry-3',
            projectName: PROJECT,
            target: TARGET,
        });

        expect(res.ok).toBe(false);
        expect(dispatchRun).not.toHaveBeenCalled();
        expect(readActiveRun(PROJECT).correlationId).toBe('already-running');
    });

    it('refuses a run while a manual redeploy owns the project', async () => {
        writeActiveRedeploy(PROJECT, { startedAt: Date.now() });

        const res = await dispatchEntryRun({
            entryId: 'entry-4',
            projectName: PROJECT,
            target: TARGET,
        });

        expect(res.ok).toBe(false);
        expect(dispatchRun).not.toHaveBeenCalled();
        expect(readActiveRun(PROJECT)).toBeNull();
    });

    it('records no active run when the dispatch itself fails', async () => {
        dispatchRun.mockImplementation(() => Promise.resolve({ ok: false, reason: 'nope' }));

        const res = await dispatchEntryRun({
            entryId: 'entry-5',
            projectName: PROJECT,
            target: TARGET,
        });

        expect(res.ok).toBe(false);
        expect(readActiveRun(PROJECT)).toBeNull();
        expect(trackDispatchedRun).not.toHaveBeenCalled();
        expect(showInjectToast).toHaveBeenCalledWith('Run failed — nope', 'error');
    });

    it('no-ops without an entry id rather than dispatching a blind run', async () => {
        const res = await dispatchEntryRun({ projectName: PROJECT, target: TARGET });
        expect(res.ok).toBe(false);
        expect(dispatchRun).not.toHaveBeenCalled();
    });
});

describe('post-inject run prompt — confirmation dialog', () => {

    beforeEach(() => {
        dispatchRun.mockClear();
        showInjectToast.mockClear();
        trackDispatchedRun.mockClear();
        dispatchRun.mockImplementation(() => Promise.resolve({ ok: true }));
        resetRunState();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        resetRunState();
    });

    it('offers a Run / Cancel confirmation after a successful inject', () => {
        promptRunInjectedEntry({ tit: 'Do the thing', entryId: 'entry-6' }, TARGET, PROJECT);

        const backdrop = document.getElementById('confirmModalBackdrop');
        expect(backdrop).not.toBeNull();
        expect(document.getElementById('confirmModalConfirm').textContent).toBe('Run');
        expect(document.getElementById('confirmModalCancel').textContent).toBe('Cancel');
        // Running an entry is not destructive — no danger treatment.
        expect(document.getElementById('confirmModalConfirm').classList.contains('danger'))
            .toBe(false);
    });

    it('dispatches an entry-scoped run for that entry on Run', async () => {
        promptRunInjectedEntry({ tit: 'Do the thing', entryId: 'entry-7' }, TARGET, PROJECT);
        document.getElementById('confirmModalConfirm').click();
        await flush();

        expect(dispatchRun).toHaveBeenCalledTimes(1);
        const payload = dispatchRun.mock.calls[0][0];
        expect(payload.mode).toBe('entry');
        expect(payload.entryId).toBe('entry-7');
        expect(trackDispatchedRun.mock.calls[0][0].title).toBe('Do the thing');
        expect(readActiveRun(PROJECT)).not.toBeNull();
    });

    it('closes the host modal via beforeRun on Run, but not on Cancel', async () => {
        const beforeRun = vi.fn();
        promptRunInjectedEntry(
            { tit: 'Do the thing', entryId: 'entry-8' }, TARGET, PROJECT, { beforeRun });
        document.getElementById('confirmModalCancel').click();
        await flush();
        expect(beforeRun).not.toHaveBeenCalled();

        promptRunInjectedEntry(
            { tit: 'Do the thing', entryId: 'entry-8' }, TARGET, PROJECT, { beforeRun });
        document.getElementById('confirmModalConfirm').click();
        await flush();
        expect(beforeRun).toHaveBeenCalledTimes(1);
    });

    it('leaves the entry injected but undispatched on Cancel', async () => {
        promptRunInjectedEntry({ tit: 'Do the thing', entryId: 'entry-9' }, TARGET, PROJECT);
        document.getElementById('confirmModalCancel').click();
        await flush();

        expect(dispatchRun).not.toHaveBeenCalled();
        expect(trackDispatchedRun).not.toHaveBeenCalled();
        expect(readActiveRun(PROJECT)).toBeNull();
        expect(document.getElementById('confirmModalBackdrop')).toBeNull();
    });

    it('shows nothing when the injected item carries no entry id', () => {
        promptRunInjectedEntry({ tit: 'Do the thing' }, TARGET, PROJECT);
        expect(document.getElementById('confirmModalBackdrop')).toBeNull();
    });
});

describe('post-inject run prompt — wiring', () => {

    const inject = read('inject.js');
    const viewer = read('todoMdViewer.js');
    const row = read('toDoRow.js');
    const modals = read('modals.js');

    it('hands onInjected the resolved inject target alongside the item', () => {
        expect(inject).toMatch(/opts\.onInjected\(\s*item\s*,\s*target\s*\)/);
    });

    it('wires onInjected from the desktop description panel', () => {
        expect(row).toMatch(
            /import\s*\{\s*promptRunInjectedEntry\s*\}\s*from\s*['"]\.\/todoMdViewer\.js['"]/);
        const start = row.indexOf('makeInjectButton(item, {');
        expect(start).toBeGreaterThan(-1);
        const block = row.slice(start, start + 400);
        expect(block).toMatch(/onInjected:\s*function/);
        expect(block).toMatch(/promptRunInjectedEntry\(/);
    });

    it('wires onInjected from the mobile description modal', () => {
        expect(modals).toMatch(
            /import\s*\{\s*promptRunInjectedEntry\s*\}\s*from\s*['"]\.\/todoMdViewer\.js['"]/);
        const start = modals.indexOf('makeInjectButton(item, {');
        expect(start).toBeGreaterThan(-1);
        const block = modals.slice(start, start + 500);
        expect(block).toMatch(/onInjected:\s*function/);
        expect(block).toMatch(/promptRunInjectedEntry\(/);
        // The modal covers the viewer, so Run closes it first.
        expect(block).toMatch(/beforeRun:\s*function\s*\(\s*\)\s*\{\s*closeDescEditor\(\)/);
    });

    it('anchors the viewer to the new entry before dispatching', () => {
        const start = viewer.indexOf('export function promptRunInjectedEntry');
        expect(start).toBeGreaterThan(-1);
        const block = viewer.slice(start, start + 1400);
        const anchorAt = block.indexOf('openViewerAnchoredToEntry(item.entryId)');
        const dispatchAt = block.indexOf('dispatchEntryRun(');
        expect(anchorAt).toBeGreaterThan(-1);
        expect(dispatchAt).toBeGreaterThan(anchorAt);
    });

    it('routes the viewer\'s own "Run this entry" control through the shared helper', () => {
        const start = viewer.indexOf('async function runEntry(');
        expect(start).toBeGreaterThan(-1);
        const block = viewer.slice(start, viewer.indexOf('function applyExpandedHeight'));
        expect(block).toMatch(/dispatchEntryRun\(/);
        // The guards and the dispatch bookkeeping now live in one place —
        // runEntry must not carry a second copy of either.
        expect(block).not.toMatch(/dispatchRun\(/);
        expect(block).not.toMatch(/readActiveRun\(/);
        expect(block).not.toMatch(/readActiveRedeploy\(/);
        expect(block).not.toMatch(/writeActiveRun\(/);
        expect(block).not.toMatch(/trackDispatchedRun\(/);
        // The pill lifecycle stays with the button.
        expect(block).toMatch(/startRunPill\(dispatchedId\)/);
    });
});
