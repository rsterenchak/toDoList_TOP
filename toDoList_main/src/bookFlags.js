// Reader flags on a repo's code book — a paragraph marked as one that didn't
// land (unclear, out of order, doesn't match the code, why?), with an optional
// note. Kept locally so they render instantly and work signed out, and mirrored
// to Supabase's `book_flags` so the shelf lists the same flags on any device.
//
// A record is `{ repo, chapterId, paraIndex, excerpt, refs, kind, note, bookSha,
// createdAt, resolvedAt }`, keyed by `(chapterId, paraIndex, createdAt)`. The
// paragraph's opening text and its resolved refs are captured at flag time, so a
// flag stays readable after the book is regenerated. The local copy (prefs.js)
// also carries sync flags: `synced` once Supabase holds the row, `dirty` for an
// edit or resolve it hasn't seen, and `deleted` for a delete it hasn't seen. On
// shelf render the repo's rows are fetched and merged as bookmarks are: Supabase
// wins for rows on both sides (unless the local row has an unsynced edit), a
// local row never synced is retried, a synced row missing remotely is dropped.
// Every Supabase call is wrapped — a sync miss must never block the reader.

import { supabase } from './supabaseClient.js';
import { getBookFlags, setBookFlags } from './prefs.js';

const TABLE = 'book_flags';
// How much of a paragraph's text a flag keeps.
export const FLAG_EXCERPT_MAX = 160;

// The four kinds, in chip order: the chip label and the shelf / export badge.
export const FLAG_KINDS = [
    { id: 'unclear', label: 'Unclear', badge: 'UNCLEAR' },
    { id: 'order', label: 'Out of order', badge: 'ORDER' },
    { id: 'wrong', label: 'Doesn’t match the code', badge: 'WRONG' },
    { id: 'why', label: 'Why?', badge: 'WHY' },
];
export const DEFAULT_FLAG_KIND = 'unclear';

function validKind(kind) {
    return FLAG_KINDS.some(function (k) { return k.id === kind; }) ? kind : DEFAULT_FLAG_KIND;
}

export function flagBadge(kind) {
    const k = FLAG_KINDS.find(function (x) { return x.id === kind; });
    return k ? k.badge : 'UNCLEAR';
}

function stamp(t) {
    const n = Date.parse(t || '');
    return Number.isFinite(n) ? n : 0;
}

// Timestamps are compared as instants, so a row Supabase echoes back as
// `+00:00` still matches the `Z` it was written with.
function keyOf(f) {
    return f.chapterId + '#' + f.paraIndex + '#' + stamp(f.createdAt);
}

// Walk a paragraph's segments, rationale sentences read through.
function eachSeg(segments, fn) {
    (Array.isArray(segments) ? segments : [{ t: String(segments || '') }]).forEach(function (seg) {
        if (seg && seg.why && typeof seg.why === 'object') eachSeg(Array.isArray(seg.why.segs) ? seg.why.segs : [], fn);
        else fn(seg);
    });
}

// A paragraph's first FLAG_EXCERPT_MAX characters of plain text, ref chips
// flattened to the label the chip shows.
export function flagExcerpt(segments) {
    let text = '';
    eachSeg(segments, function (seg) {
        if (seg && seg.ref && typeof seg.ref === 'object') text += String(seg.ref.label || seg.ref.symbol || seg.ref.file || '');
        else if (seg && typeof seg.t === 'string') text += seg.t;
    });
    return text.replace(/\s+/g, ' ').trim().slice(0, FLAG_EXCERPT_MAX).trim();
}

// A paragraph's ref chips as `{ label, file, symbol, line }`, once each.
export function flagRefs(segments) {
    const seen = new Set();
    const refs = [];
    eachSeg(segments, function (seg) {
        if (!seg || !seg.ref || typeof seg.ref !== 'object') return;
        const r = seg.ref;
        const ref = {
            label: String(r.label || r.symbol || r.file || ''),
            file: typeof r.file === 'string' ? r.file : null,
            symbol: typeof r.symbol === 'string' ? r.symbol : null,
            line: Number.isFinite(Number(r.line)) && r.line !== null ? Number(r.line) : null,
        };
        const key = ref.label + '|' + ref.file + '|' + ref.symbol;
        if (seen.has(key)) return;
        seen.add(key);
        refs.push(ref);
    });
    return refs;
}

// The chapter's code fingerprint hashes joined, or '' when it carries none.
export function chapterBookSha(chapter) {
    const fp = chapter && chapter.fingerprint && typeof chapter.fingerprint === 'object' ? chapter.fingerprint : null;
    if (!fp) return '';
    return Object.keys(fp).sort().map(function (k) { return String(fp[k]); }).join(',');
}

// Every live flag on the repo (deletes waiting to sync excluded), oldest first.
export function listFlags(repo) {
    return getBookFlags(repo).filter(function (f) { return !f.deleted; });
}

// The repo's open (unresolved) flags, oldest first.
export function openFlags(repo) {
    return listFlags(repo).filter(function (f) { return !f.resolvedAt; });
}

