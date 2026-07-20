import { vi } from 'vitest';

// The AGENT view mounts a read-only assignment-context card at the top of the
// board. It reads `assignment.md` (the sibling of the routed repo's TODO.md)
// via readAssignmentFromWorker and classifies the result into three states:
// absent (no card), unfilled (amber "add assignment context" invite), and
// filled (a one-line summary with word/section counts). These tests drive
// renderAgentView/subscribeAgentView with a controllable fake Supabase client
// and a mocked inject.js so the assignment read is fully deterministic.

// ── Supabase stub ────────────────────────────────────────────────────
let queueRows = [];
let queueError = null;
let queueSelectCalls = 0;

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => {
                    queueSelectCalls++;
                    return Promise.resolve({ data: queueRows, error: queueError });
                },
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
// A single target object is returned for any resolved project so
// resolveReadTarget() yields a routable target; `assignmentResult` controls
// what the assignment read resolves to per test.
let assignmentResult = { ok: false, reason: 'No target' };
let assignmentCalls = [];
let deriveCalls = [];
let deriveResult = { ok: true };
let activeRunsResult = { ok: true, active: false };
let activeRunsCalls = [];
let pollRunStatusResult = { ok: true, found: false };
let pollRunStatusCalls = [];
let toastCalls = [];

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'mint-0',
    embedEntryMarker: (t, id) => String(t) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: () => Promise.resolve({ ok: true, id: 'e' }),
    dispatchRun: () => Promise.resolve({ ok: true, runId: 1 }),
    dispatchTriage: () => Promise.resolve({ ok: true }),
    dispatchDerive: (projectId, correlationId, target) => {
        deriveCalls.push({ projectId, correlationId, target });
        return Promise.resolve(deriveResult);
    },
    pollRunStatus: (opts) => {
        pollRunStatusCalls.push(opts);
        return Promise.resolve(pollRunStatusResult);
    },
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    fetchActiveRuns: (target, workflow) => {
        activeRunsCalls.push({ target, workflow });
        return Promise.resolve(activeRunsResult);
    },
    readTodoMdFromWorker: () => Promise.resolve({ ok: false, reason: 'No target' }),
    readAssignmentFromWorker: (target) => {
        assignmentCalls.push(target);
        return Promise.resolve(assignmentResult);
    },
    findTargetById: () => ({ repo: 'owner/repo', file_path: 'TODO.md' }),
    showInjectToast: (msg, kind) => { toastCalls.push({ msg, kind }); },
    isInjectConfigured: () => true,
    chatWithWorker: () => Promise.resolve({ ok: true, reply: '' }),
    revertEntry: () => Promise.resolve({ ok: true }),
}));

import { listLogic } from '../src/listLogic.js';
import {
    subscribeAgentView,
    unsubscribeAgentView,
    renderAgentView,
} from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) {
    for (let i = 0; i < n; i++) await tick();
}

// Each test uses a fresh, uniquely-named routed project so the module-level
// `_assignmentProject` guard always triggers a fresh assignment read on mount.
let projCounter = 0;
function mountRoutedProject() {
    const name = 'Assign-' + (projCounter++);
    listLogic.addProject(name);
    listLogic.setProjectTargetId(name, 'target-1');
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>' +
        '<div id="agentView"></div>';
    return name;
}

async function loadBoard() {
    subscribeAgentView();
    await flush();
}

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    queueError = null;
    assignmentResult = { ok: false, reason: 'No target' };
    assignmentCalls = [];
    deriveCalls = [];
    deriveResult = { ok: true };
    activeRunsResult = { ok: true, active: false };
    activeRunsCalls = [];
    pollRunStatusResult = { ok: true, found: false };
    pollRunStatusCalls = [];
    toastCalls = [];
    queueSelectCalls = 0;
    document.body.classList.remove('agentUnavailable');
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribeAgentView();
});

