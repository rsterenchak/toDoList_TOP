import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// main.js fires initInjectTargets() without awaiting it, so surfaces that
// resolve a routed target — the Coverage tab above all — routinely mount before
// the cache holds anything. Those surfaces now leave their read unresolved
// rather than mis-settling as "no context document", which is only useful if
// something re-drives them once the warm-up lands. `injectTargetsLoaded` is that
// signal. These tests drive the real inject.js against a stubbed Supabase client
// and a captured fetch.

let targetRows = [];

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                order: () => Promise.resolve({ data: targetRows, error: null }),
            }),
        }),
    },
}));

import { initInjectTargets, loadInjectTargets, initInjectConfig } from '../src/inject.js';

let fetchSpy;
let realFetch;
let events;
let listener;

beforeEach(() => {
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();

    targetRows = [{ id: 't1', repo: 'owner/repo', file_path: 'TODO.md' }];
    realFetch = globalThis.fetch;
    fetchSpy = vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, repos: [] }),
    }));
    globalThis.fetch = fetchSpy;

    events = [];
    listener = function () { events.push(1); };
    document.addEventListener('injectTargetsLoaded', listener);
});

afterEach(() => {
    document.removeEventListener('injectTargetsLoaded', listener);
    globalThis.fetch = realFetch;
    localStorage.clear();
    initInjectConfig();
});

describe('injectTargetsLoaded', () => {
    it('fires once the boot warm-up has loaded the targets cache', async () => {
        await initInjectTargets();
        expect(events.length).toBe(1);
    });

    // The event reports the warm-up completing, not any load. loadInjectTargets
    // also runs inside the onboard poll (one every 4s); announcing from there
    // would re-drive every listener on a timer.
    it('does not fire on a bare loadInjectTargets', async () => {
        await loadInjectTargets();
        expect(events.length).toBe(0);
    });
});
