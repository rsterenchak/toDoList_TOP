// Shared Google Drive OAuth + Google Identity Services helper.
//
// Both the export-to-Drive and import-from-Drive code paths sign in with
// the same `drive.file` scope and reuse the same in-memory token cache —
// this module owns that lifecycle so the two surfaces never wind up with
// duplicate <script> tags, divergent token caches, or two different
// "Drive" toasts on screen at once.
//
// ── PROVISIONING ──
//
// A fresh fork must provide its own OAuth Client ID before either Drive
// feature works at runtime. Steps:
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
// 4. Expose the Client ID to the build as the `GOOGLE_OAUTH_CLIENT_ID`
//    environment variable. Webpack's DefinePlugin substitutes it into
//    OAUTH_CLIENT_ID below at compile time. The value is never checked
//    into source — each fork owns its own credential.
//      • Production (GitHub Pages): add `GOOGLE_OAUTH_CLIENT_ID` as a
//        repository secret and wire it into the deploy workflow's build
//        step.
//      • Local development: `export GOOGLE_OAUTH_CLIENT_ID=…` in the
//        shell before `npm start`. Without it, the menu items surface a
//        "not configured" toast and the rest of the app keeps working.
//
// ── DESIGN NOTES ──
//
// Scope used: `https://www.googleapis.com/auth/drive.file`. Stays in the
// non-sensitive tier — grants access only to files this app itself
// uploads, never the user's broader Drive. The same grant is reused for
// import: files this app created are already visible under this scope
// without any rescope.
//
// Token lifecycle: tokens are kept in-memory for the lifetime of the page.
// They are never persisted to localStorage. When a token expires
// (~1 hour after grant), the next call triggers a fresh sign-in popup.
//
// The Google Identity Services script is lazy-loaded on first call —
// mirrors music.js's YouTube IFrame API loader so a CDN failure or a
// user who never opens the menu pays no upfront cost.

// Injected at build time from the `GOOGLE_OAUTH_CLIENT_ID` environment
// variable via Webpack's DefinePlugin. Empty by default — when empty, the
// menu items show a "not configured" toast instead of opening the OAuth
// popup, so a fresh clone, a fork without the env var, and the test suite
// all keep working out of the box.
export const OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const GIS_SCRIPT_ID = 'gisClientScript';
const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_S = 3600;

let _gisPromise = null;
let _cachedToken = null;
let _tokenExpiresAt = 0;


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


function tokenStillValid() {
    return !!_cachedToken && Date.now() < _tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS;
}

// Non-prompting read of the in-memory access token. Returns the cached token
// when one is still valid for this session; returns null when no cached
// token exists or the cached one has expired. Used by the Drive sync-state
// indicator to query Drive on app load without ever popping an OAuth
// consent screen — if the user hasn't signed in this session yet, the
// indicator stays in the `unknown` state until they take a Drive action.
export function getCachedAccessToken() {
    return tokenStillValid() ? _cachedToken : null;
}


// ── OAUTH ──
//
// Acquire an access token. Returns the cached token when still valid, else
// opens the GIS popup. The `prompt: ''` flag lets GIS skip the consent
// screen when the user has already granted consent in this session — so
// importing right after exporting in the same session reuses the grant
// silently.
//
// `opts.silent: true` swaps the prompt for `'none'`, which asks Google to
// issue a token without ever showing UI. If the user has no prior grant on
// this browser, the grant has expired, or they're signed out of Google,
// GIS reports the error through the callback and the returned Promise
// rejects — there's no popup either way. The app-load auto-sync trigger
// uses this variant so a returning user in good standing gets zero-click
// sync, and a fresh user fails silently with no surprise consent screen.
export function getAccessToken(opts) {
    const silent = !!(opts && opts.silent);
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
            tokenClient.requestAccessToken({ prompt: silent ? 'none' : '' });
        });
    });
}


// ── TOAST ──
//
// Singleton success / error toast for any Drive-side notification. Both
// export and import use the same element so the two surfaces can never
// stack two toasts on top of each other when they collide. The CSS that
// styles `#driveExportToast` (kept under that id for back-compat) applies
// to imports too — visually consistent.
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
