import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    placeDescPanel,
    openDescSiblingFor,
    clearDetailPane,
    reconcileDetailPane,
    syncDetailPaneForViewport,
    syncDetailPaneHeader,
} from '../src/toDoRow.js';

// Desktop detail pane (D-pane): at ≥1024px the open task's description panel
// (#descSibling) is hosted in a dedicated right-hand column (#descDetailPane)
// instead of expanding the row inline in #mainList (which pushes the queue off
// screen). Below 1024px — or when no pane host exists (bare unit rows) — the
// panel mounts inline as a row sibling exactly as before. placeDescPanel resolves
// the host by breakpoint, mirroring placeChatContent() for the chat surface.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }

const realInnerWidth = window.innerWidth;
function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

// A minimal stand-in for a built row + its panel, matching the cross-links
// buildToDoRow sets (toDoChild.__descSibling / descSibling.__ownerRow) and the
// per-row #descToggle. buildToDoRow itself is too heavily wired for a full jsdom
// instantiation, so the placement/resolution helpers are exercised directly.
function makeRow(id) {
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.dataset.value = 'proj';
    const toggle = document.createElement('div');
    toggle.id = 'descToggle';
    row.appendChild(toggle);
    const panel = document.createElement('div');
    panel.id = 'descSibling';
    panel.dataset.rowKey = id || 'a';
    row.__descSibling = panel;
    panel.__ownerRow = row;
    return { row, toggle, panel };
}

function mountPaneHost() {
    const pane = document.createElement('div');
    pane.id = 'descDetailPane';
    const empty = document.createElement('div');
    empty.className = 'descDetailEmpty';
    pane.appendChild(empty);
    document.body.appendChild(pane);
    return { pane, empty };
}

function mountList() {
    const list = document.createElement('div');
    list.id = 'mainList';
    document.body.appendChild(list);
    return list;
}

describe('detail pane — placeDescPanel resolves host by breakpoint', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => { setWidth(realInnerWidth); document.body.innerHTML = ''; });

    it('mounts the panel into #descDetailPane at desktop width when the pane exists', () => {
        setWidth(1280);
        const { pane } = mountPaneHost();
        const list = mountList();
        const { row, panel } = makeRow('a');
        list.appendChild(row);

        placeDescPanel(panel, row);

        expect(panel.parentNode).toBe(pane);
        // The panel is NOT inline in the list.
        expect(list.querySelector('#descSibling')).toBeNull();
    });

    it('mounts the panel inline (after the row) at mobile width', () => {
        setWidth(800);
        mountPaneHost();
        const list = mountList();
        const { row, panel } = makeRow('a');
        list.appendChild(row);

        placeDescPanel(panel, row);

        expect(panel.parentNode).toBe(list);
        expect(row.nextSibling).toBe(panel);
    });

    it('falls back to inline when no pane host exists, even at desktop width (bare unit rows)', () => {
        setWidth(1280);
        const list = mountList();
        const { row, panel } = makeRow('a');
        list.appendChild(row);

        placeDescPanel(panel, row);

        expect(panel.parentNode).toBe(list);
        expect(row.nextSibling).toBe(panel);
    });

    it('inline slot sits AFTER the blank placeholder chip row and paste-entry panel', () => {
        setWidth(800);
        const list = mountList();
        const { row, panel } = makeRow('a');
        list.appendChild(row);
        const chip = document.createElement('div');
        chip.id = 'createChipRow';
        const paste = document.createElement('div');
        paste.id = 'pasteEntryPanel';
        list.appendChild(chip);
        list.appendChild(paste);

        placeDescPanel(panel, row);

        // …row, chip, paste, panel — the panel lands past both leading siblings.
        expect(paste.nextSibling).toBe(panel);
    });

    it('is idempotent — re-placing into the same host does not duplicate or move', () => {
        setWidth(1280);
        const { pane } = mountPaneHost();
        const list = mountList();
        const { row, panel } = makeRow('a');
        list.appendChild(row);

        placeDescPanel(panel, row);
        placeDescPanel(panel, row);

        expect(pane.querySelectorAll('#descSibling')).toHaveLength(1);
    });
});

