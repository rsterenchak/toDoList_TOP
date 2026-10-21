import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// postToWorker (inject.js) is the one funnel every Worker call goes through, so
// it is where the signed-in user's Supabase access token rides along as
// `X-Supabase-Token` for the Worker's admin gate. The Worker decides what a
// missing token means — the app never withholds a request — so no session, or
// a getSession that throws, sends the request exactly as before without the
// header. The shared-secret `Authorization` bearer is untouched either way.

const { session } = vi.hoisted(() => ({
    session: { value: null, throws: false },
}));

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        auth: {
            getSession: vi.fn(() => {
                if (session.throws) return Promise.reject(new Error('auth storage unavailable'));
                return Promise.resolve({ data: { session: session.value }, error: null });
            }),
        },
    },
}));

import { postToWorker, initInjectConfig } from '../src/inject.js';

let fetchSpy;
let realFetch;

beforeEach(() => {
    session.value = null;
    session.throws = false;
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();

    realFetch = globalThis.fetch;
    fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }));
    globalThis.fetch = fetchSpy;
});

afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    initInjectConfig();
});

function sentHeaders() {
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    return fetchSpy.mock.calls[0][1].headers;
}

describe('postToWorker — Supabase session header', () => {
    it('carries the session access token as X-Supabase-Token beside the unchanged bearer', async () => {
        session.value = { access_token: 'jwt-abc' };
        await postToWorker({ read: true });
        const headers = sentHeaders();
        expect(headers['X-Supabase-Token']).toBe('jwt-abc');
        expect(headers['Authorization']).toBe('Bearer secret');
    });

    it('omits the header with no session and still sends the request', async () => {
        await expect(postToWorker({ read: true })).resolves.toEqual({ ok: true });
        const headers = sentHeaders();
        expect('X-Supabase-Token' in headers).toBe(false);
        expect(headers['Authorization']).toBe('Bearer secret');
    });

    it('never lets a throwing getSession block the request', async () => {
        session.throws = true;
        await expect(postToWorker({ read: true })).resolves.toEqual({ ok: true });
        const headers = sentHeaders();
        expect('X-Supabase-Token' in headers).toBe(false);
    });
});
