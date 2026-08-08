// Tests for the mobile Settings modal's Repo setup section. The Shape
// reference row (which opens the SHAPES.md picker) was only ever added to
// settingsMenu.js — the desktop gear dropdown — leaving the picker
// unreachable from the phone, which is the surface it exists for. The
// modal now carries its own Repo setup section built from its local
// createDrawerActionRow pattern (NOT the dropdown's buildSettingsMenuItem
// builders, which are shaped for a dropdown), with Configure inject moved
// under the same heading so both halves of pointing the app at a repo read
// as one cluster, as they do in the dropdown.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const showRepoSetupModal = vi.fn();
const showInjectSettingsModal = vi.fn();

vi.mock('../src/repoSetup.js', () => ({
    showRepoSetupModal: (...args) => showRepoSetupModal(...args),
}));
vi.mock('../src/inject.js', () => ({
    showInjectSettingsModal: (...args) => showInjectSettingsModal(...args),
}));

const { createSettingsModal } = await import('../src/settingsModal.js');

const here = dirname(fileURLToPath(import.meta.url));
const settingsModalSrc = readFileSync(resolve(here, '../src/settingsModal.js'), 'utf8');

// The modal's action rows all dismiss before running their flow, so the
// harness records close() calls to pin that ordering for the new row too.
let closeCalls;

function mountSettingsModal() {
    document.body.innerHTML = '<button id="drawerSettingsBtn"></button>';
    const drawerSettingsBtn = document.getElementById('drawerSettingsBtn');
    const { showSettingsModal } = createSettingsModal({
        buildExpandAllToggle: () => ({ row: document.createElement('div') }),
        buildCompanionToggle: () => ({ row: document.createElement('div') }),
        wireDismissable: () => ({ close: () => { closeCalls += 1; } }),
        drawerSettingsBtn,
        applyActiveView: () => {},
        rebuildAfterImport: () => {},
        seedSampleTodosIntoActiveProjectIfEmpty: () => {},
    });
    showSettingsModal();
}

function sectionHeadings() {
    return [...document.querySelectorAll('#settingsModalBody .settingsSectionHeading')]
        .map((el) => el.textContent);
}

function rowLabelsIn(sectionId) {
    const section = document.getElementById(sectionId);
    expect(section, `${sectionId} missing from the modal`).toBeTruthy();
    return [...section.querySelectorAll('.drawerActionRow .drawerToggleLabel')]
        .map((el) => el.textContent);
}

function findRow(labelText) {
    return [...document.querySelectorAll('#settingsModalBody .drawerActionRow')]
        .find((row) => {
            const label = row.querySelector('.drawerToggleLabel');
            return label && label.textContent === labelText;
        });
}

describe('mobile Settings modal — Repo setup section', () => {
    beforeEach(() => {
        closeCalls = 0;
        showRepoSetupModal.mockClear();
        showInjectSettingsModal.mockClear();
        mountSettingsModal();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('renders a Repo setup section between Data and Account', () => {
        const headings = sectionHeadings();
        expect(headings).toContain('Repo setup');
        expect(headings.indexOf('Repo setup')).toBeGreaterThan(headings.indexOf('Data'));
        expect(headings.indexOf('Repo setup')).toBeLessThan(headings.indexOf('Account'));
    });

    it('holds Shape reference then Configure inject under that heading', () => {
        expect(rowLabelsIn('settingsRepoSetupSection'))
            .toEqual(['Shape reference', 'Configure inject']);
    });

    it('no longer lists Configure inject under Data', () => {
        expect(rowLabelsIn('settingsDataSection'))
            .toEqual(['Export to JSON', 'Import from JSON']);
    });

    it('opens the SHAPES.md picker when Shape reference is tapped', () => {
        const row = findRow('Shape reference');
        expect(row).toBeTruthy();
        row.click();
        expect(showRepoSetupModal).toHaveBeenCalledTimes(1);
        // Dismiss first, like every other action row in this modal, so the
        // picker lands on a clean surface rather than stacked over the modal.
        expect(closeCalls).toBe(1);
    });

    it('keeps Configure inject working from its new home', () => {
        const row = findRow('Configure inject');
        expect(row).toBeTruthy();
        row.click();
        expect(showInjectSettingsModal).toHaveBeenCalledTimes(1);
        expect(closeCalls).toBe(1);
    });

    it('carries a chevron on the Shape reference row, as the action rows do', () => {
        const row = findRow('Shape reference');
        expect(row.querySelector('.drawerActionChevron')).toBeTruthy();
    });

    it('reaches the picker through repoSetup.js, not the dropdown builders', () => {
        expect(settingsModalSrc)
            .toMatch(/import\s*\{\s*showRepoSetupModal\s*\}\s*from\s*'\.\/repoSetup\.js'/);
        // The dropdown's item/heading builders are shaped for a dropdown;
        // the modal keeps building its own rows.
        expect(settingsModalSrc).not.toMatch(/from\s*'\.\/settingsMenu\.js'/);
    });
});
