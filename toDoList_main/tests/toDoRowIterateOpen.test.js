import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The ACCEPT-face "Iterate" control opens the Claude chat in iterate mode seeded
// from the task's shipped entry, scoped to that task's repo. Two layers are
// exercised here: (1) the button itself, mounted by buildReviewActions and
// invoking the registered iterate handler with (entryId, repo) — the desktop
// pane fires it directly, the mobile modal defers it behind an onIterate hook;
// and (2) claudeSheet.openIterateForEntry, the registered opener, which frames
// the workspace on the entry's repo BEFORE firing the seed turn so the
// per-workspace iterate id can never attach to the wrong thread.

// claudeSheet → inject → supabaseClient (and toDoRow → agentQueueStore →
// supabaseClient). Stub the shared client so importing/mounting never reaches the
// network. `supaState.injectTargets` seeds the inject_targets rows the chat
// workspace list projects, so a multi-repo menu can be driven for the swap test.
const { supaState } = vi.hoisted(() => ({ supaState: { injectTargets: [] } }));

vi.mock('../src/supabaseClient.js', () => {
    function makeQuery(table) {
        const q = {
            select: function() { return q; },
            order: function() {
                if (table === 'inject_targets') {
                    return Promise.resolve({ data: supaState.injectTargets.slice(), error: null });
                }
                return Promise.resolve({ data: [], error: null });
            },
            insert: function() { return Promise.resolve({ data: null, error: null }); },
            update: function() { return q; },
            delete: function() { return q; },
            eq: function() { return Promise.resolve({ data: null, error: null }); },
        };
        return q;
    }
    return {
        supabase: {
            auth: {
                getSession: function() { return Promise.resolve({ data: { session: null }, error: null }); },
                onAuthStateChange: function() { return { data: { subscription: { unsubscribe: function() {} } } }; },
                signInWithOtp: function() { return Promise.resolve({ data: null, error: { message: 'x' } }); },
                signOut: function() { return Promise.resolve({ error: null }); },
            },
            from: function(table) { return makeQuery(table); },
            channel: function() { return { on: function() { return this; }, subscribe: function() { return this; }, unsubscribe: function() { return this; } }; },
            removeChannel: function() {},
        },
    };
});

import {
    buildReviewActions,
    setIterateTaskHandler,
    invokeIterateTask,
} from '../src/toDoRow.js';
import {
    mountClaudeSheet,
    openIterateForEntry,
    getActiveChatRepo,
} from '../src/claudeSheet.js';
import { initInjectConfig } from '../src/inject.js';

const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
const OTHER_REPO = 'rsterenchak/matchingGame-test';

function setInjectTargets(repos) {
    supaState.injectTargets = repos.map(function(repo, i) {
        return { id: 'tgt-' + i, nickname: repo, repo: repo, file_path: 'TODO.md' };
    });
}

function makeItem(overrides) {
    return Object.assign({
        id: 't1',
        tit: 'Add a widget',
        entryId: 'entry-uuid-1',
        desc: '- [ ] **[MEDIUM]** Add a widget\n  - Type: feature\n  <!-- id: entry-uuid-1 -->',
    }, overrides || {});
}

