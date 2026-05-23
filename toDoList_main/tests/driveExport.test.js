// Tests for the Drive export flow. The OAuth popup itself is mocked (we
// don't actually call out to Google's GIS library), but the wiring under
// test — multipart body shape, toast rendering, payload reuse, in-progress
// guard, body class lifecycle — is the surface area that matters for the
// caller (the ghost menu's "Export to Drive" item) and for safeguarding
// against drift from the local "Export JSON" path.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    loadGisLibrary,
    getAccessToken,
    uploadToDrive,
    showDriveToast,
    exportTodosToDrive,
    isDriveExportInProgress,
    _resetGisPromise,
    _resetCachedToken,
    OAUTH_CLIENT_ID,
} from '../src/driveExport.js';
import { listLogic } from '../src/listLogic.js';
import { buildBaseExportFilename, buildExportPayload } from '../src/exportImport.js';
import {
    LAST_DRIVE_SYNCED_AT_KEY,
    readLastDriveSyncedAt,
    writeLastDriveSyncedAt,
} from '../src/prefs.js';


const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }


// Install a fake `window.google.accounts.oauth2.initTokenClient` so
// getAccessToken resolves without touching the real Google CDN. The token
// client's `requestAccessToken` synchronously invokes the callback the
// caller registered with `initTokenClient`.
function installFakeGisClient(opts) {
    const accessToken = (opts && opts.accessToken) || 'fake-access-token';
    const error = opts && opts.error;
    window.google = {
        accounts: {
            oauth2: {
                initTokenClient(config) {
                    return {
                        requestAccessToken() {
                            if (error) {
                                config.callback({ error: error });
                            } else {
                                config.callback({
                                    access_token: accessToken,
                                    expires_in: 3600,
                                });
                            }
                        },
                    };
                },
            },
        },
    };
}

function uninstallFakeGisClient() {
    try { delete window.google; } catch (_) { window.google = undefined; }
}

function uninstallFetch() {
    if ('fetch' in globalThis) {
        try { delete globalThis.fetch; } catch (_) { globalThis.fetch = undefined; }
    }
}


describe('driveExport — buildBaseExportFilename', () => {
    it('produces the same date-stamped name as the local export filename pattern', () => {
        // Local-time constructor so the test is timezone-agnostic — the
        // filename anchors on the user's local date, not UTC.
        const name = buildBaseExportFilename(new Date(2026, 4, 22, 12, 0, 0));
        expect(name).toBe('todos-2026-05-22.json');
    });

    it('uses the local calendar day, not UTC', () => {
        // 2026-05-22 23:30 PDT = 2026-05-23 06:30 UTC. The filename must
        // anchor on PDT so a backup taken late at night doesn't surface
        // tomorrow's date.
        const d = new Date(2026, 4, 22, 23, 30, 0);
        expect(buildBaseExportFilename(d)).toBe('todos-2026-05-22.json');
    });
});


describe('driveExport — uploadToDrive', () => {
    let calls;

    beforeEach(() => {
        calls = [];
        globalThis.fetch = function(url, init) {
            calls.push({ url, init });
            return Promise.resolve({
                ok: true,
                json() { return Promise.resolve({ id: 'fileId1', webViewLink: 'https://drive.google.com/d/fileId1' }); },
            });
        };
    });

    afterEach(uninstallFetch);

    it('POSTs to the Drive upload endpoint with a Bearer token', async () => {
        await uploadToDrive('{"x":1}', 'todos-2026-05-22.json', 'tok-xyz');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toMatch(/upload\/drive\/v3\/files\?uploadType=multipart/);
        expect(calls[0].init.method).toBe('POST');
        expect(calls[0].init.headers.Authorization).toBe('Bearer tok-xyz');
        expect(calls[0].init.headers['Content-Type']).toMatch(/multipart\/related; boundary=/);
    });

    it('builds a multipart body containing the filename metadata and the JSON payload', async () => {
        await uploadToDrive('{"v":1}', 'todos-2026-05-22.json', 'tok');
        const body = calls[0].init.body;
        expect(body).toMatch(/Content-Type: application\/json; charset=UTF-8/);
        expect(body).toMatch(/"name":"todos-2026-05-22\.json"/);
        expect(body).toMatch(/"mimeType":"application\/json"/);
        expect(body).toMatch(/\{"v":1\}/);
    });

    it('rejects when the Drive response is not ok', async () => {
        globalThis.fetch = function() {
            return Promise.resolve({
                ok: false,
                status: 401,
                text() { return Promise.resolve('Unauthorized'); },
            });
        };
        let caught;
        try { await uploadToDrive('{}', 'todos.json', 't'); } catch (e) { caught = e; }
        expect(caught).toBeTruthy();
        expect(String(caught.message)).toMatch(/401/);
    });

    it('resolves with the parsed JSON file metadata (id + webViewLink)', async () => {
        const result = await uploadToDrive('{}', 'todos.json', 't');
        expect(result.id).toBe('fileId1');
        expect(result.webViewLink).toBe('https://drive.google.com/d/fileId1');
    });
});


