import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The COMPLETED section's "Clear all" pill: mounted in the mobile completed
// sheet's header (left of the X) and the desktop inline #completedHeader. It
// confirms with the count + project, deletes through
// listLogic.removeCompletedToDos, re-renders, and the sheet closes once no
// completed rows remain.
//
// buildToDoRow is too heavily wired for a full jsdom instantiation, so the
// re-render is stubbed with a minimal row builder that still runs the real
// updateCompletedSection — which fires the mainListRendered event the sheet
// re-collects on.
vi.mock('../src/toDoRow.js', async () => {
    const { updateCompletedSection } = await import('../src/emptyState.js');
    return {
        addAllToDo_DOM: function(items, name) {
            const list = document.getElementById('mainList');
            (items || []).filter(i => i.tit !== '').forEach(i => list.appendChild(makeRow(i, name)));
            updateCompletedSection(list);
        },
    };
});

import { listLogic } from '../src/listLogic.js';
import { openCompletedMobileSheet } from '../src/mobileSheets.js';
import { buildClearCompletedPill, confirmClearCompleted } from '../src/completedClearAll.js';
import { updateCompletedSection } from '../src/emptyState.js';

function makeRow(item, project) {
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.setAttribute('data-value', project);
    if (item.completed) row.classList.add('completed');
    row.textContent = item.tit;
    return row;
}

const realInnerWidth = window.innerWidth;
function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

function seed(completedTitles, openTitles) {
    listLogic._reset();
    listLogic.addProject('Work');
    openTitles.concat(completedTitles).forEach(t => listLogic.addToDo('Work', t));
    const items = listLogic.listItems('Work');
    completedTitles.forEach(t => { items.find(i => i.tit === t).completed = true; });
    listLogic.sortCompletedToBottom('Work');

    document.body.innerHTML = '';
    const list = document.createElement('div');
    list.id = 'mainList';
    document.body.appendChild(list);
    listLogic.listItems('Work').filter(i => i.tit !== '').forEach(i => list.appendChild(makeRow(i, 'Work')));
    updateCompletedSection(list);
    return list;
}

