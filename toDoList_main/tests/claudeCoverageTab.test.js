import { vi } from 'vitest';

// The chat pane's COVERAGE tab is a project-conditional third tab beside CHAT and
// RUNS. It appears only when the active project's assignment.md classifies as
// unfilled or filled (never for absent, and never before the read resolves),
// renders the assignment title + edit action + coverage summary + breakdown
// action, recomputes on a queue change, and falls back to CHAT when a project
// without an assignment becomes active. These tests drive the real claudeSheet +
// assignmentCoverage + agentQueueStore modules with a mocked inject.js (so the
// assignment read is deterministic) and a stub Supabase client.

// ── inject.js stub ───────────────────────────────────────────────────
// Superset covering everything claudeSheet, agentView, and assignmentCoverage
// import. `assignmentResult` controls what the assignment read resolves to.
let assignmentResult = { ok: false, reason: 'No target' };
let assignmentCalls = [];
// When set to an array, the assignment read defers instead of resolving
// immediately, pushing its resolver so a test can land reads out of call order
// (used to exercise the mid-fetch staleness guard).
let deferredReads = null;

vi.mock('../src/inject.js', () => ({
    // claudeSheet
    chatWithWorker: () => Promise.resolve({ ok: true, reply: '' }),
    injectEntry: () => Promise.resolve({ ok: true, id: 'e' }),
    mintEntryId: () => 'mint-0',
    embedEntryMarker: (t, id) => String(t) + '\n  <!-- id: ' + id + ' -->',
    dispatchRun: () => Promise.resolve({ ok: true, runId: 1 }),
    pollRunStatus: () => Promise.resolve({ ok: true, found: false }),
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    revertEntry: () => Promise.resolve({ ok: true }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    readTodoMdFromWorker: () => Promise.resolve({ ok: false, reason: 'No target' }),
    getCachedTargets: () => [],
    loadInjectTargets: () => Promise.resolve([]),
    isInjectConfigured: () => true,
    showInjectToast: () => {},
    emitTodoRunStatusChange: () => {},
    refreshShippedMarkersForProject: () => {},
    getShippedMarkersForRepo: () => [],
    TODO_RUN_STATUS_EVENT: 'todoapp:todoRunStatusChange',
    // agentView
    dispatchTriage: () => Promise.resolve({ ok: true }),
    dispatchDerive: () => Promise.resolve({ ok: true }),
    fetchActiveRuns: () => Promise.resolve({ ok: true, active: false }),
    findTargetById: () => ({ repo: 'owner/repo', file_path: 'TODO.md' }),
    // assignmentCoverage + agentView
    readAssignmentFromWorker: (target) => {
        assignmentCalls.push(target);
        if (deferredReads) {
            return new Promise((resolve) => { deferredReads.push(resolve); });
        }
        return Promise.resolve(assignmentResult);
    },
    readRepoFile: () => Promise.resolve({ ok: false }),
}));

// ── Supabase stub ────────────────────────────────────────────────────
vi.mock('../src/supabaseClient.js', () => {
    function makeQuery() {
        const q = {
            select: () => q,
            order: () => Promise.resolve({ data: [], error: null }),
            insert: () => Promise.resolve({ data: null, error: null }),
            update: () => q,
            delete: () => q,
            eq: () => Promise.resolve({ data: null, error: null }),
        };
        return q;
    }
    return {
        supabase: {
            auth: {
                getSession: () => Promise.resolve({ data: { session: null }, error: null }),
                onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
                signInWithOtp: () => Promise.resolve({ data: null, error: { message: 'x' } }),
                signOut: () => Promise.resolve({ error: null }),
            },
            from: () => makeQuery(),
            channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() { return this; } }),
            removeChannel: () => {},
        },
    };
});

import { listLogic } from '../src/listLogic.js';
// Importing agentView runs its module-level configureAssignmentCoverage, which
// binds getSelectedProjectName / resolveReadTarget for the shared module.
import '../src/agentView.js';
import { mountClaudeSheet, syncClaudeSheetForProject } from '../src/claudeSheet.js';
import { setQueueRows, notifyQueueChange } from '../src/agentQueueStore.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) { for (let i = 0; i < n; i++) await tick(); }

// A rubric-backed assignment (## Requirements + ## Rubric with two aspect IDs).
const FILLED_WITH_ASPECTS =
    '## Requirements\n' +
    '**A1** — Menu-driven interface\n' +
    '**A2** — Persist to disk\n\n' +
    '## Rubric\n' +
    '**A1 — Competent:** works\n' +
    '**A2 — Competent:** works\n';
