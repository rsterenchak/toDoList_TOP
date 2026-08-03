import { vi } from 'vitest';

// Coverage confirmation — every aspect (not just the shipped commit lane and the
// manual Git lane) carries a confirmation tick, so any aspect can be signed off
// by hand alongside its derived status. Confirmation is a second, independent
// axis persisted to aspect_submissions; it never overrides the derived
// lifecycle. These tests drive subscribeAgentView with a table-aware fake
// Supabase client so agent_queue and aspect_submissions are controlled
// separately.

// ── Supabase stub — table-aware ─────────────────────────────────────────
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

// A1 shipped, A2 in-flight, B1 not-started, C1 proposed, D1 blocked, G1 process.
const RUBRIC = {
    ok: true,
    content: [
        '# Assignment', '',
        '## Requirements',
        '- **A1** — Menu-driven interface',
        '- **A2** — Task deletion works',
        '- **B1** — State persists across reload',
        '- **C1** — Sorting option available',
        '- **D1** — Undo the last action',
        '- **G1** — Clean commit history', '',
        '## Rubric',
        '- **A1 — Competent:** The program presents a menu-driven interface.',
        '- **A2 — Competent:** Tasks can be removed from the list.',
        '- **B1 — Competent:** State survives a full reload.',
        '- **C1 — Competent:** The list can be sorted.',
        '- **D1 — Competent:** The last action can be undone.',
        '- **G1 — Competent:** Commit history is clean and well-scoped.',
    ].join('\n'),
};

function defaultQueue() {
    return [
        { id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add menu' } },
        { id: '2', state: 'running', aspect: 'A2', context: { title: 'Delete' } },
        { id: '3', state: 'proposed', aspect: 'C1', draft: '- [ ] sort', context: { title: 'Sort' } },
        { id: '4', state: 'needs_words', aspect: 'D1', question: 'Which?', context: { title: 'Undo' } },
    ];
}

let projCounter = 0;
let currentProject = null;
function mountRoutedProject() {
    const name = 'Confirm-' + (projCounter++);
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
function tickFor(statusClass) {
    return document.querySelector('.coverageDetailRow--' + statusClass + ' .coverageCommitTick') ||
        document.querySelector('.coverageDetailConfirmable .coverageCommitTick');
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

describe('Coverage confirmation tick — rendering on every aspect', () => {
    it('renders a "Confirmed" tick on in-progress, proposed, and not-started rows', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        await loadBoard();
        openDetail();
        await flush();
        ['in-flight', 'proposed', 'not-started'].forEach((statusClass) => {
            const row = document.querySelector('.coverageDetailRow--' + statusClass);
            expect(row).toBeTruthy();
            const tickEl = row.querySelector('.coverageCommitTick');
            expect(tickEl).toBeTruthy();
            expect(tickEl.getAttribute('role')).toBe('checkbox');
            expect(tickEl.querySelector('.coverageCommitTickLabel').textContent).toBe('Confirmed');
        });
    });

    it('pairs the blocked row with a "Confirmed" tick as a sibling of the disclosure button', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        await loadBoard();
        openDetail();
        await flush();
        const wrap = document.querySelector('.coverageDetailConfirmable');
        expect(wrap).toBeTruthy();
        const disclosure = wrap.querySelector('.coverageDetailRow--expandable');
        const tickEl = wrap.querySelector('.coverageCommitTick');
        expect(disclosure).toBeTruthy();
        expect(tickEl).toBeTruthy();
        expect(tickEl.getAttribute('aria-label')).toBe('Confirmed');
        // The tick must NOT nest inside the row <button> (invalid + would toggle it).
        expect(disclosure.querySelector('.coverageCommitTick')).toBeNull();
    });

    // Regression: a text-labelled tick made the blocked row wider than the modal
    // on mobile, pushing the confirm control off the right edge. Blocked rows get
    // the compact icon-only variant instead — no visible label, no label span,
    // and "Confirmed" carried as the accessible name.
    it('renders the blocked row\'s tick icon-only, with a stroked checkmark and no text label', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        await loadBoard();
        openDetail();
        await flush();
        const tickEl = document.querySelector('.coverageDetailConfirmable .coverageCommitTick');
        expect(tickEl.classList.contains('coverageCommitTick--icon')).toBe(true);
        expect(tickEl.querySelector('.coverageCommitTickLabel')).toBeNull();
        expect(tickEl.textContent).toBe('');
        expect(tickEl.getAttribute('aria-label')).toBe('Confirmed');
        expect(tickEl.getAttribute('title')).toBe('Confirmed');
        const svg = tickEl.querySelector('svg');
        expect(svg).toBeTruthy();
        expect(svg.getAttribute('stroke')).toBe('currentColor');
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.querySelector('path')).toBeTruthy();
    });

    // Only blocked rows go icon-only — every other lane keeps its labelled tick.
    it('leaves the other lanes on the labelled tick variant', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        await loadBoard();
        openDetail();
        await flush();
        const row = document.querySelector('.coverageDetailRow--in-flight');
        const labelled = row.querySelector('.coverageCommitTick');
        expect(labelled.classList.contains('coverageCommitTick--icon')).toBe(false);
        expect(labelled.querySelector('.coverageCommitTickLabel').textContent).toBe('Confirmed');
        const manual = document.querySelector('.coverageDetailRow--manual .coverageCommitTick');
        expect(manual.classList.contains('coverageCommitTick--icon')).toBe(false);
    });

    // The visual changed; the confirm behaviour did not — the icon tick still
    // toggles aria-checked and persists through the same listLogic write.
    it('keeps the blocked row\'s icon tick behaving as a checkbox that persists', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        const spy = vi.spyOn(listLogic, 'setAspectSubmitted').mockResolvedValue({ ok: true });
        await loadBoard();
        openDetail();
        await flush();
        const tickEl = document.querySelector('.coverageDetailConfirmable .coverageCommitTick');
        expect(tickEl.getAttribute('role')).toBe('checkbox');
        expect(tickEl.getAttribute('aria-checked')).toBe('false');
        tickEl.click();
        expect(tickEl.getAttribute('aria-checked')).toBe('true');
        expect(tickEl.classList.contains('is-committed')).toBe(true);
        const pid = listLogic.getProjectId(currentProject);
        expect(spy).toHaveBeenCalledWith(pid, 'D1', true);
        await flush();
        expect(tickEl.classList.contains('is-committed')).toBe(true);
    });

    it('keeps the manual aspect on its "mark done" tick only (no second tick)', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        await loadBoard();
        openDetail();
        await flush();
        const manual = document.querySelector('.coverageDetailRow--manual');
        const ticks = manual.querySelectorAll('.coverageCommitTick');
        expect(ticks.length).toBe(1);
        expect(ticks[0].querySelector('.coverageCommitTickLabel').textContent).toBe('mark done');
    });

    it('keeps the shipped aspect confirming through its commit-lane tick', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        await loadBoard();
        openDetail();
        await flush();
        // The collapsed shipped row itself carries no tick; its tick lives in the lane.
        const shipped = document.querySelector('.coverageDetailRow--shipped');
        expect(shipped.querySelector('.coverageCommitTick')).toBeNull();
        const lane = document.querySelector('.coverageCommitLane .coverageCommitTick');
        expect(lane).toBeTruthy();
        expect(lane.querySelector('.coverageCommitTickLabel').textContent).toBe('Committed to GitLab');
    });
});

