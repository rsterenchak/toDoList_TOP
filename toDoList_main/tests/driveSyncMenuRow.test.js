// Tests for the single Drive Sync menu row that replaced the previous
// five DRIVE-section rows (Connect to Drive, Export, Import, Push to
// Drive overwrite, Pull from Drive overwrite). The row's label and
// click handler are derived from getCurrentSyncState — synced / ahead /
// behind / failed / diverged / never / syncing-push / syncing-pull —
// so the tests pin the state→label and state→action contracts that the
// menu reads off of.
//
// The menu is built inside the component() closure of main.js, so the
// assertions sit at the source level (matching the pattern used by
// the existing driveExport and driveSyncIndicator tests).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    getCurrentSyncState,
    armAutoSync,
    disarmAutoSync,
    _resetAutoSyncForTest,
} from '../src/driveAutoSync.js';
import {
    writeLastDriveSyncedAt,
    writeLastLocalMutationAt,
    LAST_DRIVE_SYNCED_AT_KEY,
    LAST_LOCAL_MUTATION_AT_KEY,
} from '../src/prefs.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }


describe('settings menu — Sync row anchor + presence', () => {
    const main = read('main.js');

    it('renders a single Sync row tagged with the settingsMenuItem--driveSync anchor class', () => {
        expect(main).toMatch(/settingsMenuItem--driveSync/);
    });

    it('the row carries the stable settingsMenuDriveSync id so the click handler can repaint in place', () => {
        expect(main).toMatch(/settingsMenuDriveSync/);
    });

    it('the menu appends exactly one Sync row via buildDriveSyncRow', () => {
        // The single buildDriveSyncRow() call replaces the prior five
        // separate appendChild calls in the DRIVE section.
        const matches = main.match(/menu\.appendChild\(\s*buildDriveSyncRow\s*\(\s*\)\s*\)/g) || [];
        expect(matches.length).toBe(1);
    });

    it('does not retain any of the five removed DRIVE menu row class anchors', () => {
        // The Sync row replaces Connect / Export / Import / Push-overwrite
        // / Pull-overwrite. None of those anchors should appear in main.js
        // after the collapse.
        expect(main).not.toMatch(/settingsMenuItem--driveConnect/);
        expect(main).not.toMatch(/settingsMenuItem--driveExport/);
        expect(main).not.toMatch(/settingsMenuItem--driveImport/);
        expect(main).not.toMatch(/settingsMenuItem--driveResolvePush/);
        expect(main).not.toMatch(/settingsMenuItem--driveResolvePull/);
    });
});


