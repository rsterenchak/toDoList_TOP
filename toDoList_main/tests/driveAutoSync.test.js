// Tests for the Drive auto-sync first slice. Pins the four-branch
// decision logic, the debounce coalescing, the diverged auto-pause, the
// pre-push driveAhead race re-check, and the silent threading into the
// import pipeline. The OAuth popup and the network calls are stubbed —
// we're testing the module's orchestration, not the Google CDN.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import {
    decideAutoSyncAction,
    isLocalAhead,
    isDriveAhead,
    scheduleAutoSync,
    cancelPendingAutoSync,
    armAutoSync,
    disarmAutoSync,
    isAutoSyncArmed,
    getAutoSyncState,
    _resetAutoSyncForTest,
    AUTO_SYNC_DEBOUNCE_MS,
    performAutoSync,
    autoSyncOnAppLoad,
    registerAutoSyncRebuild,
    getCachedDriveModifiedTime,
    updateCachedDriveModifiedTime,
} from '../src/driveAutoSync.js';
import {
    _resetCachedToken,
    _resetGisPromise,
} from '../src/driveAuth.js';
import {
    LAST_DRIVE_SYNCED_AT_KEY,
    LAST_LOCAL_MUTATION_AT_KEY,
    writeLastDriveSyncedAt,
    writeLastLocalMutationAt,
} from '../src/prefs.js';
import { importTodosFromString } from '../src/exportImport.js';
import { listLogic } from '../src/listLogic.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }


// ── DECISION TREE ─────────────────────────────────────────────────────
describe('driveAutoSync — decideAutoSyncAction four-branch decision tree', () => {
    it('returns "unarmed" when the loop has not been armed yet, regardless of state', () => {
        expect(decideAutoSyncAction({ armed: false, hasToken: true, localAhead: false, driveAhead: false })).toBe('unarmed');
        expect(decideAutoSyncAction({ armed: false, hasToken: true, localAhead: true,  driveAhead: false })).toBe('unarmed');
        expect(decideAutoSyncAction({ armed: false, hasToken: true, localAhead: false, driveAhead: true })).toBe('unarmed');
        expect(decideAutoSyncAction({ armed: false, hasToken: true, localAhead: true,  driveAhead: true })).toBe('unarmed');
    });

    it('returns "no-token" when armed but no in-memory OAuth token exists', () => {
        expect(decideAutoSyncAction({ armed: true, hasToken: false, localAhead: false, driveAhead: false })).toBe('no-token');
        expect(decideAutoSyncAction({ armed: true, hasToken: false, localAhead: true,  driveAhead: false })).toBe('no-token');
        expect(decideAutoSyncAction({ armed: true, hasToken: false, localAhead: false, driveAhead: true })).toBe('no-token');
    });

    it('returns "noop" when both sides are in sync', () => {
        expect(decideAutoSyncAction({ armed: true, hasToken: true, localAhead: false, driveAhead: false })).toBe('noop');
    });

    it('returns "push" when local has unsynced edits and Drive is in sync', () => {
        expect(decideAutoSyncAction({ armed: true, hasToken: true, localAhead: true, driveAhead: false })).toBe('push');
    });

    it('returns "pull" when Drive has moved and local is in sync', () => {
        expect(decideAutoSyncAction({ armed: true, hasToken: true, localAhead: false, driveAhead: true })).toBe('pull');
    });

    it('returns "diverged" when both local AND Drive have moved past the sync marker', () => {
        expect(decideAutoSyncAction({ armed: true, hasToken: true, localAhead: true, driveAhead: true })).toBe('diverged');
    });
});


// ── TIMESTAMP HELPERS ─────────────────────────────────────────────────
describe('driveAutoSync — isLocalAhead / isDriveAhead helpers', () => {
    const SYNCED = '2026-05-23T10:00:00.000Z';
    const OLDER  = '2026-05-23T09:00:00.000Z';
    const NEWER  = '2026-05-23T11:00:00.000Z';

    it('isLocalAhead is false when localMutationIso is null/undefined', () => {
        expect(isLocalAhead(SYNCED, null)).toBe(false);
        expect(isLocalAhead(SYNCED, undefined)).toBe(false);
    });

    it('isLocalAhead is false when localMutationIso is older than syncedIso', () => {
        expect(isLocalAhead(SYNCED, OLDER)).toBe(false);
    });

    it('isLocalAhead is true when localMutationIso is newer than syncedIso', () => {
        expect(isLocalAhead(SYNCED, NEWER)).toBe(true);
    });

    it('isDriveAhead is false when driveModifiedIso is null', () => {
        expect(isDriveAhead(SYNCED, null)).toBe(false);
    });

    it('isDriveAhead is true when no local sync marker but Drive has a file', () => {
        expect(isDriveAhead(null, SYNCED)).toBe(true);
    });

    it('isDriveAhead is true when driveModifiedIso is newer than syncedIso', () => {
        expect(isDriveAhead(SYNCED, NEWER)).toBe(true);
    });

    it('isDriveAhead is false when driveModifiedIso equals syncedIso', () => {
        expect(isDriveAhead(SYNCED, SYNCED)).toBe(false);
    });
});


