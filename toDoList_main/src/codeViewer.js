// CODE VIEWER — the Structure tab's detail-column source reader.
//
// The UI lens fills `#structureView > .structureCanvasHost` with the block
// canvas; the Code lens left it empty. This module fills it instead: tapping a
// file row in the Code lens renders that file's source into the detail column
// with a line-number gutter, and the NEXT REFACTOR card's jump chip opens the
// same viewer scrolled to (and highlighting) a candidate's `start_line`–
// `end_line` span so the code can be read before `Push entry` drafts an entry
// to extract it.
//
// Like structureCanvas.js this module is mounted BY structureView rather than
// reaching back into it: `renderCodeViewer(host, opts)` / `clearCodeViewer(host)`
// are the render/clear pair, and any other opener (the refactor card's jump
// chip) resolves the same host itself and calls the same pair — so there is no
// back-edge and no import cycle. Subscribers learn which file is open through
// `onCodeViewerChange` + `getOpenCodeViewerFile()`, which is how structureView
// keeps the clicked tree row visually selected no matter who opened the viewer.
//
// WINDOWING IS NOT OPTIONAL. Seven files in this repo exceed 3,000 lines
// (`style.css` is over 21,000) and those are exactly the files the refactor scan
// targets, since it picks the largest over-budget file — so a whole-file render
// would stall on almost every real jump. Opening cold renders the first 300
// lines; a jump renders the span plus 60 lines of context each way, widened to
// at least 300. "Load 200 more" controls appear above and below whenever
// unrendered lines remain in that direction and APPEND to the existing DOM
// rather than re-rendering, so the reading position survives.
//
// Every line node is built with `textContent` — fetched source is never assigned
// through `innerHTML`. There is no syntax highlighting: a highlighter would mean
// touching the webpack config, and plain mono in two tones reads fine.

import { readRepoFile } from './inject.js';

// Lines rendered when a file is opened cold (no jump span).
const COLD_LINES = 300;
// Lines of context rendered either side of a jump span.
const JUMP_CONTEXT = 60;
// A jump window is widened to at least this many lines, so a two-line candidate
// still opens with enough around it to read.
const MIN_WINDOW = 300;
// How many lines each "Load 200 more" control appends.
const CHUNK = 200;

const EMPTY_TEXT = 'Select a file to read its source here.';

// Fetched source, keyed `repo\0path`, valued `{ sha, lines }`. Keyed WITHOUT the
// sha because the sha is only known once the read has happened — folding it into
// the key would mean every re-open re-fetches, which is the exact cost the cache
// exists to avoid. It is stored on the value instead so a caller can tell which
// revision it is reading. Module-level, so re-opening a file and re-jumping to a
// second candidate in the same file both serve from memory.
const cache = new Map();

// The open viewer's state, or null when the column is empty. One viewer at a
// time — the detail column has room for exactly one.
let active = null;
// Bumped on every open so a slow read that resolves after the user has clicked a
// different file is dropped instead of painting over the newer selection.
let renderGen = 0;

const changeListeners = new Set();

function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function notifyChange() {
    changeListeners.forEach(function (fn) {
        try { fn(); } catch (e) { /* a listener's failure must not break the viewer */ }
    });
}

// Subscribe to open/close transitions. Returns an unsubscribe function.
export function onCodeViewerChange(fn) {
    if (typeof fn !== 'function') return function () {};
    changeListeners.add(fn);
    return function () { changeListeners.delete(fn); };
}

// The repo-relative path of the file currently in the viewer, or null when the
// column is empty. Used by structureView to mark the matching tree row selected.
export function getOpenCodeViewerFile() {
    return active ? active.filePath : null;
}

// Drop the cached source and the open-viewer state. A test seam — nothing in the
// app calls it, since the cache is keyed by repo + path and never goes stale
// within a session.
export function resetCodeViewer() {
    cache.clear();
    active = null;
    renderGen = 0;
}

// Split fetched source into display lines. A file that ends with a newline
// splits to a trailing empty element that no editor counts as a line, so it is
// dropped — otherwise every file would report one line more than GitHub does.
function splitLines(content) {
    const lines = String(content == null ? '' : content).split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
}

