// Cross-device chat history: every chat turn is mirrored into the `chat_turns`
// Supabase table alongside its localStorage copy, and merged back in on hydrate,
// so a conversation started on one device resumes on another.
//
// Two layers are covered here. The listLogic layer owns the four mutations
// (insert / fetch / prune / clear) — all Supabase writes route through it and
// claudeSheet.js never touches the client directly. The claudeSheet layer owns
// the append funnel, the local-first hydrate-and-merge, and the reset paths that
// must clear the remote rows so a wipe can't be resurrected by the next hydrate.
//
// The mock below is a faithful chainable query builder rather than the
// return-a-promise-from-eq stub the older sheet tests use, because these queries
// chain past `.eq()` into `.order().limit()` / `.order().range()` and end in
// `.delete().in()`. It records every insert/delete/limit/range so a test can
// assert the exact query shape, and serves `chat_turns` selects from a fixture
// held oldest-first (the newest-first ordering the queries ask for is applied on
// the way out, so a reversal bug in fetchChatTurns can't hide).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function readSheetSource() {
    return readFileSync(resolve(here, '../src/claudeSheet.js'), 'utf8');
}

// Pull out the body of a top-level function declaration so a per-function
// assertion inspects only that region. Walks braces to find the matching close.
// Mirrors the helper in listLogicSupabase.test.js.
function functionBody(src, name) {
    const declRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const match = declRe.exec(src);
    if (!match) return null;
    const openBrace = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = openBrace; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(openBrace + 1, i);
        }
    }
    return null;
}

const { supa } = vi.hoisted(() => ({
    supa: {
        // chat_turns fixture rows, held OLDEST-FIRST.
        rows: [],
        selectError: null,
        writeError: null,
        inserted: [],
        deletes: [],
        limits: [],
        ranges: [],
        injectTargets: [],
    },
}));

function resetSupa() {
    supa.rows = [];
    supa.selectError = null;
    supa.writeError = null;
    supa.inserted = [];
    supa.deletes = [];
    supa.limits = [];
    supa.ranges = [];
    supa.injectTargets = [];
}

vi.mock('../src/supabaseClient.js', () => {
    function makeQuery(table) {
        const state = { op: 'select', repo: null, ranged: null, limit: null };
        function settle() {
            if (table === 'inject_targets') {
                return { data: supa.injectTargets.slice(), error: null };
            }
            if (table !== 'chat_turns') return { data: [], error: null };
            if (state.op !== 'select') {
                return supa.writeError
                    ? { data: null, error: { message: supa.writeError } }
                    : { data: null, error: null };
            }
            if (supa.selectError) return { data: null, error: { message: supa.selectError } };
            // The queries order newest-first; the fixture is oldest-first.
            const desc = supa.rows
                .filter(r => state.repo === null || r.repo === state.repo)
                .slice()
                .reverse();
            if (state.ranged) return { data: desc.slice(state.ranged[0], state.ranged[1] + 1), error: null };
            if (state.limit !== null) return { data: desc.slice(0, state.limit), error: null };
            return { data: desc, error: null };
        }
        const q = {
            select() { state.op = 'select'; return q; },
            insert(payload) {
                state.op = 'insert';
                if (table === 'chat_turns') supa.inserted.push(payload);
                return q;
            },
            update() { state.op = 'update'; return q; },
            upsert() { state.op = 'upsert'; return q; },
            delete() { state.op = 'delete'; return q; },
            eq(column, value) {
                if (column === 'repo') state.repo = value;
                if (state.op === 'delete' && table === 'chat_turns') {
                    supa.deletes.push({ kind: 'eq', column, value });
                }
                return q;
            },
            in(column, values) {
                if (state.op === 'delete' && table === 'chat_turns') {
                    supa.deletes.push({ kind: 'in', column, values: values.slice() });
                }
                return q;
            },
            order() { return q; },
            limit(n) { state.limit = n; if (table === 'chat_turns') supa.limits.push(n); return q; },
            range(from, to) {
                state.ranged = [from, to];
                if (table === 'chat_turns') supa.ranges.push([from, to]);
                return q;
            },
            then(onFulfilled, onRejected) {
                return Promise.resolve(settle()).then(onFulfilled, onRejected);
            },
        };
        return q;
    }
    return {
        supabase: {
            auth: {
                getSession() { return Promise.resolve({ data: { session: null }, error: null }); },
                onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
                signInWithOtp() { return Promise.resolve({ data: null, error: { message: 'x' } }); },
                signOut() { return Promise.resolve({ error: null }); },
            },
            from(table) { return makeQuery(table); },
            channel() { return { on() { return this; }, subscribe() { return this; }, unsubscribe() { return this; } }; },
            removeChannel() {},
        },
    };
});

