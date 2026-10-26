import { vi } from 'vitest';

// bookNotes.js: reader notes on the Understanding book — the record a note keeps
// for both anchor kinds (a chapter paragraph, a line range), its excerpt and refs
// captured at save time, the local copy that works signed out, the Supabase
// insert / update / delete, the merge with `book_notes` rows, the shelf grouping
// and the markdown the shelf's Copy produces.

const mocks = vi.hoisted(() => ({ session: null, rows: [], inserts: [], updates: [], deletes: [], insertError: null }));

vi.mock('../src/supabaseClient.js', () => {
    function chain(log, payload) {
        const filters = {};
        const c = {
            eq: vi.fn((col, val) => { filters[col] = val; return c; }),
            then: (resolve) => { log.push(payload ? { values: payload, filters } : filters); resolve({ error: null }); },
        };
        return c;
    }
    return {
        supabase: {
            auth: { getSession: vi.fn(() => Promise.resolve({ data: { session: mocks.session } })) },
            from: vi.fn(() => ({
                insert: vi.fn((row) => { mocks.inserts.push(row); return Promise.resolve({ error: mocks.insertError }); }),
                update: vi.fn((values) => chain(mocks.updates, values)),
                delete: vi.fn(() => chain(mocks.deletes)),
                select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: mocks.rows, error: null })) })),
            })),
        },
    };
});

import {
    BOOK_NOTES_EVENT,
    saveNote,
    updateNote,
    deleteNote,
    listNotes,
    notesForParagraph,
    notesForFile,
    mergeNotes,
    loadNotes,
    groupNotes,
    notesMarkdown,
    linesExcerpt,
    openNoteSheet,
} from '../src/bookNotes.js';
import { getBookNotes, setBookNotes } from '../src/prefs.js';
import { supabase } from '../src/supabaseClient.js';

const REPO = 'owner/repo';
const SEGS = [
    { t: 'Rows are built by ' },
    { ref: { label: 'buildToDoRow', file: 'toDoRow.js', symbol: 'buildToDoRow', line: 12, end: 80 } },
    { t: ' and saved through ' },
    { ref: { label: 'listLogic.js', file: 'listLogic.js', symbol: null, line: 1 } },
    { t: '.' },
];
const PARA = { chapterId: 'rows', paraIndex: 2, segments: SEGS };
const LINES = { filePath: 'toDoList_main/src/toDo.js', lineStart: 12, lineEnd: 14, lines: ['  const a = 1;', '  const b = 2;', '  return a + b;'] };

beforeEach(() => {
    localStorage.clear();
    mocks.session = null;
    mocks.rows = [];
    mocks.inserts = [];
    mocks.updates = [];
    mocks.deletes = [];
    mocks.insertError = null;
    vi.clearAllMocks();
    document.body.innerHTML = '';
});

describe('record shape', () => {
    test('a paragraph note captures the excerpt and refs and leaves the line fields null', () => {
        const { note } = saveNote(REPO, PARA, { body: '  Rows go through listLogic.  ', bookSha: 'abc' });
        expect(note).toEqual({
            repo: REPO,
            chapterId: 'rows',
            paraIndex: 2,
            filePath: null,
            lineStart: null,
            lineEnd: null,
            body: 'Rows go through listLogic.',
            source: 'user',
            excerpt: 'Rows are built by buildToDoRow and saved through listLogic.js.',
            refs: [
                { label: 'buildToDoRow', file: 'toDoRow.js', symbol: 'buildToDoRow', line: 12 },
                { label: 'listLogic.js', file: 'listLogic.js', symbol: null, line: 1 },
            ],
            bookSha: 'abc',
            createdAt: expect.any(String),
            updatedAt: note.createdAt,
        });
    });

    test('a line-range note captures the selected lines as its excerpt and leaves the paragraph fields null', () => {
        const { note } = saveNote(REPO, Object.assign({ refs: [{ label: 'sum', file: 'src/toDo.js', symbol: 'sum', line: 10 }] }, LINES), { body: 'Adds them', source: 'answer' });
        expect(note).toMatchObject({
            chapterId: null,
            paraIndex: null,
            filePath: 'toDoList_main/src/toDo.js',
            lineStart: 12,
            lineEnd: 14,
            body: 'Adds them',
            source: 'answer',
            excerpt: 'const a = 1; const b = 2; return a + b;',
            refs: [{ label: 'sum', file: 'src/toDo.js', symbol: 'sum', line: 10 }],
        });
    });

    test('an explicit excerpt wins, capped at 160 characters', () => {
        const { note } = saveNote(REPO, { chapterId: 'rows', paraIndex: 0, excerpt: 'x'.repeat(300) }, { body: 'b' });
        expect(note.excerpt).toHaveLength(160);
        expect(linesExcerpt(['a', '  b  '])).toBe('a b');
    });

    test('an empty body, a missing anchor or a reversed range saves nothing', () => {
        expect(saveNote(REPO, PARA, { body: '   ' }).note).toBeNull();
        expect(saveNote(REPO, {}, { body: 'x' }).note).toBeNull();
        expect(saveNote(REPO, { filePath: 'a.js', lineStart: 5, lineEnd: 3 }, { body: 'x' }).note).toBeNull();
        expect(getBookNotes(REPO)).toEqual([]);
    });

    test('two notes saved at once get distinct keys', () => {
        const a = saveNote(REPO, PARA, { body: 'one' }).note;
        const b = saveNote(REPO, PARA, { body: 'two' }).note;
        expect(a.createdAt).not.toBe(b.createdAt);
        expect(notesForParagraph(REPO, 'rows', 2).map((n) => n.body)).toEqual(['one', 'two']);
    });
});

