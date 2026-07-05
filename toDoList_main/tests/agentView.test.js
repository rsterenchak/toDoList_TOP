import { vi } from 'vitest';

// The AGENT view renders the per-project autonomous-agent work queue. It reads
// the `agent_queue` table (scoped by project_id) via the shared Supabase
// client and groups rows into buckets — Needs you, Stuck, In progress, Shipped
// — omitting empty buckets and showing an empty state otherwise. These tests
// drive renderAgentView with a controllable fake Supabase client so no network
// is touched; the realtime subscribe/unsubscribe pair is exercised only for
// safety (no-throw), since realtime push isn't observable in the stub.

let queueRows = [];
let queueError = null;
// Flag-insert observation: each agent_queue insert pushes its row here, and
// `insertError` lets a test force the insert to fail.
let insertCalls = [];
let insertError = null;
// Answer-update observation: each agent_queue update pushes { patch, id } here,
// and `updateError` lets a test force the update to fail.
let updateCalls = [];
let updateError = null;

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => Promise.resolve({ data: queueRows, error: queueError }),
            }),
            insert: (row) => {
                insertCalls.push(row);
                return Promise.resolve({ data: insertError ? null : [row], error: insertError });
            },
            update: (patch) => ({
                eq: (col, val) => {
                    updateCalls.push({ patch, id: val });
                    return Promise.resolve({ data: updateError ? null : [patch], error: updateError });
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

import { listLogic } from '../src/listLogic.js';
import {
    renderAgentView,
    subscribeAgentView,
    unsubscribeAgentView,
} from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) {
    for (let i = 0; i < n; i++) await tick();
}

function mountDom(projectName) {
    document.body.innerHTML =
        (projectName
            ? '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>'
            : '') +
        '<div id="agentView"></div>';
}

// Refresh the board for the mounted project and wait for the async fetch to
// settle. subscribeAgentView always kicks a project-scoped refresh, so it is a
// reliable way to load rows regardless of module cache state between tests.
async function loadBoard() {
    subscribeAgentView();
    await flush();
}

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    queueError = null;
    insertCalls = [];
    insertError = null;
    updateCalls = [];
    updateError = null;
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribeAgentView();
});

describe('listLogic.getProjectId', () => {
    it('returns a stable id for a known project and null for an unknown one', () => {
        listLogic.addProject('Alpha');
        const id = listLogic.getProjectId('Alpha');
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
        expect(listLogic.getProjectId('Nope')).toBeNull();
    });
});

describe('AGENT view — empty states', () => {
    it('prompts to select a project when none is selected', async () => {
        mountDom(null);
        await loadBoard();
        const empty = document.querySelector('.agentEmptyState');
        expect(empty).toBeTruthy();
        expect(empty.textContent).toMatch(/select a project/i);
    });

    it('shows a no-work empty state when the project has no queued rows', async () => {
        listLogic.addProject('Beta');
        mountDom('Beta');
        queueRows = [];
        await loadBoard();
        const empty = document.querySelector('.agentEmptyState');
        expect(empty).toBeTruthy();
        expect(empty.textContent).toMatch(/no agent work/i);
        expect(document.querySelector('.agentBoard')).toBeFalsy();
    });
});