// The window of lines to render for a fresh open. Cold opens start at the top;
// a jump centres on the span with context either side, widened to MIN_WINDOW
// (downward first, then upward when the file's tail is too short to absorb it).
function computeWindow(total, hl) {
    if (total <= 0) return { start: 1, end: 0 };
    if (!hl) return { start: 1, end: Math.min(total, COLD_LINES) };
    let start = Math.max(1, hl.start - JUMP_CONTEXT);
    let end = Math.min(total, hl.end + JUMP_CONTEXT);
    if (end - start + 1 < MIN_WINDOW) {
        end = Math.min(total, start + MIN_WINDOW - 1);
        if (end - start + 1 < MIN_WINDOW) start = Math.max(1, end - MIN_WINDOW + 1);
    }
    return { start: start, end: end };
}

// Normalise a caller's span into `{ start, end }` of positive integers, or null
// when either bound is missing or nonsensical (the scan's spans can be absent).
function normalizeSpan(startLine, endLine) {
    const s = Number(startLine);
    const e = Number(endLine);
    if (!isFinite(s) || !isFinite(e) || s < 1 || e < 1) return null;
    return { start: Math.min(s, e), end: Math.max(s, e) };
}

function githubBlobUrl(repo, filePath, hl) {
    if (!repo || !filePath) return '';
    const frag = hl ? ('#L' + hl.start + '-L' + hl.end) : '';
    return 'https://github.com/' + repo + '/blob/main/' + filePath + frag;
}

// ── Shell ────────────────────────────────────────────────────────────────────

// Ensure `host` carries the viewer pane and the empty-state placeholder, in that
// order, and hand back both. Idempotent: `renderLens` empties the host on every
// lens paint, so this rebuilds the shell the first time either half is opened
// after a repaint without disturbing an already-mounted one.
function ensureShell(host) {
    let pane = host.querySelector(':scope > .codeViewerPane');
    let empty = host.querySelector(':scope > .codeViewerEmpty');
    if (!pane) {
        pane = buildPane();
        host.appendChild(pane);
    }
    if (!empty) {
        empty = document.createElement('div');
        empty.className = 'codeViewerEmpty';
        empty.textContent = EMPTY_TEXT;
        host.appendChild(empty);
    }
    return { pane: pane, empty: empty };
}

// Build the pane's fixed chrome once. Its parts are parked on the element so a
// re-open can refill them in place instead of rebuilding the whole subtree.
function buildPane() {
    const pane = document.createElement('div');
    pane.className = 'codeViewerPane';

    const header = document.createElement('div');
    header.className = 'codeViewerHeader';

    const path = document.createElement('span');
    path.className = 'codeViewerPath';
    header.appendChild(path);

    const meta = document.createElement('span');
    meta.className = 'codeViewerMeta';
    header.appendChild(meta);

    const gh = document.createElement('a');
    gh.className = 'codeViewerGithub';
    gh.target = '_blank';
    gh.rel = 'noopener noreferrer';
    gh.textContent = '↗';
    header.appendChild(gh);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'codeViewerClose';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close the code viewer');
    header.appendChild(close);

    pane.appendChild(header);

    // The jump banner names the candidate the span came from. Dismissing it drops
    // the highlight and leaves the file open — the point of the jump is to read
    // the code, not to keep the marker.
    const banner = document.createElement('div');
    banner.className = 'codeViewerBanner';
    banner.hidden = true;
    const bannerText = document.createElement('span');
    bannerText.className = 'codeViewerBannerText';
    banner.appendChild(bannerText);
    const bannerDismiss = document.createElement('button');
    bannerDismiss.type = 'button';
    bannerDismiss.className = 'codeViewerBannerDismiss';
    bannerDismiss.textContent = '✕';
    bannerDismiss.setAttribute('aria-label', 'Dismiss the jump highlight');
    banner.appendChild(bannerDismiss);
    pane.appendChild(banner);

    const status = document.createElement('div');
    status.className = 'codeViewerStatus';
    status.hidden = true;
    pane.appendChild(status);

    const body = document.createElement('div');
    body.className = 'codeViewerBody';

    const moreUp = document.createElement('button');
    moreUp.type = 'button';
    moreUp.className = 'codeViewerMore codeViewerMore--up';
    moreUp.textContent = 'Load ' + CHUNK + ' more';
    moreUp.hidden = true;
    body.appendChild(moreUp);

    const lines = document.createElement('div');
    lines.className = 'codeViewerLines';
    body.appendChild(lines);

    const moreDown = document.createElement('button');
    moreDown.type = 'button';
    moreDown.className = 'codeViewerMore codeViewerMore--down';
    moreDown.textContent = 'Load ' + CHUNK + ' more';
    moreDown.hidden = true;
    body.appendChild(moreDown);

    pane.appendChild(body);

    pane._codeViewerRefs = {
        path: path,
        meta: meta,
        gh: gh,
        close: close,
        banner: banner,
        bannerText: bannerText,
        bannerDismiss: bannerDismiss,
        status: status,
        body: body,
        lines: lines,
        moreUp: moreUp,
        moreDown: moreDown,
    };

    close.addEventListener('click', function () {
        const host = pane.parentElement;
        if (host) clearCodeViewer(host);
    });
    bannerDismiss.addEventListener('click', function () {
        dismissBanner(pane);
    });
    moreUp.addEventListener('click', function () { loadMore(pane, true); });
    moreDown.addEventListener('click', function () { loadMore(pane, false); });

    return pane;
}

