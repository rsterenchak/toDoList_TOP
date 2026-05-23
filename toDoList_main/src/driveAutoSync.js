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

import { getCachedAccessToken } from './driveAuth.js';
import { queryLatestDriveFile, importTodosFromDrive } from './driveImport.js';
import { exportTodosToDrive } from './driveExport.js';
import { readLastDriveSyncedAt, readLastLocalMutationAt } from './prefs.js';

export const AUTO_SYNC_DEBOUNCE_MS = 10 * 1000;

let _armed = false;
let _debounceTimer = null;
let _state = 'idle';
let _lastFailureMessage = null;
let _onRebuildAfterImport = null;
let _inFlight = false;

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
    if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
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

// Called once at boot from main.js. If a cached token exists, runs a sync
// attempt silently (without ever opening the OAuth popup) so a user
// returning to a tab with stale data sees the right state on load. Without
// a cached token this is a no-op — the user re-arms with a manual click.
export function autoSyncOnAppLoad() {
    const token = getCachedAccessToken();
    if (!token) return Promise.resolve('no-token');
    _armed = true;
    return performAutoSync();
}
