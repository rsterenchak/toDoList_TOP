import { vi } from 'vitest';

// The coverage detail modal's blocked-aspect answer lane. Tapping a blocked
// (amber) aspect row used to call jumpToBlockedAspect, which closed the modal and
// then depended entirely on the retired Agent board — every step of it dead, so
// the modal just closed and there was NO surface anywhere in the app to answer a
// needs_words question raised against a rubric aspect (the row layer's ASKING
// block mounts per todo via agent_queue.todo_id, which a derive-produced aspect
// row parked in needs_words does not have). The row now expands in place into an
// answer lane instead.
//
// These tests drive the module through its BOARDLESS path — configure* + the
// COVERAGE pane, exactly as agentWiring.js wires it in the running app — so they
// exercise the state the app actually reaches rather than a board-mounted one.

// ── Supabase stub ────────────────────────────────────────────────────
let queueRows = [];

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({ eq: () => Promise.resolve({ data: queueRows, error: null }) }),
            insert: (row) => Promise.resolve({ data: [row], error: null }),
            update: (patch) => ({ eq: () => Promise.resolve({ data: [patch], error: null }) }),
            upsert: (row) => Promise.resolve({ data: [row], error: null }),
            delete: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

// ── inject.js stub ───────────────────────────────────────────────────
const toasts = [];
let assignmentResult = { ok: false, reason: 'No target' };

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
    readAssignmentFromWorker: () => Promise.resolve(assignmentResult),
    findTargetById: () => ({ repo: 'owner/repo', file_path: 'TODO.md' }),
    showInjectToast: (msg, kind) => { toasts.push({ msg: msg, kind: kind }); },
    isInjectConfigured: () => true,
    chatWithWorker: () => Promise.resolve({ ok: true, reply: '' }),
    revertEntry: () => Promise.resolve({ ok: true }),
}));

import { listLogic } from '../src/listLogic.js';
import {
    configureAssignmentCoverage,
    refreshAssignment,
    buildCoveragePane,
} from '../src/assignmentCoverage.js';
import {
    loadQueueRows,
    notifyQueueChange,
    pendingAnswers,
    setTriageDispatcher,
} from '../src/agentQueueStore.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) {
    for (let i = 0; i < n; i++) await tick();
}

// A1 shipped, D1 blocked on a needs_words question, G1 a Git/process aspect.
const RUBRIC = {
    ok: true,
    content: [
        '# Assignment', '',
        '## Requirements',
        '- **A1** — Menu-driven interface',
        '- **D1** — Undo the last action',
        '- **G1** — Clean commit history', '',
        '## Rubric',
        '- **A1 — Competent:** The program presents a menu-driven interface.',
        '- **D1 — Competent:** The last action can be undone.',
        '- **G1 — Competent:** Commit history is clean and well-scoped.',
    ].join('\n'),
};