// The open flag on paragraph `paraIndex` of `chapterId`, or null.
export function openFlagFor(repo, chapterId, paraIndex) {
    const list = openFlags(repo).filter(function (f) { return f.chapterId === chapterId && f.paraIndex === paraIndex; });
    return list.length ? list[list.length - 1] : null;
}

// A `book_flags` row as a record, or null when it doesn't name one.
function fromRow(repo, row) {
    if (!row || typeof row.chapter_id !== 'string' || !row.chapter_id) return null;
    const para = Number(row.para_index);
    if (!Number.isFinite(para)) return null;
    return {
        repo: repo,
        chapterId: row.chapter_id,
        paraIndex: Math.max(0, Math.floor(para)),
        excerpt: typeof row.excerpt === 'string' ? row.excerpt : '',
        refs: Array.isArray(row.refs) ? row.refs : [],
        kind: validKind(row.kind),
        note: typeof row.note === 'string' ? row.note : '',
        bookSha: typeof row.book_sha === 'string' ? row.book_sha : '',
        createdAt: typeof row.created_at === 'string' ? row.created_at : '',
        resolvedAt: typeof row.resolved_at === 'string' && row.resolved_at ? row.resolved_at : null,
        synced: true,
    };
}

// Merge the local records with the repo's Supabase rows (as records). Returns
// `{ list, insert, update, remove }`: the new local list, and the local rows to
// retry inserting, updating and deleting.
export function mergeFlags(local, remote) {
    const remoteByKey = new Map();
    (remote || []).forEach(function (r) { if (r) remoteByKey.set(keyOf(r), r); });
    const seen = new Set();
    const list = [];
    const insert = [];
    const update = [];
    const remove = [];
    (local || []).forEach(function (f) {
        const key = keyOf(f);
        if (seen.has(key)) return;
        seen.add(key);
        const r = remoteByKey.get(key);
        if (f.deleted) {
            // A delete Supabase hasn't seen: keep retrying while the row exists.
            if (r) { list.push(f); remove.push(f); }
        } else if (r && f.dirty) {
            // An edit or resolve Supabase hasn't seen outranks the row it changes.
            list.push(Object.assign({}, f, { synced: true }));
            update.push(f);
        } else if (r) {
            list.push(Object.assign({}, r, { synced: true }));
        } else if (!f.synced) {
            list.push(f);
            insert.push(f);
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
    const list = getBookFlags(repo);
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
    getBookFlags(repo).forEach(function (f) {
        if (keyOf(f) !== key) { list.push(f); return; }
        if (next && !placed) { list.push(next); placed = true; }
    });
    if (next && !placed) list.push(next);
    setBookFlags(repo, list);
}

function match(query, userId, rec) {
    return query
        .eq('user_id', userId)
        .eq('repo', rec.repo)
        .eq('chapter_id', rec.chapterId)
        .eq('para_index', rec.paraIndex)
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
            excerpt: rec.excerpt,
            refs: rec.refs,
            kind: rec.kind,
            note: rec.note,
            book_sha: rec.bookSha,
            created_at: rec.createdAt,
            resolved_at: rec.resolvedAt,
        });
    });
}

function remoteUpdate(userId, rec) {
    return run(function () {
        return match(supabase.from(TABLE).update({ kind: rec.kind, note: rec.note, resolved_at: rec.resolvedAt }), userId, rec);
    });
}

function remoteDelete(userId, rec) {
    return run(function () { return match(supabase.from(TABLE).delete(), userId, rec); });
}

