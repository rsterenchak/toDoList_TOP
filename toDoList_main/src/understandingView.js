// The UNDERSTANDING view — the repo's code book as a shelf and a reader. The
// shelf is a header with the chapter count, total reading time and a
// generate/stale control, a continue card resuming the saved reading position,
// then the ordered chapter list. The Continue card's Read button and every
// chapter row open the reader: one chapter at a time, its references as chips
// that open the code viewer at that definition, a forward-reference callout
// (whose promised-symbol chips jump to where the later chapter covers each, the
// back chip returning to where the reader left), and a prev/next bar. Rationale sentences show whether the book can back them: a
// cited one ends in a `§` chip opening its source, an inferred one is muted. A `map` chapter (the book's table of contents for the code)
// opens the book as chapter 00 and reads as a tree instead of paragraphs: each
// area, its front-door files with their purposes, and their names with roles.
//
// The book is the `src-book.json` the generator compiles from `codebook.json` and
// publishes beside the source manifest (loaded through codeBook.js). The repo is
// resolved from the selected project exactly as the Structure view resolves it,
// with the same two empty states. The reading position lives in bookProgress.js
// (local + Supabase); the reader mode itself is not persisted, so reopening the
// tab shows the shelf.
//
// The shelf lists chapters only; the guided code tours are offered in the
// reader, where they're useful: a GO DEEPER block at the end of each chapter
// lists that chapter's tours, and an All tours chip in the reader's top bar opens
// the All tours sheet. A tour plays docked in the reader's code pane on desktop
// and as a full-screen sheet below; Structure keeps only its per-area map row.
//
// Any paragraph can be bookmarked — a ribbon on hover (desktop) or a long-press
// (touch). Bookmarks live in bookBookmarks.js (local + Supabase); the reader's
// top bar lists them and the shelf shows them under the chapters.
//
// Any paragraph can also be flagged as one that didn't land — a flag button
// beside the ribbon on hover (desktop), or Flag in the long-press sheet (touch),
// opens a sheet of four kinds and a note. Flags live in bookFlags.js (local +
// Supabase); the shelf lists the open ones after the bookmarks, with a Copy that
// puts them on the clipboard as markdown for a chat. A chapter left part-read
// and not returned to that session shows `left at ¶n` on its shelf row (the rule
// lives in bookProgress.js).
//
// The reader's Ask chip opens the Claude chat scoped to the open chapter: its
// identity, its prose and its de-duplicated refs ride as `book_scope` on every
// turn (see buildBookScope), and a scoped reply's code names open back here.
//
// Generating runs through the Worker's book dispatch. The in-flight state lives
// at module scope (not on the view element), so leaving and re-entering the view
// — or a project switch — repaints "Generating…" for the same repo unchanged. It
// is driven by the book-scoped active_runs probe. When the run settles, the
// published book is re-checked every 30s (up to 10 min, absorbing the deploy and
// the Pages CDN lag) until it differs from the pre-run copy, then swapped in.
//
// The shelf also re-checks the published book on entering the tab and on
// returning from the reader, and its repo chip re-checks on tap. A changed book
// re-renders the shelf with a "Book updated" toast; an open reader is never
// interrupted — its back chip gets a dot and the new book applies on return.

import { resolveProjectRepo } from './seedTasksModal.js';
import { loadBook, revalidateBook, isBookCached, bookStats } from './codeBook.js';
import { getCachedTargets, fetchActiveRuns, dispatchBook, mintEntryId, isInjectConfigured, showInjectToast } from './inject.js';
import { showConfirmModal } from './modals.js';
import { loadManifest, openChatWithBookScope } from './claudeSheet.js';
import { joinSrcRootPath } from './srcPath.js';
import { renderCodeViewer, clearCodeViewer, onCodeViewerChange, setCodeViewerCloseHandler } from './codeViewer.js';
import { createCodeSheet } from './codeSheet.js';
import { readLocalProgress, recordProgress, flushProgress, loadProgress, noteChapterLeft, noteChapterOpened, noteChapterReached, readAbandoned } from './bookProgress.js';
import { listBookmarks, isBookmarked, toggleBookmark, removeBookmark, loadBookmarks, anchorBookmarks } from './bookBookmarks.js';
import { FLAG_KINDS, DEFAULT_FLAG_KIND, flagBadge, flagExcerpt, chapterBookSha, openFlags, openFlagFor, saveFlag, resolveFlag, deleteFlag, loadFlags, anchorFlags, flagsMarkdown } from './bookFlags.js';
import { loadTours, orderedTours, tourStats } from './codeTours.js';
import { openTourPlayer, closeTourPlayer } from './tourPlayer.js';
import { getTourProgress } from './prefs.js';

// Probe cadence and limits for a tracked book run, matching the scan tracker's.
const BOOK_POLL_MS = 5000;
// A run that never registers with active_runs is treated as settled after this.
const BOOK_GRACE_MS = 30 * 1000;
// A book rewrites every chapter, so it outlasts a scan; give up after this.
const BOOK_HARD_CAP_MS = 15 * 60 * 1000;

// After a run settles, re-check the published book this often, for this long.
const BOOK_WATCH_MS = 30 * 1000;
const BOOK_WATCH_CAP_MS = 10 * 60 * 1000;
const LAG_NOTE = 'The published copy lags the commit by a deploy (~1 min).';

// How long a touch must rest on a paragraph to open its Bookmark / Flag sheet.
const BOOKMARK_LONG_PRESS_MS = 500;
// How long a paragraph reached from a bookmark keeps its amber outline.
const BOOKMARK_PULSE_MS = 1000;

const ASK_GLYPH =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 5h16v11H9l-5 4z"/>' +
    '</svg>';

const RIBBON_GLYPH =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6 3h12v18l-6-4.5L6 21z"/>' +
    '</svg>';

const FLAG_GLYPH =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5 21V4h11l-2 4 2 4H5"/>' +
    '</svg>';

// The tracked book run: `{ repo, seenActive, graceDeadline, hardDeadline }`, or
// null when none is in flight.
let bookRun = null;
let poller = null;
// The repo whose run last settled, so the shelf can say the new copy is on its way.
let finishedRepo = null;
// Bumped on every render so a late book load can't paint over a newer render.
let renderSeq = 0;
// The post-run re-check `{ repo, deadline }` and its interval, or null.
let bookWatch = null;
let watcher = null;
// The repo the painted shelf shows, or null when the shelf isn't showing.
let shelfRepo = null;
// Set on leaving the tab or the reader: the next shelf render re-checks the book.
let revalidateNext = true;
// The open reader `{ view, repo, book, index, paraIndex, observer, scroll, main,
// codePane, marksBtn, marksBadge, marksList }`, or null while the shelf shows.
let reader = null;
// The loaded tours `{ repo, data, areas }` — `data` null when the repo has none.
let tourData = null;

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// The selected project's name from the sidebar — the same source of truth the
// Structure view uses. '' when nothing is selected.
function getSelectedProjectName() {
    const selected = document.querySelector('.selectedProject');
    if (!selected) return '';
    const input = selected.querySelector('#projInput');
    return input ? (input.value || '').trim() : '';
}

// The full inject target (repo + file_path) for a repo string, falling back to a
// repo-only target the Worker resolves itself.
function resolveTarget(repo) {
    const targets = getCachedTargets();
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] && targets[i].repo === repo) return targets[i];
    }
    return { repo: repo };
}

// Same unlinked-repo glyph the Structure view shows in its no-repo state.
const LINK_OFF_GLYPH =
    '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 17H7A5 5 0 0 1 7 7h2"/>' +
    '<path d="M15 7h2a5 5 0 0 1 4 8"/>' +
    '<line x1="8" y1="12" x2="12" y2="12"/>' +
    '<line x1="2" y1="2" x2="22" y2="22"/>' +
    '</svg>';

// The no-project / no-repo notice, in the Structure view's empty-state treatment.
function appendEmptyState(view, text, glyphMarkup) {
    const empty = document.createElement('div');
    empty.className = 'structureEmptyState understandingEmptyState';
    if (glyphMarkup) {
        const glyph = document.createElement('span');
        glyph.className = 'structureEmptyGlyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.innerHTML = glyphMarkup;
        empty.appendChild(glyph);
    }
    const msg = document.createElement('span');
    msg.textContent = text;
    empty.appendChild(msg);
    view.appendChild(empty);
    return empty;
}

function isViewActive() {
    const mainBar = document.getElementById('mainBar');
    return !!mainBar && mainBar.getAttribute('data-view') === 'understanding';
}

// ── book-run tracking ──

function stopPolling() {
    if (poller) { clearInterval(poller); poller = null; }
}

function settleRun() {
    const repo = bookRun ? bookRun.repo : null;
    bookRun = null;
    stopPolling();
    finishedRepo = repo;
    if (isViewActive() && !reader) renderUnderstandingView();
    if (repo) startBookWatch(repo);
}

// ── published-book re-check ──

function stopBookWatch() {
    if (watcher) { clearInterval(watcher); watcher = null; }
}

function endBookWatch() {
    stopBookWatch();
    bookWatch = null;
}

function watchOnce() {
    const watch = bookWatch;
    if (!watch) { stopBookWatch(); return; }
    if (Date.now() >= watch.deadline) { endBookWatch(); return; }
    revalidateBook(watch.repo).then(function (res) {
        if (bookWatch !== watch || !res || !res.changed) return;
        endBookWatch();
        if (finishedRepo === watch.repo) finishedRepo = null;
        applyBookChange(watch.repo, res.book);
    });
}

function ensureBookWatch() {
    if (!watcher && bookWatch) watcher = setInterval(watchOnce, BOOK_WATCH_MS);
}

// Re-check `repo`'s published book now and every 30s until it differs from the
// cached (pre-run) copy or the cap runs out.
function startBookWatch(repo) {
    endBookWatch();
    bookWatch = { repo: repo, deadline: Date.now() + BOOK_WATCH_CAP_MS };
    watchOnce();
    ensureBookWatch();
}

// The cache now holds a changed `book` for `repo`: repaint the shelf showing it
// with a toast, or flag an open reader without interrupting it.
function applyBookChange(repo, book) {
    if (reader) {
        if (reader.repo === repo) markReaderUpdated(book);
        return;
    }
    if (!isViewActive() || shelfRepo !== repo) return;
    renderUnderstandingView();
    showInjectToast('Book updated');
}

// The shelf repo chip's tap: re-check the published book, spinning meanwhile.
function checkBookNow(repo, chip) {
    if (chip.disabled) return;
    chip.disabled = true;
    chip.classList.add('is-checking');
    chip.setAttribute('aria-busy', 'true');
    revalidateBook(repo).then(function (res) {
        chip.disabled = false;
        chip.classList.remove('is-checking');
        chip.removeAttribute('aria-busy');
        if (res && res.changed) {
            if (finishedRepo === repo) finishedRepo = null;
            applyBookChange(repo, res.book);
        } else if (res && res.failed) {
            showInjectToast('Couldn’t check the book', 'error');
        } else {
            showInjectToast('Up to date');
        }
    });
}

function pollOnce() {
    const run = bookRun;
    if (!run) { stopPolling(); return; }
    if (Date.now() >= run.hardDeadline) { settleRun(); return; }
    Promise.resolve(fetchActiveRuns(resolveTarget(run.repo), 'book')).then(function (res) {
        if (bookRun !== run) return;             // settled or replaced mid-flight
        if (!res || res.ok === false) return;    // transient — retry next tick
        if (res.active) { run.seenActive = true; return; }
        if (run.seenActive || Date.now() >= run.graceDeadline) settleRun();
    });
}

