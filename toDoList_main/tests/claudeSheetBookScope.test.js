import { describe, it, expect, beforeEach, vi } from 'vitest';

// The chapter scope ("Ask about this chapter"): the reader's Ask chip opens the
// chat framed on the chapter's repo, renders the `📖 CH n · title` scope chip in
// place of any task scope, and sends `book_scope` on every turn while scoped.
// Every reset path (remove / + New Chat) drops it, it survives a reload, and a
// scoped reply's backticked names become code chips when they resolve in the
// repo's symbols index.

const { state } = vi.hoisted(() => ({
    state: { calls: [], reply: 'ok', symbols: null },
}));

vi.mock('../src/supabaseClient.js', () => {
    function makeQuery() {
        const q = {
            select: function() { return q; },
            order: function() { return Promise.resolve({ data: [], error: null }); },
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
            from: function() { return makeQuery(); },
            channel: function() { return { on: function() { return this; }, subscribe: function() { return this; }, unsubscribe: function() { return this; } }; },
            removeChannel: function() {},
        },
    };
});

// Capture each chat turn's arguments instead of reaching the Worker.
vi.mock('../src/inject.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        chatWithWorker: vi.fn(function() {
            state.calls.push(Array.prototype.slice.call(arguments));
            return Promise.resolve({ reply: state.reply, suggestedFiles: [] });
        }),
    };
});

// Serve the symbols index from the fixture rather than Pages.
vi.mock('../src/codeTrace.js', async (importOriginal) => {
    const actual = await importOriginal();
    const loaded = new Map();
    return {
        ...actual,
        loadSymbols: vi.fn(function(repo) {
            loaded.set(repo, state.symbols);
            return Promise.resolve(state.symbols);
        }),
        getLoadedSymbols: vi.fn(function(repo) { return loaded.get(repo); }),
        resetSymbolsCache: function() { loaded.clear(); },
    };
});

import {
    mountClaudeSheet,
    openChatWithTask,
    openChatWithBookScope,
    openChatWithSelection,
    getActiveChatTask,
    getActiveBookScope,
    getActiveSelectionScope,
    getActiveChatRepo,
    setBookRefOpener,
} from '../src/claudeSheet.js';
import { resetSymbolsCache } from '../src/codeTrace.js';
import { listLogic } from '../src/listLogic.js';

const BOOK_SCOPE_KEY = 'todoapp_claudeBookScope';
const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';

const SYMBOLS = {
    files: {
        'claudeSheet.js': {
            defs: [{ name: 'openChatWithTask', start: 570, end: 584, parent: null }],
            imports: {},
        },
        'listLogic.js': {
            defs: [
                { name: 'getTodoById', start: 90, end: 99, parent: 'listLogic' },
            ],
            imports: {},
        },
    },
};

function scope(overrides) {
    return Object.assign({
        repo: DEFAULT_REPO,
        chapter: { id: 'life', title: 'The life of a task', index: 3, total: 9 },
        prose: ['A task starts in openChatWithTask.'],
        refs: [{ file: 'claudeSheet.js', symbol: 'openChatWithTask', line: 570, end: 584, label: 'openChatWithTask' }],
    }, overrides || {});
}

const scopeChip = () => document.getElementById('claudeScopeChip');
const input = () => document.getElementById('claudeComposerInput');
const flush = () => new Promise((r) => setTimeout(r, 0));

async function sendTurn(text) {
    input().value = text;
    document.getElementById('claudeComposerSend').click();
    await flush();
    await flush();
}

function seedTodo(projectName, title) {
    listLogic.addProject(projectName);
    listLogic.addToDo(projectName, title);
    return listLogic.listItems(projectName).find((i) => i.tit === title);
}

