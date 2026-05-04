// Pins the wiring for the last-exported footer label and the ghost-menu
// mirror. The actual relative-time formatter and the DOM refresh helper
// are covered in exportImport.test.js — these tests guard the handful of
// integration points in main.js so the label can't get silently unhooked.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

describe('last-exported timestamp — footer + menu wiring', () => {
    const main = read('main.js');
    const exportImport = read('exportImport.js');
    const css = read('style.css');

    it('imports the relative-label helper and the footer refresher in main.js', () => {
        expect(main).toMatch(/formatRelativeExportedAt/);
        expect(main).toMatch(/refreshFooterExportLabel/);
        expect(main).toMatch(/readLastExportedAt/);
    });

    it('creates a #footExport span inside #footCounts', () => {
        expect(main).toMatch(/footExport\.id\s*=\s*['"]footExport['"]/);
        expect(main).toMatch(/footCounts\.appendChild\(\s*footExport\s*\)/);
    });

    it('refreshes the footer label on first paint', () => {
        expect(main).toMatch(/setTimeout\(\s*refreshFooterExportLabel\s*,\s*0\s*\)/);
    });

    it('passes the relative label into the Export JSON menu item state pill', () => {
        // The second argument to buildSettingsMenuItem('Export JSON', …) is
        // the state pill text — it must be the formatted relative label,
        // not an empty string, so the user sees how stale the last manual
        // backup is at the moment they consider taking a new one.
        expect(main).toMatch(
            /buildSettingsMenuItem\(\s*['"]Export JSON['"]\s*,\s*formatRelativeExportedAt\(\s*readLastExportedAt\(\)\s*\)\s*,/
        );
    });

    it('exportTodosToFile updates the footer label after writing the timestamp', () => {
        // The refresh must happen in the same tick as the writeLastExportedAt
        // call so the OPEN/DONE neighbour updates without waiting for any
        // mutation observer to fire.
        expect(exportImport).toMatch(
            /writeLastExportedAt\([\s\S]*?\)\s*;\s*refreshStaleHint\(\)\s*;\s*refreshFooterExportLabel\(\)\s*;/
        );
    });

    it('styles #footExport with the muted-uppercase footer treatment', () => {
        const idx = css.indexOf('#footExport');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 400);
        expect(block).toMatch(/text-transform:\s*uppercase/);
        expect(block).toMatch(/color:\s*var\(--text-muted\)/);
    });
});
