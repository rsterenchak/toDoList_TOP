// Regression: returning users on a device with no local cache must not get
// the "Getting started" sample seed or the first-run tour.
//
// bootApp() restores from the local cache before any Supabase data has
// loaded, and the seed/tour decision hangs off the device-scoped
// todoapp_onboardingComplete flag. On a fresh browser, cleared cache, or
// reinstalled PWA that flag is absent for an existing user too, so the seed
// fired, persisted a phantom project to Supabase, and started the tour —
// all before hydration could reveal the user's real projects.
//
// maybeSkipFirstRunForCloudUser closes that gap: it reuses the migration
// module's cheap "does this user own any project?" probe and marks
// onboarding complete when the answer is yes, which suppresses the seed,
// the desktop coachmark tour, and the mobile carousel in one move.

import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { supabase } from '../src/supabaseClient.js';
import {
    maybeSkipFirstRunForCloudUser,
    maybeMigrateLocalToSupabase,
    FIRST_RUN_PROBE_TIMEOUT_MS,
} from '../src/migration.js';
import { ONBOARDING_COMPLETE_KEY } from '../src/prefs.js';

const USER_ID = 'user-abc-123';

// Minimal stand-in for the `.from('projects').select('id').eq(...).limit(1)`
// chain the probe walks. `resolver` returns the promise limit() hands back.
function buildProbeMock(resolver) {
    const calls = [];
    const fromMock = vi.fn(function(table) {
        return {
            select: function() {
                return {
                    eq: function(column, value) {
                        return {
                            limit: function() {
                                calls.push({ table: table, column: column, value: value });
                                return resolver();
                            },
                        };
                    },
                };
            },
            insert: function() {
                return Promise.resolve({ data: null, error: null });
            },
        };
    });
    return { fromMock: fromMock, calls: calls };
}

function resolvesTo(result) {
    return function() { return Promise.resolve(result); };
}

