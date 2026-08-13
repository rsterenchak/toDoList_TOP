import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
    mountDescFilePicker,
    mountDescRail,
    descPanelTopAnchor,
    descPanelBottomAnchor,
    descPanelFooterHost,
    DESC_PANEL_CHILD_SELECTORS,
} from '../src/toDoRow.js';

// The desktop detail pane used to render every control in a top cluster: the
// entry textarea auto-grows to its content, so a short entry left the bottom
// two-thirds of the pane empty with the filter panel, the action buttons, the
// FILE readout and MANUAL STATUS all bunched under the rail. The reflow groups
// those trailing sections into one `.descPanelFooter` wrapper the pane pins to
// its floor (margin-top: auto) and lets the textarea flex-fill the middle.
//
// This is a layout change and jsdom computes no layout, so the pins here read
// the CSS and the DOM wiring directly — the style the sibling structural guards
// for this panel already use.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Every top-level rule body whose (possibly comma-grouped) selector list contains
// `needle`. Unlike the single-hit extractor the sibling suites use, this returns
// ALL of them — the pane reflow deliberately splits a child's declarations across
// a grouped rule and a standalone one, so "the first match" is not the answer.
function ruleBodies(css, needle) {
    const bodies = [];
    let depth = 0;
    let selectorStart = 0;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '{') {
            if (depth === 0 && css.slice(selectorStart, i).includes(needle)) {
                bodies.push(css.slice(i + 1, css.indexOf('}', i)));
            }
            depth++;
            continue;
        }
        if (c === '}') {
            depth--;
            if (depth === 0) selectorStart = i + 1;
        }
    }
    return bodies;
}

// True when SOME rule matching `needle` declares `decl`.
function declares(css, needle, decl) {
    const bodies = ruleBodies(css, needle);
    expect(bodies.length, `no rule matches ${needle}`).toBeGreaterThan(0);
    return bodies.some((body) => decl.test(body));
}

describe('detail pane footer — the wrapper is a first-class panel child', () => {
    const css = read('style.css');

    it('is registered in the panel child contract', () => {
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descPanelFooter');
    });

    it('spans the panel grid gutter-to-gutter in the mobile inline host', () => {
        // The mobile drawer keeps the 3-column grid, so an unplaced wrapper would
        // auto-place into a 14px gutter — the defect this panel keeps re-learning.
        expect(declares(css, '#descSibling .descPanelFooter', /grid-column:\s*1\s*\/\s*-1\s*;/))
            .toBe(true);
    });

    it('supplies the 14px content inset its children used to take from the grid', () => {
        expect(declares(css, '.descPanelFooter', /flex-direction:\s*column\s*;/)).toBe(true);
        expect(declares(css, '.descPanelFooter', /padding-inline:\s*14px\s*;/)).toBe(true);
    });

    it('cancels that inset for the two sections that were full-bleed before', () => {
        // The picker panel and the status control (its own padding + top divider)
        // spanned 1 / -1 as panel children and must keep reading identically.
        expect(declares(css, '#descSibling .descPanelFooter .filePickPanel', /margin-inline:\s*-14px\s*;/))
            .toBe(true);
        expect(declares(css, '#descSibling .descPanelFooter #descEditorModalStatusRow', /margin-inline:\s*-14px\s*;/))
            .toBe(true);
    });
});