// A filled spec with no rubric aspect IDs — degrades to words/sections.
const FILLED_NO_ASPECTS = '## Requirements\nBuild a thing that does stuff.\n';
// No requirements section → unfilled.
const UNFILLED = '## Overview\nSome seeded hint.\n';

let projCounter = 0;
// Append (not overwrite) a selected-project row so the mounted sheet DOM survives.
// getSelectedProjectName / resolveReadTarget key off `.selectedProject #projInput`.
function selectProject(name) {
    listLogic.addProject(name);
    listLogic.setProjectTargetId(name, 'target-1');
    const prev = document.querySelector('.selectedProject');
    if (prev) prev.remove();
    const div = document.createElement('div');
    div.className = 'selectedProject';
    div.innerHTML = '<input id="projInput" value="' + name + '">';
    document.body.appendChild(div);
}
function freshProject() {
    const name = 'Cov-' + (projCounter++);
    selectProject(name);
    return name;
}

function coverageTab() { return document.querySelector('#claudeTabCoverage'); }
function coverageView() { return document.querySelector('#claudeCoverageView'); }

async function switchTo(name, result) {
    assignmentResult = result;
    syncClaudeSheetForProject(name);
    await flush();
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.body.className = '';
    listLogic._reset();
    assignmentResult = { ok: false, reason: 'No target' };
    assignmentCalls = [];
    deferredReads = null;
    setQueueRows([], null);
    mountClaudeSheet(document.body);
});

describe('COVERAGE tab — visibility gating', () => {
    it('shows the tab for a filled assignment', async () => {
        const name = freshProject();
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        expect(coverageTab().hidden).toBe(false);
    });

    it('shows the tab for an unfilled assignment', async () => {
        const name = freshProject();
        await switchTo(name, { ok: true, content: UNFILLED });
        expect(coverageTab().hidden).toBe(false);
    });

    it('hides the tab for an absent assignment (non-coursework project)', async () => {
        const name = freshProject();
        await switchTo(name, { ok: false, reason: 'Not found' });
        expect(coverageTab().hidden).toBe(true);
    });

    it('does not show the tab before the assignment read resolves', async () => {
        const name = freshProject();
        assignmentResult = { ok: true, content: FILLED_WITH_ASPECTS };
        syncClaudeSheetForProject(name);
        // The read is still pending (no flush) — the tab must stay hidden.
        expect(coverageTab().hidden).toBe(true);
        await flush();
        expect(coverageTab().hidden).toBe(false);
    });

    it('re-resolves the tab when switching projects', async () => {
        const filled = freshProject();
        await switchTo(filled, { ok: true, content: FILLED_WITH_ASPECTS });
        expect(coverageTab().hidden).toBe(false);

        const absent = freshProject();
        await switchTo(absent, { ok: false, reason: 'Not found' });
        expect(coverageTab().hidden).toBe(true);
    });
});

// The switch path threads the switched-to project name through explicitly rather
// than re-reading the shared getSelectedProjectName() DOM selection, which can lag
// the switch call. These cover that the tab still resolves for the intended project
// regardless of selection timing, and that a stale read can't repaint the wrong one.
describe('COVERAGE tab — switch resolves independent of DOM-selection lag', () => {
    // Route a project without moving the DOM `.selectedProject` marker, reproducing
    // production where syncClaudeSheetForProject(next) fires before the sidebar flips
    // `.selectedProject` to the new row.
    function registerRouted() {
        const name = 'Cov-lag-' + (projCounter++);
        listLogic.addProject(name);
        listLogic.setProjectTargetId(name, 'target-1');
        return name;
    }

    it('reveals the tab on switch when the DOM selection still reads the previous project', async () => {
        const prev = freshProject(); // DOM .selectedProject = prev
        await switchTo(prev, { ok: false, reason: 'Not found' });
        expect(coverageTab().hidden).toBe(true);

        // The user switches to a filled-assignment project, but the DOM selection has
        // not yet flipped — it still reads `prev`. The tab must still resolve for the
        // switched-to project rather than no-opping (which left it hidden until the
        // pane was reopened).
        const next = registerRouted();
        assignmentResult = { ok: true, content: FILLED_WITH_ASPECTS };
        syncClaudeSheetForProject(next);
        await flush();
        expect(coverageTab().hidden).toBe(false);
    });

    it('drops a superseded project\'s late read instead of repainting the tab for it', async () => {
        deferredReads = [];
        const first = registerRouted();
        const last = registerRouted();

        // Two switches fire back-to-back; both reads are still pending.
        syncClaudeSheetForProject(first); // read #0 (first)
        syncClaudeSheetForProject(last);  // read #1 (last)

        // The last switch's read lands first → the tab shows for it (filled).
        deferredReads[1]({ ok: true, content: FILLED_WITH_ASPECTS });
        await flush();
        expect(coverageTab().hidden).toBe(false);

        // The superseded first switch's read lands late with an absent
        // classification — it must be dropped, leaving the last project's state
        // (tab visible), not hide the tab.
        deferredReads[0]({ ok: false, reason: 'Not found' });
        await flush();
        expect(coverageTab().hidden).toBe(false);
    });
});