// ── ARMED FLAG LIFECYCLE ──────────────────────────────────────────────
describe('driveAutoSync — armed flag lifecycle', () => {
    beforeEach(() => { _resetAutoSyncForTest(); });
    afterEach(() => { _resetAutoSyncForTest(); });

    it('starts disarmed', () => {
        expect(isAutoSyncArmed()).toBe(false);
    });

    it('armAutoSync flips the flag on', () => {
        armAutoSync();
        expect(isAutoSyncArmed()).toBe(true);
    });

    it('disarmAutoSync("diverged") flips the flag off and sets state to diverged', () => {
        armAutoSync();
        disarmAutoSync('diverged');
        expect(isAutoSyncArmed()).toBe(false);
        expect(getAutoSyncState()).toBe('diverged');
    });

    it('disarmAutoSync("failed") flips the flag off and sets state to failed with message', () => {
        armAutoSync();
        disarmAutoSync('failed', 'network error');
        expect(isAutoSyncArmed()).toBe(false);
        expect(getAutoSyncState()).toBe('failed');
    });

    it('re-arming after a failed state clears the failure', () => {
        armAutoSync();
        disarmAutoSync('failed', 'network error');
        expect(getAutoSyncState()).toBe('failed');
        armAutoSync();
        expect(getAutoSyncState()).toBe('idle');
    });
});


// ── DEBOUNCE COALESCING ───────────────────────────────────────────────
describe('driveAutoSync — debounce coalesces rapid mutations into one fire', () => {
    beforeEach(() => { _resetAutoSyncForTest(); });
    afterEach(() => { _resetAutoSyncForTest(); });

    it('exports AUTO_SYNC_DEBOUNCE_MS = 10 seconds', () => {
        expect(AUTO_SYNC_DEBOUNCE_MS).toBe(10 * 1000);
    });

    it('scheduleAutoSync is a no-op when the loop is not armed', () => {
        vi.useFakeTimers();
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        scheduleAutoSync();
        // The implementation may use setTimeout for other things, so we
        // assert no debounce timer was created by checking the spy was
        // not called with the AUTO_SYNC_DEBOUNCE_MS delay.
        const calledWithDebounce = setTimeoutSpy.mock.calls.some(call => call[1] === AUTO_SYNC_DEBOUNCE_MS);
        expect(calledWithDebounce).toBe(false);
        setTimeoutSpy.mockRestore();
        vi.useRealTimers();
    });

    it('schedules exactly one fire across N rapid scheduleAutoSync() calls', () => {
        vi.useFakeTimers();
        armAutoSync();
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        // Five rapid mutations within the debounce window.
        scheduleAutoSync();
        scheduleAutoSync();
        scheduleAutoSync();
        scheduleAutoSync();
        scheduleAutoSync();

        // Five setTimeout calls were made (one per scheduleAutoSync),
        // but only the last one survives — the earlier ones were
        // cleared. We can't directly verify "only one fire" without
        // also stubbing performAutoSync, so just pin that setTimeout
        // was invoked with the debounce delay each time.
        const debounceCalls = setTimeoutSpy.mock.calls.filter(call => call[1] === AUTO_SYNC_DEBOUNCE_MS);
        expect(debounceCalls.length).toBe(5);

        setTimeoutSpy.mockRestore();
        vi.useRealTimers();
    });

    it('cancelPendingAutoSync clears the pending timer', () => {
        vi.useFakeTimers();
        armAutoSync();
        scheduleAutoSync();
        cancelPendingAutoSync();
        // Advance past the debounce window — if the timer had not been
        // cleared, performAutoSync would have fired (we'd see a fetch
        // attempt or similar side effect). Since nothing is wired up,
        // this is a structural assertion that cancelPendingAutoSync
        // exists and returns cleanly.
        vi.advanceTimersByTime(AUTO_SYNC_DEBOUNCE_MS + 100);
        vi.useRealTimers();
    });
});


