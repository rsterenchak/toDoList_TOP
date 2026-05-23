// Tests for the "Connect to Drive" menu row — a dedicated auth-only
// entry point in the DRIVE section of the ghost popover menu. The row
// sits ABOVE the existing Export and Import rows and establishes the
// OAuth grant without performing any data transfer. After a successful
// click it flips to a dimmed, non-clickable status row labeled
// "Signed in — auto-sync on".
//
// The menu is built inside the component() closure of main.js, so the
// tests pin behavior at the source level (matches the pattern used by
// the existing driveExport and driveSyncIndicator tests).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }


describe('settings menu — Connect to Drive row position', () => {
    const main = read('main.js');

    it('renders a Connect to Drive row tagged with the settingsMenuItem--driveConnect anchor class', () => {
        expect(main).toMatch(/settingsMenuItem--driveConnect/);
    });

    it('the Connect to Drive row is appended to the menu BEFORE the Drive Export row', () => {
        // The append order in showSettingsMenu drives the visual row
        // order in the menu. The Connect row's appendChild must come
        // before the Export row's appendChild.
        const connectAppend = main.indexOf('buildConnectToDriveRow()');
        const exportAppend  = main.indexOf("'settingsMenuItem--driveExport'");
        expect(connectAppend).toBeGreaterThan(-1);
        expect(exportAppend).toBeGreaterThan(-1);
        expect(connectAppend).toBeLessThan(exportAppend);
    });

    it('the Connect to Drive row is appended to the menu BEFORE the Drive Import row', () => {
        const connectAppend = main.indexOf('buildConnectToDriveRow()');
        const importAppend  = main.indexOf("'settingsMenuItem--driveImport'");
        expect(connectAppend).toBeGreaterThan(-1);
        expect(importAppend).toBeGreaterThan(-1);
        expect(connectAppend).toBeLessThan(importAppend);
    });

    it('the row carries the stable settingsMenuConnectToDrive id so the click handler can repaint in place', () => {
        expect(main).toMatch(/settingsMenuConnectToDrive/);
    });
});


