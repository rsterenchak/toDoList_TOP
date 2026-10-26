import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Line selection in the code viewer (codeViewer.js): the gutter numbers are
// buttons — click selects a line, shift-click / Shift+Enter extends, a drag down
// the gutter extends live, a 500ms long-press on a touch starts a selection the
// finger then drags — and a bar with the span, Copy and Ask floats in the range's
// last row. Escape, a new open and a close all drop it. The bar's Note pins a
// reader note (bookNotes.js) to the range, shown as a row beneath its last line.

const { state } = vi.hoisted(() => ({
    state: { files: {}, toasts: [] },
}));

vi.mock('../src/inject.js', () => ({
    readRepoFile: vi.fn(function (target, filePath) {
        const canned = state.files[filePath];
        return Promise.resolve({ ok: true, content: (canned && canned.content) || '', sha: 'sha-1' });
    }),
    showInjectToast: vi.fn(function (message) { state.toasts.push(message); }),
}));

vi.mock('../src/supabaseClient.js', () => ({
    supabase: { auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: null } })) }, from: vi.fn() },
}));

import {
    renderCodeViewer,
    clearCodeViewer,
    resetCodeViewer,
    setCodeViewerAskHandler,
    getCodeViewerSelection,
} from '../src/codeViewer.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

const TARGET = { repo: 'owner/app' };

function fileOf(n) {
    const out = [];
    for (let i = 1; i <= n; i++) out.push('line ' + i);
    return out.join('\n');
}

const host = () => document.getElementById('col');
const row = (n) => document.querySelector('.codeViewerLine[data-line="' + n + '"]');
const gutter = (n) => row(n).querySelector('.codeViewerGutter');
const bar = () => document.querySelector('.codeViewerSelectBar');
// The bar is detached from the listing while nothing is selected.
const barShown = () => !!bar() && !bar().hidden;
const selectedLines = () => Array.from(document.querySelectorAll('.codeViewerLine--selected'))
    .map((el) => Number(el.dataset.line));

function click(el, opts) {
    el.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true, cancelable: true }, opts || {})));
}

function pointer(type, el, opts) {
    const ev = new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true }, opts || {}));
    el.dispatchEvent(ev);
    return ev;
}

function touch(type, el, x, y) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    const t = { clientX: x, clientY: y, target: el };
    ev.touches = type === 'touchend' ? [] : [t];
    el.dispatchEvent(ev);
    return ev;
}

async function open(n) {
    state.files['src/Program.cs'] = { content: fileOf(n || 60) };
    renderCodeViewer(host(), { target: TARGET, filePath: 'src/Program.cs', srcRoot: 'src' });
    await flush();
}