function sameEdit(a, b) {
    return a.kind === b.kind && a.note === b.note && a.resolvedAt === b.resolvedAt;
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

// Sync calls for one record run one at a time, so a quick save-then-resolve
// can never insert the same row twice.
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

// Flag paragraph `paraIndex` of `chapterId` (its `segments` give the excerpt
// and refs), or edit the open flag already on it. `fields` is `{ kind, note,
// bookSha }`. Written locally at once and synced in the background. Returns
// `{ flag, sync }` — `sync` resolves once Supabase has been tried and never
// rejects.
export function saveFlag(repo, chapterId, paraIndex, segments, fields) {
    const f = fields || {};
    if (!repo || typeof chapterId !== 'string' || !chapterId) return { flag: null, sync: Promise.resolve() };
    const index = Math.max(0, Math.floor(Number(paraIndex) || 0));
    const kind = validKind(f.kind);
    const note = String(f.note || '').trim();
    const current = openFlagFor(repo, chapterId, index);
    let rec;
    if (current) {
        rec = Object.assign({}, current, { kind: kind, note: note });
        if (rec.synced) rec.dirty = true;
    } else {
        rec = {
            repo: repo,
            chapterId: chapterId,
            paraIndex: index,
            excerpt: flagExcerpt(segments),
            refs: flagRefs(segments),
            kind: kind,
            note: note,
            bookSha: typeof f.bookSha === 'string' ? f.bookSha : '',
            createdAt: new Date().toISOString(),
            resolvedAt: null,
        };
    }
    const key = keyOf(rec);
    writeLocal(repo, key, rec);
    return { flag: rec, sync: queueSync(repo, key) };
}

// Mark `flag` resolved. Resolves once Supabase has been tried; never rejects.
export function resolveFlag(repo, flag) {
    if (!repo || !flag) return Promise.resolve();
    const key = keyOf(flag);
    const current = localRecord(repo, key);
    if (!current || current.deleted || current.resolvedAt) return Promise.resolve();
    const rec = Object.assign({}, current, { resolvedAt: new Date().toISOString() });
    if (rec.synced) rec.dirty = true;
    writeLocal(repo, key, rec);
    return queueSync(repo, key);
}

// Delete `flag` outright. A row Supabase never got simply goes; a synced one
// waits as a delete until it lands. Never rejects.
export function deleteFlag(repo, flag) {
    if (!repo || !flag) return Promise.resolve();
    const key = keyOf(flag);
    const current = localRecord(repo, key);
    if (!current || current.deleted) return Promise.resolve();
    writeLocal(repo, key, current.synced ? Object.assign({}, current, { deleted: true }) : null);
    return queueSync(repo, key);
}

// The repo's flags across this device and Supabase, merged and stored locally,
// with unsynced inserts, edits and deletes retried. Never rejects; signed out
// or offline it resolves to the local list.
export async function loadFlags(repo) {
    if (!repo) return [];
    const userId = await sessionUserId();
    if (!userId) return listFlags(repo);
    let rows;
    try {
        const result = await Promise.resolve(supabase.from(TABLE).select().eq('repo', repo));
        if (!result || result.error) return listFlags(repo);
        rows = Array.isArray(result.data) ? result.data : [];
    } catch (e) {
        return listFlags(repo);
    }
    const remote = rows
        .filter(function (r) { return r && (r.user_id === undefined || r.user_id === userId); })
        .map(function (r) { return fromRow(repo, r); })
        .filter(Boolean);
    const merged = mergeFlags(getBookFlags(repo), remote);
    setBookFlags(repo, merged.list);
    await Promise.all(merged.insert.concat(merged.update, merged.remove).map(function (f) {
        return queueSync(repo, keyOf(f));
    }));
    return listFlags(repo);
}

// Anchor `list` to `book`: `{ groups, removed }`. `groups` are `{ index,
// chapter, items }` in book order, each item `{ flag, paraIndex, inRange }` in
// paragraph order — a flag past the chapter's last paragraph opens at the
// chapter top (`paraIndex` 0, `inRange` false). `removed` holds the flags whose
// chapter is no longer in the book.
export function anchorFlags(book, list) {
    const chapters = book && Array.isArray(book.chapters) ? book.chapters : [];
    const byId = new Map();
    chapters.forEach(function (ch, i) { byId.set(ch.id, i); });
    const groups = new Map();
    const removed = [];
    (list || []).forEach(function (f) {
        if (!byId.has(f.chapterId)) { removed.push(f); return; }
        const index = byId.get(f.chapterId);
        const paras = Array.isArray(chapters[index].paragraphs) ? chapters[index].paragraphs.length : 0;
        const inRange = f.paraIndex < paras;
        if (!groups.has(index)) groups.set(index, { index: index, chapter: chapters[index], items: [] });
        groups.get(index).items.push({ flag: f, paraIndex: inRange ? f.paraIndex : 0, inRange: inRange });
    });
    const ordered = Array.from(groups.values()).sort(function (a, b) { return a.index - b.index; });
    ordered.forEach(function (g) {
        g.items.sort(function (a, b) { return a.flag.paraIndex - b.flag.paraIndex; });
    });
    return { groups: ordered, removed: removed };
}

// One flag as a markdown list line:
// `- CH 3 ¶2 · UNCLEAR · "note" · refs: buildToDoRow, listLogic.js`. A flag
// without a note quotes its excerpt; one without refs ends at the quote.
function flagLine(chLabel, f) {
    const parts = [chLabel + ' ¶' + (f.paraIndex + 1), flagBadge(f.kind), '"' + (f.note || f.excerpt) + '"'];
    const refs = (f.refs || []).map(function (r) { return String((r && (r.label || r.symbol || r.file)) || ''); }).filter(Boolean);
    if (refs.length) parts.push('refs: ' + refs.join(', '));
    return '- ' + parts.join(' · ');
}

// The open flags in `list` as a markdown list, in book order — for pasting into
// chat. `numberOf(i)` is the number chapter `i` is shown as (defaults to i + 1);
// a flag whose chapter is gone is listed last as `CH ?`.
export function flagsMarkdown(book, list, numberOf) {
    const num = typeof numberOf === 'function' ? numberOf : function (i) { return i + 1; };
    const open = (list || []).filter(function (f) { return f && !f.deleted && !f.resolvedAt; });
    const anchored = anchorFlags(book, open);
    const lines = [];
    anchored.groups.forEach(function (g) {
        g.items.forEach(function (item) { lines.push(flagLine('CH ' + num(g.index), item.flag)); });
    });
    anchored.removed.forEach(function (f) { lines.push(flagLine('CH ?', f)); });
    return lines.join('\n');
}
