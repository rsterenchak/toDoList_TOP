// Where the reader is in a repo's code book — the chapter and paragraph — kept
// locally on every change and mirrored to Supabase's `book_progress` so the
// shelf's Continue card resumes the same place on any device.
//
// The record is `{ chapterId, paraIndex, pct, updatedAt }`. The local copy
// (prefs.js) is written synchronously and is always enough to render; the
// Supabase row is upserted on a 2s debounce and on reader exit, and read back on
// shelf render, where the newer `updatedAt` wins (local wins a tie). Signed out
// or offline, every Supabase call is skipped or swallowed — a sync miss must
// never block or break the reader.
//
// It also keeps the chapters the reader gave up on. Leaving a chapter (a chapter
// switch or the reader closing) under ABANDON_PCT read stages it; coming back to
// it in the same session unstages it; the session ending (the page hidden or
// unloaded) writes what is still staged to the local `todoapp_bookAbandon` map,
// where it stays until that chapter is next read past ABANDON_PCT. Local only.

import { supabase } from './supabaseClient.js';
import { getBookProgress, setBookProgress, getBookAbandon, setBookAbandon } from './prefs.js';

const TABLE = 'book_progress';
// How long position changes settle before they are upserted.
export const BOOK_PROGRESS_DEBOUNCE_MS = 2000;

// How far through a chapter a reader must get for leaving it not to count as
// abandoning it.
export const ABANDON_PCT = 0.8;

// The pending upsert: `{ repo, record }`, or null when nothing is waiting.
let pending = null;
let timer = null;

function stamp(t) {
    const n = Date.parse(t || '');
    return Number.isFinite(n) ? n : -Infinity;
}

// The newer of two records by `updatedAt`; the local one wins a tie, and either
// side may be null.
export function mergeProgress(local, remote) {
    if (!remote) return local || null;
    if (!local) return remote;
    return stamp(remote.updatedAt) > stamp(local.updatedAt) ? remote : local;
}

// A `book_progress` row as a reading record, or null when it doesn't name one.
function fromRow(row) {
    if (!row || typeof row.chapter_id !== 'string' || !row.chapter_id) return null;
    const para = Number(row.para_index);
    const pct = Number(row.pct);
    return {
        chapterId: row.chapter_id,
        paraIndex: Number.isFinite(para) && para > 0 ? Math.floor(para) : 0,
        pct: Number.isFinite(pct) ? Math.min(1, Math.max(0, pct)) : 0,
        updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
    };
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

// The local record for `repo`, or null.
export function readLocalProgress(repo) {
    return getBookProgress(repo);
}

// Upsert one record now. Resolves `{ ok, skipped? }`; never rejects.
export async function upsertProgress(repo, record) {
    if (!repo || !record) return { ok: false, skipped: true };
    const userId = await sessionUserId();
    if (!userId) return { ok: false, skipped: true };
    try {
        const result = await Promise.resolve(
            supabase.from(TABLE).upsert({
                user_id: userId,
                repo: repo,
                chapter_id: record.chapterId,
                para_index: record.paraIndex,
                pct: record.pct,
                updated_at: record.updatedAt,
            }, { onConflict: 'user_id,repo' })
        );
        return { ok: !(result && result.error) };
    } catch (e) {
        return { ok: false };
    }
}

// Note the reader's position: written locally at once, upserted once it has
// settled for BOOK_PROGRESS_DEBOUNCE_MS. Returns the stored record.
export function recordProgress(repo, position) {
    if (!repo || !position || typeof position.chapterId !== 'string' || !position.chapterId) return null;
    const record = {
        chapterId: position.chapterId,
        paraIndex: Math.max(0, Math.floor(Number(position.paraIndex) || 0)),
        pct: Math.min(1, Math.max(0, Number(position.pct) || 0)),
        updatedAt: new Date().toISOString(),
    };
    setBookProgress(repo, record);
    pending = { repo: repo, record: record };
    if (timer) clearTimeout(timer);
    timer = setTimeout(flushProgress, BOOK_PROGRESS_DEBOUNCE_MS);
    return record;
}

// Send the waiting upsert now (on reader exit) instead of after the debounce.
export function flushProgress() {
    if (timer) { clearTimeout(timer); timer = null; }
    const job = pending;
    pending = null;
    if (!job) return Promise.resolve({ ok: false, skipped: true });
    return upsertProgress(job.repo, job.record);
}

// The newest record for `repo` across this device and Supabase. A newer remote
// record is copied locally so the next synchronous read agrees. Never rejects;
// signed out or offline it resolves to the local record.
export async function loadProgress(repo) {
    const local = getBookProgress(repo);
    if (!repo) return local;
    const userId = await sessionUserId();
    if (!userId) return local;
    try {
        const result = await Promise.resolve(
            supabase.from(TABLE).select().eq('repo', repo)
        );
        if (!result || result.error) return local;
        const rows = Array.isArray(result.data) ? result.data : [];
        const own = rows.filter(function (r) { return r && r.user_id === userId; });
        const remote = fromRow((own.length ? own : rows)[0]);
        const merged = mergeProgress(local, remote);
        if (merged && merged !== local) setBookProgress(repo, merged);
        return merged;
    } catch (e) {
        return local;
    }
}

// ── abandoned chapters ──

// Chapters left part-read this session: `repo` → Map(chapterId → entry).
const staged = new Map();
let sessionHooked = false;

function stagedFor(repo) {
    if (!staged.has(repo)) staged.set(repo, new Map());
    return staged.get(repo);
}

// Write the session's staged chapters at its end — the page hidden or unloaded.
function hookSessionEnd() {
    if (sessionHooked || typeof document === 'undefined') return;
    sessionHooked = true;
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') commitAbandoned();
    });
    if (typeof window !== 'undefined') window.addEventListener('pagehide', commitAbandoned);
}

