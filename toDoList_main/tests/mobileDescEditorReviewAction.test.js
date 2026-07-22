import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

import {
    setReviewBadgeTapHandler,
    invokeReviewBadgeTap,
} from '../src/todoStatus.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the mobile description-editor modal's REVIEW action: when a task's derived
// phase is `accept` (shipped, not yet acknowledged), the modal grows a single
// primary action that dismisses itself and opens the TODO.md viewer anchored to
// the entry — the mobile route out of the REVIEW rail node, since the on-row
// badge is hidden below 1024px. The modal is too heavily wired to instantiate
// end-to-end here (see mobileDescEditorRail), so the modal side is verified by
// source inspection; the shared open-and-anchor entry point it reuses IS
// exercised behaviorally through todoStatus.js's small public surface.

describe('invokeReviewBadgeTap — shared open-and-anchor entry point', () => {
    it('invokes the registered review-badge handler with the entry id + project', () => {
        const spy = vi.fn();
        setReviewBadgeTapHandler(spy);
        const result = invokeReviewBadgeTap('entry-xyz', 'Work');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('entry-xyz', 'Work');
        expect(result).toBe(true);
        setReviewBadgeTapHandler(null);
    });

    it('returns false and never throws when no handler is registered', () => {
        setReviewBadgeTapHandler(null);
        let result;
        expect(() => { result = invokeReviewBadgeTap('entry-1', 'Work'); }).not.toThrow();
        expect(result).toBe(false);
    });

    it('is the SAME handler the on-row REVIEW badge fires (single open-and-anchor path)', () => {
        // Both surfaces route through the one registered handler, so a task
        // reviewed from the modal reaches the exact viewer destination the badge
        // reaches on desktop.
        const spy = vi.fn();
        setReviewBadgeTapHandler(spy);
        invokeReviewBadgeTap('entry-2', 'Inbox');
        expect(spy).toHaveBeenCalledWith('entry-2', 'Inbox');
        setReviewBadgeTapHandler(null);
    });
});

describe('mobile desc editor REVIEW action — modal wiring', () => {
    const modals = read('modals.js');

    it('reuses the shared entry point (imports invokeReviewBadgeTap; no main.js import)', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*invokeReviewBadgeTap[^}]*\}\s*from\s*['"]\.\/todoStatus\.js['"]/
        );
        // Must not import main.js — the anchor path is a registered handler
        // precisely to avoid that cycle.
        expect(modals).not.toMatch(/from\s*['"]\.\/main\.js['"]/);
    });

    it('imports PHASE so the action gates on the accept phase by constant, not a string', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*\bPHASE\b[^}]*\}\s*from\s*['"]\.\/phase\.js['"]/
        );
    });

    it('builds a #descEditorModalReview button, hidden by default, appended to the actions block', () => {
        expect(modals).toMatch(/['"]descEditorModalReview['"]/);
        const idx = modals.indexOf("'descEditorModalReview'");
        expect(idx).toBeGreaterThan(-1);
        const block = modals.slice(idx, idx + 400);
        // Starts hidden — only the accept phase reveals it.
        expect(block).toMatch(/reviewBtn\.style\.display\s*=\s*['"]none['"]/);
        // Appended into the same actions container as the other controls.
        expect(modals).toMatch(/actions\.appendChild\(reviewBtn\)/);
    });

    it('toggles visibility ONLY in PHASE.ACCEPT via syncReviewAction', () => {
        const idx = modals.indexOf('function syncReviewAction');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 200);
        expect(fn).toMatch(/PHASE\.ACCEPT/);
        expect(fn).toMatch(/reviewBtn\.style\.display/);
    });

    it('resolves the phase once: renderRail returns it and refreshPhaseUI reuses it', () => {
        const idx = modals.indexOf('function refreshPhaseUI');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 220);
        // The review action reuses the rail's computed phase rather than calling
        // derivePhase a second time in the same render.
        expect(fn).toMatch(/renderRail\(\s*\)/);
        expect(fn).toMatch(/syncReviewAction\(\s*phase\s*\)/);
        expect(fn).not.toMatch(/derivePhase/);
    });

    it('repaints the action on TODO_RUN_STATUS_EVENT so it appears/disappears with the rail', () => {
        // onRailPhaseChange drives refreshPhaseUI, which syncs both the rail and
        // the review action — an acknowledge from another device removes it live.
        const idx = modals.indexOf('function onRailPhaseChange');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 120);
        expect(fn).toMatch(/refreshPhaseUI\(\s*\)/);
    });

    it('dismisses the modal BEFORE opening the viewer, deferring the open a tick', () => {
        const idx = modals.indexOf("reviewBtn.addEventListener('click'");
        expect(idx).toBeGreaterThan(-1);
        const handler = modals.slice(idx, idx + 500);
        const closeIdx = handler.indexOf('closeDescEditor(');
        const invokeIdx = handler.indexOf('invokeReviewBadgeTap(');
        const timeoutIdx = handler.indexOf('setTimeout(');
        expect(closeIdx).toBeGreaterThan(-1);
        expect(invokeIdx).toBeGreaterThan(-1);
        expect(timeoutIdx).toBeGreaterThan(-1);
        // close() runs before the deferred viewer open.
        expect(closeIdx).toBeLessThan(timeoutIdx);
        expect(timeoutIdx).toBeLessThan(invokeIdx);
    });

    it('captures the guarded close fn from wireModalDismiss for the review action', () => {
        expect(modals).toMatch(/const\s+closeDescEditor\s*=\s*wireModalDismiss\(/);
    });
});

describe('mobile desc editor REVIEW action — styling', () => {
    const css = read('style.css');

    it('leads the actions block on its own full-width row (order 0, ahead of Generate)', () => {
        const m = css.match(/#descEditorModalActions\s+#descEditorModalReview\s*\{([^}]*)\}/);
        expect(m).toBeTruthy();
        const body = m[1];
        expect(body).toMatch(/order:\s*0\b/);
        expect(body).toMatch(/flex:\s*0\s+0\s+100%/);
    });

    it('carries the amber REVIEW accent as a solid primary fill with dark text', () => {
        const m = css.match(/#descEditorModalActions\s+#descEditorModalReview\s*\{([^}]*)\}/);
        expect(m).toBeTruthy();
        const body = m[1];
        expect(body).toMatch(/background:\s*#ffbd5e/i);
        expect(body).toMatch(/border-color:\s*#ffbd5e/i);
        // Dark text for contrast on the amber fill (same pairing as the viewer's
        // Acknowledge pill).
        expect(body).toMatch(/color:\s*#1a1408/i);
    });
});
