// Export to Google Drive — uploads the same JSON payload as the local
// "Export JSON" action to the user's Drive root using the Google Identity
// Services OAuth flow.
//
// The OAuth + GIS lazy-load and the shared Drive toast live in
// driveAuth.js so the import-from-Drive flow can reuse the same token
// cache and toast singleton. This module is responsible only for the
// export-specific surface area: payload reuse, multipart upload shape,
// success/error toast wording, and the in-progress guard that the menu
// row's dim/disabled styling hangs off of.

import { buildExportPayload, buildBaseExportFilename } from './exportImport.js';
import { writeLastDriveSyncedAt } from './prefs.js';
import {
    OAUTH_CLIENT_ID,
    getAccessToken,
    loadGisLibrary,
    showDriveToast,
    _resetGisPromise,
    _resetCachedToken,
} from './driveAuth.js';

// Re-exported for back-compat with existing callers/tests that imported
// these symbols from this module before the driveAuth.js extraction.
export {
    OAUTH_CLIENT_ID,
    getAccessToken,
    loadGisLibrary,
    showDriveToast,
    _resetGisPromise,
    _resetCachedToken,
};

const DRIVE_UPLOAD_URL =
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';

let _activeUpload = false;

export function isDriveExportInProgress() { return _activeUpload; }


// ── UPLOAD ──
//
// Multipart upload of the JSON payload to Drive. Resolves with the parsed
// JSON response which includes `id` and `webViewLink`.
export function uploadToDrive(json, filename, token) {
    const boundary = 'todoappBoundary' + Math.random().toString(36).slice(2);
    const metadata = { name: filename, mimeType: 'application/json' };
    const body =
        '--' + boundary + '\r\n' +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) + '\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Type: application/json\r\n\r\n' +
        json + '\r\n' +
        '--' + boundary + '--';

    return fetch(DRIVE_UPLOAD_URL, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'multipart/related; boundary=' + boundary,
        },
        body: body,
    }).then(function(response) {
        if (!response.ok) {
            return response.text().then(function(text) {
                throw new Error('Drive upload failed: ' + response.status + ' ' + text);
            });
        }
        return response.json();
    });
}


// ── ORCHESTRATOR ──
//
// Drives the full flow: build payload → ensure token → upload → toast. The
// document body picks up a `driveExportInProgress` class for the duration of
// the in-flight upload so the menu item (if the user re-opens the menu) can
// render its dim/disabled loading state via CSS.
export function exportTodosToDrive() {

    if (!OAUTH_CLIENT_ID) {
        showDriveToast({
            label: 'Drive export not configured for this build.',
            error: true,
        });
        return Promise.reject(new Error('OAUTH_CLIENT_ID not configured'));
    }

    if (_activeUpload) return Promise.resolve(null);
    _activeUpload = true;
    if (typeof document !== 'undefined' && document.body) {
        document.body.classList.add('driveExportInProgress');
    }

    const now = new Date();
    const payload = buildExportPayload(now);
    const json = JSON.stringify(payload, null, 2);
    const filename = buildBaseExportFilename(now);

    return getAccessToken()
        .then(function(token) { return uploadToDrive(json, filename, token); })
        .then(function(file) {
            // Record the successful upload so the ghost menu's Export to
            // Drive row can show a relative "synced N hours ago" label
            // next time the menu opens. Only writes on success — a failed
            // upload leaves the prior timestamp untouched.
            writeLastDriveSyncedAt(now.toISOString());
            showDriveToast({
                label: 'Exported to Drive',
                linkHref: file && file.webViewLink ? file.webViewLink : null,
            });
            return file;
        })
        .catch(function(err) {
            const message = (err && err.message) || '';
            const cancelled = /denied|cancel|popup_closed/i.test(message);
            showDriveToast({
                label: cancelled
                    ? 'Drive export cancelled.'
                    : "Couldn't export to Drive — try again.",
                error: true,
            });
            throw err;
        })
        .then(function(result) {
            _activeUpload = false;
            if (typeof document !== 'undefined' && document.body) {
                document.body.classList.remove('driveExportInProgress');
            }
            return result;
        }, function(err) {
            _activeUpload = false;
            if (typeof document !== 'undefined' && document.body) {
                document.body.classList.remove('driveExportInProgress');
            }
            throw err;
        });
}