function ensurePolling() {
    if (!poller && bookRun) poller = setInterval(pollOnce, BOOK_POLL_MS);
}

function startTracking(repo, seenActive) {
    const now = Date.now();
    bookRun = {
        repo: repo,
        seenActive: !!seenActive,
        graceDeadline: now + BOOK_GRACE_MS,
        hardDeadline: now + BOOK_HARD_CAP_MS,
    };
    finishedRepo = null;
    ensurePolling();
}

// One ambient probe on entering the view, so a book run started elsewhere (another
// device, a prior session) still reads as Generating… here.
function probeForRun(repo) {
    if (bookRun || !isInjectConfigured()) return;
    Promise.resolve(fetchActiveRuns(resolveTarget(repo), 'book')).then(function (res) {
        if (bookRun || !res || res.ok === false || !res.active) return;
        startTracking(repo, true);
        if (isViewActive() && !reader) renderUnderstandingView();
    });
}

async function startBookRun(repo, scope, btn, note) {
    btn.disabled = true;
    const res = await dispatchBook(scope, mintEntryId(), resolveTarget(repo));
    if (!res || res.ok === false) {
        btn.disabled = false;
        note.textContent = 'Couldn’t start the book run' + (res && res.reason ? ' — ' + res.reason : '.');
        note.hidden = false;
        return;
    }
    startTracking(repo, false);
    if (isViewActive() && !reader) renderUnderstandingView();
}

// ── shelf ──

// The header's right-hand control for the book's current state.
function buildControl(repo, book, stats, note) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'understandingControl';
    if (bookRun && bookRun.repo === repo) {
        btn.classList.add('is-generating');
        btn.textContent = 'Generating…';
        btn.disabled = true;
        return btn;
    }
    if (!book) {
        btn.classList.add('is-generate');
        btn.textContent = 'Generate';
        btn.addEventListener('click', function () { startBookRun(repo, 'all', btn, note); });
    } else if (stats.stale > 0) {
        btn.classList.add('is-stale');
        btn.textContent = stats.stale + ' STALE';
        btn.setAttribute('aria-label', 'Regenerate ' + stats.stale + ' stale chapter' + (stats.stale === 1 ? '' : 's'));
        btn.addEventListener('click', function () { startBookRun(repo, 'stale', btn, note); });
    } else {
        btn.classList.add('is-regenerate');
        btn.textContent = 'Regenerate';
        btn.addEventListener('click', function () {
            showConfirmModal({
                message: 'Regenerate the whole book? Every chapter is rewritten.',
                confirmLabel: 'Regenerate',
                danger: false,
                onConfirm: function () { startBookRun(repo, 'all', btn, note); },
            });
        });
    }
    if (!isInjectConfigured()) btn.disabled = true;
    return btn;
}

function pad2(n) {
    return n < 10 ? '0' + n : String(n);
}

// A map chapter (the generated names-and-roles list) opens the book as
// chapter 0, so the prose chapters keep their 1-based numbers after it.
function isMapChapter(ch) {
    return !!ch && ch.kind === 'map';
}

// The number chapter `i` of `book` is shown as.
function chapterNum(book, i) {
    return isMapChapter(book.chapters[0]) ? i : i + 1;
}

// A stale chapter's tag: DRIFT when the only thing wrong is that the code it
// describes changed under it (every warning a `drift:` one), else STALE.
function staleTag(ch) {
    const drift = Array.isArray(ch.drift) ? ch.drift : [];
    const warnings = Array.isArray(ch.warnings) ? ch.warnings : [];
    const onlyDrift = drift.length > 0 && warnings.every(function (w) { return String(w).indexOf('drift: ') === 0; });
    return onlyDrift ? 'DRIFT' : 'STALE';
}

// The symbol a drift entry's `file:symbol` (or bare file) key names.
function driftLabel(entry) {
    const key = String((entry && entry.ref) || '');
    const colon = key.indexOf(':');
    return colon === -1 ? key.split('/').pop() : key.slice(colon + 1);
}

// ── reading position ──

// Where `progress` puts the reader in `book`: `{ index, paraIndex, pct }` with a
// 0-based chapter index, or null when there is no record or its chapter is gone.
function positionIn(book, progress) {
    if (!book || !progress) return null;
    for (let i = 0; i < book.chapters.length; i++) {
        if (book.chapters[i].id !== progress.chapterId) continue;
        const paras = Array.isArray(book.chapters[i].paragraphs) ? book.chapters[i].paragraphs.length : 0;
        const paraIndex = Math.min(progress.paraIndex || 0, Math.max(0, paras - 1));
        return { index: i, paraIndex: paraIndex, pct: Number(progress.pct) || 0 };
    }
    return null;
}

// Minutes still to read from chapter `index` at `pct` through the end: the
// remaining chapters' minutes plus the unread fraction of the current one.
function minutesLeft(book, index, pct) {
    let left = (Number(book.chapters[index].minutes) || 0) * (1 - (pct || 0));
    for (let i = index + 1; i < book.chapters.length; i++) left += Number(book.chapters[i].minutes) || 0;
    return Math.max(0, Math.ceil(left - 1e-9));
}

// ── shelf ──

function buildProgressBar(className, fillClassName, value, label) {
    const bar = document.createElement('div');
    bar.className = className;
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(value));
    if (label) bar.setAttribute('aria-label', label);
    const fill = document.createElement('div');
    fill.className = fillClassName;
    fill.style.width = value + '%';
    bar.appendChild(fill);
    return bar;
}

function buildContinueCard(view, repo, book, stats, pos) {
    const at = pos ? pos.index : 0;
    const chapter = book.chapters[at];
    const card = document.createElement('section');
    card.className = 'understandingContinue';
    card.setAttribute('aria-label', 'Continue reading');

    const eyebrow = document.createElement('div');
    eyebrow.className = 'understandingContinueEyebrow';
    eyebrow.textContent = (pos ? 'CONTINUE' : 'START') + ' · CH ' + chapterNum(book, at) + ' OF ' + chapterNum(book, stats.chapters - 1);
    card.appendChild(eyebrow);

    const title = document.createElement('div');
    title.className = 'understandingContinueTitle';
    title.textContent = chapter.title || '';
    card.appendChild(title);

    // How far into this chapter the reader is.
    card.appendChild(buildProgressBar('understandingProgress', 'understandingProgressFill',
        pos ? Math.round(pos.pct * 100) : 0));

    const foot = document.createElement('div');
    foot.className = 'understandingContinueFoot';
    const mins = document.createElement('span');
    mins.className = 'understandingContinueMinutes';
    mins.textContent = pos
        ? '~' + minutesLeft(book, at, pos.pct) + ' MIN LEFT'
        : '~' + (Number(chapter.minutes) || 0) + ' MIN';
    foot.appendChild(mins);
    const read = document.createElement('button');
    read.type = 'button';
    read.className = 'understandingReadBtn';
    read.textContent = 'Read';
    read.addEventListener('click', function () {
        openReader(view, repo, book, at, pos ? pos.paraIndex : 0);
    });
    foot.appendChild(read);
    card.appendChild(foot);
    return card;
}

function buildChapterList(view, repo, book, pos) {
    const abandoned = readAbandoned(repo);
    const list = document.createElement('ol');
    list.className = 'understandingChapters';
    book.chapters.forEach(function (ch, i) {
        const row = document.createElement('li');
        row.className = 'understandingChapterRow';
        row.dataset.chapterId = ch.id;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'understandingChapterBtn';

        const num = document.createElement('span');
        num.className = 'understandingChapterNum';
        num.textContent = pad2(chapterNum(book, i));
        btn.appendChild(num);

        const title = document.createElement('span');
        title.className = 'understandingChapterTitle';
        title.textContent = ch.title || ch.id;
        btn.appendChild(title);

        const meta = document.createElement('span');
        if (ch.stale === true) {
            meta.className = 'understandingChapterStale';
            meta.textContent = staleTag(ch);
        } else if (pos && i < pos.index) {
            meta.className = 'understandingChapterDone';
            meta.textContent = '✓';
            meta.setAttribute('aria-label', 'Read');
        } else {
            meta.className = 'understandingChapterMinutes';
            meta.textContent = (Number(ch.minutes) || 0) + ' MIN';
        }
        // A chapter left part-read in an earlier session says where.
        const left = Object.prototype.hasOwnProperty.call(abandoned, ch.id) ? abandoned[ch.id] : null;
        if (left) {
            const at = document.createElement('span');
            at.className = 'understandingChapterLeft';
            at.textContent = 'left at ¶' + (left.para_index + 1);
            btn.appendChild(at);
        }
        btn.appendChild(meta);
        btn.addEventListener('click', function () {
            // The chapter the reader is part-way through resumes where it left off.
            openReader(view, repo, book, i, pos && pos.index === i ? pos.paraIndex : 0);
        });
        row.appendChild(btn);
        list.appendChild(row);
    });
    return list;
}

// ── bookmarks ──

function ribbonEl(className) {
    const el = document.createElement('span');
    el.className = className;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = RIBBON_GLYPH;
    return el;
}

// A list of `bookmarks` anchored to `book`: one row per bookmark — ribbon, label,
// `CH n` — in book order, then the bookmarks whose chapter is gone under a muted
// REMOVED CHAPTER heading, each with a delete control. `grouped` adds a heading
// per chapter (the reader's list); the shelf lists the rows flat.
// `onOpen(index, paraIndex, inRange)` opens a row; `onDeleted()` follows a delete.
function buildBookmarkList(repo, book, bookmarks, grouped, onOpen, onDeleted) {
    const anchored = anchorBookmarks(book, bookmarks);
    const wrap = document.createElement('div');
    wrap.className = 'understandingBookmarkGroups';
    let list = null;
    function ensureList() {
        if (!list) {
            list = document.createElement('ol');
            list.className = 'understandingBookmarks';
            wrap.appendChild(list);
        }
        return list;
    }
    anchored.groups.forEach(function (group) {
        if (grouped) {
            const head = document.createElement('div');
            head.className = 'understandingBookmarkGroup';
            head.textContent = 'CH ' + chapterNum(book, group.index) + ' · ' + (group.chapter.title || group.chapter.id);
            wrap.appendChild(head);
            list = null;
        }
        group.items.forEach(function (item) {
            const row = document.createElement('li');
            row.className = 'understandingBookmarkRow';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'understandingBookmarkBtn';
            btn.appendChild(ribbonEl('understandingBookmarkRibbon'));
            const label = document.createElement('span');
            label.className = 'understandingBookmarkLabel';
            label.textContent = item.bookmark.label;
            btn.appendChild(label);
            const ch = document.createElement('span');
            ch.className = 'understandingBookmarkCh';
            ch.textContent = 'CH ' + chapterNum(book, group.index);
            btn.appendChild(ch);
            btn.addEventListener('click', function () { onOpen(group.index, item.paraIndex, item.inRange); });
            row.appendChild(btn);
            ensureList().appendChild(row);
        });
    });
    if (anchored.removed.length) {
        const head = document.createElement('div');
        head.className = 'understandingBookmarkGroup is-removed';
        head.textContent = 'REMOVED CHAPTER';
        wrap.appendChild(head);
        const removedList = document.createElement('ol');
        removedList.className = 'understandingBookmarks is-removed';
        anchored.removed.forEach(function (b) {
            const row = document.createElement('li');
            row.className = 'understandingBookmarkRow is-removed';
            row.appendChild(ribbonEl('understandingBookmarkRibbon'));
            const label = document.createElement('span');
            label.className = 'understandingBookmarkLabel';
            label.textContent = b.label;
            row.appendChild(label);
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'understandingBookmarkDelete';
            del.textContent = '✕';
            del.setAttribute('aria-label', 'Delete bookmark: ' + b.label);
            del.addEventListener('click', function () {
                showConfirmModal({
                    message: 'Delete this bookmark? Its chapter is no longer in the book, so it can’t be marked again.',
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: function () {
                        removeBookmark(repo, b.chapterId, b.paraIndex);
                        onDeleted();
                    },
                });
            });
            row.appendChild(del);
            removedList.appendChild(row);
        });
        wrap.appendChild(removedList);
    }
    return wrap;
}