describe('detail pane — openDescSiblingFor resolves the panel in BOTH modes', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => { setWidth(realInnerWidth); document.body.innerHTML = ''; });

    it('returns the panel when it lives in the detail pane (pane mode)', () => {
        setWidth(1280);
        mountPaneHost();
        const list = mountList();
        const { row, panel } = makeRow('a');
        list.appendChild(row);
        placeDescPanel(panel, row);

        expect(openDescSiblingFor(row)).toBe(panel);
    });

    it('returns the panel when it sits inline after the row (inline mode)', () => {
        setWidth(800);
        mountPaneHost();
        const list = mountList();
        const { row, panel } = makeRow('a');
        list.appendChild(row);
        placeDescPanel(panel, row);

        expect(openDescSiblingFor(row)).toBe(panel);
    });

    it('returns null when the row has no open panel', () => {
        setWidth(1280);
        mountPaneHost();
        const list = mountList();
        const { row } = makeRow('a');
        list.appendChild(row);

        expect(openDescSiblingFor(row)).toBeNull();
    });

    it('does not return another row’s pane panel (belongs-to check)', () => {
        setWidth(1280);
        mountPaneHost();
        const list = mountList();
        const rowA = makeRow('a');
        const rowB = makeRow('b');
        list.appendChild(rowA.row);
        list.appendChild(rowB.row);
        // Row A's panel is the one in the pane.
        placeDescPanel(rowA.panel, rowA.row);

        // Resolving for row B must not hand back row A's panel.
        expect(openDescSiblingFor(rowB.row)).toBeNull();
        expect(openDescSiblingFor(rowA.row)).toBe(rowA.panel);
    });
});

describe('detail pane — empty state, clear, reconcile', () => {
    beforeEach(() => { document.body.innerHTML = ''; setWidth(1280); });
    afterEach(() => { setWidth(realInnerWidth); document.body.innerHTML = ''; clearDetailPane(); });

    it('hides the empty state while a panel is mounted and shows it when cleared', () => {
        const { empty } = mountPaneHost();
        const list = mountList();
        const { row, panel } = makeRow('a');
        list.appendChild(row);

        placeDescPanel(panel, row);
        clearDetailPane(); // clear resets and toggles the empty state
        expect(empty.hidden).toBe(false);
        expect(panel.parentNode).toBeNull();
    });

    it('syncDetailPaneForViewport moves an inline panel into the pane on resize to desktop and marks the row selected', () => {
        const { pane } = mountPaneHost();
        const list = mountList();
        const { row, panel } = makeRow('a');
        list.appendChild(row);
        // Start inline (as if opened at mobile width), then cross to desktop.
        setWidth(800);
        placeDescPanel(panel, row);
        expect(panel.parentNode).toBe(list);

        setWidth(1280);
        syncDetailPaneForViewport();

        expect(panel.parentNode).toBe(pane);
        expect(row.classList.contains('todo-detail-open')).toBe(true);
    });

    // Establish an open-detail tracker the way the app does: open inline, then
    // cross to desktop so syncDetailPaneForViewport adopts the panel into the pane
    // and records the selection. (openPanel itself lives in wireDescToggle, which
    // buildToDoRow wires but is too heavy to instantiate here.)
    function establishOpenDetail(list) {
        const { row, panel } = makeRow('a');
        list.appendChild(row);
        setWidth(800);
        placeDescPanel(panel, row);
        setWidth(1280);
        syncDetailPaneForViewport();
        return { row, panel };
    }

    it('reconcileDetailPane clears the pane when the selected row leaves the list', () => {
        const { pane, empty } = mountPaneHost();
        const list = mountList();
        const { row } = establishOpenDetail(list);

        // The row is removed (e.g. deleted / filtered out of the rebuilt list).
        list.removeChild(row);
        reconcileDetailPane();

        expect(pane.querySelector('#descSibling')).toBeNull();
        expect(empty.hidden).toBe(false);
    });

    it('reconcileDetailPane keeps the pane when the selected row is still present', () => {
        const { pane } = mountPaneHost();
        const list = mountList();
        const { panel } = establishOpenDetail(list);

        reconcileDetailPane();

        expect(pane.querySelector('#descSibling')).toBe(panel);
    });
});

