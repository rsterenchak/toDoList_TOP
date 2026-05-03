import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the settings dropdown that replaced the standalone
// ghost pill switch and theme icon button in the top nav. The dropdown is a
// single trigger that opens a small menu with two items — Show ghost and
// Theme — each rendering a state indicator on the right. Save and import
// stay as direct icon buttons so the most-used data actions remain
// one-click.
describe('settings dropdown — top-nav trigger + menu', () => {
    const main = read('main.js');
    const modals = read('modals.js');
    const css = read('style.css');

    function extractTopLevelRule(selector) {
        let depth = 0;
        for (let i = 0; i < css.length; i++) {
            const c = css[i];
            if (c === '{') { depth++; continue; }
            if (c === '}') { depth--; continue; }
            if (depth !== 0) continue;
            if (css.startsWith(selector, i) && /[\s{]/.test(css[i + selector.length] || '')) {
                const blockStart = css.indexOf('{', i);
                const blockEnd = css.indexOf('}', blockStart);
                return css.slice(blockStart + 1, blockEnd);
            }
        }
        throw new Error(`Top-level rule for "${selector}" not found`);
    }

    it('appends a settingsToggle button to the nav with menu aria metadata', () => {
        expect(main).toMatch(/settingsToggle\.id\s*=\s*['"]settingsToggle['"]/);
        expect(main).toMatch(/settingsToggle\.setAttribute\(\s*['"]aria-haspopup['"]\s*,\s*['"]menu['"]/);
        expect(main).toMatch(/settingsToggle\.setAttribute\(\s*['"]aria-expanded['"]\s*,\s*['"]false['"]/);
        expect(main).toMatch(/nav\.appendChild\(\s*settingsToggle\s*\)/);
    });

    it('does not render the old companion pill-switch or standalone theme button in the nav', () => {
        // The pill-switch markup is gone — the only place the toggle lives now
        // is inside the dropdown menu.
        expect(main).not.toMatch(/companionToggle\.id\s*=/);
        expect(main).not.toMatch(/nav\.appendChild\(\s*companionToggle\s*\)/);
        expect(main).not.toMatch(/nav\.appendChild\(\s*themeToggle\s*\)/);
    });

    it('builds Show ghost and Theme menu items via a shared helper', () => {
        expect(main).toMatch(/function\s+buildSettingsMenuItem\s*\(/);
        expect(main).toMatch(/buildSettingsMenuItem\(\s*'Show ghost'\s*,/);
        expect(main).toMatch(/buildSettingsMenuItem\(\s*'Theme'\s*,/);
    });

    it('Show ghost item flips the companion pref and mounts/destroys the singleton', () => {
        const ghostStart = main.indexOf("buildSettingsMenuItem(\n            'Show ghost'");
        // Tolerant fallback if the formatting drifts slightly.
        const idx = ghostStart > -1 ? ghostStart : main.indexOf("'Show ghost'");
        expect(idx).toBeGreaterThan(-1);
        const slice = main.slice(idx, idx + 800);
        expect(slice).toMatch(/setCompanionEnabled\s*\(\s*next\s*\)/);
        expect(slice).toMatch(/ensureCompanion\s*\(\s*\)/);
        expect(slice).toMatch(/destroyCompanion\s*\(\s*\)/);
    });

    it('Theme item flips data-theme via applyTheme and persists under THEME_KEY', () => {
        const idx = main.indexOf("'Theme'");
        expect(idx).toBeGreaterThan(-1);
        const slice = main.slice(idx, idx + 1000);
        expect(slice).toMatch(/applyTheme\s*\(\s*next\s*\)/);
        expect(slice).toMatch(/localStorage\.setItem\s*\(\s*THEME_KEY/);
    });

    it('shows the current state on each menu item — ON/OFF for ghost, Light/Dark for theme', () => {
        expect(main).toMatch(/isCompanionEnabled\(\)\s*\?\s*'ON'\s*:\s*'OFF'/);
        expect(main).toMatch(/getCurrentTheme\(\)\s*===\s*'light'\s*\?\s*'Light'\s*:\s*'Dark'/);
    });

    it('closes the dropdown on selection, outside click, and Escape', () => {
        // Selection: the menu-item handler invokes hideSettingsMenu before the
        // activate callback runs.
        const itemBuilderStart = main.indexOf('function buildSettingsMenuItem');
        expect(itemBuilderStart).toBeGreaterThan(-1);
        const itemBuilder = main.slice(itemBuilderStart, itemBuilderStart + 1200);
        expect(itemBuilder).toMatch(/hideSettingsMenu\s*\(\s*\)/);

        // Outside click and Escape: capture-phase listeners installed when the
        // menu opens, removed when it closes.
        expect(main).toMatch(/function\s+onSettingsOutsideClick\s*\(/);
        expect(main).toMatch(/function\s+onSettingsKeydown\s*\(/);
        const escHandler = main.slice(main.indexOf('function onSettingsKeydown'));
        expect(escHandler.slice(0, 400)).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
        expect(escHandler.slice(0, 400)).toMatch(/hideSettingsMenu\s*\(\s*\)/);

        // Outside-click handler skips clicks inside the menu or on the toggle.
        const outsideHandler = main.slice(main.indexOf('function onSettingsOutsideClick'));
        expect(outsideHandler.slice(0, 600)).toMatch(/menu\.contains\s*\(\s*event\.target\s*\)/);
        expect(outsideHandler.slice(0, 600)).toMatch(/settingsToggle\.contains\s*\(\s*event\.target\s*\)/);
    });

    it('participates in isAnyModalOrPopoverOpen so global shortcuts are gated while open', () => {
        expect(modals).toMatch(/document\.getElementById\(\s*['"]settingsMenu['"]\s*\)/);
    });

    it('hides the FAB while the settings menu is open', () => {
        expect(css).toMatch(/body:has\(#settingsMenu\)\s+#shortcutsHelpFab/);
    });

    it('styles #settingsToggle as a 36×36 transparent icon button matching the nav-icon family', () => {
        const rule = extractTopLevelRule('#settingsToggle');
        expect(rule).toMatch(/width:\s*36px\s*;/);
        expect(rule).toMatch(/height:\s*36px\s*;/);
        expect(rule).toMatch(/background:\s*transparent\s*;/);
    });

    it('styles #settingsMenu as a fixed-position dropdown surface', () => {
        const rule = extractTopLevelRule('#settingsMenu');
        expect(rule).toMatch(/position:\s*fixed\s*;/);
        expect(rule).toMatch(/background:\s*var\(--bg-surface\)/);
    });
});
