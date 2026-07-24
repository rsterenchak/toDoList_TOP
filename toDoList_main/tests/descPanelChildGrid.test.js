import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Regression pins for the desktop description panel's grid placement.
//
// `#descSibling` is a three-column grid (14px 1fr 14px). Placement used to be
// implicit: the panel was mounted as [descSpacer1, descInput, descSpacer2] and
// the two spacers existed only to occupy the gutter tracks so the textarea
// auto-placed into the 1fr column. That made the layout a function of child
// order and count — any insertion shifted everything after it by one cell, which
// crushed `.askingBlock`, the inject button, and finally `#descInput` itself into
// a 14px gutter (three failures in one day). The fix: EVERY child of the panel
// carries an explicit `grid-column`, and the now-purposeless spacers are gone.
// This defect is invisible to any test that does not read the layout, which is
// why it shipped, so these pins read the CSS and the mount source directly.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Return the declaration body of the FIRST top-level rule whose (possibly
// comma-grouped) selector list contains `needle`.
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

describe('desktop description panel — every child is explicitly grid-placed', () => {
    const css = read('style.css');

    it('#descInput sits in the 1fr content column, not left to auto-placement', () => {
        const body = ruleBodyContaining(css, '#descInput ');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-column:\s*2\s*;/);
    });

    it('the Discuss action spans the full grid row like Inject and Generate', () => {
        const body = ruleBodyContaining(css, '#descSibling .discussBtn');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-column:\s*1\s*\/\s*-1\s*;/);
    });

    // Audit: every element that can mount into #descSibling must resolve to an
    // explicit grid-column, so insertion order can never displace anything.
    const fullWidthChildren = [
        '#descSibling .injectBtn',
        '#descSibling .discussBtn',
        '#descSibling .generateBtn',
        '#descSibling .generateFailure',
        '#descSibling .askingBlock',
        '#descSibling .descEditorModalStuck',
        '#descSibling .filePickTrigger',
        '#descSibling .filePickPanel',
    ];
    it.each(fullWidthChildren)('%s carries an explicit full-width placement', (selector) => {
        const body = ruleBodyContaining(css, selector);
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-column:\s*1\s*\/\s*-1\s*;/);
    });
});

describe('desktop description panel — the gutter-filler spacers are gone', () => {
    const toDoRow = read('toDoRow.js');

    it('no descSpacer element is created, id-assigned, or mounted anymore', () => {
        // The spacers only existed to consume the 14px gutter tracks under
        // implicit placement. With every child explicitly placed they serve no
        // purpose; leaving an unplaced spacer would reintroduce exactly the
        // order-dependent layout this entry removed.
        expect(toDoRow).not.toMatch(/descSpacer/);
    });

    it('mounts the textarea directly into the panel with no positional spacers', () => {
        const startIdx = toDoRow.indexOf('function wireDescToggle');
        const body = toDoRow.slice(startIdx, startIdx + 3000);
        expect(body).toMatch(/descSibling\.appendChild\(descInput\)/);
        // The extra unplaced siblings that used to bracket descInput are gone,
        // so descInput's column comes from CSS alone — a new control mounted
        // anywhere in the panel cannot push it out of the content column.
        expect(body).not.toMatch(/appendChild\(descSpacer/);
    });
});