// The shelf's BOOKMARKS · n section, or null when the repo has none.
function buildBookmarkSection(view, repo, book) {
    const bookmarks = listBookmarks(repo);
    if (!bookmarks.length) return null;
    const section = document.createElement('section');
    section.className = 'understandingBookmarkSection';
    section.setAttribute('aria-label', 'Bookmarks');
    const head = document.createElement('div');
    head.className = 'understandingBookmarkHead';
    head.textContent = 'BOOKMARKS · ' + bookmarks.length;
    section.appendChild(head);
    section.appendChild(buildBookmarkList(repo, book, bookmarks, false, function (index, paraIndex, inRange) {
        openReader(view, repo, book, index, paraIndex);
        if (inRange) pulseParagraph(paraIndex);
    }, function () { renderUnderstandingView(); }));
    return section;
}

// ── flags ──

// A flag's kind badge.
function flagBadgeEl(kind) {
    const el = document.createElement('span');
    el.className = 'understandingFlagBadge';
    el.textContent = flagBadge(kind);
    return el;
}

// The shelf's FLAGS · n section, or null when the repo has no open flags: a
// header with Copy, then the open flags grouped by chapter in book order — kind
// badge, note (or excerpt), `CH n ¶m` — each opening its paragraph, each with a
// resolve control. Flags whose chapter is gone follow under REMOVED CHAPTER.
function buildFlagSection(view, repo, book) {
    const flags = openFlags(repo);
    if (!flags.length) return null;
    const section = document.createElement('section');
    section.className = 'understandingFlagSection';
    section.setAttribute('aria-label', 'Flags');
    const head = document.createElement('div');
    head.className = 'understandingFlagHead';
    const title = document.createElement('span');
    title.className = 'understandingBookmarkHead';
    title.textContent = 'FLAGS · ' + flags.length;
    head.appendChild(title);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'understandingFlagCopy';
    copy.textContent = 'Copy';
    copy.setAttribute('aria-label', 'Copy open flags as markdown');
    copy.addEventListener('click', function () {
        copyFlags(flagsMarkdown(book, openFlags(repo), function (i) { return chapterNum(book, i); }));
    });
    head.appendChild(copy);
    section.appendChild(head);

    const anchored = anchorFlags(book, flags);
    const onResolved = function () { renderUnderstandingView(); };
    function addRows(list, items, chLabelOf, onOpen) {
        items.forEach(function (item) {
            const f = item.flag;
            const row = document.createElement('li');
            row.className = 'understandingBookmarkRow understandingFlagRow';
            const text = f.note || f.excerpt;
            const btn = document.createElement(onOpen ? 'button' : 'span');
            if (onOpen) btn.type = 'button';
            btn.className = 'understandingBookmarkBtn understandingFlagBtnRow';
            btn.appendChild(flagBadgeEl(f.kind));
            const label = document.createElement('span');
            label.className = 'understandingBookmarkLabel' + (f.note ? '' : ' is-excerpt');
            label.textContent = text;
            btn.appendChild(label);
            const ch = document.createElement('span');
            ch.className = 'understandingBookmarkCh';
            ch.textContent = chLabelOf + ' ¶' + (f.paraIndex + 1);
            btn.appendChild(ch);
            if (onOpen) btn.addEventListener('click', function () { onOpen(item); });
            row.appendChild(btn);
            const resolve = document.createElement('button');
            resolve.type = 'button';
            resolve.className = 'understandingFlagResolve';
            resolve.textContent = '✓';
            resolve.setAttribute('aria-label', 'Resolve flag: ' + text);
            resolve.addEventListener('click', function () {
                resolveFlag(repo, f);
                onResolved();
            });
            row.appendChild(resolve);
            list.appendChild(row);
        });
    }
    const wrap = document.createElement('div');
    wrap.className = 'understandingBookmarkGroups';
    anchored.groups.forEach(function (group) {
        const gh = document.createElement('div');
        gh.className = 'understandingBookmarkGroup';
        gh.textContent = 'CH ' + chapterNum(book, group.index) + ' · ' + (group.chapter.title || group.chapter.id);
        wrap.appendChild(gh);
        const list = document.createElement('ol');
        list.className = 'understandingBookmarks';
        addRows(list, group.items, 'CH ' + chapterNum(book, group.index), function (item) {
            openReader(view, repo, book, group.index, item.paraIndex);
            if (item.inRange) pulseParagraph(item.paraIndex);
        });
        wrap.appendChild(list);
    });
    if (anchored.removed.length) {
        const gh = document.createElement('div');
        gh.className = 'understandingBookmarkGroup is-removed';
        gh.textContent = 'REMOVED CHAPTER';
        wrap.appendChild(gh);
        const list = document.createElement('ol');
        list.className = 'understandingBookmarks is-removed';
        addRows(list, anchored.removed.map(function (f) { return { flag: f }; }), 'CH ?', null);
        wrap.appendChild(list);
    }
    section.appendChild(wrap);
    return section;
}

// Put `text` on the clipboard and say so in a toast.
function copyFlags(text) {
    const done = function () { showInjectToast('Copied'); };
    const fail = function () { showInjectToast('Couldn’t copy', 'error'); };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            Promise.resolve(navigator.clipboard.writeText(text)).then(done, fail);
            return;
        }
    } catch (e) { /* fall through */ }
    fail();
}

function flagSignature(list) {
    return (list || []).map(function (f) {
        return f.chapterId + '#' + f.paraIndex + '#' + f.createdAt + '#' + f.kind + '#' + f.note + '#' + (f.resolvedAt || '');
    }).sort().join('|');
}

function bookmarkSignature(list) {
    return (list || []).map(function (b) { return b.chapterId + '#' + b.paraIndex + '#' + b.label; }).sort().join('|');
}

function paintShelf(view, repo, book, progress) {
    const hasBook = !!(book && book.chapters.length);
    const stats = bookStats(hasBook ? book : null);

    const header = document.createElement('div');
    header.className = 'understandingHeader';

    const repoChip = document.createElement('button');
    repoChip.type = 'button';
    repoChip.className = 'understandingRepoChip is-refresh';
    repoChip.textContent = repo;
    repoChip.title = 'Check for an updated book';
    repoChip.setAttribute('aria-label', repo + ' — check for an updated book');
    repoChip.addEventListener('click', function () { checkBookNow(repo, repoChip); });
    header.appendChild(repoChip);

    const statsEl = document.createElement('span');
    statsEl.className = 'understandingStats';
    statsEl.textContent = stats.chapters + ' CH · ' + stats.minutes + ' MIN';
    header.appendChild(statsEl);

    const note = document.createElement('div');
    note.className = 'understandingNote';
    note.hidden = true;

    header.appendChild(buildControl(repo, hasBook ? book : null, stats, note));
    view.appendChild(header);
    view.appendChild(note);

    // Everything below the header scrolls on its own, so the header stays fixed.
    const body = document.createElement('div');
    body.className = 'understandingShelfBody';
    const shelf = document.createElement('div');
    shelf.className = 'understandingShelf';
    body.appendChild(shelf);
    view.appendChild(body);

    const generating = !!(bookRun && bookRun.repo === repo);
    if (!generating && finishedRepo === repo) {
        note.textContent = 'Book run finished. ' + LAG_NOTE;
        note.hidden = false;
    }

    if (!hasBook) {
        const empty = appendEmptyState(shelf, 'No book yet.');
        const hint = document.createElement('span');
        hint.className = 'understandingEmptyHint';
        hint.textContent = generating
            ? 'Generating the book. ' + LAG_NOTE
            : 'Generate writes the book’s chapters from this repo’s source. ' + LAG_NOTE;
        empty.appendChild(hint);
        return;
    }

    if (book.title) {
        const title = document.createElement('h2');
        title.className = 'understandingBookTitle';
        title.textContent = book.title;
        shelf.appendChild(title);
    }
    const pos = positionIn(book, progress);
    shelf.appendChild(buildContinueCard(view, repo, book, stats, pos));
    shelf.appendChild(buildChapterList(view, repo, book, pos));
    const marks = buildBookmarkSection(view, repo, book);
    if (marks) shelf.appendChild(marks);
    const flags = buildFlagSection(view, repo, book);
    if (flags) shelf.appendChild(flags);
}

// ── tours ──

// The loaded tours for `repo`, or null while loading / when it has none.
function toursFor(repo) {
    return tourData && tourData.repo === repo && tourData.data ? tourData.data : null;
}

function tourAreaName(id) {
    const areas = tourData && tourData.areas;
    const a = (areas || []).find(function (x) { return x && x.id === id; });
    return a && a.name ? a.name : id;
}

// Fetch `repo`'s tours (and its areas, for the player's chips), then repaint
// the reader's tour surfaces — unless a newer render, for another repo, has taken
// over. The reader opening off this shelf is not a takeover.
function loadTourData(repo, seq) {
    return Promise.resolve(loadTours(repo)).then(function (data) {
        if (seq !== renderSeq && !(reader && reader.repo === repo)) return;
        const has = !!(data && Array.isArray(data.tours) && data.tours.length);
        const prevAreas = tourData && tourData.repo === repo ? tourData.areas : null;
        tourData = { repo: repo, data: has ? data : null, areas: prevAreas };
        paintReaderTours();
        if (!has || prevAreas) return;
        return Promise.resolve(loadManifest(repo)).then(function (manifest) {
            if (tourData && tourData.repo === repo && manifest && Array.isArray(manifest.areas)) {
                tourData.areas = manifest.areas;
            }
        }, function () {});
    }, function () {});
}

function tourGlyph(rec, tour) {
    const g = document.createElement('span');
    g.setAttribute('aria-hidden', 'true');
    if (rec && rec.done) {
        g.className = 'tourGlyph is-done';
        g.textContent = '✓';
    } else if (rec && rec.step > 0) {
        g.className = 'tourGlyph is-progress';
    } else {
        g.className = 'tourGlyph';
    }
    g.dataset.tour = tour.id;
    return g;
}

// `step k / N` for a tour part-way through, else `N steps`.
function tourMeta(rec, tour) {
    return rec && !rec.done && rec.step > 0
        ? 'step ' + Math.min(rec.step + 1, tour.steps.length) + ' / ' + tour.steps.length
        : tour.steps.length + ' steps';
}

