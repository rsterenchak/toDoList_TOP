import { vi } from 'vitest';

// bookFlags.js: reader flags on the Understanding book — the record a flag keeps
// (its excerpt and refs captured at flag time), the local copy that works signed
// out, the Supabase insert / resolve update / delete, the merge with
// `book_flags` rows, and the markdown the shelf's Copy produces.

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
    FLAG_KINDS,
    FLAG_EXCERPT_MAX,
    flagExcerpt,
    flagRefs,
    chapterBookSha,
    saveFlag,
    resolveFlag,
    deleteFlag,
    listFlags,
    openFlags,
    openFlagFor,
    mergeFlags,
    loadFlags,
    anchorFlags,
    flagsMarkdown,
} from '../src/bookFlags.js';
import { getBookFlags, setBookFlags } from '../src/prefs.js';
import { supabase } from '../src/supabaseClient.js';

const REPO = 'owner/repo';
const SEGS = [
    { t: 'Rows are built by ' },
    { ref: { label: 'buildToDoRow', file: 'toDoRow.js', symbol: 'buildToDoRow', line: 12, end: 80 } },
    { t: ' and saved through ' },
    { why: { kind: 'cited', segs: [{ ref: { label: 'listLogic.js', file: 'listLogic.js', symbol: null, line: 1 } }, { t: ' always.' }] } },
    { ref: { label: 'buildToDoRow', file: 'toDoRow.js', symbol: 'buildToDoRow', line: 12 } },
];

beforeEach(() => {
    localStorage.clear();
    mocks.session = null;
    mocks.rows = [];
    mocks.inserts = [];
    mocks.updates = [];
    mocks.deletes = [];
    mocks.insertError = null;
    vi.clearAllMocks();
});

describe('record shape', () => {
    test('four kinds in chip order with their badges', () => {
        expect(FLAG_KINDS.map((k) => [k.id, k.label, k.badge])).toEqual([
            ['unclear', 'Unclear', 'UNCLEAR'],
            ['order', 'Out of order', 'ORDER'],
            ['wrong', 'Doesn’t match the code', 'WRONG'],
            ['why', 'Why?', 'WHY'],
        ]);
    });

    test('the excerpt is the paragraph’s first 160 characters, chips flattened', () => {
        expect(flagExcerpt(SEGS)).toBe('Rows are built by buildToDoRow and saved through listLogic.js always.buildToDoRow');
        const long = [{ t: 'x'.repeat(200) }];
        expect(flagExcerpt(long)).toHaveLength(FLAG_EXCERPT_MAX);
    });

    test('refs are captured once each, rationale read through', () => {
        expect(flagRefs(SEGS)).toEqual([
            { label: 'buildToDoRow', file: 'toDoRow.js', symbol: 'buildToDoRow', line: 12 },
            { label: 'listLogic.js', file: 'listLogic.js', symbol: null, line: 1 },
        ]);
    });

    test('the book sha is the chapter’s fingerprint hashes joined, or empty', () => {
        expect(chapterBookSha({ fingerprint: { 'b.js:y': '22.33', 'a.js:x': '00.11' } })).toBe('00.11,22.33');
        expect(chapterBookSha({ id: 'c' })).toBe('');
    });

    test('save writes the full record locally', () => {
        const res = saveFlag(REPO, 'rows', 2, SEGS, { kind: 'wrong', note: '  async now  ', bookSha: 'abc' });
        expect(res.flag).toMatchObject({
            repo: REPO, chapterId: 'rows', paraIndex: 2, kind: 'wrong', note: 'async now', bookSha: 'abc', resolvedAt: null,
            excerpt: flagExcerpt(SEGS), refs: flagRefs(SEGS),
        });
        expect(getBookFlags(REPO)).toEqual([expect.objectContaining({ chapterId: 'rows', paraIndex: 2, kind: 'wrong' })]);
        expect(openFlagFor(REPO, 'rows', 2)).toMatchObject({ note: 'async now' });
    });

    test('an unknown kind falls back to unclear', () => {
        expect(saveFlag(REPO, 'rows', 0, SEGS, { kind: 'nope' }).flag.kind).toBe('unclear');
    });

    test('saving an already-flagged paragraph edits its open flag rather than adding one', () => {
        saveFlag(REPO, 'rows', 1, SEGS, { kind: 'unclear', note: 'a' });
        saveFlag(REPO, 'rows', 1, SEGS, { kind: 'order', note: 'b' });
        expect(listFlags(REPO)).toHaveLength(1);
        expect(openFlagFor(REPO, 'rows', 1)).toMatchObject({ kind: 'order', note: 'b' });
    });
});

