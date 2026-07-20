import { vi } from 'vitest';

// Coverage v1, part 2 — the drillable detail behind the assignment card's
// coverage summary. Tapping the summary opens a modal listing every rubric
// aspect with its live lifecycle status (shipped / in-flight / proposed /
// blocked / not-started), each row reading "A1 — <label>". Blocked aspects (a
// needs_words question is waiting) group at the top and jump to that question;
// Git / process aspects the agent can't ship are set apart in a manual lane.
// These tests drive renderAgentView/subscribeAgentView with a fake Supabase
// client and a mocked inject.js so the assignment read is deterministic.

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
import {
    subscribeAgentView,
    unsubscribeAgentView,
} from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) {
    for (let i = 0; i < n; i++) await tick();
}

// A filled spec whose `## Requirements` section carries the four aspect labels in
// the real `**A1** — <what to build>` form, and whose `## Rubric` section carries
// the graded aspect IDs in the real `**A1 — Competent:** <bar>` form. Labels are
// sourced from Requirements (the short task phrase); the aspect-ID list stays on
// the Rubric. A1/A2/B1 are agent-shippable; G1 is a Git/process aspect.
const RUBRIC = {
    ok: true,
    content: [
        '# Assignment',
        '',
        '## Requirements',
        '- **A1** — Menu-driven interface',
        '- **A2** — Task deletion works',
        '- **B1** — State persists across reload',
        '- **G1** — Clean commit history',
        '',
        '## Rubric',
        '- **A1 — Competent:** The program presents a menu-driven interface.',
        '- **A2 — Competent:** Tasks can be removed from the list.',
        '- **B1 — Competent:** State survives a full reload.',
        '- **G1 — Competent:** Commit history is clean and well-scoped.',
    ].join('\n'),
};

let projCounter = 0;
function mountRoutedProject() {
    const name = 'Cov-' + (projCounter++);
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

function openDetail() {
    const summary = document.querySelector('.agentCoverage');
    summary.click();
}

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    queueError = null;
    assignmentResult = RUBRIC;
    try { localStorage.removeItem('todoapp_agentBucketCollapsed'); } catch (e) { /* noop */ }
    document.body.classList.remove('agentUnavailable');
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribeAgentView();
    const b = document.getElementById('coverageDetailModalBackdrop');
    if (b && b.parentNode) b.parentNode.removeChild(b);
});

describe('AGENT coverage summary — tappable affordance', () => {
    it('renders the summary as a button with a chevron', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        await loadBoard();
        const summary = document.querySelector('.agentCoverage');
        expect(summary).toBeTruthy();
        expect(summary.getAttribute('role')).toBe('button');
        expect(summary.getAttribute('tabindex')).toBe('0');
        expect(summary.querySelector('.agentCoverageChevron')).toBeTruthy();
    });

    it('does not open the assignment editor when the summary is clicked', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        await loadBoard();
        openDetail();
        // The coverage modal opens; the assignment editor modal does not.
        expect(document.getElementById('coverageDetailModal')).toBeTruthy();
        expect(document.getElementById('assignmentEditorModalBackdrop')).toBeNull();
    });
});

