// Loads a repo's code book (src-book.json) and answers the shelf's questions of
// it: how many chapters, how long a read, and how many chapters have gone stale.
//
// The generator compiles `codebook.json` into `src-book.json` beside the source
// manifest on each deploy, so the file lives at the repo's Pages URL. It is
// fetched once per repo per session; any failure (404, network, bad JSON)
// resolves to null, and the Understanding view then shows its "No book yet"
// state. revalidateBook re-checks the published copy cheaply (a conditional
// fetch on the stored ETag, falling back to a hash of the body) and swaps the
// cached book when it differs. Everything below the loaders is pure, mirroring
// codeTours.js.

import { pagesUrlFor } from './structureRemoteCapture.js';

const bookCache = new Map();
// Per repo, what the cached book was built from: `{ book, etag, hash }`.
const bookMeta = new Map();

function normalizeBook(doc) {
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.chapters)) return null;
    const chapters = doc.chapters.filter(function (c) {
        return c && typeof c.id === 'string' && c.id;
    });
    return {
        title: typeof doc.title === 'string' ? doc.title : '',
        chapters: chapters,
    };
}

// A short fingerprint of a parsed src-book.json, or null when there is none.
function hashDoc(doc) {
    if (doc === null || doc === undefined) return null;
    const text = JSON.stringify(doc);
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ':' + text.length;
}

function etagOf(res) {
    return res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('ETag') : null;
}

// The repo's compiled book `{ title, chapters }`, or null when it has none.
// Cache-first; `{ revalidate: true }` instead resolves revalidateBook's
// `{ book, changed }`.
export function loadBook(repo, opts) {
    if (opts && opts.revalidate) return revalidateBook(repo);
    if (bookCache.has(repo)) return bookCache.get(repo);
    const base = pagesUrlFor(repo);
    let p;
    if (!base || typeof fetch !== 'function') {
        p = Promise.resolve(null);
    } else {
        let etag = null;
        let hash = null;
        p = Promise.resolve()
            .then(function () { return fetch(base + 'src-book.json', { cache: 'no-cache' }); })
            .then(function (res) {
                if (!res || !res.ok) return null;
                etag = etagOf(res);
                return res.json();
            })
            .then(function (doc) {
                hash = hashDoc(doc);
                return normalizeBook(doc);
            })
            .catch(function () { return null; })
            .then(function (book) {
                bookMeta.set(repo, { book: book, etag: etag, hash: hash });
                return book;
            });
    }
    bookCache.set(repo, p);
    return p;
}

// Re-check `repo`'s published book against the cached copy. Resolves
// `{ book, changed }` — `changed` when the published copy differs, in which case
// the cache now holds it — plus `failed: true` when the check itself failed.
// With nothing cached yet this is a plain load (`changed: false`).
export function revalidateBook(repo) {
    if (!bookCache.has(repo)) {
        return loadBook(repo).then(function (book) { return { book: book, changed: false }; });
    }
    return bookCache.get(repo).then(function (current) {
        const base = pagesUrlFor(repo);
        if (!base || typeof fetch !== 'function') return { book: current, changed: false };
        const meta = bookMeta.get(repo) || { book: current, etag: null, hash: null };
        const init = { cache: 'no-cache' };
        if (meta.etag) init.headers = { 'If-None-Match': meta.etag };
        const same = { book: current, changed: false };
        return Promise.resolve()
            .then(function () { return fetch(base + 'src-book.json', init); })
            .then(function (res) {
                if (res && res.status === 304) return same;
                if (!res || !res.ok) {
                    // Still no book is up to date; anything else is a failed check.
                    return res && res.status === 404 && !current ? same : { book: current, changed: false, failed: true };
                }
                const etag = etagOf(res);
                return Promise.resolve(res.json()).then(function (doc) {
                    const hash = hashDoc(doc);
                    const book = normalizeBook(doc);
                    if (hash === meta.hash || (!book && !current)) {
                        if (etag) bookMeta.set(repo, { book: current, etag: etag, hash: meta.hash });
                        return same;
                    }
                    bookCache.set(repo, Promise.resolve(book));
                    bookMeta.set(repo, { book: book, etag: etag, hash: hash });
                    return { book: book, changed: true };
                });
            })
            .catch(function () { return { book: current, changed: false, failed: true }; });
    });
}

// Whether `repo`'s book has been loaded (or is loading) this session.
export function isBookCached(repo) {
    return bookCache.has(repo);
}

// Drop the per-session cache — a test seam.
export function resetBookCache() {
    bookCache.clear();
    bookMeta.clear();
}

// `{ chapters, minutes, stale }` across the book: the chapter count, the summed
// reading minutes, and how many chapters are flagged stale.
export function bookStats(data) {
    const list = data && Array.isArray(data.chapters) ? data.chapters : [];
    let minutes = 0;
    let stale = 0;
    list.forEach(function (c) {
        const m = Number(c && c.minutes);
        if (Number.isFinite(m) && m > 0) minutes += m;
        if (c && c.stale === true) stale++;
    });
    return { chapters: list.length, minutes: minutes, stale: stale };
}
