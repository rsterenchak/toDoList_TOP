import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { buildStatusLabel } from '../src/todoStatus.js';

// Pins the MOBILE mockup flow in the description-editor modal: the MOCKUP badge
// routes to the description panel at every width, but the flow previously mounted
// only in the desktop detail pane — so on mobile, tapping ⌁ MOCKUP opened a modal
// with no variants and no way to choose. This mounts the SHARED mockupFlow in the
// modal too, in the tabbed layout, and fixes the badge's stale accessible label.
//
// The modal is too heavily wired to instantiate end-to-end here (see
// mobileDescEditorRail / mobileDescEditorStuckBlock), so the modal side is verified
// by source inspection; the tabbed renderer it drives IS exercised behaviorally in
// mockupFlowTabbedRenderer.test.js, and the badge label is checked live below.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

describe('desc editor MOCKUP block — modal wiring (source inspection)', () => {
    const modals = read('modals.js');

    it('drives the SAME shared mockupFlow implementation, not a reimplementation', () => {
        expect(modals).toMatch(
            /import\s*\{\s*buildMockupSecondary\s*\}\s*from\s*['"]\.\/mockupFlow\.js['"]/
        );
        // No inline reimplementation of generation / parsing / the Use path.
        expect(modals).not.toMatch(/===VARIANT/);
        expect(modals).not.toMatch(/parseMockupVariants/);
    });

    it('requests the tabbed layout so three frames do not blow the modal height cap', () => {
        const fn = modals.slice(modals.indexOf('function showDescEditorModal('));
        expect(fn).toMatch(/function renderMockupBlock\(phase\)/);
        expect(fn).toMatch(/buildMockupSecondary\(\s*queueRow,\s*\{\s*tabbed:\s*true\s*\}\s*\)/);
    });

    it('gates the block on the MOCKUP phase and clears it once the queue row moves on', () => {
        const fn = modals.slice(modals.indexOf('function showDescEditorModal('));
        expect(fn).toMatch(/phase === PHASE\.MOCKUP/);
        // Resolves the queue row from the linked todo (not the selected project).
        expect(fn).toMatch(/getQueueRowForTodo\(item\.id\)/);
    });

    it('mounts idempotently, keyed on the queue row, so a repaint never wipes an in-flight Generate', () => {
        const fn = modals.slice(modals.indexOf('function showDescEditorModal('));
        // Same-row early return, like renderStuckBlock's idempotency.
        expect(fn).toMatch(/data-mockup-row/);
        expect(fn).toMatch(/getAttribute\('data-mockup-row'\)\s*===\s*String\(queueRow\.id\)/);
    });

    it('repaints on the shared phase sweep (refreshPhaseUI → onQueueChange / TODO_RUN_STATUS_EVENT)', () => {
        const fn = modals.slice(modals.indexOf('function showDescEditorModal('));
        const refresh = fn.slice(fn.indexOf('function refreshPhaseUI('), fn.indexOf('function refreshPhaseUI(') + 220);
        expect(refresh).toMatch(/renderMockupBlock\(phase\)/);
        // The queue-change / status subscriptions are still torn down on close.
        expect(fn).toMatch(/onQueueChange\(\s*onRailPhaseChange\s*\)/);
        expect(fn).toMatch(/unsubscribeQueueChange\(\)/);
    });
});

describe('MOCKUP / DRAFTED / STUCK badge accessible labels name the description panel, not the board', () => {
    const todoStatus = read('todoStatus.js');

    it('no derived badge label still says "the board" / "the Agent board"', () => {
        // The tap opens the row's description panel (pane or mobile modal), never
        // the Agent board — the stale wording strands a screen-reader user.
        expect(todoStatus).not.toMatch(/open the board/i);
        expect(todoStatus).not.toMatch(/open the Agent board/i);
    });

    it('the MOCKUP badge label names the description panel and still mentions the mockup', () => {
        const label = buildStatusLabel({ status: 'active' }, 'mockup');
        const aria = label.getAttribute('aria-label');
        expect(aria).toMatch(/mockup/i);
        expect(aria).toMatch(/description panel/i);
        expect(aria).not.toMatch(/board/i);
    });

    it('the DRAFTED badge label names the description panel', () => {
        const aria = buildStatusLabel({ status: 'active' }, 'drafted').getAttribute('aria-label');
        expect(aria).toMatch(/draft/i);
        expect(aria).toMatch(/description panel/i);
        expect(aria).not.toMatch(/board/i);
    });

    it('the STUCK badge label names the description panel', () => {
        const aria = buildStatusLabel({ status: 'active' }, 'stuck').getAttribute('aria-label');
        expect(aria).toMatch(/description panel/i);
        expect(aria).not.toMatch(/board/i);
    });
});

describe('mobile tabbed mockup CSS (style.css)', () => {
    const css = read('style.css');

    it('styles the tab strip as a radiogroup row and the selected tab with a solid accent fill', () => {
        expect(css).toMatch(/\.agentMockupTabs\s*\{[^}]*display:\s*flex/);
        expect(css).toMatch(/\.agentMockupTab\.is-selected\s*\{[^}]*background:\s*var\(--accent\)/);
    });

    it('gives the tab a 16px font so iOS does not auto-zoom on focus', () => {
        expect(css).toMatch(/\.agentMockupTab\s*\{[^}]*font-size:\s*16px/);
    });
});
