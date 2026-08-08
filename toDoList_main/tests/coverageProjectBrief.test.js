import { vi } from 'vitest';

// The coverage surface is fed by a repo's context document, and which document
// that is comes from the routed target's registry `purpose`: an assignment repo
// is graded against `assignment.md`, a personal repo is described by a
// `project.md` beside the same TODO.md. A brief has no `## Requirements`
// contract and no rubric, so it classifies on its own body and reports no
// aspects — which routes it through the existing untallied paths (no coverage
// fraction, no bar). Its user-visible copy says "brief" where the assignment
// flow says "assignment". These tests drive the real assignmentCoverage +
// modals modules with a mocked inject.js so the read/write are deterministic,
// and vary `targetPurpose` to switch between the two repo kinds.

// ── Supabase stub ────────────────────────────────────────────────────
vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => Promise.resolve({ data: [], error: null }),
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
// `targetPurpose` is what a test varies: it rides on the descriptor
// findTargetById returns, exactly as the real cache stamps it from the Worker's
// repos route.
let targetPurpose = 'personal';
let readResult = { ok: false, reason: 'No target' };
let writeResult = { ok: true, sha: 'new-sha' };
let readCalls = [];
let writeCalls = [];
let toastCalls = [];

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
    readAssignmentFromWorker: (target) => {
        readCalls.push(target);
        return Promise.resolve(readResult);
    },
    writeAssignmentToWorker: (target, content, sha) => {
        writeCalls.push({ target, content, sha });
        return Promise.resolve(writeResult);
    },
    makeInjectButton: () => document.createElement('button'),
    refreshInjectButton: () => {},
    findTargetById: () => ({
        repo: 'owner/repo', file_path: 'TODO.md', purpose: targetPurpose,
    }),
    showInjectToast: (msg, kind) => { toastCalls.push({ msg, kind }); },
    isInjectConfigured: () => true,
    chatWithWorker: () => Promise.resolve({ ok: true, reply: '' }),
    revertEntry: () => Promise.resolve({ ok: true }),
}));

import { listLogic } from '../src/listLogic.js';
// Importing agentView runs its module-level configureAssignmentCoverage, which
// binds getSelectedProjectName / resolveReadTarget for the shared module — the
// card's tap-to-edit path needs both.
import '../src/agentView.js';
import {
    refreshAssignment,
    resetAssignmentCache,
    getAssignmentState,
    buildAssignmentCard,
    buildCoveragePane,
} from '../src/assignmentCoverage.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) { for (let i = 0; i < n; i++) await tick(); }

// A brief with real prose. No `## Requirements` section anywhere — judging it
// against one is exactly what would misclassify an ordinary brief as unfilled.
const BRIEF_FILLED =
    '# Project brief\n\n' +
    'A pomodoro companion for studying.\n\n' +
    '## Goals\n' +
    'Track sessions and show a streak.\n';
// The seeded stub: a heading plus HTML-comment hints and nothing else.
const BRIEF_UNFILLED =
    '# Project brief\n\n' +
    '<!-- What are you building? -->\n' +
    '<!-- Who is it for? -->\n';
// A brief whose headings happen to read like rubric rows. Aspect IDs must NOT be
// invented from these — a fraction over a made-up denominator is worse than none.
const BRIEF_WITH_ASPECT_LOOKING_TEXT =
    '# Project brief\n\n' +
    'Ship the A1 milestone first, then B2.\n\n' +
    '## Rubric\n' +
    '**A1 — Competent:** works\n';

const ASSIGNMENT_FILLED =
    '## Requirements\n' +
    '**A1** — Menu-driven interface\n\n' +
    '## Rubric\n' +
    '**A1 — Competent:** works\n';

let projCounter = 0;
function routedProject() {
    const name = 'Brief-' + (projCounter++);
    listLogic.addProject(name);
    listLogic.setProjectTargetId(name, 'target-1');
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>' +
        '<div id="agentView"></div>';
    return name;
}