// ── Line rendering ───────────────────────────────────────────────────────────

// One source line: a fixed-width gutter number beside the text. The row — not the
// gutter — carries the highlight's left border, always declared and merely
// recoloured when a line is in the span, so the gutter's width is byte-identical
// on highlighted and unhighlighted rows. Colouring a border only on hits would
// shift every number by 2px as the highlight scrolls past, which reads as broken.
function buildLine(number, text, hit) {
    const row = document.createElement('div');
    row.className = 'codeViewerLine' + (hit ? ' codeViewerLine--hit' : '');
    row.dataset.line = String(number);

    const gutter = document.createElement('span');
    gutter.className = 'codeViewerGutter';
    gutter.setAttribute('aria-hidden', 'true');
    gutter.textContent = String(number);
    row.appendChild(gutter);

    const code = document.createElement('span');
    code.className = 'codeViewerCode';
    // textContent, never innerHTML — this is fetched repo source.
    code.textContent = text;
    row.appendChild(code);

    return row;
}

function isHit(state, number) {
    return !!state.hl && number >= state.hl.start && number <= state.hl.end;
}

// Append (or prepend) the inclusive line range to the rendered window.
function paintRange(state, from, to, atTop) {
    const refs = state.pane._codeViewerRefs;
    const frag = document.createDocumentFragment();
    for (let n = from; n <= to; n++) {
        frag.appendChild(buildLine(n, state.lines[n - 1], isHit(state, n)));
    }
    if (atTop) refs.lines.insertBefore(frag, refs.lines.firstChild);
    else refs.lines.appendChild(frag);
}

// Show or hide each "Load 200 more" control against what is still unrendered.
function refreshMoreControls(state) {
    const refs = state.pane._codeViewerRefs;
    refs.moreUp.hidden = state.start <= 1;
    refs.moreDown.hidden = state.end >= state.total;
}

function loadMore(pane, atTop) {
    const state = pane._codeViewerState;
    if (!state) return;
    if (atTop) {
        if (state.start <= 1) return;
        const newStart = Math.max(1, state.start - CHUNK);
        paintRange(state, newStart, state.start - 1, true);
        state.start = newStart;
    } else {
        if (state.end >= state.total) return;
        const newEnd = Math.min(state.total, state.end + CHUNK);
        paintRange(state, state.end + 1, newEnd, false);
        state.end = newEnd;
    }
    refreshMoreControls(state);
}

// Drop the jump highlight and hide the banner, leaving the file and the rendered
// window exactly as they are.
function dismissBanner(pane) {
    const state = pane._codeViewerState;
    const refs = pane._codeViewerRefs;
    refs.banner.hidden = true;
    refs.bannerText.textContent = '';
    if (!state) return;
    state.hl = null;
    Array.prototype.forEach.call(
        refs.lines.querySelectorAll('.codeViewerLine--hit'),
        function (el) { el.classList.remove('codeViewerLine--hit'); }
    );
    refs.gh.href = githubBlobUrl(state.repo, state.filePath, null);
}

function scrollToLine(state, number) {
    const refs = state.pane._codeViewerRefs;
    const el = refs.lines.querySelector('[data-line="' + number + '"]');
    if (!el) return;
    try { if (el.scrollIntoView) el.scrollIntoView({ block: 'center' }); } catch (e) { /* jsdom */ }
}

// ── Fetch ────────────────────────────────────────────────────────────────────