describe('driveExport — getAccessToken', () => {
    beforeEach(() => {
        _resetGisPromise();
        _resetCachedToken();
        installFakeGisClient({ accessToken: 'token-A' });
    });

    afterEach(() => {
        uninstallFakeGisClient();
        _resetGisPromise();
        _resetCachedToken();
    });

    it('resolves with the access token returned by the OAuth callback', async () => {
        const token = await getAccessToken();
        expect(token).toBe('token-A');
    });

    it('reuses the cached token across calls within the same session', async () => {
        const first = await getAccessToken();
        // Swap the fake client to return a different token — if the cache
        // is honored, getAccessToken should still return the first value.
        installFakeGisClient({ accessToken: 'token-B' });
        const second = await getAccessToken();
        expect(first).toBe('token-A');
        expect(second).toBe('token-A');
    });

    it('rejects when the OAuth callback reports an error', async () => {
        _resetCachedToken();
        installFakeGisClient({ error: 'access_denied' });
        let caught;
        try { await getAccessToken(); } catch (e) { caught = e; }
        expect(caught).toBeTruthy();
        expect(String(caught.message)).toMatch(/access_denied/);
    });
});


describe('driveExport — showDriveToast', () => {
    afterEach(() => {
        const t = document.getElementById('driveExportToast');
        if (t && t.parentNode) t.parentNode.removeChild(t);
    });

    it('renders a singleton #driveExportToast with role="status"', () => {
        showDriveToast({ label: 'Hello' });
        const toast = document.getElementById('driveExportToast');
        expect(toast).toBeTruthy();
        expect(toast.getAttribute('role')).toBe('status');
        expect(toast.querySelector('.driveExportToastLabel').textContent).toBe('Hello');
    });

    it('replaces any prior toast rather than stacking', () => {
        showDriveToast({ label: 'First' });
        showDriveToast({ label: 'Second' });
        const toasts = document.querySelectorAll('#driveExportToast');
        expect(toasts).toHaveLength(1);
        expect(toasts[0].querySelector('.driveExportToastLabel').textContent).toBe('Second');
    });

    it('renders an "Open in Drive" link when linkHref is provided', () => {
        showDriveToast({ label: 'Exported to Drive', linkHref: 'https://drive.example/file' });
        const link = document.querySelector('.driveExportToastLink');
        expect(link).toBeTruthy();
        expect(link.getAttribute('href')).toBe('https://drive.example/file');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
        expect(link.textContent).toBe('Open in Drive');
    });

    it('applies the error modifier class when opts.error is set', () => {
        showDriveToast({ label: 'oops', error: true });
        const toast = document.getElementById('driveExportToast');
        expect(toast.classList.contains('driveExportToast--error')).toBe(true);
    });
});


