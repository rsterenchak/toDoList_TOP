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
//
// EXPLAIN lives here too, as one control in the header acting on the open file,
// rather than as a per-row button in the tree. The work itself doesn't: the
// summary is a Sonnet turn keyed by the manifest's commit SHA, which structureView
// owns, so it registers the doer through `setCodeViewerExplainHandler` and this
// module only supplies the button and the block the reply renders into.

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
// The Explain control's resting label. Held here because the registered handler
// swaps it for a working label and restores whatever it read, so a stale
// "Explaining…" must never be what a fresh open puts back.
const EXPLAIN_LABEL = 'Explain';

// Fetched source, keyed `repo\0path`, valued `{ sha, lines }`. Keyed WITHOUT the
// sha because the sha is only known once the read has happened — folding it into
// the key would mean every re-open re-fetches, which is the exact cost the cache
// exists to avoid. It is stored on the value instead so a caller can tell which
// revision it is reading. Module-level, so re-opening a file and re-jumping to a
// second candidate in the same file both serve from memory.
const cache = new Map();

// The open viewer's state, or null when the column is empty. One viewer at a
// time — the detail column has room for exactly one. It carries the span (and
// the banner naming it) the file was opened with as well as the path, so a host
// that has to tear its column down can reopen the file exactly as it was.
let active = null;
// Bumped on every open so a slow read that resolves after the user has clicked a
// different file is dropped instead of painting over the newer selection.
let renderGen = 0;

const changeListeners = new Set();

// Who actually explains a file, registered by structureView (which owns the
// manifest SHA the explanation cache is keyed by). Null until then, in which case
// the control is inert rather than absent — the viewer has no opinion about
// whether an explainer exists.
let explainHandler = null;

// An optional veto on the header's close button, registered by whoever hosts the
// viewer somewhere that closing means more than emptying the column — the mobile
// sheet dismisses itself and deliberately KEEPS the file open, so the tree row
// that opened it stays selected. Returning true claims the click; anything else
// falls through to the default clear.
let closeHandler = null;

function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function notifyChange() {
    changeListeners.forEach(function (fn) {
        try { fn(); } catch (e) { /* a listener's failure must not break the viewer */ }
    });
}

// Register the function the Explain control calls, with the same
// `(repo, filePath, btn, resultEl)` signature the tree's per-file button used —
// so the existing explainer moves here unchanged, cache and all. Passing a
// non-function unregisters.
export function setCodeViewerExplainHandler(fn) {
    explainHandler = typeof fn === 'function' ? fn : null;
}

