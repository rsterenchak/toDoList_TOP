import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { stuckReasonText } from '../src/agentView.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STUCK reason block in the description editor: when a task's derived
// phase is `stuck` (its linked agent_queue row is failed / no_change), the editor
// surfaces the run's failure reason as a read-only block at the top — the mobile
// route that lets a red STUCK badge lead somewhere that explains itself. The modal
// is too heavily wired to instantiate end-to-end here (see mobileDescEditorRail),
// so the modal side is verified by source inspection; the shared reason resolver
// it reuses IS exercised behaviorally through agentView.js's public surface.

describe('stuckReasonText — the single Stuck-reason resolver', () => {
    it('returns the row\'s own failure_reason when present', () => {
        expect(stuckReasonText({ state: 'failed', failure_reason: 'Boom on line 3.' }))
            .toBe('Boom on line 3.');
        // Trims surrounding whitespace like the Agent board did inline.
        expect(stuckReasonText({ state: 'no_change', failure_reason: '  padded  ' }))
            .toBe('padded');
    });

    it('falls back to a no_change-specific string when the reason is blank', () => {
        expect(stuckReasonText({ state: 'no_change' }))
            .toBe('The run finished without merging any changes.');
        expect(stuckReasonText({ state: 'no_change', failure_reason: '   ' }))
            .toBe('The run finished without merging any changes.');
    });

    it('falls back to a failed string for a failed row with no reason', () => {
        expect(stuckReasonText({ state: 'failed' }))
            .toBe('The run failed. Retry from the queue.');
    });

    it('never throws on a null / undefined row', () => {
        expect(() => stuckReasonText(null)).not.toThrow();
        expect(() => stuckReasonText(undefined)).not.toThrow();
        expect(stuckReasonText(null)).toBe('The run failed. Retry from the queue.');
    });
});

describe('desc editor STUCK block — modal wiring (source inspection)', () => {
    const modals = read('modals.js');

    it('reuses agentView\'s single reason resolver rather than a second copy', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*stuckReasonText[^}]*\}\s*from\s*['"]\.\/agentView\.js['"]/
        );
        // No inline duplicate of the fallback copy in the modal.
        expect(modals).not.toMatch(/finished without merging any changes/);
    });

    it('imports the queue-row cache + change subscription it repaints from', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*getQueueRowForTodo[^}]*onQueueChange[^}]*\}\s*from\s*['"]\.\/agentQueueStore\.js['"]/
        );
    });

    it('gates the block on the STUCK phase and mounts it read-only', () => {
        const fn = modals.slice(modals.indexOf('function showDescEditorModal('));
        expect(fn).toMatch(/function renderStuckBlock\(phase\)/);
        expect(fn).toMatch(/phase\s*!==\s*PHASE\.STUCK/);
        expect(fn).toMatch(/descEditorModalStuckReason/);
        // The block text comes from the shared resolver on the linked queue row.
        expect(fn).toMatch(/stuckReasonText\(\s*queueRow\s*\)/);
    });

    it('repaints on both TODO_RUN_STATUS_EVENT and onQueueChange, and tears both down on close', () => {
        const fn = modals.slice(modals.indexOf('function showDescEditorModal('));
        expect(fn).toMatch(/onQueueChange\(\s*onRailPhaseChange\s*\)/);
        // Both listeners are removed when the modal closes — no leak.
        expect(fn).toMatch(/removeEventListener\(\s*TODO_RUN_STATUS_EVENT,\s*onRailPhaseChange\s*\)/);
        expect(fn).toMatch(/unsubscribeQueueChange\(\)/);
    });
});