describe('AGENT assignment card — absent state', () => {
    it('renders no card when the assignment read is not ok', async () => {
        mountRoutedProject();
        assignmentResult = { ok: false, reason: 'Not found' };
        await loadBoard();
        expect(document.querySelector('.agentAssignmentCard')).toBeNull();
    });

    it('renders no card when the file is present but empty', async () => {
        mountRoutedProject();
        assignmentResult = { ok: true, content: '   \n  \n' };
        await loadBoard();
        expect(document.querySelector('.agentAssignmentCard')).toBeNull();
    });
});

describe('AGENT assignment card — unfilled state', () => {
    it('renders the amber invite when there is no ## Requirements section', async () => {
        mountRoutedProject();
        assignmentResult = { ok: true, content: '# Assignment\n\nSome preamble.\n' };
        await loadBoard();
        const card = document.querySelector('.agentAssignmentCard');
        expect(card).toBeTruthy();
        expect(card.classList.contains('agentAssignmentCard--unfilled')).toBe(true);
        expect(card.querySelector('.agentAssignmentEyebrow').textContent).toBe('ASSIGNMENT');
        expect(card.querySelector('.agentAssignmentTitle').textContent)
            .toBe('No spec — add assignment context');
        expect(card.querySelector('.agentAssignmentMeta').textContent).toBe('Tap to add');
    });

    it('treats a Requirements section holding only an HTML-comment hint as unfilled', async () => {
        mountRoutedProject();
        assignmentResult = {
            ok: true,
            content: '## Requirements\n\n<!-- Describe the assignment here -->\n',
        };
        await loadBoard();
        const card = document.querySelector('.agentAssignmentCard');
        expect(card).toBeTruthy();
        expect(card.classList.contains('agentAssignmentCard--unfilled')).toBe(true);
    });
});

describe('AGENT assignment card — filled state', () => {
    it('summarizes the first requirement line with word and section counts', async () => {
        mountRoutedProject();
        assignmentResult = {
            ok: true,
            content: [
                '# Assignment',
                '',
                '## Overview',
                'A todo app.',
                '',
                '## Requirements',
                '- Users can add tasks',
                '- Users can delete tasks',
                '',
                '## Grading',
                'Rubric here.',
            ].join('\n'),
        };
        await loadBoard();
        const card = document.querySelector('.agentAssignmentCard');
        expect(card).toBeTruthy();
        expect(card.classList.contains('agentAssignmentCard--filled')).toBe(true);
        expect(card.querySelector('.agentAssignmentTitle').textContent)
            .toBe('- Users can add tasks');
        const meta = card.querySelector('.agentAssignmentMeta').textContent;
        // Three `## ` headers → 3 sections; the count segment reads "N sections".
        expect(meta).toMatch(/·\s*3 sections$/);
        expect(meta).toMatch(/^\d+ words/);
    });

    it('reads the assignment once per project mount', async () => {
        mountRoutedProject();
        assignmentResult = { ok: true, content: '## Requirements\nReal content.\n' };
        await loadBoard();
        expect(assignmentCalls.length).toBe(1);
        expect(assignmentCalls[0]).toEqual({ repo: 'owner/repo', file_path: 'TODO.md' });
    });
});

