// Reader notes on a repo's code book — a short text in the reader's own words,
// pinned to a chapter paragraph or to a line range in the code viewer, so what
// a reader cleared up is still there when they come back. Kept locally so they
// render instantly and work signed out, and mirrored to Supabase's `book_notes`
// so the shelf lists the same notes on any device. Also owns the note sheet the
// reader, the code viewer and the chat's Keep all open.
//
// A record is `{ repo, chapterId, paraIndex, filePath, lineStart, lineEnd, body,
// source, excerpt, refs, bookSha, createdAt, updatedAt }`: a paragraph note sets
// `chapterId`/`paraIndex` and leaves the line fields null, a line-range note the
// other way round. `source` is 'user' for one written by hand and 'answer' for
// one kept from a chat reply. The anchor's opening text (`excerpt`) and the names
// it relies on (`refs`) are captured at save time, so a note stays readable
// after the book is regenerated or the file changes. Records are keyed by
// `createdAt`. The local copy (prefs.js) carries the same sync flags as flags:
// `synced`, `dirty` for an edit Supabase hasn't seen, `deleted` for a delete it
// hasn't seen. On shelf render the repo's rows are fetched and merged as
// bookmarks are: Supabase wins for rows on both sides (unless the local row has
// an unsynced edit), a local row never synced is retried, and a synced row
// missing remotely is dropped. Every Supabase call is wrapped — a sync miss
// must never block the reader.

import { supabase } from './supabaseClient.js';
import { getBookNotes, setBookNotes } from './prefs.js';
import { flagExcerpt, flagRefs } from './bookFlags.js';
import { createCodeSheet } from './codeSheet.js';

const TABLE = 'book_notes';
// Fired on `document` (detail `{ repo }`) after a note is saved, edited or
// deleted here, so every surface showing the repo's notes repaints them.
export const BOOK_NOTES_EVENT = 'bookNotesChanged';
// How much of the anchor's text a note keeps, and how long a note may run.
export const NOTE_EXCERPT_MAX = 160;
export const NOTE_BODY_MAX = 2000;
// How much of a note shows while it is collapsed to one line, and the length
// past which the sheet's counter (Keep's) turns amber — longer is still allowed.
export const NOTE_COLLAPSED_MAX = 80;
export const NOTE_LONG_CHARS = 200;

function stamp(t) {
    const n = Date.parse(t || '');
    return Number.isFinite(n) ? n : 0;
}

// Timestamps are compared as instants, so a row Supabase echoes back as
// `+00:00` still matches the `Z` it was written with.
function keyOf(n) {
    return String(stamp(n.createdAt));
}

export function isLineNote(n) {
    return !!n && typeof n.filePath === 'string' && !!n.filePath;
}

// The opening NOTE_EXCERPT_MAX characters of `lines` (source lines), whitespace
// collapsed.
export function linesExcerpt(lines) {
    const text = (Array.isArray(lines) ? lines : [String(lines || '')]).join(' ');
    return text.replace(/\s+/g, ' ').trim().slice(0, NOTE_EXCERPT_MAX).trim();
}

// Every live note on the repo (deletes waiting to sync excluded), oldest first.
export function listNotes(repo) {
    return getBookNotes(repo).filter(function (n) { return !n.deleted; });
}

// The notes on paragraph `paraIndex` of `chapterId`, oldest first.
export function notesForParagraph(repo, chapterId, paraIndex) {
    return listNotes(repo).filter(function (n) {
        return !isLineNote(n) && n.chapterId === chapterId && n.paraIndex === paraIndex;
    });
}

// The line-range notes on `filePath` (repo-relative), in line order.
export function notesForFile(repo, filePath) {
    if (!filePath) return [];
    return listNotes(repo).filter(function (n) { return isLineNote(n) && n.filePath === filePath; })
        .sort(function (a, b) { return (a.lineEnd - b.lineEnd) || (stamp(a.createdAt) - stamp(b.createdAt)); });
}