// Resolve the coverage cache for a routed project against the given document
// content, using the same target descriptor the app would resolve.
async function readWith(content) {
    const name = routedProject();
    readResult = content === null
        ? { ok: false, reason: 'Not found' }
        : { ok: true, content: content, sha: 'sha-1' };
    refreshAssignment(
        { repo: 'owner/repo', file_path: 'TODO.md', purpose: targetPurpose },
        name,
    );
    await flush();
    return name;
}

beforeEach(() => {
    listLogic._reset();
    resetAssignmentCache();
    targetPurpose = 'personal';
    readResult = { ok: false, reason: 'No target' };
    writeResult = { ok: true, sha: 'new-sha' };
    readCalls = [];
    writeCalls = [];
    toastCalls = [];
    document.body.innerHTML = '';
});

afterEach(() => {
    const b = document.getElementById('assignmentEditorModalBackdrop');
    if (b && b.parentNode) b.parentNode.removeChild(b);
});

describe('personal repo — project.md classification', () => {
    it('classifies a brief with prose as filled despite having no ## Requirements', async () => {
        await readWith(BRIEF_FILLED);
        expect(getAssignmentState()).toBe('filled');
    });

    it('classifies the seeded heading-plus-comment-hints stub as unfilled', async () => {
        await readWith(BRIEF_UNFILLED);
        expect(getAssignmentState()).toBe('unfilled');
    });

    it('classifies a missing file as absent', async () => {
        await readWith(null);
        expect(getAssignmentState()).toBe('absent');
        expect(buildAssignmentCard()).toBeNull();
    });

    it('takes the title from the first non-comment, non-heading line', async () => {
        await readWith(BRIEF_FILLED);
        const card = buildAssignmentCard();
        expect(card.querySelector('.agentAssignmentTitle').textContent)
            .toBe('A pomodoro companion for studying.');
    });

    // The same content on an assignment repo is still judged against
    // `## Requirements`, so the two kinds genuinely classify differently.
    it('still requires ## Requirements on an assignment repo', async () => {
        targetPurpose = 'assignment';
        await readWith(BRIEF_FILLED);
        expect(getAssignmentState()).toBe('unfilled');
    });

    it('treats an unrecognized purpose as personal', async () => {
        targetPurpose = 'coursework';
        await readWith(BRIEF_FILLED);
        expect(getAssignmentState()).toBe('filled');
    });
});

describe('personal repo — no aspects, no coverage fraction', () => {
    it('reports no aspects even when the brief mentions rubric-shaped IDs', async () => {
        await readWith(BRIEF_WITH_ASPECT_LOOKING_TEXT);
        const pane = buildCoveragePane();
        expect(pane.querySelector('.agentCoverage')).toBeNull();
        expect(pane.querySelector('.claudeCoverageCounts')).toBeNull();
        expect(pane.querySelector('.claudeCoverageMeta').textContent)
            .toMatch(/^\d+ words · \d+ sections$/);
    });

    it('renders no coverage bar on the board card either', async () => {
        await readWith(BRIEF_WITH_ASPECT_LOOKING_TEXT);
        const card = buildAssignmentCard();
        expect(card.querySelector('.agentCoverage')).toBeNull();
        expect(card.querySelector('.agentAssignmentMeta').textContent)
            .toMatch(/sections$/);
    });

    // The assignment path must be untouched: a rubric-backed assignment.md still
    // tallies its aspects.
    it('still tallies aspects on an assignment repo', async () => {
        targetPurpose = 'assignment';
        await readWith(ASSIGNMENT_FILLED);
        expect(buildCoveragePane().querySelector('.agentCoverage')).not.toBeNull();
    });
});

