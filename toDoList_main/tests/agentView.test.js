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

    it('renders the pending question and an inert (disabled) answer affordance for needs_words', async () => {
        queueRows = [{ id: '1', state: 'needs_words', title: 'Add a toggle', question: 'Which label?' }];
        await loadBoard();

        expect(document.querySelector('.agentQuestion').textContent).toBe('Which label?');
        const input = document.querySelector('.agentAnswerInput');
        expect(input).toBeTruthy();
        expect(input.disabled).toBe(true);
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