describe('AGENT view — header', () => {
    beforeEach(() => {
        listLogic.addProject('Delta');
        mountDom('Delta');
    });

    it('renders the Agent identity block instead of the project name and queue chip', async () => {
        queueRows = [];
        await loadBoard();
        const label = document.querySelector('.agentIdentityLabel');
        expect(label).toBeTruthy();
        expect(label.textContent).toBe('Agent');
        // The bolt badge wraps the inline bolt glyph.
        expect(document.querySelector('.agentIdentityBadge .agentGiveBolt')).toBeTruthy();
        // The old project-name heading and "Agent queue" chip are gone.
        expect(document.querySelector('.agentProjectName')).toBeFalsy();
        expect(document.querySelector('.agentViewChip')).toBeFalsy();
        expect(document.body.textContent).not.toContain('Delta');
    });

    it('shows a Working status pill when any row is in an in-flight state', async () => {
        queueRows = [{ id: '1', state: 'running', context: { title: 'Build the thing' } }];
        await loadBoard();
        const pill = document.querySelector('.agentStatusPill');
        expect(pill).toBeTruthy();
        expect(pill.classList.contains('agentStatusPill--working')).toBe(true);
        expect(pill.textContent).toContain('Working');
    });

    it('shows an Idle status pill when no row is in an in-flight state', async () => {
        queueRows = [{ id: '1', state: 'shipped', context: { title: 'Shipped thing' } }];
        await loadBoard();
        const pill = document.querySelector('.agentStatusPill');
        expect(pill.classList.contains('agentStatusPill--idle')).toBe(true);
        expect(pill.textContent).toContain('Idle');
    });

    it('renders the flagged / running / shipped-today counts subline, live from the rows', async () => {
        const todayIso = new Date().toISOString();
        const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        queueRows = [
            { id: '1', state: 'triaging', context: { title: 'A' } },
            { id: '2', state: 'running', context: { title: 'B' } },
            { id: '3', state: 'shipped', context: { title: 'C' }, updated_at: todayIso },
            { id: '4', state: 'shipped', context: { title: 'D' }, updated_at: yesterdayIso },
        ];
        await loadBoard();
        const counts = document.querySelector('.agentCounts');
        expect(counts).toBeTruthy();
        // 4 flagged total, 2 in-flight (triaging + running), 1 shipped today.
        expect(counts.textContent).toBe('4 flagged · 2 running · 1 shipped today');
    });

    it('shows zero-valued count segments even on an empty board', async () => {
        queueRows = [];
        await loadBoard();
        expect(document.querySelector('.agentCounts').textContent).toBe('0 flagged · 0 running · 0 shipped today');
    });

    it('keeps the Run button in the header', async () => {
        queueRows = [];
        await loadBoard();
        expect(document.querySelector('.agentRunBtn')).toBeTruthy();
    });
});

describe('AGENT view — bucket rendering', () => {
    beforeEach(() => {
        listLogic.addProject('Gamma');
        mountDom('Gamma');
    });

    it('groups rows into the Needs you / Stuck / In progress / Shipped buckets, omitting empties', async () => {
        queueRows = [
            { id: '1', state: 'needs_words', title: 'Add a toggle', question: 'Which label?' },
            { id: '2', state: 'failed', title: 'Fix drag', failure_reason: 'Tests failed on CI' },
            { id: '3', state: 'running', title: 'Build the thing' },
            { id: '4', state: 'shipped', title: 'Shipped feature', pr_number: 42 },
        ];
        await loadBoard();

        const labels = [...document.querySelectorAll('.agentBucketLabel')].map((n) => n.textContent);
        expect(labels).toEqual(['Needs you', 'Stuck', 'In progress', 'Shipped']);
        // No triaging/drafted rows, but the "In progress" bucket still shows
        // because of the running row; the buckets with zero rows never appear.
        expect(document.querySelectorAll('.agentBucket').length).toBe(4);
    });

    it('renders the pending question and a live (editable) answer control for needs_words', async () => {
        queueRows = [{ id: '1', state: 'needs_words', title: 'Add a toggle', question: 'Which label?' }];
        await loadBoard();

        expect(document.querySelector('.agentQuestion').textContent).toBe('Which label?');
        const input = document.querySelector('.agentAnswerInput');
        expect(input).toBeTruthy();
        expect(input.disabled).toBe(false);
        // A Send affordance is present alongside the editable textarea.
        expect(document.querySelector('.agentAnswerSend')).toBeTruthy();
    });

    it('surfaces the failure reason for a stuck row', async () => {
        queueRows = [{ id: '2', state: 'failed', title: 'Fix drag', failure_reason: 'Tests failed on CI' }];
        await loadBoard();
        expect(document.querySelector('.agentFailure').textContent).toBe('Tests failed on CI');
    });

    it('labels the state chip per row and renders running work as a thin card', async () => {
        queueRows = [{ id: '3', state: 'running', title: 'Build the thing' }];
        await loadBoard();
        const chip = document.querySelector('.agentChip');
        expect(chip.textContent).toBe('Running');
        expect(document.querySelector('.agentCard--thin')).toBeTruthy();
    });

    it('falls back to "Untitled entry" when a row carries no title or context', async () => {
        queueRows = [{ id: '9', state: 'drafted' }];
        await loadBoard();
        expect(document.querySelector('.agentCardTitle').textContent).toBe('Untitled entry');
    });

    it('reads the card title from context.title without throwing on the object context', async () => {
        // agent_queue rows have no top-level `title` column — the title lives
        // inside the `context` JSONB. Rendering must read context.title and
        // never call a string method on the raw object (which would blank the
        // whole board with a TypeError).
        queueRows = [{ id: '10', state: 'triaging', context: { title: 'Flagged task', description: 'do the thing' } }];
        await loadBoard();
        expect(document.querySelector('.agentCardTitle').textContent).toBe('Flagged task');
        expect(document.querySelector('.agentBoard')).toBeTruthy();
    });

    it('falls back to "Untitled entry" for an object context with no title', async () => {
        queueRows = [{ id: '11', state: 'triaging', context: { description: 'no title here' } }];
        await loadBoard();
        expect(document.querySelector('.agentCardTitle').textContent).toBe('Untitled entry');
    });

    it('degrades to the no-work empty state when the query returns an error', async () => {
        queueRows = [{ id: '1', state: 'shipped', title: 'x' }];
        queueError = { message: 'boom' };
        await loadBoard();
        expect(document.querySelector('.agentEmptyState')).toBeTruthy();
        expect(document.querySelector('.agentBoard')).toBeFalsy();
    });
});