describe('claudeSheet — chapter scope', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
        document.body.className = '';
        state.calls = [];
        state.reply = 'ok';
        state.symbols = SYMBOLS;
        resetSymbolsCache();
        listLogic._reset();
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1300 });
        mountClaudeSheet(document.body);
    });

    it('opening sets the scope, the chip, the placeholder and persists it per repo', () => {
        document.body.classList.add('chatPaneCollapsed');
        openChatWithBookScope(scope());

        expect(document.body.classList.contains('chatPaneCollapsed')).toBe(false);
        expect(getActiveBookScope().chapter.id).toBe('life');
        const chip = scopeChip();
        expect(chip.textContent).toContain('📖 CH 3 · The life of a task');
        expect(chip.querySelector('.claudeScopeChipRemove')).toBeTruthy();
        expect(input().getAttribute('placeholder')).toBe('Ask about this chapter…');
        expect(document.activeElement).toBe(input());

        const stored = JSON.parse(localStorage.getItem(BOOK_SCOPE_KEY));
        expect(stored[DEFAULT_REPO].chapter.title).toBe('The life of a task');
        expect(stored[DEFAULT_REPO].refs).toHaveLength(1);
    });

    it('detaches a task scope — one scope at a time — and a task replaces it back', () => {
        const item = seedTodo('Proj', 'Scoped task');
        openChatWithTask(item.id);
        expect(getActiveChatTask()).toBe(item.id);

        openChatWithBookScope(scope());
        expect(getActiveChatTask()).toBe(null);
        expect(scopeChip().textContent).not.toContain('Scoped task');

        openChatWithTask(item.id);
        expect(getActiveBookScope()).toBe(null);
        expect(scopeChip().textContent).toContain('Scoped task');
        expect(input().getAttribute('placeholder')).toBe('Ask Agent');
    });

    it('the remove control clears the scope, its stored copy and the placeholder', () => {
        openChatWithBookScope(scope());
        scopeChip().querySelector('.claudeScopeChipRemove').click();

        expect(getActiveBookScope()).toBe(null);
        expect(scopeChip().textContent).toContain('Unscoped');
        expect(input().getAttribute('placeholder')).toBe('Ask Agent');
        const stored = JSON.parse(localStorage.getItem(BOOK_SCOPE_KEY) || '{}');
        expect(stored[DEFAULT_REPO]).toBeUndefined();
    });

    it('"+ New Chat" clears the scope with the transcript', async () => {
        openChatWithBookScope(scope());
        await sendTurn('hello');
        document.getElementById('claudeClearChat').click();
        document.querySelector('.claudeClearChatYes').click();

        expect(getActiveBookScope()).toBe(null);
        expect(scopeChip().textContent).toContain('Unscoped');
        const stored = JSON.parse(localStorage.getItem(BOOK_SCOPE_KEY) || '{}');
        expect(stored[DEFAULT_REPO]).toBeUndefined();
    });

    it('survives a re-mount (reload)', () => {
        openChatWithBookScope(scope());
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        expect(getActiveBookScope().chapter.id).toBe('life');
        expect(scopeChip().textContent).toContain('CH 3 · The life of a task');
        expect(input().getAttribute('placeholder')).toBe('Ask about this chapter…');
    });

    it('sends book_scope on every turn only while scoped', async () => {
        await sendTurn('unscoped question');
        expect(state.calls[0][7]).toBeUndefined();

        openChatWithBookScope(scope());
        await sendTurn('first');
        await sendTurn('second');
        expect(state.calls[1][7].bookScope.chapter).toEqual({ id: 'life', title: 'The life of a task', index: 3, total: 9 });
        expect(state.calls[1][7].bookScope.prose).toEqual(['A task starts in openChatWithTask.']);
        expect(state.calls[2][7].bookScope.chapter.id).toBe('life');
        expect(state.calls[2][3]).toBe(DEFAULT_REPO);

        scopeChip().querySelector('.claudeScopeChipRemove').click();
        await sendTurn('after removing');
        expect(state.calls[3][7]).toBeUndefined();
    });

    it('turns resolvable backticked names into chips and leaves the rest as code', async () => {
        const opened = vi.fn();
        setBookRefOpener(opened);
        openChatWithBookScope(scope());
        await flush();
        state.reply = 'It starts in `openChatWithTask()` then reads `listLogic.getTodoById` and `notARealThing`.';
        await sendTurn('where does it start?');

        const bubble = Array.from(document.querySelectorAll('.claudeMsg--assistant')).pop();
        const chips = bubble.querySelectorAll('button.claudeMsgBookRef');
        expect(Array.from(chips).map((c) => c.textContent)).toEqual(['openChatWithTask()', 'listLogic.getTodoById']);
        const codes = Array.from(bubble.querySelectorAll('code')).map((c) => c.textContent);
        expect(codes).toEqual(['notARealThing']);
        expect(bubble.textContent).not.toContain('`');

        chips[0].click();
        expect(opened).toHaveBeenCalledWith({
            repo: DEFAULT_REPO,
            file: 'claudeSheet.js',
            symbol: 'openChatWithTask',
            line: 570,
            end: 584,
            label: 'openChatWithTask()',
        });
        setBookRefOpener(null);
    });

    it('leaves an unscoped reply\'s code spans as plain code, never chips', async () => {
        state.reply = 'It starts in `openChatWithTask`.';
        await sendTurn('where?');
        const bubble = Array.from(document.querySelectorAll('.claudeMsg--assistant')).pop();
        expect(bubble.querySelector('.claudeMsgBookRef')).toBe(null);
        expect(bubble.querySelector('code').textContent).toBe('openChatWithTask');
    });

    it('leaves fenced blocks verbatim in a scoped reply', async () => {
        openChatWithBookScope(scope());
        await flush();
        state.reply = 'See:\n```md\n- [ ] Use `openChatWithTask`\n```\nDone.';
        await sendTurn('draft it');
        const bubble = Array.from(document.querySelectorAll('.claudeMsg--assistant')).pop();
        expect(bubble.querySelector('.claudeMsgBookRef')).toBe(null);
        expect(bubble.textContent).toContain('- [ ] Use `openChatWithTask`');
    });

    it('frames the conversation on the chapter repo, keeping each repo its own scope', () => {
        openChatWithBookScope(scope());
        openChatWithBookScope(scope({ repo: 'owner/other', chapter: { id: 'b', title: 'Other book', index: 1, total: 2 } }));
        expect(getActiveChatRepo()).toBe('owner/other');
        expect(scopeChip().textContent).toContain('CH 1 · Other book');
        const stored = JSON.parse(localStorage.getItem(BOOK_SCOPE_KEY));
        expect(stored[DEFAULT_REPO].chapter.id).toBe('life');
        expect(stored['owner/other'].chapter.id).toBe('b');
    });

    it('ignores a scope with no chapter id or repo', () => {
        openChatWithBookScope({ repo: DEFAULT_REPO, chapter: {} });
        openChatWithBookScope({ chapter: { id: 'x' } });
        expect(getActiveBookScope()).toBe(null);
    });
});