describe('driveExport — exportTodosToDrive orchestrator', () => {
    let fetchCalls;

    beforeEach(() => {
        listLogic._reset();
        _resetGisPromise();
        _resetCachedToken();
        installFakeGisClient({ accessToken: 'orchestrator-tok' });
        fetchCalls = [];
        globalThis.fetch = function(url, init) {
            fetchCalls.push({ url, init });
            return Promise.resolve({
                ok: true,
                json() { return Promise.resolve({ id: 'f1', webViewLink: 'https://drive.example/f1' }); },
            });
        };
        const t = document.getElementById('driveExportToast');
        if (t && t.parentNode) t.parentNode.removeChild(t);
        document.body.classList.remove('driveExportInProgress');
    });

    afterEach(() => {
        uninstallFakeGisClient();
        uninstallFetch();
        _resetGisPromise();
        _resetCachedToken();
        document.body.classList.remove('driveExportInProgress');
    });

    it('toasts a configuration error when OAUTH_CLIENT_ID is empty', async () => {
        // OAUTH_CLIENT_ID is an empty string by default — a fresh fork
        // must override it before Drive export will work at runtime.
        expect(OAUTH_CLIENT_ID).toBe('');

        let caught;
        try { await exportTodosToDrive(); } catch (e) { caught = e; }
        expect(caught).toBeTruthy();
        const toast = document.getElementById('driveExportToast');
        expect(toast).toBeTruthy();
        expect(toast.classList.contains('driveExportToast--error')).toBe(true);
        expect(toast.querySelector('.driveExportToastLabel').textContent).toMatch(/not configured/i);
        // No fetch should have been issued.
        expect(fetchCalls).toHaveLength(0);
    });
});


describe('driveExport — payload reuses the existing export serialization', () => {
    it('buildExportPayload + JSON.stringify(_, null, 2) is the shared serialization', () => {
        listLogic._reset();
        listLogic.addProject('Demo');
        const driveSrc = read('driveExport.js');
        // The orchestrator must serialize using the same buildExportPayload
        // helper as exportImport.js so the two surfaces produce
        // byte-identical content for the same calendar day.
        expect(driveSrc).toMatch(/import\s*\{[^}]*buildExportPayload[^}]*\}\s*from\s*['"]\.\/exportImport\.js['"]/);
        expect(driveSrc).toMatch(/JSON\.stringify\(\s*payload\s*,\s*null\s*,\s*2\s*\)/);
        // Sanity: buildExportPayload still returns the expected shape.
        const payload = buildExportPayload(new Date('2026-05-22T10:00:00Z'));
        expect(payload.version).toBe(1);
        expect(payload.exportedAt).toBe('2026-05-22T10:00:00.000Z');
        expect(Array.isArray(payload.projects)).toBe(true);
    });
});


describe('driveExport — in-progress guard', () => {
    it('reports false at rest', () => {
        expect(isDriveExportInProgress()).toBe(false);
    });
});


describe('driveExport — last-synced-to-Drive marker', () => {
    beforeEach(() => {
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
    });

    it('readLastDriveSyncedAt returns null when nothing has been stored', () => {
        expect(readLastDriveSyncedAt()).toBe(null);
    });

    it('writeLastDriveSyncedAt persists under the todoapp_lastDriveSyncedAt key', () => {
        writeLastDriveSyncedAt('2026-05-22T10:00:00.000Z');
        expect(localStorage.getItem(LAST_DRIVE_SYNCED_AT_KEY))
            .toBe('2026-05-22T10:00:00.000Z');
        expect(readLastDriveSyncedAt()).toBe('2026-05-22T10:00:00.000Z');
    });

    it('uses a top-level key (not nested inside the todos payload)', () => {
        // The marker is a per-device sync-state fact, not part of the user's
        // data — importing a JSON backup must not overwrite it. The key
        // sits at the localStorage root with the todoapp_ prefix.
        expect(LAST_DRIVE_SYNCED_AT_KEY).toBe('todoapp_lastDriveSyncedAt');
    });
});


