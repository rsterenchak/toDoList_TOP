import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// A repo's registry `purpose` decides which context document the coverage
// surface reads — `assignment.md` on an assignment repo, `project.md` on a
// personal one. The client only ever sent purpose outbound (onboardRepo /
// preflightRepo), so loadInjectTargets now pulls it from the Worker's `repos`
// route and stamps it onto the cached targets, making it readable off whatever
// findTargetById returns. These tests drive the real inject.js against a stubbed
// Supabase client and a captured fetch.

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

import {
    loadInjectTargets,
    initInjectTargets,
    findTargetById,
    normalizePurpose,
    assignmentDocName,
    initInjectConfig,
} from '../src/inject.js';

let fetchSpy;
let realFetch;
let reposReply;

function reposCallCount() {
    return fetchSpy.mock.calls.filter((c) => {
        try { return JSON.parse(c[1].body).repos === true; } catch (e) { return false; }
    }).length;
}

beforeEach(() => {
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();

    realFetch = globalThis.fetch;
    fetchSpy = vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(reposReply),
    }));
    globalThis.fetch = fetchSpy;
});

afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    initInjectConfig();
});

describe('normalizePurpose / assignmentDocName', () => {
    it('recognizes only "assignment", defaulting everything else to personal', () => {
        expect(normalizePurpose('assignment')).toBe('assignment');
        expect(normalizePurpose('personal')).toBe('personal');
        expect(normalizePurpose(undefined)).toBe('personal');
        expect(normalizePurpose('coursework')).toBe('personal');
    });

    it('maps the purpose to the document the coverage surface reads', () => {
        expect(assignmentDocName({ purpose: 'assignment' })).toBe('assignment.md');
        expect(assignmentDocName({ purpose: 'personal' })).toBe('project.md');
        expect(assignmentDocName({})).toBe('project.md');
        expect(assignmentDocName(null)).toBe('project.md');
    });
});

// The purpose map is cached for the session once a fetch succeeds, so these run
// in order: the unreachable case first (which must leave the cache empty so a
// later load retries), then the boot warm, then its reuse.
describe('purpose stamping', () => {
    it('leaves targets unstamped when the allowlist is unreachable', async () => {
        fetchSpy.mockImplementation(() => Promise.reject(new Error('offline')));
        targetRows = [{ id: 't1', repo: 'owner/personal-repo', file_path: 'TODO.md' }];
        await initInjectTargets();
        expect(findTargetById('t1').purpose).toBeUndefined();
        expect(assignmentDocName(findTargetById('t1'))).toBe('project.md');
    });

    // The boot warm fetches the purposes BEFORE loading the targets, so no
    // descriptor is ever reachable through findTargetById without one — a
    // coverage read that raced the fetch would otherwise look for `project.md`
    // in an assignment repo and classify it as having no context at all.
    it('stamps every target by the time the boot warm resolves', async () => {
        reposReply = {
            ok: true,
            default: 'owner/course-repo',
            repos: [
                { repo: 'owner/course-repo', purpose: 'assignment' },
                { repo: 'owner/personal-repo', purpose: 'personal' },
            ],
        };
        targetRows = [
            { id: 't1', repo: 'owner/personal-repo', file_path: 'TODO.md' },
            { id: 't2', repo: 'Owner/Course-Repo', file_path: 'docs/TODO.md' },
        ];
        await initInjectTargets();
        expect(findTargetById('t1').purpose).toBe('personal');
        // Matched case-insensitively, the way the registry and the onboard
        // pending-map already compare repo slugs.
        expect(findTargetById('t2').purpose).toBe('assignment');
        expect(assignmentDocName(findTargetById('t2'))).toBe('assignment.md');
    });

    // loadInjectTargets must not grow a Worker round-trip of its own: it sits on
    // the boot path and inside the onboard poll, and awaiting one there reorders
    // everything downstream. It stamps from the warm map instead.
    it('reuses the fetched purposes on a later load without refetching', async () => {
        const before = reposCallCount();
        targetRows = [{ id: 't2', repo: 'owner/course-repo', file_path: 'docs/TODO.md' }];
        await loadInjectTargets();
        expect(reposCallCount()).toBe(before);
        expect(findTargetById('t2').purpose).toBe('assignment');
    });

    it('leaves a purpose the target row already carried when the allowlist omits its repo', async () => {
        targetRows = [{
            id: 't3',
            repo: 'owner/unlisted-repo',
            file_path: 'TODO.md',
            purpose: 'assignment',
        }];
        await loadInjectTargets();
        expect(findTargetById('t3').purpose).toBe('assignment');
    });

    it('normalizes an unrecognized purpose from the allowlist to personal', async () => {
        targetRows = [{ id: 't4', repo: 'owner/personal-repo', file_path: 'TODO.md' }];
        await loadInjectTargets();
        expect(normalizePurpose(findTargetById('t4').purpose)).toBe('personal');
    });
});