describe('COVERAGE tab — content', () => {
    it('renders the assignment title and coverage summary when selected', async () => {
        const name = freshProject();
        setQueueRows([{ id: 1, aspect: 'A1', state: 'shipped' }], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });

        coverageTab().click();
        expect(coverageView().hidden).toBe(false);
        expect(coverageView().querySelector('.claudeCoverageTitle').textContent)
            .toContain('Menu-driven interface');
        // Summary headline (1 of 2 covered) and the segmented bar are present.
        expect(coverageView().querySelector('.agentCoverageHeadline').textContent)
            .toContain('1 of 2 covered');
        expect(coverageView().querySelector('.agentCoverageBar')).toBeTruthy();
    });

    it('degrades a filled-but-aspectless assignment to the words/sections line', async () => {
        const name = freshProject();
        await switchTo(name, { ok: true, content: FILLED_NO_ASPECTS });
        coverageTab().click();
        expect(coverageView().querySelector('.claudeCoverageMeta')).toBeTruthy();
        expect(coverageView().querySelector('.agentCoverageBar')).toBeFalsy();
    });

    it('shows an invite (no bar) for an unfilled assignment', async () => {
        const name = freshProject();
        await switchTo(name, { ok: true, content: UNFILLED });
        coverageTab().click();
        expect(coverageView().querySelector('.claudeCoveragePrompt')).toBeTruthy();
        expect(coverageView().querySelector('.agentCoverageBar')).toBeFalsy();
    });

    it('the edit action opens the assignment editor', async () => {
        const name = freshProject();
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        const before = assignmentCalls.length;
        coverageView().querySelector('.claudeCoverageEdit').click();
        await flush();
        // openAssignmentEditor re-reads assignment.md before opening the editor.
        expect(assignmentCalls.length).toBeGreaterThan(before);
        expect(document.getElementById('assignmentEditorModalBackdrop')).toBeTruthy();
    });

    it('the breakdown action opens the coverage detail modal', async () => {
        const name = freshProject();
        setQueueRows([{ id: 1, aspect: 'A1', state: 'shipped' }], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageBreakdown').click();
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeTruthy();
    });

    it('recomputes the summary on a queue change while the tab is open', async () => {
        const name = freshProject();
        setQueueRows([{ id: 1, aspect: 'A1', state: 'shipped' }], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        expect(coverageView().querySelector('.agentCoverageHeadline').textContent)
            .toContain('1 of 2 covered');

        // A second aspect ships → the open summary must repaint to 2 of 2.
        setQueueRows([
            { id: 1, aspect: 'A1', state: 'shipped' },
            { id: 2, aspect: 'A2', state: 'shipped' },
        ], name);
        notifyQueueChange();
        expect(coverageView().querySelector('.agentCoverageHeadline').textContent)
            .toContain('2 of 2 covered');
    });
});

describe('COVERAGE tab — selected-tab fallback', () => {
    it('falls back to CHAT when switching to a project without an assignment', async () => {
        const filled = freshProject();
        await switchTo(filled, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        expect(document.querySelector('#claudeSheet').getAttribute('data-tab')).toBe('coverage');

        const absent = freshProject();
        await switchTo(absent, { ok: false, reason: 'Not found' });
        expect(coverageTab().hidden).toBe(true);
        expect(document.querySelector('#claudeSheet').getAttribute('data-tab')).toBe('chat');
        expect(coverageView().hidden).toBe(true);
    });
});
