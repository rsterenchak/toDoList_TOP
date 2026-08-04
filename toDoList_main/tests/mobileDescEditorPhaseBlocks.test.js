import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    buildAskingBlock,
    buildDispatchBlock,
    buildReviewBlock,
    buildReviewActions,
    openDescEditorForTodoId,
} from '../src/toDoRow.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the mobile description-editor modal's ASKING question block and DISPATCH /
// RETRY action, and the shared opener the on-row phase badges reach on touch. The
// bug these fix: on `(pointer: coarse)` the badge tap fell to the inline
// #descSibling accordion (which the mobile design never intended) and triage's
// question, the Dispatch control, and the decide surface were unreachable from the
// modal. The modal is too heavily wired to instantiate end-to-end (see
// mobileDescEditorRail), so its render functions are verified by source
// inspection; the shared builders it reuses ARE exported and constructible here.


describe('shared phase-block builders are exported from toDoRow.js', () => {
    it('exports buildAskingBlock / buildDispatchBlock / buildReviewBlock / buildReviewActions', () => {
        expect(typeof buildAskingBlock).toBe('function');
        expect(typeof buildDispatchBlock).toBe('function');
        expect(typeof buildReviewBlock).toBe('function');
        expect(typeof buildReviewActions).toBe('function');
    });

    it('buildAskingBlock renders the question + a 16px iOS-zoom-safe answer input', () => {
        const block = buildAskingBlock(
            { id: 'a1' },
            'Work',
            { id: 7, state: 'needs_words', question: 'Which file?' },
        );
        expect(block.classList.contains('askingBlock')).toBe(true);
        expect(block.getAttribute('data-answer-row')).toBe('7');
        expect(block.querySelector('.askingQuestion').textContent).toBe('Which file?');
        const input = block.querySelector('.askingAnswerInput');
        expect(input).not.toBeNull();
        // CLAUDE.md mobile-input rule: 16px floor defeats iOS Safari focus zoom.
        expect(input.style.fontSize).toBe('16px');
    });

    it('buildDispatchBlock renders Dispatch for drafted and Retry for a stuck row', () => {
        const dispatch = buildDispatchBlock({ id: 'd1' }, { id: 3, state: 'drafted', draft: 'entry text' }, 'dispatch');
        expect(dispatch.classList.contains('descDispatchBlock')).toBe(true);
        expect(dispatch.getAttribute('data-dispatch-mode')).toBe('dispatch');
        expect(dispatch.querySelector('.descDispatchButton').textContent).toBe('Dispatch');

        const retry = buildDispatchBlock({ id: 'd2' }, { id: 4, state: 'failed', entry_id: 'e4' }, 'retry');
        expect(retry.getAttribute('data-dispatch-mode')).toBe('retry');
        expect(retry.querySelector('.descDispatchButton').textContent).toBe('Retry');
    });
});


describe('desc editor ASKING block — modal wiring (source inspection)', () => {
    const modals = read('modals.js');

    it('imports the shared ASKING / DISPATCH builders from toDoRow.js', () => {
        expect(modals).toMatch(
            /import\s*\{[\s\S]*?buildAskingBlock[\s\S]*?buildDispatchBlock[\s\S]*?\}\s*from\s*['"]\.\/toDoRow\.js['"]/
        );
    });

    it('renderAskingBlock gates on PHASE.ASKING and mounts buildAskingBlock', () => {
        const idx = modals.indexOf('function renderAskingBlock(phase)');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 900);
        expect(fn).toMatch(/PHASE\.ASKING/);
        expect(fn).toMatch(/buildAskingBlock\(item,\s*opts\.projectName[^,]*,\s*queueRow\)/);
    });

    it('renderAskingBlock keeps an already-mounted block for the same queue row (no lost unsent text)', () => {
        const idx = modals.indexOf('function renderAskingBlock(phase)');
        const fn = modals.slice(idx, idx + 900);
        // Idempotent early-return keyed on the queue row's id, mirroring
        // syncAskingPanel so a live repaint doesn't drop the user's typed answer.
        expect(fn).toMatch(/data-answer-row/);
    });
});