describe('detail pane — host DOM + CSS wiring (source-structural)', () => {
    const mainJs = read('main.js');
    const toDoRow = read('toDoRow.js');
    const css = read('style.css');

    it('main.js creates #descDetailPane with an empty-state child and appends it into #mainSec', () => {
        expect(mainJs).toMatch(/descDetailPane\.id\s*=\s*['"]descDetailPane['"]/);
        expect(mainJs).toMatch(/descDetailEmpty\.className\s*=\s*['"]descDetailEmpty['"]/);
        expect(mainJs).toMatch(/main\.appendChild\(descDetailPane\)/);
    });

    it('main.js re-places the open panel on resize via syncDetailPaneForViewport', () => {
        expect(mainJs).toMatch(/addEventListener\(\s*['"]resize['"]\s*,\s*syncDetailPaneForViewport\s*\)/);
        expect(mainJs).toMatch(/syncDetailPaneForViewport\s*,?\s*\n?\s*}\s*from\s*['"]\.\/toDoRow\.js['"]/s);
    });

    it('full-rebuild paths clear the pane; reorder reconciles it', () => {
        // addAllToDo_DOM + addToDos_restore replace every row element, so they must
        // drop a stale pane panel; reorder reuses rows, so it only reconciles.
        const addAll = toDoRow.slice(toDoRow.indexOf('export function addAllToDo_DOM'));
        expect(addAll.slice(0, addAll.indexOf('}'))).toMatch(/clearDetailPane\(\)/);
        const restore = toDoRow.slice(toDoRow.indexOf('export function addToDos_restore'));
        expect(restore.slice(0, 600)).toMatch(/clearDetailPane\(\)/);
        const reorder = toDoRow.slice(toDoRow.indexOf('export function reorderToDoDOM'));
        expect(reorder.slice(0, reorder.indexOf('\n}'))).toMatch(/reconcileDetailPane\(\)/);
    });

    it('openPanel evicts the previously open panel and marks the row selected in pane mode', () => {
        const open = toDoRow.slice(toDoRow.indexOf('function openPanel()'));
        const body = open.slice(0, open.indexOf('function closePanel()'));
        // Single-open: an existing detail is closed before the new one mounts.
        expect(body).toMatch(/isDetailPaneMode\(\)\s*&&\s*openDetail/);
        expect(body).toMatch(/openDetail\.close\(\)/);
        // Selection marker added in pane mode.
        expect(body).toMatch(/todo-detail-open/);
    });

    it('CSS splits #mainSec into queue + resize handle + detail columns at ≥1024px', () => {
        const desktop = css.slice(css.indexOf('@media (min-width: 1024px)'));
        // The split declares a THREE-track grid — a resizable queue rail on the
        // left (its width driven by the --queue-width custom property so the drag
        // handle can update it live, falling back to the responsive minmax when
        // unset), a narrow auto handle track in the middle, and a flexible detail
        // track (1fr) on the right — and places the detail pane in col 3.
        expect(desktop).toMatch(/#mainSec\s*\{[^}]*grid-template-columns:\s*var\(--queue-width,\s*minmax\(260px,\s*308px\)\)\s+auto\s+minmax\(0,\s*1fr\)/);
        expect(desktop).toMatch(/#descDetailPane\s*\{[^}]*grid-column:\s*3/);
    });

    it('CSS gives the detail pane the flexible width: fixed chat pane + fluid #mainSec', () => {
        // Width-allocation contract for the bug fix: the chat pane holds a fixed
        // ~360px basis (not 40% of the viewport), #mainSec absorbs everything
        // left over (flex: 1 1 auto), and inside #mainSec the queue is the fixed
        // rail while the detail pane takes the 1fr track — so widening the window
        // grows the detail pane and nothing else.
        const desktop = css.slice(css.indexOf('@media (min-width: 1024px)'));
        expect(desktop).toMatch(/#desktopChatPane\s*\{[^}]*flex:\s*0 0 360px/);
        expect(desktop).toMatch(/#mainSec\s*\{[^}]*flex:\s*1 1 auto/);
        // The old backwards allocation (chat at 40%, queue as the 1fr track) is gone.
        expect(desktop).not.toMatch(/#desktopChatPane\s*\{[^}]*flex:\s*0 0 40%/);
        expect(desktop).not.toMatch(/#mainSec\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(320px/);
    });

    it('CSS hides #descDetailPane by default (inline mode below 1024px)', () => {
        // The base rule (ahead of the desktop media block) keeps the pane out of
        // the layout at mobile widths.
        const baseIdx = css.indexOf('#descDetailPane {');
        expect(baseIdx).toBeGreaterThan(-1);
        const base = css.slice(baseIdx, css.indexOf('}', baseIdx));
        expect(base).toMatch(/display:\s*none/);
    });
});

// The detail pane leads with a header naming the open task: its title as a
// heading and, beneath it, the entry marker in monospace with its provenance.
// The header is a SIBLING of #descSibling (never a child) so it stays desktop-only
// and out of the panel's grid-column contract; it is populated from the panel's
// owner row's __item and cleared with the pane's empty state.
describe('detail pane — header names the open task', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => { setWidth(realInnerWidth); document.body.innerHTML = ''; clearDetailPane(); });

    function makeRowWithItem(id, item) {
        const parts = makeRow(id);
        parts.row.__item = item;
        return parts;
    }

    it('mounts a header that PRECEDES #descSibling and shows the title + full entry id', () => {
        setWidth(1280);
        const { pane } = mountPaneHost();
        const list = mountList();
        const { row, panel } = makeRowWithItem('a', {
            tit: 'Wire the pane',
            entryId: 'e0f5804a-862f-43bf-a401-1c80d8e08cc3',
        });
        list.appendChild(row);

        placeDescPanel(panel, row);
        syncDetailPaneHeader();

        const header = pane.querySelector('.descDetailHeader');
        expect(header).toBeTruthy();
        // DOM-order contract: the header sits immediately before the panel.
        expect(header.nextSibling).toBe(panel);
        expect(pane.querySelector('.descDetailHeaderTitle').textContent).toBe('Wire the pane');
        // The id is shown in FULL — a truncated id is useless for the diagnostic
        // case of comparing it against a marker in TODO.md.
        expect(pane.querySelector('.descDetailHeaderMarkerId').textContent)
            .toBe('e0f5804a-862f-43bf-a401-1c80d8e08cc3');
        expect(pane.querySelector('.descDetailHeaderMarkerNone')).toBeNull();
    });

    it('shows a not-yet-injected note in place of an id when the task has no entryId', () => {
        setWidth(1280);
        const { pane } = mountPaneHost();
        const list = mountList();
        const { row, panel } = makeRowWithItem('a', { tit: 'Fresh task' });
        list.appendChild(row);

        placeDescPanel(panel, row);
        syncDetailPaneHeader();

        expect(pane.querySelector('.descDetailHeaderMarkerId')).toBeNull();
        expect(pane.querySelector('.descDetailHeaderMarkerNone').textContent).toBe('not yet injected');
    });

    it('updates the header text when a different task opens in the pane', () => {
        setWidth(1280);
        const { pane } = mountPaneHost();
        const list = mountList();
        const a = makeRowWithItem('a', { tit: 'First', entryId: 'id-a' });
        const b = makeRowWithItem('b', { tit: 'Second', entryId: 'id-b' });
        list.appendChild(a.row);
        list.appendChild(b.row);

        placeDescPanel(a.panel, a.row);
        syncDetailPaneHeader();
        expect(pane.querySelector('.descDetailHeaderTitle').textContent).toBe('First');

        // Opening b evicts a's panel (only one detail is shown at a time); the real
        // open path removes the prior panel before placing, so mirror that here.
        if (a.panel.parentNode) a.panel.parentNode.removeChild(a.panel);
        placeDescPanel(b.panel, b.row);
        syncDetailPaneHeader();
        expect(pane.querySelector('.descDetailHeaderTitle').textContent).toBe('Second');
        expect(pane.querySelector('.descDetailHeaderMarkerId').textContent).toBe('id-b');
    });

    it('reflects a live title rename through __item on the next sync', () => {
        setWidth(1280);
        const { pane } = mountPaneHost();
        const list = mountList();
        const item = { tit: 'Before', entryId: 'id' };
        const { row, panel } = makeRowWithItem('a', item);
        list.appendChild(row);

        placeDescPanel(panel, row);
        syncDetailPaneHeader();
        expect(pane.querySelector('.descDetailHeaderTitle').textContent).toBe('Before');

        item.tit = 'After';
        syncDetailPaneHeader();
        expect(pane.querySelector('.descDetailHeaderTitle').textContent).toBe('After');
    });

    it('removes the header when the pane returns to its empty state', () => {
        setWidth(1280);
        const { pane } = mountPaneHost();
        const list = mountList();
        const { row, panel } = makeRowWithItem('a', { tit: 'Open', entryId: 'id' });
        list.appendChild(row);

        placeDescPanel(panel, row);
        syncDetailPaneHeader();
        expect(pane.querySelector('.descDetailHeader')).toBeTruthy();

        // clearDetailPane() tears the panel out and runs the empty-state toggle,
        // which the header rides — so the header is removed with it.
        clearDetailPane();
        expect(pane.querySelector('.descDetailHeader')).toBeNull();
        expect(pane.querySelector('.descDetailEmpty').hidden).toBe(false);
    });

    it('mounts no header in inline (mobile) mode — the panel is not in the pane', () => {
        setWidth(800);
        const { pane } = mountPaneHost();
        const list = mountList();
        const { row, panel } = makeRowWithItem('a', { tit: 'Mobile', entryId: 'id' });
        list.appendChild(row);

        placeDescPanel(panel, row);
        syncDetailPaneHeader();

        // The panel mounted inline in the list, so the pane holds no #descSibling
        // and therefore no header — the header is a desktop-pane affordance only.
        expect(panel.parentNode).toBe(list);
        expect(pane.querySelector('.descDetailHeader')).toBeNull();
    });
});
