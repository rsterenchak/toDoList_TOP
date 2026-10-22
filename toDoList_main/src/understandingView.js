// The UNDERSTANDING view — the repo's code book as a shelf and a reader. The
// shelf is a header with the chapter count, total reading time and a
// generate/stale control, a continue card resuming the saved reading position,
// then the ordered chapter list. The Continue card's Read button and every
// chapter row open the reader: one chapter at a time, its references as chips
// that open the code viewer at that definition, a forward-reference callout, and
// a prev/next bar.
//
// The book is the `src-book.json` the generator compiles from `codebook.json` and
// publishes beside the source manifest (loaded through codeBook.js). The repo is
// resolved from the selected project exactly as the Structure view resolves it,
// with the same two empty states. The reading position lives in bookProgress.js
// (local + Supabase); the reader mode itself is not persisted, so reopening the
// tab shows the shelf.
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
import { loadManifest } from './claudeSheet.js';
import { joinSrcRootPath } from './srcPath.js';
import { renderCodeViewer, clearCodeViewer, onCodeViewerChange, setCodeViewerCloseHandler } from './codeViewer.js';
import { createCodeSheet } from './codeSheet.js';
import { readLocalProgress, recordProgress, flushProgress, loadProgress } from './bookProgress.js';

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
// The open reader `{ view, repo, book, index, paraIndex, observer, scroll, main,
// codePane }`, or null while the shelf shows.
let reader = null;

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
    if (isViewActive() && !reader) renderUnderstandingView();
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
    eyebrow.textContent = (pos ? 'CONTINUE' : 'START') + ' · CH ' + (at + 1) + ' OF ' + stats.chapters;
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
        num.textContent = pad2(i + 1);
        btn.appendChild(num);

        const title = document.createElement('span');
        title.className = 'understandingChapterTitle';
        title.textContent = ch.title || ch.id;
        btn.appendChild(title);

        const meta = document.createElement('span');
        if (ch.stale === true) {
            meta.className = 'understandingChapterStale';
            meta.textContent = 'STALE';
        } else if (pos && i < pos.index) {
            meta.className = 'understandingChapterDone';
            meta.textContent = '✓';
            meta.setAttribute('aria-label', 'Read');
        } else {
            meta.className = 'understandingChapterMinutes';
            meta.textContent = (Number(ch.minutes) || 0) + ' MIN';
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

function paintShelf(view, repo, book, progress) {
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
    const pos = positionIn(book, progress);
    shelf.appendChild(buildContinueCard(view, repo, book, stats, pos));
    shelf.appendChild(buildChapterList(view, repo, book, pos));
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
    clearCodeViewer(reader.codePane);
    reader.codePane.remove();
    reader.codePane = null;
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
        // A file ref (no symbol) opens the file cold, with no span.
        if (ref.symbol) {
            opts.startLine = ref.line;
            opts.endLine = ref.end;
            opts.banner = ref.label;
        }
        renderCodeViewer(host, opts);
    });
}

function buildParagraph(segments, index) {
    const p = document.createElement('p');
    p.className = 'understandingPara';
    p.dataset.paraIndex = String(index);
    const segs = Array.isArray(segments) ? segments : [{ t: String(segments || '') }];
    segs.forEach(function (seg) {
        if (seg && seg.ref && typeof seg.ref === 'object') {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'bookRef';
            const label = String(seg.ref.label || seg.ref.symbol || seg.ref.file || '');
            chip.textContent = label;
            chip.setAttribute('aria-label', 'Open ' + label + ' in code');
            chip.addEventListener('click', function () { openRef(seg.ref); });
            p.appendChild(chip);
        } else if (seg && typeof seg.t === 'string') {
            p.appendChild(document.createTextNode(seg.t));
        }
    });
    return p;
}

function chapterIndexById(book, id) {
    for (let i = 0; i < book.chapters.length; i++) {
        if (book.chapters[i].id === id) return i;
    }
    return -1;
}