// The reader's All tours chip and the open chapter's GO DEEPER block follow the
// loaded tours and their stored progress; called whenever either changes.
function paintReaderTours() {
    const r = reader;
    if (!r) return;
    const data = toursFor(r.repo);
    const progress = getTourProgress(r.repo);
    const stats = data ? tourStats(data, progress) : null;
    if (stats) {
        r.toursBtn.setAttribute('aria-label', 'All tours, ' + stats.done + ' of ' + stats.total + ' done');
        if (!r.toursBtn.parentNode) r.top.insertBefore(r.toursBtn, r.marksBtn);
    } else {
        r.toursBtn.remove();
    }
    if (r.deeperEl) fillGoDeeper(r.deeperEl, r.column, r.book.chapters[r.index], data, progress);
}

// GO DEEPER · n TOURS: one row per tour the chapter's `tours` names that the
// loaded tours resolve, in that order. A chapter's `tours` holds ids or `{ id }`
// refs. The block closes `column`, and only while the chapter has tours.
function fillGoDeeper(block, column, ch, data, progress) {
    clear(block);
    const byId = new Map();
    (data ? data.tours : []).forEach(function (t) { byId.set(t.id, t); });
    const tours = (ch && Array.isArray(ch.tours) ? ch.tours : []).map(function (ref) {
        return byId.get(ref && typeof ref === 'object' ? ref.id : ref);
    }).filter(Boolean);
    if (!tours.length) {
        block.remove();
        return;
    }
    if (!block.parentNode) column.appendChild(block);
    const eyebrow = document.createElement('div');
    eyebrow.className = 'understandingGoDeeperEyebrow';
    eyebrow.textContent = 'GO DEEPER · ' + tours.length + (tours.length === 1 ? ' TOUR' : ' TOURS');
    block.appendChild(eyebrow);
    const list = document.createElement('ol');
    list.className = 'understandingGoDeeperList';
    tours.forEach(function (t) {
        const rec = progress[t.id];
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'understandingTourRow';
        if (rec && rec.done) btn.classList.add('is-done');
        btn.dataset.tour = t.id;
        btn.appendChild(tourGlyph(rec, t));
        const title = document.createElement('span');
        title.className = 'understandingTourRowTitle';
        title.textContent = t.title;
        btn.appendChild(title);
        const meta = document.createElement('span');
        meta.className = 'understandingTourRowMeta';
        meta.textContent = rec && !rec.done && rec.step > 0 ? tourMeta(rec, t) : t.steps.length + ' STEPS';
        btn.appendChild(meta);
        btn.addEventListener('click', function () {
            startReaderTour(t, rec && !rec.done ? rec.step : 0);
        });
        li.appendChild(btn);
        list.appendChild(li);
    });
    block.appendChild(list);
}

// Open a tour step's span in the reader's code viewer — the pane on desktop, the
// code sheet below — joined to the manifest's srcRoot as the reader's refs are.
function openTourStepInCode(r, step, span) {
    return Promise.resolve(loadManifest(r.repo)).then(function (manifest) {
        if (reader !== r) return;
        const srcRoot = manifest && typeof manifest.srcRoot === 'string' ? manifest.srcRoot : '';
        const host = understandingIsDesktop() ? ensureCodePane() : codeSheet.ensure();
        if (!host) return;
        renderCodeViewer(host, {
            target: { repo: r.repo },
            filePath: joinSrcRootPath(srcRoot, step.file),
            srcRoot: srcRoot,
            startLine: span.startLine,
            endLine: span.endLine,
            banner: step.title,
        });
    });
}

// Play `tour` from `step`: docked in the reader's code pane on desktop, a
// full-screen sheet below 1024px. The reader keeps its chapter and position.
function startReaderTour(tour, step) {
    const r = reader;
    if (!r || !tour) return;
    const docked = understandingIsDesktop() ? ensureCodePane() : null;
    openTourPlayer({
        tour: tour,
        repo: r.repo,
        startStep: step,
        host: docked,
        areaName: tourAreaName,
        onOpenInCode: function (st, span) { openTourStepInCode(r, st, span); },
        onClose: function () {
            if (reader !== r) return;
            // A pane the tour opened just for itself goes with it.
            if (docked && r.codePane === docked) {
                const cv = docked.querySelector(':scope > .codeViewerPane');
                if (!cv || cv.hidden) closeCodePane();
            }
            paintReaderTours();
        },
    });
}

// The All tours sheet, on the shared code-sheet chrome.
const toursSheet = createCodeSheet({
    id: 'understandingToursSheet',
    label: 'All tours',
    className: 'understandingToursSheet',
});

// The All tours sheet: overall progress, then each section's tours with their
// state. A row starts (or resumes) that tour and closes the sheet.
function openAllToursSheet() {
    const r = reader;
    const data = r ? toursFor(r.repo) : null;
    if (!data) return;
    const host = toursSheet.ensure();
    if (!host) return;
    const repo = r.repo;
    const progress = getTourProgress(repo);
    const stats = tourStats(data, progress);
    clear(host);

    const panel = document.createElement('div');
    panel.className = 'tourAllSheet';

    const head = document.createElement('div');
    head.className = 'tourAllHead';
    const h = document.createElement('h2');
    h.className = 'tourAllTitle';
    h.textContent = 'Learn this codebase';
    head.appendChild(h);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tourAllClose';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function () { toursSheet.hide(); });
    head.appendChild(closeBtn);
    panel.appendChild(head);

    const bar = document.createElement('div');
    bar.className = 'tourAllProgress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(stats.total));
    bar.setAttribute('aria-valuenow', String(stats.done));
    const fill = document.createElement('span');
    fill.className = 'tourAllProgressFill';
    fill.style.width = (stats.total ? Math.round((stats.done / stats.total) * 100) : 0) + '%';
    bar.appendChild(fill);
    panel.appendChild(bar);
    const summary = document.createElement('div');
    summary.className = 'tourAllSummary';
    summary.textContent = stats.done + ' of ' + stats.total + ' tours done';
    panel.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'tourAllList';
    const ordered = orderedTours(data);
    const sections = (data.sections || []).slice();
    const known = new Set(sections.map(function (sec) { return sec.id; }));
    if (ordered.some(function (t) { return !known.has(t.section); })) sections.push({ id: null, title: 'More' });

    sections.forEach(function (sec) {
        const tours = ordered.filter(function (t) {
            return sec.id === null ? !known.has(t.section) : t.section === sec.id;
        });
        if (!tours.length) return;
        const block = document.createElement('section');
        block.className = 'tourAllSection';
        const st = document.createElement('div');
        st.className = 'tourAllSectionHead';
        const name = document.createElement('span');
        name.textContent = sec.title || sec.id;
        st.appendChild(name);
        const cnt = document.createElement('span');
        cnt.className = 'tourAllSectionCount';
        cnt.textContent = tours.filter(function (t) { return progress[t.id] && progress[t.id].done; }).length + ' / ' + tours.length;
        st.appendChild(cnt);
        block.appendChild(st);
        tours.forEach(function (t) {
            const rec = progress[t.id];
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'tourAllRow';
            row.dataset.tour = t.id;
            row.appendChild(tourGlyph(rec, t));
            const title = document.createElement('span');
            title.className = 'tourAllRowTitle';
            title.textContent = t.title;
            row.appendChild(title);
            const meta = document.createElement('span');
            meta.className = 'tourAllRowMeta';
            meta.textContent = tourMeta(rec, t);
            row.appendChild(meta);
            row.addEventListener('click', function () {
                toursSheet.hide();
                startReaderTour(t, rec && !rec.done ? rec.step : 0);
            });
            block.appendChild(row);
        });
        list.appendChild(block);
    });
    panel.appendChild(list);
    host.appendChild(panel);
    toursSheet.show();
    closeBtn.focus();
}

// Drop the shelf's All tours sheet. A full-screen tour sheet is left to its own
// close.
function teardownShelf() {
    toursSheet.hide();
}

// ── reader ──

// The reader's code pane sits beside the column at the same >1023px breakpoint
// the Structure view's detail column uses; below it a ref opens the full-screen
// sheet.
function understandingIsDesktop() {
    return typeof window !== 'undefined' && window.innerWidth > 1023;
}

const codeSheet = createCodeSheet({
    id: 'understandingCodeSheet',
    label: 'Chapter source',
    isDesktop: understandingIsDesktop,
});
onCodeViewerChange(codeSheet.sync);

// Closing the viewer in the sheet dismisses the sheet; closing it in the desktop
// pane removes the pane, so the reader widens back. Other views' hosts fall through.
setCodeViewerCloseHandler(function (host) {
    if (host && host === codeSheet.host()) {
        codeSheet.hide();
        return true;
    }
    if (reader && reader.codePane && host === reader.codePane) {
        closeCodePane();
        return true;
    }
    return false;
});

function ensureCodePane() {
    if (!reader) return null;
    if (reader.codePane) return reader.codePane;
    const pane = document.createElement('div');
    pane.className = 'understandingCodePane';
    reader.body.appendChild(pane);
    reader.body.classList.add('has-code');
    reader.codePane = pane;
    return pane;
}

function closeCodePane() {
    if (!reader || !reader.codePane) return;
    const pane = reader.codePane;
    reader.codePane = null;
    // A tour docked in the pane closes with it.
    if (pane.classList.contains('is-touring')) closeTourPlayer();
    clearCodeViewer(pane);
    pane.remove();
    reader.body.classList.remove('has-code');
}

// Open a `{ label, file, symbol, line, end }` ref in the code viewer. The file is
// manifest-relative, so it is joined to the manifest's srcRoot — the same cached
// manifest the Structure view loads.
function openRef(ref) {
    const r = reader;
    if (!r || !ref || !ref.file) return Promise.resolve();
    return Promise.resolve(loadManifest(r.repo)).then(function (manifest) {
        if (reader !== r) return;
        const srcRoot = manifest && typeof manifest.srcRoot === 'string' ? manifest.srcRoot : '';
        const host = understandingIsDesktop() ? ensureCodePane() : codeSheet.ensure();
        if (!host) return;
        const opts = { target: { repo: r.repo }, filePath: joinSrcRootPath(srcRoot, ref.file), srcRoot: srcRoot };
        // A file ref (no symbol) opens the file cold, with no span; a citation
        // opens at its line.
        if (ref.symbol || ref.cite) {
            opts.startLine = ref.line;
            opts.endLine = ref.end;
            opts.banner = ref.label;
        }
        renderCodeViewer(host, opts);
    });
}

// The chat scope for chapter `index` of `book`: `{ repo, chapter: { id, title,
// index (1-based), total }, prose, refs }`. Each paragraph flattens to plain text
// with its ref chips read as their labels and an inferred rationale sentence
// tagged ` [inferred]`; refs are the chapter's unique
// `{ file, symbol, line, end, label }` by file + symbol, in first-seen order.
export function buildBookScope(repo, book, index) {
    const chapters = book && Array.isArray(book.chapters) ? book.chapters : [];
    const ch = chapters[index];
    if (!ch) return null;
    const prose = [];
    const refs = [];
    const seen = {};
    (Array.isArray(ch.paragraphs) ? ch.paragraphs : []).forEach(function (segments) {
        const segs = Array.isArray(segments) ? segments : [{ t: String(segments || '') }];
        let text = '';
        segs.forEach(function addSeg(seg) {
            if (seg && seg.why && typeof seg.why === 'object') {
                (Array.isArray(seg.why.segs) ? seg.why.segs : []).forEach(addSeg);
                if (seg.why.kind === 'inferred') text += ' [inferred]';
            } else if (seg && seg.ref && typeof seg.ref === 'object') {
                const ref = seg.ref;
                text += String(ref.label || ref.symbol || ref.file || '');
                if (!ref.file) return;
                const key = ref.file + '\u0000' + (ref.symbol || '');
                if (seen[key]) return;
                seen[key] = true;
                const out = { file: ref.file, symbol: ref.symbol || '', label: String(ref.label || ref.symbol || ref.file) };
                if (ref.line != null) out.line = ref.line;
                if (ref.end != null) out.end = ref.end;
                refs.push(out);
            } else if (seg && typeof seg.t === 'string') {
                text += seg.t;
            }
        });
        prose.push(text);
    });
    return {
        repo: repo,
        chapter: { id: ch.id, title: ch.title || ch.id, index: index + 1, total: chapters.length },
        prose: prose,
        refs: refs,
    };
}