const { listLogic } = await import('../src/listLogic.js');
const { mountClaudeSheet, setChatWorkspaceRepo } = await import('../src/claudeSheet.js');
const { initInjectConfig, loadInjectTargets } = await import('../src/inject.js');

const CHAT_KEY = 'todoapp_claudeChat';
const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
const OTHER_REPO = 'rsterenchak/matchingGame-test';

// The sheet's workspace list projects from the inject-targets cache, so a test
// that reframes the chat onto a second repo has to seed both targets first —
// setChatWorkspaceRepo is a deliberate no-op for a repo outside the list.
async function seedBothWorkspaces() {
    supa.injectTargets = [
        { id: 't1', repo: DEFAULT_REPO, file_path: 'TODO.md' },
        { id: 't2', repo: OTHER_REPO, file_path: 'TODO.md' },
    ];
    await loadInjectTargets();
}

function row(id, role, content, createdAt, repo) {
    return {
        id,
        repo: repo || DEFAULT_REPO,
        role,
        content,
        created_at: createdAt,
    };
}


describe('listLogic.insertChatTurn', () => {
    beforeEach(resetSupa);

    it('inserts exactly id/repo/role/content and never an owner id', async () => {
        const result = await listLogic.insertChatTurn({
            id: 'turn-1', repo: DEFAULT_REPO, role: 'user', content: 'hello',
        });
        expect(result).toEqual({ ok: true });
        expect(supa.inserted).toHaveLength(1);
        // The column defaults to auth.uid() server-side, so a client-sent owner id
        // would be both redundant and a schema-cache hazard.
        expect(Object.keys(supa.inserted[0]).sort()).toEqual(['content', 'id', 'repo', 'role']);
        expect(supa.inserted[0]).toEqual({
            id: 'turn-1', repo: DEFAULT_REPO, role: 'user', content: 'hello',
        });
    });

    it('rejects a turn missing its id, repo, or role without writing', async () => {
        expect((await listLogic.insertChatTurn({ repo: DEFAULT_REPO, role: 'user', content: 'x' })).ok).toBe(false);
        expect((await listLogic.insertChatTurn({ id: 'a', role: 'user', content: 'x' })).ok).toBe(false);
        expect((await listLogic.insertChatTurn({ id: 'a', repo: DEFAULT_REPO, content: 'x' })).ok).toBe(false);
        expect(supa.inserted).toHaveLength(0);
    });

    it('returns { ok: false, error } when the write errors', async () => {
        supa.writeError = 'insert boom';
        const result = await listLogic.insertChatTurn({
            id: 'turn-1', repo: DEFAULT_REPO, role: 'user', content: 'hello',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('insert boom');
    });
});


describe('listLogic.fetchChatTurns', () => {
    beforeEach(resetSupa);

    it('returns the newest `limit` turns, handed back oldest-first', async () => {
        supa.rows = [
            row('a', 'user', 'one', '2026-08-01T10:00:00Z'),
            row('b', 'assistant', 'two', '2026-08-01T10:00:01Z'),
            row('c', 'user', 'three', '2026-08-01T10:00:02Z'),
        ];
        const result = await listLogic.fetchChatTurns(DEFAULT_REPO, 2);
        expect(result.ok).toBe(true);
        // LIMIT applies to the newest-first ordering, so 'a' is the one dropped —
        // and the survivors come back in replay order, not query order.
        expect(result.turns.map(t => t.id)).toEqual(['b', 'c']);
        expect(supa.limits).toEqual([2]);
    });

    it('scopes to the requested repo', async () => {
        supa.rows = [
            row('a', 'user', 'mine', '2026-08-01T10:00:00Z'),
            row('b', 'user', 'theirs', '2026-08-01T10:00:01Z', OTHER_REPO),
        ];
        const result = await listLogic.fetchChatTurns(OTHER_REPO, 60);
        expect(result.turns.map(t => t.id)).toEqual(['b']);
    });

    it('degrades to ok:false with an empty array on a read error', async () => {
        supa.selectError = 'read boom';
        const result = await listLogic.fetchChatTurns(DEFAULT_REPO, 60);
        expect(result.ok).toBe(false);
        expect(result.turns).toEqual([]);
    });

    it('rejects a missing repo without querying', async () => {
        const result = await listLogic.fetchChatTurns('', 60);
        expect(result.ok).toBe(false);
        expect(result.turns).toEqual([]);
        expect(supa.limits).toEqual([]);
    });
});


describe('listLogic.pruneChatTurns', () => {
    beforeEach(resetSupa);

    it('is a no-op when nothing sits beyond the cap', async () => {
        supa.rows = [
            row('a', 'user', 'one', '2026-08-01T10:00:00Z'),
            row('b', 'user', 'two', '2026-08-01T10:00:01Z'),
        ];
        const result = await listLogic.pruneChatTurns(DEFAULT_REPO, 5);
        expect(result).toEqual({ ok: true });
        expect(supa.ranges).toEqual([[5, 5 + 999]]);
        expect(supa.deletes).toEqual([]);
    });

    it('deletes exactly the ids beyond the cap, oldest ones', async () => {
        supa.rows = [
            row('a', 'user', 'one', '2026-08-01T10:00:00Z'),
            row('b', 'user', 'two', '2026-08-01T10:00:01Z'),
            row('c', 'user', 'three', '2026-08-01T10:00:02Z'),
            row('d', 'user', 'four', '2026-08-01T10:00:03Z'),
        ];
        const result = await listLogic.pruneChatTurns(DEFAULT_REPO, 2);
        expect(result).toEqual({ ok: true });
        // Newest-first from offset 2 → the two oldest turns.
        expect(supa.deletes).toEqual([{ kind: 'in', column: 'id', values: ['b', 'a'] }]);
    });

    it('returns { ok: false, error } when the id read errors', async () => {
        supa.selectError = 'range boom';
        const result = await listLogic.pruneChatTurns(DEFAULT_REPO, 2);
        expect(result.ok).toBe(false);
        expect(supa.deletes).toEqual([]);
    });
});


describe('listLogic.clearChatTurns', () => {
    beforeEach(resetSupa);

    it('deletes every row for the repo', async () => {
        const result = await listLogic.clearChatTurns(DEFAULT_REPO);
        expect(result).toEqual({ ok: true });
        expect(supa.deletes).toEqual([{ kind: 'eq', column: 'repo', value: DEFAULT_REPO }]);
    });

    it('rejects a missing repo without deleting', async () => {
        const result = await listLogic.clearChatTurns('');
        expect(result.ok).toBe(false);
        expect(supa.deletes).toEqual([]);
    });
});


// ── The sheet's append funnel, hydrate-merge, and reset paths ──

async function tick() {
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
}
async function flush(n = 6) {
    for (let i = 0; i < n; i++) await tick();
}

describe('Claude sheet — chat turns mirrored to Supabase', () => {
    let realFetch;

    function makeFetch() {
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
            }
            const body = JSON.parse(opts.body);
            if (body.repos) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
                    ok: true, default: DEFAULT_REPO, repos: [{ repo: DEFAULT_REPO, srcPrefix: 'toDoList_main/src/' }],
                }) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'assistant reply' }) });
        });
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        resetSupa();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        realFetch = globalThis.fetch;
        globalThis.fetch = makeFetch();
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    async function send(text) {
        const input = document.getElementById('claudeComposerInput');
        input.value = text;
        document.getElementById('claudeComposerSend').click();
        await flush();
    }

    it('writes a row for the user turn and the assistant reply, each with a distinct id', async () => {
        mountClaudeSheet(document.body);
        await flush();
        supa.inserted = [];

        await send('remember me');

        const roles = supa.inserted.map(r => r.role);
        expect(roles).toEqual(['user', 'assistant']);
        expect(supa.inserted.map(r => r.content)).toEqual(['remember me', 'assistant reply']);
        expect(supa.inserted.every(r => r.repo === DEFAULT_REPO)).toBe(true);
        expect(supa.inserted[0].id).not.toBe(supa.inserted[1].id);
    });

    it('gives the local turn and its row the same id', async () => {
        mountClaudeSheet(document.body);
        await flush();
        supa.inserted = [];

        await send('remember me');

        const thread = JSON.parse(localStorage.getItem(CHAT_KEY) || '{}')[DEFAULT_REPO];
        expect(thread.map(t => t.id)).toEqual(supa.inserted.map(r => r.id));
    });

    it('prunes the repo to CHAT_HISTORY_CAP after each insert', async () => {
        mountClaudeSheet(document.body);
        await flush();
        supa.ranges = [];

        await send('remember me');

        // One prune per inserted turn, each ranged from the shared 60-turn cap —
        // the same constant the local thread is saved under.
        expect(supa.ranges.length).toBe(2);
        expect(supa.ranges.every(r => r[0] === 60)).toBe(true);
    });

    it('sends the Worker plain role/content turns — no sync metadata on the wire', async () => {
        mountClaudeSheet(document.body);
        await flush();

        await send('remember me');

        const chatCall = globalThis.fetch.mock.calls
            .map(c => JSON.parse(c[1].body))
            .filter(b => b.chat)
            .pop();
        expect(chatCall.messages).toEqual([{ role: 'user', content: 'remember me' }]);
    });

    it('leaves the thread untouched when a failed insert makes the mirror a no-op', async () => {
        mountClaudeSheet(document.body);
        await flush();
        supa.writeError = 'offline';

        await send('remember me');

        const thread = JSON.parse(localStorage.getItem(CHAT_KEY) || '{}')[DEFAULT_REPO];
        expect(thread.map(t => t.content)).toEqual(['remember me', 'assistant reply']);
        expect(document.querySelectorAll('.claudeMsg--error').length).toBe(0);
    });
});


