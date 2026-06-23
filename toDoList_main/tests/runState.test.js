import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    readActiveRun,
    writeActiveRun,
    clearActiveRun,
    activeProjectNameForViewer,
    ACTIVE_RUN_CHANGE_EVENT,
    RUN_GIVE_UP_MS,
} from '../src/runState.js';

// runState owns the per-project active-run record shared by the TODO.md
// viewer's header pill and the Claude sheet's chat ship path. State is keyed
// per project so a run on one project never affects another, persisted in
// localStorage so it survives navigation/reload, and gated by a give-up window
// so a never-confirmed run can't block a project forever.
describe('runState — per-project active-run state', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    function rec(extra) {
        return Object.assign(
            { correlationId: 'corr-1', project: 'Alpha', dispatchedAt: Date.now() },
            extra || {}
        );
    }

    it('round-trips a record through write → read for the same project', () => {
        writeActiveRun('Alpha', rec());
        const got = readActiveRun('Alpha');
        expect(got).not.toBeNull();
        expect(got.correlationId).toBe('corr-1');
    });

    it('keys state per project — a run on one project does not surface for another', () => {
        writeActiveRun('Alpha', rec({ project: 'Alpha' }));
        expect(readActiveRun('Alpha')).not.toBeNull();
        expect(readActiveRun('Beta')).toBeNull();
    });

    it('persists under a todoapp_-prefixed, project-encoded key', () => {
        writeActiveRun('Pro/ject A', rec({ project: 'Pro/ject A' }));
        const key = 'todoapp_activeRun:' + encodeURIComponent('Pro/ject A');
        expect(localStorage.getItem(key)).toBeTruthy();
    });

    it('clearActiveRun removes the project entry', () => {
        writeActiveRun('Alpha', rec());
        clearActiveRun('Alpha');
        expect(readActiveRun('Alpha')).toBeNull();
    });

    it('rejects a record without a usable correlation id', () => {
        writeActiveRun('Alpha', { project: 'Alpha', dispatchedAt: Date.now() });
        expect(readActiveRun('Alpha')).toBeNull();
        writeActiveRun('Beta', { correlationId: '', project: 'Beta', dispatchedAt: Date.now() });
        expect(readActiveRun('Beta')).toBeNull();
    });

    it('treats a record older than the give-up window as stale: clears it and returns null', () => {
        writeActiveRun('Alpha', rec({ dispatchedAt: Date.now() - (RUN_GIVE_UP_MS + 1000) }));
        const key = 'todoapp_activeRun:' + encodeURIComponent('Alpha');
        expect(localStorage.getItem(key)).toBeTruthy();
        // The stale read returns null AND purges the entry so the guard frees.
        expect(readActiveRun('Alpha')).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('keeps a record still within the give-up window', () => {
        writeActiveRun('Alpha', rec({ dispatchedAt: Date.now() - (RUN_GIVE_UP_MS - 60 * 1000) }));
        expect(readActiveRun('Alpha')).not.toBeNull();
    });

    it('fires a change event naming the project on write and on clear', () => {
        const seen = [];
        const handler = (e) => seen.push(e.detail.project);
        document.addEventListener(ACTIVE_RUN_CHANGE_EVENT, handler);
        writeActiveRun('Alpha', rec());
        clearActiveRun('Alpha');
        document.removeEventListener(ACTIVE_RUN_CHANGE_EVENT, handler);
        expect(seen).toEqual(['Alpha', 'Alpha']);
    });

    it('returns null and does not throw when localStorage is unreadable', () => {
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(readActiveRun('Alpha')).toBeNull();
        spy.mockRestore();
    });
});

describe('runState — activeProjectNameForViewer', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('reads the trimmed value from the selected project input', () => {
        document.body.innerHTML =
            '<div class="selectedProject"><input id="projInput" value="  My Project  "></div>';
        expect(activeProjectNameForViewer()).toBe('My Project');
    });

    it('returns an empty string when no project is selected', () => {
        expect(activeProjectNameForViewer()).toBe('');
    });
});