// Open the chat scoped to the chapter on screen.
function askAboutChapter() {
    const r = reader;
    if (!r) return;
    const scope = buildBookScope(r.repo, r.book, r.index);
    if (scope) openChatWithBookScope(scope);
}

// Open a scoped chat reply's code chip `{ repo, file, symbol, line, end, label }`
// in the reader's code pane / sheet. Returns false (leaving it to the caller's
// fallback) unless the Understanding view is showing that repo's reader.
export function openBookRefInReader(ref) {
    if (!ref || !reader || !isViewActive() || ref.repo !== reader.repo) return false;
    openRef(ref);
    return true;
}

function buildRefChip(ref) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'bookRef';
    const label = String(ref.label || ref.symbol || ref.file || '');
    chip.textContent = label;
    chip.setAttribute('aria-label', 'Open ' + label + ' in code');
    chip.addEventListener('click', function () { openRef(ref); });
    return chip;
}

// The sheet a `rule` / `req` citation opens on: the quoted fragment and its
// source document.
const citeSheet = createCodeSheet({
    id: 'understandingCiteSheet',
    label: 'Citation',
    className: 'understandingBookmarksSheet understandingCiteSheet',
});

function openCiteSheet(cite) {
    const host = citeSheet.ensure();
    if (!host) return;
    clear(host);
    const head = document.createElement('div');
    head.className = 'understandingMarksHead';
    const title = document.createElement('span');
    title.className = 'understandingMarksTitle';
    title.textContent = cite.type === 'req'
        ? 'REQUIREMENT · ' + String(cite.label || '')
        : String(cite.file || 'CLAUDE.md') + (cite.line ? ' · LINE ' + cite.line : '');
    head.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'understandingMarksClose';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close citation');
    close.addEventListener('click', function () { citeSheet.hide(); });
    head.appendChild(close);
    host.appendChild(head);
    const quote = document.createElement('blockquote');
    quote.className = 'understandingCiteQuote';
    quote.textContent = String(cite.text || '');
    host.appendChild(quote);
    citeSheet.show();
}

const CITE_KIND_LABEL = { src: 'code comment', rule: 'CLAUDE.md rule', req: 'requirement', commit: 'commit' };

// The `§ label` chip after a cited sentence: a `src` chip opens the commented
// line in the code pane / sheet, a `rule` / `req` chip the citation sheet, and
// a `commit` chip is inert — the generator cannot check a hash.
function buildCiteChip(cite) {
    const label = String(cite.label || cite.file || cite.text || '');
    if (cite.type === 'commit') {
        const chip = document.createElement('span');
        chip.className = 'bookCite is-unverified';
        chip.textContent = '§ ' + label;
        chip.title = 'Unverified — commit ' + String(cite.text || label) + ' is not checked';
        return chip;
    }
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'bookCite';
    chip.textContent = '§ ' + label;
    chip.setAttribute('aria-label', 'Open citation: ' + (CITE_KIND_LABEL[cite.type] || 'source') + ' ' + label);
    chip.addEventListener('click', function () {
        if (cite.type === 'src') openRef({ label: label, file: cite.file, symbol: null, line: cite.line, end: cite.line, cite: true });
        else openCiteSheet(cite);
    });
    return chip;
}

function appendSegments(el, segs) {
    (Array.isArray(segs) ? segs : []).forEach(function (seg) {
        if (seg && seg.why && typeof seg.why === 'object') {
            el.appendChild(buildWhy(seg.why));
        } else if (seg && seg.ref && typeof seg.ref === 'object') {
            el.appendChild(buildRefChip(seg.ref));
        } else if (seg && typeof seg.t === 'string') {
            el.appendChild(document.createTextNode(seg.t));
        }
    });
}

// A rationale sentence: cited ones carry a citation chip, inferred ones are set
// muted with a dotted underline and say so on hover.
function buildWhy(why) {
    const kind = why.kind === 'cited' || why.kind === 'unverified' ? why.kind : 'inferred';
    const span = document.createElement('span');
    span.className = 'why why--' + kind;
    if (kind === 'inferred') span.title = 'Inferred — not backed by a comment, rule or requirement';
    appendSegments(span, why.segs);
    if (kind !== 'inferred' && why.cite && typeof why.cite === 'object') {
        span.appendChild(document.createTextNode(' '));
        span.appendChild(buildCiteChip(why.cite));
    }
    return span;
}

function buildParagraph(segments, index) {
    const p = document.createElement('p');
    p.className = 'understandingPara';
    p.dataset.paraIndex = String(index);
    appendSegments(p, Array.isArray(segments) ? segments : [{ t: String(segments || '') }]);
    return p;
}

// One row of a map chapter: its symbol's chip beside the authored role. The
// compiler emits each entry as `[{ ref }, { t: ' — ' + role }]`.
function buildMapRow(segments, index) {
    const row = document.createElement('li');
    row.className = 'understandingMapRow';
    row.dataset.paraIndex = String(index);
    const segs = Array.isArray(segments) ? segments : [];
    const ref = segs.find(function (seg) { return seg && seg.ref && typeof seg.ref === 'object'; });
    const name = document.createElement('span');
    name.className = 'understandingMapName';
    if (ref) name.appendChild(buildRefChip(ref.ref));
    row.appendChild(name);
    const role = document.createElement('span');
    role.className = 'understandingMapRole';
    role.textContent = segs.filter(function (seg) { return seg && typeof seg.t === 'string'; })
        .map(function (seg) { return seg.t; }).join('').replace(/^\s*—\s*/, '');
    row.appendChild(role);
    return row;
}

// One chip · text row of a hierarchical map, as a `tag` element.
function buildMapEntry(tag, className, ref, text, index) {
    const row = document.createElement(tag);
    row.className = 'understandingMapRow ' + className;
    row.dataset.paraIndex = String(index);
    const name = document.createElement('span');
    name.className = 'understandingMapName';
    if (ref && typeof ref === 'object') name.appendChild(buildRefChip(ref));
    row.appendChild(name);
    if (text) {
        const role = document.createElement('span');
        role.className = 'understandingMapRole';
        role.textContent = String(text);
        row.appendChild(role);
    }
    return row;
}

// A hierarchical map chapter (its compiled `sections`): each area as a header
// over its purpose, its front-door files as chip · purpose rows, and each
// file's names as chip · role rows indented beneath. Rows are numbered — and
// pushed onto `rows` — in the compiler's paragraph order, each file then its
// names, so the reading position tracks them like paragraphs.
function buildMapTree(sections, rows) {
    const tree = document.createElement('div');
    tree.className = 'understandingMapTree';
    sections.forEach(function (sec) {
        const area = sec && sec.area && typeof sec.area === 'object' ? sec.area : {};
        const block = document.createElement('section');
        block.className = 'understandingMapArea';
        const head = document.createElement('h3');
        head.className = 'understandingMapAreaName';
        head.textContent = area.name || area.id || '';
        block.appendChild(head);
        if (area.purpose) {
            const purpose = document.createElement('div');
            purpose.className = 'understandingMapAreaPurpose';
            purpose.textContent = area.purpose;
            block.appendChild(purpose);
        }
        const files = document.createElement('ol');
        files.className = 'understandingMapFiles';
        (Array.isArray(sec.files) ? sec.files : []).forEach(function (fr) {
            const item = document.createElement('li');
            item.className = 'understandingMapFile';
            const fileRow = buildMapEntry('div', 'understandingMapFileRow', fr.ref, fr.purpose, rows.length);
            rows.push(fileRow);
            item.appendChild(fileRow);
            const syms = Array.isArray(fr.symbols) ? fr.symbols : [];
            if (syms.length) {
                const list = document.createElement('ol');
                list.className = 'understandingMapSymbols';
                syms.forEach(function (sym) {
                    const symRow = buildMapEntry('li', 'understandingMapSymbolRow', sym.ref, sym.role, rows.length);
                    rows.push(symRow);
                    list.appendChild(symRow);
                });
                item.appendChild(list);
            }
            files.appendChild(item);
        });
        block.appendChild(files);
        tree.appendChild(block);
    });
    return tree;
}

// Reflect a paragraph's bookmark state on it and its ribbon.
function paintParaMark(p, marked) {
    p.classList.toggle('is-bookmarked', marked);
    const ribbon = p.querySelector(':scope > .understandingRibbon');
    if (ribbon) {
        ribbon.setAttribute('aria-pressed', marked ? 'true' : 'false');
        ribbon.setAttribute('aria-label', marked ? 'Remove bookmark' : 'Bookmark this paragraph');
    }
}

// Mark or unmark paragraph `index` of the open chapter. Neither scroll nor the
// reading position moves.
function toggleParaMark(p, segments, index) {
    const r = reader;
    if (!r) return;
    const ch = r.book.chapters[r.index];
    const res = toggleBookmark(r.repo, ch.id, index, segments);
    paintParaMark(p, res.marked);
    paintMarksChip();
}

// Reflect a paragraph's flag state on it and its flag button.
function paintParaFlag(p, flagged) {
    p.classList.toggle('is-flagged', flagged);
    const btn = p.querySelector(':scope > .understandingFlagBtn');
    if (btn) {
        btn.setAttribute('aria-pressed', flagged ? 'true' : 'false');
        btn.setAttribute('aria-label', flagged ? 'Edit flag' : 'Flag this paragraph');
    }
}

// Give paragraph `p` its ribbon and flag button (hover-revealed on desktop, a
// tap target once set) and the ~500ms long-press that opens its Bookmark / Flag
// sheet on touch.
function wireParaMark(p, segments, index) {
    const r = reader;
    const chapterId = r.book.chapters[r.index].id;
    const flagBtn = document.createElement('button');
    flagBtn.type = 'button';
    flagBtn.className = 'understandingFlagBtn';
    flagBtn.innerHTML = FLAG_GLYPH;
    flagBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        openFlagSheet(p, segments, index);
    });
    p.appendChild(flagBtn);
    paintParaFlag(p, !!openFlagFor(r.repo, chapterId, index));
    const ribbon = document.createElement('button');
    ribbon.type = 'button';
    ribbon.className = 'understandingRibbon';
    ribbon.innerHTML = RIBBON_GLYPH;
    ribbon.addEventListener('click', function (event) {
        event.stopPropagation();
        toggleParaMark(p, segments, index);
    });
    p.appendChild(ribbon);
    paintParaMark(p, isBookmarked(r.repo, chapterId, index));

    let lpTimer = null;
    let lpStartX = 0;
    let lpStartY = 0;
    let lpFired = false;
    function cancel() {
        if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
    }
    p.addEventListener('touchstart', function (event) {
        if (event.touches.length !== 1) { cancel(); return; }
        const t = event.touches[0];
        lpStartX = t.clientX;
        lpStartY = t.clientY;
        lpFired = false;
        cancel();
        lpTimer = setTimeout(function () {
            lpTimer = null;
            lpFired = true;
            openParaActions(p, segments, index);
        }, BOOKMARK_LONG_PRESS_MS);
    }, { passive: true });
    p.addEventListener('touchmove', function (event) {
        if (!lpTimer) return;
        const t = event.touches[0];
        if (Math.abs(t.clientX - lpStartX) > 10 || Math.abs(t.clientY - lpStartY) > 10) cancel();
    }, { passive: true });
    p.addEventListener('touchend', function (event) {
        cancel();
        if (lpFired) {
            // The long-press opened the sheet — swallow the tap that would follow
            // (a chip opening, or the sheet's backdrop closing it straight away).
            event.preventDefault();
            lpFired = false;
        }
    });
    p.addEventListener('touchcancel', cancel);
}

