import { vi } from 'vitest';

// The coverage detail modal's rubric-section grouping. The flat "Rubric aspects"
// group is replaced by one group per rubric section letter — in the order the
// letters first appear in the rubric file — each headed by the bare letter, a
// "shipped / total" tally and a three-segment mini bar scoped to that section.
// A blocked aspect keeps its live, actionable row pinned in the "Waiting on you"
// group at the top AND renders a dimmed aria-hidden echo in its home section, so
// a section reporting "1 / 3" shows three rows rather than two.
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
    findTargetById: () => ({ repo: 'owner/repo', file_path: 'TODO.md', purpose: 'assignment' }),
    showInjectToast: () => {},
    isInjectConfigured: () => true,
    chatWithWorker: () => Promise.resolve({ ok: true, reply: '' }),
    revertEntry: () => Promise.resolve({ ok: true }),
}));

import { listLogic } from '../src/listLogic.js';
import { groupAspectsBySection } from '../src/assignmentCoverage.js';
import {
    subscribeAgentView,
    unsubscribeAgentView,
} from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) {
    for (let i = 0; i < n; i++) await tick();
}

// A spec whose sections deliberately interleave: the rubric lists B1 before any
// A, so first-appearance order (B, then A) differs from alphabetical order and
// the grouping can't pass by accident. G1 is a Git/process aspect and stays in
// the pinned manual lane rather than joining a section.
const RUBRIC = {
    ok: true,
    content: [
        '# Assignment',
        '',
        '## Requirements',
        '- **B1** — State persists across reload',
        '- **A1** — Menu-driven interface',
        '- **A2** — Task deletion works',
        '- **A3** — Tasks can be edited in place',
        '- **B2** — Input validated on entry',
        '- **G1** — Clean commit history',
        '',
        '## Rubric',
        '- **B1 — Competent:** State survives a full reload.',
        '- **A1 — Competent:** The program presents a menu-driven interface.',
        '- **A2 — Competent:** Tasks can be removed from the list.',
        '- **A3 — Competent:** Tasks can be edited without re-entry.',
        '- **B2 — Competent:** Bad input is rejected with a message.',
        '- **G1 — Competent:** Commit history is clean and well-scoped.',
    ].join('\n'),
};

let projCounter = 0;
function mountRoutedProject() {
    const name = 'Section-' + (projCounter++);
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
    document.querySelector('.agentCoverage').click();
}

// The section group whose head reads `letter`.
function sectionFor(letter) {
    return Array.from(document.querySelectorAll('.coverageDetailGroup--section'))
        .find(function (g) {
            const el = g.querySelector('.coverageSectionLetter');
            return el && el.textContent === letter;
        }) || null;
}

