import { vi } from 'vitest';

// Regression: the coverage breakdown modal must repaint live when a queue row
// settles. Before the fix, a single onQueueChange subscription drove only the
// proposal review modal, so an open breakdown kept showing its pre-settle state
// until it was closed and reopened — even though a run settling from dispatched
// to shipped is exactly what moves an aspect from "In progress" to "Shipped" and
// increments the covered count. These tests drive the real claudeSheet +
// assignmentCoverage + agentQueueStore modules with a mocked inject.js and a stub
// Supabase client, mirroring claudeCoverageProposals.test.js.

// ── inject.js stub ───────────────────────────────────────────────────
let assignmentResult = { ok: false, reason: 'No target' };

vi.mock('../src/inject.js', () => ({
    chatWithWorker: () => Promise.resolve({ ok: true, reply: '' }),
    injectEntry: () => Promise.resolve({ ok: true, id: 'e' }),
    mintEntryId: () => 'mint-0',
    embedEntryMarker: (t, id) => String(t) + '\n  <!-- id: ' + id + ' -->',
    dispatchRun: () => Promise.resolve({ ok: true, runId: 1 }),
    pollRunStatus: () => Promise.resolve({ ok: true, found: false }),
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    revertEntry: () => Promise.resolve({ ok: true }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    readTodoMdFromWorker: () => Promise.resolve({ ok: true, content: '<!-- id: mint-0 -->' }),
    markEntryPresentLocally: () => {},
    refreshShippedMarkers: () => {},
    getCachedTargets: () => [],
    loadInjectTargets: () => Promise.resolve([]),
    isInjectConfigured: () => true,
    showInjectToast: () => {},
    emitTodoRunStatusChange: () => {},
    refreshShippedMarkersForProject: () => {},
    getShippedMarkersForRepo: () => [],
    TODO_RUN_STATUS_EVENT: 'todoapp:todoRunStatusChange',
    dispatchTriage: () => Promise.resolve({ ok: true }),
    dispatchDerive: () => Promise.resolve({ ok: true }),
    fetchActiveRuns: () => Promise.resolve({ ok: true, active: false }),
    findTargetById: () => ({ repo: 'owner/repo', file_path: 'TODO.md', purpose: 'assignment' }),
    readAssignmentFromWorker: () => Promise.resolve(assignmentResult),
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
// Importing agentView runs its module-level configureAssignmentCoverage /
// configureRunTrackers, binding the callbacks the shared modules use.
import '../src/agentView.js';
import { mountClaudeSheet, syncClaudeSheetForProject } from '../src/claudeSheet.js';
import { setQueueRows, notifyQueueChange, stopDeriveTracking } from '../src/agentQueueStore.js';
import { showProposalReviewModal } from '../src/assignmentCoverage.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) { for (let i = 0; i < n; i++) await tick(); }

const FILLED_WITH_ASPECTS =
    '## Requirements\n' +
    '**A1** — Menu-driven interface\n' +
    '**A2** — Persist to disk\n\n' +
    '## Rubric\n' +
    '**A1 — Competent:** works\n' +
    '**A2 — Competent:** works\n';

let projCounter = 0;
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
function detailTitle() { return document.getElementById('coverageDetailModalTitleText'); }

async function switchTo(name, result) {
    assignmentResult = result;
    syncClaudeSheetForProject(name);
    await flush();
}

async function openBreakdown(name, rows) {
    setQueueRows(rows, name);
    await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
    coverageTab().click();
    coverageView().querySelector('.claudeCoverageBreakdown').click();
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.body.className = '';
    listLogic._reset();
    assignmentResult = { ok: false, reason: 'No target' };
    setQueueRows([], null);
    stopDeriveTracking(true);
    mountClaudeSheet(document.body);
});

afterEach(() => {
    stopDeriveTracking(true);
    [
        'coverageDetailModalBackdrop',
        'proposalReviewModalBackdrop',
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    });
});

describe('COVERAGE breakdown modal — live repaint on row settle', () => {
    it('repaints the headline count when a row settles to shipped', async () => {
        const name = freshProject();
        await openBreakdown(name, [
            { id: 1, aspect: 'A1', state: 'dispatched', context: { title: 'Menu' } },
        ]);
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeTruthy();
        // A1 in-flight, A2 not-started → nothing covered yet.
        expect(detailTitle().textContent).toBe('2 outstanding · 0 of 2 covered');

        // The dispatched row settles to shipped.
        setQueueRows([{ id: 1, aspect: 'A1', state: 'shipped', context: { title: 'Menu' } }], name);
        notifyQueueChange();

        // The open modal must reflect the new covered count without a reopen.
        expect(detailTitle().textContent).toBe('1 outstanding · 1 of 2 covered');
    });

    it("moves an aspect's row from In progress to Shipped in place", async () => {
        const name = freshProject();
        await openBreakdown(name, [
            { id: 1, aspect: 'A1', state: 'dispatched', context: { title: 'Menu' } },
        ]);
        expect(document.querySelector('.coverageDetailRow--in-flight')).toBeTruthy();
        expect(document.querySelector('.coverageDetailRow--shipped')).toBeFalsy();

        setQueueRows([{ id: 1, aspect: 'A1', state: 'shipped', context: { title: 'Menu' } }], name);
        notifyQueueChange();

        expect(document.querySelector('.coverageDetailRow--shipped')).toBeTruthy();
        expect(document.querySelector('.coverageDetailRow--in-flight')).toBeFalsy();
    });

    it('stops repainting once the modal is dismissed', async () => {
        const name = freshProject();
        await openBreakdown(name, [
            { id: 1, aspect: 'A1', state: 'dispatched', context: { title: 'Menu' } },
        ]);
        // Dismiss the modal.
        document.getElementById('coverageDetailModalCloseBtn').click();
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeFalsy();

        // A queue change after dismissal must not throw or resurrect the modal.
        setQueueRows([{ id: 1, aspect: 'A1', state: 'shipped', context: { title: 'Menu' } }], name);
        expect(() => notifyQueueChange()).not.toThrow();
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeFalsy();
    });

    it('leaves the proposal modal live-update path intact', async () => {
        const name = freshProject();
        // Open the proposal modal (the other consumer of the shared listener).
        setQueueRows([
            { id: 20, state: 'proposed', aspect: 'A1', draft: '- [ ] x', context: { title: 'P1', description: 'd' } },
            { id: 21, state: 'proposed', aspect: 'A2', draft: '- [ ] y', context: { title: 'P2', description: 'd' } },
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        showProposalReviewModal();
        expect(document.querySelectorAll('.proposalCard').length).toBe(2);

        setQueueRows([
            { id: 21, state: 'proposed', aspect: 'A2', draft: '- [ ] y', context: { title: 'P2', description: 'd' } },
        ], name);
        notifyQueueChange();
        expect(document.querySelectorAll('.proposalCard').length).toBe(1);
    });
});