describe('settings menu — Connect to Drive row labels', () => {
    const main = read('main.js');

    it('uses the "Connect to Drive" label for the not-yet-signed-in state', () => {
        expect(main).toMatch(/['"]Connect to Drive['"]/);
    });

    it('uses the "Reconnect to Drive" label for the failed / token-expired state', () => {
        expect(main).toMatch(/['"]Reconnect to Drive['"]/);
    });

    it('uses the "Signed in — auto-sync on" label for the signed-in status row', () => {
        expect(main).toMatch(/Signed in — auto-sync on/);
    });
});


describe('settings menu — Connect click handler is auth-only', () => {
    const main = read('main.js');

    it('imports getAccessToken from the shared driveAuth module', () => {
        expect(main).toMatch(
            /import\s*\{[^}]*\bgetAccessToken\b[^}]*\}\s*from\s*['"]\.\/driveAuth\.js['"]/
        );
    });

    it('the Connect click handler invokes getAccessToken() (interactive — no silent opts)', () => {
        // Find the onConnectToDriveClick function body and pin that it
        // calls getAccessToken() without the { silent: true } flag.
        const handlerIdx = main.indexOf('function onConnectToDriveClick');
        expect(handlerIdx).toBeGreaterThan(-1);
        // Slice from the handler start to a generous endpoint covering
        // the body. The body ends before the next `function ` keyword.
        const after = main.slice(handlerIdx);
        const nextFnIdx = after.indexOf('function ', 1);
        const body = after.slice(0, nextFnIdx > -1 ? nextFnIdx : after.length);
        // Interactive variant — no silent opts argument.
        expect(body).toMatch(/getAccessToken\s*\(\s*\)/);
        // Must NOT call { silent: true } from the Connect click — that's
        // the boot-time path, not the manual click.
        expect(body).not.toMatch(/getAccessToken\s*\(\s*\{\s*silent/);
    });

    it('the Connect click handler does NOT call exportTodosToDrive or importTodosFromDrive', () => {
        const handlerIdx = main.indexOf('function onConnectToDriveClick');
        expect(handlerIdx).toBeGreaterThan(-1);
        const after = main.slice(handlerIdx);
        const nextFnIdx = after.indexOf('function ', 1);
        const body = after.slice(0, nextFnIdx > -1 ? nextFnIdx : after.length);
        expect(body).not.toMatch(/exportTodosToDrive\s*\(/);
        expect(body).not.toMatch(/importTodosFromDrive\s*\(/);
        // No mutation paths either — no replaceAllProjects, no
        // saveToStorage, no lastLocalMutationAt write.
        expect(body).not.toMatch(/replaceAllProjects\s*\(/);
        expect(body).not.toMatch(/saveToStorage\s*\(/);
        expect(body).not.toMatch(/writeLastLocalMutationAt\s*\(/);
    });

    it('on success the Connect handler arms the loop directly via armAutoSync() and triggers an immediate sync attempt', () => {
        // Connect is auth-only — calling armAutoSync()/performAutoSync()
        // directly (rather than going through driveManualActionSuccess)
        // keeps the success contract explicit. The order in source is
        // armAutoSync → performAutoSync → dispatch driveConnectionChanged.
        const handlerIdx = main.indexOf('function onConnectToDriveClick');
        const after = main.slice(handlerIdx);
        const nextFnIdx = after.indexOf('function ', 1);
        const body = after.slice(0, nextFnIdx > -1 ? nextFnIdx : after.length);
        expect(body).toMatch(/armAutoSync\s*\(\s*\)/);
        expect(body).toMatch(/performAutoSync\s*\(\s*\)/);
        const armIdx        = body.indexOf('armAutoSync()');
        const performIdx    = body.indexOf('performAutoSync()');
        const dispatchIdx   = body.indexOf("'driveConnectionChanged'");
        expect(armIdx).toBeGreaterThan(-1);
        expect(performIdx).toBeGreaterThan(-1);
        expect(dispatchIdx).toBeGreaterThan(-1);
        // Order: arm → perform → dispatch.
        expect(armIdx).toBeLessThan(performIdx);
        expect(performIdx).toBeLessThan(dispatchIdx);
    });

    it('on rejection the Connect handler shows an error toast and does NOT arm or sync', () => {
        const handlerIdx = main.indexOf('function onConnectToDriveClick');
        const after = main.slice(handlerIdx);
        const nextFnIdx = after.indexOf('function ', 1);
        const body = after.slice(0, nextFnIdx > -1 ? nextFnIdx : after.length);
        // Find the .catch branch body — the rejection path.
        const catchIdx = body.indexOf('.catch(');
        expect(catchIdx).toBeGreaterThan(-1);
        // Strip line + block comments so the regex below can't match the
        // function names mentioned in the explanatory comment.
        const catchBody = body.slice(catchIdx)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        expect(catchBody).toMatch(/showDriveToast\s*\(\s*\{[^}]*error\s*:\s*true/);
        // The rejection branch must NOT arm the loop or fire a sync —
        // both would defeat the "leave the row in Connect state so the
        // user can retry" contract.
        expect(catchBody).not.toMatch(/armAutoSync\s*\(/);
        expect(catchBody).not.toMatch(/performAutoSync\s*\(/);
    });

    it('on success the row is re-painted in place (no menu reopen required)', () => {
        const handlerIdx = main.indexOf('function onConnectToDriveClick');
        const after = main.slice(handlerIdx);
        const nextFnIdx = after.indexOf('function ', 1);
        const body = after.slice(0, nextFnIdx > -1 ? nextFnIdx : after.length);
        expect(body).toMatch(/repaintConnectRow\s*\(\s*\)/);
    });
});


describe('settings menu — Connect row signed-in status row', () => {
    const main = read('main.js');
    const css = read('style.css');

    it('the row is marked disabled / non-clickable when signed in', () => {
        // Source-level: the build function flips disabled = true and
        // applies the --signedIn modifier class when computeConnectRowState
        // reports non-clickable.
        expect(main).toMatch(/settingsMenuItem--driveConnect--signedIn/);
        const buildIdx = main.indexOf('function buildConnectToDriveRow');
        expect(buildIdx).toBeGreaterThan(-1);
        const after = main.slice(buildIdx);
        const nextFnIdx = after.indexOf('function ', 1);
        const body = after.slice(0, nextFnIdx > -1 ? nextFnIdx : after.length);
        expect(body).toMatch(/disabled\s*=\s*true/);
        // No click handler is wired when the row is non-clickable —
        // addEventListener only fires inside a clickable branch.
        expect(body).toMatch(/if\s*\(\s*state\.clickable\s*\)/);
    });

    it('CSS dims the signed-in row and disables pointer events', () => {
        expect(css).toMatch(/\.settingsMenuItem--driveConnect--signedIn/);
        // The dimmed status row must block pointer events so a stale
        // click target doesn't surprise-fire the OAuth popup.
        const startIdx = css.indexOf('.settingsMenuItem--driveConnect--signedIn');
        const block = css.slice(startIdx, startIdx + 300);
        expect(block).toMatch(/pointer-events\s*:\s*none/);
    });
});


describe('settings menu — Connect row computeConnectRowState', () => {
    const main = read('main.js');

    it('signed in & armed → "Signed in — auto-sync on", non-clickable', () => {
        const startIdx = main.indexOf('function computeConnectRowState');
        expect(startIdx).toBeGreaterThan(-1);
        const after = main.slice(startIdx);
        const nextFnIdx = after.indexOf('function ', 1);
        const body = after.slice(0, nextFnIdx > -1 ? nextFnIdx : after.length);
        // The signed-in branch reads both hasToken AND armed and sets
        // clickable: false alongside the signed-in label.
        expect(body).toMatch(/getCachedAccessToken/);
        expect(body).toMatch(/isAutoSyncArmed/);
        expect(body).toMatch(/clickable\s*:\s*false/);
    });

    it('failed state OR (armed but no token) → "Reconnect to Drive"', () => {
        const startIdx = main.indexOf('function computeConnectRowState');
        const after = main.slice(startIdx);
        const nextFnIdx = after.indexOf('function ', 1);
        const body = after.slice(0, nextFnIdx > -1 ? nextFnIdx : after.length);
        expect(body).toMatch(/getAutoSyncState/);
        expect(body).toMatch(/Reconnect to Drive/);
    });
});


describe('settings menu — Connect row reactive repaint', () => {
    const main = read('main.js');

    it('autoSyncStateChanged listener repaints the Connect row alongside the badge', () => {
        // A mid-session state flip (success → failed) needs to update
        // the row from "Signed in — auto-sync on" to "Reconnect to
        // Drive" while the menu is still open.
        const listenerIdx = main.indexOf("'autoSyncStateChanged'");
        expect(listenerIdx).toBeGreaterThan(-1);
        const slice = main.slice(listenerIdx, listenerIdx + 400);
        expect(slice).toMatch(/repaintConnectRow\s*\(\s*\)/);
    });

    it('driveManualActionSuccess listener repaints the Connect row after a successful manual action', () => {
        // Manual Export / Import also flip the row to the signed-in
        // status row when they arm the loop.
        const listenerIdx = main.indexOf("'driveManualActionSuccess'");
        expect(listenerIdx).toBeGreaterThan(-1);
        const slice = main.slice(listenerIdx, listenerIdx + 400);
        expect(slice).toMatch(/repaintConnectRow\s*\(\s*\)/);
    });

    it('driveConnectionChanged listener repaints the Connect row after a successful Connect click', () => {
        // The Connect handler dispatches driveConnectionChanged on success;
        // the menu-row builder listens and swaps the row's label and class
        // in place without a menu reopen.
        const listenerIdx = main.indexOf("'driveConnectionChanged'");
        expect(listenerIdx).toBeGreaterThan(-1);
        const slice = main.slice(listenerIdx, listenerIdx + 400);
        expect(slice).toMatch(/repaintConnectRow\s*\(\s*\)/);
    });
});


describe('main.js — boot-time silent re-auth wiring', () => {
    const main = read('main.js');

    it('boot sequence calls autoSyncOnAppLoad BEFORE refreshDriveSyncState so the cached token populates the indicator', () => {
        // autoSyncOnAppLoad attempts silent re-auth and caches the
        // token; refreshDriveSyncState then reads getCachedAccessToken
        // and proceeds to the Drive query. Both must run, in that
        // order, at boot.
        const autoSyncIdx = main.indexOf('autoSyncOnAppLoad()');
        expect(autoSyncIdx).toBeGreaterThan(-1);
        // The boot section calls refreshDriveSyncState from inside the
        // autoSyncOnAppLoad().then() callback, so the source order is
        // autoSyncOnAppLoad → refreshDriveSyncState.
        const bootSlice = main.slice(autoSyncIdx, autoSyncIdx + 600);
        expect(bootSlice).toMatch(/refreshDriveSyncState\s*\(\s*\)/);
    });

    it('Export and Import rows continue to be wired (additive — no regression)', () => {
        // Acceptance criterion (6): Export and Import continue to work
        // standalone — the new Connect row is additive.
        expect(main).toMatch(/settingsMenuItem--driveExport/);
        expect(main).toMatch(/settingsMenuItem--driveImport/);
        expect(main).toMatch(/exportTodosToDrive\s*\(\s*\)/);
        expect(main).toMatch(/importTodosFromDrive\s*\(/);
    });
});