// The reader left `chapterId` having read `pct` of it, last at `paraIndex`: under
// ABANDON_PCT it is staged, otherwise anything staged for it is dropped.
export function noteChapterLeft(repo, chapterId, paraIndex, pct) {
    if (!repo || typeof chapterId !== 'string' || !chapterId) return;
    const share = Math.min(1, Math.max(0, Number(pct) || 0));
    const map = stagedFor(repo);
    if (share >= ABANDON_PCT) { map.delete(chapterId); return; }
    map.set(chapterId, {
        chapter_id: chapterId,
        para_index: Math.max(0, Math.floor(Number(paraIndex) || 0)),
        pct: share,
    });
    hookSessionEnd();
}

// The reader is back in `chapterId` this session: it is no longer staged.
export function noteChapterOpened(repo, chapterId) {
    if (!repo || !staged.has(repo)) return;
    staged.get(repo).delete(chapterId);
}

// The reader has read `pct` of `chapterId`; past ABANDON_PCT its stored
// abandonment, if any, is cleared.
export function noteChapterReached(repo, chapterId, pct) {
    if (!repo || !chapterId || !(Number(pct) >= ABANDON_PCT)) return;
    const stored = getBookAbandon(repo);
    if (!Object.prototype.hasOwnProperty.call(stored, chapterId)) return;
    delete stored[chapterId];
    setBookAbandon(repo, stored);
}

// End the session: write every staged chapter to the local map and unstage it.
export function commitAbandoned() {
    staged.forEach(function (map, repo) {
        if (!map.size) return;
        const stored = getBookAbandon(repo);
        map.forEach(function (entry, id) { stored[id] = entry; });
        setBookAbandon(repo, stored);
    });
    staged.clear();
}

// The repo's abandoned chapters by id: `{ [chapterId]: { chapter_id,
// para_index, pct } }`.
export function readAbandoned(repo) {
    return getBookAbandon(repo);
}

// Drop any pending upsert and its timer, and the staged chapters. A test seam.
export function resetBookProgress() {
    if (timer) { clearTimeout(timer); timer = null; }
    pending = null;
    staged.clear();
}
