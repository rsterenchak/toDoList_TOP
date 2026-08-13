import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { applyPhaseLayout, DESC_PANEL_CHILD_SELECTORS } from '../src/toDoRow.js';
import { buildManualStatusControl } from '../src/todoStatus.js';
import { PHASE } from '../src/phase.js';

// Pins the desktop-row status rework:
//   1. the manual status TEXT is dropped from desktop rows (≥1024px), leaving
//      only the blocked-phase overlay words visible,
//   2. the IN PROGRESS left-stripe is recoloured from purple to amber, matching
//      the mobile edge tab, and
//   3. the shared MANUAL STATUS control is mounted into the desktop detail pane,
//      below the action buttons, and stays visible in the terminal `done` phase.
//
// Source-inspection for the CSS (jsdom does not compute layout / media queries)
// plus runtime assertions on the shared builder + applyPhaseLayout.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

// The declaration body of the first top-level rule whose selector contains
// `needle` (matches descPanelRailContract's helper).
function ruleBodyContaining(css, needle) {
    let depth = 0;
    let selectorStart = 0;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '{') {
            if (depth === 0) {
                const selector = css.slice(selectorStart, i);
                if (selector.includes(needle)) {
                    return css.slice(i + 1, css.indexOf('}', i));
                }
            }
            depth++;
            continue;
        }
        if (c === '}') {
            depth--;
            if (depth === 0) selectorStart = i + 1;
        }
    }
    return null;
}

describe('desktop rows — manual status text is dropped (≥1024px)', () => {
    const css = read('style.css');
    // Scope to the desktop media block so this never accidentally matches the
    // ≤1023px mobile rule that already hides the badge.
    const desktopStart = css.indexOf('@media (min-width: 1024px)');
    const mobileStart = css.indexOf('@media (max-width: 1023px)');
    const desktopSlice = css.slice(desktopStart, mobileStart);

    it('the desktop block exists and precedes the mobile block', () => {
        expect(desktopStart).toBeGreaterThan(-1);
        expect(mobileStart).toBeGreaterThan(desktopStart);
    });

    it('hides the badge by default at desktop widths', () => {
        expect(desktopSlice).toMatch(/\.todoStatusLabel\s*\{\s*display:\s*none/);
    });

    it('re-exposes ONLY the blocked-phase overlay words (never the three manual values)', () => {
        // The re-expose rule lists the derived overlays and nothing else, so a
        // future phase word cannot be accidentally hidden.
        expect(desktopSlice).toMatch(/\.todoStatusLabel\[data-status="review"\]/);
        expect(desktopSlice).toMatch(/\.todoStatusLabel\[data-status="asking"\]/);
        expect(desktopSlice).toMatch(/\.todoStatusLabel\[data-status="drafted"\]/);
        expect(desktopSlice).toMatch(/\.todoStatusLabel\[data-status="stuck"\]/);
        expect(desktopSlice).toMatch(/\.todoStatusLabel\[data-status="mockup"\]/);
        // The manual values (active / in_progress / idea) are NOT enumerated as
        // display exceptions — they only appear (if at all) in colour rules.
        expect(desktopSlice).not.toMatch(/data-status="active"\][\s\S]{0,60}display:\s*inline/);
        expect(desktopSlice).not.toMatch(/data-status="in_progress"\][\s\S]{0,60}display:\s*inline/);
        expect(desktopSlice).not.toMatch(/data-status="idea"\][\s\S]{0,60}display:\s*inline/);
    });
});

describe('desktop rows — the IN PROGRESS stripe is amber, not purple', () => {
    const css = read('style.css');

    it('the base in-progress row rule uses the amber warning token, inset form', () => {
        const body = ruleBodyContaining(css, '#toDoChild.todo-row--in_progress ');
        // Fall back to the exact-brace form if the trailing-space needle misses.
        const rule = body !== null
            ? body
            : ruleBodyContaining(css, '#toDoChild.todo-row--in_progress');
        expect(rule).not.toBeNull();
        expect(rule).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--text-warning\)/);
        // The old purple must be gone from this rule.
        expect(rule).not.toMatch(/#9D93EE/);
    });
});

describe('desktop detail pane — mounts the shared MANUAL STATUS control below the actions', () => {
    const toDoRow = read('toDoRow.js');

    it('imports buildManualStatusControl from todoStatus.js', () => {
        expect(toDoRow).toMatch(
            /import\s*\{[^}]*buildManualStatusControl[^}]*\}\s*from\s*['"]\.\/todoStatus\.js['"]/
        );
    });

    it('mounts it into the footer stack AFTER the actions row', () => {
        // Inject / Generate / Discuss now live inside the `.descActionsRow`
        // wrapper; MANUAL STATUS still mounts below that whole row at the foot.
        // Both now sit in the `.descPanelFooter` wrapper the detail pane pins to
        // its floor, so the mount parent is the footer rather than #descSibling —
        // the relative order this pin guards is unchanged.
        const actionsIdx = toDoRow.indexOf('footer.appendChild(actionsRow)');
        const statusIdx = toDoRow.indexOf('footer.appendChild(manualStatusRow)');
        expect(actionsIdx).toBeGreaterThan(-1);
        expect(statusIdx).toBeGreaterThan(-1);
        expect(statusIdx).toBeGreaterThan(actionsIdx);
    });

    it('reuses an existing status row across reopens rather than re-creating it', () => {
        // The children of #descSibling survive a close (the file-picker
        // duplication lesson), so the mount must query-then-reuse.
        expect(toDoRow).toMatch(/querySelector\(\s*['"]#descEditorModalStatusRow['"]\s*\)/);
    });
});

describe('desktop detail pane — status row is grid-placed and excluded from the done-phase hide', () => {
    const css = read('style.css');

    it('the status row is in the panel child contract with a grid-column rule', () => {
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling #descEditorModalStatusRow');
        const body = ruleBodyContaining(css, '#descSibling #descEditorModalStatusRow');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-column:/);
    });

    it('applyPhaseLayout leaves the MANUAL STATUS control visible in the `done` phase', () => {
        const panel = document.createElement('div');
        panel.id = 'descSibling';
        const input = document.createElement('textarea');
        input.id = 'descInput';
        panel.appendChild(input);
        const statusRow = buildManualStatusControl({ status: 'active', tit: 'x' }, 'Work');
        panel.appendChild(statusRow);

        applyPhaseLayout(panel, PHASE.DONE);

        // The authoring group hides in `done`…
        expect(input.hidden).toBe(true);
        // …but the manual status control stays settable on a completed task.
        expect(statusRow.hidden).toBe(false);
    });
});
