import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Regression pins for the desktop description panel's phase blocks.
//
// `#descSibling` is a three-column grid (14px / 1fr / 14px). Any child appended
// without an explicit `grid-column` auto-places into the 14px gutter column,
// which crushes a full-width block one word per line. Both the ASKING question
// block and the STUCK failure-reason block mount as the panel's firstChild, so
// both must span the full grid row — the same hardening `#descSibling .injectBtn`
// / `.generateBtn` already carry. This defect is invisible to any test that does
// not read the layout, which is why it shipped.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Return the declaration body of the FIRST top-level rule whose (possibly
// comma-grouped) selector list contains `needle`. Handles grouped selectors,
// which the exact-match extractors in the sibling tests do not.
function ruleBodyContaining(css, needle) {
    let depth = 0;
    let selectorStart = 0;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '{') {
            if (depth === 0) {
                const selector = css.slice(selectorStart, i);
                if (selector.includes(needle)) {
                    const blockEnd = css.indexOf('}', i);
                    return css.slice(i + 1, blockEnd);
                }
            }
            depth++;
            continue;
        }
        if (c === '}') {
            depth--;
            if (depth === 0) selectorStart = i + 1;
            continue;
        }
    }
    return null;
}

describe('desktop description panel — ASKING/STUCK blocks span the grid', () => {
    const css = read('style.css');

    it('.askingBlock is placed full-width inside #descSibling', () => {
        const body = ruleBodyContaining(css, '#descSibling .askingBlock');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-column:\s*1\s*\/\s*-1\s*;/);
    });

    it('the desktop STUCK block reuses the modal class and is placed full-width inside #descSibling', () => {
        const body = ruleBodyContaining(css, '#descSibling .descEditorModalStuck');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-column:\s*1\s*\/\s*-1\s*;/);
    });
});

describe('desktop description panel — STUCK block wiring', () => {
    const toDoRow = read('toDoRow.js');
    const main = read('main.js');

    it('mounts the STUCK block only for a task whose derived phase is STUCK', () => {
        expect(toDoRow).toMatch(/function syncStuckPanel\(/);
        expect(toDoRow).toMatch(/derivePhase\(item\)\s*===\s*PHASE\.STUCK/);
    });

    it('reuses the modal class names rather than authoring a parallel treatment', () => {
        expect(toDoRow).toMatch(/className\s*=\s*'descEditorModalStuck'/);
        expect(toDoRow).toMatch(/'descEditorModalStuckLabel'/);
        expect(toDoRow).toMatch(/'descEditorModalStuckReason'/);
    });

    it('mounts the block on panel open and repaints it on the live sweep', () => {
        // wireDescToggle (open) and refreshDescStatusDots (live) both call it.
        const opens = toDoRow.match(/syncStuckPanel\(/g) || [];
        // one definition + two call sites
        expect(opens.length).toBeGreaterThanOrEqual(3);
    });

    it('re-applies the expanded-viewer height when the block is added or removed', () => {
        const start = toDoRow.indexOf('function syncStuckPanel(');
        const sync = toDoRow.slice(start, start + 900);
        expect(sync).toMatch(/refreshViewerExpandedHeight\(\)/);
    });

    it('resolves the reason through a registered seam, never importing agentView into the row layer', () => {
        // The row layer must not import the Agent view (cycle-avoidance boundary).
        expect(toDoRow).not.toMatch(/from '\.\/agentView\.js'/);
        expect(toDoRow).toMatch(/function setStuckReasonResolver\(/);
        // main.js — which imports both — wires the single copy resolver.
        expect(main).toMatch(/setStuckReasonResolver\(stuckReasonText\)/);
        expect(main).toMatch(/stuckReasonText,?\s*\n\s*}\s*from '\.\/agentView\.js'/);
    });
});
