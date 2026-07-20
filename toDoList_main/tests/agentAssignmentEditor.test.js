import { vi } from 'vitest';

// The AGENT board's assignment card is a tap-to-edit entry point for the routed
// repo's assignment.md. Tapping it re-reads the file for fresh content + sha and
// opens the assignment editor modal (modals.js showAssignmentEditorModal);
// Save writes the whole file back through the Worker's write branch and, on
// success, closes and repaints the card. These tests drive the real card wiring
// (agentView) against the real modal (modals.js not mocked) with a mocked
// inject.js so the read/write are deterministic.

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
let writeResult = { ok: true, sha: 'new-sha' };
let assignmentCalls = [];
let writeCalls = [];

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'mint-0',
    embedEntryMarker: (t, id) => String(t) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: () => Promise.resolve({ ok: true, id: 'e' }),
    dispatchRun: () => Promise.resolve({ ok: true, runId: 1 }),
    dispatchTriage: () => Promise.resolve({ ok: true }),
    pollRunStatus: () => Promise.resolve({ ok: true, found: false }),
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    fetchActiveRuns: () => Promise.resolve({ ok: true, active: false }),
    readTodoMdFromWorker: () => Promise.resolve({ ok: false, reason: 'No target' }),
    readAssignmentFromWorker: (target) => {
        assignmentCalls.push(target);
        return Promise.resolve(assignmentResult);
    },
    writeAssignmentToWorker: (target, content, sha) => {
        writeCalls.push({ target, content, sha });
        return Promise.resolve(writeResult);
    },
    makeInjectButton: () => document.createElement('button'),
    refreshInjectButton: () => {},
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

const FILLED = '## Requirements\n- Ship the feature.\n';

let projCounter = 0;
function mountRoutedProject() {
    const name = 'AssignEdit-' + (projCounter++);
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
    assignmentResult = { ok: true, content: FILLED, sha: 'sha-1' };
    writeResult = { ok: true, sha: 'new-sha' };
    assignmentCalls = [];
    writeCalls = [];
    document.body.classList.remove('agentUnavailable');
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribeAgentView();
    const b = document.getElementById('assignmentEditorModalBackdrop');
    if (b && b.parentNode) b.parentNode.removeChild(b);
});

describe('AGENT assignment card — tap opens the editor', () => {
    it('re-reads the file and opens the modal preloaded with its content', async () => {
        mountRoutedProject();
        await loadBoard();
        const card = document.querySelector('.agentAssignmentCard');
        expect(card).toBeTruthy();
        // Card carries button semantics for the now-interactive entry point.
        expect(card.getAttribute('role')).toBe('button');
        expect(card.getAttribute('tabindex')).toBe('0');

        const readsBefore = assignmentCalls.length;
        card.click();
        await flush();

        // The click triggers a fresh re-read (not the cached descriptor).
        expect(assignmentCalls.length).toBe(readsBefore + 1);
        const modal = document.getElementById('assignmentEditorModal');
        expect(modal).toBeTruthy();
        const ta = document.getElementById('assignmentEditorModalTextarea');
        expect(ta.value).toBe(FILLED);
    });

    it('does not open the modal when the re-read fails', async () => {
        mountRoutedProject();
        await loadBoard();
        const card = document.querySelector('.agentAssignmentCard');
        // Flip the read to a failure only for the click-time re-read.
        assignmentResult = { ok: false, reason: 'Boom' };
        card.click();
        await flush();
        expect(document.getElementById('assignmentEditorModal')).toBeNull();
    });
});

describe('AGENT assignment editor — Save', () => {
    async function openEditor() {
        mountRoutedProject();
        await loadBoard();
        document.querySelector('.agentAssignmentCard').click();
        await flush();
    }

    it('writes the edited content with the open-time sha, then closes', async () => {
        await openEditor();
        const ta = document.getElementById('assignmentEditorModalTextarea');
        ta.value = '## Requirements\n- Edited.\n';
        document.getElementById('assignmentEditorModalSave').click();
        await flush();

        expect(writeCalls.length).toBe(1);
        expect(writeCalls[0].content).toBe('## Requirements\n- Edited.\n');
        expect(writeCalls[0].sha).toBe('sha-1');
        // Modal is gone after a successful save.
        expect(document.getElementById('assignmentEditorModal')).toBeNull();
    });

    it('keeps the modal open and shows a message on a non-conflict failure', async () => {
        await openEditor();
        writeResult = { ok: false, reason: 'Server error 500' };
        document.getElementById('assignmentEditorModalSave').click();
        await flush();

        expect(document.getElementById('assignmentEditorModal')).toBeTruthy();
        const status = document.getElementById('assignmentEditorModalStatus');
        expect(status.hidden).toBe(false);
        expect(status.textContent).toMatch(/Server error 500/);
        // Save is re-enabled so the user can retry.
        expect(document.getElementById('assignmentEditorModalSave').disabled).toBe(false);
    });

    it('reloads the latest content + sha on a conflict', async () => {
        await openEditor();
        writeResult = { ok: false, conflict: true, reason: '409' };
        // The conflict path re-reads: serve newer content + sha for that read.
        assignmentResult = { ok: true, content: '## Requirements\n- Newer.\n', sha: 'sha-2' };
        document.getElementById('assignmentEditorModalSave').click();
        await flush();

        expect(document.getElementById('assignmentEditorModal')).toBeTruthy();
        const ta = document.getElementById('assignmentEditorModalTextarea');
        expect(ta.value).toBe('## Requirements\n- Newer.\n');
        const status = document.getElementById('assignmentEditorModalStatus');
        expect(status.hidden).toBe(false);

        // A second Save now carries the reloaded sha-2 as the concurrency token.
        writeResult = { ok: true, sha: 'sha-3' };
        document.getElementById('assignmentEditorModalSave').click();
        await flush();
        expect(writeCalls[writeCalls.length - 1].sha).toBe('sha-2');
    });

    it('closes on Escape without writing', async () => {
        await openEditor();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await flush();
        expect(document.getElementById('assignmentEditorModal')).toBeNull();
        expect(writeCalls.length).toBe(0);
    });
});