function segCounts(group) {
    return Array.from(group.querySelectorAll('.coverageSectionSeg'))
        .reduce(function (acc, el) {
            const key = Array.from(el.classList)
                .find(function (c) { return c.indexOf('coverageSectionSeg--') === 0; })
                .replace('coverageSectionSeg--', '');
            acc[key] = Number(el.getAttribute('data-count'));
            return acc;
        }, {});
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

describe('Coverage detail modal — rubric section groups', () => {
    it('buckets aspects into one group per section letter, in first-appearance order', async () => {
        mountRoutedProject();
        await loadBoard();
        openDetail();
        await flush();
        const letters = Array.from(document.querySelectorAll('.coverageSectionLetter'))
            .map((el) => el.textContent);
        // Rubric order is B1, A1, A2, A3, B2 — so B heads the list, not A.
        expect(letters).toEqual(['B', 'A']);
        const b = sectionFor('B');
        expect(Array.from(b.querySelectorAll('.coverageDetailId'))
            .map((el) => el.textContent)).toEqual(['B1', 'B2']);
        const a = sectionFor('A');
        expect(Array.from(a.querySelectorAll('.coverageDetailId'))
            .map((el) => el.textContent)).toEqual(['A1', 'A2', 'A3']);
    });

    it('replaces the flat "Rubric aspects" heading with the section heads', async () => {
        mountRoutedProject();
        await loadBoard();
        openDetail();
        await flush();
        const headings = Array.from(document.querySelectorAll('.coverageDetailGroupLabel'))
            .map((el) => el.textContent);
        expect(headings).not.toContain('Rubric aspects');
        // The pinned manual lane keeps its own heading.
        expect(headings).toContain('Manual · Git & process');
    });

    it('leaves Git/process aspects out of the sections, in the manual lane', async () => {
        mountRoutedProject();
        await loadBoard();
        openDetail();
        await flush();
        expect(sectionFor('G')).toBeNull();
        const manual = document.querySelector('.coverageDetailGroup--manual');
        expect(manual.querySelector('.coverageDetailId').textContent).toBe('G1');
    });

    it('tallies each section from its own members, matching its bar segments', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '1', state: 'shipped', aspect: 'B1', context: { title: 'Persist' } },
            { id: '2', state: 'running', aspect: 'B2', context: { title: 'Validate' } },
            { id: '3', state: 'shipped', aspect: 'A1', context: { title: 'Menu' } },
        ];
        await loadBoard();
        openDetail();
        await flush();
        const b = sectionFor('B');
        expect(b.querySelector('.coverageSectionCount').textContent).toBe('1 / 2');
        expect(segCounts(b)).toEqual({ shipped: 1, 'in-flight': 1, outstanding: 0 });
        const a = sectionFor('A');
        expect(a.querySelector('.coverageSectionCount').textContent).toBe('1 / 3');
        expect(segCounts(a)).toEqual({ shipped: 1, 'in-flight': 0, outstanding: 2 });
    });

    it('sizes each bar segment by aspect count via inline flex-grow', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '3', state: 'shipped', aspect: 'A1', context: { title: 'Menu' } },
        ];
        await loadBoard();
        openDetail();
        await flush();
        const grows = Array.from(sectionFor('A').querySelectorAll('.coverageSectionSeg'))
            .map((el) => el.style.flexGrow);
        expect(grows).toEqual(['1', '0', '2']);
    });
});

describe('Coverage detail modal — blocked aspect echoes', () => {
    const blockedQueue = () => ([
        { id: '3', state: 'shipped', aspect: 'A1', context: { title: 'Menu' } },
        {
            id: '9', state: 'needs_words', aspect: 'A2',
            question: 'Which?', context: { title: 'Delete' },
        },
    ]);

    it('keeps the live blocked row pinned at the top and echoes it in its section', async () => {
        mountRoutedProject();
        queueRows = blockedQueue();
        await loadBoard();
        openDetail();
        await flush();
        // Live row: still a disclosure button in the pinned group.
        const pinned = document.querySelector(
            '.coverageDetailGroup--blocked .coverageDetailRow--blocked');
        expect(pinned.tagName).toBe('BUTTON');
        expect(pinned.classList.contains('coverageDetailRow--echo')).toBe(false);
        // Echo: same aspect, in section A, as an inert div.
        const echo = sectionFor('A').querySelector('.coverageDetailRow--echo');
        expect(echo).toBeTruthy();
        expect(echo.tagName).toBe('DIV');
        expect(echo.querySelector('.coverageDetailId').textContent).toBe('A2');
        expect(echo.querySelector('.coverageDetailLabel').textContent)
            .toBe('Task deletion works');
        expect(echo.querySelector('.coverageDetailStatus').textContent)
            .toBe('Waiting on you ↑');
    });

    it('hides the echo from assistive tech and gives it no tick, chevron or lane', async () => {
        mountRoutedProject();
        queueRows = blockedQueue();
        await loadBoard();
        openDetail();
        await flush();
        const echo = sectionFor('A').querySelector('.coverageDetailRow--echo');
        expect(echo.getAttribute('aria-hidden')).toBe('true');
        expect(echo.querySelector('.coverageCommitTick')).toBeNull();
        expect(echo.querySelector('.coverageDetailChevron')).toBeNull();
        expect(echo.classList.contains('coverageDetailRow--expandable')).toBe(false);
        // The one answer lane belongs to the pinned row, not the echo.
        expect(sectionFor('A').querySelector('.coverageAnswerLane')).toBeNull();
        expect(document.querySelectorAll('.coverageAnswerLane').length).toBe(1);
    });

    it('shows as many section rows as the section tally counts', async () => {
        mountRoutedProject();
        queueRows = blockedQueue();
        await loadBoard();
        openDetail();
        await flush();
        const a = sectionFor('A');
        // A1 shipped, A2 blocked (echo), A3 not started → "1 / 3" over three rows.
        expect(a.querySelector('.coverageSectionCount').textContent).toBe('1 / 3');
        expect(a.querySelectorAll('.coverageDetailRow').length).toBe(3);
    });
});

