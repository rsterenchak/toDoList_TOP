import { vi } from 'vitest';

// Coverage v1, part 2 — the drillable detail behind the assignment card's
// coverage summary. Tapping the summary opens a modal listing every rubric
// aspect with its live lifecycle status (shipped / in-flight / proposed /
// blocked / not-started), each row reading "A1 — <label>". Blocked aspects (a
// needs_words question is waiting) group at the top and expand in place into an
// answer lane for that question (see coverageAnswerLane.test.js for the lane's
// own behavior); Git / process aspects the agent can't ship are set apart in a
// manual lane.
// These tests drive renderAgentView/subscribeAgentView with a fake Supabase
// client and a mocked inject.js so the assignment read is deterministic.

// ── Supabase stub ────────────────────────────────────────────────────
let queueRows = [];
let queueError = null;
// Every row id a delete was issued against, in call order, plus the ids whose
// delete should come back as an error — the Clear all tests drive both.
let deletedIds = [];
let deleteFailIds = new Set();

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
            delete: () => ({
                eq: (col, val) => {
                    deletedIds.push(val);
                    return Promise.resolve(deleteFailIds.has(val)
                        ? { data: null, error: { message: 'Delete failed.' } }
                        : { data: [], error: null });
                },
            }),
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
    findTargetById: () => ({ repo: 'owner/repo', file_path: 'TODO.md', purpose: 'assignment' }),
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
    deletedIds = [];
    deleteFailIds = new Set();
    assignmentResult = RUBRIC;
    try { localStorage.removeItem('todoapp_agentBucketCollapsed'); } catch (e) { /* noop */ }
    document.body.classList.remove('agentUnavailable');
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribeAgentView();
    const b = document.getElementById('coverageDetailModalBackdrop');
    if (b && b.parentNode) b.parentNode.removeChild(b);
    const c = document.getElementById('coverageClearConfirmBackdrop');
    if (c && c.parentNode) c.parentNode.removeChild(c);
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

    it('groups blocked aspects at the top as disclosure buttons', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '9', state: 'needs_words', aspect: 'A2', question: 'Which?', context: { title: 'Delete' } },
        ];
        await loadBoard();
        openDetail();
        const group = document.querySelector('.coverageDetailGroup--blocked');
        expect(group).toBeTruthy();
        const btn = group.querySelector('.coverageDetailRow--blocked');
        expect(btn).toBeTruthy();
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.classList.contains('coverageDetailRow--expandable')).toBe(true);
        expect(btn.querySelector('.coverageDetailChevron')).toBeTruthy();
        expect(btn.querySelector('.coverageDetailId').textContent).toBe('A2');
    });

    it('expands a blocked aspect into its answer lane without closing the modal', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '9', state: 'needs_words', aspect: 'A2', question: 'Which?', context: { title: 'Delete' } },
        ];
        await loadBoard();
        openDetail();
        const btn = document.querySelector('.coverageDetailRow--blocked');
        btn.click();
        // The modal stays open — the question is answered here, in place. (It used
        // to close and hand off to the Agent board, whose surface no longer exists.)
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeTruthy();
        const item = document.querySelector('.coverageDetailGroup--blocked .coverageDetailItem');
        expect(item.classList.contains('is-expanded')).toBe(true);
        const lane = item.querySelector('.coverageAnswerLane');
        expect(lane).toBeTruthy();
        expect(lane.querySelector('.coverageAnswerQuestion').textContent).toBe('Which?');
        expect(lane.querySelector('.coverageAnswerInput')).toBeTruthy();
    });

    it('leaves the board untouched when a blocked aspect is expanded', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '9', state: 'needs_words', aspect: 'A2', question: 'Which?', context: { title: 'Delete' } },
        ];
        localStorage.setItem('todoapp_agentBucketCollapsed', JSON.stringify({ 'needs-you': true }));
        await loadBoard();
        // Bucket starts collapsed.
        expect(document.querySelector('.agentBucket--needs-you.collapsed')).toBeTruthy();
        openDetail();
        document.querySelector('.coverageDetailRow--blocked').click();
        // Expanding answers in place, so it must not reach into the board's
        // bucket-collapse state the way the retired jump did.
        expect(document.querySelector('.agentBucket--needs-you.collapsed')).toBeTruthy();
    });
});

