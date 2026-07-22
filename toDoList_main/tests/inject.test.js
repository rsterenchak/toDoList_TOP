import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Direct unit tests for chatWithWorker's payload assembly (inject.js). The
// Worker call goes through fetch, so we configure the per-device Worker URL +
// secret in localStorage, init the module's config cache, and capture the
// fetch body. The focus here is the trailing `deep` flag: when truthy it must
// set `deep_think: true` on the payload (the Worker routes that turn to its
// heavier model); when omitted the field must not appear at all, preserving
// today's fast-default behavior for every other chat turn.
import { chatWithWorker, rewriteTodoMd, dispatchTriage, dispatchDerive, fetchActiveRuns, onboardRepo, readAssignmentFromWorker, readRepoFile, writeAssignmentToWorker, initInjectConfig } from '../src/inject.js';

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

function lastDeriveBody() {
    const call = fetchSpy.mock.calls.find((c) => {
        try { return JSON.parse(c[1].body).dispatch_derive; } catch (e) { return false; }
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

// The task-scope attachment rides on every turn as `attach_task` (title +
// description only). It must be present when a task is scoped and absent
// otherwise, and it must never leak the todo id — only the text the model reads.
describe('chatWithWorker — attach_task (task scope)', () => {
    it('sends attach_task { title, description } when a task is attached', async () => {
        await chatWithWorker(
            [{ role: 'user', content: 'hi' }],
            undefined, undefined, 'owner/repo', undefined, undefined,
            { title: 'Add a widget', description: 'Under the header' },
        );
        const body = lastChatBody();
        expect(body).toBeTruthy();
        expect(body.attach_task).toEqual({ title: 'Add a widget', description: 'Under the header' });
    });

    it('omits attach_task entirely when no task is attached', async () => {
        await chatWithWorker(
            [{ role: 'user', content: 'hi' }],
            undefined, undefined, 'owner/repo', undefined, undefined,
            null,
        );
        const body = lastChatBody();
        expect(body).toBeTruthy();
        expect('attach_task' in body).toBe(false);
    });

    it('omits attach_task when the task carries neither title nor description', async () => {
        await chatWithWorker(
            [{ role: 'user', content: 'hi' }],
            undefined, undefined, 'owner/repo', undefined, undefined,
            { title: '', description: '' },
        );
        const body = lastChatBody();
        expect('attach_task' in body).toBe(false);
    });

    it('sends only the title/description text, never a todo id', async () => {
        await chatWithWorker(
            [{ role: 'user', content: 'hi' }],
            undefined, undefined, 'owner/repo', undefined, undefined,
            { id: 'todo-42', title: 'T', description: 'D' },
        );
        const body = lastChatBody();
        expect(body.attach_task).toEqual({ title: 'T', description: 'D' });
        expect('id' in body.attach_task).toBe(false);
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
// correlation_id, repo, filePath }` branch through the same transport every
// other helper uses, so the triage sweep fires for the named project against its
// linked repo (or the Worker default when no target is passed). Fire-and-forget:
// the caller polls nothing, so the result is just the spread Worker payload on
// success.
// onboardRepo fires the Worker's `{ onboard: true, target_repo, shape }` branch
// through the same Bearer-secret transport dispatchRun uses, spreading the
// Worker payload onto `{ ok: true }` on success and funneling failures through
// describeError. `shape` defaults to 'auto' when omitted.
describe('onboardRepo — worker onboard payload', () => {
    function lastOnboardBody() {
        const call = fetchSpy.mock.calls.find((c) => {
            try { return JSON.parse(c[1].body).onboard; } catch (e) { return false; }
        });
        return call ? JSON.parse(call[1].body) : null;
    }

    it('POSTs { onboard, target_repo, shape } and spreads the payload', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ dispatched: true }),
        }));
        const res = await onboardRepo('rsterenchak/new-repo', 'build');
        const body = lastOnboardBody();
        expect(body).toBeTruthy();
        expect(body.onboard).toBe(true);
        expect(body.target_repo).toBe('rsterenchak/new-repo');
        expect(body.shape).toBe('build');
        expect(res.ok).toBe(true);
        expect(res.dispatched).toBe(true);
    });

    it('defaults shape to "auto" when omitted or falsy', async () => {
        await onboardRepo('rsterenchak/new-repo');
        expect(lastOnboardBody().shape).toBe('auto');
    });

    it('forwards purpose "assignment" when selected', async () => {
        await onboardRepo('rsterenchak/new-repo', 'build', 'assignment');
        expect(lastOnboardBody().purpose).toBe('assignment');
    });

    it('defaults purpose to "personal" when omitted', async () => {
        await onboardRepo('rsterenchak/new-repo', 'build');
        expect(lastOnboardBody().purpose).toBe('personal');
    });

    it('normalizes any non-"assignment" purpose to "personal"', async () => {
        await onboardRepo('rsterenchak/new-repo', 'build', 'bogus');
        expect(lastOnboardBody().purpose).toBe('personal');
    });

    it('returns { ok: false, reason } via describeError on a transport failure', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 }));
        const res = await onboardRepo('rsterenchak/new-repo', 'auto');
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('Server error 500');
    });

    it('returns { ok: false } without POSTing when inject is not configured', async () => {
        localStorage.clear();
        initInjectConfig();
        const res = await onboardRepo('rsterenchak/new-repo', 'auto');
        expect(res.ok).toBe(false);
        expect(lastOnboardBody()).toBeNull();
    });
});

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

    it('routes to the passed target repo/filePath so triage runs against the project repo', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ dispatched: true }),
        }));
        await dispatchTriage('proj-1', 'corr-9', { repo: 'owner/other', file_path: 'docs/TODO.md' });
        const body = lastTriageBody();
        expect(body).toBeTruthy();
        expect(body.repo).toBe('owner/other');
        expect(body.filePath).toBe('docs/TODO.md');
    });

    it('omits repo/filePath when no target is passed so the Worker default applies', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ dispatched: true }),
        }));
        await dispatchTriage('proj-1', 'corr-9');
        const body = lastTriageBody();
        expect(body).toBeTruthy();
        expect(body.repo).toBeUndefined();
        expect(body.filePath).toBeUndefined();
    });

    it('funnels a transport failure through describeError', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 }));
        const res = await dispatchTriage('proj-2', 'corr-10');
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('Server error 500');
    });
});

