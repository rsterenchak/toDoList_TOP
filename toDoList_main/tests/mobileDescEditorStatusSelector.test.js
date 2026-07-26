import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import { buildManualStatusControl } from '../src/todoStatus.js';
import { listLogic } from '../src/listLogic.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the status segmented control surfaced in the mobile description editor
// modal. On `(pointer: coarse)` the on-row status badge (`.todoStatusLabel`
// → showStatusPopover) is hidden in favor of the left-edge color tab, so
// status is visible but not settable from the row. The modal grows a labeled
// "Manual status" row with three connected segments (Active / In Progress /
// Idea) that write through listLogic.setToDoStatus and reflect live on the row.
//
// The control itself is built by the SHARED buildManualStatusControl helper in
// todoStatus.js (the same extraction the phase rail and file picker needed), so
// the mobile modal and the desktop detail pane can never drift. This file pins
// the shared builder's contract plus the modal's call + placement.

describe('shared manual-status control — single-sourced vocabulary', () => {

    const todoStatus = read('todoStatus.js');

    it('todoStatus.js exports STATUS_ORDER so the control does not re-hardcode it', () => {
        expect(todoStatus).toMatch(/export\s+const\s+STATUS_ORDER\s*=/);
    });

    it('todoStatus.js exports the shared buildManualStatusControl builder', () => {
        expect(todoStatus).toMatch(/export\s+function\s+buildManualStatusControl\s*\(/);
    });

    it('builds one segment per status by iterating STATUS_ORDER (not a hardcoded list)', () => {
        expect(todoStatus).toMatch(/STATUS_ORDER\.forEach\(/);
        // Each segment's label text comes from STATUS_META, keeping the
        // glyph + uppercase vocabulary single-sourced with the desktop badge.
        expect(todoStatus).toMatch(/STATUS_META\[\s*status\s*\]\.label/);
    });
});

describe('shared manual-status control — markup + a11y', () => {

    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => { vi.restoreAllMocks(); });

    it('renders a labeled status row (id + "Manual status" text) with the segmented control', () => {
        const row = buildManualStatusControl({ status: 'active' }, 'Work');
        expect(row.id).toBe('descEditorModalStatusRow');
        const label = row.querySelector('#descEditorModalStatusLabel');
        expect(label).not.toBeNull();
        expect(label.textContent).toBe('Manual status');
        expect(row.querySelector('#descEditorModalStatusControl')).not.toBeNull();
    });

    it('the segments are buttons in a radiogroup with role="radio"', () => {
        const row = buildManualStatusControl({ status: 'active' }, 'Work');
        const control = row.querySelector('#descEditorModalStatusControl');
        expect(control.getAttribute('role')).toBe('radiogroup');
        const segs = row.querySelectorAll('.descEditorModalStatusSeg');
        expect(segs).toHaveLength(3);
        segs.forEach((seg) => expect(seg.getAttribute('role')).toBe('radio'));
    });

    it('reflects the item\'s current status (normalized) as the selected segment', () => {
        // Legacy / undefined status reads as active via normalizeStatus.
        const row = buildManualStatusControl({ status: undefined }, 'Work');
        const selected = row.querySelector('.descEditorModalStatusSeg.selected');
        expect(selected.getAttribute('data-status')).toBe('active');
        expect(selected.getAttribute('aria-checked')).toBe('true');
    });
});

describe('shared manual-status control — write-through + live reflection', () => {

    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => { vi.restoreAllMocks(); });

    it('tapping a segment writes through listLogic.setToDoStatus (the on-row badge channel)', () => {
        const spy = vi.spyOn(listLogic, 'setToDoStatus').mockImplementation(() => {});

        const item = { status: 'active', tit: 'Ship it' };
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        document.body.appendChild(mainList);

        const row = buildManualStatusControl(item, 'Work');
        document.body.appendChild(row);
        row.querySelector('.descEditorModalStatusSeg[data-status="in_progress"]').click();

        expect(spy).toHaveBeenCalledWith('Work', item, 'in_progress');
        // The tapped segment becomes selected + aria-checked.
        const seg = row.querySelector('.descEditorModalStatusSeg[data-status="in_progress"]');
        expect(seg.classList.contains('selected')).toBe(true);
        expect(seg.getAttribute('aria-checked')).toBe('true');
    });

    it('resolves the underlying row by item identity in #mainList and refreshes its status UI', () => {
        // The real setToDoStatus mutates item.status; mirror that so the
        // in-place repaint (refreshTodoStatusUI) has the new value to paint.
        vi.spyOn(listLogic, 'setToDoStatus').mockImplementation((p, it, s) => { it.status = s; });

        const item = { status: 'active', tit: 'X' };
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        document.body.appendChild(mainList);
        const liveRow = document.createElement('div');
        liveRow.id = 'toDoChild';
        liveRow.__item = item;
        liveRow.appendChild(document.createElement('span')).className = 'todoStatusLabel';
        mainList.appendChild(liveRow);

        const control = buildManualStatusControl(item, 'Work');
        document.body.appendChild(control);
        control.querySelector('.descEditorModalStatusSeg[data-status="idea"]').click();

        // refreshTodoStatusUI repaints the live row's modifier class in place.
        expect(liveRow.classList.contains('todo-row--idea')).toBe(true);
    });
});