// ── paragraph actions and the flag sheet ──

// The touch long-press sheet: Bookmark and Flag for one paragraph.
const paraSheet = createCodeSheet({
    id: 'understandingParaSheet',
    label: 'Paragraph actions',
    className: 'understandingBookmarksSheet understandingParaSheet',
});

// The flag sheet: four kinds, a note, and Save / Cancel (plus Resolve and
// Delete when the paragraph already carries an open flag).
const flagSheet = createCodeSheet({
    id: 'understandingFlagSheet',
    label: 'Flag paragraph',
    className: 'understandingBookmarksSheet understandingFlagSheet',
});

// A sheet header: `titleText` and a ✕ that runs `onClose`.
function sheetHead(titleText, closeLabel, onClose) {
    const head = document.createElement('div');
    head.className = 'understandingMarksHead';
    const title = document.createElement('span');
    title.className = 'understandingMarksTitle';
    title.textContent = titleText;
    head.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'understandingMarksClose';
    close.textContent = '✕';
    close.setAttribute('aria-label', closeLabel);
    close.addEventListener('click', onClose);
    head.appendChild(close);
    return head;
}

function paraLabel(index) {
    const r = reader;
    return 'CH ' + chapterNum(r.book, r.index) + ' ¶' + (index + 1);
}

// Open paragraph `index`'s action sheet: Bookmark (one tap toggles it) and Flag.
function openParaActions(p, segments, index) {
    const r = reader;
    if (!r) return;
    const host = paraSheet.ensure();
    if (!host) return;
    clear(host);
    const chapterId = r.book.chapters[r.index].id;
    host.appendChild(sheetHead(paraLabel(index), 'Close', function () { paraSheet.hide(); }));
    const actions = document.createElement('div');
    actions.className = 'understandingParaActions';
    const marked = isBookmarked(r.repo, chapterId, index);
    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'understandingParaAction';
    mark.innerHTML = RIBBON_GLYPH;
    mark.appendChild(document.createTextNode(marked ? 'Remove bookmark' : 'Bookmark'));
    mark.addEventListener('click', function () {
        paraSheet.hide();
        toggleParaMark(p, segments, index);
    });
    actions.appendChild(mark);
    const flagged = !!openFlagFor(r.repo, chapterId, index);
    const flag = document.createElement('button');
    flag.type = 'button';
    flag.className = 'understandingParaAction';
    flag.innerHTML = FLAG_GLYPH;
    flag.appendChild(document.createTextNode(flagged ? 'Edit flag' : 'Flag'));
    flag.addEventListener('click', function () {
        paraSheet.hide();
        openFlagSheet(p, segments, index);
    });
    actions.appendChild(flag);
    host.appendChild(actions);
    paraSheet.show();
}

// After a flag changes: the paragraph, the chapter's flag count.
function afterFlagChange(p, index) {
    const r = reader;
    if (!r) return;
    paintParaFlag(p, !!openFlagFor(r.repo, r.book.chapters[r.index].id, index));
    paintChapterFlags();
}

// Open the flag sheet for paragraph `index`, pre-filled from its open flag.
function openFlagSheet(p, segments, index) {
    const r = reader;
    if (!r) return;
    const host = flagSheet.ensure();
    if (!host) return;
    clear(host);
    const ch = r.book.chapters[r.index];
    const existing = openFlagFor(r.repo, ch.id, index);
    const hide = function () { flagSheet.hide(); };
    host.appendChild(sheetHead('FLAG · ' + paraLabel(index), 'Close flag', hide));

    const body = document.createElement('div');
    body.className = 'understandingFlagForm';
    const quote = document.createElement('div');
    quote.className = 'understandingFlagExcerpt';
    quote.textContent = existing ? existing.excerpt : flagExcerpt(segments);
    body.appendChild(quote);

    let kind = existing ? existing.kind : DEFAULT_FLAG_KIND;
    const kinds = document.createElement('div');
    kinds.className = 'understandingFlagKinds';
    kinds.setAttribute('role', 'group');
    kinds.setAttribute('aria-label', 'What went wrong');
    const chips = FLAG_KINDS.map(function (k) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'understandingFlagKind';
        chip.dataset.kind = k.id;
        chip.textContent = k.label;
        chip.addEventListener('click', function () {
            kind = k.id;
            chips.forEach(function (c) { c.setAttribute('aria-pressed', c.dataset.kind === kind ? 'true' : 'false'); });
        });
        chip.setAttribute('aria-pressed', k.id === kind ? 'true' : 'false');
        kinds.appendChild(chip);
        return chip;
    });
    body.appendChild(kinds);

    const note = document.createElement('input');
    note.type = 'text';
    note.className = 'understandingFlagNote';
    note.placeholder = 'What did you expect here?';
    note.setAttribute('aria-label', 'Note');
    note.maxLength = 200;
    note.value = existing ? existing.note : '';
    body.appendChild(note);

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
    if (existing) {
        action('Delete', 'is-delete', function () {
            showConfirmModal({
                message: 'Delete this flag? Its kind and note will be lost.',
                confirmLabel: 'Delete',
                danger: true,
                onConfirm: function () {
                    deleteFlag(r.repo, existing);
                    hide();
                    afterFlagChange(p, index);
                },
            });
        });
        action('Resolve', 'is-resolve', function () {
            resolveFlag(r.repo, existing);
            hide();
            afterFlagChange(p, index);
        });
    }
    action('Cancel', 'is-cancel', hide);
    action('Save', 'is-save', function () {
        saveFlag(r.repo, ch.id, index, segments, { kind: kind, note: note.value, bookSha: chapterBookSha(ch) });
        hide();
        afterFlagChange(p, index);
    });
    body.appendChild(actions);
    host.appendChild(body);
    flagSheet.show();
}

// The chapter header's `n flags`, amber, hidden when the chapter has none open.
function paintChapterFlags() {
    const r = reader;
    if (!r || !r.flagsEl) return;
    const id = r.book.chapters[r.index].id;
    const n = openFlags(r.repo).filter(function (f) { return f.chapterId === id; }).length;
    r.flagsEl.textContent = n === 1 ? '1 flag' : n + ' flags';
    r.flagsEl.hidden = n === 0;
}

// Outline paragraph `paraIndex` of the open chapter in amber for a second.
function pulseParagraph(paraIndex) {
    const r = reader;
    if (!r) return;
    const p = r.column.querySelector('.understandingPara[data-para-index="' + paraIndex + '"]');
    if (!p) return;
    p.classList.remove('is-pulse');
    p.classList.add('is-pulse');
    setTimeout(function () { p.classList.remove('is-pulse'); }, BOOKMARK_PULSE_MS);
}

// The top bar's Bookmarks chip: its count badge (hidden at zero) and label.
function paintMarksChip() {
    const r = reader;
    if (!r || !r.marksBtn) return;
    const n = listBookmarks(r.repo).length;
    r.marksBadge.textContent = String(n);
    r.marksBadge.hidden = n === 0;
    r.marksBtn.setAttribute('aria-label', 'Bookmarks, ' + n + ' saved');
}

// The mobile list rides the shared code-sheet chrome as a bottom sheet.
const marksSheet = createCodeSheet({
    id: 'understandingBookmarksSheet',
    label: 'Bookmarks',
    className: 'understandingBookmarksSheet',
});

// Jump from a list row: open its chapter if it isn't showing, bring the
// paragraph into view and pulse it.
function goToBookmark(index, paraIndex, inRange) {
    const r = reader;
    if (!r) return;
    closeMarksList();
    if (index !== r.index) {
        showChapter(index, paraIndex);
    } else {
        const p = r.column.querySelector('.understandingPara[data-para-index="' + paraIndex + '"]');
        if (paraIndex === 0) r.scroll.scrollTop = 0;
        else if (p && typeof p.scrollIntoView === 'function') p.scrollIntoView({ block: 'start' });
    }
    if (inRange) pulseParagraph(paraIndex);
}

// The list's contents: a header with a close button, then the rows (or a hint).
function fillMarksList(host, onClose) {
    const r = reader;
    clear(host);
    const head = document.createElement('div');
    head.className = 'understandingMarksHead';
    const title = document.createElement('span');
    title.className = 'understandingMarksTitle';
    const bookmarks = listBookmarks(r.repo);
    title.textContent = 'BOOKMARKS · ' + bookmarks.length;
    head.appendChild(title);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'understandingMarksClose';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close bookmarks');
    close.addEventListener('click', onClose);
    head.appendChild(close);
    host.appendChild(head);
    if (!bookmarks.length) {
        const empty = document.createElement('div');
        empty.className = 'understandingMarksEmpty';
        empty.textContent = understandingIsDesktop()
            ? 'No bookmarks yet — hover a paragraph and click its ribbon.'
            : 'No bookmarks yet — long-press a paragraph to mark it.';
        host.appendChild(empty);
        return;
    }
    const body = document.createElement('div');
    body.className = 'understandingMarksBody';
    body.appendChild(buildBookmarkList(r.repo, r.book, bookmarks, true, goToBookmark, function () {
        if (reader !== r) return;
        paintMarksChip();
        if (r.marksList) fillMarksList(r.marksList.host, onClose);
    }));
    host.appendChild(body);
}

// Open the bookmark list: a popover under the chip on desktop, the bottom sheet
// on touch. Both close on their ✕, outside the list and Escape.
function openMarksList() {
    const r = reader;
    if (!r) return;
    closeMarksList();
    if (understandingIsDesktop()) {
        const pop = document.createElement('div');
        pop.className = 'understandingMarksPopover';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Bookmarks');
        r.top.appendChild(pop);
        const onDown = function (event) {
            if (pop.contains(event.target) || r.marksBtn.contains(event.target)) return;
            closeMarksList();
        };
        const onKey = function (event) {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeMarksList();
        };
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('touchstart', onDown, true);
        document.addEventListener('keydown', onKey, true);
        r.marksList = {
            host: pop,
            isOpen: function () { return pop.isConnected; },
            close: function () {
                document.removeEventListener('mousedown', onDown, true);
                document.removeEventListener('touchstart', onDown, true);
                document.removeEventListener('keydown', onKey, true);
                pop.remove();
            },
        };
    } else {
        const host = marksSheet.ensure();
        if (!host) return;
        r.marksList = { host: host, isOpen: marksSheet.isOpen, close: function () { marksSheet.hide(); } };
        marksSheet.show();
    }
    r.marksBtn.setAttribute('aria-expanded', 'true');
    fillMarksList(r.marksList.host, closeMarksList);
}

