// Drive auto-sync — first slice.
//
// After the user signs in to Drive once per session (by clicking the Drive
// indicator or running manual Export / Import), the app silently keeps the
// local copy and the user's Drive backup in sync. Two triggers fire the
// silent sync attempt:
//   1. on app load, IF a cached OAuth token exists from a prior session
//      (no consent prompt is opened);
//   2. on every local mutation, debounced 10 seconds — N rapid edits
//      coalesce to one sync attempt.
//
// Decision tree (after a Drive query resolves a fresh `driveModifiedTime`):
//   ── !localAhead && !driveAhead  → noop (already synced)
//   ── localAhead && !driveAhead   → auto-push (with pre-push re-check)
//   ── !localAhead && driveAhead   → auto-pull (silent — skips confirm)
//   ── localAhead && driveAhead    → diverged → auto-pause
//
// Failure handling: any thrown error inside the sync attempt sets state to
// 'failed' and disarms the loop for the session, so a broken Drive doesn't
// retry-storm. The user re-arms by clicking the indicator.
//
// Pre-push race guard: between the debounce schedule and the actual upload
// another device may have pushed a newer file to Drive. The push branch
// re-queries Drive immediately before uploading and re-enters the decision
// tree if Drive has moved — without this, auto-push silently overwrites a
// pushed-from-another-device version.

import { getCachedAccessToken, getAccessToken } from './driveAuth.js';
import { queryLatestDriveFile, importTodosFromDrive } from './driveImport.js';
import { exportTodosToDrive } from './driveExport.js';
import { readLastDriveSyncedAt, readLastLocalMutationAt } from './prefs.js';

export const AUTO_SYNC_DEBOUNCE_MS = 10 * 1000;
export const AUTO_SYNC_POLL_INTERVAL_MS = 60 * 1000;

let _armed = false;
let _debounceTimer = null;
let _state = 'idle';
let _lastFailureMessage = null;
let _onRebuildAfterImport = null;
let _inFlight = false;
let _pollIntervalId = null;
let _visibilityChangeListener = null;
let _focusListener = null;

// Cached Drive `modifiedTime` from the most recent successful query or
// push/pull. The indicator's local-only recompute path reads this via
// `getCachedDriveModifiedTime` so it can re-evaluate `driveAhead` without
// re-issuing a network query on every local edit. The cache is module-
// private — the single write entry point is `updateCachedDriveModifiedTime`,
// which also dispatches `driveSyncStateChanged` so any open indicator paints
// immediately against the fresh value. Direct mutation from outside this
// module is forbidden so the dispatch-on-write contract holds.
let _cachedDriveModifiedTime = null;

// Host hook so this module never has to import main.js. main.js calls
// registerAutoSyncRebuild(rebuildAfterImport) once at boot; the auto-pull
// branch then routes through that callback to redraw the UI after the
// silent import commits.
export function registerAutoSyncRebuild(callback) {
    _onRebuildAfterImport = callback;
}

export function isAutoSyncArmed() { return _armed; }
export function getAutoSyncState() { return _state; }
export function getAutoSyncFailureMessage() { return _lastFailureMessage; }

// Called from main.js after a successful manual click of Export or Import.
// The manual flow has already opened the OAuth popup and cached a token —
// flipping this flag is what tells the debounce + app-load triggers that
// they may fire silently from here on.
export function armAutoSync() {
    _armed = true;
    if (_state === 'failed' || _state === 'diverged') {
        _state = 'idle';
        _lastFailureMessage = null;
    }
}

// Disarms the loop. `reason` is one of 'diverged' | 'failed' | 'manual'.
// Diverged and failed pause auto-sync until the user resolves it via the
// popover; manual re-arming is a future hook for explicit "turn off auto"
// affordances.
export function disarmAutoSync(reason, failureMessage) {
    _armed = false;
    if (reason === 'diverged' || reason === 'failed') {
        _state = reason;
        _lastFailureMessage = reason === 'failed' ? (failureMessage || null) : null;
    }
}

