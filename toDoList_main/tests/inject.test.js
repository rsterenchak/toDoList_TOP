import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Direct unit tests for chatWithWorker's payload assembly (inject.js). The
// Worker call goes through fetch, so we configure the per-device Worker URL +
// secret in localStorage, init the module's config cache, and capture the
// fetch body. The focus here is the trailing `deep` flag: when truthy it must
// set `deep_think: true` on the payload (the Worker routes that turn to its
// heavier model); when omitted the field must not appear at all, preserving
// today's fast-default behavior for every other chat turn.
import { chatWithWorker, rewriteTodoMd, dispatchTriage, initInjectConfig } from '../src/inject.js';

let fetchSpy;
let realFetch;

function lastChatBody() {
    const call = fetchSpy.mock.calls.find((c) => {
        try { return JSON.parse(c[1].body).chat; } catch (e) { return false; }
    });
    return call ? JSON.parse(call[1].body) : null;
}

function lastRewriteBody() {
    const call = fetchSpy.mock.calls.find((c) => {
        try { return JSON.parse(c[1].body).rewrite; } catch (e) { return false; }
    });
    return call ? JSON.parse(call[1].body) : null;
}

function lastTriageBody() {
    const call = fetchSpy.mock.calls.find((c) => {
        try { return JSON.parse(c[1].body).dispatch_triage; } catch (e) { return false; }
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

// rewriteTodoMd POSTs the Worker's `{ rewrite: true, op, id, repo, filePath }`
// branch through the same transport every other helper uses, and routes the
// project's resolved inject target so the correct repo's TODO.md is mutated.
describe('rewriteTodoMd — worker rewrite payload', () => {
    const target = { repo: 'owner/repo', file_path: 'TODO.md' };

    it('POSTs { rewrite, op, id, repo, filePath } for a per-entry delete', async () => {
        const res = await rewriteTodoMd(target, 'delete_entry', 'abc-123');
        const body = lastRewriteBody();
        expect(body).toBeTruthy();
        expect(body.rewrite).toBe(true);
        expect(body.op).toBe('delete_entry');
        expect(body.id).toBe('abc-123');
        expect(body.repo).toBe('owner/repo');
        expect(body.filePath).toBe('TODO.md');
        expect(res.ok).toBe(true);
    });

    it('sends the op with no id for whole-file clears', async () => {
        await rewriteTodoMd(target, 'clear_completed');
        const body = lastRewriteBody();
        expect(body.op).toBe('clear_completed');
        expect(body.id).toBeUndefined();
    });

    it('spreads the Worker payload onto the result so a `skipped` flag surfaces', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ skipped: true }),
        }));
        const res = await rewriteTodoMd(target, 'delete_entry', 'missing');
        expect(res.ok).toBe(true);
        expect(res.skipped).toBe(true);
    });

    it('returns { ok: false, reason } when the target is missing', async () => {
        const res = await rewriteTodoMd(null, 'clear_all');
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('No target');
        expect(lastRewriteBody()).toBeNull();
    });

    it('funnels a transport failure through describeError', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 403 }));
        const res = await rewriteTodoMd(target, 'clear_all');
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('403 Forbidden');
    });
});

// dispatchTriage POSTs the Worker's `{ dispatch_triage: true, project_id,
// correlation_id }` branch through the same transport every other helper uses,
// so the triage sweep fires for the named project. Fire-and-forget: the caller
// polls nothing, so the result is just the spread Worker payload on success.
describe('dispatchTriage — worker dispatch_triage payload', () => {
    it('POSTs { dispatch_triage, project_id, correlation_id } and spreads the payload', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ dispatched: true }),
        }));
        const res = await dispatchTriage('proj-1', 'corr-9');
        const body = lastTriageBody();
        expect(body).toBeTruthy();
        expect(body.dispatch_triage).toBe(true);
        expect(body.project_id).toBe('proj-1');
        expect(body.correlation_id).toBe('corr-9');
        expect(res.ok).toBe(true);
        expect(res.dispatched).toBe(true);
    });

    it('funnels a transport failure through describeError', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 }));
        const res = await dispatchTriage('proj-2', 'corr-10');
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('Server error 500');
    });
});
