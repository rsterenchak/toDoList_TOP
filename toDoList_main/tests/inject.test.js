import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Direct unit tests for chatWithWorker's payload assembly (inject.js). The
// Worker call goes through fetch, so we configure the per-device Worker URL +
// secret in localStorage, init the module's config cache, and capture the
// fetch body. The focus here is the trailing `deep` flag: when truthy it must
// set `deep_think: true` on the payload (the Worker routes that turn to its
// heavier model); when omitted the field must not appear at all, preserving
// today's fast-default behavior for every other chat turn.
import { chatWithWorker, initInjectConfig } from '../src/inject.js';

let fetchSpy;
let realFetch;

function lastChatBody() {
    const call = fetchSpy.mock.calls.find((c) => {
        try { return JSON.parse(c[1].body).chat; } catch (e) { return false; }
    });
    return call ? JSON.parse(call[1].body) : null;
}

beforeEach(() => {
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();

    realFetch = globalThis.fetch;
    fetchSpy = vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ reply: 'ok', suggested_files: [] }),
    }));
    globalThis.fetch = fetchSpy;
});

afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    initInjectConfig();
});

describe('chatWithWorker — deep flag', () => {
    it('sets deep_think: true on the payload when the deep flag is true', async () => {
        await chatWithWorker(
            [{ role: 'user', content: 'hi' }],
            undefined, undefined, null, undefined, true,
        );
        const body = lastChatBody();
        expect(body).toBeTruthy();
        expect(body.deep_think).toBe(true);
    });

    it('omits deep_think entirely when the deep flag is falsy', async () => {
        await chatWithWorker(
            [{ role: 'user', content: 'hi' }],
            undefined, undefined, null, undefined,
        );
        const body = lastChatBody();
        expect(body).toBeTruthy();
        expect('deep_think' in body).toBe(false);
    });
});
