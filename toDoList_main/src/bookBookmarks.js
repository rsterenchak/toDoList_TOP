// Bookmarked paragraphs in a repo's code book — kept locally so they render
// instantly and work signed out, and mirrored to Supabase's `book_bookmarks` so
// the shelf and reader show the same marks on any device.
//
// A record is `{ repo, chapterId, paraIndex, label, createdAt }`, keyed by
// `(chapterId, paraIndex)`. The local copy (prefs.js) also carries two sync
// flags: `synced` once Supabase holds the row, and `deleted` for an unmark that
// Supabase hasn't seen yet. On shelf render the repo's rows are fetched and
// merged: Supabase wins for rows on both sides, a local row never synced is
// retried, a synced row missing remotely was deleted elsewhere and is dropped.
// Every Supabase call is wrapped — a sync miss must never block the reader.

import { supabase } from './supabaseClient.js';
import { getBookBookmarks, setBookBookmarks } from './prefs.js';

const TABLE = 'book_bookmarks';
// How much of a paragraph's text a bookmark's label keeps.
export const BOOKMARK_LABEL_MAX = 60;

function keyOf(chapterId, paraIndex) {
    return chapterId + '#' + paraIndex;
}

function stamp(t) {
    const n = Date.parse(t || '');
    return Number.isFinite(n) ? n : 0;
}

// A paragraph's plain text — text segments as written, rationale sentences read
// through, ref chips flattened to the label the chip shows — cut to
// BOOKMARK_LABEL_MAX characters at a word boundary with an ellipsis.
export function bookmarkLabel(segments) {
    const segs = Array.isArray(segments) ? segments : [{ t: String(segments || '') }];
    const flat = function (seg) {
        if (seg && seg.why && typeof seg.why === 'object') {
            return (Array.isArray(seg.why.segs) ? seg.why.segs : []).map(flat).join('');
        }
        if (seg && seg.ref && typeof seg.ref === 'object') {
            return String(seg.ref.label || seg.ref.symbol || seg.ref.file || '');
        }
        return seg && typeof seg.t === 'string' ? seg.t : '';
    };
    const text = segs.map(flat).join('').replace(/\s+/g, ' ').trim();
    if (text.length <= BOOKMARK_LABEL_MAX) return text;
    let cut = text.slice(0, BOOKMARK_LABEL_MAX);
    // Cutting inside a word drops back to the last space before it.
    if (text.charAt(BOOKMARK_LABEL_MAX) !== ' ') {
        const space = cut.lastIndexOf(' ');
        if (space > 0) cut = cut.slice(0, space);
    }
    return cut.replace(/[\s,;:.\-–—]+$/, '') + '…';
}

// The repo's live bookmarks (unmarks waiting to sync excluded), oldest first.
export function listBookmarks(repo) {
    return getBookBookmarks(repo).filter(function (b) { return !b.deleted; });
}

export function isBookmarked(repo, chapterId, paraIndex) {
    const key = keyOf(chapterId, paraIndex);
    return listBookmarks(repo).some(function (b) { return keyOf(b.chapterId, b.paraIndex) === key; });
}

// A `book_bookmarks` row as a record, or null when it doesn't name one.
function fromRow(repo, row) {
    if (!row || typeof row.chapter_id !== 'string' || !row.chapter_id) return null;
    const para = Number(row.para_index);
    if (!Number.isFinite(para)) return null;
    return {
        repo: repo,
        chapterId: row.chapter_id,
        paraIndex: Math.max(0, Math.floor(para)),
        label: typeof row.label === 'string' ? row.label : '',
        createdAt: typeof row.created_at === 'string' ? row.created_at : '',
        synced: true,
    };
}