describe('local write, edit and delete', () => {
    test('signed out: written to todoapp_bookNotes with no Supabase call', async () => {
        const res = saveNote(REPO, PARA, { body: 'local' });
        await res.sync;
        const stored = JSON.parse(localStorage.getItem('todoapp_bookNotes'))[REPO];
        expect(stored).toHaveLength(1);
        expect(stored[0].body).toBe('local');
        expect(supabase.from).not.toHaveBeenCalled();
        expect(listNotes(REPO)).toHaveLength(1);
    });

    test('notesForFile lists a file’s line notes in line order and nothing else', () => {
        saveNote(REPO, { filePath: 'a.js', lineStart: 20, lineEnd: 22 }, { body: 'later' });
        saveNote(REPO, { filePath: 'a.js', lineStart: 3, lineEnd: 3 }, { body: 'first' });
        saveNote(REPO, { filePath: 'b.js', lineStart: 1, lineEnd: 1 }, { body: 'other file' });
        saveNote(REPO, PARA, { body: 'paragraph' });
        expect(notesForFile(REPO, 'a.js').map((n) => n.body)).toEqual(['first', 'later']);
    });

    test('a save, edit and delete each announce the repo', () => {
        const heard = [];
        const on = (e) => heard.push(e.detail.repo);
        document.addEventListener(BOOK_NOTES_EVENT, on);
        const { note } = saveNote(REPO, PARA, { body: 'a' });
        updateNote(REPO, note, 'b');
        deleteNote(REPO, note);
        document.removeEventListener(BOOK_NOTES_EVENT, on);
        expect(heard).toEqual([REPO, REPO, REPO]);
    });

    test('signed in: the insert carries every column, an edit updates body and updated_at, a delete matches the row', async () => {
        mocks.session = { user: { id: 'u1' } };
        const { note, sync } = saveNote(REPO, LINES, { body: 'first' });
        await sync;
        expect(mocks.inserts).toEqual([{
            user_id: 'u1', repo: REPO, chapter_id: null, para_index: null,
            file_path: 'toDoList_main/src/toDo.js', line_start: 12, line_end: 14,
            body: 'first', source: 'user', excerpt: 'const a = 1; const b = 2; return a + b;', refs: [],
            book_sha: '', created_at: note.createdAt, updated_at: note.createdAt,
        }]);
        expect(getBookNotes(REPO)[0].synced).toBe(true);

        const edit = updateNote(REPO, note, 'second');
        expect(getBookNotes(REPO)[0]).toMatchObject({ body: 'second', dirty: true });
        await edit.sync;
        expect(mocks.updates).toEqual([{
            values: { body: 'second', updated_at: edit.note.updatedAt },
            filters: { user_id: 'u1', repo: REPO, created_at: note.createdAt },
        }]);
        expect(getBookNotes(REPO)[0].dirty).toBeUndefined();

        await deleteNote(REPO, note);
        expect(mocks.deletes).toEqual([{ user_id: 'u1', repo: REPO, created_at: note.createdAt }]);
        expect(getBookNotes(REPO)).toEqual([]);
    });

    test('an unchanged or empty edit writes nothing', () => {
        const { note } = saveNote(REPO, PARA, { body: 'same' });
        const before = getBookNotes(REPO)[0].updatedAt;
        expect(updateNote(REPO, note, 'same').note.body).toBe('same');
        expect(updateNote(REPO, note, '  ').note).toBeNull();
        expect(getBookNotes(REPO)[0].updatedAt).toBe(before);
        expect(getBookNotes(REPO)[0].body).toBe('same');
    });

    test('a failed insert leaves the note local and unsynced, to retry', async () => {
        mocks.session = { user: { id: 'u1' } };
        mocks.insertError = { message: 'offline' };
        await saveNote(REPO, PARA, { body: 'x' }).sync;
        expect(getBookNotes(REPO)[0].synced).toBeUndefined();
    });
});