describe('personal repo — copy says "brief"', () => {
    it('labels the board card BRIEF', async () => {
        await readWith(BRIEF_FILLED);
        const card = buildAssignmentCard();
        expect(card.querySelector('.agentAssignmentEyebrow').textContent).toBe('BRIEF');
        expect(card.getAttribute('aria-label')).toBe('Edit brief context');
    });

    it('invites a brief rather than an assignment when unfilled', async () => {
        await readWith(BRIEF_UNFILLED);
        expect(buildAssignmentCard().querySelector('.agentAssignmentTitle').textContent)
            .toBe('No spec — add brief context');
        const pane = buildCoveragePane();
        expect(pane.querySelector('.claudeCoverageTitle').textContent)
            .toBe('No project brief yet');
        expect(pane.querySelector('.claudeCoveragePrompt').textContent)
            .toMatch(/brief/);
    });

    it('names project.md on the pane edit action', async () => {
        await readWith(BRIEF_FILLED);
        expect(buildCoveragePane().querySelector('.claudeCoverageEdit')
            .getAttribute('aria-label')).toBe('Edit project.md');
    });

    it('leaves the assignment repo copy unchanged', async () => {
        targetPurpose = 'assignment';
        await readWith(ASSIGNMENT_FILLED);
        expect(buildAssignmentCard().querySelector('.agentAssignmentEyebrow').textContent)
            .toBe('ASSIGNMENT');
        expect(buildCoveragePane().querySelector('.claudeCoverageEdit')
            .getAttribute('aria-label')).toBe('Edit assignment.md');
    });
});

describe('personal repo — the editor', () => {
    async function openEditorFromCard(content) {
        await readWith(content);
        const card = buildAssignmentCard();
        document.body.appendChild(card);
        card.click();
        await flush();
    }

    it('opens the editor worded for a brief', async () => {
        await openEditorFromCard(BRIEF_FILLED);
        expect(document.getElementById('assignmentEditorModalEyebrow').textContent)
            .toBe('BRIEF');
        expect(document.getElementById('assignmentEditorModalTextarea')
            .getAttribute('aria-label')).toBe('Brief text');
        expect(document.getElementById('assignmentEditorModalClose')
            .getAttribute('aria-label')).toBe('Close brief editor');
    });

    it('names project.md in the conflict message', async () => {
        await openEditorFromCard(BRIEF_FILLED);
        writeResult = { ok: false, conflict: true, reason: 'Conflict' };
        document.getElementById('assignmentEditorModalSave').click();
        await flush();
        expect(document.getElementById('assignmentEditorModalStatus').textContent)
            .toMatch(/^project\.md changed since you opened it/);
    });

    it('names project.md when the read fails', async () => {
        await readWith(BRIEF_FILLED);
        const card = buildAssignmentCard();
        document.body.appendChild(card);
        readResult = { ok: false, reason: 'Not found' };
        card.click();
        await flush();
        expect(toastCalls.pop().msg).toBe('Could not load project.md: Not found');
    });

    it('names assignment.md on an assignment repo', async () => {
        targetPurpose = 'assignment';
        await openEditorFromCard(ASSIGNMENT_FILLED);
        expect(document.getElementById('assignmentEditorModalEyebrow').textContent)
            .toBe('ASSIGNMENT');
        writeResult = { ok: false, conflict: true, reason: 'Conflict' };
        document.getElementById('assignmentEditorModalSave').click();
        await flush();
        expect(document.getElementById('assignmentEditorModalStatus').textContent)
            .toMatch(/^assignment\.md changed since you opened it/);
    });

    it('reclassifies from the saved text without a second read', async () => {
        await openEditorFromCard(BRIEF_UNFILLED);
        const before = readCalls.length;
        document.getElementById('assignmentEditorModalTextarea').value =
            '# Project brief\n\nA habit tracker for weeknights.\n';
        document.getElementById('assignmentEditorModalSave').click();
        await flush();
        expect(readCalls.length).toBe(before);
        expect(getAssignmentState()).toBe('filled');
        expect(buildAssignmentCard().querySelector('.agentAssignmentEyebrow').textContent)
            .toBe('BRIEF');
    });
});