describe('AGENT view — realtime lifecycle', () => {
    it('subscribe and unsubscribe never throw', () => {
        listLogic.addProject('Delta');
        mountDom('Delta');
        expect(() => subscribeAgentView()).not.toThrow();
        expect(() => unsubscribeAgentView()).not.toThrow();
        // Idempotent teardown.
        expect(() => unsubscribeAgentView()).not.toThrow();
    });
});

// Helper: seed a project with named todos and return their ids by title.
function seedTodos(projectName, titles) {
    listLogic.addProject(projectName);
    titles.forEach((t) => listLogic.addToDo(projectName, t));
    const items = listLogic.listItems(projectName) || [];
    const byTitle = {};
    items.forEach((it) => { if (it && it.tit) byTitle[it.tit] = it.id; });
    return byTitle;
}

describe('AGENT view — Not-assigned bucket', () => {
    it('lists the project tasks not present in the queue, below the other buckets', async () => {
        const ids = seedTodos('Epsilon', ['Write docs', 'Fix bug']);
        mountDom('Epsilon');
        // One task is already queued (by todo_id); the other is not.
        queueRows = [{ id: 'q1', state: 'shipped', title: 'Fix bug', todo_id: ids['Fix bug'], pr_number: 7 }];
        await loadBoard();

        const labels = [...document.querySelectorAll('.agentBucketLabel')].map((n) => n.textContent);
        expect(labels).toEqual(['Shipped', 'Not assigned']);
        const cards = [...document.querySelectorAll('.agentCard--unassigned .agentCardTitle')].map((n) => n.textContent);
        expect(cards).toEqual(['Write docs']);
        // Each unqueued card carries a real (enabled) Give-to-agent control.
        const btn = document.querySelector('.agentCard--unassigned .agentGiveButton');
        expect(btn).toBeTruthy();
        expect(btn.disabled).toBe(false);
    });

    it('omits the Not-assigned bucket when every task is already queued', async () => {
        const ids = seedTodos('Zeta', ['Only task']);
        mountDom('Zeta');
        queueRows = [{ id: 'q1', state: 'triaging', title: 'Only task', todo_id: ids['Only task'] }];
        await loadBoard();
        expect(document.querySelector('.agentBucket--not-assigned')).toBeFalsy();
    });

    it('excludes completed tasks from the Not-assigned bucket', async () => {
        const ids = seedTodos('EtaDone', ['Open task', 'Done task']);
        mountDom('EtaDone');
        const items = listLogic.listItems('EtaDone') || [];
        const doneItem = items.find((it) => it.id === ids['Done task']);
        listLogic.setToDoCompleted('EtaDone', doneItem, true);
        queueRows = [];
        await loadBoard();

        const cards = [...document.querySelectorAll('.agentCard--unassigned .agentCardTitle')].map((n) => n.textContent);
        expect(cards).toEqual(['Open task']);
    });

    it('renders the Not-assigned bucket even when the queue is empty', async () => {
        seedTodos('Eta', ['Lonely task']);
        mountDom('Eta');
        queueRows = [];
        await loadBoard();
        expect(document.querySelector('.agentBucket--not-assigned')).toBeTruthy();
        // Not the no-work empty state, because there is an unqueued task.
        expect(document.querySelector('.agentEmptyState')).toBeFalsy();
    });
});

