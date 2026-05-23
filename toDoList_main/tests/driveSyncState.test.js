// Tests for the localAhead extension of the Drive sync-state indicator.
// The indicator originally tracked only "is Drive newer than the last
// successful sync?" — this suite pins the second axis: "has the user
// edited locally since the last sync?". `lastLocalMutationAt` is written
// from listLogic.js's saveToStorage funnel so every persisting mutation
// updates it, and a `driveSyncStateChanged` CustomEvent on `document`
// signals the indicator's render loop to re-evaluate the local-only
// branch without re-issuing the Drive query.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    LAST_LOCAL_MUTATION_AT_KEY,
    LAST_DRIVE_SYNCED_AT_KEY,
    readLastLocalMutationAt,
    writeLastLocalMutationAt,
} from '../src/prefs.js';
import { listLogic } from '../src/listLogic.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}


// ── KEY + HELPERS PINS ───────────────────────────────────────────────
describe('prefs — lastLocalMutationAt helpers', () => {
    beforeEach(() => {
        try { localStorage.removeItem(LAST_LOCAL_MUTATION_AT_KEY); } catch (_) {}
    });

    it('exports the canonical localStorage key', () => {
        expect(LAST_LOCAL_MUTATION_AT_KEY).toBe('todoapp_lastLocalMutationAt');
    });

    it('readLastLocalMutationAt returns null when nothing is stored', () => {
        expect(readLastLocalMutationAt()).toBeNull();
    });

    it('writeLastLocalMutationAt / readLastLocalMutationAt round-trip an ISO string', () => {
        const iso = '2026-05-23T18:30:00.000Z';
        writeLastLocalMutationAt(iso);
        expect(readLastLocalMutationAt()).toBe(iso);
    });
});


// ── saveToStorage WRITES THE MARKER + DISPATCHES THE EVENT ───────────
describe('listLogic.saveToStorage — local mutation marker + event', () => {
    beforeEach(() => {
        listLogic._reset();
        try { localStorage.removeItem(LAST_LOCAL_MUTATION_AT_KEY); } catch (_) {}
    });

    function dispatchedEventCount(fn) {
        let count = 0;
        const handler = () => { count++; };
        document.addEventListener('driveSyncStateChanged', handler);
        try { fn(); } finally {
            document.removeEventListener('driveSyncStateChanged', handler);
        }
        return count;
    }

    it('writes lastLocalMutationAt when saveToStorage is called directly', () => {
        listLogic.saveToStorage();
        const stored = readLastLocalMutationAt();
        expect(stored).not.toBeNull();
        // Must parse as a valid Date — the comparison logic uses Date.parse.
        expect(isNaN(Date.parse(stored))).toBe(false);
    });

    it('dispatches a driveSyncStateChanged CustomEvent on document', () => {
        const count = dispatchedEventCount(() => {
            listLogic.saveToStorage();
        });
        expect(count).toBe(1);
    });

    it('addProject updates the local mutation marker', () => {
        listLogic.saveToStorage(); // baseline timestamp
        const before = readLastLocalMutationAt();
        // Force a measurable gap so the second timestamp is strictly newer
        // even on machines whose Date.now resolution rounds aggressively.
        const baseline = before ? Date.parse(before) - 1 : 0;
        writeLastLocalMutationAt(new Date(baseline).toISOString());
        listLogic.addProject('Groceries');
        const after = Date.parse(readLastLocalMutationAt());
        expect(after).toBeGreaterThan(baseline);
    });

    it('addToDo updates the local mutation marker', () => {
        listLogic.addProject('Groceries');
        writeLastLocalMutationAt('1970-01-01T00:00:00.000Z');
        listLogic.addToDo('Groceries', 'Milk');
        const after = Date.parse(readLastLocalMutationAt());
        expect(after).toBeGreaterThan(0);
    });

    it('removeProject updates the local mutation marker', () => {
        listLogic.addProject('Groceries');
        writeLastLocalMutationAt('1970-01-01T00:00:00.000Z');
        listLogic.removeProject('Groceries');
        const after = Date.parse(readLastLocalMutationAt());
        expect(after).toBeGreaterThan(0);
    });

    it('removeToDoByItem updates the local mutation marker', () => {
        listLogic.addProject('Groceries');
        listLogic.addToDo('Groceries', 'Milk');
        const item = listLogic.listItems('Groceries').find(i => i.tit === 'Milk');
        writeLastLocalMutationAt('1970-01-01T00:00:00.000Z');
        listLogic.removeToDoByItem('Groceries', item);
        const after = Date.parse(readLastLocalMutationAt());
        expect(after).toBeGreaterThan(0);
    });

    it('editProject updates the local mutation marker', () => {
        listLogic.addProject('Old');
        writeLastLocalMutationAt('1970-01-01T00:00:00.000Z');
        listLogic.editProject('Old', 'New');
        const after = Date.parse(readLastLocalMutationAt());
        expect(after).toBeGreaterThan(0);
    });

    it('sortCompletedToBottom (completion-toggle funnel) updates the local mutation marker', () => {
        // The row checkbox handler mutates item.completed directly and then
        // calls listLogic.sortCompletedToBottom which routes through
        // saveToStorage. Pin that funnel writes the marker, since the
        // checkbox handler doesn't write it itself.
        listLogic.addProject('Groceries');
        listLogic.addToDo('Groceries', 'Milk');
        writeLastLocalMutationAt('1970-01-01T00:00:00.000Z');
        listLogic.sortCompletedToBottom('Groceries');
        const after = Date.parse(readLastLocalMutationAt());
        expect(after).toBeGreaterThan(0);
    });

    it('reorderProject updates the local mutation marker', () => {
        listLogic.addProject('A');
        listLogic.addProject('B');
        writeLastLocalMutationAt('1970-01-01T00:00:00.000Z');
        listLogic.reorderProject(0, 1);
        const after = Date.parse(readLastLocalMutationAt());
        expect(after).toBeGreaterThan(0);
    });

    it('reorderToDo updates the local mutation marker', () => {
        listLogic.addProject('Groceries');
        listLogic.addToDo('Groceries', 'Milk');
        listLogic.addToDo('Groceries', 'Bread');
        writeLastLocalMutationAt('1970-01-01T00:00:00.000Z');
        listLogic.reorderToDo('Groceries', 0, 1);
        const after = Date.parse(readLastLocalMutationAt());
        expect(after).toBeGreaterThan(0);
    });
});


