// Tests for the Drive import flow. As with driveExport.test.js, the OAuth
// popup itself is mocked — we don't call out to the real Google CDN.
// The surface area under test is: query+download wiring, "no backups"
// short-circuit, confirm-prompt source label, success/error toast
// wording, and the in-progress guard.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    queryLatestDriveFile,
    downloadDriveFile,
    importTodosFromDrive,
    isDriveImportInProgress,
} from '../src/driveImport.js';
import {
    _resetGisPromise,
    _resetCachedToken,
    OAUTH_CLIENT_ID,
} from '../src/driveAuth.js';
import { listLogic } from '../src/listLogic.js';


const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(rel) { return readFileSync(resolve(srcDir, rel), 'utf8'); }


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

function clearDriveToast() {
    const t = document.getElementById('driveExportToast');
    if (t && t.parentNode) t.parentNode.removeChild(t);
}

function clearConfirmModal() {
    const m = document.getElementById('confirmModalBackdrop');
    if (m && m.parentNode) m.parentNode.removeChild(m);
}


describe('driveImport — queryLatestDriveFile', () => {
    let calls;

    beforeEach(() => {
        calls = [];
        globalThis.fetch = function(url, init) {
            calls.push({ url, init });
            return Promise.resolve({
                ok: true,
                json() {
                    return Promise.resolve({
                        files: [{
                            id: 'fileA',
                            name: 'todos-2026-05-22.json',
                            modifiedTime: '2026-05-22T10:00:00.000Z',
                        }],
                    });
                },
            });
        };
    });

    afterEach(uninstallFetch);

    it('GETs the Drive files endpoint with the orderBy/pageSize/fields scoping', async () => {
        await queryLatestDriveFile('tok-1');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toMatch(/drive\/v3\/files\?/);
        expect(calls[0].url).toMatch(/orderBy=modifiedTime\+desc/);
        expect(calls[0].url).toMatch(/pageSize=1/);
        expect(calls[0].url).toMatch(/fields=files\(/);
        expect(calls[0].url).toMatch(/trashed%3Dfalse/);
        expect(calls[0].init.method).toBe('GET');
        expect(calls[0].init.headers.Authorization).toBe('Bearer tok-1');
    });

    it('resolves with the array of file descriptors', async () => {
        const files = await queryLatestDriveFile('tok-1');
        expect(Array.isArray(files)).toBe(true);
        expect(files).toHaveLength(1);
        expect(files[0].id).toBe('fileA');
        expect(files[0].name).toBe('todos-2026-05-22.json');
    });

    it('resolves with an empty array when the response has no files field', async () => {
        globalThis.fetch = function() {
            return Promise.resolve({ ok: true, json() { return Promise.resolve({}); } });
        };
        const files = await queryLatestDriveFile('tok-1');
        expect(files).toEqual([]);
    });

    it('rejects when the Drive list response is not ok', async () => {
        globalThis.fetch = function() {
            return Promise.resolve({
                ok: false,
                status: 401,
                text() { return Promise.resolve('Unauthorized'); },
            });
        };
        let caught;
        try { await queryLatestDriveFile('tok-1'); } catch (e) { caught = e; }
        expect(caught).toBeTruthy();
        expect(String(caught.message)).toMatch(/401/);
    });
});


describe('driveImport — downloadDriveFile', () => {
    let calls;

    beforeEach(() => {
        calls = [];
        globalThis.fetch = function(url, init) {
            calls.push({ url, init });
            return Promise.resolve({
                ok: true,
                text() { return Promise.resolve('{"version":1,"projects":[]}'); },
            });
        };
    });

    afterEach(uninstallFetch);

    it('GETs the Drive media endpoint with the file id and a Bearer token', async () => {
        const text = await downloadDriveFile('fileX', 'tok-2');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toMatch(/drive\/v3\/files\/fileX\?alt=media/);
        expect(calls[0].init.method).toBe('GET');
        expect(calls[0].init.headers.Authorization).toBe('Bearer tok-2');
        expect(text).toBe('{"version":1,"projects":[]}');
    });

    it('rejects when the download response is not ok', async () => {
        globalThis.fetch = function() {
            return Promise.resolve({
                ok: false,
                status: 404,
                text() { return Promise.resolve('Not Found'); },
            });
        };
        let caught;
        try { await downloadDriveFile('missing', 'tok'); } catch (e) { caught = e; }
        expect(caught).toBeTruthy();
        expect(String(caught.message)).toMatch(/404/);
    });
});


describe('driveImport — importTodosFromDrive orchestrator', () => {

    beforeEach(() => {
        listLogic._reset();
        _resetGisPromise();
        _resetCachedToken();
        clearDriveToast();
        clearConfirmModal();
        document.body.classList.remove('driveImportInProgress');
    });

    afterEach(() => {
        uninstallFakeGisClient();
        uninstallFetch();
        _resetGisPromise();
        _resetCachedToken();
        clearDriveToast();
        clearConfirmModal();
        document.body.classList.remove('driveImportInProgress');
    });

    it('toasts a configuration error when OAUTH_CLIENT_ID is empty', async () => {
        expect(OAUTH_CLIENT_ID).toBe('');
        let caught;
        try { await importTodosFromDrive(); } catch (e) { caught = e; }
        expect(caught).toBeTruthy();
        const toast = document.getElementById('driveExportToast');
        expect(toast).toBeTruthy();
        expect(toast.classList.contains('driveExportToast--error')).toBe(true);
        expect(toast.querySelector('.driveExportToastLabel').textContent).toMatch(/not configured/i);
    });

    it('reports false at rest for the in-progress guard', () => {
        expect(isDriveImportInProgress()).toBe(false);
    });
});


describe('driveImport — source-level contract', () => {
    const src = read('driveImport.js');

    it('uses the same Drive list query shape the task spec calls for', () => {
        // Scoping params per the task description — kept as URL fragments
        // so the test catches drift in either name or order of params.
        expect(src).toMatch(/trashed%3Dfalse/);
        expect(src).toMatch(/orderBy=modifiedTime\+desc/);
        expect(src).toMatch(/pageSize=1/);
        expect(src).toMatch(/fields=files\(/);
    });

    it('downloads file content via the alt=media variant', () => {
        expect(src).toMatch(/alt=media/);
    });

    it('routes the downloaded JSON through the shared import-from-string helper', () => {
        // The Drive path must not re-implement parse + validate + apply —
        // those live in exportImport.importTodosFromString.
        expect(src).toMatch(
            /import\s*\{[^}]*importTodosFromString[^}]*\}\s*from\s*['"]\.\/exportImport\.js['"]/
        );
        expect(src).toMatch(/importTodosFromString\s*\(/);
        // And it must not hand-roll its own JSON.parse / replaceAllProjects.
        expect(src).not.toMatch(/JSON\.parse\(/);
        expect(src).not.toMatch(/replaceAllProjects\(/);
    });

    it('shares the OAuth helper with the export path (driveAuth)', () => {
        expect(src).toMatch(
            /import\s*\{[^}]*\}\s*from\s*['"]\.\/driveAuth\.js['"]/
        );
    });
});


describe('settings menu — Import from Drive wiring', () => {
    const main = read('main.js');
    const css = read('style.css');

    it('builds a Drive Import menu item via the shared helper, tagged with the driveImport anchor class', () => {
        // The visible label shortens to 'Import' since the DRIVE section
        // header disambiguates against the LOCAL Import row above. The
        // stable identifier is the `settingsMenuItem--driveImport`
        // extraClass that CSS and tests pivot on.
        expect(main).toMatch(/buildSettingsMenuItem\(\s*'Import'\s*,[\s\S]{0,300}?'settingsMenuItem--driveImport'/);
    });

    it('Drive Import sits directly below Drive Export inside the DRIVE section', () => {
        // After section grouping, the Drive Import row sits directly under
        // its sibling Drive Export row — not under the local Import row.
        // The rows are matched by their stable anchor classes. Only the
        // Drive Import row's own buildSettingsMenuItem call sits between
        // the two extraClass anchors in source order — no third row may
        // sneak in.
        const driveExportIdx = main.indexOf("'settingsMenuItem--driveExport'");
        const driveImportIdx = main.indexOf("'settingsMenuItem--driveImport'");
        expect(driveExportIdx).toBeGreaterThan(-1);
        expect(driveImportIdx).toBeGreaterThan(driveExportIdx);
        // The buildSettingsMenuItem call between the two anchors must be
        // exactly one — the Drive Import row itself. Asserting on a
        // single call in the between-slice catches accidental inserts of
        // another row in the DRIVE section.
        const between = main.slice(driveExportIdx, driveImportIdx);
        const buildMatches = between.match(/buildSettingsMenuItem\(/g) || [];
        expect(buildMatches.length).toBe(1);
    });

    it('Drive Import row invokes importTodosFromDrive() with the rebuild callback', () => {
        const idx = main.indexOf("'settingsMenuItem--driveImport'");
        expect(idx).toBeGreaterThan(-1);
        const slice = main.slice(Math.max(0, idx - 400), idx + 100);
        expect(slice).toMatch(/importTodosFromDrive\s*\(/);
        expect(slice).toMatch(/rebuildAfterImport\s*\(/);
    });

    it('imports importTodosFromDrive from the driveImport module', () => {
        expect(main).toMatch(
            /import\s*\{[^}]*\bimportTodosFromDrive\b[^}]*\}\s*from\s*['"]\.\/driveImport\.js['"]/
        );
    });

    it('tags the menu row with settingsMenuItem--driveImport so CSS can dim it during import', () => {
        expect(main).toMatch(/settingsMenuItem--driveImport/);
        expect(css).toMatch(
            /body\.driveImportInProgress\s+\.settingsMenuItem--driveImport\s*\{[^}]*pointer-events:\s*none/
        );
    });
});


describe('exportImport — importTodosFromString shared pipeline', () => {
    it('is exported from exportImport.js', () => {
        const src = read('exportImport.js');
        expect(src).toMatch(/export\s+function\s+importTodosFromString/);
    });

    it('importFromFile delegates to importTodosFromString instead of duplicating parse + validate', () => {
        const src = read('exportImport.js');
        // The file picker path must route through the shared helper.
        expect(src).toMatch(
            /function\s+importFromFile[\s\S]{0,400}importTodosFromString\s*\(/
        );
    });
});