describe('Claude sheet — hydrating stored chat turns', () => {
    let realFetch;

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        resetSupa();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        realFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(() => Promise.resolve({
            ok: false, status: 404, json: () => Promise.resolve(null),
        }));
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    // Replayed assistant bubbles carry a "+ Create task" action appended to their
    // text; trim it so these assertions read on the turn content alone.
    function bubbleTexts() {
        return Array.prototype.map.call(
            document.querySelectorAll('#claudeChatSurface .claudeMsg--user, #claudeChatSurface .claudeMsg--assistant'),
            el => el.textContent.replace(/\+ Create task$/, '')
        );
    }

    it('merges rows written by another device into the local thread on mount', async () => {
        localStorage.setItem(CHAT_KEY, JSON.stringify({
            [DEFAULT_REPO]: [
                { id: 'local-1', ts: 1000, role: 'user', content: 'from this device' },
            ],
        }));
        supa.rows = [
            row('remote-1', 'user', 'from the phone', '2026-08-01T10:00:00Z'),
            row('remote-2', 'assistant', 'phone answer', '2026-08-01T10:00:01Z'),
        ];

        mountClaudeSheet(document.body);
        await flush(10);

        const thread = JSON.parse(localStorage.getItem(CHAT_KEY) || '{}')[DEFAULT_REPO];
        expect(thread.map(t => t.id)).toEqual(['local-1', 'remote-1', 'remote-2']);
        expect(bubbleTexts()).toEqual(['from this device', 'from the phone', 'phone answer']);
    });

    it('dedupes a turn present on both sides by id rather than duplicating it', async () => {
        localStorage.setItem(CHAT_KEY, JSON.stringify({
            [DEFAULT_REPO]: [
                { id: 'shared', ts: 1000, role: 'user', content: 'asked once' },
            ],
        }));
        supa.rows = [row('shared', 'user', 'asked once', '2026-08-01T10:00:00Z')];

        mountClaudeSheet(document.body);
        await flush(10);

        const thread = JSON.parse(localStorage.getItem(CHAT_KEY) || '{}')[DEFAULT_REPO];
        expect(thread).toHaveLength(1);
        expect(thread[0].id).toBe('shared');
    });

    it('leaves the locally-hydrated thread exactly as it was when the fetch fails', async () => {
        localStorage.setItem(CHAT_KEY, JSON.stringify({
            [DEFAULT_REPO]: [
                { id: 'local-1', ts: 1000, role: 'user', content: 'offline turn' },
            ],
        }));
        supa.selectError = 'offline';

        mountClaudeSheet(document.body);
        await flush(10);

        const thread = JSON.parse(localStorage.getItem(CHAT_KEY) || '{}')[DEFAULT_REPO];
        expect(thread.map(t => t.content)).toEqual(['offline turn']);
        expect(bubbleTexts()).toEqual(['offline turn']);
    });

    it('keeps legacy id-less turns, ordered ahead of every synced turn', async () => {
        localStorage.setItem(CHAT_KEY, JSON.stringify({
            [DEFAULT_REPO]: [
                { role: 'user', content: 'legacy question' },
                { role: 'assistant', content: 'legacy answer' },
            ],
        }));
        supa.rows = [row('remote-1', 'user', 'newer turn', '2026-08-01T10:00:00Z')];

        mountClaudeSheet(document.body);
        await flush(10);

        expect(bubbleTexts()).toEqual(['legacy question', 'legacy answer', 'newer turn']);
    });

    it('does not merge another repo\'s rows when the workspace moved mid-fetch', async () => {
        await seedBothWorkspaces();
        supa.rows = [row('remote-1', 'user', 'default repo turn', '2026-08-01T10:00:00Z')];

        mountClaudeSheet(document.body);
        // Swap the workspace before the mount hydrate resolves. The guard keys on
        // activeChatRepo, so the in-flight merge must be dropped rather than
        // painting the old repo's thread over the new one's blank surface.
        setChatWorkspaceRepo(OTHER_REPO);
        await flush(10);

        expect(bubbleTexts()).not.toContain('default repo turn');
    });
});