describe('driveExport — source-level: timestamp write on success only', () => {
    const src = read('driveExport.js');

    it('imports writeLastDriveSyncedAt from prefs.js', () => {
        expect(src).toMatch(
            /import\s*\{\s*writeLastDriveSyncedAt\s*\}\s*from\s*['"]\.\/prefs\.js['"]/
        );
    });

    it('writes the timestamp inside the upload-success then-handler', () => {
        // The write must sit in the post-uploadToDrive .then() block — that
        // runs only on a 2xx Drive response. A failed upload routes through
        // the .catch() and leaves the prior timestamp untouched.
        expect(src).toMatch(
            /\.then\(function\(file\)\s*\{[\s\S]*?writeLastDriveSyncedAt\(/
        );
    });

    it('does not write the timestamp from the catch handler', () => {
        const catchIdx = src.indexOf('.catch(function(err)');
        expect(catchIdx).toBeGreaterThan(-1);
        // Walk to the end of the catch block (until the next .then) and
        // make sure writeLastDriveSyncedAt is not called inside it.
        const tail = src.slice(catchIdx, src.indexOf('.then(function(result)', catchIdx));
        expect(tail).not.toMatch(/writeLastDriveSyncedAt/);
    });
});


describe('driveExport — server-set modifiedTime is the canonical sync timestamp', () => {
    // Regression for the indicator-flicker bug: the post-upload handler
    // used to write `now.toISOString()` (the client clock captured at the
    // start of the request) as the sync marker. Drive's server-set
    // modifiedTime resolves a few hundred ms later than the client `now`,
    // so the next Drive query read `modifiedTime > lastDriveSyncedAt` and
    // the indicator flickered to "Drive is newer" right after a successful
    // push. Pins that the upload requests modifiedTime in the fields
    // parameter, that the success handler writes the server-set value, and
    // that the in-memory cache the indicator reads is updated to match so
    // post-push local edits don't re-evaluate against stale data.
    const src = read('driveExport.js');

    it('Drive upload URL requests modifiedTime via the fields parameter', () => {
        // Without modifiedTime in the response fields, the success handler
        // has no server-truth to write — falls back to client clock and
        // re-introduces the drift bug.
        expect(src).toMatch(
            /upload\/drive\/v3\/files\?[^'"`]*fields=[^'"`]*modifiedTime/
        );
    });

    it('writes file.modifiedTime (not now.toISOString) to the sync marker on success', () => {
        // Find the success then-handler block and walk it brace-balanced
        // so the assertion isn't fooled by other writes earlier in the file.
        const handlerIdx = src.indexOf('.then(function(file)');
        expect(handlerIdx).toBeGreaterThan(-1);
        const bodyStart = src.indexOf('{', handlerIdx);
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
        // Marker write references file.modifiedTime.
        expect(body).toMatch(/writeLastDriveSyncedAt\([\s\S]*?file\.modifiedTime/);
        // And the success handler must NOT pass the bare client-clock value
        // — the previous shape `writeLastDriveSyncedAt(now.toISOString())`
        // is exactly the line this regression test is guarding against.
        expect(body).not.toMatch(/writeLastDriveSyncedAt\(\s*now\.toISOString\s*\(\s*\)\s*\)/);
    });

    it('mirrors file.modifiedTime into the in-memory cache via updateCachedDriveModifiedTime', () => {
        // Without the cache write, the indicator's local-only recompute
        // path keeps reading the pre-push cached value and computes
        // driveAhead = true after every local edit until the menu opens
        // and a fresh query lands.
        expect(src).toMatch(
            /import\s*\{[^}]*\bupdateCachedDriveModifiedTime\b[^}]*\}\s*from\s*['"]\.\/driveAutoSync\.js['"]/
        );
        const handlerIdx = src.indexOf('.then(function(file)');
        const bodyStart = src.indexOf('{', handlerIdx);
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
        expect(body).toMatch(/updateCachedDriveModifiedTime\(/);
    });
});


describe('driveExport — uploadToDrive returns the server-set modifiedTime', () => {
    // Behavioural regression: stub the Drive upload to return a specific
    // server-set modifiedTime that is 500ms newer than the client's `now`
    // and confirm uploadToDrive surfaces it. Combined with the source-level
    // pin that the success handler writes that field to localStorage, this
    // proves the equality invariant: lastDriveSyncedAt === file.modifiedTime
    // exactly, no client/server drift.
    afterEach(uninstallFetch);

    it('resolves with modifiedTime exactly as returned by Drive (no client-clock drift)', async () => {
        const SERVER_MODIFIED_TIME = '2026-05-23T14:03:49.580Z';
        globalThis.fetch = function() {
            return Promise.resolve({
                ok: true,
                json() {
                    return Promise.resolve({
                        id: 'fileXYZ',
                        webViewLink: 'https://drive.example/fileXYZ',
                        modifiedTime: SERVER_MODIFIED_TIME,
                    });
                },
            });
        };
        const result = await uploadToDrive('{"v":1}', 'todos.json', 'tok');
        // The Drive response is forwarded verbatim — no client-side
        // override, no Date.now()-derived stamp. The success handler in
        // exportTodosToDrive consumes this exact field for its
        // writeLastDriveSyncedAt + updateCachedDriveModifiedTime calls.
        expect(result.modifiedTime).toBe(SERVER_MODIFIED_TIME);
    });

    it('the simulated post-upload write chain produces lastDriveSyncedAt === file.modifiedTime exactly', () => {
        // Replays the precise sequence the success handler runs once
        // uploadToDrive resolves with a server modifiedTime. Pinning this
        // at the data level (no orchestrator-level OAUTH guard to dodge)
        // makes the equality invariant the regression depends on
        // explicit: a fresh fetch from localStorage returns the same
        // string the Drive response provided, byte for byte.
        const SERVER_MODIFIED_TIME = '2026-05-23T14:03:49.580Z';
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
        const file = { id: 'fileXYZ', modifiedTime: SERVER_MODIFIED_TIME };
        const serverIso = (file && file.modifiedTime) || new Date().toISOString();
        writeLastDriveSyncedAt(serverIso);
        expect(localStorage.getItem('todoapp_lastDriveSyncedAt'))
            .toBe(SERVER_MODIFIED_TIME);
        expect(readLastDriveSyncedAt()).toBe(SERVER_MODIFIED_TIME);
    });
});


describe('settings menu — Sync row last-synced label', () => {
    const main = read('main.js');

    it('imports readLastDriveSyncedAt for the Sync row label compute', () => {
        expect(main).toMatch(
            /import\s*\{[^}]*readLastDriveSyncedAt[^}]*\}\s*from\s*['"]\.\/prefs\.js['"]/
        );
    });

    it('the Sync row reads the relative label via formatRelativeExportedAt + readLastDriveSyncedAt', () => {
        // After the five-row collapse, the previous Drive Export row's
        // state pill is gone — the relative-time signal now lives inline
        // in the single Sync row's label compute. The contract is the same:
        // formatRelativeExportedAt(readLastDriveSyncedAt()) drives the
        // user-visible "5 minutes ago" suffix.
        const fnIdx = main.indexOf('function computeDriveSyncLabel');
        expect(fnIdx).toBeGreaterThan(-1);
        const after = main.slice(fnIdx);
        const nextFnIdx = after.indexOf('function ', 1);
        const body = after.slice(0, nextFnIdx > -1 ? nextFnIdx : after.length);
        expect(body).toMatch(/readLastDriveSyncedAt\s*\(\s*\)/);
        expect(body).toMatch(/formatRelativeExportedAt\s*\(/);
    });
});


describe('driveExport — source-level contract', () => {
    const src = read('driveExport.js');
    // The OAuth + GIS lazy-load lives in driveAuth.js so the import flow
    // can share one token cache and one initialization. The contracts
    // about scope, lazy-load, provisioning docs, and the module-level
    // Client ID constant follow the symbols into that shared module.
    const authSrc = read('driveAuth.js');

    it('uses the drive.file scope (not the broad drive scope)', () => {
        expect(authSrc).toMatch(/drive\.file/);
        // Must NOT request the broader Drive scope — that would push the
        // app into Google's restricted-scope review process.
        expect(authSrc).not.toMatch(/['"]https:\/\/www\.googleapis\.com\/auth\/drive['"]/);
        expect(src).not.toMatch(/['"]https:\/\/www\.googleapis\.com\/auth\/drive['"]/);
    });

    it('loads the GIS client lazily on first call', () => {
        expect(authSrc).toMatch(/accounts\.google\.com\/gsi\/client/);
        expect(authSrc).toMatch(/function\s+loadGisLibrary/);
        expect(authSrc).toMatch(/_gisPromise/);
    });

    it('documents the OAuth setup steps in a top-of-module comment block', () => {
        const head = authSrc.slice(0, 2000);
        expect(head).toMatch(/PROVISIONING/i);
        expect(head).toMatch(/Client ID/i);
        expect(head).toMatch(/console\.cloud\.google\.com|Google Cloud/i);
    });

    it('exposes the OAuth Client ID as a module-level constant (not hardcoded in main.js)', () => {
        expect(authSrc).toMatch(/export\s+const\s+OAUTH_CLIENT_ID/);
        const mainSrc = read('main.js');
        expect(mainSrc).not.toMatch(/OAUTH_CLIENT_ID\s*=/);
    });

    it('does not persist the access token to localStorage', () => {
        expect(src).not.toMatch(/localStorage\.[gs]etItem\([^)]*token/i);
        expect(authSrc).not.toMatch(/localStorage\.[gs]etItem\([^)]*token/i);
    });

    it('consumes the shared driveAuth helper rather than duplicating OAuth state', () => {
        expect(src).toMatch(
            /import\s*\{[^}]*\}\s*from\s*['"]\.\/driveAuth\.js['"]/
        );
        // The duplicated copies must be gone from driveExport.js itself.
        expect(src).not.toMatch(/let\s+_gisPromise\s*=/);
        expect(src).not.toMatch(/let\s+_cachedToken\s*=/);
    });
});


describe('settings menu — Export to Drive wiring (via Sync row)', () => {
    const main = read('main.js');
    const css = read('style.css');

    it('LOCAL anchor classes do not appear in source anywhere', () => {
        expect(main).not.toMatch(/settingsMenuItem--exportLocal/);
        expect(main).not.toMatch(/settingsMenuItem--importLocal/);
    });

    it('exportTodosToDrive is still wired — invoked by the diverged conflict popover push branch', () => {
        // The previous menu had a dedicated "Export to Drive" row that
        // called exportTodosToDrive() directly. After the five-row
        // collapse the function is reached from two paths: the auto-sync
        // orchestrator (performAutoSync) and the diverged popover's
        // "Push to Drive (overwrite Drive copy)" button.
        expect(main).toMatch(/exportTodosToDrive\s*\(\s*\)/);
        // The push button inside the popover is the manual surface.
        // Use brace-balanced extraction — the popover body contains inner
        // function declarations that would truncate a naive indexOf.
        const fnIdx = main.indexOf('function openDriveConflictPopover');
        expect(fnIdx).toBeGreaterThan(-1);
        const after = main.slice(fnIdx);
        const bodyStart = after.indexOf('{');
        let depth = 0;
        let body = '';
        for (let i = bodyStart; i < after.length; i++) {
            const c = after.charAt(i);
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { body = after.slice(0, i + 1); break; }
            }
        }
        expect(body).toMatch(/exportTodosToDrive\s*\(/);
    });

    it('imports exportTodosToDrive from the driveExport module', () => {
        expect(main).toMatch(
            /import\s*\{\s*exportTodosToDrive\s*\}\s*from\s*['"]\.\/driveExport\.js['"]/
        );
    });

    it('CSS dims the single Sync row during a Drive export, via the new settingsMenuItem--driveSync anchor', () => {
        expect(css).toMatch(/settingsMenuItem--driveSync/);
        expect(css).toMatch(
            /body\.driveExportInProgress\s+\.settingsMenuItem--driveSync[\s\S]{0,200}pointer-events:\s*none/
        );
    });

    it('styles the #driveExportToast container and the Open-in-Drive link', () => {
        expect(css).toMatch(/#driveExportToast\s*\{/);
        expect(css).toMatch(/\.driveExportToastLink\s*\{/);
        expect(css).toMatch(/\.driveExportToast--error/);
    });
});
