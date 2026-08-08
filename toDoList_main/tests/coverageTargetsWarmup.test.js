import { vi } from 'vitest';

// The Coverage tab used to stay empty until the user switched projects and back.
// main.js fires initInjectTargets() without awaiting it, so the tab routinely
// mounts and resolves its read target against a still-empty inject-targets cache.
// The lookup returns null, refreshAssignment settled that as `absent` — and in
// doing so recorded the project in `_assignmentProject`, after which the
// double-fetch guard in refreshAssignmentForActiveProject no-opped every later
// call. Only a project switch invalidated it.
//
// The fix has two halves and both are exercised here: an unresolved lookup no
// longer binds the cache (so a later call retries), and initInjectTargets fires
// `injectTargetsLoaded` once its warm-up lands so the tab re-reads on its own.
// `cachedTargets` / `routedTarget` are what a test varies to move between the
// cold-cache and warm-cache worlds.

// ── Supabase stub ────────────────────────────────────────────────────
vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => Promise.resolve({ data: [], error: null }),
            }),
            insert: (row) => Promise.resolve({ data: [row], error: null }),
            update: (patch) => ({
                eq: () => Promise.resolve({ data: [patch], error: null }),
            }),
            delete: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        }),
        channel: () => ({
            on() { return this; },
            subscribe() { return this; },
        }),
        removeChannel: () => {},
    },
}));

// ── inject.js stub ───────────────────────────────────────────────────
const TARGET = { repo: 'owner/repo', file_path: 'TODO.md', purpose: 'assignment' };
// The cold-cache world: no targets loaded, so no id resolves.
let cachedTargets = [];
let routedTarget = null;
let readResult = { ok: true, content: '## Requirements\n**A1** — Menu\n', sha: 'sha-1' };
let readCalls = [];

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'mint-0',
    embedEntryMarker: (t, id) => String(t) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: () => Promise.resolve({ ok: true, id: 'e' }),
    dispatchRun: () => Promise.resolve({ ok: true, runId: 1 }),
    dispatchTriage: () => Promise.resolve({ ok: true }),
    dispatchDerive: () => Promise.resolve({ ok: true }),
    pollRunStatus: () => Promise.resolve({ ok: true, found: false }),
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    fetchActiveRuns: () => Promise.resolve({ ok: true, active: false }),
    readTodoMdFromWorker: () => Promise.resolve({ ok: false, reason: 'No target' }),
    readRepoFile: () => Promise.resolve({ ok: false }),
    readAssignmentFromWorker: (target) => {
        readCalls.push(target);
        return Promise.resolve(readResult);
    },
    writeAssignmentToWorker: () => Promise.resolve({ ok: true, sha: 'new-sha' }),
    makeInjectButton: () => document.createElement('button'),
    refreshInjectButton: () => {},
    findTargetById: () => routedTarget,
    getCachedTargets: () => cachedTargets.slice(),
    showInjectToast: () => {},
    isInjectConfigured: () => true,
    chatWithWorker: () => Promise.resolve({ ok: true, reply: '' }),
    revertEntry: () => Promise.resolve({ ok: true }),
}));

import { listLogic } from '../src/listLogic.js';
// Importing agentView runs its module-level configureAssignmentCoverage, which
// binds getSelectedProjectName — the `injectTargetsLoaded` retry resolves the
// active project through it.
import '../src/agentView.js';
import {
    refreshAssignment,
    refreshAssignmentForActiveProject,
    resetAssignmentCache,
    getAssignmentProject,
    getAssignmentState,
} from '../src/assignmentCoverage.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) { for (let i = 0; i < n; i++) await tick(); }

let projCounter = 0;
// A project routed to a target id, selected in the DOM — the shape the coverage
// tab reads at mount.
function routedProject() {
    const name = 'Warmup-' + (projCounter++);
    listLogic.addProject(name);
    listLogic.setProjectTargetId(name, 'target-1');
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>' +
        '<div id="agentView"></div>';
    return name;
}