describe('AGENT assignment card — rubric coverage summary', () => {
    // A filled spec whose `## Rubric` section carries three aspect IDs (A1, A2,
    // B1). Coverage cross-references these against the loaded agent_queue rows'
    // `aspect` tags to compute the summary.
    const RUBRIC = {
        ok: true,
        content: [
            '# Assignment',
            '',
            '## Requirements',
            '- Users can add tasks',
            '',
            '## Rubric',
            '- A1: Task creation works',
            '- A2: Task deletion works',
            '- B1: State persists across reload',
        ].join('\n'),
    };

    it('renders the coverage summary in place of the words/sections meta line', async () => {
        mountRoutedProject();
        assignmentResult = RUBRIC;
        // A1 shipped, A2 in-flight (running), B1 has no row (not-started).
        queueRows = [
            { id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } },
            { id: '2', state: 'running', aspect: 'A2', context: { title: 'Delete' } },
        ];
        await loadBoard();
        const card = document.querySelector('.agentAssignmentCard--filled');
        expect(card).toBeTruthy();
        // The coverage block replaces the plain words/sections meta line.
        expect(card.querySelector('.agentCoverage')).toBeTruthy();
        expect(card.querySelector('.agentAssignmentMeta')).toBeNull();
    });

    it('headline leads with the outstanding count and shows covered-of-total', async () => {
        mountRoutedProject();
        assignmentResult = RUBRIC;
        queueRows = [
            { id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } },
            { id: '2', state: 'running', aspect: 'A2', context: { title: 'Delete' } },
        ];
        await loadBoard();
        // 3 aspects, 1 shipped → 2 not covered; covered numerator is shipped only.
        expect(document.querySelector('.agentCoverageHeadline').textContent)
            .toBe('2 outstanding · 1 of 3 covered');
    });

    it('segments the bar into shipped / in-flight / outstanding proportions', async () => {
        mountRoutedProject();
        assignmentResult = RUBRIC;
        queueRows = [
            { id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } },
            { id: '2', state: 'running', aspect: 'A2', context: { title: 'Delete' } },
        ];
        await loadBoard();
        const seg = (k) => document.querySelector('.agentCoverageSeg--' + k);
        expect(seg('shipped').getAttribute('data-count')).toBe('1');
        expect(seg('in-flight').getAttribute('data-count')).toBe('1');
        // B1 has no row → the one outstanding aspect.
        expect(seg('outstanding').getAttribute('data-count')).toBe('1');
        expect(seg('shipped').style.flexGrow).toBe('1');
    });

    it('counts an aspect covered only when a shipped row wins over other states', async () => {
        mountRoutedProject();
        assignmentResult = RUBRIC;
        // A1 has both a proposed and a shipped row → shipped wins (covered).
        // A2 is only needs_words (blocked) → outstanding, not covered.
        queueRows = [
            { id: '1', state: 'proposed', aspect: 'A1', context: { title: 'Add' } },
            { id: '2', state: 'shipped', aspect: 'A1', context: { title: 'Add v2' } },
            { id: '3', state: 'needs_words', aspect: 'A2', context: { title: 'Delete' }, question: 'Which?' },
        ];
        await loadBoard();
        expect(document.querySelector('.agentCoverageHeadline').textContent)
            .toBe('2 outstanding · 1 of 3 covered');
        expect(document.querySelector('.agentCoverageSeg--shipped').getAttribute('data-count')).toBe('1');
        // needs_words is blocked, not in-flight, so it lands in outstanding.
        expect(document.querySelector('.agentCoverageSeg--in-flight').getAttribute('data-count')).toBe('0');
        expect(document.querySelector('.agentCoverageSeg--outstanding').getAttribute('data-count')).toBe('2');
    });

    it('falls back to the words/sections line when the spec has no rubric aspects', async () => {
        mountRoutedProject();
        // Filled requirements but no `## Rubric` section at all.
        assignmentResult = {
            ok: true,
            content: '# Assignment\n\n## Requirements\n- Users can add tasks\n',
        };
        await loadBoard();
        const card = document.querySelector('.agentAssignmentCard--filled');
        expect(card).toBeTruthy();
        expect(card.querySelector('.agentCoverage')).toBeNull();
        expect(card.querySelector('.agentAssignmentMeta').textContent).toMatch(/\d+ words · \d+ sections/);
    });

    it('falls back when a rubric section is present but carries no aspect IDs', async () => {
        mountRoutedProject();
        assignmentResult = {
            ok: true,
            content: [
                '## Requirements',
                '- Users can add tasks',
                '',
                '## Rubric',
                '- Overall quality of the submission',
                '- Clean commit history',
            ].join('\n'),
        };
        await loadBoard();
        expect(document.querySelector('.agentCoverage')).toBeNull();
        expect(document.querySelector('.agentAssignmentMeta')).toBeTruthy();
    });
});