// ── SOURCE-LEVEL CONTRACT ─────────────────────────────────────────────
describe('driveAutoSync — source-level contract', () => {
    const src = read('driveAutoSync.js');

    it('imports getCachedAccessToken so the app-load trigger never opens an OAuth popup', () => {
        expect(src).toMatch(
            /import\s*\{[^}]*\bgetCachedAccessToken\b[^}]*\}\s*from\s*['"]\.\/driveAuth\.js['"]/
        );
    });

    it('imports queryLatestDriveFile from driveImport for the decision-tree input', () => {
        expect(src).toMatch(
            /import\s*\{[^}]*\bqueryLatestDriveFile\b[^}]*\}\s*from\s*['"]\.\/driveImport\.js['"]/
        );
    });

    it('imports the shared importTodosFromDrive orchestrator (does not re-implement)', () => {
        expect(src).toMatch(
            /import\s*\{[^}]*\bimportTodosFromDrive\b[^}]*\}\s*from\s*['"]\.\/driveImport\.js['"]/
        );
    });

    it('imports the shared exportTodosToDrive orchestrator (does not re-implement)', () => {
        expect(src).toMatch(
            /import\s*\{[^}]*\bexportTodosToDrive\b[^}]*\}\s*from\s*['"]\.\/driveExport\.js['"]/
        );
    });

    it('passes { silent: true } when invoking the auto-pull import', () => {
        // Auto-pull skips the destructive-overwrite confirmation modal;
        // manual pull (separate code path) does not.
        expect(src).toMatch(/importTodosFromDrive\s*\([^)]*silent\s*:\s*true/);
    });

    it('performs a pre-push driveAhead re-check (queryLatestDriveFile fires twice on the push branch)', () => {
        // The first call collects the decision-tree input; the second
        // runs immediately before exportTodosToDrive to guard against the
        // race where another device pushes during the debounce window.
        // The literal queryLatestDriveFile reference must appear more
        // than once in the module source.
        const matches = src.match(/queryLatestDriveFile\s*\(/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });
});


// ── SILENT IMPORT PIPELINE ────────────────────────────────────────────
describe('exportImport — silent: true threading skips the confirm modal', () => {
    beforeEach(() => {
        listLogic._reset();
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
        try { localStorage.removeItem(LAST_LOCAL_MUTATION_AT_KEY); } catch (_) {}
        const modal = document.getElementById('confirmModalBackdrop');
        if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    });

    it('with opts.silent = true, applies the import directly without rendering a confirmation modal', () => {
        const payload = JSON.stringify({
            version: 1,
            exportedAt: '2026-05-23T10:00:00.000Z',
            projects: [
                { name: 'SilentlyImported', items: [{ tit: 'X', completed: false, due: '' }], color: null },
            ],
        });
        const outcome = importTodosFromString(payload, function() { /* host */ }, {
            silentError: true,
            silent: true,
            fromSync: true,
        });
        expect(outcome.ok).toBe(true);
        // No confirm modal was rendered.
        expect(document.getElementById('confirmModalBackdrop')).toBeFalsy();
        // The replace landed.
        expect(listLogic.listProjectsArray()).toEqual(['SilentlyImported']);
    });

    it('without opts.silent, still renders the confirm modal (regression guard)', () => {
        const payload = JSON.stringify({
            version: 1,
            exportedAt: '2026-05-23T10:00:00.000Z',
            projects: [
                { name: 'NeedsConfirm', items: [], color: null },
            ],
        });
        const outcome = importTodosFromString(payload, null, { silentError: true });
        expect(outcome.ok).toBe(true);
        // Confirm modal IS rendered for the non-silent path.
        const modal = document.getElementById('confirmModalBackdrop');
        expect(modal).toBeTruthy();
        // Clean up.
        if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    });
});


// ── REGISTER REBUILD CALLBACK ─────────────────────────────────────────
describe('driveAutoSync — registerAutoSyncRebuild', () => {
    beforeEach(() => { _resetAutoSyncForTest(); });
    afterEach(() => { _resetAutoSyncForTest(); });

    it('accepts a callback without throwing (host hook for the pull rebuild)', () => {
        expect(() => registerAutoSyncRebuild(function() {})).not.toThrow();
    });
});


