import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    syncTriageBlock,
    resolveTriageStart,
    formatTriageElapsed,
    applyPhaseLayout,
    applyAuthoringMode,
    DESC_PANEL_CHILD_SELECTORS,
} from '../src/toDoRow.js';
import { PHASE } from '../src/phase.js';
import { setQueueRows } from '../src/agentQueueStore.js';

// The desktop description panel replaces its entry region with a dedicated TRIAGE
// RUNNING block while the linked agent_queue row sits in `triaging`, instead of
// only swapping the Generate button's label to "Generating…". The block is driven
// entirely by the queue row's state (the row IS the state — no second store), so
// it persists across a close/reopen with the elapsed clock continuing. These pins
// exercise the real syncTriageBlock against a jsdom panel and the pure helpers.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Build the inline panel structure openDescSiblingFor resolves: a #toDoChild whose
// nextSibling is the #descSibling panel, carrying a File: picker trigger and the
// textarea it will hide while triage runs.
function makePanel() {
    const container = document.createElement('div');
    const toDoChild = document.createElement('div');
    toDoChild.id = 'toDoChild';
    const descSibling = document.createElement('div');
    descSibling.id = 'descSibling';
    const trigger = document.createElement('button');
    trigger.className = 'filePickTrigger';
    const descInput = document.createElement('textarea');
    descInput.id = 'descInput';
    descSibling.appendChild(trigger);
    descSibling.appendChild(descInput);
    container.appendChild(toDoChild);
    container.appendChild(descSibling);
    document.body.appendChild(container);
    return { container, toDoChild, descSibling, trigger, descInput };
}

function seedQueueRow(overrides) {
    setQueueRows([Object.assign({ id: 9, todo_id: 't1', state: 'triaging' }, overrides)], 'proj');
}

beforeEach(() => {
    // Fake timers with a fixed base so the elapsed clock is deterministic and no
    // real setInterval survives a test.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T00:00:00Z'));
});
afterEach(() => {
    setQueueRows([]);
    document.body.innerHTML = '';
    vi.useRealTimers();
});

describe('syncTriageBlock — mount / remove by state', () => {
    it('mounts the block and hides the textarea + picker while the row is triaging', () => {
        const { toDoChild, descSibling, trigger, descInput } = makePanel();
        seedQueueRow({ created_at: '2026-07-27T00:00:00Z' });

        syncTriageBlock(toDoChild, { id: 't1' });

        const block = descSibling.querySelector('.descTriageBlock');
        expect(block).not.toBeNull();
        expect(block.querySelector('.descTriageHeading').textContent).toMatch(/triage running/i);
        expect(block.querySelector('.descTriageBar')).not.toBeNull();
        // Entry region hidden so a landing draft can't overwrite mid-flight text.
        expect(descInput.hidden).toBe(true);
        expect(trigger.hidden).toBe(true);
    });

    it('does not mount the block when the row is not triaging', () => {
        const { toDoChild, descSibling } = makePanel();
        seedQueueRow({ state: 'drafted', draft: 'x' });

        syncTriageBlock(toDoChild, { id: 't1' });

        expect(descSibling.querySelector('.descTriageBlock')).toBeNull();
    });

    it('does nothing when the row has no linked queue row', () => {
        const { toDoChild, descSibling } = makePanel();
        setQueueRows([], 'proj');

        syncTriageBlock(toDoChild, { id: 't1' });

        expect(descSibling.querySelector('.descTriageBlock')).toBeNull();
    });

    it('removes the block when the row leaves triaging, and the entry region can be restored', () => {
        const { toDoChild, descSibling, trigger, descInput } = makePanel();
        seedQueueRow({ created_at: '2026-07-27T00:00:00Z' });
        syncTriageBlock(toDoChild, { id: 't1' });
        expect(descSibling.querySelector('.descTriageBlock')).not.toBeNull();
        expect(descInput.hidden).toBe(true);

        // Run completes → drafted. The sweep runs applyAuthoringMode (restoring
        // WRITE's textarea) BEFORE syncTriageBlock, which then removes the block and
        // leaves the restored visibility alone.
        setQueueRows([{ id: 9, todo_id: 't1', state: 'drafted', draft: 'x' }], 'proj');
        applyAuthoringMode(descSibling, 'write');
        syncTriageBlock(toDoChild, { id: 't1' });

        expect(descSibling.querySelector('.descTriageBlock')).toBeNull();
        expect(descInput.hidden).toBe(false);
        expect(trigger.hidden).toBe(false);
    });
});