describe('codeViewer — line selection', () => {
    beforeEach(() => {
        resetCodeViewer();
        state.files = {};
        state.toasts = [];
        document.body.innerHTML = '<div id="col"></div>';
    });

    afterEach(() => {
        vi.useRealTimers();
        document.elementFromPoint = undefined;
    });

    it('renders the gutter numbers as unpressed buttons', async () => {
        await open();
        const g = gutter(29);
        expect(g.tagName).toBe('BUTTON');
        expect(g.textContent).toBe('29');
        expect(g.getAttribute('aria-pressed')).toBe('false');
        expect(barShown()).toBe(false);
    });

    it('a click selects one line; a shift-click extends to the range', async () => {
        await open();
        click(gutter(29));
        expect(getCodeViewerSelection(host())).toEqual({ start: 29, end: 29 });
        expect(selectedLines()).toEqual([29]);

        click(gutter(31), { shiftKey: true });
        expect(getCodeViewerSelection(host())).toEqual({ start: 29, end: 31 });
        expect(selectedLines()).toEqual([29, 30, 31]);
        expect(gutter(30).getAttribute('aria-pressed')).toBe('true');
        expect(gutter(32).getAttribute('aria-pressed')).toBe('false');

        // Extending above the anchor keeps the range ordered.
        click(gutter(27), { shiftKey: true });
        expect(getCodeViewerSelection(host())).toEqual({ start: 27, end: 29 });

        // A plain click starts over.
        click(gutter(40));
        expect(getCodeViewerSelection(host())).toEqual({ start: 40, end: 40 });
    });

    it('keeps the selected band separate from the jump highlight', async () => {
        state.files['src/Program.cs'] = { content: fileOf(60) };
        renderCodeViewer(host(), { target: TARGET, filePath: 'src/Program.cs', startLine: 30, endLine: 30 });
        await flush();
        click(gutter(30));
        expect(row(30).classList.contains('codeViewerLine--hit')).toBe(true);
        expect(row(30).classList.contains('codeViewerLine--selected')).toBe(true);
    });

    it('shows the bar with the span in the range\'s last row, and hides it when cleared', async () => {
        await open();
        click(gutter(29));
        expect(barShown()).toBe(true);
        expect(bar().querySelector('.codeViewerSelectSpan').textContent).toBe('L29');
        expect(row(29).contains(bar())).toBe(true);

        click(gutter(31), { shiftKey: true });
        expect(bar().querySelector('.codeViewerSelectSpan').textContent).toBe('L29–L31');
        expect(row(31).contains(bar())).toBe(true);
        expect(row(29).contains(bar())).toBe(false);

        const ask = bar().querySelector('.codeViewerSelectAsk');
        const copy = bar().querySelector('.codeViewerSelectCopy');
        expect(ask.tagName).toBe('BUTTON');
        expect(copy.tagName).toBe('BUTTON');
        expect(ask.getAttribute('aria-label')).toMatch(/Ask/);

        clearCodeViewer(host());
        expect(getCodeViewerSelection(host())).toBe(null);
        expect(barShown()).toBe(false);
    });

    it('Escape clears the selection', async () => {
        await open();
        click(gutter(29));
        click(gutter(31), { shiftKey: true });
        const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        document.body.dispatchEvent(ev);
        expect(getCodeViewerSelection(host())).toBe(null);
        expect(selectedLines()).toEqual([]);
        expect(barShown()).toBe(false);
        expect(ev.defaultPrevented).toBe(true);

        // With nothing selected, Escape passes through untouched.
        const again = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        document.body.dispatchEvent(again);
        expect(again.defaultPrevented).toBe(false);
    });

    it('opening a file (or the same file again) drops the selection', async () => {
        await open();
        click(gutter(29));
        state.files['src/Other.cs'] = { content: fileOf(10) };
        renderCodeViewer(host(), { target: TARGET, filePath: 'src/Other.cs' });
        await flush();
        expect(getCodeViewerSelection(host())).toBe(null);
        expect(selectedLines()).toEqual([]);
        expect(barShown()).toBe(false);
    });

    it('selects and extends by keyboard: Enter, then Shift+Enter', async () => {
        await open();
        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        gutter(12).dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(true);
        expect(getCodeViewerSelection(host())).toEqual({ start: 12, end: 12 });
        gutter(14).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
        expect(getCodeViewerSelection(host())).toEqual({ start: 12, end: 14 });
    });

    it('a drag down the gutter extends the selection live, and its trailing click does not reset it', async () => {
        await open();
        pointer('pointerdown', gutter(29));
        pointer('pointermove', gutter(30));
        expect(getCodeViewerSelection(host())).toEqual({ start: 29, end: 30 });
        pointer('pointermove', row(31).querySelector('.codeViewerCode'));
        expect(getCodeViewerSelection(host())).toEqual({ start: 29, end: 31 });
        window.dispatchEvent(new MouseEvent('pointerup'));
        click(gutter(31));
        expect(getCodeViewerSelection(host())).toEqual({ start: 29, end: 31 });

        // After the drag has ended, moving the pointer changes nothing.
        pointer('pointermove', gutter(40));
        expect(getCodeViewerSelection(host())).toEqual({ start: 29, end: 31 });
    });

    it('a long-press on a touch starts a selection that a drag extends', async () => {
        await open();
        vi.useFakeTimers();
        const code = row(29).querySelector('.codeViewerCode');
        touch('touchstart', code, 100, 100);
        vi.advanceTimersByTime(499);
        expect(getCodeViewerSelection(host())).toBe(null);
        vi.advanceTimersByTime(1);
        expect(getCodeViewerSelection(host())).toEqual({ start: 29, end: 29 });

        document.elementFromPoint = () => row(32).querySelector('.codeViewerCode');
        const move = touch('touchmove', code, 100, 160);
        expect(move.defaultPrevented).toBe(true);
        expect(getCodeViewerSelection(host())).toEqual({ start: 29, end: 32 });
        const end = touch('touchend', code, 100, 160);
        expect(end.defaultPrevented).toBe(true);
        expect(getCodeViewerSelection(host())).toEqual({ start: 29, end: 32 });
    });

    it('a touch that moves before the long-press fires is a scroll, not a selection', async () => {
        await open();
        vi.useFakeTimers();
        const code = row(29).querySelector('.codeViewerCode');
        touch('touchstart', code, 100, 100);
        const move = touch('touchmove', code, 100, 140);
        expect(move.defaultPrevented).toBe(false);
        vi.advanceTimersByTime(600);
        expect(getCodeViewerSelection(host())).toBe(null);
    });

    it('Copy copies the raw selected lines and confirms with the toast', async () => {
        await open();
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        click(gutter(29));
        click(gutter(31), { shiftKey: true });
        bar().querySelector('.codeViewerSelectCopy').click();
        await flush();
        expect(writeText).toHaveBeenCalledWith('line 29\nline 30\nline 31');
        expect(state.toasts).toEqual(['Copied']);
        delete navigator.clipboard;
    });

    it('Ask hands the range and its lines to the registered handler; disabled with none', async () => {
        await open();
        click(gutter(29));
        const ask = bar().querySelector('.codeViewerSelectAsk');
        expect(ask.disabled).toBe(true);

        const handler = vi.fn();
        setCodeViewerAskHandler(handler);
        expect(ask.disabled).toBe(false);
        click(gutter(31), { shiftKey: true });
        ask.click();
        expect(handler).toHaveBeenCalledWith({
            repo: 'owner/app',
            filePath: 'src/Program.cs',
            srcRoot: 'src',
            start: 29,
            end: 31,
            text: ['line 29', 'line 30', 'line 31'],
        });
    });

    describe('reader notes', () => {
        const notes = () => JSON.parse(localStorage.getItem('todoapp_bookNotes') || '{}')['owner/app'] || [];
        const sheet = () => document.getElementById('bookNoteSheet');
        const userNotes = () => Array.from(document.querySelectorAll('.codeViewerLines > .codeViewerNote--user'));

        beforeEach(() => { localStorage.clear(); });

        it('the bar’s Note, between Copy and Ask, saves a line-range note and its row renders beneath the last line', async () => {
            await open();
            click(gutter(29));
            click(gutter(31), { shiftKey: true });
            const note = bar().querySelector('.codeViewerSelectNote');
            expect(note.textContent).toBe('Note');
            expect(note.previousElementSibling.classList.contains('codeViewerSelectCopy')).toBe(true);
            expect(note.nextElementSibling.classList.contains('codeViewerSelectAsk')).toBe(true);
            note.click();
            expect(sheet().hidden).toBe(false);
            expect(sheet().querySelector('.understandingMarksTitle').textContent).toBe('NOTE · Program.cs:29–31');
            expect(sheet().querySelector('.understandingFlagExcerpt').textContent).toBe('line 29 line 30 line 31');
            const field = sheet().querySelector('textarea.bookNoteField');
            field.value = 'Three lines that matter';
            field.dispatchEvent(new Event('input'));
            sheet().querySelector('.understandingFlagAction.is-save').click();

            expect(notes()).toEqual([expect.objectContaining({
                filePath: 'src/Program.cs', lineStart: 29, lineEnd: 31, chapterId: null,
                body: 'Three lines that matter', source: 'user', excerpt: 'line 29 line 30 line 31',
            })]);
            expect(getCodeViewerSelection(host())).toBeNull();
            const rows = userNotes();
            expect(rows).toHaveLength(1);
            expect(rows[0].previousElementSibling).toBe(row(31));
            expect(rows[0].textContent).toBe('Three lines that matter');
            // Numbering is untouched: the next row is still line 32.
            expect(rows[0].nextElementSibling).toBe(row(32));
        });

        it('a stored note shows when its file opens, re-attaches as the window grows, and its pencil opens the edit sheet', async () => {
            localStorage.setItem('todoapp_bookNotes', JSON.stringify({ 'owner/app': [
                { filePath: 'src/Program.cs', lineStart: 10, lineEnd: 12, body: 'Early', createdAt: '2026-10-01T00:00:00.000Z' },
                { filePath: 'src/Program.cs', lineStart: 400, lineEnd: 401, body: 'Late', createdAt: '2026-10-02T00:00:00.000Z' },
                { filePath: 'src/Other.cs', lineStart: 1, lineEnd: 1, body: 'Elsewhere', createdAt: '2026-10-03T00:00:00.000Z' },
            ] }));
            await open(600);
            expect(userNotes().map((el) => el.textContent)).toEqual(['Early']);
            expect(userNotes()[0].previousElementSibling).toBe(row(12));
            document.querySelector('.codeViewerMore--down').click();
            expect(userNotes().map((el) => el.textContent)).toEqual(['Early', 'Late']);
            expect(userNotes()[1].previousElementSibling).toBe(row(401));

            userNotes()[0].querySelector('.codeViewerUserNoteEdit').click();
            expect(sheet().hidden).toBe(false);
            const field = sheet().querySelector('textarea.bookNoteField');
            expect(field.value).toBe('Early');
            field.value = 'Edited';
            field.dispatchEvent(new Event('input'));
            sheet().querySelector('.understandingFlagAction.is-save').click();
            expect(userNotes()[0].textContent).toBe('Edited');

            userNotes()[0].querySelector('.codeViewerUserNoteEdit').click();
            sheet().querySelector('.understandingFlagAction.is-delete').click();
            sheet().querySelector('.bookNoteConfirm .is-confirm').click();
            expect(userNotes().map((el) => el.textContent)).toEqual(['Late']);
        });

        const LONG = 'Kept answer: the reader walks every line of the listing and pins the note beneath the last one.\nSecond line.';

        it('a note renders collapsed to one line, expands on a tap without opening the sheet, and stays open across a re-attach', async () => {
            localStorage.setItem('todoapp_bookNotes', JSON.stringify({ 'owner/app': [
                { filePath: 'src/Program.cs', lineStart: 10, lineEnd: 12, body: LONG, source: 'answer', createdAt: '2026-10-01T00:00:00.000Z' },
            ] }));
            await open(600);
            const text = () => userNotes()[0].querySelector('.codeViewerUserNoteText');
            expect(userNotes()[0].classList.contains('is-answer')).toBe(true);
            expect(text().getAttribute('aria-expanded')).toBe('false');
            expect(text().textContent).toBe(LONG.slice(0, 80).trimEnd() + '…');
            expect(text().textContent.length).toBeLessThanOrEqual(81);

            text().click();
            expect(text().getAttribute('aria-expanded')).toBe('true');
            expect(text().textContent).toBe(LONG);
            expect(userNotes()[0].classList.contains('is-open')).toBe(true);
            expect(sheet() && !sheet().hidden).toBeFalsy();

            // Loading more re-lays every row; the open one stays open.
            document.querySelector('.codeViewerMore--down').click();
            expect(text().getAttribute('aria-expanded')).toBe('true');
            expect(text().textContent).toBe(LONG);

            text().click();
            expect(text().getAttribute('aria-expanded')).toBe('false');
            expect(text().textContent.endsWith('…')).toBe(true);
        });

        it('a short one-line note shows whole and a multi-line one is cut at its first break', async () => {
            localStorage.setItem('todoapp_bookNotes', JSON.stringify({ 'owner/app': [
                { filePath: 'src/Program.cs', lineStart: 5, lineEnd: 5, body: 'Short', createdAt: '2026-10-01T00:00:00.000Z' },
                { filePath: 'src/Program.cs', lineStart: 8, lineEnd: 8, body: 'First\nsecond', createdAt: '2026-10-02T00:00:00.000Z' },
            ] }));
            await open();
            expect(userNotes().map((el) => el.querySelector('.codeViewerUserNoteText').textContent)).toEqual(['Short', 'First…']);
        });

        it('the Marks toggle, left of Notes, unmounts every note row when off and is remembered per repo', async () => {
            localStorage.setItem('todoapp_bookNotes', JSON.stringify({ 'owner/app': [
                { filePath: 'src/Program.cs', lineStart: 10, lineEnd: 12, body: 'Early', createdAt: '2026-10-01T00:00:00.000Z' },
            ] }));
            await open();
            const marks = document.querySelector('.codeViewerMarks');
            expect(marks.textContent).toBe('Marks');
            expect(marks.nextElementSibling.classList.contains('codeViewerNotesWrap')).toBe(true);
            expect(marks.disabled).toBe(false);
            expect(marks.getAttribute('aria-pressed')).toBe('true');
            expect(userNotes()).toHaveLength(1);
            expect(document.querySelector('.codeViewerLines').classList.contains('codeViewerLines--userNotes')).toBe(true);

            marks.click();
            expect(marks.getAttribute('aria-pressed')).toBe('false');
            expect(userNotes()).toHaveLength(0);
            expect(document.querySelector('.codeViewerLines').classList.contains('codeViewerLines--userNotes')).toBe(false);
            expect(JSON.parse(localStorage.getItem('todoapp_codeMarksOn'))).toEqual({ 'owner/app': false });

            // A fresh open of the repo's files reads it back.
            resetCodeViewer();
            document.body.innerHTML = '<div id="col"></div>';
            await open();
            expect(document.querySelector('.codeViewerMarks').getAttribute('aria-pressed')).toBe('false');
            expect(userNotes()).toHaveLength(0);
            document.querySelector('.codeViewerMarks').click();
            expect(userNotes()).toHaveLength(1);
            expect(JSON.parse(localStorage.getItem('todoapp_codeMarksOn'))).toEqual({});
        });
    });
});
