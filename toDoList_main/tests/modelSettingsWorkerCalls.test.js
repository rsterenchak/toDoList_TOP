// Payload tests for the four Worker calls behind the Models panel. Same harness
// as inject.test.js: configure the per-device Worker URL + secret, init the
// config cache, and capture the fetch body. What's pinned here is the wire
// contract the panel can't assert for itself — which route flag each call sets,
// that a cleared pick travels as an explicit `model: null` (rather than being
// dropped from the JSON, which the Worker would read as "no change"), and that
// every write names the ACTIVE repo even at global scope, since the Worker
// resolves the auth context from it and reads `scope` to pick the row.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    fetchModelCatalog,
    fetchModelSettings,
    saveModelSetting,
    saveAutoMerge3p,
    initInjectConfig,
} from '../src/inject.js';

let fetchSpy;
let realFetch;

function lastBody() {
    const call = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    return call ? JSON.parse(call[1].body) : null;
}

beforeEach(() => {
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();

    realFetch = globalThis.fetch;
    fetchSpy = vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ models: [], plan_lanes: [] }),
    }));
    globalThis.fetch = fetchSpy;
});

afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    initInjectConfig();
});

describe('model settings — worker payloads', () => {
    it('asks for the catalog with no scope of its own', async () => {
        const res = await fetchModelCatalog();
        expect(lastBody()).toEqual({ models: true });
        expect(res.ok).toBe(true);
        expect(res.plan_lanes).toEqual([]);
    });

    it('reads one scope by repo, and the global row by its sentinel', async () => {
        await fetchModelSettings('rsterenchak/toDoList_TOP');
        expect(lastBody()).toEqual({ models_get: true, repo: 'rsterenchak/toDoList_TOP' });

        await fetchModelSettings('*');
        expect(lastBody()).toEqual({ models_get: true, repo: '*' });
    });

    it('sends an explicit null when a pick is cleared back to inherited', async () => {
        await saveModelSetting({ scope: 'repo', surface: 'run', model: null, repo: 'o/r' });
        const body = lastBody();
        expect(body).toEqual({
            models_set: true,
            scope: 'repo',
            surface: 'run',
            model: null,
            repo: 'o/r',
        });
        // The key must survive JSON.stringify — a dropped key reads as "leave it
        // alone", which is the opposite of clearing the pick.
        expect('model' in body).toBe(true);
    });

    it('names the active repo on a global-scope write, not the sentinel', async () => {
        await saveModelSetting({ scope: 'global', surface: 'chat', model: 'gpt-5-codex', repo: 'o/r' });
        expect(lastBody()).toEqual({
            models_set: true,
            scope: 'global',
            surface: 'chat',
            model: 'gpt-5-codex',
            repo: 'o/r',
        });
    });

    it('writes the auto-merge flag as a peer of the per-surface picks', async () => {
        await saveAutoMerge3p({ scope: 'repo', value: true, repo: 'o/r' });
        expect(lastBody()).toEqual({
            models_set: true,
            scope: 'repo',
            auto_merge_3p: true,
            repo: 'o/r',
        });
    });

    it('reports a refused write as an ok:false envelope carrying the reason', async () => {
        fetchSpy.mockResolvedValue({
            ok: false,
            status: 403,
            json: () => Promise.resolve({ error: 'Target not in allowlist' }),
        });
        const res = await saveModelSetting({ scope: 'repo', surface: 'run', model: 'x', repo: 'o/r' });
        expect(res.ok).toBe(false);
        expect(res.reason).toContain('Target not in allowlist');
        expect(res.reason).toContain('403');
    });

    it('reports an unconfigured device without throwing at the caller', async () => {
        localStorage.clear();
        initInjectConfig();
        const res = await fetchModelSettings('o/r');
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('Not configured');
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