// Test reset.
export function _resetAutoSyncForTest() {
    _armed = false;
    _state = 'idle';
    _lastFailureMessage = null;
    _onRebuildAfterImport = null;
    _inFlight = false;
    _cachedDriveModifiedTime = null;
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
    }
    _uninstallBackgroundTriggers();
}


// ── DRIVE MODIFIEDTIME CACHE ──

export function getCachedDriveModifiedTime() {
    return _cachedDriveModifiedTime;
}

// Single writer for the cached Drive modifiedTime. Updates the module-
// private cell, then dispatches `driveSyncStateChanged` so the indicator's
// local-only recompute path repaints immediately against the fresh value.
// All call sites that learn a fresh Drive modifiedTime — the menu-open
// Drive query, the post-push handler, the post-pull handler, the auto-sync
// orchestrator's pre-decision query and pre-push recheck — route through
// this helper.
export function updateCachedDriveModifiedTime(iso) {
    _cachedDriveModifiedTime = iso || null;
    if (typeof document !== 'undefined' && document.dispatchEvent) {
        try {
            document.dispatchEvent(new CustomEvent('driveSyncStateChanged'));
        } catch (_) { /* CustomEvent unsupported — silent */ }
    }
}


// ── DECISION HELPERS ──

export function isLocalAhead(syncedIso, localMutationIso) {
    if (!syncedIso || !localMutationIso) return false;
    const syncedMs = Date.parse(syncedIso);
    const mutationMs = Date.parse(localMutationIso);
    if (isNaN(syncedMs) || isNaN(mutationMs)) return false;
    return mutationMs > syncedMs;
}

export function isDriveAhead(syncedIso, driveModifiedIso) {
    if (!driveModifiedIso) return false;
    if (!syncedIso) return true;
    const syncedMs = Date.parse(syncedIso);
    const driveMs = Date.parse(driveModifiedIso);
    if (isNaN(syncedMs) || isNaN(driveMs)) return false;
    return driveMs > syncedMs;
}

// Resolve the single sync-state string the ghost menu's Sync row reads to
// derive its label + click handler. Combines three signals:
//
//   1. In-flight body classes (driveExportInProgress / driveImportInProgress)
//      take precedence — once a sync is underway, the row dims and reports
//      'syncing-push' / 'syncing-pull' until the body class clears.
//   2. Module-resident _state ('failed' / 'diverged') wins over timestamps
//      since the auto-sync loop's failure modes can't be re-derived from the
//      marker pair alone.
//   3. Otherwise compute from the local-synced + local-mutation + cached
//      Drive modifiedTime triplet, the same tree the indicator uses.
//
// The Drive modifiedTime isn't owned by this module (the indicator caches
// it in main.js), so callers pass it in via `driveModifiedIso`. `hasToken`
// is also a caller fact — when no cached OAuth token exists and the user
// has never synced, the row reads 'never' rather than optimistically
// claiming 'synced' against an empty Drive view.
export function getCurrentSyncState(opts) {
    opts = opts || {};
    const driveModifiedIso = opts.driveModifiedIso || null;
    const hasToken = opts.hasToken !== false;

    if (typeof document !== 'undefined' && document.body && document.body.classList) {
        if (document.body.classList.contains('driveImportInProgress')) return 'syncing-pull';
        if (document.body.classList.contains('driveExportInProgress')) return 'syncing-push';
    }

    if (_state === 'failed') return 'failed';
    if (_state === 'diverged') return 'diverged';

    const syncedIso = readLastDriveSyncedAt();
    const localMutationIso = readLastLocalMutationAt();

    if (!hasToken && !syncedIso) return 'never';

    const localAhead = isLocalAhead(syncedIso, localMutationIso);
    const driveAhead = isDriveAhead(syncedIso, driveModifiedIso);

    if (localAhead && driveAhead) return 'diverged';
    if (driveAhead) return 'behind';
    if (localAhead) return 'ahead';

    if (!syncedIso) return 'never';
    return 'synced';
}

// Pure decision function. Given the four inputs (cached token presence,
// localAhead, driveAhead, armed), return the action to take:
//   'noop' | 'push' | 'pull' | 'diverged' | 'unarmed' | 'no-token'
export function decideAutoSyncAction({ armed, hasToken, localAhead, driveAhead }) {
    if (!armed) return 'unarmed';
    if (!hasToken) return 'no-token';
    if (localAhead && driveAhead) return 'diverged';
    if (localAhead && !driveAhead) return 'push';
    if (!localAhead && driveAhead) return 'pull';
    return 'noop';
}