describe('maybeSkipFirstRunForCloudUser', () => {
    let fromSpy;
    let warnSpy;

    beforeEach(() => {
        localStorage.clear();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(function() {});
    });

    afterEach(() => {
        if (fromSpy) fromSpy.mockRestore();
        if (warnSpy) warnSpy.mockRestore();
        fromSpy = null;
        warnSpy = null;
        localStorage.clear();
    });

    it('marks onboarding complete when the signed-in user already owns cloud projects', async () => {
        const mock = buildProbeMock(resolvesTo({ data: [{ id: 'remote-proj-1' }], error: null }));
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        const verdict = await maybeSkipFirstRunForCloudUser(USER_ID);

        expect(verdict).toBe(true);
        expect(localStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBe('true');
        expect(mock.calls.length).toBe(1);
        expect(mock.calls[0].table).toBe('projects');
        expect(mock.calls[0].column).toBe('user_id');
        expect(mock.calls[0].value).toBe(USER_ID);
    });

    it('leaves the flag alone for a genuinely new user so the seed and tour still run', async () => {
        const mock = buildProbeMock(resolvesTo({ data: [], error: null }));
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        const verdict = await maybeSkipFirstRunForCloudUser(USER_ID);

        expect(verdict).toBe(false);
        expect(localStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBeNull();
    });

    it('does not probe when onboarding is already complete on this device', async () => {
        localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
        const mock = buildProbeMock(resolvesTo({ data: [{ id: 'remote-proj-1' }], error: null }));
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        const verdict = await maybeSkipFirstRunForCloudUser(USER_ID);

        expect(verdict).toBeNull();
        expect(mock.fromMock).not.toHaveBeenCalled();
        expect(localStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBe('true');
    });

    it('is a no-op without a userId', async () => {
        const mock = buildProbeMock(resolvesTo({ data: [{ id: 'remote-proj-1' }], error: null }));
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        expect(await maybeSkipFirstRunForCloudUser(null)).toBeNull();
        expect(await maybeSkipFirstRunForCloudUser(undefined)).toBeNull();
        expect(await maybeSkipFirstRunForCloudUser('')).toBeNull();

        expect(mock.fromMock).not.toHaveBeenCalled();
        expect(localStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBeNull();
    });

    it('leaves the flag alone when the probe errors — an unknown answer never suppresses onboarding', async () => {
        const mock = buildProbeMock(resolvesTo({ data: null, error: { code: 'XX000', message: 'boom' } }));
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        const verdict = await maybeSkipFirstRunForCloudUser(USER_ID);

        expect(verdict).toBeNull();
        expect(localStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBeNull();
    });

    it('leaves the flag alone when the probe throws', async () => {
        const mock = buildProbeMock(function() { return Promise.reject(new Error('offline')); });
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        const verdict = await maybeSkipFirstRunForCloudUser(USER_ID);

        expect(verdict).toBeNull();
        expect(localStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBeNull();
    });

    it('gives up after the timeout so a hanging probe can never block the boot render', async () => {
        vi.useFakeTimers();
        try {
            const mock = buildProbeMock(function() { return new Promise(function() { /* never settles */ }); });
            fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

            const pending = maybeSkipFirstRunForCloudUser(USER_ID);
            await vi.advanceTimersByTimeAsync(FIRST_RUN_PROBE_TIMEOUT_MS + 1);
            const verdict = await pending;

            expect(verdict).toBeNull();
            expect(localStorage.getItem(ONBOARDING_COMPLETE_KEY)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('maybeMigrateLocalToSupabase — shared probe verdict', () => {
    let fromSpy;
    let warnSpy;

    beforeEach(() => {
        localStorage.clear();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(function() {});
    });

    afterEach(() => {
        if (fromSpy) fromSpy.mockRestore();
        if (warnSpy) warnSpy.mockRestore();
        fromSpy = null;
        warnSpy = null;
        localStorage.clear();
    });

    it('reuses a supplied cloudHasData verdict instead of probing again', async () => {
        localStorage.setItem('allProjects', JSON.stringify({
            Stale: {
                id: 'proj-stale',
                color: null,
                items: [{ id: 'todo-stale', tit: 'Old', desc: '', due: '', pri: 1, pos: 0 }],
            },
        }));
        const mock = buildProbeMock(resolvesTo({ data: [], error: null }));
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        await maybeMigrateLocalToSupabase(USER_ID, { cloudHasData: true });

        // No probe round-trip, and cloud-wins means the local copy is not uploaded.
        expect(mock.calls.length).toBe(0);
        expect(localStorage.getItem('migrated_user_' + USER_ID)).toBe('true');
    });

    it('still probes on its own when no verdict is supplied', async () => {
        const mock = buildProbeMock(resolvesTo({ data: [], error: null }));
        fromSpy = vi.spyOn(supabase, 'from').mockImplementation(mock.fromMock);

        await maybeMigrateLocalToSupabase(USER_ID);

        expect(mock.calls.length).toBe(1);
    });
});

describe('boot sequencing contract — src/index.js', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const index = readFileSync(resolve(here, '../src/index.js'), 'utf8');

    // Source-pattern assertions: index.js is the entry module (it appends the
    // DOM and hits Supabase at import time), so the ordering it encodes is
    // pinned here rather than by importing it. Mirrors bootWatchdog.test.js.
    // Returns bootApp's body with `//` comments stripped, so prose that
    // merely names a call can't stand in for the call itself.
    function liftBootApp() {
        const idx = index.indexOf('function bootApp(');
        if (idx === -1) return null;
        const braceStart = index.indexOf('{', idx);
        let depth = 0;
        for (let i = braceStart; i < index.length; i++) {
            if (index[i] === '{') depth++;
            else if (index[i] === '}') {
                depth--;
                if (depth === 0) {
                    return index.slice(braceStart + 1, i)
                        .split('\n')
                        .map(function(line) { return line.replace(/\/\/.*$/, ''); })
                        .join('\n');
                }
            }
        }
        return null;
    }

    it('resolves the first-run cloud gate before restoring from the local cache', () => {
        const body = liftBootApp();
        expect(body).not.toBeNull();
        const gateAt = body.indexOf('maybeSkipFirstRunForCloudUser(');
        const restoreAt = body.indexOf('restoreFromStorage(');
        expect(gateAt).toBeGreaterThan(-1);
        expect(restoreAt).toBeGreaterThan(-1);
        expect(gateAt).toBeLessThan(restoreAt);
    });

    it('signals boot before the gate so a slow probe cannot trip the watchdog', () => {
        const body = liftBootApp();
        expect(body).not.toBeNull();
        expect(body.indexOf('markAppBooted(')).toBeLessThan(
            body.indexOf('maybeSkipFirstRunForCloudUser(')
        );
    });
});
