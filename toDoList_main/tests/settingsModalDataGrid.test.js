// Tests for the mobile Settings modal's Data section — the button grid
// that surfaces Drive Export/Import on mobile, where the desktop ghost
// menu that houses those rows is hidden by the ≤700px breakpoint.
// Source-level pins: the section is the FIRST one in the modal body, the
// two tiles invoke the same handlers the desktop menu rows already wire
// up (no new orchestration), the existing body.driveExportInProgress /
// driveImportInProgress dim hooks pivot on the tile anchor classes, and
// the caption underneath uses formatRelativeExportedAt for the
// stale-time signal so it stays consistent with the desktop ghost menu.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

describe('mobile Settings modal — Data section (2x2 grid)', () => {
    const main = read('main.js');
    const css  = read('style.css');

    function showSettingsModalSlice() {
        const idx = main.indexOf('function showSettingsModal()');
        expect(idx).toBeGreaterThan(-1);
        // Wide enough to cover the data section + the rest of the modal
        // body the tests pivot on. Widened to 10000 after the About
        // section landed between Appearance and Help.
        return main.slice(idx, idx + 10000);
    }

    describe('Data section structure', () => {
        it('builds a Data section heading via the existing settingsSectionHeading class', () => {
            const slice = showSettingsModalSlice();
            expect(slice).toMatch(/dataHeading\.className\s*=\s*['"]settingsSectionHeading['"]/);
            expect(slice).toMatch(/dataHeading\.textContent\s*=\s*['"]Data['"]/);
        });

        it('mounts the Data section as the FIRST section in the modal body (above View / Appearance / Help)', () => {
            const slice = showSettingsModalSlice();
            const dataAppend       = slice.indexOf('body.appendChild(dataSection)');
            const viewAppend       = slice.indexOf('body.appendChild(viewSection)');
            const appearanceAppend = slice.indexOf('body.appendChild(appearanceSection)');
            const helpAppend       = slice.indexOf('body.appendChild(helpSection)');
            expect(dataAppend).toBeGreaterThan(-1);
            expect(viewAppend).toBeGreaterThan(dataAppend);
            expect(appearanceAppend).toBeGreaterThan(viewAppend);
            expect(helpAppend).toBeGreaterThan(appearanceAppend);
        });

        it('builds a grid wrapper with the settingsModalDataGrid class', () => {
            const slice = showSettingsModalSlice();
            expect(slice).toMatch(/dataGrid\.className\s*=\s*['"]settingsModalDataGrid['"]/);
            expect(slice).toMatch(/dataSection\.appendChild\(dataGrid\)/);
        });
    });

    describe('tile builder + Drive tile layout', () => {
        it('createDrawerDataTile sits next to createDrawerToggleRow / createDrawerActionRow', () => {
            expect(main).toMatch(/function\s+createDrawerDataTile\s*\(/);
            const tileIdx   = main.indexOf('function createDrawerDataTile');
            const toggleIdx = main.indexOf('function createDrawerToggleRow');
            const actionIdx = main.indexOf('function createDrawerActionRow');
            expect(toggleIdx).toBeGreaterThan(-1);
            expect(actionIdx).toBeGreaterThan(-1);
            // All four drawer-row helpers (Toggle / Data / Info / Action)
            // cluster in one neighborhood so they're easy to maintain
            // together. Widened from 4000 → 5000 after createDrawerInfoRow
            // joined the cluster to back the Settings About section.
            const lo = Math.min(tileIdx, toggleIdx, actionIdx);
            const hi = Math.max(tileIdx, toggleIdx, actionIdx);
            expect(hi - lo).toBeLessThan(5000);
        });

        it('tile builder paints icon / verb / sub-label spans', () => {
            const idx = main.indexOf('function createDrawerDataTile');
            expect(idx).toBeGreaterThan(-1);
            const fn = main.slice(idx, idx + 1200);
            expect(fn).toMatch(/settingsModalDataTileIcon/);
            expect(fn).toMatch(/settingsModalDataTileVerb/);
            expect(fn).toMatch(/settingsModalDataTileSub/);
        });

        it('mounts two Drive tiles: Drive Export then Drive Import', () => {
            const slice = showSettingsModalSlice();
            const driveExportIdx = slice.indexOf("'settingsModalDataTile--driveExport'");
            const driveImportIdx = slice.indexOf("'settingsModalDataTile--driveImport'");
            expect(driveExportIdx).toBeGreaterThan(-1);
            expect(driveImportIdx).toBeGreaterThan(driveExportIdx);
            // LOCAL tile anchors must not appear anywhere in source.
            expect(main).not.toMatch(/settingsModalDataTile--localExport/);
            expect(main).not.toMatch(/settingsModalDataTile--localImport/);
        });
    });

    describe('tile handlers reuse the existing desktop menu wiring', () => {
        function sliceAroundAnchor(anchor) {
            const slice = showSettingsModalSlice();
            const idx = slice.indexOf(anchor);
            expect(idx).toBeGreaterThan(-1);
            return slice.slice(Math.max(0, idx - 600), idx + 200);
        }

        it('Drive Export tile invokes exportTodosToDrive()', () => {
            const slice = sliceAroundAnchor("'settingsModalDataTile--driveExport'");
            expect(slice).toMatch(/exportTodosToDrive\s*\(\s*\)/);
        });

        it('Drive Import tile invokes importTodosFromDrive() with the rebuild callback', () => {
            const slice = sliceAroundAnchor("'settingsModalDataTile--driveImport'");
            expect(slice).toMatch(/importTodosFromDrive\s*\(/);
            expect(slice).toMatch(/rebuildAfterImport\s*\(\s*\)/);
        });
    });

    describe('body.driveExportInProgress / driveImportInProgress dim the matching tiles', () => {
        it('CSS pivots on settingsModalDataTile--driveExport for the in-flight upload', () => {
            expect(css).toMatch(
                /body\.driveExportInProgress\s+\.settingsModalDataTile--driveExport\s*\{[^}]*pointer-events:\s*none/
            );
            expect(css).toMatch(
                /body\.driveExportInProgress\s+\.settingsModalDataTile--driveExport\s*\{[^}]*opacity:\s*0\.55/
            );
        });

        it('CSS pivots on settingsModalDataTile--driveImport for the in-flight download', () => {
            expect(css).toMatch(
                /body\.driveImportInProgress\s+\.settingsModalDataTile--driveImport\s*\{[^}]*pointer-events:\s*none/
            );
            expect(css).toMatch(
                /body\.driveImportInProgress\s+\.settingsModalDataTile--driveImport\s*\{[^}]*opacity:\s*0\.55/
            );
        });
    });

    describe('caption row stale-time signal', () => {
        it('caption uses formatRelativeExportedAt and reads readLastDriveSyncedAt from prefs', () => {
            const slice = showSettingsModalSlice();
            expect(slice).toMatch(/settingsModalDataCaption/);
            // The helper is imported into main.js at the top and called
            // from the caption refresh — it's the same helper the desktop
            // ghost menu's Drive Export state pill uses.
            expect(slice).toMatch(/formatRelativeExportedAt\s*\(/);
            expect(slice).toMatch(/readLastDriveSyncedAt\s*\(\s*\)/);
        });

        it('caption falls back to "never" for null timestamps (vs the helper\'s "Never synced")', () => {
            const slice = showSettingsModalSlice();
            // Null timestamps must read "never" in the caption rather than
            // the helper's longer default, so the caption stays terse
            // beneath the grid.
            expect(slice).toMatch(/formatCaptionPart[\s\S]{0,400}return\s+['"]never['"]/);
        });

        it('caption text is wired to the captured DOM via a refreshDataCaption helper called on modal open', () => {
            const slice = showSettingsModalSlice();
            // The helper sits inside showSettingsModal so it closes over
            // the caption DOM element, and runs once before the modal is
            // attached so the first paint already shows the freshly read
            // timestamp.
            expect(slice).toMatch(/function\s+refreshDataCaption\s*\(/);
            expect(slice).toMatch(/refreshDataCaption\s*\(\s*\)/);
        });

        it('caption is re-rendered after a Drive Export promise resolves (without needing to reopen the modal)', () => {
            const slice = showSettingsModalSlice();
            // exportTodosToDrive returns a promise that resolves after the
            // upload + timestamp write completes; chaining the caption
            // refresh keeps the open modal in sync.
            const idx = slice.indexOf("'settingsModalDataTile--driveExport'");
            expect(idx).toBeGreaterThan(-1);
            const around = slice.slice(Math.max(0, idx - 600), idx + 200);
            expect(around).toMatch(/exportTodosToDrive\s*\(\s*\)/);
            expect(around).toMatch(/\.then\(\s*refreshDataCaption\s*,\s*refreshDataCaption\s*\)/);
        });
    });

    describe('desktop ghost menu is untouched (scope guard)', () => {
        it('showSettingsMenu still mounts a DRIVE section heading', () => {
            // The mobile Data section is purely additive. The desktop
            // ghost menu's DRIVE section (and its right-side pill) must
            // keep working exactly as before.
            expect(main).toMatch(/driveHeadingLabel\.textContent\s*=\s*['"]Drive['"]/);
            // LOCAL section is gone — the heading no longer exists.
            expect(main).not.toMatch(/localHeading\.textContent\s*=\s*['"]Local['"]/);
        });
    });
});