describe('Coverage detail modal — two-line aspect rows', () => {
    it('drops the em-dash separator between the ID and the label', async () => {
        mountRoutedProject();
        await loadBoard();
        openDetail();
        await flush();
        expect(document.querySelector('.coverageDetailSep')).toBeNull();
        const row = sectionFor('A').querySelector('.coverageDetailRow');
        expect(row.textContent).not.toContain('—');
        expect(row.querySelector('.coverageDetailId').textContent).toBe('A1');
        expect(row.querySelector('.coverageDetailLabel').textContent)
            .toBe('Menu-driven interface');
    });

    it('keeps the status word on the row as its own element', async () => {
        mountRoutedProject();
        queueRows = [
            { id: '3', state: 'shipped', aspect: 'A1', context: { title: 'Menu' } },
        ];
        await loadBoard();
        openDetail();
        await flush();
        const shipped = document.querySelector('.coverageDetailRow--shipped');
        expect(shipped.querySelector('.coverageDetailStatus').textContent).toBe('Shipped');
    });
});

// A WGU-shaped rubric: bare-letter aspects (`A`, `E`, `H`, `I`) sit alongside
// lettered-suffix siblings (`B2a`, `B2b`) and an ordinary `F`/`F1` pair. The
// leading-ID parse used to require a digit, so every bare letter vanished and
// `B2a`/`B2b` collapsed into one `B2` — this fixture pins all three shapes.
const MIXED_RUBRIC = {
    ok: true,
    content: [
        '# Assignment',
        '',
        '## Requirements',
        '- **A** — Overall solution summary',
        '- **B2a** — Data written to storage',
        '- **B2b** — Data read back on launch',
        '- **E** — Error handling for bad input',
        '- **F** — Test plan for the feature',
        '- **F1** — Test results recorded',
        '- **H** — Sources cited',
        '- **I** — Professional communication',
        '',
        '## Rubric',
        '- **A — Competent:** The summary describes the whole solution.',
        '- **B2a — Competent:** Data is written to storage.',
        '- **B2b — Competent:** Data is read back on launch.',
        '- **E — Competent:** Bad input is handled without a crash.',
        '- **F — Competent:** A test plan is present.',
        '- **F1 — Competent:** Results are recorded for each test.',
        '- **H — Competent:** Sources are cited correctly.',
        '- **I — Competent:** The submission communicates professionally.',
    ].join('\n'),
};