// dispatchDerive mirrors dispatchTriage exactly but flips the Worker route to
// `dispatch_derive` (assignment.md → candidate tasks + questions). Same
// fire-and-forget shape, same repo/filePath routing, same error vocabulary.
describe('dispatchDerive — worker dispatch_derive payload', () => {
    it('POSTs { dispatch_derive, project_id, correlation_id } and spreads the payload', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ dispatched: true }),
        }));
        const res = await dispatchDerive('proj-1', 'corr-9');
        const body = lastDeriveBody();
        expect(body).toBeTruthy();
        expect(body.dispatch_derive).toBe(true);
        expect(body.project_id).toBe('proj-1');
        expect(body.correlation_id).toBe('corr-9');
        expect(res.ok).toBe(true);
        expect(res.dispatched).toBe(true);
    });

    it('routes to the passed target repo/filePath so derive runs against the project repo', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ dispatched: true }),
        }));
        await dispatchDerive('proj-1', 'corr-9', { repo: 'owner/other', file_path: 'docs/TODO.md' });
        const body = lastDeriveBody();
        expect(body).toBeTruthy();
        expect(body.repo).toBe('owner/other');
        expect(body.filePath).toBe('docs/TODO.md');
    });

    it('omits repo/filePath when no target is passed so the Worker default applies', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ dispatched: true }),
        }));
        await dispatchDerive('proj-1', 'corr-9');
        const body = lastDeriveBody();
        expect(body).toBeTruthy();
        expect(body.repo).toBeUndefined();
        expect(body.filePath).toBeUndefined();
    });

    it('funnels a transport failure through describeError', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 }));
        const res = await dispatchDerive('proj-2', 'corr-10');
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('Server error 500');
    });
});