function buildAhead(book, ahead) {
    const target = chapterIndexById(book, ahead.chapter);
    if (target < 0) return null;
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'understandingAhead';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'understandingAheadEyebrow';
    eyebrow.textContent = 'AHEAD → CH ' + (target + 1);
    box.appendChild(eyebrow);
    const note = document.createElement('span');
    note.className = 'understandingAheadNote';
    note.textContent = ahead.note || '';
    box.appendChild(note);
    box.addEventListener('click', function () { showChapter(target, 0); });
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
    r.posEl.textContent = 'CH ' + (r.index + 1) + ' OF ' + chapters.length + ' · ' + whole + '%';
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
    paintReaderProgress();
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
    r.index = index;
    clear(r.column);

    const eyebrow = document.createElement('div');
    eyebrow.className = 'understandingReaderEyebrow';
    eyebrow.textContent = 'CHAPTER ' + (index + 1) + ' · ' + (Number(ch.minutes) || 0) + ' MIN';
    r.column.appendChild(eyebrow);

    const title = document.createElement('h2');
    title.className = 'understandingReaderTitle';
    title.textContent = ch.title || ch.id;
    r.column.appendChild(title);

    // The forward reference sits after the second paragraph, or at the end of a
    // chapter too short for that to leave text on both sides.
    const ahead = ch.ahead && typeof ch.ahead === 'object' ? buildAhead(r.book, ch.ahead) : null;
    const aheadAfter = paragraphs.length >= 3 ? 1 : paragraphs.length - 1;
    const paraEls = [];
    paragraphs.forEach(function (segs, i) {
        const p = buildParagraph(segs, i);
        paraEls.push(p);
        r.column.appendChild(p);
        if (ahead && i === aheadAfter) r.column.appendChild(ahead);
    });
    if (ahead && !paragraphs.length) r.column.appendChild(ahead);

    // Prev / next.
    clear(r.nav);
    const prev = index > 0
        ? buildNavButton('Prev', '‹ CH ' + index, chapters[index - 1].title || chapters[index - 1].id)
        : buildNavButton('Prev', '', '');
    prev.hidden = index === 0;
    prev.addEventListener('click', function () { showChapter(index - 1, 0); });
    r.nav.appendChild(prev);
    const last = index === chapters.length - 1;
    const next = last
        ? buildNavButton('Next', '', 'Back to shelf')
        : buildNavButton('Next', 'CH ' + (index + 2) + ' ›', chapters[index + 1].title || chapters[index + 1].id);
    next.addEventListener('click', function () {
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
}

// Swap the shelf for the reader on chapter `index`, resuming at `paraIndex`.
function openReader(view, repo, book, index, paraIndex) {
    // A shelf repaint still in flight must not paint over the reader.
    renderSeq++;
    teardownReader();
    clear(view);
    view.classList.add('is-reading');

    const root = document.createElement('div');
    root.className = 'understandingReader';

    const top = document.createElement('div');
    top.className = 'understandingReaderTop';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'understandingBackChip';
    back.textContent = '‹ Shelf';
    back.setAttribute('aria-label', 'Back to the shelf');
    back.addEventListener('click', function () { leaveReader(); });
    top.appendChild(back);
    const repoChip = document.createElement('span');
    repoChip.className = 'understandingRepoChip';
    repoChip.textContent = repo;
    top.appendChild(repoChip);
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
    };
    showChapter(index, paraIndex);
}

// Drop the open reader's observer and code hosts and send its position. The view
// DOM is left to whoever paints next.
function teardownReader() {
    if (!reader) return;
    flushProgress();
    if (reader.observer) reader.observer.disconnect();
    closeCodePane();
    if (codeSheet.isOpen()) codeSheet.reset();
    reader.view.classList.remove('is-reading');
    reader = null;
}

// Back to the shelf, re-rendered so its progress marks are current.
function leaveReader() {
    if (!reader) return;
    teardownReader();
    renderUnderstandingView();
}

// Render the UNDERSTANDING view's shelf. Safe to call before component() has
// built the shell (a missing #understandingView short-circuits).
export function renderUnderstandingView() {
    const view = document.getElementById('understandingView');
    if (!view) return;
    teardownReader();
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
        const local = readLocalProgress(repo);
        clear(view);
        paintShelf(view, repo, book, local);
        if (!book || !book.chapters.length) return;
        // The synced record may be newer (another device); repaint when it is.
        return Promise.resolve(loadProgress(repo)).then(function (merged) {
            if (seq !== renderSeq || reader || merged === local) return;
            if (merged && local && merged.updatedAt === local.updatedAt && merged.chapterId === local.chapterId) return;
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
    stopPolling();
    teardownReader();
}

// Forget any tracked book run and its finished note. A test seam.
export function resetUnderstandingRun() {
    stopPolling();
    bookRun = null;
    finishedRepo = null;
}