describe('merge', () => {
    const rec = (createdAt, extra) => Object.assign({
        repo: REPO, chapterId: 'rows', paraIndex: 0, filePath: null, lineStart: null, lineEnd: null,
        body: 'b', source: 'user', excerpt: '', refs: [], bookSha: '', createdAt, updatedAt: createdAt,
    }, extra);

    test('Supabase wins for rows on both sides; local-only rows are retried; synced rows gone remotely drop', () => {
        const local = [
            rec('2026-10-01T00:00:00.000Z', { body: 'local', synced: true }),
            rec('2026-10-02T00:00:00.000Z', { body: 'never synced' }),
            rec('2026-10-03T00:00:00.000Z', { synced: true }),
        ];
        const remote = [
            rec('2026-10-01T00:00:00+00:00', { body: 'remote', synced: true }),
            rec('2026-10-04T00:00:00.000Z', { body: 'other device', synced: true }),
        ];
        const m = mergeNotes(local, remote);
        expect(m.list.map((n) => n.body)).toEqual(['remote', 'never synced', 'other device']);
        expect(m.insert.map((n) => n.body)).toEqual(['never synced']);
        expect(m.update).toEqual([]);
        expect(m.remove).toEqual([]);
    });

    test('an unsynced edit outranks the row; an unsynced delete is retried', () => {
        const local = [
            rec('2026-10-01T00:00:00.000Z', { body: 'edited', synced: true, dirty: true }),
            rec('2026-10-02T00:00:00.000Z', { synced: true, deleted: true }),
        ];
        const remote = [rec('2026-10-01T00:00:00.000Z', { body: 'old' }), rec('2026-10-02T00:00:00.000Z')];
        const m = mergeNotes(local, remote);
        expect(m.list[0].body).toBe('edited');
        expect(m.update).toHaveLength(1);
        expect(m.remove).toHaveLength(1);
    });

    test('loadNotes merges the repo’s rows into the local copy, both anchor kinds', async () => {
        mocks.session = { user: { id: 'u1' } };
        mocks.rows = [
            { user_id: 'u1', repo: REPO, chapter_id: 'rows', para_index: 1, file_path: null, line_start: null, line_end: null,
                body: 'para', source: 'user', excerpt: 'e', refs: [], book_sha: '', created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' },
            { user_id: 'u1', repo: REPO, chapter_id: null, para_index: null, file_path: 'src/a.js', line_start: 4, line_end: 6,
                body: 'code', source: 'answer', excerpt: 'x', refs: [], book_sha: '', created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-03T00:00:00.000Z' },
            { user_id: 'u1', repo: REPO, chapter_id: null, para_index: null, file_path: null, created_at: '2026-10-05T00:00:00.000Z' },
        ];
        const list = await loadNotes(REPO);
        expect(list.map((n) => [n.body, n.chapterId, n.filePath, n.lineStart, n.lineEnd, n.source])).toEqual([
            ['para', 'rows', null, null, null, 'user'],
            ['code', null, 'src/a.js', 4, 6, 'answer'],
        ]);
        expect(getBookNotes(REPO).every((n) => n.synced)).toBe(true);
    });

    test('signed out, loadNotes is the local list', async () => {
        saveNote(REPO, PARA, { body: 'mine' });
        expect((await loadNotes(REPO)).map((n) => n.body)).toEqual(['mine']);
        expect(supabase.from).not.toHaveBeenCalled();
    });
});

describe('grouping and markdown', () => {
    const BOOK = {
        chapters: [
            { id: 'start', title: 'Start', files: ['index.js'], paragraphs: [[{ t: 'a' }], [{ t: 'b' }]] },
            { id: 'rows', title: 'Rows', files: ['toDo.js', 'listLogic.js'], paragraphs: [[{ t: 'a' }], [{ t: 'b' }], [{ t: 'c' }]] },
        ],
    };

    function seed() {
        setBookNotes(REPO, [
            { chapterId: 'rows', paraIndex: 1, body: 'Rows note', refs: [{ label: 'buildToDoRow' }], createdAt: '2026-10-01T00:00:00.000Z' },
            { filePath: 'toDoList_main/src/toDo.js', lineStart: 12, lineEnd: 14, body: 'Code note\nsecond line', createdAt: '2026-10-02T00:00:00.000Z' },
            { filePath: 'scripts/build.js', lineStart: 3, lineEnd: 3, body: 'Uncovered', createdAt: '2026-10-03T00:00:00.000Z' },
            { chapterId: 'start', paraIndex: 0, body: 'Start note', createdAt: '2026-10-04T00:00:00.000Z' },
            { chapterId: 'gone', paraIndex: 0, body: 'Orphan', createdAt: '2026-10-05T00:00:00.000Z' },
        ]);
    }

    test('a code-anchored note groups under the chapter whose files include its file; others under CODE', () => {
        seed();
        const g = groupNotes(BOOK, listNotes(REPO));
        expect(g.groups.map((x) => [x.index, x.items.map((i) => i.note.body)])).toEqual([
            [0, ['Start note']],
            [1, ['Rows note', 'Code note\nsecond line']],
        ]);
        expect(g.code.map((i) => i.note.body)).toEqual(['Uncovered']);
        expect(g.removed.map((n) => n.body)).toEqual(['Orphan']);
    });

    test('markdown lists every note in shelf order', () => {
        seed();
        expect(notesMarkdown(BOOK, listNotes(REPO))).toBe(
            '- CH 1 ¶1 · "Start note"\n' +
            '- CH 2 ¶2 · "Rows note" · refs: buildToDoRow\n' +
            '- toDo.js:12–14 · "Code note second line"\n' +
            '- build.js:3 · "Uncovered"\n' +
            '- CH ? ¶1 · "Orphan"'
        );
    });
});

describe('note sheet', () => {
    const sheet = () => document.getElementById('bookNoteSheet');

    test('a new note: 16px-safe textarea, Save disabled while empty, Save hands over the text and closes', () => {
        const onSave = vi.fn();
        openNoteSheet({ title: 'NOTE · CH 1 ¶2', excerpt: 'The paragraph.', body: '', onSave });
        expect(sheet().hidden).toBe(false);
        expect(sheet().querySelector('.understandingMarksTitle').textContent).toBe('NOTE · CH 1 ¶2');
        expect(sheet().querySelector('.understandingFlagExcerpt').textContent).toBe('The paragraph.');
        const field = sheet().querySelector('textarea.bookNoteField');
        const save = sheet().querySelector('.understandingFlagAction.is-save');
        expect(Array.from(sheet().querySelectorAll('.understandingFlagActions:not(.bookNoteConfirm) > .understandingFlagAction')).map((a) => a.textContent)).toEqual(['Cancel', 'Save']);
        expect(save.disabled).toBe(true);
        field.value = '  Worked it out  ';
        field.dispatchEvent(new Event('input'));
        expect(save.disabled).toBe(false);
        save.click();
        expect(onSave).toHaveBeenCalledWith('Worked it out');
        expect(sheet().hidden).toBe(true);
    });

    test('editing: Delete asks in place, stating what is lost, before deleting', () => {
        const onDelete = vi.fn();
        openNoteSheet({ title: 'NOTE', body: 'old', onSave: vi.fn(), onDelete });
        sheet().querySelector('.understandingFlagAction.is-delete').click();
        expect(onDelete).not.toHaveBeenCalled();
        const confirm = sheet().querySelector('.bookNoteConfirm');
        expect(confirm.hidden).toBe(false);
        expect(confirm.textContent).toContain('Delete this note? Its text will be lost.');
        confirm.querySelector('.is-cancel').click();
        expect(confirm.hidden).toBe(true);
        sheet().querySelector('.understandingFlagAction.is-delete').click();
        confirm.querySelector('.is-confirm').click();
        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(sheet().hidden).toBe(true);
    });

    test('closes on ✕, the backdrop and Escape', () => {
        openNoteSheet({ title: 'NOTE', body: 'x', onSave: vi.fn() });
        sheet().querySelector('.understandingMarksClose').click();
        expect(sheet().hidden).toBe(true);
        openNoteSheet({ title: 'NOTE', body: 'x', onSave: vi.fn() });
        sheet().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(sheet().hidden).toBe(true);
        openNoteSheet({ title: 'NOTE', body: 'x', onSave: vi.fn() });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(sheet().hidden).toBe(true);
    });
});