// readAssignmentFromWorker reads the `assignment.md` sibling of the routed
// repo's TODO.md through the Worker's `{ read: true, repo, filePath }` handler.
// The focus here is the derived path: the directory portion of `file_path` with
// `assignment.md` appended, so a repo-root TODO.md reads `assignment.md` and a
// nested one reads `<dir>/assignment.md`.
describe('readAssignmentFromWorker — sibling path derivation', () => {
    function lastReadBody() {
        const call = fetchSpy.mock.calls.find((c) => {
            try { return JSON.parse(c[1].body).read; } catch (e) { return false; }
        });
        return call ? JSON.parse(call[1].body) : null;
    }

    it('reads assignment.md at the repo root when TODO.md is at the root', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ content: '# Assignment', sha: 'abc' }),
        }));
        const res = await readAssignmentFromWorker({ repo: 'owner/repo', file_path: 'TODO.md' });
        const body = lastReadBody();
        expect(body).toBeTruthy();
        expect(body.repo).toBe('owner/repo');
        expect(body.filePath).toBe('assignment.md');
        expect(res).toEqual({ ok: true, content: '# Assignment', sha: 'abc' });
    });

    it('reads the assignment.md sibling in the same directory as a nested TODO.md', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ content: 'x', sha: 's' }),
        }));
        await readAssignmentFromWorker({ repo: 'owner/repo', file_path: 'docs/plans/TODO.md' });
        const body = lastReadBody();
        expect(body.filePath).toBe('docs/plans/assignment.md');
    });

    it('returns ok:false without a Worker call when no target is passed', async () => {
        const res = await readAssignmentFromWorker(null);
        expect(res.ok).toBe(false);
        expect(lastReadBody()).toBeNull();
    });

    it('returns ok:false when the Worker response carries no content', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sha: 's' }),
        }));
        const res = await readAssignmentFromWorker({ repo: 'owner/repo', file_path: 'TODO.md' });
        expect(res.ok).toBe(false);
    });
});

// readRepoFile reads an arbitrary repo-relative file through the Worker's
// `{ read: true, repo, filePath }` handler. Unlike readAssignmentFromWorker it
// takes the path directly (no sibling derivation), so the coverage-commit
// manifest can copy any shipped file's full content for a paste-into-GitLab
// transfer.
describe('readRepoFile — direct path read', () => {
    function lastReadBody() {
        const call = fetchSpy.mock.calls.find((c) => {
            try { return JSON.parse(c[1].body).read; } catch (e) { return false; }
        });
        return call ? JSON.parse(call[1].body) : null;
    }

    it('posts the given path verbatim and returns its content and sha', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ content: 'file body', sha: 'blob1' }),
        }));
        const res = await readRepoFile(
            { repo: 'owner/repo', file_path: 'TODO.md' },
            'toDoList_main/src/main.js',
        );
        const body = lastReadBody();
        expect(body).toBeTruthy();
        expect(body.read).toBe(true);
        expect(body.repo).toBe('owner/repo');
        expect(body.filePath).toBe('toDoList_main/src/main.js');
        expect(res).toEqual({ ok: true, content: 'file body', sha: 'blob1' });
    });

    it('returns ok:false without a Worker call when no target is passed', async () => {
        const res = await readRepoFile(null, 'src/main.js');
        expect(res.ok).toBe(false);
        expect(lastReadBody()).toBeNull();
    });

    it('returns ok:false without a Worker call when the path is empty', async () => {
        const res = await readRepoFile({ repo: 'owner/repo', file_path: 'TODO.md' }, '');
        expect(res.ok).toBe(false);
        expect(lastReadBody()).toBeNull();
    });

    it('returns ok:false when the Worker response carries no content', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sha: 's' }),
        }));
        const res = await readRepoFile({ repo: 'owner/repo', file_path: 'TODO.md' }, 'src/x.js');
        expect(res.ok).toBe(false);
    });

    it('maps a Worker failure to ok:false with a reason rather than throwing', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: false,
            status: 400,
            text: () => Promise.resolve('not allowed'),
        }));
        const res = await readRepoFile({ repo: 'owner/repo', file_path: 'TODO.md' }, 'secret.txt');
        expect(res.ok).toBe(false);
        expect(typeof res.reason).toBe('string');
    });
});