describe('syncTriageBlock — live clock', () => {
    it('advances the elapsed clock on its interval and clears it when the block is removed', () => {
        const { toDoChild, descSibling } = makePanel();
        seedQueueRow({ created_at: '2026-07-27T00:00:00Z' });

        syncTriageBlock(toDoChild, { id: 't1' });
        const block = descSibling.querySelector('.descTriageBlock');
        const elapsed = block.querySelector('.descTriageElapsed');
        expect(elapsed.hidden).toBe(false);
        expect(elapsed.textContent).toBe('0:00');

        vi.advanceTimersByTime(7000);
        expect(elapsed.textContent).toBe('0:07');
        vi.advanceTimersByTime(60000);
        expect(elapsed.textContent).toBe('1:07');

        // Leaving triaging removes the block and clears its interval.
        setQueueRows([{ id: 9, todo_id: 't1', state: 'drafted', draft: 'x' }], 'proj');
        syncTriageBlock(toDoChild, { id: 't1' });
        expect(block._triageTimer).toBeNull();
    });

    it('keeps running across a close + reopen — the clock is reset on close and resumed from the same start', () => {
        const { container, toDoChild, descSibling } = makePanel();
        seedQueueRow({ created_at: '2026-07-27T00:00:00Z' });

        syncTriageBlock(toDoChild, { id: 't1' });
        const block = descSibling.querySelector('.descTriageBlock');
        const start = block.getAttribute('data-triage-start');
        vi.advanceTimersByTime(5000);
        expect(block.querySelector('.descTriageElapsed').textContent).toBe('0:05');

        // Close: #descSibling is detached and its clock stopped (children survive).
        // The self-terminating tick would also stop once detached; assert the block
        // survives with the same start so a reopen resumes from real elapsed time.
        container.removeChild(descSibling);
        vi.advanceTimersByTime(10000);

        // Reopen: re-attach and re-sync while still triaging → same block, restarted
        // clock, unchanged start, so the elapsed reflects the FULL time since start.
        container.appendChild(descSibling);
        syncTriageBlock(toDoChild, { id: 't1' });
        const reopened = descSibling.querySelector('.descTriageBlock');
        expect(reopened).toBe(block);
        expect(reopened.getAttribute('data-triage-start')).toBe(start);
        expect(reopened._triageTimer).not.toBeNull();
        expect(reopened.querySelector('.descTriageElapsed').textContent).toBe('0:15');
    });

    it('is idempotent — re-syncing the same run keeps the one block and its clock', () => {
        const { toDoChild, descSibling } = makePanel();
        seedQueueRow({ created_at: '2026-07-27T00:00:00Z' });

        syncTriageBlock(toDoChild, { id: 't1' });
        const block = descSibling.querySelector('.descTriageBlock');
        const timer = block._triageTimer;
        syncTriageBlock(toDoChild, { id: 't1' });

        expect(descSibling.querySelectorAll('.descTriageBlock')).toHaveLength(1);
        expect(descSibling.querySelector('.descTriageBlock')).toBe(block);
        expect(block._triageTimer).toBe(timer);
    });
});

