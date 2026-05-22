// Export to Google Drive — uploads the same JSON payload as the local
// "Export JSON" action to the user's Drive root using the Google Identity
// Services OAuth flow.
//
// ── PROVISIONING ──
//
// A fresh fork must provide its own OAuth Client ID before this feature
// works at runtime. Steps:
//
// 1. Create (or reuse) a Google Cloud project at
//    https://console.cloud.google.com/.
// 2. In APIs & Services → OAuth consent screen, configure the consent
//    screen for "External" user type. Add your contact email and the
//    deployment origin. No scope upgrades are needed — drive.file is in
//    the non-sensitive tier and avoids Google's security review process.
// 3. In APIs & Services → Credentials, create an OAuth 2.0 Client ID of
//    type "Web application". Under "Authorized JavaScript origins", add
//    the origins this app is served from (e.g.,
//    https://<github-username>.github.io for a GitHub Pages deploy and
//    http://localhost:8080 for local development).
// 4. Copy the Client ID and assign it to OAUTH_CLIENT_ID below. Do NOT
//    check in a Client ID that belongs to a private project — each fork
//    owns its own credential.
//
// ── DESIGN NOTES ──
//
// Scope used: `https://www.googleapis.com/auth/drive.file`. Stays in the
// non-sensitive tier — grants access only to files this app itself
// uploads, never the user's broader Drive.
//
// Token lifecycle: tokens are kept in-memory for the lifetime of the page.
// They are never persisted to localStorage. When a token expires
// (~1 hour after grant), the next upload triggers a fresh sign-in popup.
//
// The Google Identity Services script is lazy-loaded on first click —
// mirrors music.js's YouTube IFrame API loader so a CDN failure or a
// user who never opens the menu pays no upfront cost.

import { buildExportPayload, buildBaseExportFilename } from './exportImport.js';

// Empty default — set this to your own OAuth Client ID in a fork. When
// empty, the menu item shows a "not configured" toast instead of opening
// the OAuth popup, so the rest of the app keeps working out of the box.
export const OAUTH_CLIENT_ID = '';

const GIS_SCRIPT_ID = 'gisClientScript';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_UPLOAD_URL =
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_S = 3600;

let _gisPromise = null;
let _cachedToken = null;
let _tokenExpiresAt = 0;
let _activeUpload = false;


// ── LAZY LOADER ──
//
// Resolves once the GIS library has registered `window.google.accounts.oauth2`.
// Module-level promise so concurrent calls don't queue duplicate <script> tags.
export function loadGisLibrary(doc) {
    if (typeof window === 'undefined' || !doc) return Promise.reject(new Error('no window'));
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        return Promise.resolve(window.google);
    }
    if (_gisPromise) return _gisPromise;

    _gisPromise = new Promise(function(resolve, reject) {
        const onReady = function() {
            if (window.google && window.google.accounts && window.google.accounts.oauth2) {
                resolve(window.google);
            } else {
                reject(new Error('GIS loaded without oauth2 client'));
            }
        };

        const prior = doc.getElementById(GIS_SCRIPT_ID);
        if (prior) {
            prior.addEventListener('load', onReady);
            prior.addEventListener('error', function() { reject(new Error('failed to load GIS')); });
            return;
        }

        try {
            const tag = doc.createElement('script');
            tag.id = GIS_SCRIPT_ID;
            tag.src = GIS_SCRIPT_SRC;
            tag.async = true;
            tag.defer = true;
            tag.onload = onReady;
            tag.onerror = function() { reject(new Error('failed to load GIS')); };
            (doc.head || doc.body || doc.documentElement).appendChild(tag);
        } catch (e) {
            reject(e);
        }
    });
    return _gisPromise;
}

// Test helpers — let tests reset the singleton state between runs.
export function _resetGisPromise() { _gisPromise = null; }
export function _resetCachedToken() { _cachedToken = null; _tokenExpiresAt = 0; }
export function isDriveExportInProgress() { return _activeUpload; }


function tokenStillValid() {
    return !!_cachedToken && Date.now() < _tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS;
}


// ── OAUTH ──
//
// Acquire an access token. Returns the cached token when still valid, else
// opens the GIS popup. The `prompt: ''` flag lets GIS skip the consent
// screen when the user has already granted consent in this session.
export function getAccessToken() {
    if (tokenStillValid()) return Promise.resolve(_cachedToken);
    return loadGisLibrary(document).then(function(google) {
        return new Promise(function(resolve, reject) {
            const tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: OAUTH_CLIENT_ID,
                scope: DRIVE_SCOPE,
                callback: function(response) {
                    if (response && response.error) {
                        reject(new Error(response.error_description || response.error));
                        return;
                    }
                    if (!response || !response.access_token) {
                        reject(new Error('No access token returned'));
                        return;
                    }
                    _cachedToken = response.access_token;
                    const expiresIn = parseInt(response.expires_in, 10);
                    const lifetimeS = isNaN(expiresIn) ? DEFAULT_TOKEN_LIFETIME_S : expiresIn;
                    _tokenExpiresAt = Date.now() + lifetimeS * 1000;
                    resolve(_cachedToken);
                },
            });
            tokenClient.requestAccessToken({ prompt: '' });
        });
    });
}


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


// ── TOAST ──
//
// Singleton success / error toast. Mirrors the importErrorToast pattern but
// supports a `webViewLink` affordance on success. A separate id from the
// import toast so the two don't clobber each other when they collide.
export function showDriveToast(opts) {
    const prior = document.getElementById('driveExportToast');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const toast = document.createElement('div');
    toast.id = 'driveExportToast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    if (opts && opts.error) toast.classList.add('driveExportToast--error');

    const label = document.createElement('span');
    label.className = 'driveExportToastLabel';
    label.textContent = (opts && opts.label) || '';
    toast.appendChild(label);

    if (opts && opts.linkHref) {
        const a = document.createElement('a');
        a.className = 'driveExportToastLink';
        a.href = opts.linkHref;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'Open in Drive';
        toast.appendChild(a);
    }

    document.body.appendChild(toast);
    const lifeMs = (opts && opts.linkHref) ? 6000 : 4000;
    setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, lifeMs);

    return toast;
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