function fetchLines(target, filePath) {
    const key = target.repo + ' ' + filePath;
    const hit = cache.get(key);
    if (hit) return Promise.resolve({ ok: true, lines: hit.lines, sha: hit.sha });
    return Promise.resolve(readRepoFile(target, filePath)).then(function (res) {
        if (!res || res.ok === false || typeof res.content !== 'string') {
            return { ok: false, reason: (res && res.reason) || '' };
        }
        const lines = splitLines(res.content);
        const sha = res.sha || null;
        cache.set(key, { sha: sha, lines: lines });
        return { ok: true, lines: lines, sha: sha };
    }).catch(function (e) {
        return { ok: false, reason: (e && e.message) ? e.message : '' };
    });
}

// ── Public render / clear pair ───────────────────────────────────────────────

// Render `opts.filePath` from `opts.target` into `host`, replacing whatever the
// viewer was showing. `opts`:
//   • target    — an inject target; only `.repo` is read, and the Worker's `read`
//                 route serves it with the server-side token (so private repos
//                 work), provided the repo is in `inject_targets`.
//   • filePath  — REPO-RELATIVE path (`toDoList_main/src/style.css`), not a
//                 manifest-relative one; callers join the manifest's srcRoot.
//   • startLine / endLine — an optional span to jump to and highlight.
//   • banner    — text naming where the span came from, shown above the source
//                 while the highlight is live. Only meaningful with a span.
// Returns the pane element, or null when the arguments can't address a file.
export function renderCodeViewer(host, opts) {
    if (!host || !opts) return null;
    const target = opts.target;
    const filePath = String(opts.filePath || '');
    if (!target || !target.repo || !filePath) return null;

    const hl = normalizeSpan(opts.startLine, opts.endLine);
    const gen = ++renderGen;
    const shell = ensureShell(host);
    const pane = shell.pane;
    const refs = pane._codeViewerRefs;

    shell.empty.hidden = true;
    pane.hidden = false;

    refs.path.textContent = filePath;
    refs.path.title = filePath;
    refs.meta.textContent = '';
    refs.gh.href = githubBlobUrl(target.repo, filePath, hl);
    refs.gh.setAttribute('aria-label', 'View ' + filePath + ' on GitHub');
    clearEl(refs.lines);
    refs.moreUp.hidden = true;
    refs.moreDown.hidden = true;
    refs.status.hidden = false;
    refs.status.textContent = 'Loading source…';
    if (hl && opts.banner) {
        refs.bannerText.textContent = opts.banner;
        refs.banner.hidden = false;
    } else {
        refs.bannerText.textContent = '';
        refs.banner.hidden = true;
    }

    pane._codeViewerState = null;
    active = { host: host, filePath: filePath, repo: target.repo };
    notifyChange();

    fetchLines(target, filePath).then(function (res) {
        // A newer open superseded this read — drop it rather than painting over
        // the file the user actually asked for.
        if (gen !== renderGen) return;
        if (!res.ok) {
            refs.status.hidden = false;
            refs.status.textContent = res.reason
                ? ('Couldn’t read this file — ' + res.reason)
                : 'Couldn’t read this file.';
            return;
        }
        const total = res.lines.length;
        const state = {
            pane: pane,
            repo: target.repo,
            filePath: filePath,
            lines: res.lines,
            total: total,
            hl: hl,
            start: 1,
            end: 0,
        };
        pane._codeViewerState = state;
        const win = computeWindow(total, hl);
        state.start = win.start;
        state.end = win.end;
        refs.status.hidden = true;
        refs.status.textContent = '';
        refs.meta.textContent = total + (total === 1 ? ' line' : ' lines');
        if (win.end >= win.start) paintRange(state, win.start, win.end, false);
        refreshMoreControls(state);
        if (hl) scrollToLine(state, hl.start);
    });

    return pane;
}

// Return the column to empty: the viewer is hidden and reset, the placeholder
// shows. Also the "no file open" mount point — structureView calls it when the
// Code lens paints on desktop so the column starts with its empty state.
export function clearCodeViewer(host) {
    if (!host) return;
    // A pending read must not paint into a column the user has just closed.
    renderGen++;
    const shell = ensureShell(host);
    const refs = shell.pane._codeViewerRefs;
    shell.pane.hidden = true;
    shell.pane._codeViewerState = null;
    clearEl(refs.lines);
    refs.path.textContent = '';
    refs.meta.textContent = '';
    refs.gh.removeAttribute('href');
    refs.status.hidden = true;
    refs.status.textContent = '';
    refs.banner.hidden = true;
    refs.bannerText.textContent = '';
    refs.moreUp.hidden = true;
    refs.moreDown.hidden = true;
    shell.empty.hidden = false;
    if (active && active.host === host) {
        active = null;
        notifyChange();
    }
}