// A `book_notes` row as a record, or null when it doesn't name an anchor.
function fromRow(repo, row) {
    if (!row || typeof row.created_at !== 'string' || !row.created_at) return null;
    const para = Number(row.para_index);
    const start = Number(row.line_start);
    const end = Number(row.line_end);
    const isPara = typeof row.chapter_id === 'string' && !!row.chapter_id && row.para_index !== null && Number.isFinite(para);
    const isCode = typeof row.file_path === 'string' && !!row.file_path && row.line_start !== null && row.line_end !== null &&
        Number.isFinite(start) && Number.isFinite(end) && start >= 1 && end >= start;
    if (!isPara && !isCode) return null;
    return {
        repo: repo,
        chapterId: isPara ? row.chapter_id : null,
        paraIndex: isPara ? Math.max(0, Math.floor(para)) : null,
        filePath: isPara ? null : row.file_path,
        lineStart: isPara ? null : Math.floor(start),
        lineEnd: isPara ? null : Math.floor(end),
        body: typeof row.body === 'string' ? row.body : '',
        source: row.source === 'answer' ? 'answer' : 'user',
        excerpt: typeof row.excerpt === 'string' ? row.excerpt : '',
        refs: Array.isArray(row.refs) ? row.refs : [],
        bookSha: typeof row.book_sha === 'string' ? row.book_sha : '',
        createdAt: row.created_at,
        updatedAt: typeof row.updated_at === 'string' && row.updated_at ? row.updated_at : row.created_at,
        synced: true,
    };
}

// Merge the local records with the repo's Supabase rows (as records). Returns
// `{ list, insert, update, remove }`: the new local list, and the local rows to
// retry inserting, updating and deleting.
export function mergeNotes(local, remote) {
    const remoteByKey = new Map();
    (remote || []).forEach(function (r) { if (r) remoteByKey.set(keyOf(r), r); });
    const seen = new Set();
    const list = [];
    const insert = [];
    const update = [];
    const remove = [];
    (local || []).forEach(function (n) {
        const key = keyOf(n);
        if (seen.has(key)) return;
        seen.add(key);
        const r = remoteByKey.get(key);
        if (n.deleted) {
            // A delete Supabase hasn't seen: keep retrying while the row exists.
            if (r) { list.push(n); remove.push(n); }
        } else if (r && n.dirty) {
            // An edit Supabase hasn't seen outranks the row it changes.
            list.push(Object.assign({}, n, { synced: true }));
            update.push(n);
        } else if (r) {
            list.push(Object.assign({}, r, { synced: true }));
        } else if (!n.synced) {
            list.push(n);
            insert.push(n);
        }
        // A synced row missing remotely was deleted on another device: dropped.
    });
    remoteByKey.forEach(function (r, key) {
        if (!seen.has(key)) list.push(Object.assign({}, r, { synced: true }));
    });
    list.sort(function (a, b) { return stamp(a.createdAt) - stamp(b.createdAt); });
    return { list: list, insert: insert, update: update, remove: remove };
}

async function sessionUserId() {
    try {
        const res = await supabase.auth.getSession();
        const session = res && res.data && res.data.session;
        return session && session.user && session.user.id ? session.user.id : null;
    } catch (e) {
        return null;
    }
}

function localRecord(repo, key) {
    const list = getBookNotes(repo);
    for (let i = 0; i < list.length; i++) {
        if (keyOf(list[i]) === key) return list[i];
    }
    return null;
}

// Replace the local record keyed `key` with `next` (or drop it when `next` is
// null) in place, leaving every other record as stored.
function writeLocal(repo, key, next) {
    const list = [];
    let placed = false;
    getBookNotes(repo).forEach(function (n) {
        if (keyOf(n) !== key) { list.push(n); return; }
        if (next && !placed) { list.push(next); placed = true; }
    });
    if (next && !placed) list.push(next);
    setBookNotes(repo, list);
}

