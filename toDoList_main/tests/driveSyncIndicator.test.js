// Tests for the Drive sync-state indicator that overlays the ghost icon
// in the header and the matching badge next to the DRIVE section header
// inside the popover menu. Both surfaces share one state machine driven
// by comparing the local lastDriveSyncedAt timestamp against the
// latest Drive file's modifiedTime. State values: 'synced', 'behind',
// 'never', 'unknown'.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}


describe('Drive sync indicator — source-level wiring in main.js', () => {
    const main = read('main.js');

    it('imports queryLatestDriveFile from the driveImport module', () => {
        expect(main).toMatch(
            /import\s*\{[^}]*\bqueryLatestDriveFile\b[^}]*\}\s*from\s*['"]\.\/driveImport\.js['"]/
        );
    });

    it('imports getCachedAccessToken from the driveAuth module (non-prompting token read)', () => {
        expect(main).toMatch(
            /import\s*\{[^}]*\bgetCachedAccessToken\b[^}]*\}\s*from\s*['"]\.\/driveAuth\.js['"]/
        );
    });

    it('creates the sync-state badge overlay on the ghost icon', () => {
        // The badge is a sibling <span> inside #settingsToggle so CSS can
        // position it absolutely in the bottom-right corner without
        // rewriting the SVG glyph.
        expect(main).toMatch(/settingsToggleSyncBadge\.className\s*=\s*['"]settingsToggleSyncBadge['"]/);
        expect(main).toMatch(/settingsToggle\.appendChild\(\s*settingsToggleSyncBadge\s*\)/);
    });

    it('defines a computeDriveSyncState helper that returns one of the four bucket values', () => {
        // Source-level shape pin: a function named computeDriveSyncState
        // that branches on the timestamps and resolves to 'synced',
        // 'behind', 'never', or 'unknown'.
        expect(main).toMatch(/function\s+computeDriveSyncState\s*\(/);
        const idx = main.indexOf('function computeDriveSyncState');
        const fn = main.slice(idx, idx + 2000);
        expect(fn).toMatch(/['"]synced['"]/);
        expect(fn).toMatch(/['"]behind['"]/);
        expect(fn).toMatch(/['"]never['"]/);
    });

    it('refreshDriveSyncState short-circuits to non-prompting state when no cached token exists', () => {
        // The silent load-on-open behavior: if getCachedAccessToken
        // returns null, the function never calls queryLatestDriveFile —
        // it just sets the state from the local marker. The OAuth popup
        // never opens for the indicator alone.
        const idx = main.indexOf('function refreshDriveSyncState');
        expect(idx).toBeGreaterThan(-1);
        const fn = main.slice(idx, idx + 1200);
        expect(fn).toMatch(/getCachedAccessToken\s*\(\s*\)/);
        // Early-return branch: when no token, set state and return without
        // hitting queryLatestDriveFile.
        expect(fn).toMatch(/if\s*\(\s*!token\s*\)/);
    });

    it('queries Drive when a token is cached and routes the result through computeDriveSyncState', () => {
        const idx = main.indexOf('function refreshDriveSyncState');
        const fn = main.slice(idx, idx + 1200);
        expect(fn).toMatch(/queryLatestDriveFile\s*\(\s*token\s*\)/);
        expect(fn).toMatch(/computeDriveSyncState\s*\(/);
    });

    it('catches Drive query errors and falls back to the unknown state', () => {
        const idx = main.indexOf('function refreshDriveSyncState');
        const fn = main.slice(idx, idx + 1500);
        // The promise chain has a .catch that sets state to 'unknown'.
        expect(fn).toMatch(/\.catch\(/);
        const catchIdx = fn.indexOf('.catch(');
        const catchSlice = fn.slice(catchIdx, catchIdx + 400);
        expect(catchSlice).toMatch(/['"]unknown['"]/);
    });

    it('schedules a one-shot silent sync probe on app load — refreshDriveSyncState runs after the boot-time autoSyncOnAppLoad silent re-auth attempt', () => {
        // Boot now attempts a silent OAuth refresh first (so a returning
        // user's cached Drive token populates getCachedAccessToken before
        // the indicator paints), then chains into refreshDriveSyncState
        // from the same setTimeout. The two calls live in the same boot
        // block; refreshDriveSyncState appears after autoSyncOnAppLoad
        // in the source so the chain ordering is verifiable.
        const autoSyncIdx = main.indexOf('autoSyncOnAppLoad()');
        expect(autoSyncIdx).toBeGreaterThan(-1);
        const slice = main.slice(autoSyncIdx, autoSyncIdx + 600);
        expect(slice).toMatch(/refreshDriveSyncState\s*\(\s*\)/);
    });

    it('re-queries Drive whenever the ghost menu opens', () => {
        // showSettingsMenu must call refreshDriveSyncState so the badge
        // reflects the latest Drive modifiedTime each time the menu is
        // opened — covering the "another device pushed" case.
        const idx = main.indexOf('function showSettingsMenu');
        expect(idx).toBeGreaterThan(-1);
        const fn = main.slice(idx, idx + 12000);
        expect(fn).toMatch(/refreshDriveSyncState\s*\(\s*\)/);
    });

    it('renders the DRIVE section header with an inline sync-state badge', () => {
        // The badge is a span with id="settingsMenuDriveSyncBadge" inside
        // the DRIVE heading so the popover surface mirrors the trigger.
        expect(main).toMatch(/driveHeadingBadge\.id\s*=\s*['"]settingsMenuDriveSyncBadge['"]/);
        expect(main).toMatch(/driveHeading\.appendChild\(\s*driveHeadingBadge\s*\)/);
    });
});


describe('Drive sync indicator — computeDriveSyncState semantics (runtime)', () => {
    // Build a lightweight runtime probe by parsing the function definition
    // out of main.js source. This keeps the test source-level (no DOM
    // simulation needed) while still exercising the actual branching
    // logic.
    const main = read('main.js');

    function extractFunction(name) {
        const idx = main.indexOf('function ' + name);
        expect(idx).toBeGreaterThan(-1);
        // Walk braces from the first { after the name to its matching }.
        const openBrace = main.indexOf('{', idx);
        let depth = 0;
        for (let i = openBrace; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) {
                    const body = main.slice(openBrace + 1, i);
                    // Need only the parameter list + body for new Function.
                    const sig = main.slice(idx, openBrace);
                    const params = sig.match(/\(([^)]*)\)/);
                    return new Function(params[1], body);
                }
            }
        }
        throw new Error('unbalanced braces in ' + name);
    }

    const computeDriveSyncState = extractFunction('computeDriveSyncState');

    it('returns "never" when there is no local timestamp and no Drive file', () => {
        expect(computeDriveSyncState(null, null)).toBe('never');
        expect(computeDriveSyncState(undefined, undefined)).toBe('never');
        expect(computeDriveSyncState('', '')).toBe('never');
    });

    it('returns "synced" when local timestamp matches or exceeds Drive modifiedTime', () => {
        const t = '2026-05-22T10:00:00.000Z';
        expect(computeDriveSyncState(t, t)).toBe('synced');
        const later = '2026-05-22T10:00:01.000Z';
        expect(computeDriveSyncState(later, t)).toBe('synced');
    });

    it('returns "behind" when Drive modifiedTime is newer than local timestamp', () => {
        const localIso = '2026-05-22T09:00:00.000Z';
        const driveIso = '2026-05-22T10:00:00.000Z';
        expect(computeDriveSyncState(localIso, driveIso)).toBe('behind');
    });

    it('returns "behind" when there is a Drive file but no local timestamp', () => {
        expect(computeDriveSyncState(null, '2026-05-22T10:00:00.000Z')).toBe('behind');
    });

    it('returns "synced" when there is a local timestamp but no Drive file (first-time uploader before backend reflects the file)', () => {
        // Edge case where the local marker exists but the Drive list is
        // empty — treat as in-sync. The user's most recent action was an
        // export they took, so there's no "Drive is newer" claim to make.
        expect(computeDriveSyncState('2026-05-22T10:00:00.000Z', null)).toBe('synced');
    });

    it('returns "unknown" when either timestamp is unparseable', () => {
        expect(computeDriveSyncState('not-a-date', '2026-05-22T10:00:00.000Z')).toBe('unknown');
        expect(computeDriveSyncState('2026-05-22T10:00:00.000Z', 'not-a-date')).toBe('unknown');
    });
});


describe('Drive sync indicator — driveAuth.getCachedAccessToken helper', () => {
    const src = read('driveAuth.js');

    it('exports a getCachedAccessToken function', () => {
        expect(src).toMatch(/export\s+function\s+getCachedAccessToken\s*\(/);
    });

    it('returns the cached token only when tokenStillValid() is true', () => {
        const idx = src.indexOf('function getCachedAccessToken');
        const fn = src.slice(idx, idx + 400);
        expect(fn).toMatch(/tokenStillValid\s*\(\s*\)/);
    });

    it('never calls requestAccessToken — the helper is non-prompting', () => {
        // The whole point of this helper is to read the cached token
        // without triggering an OAuth popup. The body must not invoke
        // GIS's requestAccessToken / loadGisLibrary.
        const idx = src.indexOf('function getCachedAccessToken');
        const fn = src.slice(idx, idx + 400);
        expect(fn).not.toMatch(/requestAccessToken/);
        expect(fn).not.toMatch(/loadGisLibrary/);
    });
});


describe('Drive sync indicator — CSS', () => {
    const css = read('style.css');

    it('positions the ghost-icon badge absolutely on the trigger', () => {
        const idx = css.indexOf('.settingsToggleSyncBadge {');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 500);
        expect(block).toMatch(/position:\s*absolute/);
    });

    it('colors the badge by data-sync-state for each bucket', () => {
        expect(css).toMatch(/\.settingsToggleSyncBadge\[data-sync-state="synced"\]/);
        expect(css).toMatch(/\.settingsToggleSyncBadge\[data-sync-state="behind"\]/);
        expect(css).toMatch(/\.settingsToggleSyncBadge\[data-sync-state="never"\]/);
        expect(css).toMatch(/\.settingsMenuDriveSyncBadge\[data-sync-state="synced"\]/);
        expect(css).toMatch(/\.settingsMenuDriveSyncBadge\[data-sync-state="behind"\]/);
    });
});
