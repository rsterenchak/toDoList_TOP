// restoreFromStorage's tail auto-selects a project programmatically (cold-boot
// default = first project; in-session re-render = opts.selectProject). Unlike
// the two click-driven select paths, this programmatic path historically
// marked its target row .selectedProject WITHOUT first clearing the
// previously-selected row. When it ran while another row was already selected
// (e.g. the allProjChildren[0] fallback firing while a linked project row was
// active), two rows carried .selectedProject at once. Because
// getSelectedProjectName()/resolveProjectRepo() read the FIRST .selectedProject
// in DOM order, the row-0 (self repo) row won and the Structure tab resolved
// the wrong repo.
//
// This test extracts the runnable auto-select region and drives it directly:
// with a prior selection present, the programmatic select must leave EXACTLY
// one .selectedProject row, and it must be the intended target — not the stale
// prior row.
//
// jsdom note: element.querySelector('#id') with duplicate ids delegates to
// getElementById and returns the document-first match, ignoring scope. The
// real rows all carry id="projInput", so the honorSelect lookup only resolves
// a target whose #projInput is document-first. The honorSelect scenario below
// is ordered accordingly; the fallback scenarios don't depend on it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(resolve(here, '../src/main.js'), 'utf8');

// Slice the self-contained auto-select region: from the honorSelect/target
// resolution through the if (targetChild) { ... } select block, stopping
// before applyProjectAccent (which pulls in unrelated app dependencies).
const startIdx = main.indexOf('const honorSelect');
const endIdx = main.indexOf('applyProjectAccent(document.getElementById', startIdx);
const region = main.slice(startIdx, endIdx);

// Build a fresh closure per call so nothing bleeds across tests. The region
// only touches document, savedProjects, and opts; it returns the resolved row.
const runAutoSelect = new Function(
    'document', 'savedProjects', 'opts',
    region + '\n; return targetChild;'
);

function makeRow(name, selected) {
    const row = document.createElement('div');
    row.id = 'projChild';
    row.className = selected ? 'selectedProject' : 'unselectedProject';
    const input = document.createElement('input');
    input.id = 'projInput';
    input.value = name;
    row.appendChild(input);
    return row;
}

describe('programmatic project select keeps a single .selectedProject', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('region was located and contains the select block', () => {
        expect(startIdx).toBeGreaterThan(-1);
        expect(endIdx).toBeGreaterThan(startIdx);
        expect(region).toMatch(/targetChild\.classList\.add\("selectedProject"\)/);
    });

    it('cold-boot fallback to row 0 clears a pre-existing selection (the reported bug)', () => {
        // A linked project row is already selected; a cold-boot re-render with
        // no honored selection falls back to allProjChildren[0]. The fallback
        // must demote the linked row so only row 0 stays selected — otherwise
        // both rows carry .selectedProject and the first-match reader picks the
        // wrong (self) repo.
        const rowSelf = makeRow('Task Management App', false);   // row 0
        const rowLinked = makeRow('DBZ Memory Game App', true);  // stale selection
        document.body.appendChild(rowSelf);
        document.body.appendChild(rowLinked);

        const target = runAutoSelect(
            document,
            ['Task Management App', 'DBZ Memory Game App'],
            undefined
        );

        const selected = document.querySelectorAll('.selectedProject');
        expect(selected.length).toBe(1);
        expect(selected[0]).toBe(rowSelf);
        expect(target).toBe(rowSelf);
        // The stale linked row is fully demoted, not left half-marked.
        expect(rowLinked.classList.contains('selectedProject')).toBe(false);
        expect(rowLinked.classList.contains('unselectedProject')).toBe(true);
    });

    it('honorSelect target deselects the previously selected row', () => {
        // In-session re-render preserving a specific project: the honored
        // target must end up the sole selection, with the prior row cleared.
        // The target row is placed first in DOM order so jsdom's getElementById
        // -backed #projInput lookup resolves it (see jsdom note above).
        const rowTarget = makeRow('DBZ Memory Game App', false); // row 0, target
        const rowPrev = makeRow('Task Management App', true);     // stale selection
        document.body.appendChild(rowTarget);
        document.body.appendChild(rowPrev);

        const target = runAutoSelect(
            document,
            ['DBZ Memory Game App', 'Task Management App'],
            { selectProject: 'DBZ Memory Game App' }
        );

        const selected = document.querySelectorAll('.selectedProject');
        expect(selected.length).toBe(1);
        expect(selected[0]).toBe(rowTarget);
        expect(target).toBe(rowTarget);
        expect(rowPrev.classList.contains('selectedProject')).toBe(false);
    });

    it('re-selecting the already-selected target does not toggle it off', () => {
        // A same-project programmatic re-select (target === current selection)
        // must leave the target selected, not deselect itself.
        const rowActive = makeRow('Task Management App', true);  // row 0, already selected
        const rowOther = makeRow('DBZ Memory Game App', false);
        document.body.appendChild(rowActive);
        document.body.appendChild(rowOther);

        const target = runAutoSelect(
            document,
            ['Task Management App', 'DBZ Memory Game App'],
            undefined
        );

        const selected = document.querySelectorAll('.selectedProject');
        expect(selected.length).toBe(1);
        expect(selected[0]).toBe(rowActive);
        expect(target).toBe(rowActive);
        expect(rowActive.classList.contains('selectedProject')).toBe(true);
    });
});
