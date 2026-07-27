import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Regression pin for: "Queue row: selection stripe hides the manual status
// stripe". The selected-row treatment (`.todo-detail-open`) and the manual
// status stripe (`.todo-row--in_progress`) both used `box-shadow`, which does
// not compose across rules — the higher-specificity detail-open selector
// replaced the amber status stripe entirely, so an open in-progress row showed
// the selection stripe instead of its status colour.
//
// The fix keeps `box-shadow` reserved for status and carries selection on a
// DIFFERENT CSS property (a right-edge ::after marker). This test asserts the
// two treatments never share the clobbering property again. jsdom does not
// compute layout, so this is a stylesheet-structure assertion.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

// Declaration body of the first top-level rule whose selector contains `needle`.
// (Same walker used by descPanelRailContract / desktopRowStatusPaneControl.)
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

describe('queue row — selection and manual status use different CSS properties', () => {
    const css = read('style.css');

    it('the manual-status stripe carries the status colour on box-shadow', () => {
        const rule = ruleBodyContaining(css, '#toDoChild.todo-row--in_progress ')
            ?? ruleBodyContaining(css, '#toDoChild.todo-row--in_progress');
        expect(rule).not.toBeNull();
        expect(rule).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--text-warning\)/);
    });

    it('the selected-row treatment does NOT declare box-shadow (so it cannot clobber the status stripe)', () => {
        // The base detail-open rule must not carry a box-shadow — that is the
        // exact declaration that previously replaced the status stripe.
        const base = ruleBodyContaining(css, '#mainList #toDoChild.todo-detail-open ')
            ?? ruleBodyContaining(css, '#mainList #toDoChild.todo-detail-open {');
        expect(base).not.toBeNull();
        expect(base).not.toMatch(/box-shadow/);
    });

    it('carries selection on a different property — a right-edge ::after marker', () => {
        const marker = ruleBodyContaining(css, '#mainList #toDoChild.todo-detail-open::after');
        expect(marker).not.toBeNull();
        expect(marker).toMatch(/content:/);
        expect(marker).toMatch(/right:\s*0/);
        expect(marker).toMatch(/background:\s*var\(--accent-dim\)/);
        // The marker must not itself reintroduce the clobbering property.
        expect(marker).not.toMatch(/box-shadow/);
    });

    it('a selected IDEA row keeps its muted background', () => {
        const ideaSelected = ruleBodyContaining(
            css,
            '#mainList #toDoChild.todo-detail-open.todo-row--idea'
        );
        expect(ideaSelected).not.toBeNull();
        expect(ideaSelected).toMatch(/background:\s*rgba\(90, 90, 106, 0\.10\)/);
    });
});
