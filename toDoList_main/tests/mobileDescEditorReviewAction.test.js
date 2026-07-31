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

// Pins the mobile description-editor modal's REVIEW (accept-phase) surface: when a
// task's derived phase is `accept` (shipped, not yet acknowledged), the modal
// mounts the SHARED WHAT CHANGED card (buildReviewBlock) plus the Accept / Revert /
// Open-in-TODO.md action row (buildReviewActions) at the top of its body — the same
// decide surface the desktop detail pane mounts inline, since the on-row badge is
// hidden below 1024px. OPEN IN TODO.MD still routes out to the anchored viewer, but
// via buildReviewActions' onOpenInViewer hook that dismisses the modal first. The
// modal is too heavily wired to instantiate end-to-end here (see
// mobileDescEditorRail), so the modal side is verified by source inspection; the
// shared open-and-anchor entry point it reuses IS exercised behaviorally through
// todoStatus.js's small public surface.

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

describe('mobile desc editor REVIEW block — modal wiring', () => {
    const modals = read('modals.js');

    it('reuses the shared entry point (imports invokeReviewBadgeTap; no main.js import)', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*invokeReviewBadgeTap[^}]*\}\s*from\s*['"]\.\/todoStatus\.js['"]/
        );
        // Must not import main.js — the anchor path is a registered handler
        // precisely to avoid that cycle.
        expect(modals).not.toMatch(/from\s*['"]\.\/main\.js['"]/);
    });

    it('imports PHASE so the block gates on the accept phase by constant, not a string', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*\bPHASE\b[^}]*\}\s*from\s*['"]\.\/phase\.js['"]/
        );
    });

    it('imports the shared review builders from toDoRow.js (one card + actions for both hosts)', () => {
        expect(modals).toMatch(
            /import\s*\{[\s\S]*?buildReviewBlock[\s\S]*?buildReviewActions[\s\S]*?\}\s*from\s*['"]\.\/toDoRow\.js['"]/
        );
    });

    it('the old single-route reviewBtn + syncReviewAction are gone — the decide surface mounts in the body', () => {
        // The accept-phase surface is no longer a lone "Review shipped change"
        // button in the actions row; the WHAT CHANGED card + Accept/Revert/Open
        // action row mount at the top of the body via renderReviewBlock.
        expect(modals).not.toMatch(/descEditorModalReview/);
        expect(modals).not.toMatch(/function syncReviewAction/);
    });

    it('renderReviewBlock gates on PHASE.ACCEPT and mounts buildReviewBlock + buildReviewActions', () => {
        const idx = modals.indexOf('function renderReviewBlock(phase)');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 2100);
        expect(fn).toMatch(/phase\s*!==\s*PHASE\.ACCEPT/);
        expect(fn).toMatch(/buildReviewBlock\(item,\s*queueRow\)/);
        expect(fn).toMatch(/buildReviewActions\(item,\s*projectName/);
    });

    it('OPEN IN TODO.MD dismisses the modal BEFORE opening the viewer, deferring the open a tick', () => {
        const idx = modals.indexOf('function renderReviewBlock(phase)');
        const fn = modals.slice(idx, idx + 2100);
        // The modal passes an onOpenInViewer callback so buildReviewActions'
        // OPEN button closes the modal first, then defers the anchored viewer.
        expect(fn).toMatch(/onOpenInViewer/);
        const closeIdx = fn.indexOf('closeDescEditor(');
        const timeoutIdx = fn.indexOf('setTimeout(');
        const invokeIdx = fn.indexOf('invokeReviewBadgeTap(');
        expect(closeIdx).toBeGreaterThan(-1);
        expect(timeoutIdx).toBeGreaterThan(-1);
        expect(invokeIdx).toBeGreaterThan(-1);
        expect(closeIdx).toBeLessThan(timeoutIdx);
        expect(timeoutIdx).toBeLessThan(invokeIdx);
    });

    it('resolves the phase once: renderRail returns it and refreshPhaseUI reuses it (no second derivePhase)', () => {
        const idx = modals.indexOf('function refreshPhaseUI');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 320);
        expect(fn).toMatch(/renderRail\(\s*\)/);
        expect(fn).toMatch(/renderReviewBlock\(\s*phase\s*\)/);
        // The block reuses the rail's computed phase rather than calling
        // derivePhase a second time in the same render.
        expect(fn).not.toMatch(/derivePhase/);
    });

    it('repaints the block on TODO_RUN_STATUS_EVENT so it appears/disappears with the rail', () => {
        // onRailPhaseChange drives refreshPhaseUI, which repaints the review block —
        // an acknowledge from another device removes it live.
        const idx = modals.indexOf('function onRailPhaseChange');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 120);
        expect(fn).toMatch(/refreshPhaseUI\(\s*\)/);
    });

    it('captures the guarded close fn from wireModalDismiss for the review block', () => {
        expect(modals).toMatch(/const\s+closeDescEditor\s*=\s*wireModalDismiss\(/);
    });
});

describe('mobile desc editor REVIEW block — styling', () => {
    const css = read('style.css');

    it('reuses the shared .descReviewBlock treatment, dropping the grid gutters for the modal host', () => {
        // One class serves both hosts; the modal body's own padding insets it, so
        // the modal-host rule only zeroes the #descSibling grid side margins.
        const m = css.match(/#descEditorModalBody\s+\.descReviewBlock\s*\{([^}]*)\}/);
        expect(m).toBeTruthy();
        const body = m[1];
        expect(body).toMatch(/margin-left:\s*0/);
        expect(body).toMatch(/margin-right:\s*0/);
    });

    it('keeps the shared ACCEPT amber / REVERT red / OPEN ghost button treatment', () => {
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