describe('mobile desc editor — calls the shared builder, placed LAST', () => {

    const modals = read('modals.js');

    it('imports buildManualStatusControl from todoStatus.js', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*buildManualStatusControl[^}]*\}\s*from\s*['"]\.\/todoStatus\.js['"]/
        );
    });

    it('builds the status row via buildManualStatusControl (not a second inline copy)', () => {
        expect(modals).toMatch(/statusRow\s*=\s*buildManualStatusControl\s*\(/);
    });

    it('places the status row LAST — below the actions row (demoted beneath Generate/Inject/Clear/Copy)', () => {
        // The manual status control is demoted below the actions so the derived
        // pipeline phase (the rail) leads and the two no longer stack adjacent.
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = modals.slice(fnIdx);
        const bodyAppend = fn.search(/dialog\.appendChild\(\s*body\s*\)/);
        const actionsAppend = fn.search(/dialog\.appendChild\(\s*actions\s*\)/);
        const statusAppend = fn.search(/dialog\.appendChild\(\s*statusRow\s*\)/);
        expect(bodyAppend).toBeGreaterThan(-1);
        expect(actionsAppend).toBeGreaterThan(-1);
        expect(statusAppend).toBeGreaterThan(-1);
        expect(bodyAppend).toBeLessThan(actionsAppend);
        expect(actionsAppend).toBeLessThan(statusAppend);
    });
});

describe('shared manual-status control — styling', () => {

    const css = read('style.css');

    it('the selected segment fills with its status color, matched to the row edge tab', () => {
        // active → accent purple, in_progress → amber (--text-warning),
        // idea → muted (--text-muted) — the same colors the mobile left-edge
        // status tab uses.
        expect(css).toMatch(
            /\.descEditorModalStatusSeg\.selected\[data-status="active"\][\s\S]{0,80}background:\s*var\(--accent\)/
        );
        expect(css).toMatch(
            /\.descEditorModalStatusSeg\.selected\[data-status="in_progress"\][\s\S]{0,80}background:\s*var\(--text-warning\)/
        );
        expect(css).toMatch(
            /\.descEditorModalStatusSeg\.selected\[data-status="idea"\][\s\S]{0,80}background:\s*var\(--text-muted\)/
        );
    });

    it('the segments are connected (a single bordered control, segments flex to fill)', () => {
        const ruleMatch = css.match(/\.descEditorModalStatusSeg\s*\{([\s\S]{0,600}?)\}/);
        expect(ruleMatch).toBeTruthy();
        expect(ruleMatch[1]).toMatch(/flex:\s*1\s+1\s+0/);
    });
});