describe('Clear all — mobile completed sheet', () => {
    beforeEach(() => { setWidth(390); });
    afterEach(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        setWidth(realInnerWidth);
        document.body.innerHTML = '';
    });

    it('puts the pill in the sheet header, left of the X, with an aria-label', () => {
        seed(['A', 'B', 'C'], ['D', 'E']);
        openCompletedMobileSheet();
        const header = document.querySelector('#completedMobileSheet .completedMobileSheetHeader');
        const pill = header.querySelector('.completedClearAllBtn');
        expect(pill).toBeTruthy();
        expect(pill.getAttribute('aria-label')).toBe('Delete all completed tasks');
        expect(pill.hidden).toBe(false);
        const close = header.querySelector('.completedMobileSheetClose');
        expect(pill.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('opens the confirm with the count and project, and confirming deletes the rows and closes the sheet', () => {
        seed(['A', 'B', 'C'], ['D', 'E']);
        openCompletedMobileSheet();
        document.querySelector('#completedMobileSheet .completedClearAllBtn').click();

        const modal = document.getElementById('confirmModal');
        expect(modal).toBeTruthy();
        expect(document.getElementById('confirmModalMessage').textContent).toBe('Delete completed tasks?');
        expect(modal.textContent).toContain('Delete 3 completed tasks in Work? This can\'t be undone.');
        expect(document.getElementById('confirmModalConfirm').textContent).toBe('Delete 3');

        document.getElementById('confirmModalConfirm').click();

        expect(document.querySelectorAll('#toDoChild.completed').length).toBe(0);
        expect(listLogic.listItems('Work').filter(i => i.tit !== '').map(i => i.tit).sort()).toEqual(['D', 'E']);
        expect(document.getElementById('completedMobileSheetBackdrop')).toBeNull();
        expect(document.getElementById('injectToast').textContent).toBe('3 completed tasks deleted');
    });

    it('cancelling the confirm changes nothing', () => {
        seed(['A', 'B'], ['C']);
        openCompletedMobileSheet();
        document.querySelector('#completedMobileSheet .completedClearAllBtn').click();
        document.getElementById('confirmModalCancel').click();

        expect(document.getElementById('confirmModal')).toBeNull();
        expect(listLogic.listItems('Work').filter(i => i.completed).length).toBe(2);
        expect(document.getElementById('completedMobileSheetBackdrop')).toBeTruthy();
    });

    it('has no pill when there are no completed rows', () => {
        seed([], ['A']);
        openCompletedMobileSheet();
        expect(document.querySelector('.completedClearAllBtn:not([hidden])')).toBeNull();
    });
});

describe('Clear all — confirm guards', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('does not open a confirm for a project with nothing completed', () => {
        seed([], ['A']);
        confirmClearCompleted('Work');
        expect(document.getElementById('confirmModal')).toBeNull();
    });

    it('the pill click stops propagation so the accordion header does not toggle', () => {
        seed(['A'], ['B']);
        const header = document.getElementById('completedHeader');
        const before = header.getAttribute('aria-expanded');
        header.appendChild(buildClearCompletedPill());
        header.querySelector('.completedClearAllBtn').click();
        expect(header.getAttribute('aria-expanded')).toBe(before);
        expect(document.getElementById('confirmModal')).toBeTruthy();
    });
});

describe('Clear all — ghost pill markup', () => {
    it('renders a leading trash glyph before a separate "Clear all" label', () => {
        const pill = buildClearCompletedPill();
        expect(pill.type).toBe('button');
        expect(pill.className).toBe('completedClearAllBtn');
        expect(pill.getAttribute('aria-label')).toBe('Delete all completed tasks');
        const [icon, label] = pill.children;
        expect(icon.namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(icon.tagName.toLowerCase()).toBe('svg');
        expect(icon.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(icon.getAttribute('width')).toBe('13');
        expect(icon.getAttribute('stroke')).toBe('currentColor');
        expect(icon.getAttribute('fill')).toBe('none');
        expect(icon.querySelector('path').getAttribute('d')).toBe('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3');
        expect(label.tagName).toBe('SPAN');
        expect(label.textContent).toBe('Clear all');
        expect(pill.textContent).toBe('Clear all');
    });

    it('styles the pill borderless with a soft hover tint and an un-uppercased header variant', () => {
        const here = dirname(fileURLToPath(import.meta.url));
        const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');
        const base = css.match(/\n\.completedClearAllBtn \{([^}]*)\}/)[1];
        expect(base).toMatch(/border: none;/);
        expect(base).toMatch(/background: transparent;/);
        expect(base).toMatch(/display: inline-flex;/);
        const hover = css.match(/\.completedClearAllBtn:hover \{([^}]*)\}/)[1];
        expect(hover).toMatch(/var\(--text-danger\) 14%/);
        expect(hover).not.toMatch(/border-color/);
        const header = css.match(/#completedHeader \.completedClearAllBtn \{\n([^}]*)\}/)[1];
        expect(header).toMatch(/text-transform: none;/);
        expect(header).toMatch(/padding: 0 10px 0 8px;/);
        expect(css).toMatch(/#completedHeader \.completedClearAllBtn::after \{\s*inset: -10px -4px;/);
    });
});

describe('Clear all — desktop wiring (source pins)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const read = rel => readFileSync(resolve(here, '../src', rel), 'utf8');
    const main = read('main.js');
    const css = read('style.css');

    it('main.js mounts the pill into #completedHeader on every render pass', () => {
        expect(main).toMatch(/addEventListener\('mainListRendered'[\s\S]{0,300}#completedHeader[\s\S]{0,200}buildClearCompletedPill\(\)/);
    });

    it('the exclusive-collapse capture handler skips clicks on the pill', () => {
        const idx = main.indexOf("target.closest('.completedClearAllBtn')");
        expect(idx).toBeGreaterThan(-1);
        expect(idx).toBeLessThan(main.indexOf("const ch = target.closest('#completedHeader')"));
    });

    it('hides the inline pill below 1024px, where the sheet carries its own', () => {
        expect(css).toMatch(/#completedHeader \.completedClearAllBtn \{ display: none; \}/);
    });
});