describe('AGENT assignment card — Draft tasks from this (derive dispatch)', () => {
    const FILLED = { ok: true, content: '## Requirements\n- Users can add tasks\n' };

    it('renders the Draft-tasks footer button on the filled card', async () => {
        mountRoutedProject();
        assignmentResult = FILLED;
        await loadBoard();
        const btn = document.querySelector('.agentAssignmentDeriveBtn');
        expect(btn).toBeTruthy();
        expect(btn.textContent).toBe('Draft tasks from this');
    });

    it('does not render the Draft-tasks button on the unfilled card', async () => {
        mountRoutedProject();
        assignmentResult = { ok: true, content: '# Assignment\n\nSome preamble.\n' };
        await loadBoard();
        expect(document.querySelector('.agentAssignmentCard--unfilled')).toBeTruthy();
        expect(document.querySelector('.agentAssignmentDeriveBtn')).toBeNull();
    });

    it('dispatches a derive run for the active project id on tap', async () => {
        const name = mountRoutedProject();
        assignmentResult = FILLED;
        await loadBoard();

        document.querySelector('.agentAssignmentDeriveBtn').click();
        await flush();

        expect(deriveCalls.length).toBe(1);
        expect(deriveCalls[0].projectId).toBe(listLogic.getProjectId(name));
    });

    it('does not open the assignment editor when the Draft button is tapped', async () => {
        mountRoutedProject();
        assignmentResult = FILLED;
        await loadBoard();
        // The mount read is the only assignment read so far.
        expect(assignmentCalls.length).toBe(1);

        document.querySelector('.agentAssignmentDeriveBtn').click();
        await flush();

        // Opening the editor would trigger a second readAssignmentFromWorker; the
        // button stops propagation so the card's open handler never fires.
        expect(assignmentCalls.length).toBe(1);
    });

    it('disables the button while a derive dispatch is in flight (double-tap guard)', async () => {
        mountRoutedProject();
        assignmentResult = FILLED;
        await loadBoard();

        const btn = document.querySelector('.agentAssignmentDeriveBtn');
        btn.click();
        btn.click();
        await flush();

        // The second tap is dropped by the local disable, so only one run fires.
        expect(deriveCalls.length).toBe(1);
        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toBe('Drafting…');
    });
});

describe('AGENT status pill — derive run progress', () => {
    const FILLED = { ok: true, content: '## Requirements\n- Users can add tasks\n' };

    it('flips the header pill to Working on a Draft tap (optimistic)', async () => {
        mountRoutedProject();
        assignmentResult = FILLED;
        await loadBoard();

        // Idle before the derive run starts.
        const pill = document.getElementById('agentStatusPill');
        expect(pill).toBeTruthy();
        expect(pill.className).toContain('agentStatusPill--idle');

        document.querySelector('.agentAssignmentDeriveBtn').click();
        await flush();

        const pillNow = document.getElementById('agentStatusPill');
        expect(pillNow.className).toContain('agentStatusPill--working');
        const label = pillNow.querySelector('.agentStatusLabel');
        if (label) expect(label.textContent).toBe('Working');
    });

    it('probes the derive workflow (not triage) while tracking', async () => {
        mountRoutedProject();
        assignmentResult = FILLED;
        await loadBoard();
        activeRunsCalls = [];

        document.querySelector('.agentAssignmentDeriveBtn').click();
        await flush();

        // The tracker polls fetchActiveRuns scoped to claude-derive.yml.
        expect(activeRunsCalls.some((c) => c.workflow === 'derive')).toBe(true);
    });

    it('clears the optimistic Working state when the dispatch itself fails', async () => {
        mountRoutedProject();
        assignmentResult = FILLED;
        deriveResult = { ok: false, reason: 'Worker down' };
        await loadBoard();

        document.querySelector('.agentAssignmentDeriveBtn').click();
        await flush();

        // A failed dispatch never registers a run, so the pill must settle back
        // to Idle and the Draft button re-enable rather than pin Working.
        const pill = document.getElementById('agentStatusPill');
        expect(pill.className).toContain('agentStatusPill--idle');
        const btn = document.querySelector('.agentAssignmentDeriveBtn');
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Draft tasks from this');
    });

    it('keeps the pill Working across a repaint while the run is in flight', async () => {
        mountRoutedProject();
        assignmentResult = FILLED;
        await loadBoard();

        document.querySelector('.agentAssignmentDeriveBtn').click();
        await flush();

        // A repaint (e.g. a realtime board push) rebuilds the header from
        // `_deriveActive`, so both the pill and the Draft button stay in their
        // working state rather than snapping back to Idle.
        renderAgentView();
        await flush();

        const pill = document.getElementById('agentStatusPill');
        expect(pill.className).toContain('agentStatusPill--working');
        const btn = document.querySelector('.agentAssignmentDeriveBtn');
        expect(btn.disabled).toBe(true);
        expect(btn.textContent).toBe('Drafting…');
    });
});