describe('ACCEPT-face Iterate control — button + handler bridge', () => {
    afterEach(() => {
        setIterateTaskHandler(null);
    });

    it('mounts a ghost Iterate button on the desktop pane host', () => {
        const actions = buildReviewActions(makeItem(), 'Proj');
        const btn = actions.querySelector('.descReviewBtn--iterate');
        expect(btn).not.toBeNull();
        expect(btn.textContent).toMatch(/iterate/i);
    });

    it('mounts the Iterate button on the mobile modal host too (onIterate supplied)', () => {
        const actions = buildReviewActions(makeItem(), 'Proj', { onIterate: function() {} });
        const btn = actions.querySelector('.descReviewBtn--iterate');
        expect(btn).not.toBeNull();
    });

    it('desktop click invokes the registered iterate handler with the entry id and repo', () => {
        const seen = [];
        setIterateTaskHandler(function(entryId, repo) { seen.push([entryId, repo]); });
        const actions = buildReviewActions(makeItem(), 'Proj');
        actions.querySelector('.descReviewBtn--iterate').click();
        expect(seen.length).toBe(1);
        expect(seen[0][0]).toBe('entry-uuid-1');
    });

    it('mobile click prefers the onIterate hook and does NOT fire the handler directly', () => {
        const handlerCalls = [];
        const hookCalls = [];
        setIterateTaskHandler(function(entryId) { handlerCalls.push(entryId); });
        const actions = buildReviewActions(makeItem(), 'Proj', {
            onIterate: function(entryId, repo) { hookCalls.push([entryId, repo]); },
        });
        actions.querySelector('.descReviewBtn--iterate').click();
        expect(hookCalls.length).toBe(1);
        expect(hookCalls[0][0]).toBe('entry-uuid-1');
        expect(handlerCalls.length).toBe(0);
    });

    it('is a no-op when the task carries no entry id (nothing shipped to iterate on)', () => {
        const handlerCalls = [];
        setIterateTaskHandler(function(entryId) { handlerCalls.push(entryId); });
        const actions = buildReviewActions(makeItem({ entryId: '' }), 'Proj');
        actions.querySelector('.descReviewBtn--iterate').click();
        expect(handlerCalls.length).toBe(0);
    });

    it('invokeIterateTask fires the registered opener (the modal-defer seam)', () => {
        const seen = [];
        setIterateTaskHandler(function(entryId, repo) { seen.push([entryId, repo]); });
        invokeIterateTask('entry-uuid-1', OTHER_REPO);
        expect(seen).toEqual([['entry-uuid-1', OTHER_REPO]]);
        // A missing id never fires the opener.
        invokeIterateTask('', OTHER_REPO);
        expect(seen.length).toBe(1);
    });
});

describe('openIterateForEntry — seeds iterate scoped to the entry\'s repo', () => {
    let realFetch;
    let chatBodies;

    function makeFetch() {
        chatBodies = [];
        return vi.fn((url, opts) => {
            const body = JSON.parse(opts.body);
            if (body.chat) chatBodies.push(body);
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'ok' }) });
        });
    }

    const tick = () => new Promise((r) => setTimeout(r, 0));
    async function flush(n = 6) { for (let i = 0; i < n; i++) await tick(); }

    beforeEach(async () => {
        document.body.innerHTML = '';
        document.body.className = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        realFetch = globalThis.fetch;
        globalThis.fetch = makeFetch();
        mountClaudeSheet(document.body);
        // The workspace list is projected from the inject targets asynchronously
        // on mount; let it resolve so OTHER_REPO is an allowed workspace to swap to.
        await flush();
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
    });

    it('switches to the CHAT tab and fires a seed turn carrying the entry id', async () => {
        await openIterateForEntry('e-seed-1', DEFAULT_REPO);
        await flush();
        const sheet = document.getElementById('claudeSheet');
        expect(sheet.getAttribute('data-tab')).toBe('chat');
        expect(chatBodies.length).toBe(1);
        expect(chatBodies[0].entry_id).toBe('e-seed-1');
        expect(chatBodies[0].repo).toBe(DEFAULT_REPO);
    });

    it('frames the workspace on the task\'s repo FIRST when it differs from the active one', async () => {
        expect(getActiveChatRepo()).toBe(DEFAULT_REPO);
        await openIterateForEntry('e-seed-2', OTHER_REPO);
        await flush();
        // The workspace swapped before the seed, so the turn is framed on OTHER_REPO.
        expect(getActiveChatRepo()).toBe(OTHER_REPO);
        expect(chatBodies.length).toBe(1);
        expect(chatBodies[0].entry_id).toBe('e-seed-2');
        expect(chatBodies[0].repo).toBe(OTHER_REPO);
    });

    it('is a no-op with no entry id — no chat turn is fired', async () => {
        await openIterateForEntry('', DEFAULT_REPO);
        await flush();
        expect(chatBodies.length).toBe(0);
    });
});