describe('AGENT view — Give to agent action', () => {
    it('inserts a triaging agent_queue row denormalising the task context on tap', async () => {
        const ids = seedTodos('Theta', ['Ship it']);
        mountDom('Theta');
        queueRows = [];
        await loadBoard();

        const btn = document.querySelector('.agentCard--unassigned .agentGiveButton');
        btn.click();
        await flush();

        expect(insertCalls.length).toBe(1);
        const row = insertCalls[0];
        expect(row.todo_id).toBe(ids['Ship it']);
        expect(row.state).toBe('triaging');
        expect(row.auto).toBe(true);
        expect(row.project_id).toBe(listLogic.getProjectId('Theta'));
        expect(row.context.title).toBe('Ship it');
    });

    it('re-enables the button and surfaces a non-blocking error when the insert fails', async () => {
        seedTodos('Iota', ['Risky task']);
        mountDom('Iota');
        queueRows = [];
        await loadBoard();

        insertError = { message: 'insert boom' };
        const btn = document.querySelector('.agentCard--unassigned .agentGiveButton');
        btn.click();
        await flush();

        expect(btn.disabled).toBe(false);
        const err = document.querySelector('.agentGiveError');
        expect(err).toBeTruthy();
        expect(err.hidden).toBe(false);
        expect(err.textContent).toMatch(/boom/);
    });
});

describe('listLogic.flagTaskForAgent', () => {
    it('returns { ok: true } and writes a well-formed row for a known task', async () => {
        const ids = seedTodos('Kappa', ['A task']);
        const res = await listLogic.flagTaskForAgent(ids['A task']);
        expect(res.ok).toBe(true);
        expect(insertCalls.length).toBe(1);
        expect(insertCalls[0].context.description).toBe(null);
    });

    it('returns an error result for an unknown task id and writes nothing', async () => {
        listLogic.addProject('Lambda');
        const res = await listLogic.flagTaskForAgent('no-such-id');
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/not found/i);
        expect(insertCalls.length).toBe(0);
    });
});

describe('AGENT view — needs_words answer action', () => {
    it('appends the answer to the thread and re-queues the row (state -> triaging) on Send', async () => {
        listLogic.addProject('Mu');
        mountDom('Mu');
        queueRows = [{
            id: 'nw1',
            state: 'needs_words',
            context: { title: 'Add a toggle' },
            question: 'Which label?',
            thread: [{ role: 'assistant', text: 'Which label?', ts: '2026-07-05T00:00:00.000Z' }],
        }];
        await loadBoard();

        const input = document.querySelector('.agentAnswerInput');
        input.value = '  Use "Done"  ';
        document.querySelector('.agentAnswerSend').click();
        await flush();

        expect(updateCalls.length).toBe(1);
        const { patch, id } = updateCalls[0];
        expect(id).toBe('nw1');
        expect(patch.state).toBe('triaging');
        // Existing thread preserved, user answer appended (trimmed).
        expect(patch.thread.length).toBe(2);
        expect(patch.thread[0].role).toBe('assistant');
        expect(patch.thread[1]).toMatchObject({ role: 'user', text: 'Use "Done"' });
        expect(typeof patch.thread[1].ts).toBe('string');
    });

    it('submits on Enter without Shift and ignores Shift+Enter (newline)', async () => {
        listLogic.addProject('Nu');
        mountDom('Nu');
        queueRows = [{ id: 'nw2', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];
        await loadBoard();

        const input = document.querySelector('.agentAnswerInput');
        input.value = 'plain answer';
        // Shift+Enter must NOT submit.
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
        await flush();
        expect(updateCalls.length).toBe(0);

        // Enter without Shift submits.
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true }));
        await flush();
        expect(updateCalls.length).toBe(1);
        expect(updateCalls[0].patch.thread[updateCalls[0].patch.thread.length - 1].text).toBe('plain answer');
    });

    it('ignores an empty / whitespace-only submission (no write)', async () => {
        listLogic.addProject('Xi');
        mountDom('Xi');
        queueRows = [{ id: 'nw3', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];
        await loadBoard();

        const input = document.querySelector('.agentAnswerInput');
        input.value = '   ';
        document.querySelector('.agentAnswerSend').click();
        await flush();
        expect(updateCalls.length).toBe(0);
    });

    it('re-enables the controls and surfaces a non-blocking error when the update fails', async () => {
        listLogic.addProject('Omicron');
        mountDom('Omicron');
        queueRows = [{ id: 'nw4', state: 'needs_words', context: { title: 'X' }, question: 'Q?' }];
        await loadBoard();

        updateError = { message: 'update boom' };
        const input = document.querySelector('.agentAnswerInput');
        const send = document.querySelector('.agentAnswerSend');
        input.value = 'my answer';
        send.click();
        await flush();

        expect(send.disabled).toBe(false);
        expect(input.disabled).toBe(false);
        const err = document.querySelector('.agentAnswerError');
        expect(err).toBeTruthy();
        expect(err.hidden).toBe(false);
        expect(err.textContent).toMatch(/boom/);
    });
});

