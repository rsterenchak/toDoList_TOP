// Import from Google Drive — pulls the most recently modified backup
// this app uploaded to the user's Drive and feeds the raw JSON through
// the same parse-validate-apply pipeline the local "Import JSON" path
// uses. No new validation, no new confirmation primitive — the Drive
// flow only owns the auth + fetch shim; the rest of the work is shared.
//
// The drive.file scope already granted for export covers import: the
// Drive list query implicitly restricts to files this app created, so
// no rescope is needed.

import { importTodosFromString } from './exportImport.js';
import { writeLastDriveSyncedAt } from './prefs.js';
import {
    OAUTH_CLIENT_ID,
    getAccessToken,
    showDriveToast,
} from './driveAuth.js';

const DRIVE_LIST_URL =
    'https://www.googleapis.com/drive/v3/files'
    + '?q=trashed%3Dfalse'
    + '&orderBy=modifiedTime+desc'
    + '&pageSize=1'
    + '&fields=files(id%2Cname%2CmodifiedTime)';

function buildDriveDownloadUrl(fileId) {
    return 'https://www.googleapis.com/drive/v3/files/'
        + encodeURIComponent(fileId) + '?alt=media';
}

let _activeImport = false;

export function isDriveImportInProgress() { return _activeImport; }


// ── DRIVE QUERIES ──
//
// Fetch the most recently modified Drive file this app created (the
// drive.file scope's implicit filter handles the "only this app's files"
// requirement). Resolves with the parsed `files` array (zero or one
// element under pageSize=1).
export function queryLatestDriveFile(token) {
    return fetch(DRIVE_LIST_URL, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
    }).then(function(response) {
        if (!response.ok) {
            return response.text().then(function(text) {
                throw new Error('Drive list failed: ' + response.status + ' ' + text);
            });
        }
        return response.json();
    }).then(function(payload) {
        return (payload && Array.isArray(payload.files)) ? payload.files : [];
    });
}


// Download the raw bytes of a Drive file as text. Resolves with the
// response body as a string — the caller is responsible for handing it
// to the import pipeline for parse + validate.
export function downloadDriveFile(fileId, token) {
    return fetch(buildDriveDownloadUrl(fileId), {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
    }).then(function(response) {
        if (!response.ok) {
            return response.text().then(function(text) {
                throw new Error('Drive download failed: ' + response.status + ' ' + text);
            });
        }
        return response.text();
    });
}


// ── HELPERS ──
//
// Local-format the Drive modifiedTime so the confirm prompt reads like
// "your backup, 5 minutes ago" instead of an opaque ISO stamp. Falls
// back gracefully when the field is missing or unparseable.
function formatDriveModifiedTime(iso) {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (isNaN(t)) return iso;
    try {
        return new Date(t).toLocaleString();
    } catch (_) {
        return iso;
    }
}

function describeDriveBackup(file) {
    const name = (file && file.name) || 'backup';
    const when = formatDriveModifiedTime(file && file.modifiedTime);
    if (when) return 'Restore from "' + name + '" (last modified ' + when + ')?';
    return 'Restore from "' + name + '"?';
}


// ── ORCHESTRATOR ──
//
// Drives the full flow: ensure token → list latest → bail or confirm →
// download → hand off to shared import pipeline → success toast. The
// document body picks up a `driveImportInProgress` class for the
// duration of the auth + query + download so the menu item (if the user
// re-opens the menu) renders its dim/disabled state via CSS.
export function importTodosFromDrive(onAfterReplace) {

    if (!OAUTH_CLIENT_ID) {
        showDriveToast({
            label: 'Drive import not configured for this build.',
            error: true,
        });
        return Promise.reject(new Error('OAUTH_CLIENT_ID not configured'));
    }

    if (_activeImport) return Promise.resolve(null);
    _activeImport = true;
    if (typeof document !== 'undefined' && document.body) {
        document.body.classList.add('driveImportInProgress');
    }

    function clearActive() {
        _activeImport = false;
        if (typeof document !== 'undefined' && document.body) {
            document.body.classList.remove('driveImportInProgress');
        }
    }

    return getAccessToken()
        .then(function(token) {
            return queryLatestDriveFile(token).then(function(files) {
                if (!files.length) {
                    showDriveToast({ label: 'No Drive backups found' });
                    clearActive();
                    return null;
                }
                const file = files[0];
                return downloadDriveFile(file.id, token).then(function(text) {
                    // Hand off auth-side cleanup before the confirm
                    // modal opens — once the JSON is in hand, the user's
                    // decision and the eventual replaceAllProjects call
                    // belong to the local import pipeline, not the
                    // Drive-side in-progress guard.
                    clearActive();
                    const outcome = importTodosFromString(
                        text,
                        function() {
                            // Mark this device as synced with the Drive
                            // file we just pulled. Using Drive's
                            // modifiedTime (not Date.now()) means the
                            // post-import sync-state comparison reads as
                            // 'synced' regardless of clock skew between
                            // this device and Drive's server. Written
                            // unconditionally on success — even a no-op
                            // restore should clear the "behind" indicator
                            // since the local state is by definition in
                            // sync with that Drive file.
                            if (file && file.modifiedTime) {
                                writeLastDriveSyncedAt(file.modifiedTime);
                            }
                            showDriveToast({ label: 'Imported from Drive' });
                            if (typeof onAfterReplace === 'function') onAfterReplace();
                        },
                        {
                            sourceLabel: describeDriveBackup(file),
                            silentError: true,
                        }
                    );
                    if (!outcome.ok) {
                        showDriveToast({
                            label: outcome.error || "Couldn't import from Drive — try again.",
                            error: true,
                        });
                    }
                    return file;
                });
            });
        })
        .catch(function(err) {
            const message = (err && err.message) || '';
            const cancelled = /denied|cancel|popup_closed/i.test(message);
            showDriveToast({
                label: cancelled
                    ? 'Drive import cancelled.'
                    : "Couldn't import from Drive — try again.",
                error: true,
            });
            clearActive();
            throw err;
        });
}
