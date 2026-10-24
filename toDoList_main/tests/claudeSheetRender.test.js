import { describe, it, expect, beforeEach, vi } from 'vitest';

// Assistant replies render through the markdown renderer in the live bubble and
// on replay, the existing html/svg, Create task and scoped-chip behaviours hold,
// and the `⤢` chip opens a paging reply reader.

const { state } = vi.hoisted(() => ({
    state: { calls: [], reply: 'ok', replies: null, symbols: null },
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
            const reply = state.replies && state.replies.length ? state.replies.shift() : state.reply;
            return Promise.resolve({ reply: reply, suggestedFiles: [] });
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
    openChatWithBookScope,
} from '../src/claudeSheet.js';
import { resetSymbolsCache } from '../src/codeTrace.js';
import { listLogic } from '../src/listLogic.js';

const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
const SYMBOLS = {
    files: {
        'claudeSheet.js': {
            defs: [{ name: 'openChatWithTask', start: 570, end: 584, parent: null }],
            imports: {},
        },
    },
};

const input = () => document.getElementById('claudeComposerInput');
const flush = () => new Promise((r) => setTimeout(r, 0));
const assistantBubbles = () => Array.from(document.querySelectorAll('#claudeChatSurface .claudeMsg--assistant'));
const readerSheet = () => document.getElementById('claudeReaderSheet');

async function sendTurn(text) {
    input().value = text;
    document.getElementById('claudeComposerSend').click();
    await flush();
    await flush();
}

describe('claudeSheet — assistant replies render as markdown', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
        document.body.className = '';
        state.calls = [];
        state.reply = 'ok';
        state.replies = null;
        state.symbols = SYMBOLS;
        resetSymbolsCache();
        listLogic._reset();
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1300 });
        mountClaudeSheet(document.body);
    });

    it('renders bold and nested bullets as real elements in the bubble', async () => {
        state.reply = 'Plan:\n- **First** step\n  - sub point\n- Second';
        await sendTurn('plan?');
        const bubble = assistantBubbles().pop();
        expect(bubble.querySelector('strong').textContent).toBe('First');
        expect(bubble.querySelector('ul > li > ul > li').textContent).toBe('sub point');
        expect(bubble.textContent).not.toContain('**');
    });

    it('still renders a fenced html block as a live box', async () => {
        state.reply = 'Mockup:\n```html\n<div class="card">Hi</div>\n```\n**done**';
        await sendTurn('mock it');
        const bubble = assistantBubbles().pop();
        expect(bubble.querySelector('.claudeMsgRendered--html .card')).toBeTruthy();
        expect(bubble.querySelector('strong').textContent).toBe('done');
    });

    it('still mounts Create task on a drafted md fence, shown as a code block', async () => {
        state.reply = 'Here:\n```md\n- [ ] **[LOW]** Do a thing\n  - Type: feature\n```';
        await sendTurn('draft');
        const bubble = assistantBubbles().pop();
        expect(bubble.querySelector('pre code[data-lang="md"]').textContent).toContain('- [ ] **[LOW]** Do a thing');
        expect(bubble.querySelector('.claudeMsgCreateTask')).toBeTruthy();
    });

    it('runs the scoped chip pass inside a rendered paragraph', async () => {
        openChatWithBookScope({
            repo: DEFAULT_REPO,
            chapter: { id: 'life', title: 'Life', index: 1, total: 1 },
            prose: [],
            refs: [{ file: 'claudeSheet.js', symbol: 'openChatWithTask', line: 570, end: 584, label: 'openChatWithTask' }],
        });
        await flush();
        state.reply = 'It starts in **`openChatWithTask`** and `unknownThing`.';
        await sendTurn('where?');
        const bubble = assistantBubbles().pop();
        const chip = bubble.querySelector('p strong .claudeMsgBookRef');
        expect(chip.textContent).toBe('openChatWithTask');
        expect(bubble.querySelector('p code').textContent).toBe('unknownThing');
    });

    it('renders replayed history the same after a re-mount', async () => {
        state.reply = '- **a**\n- b';
        await sendTurn('x');
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        const bubble = assistantBubbles().pop();
        expect(bubble.querySelector('ul > li > strong').textContent).toBe('a');
        expect(bubble.querySelector('.claudeMsgReaderChip')).toBeTruthy();
    });

    it('mounts the reader chip on completed replies only', async () => {
        await sendTurn('hi');
        const bubble = assistantBubbles().pop();
        const chip = bubble.querySelector('.claudeMsgReaderChip');
        expect(chip.getAttribute('aria-label')).toBe('Open reply in reader');
        expect(document.querySelector('.claudeMsg--note .claudeMsgReaderChip')).toBe(null);
        expect(document.querySelector('.claudeMsg--user .claudeMsgReaderChip')).toBe(null);
    });

    it('opens the reader at the bubble\'s turn, pages, and Escape refocuses the chip', async () => {
        state.replies = ['First **one**', 'Second *two*', 'Third `three`'];
        await sendTurn('1');
        await sendTurn('2');
        await sendTurn('3');
        const chip = assistantBubbles()[1].querySelector('.claudeMsgReaderChip');
        chip.click();

        const sheet = readerSheet();
        expect(sheet.hidden).toBe(false);
        expect(sheet.querySelector('.claudeReaderTitle').textContent).toBe('REPLY · 2 OF 3');
        expect(sheet.querySelector('.claudeReaderBody em').textContent).toBe('two');

        sheet.querySelector('.claudeReaderNext').click();
        expect(sheet.querySelector('.claudeReaderTitle').textContent).toBe('REPLY · 3 OF 3');
        expect(sheet.querySelector('.claudeReaderBody code').textContent).toBe('three');
        expect(sheet.querySelector('.claudeReaderNext').disabled).toBe(true);

        sheet.querySelector('.claudeReaderPrev').click();
        sheet.querySelector('.claudeReaderPrev').click();
        expect(sheet.querySelector('.claudeReaderTitle').textContent).toBe('REPLY · 1 OF 3');
        expect(sheet.querySelector('.claudeReaderPrev').disabled).toBe(true);
        expect(sheet.hidden).toBe(false);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(sheet.hidden).toBe(true);
        expect(document.activeElement).toBe(chip);
    });

    it('closes from the Close button and the backdrop', async () => {
        await sendTurn('hi');
        const chip = assistantBubbles().pop().querySelector('.claudeMsgReaderChip');
        chip.click();
        readerSheet().querySelector('.claudeReaderClose').click();
        expect(readerSheet().hidden).toBe(true);
        expect(document.activeElement).toBe(chip);

        chip.click();
        readerSheet().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(readerSheet().hidden).toBe(true);
    });

    it('Copy puts the raw markdown on the clipboard', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        state.reply = '**raw** reply';
        await sendTurn('hi');
        assistantBubbles().pop().querySelector('.claudeMsgReaderChip').click();
        readerSheet().querySelector('.claudeReaderCopy').click();
        expect(writeText).toHaveBeenCalledWith('**raw** reply');
    });
});