describe('signed out', () => {
    test('save, resolve and delete stay local with no Supabase call', async () => {
        const { flag, sync } = saveFlag(REPO, 'rows', 0, SEGS, { kind: 'why' });
        await sync;
        await resolveFlag(REPO, flag);
        expect(openFlags(REPO)).toEqual([]);
        expect(listFlags(REPO)[0].resolvedAt).toEqual(expect.any(String));
        await deleteFlag(REPO, listFlags(REPO)[0]);
        expect(getBookFlags(REPO)).toEqual([]);
        expect(await loadFlags(REPO)).toEqual([]);
        expect(supabase.from).not.toHaveBeenCalled();
    });
});

describe('signed in', () => {
    beforeEach(() => { mocks.session = { user: { id: 'user-1' } }; });

    test('save inserts a book_flags row and marks the record synced', async () => {
        const { flag, sync } = saveFlag(REPO, 'rows', 3, SEGS, { kind: 'order', note: 'n', bookSha: 'sha' });
        await sync;
        expect(supabase.from).toHaveBeenCalledWith('book_flags');
        expect(mocks.inserts).toEqual([{
            user_id: 'user-1', repo: REPO, chapter_id: 'rows', para_index: 3, excerpt: flag.excerpt, refs: flag.refs,
            kind: 'order', note: 'n', book_sha: 'sha', created_at: flag.createdAt, resolved_at: null,
        }]);
        expect(getBookFlags(REPO)[0].synced).toBe(true);
    });

    test('resolve updates resolved_at on the row', async () => {
        const { flag, sync } = saveFlag(REPO, 'rows', 3, SEGS, { kind: 'order' });
        await sync;
        await resolveFlag(REPO, flag);
        expect(mocks.updates).toHaveLength(1);
        expect(mocks.updates[0].values).toEqual({ kind: 'order', note: '', resolved_at: expect.any(String) });
        expect(mocks.updates[0].filters).toEqual({
            user_id: 'user-1', repo: REPO, chapter_id: 'rows', para_index: 3, created_at: flag.createdAt,
        });
        expect(getBookFlags(REPO)[0].dirty).toBeUndefined();
    });

    test('a resolve straight after save rides the single queued insert', async () => {
        const { flag } = saveFlag(REPO, 'rows', 0, SEGS, { kind: 'why' });
        await resolveFlag(REPO, flag);
        expect(mocks.inserts).toHaveLength(1);
        expect(mocks.inserts[0].resolved_at).toEqual(expect.any(String));
        expect(mocks.updates).toHaveLength(0);
        expect(getBookFlags(REPO)[0]).toMatchObject({ synced: true, resolvedAt: expect.any(String) });
    });

    test('delete removes the synced row and the local record', async () => {
        const { flag, sync } = saveFlag(REPO, 'rows', 1, SEGS, {});
        await sync;
        await deleteFlag(REPO, flag);
        expect(mocks.deletes).toHaveLength(1);
        expect(getBookFlags(REPO)).toEqual([]);
    });

    test('a failed insert stays local and is retried on load', async () => {
        mocks.insertError = { message: 'offline' };
        const { sync } = saveFlag(REPO, 'rows', 1, SEGS, {});
        await sync;
        expect(getBookFlags(REPO)[0].synced).toBeUndefined();
        mocks.insertError = null;
        await loadFlags(REPO);
        expect(mocks.inserts).toHaveLength(2);
        expect(getBookFlags(REPO)[0].synced).toBe(true);
    });

    test('load merges remote rows in', async () => {
        mocks.rows = [{
            user_id: 'user-1', repo: REPO, chapter_id: 'data', para_index: 0, excerpt: 'Data one.', refs: [],
            kind: 'wrong', note: 'remote', book_sha: '', created_at: '2026-10-01T00:00:00+00:00', resolved_at: null,
        }];
        const list = await loadFlags(REPO);
        expect(list).toEqual([expect.objectContaining({ chapterId: 'data', kind: 'wrong', note: 'remote', synced: true })]);
    });
});

