// Guarded localStorage writes, the app's storage size report, and the caps and
// "Clear caches" action for the heavy cache keys.
//
// iOS Safari caps localStorage at roughly 5MB per origin and every key shares
// that quota, so a write can throw QuotaExceededError at any time. safeSetItem
// never throws: it reports the failure through one module-level hook (the UI
// registers a toast at boot via listLogic.setStorageErrorHandler) and returns
// false so the caller carries on — Supabase is the system of record and
// localStorage only a cache. Leaf module: no app imports, so prefs.js,
// listLogic.js and claudeSheet.js can all use it without an import cycle.

// Per-key byte budget for the capped cache keys (reader notes, the Explain /
// code-notes caches). Eviction runs on write, oldest first.
export const CACHE_BYTE_BUDGET = 256 * 1024;

// The cache keys "Clear caches" removes. Everything here is rebuilt from the
// Worker or Supabase on demand; allProjects, prefs and auth are never listed.
const CACHE_KEYS = [
    'todoapp_claudeChat',
    'todoapp_claudeRuns',
    'todoapp_structureExplain',
    'todoapp_codeNotes',
];
// Reader notes are only partly a cache: synced, unedited notes re-merge from
// Supabase on the next shelf render, but an unsynced one exists nowhere else.
// Clearing and eviction drop only the former. Mirrors prefs.js BOOK_NOTES_KEY.
const BOOK_NOTES_KEY = 'todoapp_bookNotes';

let storageErrorHandler = null;

// Register the callback a failed write reports to, as `fn(err, key)`. Pass
// null to unregister.
export function setStorageErrorHandler(fn) {
    storageErrorHandler = typeof fn === 'function' ? fn : null;
}

// Hand a failed write to the registered handler. A throwing handler must never
// turn a swallowed storage error back into a thrown one.
export function reportStorageError(err, key) {
    if (!storageErrorHandler) return;
    try { storageErrorHandler(err, key); } catch (e) { /* handler bug — ignore */ }
}

// localStorage.setItem that returns true on success and false (after logging
// and reporting) when the write throws.
export function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (err) {
        console.error('[storage] ' + key + ' write failed', err);
        reportStorageError(err, key);
        return false;
    }
}

// Bytes a value occupies once serialized — localStorage stores UTF-16, so two
// per code unit.
export function jsonBytes(value) {
    const s = JSON.stringify(value);
    return s === undefined ? 0 : s.length * 2;
}

// The newest `max` items of `list`. Lists are oldest-first unless
// `newestFirst` is set (the run records, which unshift new rows).
export function keepNewest(list, max, newestFirst) {
    if (!Array.isArray(list)) return [];
    if (list.length <= max) return list.slice();
    return newestFirst ? list.slice(0, max) : list.slice(list.length - max);
}

// Drop items from the front of the oldest-first `list` until the sum of
// `itemBytes(item)` fits `budget`. Items `canEvict` rejects are kept and
// skipped over, so the result can stay over budget when nothing else is left
// to drop.
export function trimToByteBudget(list, budget, itemBytes, canEvict) {
    if (!Array.isArray(list)) return [];
    const sizeOf = itemBytes || jsonBytes;
    let total = 0;
    list.forEach(function (item) { total += sizeOf(item); });
    const kept = [];
    list.forEach(function (item) {
        if (total > budget && (!canEvict || canEvict(item))) {
            total -= sizeOf(item);
            return;
        }
        kept.push(item);
    });
    return kept;
}

// A reader note Supabase already holds unchanged, so dropping the local copy
// loses nothing.
export function isEvictableNote(note) {
    return !!(note && note.synced === true && !note.dirty && !note.deleted);
}

// Trim a `{ [repo]: notes[] }` reader-notes store to the byte budget, evicting
// the least recently updated synced notes first across every repo.
export function capBookNotesStore(store, budget) {
    const flat = [];
    Object.keys(store).forEach(function (repo) {
        if (!Array.isArray(store[repo])) return;
        store[repo].forEach(function (note, i) { flat.push({ repo: repo, i: i, note: note }); });
    });
    const stamp = function (e) { return String((e.note && (e.note.updatedAt || e.note.createdAt)) || ''); };
    flat.sort(function (a, b) { return stamp(a) < stamp(b) ? -1 : stamp(a) > stamp(b) ? 1 : 0; });
    const kept = trimToByteBudget(flat, budget,
        function (e) { return jsonBytes(e.note); },
        function (e) { return isEvictableNote(e.note); });
    if (kept.length === flat.length) return store;
    const keep = new Set(kept);
    const out = {};
    Object.keys(store).forEach(function (repo) {
        if (!Array.isArray(store[repo])) { out[repo] = store[repo]; return; }
        const list = flat.filter(function (e) { return e.repo === repo && keep.has(e); })
            .sort(function (a, b) { return a.i - b.i; })
            .map(function (e) { return e.note; });
        if (list.length) out[repo] = list;
    });
    return out;
}

function isAppKey(key) {
    return key === 'allProjects' || (typeof key === 'string' && key.indexOf('todoapp_') === 0);
}

// `[{ key, bytes }]` for allProjects and every todoapp_ key, largest first.
export function appStorageSizes() {
    const out = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!isAppKey(key)) continue;
            const value = localStorage.getItem(key) || '';
            out.push({ key: key, bytes: (key.length + value.length) * 2 });
        }
    } catch (e) { /* storage unavailable — report what we have */ }
    out.sort(function (a, b) { return b.bytes - a.bytes; });
    return out;
}

// Total bytes the app's keys occupy.
export function appStorageBytes() {
    return appStorageSizes().reduce(function (sum, e) { return sum + e.bytes; }, 0);
}

// "512 B", "340 KB", "1.2 MB".
export function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

// Remove the capped cache keys, and the synced reader notes, from this device.
// Returns the number of bytes freed.
export function clearCaches() {
    const before = appStorageBytes();
    CACHE_KEYS.forEach(function (key) {
        try { localStorage.removeItem(key); } catch (e) { /* unavailable */ }
    });
    try {
        const raw = localStorage.getItem(BOOK_NOTES_KEY);
        const store = raw ? JSON.parse(raw) : null;
        if (store && typeof store === 'object') {
            const out = {};
            Object.keys(store).forEach(function (repo) {
                if (!Array.isArray(store[repo])) return;
                const list = store[repo].filter(function (n) { return !isEvictableNote(n); });
                if (list.length) out[repo] = list;
            });
            if (Object.keys(out).length) safeSetItem(BOOK_NOTES_KEY, JSON.stringify(out));
            else localStorage.removeItem(BOOK_NOTES_KEY);
        }
    } catch (e) { /* malformed or unavailable — leave it */ }
    return Math.max(0, before - appStorageBytes());
}
