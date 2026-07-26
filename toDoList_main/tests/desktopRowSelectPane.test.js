import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    placeDescPanel,
    syncDetailPaneForViewport,
    clearDetailPane,
    openRowInDetailPane,
    ensureDetailPaneFocusListener,
} from '../src/toDoRow.js';

// Selecting a row opens it in the desktop detail pane. Clicking a committed row
// (in addition to its one-click title editing) and moving keyboard focus into it
// both drive the SAME chevron open path via openRowInDetailPane, so the ASKING/
// STUCK syncs and the phase-switch layout run identically regardless of what
// initiated the open. The open is idempotent and gated on detail-pane mode; the
// keyboard path must not enter title-edit mode.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }

const realInnerWidth = window.innerWidth;
function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
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

// A committed row with a spy #descToggle whose native click() is counted, plus a
// #toDoInput carrying a title, mirroring the cross-links buildToDoRow sets.
function makeSpyRow(id, title) {
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.dataset.value = 'proj';
    const toggle = document.createElement('div');
    toggle.id = 'descToggle';
    row.appendChild(toggle);
    const input = document.createElement('input');
    input.id = 'toDoInput';
    input.value = title == null ? '' : title;
    row.appendChild(input);
    const panel = document.createElement('div');
    panel.id = 'descSibling';
    panel.dataset.rowKey = id || 'a';
    row.__descSibling = panel;
    panel.__ownerRow = row;
    const state = { clicks: 0 };
    toggle.addEventListener('click', function() { state.clicks += 1; });
    return { row, toggle, input, panel, state };
}

describe('detail pane — openRowInDetailPane drives the chevron open, idempotently', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => { setWidth(realInnerWidth); document.body.innerHTML = ''; clearDetailPane(); });

    it('opens a fresh committed row in pane mode by triggering its toggle exactly once', () => {
        setWidth(1280);
        mountPaneHost();
        const list = mountList();
        const { row, toggle, state } = makeSpyRow('a', 'Task A');
        list.appendChild(row);

        openRowInDetailPane(row, toggle);

        expect(state.clicks).toBe(1);
    });

    it('is a no-op in inline mode (mobile width) — inline owns its own open', () => {
        setWidth(800);
        mountPaneHost();
        const list = mountList();
        const { row, toggle, state } = makeSpyRow('a', 'Task A');
        list.appendChild(row);

        openRowInDetailPane(row, toggle);

        expect(state.clicks).toBe(0);
    });

    it('is a no-op when no pane host exists, even at desktop width', () => {
        setWidth(1280);
        const list = mountList();
        const { row, toggle, state } = makeSpyRow('a', 'Task A');
        list.appendChild(row);

        openRowInDetailPane(row, toggle);

        expect(state.clicks).toBe(0);
    });

    it('is a no-op when the row is already the mounted detail — never toggles it closed', () => {
        const { pane } = mountPaneHost();
        const list = mountList();
        // Establish an open-detail tracker for this row the way the app does:
        // open inline, then cross to desktop so syncDetailPaneForViewport adopts
        // the panel into the pane and records the selection.
        const { row, panel } = makeSpyRow('a', 'Task A');
        const toggle = row.querySelector('#descToggle');
        list.appendChild(row);
        setWidth(800);
        placeDescPanel(panel, row);
        setWidth(1280);
        syncDetailPaneForViewport();
        expect(panel.parentNode).toBe(pane);

        let clicks = 0;
        toggle.addEventListener('click', function() { clicks += 1; });

        openRowInDetailPane(row, toggle);

        expect(clicks).toBe(0);
    });

    it('is a no-op when the toggle already carries the open class', () => {
        setWidth(1280);
        mountPaneHost();
        const list = mountList();
        const { row, toggle, state } = makeSpyRow('a', 'Task A');
        toggle.classList.add('open');
        list.appendChild(row);

        openRowInDetailPane(row, toggle);

        expect(state.clicks).toBe(0);
    });
});

describe('detail pane — keyboard focus opens the row (delegated focusin on #mainList)', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => { setWidth(realInnerWidth); document.body.innerHTML = ''; clearDetailPane(); });

    it('focusing a committed row opens it; blank/compose rows and empty inputs do not', () => {
        setWidth(1280);
        mountPaneHost();
        const list = mountList();

        const committed = makeSpyRow('a', 'Task A');
        const blank = makeSpyRow('b', '');
        blank.row.dataset.originalBlank = 'true';
        list.appendChild(committed.row);
        list.appendChild(blank.row);

        ensureDetailPaneFocusListener();

        // Focus into the committed row → the pane opens (toggle triggered once).
        committed.input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(committed.state.clicks).toBe(1);

        // Focus into the blank placeholder row → nothing opens.
        blank.input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(blank.state.clicks).toBe(0);
    });
});

describe('detail pane — row-select source wiring (source-structural)', () => {
    const toDoRow = read('toDoRow.js');

    it('the committed-row click branch opens the row in the pane after marking it active, before edit mode', () => {
        const fn = toDoRow.slice(toDoRow.indexOf('export function wireToDoRowClick'));
        const openIdx = fn.indexOf('openRowInDetailPane(toDoChild, descToggle)');
        // The committed branch's own todo-active mark (the one nearest before the
        // open) precedes it; entering title-edit mode (data-title-edit) follows.
        const activeIdx = fn.lastIndexOf("classList.add('todo-active')", openIdx);
        const editIdx = fn.indexOf("setAttribute('data-title-edit'", openIdx);
        expect(openIdx).toBeGreaterThan(-1);
        expect(activeIdx).toBeGreaterThan(-1);
        expect(openIdx).toBeGreaterThan(activeIdx);
        expect(editIdx).toBeGreaterThan(openIdx);
    });

    it('the click branch reuses the chevron path — no second open handler', () => {
        // Both the click branch and the focus delegation call the one helper.
        const occurrences = (toDoRow.match(/openRowInDetailPane\(/g) || []).length;
        // definition + click branch + focus delegation = 3 call sites minimum.
        expect(occurrences).toBeGreaterThanOrEqual(3);
    });

    it('the focus delegation is attached once, on #mainList, and stays out of edit mode', () => {
        const fn = toDoRow.slice(toDoRow.indexOf('export function ensureDetailPaneFocusListener'));
        const body = fn.slice(0, fn.indexOf('\n}\n'));
        // Once-flag guard so main.js's double eval can't double-bind it.
        expect(body).toMatch(/detailPaneFocusinAttached/);
        // Delegated focusin on the shared list container.
        expect(body).toMatch(/getElementById\(['"]mainList['"]\)/);
        expect(body).toMatch(/addEventListener\(\s*['"]focusin['"]/);
        // Excludes the blank placeholder / compose row.
        expect(body).toMatch(/originalBlank/);
        // The focus path must NOT enter title-edit mode: no data-title-edit,
        // no direct input focus() — that is the click path's job only.
        expect(body).not.toMatch(/data-title-edit/);
        expect(body).not.toMatch(/\.focus\(\)/);
    });

    it('wireToDoRowClick registers the focus delegation (lazy, past #mainList creation)', () => {
        const fn = toDoRow.slice(toDoRow.indexOf('export function wireToDoRowClick'));
        const body = fn.slice(0, fn.indexOf('\n}\n\n\n'));
        expect(body).toMatch(/ensureDetailPaneFocusListener\(\)/);
    });
});