describe('Claude sheet — thread resets clear the stored turns', () => {
    let realFetch;

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        resetSupa();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        realFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(() => Promise.resolve({
            ok: false, status: 404, json: () => Promise.resolve(null),
        }));
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    it('clears the incoming repo\'s rows on a workspace reframe', async () => {
        await seedBothWorkspaces();
        mountClaudeSheet(document.body);
        await flush();
        supa.deletes = [];

        setChatWorkspaceRepo(OTHER_REPO);
        await flush();

        expect(supa.deletes).toContainEqual({ kind: 'eq', column: 'repo', value: OTHER_REPO });
    });

    it('clears the active repo\'s rows when the conversation is wiped', async () => {
        mountClaudeSheet(document.body);
        await flush();
        supa.deletes = [];

        const newChat = document.getElementById('claudeClearChat');
        expect(newChat).toBeTruthy();
        // New Chat arms an inline confirm; the wipe only fires on Wipe.
        newChat.click();
        document.querySelector('.claudeClearChatYes').click();
        await flush();

        expect(supa.deletes).toContainEqual({ kind: 'eq', column: 'repo', value: DEFAULT_REPO });
    });
});


// Source-level pins for the two invariants whose failure mode is silent: the
// replay guard (a merge landing mid-turn would wipe the pending bubble) and the
// single-source cap (a second constant would let the local and remote caps
// drift apart without any visible symptom).
describe('chat turns sync — source-level invariants', () => {
    const SHEET = readSheetSource();

    it('guards the post-merge replay on both the workspace and an in-flight turn', () => {
        const body = functionBody(SHEET, 'hydrateChatTurnsFromRemote');
        expect(body).toBeTruthy();
        expect(body).toMatch(/if\s*\(\s*repo\s*!==\s*activeChatRepo\s*\)\s*return;/);
        expect(body).toMatch(/if\s*\(\s*chatTurnInFlight\s*\)\s*return;/);
        // Both guards must precede the replay call they protect (lastIndexOf, so
        // the mention in the guard's own comment doesn't stand in for the call).
        expect(body.indexOf('chatTurnInFlight')).toBeLessThan(body.lastIndexOf('replayChatHistory'));
        expect(body.indexOf('activeChatRepo')).toBeLessThan(body.lastIndexOf('replayChatHistory'));
    });

    it('prunes against CHAT_HISTORY_CAP rather than a second cap constant', () => {
        const body = functionBody(SHEET, 'appendChatTurn');
        expect(body).toBeTruthy();
        expect(body).toMatch(/pruneChatTurns\(\s*repo\s*,\s*CHAT_HISTORY_CAP\s*\)/);
        const caps = SHEET.match(/const CHAT_HISTORY_CAP\s*=/g) || [];
        expect(caps).toHaveLength(1);
    });

    it('leaves stripTurnImages as the sole gate keeping base64 out of persistence', () => {
        const body = functionBody(SHEET, 'appendChatTurn');
        // The mirrored row carries only the four synced columns — an `images`
        // field would push base64 into Supabase exactly as it was kept out of
        // localStorage.
        expect(body).not.toMatch(/images/);
    });
});
