import { vi } from 'vitest';

// The COVERAGE tab's Derive action + proposal review modal. Derive dispatches a
// claude-derive.yml run (once, disabling while in flight via the relocated derive
// tracker); when derive has produced `proposed` rows the tab shows a count badge
// and a "Review N proposals" action that opens a batch modal where each proposal
// can be Accepted (ships its draft through dispatchDraft) or Dismissed (removes the
// queue row). These tests drive the real claudeSheet + assignmentCoverage +
// agentQueueStore + dispatchDraft modules with a mocked inject.js and a stub
// Supabase client, mirroring claudeCoverageTab.test.js.

// ── inject.js stub ───────────────────────────────────────────────────
let assignmentResult = { ok: false, reason: 'No target' };
let deriveCalls = [];
let deriveResult = { ok: true };
let injectCalls = [];
let dispatchRunCalls = [];

vi.mock('../src/inject.js', () => ({
    // claudeSheet
    chatWithWorker: () => Promise.resolve({ ok: true, reply: '' }),
    injectEntry: (opts) => { injectCalls.push(opts); return Promise.resolve({ ok: true, id: 'e' }); },
    mintEntryId: () => 'mint-0',
    embedEntryMarker: (t, id) => String(t) + '\n  <!-- id: ' + id + ' -->',
    dispatchRun: (opts) => { dispatchRunCalls.push(opts); return Promise.resolve({ ok: true, runId: 1 }); },
    pollRunStatus: () => Promise.resolve({ ok: true, found: false }),
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    revertEntry: () => Promise.resolve({ ok: true }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    // shipEntryForTodo's marker-visibility poll: return the marker immediately so
    // the loop breaks on the first attempt (no 8×1s setTimeout in tests).
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
    // agentView + coverage tab derive dispatch
    dispatchTriage: () => Promise.resolve({ ok: true }),
    dispatchDerive: (projectId, correlationId, target) => {
        deriveCalls.push({ projectId, correlationId, target });
        return Promise.resolve(deriveResult);
    },
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
// configureRunTrackers, binding the callbacks + Worker probes the shared modules use.
import '../src/agentView.js';
import { mountClaudeSheet, syncClaudeSheetForProject } from '../src/claudeSheet.js';
import { setQueueRows, notifyQueueChange, isDeriveActive, stopDeriveTracking } from '../src/agentQueueStore.js';

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
function coverageBadge() { return document.querySelector('#claudeTabCoverageBadge'); }

async function switchTo(name, result) {
    assignmentResult = result;
    syncClaudeSheetForProject(name);
    await flush();
}

function proposedRow(id, aspect, title) {
    return {
        id: id,
        state: 'proposed',
        aspect: aspect,
        todo_id: null,
        entry_id: null,
        draft: '- [ ] ' + title,
        context: { title: title, description: title + ' description' },
    };
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.body.className = '';
    listLogic._reset();
    assignmentResult = { ok: false, reason: 'No target' };
    deriveCalls = [];
    deriveResult = { ok: true };
    injectCalls = [];
    dispatchRunCalls = [];
    setQueueRows([], null);
    stopDeriveTracking(true);
    mountClaudeSheet(document.body);
});

afterEach(() => {
    stopDeriveTracking(true);
    const backdrop = document.getElementById('proposalReviewModalBackdrop');
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
});

describe('COVERAGE tab — Derive action', () => {
    it('renders a Derive action for a filled assignment', async () => {
        const name = freshProject();
        setQueueRows([{ id: 1, aspect: 'A1', state: 'shipped' }], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        expect(coverageView().querySelector('.claudeCoverageDerive')).toBeTruthy();
    });

    it('dispatches a derive run once and disables while in flight', async () => {
        const name = freshProject();
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        const btn = coverageView().querySelector('.claudeCoverageDerive');
        btn.click();
        await flush();
        expect(deriveCalls.length).toBe(1);
        expect(isDeriveActive()).toBe(true);
        expect(btn.disabled).toBe(true);
        // A second click while a run is in flight must not fire a second dispatch.
        btn.click();
        await flush();
        expect(deriveCalls.length).toBe(1);
    });

    it('the pending state survives a pane close and reopen', async () => {
        const name = freshProject();
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageDerive').click();
        await flush();
        expect(isDeriveActive()).toBe(true);
        // Reopen the pane (leave and return) — the rebuilt Derive action must still
        // read the in-flight state from the tracker, not a one-shot local flag.
        document.querySelector('#claudeTabChat').click();
        coverageTab().click();
        const reopened = coverageView().querySelector('.claudeCoverageDerive');
        expect(reopened.disabled).toBe(true);
        expect(reopened.textContent).toBe('Deriving…');
    });

    // The in-flight Derive button used to read as working only via its label and
    // disabled attribute, which doesn't clearly say "still running". A spinner
    // glyph must accompany the pending label — and must be absent at rest, so an
    // idle button carries no animating node.
    it('carries no spinner while idle', async () => {
        const name = freshProject();
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        const btn = coverageView().querySelector('.claudeCoverageDerive');
        expect(btn.querySelector('.claudeCoverageDeriveSpinner')).toBeFalsy();
        expect(btn.textContent).toBe('Derive tasks');
    });

    it('shows a spinner in the button while a derive run is in flight', async () => {
        const name = freshProject();
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        const btn = coverageView().querySelector('.claudeCoverageDerive');
        btn.click();
        await flush();
        const spinner = btn.querySelector('.claudeCoverageDeriveSpinner');
        expect(spinner).toBeTruthy();
        // Reuses the shared .projRunSpinner ring glyph rather than a new one, and
        // is hidden from assistive tech since the label already says "Deriving…".
        expect(spinner.classList.contains('projRunSpinner')).toBe(true);
        expect(spinner.getAttribute('aria-hidden')).toBe('true');
        // The spinner is a child element, so the label text is untouched.
        expect(btn.textContent).toBe('Deriving…');
    });

    it('rebuilds the spinner on a repaint while the run is still tracked', async () => {
        const name = freshProject();
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageDerive').click();
        await flush();
        document.querySelector('#claudeTabChat').click();
        coverageTab().click();
        const reopened = coverageView().querySelector('.claudeCoverageDerive');
        expect(reopened.querySelector('.claudeCoverageDeriveSpinner')).toBeTruthy();
        expect(reopened.textContent).toBe('Deriving…');
    });

    it('removes the spinner when the dispatch fails', async () => {
        const name = freshProject();
        deriveResult = { ok: false, error: 'nope' };
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        const btn = coverageView().querySelector('.claudeCoverageDerive');
        btn.click();
        await flush();
        expect(isDeriveActive()).toBe(false);
        expect(btn.querySelector('.claudeCoverageDeriveSpinner')).toBeFalsy();
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Derive tasks');
    });
});

describe('COVERAGE tab — proposals badge + review action', () => {
    it('shows neither the badge nor the review action with no proposals', async () => {
        const name = freshProject();
        setQueueRows([{ id: 1, aspect: 'A1', state: 'shipped' }], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        expect(coverageBadge().hidden).toBe(true);
        expect(coverageView().querySelector('.claudeCoverageProposals')).toBeFalsy();
    });

    it('shows the badge and review action when proposals exist', async () => {
        const name = freshProject();
        setQueueRows([proposedRow(10, 'A1', 'Add a menu'), proposedRow(11, 'A2', 'Persist')], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        expect(coverageBadge().hidden).toBe(false);
        expect(coverageBadge().textContent).toBe('2');
        const review = coverageView().querySelector('.claudeCoverageProposals');
        expect(review).toBeTruthy();
        expect(review.textContent).toBe('Review 2 proposals');
    });

    it('updates the badge count on a realtime queue change', async () => {
        const name = freshProject();
        setQueueRows([proposedRow(10, 'A1', 'Add a menu')], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        expect(coverageBadge().textContent).toBe('1');
        setQueueRows([proposedRow(10, 'A1', 'Add a menu'), proposedRow(11, 'A2', 'Persist')], name);
        notifyQueueChange();
        expect(coverageBadge().textContent).toBe('2');
    });
});

describe('COVERAGE tab — proposal review modal', () => {
    async function openModal(name) {
        setQueueRows([proposedRow(10, 'A1', 'Add a menu'), proposedRow(11, 'A2', 'Persist')], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
    }

    it('opens a modal listing every proposal with its aspect badge', async () => {
        const name = freshProject();
        await openModal(name);
        expect(document.getElementById('proposalReviewModalBackdrop')).toBeTruthy();
        const cards = document.querySelectorAll('.proposalCard');
        expect(cards.length).toBe(2);
        // Each card carries the rubric aspect badge and a title.
        expect(cards[0].querySelector('.agentAspectBadge')).toBeTruthy();
        expect(document.getElementById('proposalReviewModalTitleText').textContent)
            .toContain('2 proposals');
    });

    it('Accept ships the proposal through dispatchDraft', async () => {
        const name = freshProject();
        await openModal(name);
        document.querySelector('.proposalCard .proposalAcceptBtn').click();
        await flush();
        // dispatchDraft → shipEntryForTodo injected the entry and dispatched a run.
        expect(injectCalls.length).toBe(1);
        expect(dispatchRunCalls.length).toBe(1);
        expect(dispatchRunCalls[0].mode).toBe('entry');
    });

    it('Dismiss removes the queue row', async () => {
        const name = freshProject();
        const spy = vi.spyOn(listLogic, 'unflagAgentTask');
        await openModal(name);
        document.querySelector('.proposalCard .proposalDismissBtn').click();
        await flush();
        expect(spy).toHaveBeenCalledWith(10);
        spy.mockRestore();
    });

    it('re-renders live and closes itself when the last proposal resolves', async () => {
        const name = freshProject();
        await openModal(name);
        expect(document.querySelectorAll('.proposalCard').length).toBe(2);

        // One proposal resolved elsewhere → the list drops to one card.
        setQueueRows([proposedRow(11, 'A2', 'Persist')], name);
        notifyQueueChange();
        expect(document.querySelectorAll('.proposalCard').length).toBe(1);

        // The last one resolved → the modal closes itself.
        setQueueRows([], name);
        notifyQueueChange();
        expect(document.getElementById('proposalReviewModalBackdrop')).toBeFalsy();
    });

    function renderedAspects() {
        return Array.from(document.querySelectorAll('.proposalCard')).map(function (c) {
            const b = c.querySelector('.agentAspectBadge');
            return b ? b.textContent : null;
        });
    }
    function renderedTitles() {
        return Array.from(document.querySelectorAll('.proposalCardTitle'))
            .map(function (t) { return t.textContent; });
    }

    it('orders cards by rubric aspect regardless of fetch order', async () => {
        const name = freshProject();
        setQueueRows([
            proposedRow(30, 'B3', 'b3'),
            proposedRow(31, 'C1', 'c1'),
            proposedRow(32, 'B1', 'b1'),
            proposedRow(33, 'A2', 'a2'),
            proposedRow(34, 'A1', 'a1'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        expect(renderedAspects()).toEqual(['A1', 'A2', 'B1', 'B3', 'C1']);
    });

    it('sorts aspect numbers numerically, not lexically (B10 after B2)', async () => {
        const name = freshProject();
        setQueueRows([
            proposedRow(40, 'B10', 'b10'),
            proposedRow(41, 'B2', 'b2'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        expect(renderedAspects()).toEqual(['B2', 'B10']);
    });

    it('renders untagged proposals last, after all tagged ones', async () => {
        const name = freshProject();
        setQueueRows([
            proposedRow(50, '', 'untagged'),
            proposedRow(51, 'B1', 'b1'),
            proposedRow(52, 'A1', 'a1'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        expect(renderedTitles()).toEqual(['a1', 'b1', 'untagged']);
    });

    it('keeps the remaining order stable after one card resolves', async () => {
        const name = freshProject();
        setQueueRows([
            proposedRow(60, 'C1', 'c1'),
            proposedRow(61, 'A1', 'a1'),
            proposedRow(62, 'B1', 'b1'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        expect(renderedAspects()).toEqual(['A1', 'B1', 'C1']);

        // Resolve the middle card (B1) elsewhere → the rest stay in order.
        setQueueRows([
            proposedRow(60, 'C1', 'c1'),
            proposedRow(61, 'A1', 'a1'),
        ], name);
        notifyQueueChange();
        expect(renderedAspects()).toEqual(['A1', 'C1']);
    });

    // A project derive emits every proposal untagged, in the build order its
    // closing summary tells you to accept them in. Postgres is free to return
    // those rows in any order, so the comparator has to restore it from
    // `created_at` rather than leaning on the fetch order.
    function untaggedRow(id, title, createdAt) {
        const row = proposedRow(id, '', title);
        if (createdAt !== undefined) row.created_at = createdAt;
        return row;
    }

    it('orders untagged proposals by created_at, oldest first', async () => {
        const name = freshProject();
        setQueueRows([
            untaggedRow(73, 'service worker', '2026-08-08T10:00:07Z'),
            untaggedRow(71, 'data layer', '2026-08-08T10:00:01Z'),
            untaggedRow(72, 'surfaces', '2026-08-08T10:00:04Z'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        expect(renderedTitles()).toEqual(['data layer', 'surfaces', 'service worker']);
    });

    it('breaks a created_at tie by id, so same-second inserts stay ordered', async () => {
        const name = freshProject();
        setQueueRows([
            untaggedRow(83, 'third', '2026-08-08T10:00:00Z'),
            untaggedRow(81, 'first', '2026-08-08T10:00:00Z'),
            untaggedRow(82, 'second', '2026-08-08T10:00:00Z'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        expect(renderedTitles()).toEqual(['first', 'second', 'third']);
    });

    it('keeps tagged proposals ahead of untagged ones regardless of created_at', async () => {
        const name = freshProject();
        setQueueRows([
            untaggedRow(90, 'untagged early', '2026-08-08T09:00:00Z'),
            { ...proposedRow(91, 'B1', 'b1'), created_at: '2026-08-08T11:00:00Z' },
            { ...proposedRow(92, 'A1', 'a1'), created_at: '2026-08-08T12:00:00Z' },
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        expect(renderedTitles()).toEqual(['a1', 'b1', 'untagged early']);
    });

    it('treats rows with a missing or unparseable created_at as equal, keeping fetch order', async () => {
        const name = freshProject();
        setQueueRows([
            untaggedRow(101, 'no timestamp'),
            untaggedRow(102, 'garbage timestamp', 'not-a-date'),
            untaggedRow(103, 'real timestamp', '2026-08-08T10:00:00Z'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        expect(renderedTitles()).toEqual(['no timestamp', 'garbage timestamp', 'real timestamp']);
    });
});