// writeAssignmentToWorker posts `{ write: true, repo, filePath, content, sha }`
// to the same `assignment.md` sibling path readAssignmentFromWorker derives,
// with the open-time sha as the concurrency token. Success returns
// `{ ok: true, sha }`; an HTTP 409 maps to `{ ok: false, conflict: true }`; any
// other failure to `{ ok: false, reason }`.
describe('writeAssignmentToWorker — write branch', () => {
    function lastWriteBody() {
        const call = fetchSpy.mock.calls.find((c) => {
            try { return JSON.parse(c[1].body).write; } catch (e) { return false; }
        });
        return call ? JSON.parse(call[1].body) : null;
    }

    it('posts the derived assignment.md path, content, and sha', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sha: 'new-sha' }),
        }));
        const res = await writeAssignmentToWorker(
            { repo: 'owner/repo', file_path: 'docs/TODO.md' },
            '## Requirements\nDo the thing.\n',
            'old-sha',
        );
        const body = lastWriteBody();
        expect(body).toBeTruthy();
        expect(body.write).toBe(true);
        expect(body.repo).toBe('owner/repo');
        expect(body.filePath).toBe('docs/assignment.md');
        expect(body.content).toBe('## Requirements\nDo the thing.\n');
        expect(body.sha).toBe('old-sha');
        expect(res).toEqual({ ok: true, sha: 'new-sha' });
    });

    it('returns ok:false without a Worker call when no target is passed', async () => {
        const res = await writeAssignmentToWorker(null, 'x', 's');
        expect(res.ok).toBe(false);
        expect(lastWriteBody()).toBeNull();
    });

    it('maps an HTTP 409 to a conflict result', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: false,
            status: 409,
            json: () => Promise.resolve({}),
        }));
        const res = await writeAssignmentToWorker(
            { repo: 'owner/repo', file_path: 'TODO.md' }, 'x', 'stale',
        );
        expect(res.ok).toBe(false);
        expect(res.conflict).toBe(true);
    });

    it('maps a non-409 failure to a plain error result', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: false,
            status: 500,
            json: () => Promise.resolve({}),
        }));
        const res = await writeAssignmentToWorker(
            { repo: 'owner/repo', file_path: 'TODO.md' }, 'x', 's',
        );
        expect(res.ok).toBe(false);
        expect(res.conflict).toBeFalsy();
        expect(typeof res.reason).toBe('string');
    });
});

describe('fetchActiveRuns — optional workflow scope', () => {
    function lastActiveRunsBody() {
        const call = fetchSpy.mock.calls.find((c) => {
            try { return JSON.parse(c[1].body).active_runs; } catch (e) { return false; }
        });
        return call ? JSON.parse(call[1].body) : null;
    }

    it('omits the workflow field when no workflow is passed (existing callers unchanged)', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ active: false }),
        }));
        await fetchActiveRuns();
        const body = lastActiveRunsBody();
        expect(body).toBeTruthy();
        expect(body.active_runs).toBe(true);
        expect('workflow' in body).toBe(false);
    });

    it('includes the workflow field when passed (triage-scoped probe)', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ active: true }),
        }));
        const res = await fetchActiveRuns(null, 'triage');
        const body = lastActiveRunsBody();
        expect(body.workflow).toBe('triage');
        expect(res.ok).toBe(true);
        expect(res.active).toBe(true);
    });
});