describe('Coverage detail modal — bare-letter and suffixed aspect IDs', () => {
    it('keeps every ID shape, one row per aspect under its section letter', async () => {
        mountRoutedProject();
        assignmentResult = MIXED_RUBRIC;
        await loadBoard();
        openDetail();
        await flush();
        const letters = Array.from(document.querySelectorAll('.coverageSectionLetter'))
            .map((el) => el.textContent);
        expect(letters).toEqual(['A', 'B', 'E', 'F', 'H', 'I']);
        // Bare letters survive the parse instead of being dropped for want of
        // a digit …
        expect(Array.from(sectionFor('A').querySelectorAll('.coverageDetailId'))
            .map((el) => el.textContent)).toEqual(['A']);
        // … and suffixed siblings stay distinct instead of collapsing to `B2`.
        expect(Array.from(sectionFor('B').querySelectorAll('.coverageDetailId'))
            .map((el) => el.textContent)).toEqual(['B2a', 'B2b']);
        // A bare letter and its numbered sibling share one section.
        expect(Array.from(sectionFor('F').querySelectorAll('.coverageDetailId'))
            .map((el) => el.textContent)).toEqual(['F', 'F1']);
    });

    it('labels bare-letter and suffixed rows from their requirements text', async () => {
        mountRoutedProject();
        assignmentResult = MIXED_RUBRIC;
        await loadBoard();
        openDetail();
        await flush();
        expect(sectionFor('A').querySelector('.coverageDetailLabel').textContent)
            .toBe('Overall solution summary');
        expect(Array.from(sectionFor('B').querySelectorAll('.coverageDetailLabel'))
            .map((el) => el.textContent))
            .toEqual(['Data written to storage', 'Data read back on launch']);
    });

    it('tallies sections that mix the shapes', async () => {
        mountRoutedProject();
        assignmentResult = MIXED_RUBRIC;
        queueRows = [
            { id: '1', state: 'shipped', aspect: 'B2a', context: { title: 'Write' } },
            { id: '2', state: 'shipped', aspect: 'A', context: { title: 'Summary' } },
            { id: '3', state: 'running', aspect: 'F1', context: { title: 'Results' } },
        ];
        await loadBoard();
        openDetail();
        await flush();
        expect(sectionFor('A').querySelector('.coverageSectionCount').textContent)
            .toBe('1 / 1');
        expect(sectionFor('B').querySelector('.coverageSectionCount').textContent)
            .toBe('1 / 2');
        expect(segCounts(sectionFor('F')))
            .toEqual({ shipped: 0, 'in-flight': 1, outstanding: 1 });
    });

    it('expands a blocked bare-letter aspect into its answer lane', async () => {
        mountRoutedProject();
        assignmentResult = MIXED_RUBRIC;
        queueRows = [
            {
                id: '9', state: 'needs_words', aspect: 'E',
                question: 'Which inputs?', context: { title: 'Errors' },
            },
        ];
        await loadBoard();
        openDetail();
        await flush();
        const pinned = document.querySelector(
            '.coverageDetailGroup--blocked .coverageDetailRow--blocked');
        expect(pinned).toBeTruthy();
        expect(pinned.querySelector('.coverageDetailId').textContent).toBe('E');
        pinned.click();
        expect(document.querySelector('.coverageAnswerLane')).toBeTruthy();
        // The echo lands in section E, so the section still shows its one row.
        expect(sectionFor('E').querySelector('.coverageDetailRow--echo')).toBeTruthy();
    });
});

describe('groupAspectsBySection', () => {
    it('groups by ID letter in first-appearance order, preserving item order', () => {
        const out = groupAspectsBySection([
            { id: 'B1' }, { id: 'A1' }, { id: 'A2' }, { id: 'B2' },
        ]);
        expect(out.sections.map((s) => s.letter)).toEqual(['B', 'A']);
        expect(out.sections[0].items.map((i) => i.id)).toEqual(['B1', 'B2']);
        expect(out.sections[1].items.map((i) => i.id)).toEqual(['A1', 'A2']);
        expect(out.other).toEqual([]);
    });

    it('sorts nothing — B10 keeps its rubric position within its section', () => {
        const out = groupAspectsBySection([{ id: 'B10' }, { id: 'B2' }]);
        expect(out.sections[0].items.map((i) => i.id)).toEqual(['B10', 'B2']);
    });

    it('gives bare-letter IDs their own section and keeps suffixed siblings together', () => {
        const out = groupAspectsBySection([
            { id: 'A' }, { id: 'B2a' }, { id: 'B2b' }, { id: 'F' }, { id: 'F1' },
        ]);
        expect(out.sections.map((s) => s.letter)).toEqual(['A', 'B', 'F']);
        expect(out.sections[1].items.map((i) => i.id)).toEqual(['B2a', 'B2b']);
        expect(out.sections[2].items.map((i) => i.id)).toEqual(['F', 'F1']);
        expect(out.other).toEqual([]);
    });

    it('collects IDs with no letter/number split into the trailing group', () => {
        const out = groupAspectsBySection([
            { id: 'A1' }, { id: '???' }, { id: 'B1' }, { id: '' },
        ]);
        expect(out.sections.map((s) => s.letter)).toEqual(['A', 'B']);
        expect(out.other.map((i) => i.id)).toEqual(['???', '']);
    });
});