function match(query, userId, rec) {
    return query
        .eq('user_id', userId)
        .eq('repo', rec.repo)
        .eq('created_at', rec.createdAt);
}

async function run(op) {
    try {
        const result = await Promise.resolve(op());
        return !(result && result.error);
    } catch (e) {
        return false;
    }
}

function remoteInsert(userId, rec) {
    return run(function () {
        return supabase.from(TABLE).insert({
            user_id: userId,
            repo: rec.repo,
            chapter_id: rec.chapterId,
            para_index: rec.paraIndex,
            file_path: rec.filePath,
            line_start: rec.lineStart,
            line_end: rec.lineEnd,
            body: rec.body,
            source: rec.source,
            excerpt: rec.excerpt,
            refs: rec.refs,
            book_sha: rec.bookSha,
            created_at: rec.createdAt,
            updated_at: rec.updatedAt,
        });
    });
}

function remoteUpdate(userId, rec) {
    return run(function () {
        return match(supabase.from(TABLE).update({ body: rec.body, updated_at: rec.updatedAt }), userId, rec);
    });
}

function remoteDelete(userId, rec) {
    return run(function () { return match(supabase.from(TABLE).delete(), userId, rec); });
}

function sameEdit(a, b) {
    return a.body === b.body && a.updatedAt === b.updatedAt;
}

// Bring one record's Supabase row in line with its local state: insert it,
// push an edit, or delete it — repeating while the record changes underneath.
async function syncOnce(userId, repo, key) {
    for (let step = 0; step < 4; step++) {
        const rec = localRecord(repo, key);
        if (!rec) return;
        if (rec.deleted) {
            if (rec.synced && !(await remoteDelete(userId, rec))) return;
            const now = localRecord(repo, key);
            if (now && now.deleted) writeLocal(repo, key, null);
            return;
        }
        if (!rec.synced) {
            if (!(await remoteInsert(userId, rec))) return;
            const now = localRecord(repo, key);
            if (!now) {
                // Deleted while its insert was in flight: delete it again remotely.
                await remoteDelete(userId, rec);
                return;
            }
            const next = Object.assign({}, now, { synced: true });
            if (now.deleted || !sameEdit(now, rec)) next.dirty = !now.deleted;
            else delete next.dirty;
            writeLocal(repo, key, next);
            if (!next.dirty && !next.deleted) return;
            continue;
        }
        if (rec.dirty) {
            if (!(await remoteUpdate(userId, rec))) return;
            const now = localRecord(repo, key);
            if (now && !now.deleted && sameEdit(now, rec)) {
                const next = Object.assign({}, now);
                delete next.dirty;
                writeLocal(repo, key, next);
                return;
            }
            continue;
        }
        return;
    }
}

// Sync calls for one record run one at a time, so a quick save-then-edit can
// never insert the same row twice.
const chains = new Map();

function queueSync(repo, key) {
    const id = repo + '\n' + key;
    const prev = chains.get(id) || Promise.resolve();
    const next = prev.then(function () {
        return sessionUserId().then(function (uid) { return uid ? syncOnce(uid, repo, key) : undefined; });
    }).catch(function () {});
    chains.set(id, next);
    next.then(function () { if (chains.get(id) === next) chains.delete(id); });
    return next;
}

function announce(repo) {
    try {
        if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(BOOK_NOTES_EVENT, { detail: { repo: repo } }));
    } catch (e) { /* a listener's failure is its own */ }
}

function cleanBody(text) {
    return String(text == null ? '' : text).trim().slice(0, NOTE_BODY_MAX);
}

// A createdAt strictly later than every note on the repo, so two notes saved in
// the same millisecond never share a key.
function freshStamp(repo) {
    let t = Date.now();
    getBookNotes(repo).forEach(function (n) { if (stamp(n.createdAt) >= t) t = stamp(n.createdAt) + 1; });
    return new Date(t).toISOString();
}

