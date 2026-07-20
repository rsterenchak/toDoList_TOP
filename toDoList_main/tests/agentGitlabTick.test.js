import { vi } from 'vitest';

// GitLab lane, part 2 — the "committed to GitLab" submission tick. Each shipped
// aspect's expansion gains a "Committed to GitLab" checkbox and the manual
// (Git/process) aspect gets a "mark done" tick; both persist to the
// aspect_submissions table (row-presence = committed) via listLogic. The modal
// header shows an "N committed to GitLab" count that tracks the ticks. These
// tests drive subscribeAgentView with a table-aware fake Supabase client so the
// agent_queue read and the aspect_submissions read/write are independently
// controllable.

// ── Supabase stub — table-aware so agent_queue and aspect_submissions are
//    driven separately. ─────────────────────────────────────────────────
let queueRows = [];
let submissionRows = [];

function queueTable() {
    return {
        select: () => ({ eq: () => Promise.resolve({ data: queueRows, error: null }) }),
        insert: (row) => Promise.resolve({ data: [row], error: null }),
        update: (patch) => ({ eq: () => Promise.resolve({ data: [patch], error: null }) }),
        delete: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    };
}
function submissionsTable() {
    return {
        select: () => ({ eq: () => Promise.resolve({ data: submissionRows, error: null }) }),
        upsert: (row) => Promise.resolve({ data: [row], error: null }),
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    };
}

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: (table) => (table === 'aspect_submissions' ? submissionsTable() : queueTable()),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

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
    readAssignmentFromWorker: () => Promise.resolve(assignmentResult),
    findTargetById: () => ({ repo: 'owner/repo', file_path: 'TODO.md' }),
    showInjectToast: () => {},
    isInjectConfigured: () => true,
    chatWithWorker: () => Promise.resolve({ ok: true, reply: '' }),
    revertEntry: () => Promise.resolve({ ok: true }),
}));

import { listLogic } from '../src/listLogic.js';
import { subscribeAgentView, unsubscribeAgentView } from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) {
    for (let i = 0; i < n; i++) await tick();
}

const RUBRIC = {
    ok: true,
    content: [
        '# Assignment', '',
        '## Requirements',
        '- **A1** — Menu-driven interface',
        '- **A2** — Task deletion works',
        '- **G1** — Clean commit history', '',
        '## Rubric',
        '- **A1 — Competent:** The program presents a menu-driven interface.',
        '- **A2 — Competent:** Tasks can be removed from the list.',
        '- **G1 — Competent:** Commit history is clean and well-scoped.',
    ].join('\n'),
};

let projCounter = 0;
let currentProject = null;
function mountRoutedProject() {
    const name = 'Tick-' + (projCounter++);
    listLogic.addProject(name);
    listLogic.setProjectTargetId(name, 'target-1');
    currentProject = name;
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>' +
        '<div id="agentView"></div>';
    return name;
}

async function loadBoard() {
    subscribeAgentView();
    await flush();
}
function openDetail() {
    document.querySelector('.agentCoverage').click();
}
function expandShipped() {
    document.querySelector('.coverageDetailRow--shipped').click();
}

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    submissionRows = [];
    assignmentResult = RUBRIC;
    try { localStorage.removeItem('todoapp_agentBucketCollapsed'); } catch (e) { /* noop */ }
    document.body.classList.remove('agentUnavailable');
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribeAgentView();
    const b = document.getElementById('coverageDetailModalBackdrop');
    if (b && b.parentNode) b.parentNode.removeChild(b);
    vi.restoreAllMocks();
});

describe('GitLab submission tick — rendering', () => {
    it('adds a "Committed to GitLab" tick inside a shipped aspect expansion', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        await loadBoard();
        openDetail();
        await flush();
        const lane = document.querySelector('.coverageCommitLane');
        const tickEl = lane.querySelector('.coverageCommitTick');
        expect(tickEl).toBeTruthy();
        expect(tickEl.getAttribute('role')).toBe('checkbox');
        expect(tickEl.querySelector('.coverageCommitTickLabel').textContent)
            .toBe('Committed to GitLab');
    });

    it('adds a "mark done" tick on the manual Git/process aspect row', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        await loadBoard();
        openDetail();
        await flush();
        const manual = document.querySelector('.coverageDetailRow--manual');
        const tickEl = manual.querySelector('.coverageCommitTick');
        expect(tickEl).toBeTruthy();
        expect(tickEl.querySelector('.coverageCommitTickLabel').textContent).toBe('mark done');
    });

    it('shows a committed count in the header, starting at 0 with no submissions', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        await loadBoard();
        openDetail();
        await flush();
        expect(document.getElementById('coverageDetailModalCommitted').textContent)
            .toBe('0 committed to GitLab');
    });
});

describe('GitLab submission tick — hydration from stored submissions', () => {
    it('reflects stored committed aspects and counts them once the read resolves', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        submissionRows = [{ aspect: 'A1' }];
        await loadBoard();
        openDetail();
        await flush();
        const lane = document.querySelector('.coverageCommitLane');
        expect(lane.querySelector('.coverageCommitTick').classList.contains('is-committed'))
            .toBe(true);
        expect(document.getElementById('coverageDetailModalCommitted').textContent)
            .toBe('1 committed to GitLab');
    });
});

describe('GitLab submission tick — toggle', () => {
    it('optimistically commits, persists via listLogic, and updates the header count', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        const spy = vi.spyOn(listLogic, 'setAspectSubmitted')
            .mockResolvedValue({ ok: true });
        await loadBoard();
        openDetail();
        await flush();
        expandShipped();
        const tickEl = document.querySelector('.coverageCommitLane .coverageCommitTick');
        tickEl.click();
        // Optimistic flip is synchronous.
        expect(tickEl.classList.contains('is-committed')).toBe(true);
        expect(document.getElementById('coverageDetailModalCommitted').textContent)
            .toBe('1 committed to GitLab');
        const pid = listLogic.getProjectId(currentProject);
        expect(spy).toHaveBeenCalledWith(pid, 'A1', true);
        await flush();
        // Still committed after the successful write resolves.
        expect(tickEl.classList.contains('is-committed')).toBe(true);
    });

    it('reverts the tick and the count when the write fails', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        vi.spyOn(listLogic, 'setAspectSubmitted')
            .mockResolvedValue({ ok: false, error: 'nope' });
        await loadBoard();
        openDetail();
        await flush();
        expandShipped();
        const tickEl = document.querySelector('.coverageCommitLane .coverageCommitTick');
        tickEl.click();
        expect(tickEl.classList.contains('is-committed')).toBe(true);
        await flush();
        // Reverted after failure.
        expect(tickEl.classList.contains('is-committed')).toBe(false);
        expect(document.getElementById('coverageDetailModalCommitted').textContent)
            .toBe('0 committed to GitLab');
    });

    it('does not collapse the expansion when the committed tick is clicked', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        vi.spyOn(listLogic, 'setAspectSubmitted').mockResolvedValue({ ok: true });
        await loadBoard();
        openDetail();
        await flush();
        expandShipped();
        const item = document.querySelector('.coverageDetailItem');
        expect(item.classList.contains('is-expanded')).toBe(true);
        document.querySelector('.coverageCommitLane .coverageCommitTick').click();
        // stopPropagation keeps the expansion open.
        expect(item.classList.contains('is-expanded')).toBe(true);
    });
});