// ── DEBOUNCE ──

// Resets the pending sync timer. Called from main.js's
// `driveSyncStateChanged` listener on every mutation. The loop is gated by
// `_armed` so pre-first-click mutations don't start the timer at all.
export function scheduleAutoSync() {
    if (!_armed) return;
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(function() {
        _debounceTimer = null;
        performAutoSync().catch(function() { /* swallow — performAutoSync logs */ });
    }, AUTO_SYNC_DEBOUNCE_MS);
}

// Cancels any pending debounce without firing it. Used when the loop is
// disarmed mid-debounce (e.g. a manual flow grabbed the token and we want
// to defer to that direction).
export function cancelPendingAutoSync() {
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
    }
}


// ── ORCHESTRATOR ──

function emitStateChange() {
    if (typeof document === 'undefined' || !document.dispatchEvent) return;
    try {
        document.dispatchEvent(new CustomEvent('autoSyncStateChanged', {
            detail: { state: _state, message: _lastFailureMessage },
        }));
    } catch (_) { /* CustomEvent unsupported — silent */ }
}

// Run a single sync attempt. Returns the action taken ('pushed' | 'pulled'
// | 'noop' | 'diverged' | 'failed' | 'unarmed' | 'no-token'). Safe to call
// directly (bypasses debounce) — the popover's "Sync now" button hooks
// into this entry point.
export function performAutoSync() {
    if (_inFlight) return Promise.resolve('in-flight');

    const token = getCachedAccessToken();
    const localSyncedIso = readLastDriveSyncedAt();
    const localMutationIso = readLastLocalMutationAt();

    const decision = decideAutoSyncAction({
        armed: _armed,
        hasToken: !!token,
        localAhead: isLocalAhead(localSyncedIso, localMutationIso),
        driveAhead: false, // placeholder — we re-evaluate driveAhead after the query
    });

    if (decision === 'unarmed') return Promise.resolve('unarmed');
    if (decision === 'no-token') return Promise.resolve('no-token');

    _inFlight = true;
    return queryLatestDriveFile(token).then(function(files) {
        const driveFile = files && files[0] ? files[0] : null;
        const driveModifiedIso = driveFile ? driveFile.modifiedTime : null;
        // Keep the indicator's cache aligned with the freshest server
        // truth so the local-only recompute path sees the right inputs.
        updateCachedDriveModifiedTime(driveModifiedIso);

        const action = decideAutoSyncAction({
            armed: _armed,
            hasToken: true,
            localAhead: isLocalAhead(localSyncedIso, localMutationIso),
            driveAhead: isDriveAhead(localSyncedIso, driveModifiedIso),
        });

        if (action === 'noop') {
            _state = 'synced';
            _lastFailureMessage = null;
            emitStateChange();
            return 'noop';
        }

        if (action === 'diverged') {
            disarmAutoSync('diverged');
            emitStateChange();
            return 'diverged';
        }

        if (action === 'push') {
            // Pre-push race re-check: another device may have pushed between
            // the debounce schedule and now. Re-query Drive and bail to the
            // decision tree if it moved — silent-overwrite of a fresh remote
            // version is the worst outcome auto-sync can have.
            return queryLatestDriveFile(token).then(function(recheck) {
                const recheckFile = recheck && recheck[0] ? recheck[0] : null;
                const recheckIso = recheckFile ? recheckFile.modifiedTime : null;
                updateCachedDriveModifiedTime(recheckIso);
                if (isDriveAhead(localSyncedIso, recheckIso)) {
                    _inFlight = false;
                    return performAutoSync();
                }
                return exportTodosToDrive().then(function() {
                    _state = 'synced';
                    _lastFailureMessage = null;
                    emitStateChange();
                    return 'pushed';
                });
            });
        }

        if (action === 'pull') {
            return importTodosFromDrive(_onRebuildAfterImport, { silent: true }).then(function() {
                _state = 'synced';
                _lastFailureMessage = null;
                emitStateChange();
                return 'pulled';
            });
        }

        return 'noop';
    }).catch(function(err) {
        const message = (err && err.message) || 'auto-sync error';
        disarmAutoSync('failed', message);
        emitStateChange();
        return 'failed';
    }).then(function(result) {
        _inFlight = false;
        return result;
    }, function(err) {
        _inFlight = false;
        throw err;
    });
}