// Save a new note on `anchor` — `{ chapterId, paraIndex, segments? }` for a
// paragraph (its segments give the excerpt and refs) or `{ filePath, lineStart,
// lineEnd, lines? }` for a line range (its source lines give the excerpt); either
// may pass `excerpt` / `refs` directly instead. `fields` is `{ body, source,
// bookSha }`. Written locally at once and synced in the background. Returns
// `{ note, sync }` — `note` null when the anchor or the body is missing; `sync`
// resolves once Supabase has been tried and never rejects.
export function saveNote(repo, anchor, fields) {
    const a = anchor || {};
    const f = fields || {};
    const body = cleanBody(f.body);
    const none = { note: null, sync: Promise.resolve() };
    if (!repo || !body) return none;
    let rec;
    const createdAt = freshStamp(repo);
    const base = {
        repo: repo,
        chapterId: null,
        paraIndex: null,
        filePath: null,
        lineStart: null,
        lineEnd: null,
        body: body,
        source: f.source === 'answer' ? 'answer' : 'user',
        excerpt: '',
        refs: [],
        bookSha: typeof f.bookSha === 'string' ? f.bookSha : (typeof a.bookSha === 'string' ? a.bookSha : ''),
        createdAt: createdAt,
        updatedAt: createdAt,
    };
    if (typeof a.filePath === 'string' && a.filePath) {
        const start = Math.floor(Number(a.lineStart));
        const end = Math.floor(Number(a.lineEnd));
        if (!(start >= 1) || !(end >= start)) return none;
        rec = Object.assign(base, {
            filePath: a.filePath,
            lineStart: start,
            lineEnd: end,
            excerpt: typeof a.excerpt === 'string' ? a.excerpt.slice(0, NOTE_EXCERPT_MAX) : linesExcerpt(a.lines),
            refs: Array.isArray(a.refs) ? a.refs.slice() : [],
        });
    } else if (typeof a.chapterId === 'string' && a.chapterId) {
        rec = Object.assign(base, {
            chapterId: a.chapterId,
            paraIndex: Math.max(0, Math.floor(Number(a.paraIndex) || 0)),
            excerpt: typeof a.excerpt === 'string' ? a.excerpt.slice(0, NOTE_EXCERPT_MAX) : flagExcerpt(a.segments),
            refs: Array.isArray(a.refs) ? a.refs.slice() : flagRefs(a.segments),
        });
    } else {
        return none;
    }
    const key = keyOf(rec);
    writeLocal(repo, key, rec);
    announce(repo);
    return { note: rec, sync: queueSync(repo, key) };
}

// Replace `note`'s text with `body`. An empty body leaves the note as it was.
// Returns `{ note, sync }` like saveNote; `sync` never rejects.
export function updateNote(repo, note, body) {
    const text = cleanBody(body);
    if (!repo || !note || !text) return { note: null, sync: Promise.resolve() };
    const key = keyOf(note);
    const current = localRecord(repo, key);
    if (!current || current.deleted) return { note: null, sync: Promise.resolve() };
    if (current.body === text) return { note: current, sync: Promise.resolve() };
    const rec = Object.assign({}, current, { body: text, updatedAt: new Date().toISOString() });
    if (rec.synced) rec.dirty = true;
    writeLocal(repo, key, rec);
    announce(repo);
    return { note: rec, sync: queueSync(repo, key) };
}

// Delete `note`. A row Supabase never got simply goes; a synced one waits as a
// delete until it lands. Never rejects.
export function deleteNote(repo, note) {
    if (!repo || !note) return Promise.resolve();
    const key = keyOf(note);
    const current = localRecord(repo, key);
    if (!current || current.deleted) return Promise.resolve();
    writeLocal(repo, key, current.synced ? Object.assign({}, current, { deleted: true }) : null);
    announce(repo);
    return queueSync(repo, key);
}