describe('detail pane footer — the pane reflow', () => {
    const css = read('style.css');

    it('stacks the pane copy of the panel as a flex column', () => {
        expect(declares(css, '#descDetailPane #descSibling', /display:\s*flex\s*;/)).toBe(true);
        expect(declares(css, '#descDetailPane #descSibling', /flex-direction:\s*column\s*;/)).toBe(true);
    });

    it('never lets the panel shrink below its content, so a tall panel still scrolls', () => {
        expect(declares(css, '#descDetailPane #descSibling', /flex:\s*1\s+0\s+auto\s*;/)).toBe(true);
    });

    it('overrides the base rule\'s align-items: center, which centres horizontally under flex', () => {
        expect(declares(css, '#descDetailPane #descSibling', /align-items:\s*stretch\s*;/)).toBe(true);
    });

    it('makes the entry textarea the flex-fill middle with a floor, not a sliver', () => {
        const sel = '#descDetailPane #descSibling > #descInput';
        expect(declares(css, sel, /flex:\s*1\s+1\s+auto\s*;/)).toBe(true);
        expect(declares(css, sel, /min-height:\s*96px\s*;/)).toBe(true);
        // The base rule's width: 100% plus the 14px margins below would overflow.
        expect(declares(css, sel, /width:\s*auto\s*;/)).toBe(true);
        expect(declares(css, sel, /margin-inline:\s*14px\s*;/)).toBe(true);
    });

    it('pins the footer stack to the pane floor', () => {
        expect(declares(css, '#descDetailPane #descSibling > .descPanelFooter', /margin-top:\s*auto\s*;/))
            .toBe(true);
    });

    it('re-supplies the content-column inset the grid gutters used to give', () => {
        expect(declares(css, '#descDetailPane #descSibling > .phaseRail', /margin-inline:\s*14px\s*;/))
            .toBe(true);
        expect(declares(css, '#descDetailPane #descSibling > .descModeStrip', /margin-inline:\s*14px\s*;/))
            .toBe(true);
    });

    it('keeps the picker trigger right-aligned now that justify-self is inert', () => {
        expect(declares(css, '#descDetailPane #descSibling > .filePickTrigger', /align-self:\s*flex-end\s*;/))
            .toBe(true);
    });

    it('leaves the mobile inline host on the grid — every placement rule survives', () => {
        // The reflow is pane-scoped; the grid contract the structural guard reads
        // must not have been traded away for it.
        [
            '#descSibling .descActionsRow',
            '#descSibling .descFileReadout',
            '#descSibling #descEditorModalStatusRow',
            '#descSibling .filePickPanel',
        ].forEach((needle) => {
            expect(declares(css, needle, /grid-column:/), `${needle} lost its grid-column`).toBe(true);
        });
    });
});