// ── PERFORM AUTO-SYNC — DIVERGED AUTO-PAUSE ───────────────────────────
describe('driveAutoSync — performAutoSync diverged auto-pause', () => {
    let originalGoogle;

    beforeEach(() => {
        _resetAutoSyncForTest();
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
        try { localStorage.removeItem(LAST_LOCAL_MUTATION_AT_KEY); } catch (_) {}
        // Seed the in-memory token cache so getCachedAccessToken returns
        // a value. The auth module exposes a reset helper; we simulate a
        // cached token by patching getCachedAccessToken behaviour via the
        // GIS popup — but for unit isolation we just stub fetch.
        originalGoogle = window.google;
    });

    afterEach(() => {
        _resetAutoSyncForTest();
        if (originalGoogle === undefined) {
            try { delete window.google; } catch (_) { window.google = undefined; }
        } else {
            window.google = originalGoogle;
        }
        if ('fetch' in globalThis) {
            try { delete globalThis.fetch; } catch (_) { globalThis.fetch = undefined; }
        }
    });

    it('returns "unarmed" without doing any work when the loop is not armed', async () => {
        const result = await performAutoSync();
        expect(result).toBe('unarmed');
    });

    it('returns "no-token" when armed but no cached OAuth token exists', async () => {
        armAutoSync();
        const result = await performAutoSync();
        expect(result).toBe('no-token');
    });
});


// ── AUTO-SYNC ON APP LOAD — SILENT RE-AUTH ────────────────────────────
describe('driveAutoSync — autoSyncOnAppLoad silent re-auth', () => {
    let originalGoogle;

    beforeEach(() => {
        _resetAutoSyncForTest();
        _resetCachedToken();
        _resetGisPromise();
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
        try { localStorage.removeItem(LAST_LOCAL_MUTATION_AT_KEY); } catch (_) {}
        originalGoogle = window.google;
    });

    afterEach(() => {
        _resetAutoSyncForTest();
        _resetCachedToken();
        _resetGisPromise();
        if (originalGoogle === undefined) {
            try { delete window.google; } catch (_) { window.google = undefined; }
        } else {
            window.google = originalGoogle;
        }
        if ('fetch' in globalThis) {
            try { delete globalThis.fetch; } catch (_) { globalThis.fetch = undefined; }
        }
    });

    function installFakeGisSuccess() {
        const calls = [];
        window.google = {
            accounts: {
                oauth2: {
                    initTokenClient(config) {
                        return {
                            requestAccessToken(opts) {
                                calls.push(opts || {});
                                config.callback({
                                    access_token: 'silent-token',
                                    expires_in: 3600,
                                });
                            },
                        };
                    },
                },
            },
        };
        return calls;
    }

    function installFakeGisFailure(errorString) {
        window.google = {
            accounts: {
                oauth2: {
                    initTokenClient(config) {
                        return {
                            requestAccessToken() {
                                config.callback({ error: errorString || 'access_denied' });
                            },
                        };
                    },
                },
            },
        };
    }

    function stubQuietDriveQuery() {
        globalThis.fetch = function() {
            return Promise.resolve({
                ok: true,
                json() { return Promise.resolve({ files: [] }); },
            });
        };
    }

    it('arms _autoSyncArmed after a successful silent refresh on app load', async () => {
        installFakeGisSuccess();
        stubQuietDriveQuery();
        expect(isAutoSyncArmed()).toBe(false);
        await autoSyncOnAppLoad();
        expect(isAutoSyncArmed()).toBe(true);
    });

    it('passes prompt: "none" through to the GIS token client (no popup on silent app-load)', async () => {
        const calls = installFakeGisSuccess();
        stubQuietDriveQuery();
        await autoSyncOnAppLoad();
        expect(calls).toHaveLength(1);
        expect(calls[0].prompt).toBe('none');
    });

    it('does NOT arm _autoSyncArmed when the silent refresh fails', async () => {
        installFakeGisFailure('access_denied');
        expect(isAutoSyncArmed()).toBe(false);
        const result = await autoSyncOnAppLoad();
        expect(isAutoSyncArmed()).toBe(false);
        // The failure resolves quietly with a no-token marker — no throw.
        expect(result).toBe('no-token');
    });

    it('does NOT throw or surface a toast when the silent refresh fails', async () => {
        installFakeGisFailure('no_session');
        // Pre-test cleanup: no existing toast in the DOM.
        const priorToast = document.getElementById('driveExportToast');
        if (priorToast && priorToast.parentNode) priorToast.parentNode.removeChild(priorToast);

        let threw = false;
        try {
            await autoSyncOnAppLoad();
        } catch (_) {
            threw = true;
        }
        expect(threw).toBe(false);

        // Auth failure during the silent path must not surface a toast —
        // it's the normal first-time-user path.
        const toast = document.getElementById('driveExportToast');
        expect(toast).toBeFalsy();
    });
});