// The repo's notes across this device and Supabase, merged and stored locally,
// with unsynced inserts, edits and deletes retried. Never rejects; signed out
// or offline it resolves to the local list.
export async function loadNotes(repo) {
    if (!repo) return [];
    const userId = await sessionUserId();
    if (!userId) return listNotes(repo);
    let rows;
    try {
        const result = await Promise.resolve(supabase.from(TABLE).select().eq('repo', repo));
        if (!result || result.error) return listNotes(repo);
        rows = Array.isArray(result.data) ? result.data : [];
    } catch (e) {
        return listNotes(repo);
    }
    const remote = rows
        .filter(function (r) { return r && (r.user_id === undefined || r.user_id === userId); })
        .map(function (r) { return fromRow(repo, r); })
        .filter(Boolean);
    const merged = mergeNotes(getBookNotes(repo), remote);
    setBookNotes(repo, merged.list);
    await Promise.all(merged.insert.concat(merged.update, merged.remove).map(function (n) {
        return queueSync(repo, keyOf(n));
    }));
    return listNotes(repo);
}

// Whether chapter file `chFile` (manifest-relative, as the book names files)
// is `filePath` (repo-relative, as the viewer names them).
function sameFile(filePath, chFile) {
    const f = String(chFile || '');
    return !!f && (filePath === f || filePath.slice(-(f.length + 1)) === '/' + f);
}

// The index of the first chapter in `chapters` whose `files` include
// `filePath`, or -1.
function chapterOfFile(chapters, filePath) {
    for (let i = 0; i < chapters.length; i++) {
        const files = Array.isArray(chapters[i].files) ? chapters[i].files : [];
        if (files.some(function (f) { return sameFile(filePath, typeof f === 'string' ? f : (f && f.file)); })) return i;
    }
    return -1;
}

// Group `list` by `book`: `{ groups, code, removed }`. `groups` are `{ index,
// chapter, items }` in book order — a paragraph note under its chapter, a
// line-range note under the first chapter whose `files` include its file — each
// item `{ note, paraIndex, inRange }` with the chapter's paragraph notes first
// in paragraph order, then its code notes by file and line. A paragraph note
// past the chapter's last paragraph opens at the chapter top. `code` holds the
// line-range notes no chapter covers (the shelf's CODE group), `removed` the
// paragraph notes whose chapter is no longer in the book.
export function groupNotes(book, list) {
    const chapters = book && Array.isArray(book.chapters) ? book.chapters : [];
    const byId = new Map();
    chapters.forEach(function (ch, i) { byId.set(ch.id, i); });
    const groups = new Map();
    const code = [];
    const removed = [];
    function groupAt(index) {
        if (!groups.has(index)) groups.set(index, { index: index, chapter: chapters[index], items: [] });
        return groups.get(index);
    }
    (list || []).forEach(function (n) {
        if (!n || n.deleted) return;
        if (isLineNote(n)) {
            const at = chapterOfFile(chapters, n.filePath);
            if (at === -1) code.push({ note: n });
            else groupAt(at).items.push({ note: n });
            return;
        }
        if (!byId.has(n.chapterId)) { removed.push(n); return; }
        const index = byId.get(n.chapterId);
        const paras = Array.isArray(chapters[index].paragraphs) ? chapters[index].paragraphs.length : 0;
        const inRange = n.paraIndex < paras;
        groupAt(index).items.push({ note: n, paraIndex: inRange ? n.paraIndex : 0, inRange: inRange });
    });
    function order(a, b) {
        const ac = isLineNote(a.note);
        const bc = isLineNote(b.note);
        if (ac !== bc) return ac ? 1 : -1;
        if (!ac) return (a.note.paraIndex - b.note.paraIndex) || (stamp(a.note.createdAt) - stamp(b.note.createdAt));
        return a.note.filePath.localeCompare(b.note.filePath) || (a.note.lineStart - b.note.lineStart);
    }
    const ordered = Array.from(groups.values()).sort(function (a, b) { return a.index - b.index; });
    ordered.forEach(function (g) { g.items.sort(order); });
    code.sort(order);
    return { groups: ordered, code: code, removed: removed };
}