describe('listLogic.answerAgentTask', () => {
    it('appends a user message to the thread and writes state triaging for a valid answer', async () => {
        const res = await listLogic.answerAgentTask('row-1', '  hi there  ', [
            { role: 'assistant', text: 'q', ts: '2026-07-05T00:00:00.000Z' },
        ]);
        expect(res.ok).toBe(true);
        expect(updateCalls.length).toBe(1);
        expect(updateCalls[0].id).toBe('row-1');
        expect(updateCalls[0].patch.state).toBe('triaging');
        expect(updateCalls[0].patch.thread.length).toBe(2);
        expect(updateCalls[0].patch.thread[1]).toMatchObject({ role: 'user', text: 'hi there' });
    });

    it('treats a missing/empty thread as an empty list and still appends one message', async () => {
        const res = await listLogic.answerAgentTask('row-2', 'first reply');
        expect(res.ok).toBe(true);
        expect(updateCalls[0].patch.thread.length).toBe(1);
        expect(updateCalls[0].patch.thread[0].text).toBe('first reply');
    });

    it('rejects a whitespace-only answer and writes nothing', async () => {
        const res = await listLogic.answerAgentTask('row-3', '   ');
        expect(res.ok).toBe(false);
        expect(updateCalls.length).toBe(0);
    });

    it('rejects a missing row id and writes nothing', async () => {
        const res = await listLogic.answerAgentTask('', 'answer');
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/row id/i);
        expect(updateCalls.length).toBe(0);
    });

    it('returns an error result when the update fails', async () => {
        updateError = { message: 'nope' };
        const res = await listLogic.answerAgentTask('row-4', 'answer');
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/nope/);
    });
});

