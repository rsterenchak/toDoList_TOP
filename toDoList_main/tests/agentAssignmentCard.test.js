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

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => Promise.resolve({ data: queueRows, error: queueError }),
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

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'mint-0',
    embedEntryMarker: (t, id) => String(t) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: () => Promise.resolve({ ok: true, id: 'e' }),
    dispatchRun: () => Promise.resolve({ ok: true, runId: 1 }),
    dispatchTriage: () => Promise.resolve({ ok: true }),
    dispatchDerive: (projectId, correlationId, target) => {
        deriveCalls.push({ projectId, correlationId, target });
        return Promise.resolve({ ok: true });
    },
    pollRunStatus: () => Promise.resolve({ ok: true, found: false }),
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    fetchActiveRuns: () => Promise.resolve({ ok: true, active: false }),
    readTodoMdFromWorker: () => Promise.resolve({ ok: false, reason: 'No target' }),
    readAssignmentFromWorker: (target) => {
        assignmentCalls.push(target);
        return Promise.resolve(assignmentResult);
    },
    findTargetById: () => ({ repo: 'owner/repo', file_path: 'TODO.md' }),
    showInjectToast: () => {},
    isInjectConfigured: () => true,
    chatWithWorker: () => Promise.resolve({ ok: true, reply: '' }),
    revertEntry: () => Promise.resolve({ ok: true }),
}));

import { listLogic } from '../src/listLogic.js';
import {
    subscribeAgentView,
    unsubscribeAgentView,
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
