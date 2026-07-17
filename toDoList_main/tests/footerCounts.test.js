import { beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createFooterCounts } from '../src/footerCounts.js';
import { listLogic } from '../src/listLogic.js';

// updateFooterCounts was extracted verbatim from main.js into footerCounts.js.
// These tests pin the extracted factory's behaviour (badge repaint + open/done
// tally + footer text + header hand-off) and guard the wiring in main.js so a
// future re-inline can't quietly reintroduce the function there.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

beforeEach(() => {
    document.body.innerHTML = '';
    try { localStorage.clear(); } catch (e) { /* ignore */ }
});

function selectedSidebar(projectName) {
    // Minimal sidebar shape updateFooterCounts reads: a #sideMa container with a
    // single committed, selected project row carrying its #projInput name.
    const sideMain = document.createElement('div');
    sideMain.id = 'sideMa';
    const row = document.createElement('div');
    row.id = 'projChild';
    row.className = 'selectedProject';
    const input = document.createElement('input');
    input.id = 'projInput';
    input.value = projectName;
    row.appendChild(input);
    sideMain.appendChild(row);
    document.body.appendChild(sideMain);
    return sideMain;
}

describe('footerCounts — createFooterCounts factory', () => {
    it('tallies open/done, writes the footer spans, and hands the tally to the header writer', () => {
        listLogic.addProject('Work');
        listLogic.addToDo('Work', 'A');
        listLogic.addToDo('Work', 'B');
        listLogic.addToDo('Work', 'C');
        const items = listLogic.listItems('Work');
        const a = items.find(i => i.tit === 'A');
        listLogic.setToDoCompleted('Work', a, true);

        const sideMain = selectedSidebar('Work');
        const footOpen = document.createElement('span');
        const footDone = document.createElement('span');
        const updateMobileProjHeader = vi.fn();

        const { updateFooterCounts } = createFooterCounts({
            sideMain, footOpen, footDone, updateMobileProjHeader,
        });
        updateFooterCounts();

        // A is done; B and C remain open.
        expect(footOpen.textContent).toBe('2 OPEN');
        expect(footDone.textContent).toBe('1 DONE');
        expect(updateMobileProjHeader).toHaveBeenCalledWith('Work', 2, 1);
    });

    it('reports zeros with no selected project and still calls the header writer', () => {
        const sideMain = document.createElement('div');
        sideMain.id = 'sideMa';
        document.body.appendChild(sideMain);
        const footOpen = document.createElement('span');
        const footDone = document.createElement('span');
        const updateMobileProjHeader = vi.fn();

        const { updateFooterCounts } = createFooterCounts({
            sideMain, footOpen, footDone, updateMobileProjHeader,
        });
        updateFooterCounts();

        expect(footOpen.textContent).toBe('0 OPEN');
        expect(footDone.textContent).toBe('0 DONE');
        expect(updateMobileProjHeader).toHaveBeenCalledWith('', 0, 0);
    });
});

describe('footerCounts.js — extracted from main.js', () => {
    const main = read('main.js');
    const module = read('footerCounts.js');

    it('exports the createFooterCounts factory holding updateFooterCounts', () => {
        expect(module).toMatch(/export function createFooterCounts\(/);
        expect(module).toMatch(/function updateFooterCounts\(/);
    });

    it('main.js imports and instantiates the factory', () => {
        expect(main).toMatch(/import \{ createFooterCounts \} from '\.\/footerCounts\.js'/);
        expect(main).toMatch(/createFooterCounts\(/);
    });

    it('main.js no longer defines updateFooterCounts inline', () => {
        expect(main).not.toMatch(/function updateFooterCounts\(/);
    });
});