// `<file>:<start>–<end>` (`<file>:<start>` for one line), the file's base name.
export function noteSpanLabel(n) {
    const file = String(n.filePath || '');
    const base = file.slice(file.lastIndexOf('/') + 1);
    return base + ':' + n.lineStart + (n.lineEnd !== n.lineStart ? '–' + n.lineEnd : '');
}

// The note's first line.
export function noteFirstLine(n) {
    return String((n && n.body) || '').split('\n')[0].trim();
}

// A collapsed note's one line: the body cut at its first line break or at
// NOTE_COLLAPSED_MAX characters, with `…` when anything was cut.
export function noteCollapsedText(n) {
    const body = String((n && n.body) || '').trim();
    const brk = body.indexOf('\n');
    let line = brk === -1 ? body : body.slice(0, brk).trimEnd();
    let cut = brk !== -1;
    if (line.length > NOTE_COLLAPSED_MAX) {
        line = line.slice(0, NOTE_COLLAPSED_MAX).trimEnd();
        cut = true;
    }
    return cut ? line + '…' : line;
}

function noteLine(label, n) {
    const parts = [label, '"' + String(n.body || '').replace(/\s+/g, ' ').trim() + '"'];
    const refs = (n.refs || []).map(function (r) {
        return typeof r === 'string' ? r : String((r && (r.label || r.symbol || r.file)) || '');
    }).filter(Boolean);
    if (refs.length) parts.push('refs: ' + refs.join(', '));
    return '- ' + parts.join(' · ');
}

// The notes in `list` as a markdown list, in shelf order:
// `- CH 3 ¶2 · "note" · refs: buildToDoRow, listLogic.js` for a paragraph note,
// `- toDo.js:12–14 · "note"` for a line-range note. `numberOf(i)` is the number
// chapter `i` is shown as (defaults to i + 1); a paragraph note whose chapter is
// gone is listed last as `CH ?`.
export function notesMarkdown(book, list, numberOf) {
    const num = typeof numberOf === 'function' ? numberOf : function (i) { return i + 1; };
    const grouped = groupNotes(book, list);
    const lines = [];
    function add(chLabel, n) {
        lines.push(noteLine(isLineNote(n) ? noteSpanLabel(n) : chLabel + ' ¶' + (n.paraIndex + 1), n));
    }
    grouped.groups.forEach(function (g) {
        g.items.forEach(function (item) { add('CH ' + num(g.index), item.note); });
    });
    grouped.code.forEach(function (item) { add('', item.note); });
    grouped.removed.forEach(function (n) { add('CH ?', n); });
    return lines.join('\n');
}

// ── the note sheet ──
// One sheet for every way in: a paragraph's Note, the code viewer's selection
// Note, a tap on a note block or row (edit), and a chat reply's Keep. Built on
// the codeSheet chrome, so its backdrop and Escape close it like the others.

let noteSheet = null;

function sheet() {
    if (!noteSheet) {
        noteSheet = createCodeSheet({
            id: 'bookNoteSheet',
            label: 'Note',
            className: 'understandingBookmarksSheet bookNoteSheet',
        });
    }
    return noteSheet;
}

// Close the note sheet, if it is open.
export function hideNoteSheet() {
    if (noteSheet) noteSheet.hide();
}

export function isNoteSheetOpen() {
    return !!noteSheet && noteSheet.isOpen();
}