describe('merge', () => {
    const rec = (over) => Object.assign({
        repo: REPO, chapterId: 'c', paraIndex: 0, excerpt: '', refs: [], kind: 'unclear', note: '',
        bookSha: '', createdAt: '2026-10-01T00:00:00.000Z', resolvedAt: null,
    }, over);

    test('Supabase wins for rows on both sides, matched by instant not string', () => {
        const local = [rec({ note: 'local', synced: true })];
        const remote = [rec({ note: 'remote', createdAt: '2026-10-01T00:00:00+00:00' })];
        const out = mergeFlags(local, remote);
        expect(out.list).toEqual([expect.objectContaining({ note: 'remote', synced: true })]);
        expect(out.insert).toEqual([]);
    });

    test('a local edit Supabase hasn’t seen outranks the row and is retried', () => {
        const local = [rec({ resolvedAt: '2026-10-02T00:00:00.000Z', synced: true, dirty: true })];
        const out = mergeFlags(local, [rec({})]);
        expect(out.list[0].resolvedAt).toBe('2026-10-02T00:00:00.000Z');
        expect(out.update).toHaveLength(1);
    });

    test('local-only rows are retried; synced rows missing remotely are dropped; pending deletes retried', () => {
        const local = [
            rec({ paraIndex: 1 }),
            rec({ paraIndex: 2, synced: true }),
            rec({ paraIndex: 3, synced: true, deleted: true }),
        ];
        const out = mergeFlags(local, [rec({ paraIndex: 3 }), rec({ paraIndex: 4 })]);
        expect(out.insert.map((f) => f.paraIndex)).toEqual([1]);
        expect(out.remove.map((f) => f.paraIndex)).toEqual([3]);
        expect(out.list.map((f) => f.paraIndex).sort()).toEqual([1, 3, 4]);
    });
});

describe('anchoring and markdown export', () => {
    const BOOK = {
        chapters: [
            { id: 'map', kind: 'map', paragraphs: [[{ t: 'm' }]] },
            { id: 'rows', paragraphs: [[{ t: 'a' }], [{ t: 'b' }]] },
            { id: 'data', paragraphs: [[{ t: 'c' }]] },
        ],
    };
    const f = (chapterId, paraIndex, kind, note, refs, extra) => Object.assign({
        repo: REPO, chapterId, paraIndex, excerpt: 'ex ' + chapterId, refs: refs || [], kind, note,
        bookSha: '', createdAt: '', resolvedAt: null,
    }, extra);

    test('groups in book order, paragraphs in order; past-the-end opens at top; gone chapters removed', () => {
        const out = anchorFlags(BOOK, [f('data', 0, 'why', ''), f('rows', 1, 'why', ''), f('rows', 0, 'why', ''), f('rows', 9, 'why', ''), f('gone', 0, 'why', '')]);
        expect(out.groups.map((g) => g.chapter.id)).toEqual(['rows', 'data']);
        expect(out.groups[0].items.map((i) => [i.flag.paraIndex, i.paraIndex, i.inRange])).toEqual([[0, 0, true], [1, 1, true], [9, 0, false]]);
        expect(out.removed.map((x) => x.chapterId)).toEqual(['gone']);
    });

    test('open flags as a markdown list: chapter, paragraph, kind, note (or excerpt), refs', () => {
        const md = flagsMarkdown(BOOK, [
            f('data', 0, 'unclear', 'lost me', [{ label: 'buildToDoRow' }, { label: 'listLogic.js' }]),
            f('rows', 1, 'order', ''),
            f('rows', 0, 'why', 'done', [], { resolvedAt: '2026-10-02T00:00:00.000Z' }),
            f('gone', 2, 'wrong', 'old'),
        ], (i) => i);
        expect(md).toBe(
            '- CH 1 ¶2 · ORDER · "ex rows"\n' +
            '- CH 2 ¶1 · UNCLEAR · "lost me" · refs: buildToDoRow, listLogic.js\n' +
            '- CH ? ¶3 · WRONG · "old"'
        );
    });

    test('chapter numbers default to 1-based', () => {
        expect(flagsMarkdown(BOOK, [f('rows', 0, 'why', 'q')])).toBe('- CH 2 ¶1 · WHY · "q"');
    });
});

describe('local store', () => {
    test('malformed stored records are dropped', () => {
        setBookFlags(REPO, [{ chapterId: '', paraIndex: 0 }, { chapterId: 'c', paraIndex: 'x' }, { chapterId: 'c', paraIndex: 1, kind: 'why' }]);
        expect(getBookFlags(REPO)).toEqual([expect.objectContaining({ chapterId: 'c', paraIndex: 1, kind: 'why', resolvedAt: null })]);
    });
});
