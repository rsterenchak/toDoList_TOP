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