describe('desc editor DISPATCH / RETRY action — modal wiring (source inspection)', () => {
    const modals = read('modals.js');

    it('gates the dispatch block on the queue row STATE, not the derived phase', () => {
        const idx = modals.indexOf('function renderDispatchBlock()');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 1100);
        // Opening the modal stamps draftSeenAt (clearing PHASE.DRAFTED), so the
        // control must gate on the queue row's own state — the green-but-does-
        // nothing failure this codebase pins deliberately.
        expect(fn).toMatch(/state\s*===\s*['"]drafted['"]/);
        expect(fn).toMatch(/state\s*===\s*['"]failed['"]\s*\|\|\s*state\s*===\s*['"]no_change['"]/);
        expect(fn).not.toMatch(/PHASE\.DRAFTED/);
    });

    it('mounts Retry beneath the STUCK reason card and Dispatch beneath the entry textarea', () => {
        const idx = modals.indexOf('function renderDispatchBlock()');
        const fn = modals.slice(idx, idx + 1700);
        // The builder gained a trailing projectName argument with the retriage mode,
        // so the pin is on the shared call and its first three arguments.
        expect(fn).toMatch(/buildDispatchBlock\(item,\s*queueRow,\s*mode\b/);
        expect(fn).toMatch(/descEditorModalStuck/);
        expect(fn).toMatch(/descEditorModalTextarea/);
    });

    it('refreshPhaseUI drives every phase block, mounting STUCK before DISPATCH so Retry can anchor to it', () => {
        const idx = modals.indexOf('function refreshPhaseUI');
        const fn = modals.slice(idx, idx + 320);
        const askingIdx = fn.indexOf('renderAskingBlock(');
        const stuckIdx = fn.indexOf('renderStuckBlock(');
        const dispatchIdx = fn.indexOf('renderDispatchBlock(');
        const reviewIdx = fn.indexOf('renderReviewBlock(');
        expect(askingIdx).toBeGreaterThan(-1);
        expect(reviewIdx).toBeGreaterThan(-1);
        // STUCK's reason card is the Retry anchor, so it must mount first.
        expect(stuckIdx).toBeLessThan(dispatchIdx);
    });
});


describe('badge routing keeps the module boundary (source inspection)', () => {
    it('todoStatus.js routes coarse-pointer badge taps through the registered handler, not a modals.js import', () => {
        const todoStatus = read('todoStatus.js');
        // The tap reaches the modal through the registered handler precisely to
        // avoid the todoStatus → modals/toDoRow import cycle.
        expect(todoStatus).not.toMatch(/from\s*['"]\.\/modals\.js['"]/);
        expect(todoStatus).toMatch(/agentRouteBadgeTapHandler\(item\.id,\s*projectName\)/);
        // Gated on a coarse pointer so the desktop path still falls through.
        expect(todoStatus).toMatch(/matchMedia\('\(pointer: coarse\)'\)/);
    });
});


describe('openDescEditorForTodoId — the touch badge-route opener', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => {
        // Close any modal this suite opened so its document-level phase listeners
        // (TODO_RUN_STATUS_EVENT / onQueueChange) are torn down and don't leak into
        // other suites; the × button routes through the modal's guarded close.
        const closeX = document.getElementById('descEditorModalClose');
        if (closeX) closeX.click();
        document.body.innerHTML = '';
    });

    it('is a safe no-op with no #mainList and with no matching row (never throws, no modal)', () => {
        expect(() => openDescEditorForTodoId('nope')).not.toThrow();

        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        const row = document.createElement('div');
        row.id = 'toDoChild';
        row.__item = { id: 'other', tit: 'X' };
        mainList.appendChild(row);
        document.body.appendChild(mainList);

        expect(() => openDescEditorForTodoId('missing')).not.toThrow();
        expect(() => openDescEditorForTodoId()).not.toThrow();
        // No matching row → the modal never opens.
        expect(document.getElementById('descEditorModalBackdrop')).toBeNull();
    });

    it('resolves the live #mainList row by item id and opens the description modal', () => {
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        const row = document.createElement('div');
        row.id = 'toDoChild';
        row.dataset.value = 'Work';
        row.__item = { id: 'todo-open', tit: 'A committed task', desc: '', status: 'active' };
        mainList.appendChild(row);
        document.body.appendChild(mainList);

        openDescEditorForTodoId('todo-open');

        // The shared opener path builds the modal for the resolved row.
        expect(document.getElementById('descEditorModalBackdrop')).not.toBeNull();
    });

    it('source: resolves the row from #mainList by __item.id and reuses openDescEditorForRow', () => {
        const toDoRow = read('toDoRow.js');
        const idx = toDoRow.indexOf('function openDescEditorForTodoId(');
        expect(idx).toBeGreaterThan(-1);
        const fn = toDoRow.slice(idx, idx + 700);
        expect(fn).toMatch(/getElementById\('mainList'\)/);
        expect(fn).toMatch(/__item/);
        expect(fn).toMatch(/openDescEditorForRow\(/);
    });
});