describe('AGENT view — needs_mockup launcher', () => {
    let clipboardText;
    let openArgs;
    let priorClipboard;
    let priorOpen;

    beforeEach(() => {
        clipboardText = null;
        openArgs = null;
        priorClipboard = navigator.clipboard;
        priorOpen = window.open;
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: (t) => { clipboardText = t; return Promise.resolve(); } },
        });
        window.open = (url, target) => { openArgs = { url, target }; return null; };
        listLogic.addProject('Mocky');
        mountDom('Mocky');
    });

    afterEach(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: priorClipboard });
        window.open = priorOpen;
    });

    it('renders the launcher controls without a standalone context bundle, prompt hidden until opened', async () => {
        queueRows = [{
            id: 'nm1',
            state: 'needs_mockup',
            context: { title: 'Restyle the chip', region: 'Agent header', change: 'Move the Run button left' },
        }];
        await loadBoard();

        // The always-visible Region/Tokens/Change bundle is gone — that content
        // lives inside the prompt now.
        expect(document.querySelector('.agentMockupBundle')).toBeFalsy();

        const openBtn = document.querySelector('.agentMockupOpen');
        expect(openBtn).toBeTruthy();
        expect(openBtn.getAttribute('aria-expanded')).toBe('false');
        // The prompt block is present but hidden until Open mockup is tapped.
        const promptWrap = document.querySelector('.agentMockupPrompt');
        expect(promptWrap).toBeTruthy();
        expect(promptWrap.hidden).toBe(true);

        expect(document.querySelector('.agentMockupPaste')).toBeTruthy();
        expect(document.querySelector('.agentMockupSave')).toBeTruthy();
        // The needs_mockup card lives in the Needs you bucket.
        expect(document.querySelector('.agentBucket--needs-you')).toBeTruthy();
    });

    it('Open mockup toggles the prompt block, showing the full task + bundle prompt', async () => {
        queueRows = [{
            id: 'nm3',
            state: 'needs_mockup',
            context: { title: 'Restyle the chip', description: 'Make it purple', region: 'Header', tokens: 'accent', change: 'recolor' },
        }];
        await loadBoard();

        const openBtn = document.querySelector('.agentMockupOpen');
        const promptWrap = document.querySelector('.agentMockupPrompt');
        openBtn.click();
        await flush();

        // The block is now visible and shows the exact prompt to paste.
        expect(promptWrap.hidden).toBe(false);
        expect(openBtn.getAttribute('aria-expanded')).toBe('true');
        const promptText = document.querySelector('.agentMockupPromptBlock').textContent;
        expect(promptText).toContain('Task: Restyle the chip');
        expect(promptText).toContain('Make it purple');
        expect(promptText).toContain('- Region: Header');
        expect(promptText).toContain('- Tokens: accent');
        expect(promptText).toContain('- Change: recolor');
        expect(promptText).toContain('toDoList_main/src/');
        expect(promptText).toContain('no id marker');
        // Opening does not touch the clipboard or open a tab on its own.
        expect(clipboardText).toBeNull();
        expect(openArgs).toBeNull();

        // Toggling again hides it.
        openBtn.click();
        await flush();
        expect(promptWrap.hidden).toBe(true);
        expect(openBtn.getAttribute('aria-expanded')).toBe('false');
    });

    it('Copy writes the prompt to the clipboard and keeps the block visible', async () => {
        queueRows = [{
            id: 'nm3b',
            state: 'needs_mockup',
            context: { title: 'Restyle the chip', region: 'Header' },
        }];
        await loadBoard();

        document.querySelector('.agentMockupOpen').click();
        await flush();
        document.querySelector('.agentMockupCopy').click();
        await flush();

        expect(clipboardText).toBeTruthy();
        expect(clipboardText).toContain('Task: Restyle the chip');
        expect(clipboardText).toContain('- Region: Header');
        // Copy neither opens a tab nor collapses the prompt block.
        expect(openArgs).toBeNull();
        expect(document.querySelector('.agentMockupPrompt').hidden).toBe(false);
    });

    it('Open Claude Design opens claude.ai in a new tab without touching the clipboard', async () => {
        queueRows = [{ id: 'nm3c', state: 'needs_mockup', context: { title: 'T' } }];
        await loadBoard();

        document.querySelector('.agentMockupOpen').click();
        await flush();
        document.querySelector('.agentMockupDesignLink').click();
        await flush();

        expect(openArgs).toEqual({ url: 'https://claude.ai/new', target: '_blank' });
        expect(clipboardText).toBeNull();
    });

    it('omits an empty Context line but keeps the ones present in the copied prompt', async () => {
        queueRows = [{
            id: 'nm4',
            state: 'needs_mockup',
            context: { title: 'T', region: 'Sidebar' },
        }];
        await loadBoard();

        document.querySelector('.agentMockupOpen').click();
        await flush();
        document.querySelector('.agentMockupCopy').click();
        await flush();

        expect(clipboardText).toContain('- Region: Sidebar');
        expect(clipboardText).not.toContain('- Tokens:');
        expect(clipboardText).not.toContain('- Change:');
    });

    it('Save draft writes the pasted entry to draft and flips the row to drafted', async () => {
        queueRows = [{ id: 'nm5', state: 'needs_mockup', context: { title: 'T' } }];
        await loadBoard();

        const input = document.querySelector('.agentMockupPaste');
        input.value = '  - [ ] **[HIGH]** Do the thing  ';
        document.querySelector('.agentMockupSave').click();
        await flush();

        expect(updateCalls.length).toBe(1);
        expect(updateCalls[0].id).toBe('nm5');
        expect(updateCalls[0].patch.state).toBe('drafted');
        // Trimmed, and the draft key survives the setAgentRunState allow-list.
        expect(updateCalls[0].patch.draft).toBe('- [ ] **[HIGH]** Do the thing');
    });

    it('ignores an empty / whitespace-only paste (no write)', async () => {
        queueRows = [{ id: 'nm6', state: 'needs_mockup', context: { title: 'T' } }];
        await loadBoard();

        document.querySelector('.agentMockupPaste').value = '   ';
        document.querySelector('.agentMockupSave').click();
        await flush();
        expect(updateCalls.length).toBe(0);
    });

    it('re-enables the controls and surfaces an error when the save fails', async () => {
        queueRows = [{ id: 'nm7', state: 'needs_mockup', context: { title: 'T' } }];
        await loadBoard();

        updateError = { message: 'save boom' };
        const input = document.querySelector('.agentMockupPaste');
        const save = document.querySelector('.agentMockupSave');
        input.value = '- [ ] entry';
        save.click();
        await flush();

        expect(save.disabled).toBe(false);
        expect(input.disabled).toBe(false);
        const err = document.querySelector('.agentMockupError');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toMatch(/boom/);
    });
});
