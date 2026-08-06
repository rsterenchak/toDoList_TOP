import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Regression tests for the Worker failure message. Every Worker route answers a
// failure with `json({ error, ...context }, status)`, but postToWorker used to
// throw a bare `HTTP <status>` and drop the body — so a freshly onboarded repo
// whose registry cache had not caught up showed `Couldn't load TODO.md — HTTP
// 400` instead of the `Target not in allowlist` the body named. These pin that
// the `error` field leads and the status trails, that `detail` rides along
// truncated, and that a body with no usable `error` still falls back to the
// bare-status vocabulary rather than surfacing raw text.
import { readTodoMdFromWorker, writeAssignmentToWorker, initInjectConfig } from '../src/inject.js';

const target = { repo: 'owner/repo', file_path: 'TODO.md' };

let fetchSpy;
let realFetch;

function failWith(status, body) {
    fetchSpy.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: status,
        json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
    }));
}

beforeEach(() => {
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();

    realFetch = globalThis.fetch;
    fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    globalThis.fetch = fetchSpy;
});

afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    initInjectConfig();
});

describe('Worker failure messages carry the response body’s error field', () => {
    it('leads with the error string and trails the status', async () => {
        failWith(400, { error: 'Target not in allowlist', repo: 'owner/repo' });
        const res = await readTodoMdFromWorker(target);
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('Target not in allowlist (400)');
    });

    it('appends a detail when the body carries one', async () => {
        failWith(502, { error: 'GitHub API failed', detail: 'Bad credentials' });
        const res = await readTodoMdFromWorker(target);
        expect(res.reason).toBe('GitHub API failed (502) — Bad credentials');
    });

    it('truncates a long detail rather than dumping it whole', async () => {
        failWith(502, { error: 'GitHub API failed', detail: 'x'.repeat(500) });
        const res = await readTodoMdFromWorker(target);
        expect(res.reason.length).toBeLessThan(260);
        expect(res.reason).toContain('GitHub API failed (502) — ' + 'x'.repeat(200) + '…');
    });

    it('prefers the error string over the status vocabulary on 401 and 403', async () => {
        failWith(401, { error: 'Bad shared secret' });
        expect((await readTodoMdFromWorker(target)).reason).toBe('Bad shared secret (401)');

        failWith(403, { error: 'Repo not writable' });
        expect((await readTodoMdFromWorker(target)).reason).toBe('Repo not writable (403)');
    });

    it('falls back to the bare status when the body has no error field', async () => {
        failWith(500, { ok: false });
        const res = await readTodoMdFromWorker(target);
        expect(res.reason).toBe('Server error 500');
    });

    it('falls back to the bare status when the body is unparseable', async () => {
        failWith(400, new Error('Unexpected token < in JSON'));
        const res = await readTodoMdFromWorker(target);
        expect(res.reason).toBe('HTTP 400');
    });

    it('falls back to the bare status when the response exposes no json reader', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 403 }));
        const res = await readTodoMdFromWorker(target);
        expect(res.reason).toBe('403 Forbidden');
    });

    it('never surfaces raw body text that is not a Worker error field', async () => {
        failWith(500, { message: '<html>Cloudflare</html>' });
        const res = await readTodoMdFromWorker(target);
        expect(res.reason).not.toContain('html');
        expect(res.reason).toBe('Server error 500');
    });

    it('keeps the 409 conflict mapping intact while surfacing the error string', async () => {
        failWith(409, { error: 'Stale sha' });
        const res = await writeAssignmentToWorker(target, 'content', 'stale-sha');
        expect(res.ok).toBe(false);
        expect(res.conflict).toBe(true);
        expect(res.reason).toBe('Stale sha (409)');
    });
});
