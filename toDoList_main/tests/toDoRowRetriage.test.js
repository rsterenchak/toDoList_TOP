import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression pin for "Retry triage for runs stuck before a draft exists".
//
// When claude-triage.yml dies before writing a verdict, reconcileStuckTriaging
// flips the row from `triaging` to `failed`. That row carries no entry_id and no
// draft, so buildDispatchBlock's retry mode computed canRun false and mounted a
// permanently disabled RETRY — styled only with `opacity: 0.6`, so it read as a
// live control and did nothing when tapped. Even enabled it routed through
// dispatchDraft → claude-run.yml, which ships an ENTRY: the wrong recovery for a
// row that never got one. Those rows now mount RETRY TRIAGE, which puts the row
// back to `triaging` and re-fires the project-wide sweep instead.
//
// dispatchDraft is mocked so "the retriage branch must not call dispatchDraft at
// all" is an assertion rather than a reading of the source, and the sweep is
// driven through the store's own registered-dispatcher seam (setTriageDispatcher)
// — the same seam agentWiring.js registers the real boardless sweep through — so
// each of fireTriageSweep's three outcomes is exercised for real.

vi.mock('../src/dispatchDraft.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, dispatchDraft: vi.fn(() => Promise.resolve({ ok: true })) };
});

import { buildDispatchBlock, isRetriageRow } from '../src/toDoRow.js';
import { dispatchDraft } from '../src/dispatchDraft.js';
import { setTriageDispatcher } from '../src/agentQueueStore.js';
import { listLogic } from '../src/listLogic.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

const STUCK_BARE = { id: 11, state: 'failed', entry_id: null, draft: '' };
const ITEM = { id: 'todo-1' };

function flush() {
    // Three microtask hops: setAgentRunState → fireTriageSweep → its .then.
    return Promise.resolve().then().then().then();
}

function retriageBlock(queueRow, projectName) {
    return buildDispatchBlock(ITEM, queueRow || STUCK_BARE, 'retriage', projectName || 'Work');
}

let setState;

beforeEach(() => {
    setState = vi.spyOn(listLogic, 'setAgentRunState')
        .mockResolvedValue({ ok: true });
    dispatchDraft.mockClear();
});

afterEach(() => {
    setState.mockRestore();
    setTriageDispatcher(null);
    vi.restoreAllMocks();
});


describe('isRetriageRow — which stuck rows have nothing to dispatch', () => {
    it('is true only for a row with neither an entry marker nor a draft', () => {
        expect(isRetriageRow({ id: 1, entry_id: null, draft: '' })).toBe(true);
        expect(isRetriageRow({ id: 1, entry_id: null, draft: '   ' })).toBe(true);
        expect(isRetriageRow({ id: 1 })).toBe(true);
    });

    it('is false when the row carries an entry marker or a generated draft', () => {
        expect(isRetriageRow({ id: 1, entry_id: 'e1', draft: '' })).toBe(false);
        expect(isRetriageRow({ id: 1, entry_id: null, draft: '- [ ] do it' })).toBe(false);
    });

    it('is false for a missing row rather than throwing', () => {
        expect(isRetriageRow(null)).toBe(false);
        expect(isRetriageRow(undefined)).toBe(false);
    });
});


