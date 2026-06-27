import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the status segmented control added to the mobile description editor
// modal. On `(pointer: coarse)` the on-row status badge (`.todoStatusLabel`
// → showStatusPopover) is hidden in favor of the left-edge color tab, so
// status is visible but not settable from the row. The modal grows a labeled
// "Status" row with three connected segments (Active / In Progress / Idea)
// that write through listLogic.setToDoStatus and reflect live on the row.
//
// Source-inspection only, matching the mobileDescEditorModal style — the
// modal flow is too heavily wired to instantiate end-to-end here.

describe('mobile desc editor status selector — single-sourced vocabulary', () => {

    const modals = read('modals.js');
    const todoStatus = read('todoStatus.js');

    it('todoStatus.js exports STATUS_ORDER so the modal does not re-hardcode it', () => {
        expect(todoStatus).toMatch(/export\s+const\s+STATUS_ORDER\s*=/);
    });

    it('modals.js imports STATUS_META / STATUS_ORDER / normalizeStatus from todoStatus.js', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*STATUS_META[^}]*\}\s*from\s*['"]\.\/todoStatus\.js['"]/
        );
        expect(modals).toMatch(
            /import\s*\{[^}]*STATUS_ORDER[^}]*\}\s*from\s*['"]\.\/todoStatus\.js['"]/
        );
        expect(modals).toMatch(
            /import\s*\{[^}]*normalizeStatus[^}]*\}\s*from\s*['"]\.\/todoStatus\.js['"]/
        );
    });

    it('builds one segment per status by iterating STATUS_ORDER (not a hardcoded list)', () => {
        expect(modals).toMatch(/STATUS_ORDER\.forEach\(/);
        // Each segment's label text comes from STATUS_META, keeping the
        // glyph + uppercase vocabulary single-sourced with the desktop badge.
        expect(modals).toMatch(/STATUS_META\[\s*status\s*\]\.label/);
    });
});

describe('mobile desc editor status selector — markup + placement', () => {

    const modals = read('modals.js');

    it('renders a labeled Status row with the segmented control', () => {
        expect(modals).toMatch(/['"]descEditorModalStatusRow['"]/);
        expect(modals).toMatch(/['"]descEditorModalStatusLabel['"]/);
        expect(modals).toMatch(/['"]descEditorModalStatusControl['"]/);
        const labelIdx = modals.indexOf("'descEditorModalStatusLabel'");
        expect(labelIdx).toBeGreaterThan(-1);
        const tail = modals.slice(labelIdx, labelIdx + 300);
        expect(tail).toMatch(/textContent\s*=\s*['"]Status['"]/);
    });

    it('the segments are buttons in a radiogroup with role="radio"', () => {
        expect(modals).toMatch(/['"]descEditorModalStatusSeg['"]/);
        expect(modals).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]radiogroup['"]\s*\)/);
        expect(modals).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]radio['"]\s*\)/);
    });

    it('inserts the Status row between the body and the actions row', () => {
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = modals.slice(fnIdx);
        const bodyAppend = fn.search(/dialog\.appendChild\(\s*body\s*\)/);
        const statusAppend = fn.search(/dialog\.appendChild\(\s*statusRow\s*\)/);
        const actionsAppend = fn.search(/dialog\.appendChild\(\s*actions\s*\)/);
        expect(bodyAppend).toBeGreaterThan(-1);
        expect(statusAppend).toBeGreaterThan(-1);
        expect(actionsAppend).toBeGreaterThan(-1);
        expect(bodyAppend).toBeLessThan(statusAppend);
        expect(statusAppend).toBeLessThan(actionsAppend);
    });
});

describe('mobile desc editor status selector — initial reflection', () => {

    const modals = read('modals.js');

    it('reflects the item\'s current status (normalized) as the selected segment', () => {
        // Legacy / undefined status reads as active via normalizeStatus.
        expect(modals).toMatch(/normalizeStatus\(\s*item\s*&&\s*item\.status\s*\)/);
        // The build loop marks the matching segment selected + aria-checked.
        const forEachIdx = modals.indexOf('STATUS_ORDER.forEach(');
        expect(forEachIdx).toBeGreaterThan(-1);
        const loop = modals.slice(forEachIdx, forEachIdx + 800);
        expect(loop).toMatch(/status\s*===\s*currentStatus/);
        expect(loop).toMatch(/setAttribute\(\s*['"]aria-checked['"]/);
    });
});

describe('mobile desc editor status selector — write-through + live reflection', () => {

    const modals = read('modals.js');

    it('tapping a segment writes through listLogic.setToDoStatus (the desktop badge channel)', () => {
        // CLAUDE.md: mutations route through listLogic. The same channel the
        // on-row popover uses — so localStorage + Supabase mirror come free.
        const selIdx = modals.indexOf('function selectStatus(');
        expect(selIdx).toBeGreaterThan(-1);
        const fn = modals.slice(selIdx, selIdx + 1500);
        expect(fn).toMatch(/listLogic\.setToDoStatus\s*\(\s*projectName\s*,\s*item\s*,\s*status\s*\)/);
    });

    it('resolves the underlying row by item identity in #mainList and refreshes its status UI', () => {
        const selIdx = modals.indexOf('function selectStatus(');
        const fn = modals.slice(selIdx, selIdx + 1500);
        expect(fn).toMatch(/getElementById\(\s*['"]mainList['"]\s*\)/);
        expect(fn).toMatch(/__item\s*===\s*item/);
        expect(fn).toMatch(/refreshTodoStatusUI\s*\(/);
    });

    it('re-sorts / re-filters the list via reorderToDoDOM after the change', () => {
        // Mirrors showStatusPopover: reorderToDoDOM moves the row to its new
        // place when sort = Status and re-applies the status filter.
        expect(modals).toMatch(
            /import\s*\{[^}]*reorderToDoDOM[^}]*\}\s*from\s*['"]\.\/toDoRow\.js['"]/
        );
        const selIdx = modals.indexOf('function selectStatus(');
        const fn = modals.slice(selIdx, selIdx + 1500);
        expect(fn).toMatch(/reorderToDoDOM\s*\(\s*projectName\s*\)/);
    });
});

describe('mobile desc editor status selector — styling', () => {

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