// Open the note sheet. `opts`:
//   • title    — the header (`NOTE · CH 3 ¶2`, `NOTE · toDo.js:12–14`).
//   • excerpt  — the anchor's text, quoted above the field.
//   • body     — the field's starting text ('' for a new note).
//   • onSave(text) — Save with a non-empty field; the sheet closes after it.
//   • onDelete()   — when given (editing), a Delete that asks first.
//   • counter  — show a live character count under the field.
// Returns the sheet's host, or null when there is no document.
export function openNoteSheet(opts) {
    const o = opts || {};
    const s = sheet();
    const host = s.ensure();
    if (!host) return null;
    while (host.firstChild) host.removeChild(host.firstChild);
    const hide = function () { s.hide(); };

    const head = document.createElement('div');
    head.className = 'understandingMarksHead';
    const title = document.createElement('span');
    title.className = 'understandingMarksTitle';
    title.textContent = o.title || 'NOTE';
    head.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'understandingMarksClose';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close note');
    close.addEventListener('click', hide);
    head.appendChild(close);
    host.appendChild(head);

    const body = document.createElement('div');
    body.className = 'understandingFlagForm bookNoteForm';
    if (o.excerpt) {
        const quote = document.createElement('div');
        quote.className = 'understandingFlagExcerpt';
        quote.textContent = o.excerpt;
        body.appendChild(quote);
    }
    const field = document.createElement('textarea');
    field.className = 'bookNoteField';
    field.rows = 4;
    field.maxLength = NOTE_BODY_MAX;
    field.placeholder = 'What did you work out?';
    field.setAttribute('aria-label', 'Note');
    field.value = typeof o.body === 'string' ? o.body : '';
    body.appendChild(field);
    // `counter`: a live `n chars` under the field, amber past NOTE_LONG_CHARS.
    let count = null;
    if (o.counter) {
        count = document.createElement('div');
        count.className = 'bookNoteCount';
        count.setAttribute('aria-live', 'polite');
        body.appendChild(count);
    }
    const syncCount = function () {
        if (!count) return;
        const n = field.value.length;
        count.textContent = n + (n === 1 ? ' char' : ' chars');
        count.classList.toggle('is-long', n > NOTE_LONG_CHARS);
    };

    const actions = document.createElement('div');
    actions.className = 'understandingFlagActions';
    function action(label, className, fn) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'understandingFlagAction ' + className;
        btn.textContent = label;
        btn.addEventListener('click', fn);
        actions.appendChild(btn);
        return btn;
    }
    // Delete asks in place: the row becomes the question and its two answers.
    const confirm = document.createElement('div');
    confirm.className = 'understandingFlagActions bookNoteConfirm';
    confirm.hidden = true;
    if (typeof o.onDelete === 'function') {
        action('Delete', 'is-delete', function () {
            actions.hidden = true;
            confirm.hidden = false;
        });
        const ask = document.createElement('span');
        ask.className = 'bookNoteConfirmText';
        ask.textContent = 'Delete this note? Its text will be lost.';
        confirm.appendChild(ask);
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.className = 'understandingFlagAction is-cancel';
        keep.textContent = 'Cancel';
        keep.addEventListener('click', function () {
            confirm.hidden = true;
            actions.hidden = false;
        });
        confirm.appendChild(keep);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'understandingFlagAction is-delete is-confirm';
        del.textContent = 'Delete';
        del.addEventListener('click', function () {
            hide();
            o.onDelete();
        });
        confirm.appendChild(del);
    }
    action('Cancel', 'is-cancel', hide);
    const save = action('Save', 'is-save', function () {
        const text = field.value.trim();
        if (!text) return;
        hide();
        if (typeof o.onSave === 'function') o.onSave(text);
    });
    const syncSave = function () { save.disabled = !field.value.trim(); syncCount(); };
    field.addEventListener('input', syncSave);
    syncSave();
    body.appendChild(actions);
    body.appendChild(confirm);
    host.appendChild(body);
    s.show();
    try { field.focus(); } catch (e) { /* defensive */ }
    return host;
}