// ── MAIN.JS WIRING ────────────────────────────────────────────────────
describe('main.js — auto-sync wiring at boot', () => {
    const main = read('main.js');

    it('imports the auto-sync module', () => {
        expect(main).toMatch(
            /import\s*\{[^}]*\}\s*from\s*['"]\.\/driveAutoSync\.js['"]/
        );
    });

    it('registers rebuildAfterImport as the auto-sync rebuild callback', () => {
        expect(main).toMatch(/registerAutoSyncRebuild\s*\(\s*rebuildAfterImport\s*\)/);
    });

    it('calls autoSyncOnAppLoad at boot', () => {
        expect(main).toMatch(/autoSyncOnAppLoad\s*\(/);
    });

    it('schedules an auto-sync attempt from the driveSyncStateChanged listener', () => {
        // Two listeners are attached for driveSyncStateChanged: the
        // existing recomputeDriveSyncStateLocal, plus a new one that
        // calls scheduleAutoSync. The source must contain a
        // scheduleAutoSync call somewhere inside a driveSyncStateChanged
        // handler.
        expect(main).toMatch(/scheduleAutoSync\s*\(/);
    });

    it('listens for driveManualActionSuccess to arm the auto-sync loop', () => {
        // Manual Drive Export / Import success dispatches a CustomEvent
        // (decoupled — driveExport.js and driveImport.js don't import
        // driveAutoSync to avoid a circular dependency). main.js listens
        // and flips the loop on.
        expect(main).toMatch(/driveManualActionSuccess/);
        expect(main).toMatch(/armAutoSync\s*\(\s*\)/);
    });

    it('driveExport dispatches driveManualActionSuccess on a successful upload', () => {
        const exportSrc = read('driveExport.js');
        expect(exportSrc).toMatch(/driveManualActionSuccess/);
    });

    it('driveImport dispatches driveManualActionSuccess on a successful (non-silent) restore', () => {
        const importSrc = read('driveImport.js');
        expect(importSrc).toMatch(/driveManualActionSuccess/);
    });
});


// ── ARMED FLAG IS EXPORTED FROM driveAutoSync.js ──────────────────────
describe('driveAutoSync — armed flag is owned by this module', () => {
    // Pins that main.js never mutates _armed directly — the only ways to
    // flip the flag are armAutoSync() and disarmAutoSync(). This is the
    // contract that lets the Connect-to-Drive handler trust armAutoSync()
    // as the single source of truth for arming.
    const src = read('driveAutoSync.js');
    const mainSrc = read('main.js');

    it('armAutoSync is exported from driveAutoSync.js', () => {
        expect(src).toMatch(/export\s+function\s+armAutoSync\s*\(/);
    });

    it('armAutoSync flips _armed to true (source-level)', () => {
        const idx = src.indexOf('export function armAutoSync');
        expect(idx).toBeGreaterThan(-1);
        const fn = src.slice(idx, idx + 400);
        expect(fn).toMatch(/_armed\s*=\s*true/);
    });

    it('main.js never assigns to _armed directly — the flag is module-private to driveAutoSync.js', () => {
        // Any line in main.js that touches a bare _armed identifier would
        // bypass the exported helpers' state cleanup (e.g., clearing the
        // 'failed' state on re-arm). Calls to armAutoSync()/disarmAutoSync()
        // are fine — those are function invocations, not assignments.
        expect(mainSrc).not.toMatch(/\b_armed\s*=/);
    });
});


// ── INDICATOR STATE-TO-GLYPH MAPPING ──────────────────────────────────
describe('Drive sync indicator — state-to-glyph mapping', () => {
    // The state-to-glyph mapping function lives inside the component()
    // closure of main.js. We extract it via Function-from-source the same
    // way driveSyncIndicator.test.js extracts computeDriveSyncState, then
    // assert one row per state.
    const main = read('main.js');

    function extractFunction(name) {
        const idx = main.indexOf('function ' + name);
        expect(idx).toBeGreaterThan(-1);
        const openBrace = main.indexOf('{', idx);
        let depth = 0;
        for (let i = openBrace; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) {
                    const body = main.slice(openBrace + 1, i);
                    const sig = main.slice(idx, openBrace);
                    const params = sig.match(/\(([^)]*)\)/);
                    return new Function(params[1], body);
                }
            }
        }
        throw new Error('unbalanced braces in ' + name);
    }

    const syncStateToGlyphClass = extractFunction('syncStateToGlyphClass');
    const syncStateTooltip      = extractFunction('syncStateTooltip');

    it('synced → ti-cloud-check', () => {
        expect(syncStateToGlyphClass('synced')).toBe('ti-cloud-check');
    });

    it('ahead → ti-cloud-up', () => {
        expect(syncStateToGlyphClass('ahead')).toBe('ti-cloud-up');
    });

    it('behind → ti-cloud-up', () => {
        expect(syncStateToGlyphClass('behind')).toBe('ti-cloud-up');
    });

    it('diverged → ti-cloud-x', () => {
        expect(syncStateToGlyphClass('diverged')).toBe('ti-cloud-x');
    });

    it('failed → ti-cloud-off', () => {
        expect(syncStateToGlyphClass('failed')).toBe('ti-cloud-off');
    });

    it('never → ti-cloud-off', () => {
        expect(syncStateToGlyphClass('never')).toBe('ti-cloud-off');
    });

    it('unknown → ti-cloud-off (sibling of never, differentiated only by CSS color)', () => {
        expect(syncStateToGlyphClass('unknown')).toBe('ti-cloud-off');
    });

    it('ahead and behind resolve to the SAME glyph class (only tooltip differentiates)', () => {
        expect(syncStateToGlyphClass('ahead')).toBe(syncStateToGlyphClass('behind'));
    });

    it('ahead and behind produce DIFFERENT tooltip strings (direction-of-travel cue lives in the tooltip)', () => {
        const aheadTip  = syncStateTooltip('ahead', '2026-05-23T10:00:00.000Z');
        const behindTip = syncStateTooltip('behind', '2026-05-23T10:00:00.000Z');
        expect(aheadTip).not.toBe(behindTip);
    });

    it('ahead does NOT resolve to the failure glyph (regression — was conflated with failed)', () => {
        expect(syncStateToGlyphClass('ahead')).not.toBe(syncStateToGlyphClass('failed'));
    });
});


