// The UNDERSTANDING view — the repo's code book as a shelf: a header with the
// chapter count, total reading time and a generate/stale control, a continue card
// for the first chapter, then the ordered chapter list.
//
// The book is the `src-book.json` the generator compiles from `codebook.json` and
// publishes beside the source manifest (loaded through codeBook.js). The repo is
// resolved from the selected project exactly as the Structure view resolves it,
// with the same two empty states. This module is the shelf only: the continue
// card's Read button and the chapter rows render inert; the reader that opens a
// chapter is a separate surface.
//
// Generating runs through the Worker's book dispatch. The in-flight state lives
// at module scope (not on the view element), so leaving and re-entering the view
// — or a project switch — repaints "Generating…" for the same repo unchanged. It
// is driven by the book-scoped active_runs probe; when the run settles the book
// cache is dropped and the shelf re-renders from the freshly published copy.

import { resolveProjectRepo } from './seedTasksModal.js';
import { loadBook, resetBookCache, bookStats } from './codeBook.js';
import { getCachedTargets, fetchActiveRuns, dispatchBook, mintEntryId, isInjectConfigured } from './inject.js';
import { showConfirmModal } from './modals.js';

// Probe cadence and limits for a tracked book run, matching the scan tracker's.
const BOOK_POLL_MS = 5000;
// A run that never registers with active_runs is treated as settled after this.
const BOOK_GRACE_MS = 30 * 1000;
// A book rewrites every chapter, so it outlasts a scan; give up after this.
const BOOK_HARD_CAP_MS = 15 * 60 * 1000;

const LAG_NOTE = 'The published copy lags the commit by a deploy (~1 min).';

// The tracked book run: `{ repo, seenActive, graceDeadline, hardDeadline }`, or
// null when none is in flight.
let bookRun = null;
let poller = null;
// The repo whose run last settled, so the shelf can say the new copy is on its way.
let finishedRepo = null;
// Bumped on every render so a late book load can't paint over a newer render.
let renderSeq = 0;

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
    resetBookCache();
    if (isViewActive()) renderUnderstandingView();
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
        if (isViewActive()) renderUnderstandingView();
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
    if (isViewActive()) renderUnderstandingView();
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

function buildContinueCard(book, stats) {
    const first = book.chapters[0];
    const card = document.createElement('section');
    card.className = 'understandingContinue';
    card.setAttribute('aria-label', 'Continue reading');

    const eyebrow = document.createElement('div');
    eyebrow.className = 'understandingContinueEyebrow';
    eyebrow.textContent = 'START · CH 1 OF ' + stats.chapters;
    card.appendChild(eyebrow);

    const title = document.createElement('div');
    title.className = 'understandingContinueTitle';
    title.textContent = first.title || '';
    card.appendChild(title);

    const bar = document.createElement('div');
    bar.className = 'understandingProgress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', '0');
    const fill = document.createElement('div');
    fill.className = 'understandingProgressFill';
    bar.appendChild(fill);
    card.appendChild(bar);

    const foot = document.createElement('div');
    foot.className = 'understandingContinueFoot';
    const mins = document.createElement('span');
    mins.className = 'understandingContinueMinutes';
    mins.textContent = '~' + (Number(first.minutes) || 0) + ' MIN';
    foot.appendChild(mins);
    // Present but inert — the reader that opens a chapter wires it.
    const read = document.createElement('button');
    read.type = 'button';
    read.className = 'understandingReadBtn';
    read.textContent = 'Read';
    foot.appendChild(read);
    card.appendChild(foot);
    return card;
}

function buildChapterList(book) {
    const list = document.createElement('ol');
    list.className = 'understandingChapters';
    book.chapters.forEach(function (ch, i) {
        const row = document.createElement('li');
        row.className = 'understandingChapterRow';
        row.dataset.chapterId = ch.id;

        const num = document.createElement('span');
        num.className = 'understandingChapterNum';
        num.textContent = pad2(i + 1);
        row.appendChild(num);

        const title = document.createElement('span');
        title.className = 'understandingChapterTitle';
        title.textContent = ch.title || ch.id;
        row.appendChild(title);

        const meta = document.createElement('span');
        if (ch.stale === true) {
            meta.className = 'understandingChapterStale';
            meta.textContent = 'STALE';
        } else {
            meta.className = 'understandingChapterMinutes';
            meta.textContent = (Number(ch.minutes) || 0) + ' MIN';
        }
        row.appendChild(meta);
        list.appendChild(row);
    });
    return list;
}

function paintShelf(view, repo, book) {
    const hasBook = !!(book && book.chapters.length);
    const stats = bookStats(hasBook ? book : null);

    const header = document.createElement('div');
    header.className = 'understandingHeader';

    const repoChip = document.createElement('span');
    repoChip.className = 'understandingRepoChip';
    repoChip.textContent = repo;
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
    const shelf = document.createElement('div');
    shelf.className = 'understandingShelf';
    view.appendChild(shelf);

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
    shelf.appendChild(buildContinueCard(book, stats));
    shelf.appendChild(buildChapterList(book));
}

// Render the UNDERSTANDING view. Safe to call before component() has built the
// shell (a missing #understandingView short-circuits).
export function renderUnderstandingView() {
    const view = document.getElementById('understandingView');
    if (!view) return;
    const seq = ++renderSeq;
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

    const loading = document.createElement('div');
    loading.className = 'understandingLoading';
    loading.textContent = 'Loading the code book…';
    view.appendChild(loading);

    return Promise.resolve(loadBook(repo)).then(function (book) {
        if (seq !== renderSeq) return;
        clear(view);
        paintShelf(view, repo, book);
    });
}

// Leaving the view: stop the probe timer (the tracked run itself is kept, so
// re-entering resumes it) — no interval keeps firing behind a hidden tab.
export function exitUnderstandingView() {
    renderSeq++;
    stopPolling();
}

// Forget any tracked book run and its finished note. A test seam.
export function resetUnderstandingRun() {
    stopPolling();
    bookRun = null;
    finishedRepo = null;
}