function defaultQueue() {
    return [
        { id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add menu' } },
        {
            id: '4', state: 'needs_words', aspect: 'D1',
            question: 'Undo one step, or a full history?',
            thread: [{ role: 'agent', text: 'Undo one step, or a full history?' }],
            context: { title: 'Undo', description: 'Let the user undo the last action.' },
        },
    ];
}

let projCounter = 0;
let currentProject = null;
let seeded = [];

function mountRoutedProject() {
    const name = 'Lane-' + (projCounter++);
    listLogic.addProject(name);
    listLogic.setProjectTargetId(name, 'target-1');
    currentProject = name;
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>';
    return name;
}

// Wire the module the way agentWiring.js does at boot — no board anywhere.
function wireBoardless() {
    seeded = [];
    configureAssignmentCoverage({
        getSelectedProjectName: function () {
            const input = document.querySelector('.selectedProject #projInput');
            return input ? (input.value || '').trim() : '';
        },
        resolveReadTarget: function () { return { repo: 'owner/repo', file_path: 'TODO.md' }; },
        openChatWithSeed: function (seed, rowId) { seeded.push({ seed: seed, rowId: rowId }); },
    });
}

// Load the assignment + queue and open the coverage detail modal from the
// COVERAGE pane's "View full breakdown" action.
async function openDetail() {
    refreshAssignment({ repo: 'owner/repo', file_path: 'TODO.md' }, currentProject);
    await loadQueueRows(currentProject);
    await flush();
    document.body.appendChild(buildCoveragePane());
    document.querySelector('.claudeCoverageBreakdown').click();
    await flush();
}

function blockedItem() {
    return document.querySelector('.coverageDetailGroup--blocked .coverageDetailItem');
}
function blockedRow() {
    return document.querySelector('.coverageDetailGroup--blocked .coverageDetailRow--blocked');
}
function lane() {
    return document.querySelector('.coverageAnswerLane');
}

beforeEach(() => {
    listLogic._reset();
    queueRows = defaultQueue();
    assignmentResult = RUBRIC;
    toasts.length = 0;
    pendingAnswers.clear();
    setTriageDispatcher(null);
    document.body.innerHTML = '';
    wireBoardless();
    mountRoutedProject();
});

afterEach(() => {
    const b = document.getElementById('coverageDetailModalBackdrop');
    if (b && b.parentNode) b.parentNode.removeChild(b);
    setTriageDispatcher(null);
    vi.restoreAllMocks();
});

describe('Coverage detail — blocked aspects expand in place', () => {
    it('renders the blocked row as a disclosure, not a jump', async () => {
        await openDetail();
        const row = blockedRow();
        expect(row).toBeTruthy();
        expect(row.tagName).toBe('BUTTON');
        expect(row.classList.contains('coverageDetailRow--expandable')).toBe(true);
        expect(row.classList.contains('coverageDetailRow--jump')).toBe(false);
        expect(row.getAttribute('aria-expanded')).toBe('false');
        expect(row.querySelector('.coverageDetailChevron')).toBeTruthy();
    });

    it('keeps the modal open and reveals the answer lane when tapped', async () => {
        await openDetail();
        blockedRow().click();
        // The modal must NOT close — the whole point of the change.
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeTruthy();
        expect(blockedItem().classList.contains('is-expanded')).toBe(true);
        expect(blockedRow().getAttribute('aria-expanded')).toBe('true');
        expect(lane()).toBeTruthy();
    });

    it('collapses again on a second tap', async () => {
        await openDetail();
        blockedRow().click();
        blockedRow().click();
        expect(blockedItem().classList.contains('is-expanded')).toBe(false);
        expect(blockedRow().getAttribute('aria-expanded')).toBe('false');
    });

    it('renders the question, a 16px reply box, Discuss and Send', async () => {
        await openDetail();
        blockedRow().click();
        const l = lane();
        expect(l.querySelector('.coverageAnswerQuestion').textContent)
            .toBe('Undo one step, or a full history?');
        const input = l.querySelector('.coverageAnswerInput');
        expect(input.tagName).toBe('TEXTAREA');
        expect(input.getAttribute('aria-label')).toBe('Answer');
        const err = l.querySelector('.coverageAnswerError');
        expect(err.getAttribute('role')).toBe('alert');
        expect(err.hidden).toBe(true);
        expect(l.querySelector('.coverageAnswerDiscuss').textContent).toBe('Discuss in chat');
        expect(l.querySelector('.coverageAnswerSend').textContent).toBe('Send');
    });

    it('keeps the blocked row\'s "Confirmed" tick as a sibling of the row', async () => {
        await openDetail();
        const head = document.querySelector('.coverageDetailConfirmable');
        expect(head).toBeTruthy();
        expect(head.querySelector('.coverageDetailRow--expandable')).toBeTruthy();
        const tickEl = head.querySelector('.coverageCommitTick');
        expect(tickEl).toBeTruthy();
        // Blocked rows carry the compact icon-only variant; "Confirmed" survives
        // as the accessible name rather than visible copy.
        expect(tickEl.classList.contains('coverageCommitTick--icon')).toBe(true);
        expect(tickEl.getAttribute('aria-label')).toBe('Confirmed');
        // The tick must not nest inside the row <button> (invalid + would toggle it).
        expect(blockedRow().querySelector('.coverageCommitTick')).toBeNull();
    });

    it('leaves shipped aspects on their commit lane, not an answer lane', async () => {
        await openDetail();
        const shipped = document.querySelector('.coverageDetailRow--shipped');
        shipped.click();
        expect(document.querySelector('.coverageCommitLane')).toBeTruthy();
        // Only the blocked aspect has an answer lane.
        expect(document.querySelectorAll('.coverageAnswerLane').length).toBe(1);
    });
});

describe('Coverage answer lane — sending', () => {
    it('writes through listLogic.answerAgentTask with the row id, text and thread', async () => {
        const spy = vi.spyOn(listLogic, 'answerAgentTask').mockResolvedValue({ ok: true });
        await openDetail();
        blockedRow().click();
        const input = lane().querySelector('.coverageAnswerInput');
        input.value = '  One step at a time.  ';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        lane().querySelector('.coverageAnswerSend').click();
        expect(spy).toHaveBeenCalledWith('4', 'One step at a time.', queueRows[1].thread);
        await flush();
    });

    it('ignores whitespace-only input with no write', async () => {
        const spy = vi.spyOn(listLogic, 'answerAgentTask').mockResolvedValue({ ok: true });
        await openDetail();
        blockedRow().click();
        const input = lane().querySelector('.coverageAnswerInput');
        input.value = '   \n  ';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        lane().querySelector('.coverageAnswerSend').click();
        expect(spy).not.toHaveBeenCalled();
        expect(lane().querySelector('.coverageAnswerSend').disabled).toBe(false);
    });

    it('disables both controls while the write is in flight', async () => {
        let resolve;
        vi.spyOn(listLogic, 'answerAgentTask')
            .mockReturnValue(new Promise((r) => { resolve = r; }));
        await openDetail();
        blockedRow().click();
        const input = lane().querySelector('.coverageAnswerInput');
        const send = lane().querySelector('.coverageAnswerSend');
        input.value = 'One step.';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        send.click();
        expect(send.disabled).toBe(true);
        expect(input.disabled).toBe(true);
        expect(send.textContent).toBe('Sending…');
        resolve({ ok: true });
        await flush();
    });

    it('clears the draft and fires a triage sweep on success', async () => {
        vi.spyOn(listLogic, 'answerAgentTask').mockResolvedValue({ ok: true });
        const swept = [];
        setTriageDispatcher(function (name) { swept.push(name); return { ok: true }; });
        await openDetail();
        blockedRow().click();
        const input = lane().querySelector('.coverageAnswerInput');
        input.value = 'One step.';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(pendingAnswers.get('4')).toBe('One step.');
        lane().querySelector('.coverageAnswerSend').click();
        await flush();
        expect(pendingAnswers.has('4')).toBe(false);
        expect(swept).toEqual([currentProject]);
        expect(toasts.length).toBe(0);
    });

    it('toasts but does not roll back when the sweep fails', async () => {
        vi.spyOn(listLogic, 'answerAgentTask').mockResolvedValue({ ok: true });
        setTriageDispatcher(function () { return { ok: false }; });
        await openDetail();
        blockedRow().click();
        const input = lane().querySelector('.coverageAnswerInput');
        input.value = 'One step.';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        lane().querySelector('.coverageAnswerSend').click();
        await flush();
        // The answer is already saved — the failed sweep is advisory only.
        expect(pendingAnswers.has('4')).toBe(false);
        expect(toasts.length).toBe(1);
        expect(toasts[0].msg).toMatch(/triage didn’t start/);
    });

    it('re-enables the controls and shows the error when the write fails', async () => {
        vi.spyOn(listLogic, 'answerAgentTask').mockResolvedValue({ ok: false, error: 'nope' });
        await openDetail();
        blockedRow().click();
        const input = lane().querySelector('.coverageAnswerInput');
        const send = lane().querySelector('.coverageAnswerSend');
        input.value = 'One step.';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        send.click();
        await flush();
        expect(send.disabled).toBe(false);
        expect(input.disabled).toBe(false);
        expect(send.textContent).toBe('Send');
        const err = lane().querySelector('.coverageAnswerError');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toBe('nope');
        // The draft is kept so the answer isn't lost.
        expect(pendingAnswers.get('4')).toBe('One step.');
    });
});

describe('Coverage answer lane — Discuss in chat', () => {
    it('seeds the chat with the task context and links the row', async () => {
        await openDetail();
        blockedRow().click();
        lane().querySelector('.coverageAnswerDiscuss').click();
        expect(seeded.length).toBe(1);
        expect(seeded[0].rowId).toBe('4');
        expect(seeded[0].seed).toContain('Task: Undo');
        expect(seeded[0].seed).toContain('Let the user undo the last action.');
        expect(seeded[0].seed).toContain('The agent asked: Undo one step, or a full history?');
    });

    it('never writes to the data model', async () => {
        const spy = vi.spyOn(listLogic, 'answerAgentTask');
        await openDetail();
        blockedRow().click();
        lane().querySelector('.coverageAnswerDiscuss').click();
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('Coverage answer lane — surviving the modal\'s live rebuild', () => {
    it('re-expands the lane and restores the unsent draft after a queue repaint', async () => {
        await openDetail();
        blockedRow().click();
        const input = lane().querySelector('.coverageAnswerInput');
        input.value = 'Half a thought';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        // A row settling elsewhere rebuilds the whole modal body.
        notifyQueueChange();

        expect(blockedItem().classList.contains('is-expanded')).toBe(true);
        expect(blockedRow().getAttribute('aria-expanded')).toBe('true');
        const rebuilt = lane().querySelector('.coverageAnswerInput');
        expect(rebuilt).not.toBe(input);
        expect(rebuilt.value).toBe('Half a thought');
    });

    it('leaves a collapsed lane collapsed after a repaint', async () => {
        await openDetail();
        notifyQueueChange();
        expect(blockedItem().classList.contains('is-expanded')).toBe(false);
    });
});
