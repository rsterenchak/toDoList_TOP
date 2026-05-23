// The Sync row's label must stay live while the menu is open — when the
// state changes (e.g. an auto-sync attempt completes and the row's label
// should flip from "Sync • syncing…" to "Sync • synced just now"), the
// menu-builder's `driveSyncStateChanged` listener has to rebuild the row
// in place without closing the popover.
//
// These tests sit at the source level — the menu DOM lives inside the
// component() closure of main.js, so the harness pins the wiring shape
// rather than spinning up the full app.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }


describe('settings menu — Sync row live updates', () => {
    const main = read('main.js');

    it('declares a driveMenuRowNeedsRefresh helper that swaps the Sync row in place', () => {
        expect(main).toMatch(/function\s+driveMenuRowNeedsRefresh\s*\(/);
        // The helper finds the existing row by its stable id and replaces
        // it with a fresh buildDriveSyncRow() output — that's the "in
        // place" semantics the spec calls for.
        const fnIdx = main.indexOf('function driveMenuRowNeedsRefresh');
        expect(fnIdx).toBeGreaterThan(-1);
        const after = main.slice(fnIdx);
        const nextFnIdx = after.indexOf('function ', 1);
        const body = after.slice(0, nextFnIdx > -1 ? nextFnIdx : after.length);
        expect(body).toMatch(/getElementById\(\s*['"]settingsMenuDriveSync['"]\s*\)/);
        expect(body).toMatch(/replaceChild\s*\(\s*buildDriveSyncRow\s*\(\s*\)/);
    });

    it('driveSyncStateChanged listener calls driveMenuRowNeedsRefresh', () => {
        // The same CustomEvent the indicator listens for must also retarget
        // the menu row so the open menu reflects the latest state mid-sync.
        const listenerIdx = main.indexOf("'driveSyncStateChanged'");
        expect(listenerIdx).toBeGreaterThan(-1);
        // Scan ALL driveSyncStateChanged listener registrations and confirm
        // at least one calls driveMenuRowNeedsRefresh.
        let foundRefreshHook = false;
        let from = 0;
        while (true) {
            const next = main.indexOf("'driveSyncStateChanged'", from);
            if (next === -1) break;
            const slice = main.slice(next, next + 400);
            if (/driveMenuRowNeedsRefresh\s*\(\s*\)/.test(slice)) {
                foundRefreshHook = true;
                break;
            }
            from = next + 1;
        }
        expect(foundRefreshHook).toBe(true);
    });

    it('autoSyncStateChanged listener also calls driveMenuRowNeedsRefresh', () => {
        // Replaces the previous repaintConnectRow hook so the failure /
        // diverged / success states flip the row's label in place.
        const listenerIdx = main.indexOf("'autoSyncStateChanged'");
        expect(listenerIdx).toBeGreaterThan(-1);
        const slice = main.slice(listenerIdx, listenerIdx + 400);
        expect(slice).toMatch(/driveMenuRowNeedsRefresh\s*\(\s*\)/);
    });

    it('driveManualActionSuccess listener also calls driveMenuRowNeedsRefresh', () => {
        const listenerIdx = main.indexOf("'driveManualActionSuccess'");
        expect(listenerIdx).toBeGreaterThan(-1);
        const slice = main.slice(listenerIdx, listenerIdx + 400);
        expect(slice).toMatch(/driveMenuRowNeedsRefresh\s*\(\s*\)/);
    });

    it('driveConnectionChanged listener also calls driveMenuRowNeedsRefresh', () => {
        const listenerIdx = main.indexOf("'driveConnectionChanged'");
        expect(listenerIdx).toBeGreaterThan(-1);
        const slice = main.slice(listenerIdx, listenerIdx + 400);
        expect(slice).toMatch(/driveMenuRowNeedsRefresh\s*\(\s*\)/);
    });

    it('the previous repaintConnectRow helper is gone', () => {
        // The Connect row helpers and their event-listener hooks were
        // replaced by the single buildDriveSyncRow / driveMenuRowNeedsRefresh
        // pair. Any surviving reference would mean a stale code path is
        // still wired in.
        expect(main).not.toMatch(/\brepaintConnectRow\b/);
        expect(main).not.toMatch(/\bbuildConnectToDriveRow\b/);
        expect(main).not.toMatch(/\bcomputeConnectRowState\b/);
        expect(main).not.toMatch(/\bonConnectToDriveClick\b/);
    });
});