describe('AGENT coverage detail modal — shipped commit helper', () => {
    it('makes a shipped aspect row a tap-to-expand toggle with a chevron', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add a menu-driven loop' } }];
        await loadBoard();
        openDetail();
        const shipped = document.querySelector('.coverageDetailRow--shipped');
        expect(shipped).toBeTruthy();
        expect(shipped.tagName).toBe('BUTTON');
        expect(shipped.classList.contains('coverageDetailRow--expandable')).toBe(true);
        expect(shipped.getAttribute('aria-expanded')).toBe('false');
        expect(shipped.querySelector('.coverageDetailChevron')).toBeTruthy();
    });

    it('does not expand non-shipped aspects (proposed / not-started / manual)', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'proposed', aspect: 'A1', context: { title: 'Add' } }];
        await loadBoard();
        openDetail();
        expect(document.querySelector('.coverageDetailRow--expandable')).toBeNull();
        expect(document.querySelector('.coverageCommitLane')).toBeNull();
    });

    it('toggles the commit-helper lane open and closed on tap', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add a menu-driven loop' } }];
        await loadBoard();
        openDetail();
        const shipped = document.querySelector('.coverageDetailRow--shipped');
        const item = shipped.closest('.coverageDetailItem');
        expect(item).toBeTruthy();
        expect(item.classList.contains('is-expanded')).toBe(false);
        shipped.click();
        expect(item.classList.contains('is-expanded')).toBe(true);
        expect(shipped.getAttribute('aria-expanded')).toBe('true');
        shipped.click();
        expect(item.classList.contains('is-expanded')).toBe(false);
        expect(shipped.getAttribute('aria-expanded')).toBe('false');
    });

    it('shows a commit message of "<title> (<aspect id>)"', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add a menu-driven loop' } }];
        await loadBoard();
        openDetail();
        const msg = document.querySelector('.coverageCommitMsg');
        expect(msg).toBeTruthy();
        expect(msg.textContent).toBe('Add a menu-driven loop (A1)');
    });

    it('falls back to the aspect label when a shipped row has no title', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: {} }];
        await loadBoard();
        openDetail();
        const msg = document.querySelector('.coverageCommitMsg');
        expect(msg.textContent).toBe('Menu-driven interface (A1)');
    });

    it('copies the commit message to the clipboard on Copy', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        const orig = navigator.clipboard;
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        try {
            mountRoutedProject();
            queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add a menu-driven loop' } }];
            await loadBoard();
            openDetail();
            document.querySelector('.coverageDetailRow--shipped').click();
            document.querySelector('.coverageCommitCopy').click();
            expect(writeText).toHaveBeenCalledWith('Add a menu-driven loop (A1)');
        } finally {
            Object.defineProperty(navigator, 'clipboard', { value: orig, configurable: true });
        }
    });

    it('renders the deduped union of file_paths across the aspect\'s shipped rows', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' }, file_paths: ['src/a.js', 'src/b.js'] },
            { id: '2', state: 'shipped', aspect: 'A1', context: { title: 'More' }, file_paths: ['src/b.js', 'src/c.js'] },
        ];
        await loadBoard();
        openDetail();
        document.querySelector('.coverageDetailRow--shipped').click();
        const files = Array.from(document.querySelectorAll('.coverageCommitManifestPath'))
            .map((el) => el.textContent);
        expect(files).toEqual(['src/a.js', 'src/b.js', 'src/c.js']);
        expect(document.querySelector('.coverageCommitManifestLabel').textContent).toBe('3 files');
        // Each manifest row carries a per-file Copy button.
        expect(document.querySelectorAll('.coverageCommitFileCopy').length).toBe(3);
    });

    it('shows an empty-manifest note when no file_paths are recorded', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        await loadBoard();
        openDetail();
        document.querySelector('.coverageDetailRow--shipped').click();
        expect(document.querySelector('.coverageCommitManifest')).toBeNull();
        expect(document.querySelector('.coverageCommitManifestEmpty')).toBeTruthy();
    });
});

