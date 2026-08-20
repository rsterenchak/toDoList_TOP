// The Models panel is one surface with two openers — the desktop gear dropdown
// and the mobile settings modal — the same shape the API-spend panel uses. Both
// halves are pinned here so the panel can never end up reachable from only one
// viewport, which is exactly how the Shape reference row shipped desktop-only.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const openModelsPanel = vi.fn();
const showRepoSetupModal = vi.fn();
const showInjectSettingsModal = vi.fn();

vi.mock('../src/modelsPanel.js', () => ({
    openModelsPanel: (...args) => openModelsPanel(...args),
}));
vi.mock('../src/repoSetup.js', () => ({
    showRepoSetupModal: (...args) => showRepoSetupModal(...args),
}));
vi.mock('../src/inject.js', () => ({
    showInjectSettingsModal: (...args) => showInjectSettingsModal(...args),
}));

const { createSettingsModal } = await import('../src/settingsModal.js');

const here = dirname(fileURLToPath(import.meta.url));
const settingsMenuSrc = readFileSync(resolve(here, '../src/settingsMenu.js'), 'utf8');

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

describe('models panel — mobile settings modal opener', () => {
    beforeEach(() => {
        closeCalls = 0;
        openModelsPanel.mockReset();
        mountSettingsModal();
    });

    it('carries a Models section sitting after Repo setup', () => {
        const headings = [...document.querySelectorAll('#settingsModalBody .settingsSectionHeading')]
            .map((el) => el.textContent);
        expect(headings).toContain('Models');
        expect(headings.indexOf('Models')).toBe(headings.indexOf('Repo setup') + 1);
    });

    it('opens the shared panel from its row, dismissing the modal first', () => {
        const section = document.getElementById('settingsModelsSection');
        expect(section).toBeTruthy();
        const row = section.querySelector('.drawerActionRow');
        expect(row.querySelector('.drawerToggleLabel').textContent).toBe('Per-workflow models');

        row.click();
        expect(closeCalls).toBe(1);
        expect(openModelsPanel).toHaveBeenCalledTimes(1);
        // Focus goes back to the drawer's settings button, which is what opened
        // the modal the row lives in.
        expect(openModelsPanel.mock.calls[0][0]).toBe(document.getElementById('drawerSettingsBtn'));
    });
});

describe('models panel — desktop gear dropdown opener', () => {
    it('adds a Models section whose row opens the same shared panel', () => {
        expect(settingsMenuSrc).toMatch(/import \{ openModelsPanel \} from '\.\/modelsPanel\.js';/);
        expect(settingsMenuSrc).toMatch(/modelsHeading\.textContent\s*=\s*'Models'/);
        expect(settingsMenuSrc).toMatch(/'Per-workflow models',[\s\S]{0,80}openModelsPanel\(settingsToggle\)/);
    });
});
