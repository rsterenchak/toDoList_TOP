import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Line notes in the code viewer (codeViewer.js): the header's Notes toggle asks
// the registered handler for a scope's notes — the whole file up to 300 lines,
// otherwise the definition in view (or every top-level one from the toggle's
// menu) — keeps only notes on code lines no adjacent comment explains, and lays
// them in a rail beside the code when the pane is 620px or wider or beneath
// their lines when narrower. Hover pairs a row with its note, a ref chip peeks
// the definition, and tapping a note's text asks about its line.

const { state } = vi.hoisted(() => ({
    state: { files: {}, symbols: null },
}));

vi.mock('../src/inject.js', () => ({
    readRepoFile: vi.fn(function (target, filePath) {
        const canned = state.files[filePath];
        return Promise.resolve({ ok: true, content: (canned && canned.content) || '', sha: 'blob-1' });
    }),
    showInjectToast: vi.fn(),
}));

import {
    renderCodeViewer,
    resetCodeViewer,
    setCodeViewerNotesHandler,
    setCodeViewerAskHandler,
} from '../src/codeViewer.js';
import { resetSymbolsCache } from '../src/codeTrace.js';
import { CODE_NOTES_ON_KEY, isCodeNotesOn } from '../src/prefs.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) { for (let i = 0; i < n; i++) await tick(); }

const TARGET = { repo: 'owner/app' };
const FILE = 'src/Customer.cs';

// Lines 1–2 are a doc comment over line 3; 4 is blank, 5 code, 6 code with a
// trailing comment, 7 a lone brace, 8–9 a two-line statement, 10 code.
const SOURCE = [
    '// The customer record.',
    '/// Holds the id.',
    'public int Id;',
    '',
    'var total = helper(1);',
    'var x = 2; // the x',
    '}',
    'var y = compute(',
    '    3);',
    'return total;',
].join('\n');

const host = () => document.getElementById('col');
const pane = () => document.querySelector('.codeViewerPane');
const toggle = () => document.querySelector('.codeViewerNotes');
const row = (n) => document.querySelector('.codeViewerLine[data-line="' + n + '"]');
const notes = () => Array.from(document.querySelectorAll('.codeViewerNote'));
const noteFor = (n) => document.querySelector('.codeViewerNote[data-note-line="' + n + '"]');

function fileOf(n) {
    const out = [];
    for (let i = 1; i <= n; i++) out.push('var v' + i + ' = ' + i + ';');
    return out.join('\n');
}

function setWidth(el, width) {
    el.getBoundingClientRect = () => ({ width: width, height: 0, top: 0, bottom: 0, left: 0, right: width });
}

async function open(content, width) {
    state.files[FILE] = { content: content == null ? SOURCE : content };
    renderCodeViewer(host(), { target: TARGET, filePath: FILE, srcRoot: 'src' });
    if (width) setWidth(pane(), width);
    await flush();
}

const RAW = [
    { line: 1, note: 'On a comment.' },
    { line: 3, note: 'Explained by the doc comment.' },
    { line: 4, note: 'Blank.' },
    { line: 5, note: 'Sums the order lines.', refs: ['helper', 'nowhere'] },
    { line: 6, note: 'Has its own comment.' },
    { line: 7, note: 'A brace.' },
    { line: 8, end: 9, note: 'Two-line call into compute.', refs: ['compute'] },
    { line: 10, note: 'Hands the total back.' },
];