describe('AGENT coverage detail modal — Clear all', () => {
    const clearBtn = () => document.getElementById('coverageDetailModalClearBtn');
    const confirmBackdrop = () => document.getElementById('coverageClearConfirmBackdrop');

    it('hides the control when every row has shipped', async () => {
        mountRoutedProject();
        queueRows = [{ id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } }];
        await loadBoard();
        openDetail();
        expect(clearBtn()).toBeTruthy();
        expect(clearBtn().hidden).toBe(true);
    });

    it('hides the control when there are no queue rows at all', async () => {
        mountRoutedProject();
        await loadBoard();
        openDetail();
        expect(clearBtn().hidden).toBe(true);
    });

    it('shows the control once a non-shipped row exists', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } },
            { id: '2', state: 'proposed', aspect: 'A2', context: { title: 'Delete' } },
        ];
        await loadBoard();
        openDetail();
        expect(clearBtn().hidden).toBe(false);
        expect(clearBtn().textContent).toBe('Clear all');
    });

    it('asks for confirmation naming the count and keeping shipped rows, before deleting anything', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } },
            { id: '2', state: 'proposed', aspect: 'A2', context: { title: 'Delete' } },
            { id: '3', state: 'needs_words', aspect: 'B1', question: 'Which?', context: { title: 'Persist' } },
        ];
        await loadBoard();
        openDetail();
        clearBtn().click();
        await flush();
        const msg = document.getElementById('coverageClearConfirmMessage');
        expect(msg).toBeTruthy();
        // The count is the non-shipped tally (2), not the row total (3).
        expect(msg.textContent).toContain('Remove 2 queue rows');
        expect(msg.textContent).toContain('Shipped rows are kept');
        // Nothing goes until the prompt is answered.
        expect(deletedIds).toEqual([]);
    });

    it('deletes nothing and leaves the detail modal open on Cancel', async () => {
        mountRoutedProject();
        queueRows = [{ id: '2', state: 'proposed', aspect: 'A2', context: { title: 'Delete' } }];
        await loadBoard();
        openDetail();
        clearBtn().click();
        document.getElementById('coverageClearConfirmCancel').click();
        await flush();
        expect(confirmBackdrop()).toBeNull();
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeTruthy();
        expect(deletedIds).toEqual([]);
    });

    it('deletes nothing when the confirmation is dismissed with Escape', async () => {
        mountRoutedProject();
        queueRows = [{ id: '2', state: 'proposed', aspect: 'A2', context: { title: 'Delete' } }];
        await loadBoard();
        openDetail();
        clearBtn().click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flush();
        expect(confirmBackdrop()).toBeNull();
        expect(deletedIds).toEqual([]);
        // Escape cancels the prompt only — the list it was about to clear stays up.
        expect(document.getElementById('coverageDetailModalBackdrop')).toBeTruthy();
    });

    it('removes every non-shipped row on confirm and leaves shipped rows untouched', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '1', state: 'shipped', aspect: 'A1', context: { title: 'Add' } },
            { id: '2', state: 'proposed', aspect: 'A2', context: { title: 'Delete' } },
            { id: '3', state: 'needs_words', aspect: 'B1', question: 'Which?', context: { title: 'Persist' } },
            { id: '4', state: 'failed', aspect: 'A2', context: { title: 'Retry me' } },
        ];
        await loadBoard();
        openDetail();
        clearBtn().click();
        document.getElementById('coverageClearConfirmOk').click();
        await flush(20);
        // Blocked and failed rows go too — getProposedRows would have skipped them.
        expect(deletedIds).toEqual(['2', '3', '4']);
        expect(deletedIds).not.toContain('1');
        expect(document.getElementById('coverageDetailModalClearError').hidden).toBe(true);
    });

    it('re-hides the control once the cleared rows are gone', async () => {
        mountRoutedProject();
        queueRows = [{ id: '2', state: 'proposed', aspect: 'A2', context: { title: 'Delete' } }];
        await loadBoard();
        openDetail();
        expect(clearBtn().hidden).toBe(false);
        clearBtn().click();
        document.getElementById('coverageClearConfirmOk').click();
        // The reload after the walk sees the emptied queue.
        queueRows = [];
        await flush(20);
        expect(clearBtn().hidden).toBe(true);
        // The aspect falls back to not-started, ready for the next derive pass.
        expect(document.querySelector('.coverageDetailRow--not-started')).toBeTruthy();
    });

    it('reports the failed count inline and does not roll back the rows that went', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '2', state: 'proposed', aspect: 'A2', context: { title: 'Delete' } },
            { id: '3', state: 'needs_words', aspect: 'B1', question: 'Which?', context: { title: 'Persist' } },
        ];
        deleteFailIds = new Set(['3']);
        await loadBoard();
        openDetail();
        clearBtn().click();
        document.getElementById('coverageClearConfirmOk').click();
        await flush(20);
        // The walk continues past the refusal — both rows were attempted.
        expect(deletedIds).toEqual(['2', '3']);
        const err = document.getElementById('coverageDetailModalClearError');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toBe('1 of 2 could not be removed. Try again.');
        // The control comes back out of its pending state, ready for a retry.
        expect(clearBtn().disabled).toBe(false);
        expect(clearBtn().textContent).toBe('Clear all');
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
