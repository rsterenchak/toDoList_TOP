import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { DESC_PANEL_CHILD_SELECTORS } from '../src/toDoRow.js';

// The detail-pane REVIEW (accept-phase) decision surface — Accept / Revert /
// Open-in-TODO.md plus the WHAT CHANGED card — is source-pinned like the ASKING /
// STUCK / Dispatch block wiring (buildToDoRow is too heavily wired to instantiate
// end-to-end in jsdom — see the row-layer test caveat). These pins assert it mounts
// only in the accept phase and only in detail-pane mode, reuses the EXISTING
// acknowledge writer and revert route rather than a second path, is grid-placed,
// is excluded from the done-phase authoring hide, and repaints on both open and the
// live sweep.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');
const toDoRow = read('toDoRow.js');
const css = read('style.css');

describe('toDoRow REVIEW decision surface wiring', () => {
    it('mounts the review surface only for the accept phase', () => {
        expect(toDoRow).toMatch(/function syncReviewPanel\(/);
        const start = toDoRow.indexOf('function syncReviewPanel(');
        const body = toDoRow.slice(start, start + 1800);
        expect(body).toMatch(/phase === PHASE\.ACCEPT/);
    });

    it('is DESKTOP-ONLY — gated on detail-pane mode so nothing mounts on mobile', () => {
        const start = toDoRow.indexOf('function syncReviewPanel(');
        const body = toDoRow.slice(start, start + 400);
        expect(body).toMatch(/if \(!isDetailPaneMode\(\)\) return;/);
    });

    it('acknowledges through the SAME writer the viewer\'s Acknowledge pill uses', () => {
        const start = toDoRow.indexOf('function buildReviewActions(');
        const body = toDoRow.slice(start, start + 2600);
        expect(body).toMatch(/listLogic\.markEntryReviewed\(item\.id\)/);
        // Emits the run-status event so the phase advances to done and the sweep
        // clears the block — the same signal the viewer's acknowledge emits.
        expect(body).toMatch(/TODO_RUN_STATUS_EVENT/);
    });

    it('reverts through the SHARED revert route, not a reimplementation', () => {
        expect(toDoRow).toMatch(/import \{[^}]*revertEntry[^}]*\} from '\.\/inject\.js'/s);
        const start = toDoRow.indexOf('function performReviewRevert(');
        const body = toDoRow.slice(start, start + 1800);
        expect(body).toMatch(/revertEntry\(item\.entryId,\s*resolveDispatchTarget\(\)\)/);
        // The three Worker outcomes are handled exactly as the viewer's pill does.
        expect(body).toMatch(/res\.merged === true/);
        expect(body).toMatch(/res\.merged === false/);
    });

    it('opens the viewer through the shared review-badge entry point (default, no modal host)', () => {
        expect(toDoRow).toMatch(/import \{[^}]*invokeReviewBadgeTap[^}]*\} from '\.\/todoStatus\.js'/s);
        const start = toDoRow.indexOf('function buildReviewActions(');
        // Widened window: buildReviewActions grew an optional modal-host
        // onOpenInViewer branch above the default direct call, then the
        // primary/tertiary cluster containers above the buttons themselves.
        const body = toDoRow.slice(start, start + 4200);
        // The desktop detail pane passes no options, so the OPEN button falls
        // through to the shared entry point directly.
        expect(body).toMatch(/invokeReviewBadgeTap\(item && item\.entryId, projectName\)/);
    });

    it('lets a modal host supply its own close-then-open route via options.onOpenInViewer', () => {
        const start = toDoRow.indexOf('function buildReviewActions(');
        // Same widened window as above — the cluster containers sit between the
        // signature and the OPEN handler.
        const body = toDoRow.slice(start, start + 4200);
        // Signature carries the optional options bag …
        expect(body).toMatch(/function buildReviewActions\(item, projectName, options\)/);
        // … and the OPEN handler prefers the host's callback when present, so the
        // mobile modal can dismiss itself before opening the anchored viewer.
        expect(body).toMatch(/opts2\.onOpenInViewer/);
    });

    it('mounts on panel open AND repaints on the live sweep (one def + two call sites)', () => {
        const calls = toDoRow.match(/syncReviewPanel\(/g) || [];
        expect(calls.length).toBeGreaterThanOrEqual(3);
    });

    it('re-applies the expanded-viewer height when the surface is added or removed', () => {
        const start = toDoRow.indexOf('function syncReviewPanel(');
        const body = toDoRow.slice(start, start + 1800);
        expect(body).toMatch(/refreshViewerExpandedHeight\(\)/);
    });

    it('registers both grid children in the panel child grid contract', () => {
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descReviewBlock');
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descReviewActions');
        const gridColOf = (needle) => {
            const idx = css.indexOf(needle + ' {');
            const brace = css.indexOf('{', idx);
            return css.slice(brace + 1, css.indexOf('}', brace));
        };
        expect(gridColOf('#descSibling .descReviewBlock')).toMatch(/grid-column:\s*1\s*\/\s*-1/);
        expect(gridColOf('#descSibling .descReviewActions')).toMatch(/grid-column:\s*2/);
    });

    it('is NOT in the authoring group hidden by applyPhaseLayout in the done phase', () => {
        // Accepting is precisely what moves a task INTO `done`; sweeping these into
        // the group would make the controls vanish mid-interaction.
        const start = toDoRow.indexOf('DESC_AUTHORING_GROUP_SELECTORS = Object.freeze([');
        const group = toDoRow.slice(start, toDoRow.indexOf(']', start));
        expect(group).not.toMatch(/descReviewBlock/);
        expect(group).not.toMatch(/descReviewActions/);
        expect(group).not.toMatch(/descReviewBtn/);
    });

    it('styles ACCEPT in amber, REVERT in danger red, OPEN as a ghost action', () => {
        const bodyOf = (sel) => {
            const idx = css.indexOf(sel + ' {');
            expect(idx).toBeGreaterThan(-1);
            return css.slice(idx, css.indexOf('}', idx));
        };
        expect(bodyOf('.descReviewBtn--accept')).toMatch(/#ffbd5e/);
        expect(bodyOf('.descReviewBtn--revert')).toMatch(/var\(--text-danger\)/);
        expect(bodyOf('.descReviewBtn--open')).toMatch(/background:\s*transparent/);
    });
});