describe('buildDispatchBlock — retriage mode', () => {
    it('mounts an ENABLED RETRY TRIAGE control for a row with no entry and no draft', () => {
        const block = retriageBlock();
        expect(block.getAttribute('data-dispatch-mode')).toBe('retriage');
        const btn = block.querySelector('.descDispatchButton');
        expect(btn.textContent).toBe('Retry triage');
        // The bug: retry's canRun made this button permanently disabled.
        expect(btn.disabled).toBe(false);
        // Reuses the existing retry variant — no new CSS.
        expect(btn.classList.contains('descDispatchButton--retry')).toBe(true);
    });

    it('leaves the retry mode untouched for a stuck row that DOES carry an entry', () => {
        const block = buildDispatchBlock(ITEM, { id: 12, state: 'failed', entry_id: 'e12' }, 'retry', 'Work');
        const btn = block.querySelector('.descDispatchButton');
        expect(block.getAttribute('data-dispatch-mode')).toBe('retry');
        expect(btn.textContent).toBe('Retry');
        expect(btn.disabled).toBe(false);
    });

    it('shows "Retrying…", clears the failure reason, and re-queues the row as triaging', async () => {
        setTriageDispatcher(vi.fn(() => Promise.resolve({ ok: true })));
        const block = retriageBlock();
        const btn = block.querySelector('.descDispatchButton');

        btn.click();
        expect(btn.textContent).toBe('Retrying…');
        expect(btn.disabled).toBe(true);
        expect(setState).toHaveBeenCalledWith(11, { state: 'triaging', failure_reason: null });

        await flush();
        // The row left STUCK; the control clears on the next repaint, not here.
        expect(block.querySelector('.descDispatchError').hidden).toBe(true);
    });

    it('fires the project-wide sweep and never routes through dispatchDraft', async () => {
        const dispatcher = vi.fn(() => Promise.resolve({ ok: true }));
        setTriageDispatcher(dispatcher);

        retriageBlock(STUCK_BARE, 'Side Project').querySelector('.descDispatchButton').click();
        await flush();

        expect(dispatcher).toHaveBeenCalledWith('Side Project');
        expect(dispatchDraft).not.toHaveBeenCalled();
    });

    it('surfaces the error and restores the idle label WITHOUT sweeping when the state write fails', async () => {
        const dispatcher = vi.fn(() => Promise.resolve({ ok: true }));
        setTriageDispatcher(dispatcher);
        setState.mockResolvedValue({ ok: false, error: 'row is gone' });

        const block = retriageBlock();
        const btn = block.querySelector('.descDispatchButton');
        btn.click();
        await flush();

        const err = block.querySelector('.descDispatchError');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toBe('row is gone');
        expect(btn.textContent).toBe('Retry triage');
        expect(btn.disabled).toBe(false);
        expect(dispatcher).not.toHaveBeenCalled();
    });

    it('surfaces a failed sweep inline rather than reverting the row out of triaging', async () => {
        setTriageDispatcher(vi.fn(() => Promise.resolve({ ok: false })));

        const block = retriageBlock();
        const btn = block.querySelector('.descDispatchButton');
        btn.click();
        await flush();

        const err = block.querySelector('.descDispatchError');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toBe('Triage didn’t start — Run it from the Agent tab.');
        // The row is already back at triaging — the button must NOT invite a second go.
        expect(btn.textContent).toBe('Retrying…');
        expect(btn.disabled).toBe(true);
    });

    it('explains the swallowed call when a sweep is already in flight (null result)', async () => {
        // The store's guard returns null when a dispatcher is registered but the
        // in-flight flag swallows the call — and when none is registered at all.
        setTriageDispatcher(vi.fn(() => null));

        const block = retriageBlock();
        const btn = block.querySelector('.descDispatchButton');
        btn.click();
        await flush();

        const err = block.querySelector('.descDispatchError');
        expect(err.hidden).toBe(false);
        expect(err.textContent)
            .toBe('A sweep is already running — this task will be picked up on the next one.');
        expect(btn.disabled).toBe(true);
    });

    it('surfaces a thrown state write rather than leaving the button stuck pending', async () => {
        setState.mockRejectedValue(new Error('offline'));

        const block = retriageBlock();
        const btn = block.querySelector('.descDispatchButton');
        btn.click();
        await flush();

        const err = block.querySelector('.descDispatchError');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toBe('Could not retry triage. Try again.');
        expect(btn.textContent).toBe('Retry triage');
        expect(btn.disabled).toBe(false);
    });
});


describe('both hosts resolve the retriage mode through the shared predicate', () => {
    const toDoRow = read('toDoRow.js');
    const modals = read('modals.js');
    const store = read('agentQueueStore.js');

    it('the row panel refines a stuck mode to retriage after resolving the queue row', () => {
        const idx = toDoRow.indexOf('function syncDispatchPanel(');
        const fn = toDoRow.slice(idx, idx + 1800);
        expect(fn).toMatch(/phase === PHASE\.STUCK \? 'retry'/);
        expect(fn).toMatch(/baseMode === 'retry' && isRetriageRow\(queueRow\)\) \? 'retriage'/);
        // Retriage anchors beneath the SAME stuck reason block as retry.
        expect(fn).toMatch(/if \(mode !== 'dispatch'\)/);
    });

    it('the mobile modal refines the same way and passes the project name through', () => {
        const idx = modals.indexOf('function renderDispatchBlock()');
        const fn = modals.slice(idx, idx + 1500);
        expect(fn).toMatch(/baseMode === 'retry' && isRetriageRow\(queueRow\)\) \? 'retriage'/);
        expect(fn).toMatch(/buildDispatchBlock\(item,\s*queueRow,\s*mode,\s*opts\.projectName \|\| ''\)/);
        expect(modals).toMatch(/import \{[^}]*\bisRetriageRow\b[^}]*\} from '\.\/toDoRow\.js'/s);
    });

    it('the row panel hands the sweep the row\'s own project name', () => {
        const idx = toDoRow.indexOf('function syncDispatchPanel(');
        const fn = toDoRow.slice(idx, idx + 1800);
        expect(fn).toMatch(/buildDispatchBlock\(item,\s*queueRow,\s*mode,\s*\(toDoChild\.dataset/);
    });

    it('the reaper\'s reason points at the new control rather than remove-and-reflag', () => {
        const idx = store.indexOf('function reconcileStuckTriaging(');
        const fn = store.slice(idx, idx + 900);
        expect(fn).toMatch(/Use Retry triage to run it again\./);
        expect(fn).not.toMatch(/Remove it and flag the task again/);
    });
});
