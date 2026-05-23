// Lint-style static scan: the LOCAL JSON export / import path was removed
// in an earlier PR, but its helper functions were called from several
// sites that survived the cull. The first time anyone ran Drive import on
// a build after the removal, `rebuildAfterImport` threw a ReferenceError
// on `refreshStaleHint`, which stranded the post-import sync marker and
// left the Drive sync indicator stuck on amber forever.
//
// To prevent the same class of regression, this file scans the source
// files that wire Drive sync (main.js, exportImport.js, driveExport.js)
// and fails CI if any of the removed-LOCAL helper names appear there. A
// future contributor reaching for these helpers will see this test fail
// before the bug ships.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }

const GHOST_HELPERS = [
    'refreshStaleHint',
    'refreshFooterExportLabel',
    'readLastExportedAt',
    'writeLastExportedAt',
];

const SCANNED_FILES = ['main.js', 'exportImport.js', 'driveExport.js'];


describe('removed LOCAL helpers — static scan', () => {

    SCANNED_FILES.forEach(function(filename) {
        describe(filename, () => {
            const src = read(filename);
            GHOST_HELPERS.forEach(function(name) {
                it('does not reference the removed LOCAL helper "' + name + '"', () => {
                    expect(src).not.toMatch(new RegExp('\\b' + name + '\\b'));
                });
            });
        });
    });
});


// The single Drive Sync row replaced the previous five-row block. The
// five removed extraClass anchors must not appear anywhere in main.js
// or style.css — a stray reference would mean a stale row builder or
// CSS rule survived the collapse and a future contributor could rewire
// it back into the menu by accident.
const REMOVED_MENU_ROW_ANCHORS = [
    'settingsMenuItem--driveConnect',
    'settingsMenuItem--driveExport',
    'settingsMenuItem--driveImport',
    'settingsMenuItem--driveResolvePush',
    'settingsMenuItem--driveResolvePull',
];

describe('removed DRIVE menu row anchors — static scan', () => {
    ['main.js', 'style.css'].forEach(function(filename) {
        describe(filename, () => {
            const src = read(filename);
            REMOVED_MENU_ROW_ANCHORS.forEach(function(name) {
                it('does not reference the removed anchor "' + name + '"', () => {
                    expect(src).not.toMatch(new RegExp(name));
                });
            });
        });
    });
});
