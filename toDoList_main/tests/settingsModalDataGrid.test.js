// Tests for the mobile Settings modal's Data section — now a single
// state-aware Sync card that replaced the prior 2-tile Drive Export /
// Drive Import grid plus the standalone LAST DRIVE timestamp caption.
// The card reuses the existing .settingsModalDataTile chrome so the
// section reads as a single-card variant of the prior 2-tile layout,
// with content driven by getCurrentSyncState — matching the desktop
// ghost-menu Sync row's contract.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

describe('mobile Settings modal — Data section (single Sync card)', () => {
    const main = read('main.js');
    const css  = read('style.css');

    function showSettingsModalSlice() {
        const idx = main.indexOf('function showSettingsModal()');
        expect(idx).toBeGreaterThan(-1);
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

        it('grid wrapper is single-column now that only the Sync card lives inside', () => {
            // The 2x2 layout collapsed to a single column when the Drive
            // Export / Drive Import tiles consolidated into one Sync card.
            // Pinning the grid-template-columns value keeps the layout
            // from accidentally regressing to two columns and rendering
            // the single card half-width.
            expect(css).toMatch(
                /\.settingsModalDataGrid\s*\{[^}]*grid-template-columns:\s*1fr\s*;/
            );
        });
    });

    describe('Sync card builder', () => {
        it('declares a buildSettingsModalDriveSyncCard function', () => {
            expect(main).toMatch(/function\s+buildSettingsModalDriveSyncCard\s*\(/);
        });

        it('the card carries the settingsModalDataTile chrome plus the --driveSync anchor', () => {
            const idx = main.indexOf('function buildSettingsModalDriveSyncCard');
            expect(idx).toBeGreaterThan(-1);
            const body = main.slice(idx, idx + 2400);
            expect(body).toMatch(
                /tile\.className\s*=\s*['"]settingsModalDataTile settingsModalDataTile--driveSync['"]/
            );
        });

        it('the card carries the stable settingsModalDriveSyncCard id so the refresh helper can swap it in place', () => {
            const idx = main.indexOf('function buildSettingsModalDriveSyncCard');
            const body = main.slice(idx, idx + 2400);
            expect(body).toMatch(/tile\.id\s*=\s*['"]settingsModalDriveSyncCard['"]/);
        });

        it('builder paints icon / verb / sub-label spans using the same chrome classes as the prior tile builder', () => {
            const idx = main.indexOf('function buildSettingsModalDriveSyncCard');
            const body = main.slice(idx, idx + 2400);
            expect(body).toMatch(/settingsModalDataTileIcon/);
            expect(body).toMatch(/settingsModalDataTileVerb/);
            expect(body).toMatch(/settingsModalDataTileSub/);
        });

        it('the prior LOCAL and per-direction Drive tile anchors no longer appear anywhere in source', () => {
            // Removal scope sanity — the two Drive Export/Import tile class
            // anchors and the long-gone LOCAL anchors must not creep back
            // in via a future copy-paste.
            expect(main).not.toMatch(/settingsModalDataTile--driveExport/);
            expect(main).not.toMatch(/settingsModalDataTile--driveImport/);
            expect(main).not.toMatch(/settingsModalDataTile--localExport/);
            expect(main).not.toMatch(/settingsModalDataTile--localImport/);
        });

        it('the prior LAST DRIVE caption row is gone (folded into the Sync card sublabel)', () => {
            // The standalone "Last Drive: …" caption row + its
            // refreshDataCaption helper were removed when the timestamp
            // folded into the Sync card's sublabel. Pinning their
            // absence keeps a future rebuild from re-adding the dual
            // surface.
            expect(main).not.toMatch(/settingsModalDataCaption/);
            expect(main).not.toMatch(/function\s+refreshDataCaption/);
            expect(main).not.toMatch(/'Last Drive: '/);
        });
    });

    describe('state → verb mapping', () => {
        function extractFn(name) {
            const idx = main.indexOf('function ' + name);
            if (idx === -1) throw new Error(name + ' not found');
            const after = main.slice(idx);
            const bodyStart = after.indexOf('{');
            let depth = 0;
            for (let i = bodyStart; i < after.length; i++) {
                const c = after.charAt(i);
                if (c === '{') depth++;
                else if (c === '}') {
                    depth--;
                    if (depth === 0) return after.slice(0, i + 1);
                }
            }
            throw new Error('unbalanced braces in ' + name);
        }

        it('never state reads as "Connect" (call-to-action verb)', () => {
            const fn = extractFn('computeSettingsModalDriveSyncVerb');
            expect(fn).toMatch(/['"]Connect['"]/);
            expect(fn).toMatch(/state\s*===\s*['"]never['"]/);
        });

        it('in-flight states (syncing-push / syncing-pull) read as "Syncing…"', () => {
            const fn = extractFn('computeSettingsModalDriveSyncVerb');
            expect(fn).toMatch(/['"]Syncing…['"]/);
            expect(fn).toMatch(/['"]syncing-push['"]/);
            expect(fn).toMatch(/['"]syncing-pull['"]/);
        });

        it('default verb is "Sync" (used by synced / ahead / behind / diverged / failed)', () => {
            const fn = extractFn('computeSettingsModalDriveSyncVerb');
            expect(fn).toMatch(/return\s*['"]Sync['"]/);
        });
    });

    describe('state → sublabel mapping', () => {
        function extractFn(name) {
            const idx = main.indexOf('function ' + name);
            if (idx === -1) throw new Error(name + ' not found');
            const after = main.slice(idx);
            const bodyStart = after.indexOf('{');
            let depth = 0;
            for (let i = bodyStart; i < after.length; i++) {
                const c = after.charAt(i);
                if (c === '{') depth++;
                else if (c === '}') {
                    depth--;
                    if (depth === 0) return after.slice(0, i + 1);
                }
            }
            throw new Error('unbalanced braces in ' + name);
        }

        it('ahead state reads "Local has unsaved changes"', () => {
            const fn = extractFn('computeSettingsModalDriveSyncSubLabel');
            expect(fn).toMatch(/Local has unsaved changes/);
        });

        it('behind state reads "Drive is newer"', () => {
            const fn = extractFn('computeSettingsModalDriveSyncSubLabel');
            expect(fn).toMatch(/Drive is newer/);
        });

        it('diverged state reads "Conflict — tap to resolve"', () => {
            const fn = extractFn('computeSettingsModalDriveSyncSubLabel');
            expect(fn).toMatch(/Conflict — tap to resolve/);
        });

        it('failed state reads "Sync failed — tap to retry"', () => {
            const fn = extractFn('computeSettingsModalDriveSyncSubLabel');
            expect(fn).toMatch(/Sync failed — tap to retry/);
        });

        it('never state reads "Sign in to Drive"', () => {
            const fn = extractFn('computeSettingsModalDriveSyncSubLabel');
            expect(fn).toMatch(/Sign in to Drive/);
        });

        it('synced state folds the LAST DRIVE timestamp into the card via formatRelativeExportedAt', () => {
            const fn = extractFn('computeSettingsModalDriveSyncSubLabel');
            // The timestamp helper is the same one the desktop ghost menu
            // uses, so the wording stays consistent ("Synced just now",
            // "Synced 5 minutes ago").
            expect(fn).toMatch(/readLastDriveSyncedAt\s*\(\s*\)/);
            expect(fn).toMatch(/formatRelativeExportedAt\s*\(/);
        });
    });

    describe('click handler routes through onDriveSyncClick (the same dispatcher desktop uses)', () => {
        it('attaches a click listener that calls onDriveSyncClick(state) in the non-in-flight branch', () => {
            const idx = main.indexOf('function buildSettingsModalDriveSyncCard');
            const body = main.slice(idx, idx + 2400);
            expect(body).toMatch(
                /tile\.addEventListener\(\s*['"]click['"][\s\S]{0,200}onDriveSyncClick\(\s*state\s*\)/
            );
        });

        it('in-flight states (syncing-push / syncing-pull) disable the card and skip the click listener', () => {
            const idx = main.indexOf('function buildSettingsModalDriveSyncCard');
            const body = main.slice(idx, idx + 2400);
            expect(body).toMatch(/syncing-push/);
            expect(body).toMatch(/syncing-pull/);
            expect(body).toMatch(/tile\.disabled\s*=\s*true/);
            expect(body).toMatch(/if\s*\(\s*inFlight\s*\)/);
        });
    });

    describe('body.driveExportInProgress / driveImportInProgress dim the single Sync card', () => {
        it('CSS pivots on settingsModalDataTile--driveSync for the in-flight upload', () => {
            expect(css).toMatch(
                /body\.driveExportInProgress\s+\.settingsModalDataTile--driveSync\s*\{[^}]*pointer-events:\s*none/
            );
            expect(css).toMatch(
                /body\.driveExportInProgress\s+\.settingsModalDataTile--driveSync\s*\{[^}]*opacity:\s*0\.55/
            );
        });

        it('CSS pivots on settingsModalDataTile--driveSync for the in-flight download', () => {
            expect(css).toMatch(
                /body\.driveImportInProgress\s+\.settingsModalDataTile--driveSync\s*\{[^}]*pointer-events:\s*none/
            );
            expect(css).toMatch(
                /body\.driveImportInProgress\s+\.settingsModalDataTile--driveSync\s*\{[^}]*opacity:\s*0\.55/
            );
        });
    });

    describe('live re-rendering — driveSyncStateChanged + driveConnectionChanged', () => {
        it('declares a refreshSettingsModalSyncCard that swaps the card by id', () => {
            expect(main).toMatch(/function\s+refreshSettingsModalSyncCard\s*\(/);
            const idx = main.indexOf('function refreshSettingsModalSyncCard');
            const body = main.slice(idx, idx + 600);
            expect(body).toMatch(/getElementById\(\s*['"]settingsModalDriveSyncCard['"]/);
            expect(body).toMatch(/replaceChild\(\s*buildSettingsModalDriveSyncCard\(\s*\)/);
        });

        it('the modal subscribes to driveSyncStateChanged on mount and unsubscribes on close', () => {
            const slice = showSettingsModalSlice();
            expect(slice).toMatch(
                /addEventListener\(\s*['"]driveSyncStateChanged['"][\s\S]{0,200}onDriveSyncStateChangedForModal/
            );
            expect(slice).toMatch(
                /removeEventListener\(\s*['"]driveSyncStateChanged['"][\s\S]{0,200}onDriveSyncStateChangedForModal/
            );
        });

        it('the modal subscribes to driveConnectionChanged on mount and unsubscribes on close', () => {
            const slice = showSettingsModalSlice();
            expect(slice).toMatch(
                /addEventListener\(\s*['"]driveConnectionChanged['"][\s\S]{0,200}onDriveConnectionChangedForModal/
            );
            expect(slice).toMatch(
                /removeEventListener\(\s*['"]driveConnectionChanged['"][\s\S]{0,200}onDriveConnectionChangedForModal/
            );
        });

        it('paintAllSyncBadges also nudges the modal card so a desktop-style refreshDriveSyncState tick paints it', () => {
            // paintAllSyncBadges fires from the same setDriveSyncState
            // pipeline that drives the desktop ghost-icon overlay; it
            // should also drive the modal card so the user sees state
            // flips even before the CustomEvent fan-out lands.
            const paintIdx = main.indexOf('function paintAllSyncBadges');
            expect(paintIdx).toBeGreaterThan(-1);
            const body = main.slice(paintIdx, paintIdx + 1500);
            expect(body).toMatch(/refreshSettingsModalSyncCard/);
        });
    });

    describe('desktop ghost menu is untouched (scope guard)', () => {
        it('showSettingsMenu still mounts a DRIVE section heading and the single buildDriveSyncRow', () => {
            // The mobile consolidation must not regress the desktop
            // ghost menu — the DRIVE heading + single Sync row stay.
            expect(main).toMatch(/driveHeadingLabel\.textContent\s*=\s*['"]Drive['"]/);
            expect(main).toMatch(/menu\.appendChild\(\s*buildDriveSyncRow\(\s*\)\s*\)/);
            expect(main).not.toMatch(/localHeading\.textContent\s*=\s*['"]Local['"]/);
        });
    });
});
