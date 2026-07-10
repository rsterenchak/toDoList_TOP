import { vi } from 'vitest';

// The AGENT view's bucket headers carry a fold/open caret that collapses the
// bucket's card list. Collapsed state is persisted per bucket key in
// localStorage under `todoapp_agentBucketCollapsed`; every bucket defaults open
// except Shipped, which defaults collapsed on first load. These tests drive
// renderAgentView with a controllable fake Supabase client (mirroring
// agentView.test.js) so no network is touched.

let queueRows = [];
let queueError = null;

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => Promise.resolve({ data: queueRows, error: queueError }),
            }),
            insert: (row) => Promise.resolve({ data: [row], error: null }),
            update: (patch) => ({ eq: () => Promise.resolve({ data: [patch], error: null }) }),
        }),
        channel: () => ({
            on() { return this; },
            subscribe() { return this; },
        }),
        removeChannel: () => {},
    },
}));

vi.mock('../src/claudeSheet.js', () => ({
    openChatWithSeed: () => {},
}));

import { listLogic } from '../src/listLogic.js';
import {
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

async function loadBoard() {
    subscribeAgentView();
    await flush();
}

// The four seed rows put one row in each bucket so every bucket renders.
function seedAllBuckets() {
    queueRows = [
        { id: '1', state: 'needs_words', title: 'Add a toggle', question: 'Which label?' },
        { id: '2', state: 'failed', title: 'Fix drag', failure_reason: 'Tests failed on CI' },
        { id: '3', state: 'running', title: 'Build the thing' },
        { id: '4', state: 'shipped', title: 'Shipped feature', pr_number: 42 },
    ];
}

function bucketByKey(key) {
    return document.querySelector('.agentBucket--' + key);
}

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    queueError = null;
    localStorage.clear();
    document.body.innerHTML = '';
});

afterEach(() => {
    unsubscribeAgentView();
    localStorage.clear();
});

describe('AGENT view — bucket fold/open caret', () => {
    beforeEach(() => {
        listLogic.addProject('Folders');
        mountDom('Folders');
    });

    it('renders a keyboard-accessible caret before the label on every bucket header', async () => {
        seedAllBuckets();
        await loadBoard();

        const headers = [...document.querySelectorAll('.agentBucketHeader')];
        expect(headers.length).toBe(4);
        headers.forEach((header) => {
            const caret = header.querySelector('.agentBucketCaret');
            expect(caret).toBeTruthy();
            // The caret is the first child of the header (before the label).
            expect(header.firstElementChild).toBe(caret);
            expect(caret.getAttribute('role')).toBe('button');
            expect(caret.getAttribute('tabindex')).toBe('0');
            expect(caret.getAttribute('aria-label')).toMatch(/(expand|collapse)/i);
        });
    });

    it('defaults Shipped collapsed and the other buckets open on first load', async () => {
        seedAllBuckets();
        await loadBoard();

        expect(bucketByKey('shipped').classList.contains('collapsed')).toBe(true);
        expect(bucketByKey('needs-you').classList.contains('collapsed')).toBe(false);
        expect(bucketByKey('stuck').classList.contains('collapsed')).toBe(false);
        expect(bucketByKey('in-progress').classList.contains('collapsed')).toBe(false);
        // The Shipped caret's aria-label reflects that it can be expanded.
        const shippedCaret = bucketByKey('shipped').querySelector('.agentBucketCaret');
        expect(shippedCaret.getAttribute('aria-label')).toMatch(/expand/i);
        expect(shippedCaret.getAttribute('aria-expanded')).toBe('false');
    });

    it('toggles the collapsed class and persists the state when the header is clicked', async () => {
        seedAllBuckets();
        await loadBoard();

        const stuck = bucketByKey('stuck');
        expect(stuck.classList.contains('collapsed')).toBe(false);
        stuck.querySelector('.agentBucketHeader').click();
        expect(stuck.classList.contains('collapsed')).toBe(true);

        const persisted = JSON.parse(localStorage.getItem('todoapp_agentBucketCollapsed'));
        expect(persisted.stuck).toBe(true);

        // Clicking again opens it and updates the store.
        stuck.querySelector('.agentBucketHeader').click();
        expect(stuck.classList.contains('collapsed')).toBe(false);
        expect(JSON.parse(localStorage.getItem('todoapp_agentBucketCollapsed')).stuck).toBe(false);
    });

    it('toggles on Enter and Space keydown against the caret', async () => {
        seedAllBuckets();
        await loadBoard();

        const inProgress = bucketByKey('in-progress');
        const caret = inProgress.querySelector('.agentBucketCaret');

        caret.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(inProgress.classList.contains('collapsed')).toBe(true);

        caret.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        expect(inProgress.classList.contains('collapsed')).toBe(false);
    });

    it('honors a persisted collapsed state across re-renders', async () => {
        // Persist an explicit map: Shipped open, Needs-you collapsed — the
        // opposite of the first-load defaults, so we know the store won it.
        localStorage.setItem(
            'todoapp_agentBucketCollapsed',
            JSON.stringify({ shipped: false, 'needs-you': true }),
        );
        seedAllBuckets();
        await loadBoard();

        expect(bucketByKey('shipped').classList.contains('collapsed')).toBe(false);
        expect(bucketByKey('needs-you').classList.contains('collapsed')).toBe(true);
    });

    it('renders a caret on the Not-assigned bucket too', async () => {
        listLogic.addToDo('Folders', 'Loose task');
        queueRows = [];
        await loadBoard();

        const notAssigned = bucketByKey('not-assigned');
        expect(notAssigned).toBeTruthy();
        const caret = notAssigned.querySelector('.agentBucketCaret');
        expect(caret).toBeTruthy();
        expect(caret.getAttribute('role')).toBe('button');
    });
});