describe('AGENT coverage detail modal', () => {
    it('lists each rubric aspect with its ID and label', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        await loadBoard();
        openDetail();
        const rows = document.querySelectorAll('.coverageDetailRow');
        // A1, A2, B1, G1 → four rows.
        expect(rows.length).toBe(4);
        const ids = Array.from(document.querySelectorAll('.coverageDetailId'))
            .map((el) => el.textContent);
        expect(ids).toContain('A1');
        expect(ids).toContain('G1');
        const labels = Array.from(document.querySelectorAll('.coverageDetailLabel'))
            .map((el) => el.textContent);
        expect(labels).toContain('Menu-driven interface');
        expect(labels).toContain('State persists across reload');
    });

    it('sources labels from the requirement text, not the rubric bar, with no markdown leak', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        await loadBoard();
        openDetail();
        const labels = Array.from(document.querySelectorAll('.coverageDetailLabel'))
            .map((el) => el.textContent);
        // The requirement phrase, not the rubric's "Competent:** …" grading bar.
        expect(labels).toContain('Menu-driven interface');
        expect(labels).toContain('Clean commit history');
        labels.forEach((label) => {
            expect(label).not.toMatch(/Competent/);
            expect(label).not.toContain('*');
        });
    });

    it('color-codes each aspect by its live lifecycle status', async () => {
        mountRoutedProject();
        // A1 shipped, A2 needs_words (blocked), B1 has no row (not-started),
        // G1 is a process aspect (manual).
        queueRows = [
            { id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } },
            { id: '2', state: 'needs_words', aspect: 'A2', question: 'Which?', context: { title: 'Delete' } },
        ];
        await loadBoard();
        openDetail();
        expect(document.querySelector('.coverageDetailRow--shipped')).toBeTruthy();
        expect(document.querySelector('.coverageDetailRow--blocked')).toBeTruthy();
        expect(document.querySelector('.coverageDetailRow--not-started')).toBeTruthy();
        expect(document.querySelector('.coverageDetailRow--manual')).toBeTruthy();
    });

    it('sets Git/process aspects apart in a manual lane reading "manual · outstanding"', async () => {
        mountRoutedProject();
        await loadBoard();
        openDetail();
        const manual = document.querySelector('.coverageDetailGroup--manual');
        expect(manual).toBeTruthy();
        const manualRow = manual.querySelector('.coverageDetailRow--manual');
        expect(manualRow).toBeTruthy();
        expect(manualRow.querySelector('.coverageDetailId').textContent).toBe('G1');
        expect(manualRow.querySelector('.coverageDetailStatus').textContent)
            .toBe('manual · outstanding');
    });

    it('groups blocked aspects at the top as jump buttons', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '9', state: 'needs_words', aspect: 'A2', question: 'Which?', context: { title: 'Delete' } },
        ];
        await loadBoard();
        openDetail();
        const group = document.querySelector('.coverageDetailGroup--blocked');
        expect(group).toBeTruthy();
        const btn = group.querySelector('.coverageDetailRow--jump');
        expect(btn).toBeTruthy();
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.querySelector('.coverageDetailId').textContent).toBe('A2');
    });

    it('jumping a blocked aspect closes the modal and focuses its answer input', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '9', state: 'needs_words', aspect: 'A2', question: 'Which?', context: { title: 'Delete' } },
        ];
        await loadBoard();
        openDetail();
        const btn = document.querySelector('.coverageDetailRow--jump');
        btn.click();
        // Modal is gone…
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeNull();
        // …and focus landed on that row's answer input.
        const input = document.querySelector('[data-answer-row="9"]');
        expect(input).toBeTruthy();
        expect(document.activeElement).toBe(input);
    });

    it('expands a collapsed Needs-you bucket before jumping', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '9', state: 'needs_words', aspect: 'A2', question: 'Which?', context: { title: 'Delete' } },
        ];
        localStorage.setItem('todoapp_agentBucketCollapsed', JSON.stringify({ 'needs-you': true }));
        await loadBoard();
        // Bucket starts collapsed.
        expect(document.querySelector('.agentBucket--needs-you.collapsed')).toBeTruthy();
        openDetail();
        document.querySelector('.coverageDetailRow--jump').click();
        // The jump repainted the board with the bucket expanded.
        expect(document.querySelector('.agentBucket--needs-you.collapsed')).toBeNull();
    });
});

describe('AGENT coverage detail modal — dismissal', () => {
    it('closes on the Close button', async () => {
        mountRoutedProject();
        await loadBoard();
        openDetail();
        document.getElementById('coverageDetailModalCloseBtn').click();
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeNull();
    });

    it('closes on Escape', async () => {
        mountRoutedProject();
        await loadBoard();
        openDetail();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeNull();
    });

    it('closes on a backdrop click', async () => {
        mountRoutedProject();
        await loadBoard();
        openDetail();
        const backdrop = document.getElementById('coverageDetailModalBackdrop');
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeNull();
    });
});