// ── FOUR-WAY STATE MATRIX (computeDriveSyncState 3-arg form) ─────────
describe('Drive sync indicator — computeDriveSyncState with lastLocalMutationAt', () => {
    const main = read('main.js');

    function extractFunction(name) {
        const idx = main.indexOf('function ' + name);
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

    const SYNCED  = '2026-05-23T10:00:00.000Z';
    const OLDER   = '2026-05-23T09:00:00.000Z';
    const NEWER   = '2026-05-23T11:00:00.000Z';

    it('returns "synced" when neither timestamp has drifted past the sync marker', () => {
        // driveModified <= lastDriveSyncedAt and lastLocalMutationAt <= lastDriveSyncedAt
        expect(computeDriveSyncState(SYNCED, OLDER, OLDER)).toBe('synced');
        expect(computeDriveSyncState(SYNCED, SYNCED, SYNCED)).toBe('synced');
    });

    it('returns "ahead" when only lastLocalMutationAt has moved past the sync marker', () => {
        // localAhead = true, driveAhead = false
        expect(computeDriveSyncState(SYNCED, OLDER, NEWER)).toBe('ahead');
        expect(computeDriveSyncState(SYNCED, SYNCED, NEWER)).toBe('ahead');
    });

    it('returns "behind" when only driveModifiedTime has moved past the sync marker', () => {
        // localAhead = false, driveAhead = true
        expect(computeDriveSyncState(SYNCED, NEWER, OLDER)).toBe('behind');
        expect(computeDriveSyncState(SYNCED, NEWER, SYNCED)).toBe('behind');
    });

    it('folds the diverged case (both ahead) into "behind"', () => {
        // localAhead = true AND driveAhead = true — spec says pull first,
        // so the indicator surfaces 'behind' rather than 'ahead' or a
        // separate diverged state.
        expect(computeDriveSyncState(SYNCED, NEWER, NEWER)).toBe('behind');
    });

    it('returns "ahead" against a null Drive modifiedTime when local has drifted', () => {
        // The cached Drive modifiedTime is null between app load and the
        // first successful query. Local edits in that window should still
        // surface as 'ahead' against the existing sync marker.
        expect(computeDriveSyncState(SYNCED, null, NEWER)).toBe('ahead');
    });

    it('keeps the original two-argument call sites working unchanged', () => {
        // Pin backwards compatibility: when no localMutationIso is passed,
        // the function behaves the same as before — driveAhead alone
        // controls the synced/behind split, and the never/unknown
        // branches are preserved.
        expect(computeDriveSyncState(SYNCED, SYNCED)).toBe('synced');
        expect(computeDriveSyncState(SYNCED, NEWER)).toBe('behind');
        expect(computeDriveSyncState(null, null)).toBe('never');
        expect(computeDriveSyncState('bad-date', SYNCED)).toBe('unknown');
    });
});


// ── LIVE RECOMPUTE LISTENER WIRING ───────────────────────────────────
describe('Drive sync indicator — live recompute on driveSyncStateChanged', () => {
    const main = read('main.js');

    it('registers a document listener for the driveSyncStateChanged event', () => {
        expect(main).toMatch(
            /document\.addEventListener\s*\(\s*['"]driveSyncStateChanged['"]/
        );
    });

    it('defines a recomputeDriveSyncStateLocal helper that the listener calls', () => {
        expect(main).toMatch(/function\s+recomputeDriveSyncStateLocal\s*\(/);
    });

    it('recompute helper does not re-issue the Drive query', () => {
        // The local-edit tick must only re-evaluate the localAhead branch
        // against the cached driveModifiedTime — never re-fetch from
        // Drive, since saveToStorage runs on every mutation and a
        // network call here would be expensive and racy.
        const idx = main.indexOf('function recomputeDriveSyncStateLocal');
        expect(idx).toBeGreaterThan(-1);
        const openBrace = main.indexOf('{', idx);
        let depth = 0;
        let end = main.length;
        for (let i = openBrace; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
        const body = main.slice(openBrace, end);
        expect(body).not.toMatch(/queryLatestDriveFile/);
        expect(body).not.toMatch(/getCachedAccessToken/);
    });

    it('reads the cached drive modifiedTime variable rather than re-querying', () => {
        const idx = main.indexOf('function recomputeDriveSyncStateLocal');
        const openBrace = main.indexOf('{', idx);
        let depth = 0;
        let end = main.length;
        for (let i = openBrace; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
        const body = main.slice(openBrace, end);
        expect(body).toMatch(/_driveModifiedTimeCache/);
        expect(body).toMatch(/readLastLocalMutationAt/);
        expect(body).toMatch(/readLastDriveSyncedAt/);
    });

    it('refreshDriveSyncState seeds the cached modifiedTime so the listener has something to compare against', () => {
        const idx = main.indexOf('function refreshDriveSyncState');
        const fn = main.slice(idx, idx + 2000);
        expect(fn).toMatch(/_driveModifiedTimeCache\s*=/);
    });
});


// ── INTEGRATION: saveToStorage → listener → recompute ────────────────
describe('Drive sync indicator — end-to-end local-edit signal', () => {
    beforeEach(() => {
        listLogic._reset();
        try { localStorage.removeItem(LAST_LOCAL_MUTATION_AT_KEY); } catch (_) {}
        try { localStorage.removeItem(LAST_DRIVE_SYNCED_AT_KEY); } catch (_) {}
    });

    it('every saveToStorage call delivers exactly one driveSyncStateChanged event', () => {
        let count = 0;
        const handler = () => { count++; };
        document.addEventListener('driveSyncStateChanged', handler);
        try {
            listLogic.addProject('Groceries');         // 1
            listLogic.addToDo('Groceries', 'Milk');    // 2
            listLogic.addToDo('Groceries', 'Bread');   // 3
            listLogic.editProject('Groceries', 'Food'); // 4
        } finally {
            document.removeEventListener('driveSyncStateChanged', handler);
        }
        expect(count).toBe(4);
    });

    it('the local mutation marker advances past lastDriveSyncedAt after an edit', () => {
        // The bug: "the indicator silently stays green even though local
        // state is now ahead of Drive". After a sync and then a local
        // edit, lastLocalMutationAt must end up strictly greater than
        // lastDriveSyncedAt so the recompute can see the drift.
        writeLastLocalMutationAt('1970-01-01T00:00:00.000Z');
        const syncedIso = '1970-01-01T00:00:01.000Z';
        try { localStorage.setItem(LAST_DRIVE_SYNCED_AT_KEY, syncedIso); } catch (_) {}
        listLogic.addProject('After-sync edit');
        const mutationMs = Date.parse(readLastLocalMutationAt());
        const syncedMs   = Date.parse(syncedIso);
        expect(mutationMs).toBeGreaterThan(syncedMs);
    });
});