describe('codeViewer — line notes', () => {
    let handler;

    beforeEach(() => {
        resetCodeViewer();
        resetSymbolsCache();
        localStorage.clear();
        state.files = {};
        state.symbols = null;
        document.body.innerHTML = '<div id="col"></div>';
        handler = vi.fn(function () { return Promise.resolve({ ok: true, notes: RAW }); });
        setCodeViewerNotesHandler(handler);
        globalThis.fetch = vi.fn(function () {
            return Promise.resolve({ ok: !!state.symbols, json: () => Promise.resolve(state.symbols) });
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        delete globalThis.fetch;
    });

    it('puts a Notes toggle left of Explain, enabled once a file is open', async () => {
        await open();
        const t = toggle();
        expect(t).toBeTruthy();
        expect(t.disabled).toBe(false);
        expect(t.getAttribute('aria-pressed')).toBe('false');
        const explain = document.querySelector('.codeViewerExplain');
        expect(t.compareDocumentPosition(explain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('is disabled with no handler registered', async () => {
        setCodeViewerNotesHandler(null);
        await open();
        expect(toggle().disabled).toBe(true);
    });

    it('asks once for the whole of a short file and remembers the toggle per repo', async () => {
        await open();
        toggle().click();
        await flush();
        expect(handler).toHaveBeenCalledTimes(1);
        const req = handler.mock.calls[0][0];
        expect(req.repo).toBe('owner/app');
        expect(req.filePath).toBe(FILE);
        expect(req.sha).toBe('blob-1');
        expect(req.scope).toBeNull();
        expect(toggle().getAttribute('aria-pressed')).toBe('true');
        expect(isCodeNotesOn('owner/app')).toBe(true);
        expect(JSON.parse(localStorage.getItem(CODE_NOTES_ON_KEY))).toEqual({ 'owner/app': true });
    });

    it('skips comment, blank and brace lines and lines an adjacent comment explains', async () => {
        await open();
        toggle().click();
        await flush();
        expect(notes().map((el) => Number(el.dataset.noteLine))).toEqual([5, 8, 10]);
        expect(row(3).hasAttribute('data-note')).toBe(false);
        expect(row(6).hasAttribute('data-note')).toBe(false);
        expect(row(8).dataset.note).toBe('8');
        expect(row(9).dataset.note).toBe('8');
    });

    it('interleaves notes beneath their (last) line when the pane is narrow', async () => {
        await open(null, 390);
        toggle().click();
        await flush();
        const lines = document.querySelector('.codeViewerLines');
        expect(lines.classList.contains('codeViewerLines--rail')).toBe(false);
        expect(lines.classList.contains('codeViewerLines--notes')).toBe(true);
        expect(row(5).nextElementSibling).toBe(noteFor(5));
        expect(row(9).nextElementSibling).toBe(noteFor(8));
        expect(noteFor(5).style.gridRow).toBe('');
        // Numbering is untouched: still one row per line.
        expect(document.querySelectorAll('.codeViewerLine').length).toBe(10);
    });

    it('lays notes in a rail aligned to their rows when the pane is 620px or wider', async () => {
        await open(null, 900);
        toggle().click();
        await flush();
        const lines = document.querySelector('.codeViewerLines');
        expect(lines.classList.contains('codeViewerLines--rail')).toBe(true);
        expect(noteFor(5).style.gridRow).toBe('5 / span 1');
        expect(noteFor(8).style.gridRow).toBe('8 / span 2');
        expect(noteFor(10).style.gridRow).toBe('10 / span 1');
    });

    it('switches between rail and interleaved as the pane resizes', async () => {
        let observed = null;
        globalThis.ResizeObserver = class { constructor(cb) { observed = cb; } observe() {} };
        try {
            resetCodeViewer();
            document.body.innerHTML = '<div id="col"></div>';
            setCodeViewerNotesHandler(handler);
            await open(null, 900);
            toggle().click();
            await flush();
            const lines = document.querySelector('.codeViewerLines');
            expect(lines.classList.contains('codeViewerLines--rail')).toBe(true);
            setWidth(pane(), 500);
            observed();
            expect(lines.classList.contains('codeViewerLines--rail')).toBe(false);
            expect(row(5).nextElementSibling).toBe(noteFor(5));
        } finally {
            delete globalThis.ResizeObserver;
        }
    });

    it('pairs a hovered row with its note and a hovered note with its rows', async () => {
        await open();
        toggle().click();
        await flush();
        row(9).querySelector('.codeViewerCode').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        expect(noteFor(8).classList.contains('codeViewerNote--active')).toBe(true);
        expect(row(8).classList.contains('codeViewerLine--noteActive')).toBe(true);
        expect(row(9).classList.contains('codeViewerLine--noteActive')).toBe(true);
        expect(noteFor(5).classList.contains('codeViewerNote--active')).toBe(false);

        noteFor(5).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        expect(noteFor(5).classList.contains('codeViewerNote--active')).toBe(true);
        expect(row(5).classList.contains('codeViewerLine--noteActive')).toBe(true);
        expect(row(8).classList.contains('codeViewerLine--noteActive')).toBe(false);

        document.querySelector('.codeViewerLines').dispatchEvent(new MouseEvent('mouseleave'));
        expect(document.querySelectorAll('.codeViewerNote--active').length).toBe(0);
    });

    it('lights a row\'s note on a tap (touch has no hover)', async () => {
        await open();
        toggle().click();
        await flush();
        row(10).querySelector('.codeViewerCode').click();
        expect(noteFor(10).classList.contains('codeViewerNote--active')).toBe(true);
    });

    it('renders only resolvable refs as chips, and a chip opens the trace peek', async () => {
        state.symbols = {
            files: {
                'Customer.cs': { defs: [], imports: {} },
                'Helpers.cs': { defs: [{ name: 'helper', kind: 'function', start: 1, end: 3 }] },
            },
        };
        state.files['src/Helpers.cs'] = { content: 'int helper(int a) {\n  return a;\n}' };
        await open();
        toggle().click();
        await flush();
        const chips = Array.from(noteFor(5).querySelectorAll('.codeViewerNoteRef'));
        expect(chips.map((c) => c.textContent)).toEqual(['helper']);
        expect(chips[0].classList.contains('bookRef')).toBe(true);
        chips[0].click();
        await flush();
        const peek = document.querySelector('.codeTracePeek');
        expect(peek).toBeTruthy();
        expect(peek.querySelector('.codeTracePeekName').textContent).toBe('helper');
    });

    it('asks about a note\'s line (or statement) when its text is tapped', async () => {
        const ask = vi.fn();
        setCodeViewerAskHandler(ask);
        await open();
        toggle().click();
        await flush();
        noteFor(8).querySelector('.codeViewerNoteText').click();
        expect(ask).toHaveBeenCalledTimes(1);
        expect(ask.mock.calls[0][0]).toEqual({
            repo: 'owner/app',
            filePath: FILE,
            srcRoot: 'src',
            start: 8,
            end: 9,
            text: ['var y = compute(', '    3);'],
            seed: 'Explain line 8',
        });
    });

    it('turns itself off with a message when the notes can\'t be read', async () => {
        handler.mockImplementation(() => Promise.resolve({ ok: false }));
        await open();
        toggle().click();
        await flush();
        expect(toggle().getAttribute('aria-pressed')).toBe('false');
        expect(notes().length).toBe(0);
        const status = document.querySelector('.codeViewerNotesStatus');
        expect(status.hidden).toBe(false);
        expect(status.textContent).toBe('Couldn’t read notes for this file.');
    });

    it('toggling off removes the notes and forgets the repo', async () => {
        await open();
        toggle().click();
        await flush();
        expect(notes().length).toBe(3);
        toggle().click();
        expect(notes().length).toBe(0);
        expect(toggle().getAttribute('aria-pressed')).toBe('false');
        expect(isCodeNotesOn('owner/app')).toBe(false);
    });

    it('annotates a newly opened file straight away when the repo has Notes on', async () => {
        localStorage.setItem(CODE_NOTES_ON_KEY, JSON.stringify({ 'owner/app': true }));
        await open();
        expect(toggle().getAttribute('aria-pressed')).toBe('true');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(notes().length).toBe(3);
    });

    it('drops a reply that lands after a different file was opened', async () => {
        let resolve;
        handler.mockImplementation(() => new Promise((r) => { resolve = r; }));
        await open();
        toggle().click();
        await flush();
        state.files['src/Other.cs'] = { content: 'a\nb' };
        renderCodeViewer(host(), { target: TARGET, filePath: 'src/Other.cs', srcRoot: 'src' });
        resolve({ ok: true, notes: RAW });
        await flush();
        expect(notes().length).toBe(0);
    });

    describe('a file over 300 lines', () => {
        const DEFS = [
            { name: 'Top', kind: 'class', start: 1, end: 120 },
            { name: 'inner', kind: 'function', start: 10, end: 20, parent: 'Top' },
            { name: 'Middle', kind: 'function', start: 130, end: 250 },
            { name: 'Tail', kind: 'function', start: 260, end: 400 },
        ];

        beforeEach(() => {
            state.symbols = { files: { 'Customer.cs': { defs: DEFS, imports: {} } } };
        });

        it('annotates the definition in view, naming it and the file\'s definitions', async () => {
            await open(fileOf(400));
            toggle().click();
            await flush();
            expect(handler).toHaveBeenCalledTimes(1);
            const req = handler.mock.calls[0][0];
            expect(req.scope).toEqual({ start: 1, end: 120, symbol: 'Top' });
            expect(req.names).toEqual(['Top', 'inner', 'Middle', 'Tail']);
        });

        it('keeps a scope\'s notes inside its definition', async () => {
            handler.mockImplementation(() => Promise.resolve({ ok: true, notes: [
                { line: 12, note: 'Inside.' },
                { line: 140, note: 'Outside the scope.' },
            ] }));
            await open(fileOf(400));
            toggle().click();
            await flush();
            expect(notes().map((el) => Number(el.dataset.noteLine))).toEqual([12]);
        });

        it('offers "Notes for whole file" on right-click and fetches each top-level definition in turn', async () => {
            await open(fileOf(400));
            const menu = document.querySelector('.codeViewerNotesMenu');
            expect(menu.hidden).toBe(true);
            const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            toggle().dispatchEvent(ev);
            expect(ev.defaultPrevented).toBe(true);
            expect(menu.hidden).toBe(false);
            menu.querySelector('.codeViewerNotesMenuItem').click();
            expect(menu.hidden).toBe(true);
            await flush(12);
            expect(handler.mock.calls.map((c) => c[0].scope.symbol)).toEqual(['Top', 'Middle', 'Tail']);
            expect(toggle().getAttribute('aria-pressed')).toBe('true');
        });

        it('opens the menu on a 500ms long-press', async () => {
            await open(fileOf(400));
            vi.useFakeTimers();
            const t = toggle();
            const ev = new Event('touchstart', { bubbles: true });
            ev.touches = [{ clientX: 5, clientY: 5 }];
            t.dispatchEvent(ev);
            vi.advanceTimersByTime(499);
            expect(document.querySelector('.codeViewerNotesMenu').hidden).toBe(true);
            vi.advanceTimersByTime(1);
            expect(document.querySelector('.codeViewerNotesMenu').hidden).toBe(false);
            // The click that ends the press doesn't also flip the toggle.
            t.click();
            expect(t.getAttribute('aria-pressed')).toBe('false');
        });

        it('closes the menu on Escape, an outside press, or a right-click elsewhere', async () => {
            await open(fileOf(400));
            const menu = document.querySelector('.codeViewerNotesMenu');
            const openMenu = () => toggle().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            openMenu();
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(menu.hidden).toBe(true);
            openMenu();
            document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
            expect(menu.hidden).toBe(true);
            openMenu();
            row(3).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            expect(menu.hidden).toBe(true);
        });

        it('has no menu on a short file', async () => {
            await open();
            const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            toggle().dispatchEvent(ev);
            expect(ev.defaultPrevented).toBe(false);
            expect(document.querySelector('.codeViewerNotesMenu').hidden).toBe(true);
        });

        it('re-lays rail notes when the window grows upward', async () => {
            handler.mockImplementation(() => Promise.resolve({ ok: true, notes: [{ line: 330, note: 'Late.' }] }));
            state.symbols = { files: { 'Customer.cs': { defs: [{ name: 'Tail', kind: 'function', start: 300, end: 400 }], imports: {} } } };
            state.files[FILE] = { content: fileOf(600) };
            renderCodeViewer(host(), { target: TARGET, filePath: FILE, srcRoot: 'src', startLine: 330, endLine: 330 });
            setWidth(pane(), 900);
            await flush();
            toggle().click();
            await flush();
            // The jump window starts at 270, so line 330 is the 61st row.
            expect(noteFor(330).style.gridRow).toBe('61 / span 1');
            document.querySelector('.codeViewerMore--up').click();
            expect(noteFor(330).style.gridRow).toBe('261 / span 1');
        });
    });
});