// ── APP LOAD ──

// Called once at boot from main.js. Attempts a silent re-auth against
// Google Identity Services (prompt: 'none' — never shows UI). If GIS can
// issue a token because the user has a valid prior grant on this browser,
// the cached token gets established here, the loop arms itself, and a
// normal sync attempt runs against the just-loaded data — returning users
// in good standing see green within a few hundred ms of load, zero clicks.
//
// If silent re-auth fails (no prior grant, expired, signed out of Google,
// network offline), the rejection is swallowed: no popup, no toast, no
// console error. The loop stays dormant and the user re-arms via the
// explicit "Connect to Drive" menu row.
//
// Auth-time failures are intentionally distinct from sync-time failures —
// only the latter disarm the loop and surface 'failed' state. A silent
// re-auth that just isn't possible yet is the normal first-time-user path.
export function autoSyncOnAppLoad() {
    return getAccessToken({ silent: true }).then(function() {
        _armed = true;
        return performAutoSync();
    }, function() {
        return 'no-token';
    });
}


// ── BACKGROUND TRIGGERS ──
//
// Beyond the boot-time silent re-auth and the per-mutation debounce, three
// background triggers feed performAutoSync() so a tab left open on Device B
// notices when Device A has pushed a fresh version to Drive:
//
//   1. visibilitychange → 'visible': catches tab returns after sleep / OS
//      app-switch / phone screen-on. The common case where a user picks the
//      phone back up after editing on the laptop.
//   2. window focus: desktop-tab-switch backstop. Some browsers fire focus
//      but not visibilitychange when the user switches between tabs in the
//      same window.
//   3. 60s setInterval, gated on document.visibilityState === 'visible':
//      catches devices left open in the foreground while another device
//      pushes — without this, a static visible tab never re-queries.
//
// All three short-circuit when getCachedAccessToken() returns null so the
// triggers can never open an OAuth popup — with no cached token they're
// silent no-ops. The existing _inFlight guard in performAutoSync()
// coalesces near-simultaneous triggers (visibilitychange + focus on a
// desktop tab return) into one Drive query.
//
// The poll's visibility gate lives inside the callback rather than around
// the interval registration so a hidden→visible transition resumes the
// poll without tearing down and recreating the timer.
//
// Idempotent — calling twice tears down the previous listeners and interval
// before reinstalling, so the boot path can't leave duplicate triggers
// behind if it ever runs more than once.
export function installAutoSyncBackgroundTriggers() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    _uninstallBackgroundTriggers();

    _visibilityChangeListener = function() {
        if (document.visibilityState !== 'visible') return;
        if (!getCachedAccessToken()) return;
        performAutoSync().catch(function() { /* silent — performAutoSync handles its own failure modes */ });
    };
    document.addEventListener('visibilitychange', _visibilityChangeListener);

    _focusListener = function() {
        if (!getCachedAccessToken()) return;
        performAutoSync().catch(function() { /* silent */ });
    };
    window.addEventListener('focus', _focusListener);

    _pollIntervalId = setInterval(function() {
        if (document.visibilityState !== 'visible') return;
        if (!getCachedAccessToken()) return;
        performAutoSync().catch(function() { /* silent */ });
    }, AUTO_SYNC_POLL_INTERVAL_MS);
}

function _uninstallBackgroundTriggers() {
    if (_visibilityChangeListener && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', _visibilityChangeListener);
    }
    _visibilityChangeListener = null;
    if (_focusListener && typeof window !== 'undefined') {
        window.removeEventListener('focus', _focusListener);
    }
    _focusListener = null;
    if (_pollIntervalId) {
        clearInterval(_pollIntervalId);
        _pollIntervalId = null;
    }
}