// The selection scope ("Ask about these lines"): the code viewer's Ask opens the
// chat with a `§ file:start–end` chip and the "Ask about these lines…"
// placeholder, sends the selection as `book_scope` on every turn, replaces any
// task or chapter scope (and is replaced by them), and is cleared by + New Chat
// and the chip's remove control.
describe('claudeSheet — selection scope', () => {
    const SELECTION_KEY = 'todoapp_claudeSelectionScope';

    function selection(overrides) {
        return Object.assign({
            repo: DEFAULT_REPO,
            filePath: 'src/Program.cs',
            srcRoot: 'src',
            start: 29,
            end: 31,
            text: ['using A;', 'using B;', 'using C;'],
            scope: {
                chapter: { id: 'sel:Program.cs:29-31', title: 'Program.cs lines 29–31', index: 0, total: 0 },
                prose: ['29  using A;\n30  using B;\n31  using C;'],
                refs: [{ file: 'Program.cs', symbol: 'Main', label: 'Main', line: 20, end: 40 }],
                index: [{ file: 'Other.cs', symbol: 'Helper', line: 1, end: 5 }],
            },
        }, overrides || {});
    }

    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
        document.body.className = '';
        state.calls = [];
        state.reply = 'ok';
        state.symbols = SYMBOLS;
        resetSymbolsCache();
        listLogic._reset();
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1300 });
        mountClaudeSheet(document.body);
    });

    it('opening uncollapses the chat with the selection chip, placeholder and stored scope', () => {
        document.body.classList.add('chatPaneCollapsed');
        openChatWithSelection(selection());

        expect(document.body.classList.contains('chatPaneCollapsed')).toBe(false);
        expect(getActiveSelectionScope()).toMatchObject({ file: 'src/Program.cs', start: 29, end: 31 });
        expect(scopeChip().textContent).toContain('§ Program.cs:29–31');
        expect(scopeChip().querySelector('.claudeScopeChipRemove')).toBeTruthy();
        expect(input().getAttribute('placeholder')).toBe('Ask about these lines…');
        expect(document.activeElement).toBe(input());
        const stored = JSON.parse(localStorage.getItem(SELECTION_KEY));
        expect(stored[DEFAULT_REPO].chapter.id).toBe('sel:Program.cs:29-31');
    });

    it('labels a one-line selection without a range', () => {
        openChatWithSelection(selection({ start: 7, end: 7, scope: null, text: ['x'] }));
        expect(scopeChip().textContent).toContain('§ Program.cs:7');
        expect(scopeChip().textContent).not.toContain('–');
    });

    it('sends the selection as book_scope on every turn, without its own bookkeeping fields', async () => {
        openChatWithSelection(selection());
        await sendTurn('why is this using here?');
        await sendTurn('who calls this?');
        const sent = state.calls[0][7].bookScope;
        expect(sent).toEqual({
            chapter: { id: 'sel:Program.cs:29-31', title: 'Program.cs lines 29–31', index: 0, total: 0 },
            prose: ['29  using A;\n30  using B;\n31  using C;'],
            refs: [{ file: 'Program.cs', symbol: 'Main', label: 'Main', line: 20, end: 40 }],
            index: [{ file: 'Other.cs', symbol: 'Helper', line: 1, end: 5 }],
        });
        expect(state.calls[1][7].bookScope.chapter.id).toBe('sel:Program.cs:29-31');
        expect(state.calls[1][3]).toBe(DEFAULT_REPO);
    });

    it('falls back to the raw lines when no scope was built', async () => {
        openChatWithSelection(selection({ scope: undefined }));
        await sendTurn('what is this?');
        const sent = state.calls[0][7].bookScope;
        expect(sent.chapter).toEqual({ id: 'sel:src/Program.cs:29-31', title: 'src/Program.cs lines 29–31', index: 0, total: 0 });
        expect(sent.prose).toEqual(['using A;\nusing B;\nusing C;']);
        expect(sent.refs).toEqual([]);
    });

    it('detaches a task or chapter scope, and either replaces it back', () => {
        const item = seedTodo('Proj', 'Scoped task');
        openChatWithTask(item.id);
        openChatWithSelection(selection());
        expect(getActiveChatTask()).toBe(null);
        expect(getActiveSelectionScope()).not.toBe(null);

        openChatWithBookScope(scope());
        expect(getActiveSelectionScope()).toBe(null);
        expect(scopeChip().textContent).toContain('📖 CH 3');
        expect(JSON.parse(localStorage.getItem(SELECTION_KEY) || '{}')[DEFAULT_REPO]).toBeUndefined();

        openChatWithSelection(selection());
        expect(getActiveBookScope()).toBe(null);
        expect(scopeChip().textContent).toContain('§ Program.cs:29–31');

        openChatWithTask(item.id);
        expect(getActiveSelectionScope()).toBe(null);
        expect(input().getAttribute('placeholder')).toBe('Ask Agent');
    });

    it('the remove control clears the scope, its stored copy and the placeholder', () => {
        openChatWithSelection(selection());
        scopeChip().querySelector('.claudeScopeChipRemove').click();
        expect(getActiveSelectionScope()).toBe(null);
        expect(scopeChip().textContent).toContain('Unscoped');
        expect(input().getAttribute('placeholder')).toBe('Ask Agent');
        expect(JSON.parse(localStorage.getItem(SELECTION_KEY) || '{}')[DEFAULT_REPO]).toBeUndefined();
    });

    it('"+ New Chat" clears the scope with the transcript', async () => {
        openChatWithSelection(selection());
        await sendTurn('hello');
        document.getElementById('claudeClearChat').click();
        document.querySelector('.claudeClearChatYes').click();
        expect(getActiveSelectionScope()).toBe(null);
        expect(scopeChip().textContent).toContain('Unscoped');
        expect(JSON.parse(localStorage.getItem(SELECTION_KEY) || '{}')[DEFAULT_REPO]).toBeUndefined();
    });

    it('survives a re-mount (reload)', () => {
        openChatWithSelection(selection());
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        expect(getActiveSelectionScope()).toMatchObject({ start: 29, end: 31 });
        expect(scopeChip().textContent).toContain('§ Program.cs:29–31');
        expect(input().getAttribute('placeholder')).toBe('Ask about these lines…');
    });

    it('frames the conversation on the selection repo, keeping each repo its own scope', () => {
        openChatWithSelection(selection());
        openChatWithSelection(selection({ repo: 'owner/other', filePath: 'lib/a.js', start: 2, end: 3, scope: null }));
        expect(getActiveChatRepo()).toBe('owner/other');
        expect(scopeChip().textContent).toContain('§ a.js:2–3');
        const stored = JSON.parse(localStorage.getItem(SELECTION_KEY));
        expect(stored[DEFAULT_REPO].start).toBe(29);
        expect(stored['owner/other'].file).toBe('lib/a.js');
    });

    it('ignores a selection with no repo, file or valid range', () => {
        openChatWithSelection({ filePath: 'a.js', start: 1, end: 1 });
        openChatWithSelection({ repo: DEFAULT_REPO, start: 1, end: 1 });
        openChatWithSelection({ repo: DEFAULT_REPO, filePath: 'a.js', start: 5, end: 2 });
        expect(getActiveSelectionScope()).toBe(null);
    });

    it('a line note\'s seed fills an empty composer but never a draft', () => {
        openChatWithSelection(selection({ start: 8, end: 8, scope: null, text: ['x'], seed: 'Explain line 8' }));
        expect(input().value).toBe('Explain line 8');
        expect(scopeChip().textContent).toContain('§ Program.cs:8');
        input().value = 'my own question';
        openChatWithSelection(selection({ start: 9, end: 9, scope: null, text: ['y'], seed: 'Explain line 9' }));
        expect(input().value).toBe('my own question');
    });
});
