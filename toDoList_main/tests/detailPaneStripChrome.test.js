import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Detail-pane chrome strip: when #descSibling is hosted in #descDetailPane it is
// content sitting on the pane background, not a drawer hanging off a row — so the
// pane-mode rule must strip the base card chrome (border + accent left-edge,
// radius, elevated background) and the redundant "THE ENTRY" section label. The
// base #descSibling rule keeps all of it for the mobile inline drawer host. These
// are stylesheet-text (source-structural) assertions: jsdom does not compute
// layout, so the contract is pinned against the CSS declarations, matching the
// existing detail-pane CSS tests.

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Extract the body of the FIRST CSS rule whose selector text exactly matches.
// The needle is line-anchored ("\n" + selector) so a bare "#descSibling" does not
// match inside the longer "#descDetailPane #descSibling" selector.
function ruleBody(selector) {
    const needle = '\n' + selector + ' {';
    const start = css.indexOf(needle);
    if (start === -1) return null;
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
}

describe('detail pane — strips the drawer chrome from #descSibling', () => {
    const paneRule = ruleBody('#descDetailPane #descSibling');

    it('has a pane-scoped #descSibling rule', () => {
        expect(paneRule).toBeTruthy();
    });

    it('removes the border (and thus the accent left-edge), radius, and elevated background', () => {
        expect(paneRule).toMatch(/border:\s*none/);
        expect(paneRule).toMatch(/border-radius:\s*0\b/);
        expect(paneRule).toMatch(/background:\s*transparent/);
    });

    it('no longer re-asserts the old drawer border-top / 6px radius', () => {
        // The pre-fix rule gave the pane panel a full border-top + 6px radius,
        // which read as a card inside a card. Those must be gone.
        expect(paneRule).not.toMatch(/border-top:/);
        expect(paneRule).not.toMatch(/border-radius:\s*6px/);
    });
});

describe('detail pane — hides the redundant THE ENTRY label in pane mode', () => {
    it('scopes display:none to the pane host so the label is not rendered there', () => {
        const rule = ruleBody('#descDetailPane .descSiblingEntryLabel');
        expect(rule).toBeTruthy();
        expect(rule).toMatch(/display:\s*none/);
    });

    it('keeps the label registered as a grid child so the structural guard still holds', () => {
        // The element still renders (only visually removed), so its grid-column
        // placement must survive for DESC_PANEL_CHILD_SELECTORS.
        const gridRule = ruleBody('#descSibling .descSiblingEntryLabel');
        expect(gridRule).toBeTruthy();
        expect(gridRule).toMatch(/grid-column:\s*2/);
    });
});

describe('detail pane — mobile inline drawer keeps its chrome (untouched)', () => {
    const baseRule = ruleBody('#descSibling');

    it('the base #descSibling rule still carries border, radius, accent left-edge, and surface background', () => {
        expect(baseRule).toBeTruthy();
        expect(baseRule).toMatch(/border:\s*0\.5px solid var\(--border-mid\)/);
        expect(baseRule).toMatch(/border-radius:\s*0 0 6px 6px/);
        expect(baseRule).toMatch(/border-left:\s*2px solid var\(--accent-dim\)/);
        expect(baseRule).toMatch(/background:\s*var\(--bg-surface\)/);
    });
});