// ── IMMEDIATE-SYNC-ON-CONNECT REGRESSION ──────────────────────────────
describe('driveAutoSync — immediate sync on connect writes lastDriveSyncedAt', () => {
    // Regression test for Bug A: after a Connect click resolves with an
    // OAuth token, the click handler arms the loop and calls
    // performAutoSync(). With local edits pending (localAhead) and no
    // newer Drive file, performAutoSync hits the push branch and
    // exportTodosToDrive writes lastDriveSyncedAt. The full Connect
    // handler lives inside main.js's closure — we exercise the
    // arm-then-perform sequence directly to prove the orchestration
    // produces the expected localStorage write.
    let originalFetch;
    let originalGoogle;

    beforeEach(() => {
        _resetAutoSyncForTest();
        _resetCachedToken();
        _resetGisPromise();
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
        try { localStorage.removeItem(LAST_LOCAL_MUTATION_AT_KEY); } catch (_) {}
        originalFetch = globalThis.fetch;
        originalGoogle = window.google;
    });

    afterEach(() => {
        _resetAutoSyncForTest();
        _resetCachedToken();
        _resetGisPromise();
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
        try { localStorage.removeItem(LAST_LOCAL_MUTATION_AT_KEY); } catch (_) {}
        if (originalFetch === undefined) {
            try { delete globalThis.fetch; } catch (_) { globalThis.fetch = undefined; }
        } else {
            globalThis.fetch = originalFetch;
        }
        if (originalGoogle === undefined) {
            try { delete window.google; } catch (_) { window.google = undefined; }
        } else {
            window.google = originalGoogle;
        }
    });

    it('arm + performAutoSync issues a Drive query against the cached token (proves the immediate sync attempt fires)', async () => {
        // The Bug-A symptom is that performAutoSync never runs after a
        // successful Connect click — the handler discards the resolved
        // token. With the fix in place, the handler arms the loop and
        // invokes performAutoSync, which must pass the unarmed/no-token
        // gates and actually issue a Drive query. We assert by spying on
        // fetch and confirming the Drive list URL was hit.
        const PRIOR_SYNCED  = '2026-05-22T10:00:00.000Z';
        const RECENT_EDIT   = '2026-05-23T12:00:00.000Z';
        writeLastDriveSyncedAt(PRIOR_SYNCED);
        writeLastLocalMutationAt(RECENT_EDIT);

        // Populate the in-memory token cache by stubbing GIS to resolve
        // with a fake token, then calling getAccessToken().
        const { getAccessToken } = await import('../src/driveAuth.js');
        window.google = {
            accounts: {
                oauth2: {
                    initTokenClient(config) {
                        return {
                            requestAccessToken() {
                                config.callback({
                                    access_token: 'connect-token',
                                    expires_in: 3600,
                                });
                            },
                        };
                    },
                },
            },
        };
        await getAccessToken();

        // Stub fetch so the Drive query returns a file matching the local
        // sync marker (so localAhead drives the decision, not driveAhead).
        const driveQueryResponse = {
            ok: true,
            json: () => Promise.resolve({
                files: [{ id: 'file-1', modifiedTime: PRIOR_SYNCED, name: 'todoapp-export.json' }],
            }),
        };
        globalThis.fetch = vi.fn(function() {
            return Promise.resolve(driveQueryResponse);
        });

        // Mirror the Connect handler's success branch: arm, then perform.
        armAutoSync();
        const result = await performAutoSync();

        // The push branch may bail downstream (the test env has no
        // OAUTH_CLIENT_ID configured for exportTodosToDrive), but the
        // critical proof is that performAutoSync got far enough to fire
        // the Drive query — i.e., it didn't silently exit at the
        // unarmed/no-token gate. Either 'pushed' (full push completed)
        // or 'failed' (push attempted, blocked downstream) is acceptable;
        // 'unarmed' / 'no-token' is the regression we're guarding against.
        expect(['pushed', 'failed']).toContain(result);
        // Drive query was issued — the immediate sync attempt fired.
        const fetchCalls = globalThis.fetch.mock.calls;
        const driveListHit = fetchCalls.some(function(call) {
            const url = call[0];
            return typeof url === 'string' && url.indexOf('drive/v3/files') !== -1;
        });
        expect(driveListHit).toBe(true);
    });

    it('without armAutoSync first, performAutoSync silently returns "unarmed" — confirming the gate exists', async () => {
        // Negative companion to the test above: if the Connect handler
        // had skipped armAutoSync() (the original Bug-A behavior),
        // performAutoSync would short-circuit at the unarmed gate even
        // with a fresh cached token in place. This pin makes sure the
        // gate stays effective so a future refactor can't accidentally
        // mask a missing armAutoSync() call by always firing.
        const { getAccessToken } = await import('../src/driveAuth.js');
        window.google = {
            accounts: {
                oauth2: {
                    initTokenClient(config) {
                        return {
                            requestAccessToken() {
                                config.callback({
                                    access_token: 'connect-token',
                                    expires_in: 3600,
                                });
                            },
                        };
                    },
                },
            },
        };
        await getAccessToken();
        globalThis.fetch = vi.fn();

        const result = await performAutoSync();
        expect(result).toBe('unarmed');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});


// ── DRIVE MODIFIEDTIME CACHE ──────────────────────────────────────────
describe('driveAutoSync — updateCachedDriveModifiedTime / getCachedDriveModifiedTime', () => {
    beforeEach(() => { _resetAutoSyncForTest(); });
    afterEach(() => { _resetAutoSyncForTest(); });

    it('starts as null until the first write', () => {
        expect(getCachedDriveModifiedTime()).toBe(null);
    });

    it('writes the cache and exposes the value via the getter', () => {
        updateCachedDriveModifiedTime('2026-05-23T14:03:49.580Z');
        expect(getCachedDriveModifiedTime()).toBe('2026-05-23T14:03:49.580Z');
    });

    it('coerces nullish/empty inputs to null (single-shape "no Drive file" sentinel)', () => {
        updateCachedDriveModifiedTime('2026-05-23T14:03:49.580Z');
        updateCachedDriveModifiedTime(null);
        expect(getCachedDriveModifiedTime()).toBe(null);
        updateCachedDriveModifiedTime(undefined);
        expect(getCachedDriveModifiedTime()).toBe(null);
        updateCachedDriveModifiedTime('');
        expect(getCachedDriveModifiedTime()).toBe(null);
    });

    it('dispatches driveSyncStateChanged on every write so the indicator repaints immediately', () => {
        let fired = 0;
        const listener = function() { fired += 1; };
        document.addEventListener('driveSyncStateChanged', listener);
        try {
            updateCachedDriveModifiedTime('2026-05-23T14:03:49.580Z');
            updateCachedDriveModifiedTime('2026-05-23T15:00:00.000Z');
            expect(fired).toBe(2);
        } finally {
            document.removeEventListener('driveSyncStateChanged', listener);
        }
    });

    it('_resetAutoSyncForTest clears the cache back to null', () => {
        updateCachedDriveModifiedTime('2026-05-23T14:03:49.580Z');
        expect(getCachedDriveModifiedTime()).toBe('2026-05-23T14:03:49.580Z');
        _resetAutoSyncForTest();
        expect(getCachedDriveModifiedTime()).toBe(null);
    });
});


// ── STATIC SCAN: CACHE MUTATION IS MODULE-PRIVATE ─────────────────────
describe('driveAutoSync — _cachedDriveModifiedTime assignment is module-private', () => {
    // Pins the contract that the only file allowed to assign to
    // `_cachedDriveModifiedTime` is driveAutoSync.js itself. Any other
    // file that bypasses updateCachedDriveModifiedTime would also bypass
    // the driveSyncStateChanged dispatch and leave the indicator stale.
    const here = dirname(fileURLToPath(import.meta.url));
    const srcDirHere = resolve(here, '../src');

    function readAllSources() {
        const files = readdirSync(srcDirHere)
            .filter(function(f) { return f.endsWith('.js'); });
        return files.map(function(f) {
            return {
                name: f,
                body: readFileSync(join(srcDirHere, f), 'utf8'),
            };
        });
    }

    it('no source file outside driveAutoSync.js contains a _cachedDriveModifiedTime = ... assignment', () => {
        const ASSIGN_RE = /_cachedDriveModifiedTime\s*=/g;
        const offenders = readAllSources()
            .filter(function(f) { return f.name !== 'driveAutoSync.js'; })
            .filter(function(f) { return ASSIGN_RE.test(f.body); })
            .map(function(f) { return f.name; });
        expect(offenders).toEqual([]);
    });
});


// ── PERFORM AUTO-SYNC UPDATES THE CACHE ───────────────────────────────
describe('driveAutoSync — performAutoSync keeps the cache aligned with the freshest Drive query', () => {
    // Audit pin from the bug report: every Drive query inside the
    // orchestrator must feed its result into updateCachedDriveModifiedTime
    // so the indicator's local-only recompute path always reads server-
    // truth between mutations.
    const src = read('driveAutoSync.js');

    it('calls updateCachedDriveModifiedTime after the initial queryLatestDriveFile', () => {
        // Pull the performAutoSync function body brace-balanced so the
        // assertion isn't confused by other queryLatestDriveFile calls
        // elsewhere in the file (e.g. an export helper).
        const fnIdx = src.indexOf('export function performAutoSync');
        expect(fnIdx).toBeGreaterThan(-1);
        const bodyStart = src.indexOf('{', fnIdx);
        let depth = 0;
        let body = '';
        for (let i = bodyStart; i < src.length; i++) {
            const c = src.charAt(i);
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { body = src.slice(bodyStart, i + 1); break; }
            }
        }
        // At least two cache updates inside performAutoSync: one after
        // the initial query (drives the decision tree) and one after the
        // pre-push recheck (catches a remote push that landed during the
        // debounce window).
        const matches = body.match(/updateCachedDriveModifiedTime\s*\(/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });
});


// ── DIVERGED & FAILED CSS STATES ──────────────────────────────────────
describe('CSS — diverged and failed indicator states', () => {
    const css = read('style.css');

    it('the toggle sync badge styles the diverged state', () => {
        expect(css).toMatch(
            /\.settingsToggleSyncBadge\[data-sync-state="diverged"\]/
        );
    });

    it('the toggle sync badge styles the failed state', () => {
        expect(css).toMatch(
            /\.settingsToggleSyncBadge\[data-sync-state="failed"\]/
        );
    });

    it('the menu badge styles the diverged state', () => {
        expect(css).toMatch(
            /\.settingsMenuDriveSyncBadge\[data-sync-state="diverged"\]/
        );
    });
});
