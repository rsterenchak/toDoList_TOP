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
    LAST_DRIVE_EXPORTED_AT_KEY,
    readLastDriveExportedAt,
    writeLastDriveExportedAt,
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


describe('driveExport — last-exported-to-Drive marker', () => {
    beforeEach(() => {
        try { localStorage.removeItem(LAST_DRIVE_EXPORTED_AT_KEY); } catch (_) {}
    });

    it('readLastDriveExportedAt returns null when nothing has been stored', () => {
        expect(readLastDriveExportedAt()).toBe(null);
    });

    it('writeLastDriveExportedAt persists under the todoapp_lastDriveExportedAt key', () => {
        writeLastDriveExportedAt('2026-05-22T10:00:00.000Z');
        expect(localStorage.getItem(LAST_DRIVE_EXPORTED_AT_KEY))
            .toBe('2026-05-22T10:00:00.000Z');
        expect(readLastDriveExportedAt()).toBe('2026-05-22T10:00:00.000Z');
    });

    it('uses a top-level key (not nested inside the todos payload)', () => {
        // The marker is a per-device sync-state fact, not part of the user's
        // data — importing a JSON backup must not overwrite it. The key
        // sits at the localStorage root with the todoapp_ prefix.
        expect(LAST_DRIVE_EXPORTED_AT_KEY).toBe('todoapp_lastDriveExportedAt');
    });
});


describe('driveExport — source-level: timestamp write on success only', () => {
    const src = read('driveExport.js');

    it('imports writeLastDriveExportedAt from prefs.js', () => {
        expect(src).toMatch(
            /import\s*\{\s*writeLastDriveExportedAt\s*\}\s*from\s*['"]\.\/prefs\.js['"]/
        );
    });

    it('writes the timestamp inside the upload-success then-handler', () => {
        // The write must sit in the post-uploadToDrive .then() block — that
        // runs only on a 2xx Drive response. A failed upload routes through
        // the .catch() and leaves the prior timestamp untouched.
        expect(src).toMatch(
            /\.then\(function\(file\)\s*\{[\s\S]*?writeLastDriveExportedAt\(/
        );
    });

    it('does not write the timestamp from the catch handler', () => {
        const catchIdx = src.indexOf('.catch(function(err)');
        expect(catchIdx).toBeGreaterThan(-1);
        // Walk to the end of the catch block (until the next .then) and
        // make sure writeLastDriveExportedAt is not called inside it.
        const tail = src.slice(catchIdx, src.indexOf('.then(function(result)', catchIdx));
        expect(tail).not.toMatch(/writeLastDriveExportedAt/);
    });
});


describe('settings menu — Export to Drive last-exported label', () => {
    const main = read('main.js');

    it('imports readLastDriveExportedAt alongside readLastExportedAt', () => {
        expect(main).toMatch(
            /import\s*\{[^}]*readLastDriveExportedAt[^}]*\}\s*from\s*['"]\.\/prefs\.js['"]/
        );
    });

    it('passes the relative label into the Export to Drive state pill', () => {
        // Mirror of the Export JSON pin in lastExportedFooter.test.js — the
        // second arg to buildSettingsMenuItem('Export to Drive', …) must be
        // the formatted relative label so the user sees how stale their
        // last Drive backup is at the moment of action.
        const driveIdx = main.indexOf("'Export to Drive'");
        expect(driveIdx).toBeGreaterThan(-1);
        const slice = main.slice(driveIdx, driveIdx + 400);
        expect(slice).toMatch(/formatRelativeExportedAt\s*\(\s*readLastDriveExportedAt\(\)\s*\)/);
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


describe('settings menu — Export to Drive wiring', () => {
    const main = read('main.js');
    const css = read('style.css');

    it('builds an "Export to Drive" menu item via the shared helper', () => {
        expect(main).toMatch(/buildSettingsMenuItem\(\s*'Export to Drive'\s*,/);
    });

    it('Export to Drive sits between Export JSON and Import JSON', () => {
        const exportIdx = main.indexOf("'Export JSON'");
        const driveIdx  = main.indexOf("'Export to Drive'");
        const importIdx = main.indexOf("'Import JSON'");
        expect(exportIdx).toBeGreaterThan(-1);
        expect(driveIdx).toBeGreaterThan(exportIdx);
        expect(importIdx).toBeGreaterThan(driveIdx);
    });

    it('Export to Drive invokes exportTodosToDrive() directly', () => {
        const idx = main.indexOf("'Export to Drive'");
        expect(idx).toBeGreaterThan(-1);
        const slice = main.slice(idx, idx + 400);
        expect(slice).toMatch(/exportTodosToDrive\s*\(\s*\)/);
    });

    it('imports exportTodosToDrive from the driveExport module', () => {
        expect(main).toMatch(
            /import\s*\{\s*exportTodosToDrive\s*\}\s*from\s*['"]\.\/driveExport\.js['"]/
        );
    });

    it('tags the menu row with settingsMenuItem--driveExport so CSS can dim it during upload', () => {
        expect(main).toMatch(/settingsMenuItem--driveExport/);
        expect(css).toMatch(
            /body\.driveExportInProgress\s+\.settingsMenuItem--driveExport\s*\{[^}]*pointer-events:\s*none/
        );
    });

    it('styles the #driveExportToast container and the Open-in-Drive link', () => {
        expect(css).toMatch(/#driveExportToast\s*\{/);
        expect(css).toMatch(/\.driveExportToastLink\s*\{/);
        expect(css).toMatch(/\.driveExportToast--error/);
    });
});
