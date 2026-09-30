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
// What the on-main TODO.md read returns for shipEntryForTodo's marker-visibility
// poll. Mutable so a Retry test can make the row's REUSED entry id the visible
// one — an id the poll can't find costs the suite 7×1s of real backoff.
let todoMdContent = '<!-- id: mint-0 -->';

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
    readTodoMdFromWorker: () => Promise.resolve({ ok: true, content: todoMdContent }),
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
import { computeMovedSortKey } from '../src/assignmentCoverage.js';

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

// The review modal opens in Build order (derive's insertion order); tests that
// pin the aspect ordering flip it to Rubric first.
function selectRubric() {
    document.querySelector('.proposalReviewModalSortSeg[data-mode="rubric"]').click();
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

// A derive row parked on a mockup decision: no `todo_id` (so the row layer's
// per-todo mockup pane has nowhere to mount it) and no `draft` (triage stopped
// before authoring the entry). `todoId` opts into the "belongs to a real task
// row" variant, which must NOT surface in the review sheet.
function mockupRow(id, aspect, title, todoId) {
    return {
        id: id,
        state: 'needs_mockup',
        aspect: aspect,
        todo_id: todoId === undefined ? null : todoId,
        entry_id: null,
        draft: '',
        question: 'Which card styling?',
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
    todoMdContent = '<!-- id: mint-0 -->';
    setQueueRows([], null);
    stopDeriveTracking(true);
    mountClaudeSheet(document.body);
});

afterEach(() => {
    stopDeriveTracking(true);
    const backdrop = document.getElementById('proposalReviewModalBackdrop');
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    const detail = document.getElementById('coverageDetailModalBackdrop');
    if (detail && detail.parentNode) detail.parentNode.removeChild(detail);
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
        selectRubric();
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
        selectRubric();
        expect(renderedAspects()).toEqual(['B2', 'B10']);
    });

    it('sorts a bare letter ahead of its numbered and suffixed siblings', async () => {
        const name = freshProject();
        setQueueRows([
            proposedRow(45, 'B2b', 'b2b'),
            proposedRow(46, 'B3', 'b3'),
            proposedRow(47, 'B', 'b'),
            proposedRow(48, 'B2a', 'b2a'),
            proposedRow(49, 'B1', 'b1'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        selectRubric();
        expect(renderedAspects()).toEqual(['B', 'B1', 'B2a', 'B2b', 'B3']);
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
        selectRubric();
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
        selectRubric();
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
        selectRubric();
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

    // Derive inserts proposals foundation-first, one row at a time, so the modal
    // defaults to that build order even when every row carries an aspect tag.
    function taggedRow(id, aspect, title, createdAt) {
        return { ...proposedRow(id, aspect, title), created_at: createdAt };
    }
    function buildOrderRows() {
        return [
            taggedRow(120, 'A1', 'screen', '2026-08-08T10:00:09Z'),
            taggedRow(121, 'C1', 'model', '2026-08-08T10:00:01Z'),
            taggedRow(122, 'B1', 'service', '2026-08-08T10:00:05Z'),
        ];
    }
    async function openWith(name, rows) {
        setQueueRows(rows, name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
    }
    function pressedModes() {
        return Array.from(document.querySelectorAll('.proposalReviewModalSortSeg'))
            .map(function (b) { return b.dataset.mode + ':' + b.getAttribute('aria-pressed'); });
    }

    it('opens in Build order with tagged rows ordered by created_at, not aspect', async () => {
        const name = freshProject();
        await openWith(name, buildOrderRows());
        expect(pressedModes()).toEqual(['build:true', 'rubric:false']);
        expect(document.querySelector('.proposalReviewModalSortSeg.selected').textContent)
            .toBe('Build order');
        expect(renderedTitles()).toEqual(['model', 'service', 'screen']);
    });

    it('breaks a created_at tie by id in Build order', async () => {
        const name = freshProject();
        await openWith(name, [
            taggedRow(133, 'A1', 'third', '2026-08-08T10:00:00Z'),
            taggedRow(131, 'C1', 'first', '2026-08-08T10:00:00Z'),
            taggedRow(132, 'B1', 'second', '2026-08-08T10:00:00Z'),
        ]);
        expect(renderedTitles()).toEqual(['first', 'second', 'third']);
    });

    it('switches to Rubric (A→K) and back to Build order', async () => {
        const name = freshProject();
        await openWith(name, buildOrderRows());
        selectRubric();
        expect(pressedModes()).toEqual(['build:false', 'rubric:true']);
        expect(renderedAspects()).toEqual(['A1', 'B1', 'C1']);
        document.querySelector('.proposalReviewModalSortSeg[data-mode="build"]').click();
        expect(pressedModes()).toEqual(['build:true', 'rubric:false']);
        expect(renderedTitles()).toEqual(['model', 'service', 'screen']);
    });

    it('keeps the selected mode across an onQueueChange repaint', async () => {
        const name = freshProject();
        await openWith(name, buildOrderRows());
        selectRubric();
        setQueueRows(buildOrderRows().concat([taggedRow(123, 'A2', 'extra', '2026-08-08T10:00:00Z')]), name);
        notifyQueueChange();
        expect(pressedModes()).toEqual(['build:false', 'rubric:true']);
        expect(renderedAspects()).toEqual(['A1', 'A2', 'B1', 'C1']);
    });

    it('resets to Build order when the modal is reopened', async () => {
        const name = freshProject();
        await openWith(name, buildOrderRows());
        selectRubric();
        document.getElementById('proposalReviewModalClose').click();
        expect(document.getElementById('proposalReviewModalBackdrop')).toBeFalsy();
        coverageView().querySelector('.claudeCoverageProposals').click();
        expect(pressedModes()).toEqual(['build:true', 'rubric:false']);
        expect(renderedTitles()).toEqual(['model', 'service', 'screen']);
    });
});

// Build order's manual up/down arrows: a move writes one `sort_key` through
// listLogic.setProposalSortKey (midpoint of the bracketing keys, ∓60000 at the
// ends, a full respace when the midpoint is indistinguishable), repaints at once,
// and restores on a failed write. Rubric mode renders no arrows.
describe('COVERAGE tab — proposal review modal manual reordering', () => {
    const T0 = Date.parse('2026-08-08T10:00:00Z');
    function row(id, title, createdMs, sortKey) {
        const r = { ...proposedRow(id, 'A' + id, title), created_at: new Date(createdMs).toISOString() };
        if (sortKey !== undefined) r.sort_key = sortKey;
        return r;
    }
    function threeRows() {
        return [
            row(1, 'first', T0),
            row(2, 'second', T0 + 10000),
            row(3, 'third', T0 + 20000),
        ];
    }
    async function openWith(name, rows) {
        setQueueRows(rows, name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
    }
    function titles() {
        return Array.from(document.querySelectorAll('.proposalCardTitle'))
            .map(function (t) { return t.textContent; });
    }
    function cards() { return Array.from(document.querySelectorAll('.proposalCard')); }
    function spyWrite(result) {
        return vi.spyOn(listLogic, 'setProposalSortKey').mockResolvedValue(result || { ok: true });
    }
    afterEach(() => { vi.restoreAllMocks(); });

    it('renders arrows in Build order and none in Rubric', async () => {
        await openWith(freshProject(), threeRows());
        expect(document.querySelectorAll('.proposalMoveBtn').length).toBe(4);
        expect(cards()[1].querySelector('[aria-label="Move up"]')).toBeTruthy();
        expect(cards()[1].querySelector('[aria-label="Move down"]')).toBeTruthy();
        selectRubric();
        expect(document.querySelectorAll('.proposalMoveBtn').length).toBe(0);
        expect(document.querySelectorAll('.proposalCardMove').length).toBe(0);
    });

    it('omits the first card\'s up arrow and the last card\'s down arrow, keeping the slot', async () => {
        await openWith(freshProject(), threeRows());
        const c = cards();
        expect(c[0].querySelector('.proposalMoveUp')).toBeNull();
        expect(c[0].querySelector('.proposalMoveDown')).toBeTruthy();
        expect(c[0].querySelector('.proposalMoveSpacer')).toBeTruthy();
        expect(c[2].querySelector('.proposalMoveDown')).toBeNull();
        expect(c[2].querySelector('.proposalMoveUp')).toBeTruthy();
        expect(c[2].querySelector('.proposalMoveSpacer')).toBeTruthy();
    });

    it('sorts a row by its sort_key over its created_at', async () => {
        await openWith(freshProject(), [
            row(1, 'first', T0),
            row(2, 'second', T0 + 10000),
            row(3, 'third', T0 + 20000, T0 - 5000),
        ]);
        expect(titles()).toEqual(['third', 'first', 'second']);
    });

    it('moving up writes the midpoint key once and repaints', async () => {
        const spy = spyWrite();
        await openWith(freshProject(), threeRows());
        cards()[2].querySelector('.proposalMoveUp').click();
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(3, T0 + 5000);
        expect(titles()).toEqual(['first', 'third', 'second']);
    });

    it('moving down writes the midpoint key once and repaints', async () => {
        const spy = spyWrite();
        await openWith(freshProject(), threeRows());
        cards()[0].querySelector('.proposalMoveDown').click();
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(1, T0 + 15000);
        expect(titles()).toEqual(['second', 'first', 'third']);
    });

    it('moving to the very top or bottom offsets the end card by 60000', async () => {
        const spy = spyWrite();
        await openWith(freshProject(), threeRows());
        cards()[1].querySelector('.proposalMoveUp').click();
        expect(spy).toHaveBeenLastCalledWith(2, T0 - 60000);
        expect(titles()).toEqual(['second', 'first', 'third']);
        await flush();
        cards()[1].querySelector('.proposalMoveDown').click();
        expect(spy).toHaveBeenLastCalledWith(1, T0 + 20000 + 60000);
        expect(titles()).toEqual(['second', 'third', 'first']);
    });

    it('respaces every card when the midpoint is indistinguishable from its bounds', async () => {
        const spy = spyWrite();
        const lo = 1;
        const hi = 1 + Number.EPSILON;
        await openWith(freshProject(), [
            row(1, 'first', T0, lo),
            row(2, 'second', T0, hi),
            row(3, 'third', T0, 5),
        ]);
        cards()[2].querySelector('.proposalMoveUp').click();
        expect(spy).toHaveBeenCalledTimes(3);
        expect(spy.mock.calls).toEqual([[1, 1], [3, 60001], [2, 120001]]);
        expect(titles()).toEqual(['first', 'third', 'second']);
    });

    it('a failed write restores the previous order and shows an inline error', async () => {
        spyWrite({ ok: false, error: 'nope' });
        await openWith(freshProject(), threeRows());
        cards()[2].querySelector('.proposalMoveUp').click();
        expect(titles()).toEqual(['first', 'third', 'second']);
        await flush();
        expect(titles()).toEqual(['first', 'second', 'third']);
        const err = cards()[2].querySelector('.proposalCardError');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toBe('Could not move. Try again.');
    });

    it('an arrow tap does not expand the card', async () => {
        spyWrite();
        await openWith(freshProject(), threeRows());
        cards()[0].querySelector('.proposalMoveDown').click();
        expect(document.querySelectorAll('.proposalCard.is-expanded').length).toBe(0);
    });

    it('keeps Build order and reflects a sort_key moved elsewhere on a queue repaint', async () => {
        const name = freshProject();
        await openWith(name, threeRows());
        const rows = threeRows();
        rows[0].sort_key = T0 + 30000;
        setQueueRows(rows, name);
        notifyQueueChange();
        expect(titles()).toEqual(['second', 'third', 'first']);
        expect(document.querySelectorAll('.proposalMoveBtn').length).toBe(4);
    });

    it('Rubric mode ignores sort_key', async () => {
        await openWith(freshProject(), [
            row(1, 'first', T0),
            row(2, 'second', T0 + 10000, T0 - 99999),
        ]);
        expect(titles()).toEqual(['second', 'first']);
        selectRubric();
        expect(titles()).toEqual(['first', 'second']);
    });
});

describe('COVERAGE tab — proposal review modal resize', () => {
    const SIZE_KEY = 'todoapp_proposalReviewModalSize';
    const origWidth = window.innerWidth;
    const origHeight = window.innerHeight;
    function setViewport(w, h) {
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
        Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: h });
    }
    async function openModal() {
        const name = freshProject();
        setQueueRows([proposedRow(10, 'A1', 'Add a menu'), proposedRow(11, 'A2', 'Persist')], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
    }
    function dialog() { return document.getElementById('proposalReviewModal'); }
    function grip() { return document.getElementById('proposalReviewModalResize'); }
    function key(k) {
        grip().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    }
    function pointer(type, x, y) {
        const e = new Event(type, { bubbles: true, cancelable: true });
        e.clientX = x;
        e.clientY = y;
        e.pointerId = 1;
        grip().dispatchEvent(e);
    }
    function stored() { return JSON.parse(localStorage.getItem(SIZE_KEY)); }

    beforeEach(() => { setViewport(1280, 1000); });
    afterEach(() => { setViewport(origWidth, origHeight); });

    it('renders a focusable grip and no inline size by default', async () => {
        await openModal();
        expect(grip()).toBeTruthy();
        expect(grip().tagName).toBe('BUTTON');
        expect(grip().hidden).toBe(false);
        expect(dialog().style.width).toBe('');
        expect(dialog().style.height).toBe('');
        expect(dialog().classList.contains('proposalReviewModalSized')).toBe(false);
    });

    it('restores a persisted size on open', async () => {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 600, height: 500 }));
        await openModal();
        expect(dialog().style.width).toBe('600px');
        expect(dialog().style.height).toBe('500px');
        expect(dialog().classList.contains('proposalReviewModalSized')).toBe(true);
    });

    it('clamps a persisted size to the 360–720 width and 300–86vh height bounds', async () => {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 5000, height: 5000 }));
        await openModal();
        expect(dialog().style.width).toBe('720px');
        expect(dialog().style.height).toBe('860px');
        document.getElementById('proposalReviewModalClose').click();

        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 10, height: 10 }));
        await openModal();
        expect(dialog().style.width).toBe('360px');
        expect(dialog().style.height).toBe('300px');
    });

    it('ignores a malformed stored size', async () => {
        localStorage.setItem(SIZE_KEY, 'not json');
        await openModal();
        expect(dialog().style.width).toBe('');
    });

    it('arrow keys on the grip resize and persist', async () => {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 500, height: 400 }));
        await openModal();
        key('ArrowRight');
        expect(dialog().style.width).toBe('520px');
        expect(stored()).toEqual({ width: 520, height: 400 });
        key('ArrowDown');
        expect(dialog().style.height).toBe('420px');
        key('ArrowLeft');
        key('ArrowUp');
        expect(stored()).toEqual({ width: 500, height: 400 });
        // A non-arrow key leaves the size alone.
        key('a');
        expect(stored()).toEqual({ width: 500, height: 400 });
    });

    it('a pointer drag on the grip resizes and persists on release', async () => {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 500, height: 400 }));
        await openModal();
        pointer('pointerdown', 100, 100);
        pointer('pointermove', 180, 150);
        expect(dialog().style.width).toBe('580px');
        expect(dialog().style.height).toBe('450px');
        // Not persisted until the drag ends.
        expect(stored()).toEqual({ width: 500, height: 400 });
        pointer('pointerup', 180, 150);
        expect(stored()).toEqual({ width: 580, height: 450 });
    });

    it('mobile hides the grip and applies no stored size', async () => {
        setViewport(800, 900);
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 600, height: 500 }));
        await openModal();
        expect(grip().hidden).toBe(true);
        expect(dialog().style.width).toBe('');
        expect(dialog().style.height).toBe('');
        key('ArrowRight');
        expect(dialog().style.width).toBe('');
        expect(stored()).toEqual({ width: 600, height: 500 });
    });

    it('drops the inline size when the window shrinks past the mobile breakpoint', async () => {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 600, height: 500 }));
        await openModal();
        expect(dialog().style.width).toBe('600px');
        setViewport(800, 900);
        window.dispatchEvent(new Event('resize'));
        expect(dialog().style.width).toBe('');
        expect(grip().hidden).toBe(true);
        setViewport(1280, 1000);
        window.dispatchEvent(new Event('resize'));
        expect(dialog().style.width).toBe('600px');
    });

    it('Escape, backdrop, and close button still dismiss a resized modal', async () => {
        localStorage.setItem(SIZE_KEY, JSON.stringify({ width: 600, height: 500 }));
        await openModal();
        grip().focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.getElementById('proposalReviewModalBackdrop')).toBeFalsy();

        await openModal();
        const backdrop = document.getElementById('proposalReviewModalBackdrop');
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById('proposalReviewModalBackdrop')).toBeFalsy();

        await openModal();
        document.getElementById('proposalReviewModalCloseBtn').click();
        expect(document.getElementById('proposalReviewModalBackdrop')).toBeFalsy();
    });
});