describe('AGENT status pill — derive run completion outcome', () => {
    const FILLED = { ok: true, content: '## Requirements\n- Users can add tasks\n' };
    // Matches SWEEP_POLL_MS in agentView.js — the interval between derive polls.
    const POLL_MS = 5000;

    // Drives a confirmed derive run to genuine completion: the one-shot poll
    // confirms it in flight, then the next interval tick reports it finished.
    // Fake timers are armed BEFORE the click so the poller's setInterval is a
    // fake timer this run can advance.
    async function runToCompletion() {
        activeRunsResult = { ok: true, active: true };
        vi.useFakeTimers();
        document.querySelector('.agentAssignmentDeriveBtn').click();
        await vi.advanceTimersByTimeAsync(0); // one-shot poll confirms active

        activeRunsResult = { ok: true, active: false };
        await vi.advanceTimersByTimeAsync(POLL_MS + 100); // interval tick → finished
        vi.useRealTimers();
        await flush();
    }

    it('surfaces a failure toast when a completed derive run reports a failure conclusion', async () => {
        mountRoutedProject();
        assignmentResult = FILLED;
        await loadBoard();

        pollRunStatusResult = { ok: true, status: 'completed', conclusion: 'failure' };
        await runToCompletion();

        // The confirmed run's conclusion was fetched, and a genuine failure
        // raised an error toast instead of settling the pill silently.
        expect(pollRunStatusCalls.length).toBeGreaterThan(0);
        expect(toastCalls.some((t) => /failed/i.test(t.msg) && t.kind === 'error')).toBe(true);
        // The pill still settles to Idle after a failure.
        const pill = document.getElementById('agentStatusPill');
        expect(pill.className).toContain('agentStatusPill--idle');
    });

    it('does not toast on a successful completion, but refreshes the queue', async () => {
        mountRoutedProject();
        assignmentResult = FILLED;
        await loadBoard();

        pollRunStatusResult = { ok: true, status: 'completed', conclusion: 'success' };
        const before = queueSelectCalls;
        await runToCompletion();

        // Success is quiet (no error toast) but the queue is re-read so proposals
        // appear even if the realtime push lagged.
        expect(toastCalls.some((t) => t.kind === 'error')).toBe(false);
        expect(queueSelectCalls).toBeGreaterThan(before);
    });

    it('does not fetch a conclusion when the derive run never registers (grace-elapsed)', async () => {
        mountRoutedProject();
        assignmentResult = FILLED;
        await loadBoard();

        // The probe never reports the run active — it never registers, so the
        // grace window elapses and the pill settles silently.
        activeRunsResult = { ok: true, active: false };
        pollRunStatusResult = { ok: true, status: 'completed', conclusion: 'failure' };
        pollRunStatusCalls = [];
        toastCalls = [];

        vi.useFakeTimers();
        document.querySelector('.agentAssignmentDeriveBtn').click();
        await vi.advanceTimersByTimeAsync(30 * 1000 + POLL_MS + 100);
        vi.useRealTimers();
        await flush();

        // No genuine run outcome to report → conclusion never fetched, no toast.
        expect(pollRunStatusCalls.length).toBe(0);
        expect(toastCalls.length).toBe(0);
        const pill = document.getElementById('agentStatusPill');
        expect(pill.className).toContain('agentStatusPill--idle');
    });
});
