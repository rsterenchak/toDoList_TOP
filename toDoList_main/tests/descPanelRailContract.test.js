import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
    mountDescRail,
    descPanelTopAnchor,
    DESC_PANEL_CHILD_SELECTORS,
} from '../src/toDoRow.js';

// Structural guard for the desktop description panel's grid-placement contract.
//
// #descSibling is a 3-column grid (14px 1fr 14px). An auto-placed child lands in
// a 14px gutter — the defect that crushed the inject button, the ASKING block,
// and #descInput in turn (four separate layout failures in one day, none visible
// to a suite that does not compute layout). DESC_PANEL_CHILD_SELECTORS is the
// single source of truth for the panel's children; this file asserts:
//   (a) every selector in it carries a grid-column rule in style.css, and
//   (b) every descSibling.appendChild/insertBefore call site in toDoRow.js mounts
//       one of those children.
// NOTE: this guard is SOURCE-STRUCTURAL, not layout-computing — it makes adding
// an unplaced child fail the build, but it does not (and cannot here) verify the
// rendered column geometry. The four prior defects were geometry defects; this
// catches the "new child added with no placement rule" cause of them.

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

describe('desc panel child contract — (a) every listed child is grid-placed', () => {
    const css = read('style.css');

    it('the contract list names the rail and the section label alongside the older children', () => {
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .phaseRail');
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descSiblingEntryLabel');
    });

    it.each(DESC_PANEL_CHILD_SELECTORS)('%s carries an explicit grid-column', (selector) => {
        const body = ruleBodyContaining(css, selector);
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-column:/);
    });
});

describe('desc panel child contract — (b) every mount site is a listed child', () => {
    const toDoRow = read('toDoRow.js');

    // The identifiers permitted as the first argument of a descSibling mount, each
    // mapping to a selector in DESC_PANEL_CHILD_SELECTORS. A mount of anything else
    // is an unplaced child and must fail this test.
    const ALLOWED_MOUNT_ARGS = new Set([
        'descInput',       // #descInput
        'injectBtn',       // .injectBtn
        'generateBtn',     // .generateBtn
        'discussBtn',      // .discussBtn
        'picker.trigger',  // .filePickTrigger
        'picker.panel',    // .filePickPanel
        'rail',            // .phaseRail
        'label',           // .descSiblingEntryLabel
    ]);

    it('every descSibling.appendChild/insertBefore mounts a known, placed child', () => {
        const re = /descSibling\.(?:appendChild|insertBefore)\(\s*([A-Za-z_$][\w$.]*)/g;
        const found = [];
        let m;
        while ((m = re.exec(toDoRow)) !== null) {
            found.push(m[1]);
        }
        // Sanity: the scan actually found the mount sites (guards against a regex
        // that silently matches nothing and passes vacuously).
        expect(found.length).toBeGreaterThanOrEqual(6);
        const unplaced = found.filter((arg) => !ALLOWED_MOUNT_ARGS.has(arg));
        expect(unplaced).toEqual([]);
    });
});

describe('desc panel rail — idempotent mount + leading order', () => {
    // A persistent panel + textarea, matching the nodes wireDescToggle keeps per
    // row (see descFilePickerReopenDedup.test.js).
    function makePanel() {
        const descSibling = document.createElement('div');
        descSibling.id = 'descSibling';
        const descInput = document.createElement('textarea');
        descInput.id = 'descInput';
        descSibling.appendChild(descInput);
        return { descSibling, descInput };
    }

    it('mounts exactly one rail (as firstChild) and one entry label across reopens', () => {
        const { descSibling, descInput } = makePanel();
        const item = { id: 't1', desc: 'body' };

        for (let cycle = 1; cycle <= 3; cycle++) {
            // Each cycle re-appends descInput (wireDescToggle moves it back) then
            // remounts the rail — exactly one reopen.
            descSibling.appendChild(descInput);
            mountDescRail(descSibling, item);

            expect(descSibling.querySelectorAll('.phaseRail')).toHaveLength(1);
            expect(descSibling.querySelectorAll('.descSiblingEntryLabel')).toHaveLength(1);
            // The rail always leads the panel; the label sits immediately after it.
            expect(descSibling.firstChild.classList.contains('phaseRail')).toBe(true);
            expect(
                descSibling.firstChild.nextSibling.classList.contains('descSiblingEntryLabel')
            ).toBe(true);
        }
    });

    it('descPanelTopAnchor lands a block between the rail and the label, keeping the rail first', () => {
        const { descSibling } = makePanel();
        mountDescRail(descSibling, { id: 't2', desc: '' });

        // Simulate an ASKING/STUCK block insertion the way syncAskingPanel does.
        const block = document.createElement('div');
        block.className = 'askingBlock';
        descSibling.insertBefore(block, descPanelTopAnchor(descSibling));

        const order = [...descSibling.children].map((el) => el.className || el.id);
        // rail, block, label, … — the rail is never displaced below a block, which
        // was the ordering conflict this entry called out (both syncs mounting at
        // firstChild would otherwise fight over the top slot).
        expect(order[0]).toContain('phaseRail');
        expect(order[1]).toContain('askingBlock');
        expect(order[2]).toContain('descSiblingEntryLabel');
    });

    it('falls back to firstChild when no rail is mounted yet', () => {
        const { descSibling, descInput } = makePanel();
        // Before mountDescRail runs there is no rail; the anchor is the panel's
        // firstChild so early blocks still lead the panel.
        expect(descPanelTopAnchor(descSibling)).toBe(descInput);
    });
});