function closeMarksList() {
    const r = reader;
    // The sheet can also be dismissed by its backdrop or Escape, outside this path.
    marksSheet.hide();
    if (!r || !r.marksList) return;
    r.marksList.close();
    r.marksList = null;
    r.marksBtn.setAttribute('aria-expanded', 'false');
}

function chapterIndexById(book, id) {
    for (let i = 0; i < book.chapters.length; i++) {
        if (book.chapters[i].id === id) return i;
    }
    return -1;
}

// Follow a forward reference: remember where the reader is so the back chip
// can return there, then open chapter `index` at `paraIndex`.
function followAhead(index, paraIndex) {
    const r = reader;
    if (!r) return;
    r.backStack.push({ index: r.index, paraIndex: r.paraIndex });
    showChapter(index, paraIndex);
    if (paraIndex > 0) pulseParagraph(paraIndex);
}

// The top bar's back chip: back to the chapter an ahead link was followed from
// while there is one, otherwise back to the shelf.
function paintBackChip() {
    const r = reader;
    if (!r || !r.backBtn) return;
    const from = r.backStack[r.backStack.length - 1];
    if (r.chapterGone) {
        r.backBtn.textContent = '‹ Book updated';
        r.backBtn.setAttribute('aria-label', 'Book updated — back to the shelf');
    } else if (from) {
        r.backBtn.textContent = '‹ CH ' + chapterNum(r.book, from.index);
        r.backBtn.setAttribute('aria-label', 'Back to chapter ' + chapterNum(r.book, from.index));
    } else {
        r.backBtn.textContent = '‹ Shelf';
        r.backBtn.setAttribute('aria-label', 'Back to the shelf');
    }
    r.backBtn.classList.toggle('has-update', !!r.bookUpdated);
    if (r.bookUpdated) {
        const dot = document.createElement('span');
        dot.className = 'understandingBackDot';
        dot.setAttribute('aria-hidden', 'true');
        r.backBtn.appendChild(dot);
        if (!r.chapterGone) r.backBtn.setAttribute('aria-label', r.backBtn.getAttribute('aria-label') + ' — book updated');
    }
}

// A newer book landed while reading: leave the chapter on screen, dot the back
// chip, and send it straight to the shelf when the open chapter is gone.
function markReaderUpdated(book) {
    const r = reader;
    if (!r) return;
    r.bookUpdated = true;
    const id = r.book.chapters[r.index] && r.book.chapters[r.index].id;
    r.chapterGone = !book || chapterIndexById(book, id) < 0;
    paintBackChip();
}

function goBack() {
    const r = reader;
    if (!r) return;
    if (r.chapterGone) { leaveReader(); return; }
    const from = r.backStack.pop();
    if (!from) { leaveReader(); return; }
    showChapter(from.index, from.paraIndex);
}

// The AHEAD callout: eyebrow and note jump to the target chapter's top; each
// promised symbol below is a chip that jumps to the target's first paragraph
// referencing it.
function buildAhead(book, ahead) {
    const target = chapterIndexById(book, ahead.chapter);
    if (target < 0) return null;
    const promises = (Array.isArray(ahead.promises) ? ahead.promises : []).filter(function (p) {
        return p && p.ref && typeof p.ref === 'object';
    });
    const box = document.createElement(promises.length ? 'div' : 'button');
    box.className = 'understandingAhead';
    let link = box;
    if (promises.length) {
        link = document.createElement('button');
        link.className = 'understandingAheadLink';
        box.appendChild(link);
    }
    link.type = 'button';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'understandingAheadEyebrow';
    eyebrow.textContent = 'AHEAD → CH ' + chapterNum(book, target);
    link.appendChild(eyebrow);
    const note = document.createElement('span');
    note.className = 'understandingAheadNote';
    note.textContent = ahead.note || '';
    link.appendChild(note);
    box.addEventListener('click', function () { followAhead(target, 0); });
    if (promises.length) {
        const row = document.createElement('div');
        row.className = 'understandingAheadPromises';
        promises.forEach(function (p) {
            const label = p.ref.label || p.ref.symbol || p.ref.file;
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'understandingAheadPromise';
            chip.textContent = label;
            chip.setAttribute('aria-label', 'Read about ' + label + ' in chapter ' + chapterNum(book, target));
            chip.addEventListener('click', function (event) {
                event.stopPropagation();
                followAhead(target, Math.max(0, Number(p.paraIndex) || 0));
            });
            row.appendChild(chip);
        });
        box.appendChild(row);
    }
    return box;
}

function buildNavButton(side, eyebrowText, titleText, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'understandingNav' + side;
    if (eyebrowText) {
        const eyebrow = document.createElement('span');
        eyebrow.className = 'understandingNavEyebrow';
        eyebrow.textContent = eyebrowText;
        btn.appendChild(eyebrow);
    }
    const title = document.createElement('span');
    title.className = 'understandingNavTitle';
    title.textContent = titleText;
    btn.appendChild(title);
    if (label) btn.setAttribute('aria-label', label);
    return btn;
}

// Paint the reader's whole-book progress and minutes-left for its position.
function paintReaderProgress() {
    const r = reader;
    const chapters = r.book.chapters;
    const ch = chapters[r.index];
    const paras = Array.isArray(ch.paragraphs) ? ch.paragraphs.length : 0;
    const pct = paras ? r.paraIndex / paras : 0;
    const whole = Math.round(((r.index + pct) / chapters.length) * 100);
    r.barFill.style.width = whole + '%';
    r.bar.setAttribute('aria-valuenow', String(whole));
    r.posEl.textContent = 'CH ' + chapterNum(r.book, r.index) + ' OF ' + chapterNum(r.book, chapters.length - 1) + ' · ' + whole + '%';
    r.leftEl.textContent = '~' + minutesLeft(r.book, r.index, pct) + ' MIN LEFT';
}

// Record the reader at paragraph `paraIndex` of the open chapter.
function setPosition(paraIndex) {
    const r = reader;
    if (!r) return;
    const ch = r.book.chapters[r.index];
    const paras = Array.isArray(ch.paragraphs) ? ch.paragraphs.length : 0;
    r.paraIndex = paraIndex;
    recordProgress(r.repo, { chapterId: ch.id, paraIndex: paraIndex, pct: paras ? paraIndex / paras : 0 });
    noteReached(paraIndex);
    paintReaderProgress();
}

// How much of the open chapter the reader has seen: up to paragraph `i`.
function readShare(i) {
    const r = reader;
    const ch = r.book.chapters[r.index];
    const paras = Array.isArray(ch.paragraphs) ? ch.paragraphs.length : 0;
    return paras ? Math.min(1, (i + 1) / paras) : 1;
}

// The reader has seen paragraph `i` of the open chapter; reading far enough
// clears the chapter's stored abandonment.
function noteReached(i) {
    const r = reader;
    if (!r || !(i > r.reached)) return;
    r.reached = i;
    noteChapterReached(r.repo, r.book.chapters[r.index].id, readShare(i));
}

// The reader is leaving the chapter it shows (a chapter switch or the reader
// closing): stage it as abandoned when too little of it was seen.
function departChapter() {
    const r = reader;
    if (!r || r.shownIndex < 0) return;
    const ch = r.book.chapters[r.shownIndex];
    noteChapterLeft(r.repo, ch.id, r.paraIndex, readShare(Math.max(0, r.reached)));
    r.shownIndex = -1;
}

// Track the topmost paragraph at least half visible in the reader's scroller.
function observeParagraphs(paras) {
    const r = reader;
    if (r.observer) { r.observer.disconnect(); r.observer = null; }
    if (typeof IntersectionObserver !== 'function') return;
    const visible = new Set();
    r.observer = new IntersectionObserver(function (entries) {
        if (reader !== r) return;
        entries.forEach(function (entry) {
            const i = Number(entry.target.dataset.paraIndex);
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) visible.add(i);
            else visible.delete(i);
        });
        if (!visible.size) return;
        const top = Math.min.apply(null, Array.from(visible));
        if (top !== r.paraIndex) setPosition(top);
        noteReached(Math.max.apply(null, Array.from(visible)));
    }, { root: r.scroll, threshold: [0, 0.5, 1] });
    paras.forEach(function (p) { r.observer.observe(p); });
}

// Show chapter `index` scrolled to paragraph `paraIndex` (the top for 0).
function showChapter(index, paraIndex) {
    const r = reader;
    if (!r || index < 0 || index >= r.book.chapters.length) return;
    const chapters = r.book.chapters;
    const ch = chapters[index];
    const paragraphs = Array.isArray(ch.paragraphs) ? ch.paragraphs : [];
    if (r.shownIndex !== index) {
        departChapter();
        noteChapterOpened(r.repo, ch.id);
        r.reached = -1;
    }
    r.index = index;
    r.shownIndex = index;
    clear(r.column);

    const eyebrow = document.createElement('div');
    eyebrow.className = 'understandingReaderEyebrow';
    eyebrow.textContent = (isMapChapter(ch) ? 'MAP' : 'CHAPTER ' + chapterNum(r.book, index)) + ' · ' + (Number(ch.minutes) || 0) + ' MIN';
    r.column.appendChild(eyebrow);

    const title = document.createElement('h2');
    title.className = 'understandingReaderTitle';
    title.textContent = ch.title || ch.id;
    r.column.appendChild(title);

    // `n flags` while the chapter has open ones.
    const flagsEl = document.createElement('div');
    flagsEl.className = 'understandingReaderFlags';
    r.column.appendChild(flagsEl);
    r.flagsEl = flagsEl;
    paintChapterFlags();

    // A stale chapter says so, and names the symbols whose code drifted.
    if (ch.stale === true) {
        const flag = document.createElement('div');
        flag.className = 'understandingReaderStale';
        const tag = document.createElement('span');
        tag.className = 'understandingReaderStaleTag';
        tag.textContent = staleTag(ch);
        flag.appendChild(tag);
        (Array.isArray(ch.drift) ? ch.drift : []).forEach(function (d) {
            const chip = document.createElement('span');
            chip.className = 'understandingDriftChip';
            chip.textContent = driftLabel(d);
            chip.title = d.ref + ' — ' + (d.reason === 'both' ? 'body and importers' : d.reason) + ' changed';
            flag.appendChild(chip);
        });
        r.column.appendChild(flag);
    }

    // How much of the chapter's rationale the book can back up.
    const why = ch.rationale && typeof ch.rationale === 'object' ? ch.rationale : null;
    const cited = why ? Number(why.cited) || 0 : 0;
    const inferred = why ? Number(why.inferred) || 0 : 0;
    if (cited || inferred) {
        const counts = document.createElement('div');
        counts.className = 'understandingReaderWhy';
        counts.textContent = cited + ' cited · ' + inferred + ' inferred';
        r.column.appendChild(counts);
    }

    // The forward reference sits after the second paragraph, or at the end of a
    // chapter too short for that to leave text on both sides.
    const ahead = ch.ahead && typeof ch.ahead === 'object' ? buildAhead(r.book, ch.ahead) : null;
    const aheadAfter = paragraphs.length >= 3 ? 1 : paragraphs.length - 1;
    const paraEls = [];
    if (isMapChapter(ch) && Array.isArray(ch.sections) && ch.sections.length) {
        // Areas, their front-door files and those files' names, as a tree.
        r.column.appendChild(buildMapTree(ch.sections, paraEls));
        if (ahead) r.column.appendChild(ahead);
    } else if (isMapChapter(ch)) {
        // A flat map (an older book) reads as a two-column list.
        const list = document.createElement('ol');
        list.className = 'understandingMap';
        paragraphs.forEach(function (segs, i) {
            const row = buildMapRow(segs, i);
            paraEls.push(row);
            list.appendChild(row);
        });
        r.column.appendChild(list);
        if (ahead) r.column.appendChild(ahead);
    } else {
        paragraphs.forEach(function (segs, i) {
            const p = buildParagraph(segs, i);
            wireParaMark(p, segs, i);
            paraEls.push(p);
            r.column.appendChild(p);
            if (ahead && i === aheadAfter) r.column.appendChild(ahead);
        });
        if (ahead && !paragraphs.length) r.column.appendChild(ahead);
    }

    // The chapter's tours, between its last paragraph and the prev/next bar.
    const deeper = document.createElement('section');
    deeper.className = 'understandingGoDeeper';
    deeper.setAttribute('aria-label', 'Go deeper');
    r.deeperEl = deeper;
    paintReaderTours();

    // Prev / next.
    clear(r.nav);
    const prev = index > 0
        ? buildNavButton('Prev', '‹ CH ' + chapterNum(r.book, index - 1), chapters[index - 1].title || chapters[index - 1].id)
        : buildNavButton('Prev', '', '');
    prev.hidden = index === 0;
    prev.addEventListener('click', function () { showChapter(index - 1, 0); });
    r.nav.appendChild(prev);
    const last = index === chapters.length - 1;
    const next = last
        ? buildNavButton('Next', '', 'Back to shelf')
        : buildNavButton('Next', 'CH ' + chapterNum(r.book, index + 1) + ' ›', chapters[index + 1].title || chapters[index + 1].id);
    next.addEventListener('click', function () {
        // Reading on past the end counts as having read the chapter through.
        noteReached(paragraphs.length - 1);
        if (last) leaveReader();
        else showChapter(index + 1, 0);
    });
    r.nav.appendChild(next);

    const at = Math.min(Math.max(0, paraIndex || 0), Math.max(0, paragraphs.length - 1));
    r.scroll.scrollTop = 0;
    if (at > 0 && paraEls[at] && typeof paraEls[at].scrollIntoView === 'function') {
        paraEls[at].scrollIntoView({ block: 'start' });
    }
    setPosition(at);
    observeParagraphs(paraEls);
    paintBackChip();
}