describe('settings menu — Sync row state→label mapping', () => {
    const main = read('main.js');

    function extractFn(name) {
        const idx = main.indexOf('function ' + name);
        if (idx === -1) throw new Error(name + ' not found');
        const after = main.slice(idx);
        // Match the function body to its closing brace by depth-counting.
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

    it('declares a state→label helper that maps each named state', () => {
        const fn = extractFn('computeDriveSyncLabel');
        // Every state in the spec table appears as a literal string match
        // somewhere in the function body.
        expect(fn).toMatch(/'syncing-push'/);
        expect(fn).toMatch(/'syncing-pull'/);
        expect(fn).toMatch(/'synced'/);
        expect(fn).toMatch(/'ahead'/);
        expect(fn).toMatch(/'behind'/);
        expect(fn).toMatch(/'diverged'/);
        expect(fn).toMatch(/'failed'/);
    });

    it('synced state surfaces "Sync • synced just now" (or relative time)', () => {
        const fn = extractFn('computeDriveSyncLabel');
        expect(fn).toMatch(/Sync\s*•\s*synced just now/);
        // The non-just-now branch derives a "Sync • N minutes ago" label
        // from formatRelativeExportedAt by dropping the "Synced" prefix.
        expect(fn).toMatch(/formatRelativeExportedAt/);
        expect(fn).toMatch(/replace\(\/\^Synced/);
    });

    it('ahead state reads "Sync • local has unsaved changes"', () => {
        const fn = extractFn('computeDriveSyncLabel');
        expect(fn).toMatch(/Sync\s*•\s*local has unsaved changes/);
    });

    it('behind state reads "Sync • Drive is newer"', () => {
        const fn = extractFn('computeDriveSyncLabel');
        expect(fn).toMatch(/Sync\s*•\s*Drive is newer/);
    });

    it('diverged state reads "Sync • conflict — tap to resolve"', () => {
        const fn = extractFn('computeDriveSyncLabel');
        expect(fn).toMatch(/Sync\s*•\s*conflict — tap to resolve/);
    });

    it('failed state reads "Sync • failed — tap to retry"', () => {
        const fn = extractFn('computeDriveSyncLabel');
        expect(fn).toMatch(/Sync\s*•\s*failed — tap to retry/);
    });

    it('never state reads "Sync • not connected"', () => {
        const fn = extractFn('computeDriveSyncLabel');
        expect(fn).toMatch(/Sync\s*•\s*not connected/);
    });

    it('reauth-required state reads "Sync • sign in again"', () => {
        // Distinct from 'never' (true first-run, no local history) and
        // 'failed' (mid-flight sync error) — surfaced when the user has
        // synced before but the in-memory token is gone (expired Google
        // session, revoked grant, blocked third-party cookies).
        const fn = extractFn('computeDriveSyncLabel');
        expect(fn).toMatch(/Sync\s*•\s*sign in again/);
    });

    it('in-flight states (syncing-push / syncing-pull) read "Sync • syncing…"', () => {
        const fn = extractFn('computeDriveSyncLabel');
        expect(fn).toMatch(/Sync\s*•\s*syncing…/);
    });
});


describe('settings menu — Sync row state→action mapping', () => {
    const main = read('main.js');

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

    it('synced / ahead / behind route through performAutoSync (the auto-sync orchestrator picks the direction)', () => {
        const fn = extractFn('onDriveSyncClick');
        // synced/ahead/behind all fall through to the trailing
        // performAutoSync call — no per-state branches branch off first.
        expect(fn).toMatch(/performAutoSync\s*\(\s*\)/);
    });

    it('diverged opens the conflict popover (not the auto-sync entry)', () => {
        const fn = extractFn('onDriveSyncClick');
        const divergedIdx = fn.indexOf("'diverged'");
        expect(divergedIdx).toBeGreaterThan(-1);
        // The diverged branch calls openDriveConflictPopover and returns
        // before falling through to performAutoSync.
        const branchSlice = fn.slice(divergedIdx, divergedIdx + 300);
        expect(branchSlice).toMatch(/openDriveConflictPopover\s*\(\s*\)/);
    });

    it('failed re-arms the loop before re-running performAutoSync', () => {
        const fn = extractFn('onDriveSyncClick');
        const failedIdx = fn.indexOf("'failed'");
        expect(failedIdx).toBeGreaterThan(-1);
        const slice = fn.slice(failedIdx, failedIdx + 300);
        // armAutoSync resets failed → idle so the next performAutoSync
        // passes the armed gate inside the orchestrator.
        const armIdx     = slice.indexOf('armAutoSync()');
        const performIdx = slice.indexOf('performAutoSync()');
        expect(armIdx).toBeGreaterThan(-1);
        expect(performIdx).toBeGreaterThan(armIdx);
    });

    it('never runs OAuth, then arms the loop, then triggers an immediate sync', () => {
        const fn = extractFn('onDriveSyncClick');
        const neverIdx = fn.indexOf("'never'");
        expect(neverIdx).toBeGreaterThan(-1);
        const slice = fn.slice(neverIdx, neverIdx + 1500);
        // Replicates the previous Connect handler's success contract:
        // getAccessToken → armAutoSync → performAutoSync.
        const tokenIdx   = slice.indexOf('getAccessToken(');
        const armIdx     = slice.indexOf('armAutoSync()');
        const performIdx = slice.indexOf('performAutoSync()');
        expect(tokenIdx).toBeGreaterThan(-1);
        expect(armIdx).toBeGreaterThan(tokenIdx);
        expect(performIdx).toBeGreaterThan(armIdx);
    });

    it('reauth-required mirrors the never branch — getAccessToken → armAutoSync → performAutoSync', () => {
        // The bug: a returning user whose silent re-auth failed reads as
        // 'synced'/'ahead' (cached prior session) but clicking the Sync row
        // dead-ends inside performAutoSync's no-token gate with no UI
        // feedback. Fix routes the click through the OAuth popup just like
        // the first-time-connect ('never') branch does.
        const fn = extractFn('onDriveSyncClick');
        const reauthIdx = fn.indexOf("'reauth-required'");
        expect(reauthIdx).toBeGreaterThan(-1);
        // The branch may be expressed as `'never' || 'reauth-required'` so
        // we slice from the literal forward — the helper trio must appear
        // somewhere in the same branch body.
        const slice = fn.slice(reauthIdx, reauthIdx + 1500);
        const tokenIdx   = slice.indexOf('getAccessToken(');
        const armIdx     = slice.indexOf('armAutoSync()');
        const performIdx = slice.indexOf('performAutoSync()');
        expect(tokenIdx).toBeGreaterThan(-1);
        expect(armIdx).toBeGreaterThan(tokenIdx);
        expect(performIdx).toBeGreaterThan(armIdx);
    });

    it('in-flight states early-return — no auto-sync or popover side effect', () => {
        const fn = extractFn('onDriveSyncClick');
        // The function's first guard catches the two in-flight states
        // and returns before any side-effecting branch.
        const guardIdx = fn.indexOf("'syncing-push'");
        expect(guardIdx).toBeGreaterThan(-1);
        const guardSlice = fn.slice(guardIdx, guardIdx + 80);
        expect(guardSlice).toMatch(/return\s*;/);
    });
});


describe('settings menu — Sync row in-flight wiring', () => {
    const main = read('main.js');
    const css = read('style.css');

    it('disables the row when state is syncing-push or syncing-pull', () => {
        const fnIdx = main.indexOf('function buildDriveSyncRow');
        expect(fnIdx).toBeGreaterThan(-1);
        const after = main.slice(fnIdx);
        const nextFnIdx = after.indexOf('function ', 1);
        const body = after.slice(0, nextFnIdx > -1 ? nextFnIdx : after.length);
        expect(body).toMatch(/syncing-push/);
        expect(body).toMatch(/syncing-pull/);
        expect(body).toMatch(/disabled\s*=\s*true/);
        // The click listener only attaches in the non-in-flight branch.
        expect(body).toMatch(/if\s*\(\s*inFlight\s*\)/);
    });

    it('CSS dims the Sync row while driveExportInProgress / driveImportInProgress is on body', () => {
        // The existing body-class hooks dim the new Sync row using the
        // single anchor class — the visible signal that a sync is in
        // flight, equivalent to the previous per-row dim rules.
        expect(css).toMatch(
            /body\.driveExportInProgress\s+\.settingsMenuItem--driveSync[\s\S]{0,200}pointer-events:\s*none/
        );
        expect(css).toMatch(
            /body\.driveImportInProgress\s+\.settingsMenuItem--driveSync[\s\S]{0,200}pointer-events:\s*none/
        );
    });
});


describe('settings menu — diverged conflict popover', () => {
    const main = read('main.js');
    const css = read('style.css');

    // Brace-balanced extractor — needed because the popover body contains
    // inner function declarations (close, onKeydown). A naive
    // indexOf('function ') after the opener would truncate the body early.
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

    it('declares an openDriveConflictPopover function reachable from onDriveSyncClick', () => {
        expect(main).toMatch(/function\s+openDriveConflictPopover\s*\(/);
    });

    it('the popover renders both overwrite-warning buttons (push / pull)', () => {
        const body = extractFn('openDriveConflictPopover');
        expect(body).toMatch(/Push to Drive \(overwrite Drive copy\)/);
        expect(body).toMatch(/Pull from Drive \(overwrite local\)/);
        expect(body).toMatch(/exportTodosToDrive\s*\(\s*\)/);
        expect(body).toMatch(/importTodosFromDrive\s*\(/);
    });

    it('dismissal follows the 3-way pattern: close button, backdrop click, Escape', () => {
        const body = extractFn('openDriveConflictPopover');
        // Explicit close button wired up.
        expect(body).toMatch(/closeX\.addEventListener\s*\(\s*['"]click['"]/);
        // Backdrop click closes (only when event.target IS the backdrop).
        expect(body).toMatch(/backdrop\.addEventListener\s*\(\s*['"]click['"]/);
        expect(body).toMatch(/event\.target\s*===\s*backdrop/);
        // Escape closes via document-level keydown.
        expect(body).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
    });

    it('CSS styles the popover surface and the destructive overwrite buttons', () => {
        expect(css).toMatch(/#driveConflictBackdrop\s*\{/);
        expect(css).toMatch(/#driveConflictPopover\s*\{/);
        expect(css).toMatch(/\.driveConflictAction\s*\{/);
    });
});


describe('driveAutoSync — getCurrentSyncState resolver', () => {
    // The Sync row reads the resolved state from this helper. The cases
    // below pin the precedence rules and inputs the menu relies on.

    afterEach(() => {
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
        try { localStorage.removeItem(LAST_LOCAL_MUTATION_AT_KEY); } catch (_) {}
        if (document && document.body && document.body.classList) {
            document.body.classList.remove('driveExportInProgress');
            document.body.classList.remove('driveImportInProgress');
        }
        _resetAutoSyncForTest();
    });

    it('in-flight body classes take precedence over everything else', () => {
        writeLastDriveSyncedAt('2026-05-22T10:00:00.000Z');
        document.body.classList.add('driveExportInProgress');
        expect(getCurrentSyncState({ hasToken: true })).toBe('syncing-push');
        document.body.classList.remove('driveExportInProgress');
        document.body.classList.add('driveImportInProgress');
        expect(getCurrentSyncState({ hasToken: true })).toBe('syncing-pull');
    });

    it('module-resident failed / diverged state wins over timestamps', () => {
        writeLastDriveSyncedAt('2026-05-22T10:00:00.000Z');
        disarmAutoSync('failed', 'boom');
        expect(getCurrentSyncState({ hasToken: true })).toBe('failed');
        _resetAutoSyncForTest();
        disarmAutoSync('diverged');
        expect(getCurrentSyncState({ hasToken: true })).toBe('diverged');
    });

    it('no cached token and no prior sync → never', () => {
        expect(getCurrentSyncState({ hasToken: false })).toBe('never');
    });

    it('no cached token but a prior sync marker exists → reauth-required', () => {
        // The new fourth bucket distinguishes "had a session before,
        // doesn't now" from "true first-run" so the click handler can
        // route through the OAuth popup instead of dead-ending in
        // performAutoSync's no-token gate.
        writeLastDriveSyncedAt('2026-05-22T10:00:00.000Z');
        expect(getCurrentSyncState({ hasToken: false })).toBe('reauth-required');
    });

    it('reauth-required takes precedence over the localAhead branch when token is missing', () => {
        // Pin the precedence: a user with local edits queued up but no
        // token still reads as 'reauth-required' (not 'ahead'), because
        // the recovery action they need is sign-in, not a sync attempt
        // that would silently no-token-out.
        writeLastDriveSyncedAt('2026-05-22T10:00:00.000Z');
        writeLastLocalMutationAt('2026-05-22T11:00:00.000Z');
        expect(getCurrentSyncState({ hasToken: false })).toBe('reauth-required');
    });

    it('local mutation after the last sync → ahead', () => {
        writeLastDriveSyncedAt('2026-05-22T10:00:00.000Z');
        writeLastLocalMutationAt('2026-05-22T11:00:00.000Z');
        expect(getCurrentSyncState({ hasToken: true })).toBe('ahead');
    });

    it('Drive modifiedTime newer than the last sync → behind', () => {
        writeLastDriveSyncedAt('2026-05-22T10:00:00.000Z');
        expect(getCurrentSyncState({
            driveModifiedIso: '2026-05-22T11:00:00.000Z',
            hasToken: true,
        })).toBe('behind');
    });

    it('both local mutation AND Drive newer → diverged', () => {
        writeLastDriveSyncedAt('2026-05-22T10:00:00.000Z');
        writeLastLocalMutationAt('2026-05-22T11:00:00.000Z');
        expect(getCurrentSyncState({
            driveModifiedIso: '2026-05-22T11:30:00.000Z',
            hasToken: true,
        })).toBe('diverged');
    });

    it('synced timestamp with no drift in either direction → synced', () => {
        writeLastDriveSyncedAt('2026-05-22T10:00:00.000Z');
        // No local mutation after the sync; Drive modifiedTime matches.
        expect(getCurrentSyncState({
            driveModifiedIso: '2026-05-22T10:00:00.000Z',
            hasToken: true,
        })).toBe('synced');
    });
});


describe('main.js — boot-time silent re-auth wiring (preserved)', () => {
    const main = read('main.js');

    it('boot sequence still calls autoSyncOnAppLoad before refreshDriveSyncState', () => {
        const autoSyncIdx = main.indexOf('autoSyncOnAppLoad()');
        expect(autoSyncIdx).toBeGreaterThan(-1);
        const bootSlice = main.slice(autoSyncIdx, autoSyncIdx + 600);
        expect(bootSlice).toMatch(/refreshDriveSyncState\s*\(\s*\)/);
    });
});
