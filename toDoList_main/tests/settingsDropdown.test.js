import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the ghost menu dropdown that replaced the previous
// save / import / kebab cluster on the top nav. The cluster is gone — a
// single 36×36 ghost icon trigger sits flush against the right edge of the
// nav, and clicking it opens a small dropdown housing Theme, Toggle
// floating ghost, a divider, the HELP section (Replay welcome tour, Help),
// another divider, and the ACCOUNT section (Sign out). The trigger itself
// stays static; the floating-ghost companion (toggled from inside the
// menu) is the one that drifts. A subtle hover-pulse animation cycles on
// the trigger while idle for discoverability.
describe('ghost menu — top-nav trigger + dropdown', () => {
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

    it('renders a ghost glyph (not a kebab) inside the trigger', () => {
        // The trigger's icon is a pixel-art ghost. The kebab three-circle
        // SVG it replaced should be gone from the trigger markup. Scope the
        // assertions to the captured `settingsToggle.innerHTML` value (up to
        // its terminating `;`) so an unrelated `<circle` elsewhere in main.js
        // can't be picked up by an unanchored match.
        const assignment = main.match(/settingsToggle\.innerHTML\s*=\s*([\s\S]*?);/);
        expect(assignment).not.toBeNull();
        const triggerMarkup = assignment[1];
        expect(triggerMarkup).toMatch(/ghostIcon/);
        expect(triggerMarkup).not.toMatch(/<circle/);
    });

    it('removes the previous save/import icon cluster from the nav', () => {
        // The save (download) and import (upload) icon buttons that lived
        // immediately to the left of the kebab are gone — Export and
        // Import now live as items inside the dropdown.
        expect(main).not.toMatch(/createExportImportControls\s*\(/);
        expect(main).not.toMatch(/nav\.appendChild\(\s*exportImportControls\s*\)/);
    });

    it('does not render the old companion pill-switch or standalone theme button in the nav', () => {
        expect(main).not.toMatch(/companionToggle\.id\s*=/);
        expect(main).not.toMatch(/nav\.appendChild\(\s*companionToggle\s*\)/);
        expect(main).not.toMatch(/nav\.appendChild\(\s*themeToggle\s*\)/);
    });

    it('builds Theme and Toggle floating ghost menu items via the shared helper', () => {
        // The previous DRIVE section (heading + state-aware Sync row) was
        // removed when Drive sync was retired. The remaining toggle items
        // go through buildSettingsMenuItem so a future row addition picks
        // up the same chrome.
        expect(main).toMatch(/function\s+buildSettingsMenuItem\s*\(/);
        expect(main).toMatch(/buildSettingsMenuItem\(\s*'Theme'\s*,/);
        expect(main).toMatch(/buildSettingsMenuItem\(\s*'Toggle floating ghost'\s*,/);
    });

    it('renders a divider between the toggle group and the HELP section', () => {
        // The CSS class is consumed both for visual styling and as the
        // semantic anchor — the divider's render order in showSettingsMenu
        // determines which items sit above and below it.
        expect(main).toMatch(/function\s+buildSettingsMenuDivider\s*\(/);
        expect(main).toMatch(/settingsMenuDivider/);

        // Order in source: Theme → Toggle floating ghost → divider → Help
        // heading → Replay welcome tour. The previous DRIVE heading +
        // Sync row are gone.
        const themeIdx     = main.indexOf("'Theme'");
        const ghostIdx     = main.indexOf("'Toggle floating ghost'");
        const dividerIdx   = main.indexOf('menu.appendChild(buildSettingsMenuDivider()');
        const helpHeadIdx  = main.indexOf("helpHeading.textContent = 'Help'");
        expect(themeIdx).toBeGreaterThan(-1);
        expect(ghostIdx).toBeGreaterThan(themeIdx);
        expect(dividerIdx).toBeGreaterThan(themeIdx);
        expect(helpHeadIdx).toBeGreaterThan(dividerIdx);
    });

    it('does not render a DRIVE section heading or Drive Sync row builder', () => {
        // Drive sync was removed; no DRIVE heading, sync row builder, or
        // Drive-anchored menu hooks should remain in source.
        expect(main).not.toMatch(/driveHeadingLabel\.textContent\s*=\s*['"]Drive['"]/);
        expect(main).not.toMatch(/function\s+buildDriveSyncRow\s*\(/);
        expect(main).not.toMatch(/menu\.appendChild\(\s*buildDriveSyncRow\s*\(\s*\)\s*\)/);
        // No LOCAL section heading either — long since removed.
        expect(main).not.toMatch(/localHeading\.textContent\s*=\s*['"]Local['"]/);
    });

    it('Toggle floating ghost item flips the companion pref and mounts/destroys the singleton', () => {
        const idx = main.indexOf("'Toggle floating ghost'");
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

    it('shows the current state on the toggle items — ON/OFF for floating ghost, Light/Dark for theme', () => {
        expect(main).toMatch(/isCompanionEnabled\(\)\s*\?\s*'ON'\s*:\s*'OFF'/);
        expect(main).toMatch(/getCurrentTheme\(\)\s*===\s*'light'\s*\?\s*'Light'\s*:\s*'Dark'/);
    });

    it('closes the dropdown on selection, outside click, and Escape', () => {
        const itemBuilderStart = main.indexOf('function buildSettingsMenuItem');
        expect(itemBuilderStart).toBeGreaterThan(-1);
        const itemBuilder = main.slice(itemBuilderStart, itemBuilderStart + 1200);
        expect(itemBuilder).toMatch(/hideSettingsMenu\s*\(\s*\)/);

        expect(main).toMatch(/function\s+onSettingsOutsideClick\s*\(/);
        expect(main).toMatch(/function\s+onSettingsKeydown\s*\(/);
        const escHandler = main.slice(main.indexOf('function onSettingsKeydown'));
        expect(escHandler.slice(0, 400)).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
        expect(escHandler.slice(0, 400)).toMatch(/hideSettingsMenu\s*\(\s*\)/);

        const outsideHandler = main.slice(main.indexOf('function onSettingsOutsideClick'));
        expect(outsideHandler.slice(0, 600)).toMatch(/menu\.contains\s*\(\s*event\.target\s*\)/);
        expect(outsideHandler.slice(0, 600)).toMatch(/settingsToggle\.contains\s*\(\s*event\.target\s*\)/);
    });

    it('participates in isAnyModalOrPopoverOpen so global shortcuts are gated while open', () => {
        expect(modals).toMatch(/document\.getElementById\(\s*['"]settingsMenu['"]\s*\)/);
    });

    it('hides the FAB while the settings menu is open', () => {
        expect(css).toMatch(/body:has\(#settingsMenu\)\s+#helpFab/);
    });

    it('styles #settingsToggle as a 36×36 transparent icon button pushed flush right of the nav', () => {
        const rule = extractTopLevelRule('#settingsToggle');
        expect(rule).toMatch(/width:\s*36px\s*;/);
        expect(rule).toMatch(/height:\s*36px\s*;/);
        expect(rule).toMatch(/background:\s*transparent\s*;/);
        // The `margin-left: auto` that pushes the right-side cluster flush
        // right now lives on #pomodoroToggle (the leftmost member of that
        // cluster in DOM order). settingsToggle inherits the position by
        // sitting next to pomodoro under the navbar's `gap: 8px`, so its
        // own rule must NOT redeclare margin-left: auto — that would split
        // the slack between the two and break the cluster.
        expect(rule).not.toMatch(/margin-left:\s*auto\s*;/);
        const pomoRule = extractTopLevelRule('#pomodoroToggle');
        expect(pomoRule).toMatch(/margin-left:\s*auto\s*;/);
    });

    it('drives a hover-pulse animation on #settingsToggle for discoverability', () => {
        // Subtle scale + opacity loop around the ~700ms cycle the task
        // calls out. The animation only runs while the trigger is idle —
        // hover, focus-visible, and aria-expanded="true" (menu open) all
        // cancel it.
        const rule = extractTopLevelRule('#settingsToggle');
        expect(rule).toMatch(/animation:\s*ghostMenuPulse\s+700ms/);
        expect(css).toMatch(/@keyframes\s+ghostMenuPulse\s*\{[\s\S]*?scale\s*\(\s*1[\.0-9]*\s*\)[\s\S]*?opacity:\s*[01](\.\d+)?[\s\S]*?\}/);

        const hover = extractTopLevelRule('#settingsToggle:hover');
        expect(hover).toMatch(/animation:\s*none\s*;/);
        const focus = extractTopLevelRule('#settingsToggle:focus-visible');
        expect(focus).toMatch(/animation:\s*none\s*;/);
        const open = extractTopLevelRule('#settingsToggle[aria-expanded="true"]');
        expect(open).toMatch(/animation:\s*none\s*;/);
    });

    it('disables the hover-pulse under prefers-reduced-motion', () => {
        // The pulse is ambient motion; reduced-motion users get the static
        // icon at full opacity / rest scale.
        expect(css).toMatch(/@media\s+\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?#settingsToggle[\s\S]*?animation:\s*none/);
    });

    it('styles #settingsMenu as a fixed-position dropdown surface', () => {
        const rule = extractTopLevelRule('#settingsMenu');
        expect(rule).toMatch(/position:\s*fixed\s*;/);
        expect(rule).toMatch(/background:\s*var\(--bg-surface\)/);
    });

    it('styles .settingsMenuDivider as a thin hairline that separates the data and toggle groups', () => {
        const rule = extractTopLevelRule('.settingsMenuDivider');
        expect(rule).toMatch(/height:\s*1px\s*;/);
        expect(rule).toMatch(/background:\s*var\(--border-dim\)/);
    });
});