describe('computeMovedSortKey', () => {
    const r = (id, key) => ({ id: id, sort_key: key });

    it('returns the midpoint of the bracketing keys', () => {
        expect(computeMovedSortKey([r(1, 0), r(2, 100), r(3, 200)], 2, -1)).toEqual({ sortKey: 50 });
        expect(computeMovedSortKey([r(1, 0), r(2, 100), r(3, 200)], 0, 1)).toEqual({ sortKey: 150 });
    });

    it('offsets the end card by 60000 at the very top or bottom', () => {
        expect(computeMovedSortKey([r(1, 0), r(2, 100)], 1, -1)).toEqual({ sortKey: -60000 });
        expect(computeMovedSortKey([r(1, 0), r(2, 100)], 0, 1)).toEqual({ sortKey: 60100 });
    });

    it('is a no-op past either end or when a bracketing row has no usable key', () => {
        expect(computeMovedSortKey([r(1, 0), r(2, 100)], 0, -1)).toBeNull();
        expect(computeMovedSortKey([r(1, 0), r(2, 100)], 1, 1)).toBeNull();
        expect(computeMovedSortKey([{ id: 1 }, r(2, 100), r(3, 200)], 2, -1)).toBeNull();
    });

    it('respaces every row when keys tie', () => {
        const rows = [r(1, 10), r(2, 10), r(3, 20)];
        const plan = computeMovedSortKey(rows, 2, -1);
        expect(plan.respace.map((w) => [w.row.id, w.sortKey])).toEqual([[1, 10], [3, 60010], [2, 120010]]);
        expect(rows[2].sort_key).toBe(20);
    });
});