// Merge the local records with the repo's Supabase rows (as records). Returns
// `{ list, insert, remove }`: the new local list, the local rows to retry
// inserting, and the unmarks to retry deleting.
export function mergeBookmarks(local, remote) {
    const remoteByKey = new Map();
    (remote || []).forEach(function (r) {
        if (r) remoteByKey.set(keyOf(r.chapterId, r.paraIndex), r);
    });
    const seen = new Set();
    const list = [];
    const insert = [];
    const remove = [];
    (local || []).forEach(function (b) {
        const key = keyOf(b.chapterId, b.paraIndex);
        if (seen.has(key)) return;
        seen.add(key);
        const r = remoteByKey.get(key);
        if (b.deleted) {
            // An unmark Supabase hasn't seen: keep retrying while the row exists.
            if (r) { list.push(b); remove.push(b); }
        } else if (r) {
            list.push(Object.assign({}, r, { synced: true }));
        } else if (!b.synced) {
            list.push(b);
            insert.push(b);
        }
        // A synced row missing remotely was deleted on another device: dropped.
    });
    remoteByKey.forEach(function (r, key) {
        if (!seen.has(key)) list.push(Object.assign({}, r, { synced: true }));
    });
    list.sort(function (a, b) { return stamp(a.createdAt) - stamp(b.createdAt); });
    return { list: list, insert: insert, remove: remove };
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

// Replace the local record for `(chapterId, paraIndex)` with `next` (or drop it
// when `next` is null) in place, leaving every other record as stored.
function writeLocal(repo, chapterId, paraIndex, next) {
    const key = keyOf(chapterId, paraIndex);
    const list = [];
    let placed = false;
    getBookBookmarks(repo).forEach(function (b) {
        if (keyOf(b.chapterId, b.paraIndex) !== key) { list.push(b); return; }
        if (next && !placed) { list.push(next); placed = true; }
    });
    if (next && !placed) list.push(next);
    setBookBookmarks(repo, list);
}

function localRecord(repo, chapterId, paraIndex) {
    const key = keyOf(chapterId, paraIndex);
    const list = getBookBookmarks(repo);
    for (let i = 0; i < list.length; i++) {
        if (keyOf(list[i].chapterId, list[i].paraIndex) === key) return list[i];
    }
    return null;
}

async function remoteInsert(userId, rec) {
    try {
        const result = await Promise.resolve(supabase.from(TABLE).insert({
            user_id: userId,
            repo: rec.repo,
            chapter_id: rec.chapterId,
            para_index: rec.paraIndex,
            label: rec.label,
            created_at: rec.createdAt,
        }));
        return !(result && result.error);
    } catch (e) {
        return false;
    }
}

async function remoteDelete(userId, rec) {
    try {
        const result = await Promise.resolve(supabase.from(TABLE).delete()
            .eq('user_id', userId)
            .eq('repo', rec.repo)
            .eq('chapter_id', rec.chapterId)
            .eq('para_index', rec.paraIndex));
        return !(result && result.error);
    } catch (e) {
        return false;
    }
}

// Push one local record's state to Supabase and settle its sync flags. A record
// unmarked while its insert was in flight is deleted again rather than left
// orphaned remotely.
async function pushInsert(userId, rec) {
    if (!(await remoteInsert(userId, rec))) return;
    const now = localRecord(rec.repo, rec.chapterId, rec.paraIndex);
    if (now && !now.deleted) {
        writeLocal(rec.repo, rec.chapterId, rec.paraIndex, Object.assign({}, now, { synced: true }));
    } else {
        const tomb = Object.assign({}, rec, { synced: true, deleted: true });
        writeLocal(rec.repo, rec.chapterId, rec.paraIndex, tomb);
        await pushDelete(userId, tomb);
    }
}

async function pushDelete(userId, rec) {
    if (!(await remoteDelete(userId, rec))) return;
    const now = localRecord(rec.repo, rec.chapterId, rec.paraIndex);
    if (now && now.deleted) writeLocal(rec.repo, rec.chapterId, rec.paraIndex, null);
}

// Mark or unmark paragraph `paraIndex` of `chapterId`; `segments` are the
// paragraph's segments, for the label. Written locally at once and synced in the
// background. Returns `{ marked, sync }` — `sync` resolves once Supabase has
// been tried and never rejects.
export function toggleBookmark(repo, chapterId, paraIndex, segments) {
    if (!repo || typeof chapterId !== 'string' || !chapterId) return { marked: false, sync: Promise.resolve() };
    const index = Math.max(0, Math.floor(Number(paraIndex) || 0));
    const current = localRecord(repo, chapterId, index);
    if (current && !current.deleted) {
        // Unmark. A row Supabase never got simply goes; a synced one waits as an
        // unmark until the delete lands.
        const tomb = current.synced ? Object.assign({}, current, { deleted: true }) : null;
        writeLocal(repo, chapterId, index, tomb);
        const sync = tomb
            ? sessionUserId().then(function (uid) { return uid ? pushDelete(uid, tomb) : undefined; })
            : Promise.resolve();
        return { marked: false, sync: sync.catch(function () {}) };
    }
    // Re-marking a pending unmark keeps its label and is inserted afresh, so a
    // delete still in flight can't leave it marked here and missing remotely.
    const rec = {
        repo: repo,
        chapterId: chapterId,
        paraIndex: index,
        label: current ? current.label : bookmarkLabel(segments),
        createdAt: current ? current.createdAt : new Date().toISOString(),
    };
    writeLocal(repo, chapterId, index, rec);
    const sync = sessionUserId().then(function (uid) { return uid ? pushInsert(uid, rec) : undefined; });
    return { marked: true, sync: sync.catch(function () {}) };
}

// Delete a bookmark outright (the removed-chapter delete control).
export function removeBookmark(repo, chapterId, paraIndex) {
    if (!isBookmarked(repo, chapterId, paraIndex)) return Promise.resolve();
    return toggleBookmark(repo, chapterId, paraIndex, null).sync;
}

// The repo's bookmarks across this device and Supabase, merged and stored
// locally, with unsynced marks and unmarks retried. Never rejects; signed out or
// offline it resolves to the local list.
export async function loadBookmarks(repo) {
    if (!repo) return [];
    const userId = await sessionUserId();
    if (!userId) return listBookmarks(repo);
    let rows;
    try {
        const result = await Promise.resolve(supabase.from(TABLE).select().eq('repo', repo));
        if (!result || result.error) return listBookmarks(repo);
        rows = Array.isArray(result.data) ? result.data : [];
    } catch (e) {
        return listBookmarks(repo);
    }
    const remote = rows
        .filter(function (r) { return r && (r.user_id === undefined || r.user_id === userId); })
        .map(function (r) { return fromRow(repo, r); })
        .filter(Boolean);
    const merged = mergeBookmarks(getBookBookmarks(repo), remote);
    setBookBookmarks(repo, merged.list);
    await Promise.all(
        merged.insert.map(function (b) { return pushInsert(userId, b); })
            .concat(merged.remove.map(function (b) { return pushDelete(userId, b); }))
    );
    return listBookmarks(repo);
}

// Anchor `list` to `book`: `{ groups, removed }`. `groups` are `{ index,
// chapter, items }` in book order, each item `{ bookmark, paraIndex, inRange }`
// in paragraph order — a bookmark past the chapter's last paragraph opens at
// the chapter top (`paraIndex` 0, `inRange` false) and keeps its label.
// `removed` holds the bookmarks whose chapter is no longer in the book.
export function anchorBookmarks(book, list) {
    const chapters = book && Array.isArray(book.chapters) ? book.chapters : [];
    const byId = new Map();
    chapters.forEach(function (ch, i) { byId.set(ch.id, i); });
    const groups = new Map();
    const removed = [];
    (list || []).forEach(function (b) {
        if (!byId.has(b.chapterId)) { removed.push(b); return; }
        const index = byId.get(b.chapterId);
        const paras = Array.isArray(chapters[index].paragraphs) ? chapters[index].paragraphs.length : 0;
        const inRange = b.paraIndex < paras;
        if (!groups.has(index)) groups.set(index, { index: index, chapter: chapters[index], items: [] });
        groups.get(index).items.push({ bookmark: b, paraIndex: inRange ? b.paraIndex : 0, inRange: inRange });
    });
    const ordered = Array.from(groups.values()).sort(function (a, b) { return a.index - b.index; });
    ordered.forEach(function (g) {
        g.items.sort(function (a, b) { return a.bookmark.paraIndex - b.bookmark.paraIndex; });
    });
    return { groups: ordered, removed: removed };
}