describe('detail pane footer — DOM wiring', () => {
    function makePanel({ withFooter }) {
        const descSibling = document.createElement('div');
        descSibling.id = 'descSibling';
        const descInput = document.createElement('textarea');
        descInput.id = 'descInput';
        descSibling.appendChild(descInput);
        let footer = null;
        if (withFooter) {
            footer = document.createElement('div');
            footer.className = 'descPanelFooter';
            descSibling.appendChild(footer);
        }
        return { descSibling, descInput, footer };
    }

    it('resolves the footer host, or null on a panel that has none', () => {
        const { descSibling, footer } = makePanel({ withFooter: true });
        expect(descPanelFooterHost(descSibling)).toBe(footer);
        expect(descPanelFooterHost(makePanel({ withFooter: false }).descSibling)).toBeNull();
        expect(descPanelFooterHost(null)).toBeNull();
    });

    it('leads the footer with the picker panel — filter row first in the docked stack', () => {
        const { descSibling, descInput, footer } = makePanel({ withFooter: true });
        // The sections mounted before the picker runs, as mountPanelContents does.
        const actions = document.createElement('div');
        actions.className = 'descActionsRow';
        footer.appendChild(actions);
        const readout = document.createElement('div');
        readout.className = 'descFileReadout';
        footer.appendChild(readout);

        mountDescFilePicker(descSibling, descInput, { id: 't1' }, '', null);

        expect([...footer.children].map((el) => el.className))
            .toEqual(['filePickPanel', 'descActionsRow', 'descFileReadout']);
        // The trigger stays with the entry region, directly above the textarea.
        expect(descSibling.querySelector('.filePickTrigger').nextSibling).toBe(descInput);
    });

    it('falls back to the historic slot below the textarea on a footer-less panel', () => {
        const { descSibling, descInput } = makePanel({ withFooter: false });
        mountDescFilePicker(descSibling, descInput, { id: 't1' }, '', null);
        expect(descInput.nextSibling.className).toBe('filePickPanel');
    });

    it('mounts exactly one picker panel across reopens, wherever it lives', () => {
        const { descSibling, descInput, footer } = makePanel({ withFooter: true });
        mountDescFilePicker(descSibling, descInput, { id: 't1' }, '', null);
        mountDescFilePicker(descSibling, descInput, { id: 't1' }, '', null);
        expect(descSibling.querySelectorAll('.filePickPanel')).toHaveLength(1);
        expect(descSibling.querySelectorAll('.filePickTrigger')).toHaveLength(1);
        expect(footer.querySelectorAll('.filePickPanel')).toHaveLength(1);
    });

    it('descPanelBottomAnchor keeps a fallback-mounted block above the footer', () => {
        // The dispatch and triage blocks fall back to "the panel's end" when their
        // anchor is missing; appending would drop them below the docked stack.
        const { descSibling, footer } = makePanel({ withFooter: true });
        const block = document.createElement('div');
        block.className = 'descDispatchBlock';
        descSibling.insertBefore(block, descPanelBottomAnchor(descSibling));

        const order = [...descSibling.children].map((el) => el.className || el.id);
        expect(order.indexOf('descDispatchBlock')).toBeLessThan(order.indexOf('descPanelFooter'));
        expect(footer.querySelector('.descDispatchBlock')).toBeNull();
    });

    it('degrades to a plain append when the panel has no footer', () => {
        const { descSibling } = makePanel({ withFooter: false });
        const block = document.createElement('div');
        block.className = 'descDispatchBlock';
        descSibling.insertBefore(block, descPanelBottomAnchor(descSibling));
        expect(descSibling.lastChild).toBe(block);
    });

    it('descPanelTopAnchor still lands the phase blocks above the editor, never in the footer', () => {
        const { descSibling, footer } = makePanel({ withFooter: true });
        mountDescRail(descSibling, { id: 't1', desc: '' });
        const asking = document.createElement('div');
        asking.className = 'askingBlock';
        descSibling.insertBefore(asking, descPanelTopAnchor(descSibling));

        const order = [...descSibling.children].map((el) => el.className || el.id);
        expect(order[0]).toContain('phaseRail');
        expect(order[1]).toContain('askingBlock');
        expect(order.indexOf('askingBlock')).toBeLessThan(order.indexOf('descInput'));
        expect(footer.children).toHaveLength(0);
    });
});

describe('detail pane footer — mount source order', () => {
    const toDoRow = read('toDoRow.js');
    const mountBody = toDoRow.slice(
        toDoRow.indexOf('function mountPanelContents'),
        toDoRow.indexOf('function openPanel')
    );

    it('reuses the wrapper across reopens and re-appends it so it stays last', () => {
        expect(mountBody).toMatch(/querySelector\('\.descPanelFooter'\)/);
        expect(mountBody).toMatch(/descSibling\.appendChild\(footer\)/);
        // descInput is re-appended on every open and would otherwise sit below the
        // footer, so the footer's own re-append has to follow it.
        expect(mountBody.indexOf('descSibling.appendChild(descInput)'))
            .toBeLessThan(mountBody.indexOf('descSibling.appendChild(footer)'));
    });

    it('stacks the footer as filter row, actions row, FILE, then status', () => {
        const actionsIdx = mountBody.indexOf('footer.appendChild(actionsRow)');
        const readoutIdx = mountBody.indexOf('footer.appendChild(fileReadout)');
        const statusIdx = mountBody.indexOf('footer.appendChild(manualStatusRow)');
        expect(actionsIdx).toBeGreaterThan(-1);
        expect(readoutIdx).toBeGreaterThan(actionsIdx);
        expect(statusIdx).toBeGreaterThan(readoutIdx);
        // The picker mounts after those and inserts its panel at the footer's head.
        expect(toDoRow).toMatch(/footer\.insertBefore\(picker\.panel,\s*footer\.firstChild\)/);
    });

    it('no trailing section is left mounted straight onto the panel', () => {
        ['actionsRow', 'fileReadout', 'manualStatusRow'].forEach((name) => {
            expect(toDoRow).not.toMatch(new RegExp(`descSibling\\.appendChild\\(${name}\\)`));
        });
    });
});