// An unrouted project — no target id at all. This is the genuinely-absent case
// and must keep settling immediately, cold cache or not.
function unroutedProject() {
    const name = 'Unrouted-' + (projCounter++);
    listLogic.addProject(name);
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>' +
        '<div id="agentView"></div>';
    return name;
}

// Warm the cache the way loadInjectTargets does, then announce it the way
// initInjectTargets does.
function warmTargets() {
    cachedTargets = [TARGET];
    routedTarget = TARGET;
    document.dispatchEvent(new CustomEvent('injectTargetsLoaded'));
}

beforeEach(() => {
    listLogic._reset();
    resetAssignmentCache();
    cachedTargets = [];
    routedTarget = null;
    readResult = { ok: true, content: '## Requirements\n**A1** — Menu\n', sha: 'sha-1' };
    readCalls = [];
    document.body.innerHTML = '';
});

describe('coverage read against a cold inject-targets cache', () => {
    it('leaves the read unresolved rather than settling as absent', async () => {
        const name = routedProject();
        refreshAssignmentForActiveProject(name);
        await flush();
        expect(getAssignmentState()).toBe(null);
        expect(readCalls.length).toBe(0);
        // The bug: binding the project here is what let the double-fetch guard
        // swallow every later call.
        expect(getAssignmentProject()).not.toBe(name);
    });

    it('does not suppress a later read via the double-fetch guard', async () => {
        const name = routedProject();
        refreshAssignmentForActiveProject(name);
        await flush();
        // The cache warms; the very next call must actually read.
        cachedTargets = [TARGET];
        routedTarget = TARGET;
        refreshAssignmentForActiveProject(name);
        await flush();
        expect(readCalls.length).toBe(1);
        expect(getAssignmentState()).toBe('filled');
    });

    it('still settles a project with no routed target as absent', async () => {
        const name = unroutedProject();
        refreshAssignmentForActiveProject(name);
        await flush();
        expect(getAssignmentState()).toBe('absent');
        expect(getAssignmentProject()).toBe(name);
        expect(readCalls.length).toBe(0);
    });

    it('settles as absent once the cache is loaded but holds no matching target', async () => {
        const name = routedProject();
        // Loaded (non-empty) cache whose lookup simply misses — a real answer.
        cachedTargets = [TARGET];
        routedTarget = null;
        refreshAssignmentForActiveProject(name);
        await flush();
        expect(getAssignmentState()).toBe('absent');
        expect(getAssignmentProject()).toBe(name);
        expect(readCalls.length).toBe(0);
    });
});

describe('injectTargetsLoaded retry', () => {
    it('re-reads a project that mounted before the targets warmed up', async () => {
        const name = routedProject();
        refreshAssignmentForActiveProject(name);
        await flush();
        expect(getAssignmentState()).toBe(null);

        warmTargets();
        await flush();

        expect(readCalls.length).toBe(1);
        expect(readCalls[0]).toEqual(TARGET);
        expect(getAssignmentProject()).toBe(name);
        expect(getAssignmentState()).toBe('filled');
    });

    it('does not re-read a project whose assignment already resolved', async () => {
        const name = routedProject();
        cachedTargets = [TARGET];
        routedTarget = TARGET;
        refreshAssignmentForActiveProject(name);
        await flush();
        expect(readCalls.length).toBe(1);

        document.dispatchEvent(new CustomEvent('injectTargetsLoaded'));
        await flush();
        expect(readCalls.length).toBe(1);
    });
});

describe('refreshAssignment called directly with a null target', () => {
    it('stays unresolved for a routed project while the cache is cold', async () => {
        const name = routedProject();
        refreshAssignment(null, name);
        await flush();
        expect(getAssignmentState()).toBe(null);
        expect(getAssignmentProject()).not.toBe(name);
    });

    it('resolves to absent for an unrouted project while the cache is cold', async () => {
        const name = unroutedProject();
        refreshAssignment(null, name);
        await flush();
        expect(getAssignmentState()).toBe('absent');
        expect(getAssignmentProject()).toBe(name);
    });
});