describe('syncTriageBlock — clock source resolution', () => {
    it('formatTriageElapsed renders m:ss, never negative, minutes uncapped', () => {
        expect(formatTriageElapsed(0)).toBe('0:00');
        expect(formatTriageElapsed(7000)).toBe('0:07');
        expect(formatTriageElapsed(67000)).toBe('1:07');
        expect(formatTriageElapsed(-5000)).toBe('0:00');
        expect(formatTriageElapsed(3600000)).toBe('60:00');
    });

    it('prefers updated_at, falls back to created_at, and refuses a stale created_at on a re-triage', () => {
        // First Generate: created_at is dispatch time.
        expect(resolveTriageStart({ created_at: '2026-07-27T00:00:00Z' }))
            .toBe(Date.parse('2026-07-27T00:00:00Z'));
        // A state-transition timestamp wins (correct across the answer → triaging loop).
        expect(resolveTriageStart({ created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-27T00:00:00Z' }))
            .toBe(Date.parse('2026-07-27T00:00:00Z'));
        // Re-triage (answered → non-empty thread) with only created_at → no clock.
        expect(resolveTriageStart({ created_at: '2026-07-01T00:00:00Z', thread: [{ role: 'user', text: 'go' }] }))
            .toBeNull();
        // Nothing usable → no clock.
        expect(resolveTriageStart({})).toBeNull();
        expect(resolveTriageStart({ created_at: 'not-a-date' })).toBeNull();
    });

    it('renders the block WITHOUT a clock when no usable start exists (re-triage with only created_at)', () => {
        const { toDoChild, descSibling } = makePanel();
        seedQueueRow({ created_at: '2026-07-01T00:00:00Z', thread: [{ role: 'user', text: 'go' }] });

        syncTriageBlock(toDoChild, { id: 't1' });

        const block = descSibling.querySelector('.descTriageBlock');
        expect(block).not.toBeNull();
        expect(block.hasAttribute('data-triage-start')).toBe(false);
        expect(block.querySelector('.descTriageElapsed').hidden).toBe(true);
        expect(block._triageTimer).toBeFalsy();
    });
});

describe('TRIAGE RUNNING block — panel contracts', () => {
    it('is registered as a grid-placed #descSibling child', () => {
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descTriageBlock');
    });

    it('is in the authoring group, so applyPhaseLayout hides it in the done phase', () => {
        const panel = document.createElement('div');
        panel.id = 'descSibling';
        const block = document.createElement('div');
        block.className = 'descTriageBlock';
        panel.appendChild(block);

        applyPhaseLayout(panel, PHASE.DONE);
        expect(block.hidden).toBe(true);
        applyPhaseLayout(panel, PHASE.DRAFT);
        expect(block.hidden).toBe(false);
    });

    it('carries an explicit full-width grid placement and a [hidden] guard in CSS', () => {
        const css = read('style.css');
        const idx = css.indexOf('#descSibling .descTriageBlock {');
        expect(idx).toBeGreaterThan(-1);
        const body = css.slice(idx + '#descSibling .descTriageBlock {'.length, css.indexOf('}', idx));
        expect(body).toMatch(/grid-column:\s*1\s*\/\s*-1/);
        expect(css).toMatch(/#descSibling \.descTriageBlock\[hidden\]\s*\{[^}]*display:\s*none/);
    });

    it('the spend line reuses the Generate control’s Max-plan-quota wording', () => {
        const toDoRow = read('toDoRow.js');
        expect(toDoRow).toMatch(/descTriageSpend/);
        expect(toDoRow).toMatch(/Max-plan quota/);
    });
});

describe('TRIAGE RUNNING block — wiring', () => {
    const toDoRow = read('toDoRow.js');

    it('is driven by the queue row state, with no second pending store or give-up timer', () => {
        expect(toDoRow).toMatch(/function syncTriageBlock\(/);
        // The single state read is the shared store's per-todo lookup.
        const start = toDoRow.indexOf('export function syncTriageBlock(');
        const body = toDoRow.slice(start, start + 1400);
        expect(body).toMatch(/getQueueRowForTodo\(item\.id\)/);
        expect(body).toMatch(/row\.state === 'triaging'/);
    });

    it('mounts on panel open and repaints on the live sweep (definition + two call sites)', () => {
        const calls = toDoRow.match(/syncTriageBlock\(/g) || [];
        expect(calls.length).toBeGreaterThanOrEqual(3);
    });

    it('clears the clock when the panel closes', () => {
        const start = toDoRow.indexOf('function closePanel()');
        const body = toDoRow.slice(start, start + 400);
        expect(body).toMatch(/clearTriageClock\(descSibling\)/);
    });

    it('ticks with setInterval and clears with clearInterval', () => {
        expect(toDoRow).toMatch(/block\._triageTimer = setInterval\(/);
        expect(toDoRow).toMatch(/clearInterval\(block\._triageTimer\)/);
    });
});
