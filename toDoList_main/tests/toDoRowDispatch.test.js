import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { DESC_PANEL_CHILD_SELECTORS } from '../src/toDoRow.js';

// The description-panel Dispatch (drafted) / Retry (stuck) action is source-pinned
// like the ASKING / STUCK block wiring (buildToDoRow is too heavily wired to
// instantiate end-to-end in jsdom — see the row-layer test caveat). These pins
// assert the action mounts only in its two phases, is grid-placed, is excluded
// from the done-phase authoring hide, and repaints on both open and the live sweep.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');
const toDoRow = read('toDoRow.js');
const css = read('style.css');

describe('toDoRow Dispatch / Retry action wiring', () => {
    it('mounts a Dispatch action for the drafted phase and a Retry action for the stuck phase', () => {
        expect(toDoRow).toMatch(/function syncDispatchPanel\(/);
        expect(toDoRow).toMatch(/phase === PHASE\.DRAFTED \? 'dispatch'/);
        expect(toDoRow).toMatch(/phase === PHASE\.STUCK \? 'retry'/);
    });

    it('runs the SHARED dispatch, never importing the Agent view into the row layer', () => {
        // Tolerant of additional named imports from the shared module (the review
        // surface also pulls resolveDispatchTarget from here); what matters is that
        // dispatchDraft comes from dispatchDraft.js and agentView is never imported.
        expect(toDoRow).toMatch(/import \{[^}]*\bdispatchDraft\b[^}]*\} from '\.\/dispatchDraft\.js'/s);
        expect(toDoRow).not.toMatch(/from '\.\/agentView\.js'/);
    });

    it('passes the row\'s existing entry_id so a Retry dedup-skips rather than duplicating', () => {
        expect(toDoRow).toMatch(/dispatchDraft\(queueRow,\s*draftText,\s*queueRow\.entry_id\)/);
    });

    it('guards the empty-draft case for Dispatch rather than dispatching nothing', () => {
        const start = toDoRow.indexOf('function buildDispatchBlock(');
        // Widened from 2200 when the retriage mode landed: the guard is unchanged,
        // but the retriage branch and its helpers pushed it further down the body.
        const body = toDoRow.slice(start, start + 3400);
        expect(body).toMatch(/if \(!isRetry && !draftText\)/);
    });

    it('mounts on panel open AND repaints on the live sweep (one def + two call sites)', () => {
        const calls = toDoRow.match(/syncDispatchPanel\(/g) || [];
        expect(calls.length).toBeGreaterThanOrEqual(3);
    });

    it('re-applies the expanded-viewer height when the action is added or removed', () => {
        const start = toDoRow.indexOf('function syncDispatchPanel(');
        const body = toDoRow.slice(start, start + 1400);
        expect(body).toMatch(/refreshViewerExpandedHeight\(\)/);
    });

    it('registers the block in the panel child grid contract', () => {
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descDispatchBlock');
        const body = (() => {
            const idx = css.indexOf('#descSibling .descDispatchBlock');
            const brace = css.indexOf('{', idx);
            return css.slice(brace + 1, css.indexOf('}', brace));
        })();
        expect(body).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    });

    it('is NOT in the authoring group hidden by applyPhaseLayout in the done phase', () => {
        // The action belongs to drafted / stuck, which are never `done`; it must
        // stay out of the group applyPhaseLayout hides so it never gets a stray
        // [hidden]. Assert its class does not appear in DESC_AUTHORING_GROUP_SELECTORS.
        const start = toDoRow.indexOf('DESC_AUTHORING_GROUP_SELECTORS = Object.freeze([');
        const group = toDoRow.slice(start, toDoRow.indexOf(']', start));
        expect(group).not.toMatch(/descDispatchBlock/);
        expect(group).not.toMatch(/descDispatchButton/);
    });

    it('styles Retry in the danger red carrying the stuck state', () => {
        const idx = css.indexOf('.descDispatchButton--retry {');
        expect(idx).toBeGreaterThan(-1);
        const body = css.slice(idx, css.indexOf('}', idx));
        expect(body).toMatch(/var\(--text-danger\)/);
    });
});