// A derive row that routes to a mockup parks in `needs_mockup` with `todo_id:
// null`. The coverage module used to have no handling for that state at all, so
// such a row rendered NOWHERE: its aspect read as not-started rather than blocked
// (aspectStatus only flagged needs_words), and the review sheet's `state ===
// 'proposed'` filter never reached it — and with no todo_id there was no task row
// to fall back on either. These pin both halves of the fix.
describe('COVERAGE tab — needs_mockup rows', () => {
    function detailModal() { return document.getElementById('coverageDetailModalBackdrop'); }

    async function openDetail(name, rows) {
        setQueueRows(rows, name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageBreakdown').click();
    }

    it('reads a needs_mockup-only aspect as blocked, in the modal\'s waiting group', async () => {
        const name = freshProject();
        await openDetail(name, [mockupRow(20, 'A2', 'Style the card')]);
        const group = document.querySelector('.coverageDetailGroup--blocked');
        expect(group).toBeTruthy();
        const blockedRow = group.querySelector('.coverageDetailRow--blocked');
        expect(blockedRow).toBeTruthy();
        expect(blockedRow.querySelector('.coverageDetailId').textContent).toBe('A2');
        // Same amber "Blocked" wording a needs_words aspect carries — never the
        // "Not started" it used to fall through to.
        expect(blockedRow.querySelector('.coverageDetailStatus').textContent).toBe('Blocked');
        expect(document.querySelector('.coverageDetailRow--not-started .coverageDetailId'))
            .not.toBe(blockedRow.querySelector('.coverageDetailId'));
    });

    it('resolves the needs_mockup row behind the flag so its lane is answerable', async () => {
        const name = freshProject();
        await openDetail(name, [mockupRow(21, 'A2', 'Style the card')]);
        const btn = document.querySelector('.coverageDetailRow--blocked');
        expect(btn.tagName).toBe('BUTTON');
        btn.click();
        const lane = document.querySelector('.coverageAnswerLane');
        expect(lane).toBeTruthy();
        expect(lane.querySelector('.coverageAnswerQuestion').textContent)
            .toBe('Which card styling?');
    });

    it('counts a homeless needs_mockup row in the badge and review action', async () => {
        const name = freshProject();
        setQueueRows([
            proposedRow(10, 'A1', 'Add a menu'),
            mockupRow(22, 'A2', 'Style the card'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        expect(coverageBadge().hidden).toBe(false);
        expect(coverageBadge().textContent).toBe('2');
        expect(coverageView().querySelector('.claudeCoverageProposals').textContent)
            .toBe('Review 2 proposals');
    });

    it('leaves a needs_mockup row that belongs to a task row out of the sheet', async () => {
        const name = freshProject();
        // todo_id set → the row layer's per-todo mockup pane already renders it.
        setQueueRows([mockupRow(23, 'A2', 'Style the card', 'todo-1')], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        expect(coverageBadge().hidden).toBe(true);
        expect(coverageView().querySelector('.claudeCoverageProposals')).toBeFalsy();
    });

    it('gives the mockup card a mockup primary rather than Accept, and never dispatches', async () => {
        const name = freshProject();
        setQueueRows([mockupRow(24, 'A2', 'Style the card')], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        const card = document.querySelector('.proposalCard');
        expect(card.querySelector('.proposalAcceptBtn')).toBeFalsy();
        const primary = card.querySelector('.proposalMockupBtn');
        expect(primary).toBeTruthy();
        expect(primary.textContent).toBe('Choose mockup');
        // The flow is disclosed on tap, not mounted eagerly.
        expect(card.querySelector('.proposalMockupFlow').childNodes.length).toBe(0);
        primary.click();
        await flush();
        expect(card.querySelector('.proposalMockupFlow .agentMockup')).toBeTruthy();
        expect(card.querySelector('.proposalMockupFlow .agentMockupGenerate')).toBeTruthy();
        expect(primary.getAttribute('aria-expanded')).toBe('true');
        // A mockup row carries no draft — the Accept path would have had nothing to
        // ship, so it must not run at all.
        expect(injectCalls.length).toBe(0);
        expect(dispatchRunCalls.length).toBe(0);
    });

    it('keeps a disclosed mockup flow open across a queue-change repaint', async () => {
        const name = freshProject();
        setQueueRows([mockupRow(25, 'A2', 'Style the card')], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        document.querySelector('.proposalMockupBtn').click();
        await flush();
        // Another device changes the queue → the modal body is rebuilt wholesale.
        setQueueRows([
            mockupRow(25, 'A2', 'Style the card'),
            proposedRow(26, 'A1', 'Add a menu'),
        ], name);
        notifyQueueChange();
        const mockupCard = Array.from(document.querySelectorAll('.proposalCard'))
            .find(function (c) { return c.querySelector('.proposalMockupBtn'); });
        expect(mockupCard.querySelector('.proposalMockupFlow .agentMockup')).toBeTruthy();
    });

    it('Dismiss on a mockup card removes the queue row', async () => {
        const name = freshProject();
        const spy = vi.spyOn(listLogic, 'unflagAgentTask');
        setQueueRows([mockupRow(27, 'A2', 'Style the card')], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        document.querySelector('.proposalCard .proposalDismissBtn').click();
        await flush();
        expect(spy).toHaveBeenCalledWith(27);
        spy.mockRestore();
    });

    it('sorts mockup cards into aspect order alongside the proposals', async () => {
        const name = freshProject();
        setQueueRows([
            proposedRow(31, 'C1', 'c1'),
            mockupRow(32, 'A2', 'a2 mockup'),
            proposedRow(33, 'A1', 'a1'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        selectRubric();
        expect(Array.from(document.querySelectorAll('.proposalCardTitle'))
            .map(function (t) { return t.textContent; }))
            .toEqual(['a1', 'a2 mockup', 'c1']);
    });

    it('turns the mockup card into a Dispatch card once the row is drafted', async () => {
        const name = freshProject();
        setQueueRows([
            mockupRow(40, 'A2', 'Style the card'),
            proposedRow(41, 'A1', 'Add a menu'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        selectRubric();
        expect(document.querySelectorAll('.proposalCard').length).toBe(2);
        // A mockup was chosen → the row moves to `drafted`, still homeless, so the
        // sheet keeps it and swaps the mockup primary for Dispatch (the entry is
        // written; shipping it is the only step left).
        setQueueRows([
            { ...mockupRow(40, 'A2', 'Style the card'), state: 'drafted', draft: '- [ ] x' },
            proposedRow(41, 'A1', 'Add a menu'),
        ], name);
        notifyQueueChange();
        expect(document.querySelectorAll('.proposalCard').length).toBe(2);
        expect(document.querySelector('.proposalMockupBtn')).toBeFalsy();
        const labels = Array.from(document.querySelectorAll('.proposalAcceptBtn'))
            .map(function (b) { return b.textContent; });
        expect(labels).toEqual(['Accept', 'Dispatch']);
    });
});

// `drafted` and `failed` used to match nothing in aspectStatus, so a row in
// either state read as 'not-started' — the coverage tab called the aspect
// untouched while the derive routine counted it as covered and skipped it, and a
// derive row (todo_id: null) had no task row to fall back on. These pin the two
// states into the status scan, the modal's "Waiting on you" group, and the review
// sheet.
describe('COVERAGE tab — drafted and failed queue states', () => {
    // A derive row holding a finished entry, waiting on a Dispatch. `todoId` opts
    // into the "belongs to a real task row" variant, which the row layer's own
    // Dispatch action already renders and the sheet must therefore leave alone.
    function draftedRow(id, aspect, title, todoId) {
        return {
            id: id,
            state: 'drafted',
            aspect: aspect,
            todo_id: todoId === undefined ? null : todoId,
            entry_id: null,
            draft: '- [ ] ' + title,
            context: { title: title, description: title + ' description' },
        };
    }

    // A derive row whose run broke. It keeps the entry id the failed run shipped
    // under, which is exactly what Retry re-uses so TODO.md gains no second copy.
    function failedRow(id, aspect, title, entryId) {
        return {
            id: id,
            state: 'failed',
            aspect: aspect,
            todo_id: null,
            entry_id: entryId === undefined ? 'mint-0' : entryId,
            draft: '- [ ] ' + title,
            context: { title: title, description: title + ' description' },
        };
    }

    async function openDetail(name, rows) {
        setQueueRows(rows, name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageBreakdown').click();
    }

    function rowFor(id) {
        return Array.from(document.querySelectorAll('.coverageDetailRow'))
            .find(function (r) {
                const el = r.querySelector('.coverageDetailId');
                return el && el.textContent === id;
            });
    }

    it('reads a drafted-only aspect as drafted, not as not-started', async () => {
        const name = freshProject();
        await openDetail(name, [draftedRow(50, 'A2', 'Persist to disk')]);
        const row = rowFor('A2');
        expect(row.querySelector('.coverageDetailStatus').textContent).toBe('Drafted');
        expect(row.classList.contains('coverageDetailRow--drafted')).toBe(true);
        // A draft is progress, not a stall — it stays in its own rubric section.
        expect(document.querySelector('.coverageDetailGroup--blocked')).toBeFalsy();
    });

    it('reads a failed-only aspect as failed, pinned in the waiting group', async () => {
        const name = freshProject();
        await openDetail(name, [failedRow(51, 'A2', 'Persist to disk')]);
        const group = document.querySelector('.coverageDetailGroup--blocked');
        expect(group).toBeTruthy();
        const pinned = group.querySelector('.coverageDetailRow--failed');
        expect(pinned).toBeTruthy();
        expect(pinned.querySelector('.coverageDetailId').textContent).toBe('A2');
        expect(pinned.querySelector('.coverageDetailStatus').textContent).toBe('Failed');
        // …and an echo in its home section, so the section's row count still
        // matches its tally.
        const echo = document.querySelector('.coverageDetailRow--echo');
        expect(echo).toBeTruthy();
        expect(echo.classList.contains('coverageDetailRow--failed')).toBe(true);
    });

    it('ranks failed above blocked and drafted, and shipped above failed', async () => {
        const name = freshProject();
        await openDetail(name, [
            // A1: a broken run alongside an unanswered question → failed wins.
            failedRow(52, 'A1', 'Menu'),
            { id: 53, state: 'needs_words', aspect: 'A1', todo_id: null, question: 'Which?' },
            { id: 54, state: 'drafted', aspect: 'A1', todo_id: null, draft: '- [ ] x' },
            // A2: a broken run alongside a shipped one → covered still wins.
            failedRow(55, 'A2', 'Persist'),
            { id: 56, state: 'shipped', aspect: 'A2', todo_id: null },
        ]);
        expect(rowFor('A1').querySelector('.coverageDetailStatus').textContent).toBe('Failed');
        expect(rowFor('A2').querySelector('.coverageDetailStatus').textContent).toBe('Shipped');
    });

    it('keeps the covered numerator at shipped only', async () => {
        const name = freshProject();
        await openDetail(name, [
            draftedRow(57, 'A1', 'Menu'),
            failedRow(58, 'A2', 'Persist'),
        ]);
        expect(document.getElementById('coverageDetailModalTitleText').textContent)
            .toBe('2 outstanding · 0 of 2 covered');
    });

    it('counts a failed aspect in the pane\'s blocked total', async () => {
        const name = freshProject();
        setQueueRows([
            failedRow(59, 'A1', 'Menu'),
            { id: 60, state: 'needs_words', aspect: 'A2', todo_id: null, question: 'Which?' },
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        // Both are pinned in the modal's "Waiting on you" group, so the pane's
        // count has to agree with it.
        expect(coverageView().querySelector('.claudeCoverageCounts').textContent)
            .toContain('2 blocked');
    });

    it('offers a Retry on the failed row that re-ships the stored entry id', async () => {
        const name = freshProject();
        await openDetail(name, [failedRow(61, 'A2', 'Persist to disk')]);
        const retry = document.querySelector('.coverageDetailRow--failed .coverageRetryBtn');
        expect(retry).toBeTruthy();
        expect(retry.disabled).toBe(false);
        retry.click();
        expect(retry.textContent).toBe('Retrying…');
        await flush(12);
        // Re-shipped through the same dispatchDraft path, reusing the row's entry
        // id so injectEntry dedup-skips rather than appending a second entry.
        expect(injectCalls.length).toBe(1);
        expect(injectCalls[0].id).toBe('mint-0');
        expect(dispatchRunCalls.length).toBe(1);
        expect(dispatchRunCalls[0].mode).toBe('entry');
        expect(dispatchRunCalls[0].entryId).toBe('mint-0');
    });

    it('re-uses a non-minted entry id verbatim on Retry', async () => {
        const name = freshProject();
        todoMdContent = '<!-- id: prior-77 -->';
        await openDetail(name, [failedRow(62, 'A2', 'Persist to disk', 'prior-77')]);
        document.querySelector('.coverageDetailRow--failed .coverageRetryBtn').click();
        await flush(12);
        expect(injectCalls[0].id).toBe('prior-77');
        expect(dispatchRunCalls[0].entryId).toBe('prior-77');
    });

    it('disables Retry when the failed row has neither an entry id nor a draft', async () => {
        const name = freshProject();
        await openDetail(name, [{
            id: 63, state: 'failed', aspect: 'A2', todo_id: null,
            entry_id: null, draft: '', context: { title: 'Persist' },
        }]);
        const retry = document.querySelector('.coverageDetailRow--failed .coverageRetryBtn');
        expect(retry).toBeTruthy();
        expect(retry.disabled).toBe(true);
    });

    it('surfaces a homeless drafted row in the sheet with a Dispatch primary', async () => {
        const name = freshProject();
        setQueueRows([draftedRow(64, 'A2', 'Persist to disk')], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        expect(coverageBadge().hidden).toBe(false);
        expect(coverageBadge().textContent).toBe('1');
        coverageView().querySelector('.claudeCoverageProposals').click();
        const primary = document.querySelector('.proposalCard .proposalAcceptBtn');
        expect(primary.textContent).toBe('Dispatch');
        primary.click();
        expect(primary.textContent).toBe('Dispatching…');
        await flush(12);
        expect(injectCalls.length).toBe(1);
        expect(dispatchRunCalls.length).toBe(1);
        expect(dispatchRunCalls[0].mode).toBe('entry');
    });

    it('leaves a drafted row that belongs to a task row out of the sheet', async () => {
        const name = freshProject();
        setQueueRows([draftedRow(65, 'A2', 'Persist to disk', 'todo-1')], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        expect(coverageBadge().hidden).toBe(true);
        expect(coverageView().querySelector('.claudeCoverageProposals')).toBeFalsy();
    });

    it('keeps failed rows out of the review sheet', async () => {
        const name = freshProject();
        setQueueRows([failedRow(66, 'A2', 'Persist to disk')], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        // A failed run is retried from the coverage modal's own row, not reviewed
        // as a proposal.
        expect(coverageBadge().hidden).toBe(true);
        expect(coverageView().querySelector('.claudeCoverageProposals')).toBeFalsy();
    });

    it('sorts a drafted card into aspect order alongside the proposals', async () => {
        const name = freshProject();
        setQueueRows([
            proposedRow(67, 'C1', 'c1'),
            draftedRow(68, 'A2', 'a2 draft'),
            proposedRow(69, 'A1', 'a1'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        selectRubric();
        expect(Array.from(document.querySelectorAll('.proposalCardTitle'))
            .map(function (t) { return t.textContent; }))
            .toEqual(['a1', 'a2 draft', 'c1']);
    });

    it('drops the drafted card once the row is dispatched', async () => {
        const name = freshProject();
        setQueueRows([
            draftedRow(70, 'A2', 'Persist to disk'),
            proposedRow(71, 'A1', 'Add a menu'),
        ], name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        expect(document.querySelectorAll('.proposalCard').length).toBe(2);
        setQueueRows([
            { ...draftedRow(70, 'A2', 'Persist to disk'), state: 'dispatched' },
            proposedRow(71, 'A1', 'Add a menu'),
        ], name);
        notifyQueueChange();
        expect(document.querySelectorAll('.proposalCard').length).toBe(1);
    });
});

// The review sheet is read on a phone, where a derive description is far longer
// than the two lines a scannable card can spare. Each card therefore collapses to
// a clamped preview and expands on a tap of its body, with one card open at a time
// (an `_activeProposalId`-style state that also survives the wholesale repaint
// renderList does on every queue change). The card's own Accept / Dismiss must keep
// working from the expanded state — they sit under the same card the tap handler is
// bound to, so their clicks stop propagating rather than toggling the description.
describe('COVERAGE tab — proposal card tap-to-expand', () => {
    async function openModal(name, rows) {
        setQueueRows(rows, name);
        await switchTo(name, { ok: true, content: FILLED_WITH_ASPECTS });
        coverageTab().click();
        coverageView().querySelector('.claudeCoverageProposals').click();
    }
    function cards() { return Array.from(document.querySelectorAll('.proposalCard')); }
    function twoProposals() {
        return [proposedRow(80, 'A1', 'Add a menu'), proposedRow(81, 'A2', 'Persist')];
    }

    it('renders each card collapsed, with the description in a tappable body region', async () => {
        const name = freshProject();
        await openModal(name, twoProposals());
        cards().forEach(function (card) {
            const body = card.querySelector('.proposalCardBody');
            expect(body).toBeTruthy();
            // The preview lives inside the tap target, not as a card-level sibling.
            expect(body.querySelector('.proposalCardPreview')).toBeTruthy();
            expect(card.classList.contains('is-expandable')).toBe(true);
            expect(card.classList.contains('is-expanded')).toBe(false);
            expect(body.getAttribute('role')).toBe('button');
            expect(body.getAttribute('tabindex')).toBe('0');
            expect(body.getAttribute('aria-expanded')).toBe('false');
        });
    });

    it('tapping the card body expands it to the full description and tapping again collapses it', async () => {
        const name = freshProject();
        await openModal(name, twoProposals());
        const card = cards()[0];
        const body = card.querySelector('.proposalCardBody');

        body.click();
        expect(card.classList.contains('is-expanded')).toBe(true);
        expect(body.getAttribute('aria-expanded')).toBe('true');
        // Expanding reveals the proposal's complete text — the clamp is CSS-side,
        // so the preview always carries the whole description.
        expect(card.querySelector('.proposalCardPreview').textContent)
            .toBe('Add a menu description');

        body.click();
        expect(card.classList.contains('is-expanded')).toBe(false);
        expect(body.getAttribute('aria-expanded')).toBe('false');
    });

    it('expands from the keyboard, so the body region is a real control', async () => {
        const name = freshProject();
        await openModal(name, twoProposals());
        const body = cards()[0].querySelector('.proposalCardBody');
        body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(cards()[0].classList.contains('is-expanded')).toBe(true);
        body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        expect(cards()[0].classList.contains('is-expanded')).toBe(false);
    });

    it('keeps only one card expanded at a time', async () => {
        const name = freshProject();
        await openModal(name, twoProposals());
        cards()[0].querySelector('.proposalCardBody').click();
        cards()[1].querySelector('.proposalCardBody').click();
        expect(cards()[0].classList.contains('is-expanded')).toBe(false);
        expect(cards()[0].querySelector('.proposalCardBody').getAttribute('aria-expanded'))
            .toBe('false');
        expect(cards()[1].classList.contains('is-expanded')).toBe(true);
    });

    it('keeps the expanded card expanded across a queue-change repaint', async () => {
        const name = freshProject();
        await openModal(name, twoProposals());
        cards()[1].querySelector('.proposalCardBody').click();

        // An unrelated proposal arrives; renderList rebuilds every card.
        setQueueRows([
            proposedRow(80, 'A1', 'Add a menu'),
            proposedRow(81, 'A2', 'Persist'),
            proposedRow(82, 'A3', 'Undo'),
        ], name);
        notifyQueueChange();

        const rebuilt = cards();
        expect(rebuilt.length).toBe(3);
        expect(rebuilt[1].querySelector('.proposalCardTitle').textContent).toBe('Persist');
        expect(rebuilt[1].classList.contains('is-expanded')).toBe(true);
        expect(rebuilt[0].classList.contains('is-expanded')).toBe(false);
    });

    it('Accept still ships from an expanded card, without collapsing it', async () => {
        const name = freshProject();
        await openModal(name, twoProposals());
        const card = cards()[0];
        card.querySelector('.proposalCardBody').click();

        card.querySelector('.proposalAcceptBtn').click();
        await flush();
        expect(injectCalls.length).toBe(1);
        expect(dispatchRunCalls.length).toBe(1);
        // The Accept click must not have reached the card's expand handler.
        expect(card.classList.contains('is-expanded')).toBe(true);
    });

    it('Dismiss still removes the row from an expanded card', async () => {
        const name = freshProject();
        const spy = vi.spyOn(listLogic, 'unflagAgentTask');
        await openModal(name, twoProposals());
        const card = cards()[0];
        card.querySelector('.proposalCardBody').click();

        card.querySelector('.proposalDismissBtn').click();
        await flush();
        expect(spy).toHaveBeenCalledWith(80);
        expect(card.classList.contains('is-expanded')).toBe(true);
        spy.mockRestore();
    });

    it('a click inside a disclosed mockup flow does not toggle the description', async () => {
        const name = freshProject();
        await openModal(name, [mockupRow(83, 'A1', 'Pick a look')]);
        const card = cards()[0];
        card.querySelector('.proposalMockupBtn').click();
        const flow = card.querySelector('.proposalMockupFlow');
        expect(flow.childNodes.length).toBeGreaterThan(0);
        expect(card.classList.contains('is-expanded')).toBe(false);

        flow.click();
        expect(card.classList.contains('is-expanded')).toBe(false);
    });

    it('starts collapsed again after the sheet is closed and reopened', async () => {
        const name = freshProject();
        await openModal(name, twoProposals());
        cards()[0].querySelector('.proposalCardBody').click();
        expect(cards()[0].classList.contains('is-expanded')).toBe(true);

        document.getElementById('proposalReviewModalCloseBtn').click();
        coverageView().querySelector('.claudeCoverageProposals').click();
        expect(cards()[0].classList.contains('is-expanded')).toBe(false);
    });

    it('leaves a proposal with no description unexpandable', async () => {
        const name = freshProject();
        const bare = { ...proposedRow(84, 'A1', 'Add a menu'), context: { title: 'Add a menu' } };
        await openModal(name, [bare]);
        const card = cards()[0];
        expect(card.querySelector('.proposalCardPreview')).toBeFalsy();
        expect(card.classList.contains('is-expandable')).toBe(false);
        expect(card.querySelector('.proposalCardBody').getAttribute('role')).toBeNull();
        card.querySelector('.proposalCardBody').click();
        expect(card.classList.contains('is-expanded')).toBe(false);
    });
});