// Register a close interceptor. It is called with the host element the pane sits
// in; returning true means the host handled the close and the viewer must NOT be
// cleared. Passing a non-function unregisters.
export function setCodeViewerCloseHandler(fn) {
    closeHandler = typeof fn === 'function' ? fn : null;
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

// Everything it would take to open the current file again — its repo, its path,
// and the span it was opened with — or null when the column is empty.
// `getOpenCodeViewerFile()` answers "which file is showing"; this answers "how do
// I show it again", which is what a host whose column is thrown away and rebuilt
// (the Structure view's lens toggle) needs in order not to lose the user's place.
// The shape matches `renderCodeViewer`'s options, so a caller can pass it straight
// back in. A dismissed banner drops the span here too, so a reopen can't resurrect
// a highlight the user has already waved away.
export function getOpenCodeViewerRef() {
    if (!active) return null;
    const ref = { repo: active.repo, filePath: active.filePath };
    if (active.hl) {
        ref.startLine = active.hl.start;
        ref.endLine = active.hl.end;
        if (active.banner) ref.banner = active.banner;
    }
    return ref;
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

// Group a count in threes — `1546` → `1,546`. Written out rather than left to
// `toLocaleString` because the header is read beside the gutter's own ungrouped
// numbers, and a locale that groups with `.` or a space would have the two
// disagree about what a thousand looks like.
function formatCount(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// What the header meta reads. WINDOWING MEANS THE COUNT ALONE LIES: a viewer
// showing 300 of 1,546 lines with a scrollbar sized to the rendered slice reads
// as a complete document that inexplicably stops, so the rendered range is named
// against the total. A whole-file render drops the range — `1–8 of 8 lines` is
// noise on the short files that need it least.
function metaText(state) {
    const total = formatCount(state.total);
    const unit = state.total === 1 ? ' line' : ' lines';
    if (state.start <= 1 && state.end >= state.total) return total + unit;
    return formatCount(state.start) + '–' + formatCount(state.end) + ' of ' + total + unit;
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

// Fold or unfold the explanation block. The chevron is the affordance and the
// body's `hidden` is the state, so the registered handler's own
// `resultEl.hidden = false` (it renders into the body) naturally unfolds it.
function setExplanationCollapsed(pane, collapsed) {
    const refs = pane._codeViewerRefs;
    refs.explanationBody.hidden = !!collapsed;
    refs.explanationToggle.textContent = collapsed ? '▸' : '▾';
    refs.explanationToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    refs.explanationToggle.setAttribute(
        'aria-label',
        collapsed ? 'Show the explanation' : 'Hide the explanation'
    );
}

// Return the explanation to "nothing shown yet", which every open and close does.
// The body is REPLACED rather than emptied: an explain call still in flight holds
// a reference to the old node, so swapping it means a late reply lands in a
// detached element instead of under whichever file is open by then.
function resetExplanation(pane) {
    const refs = pane._codeViewerRefs;
    refs.explanation.hidden = true;
    const fresh = document.createElement('div');
    fresh.className = 'codeViewerExplanationBody';
    refs.explanation.replaceChild(fresh, refs.explanationBody);
    refs.explanationBody = fresh;
    setExplanationCollapsed(pane, false);
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

    // One Explain control for the open file, left of the GitHub link. Disabled
    // until a file is open, so it never advertises an action it can't perform.
    // In the mobile sheet CSS wraps it onto its own full-width row beneath the
    // rest of the header — the module stays unaware of which host it is in.
    const explain = document.createElement('button');
    explain.type = 'button';
    explain.className = 'codeViewerExplain';
    explain.textContent = EXPLAIN_LABEL;
    explain.disabled = true;
    explain.setAttribute('aria-label', 'Explain this file with Sonnet');
    header.appendChild(explain);

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

    // The explanation sits between the chrome and the source, so it PUSHES the
    // code down rather than overlaying it — an overlay would hide the very lines
    // the summary is describing. The chevron collapses it once read, since a
    // three-sentence block holds real screen height on a phone.
    const explanation = document.createElement('div');
    explanation.className = 'codeViewerExplanation';
    explanation.hidden = true;

    const explanationHead = document.createElement('div');
    explanationHead.className = 'codeViewerExplanationHead';

    const explanationToggle = document.createElement('button');
    explanationToggle.type = 'button';
    explanationToggle.className = 'codeViewerExplanationToggle';
    explanationToggle.textContent = '▾';
    explanationHead.appendChild(explanationToggle);

    const explanationLabel = document.createElement('span');
    explanationLabel.className = 'codeViewerExplanationLabel';
    explanationLabel.textContent = 'EXPLANATION';
    explanationHead.appendChild(explanationLabel);

    explanation.appendChild(explanationHead);

    const explanationBody = document.createElement('div');
    explanationBody.className = 'codeViewerExplanationBody';
    explanation.appendChild(explanationBody);

    pane.appendChild(explanation);

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
        explain: explain,
        gh: gh,
        close: close,
        banner: banner,
        bannerText: bannerText,
        bannerDismiss: bannerDismiss,
        status: status,
        explanation: explanation,
        explanationToggle: explanationToggle,
        explanationBody: explanationBody,
        body: body,
        lines: lines,
        moreUp: moreUp,
        moreDown: moreDown,
    };
    // The file the Explain control acts on, set synchronously on open (the read
    // that follows is irrelevant to it) and null while the column is empty.
    pane._codeViewerFile = null;

    setExplanationCollapsed(pane, false);

    close.addEventListener('click', function () {
        const host = pane.parentElement;
        if (!host) return;
        if (closeHandler && closeHandler(host) === true) return;
        clearCodeViewer(host);
    });
    explain.addEventListener('click', function () {
        const file = pane._codeViewerFile;
        if (!file || !explainHandler) return;
        explanation.hidden = false;
        setExplanationCollapsed(pane, false);
        explainHandler(file.repo, file.filePath, explain, pane._codeViewerRefs.explanationBody);
    });
    explanationToggle.addEventListener('click', function () {
        setExplanationCollapsed(pane, !pane._codeViewerRefs.explanationBody.hidden);
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

// Re-state the rendered window: each "Load 200 more" control shows only while
// unrendered lines remain in its direction, and the header meta names the range.
// Both read the same three numbers, and both change on every window growth, so
// they are refreshed together here rather than at each of the three call sites —
// a meta updated at only some of them is how the header came to report a total
// the body was never showing.
function refreshWindowChrome(state) {
    const refs = state.pane._codeViewerRefs;
    refs.moreUp.hidden = state.start <= 1;
    refs.moreDown.hidden = state.end >= state.total;
    refs.meta.textContent = metaText(state);
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
    refreshWindowChrome(state);
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
    // The span is dropped from the open-file record too, so a host that reopens
    // this file later (a lens switch, which rebuilds the column) brings back the
    // file without the highlight the user has just dismissed.
    if (active && active.host === pane.parentElement) {
        active.hl = null;
        active.banner = '';
    }
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
    // A new file means a new subject: the previous file's explanation is dropped
    // rather than left sitting above unrelated source.
    pane._codeViewerFile = { repo: target.repo, filePath: filePath };
    refs.explain.disabled = false;
    refs.explain.textContent = EXPLAIN_LABEL;
    resetExplanation(pane);
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
    active = {
        host: host,
        filePath: filePath,
        repo: target.repo,
        hl: hl,
        banner: (hl && opts.banner) ? String(opts.banner) : '',
    };
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
        if (win.end >= win.start) paintRange(state, win.start, win.end, false);
        refreshWindowChrome(state);
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
    shell.pane._codeViewerFile = null;
    clearEl(refs.lines);
    refs.explain.disabled = true;
    refs.explain.textContent = EXPLAIN_LABEL;
    resetExplanation(shell.pane);
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