describe('Coverage confirmation tick — persistence and independence', () => {
    it('persists a not-started confirmation via listLogic and bumps the header count', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        const spy = vi.spyOn(listLogic, 'setAspectSubmitted').mockResolvedValue({ ok: true });
        await loadBoard();
        openDetail();
        await flush();
        const row = document.querySelector('.coverageDetailRow--not-started');
        const tickEl = row.querySelector('.coverageCommitTick');
        tickEl.click();
        expect(tickEl.classList.contains('is-committed')).toBe(true);
        const pid = listLogic.getProjectId(currentProject);
        expect(spy).toHaveBeenCalledWith(pid, 'B1', true);
        expect(document.getElementById('coverageDetailModalCommitted').textContent)
            .toBe('1 committed to GitLab');
        await flush();
        expect(tickEl.classList.contains('is-committed')).toBe(true);
    });

    it('reverts the confirmation and the count when the write fails', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        vi.spyOn(listLogic, 'setAspectSubmitted').mockResolvedValue({ ok: false, error: 'nope' });
        await loadBoard();
        openDetail();
        await flush();
        const tickEl = document.querySelector('.coverageDetailRow--proposed .coverageCommitTick');
        tickEl.click();
        expect(tickEl.classList.contains('is-committed')).toBe(true);
        await flush();
        expect(tickEl.classList.contains('is-committed')).toBe(false);
        expect(document.getElementById('coverageDetailModalCommitted').textContent)
            .toBe('0 committed to GitLab');
    });

    it('does not change the derived status when an aspect is confirmed', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        vi.spyOn(listLogic, 'setAspectSubmitted').mockResolvedValue({ ok: true });
        await loadBoard();
        openDetail();
        await flush();
        const row = document.querySelector('.coverageDetailRow--in-flight');
        const tickEl = row.querySelector('.coverageCommitTick');
        tickEl.click();
        // Confirmation is a second axis: the derived status class and word stay put.
        expect(document.querySelector('.coverageDetailRow--in-flight')).toBeTruthy();
        expect(row.querySelector('.coverageDetailStatus').textContent).toBe('In progress');
    });

    it('does not expand the answer lane when the blocked row\'s confirmation tick is clicked', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        vi.spyOn(listLogic, 'setAspectSubmitted').mockResolvedValue({ ok: true });
        await loadBoard();
        openDetail();
        await flush();
        const tickEl = document.querySelector('.coverageDetailConfirmable .coverageCommitTick');
        tickEl.click();
        // The row's disclosure toggle must not have fired, and the modal stays open.
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeTruthy();
        const item = document.querySelector('.coverageDetailGroup--blocked .coverageDetailItem');
        expect(item.classList.contains('is-expanded')).toBe(false);
        expect(tickEl.classList.contains('is-committed')).toBe(true);
    });
});

describe('Coverage confirmation tick — hydration', () => {
    it('reflects a stored confirmation on a non-process, non-shipped aspect', async () => {
        mountRoutedProject();
        queueRows = defaultQueue();
        submissionRows = [{ aspect: 'A2' }];
        await loadBoard();
        openDetail();
        await flush();
        const row = document.querySelector('.coverageDetailRow--in-flight');
        expect(row.querySelector('.coverageCommitTick').classList.contains('is-committed')).toBe(true);
        expect(document.getElementById('coverageDetailModalCommitted').textContent)
            .toBe('1 committed to GitLab');
    });
});