// Swap the shelf for the reader on chapter `index`, resuming at `paraIndex`.
function openReader(view, repo, book, index, paraIndex) {
    // A shelf repaint still in flight must not paint over the reader.
    renderSeq++;
    shelfRepo = null;
    teardownReader();
    teardownShelf();
    clear(view);
    view.classList.add('is-reading');

    const root = document.createElement('div');
    root.className = 'understandingReader';

    const top = document.createElement('div');
    top.className = 'understandingReaderTop';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'understandingBackChip';
    back.addEventListener('click', goBack);
    top.appendChild(back);
    const repoChip = document.createElement('span');
    repoChip.className = 'understandingRepoChip';
    repoChip.textContent = repo;
    top.appendChild(repoChip);
    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.className = 'understandingAskChip';
    askBtn.setAttribute('aria-label', 'Ask about this chapter');
    askBtn.title = 'Ask about this chapter';
    askBtn.innerHTML = ASK_GLYPH;
    askBtn.addEventListener('click', askAboutChapter);
    top.appendChild(askBtn);
    // Mounted left of Bookmarks once the tours load, and never when the repo has
    // none (see paintReaderTours).
    const toursBtn = document.createElement('button');
    toursBtn.type = 'button';
    toursBtn.className = 'understandingReaderToursChip';
    toursBtn.setAttribute('aria-haspopup', 'dialog');
    toursBtn.textContent = 'All tours';
    toursBtn.addEventListener('click', openAllToursSheet);
    const marksBtn = document.createElement('button');
    marksBtn.type = 'button';
    marksBtn.className = 'understandingMarksChip';
    marksBtn.setAttribute('aria-haspopup', 'dialog');
    marksBtn.setAttribute('aria-expanded', 'false');
    marksBtn.innerHTML = RIBBON_GLYPH;
    const marksBadge = document.createElement('span');
    marksBadge.className = 'understandingMarksBadge';
    marksBtn.appendChild(marksBadge);
    marksBtn.addEventListener('click', function () {
        if (reader && reader.marksList && reader.marksList.isOpen()) closeMarksList();
        else openMarksList();
    });
    top.appendChild(marksBtn);
    root.appendChild(top);

    const progress = document.createElement('div');
    progress.className = 'understandingReaderProgress';
    const bar = buildProgressBar('understandingReaderBar', 'understandingReaderBarFill', 0, 'Book progress');
    progress.appendChild(bar);
    const meta = document.createElement('div');
    meta.className = 'understandingReaderMeta';
    const posEl = document.createElement('span');
    posEl.className = 'understandingReaderPos';
    meta.appendChild(posEl);
    const leftEl = document.createElement('span');
    leftEl.className = 'understandingReaderLeft';
    meta.appendChild(leftEl);
    progress.appendChild(meta);
    root.appendChild(progress);

    // The reading column and its prev/next bar, with the desktop code pane beside.
    const body = document.createElement('div');
    body.className = 'understandingReaderBody';
    const main = document.createElement('div');
    main.className = 'understandingReaderMain';
    const scroll = document.createElement('div');
    scroll.className = 'understandingReaderScroll';
    const column = document.createElement('article');
    column.className = 'understandingReaderCol';
    scroll.appendChild(column);
    main.appendChild(scroll);
    const nav = document.createElement('nav');
    nav.className = 'understandingReaderNav';
    nav.setAttribute('aria-label', 'Chapters');
    main.appendChild(nav);
    body.appendChild(main);
    root.appendChild(body);
    view.appendChild(root);

    reader = {
        view: view,
        repo: repo,
        book: book,
        index: index,
        paraIndex: 0,
        observer: null,
        body: body,
        scroll: scroll,
        column: column,
        nav: nav,
        bar: bar,
        barFill: bar.firstChild,
        posEl: posEl,
        leftEl: leftEl,
        codePane: null,
        top: top,
        toursBtn: toursBtn,
        deeperEl: null,
        marksBtn: marksBtn,
        marksBadge: marksBadge,
        marksList: null,
        flagsEl: null,
        // The chapter on screen (-1 before the first) and the furthest paragraph
        // of it seen, for the abandonment rule.
        shownIndex: -1,
        reached: -1,
        backBtn: back,
        // Where each followed ahead link came from; the back chip pops it.
        backStack: [],
        // A newer book was published while reading; and the open chapter is
        // missing from it (the back chip then returns to the shelf).
        bookUpdated: false,
        chapterGone: false,
    };
    paintMarksChip();
    paintBackChip();
    showChapter(index, paraIndex);
    if (!tourData || tourData.repo !== repo) loadTourData(repo, renderSeq);
}

// Drop the open reader's observer and code hosts and send its position. The view
// DOM is left to whoever paints next.
function teardownReader() {
    if (!reader) return;
    departChapter();
    flushProgress();
    if (reader.observer) reader.observer.disconnect();
    closeMarksList();
    citeSheet.hide();
    paraSheet.hide();
    flagSheet.hide();
    closeCodePane();
    if (codeSheet.isOpen()) codeSheet.reset();
    reader.view.classList.remove('is-reading');
    reader = null;
}

// Back to the shelf, re-rendered so its progress marks are current, and with the
// published book re-checked. A newer book that landed while reading applies now.
function leaveReader() {
    if (!reader) return;
    const updated = reader.bookUpdated;
    teardownReader();
    revalidateNext = !updated;
    renderUnderstandingView();
    if (updated) showInjectToast('Book updated');
}

// Render the UNDERSTANDING view's shelf. Safe to call before component() has
// built the shell (a missing #understandingView short-circuits). An open reader
// is left alone unless `{ force: true }` asks for a fresh shelf (a project switch).
export function renderUnderstandingView(opts) {
    const view = document.getElementById('understandingView');
    if (!view) return;
    if (reader && !(opts && opts.force)) return;
    teardownReader();
    teardownShelf();
    const seq = ++renderSeq;
    shelfRepo = null;
    clear(view);

    const projectName = getSelectedProjectName();
    if (!projectName) {
        appendEmptyState(view, 'Select a project to read its code book.');
        return;
    }
    const repo = resolveProjectRepo(projectName);
    if (!repo) {
        appendEmptyState(
            view,
            projectName + ' isn’t linked to a repo — link one in its inject target to read its code book.',
            LINK_OFF_GLYPH
        );
        return;
    }

    if (bookRun && bookRun.repo === repo) ensurePolling();
    else probeForRun(repo);
    if (bookWatch && bookWatch.repo === repo) ensureBookWatch();

    // Entering the tab or returning from the reader re-checks a book already
    // loaded this session; a first load is fresh anyway.
    const revalidate = revalidateNext && isBookCached(repo);
    revalidateNext = false;

    const loading = document.createElement('div');
    loading.className = 'understandingLoading';
    loading.textContent = 'Loading the code book…';
    view.appendChild(loading);

    // The tours load beside the book, ready for the reader's GO DEEPER blocks.
    loadTourData(repo, seq);

    return Promise.resolve(loadBook(repo)).then(function (book) {
        if (seq !== renderSeq) return;
        const local = readLocalProgress(repo);
        const localMarks = bookmarkSignature(listBookmarks(repo));
        const localFlags = flagSignature(openFlags(repo));
        clear(view);
        paintShelf(view, repo, book, local);
        shelfRepo = repo;
        if (revalidate) {
            revalidateBook(repo).then(function (res) {
                if (res && res.changed) applyBookChange(repo, res.book);
            });
        }
        if (!book || !book.chapters.length) return;
        // The synced record may be newer (another device) and the synced bookmarks
        // and flags may differ; repaint when any does.
        return Promise.all([loadProgress(repo), loadBookmarks(repo), loadFlags(repo)]).then(function (res) {
            const merged = res[0];
            if (seq !== renderSeq || reader) return;
            const sameProgress = merged === local ||
                (merged && local && merged.updatedAt === local.updatedAt && merged.chapterId === local.chapterId);
            if (sameProgress && bookmarkSignature(res[1]) === localMarks &&
                flagSignature(openFlags(repo)) === localFlags) return;
            clear(view);
            paintShelf(view, repo, book, merged);
        });
    });
}

// Leaving the view: stop the probe timer (the tracked run itself is kept, so
// re-entering resumes it) — no interval keeps firing behind a hidden tab. An
// open reader is closed and its position sent; the tab reopens on the shelf.
export function exitUnderstandingView() {
    renderSeq++;
    shelfRepo = null;
    revalidateNext = true;
    stopPolling();
    stopBookWatch();
    teardownReader();
    teardownShelf();
}

// Forget any tracked book run, its finished note and the post-run re-check. A
// test seam.
export function resetUnderstandingRun() {
    stopPolling();
    endBookWatch();
    bookRun = null;
    finishedRepo = null;
    revalidateNext = true;
}
