// Loads a repo's code book (src-book.json) and answers the shelf's questions of
// it: how many chapters, how long a read, and how many chapters have gone stale.
//
// The generator compiles `codebook.json` into `src-book.json` beside the source
// manifest on each deploy, so the file lives at the repo's Pages URL. It is
// fetched once per repo per session; any failure (404, network, bad JSON)
// resolves to null, and the Understanding view then shows its "No book yet"
// state. Everything below the loader is pure, mirroring codeTours.js.

import { pagesUrlFor } from './structureRemoteCapture.js';

const bookCache = new Map();

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

// The repo's compiled book `{ title, chapters }`, or null when it has none.
export function loadBook(repo) {
    if (bookCache.has(repo)) return bookCache.get(repo);
    const base = pagesUrlFor(repo);
    let p;
    if (!base || typeof fetch !== 'function') {
        p = Promise.resolve(null);
    } else {
        p = Promise.resolve()
            .then(function () { return fetch(base + 'src-book.json', { cache: 'no-cache' }); })
            .then(function (res) { return res && res.ok ? res.json() : null; })
            .then(normalizeBook)
            .catch(function () { return null; });
    }
    bookCache.set(repo, p);
    return p;
}

// Drop the per-session cache — after a book run lands, and as a test seam.
export function resetBookCache() {
    bookCache.clear();
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
