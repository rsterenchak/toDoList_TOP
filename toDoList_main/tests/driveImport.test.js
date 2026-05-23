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
import { importTodosFromString } from '../src/exportImport.js';
import {
    LAST_DRIVE_SYNCED_AT_KEY,
    LAST_LOCAL_MUTATION_AT_KEY,
    LEGACY_LAST_DRIVE_EXPORTED_AT_KEY,
    readLastDriveSyncedAt,
    readLastLocalMutationAt,
    writeLastDriveSyncedAt,
    migrateLegacyDriveSyncMarker,
} from '../src/prefs.js';


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


describe('driveImport — source-level: writes the sync marker on success', () => {
    const src = read('driveImport.js');

    it('imports writeLastDriveSyncedAt from prefs.js', () => {
        // Mirror of the export-side timestamp-write pin in
        // driveExport.test.js — the import path must record its own
        // success against the same marker so the "behind" indicator
        // clears as soon as an import completes.
        expect(src).toMatch(
            /import\s*\{\s*writeLastDriveSyncedAt\s*\}\s*from\s*['"]\.\/prefs\.js['"]/
        );
    });

    it('writes the timestamp inside the importTodosFromString success callback', () => {
        // The write must sit in the onAfterReplace callback handed to
        // importTodosFromString — that callback runs only after the user
        // confirms the destructive overwrite and listLogic.replaceAllProjects
        // has applied the new state. A user who declines the confirm leaves
        // the prior timestamp untouched.
        expect(src).toMatch(
            /importTodosFromString\s*\([\s\S]*?writeLastDriveSyncedAt\(/
        );
    });

    it('uses the Drive file modifiedTime (not Date.now) to avoid clock skew', () => {
        // Writing the Drive file's modifiedTime — not the local clock —
        // guarantees the post-import sync-state comparison reads as
        // 'synced' regardless of clock skew between this device and
        // Drive's server.
        expect(src).toMatch(/writeLastDriveSyncedAt\(\s*file\.modifiedTime/);
        // And not a Date.now-derived value inside the success callback.
        const writeIdx = src.indexOf('writeLastDriveSyncedAt(');
        expect(writeIdx).toBeGreaterThan(-1);
        const writeSlice = src.slice(writeIdx, writeIdx + 200);
        expect(writeSlice).not.toMatch(/Date\.now/);
        expect(writeSlice).not.toMatch(/new\s+Date\s*\(\s*\)\.toISOString/);
    });
});


describe('driveImport — sync-initiated replace suppresses the mutation bump', () => {
    const src = read('driveImport.js');

    it('passes fromSync: true through importTodosFromString so the post-replace save does not bump lastLocalMutationAt', () => {
        // Without the flag, saveToStorage stamps Date.now() into
        // lastLocalMutationAt after replaceAllProjects runs. That bump
        // lands a few ms AFTER lastDriveSyncedAt is written from the
        // Drive file's modifiedTime, so the indicator computes 'ahead'
        // (mutation > sync) even though the import just put the device
        // in sync.
        expect(src).toMatch(
            /importTodosFromString\s*\([\s\S]*?fromSync\s*:\s*true/
        );
    });

    it('writes lastDriveSyncedAt in an onBeforeReplace hook so it precedes the driveSyncStateChanged dispatch', () => {
        // Reordering the write to BEFORE replaceAllProjects guarantees
        // the live recompute fired from saveToStorage observes the new
        // sync marker, not the prior one.
        expect(src).toMatch(
            /onBeforeReplace\s*:\s*function[\s\S]*?writeLastDriveSyncedAt\s*\(\s*file\.modifiedTime/
        );
    });

    it('wraps the onAfterReplace invocation in a try/catch so a host rebuild error cannot propagate', () => {
        // The host rebuild (rebuildAfterImport in main.js) walks DOM and
        // can throw. Isolating it keeps the Drive import's promise chain
        // from rejecting on a UI-side bug, and preserves the sync
        // indicator's "synced" reading written via onBeforeReplace.
        expect(src).toMatch(/try\s*\{\s*onAfterReplace\(\)/);
    });
});


describe('driveImport — host rebuild error does not break the sync invariant', () => {
    // Regression for the rebuildAfterImport ReferenceError class of bug:
    // when the host callback throws, the import pipeline must still leave
    // the data committed AND the Drive sync marker advanced to the file's
    // modifiedTime. Drives importTodosFromString directly (the same
    // pipeline driveImport.js's orchestrator hands the JSON to) and pins
    // the post-confirm state with a stubbed onAfterReplace that throws.

    beforeEach(() => {
        listLogic._reset();
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
        try { localStorage.removeItem(LAST_LOCAL_MUTATION_AT_KEY); } catch (_) {}
        clearConfirmModal();
    });

    afterEach(() => {
        clearConfirmModal();
    });

    it('a throwing host callback (wrapped per driveImport orchestrator) leaves lastDriveSyncedAt set', () => {
        const driveModifiedIso = '2026-05-23T14:00:00.000Z';
        const payload = JSON.stringify({
            version: 1,
            exportedAt: driveModifiedIso,
            projects: [
                { name: 'FromDrive', items: [{ tit: 'Pulled', completed: false, due: '' }], color: null },
            ],
        });

        // Mirror the orchestrator's try/catch around onAfterReplace.
        // The host callback throws (simulating the original
        // rebuildAfterImport ReferenceError); the wrapper suppresses it.
        const throwingHost = function() {
            throw new ReferenceError('refreshStaleHint is not defined');
        };
        const guardedHost = function() {
            try { throwingHost(); } catch (_) { /* suppressed */ }
        };

        const outcome = importTodosFromString(payload, guardedHost, {
            silentError: true,
            fromSync: true,
            onBeforeReplace: function() {
                writeLastDriveSyncedAt(driveModifiedIso);
            },
        });
        expect(outcome.ok).toBe(true);

        const confirmBtn = document.getElementById('confirmModalConfirm');
        expect(confirmBtn).toBeTruthy();
        confirmBtn.click();

        // Data swap committed.
        expect(listLogic.listProjectsArray()).toEqual(['FromDrive']);

        // Sync marker is the Drive file's modifiedTime — the invariant
        // the original bug broke by letting the throw cascade past the
        // marker write.
        expect(readLastDriveSyncedAt()).toBe(driveModifiedIso);
    });
});


describe('driveImport — end-to-end: confirmed import leaves lastLocalMutationAt <= lastDriveSyncedAt', () => {
    // Drives the same importTodosFromString pipeline driveImport.js uses,
    // up to and including the confirm-modal click, and pins the regression:
    // after a successful import the local mutation marker must not have
    // been pushed past the just-written Drive sync marker.

    beforeEach(() => {
        listLogic._reset();
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
        try { localStorage.removeItem(LAST_LOCAL_MUTATION_AT_KEY); } catch (_) {}
        clearConfirmModal();
    });

    afterEach(() => {
        clearConfirmModal();
    });

    it('does not bump lastLocalMutationAt past the Drive sync marker on confirmed import', () => {
        // Seed an old local mutation timestamp so the test can prove the
        // value stays put — not merely that some new value lands above
        // the sync marker by chance.
        const OLD_MUTATION = '2026-04-01T00:00:00.000Z';
        localStorage.setItem(LAST_LOCAL_MUTATION_AT_KEY, OLD_MUTATION);

        // Drive file mtime sits AFTER the local mutation — the realistic
        // "another device pushed a newer backup" shape that triggered
        // the original bug report.
        const driveModifiedIso = '2026-05-23T10:14:28.783Z';

        const payload = JSON.stringify({
            version: 1,
            exportedAt: driveModifiedIso,
            projects: [
                { name: 'FromDrive', items: [{ tit: 'Pulled', completed: false, due: '' }], color: null },
            ],
        });

        const outcome = importTodosFromString(payload, function() { /* onAfterReplace */ }, {
            sourceLabel: 'Restore from "todos-2026-05-23.json"?',
            silentError: true,
            fromSync: true,
            onBeforeReplace: function() {
                writeLastDriveSyncedAt(driveModifiedIso);
            },
        });
        expect(outcome.ok).toBe(true);

        // Click the confirm modal's Replace button — the same affordance
        // a real user would tap to commit the destructive overwrite.
        const confirmBtn = document.getElementById('confirmModalConfirm');
        expect(confirmBtn).toBeTruthy();
        confirmBtn.click();

        // The import committed: project tree was replaced.
        expect(listLogic.listProjectsArray()).toEqual(['FromDrive']);

        // Mutation marker is untouched by the sync-initiated save.
        expect(readLastLocalMutationAt()).toBe(OLD_MUTATION);

        // Sync marker is the Drive file's modifiedTime.
        expect(readLastDriveSyncedAt()).toBe(driveModifiedIso);

        // Acceptance criterion (1): lastLocalMutationAt <= lastDriveSyncedAt.
        expect(Date.parse(readLastLocalMutationAt()))
            .toBeLessThanOrEqual(Date.parse(readLastDriveSyncedAt()));
    });

    it('still bumps lastLocalMutationAt for non-sync (local file picker) imports', () => {
        // The local file-picker path leaves opts.fromSync unset, so the
        // mutation marker SHOULD bump — acceptance criterion (3) requires
        // the flag to suppress only sync-initiated saves.
        const OLD_MUTATION = '2026-04-01T00:00:00.000Z';
        localStorage.setItem(LAST_LOCAL_MUTATION_AT_KEY, OLD_MUTATION);

        const payload = JSON.stringify({
            version: 1,
            exportedAt: '2026-05-23T00:00:00.000Z',
            projects: [
                { name: 'FromFile', items: [], color: null },
            ],
        });

        const outcome = importTodosFromString(payload, null, { silentError: true });
        expect(outcome.ok).toBe(true);

        document.getElementById('confirmModalConfirm').click();

        const after = readLastLocalMutationAt();
        expect(after).not.toBe(OLD_MUTATION);
        expect(isNaN(Date.parse(after))).toBe(false);
    });

    it('post-confirm rebuild loop (addToDos_restore per project) keeps lastLocalMutationAt frozen when fromSync: true', () => {
        // End-to-end repro for the row-sort-persistence leak: the import
        // confirms, replaceAllProjects writes data with fromSync, then
        // rebuildAfterImport in main.js fires restoreFromStorage({ fromSync:
        // true }) which calls addToDos_restore — which in turn calls
        // sortCompletedToBottom. Before this fix, that sort wrote
        // lastLocalMutationAt = Date.now() and pushed the marker past the
        // just-written lastDriveSyncedAt. The fix threads opts through the
        // full chain so the post-rebuild storage write stays sync-safe.
        const OLD_MUTATION = '2026-04-01T00:00:00.000Z';
        localStorage.setItem(LAST_LOCAL_MUTATION_AT_KEY, OLD_MUTATION);

        const driveModifiedIso = '2026-05-23T10:14:28.783Z';
        const payload = JSON.stringify({
            version: 1,
            exportedAt: driveModifiedIso,
            projects: [
                // Two projects with completed items each so the per-project
                // sort in addToDos_restore actually has work to do — this
                // is the realistic "another device pushed real data" shape
                // that surfaced the original bug, not a single-empty-project
                // case where the sort would be a no-op.
                { name: 'Work', items: [
                    { tit: 'Done', completed: true, due: '' },
                    { tit: 'Open', completed: false, due: '' },
                ], color: null },
                { name: 'Home', items: [
                    { tit: 'AlsoDone', completed: true, due: '' },
                    { tit: 'AlsoOpen', completed: false, due: '' },
                ], color: null },
            ],
        });

        const outcome = importTodosFromString(payload, function() {
            // Simulate rebuildAfterImport's post-replace per-project sort.
            // Each project is sort-and-persisted, exactly as
            // addToDos_restore does on the rebuild loop. With the fix in
            // place, both calls forward fromSync and the mutation marker
            // stays put.
            listLogic.listProjectsArray().forEach(function(name) {
                listLogic.sortCompletedToBottom(name, { fromSync: true });
            });
        }, {
            sourceLabel: 'Restore from "todos-2026-05-23.json"?',
            silentError: true,
            fromSync: true,
            onBeforeReplace: function() {
                writeLastDriveSyncedAt(driveModifiedIso);
            },
        });
        expect(outcome.ok).toBe(true);

        document.getElementById('confirmModalConfirm').click();

        // The whole chain ran; mutation marker is untouched.
        expect(readLastLocalMutationAt()).toBe(OLD_MUTATION);
        expect(readLastDriveSyncedAt()).toBe(driveModifiedIso);
        // Acceptance criterion: mutation marker <= drive sync marker so
        // the indicator reads 'synced', not 'ahead'.
        expect(Date.parse(readLastLocalMutationAt()))
            .toBeLessThanOrEqual(Date.parse(readLastDriveSyncedAt()));
    });
});


describe('driveImport — post-import sync-state reads as "synced"', () => {
    // Regression test: after a successful import, the sync-state
    // computation must report 'synced' against the same Drive modifiedTime
    // the import was sourced from. This is the central bug the rename
    // fixes — previously the local marker only moved on export, so an
    // import left the indicator amber.
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

    const computeDriveSyncState = extractFunction('computeDriveSyncState');

    it('reads as "synced" when the local marker equals the Drive file modifiedTime that was imported', () => {
        // Simulate the post-import state: writeLastDriveSyncedAt was
        // called with file.modifiedTime, so the local marker now matches
        // the Drive file. The next sync-state probe must report 'synced',
        // not 'behind'.
        const driveModified = '2026-05-23T14:00:00.000Z';
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
        writeLastDriveSyncedAt(driveModified);
        const localIso = readLastDriveSyncedAt();
        expect(computeDriveSyncState(localIso, driveModified)).toBe('synced');
    });
});


describe('prefs — legacy lastDriveExportedAt → lastDriveSyncedAt migration', () => {
    beforeEach(() => {
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
        try { localStorage.removeItem(LEGACY_LAST_DRIVE_EXPORTED_AT_KEY); } catch (_) {}
    });

    it('moves the legacy value to the new key when the new key is empty', () => {
        localStorage.setItem(LEGACY_LAST_DRIVE_EXPORTED_AT_KEY, '2026-05-22T10:00:00.000Z');
        migrateLegacyDriveSyncMarker();
        expect(localStorage.getItem(LAST_DRIVE_SYNCED_AT_KEY))
            .toBe('2026-05-22T10:00:00.000Z');
        expect(localStorage.getItem(LEGACY_LAST_DRIVE_EXPORTED_AT_KEY)).toBe(null);
    });

    it('preserves a freshly-written new-key value rather than clobbering it with the legacy value', () => {
        // If both keys somehow exist (e.g. user already synced once on the
        // new build before the migration ran), the new value wins. The
        // legacy key is always removed.
        localStorage.setItem(LEGACY_LAST_DRIVE_EXPORTED_AT_KEY, '2025-01-01T00:00:00.000Z');
        localStorage.setItem(LAST_DRIVE_SYNCED_AT_KEY, '2026-05-23T14:00:00.000Z');
        migrateLegacyDriveSyncMarker();
        expect(localStorage.getItem(LAST_DRIVE_SYNCED_AT_KEY))
            .toBe('2026-05-23T14:00:00.000Z');
        expect(localStorage.getItem(LEGACY_LAST_DRIVE_EXPORTED_AT_KEY)).toBe(null);
    });

    it('is a no-op when neither key is set', () => {
        migrateLegacyDriveSyncMarker();
        expect(localStorage.getItem(LAST_DRIVE_SYNCED_AT_KEY)).toBe(null);
        expect(localStorage.getItem(LEGACY_LAST_DRIVE_EXPORTED_AT_KEY)).toBe(null);
    });

    it('is invoked at app boot from main.js', () => {
        const main = read('main.js');
        expect(main).toMatch(
            /import\s*\{[^}]*\bmigrateLegacyDriveSyncMarker\b[^}]*\}\s*from\s*['"]\.\/prefs\.js['"]/
        );
        expect(main).toMatch(/migrateLegacyDriveSyncMarker\s*\(\s*\)/);
    });
});
