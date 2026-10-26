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
//
// The header also carries a −/+ size stepper for the source text. It exists for
// two reasons at once: 12px mono is small on a phone, and iOS Safari's text
// autosizing was inflating each line by its own width, so a file whose lines are
// all different widths (`white-space: pre`) rendered at visibly different sizes
// within one view. The listing opts out of autosizing in CSS and the size becomes
// an explicit preference instead — persisted per device, applied at both
// breakpoints, and driven through one custom property so the gutter and the code
// can never step apart.
//
// TAP-TO-TRACE rides on the same listing. Once the repo's definitions index has
// loaded (codeTrace.js), names it knows are wrapped in buttons; a tap opens a peek
// of the definition over the listing (a bottom sheet below 1024px, a card at the
// foot of the column above), tracing on from inside the peek extends its trail,
// and Open jumps the viewer to the definition, leaving a trail bar to step back
// along. The trail is cleared by any open that isn't a step along it.
//
// LINE SELECTION rides on the gutter. Each number is a button: a click selects
// that line, a shift-click (or Shift+Enter) extends to it, a drag down the gutter
// extends live, and on touch a 500ms long-press on any row starts a selection
// that the same finger then drags. The range is banded and a small bar floats at
// its last visible row — the span, Copy, and Ask. Ask hands the lines to the
// registered handler (understandingView builds the chat scope, so this module
// never imports the chat). The selection lives on the pane, so each host's
// viewer keeps its own, and any open, close or Escape drops it.
//
// LINE NOTES ride on the listing too. The header's Notes toggle (left of
// Explain) annotates the open file in place with one short note per line or
// statement — what the code and its comments can't say on their own. Like
// Explain, the writing lives elsewhere: structureView registers the doer through
// `setCodeViewerNotesHandler` (it owns the Worker turn and its cache), and this
// module only asks for a scope, filters what comes back and lays it out. A file
// of 300 lines or fewer is annotated whole; a longer one, the definition the
// listing is scrolled to (or every top-level definition, from the toggle's menu).
// Notes sit in a line-aligned rail right of the code when the pane is at least
// 620px wide and interleave beneath their lines when it is narrower; they never
// renumber lines or disturb the highlight, the selection or tap-to-trace.

import { readRepoFile, showInjectToast } from './inject.js';
import { isCodeNotesOn, setCodeNotesOn } from './prefs.js';
import { loadSymbols, getLoadedSymbols, isTraceable, tokenizeLine, resolveName, topRanked } from './codeTrace.js';
import { joinSrcRootPath } from './srcPath.js';

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

// Optional vetoes on the header's close button, registered by whoever hosts the
// viewer somewhere that closing means more than emptying the column — the mobile
// sheet dismisses itself and deliberately KEEPS the file open, so the tree row
// that opened it stays selected. Each view registers its own and answers only for
// its own hosts; the first to return true claims the click, and when none does
// the default clear runs.
const closeHandlers = [];

// The trace trail: the points the user jumped away from, oldest first, each
// `{ repo, srcRoot, filePath, line, label }`. One trail, like one viewer.
let trail = [];

// repo → the srcRoot it was last opened with, so an opener that doesn't know it
// (the refactor card, the hotspot list) still gets tappable names once the
// Structure view has opened anything from that repo.
const srcRoots = new Map();

// Rows the peek shows of a definition before summarising the rest.
const PEEK_ROWS = 14;

// Who answers the selection bar's Ask, registered by understandingView (which
// owns the scope builder). Null until then, in which case Ask is disabled.
let askHandler = null;
// How long a touch must rest on a row before it starts a selection, and how far
// it may drift first before the gesture counts as a scroll instead.
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

// Who writes a file's line notes, registered by structureView (which owns the
// Worker turn and the notes cache). Called with `{ repo, filePath, srcRoot, sha,
// lines, scope, names }` and resolving to `{ ok: true, notes }` or `{ ok: false }`.
// Null until then, in which case the Notes toggle is disabled.
let notesHandler = null;
const NOTES_LABEL = 'Notes';
// A file this long or shorter is annotated in one call; past it, per definition.
const NOTES_WHOLE_MAX = 300;
// The pane width at which notes move from beneath their lines into a rail.
const NOTES_RAIL_MIN = 620;
// How long the listing must rest after a scroll before an un-noted definition
// scrolled into view is fetched.
const NOTES_SCROLL_MS = 300;
const NOTE_MAX_CHARS = 120;
const NOTES_ERROR = 'Couldn’t read notes for this file.';
// The Ask control's chat-bubble glyph.
const ASK_ICON_PATH = 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5z';
const SVG_NS = 'http://www.w3.org/2000/svg';

function buildAskIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ASK_ICON_PATH);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
}

// ── Code text size ───────────────────────────────────────────────────────────

// The stepper's range, in px. 12 is the size the listing has always rendered at,
// so a device with nothing stored reads exactly as it did before.
const CODE_FONT_MIN = 10;
const CODE_FONT_MAX = 18;
const CODE_FONT_DEFAULT = 12;
const CODE_FONT_STEP = 1;
const CODE_FONT_KEY = 'todoapp_codeFontSize';

function clampFontSize(n) {
    const v = Math.round(Number(n));
    if (!isFinite(v)) return CODE_FONT_DEFAULT;
    return Math.min(CODE_FONT_MAX, Math.max(CODE_FONT_MIN, v));
}

// Both accessors are wrapped: Safari's private mode throws on `localStorage`
// access outright, and a full quota throws on write. Neither may cost the user
// the viewer, so a failure falls back to the default / to a session-only size.
function readStoredFontSize() {
    try {
        const raw = localStorage.getItem(CODE_FONT_KEY);
        if (raw == null || raw === '') return CODE_FONT_DEFAULT;
        const n = Number(raw);
        if (!isFinite(n)) return CODE_FONT_DEFAULT;
        return clampFontSize(n);
    } catch (e) {
        return CODE_FONT_DEFAULT;
    }
}

function writeStoredFontSize(px) {
    try { localStorage.setItem(CODE_FONT_KEY, String(px)); }
    catch (e) { /* the size still applies for this session */ }
}

let codeFontSize = readStoredFontSize();

// Every pane built so far, so a step taken in one host moves the other one too —
// the detail column and the mobile sheet each mount their own pane, and a size
// that only followed the pane you happened to step in would disagree across a
// resize. Panes the host has discarded (`renderLens` empties it on every lens
// paint) are pruned here rather than tracked, so the set can't grow unbounded.
const panes = new Set();

// Push the current size onto one pane: the custom property the listing reads,
// the readout between the steppers, and the end-of-range disabled states.
function applyFontSize(pane) {
    const refs = pane._codeViewerRefs;
    pane.style.setProperty('--code-font-size', codeFontSize + 'px');
    refs.sizeValue.textContent = String(codeFontSize);
    refs.sizeDown.disabled = codeFontSize <= CODE_FONT_MIN;
    refs.sizeUp.disabled = codeFontSize >= CODE_FONT_MAX;
    refs.size.setAttribute('aria-label', 'Code text size, ' + codeFontSize + 'px');
}

function stepFontSize(delta) {
    const next = clampFontSize(codeFontSize + delta);
    if (next === codeFontSize) return;
    codeFontSize = next;
    writeStoredFontSize(next);
    panes.forEach(function (p) {
        if (!p.parentElement) { panes.delete(p); return; }
        applyFontSize(p);
    });
}

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
// cleared. Returns a function that unregisters it.
export function setCodeViewerCloseHandler(fn) {
    if (typeof fn !== 'function') return function () {};
    closeHandlers.push(fn);
    return function () {
        const i = closeHandlers.indexOf(fn);
        if (i !== -1) closeHandlers.splice(i, 1);
    };
}

// Register the function the selection bar's Ask calls with
// `{ repo, filePath, srcRoot, start, end, text }` — `text` the selected lines as
// an array. Passing a non-function unregisters.
export function setCodeViewerAskHandler(fn) {
    askHandler = typeof fn === 'function' ? fn : null;
    panes.forEach(function (p) { p._codeViewerRefs.selectAsk.disabled = !askHandler; });
}

// Register the function the Notes toggle asks for a scope's notes (see
// `notesHandler`). Passing a non-function unregisters.
export function setCodeViewerNotesHandler(fn) {
    notesHandler = typeof fn === 'function' ? fn : null;
    panes.forEach(function (p) { p._codeViewerRefs.notes.disabled = !notesHandler || !p._codeViewerFile; });
}

// The selected `{ start, end }` in `host`'s viewer (a copy), or null.
export function getCodeViewerSelection(host) {
    const pane = host && host.querySelector ? host.querySelector(':scope > .codeViewerPane') : null;
    const sel = pane ? pane._codeSelection : null;
    return sel ? { start: sel.start, end: sel.end } : null;
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
    if (typeof active.srcRoot === 'string') ref.srcRoot = active.srcRoot;
    if (active.hl) {
        ref.startLine = active.hl.start;
        ref.endLine = active.hl.end;
        if (active.banner) ref.banner = active.banner;
    }
    return ref;
}

// The cached lines of REPO-RELATIVE `filePath` in `repo` (a copy), or null when
// the viewer has not read that file this session. Read-only and never fetches —
// the chapter chat scope uses it to find a symbol's uses only in files already
// paid for.
export function getCachedLines(repo, filePath) {
    const hit = cache.get(repo + '\u0000' + filePath);
    return hit ? hit.lines.slice() : null;
}

// Drop the cached source and the open-viewer state. A test seam — nothing in the
// app calls it, since the cache is keyed by repo + path and never goes stale
// within a session.
export function resetCodeViewer() {
    cache.clear();
    active = null;
    renderGen = 0;
    panes.clear();
    trail = [];
    srcRoots.clear();
    askHandler = null;
    notesHandler = null;
    // Re-read rather than reset to the default: the size is a persisted device
    // preference, so a reset viewer must still come back at the stored size.
    codeFontSize = readStoredFontSize();
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

    // The size stepper, next to the meta. It is a preference rather than an
    // action on the open file, so unlike Explain it is never disabled as a whole
    // — only its two ends, once the range runs out. On mobile CSS drops it onto
    // the Explain row, where the header has the width to spare.
    const size = document.createElement('div');
    size.className = 'codeViewerSize';
    size.setAttribute('role', 'group');

    const sizeDown = document.createElement('button');
    sizeDown.type = 'button';
    sizeDown.className = 'codeViewerSizeStep';
    sizeDown.textContent = '−';
    sizeDown.setAttribute('aria-label', 'Decrease code text size');
    size.appendChild(sizeDown);

    const sizeValue = document.createElement('span');
    sizeValue.className = 'codeViewerSizeValue';
    size.appendChild(sizeValue);

    const sizeUp = document.createElement('button');
    sizeUp.type = 'button';
    sizeUp.className = 'codeViewerSizeStep';
    sizeUp.textContent = '+';
    sizeUp.setAttribute('aria-label', 'Increase code text size');
    size.appendChild(sizeUp);

    header.appendChild(size);

    // The Notes toggle, left of Explain. Pressed while the open file is
    // annotated; a right-click or long-press opens its menu, which on a long file
    // offers notes for every definition at once instead of the one in view.
    const notesWrap = document.createElement('span');
    notesWrap.className = 'codeViewerNotesWrap';
    const notes = document.createElement('button');
    notes.type = 'button';
    notes.className = 'codeViewerNotes';
    notes.textContent = NOTES_LABEL;
    notes.disabled = true;
    notes.setAttribute('aria-pressed', 'false');
    notes.setAttribute('aria-label', 'Show line notes for this file');
    notesWrap.appendChild(notes);
    const notesMenu = document.createElement('div');
    notesMenu.className = 'codeViewerNotesMenu';
    notesMenu.setAttribute('role', 'menu');
    notesMenu.hidden = true;
    const notesWhole = document.createElement('button');
    notesWhole.type = 'button';
    notesWhole.className = 'codeViewerNotesMenuItem';
    notesWhole.setAttribute('role', 'menuitem');
    notesWhole.textContent = 'Notes for whole file';
    notesMenu.appendChild(notesWhole);
    notesWrap.appendChild(notesMenu);
    header.appendChild(notesWrap);

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

    // A host-supplied banner pinned above the source — the docked tour player's
    // step chrome. It belongs to whoever set it, so opens and jumps leave it in
    // place; only `clearBanner` takes it down.
    const slot = document.createElement('div');
    slot.className = 'codeViewerBannerSlot';
    slot.hidden = true;
    pane.appendChild(slot);

    // The trace trail: Back plus one chip per point jumped away from. Shown only
    // while there is somewhere to go back to.
    const trailBar = document.createElement('div');
    trailBar.className = 'codeViewerTrail';
    trailBar.hidden = true;
    const trailBack = document.createElement('button');
    trailBack.type = 'button';
    trailBack.className = 'codeViewerTrailBack';
    trailBack.textContent = '← Back';
    trailBack.setAttribute('aria-label', 'Back to where you traced from');
    trailBar.appendChild(trailBack);
    const trailChips = document.createElement('div');
    trailChips.className = 'codeViewerTrailChips';
    trailBar.appendChild(trailChips);
    pane.appendChild(trailBar);

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

    // One line of notes progress or failure, above the listing.
    const notesStatus = document.createElement('div');
    notesStatus.className = 'codeViewerNotesStatus';
    notesStatus.hidden = true;
    notesStatus.setAttribute('role', 'status');
    pane.appendChild(notesStatus);

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

    // The selection bar floats over the listing at the range's last visible row:
    // a zero-size dock is appended to that row and pinned (sticky) to the
    // scroller's right edge, so a sideways scroll of a long line can't carry it
    // off screen, and the bar hangs from the dock. Detached while nothing is
    // selected.
    const selectDock = document.createElement('div');
    selectDock.className = 'codeViewerSelectDock';
    const selectBar = document.createElement('div');
    selectBar.className = 'codeViewerSelectBar';
    selectBar.setAttribute('role', 'toolbar');
    selectBar.hidden = true;
    const selectSpan = document.createElement('span');
    selectSpan.className = 'codeViewerSelectSpan';
    selectBar.appendChild(selectSpan);
    const selectCopy = document.createElement('button');
    selectCopy.type = 'button';
    selectCopy.className = 'codeViewerSelectCopy';
    selectCopy.textContent = 'Copy';
    selectCopy.setAttribute('aria-label', 'Copy the selected lines');
    selectBar.appendChild(selectCopy);
    const selectAsk = document.createElement('button');
    selectAsk.type = 'button';
    selectAsk.className = 'codeViewerSelectAsk';
    selectAsk.appendChild(buildAskIcon());
    selectAsk.setAttribute('aria-label', 'Ask Claude about the selected lines');
    selectAsk.title = 'Ask';
    selectAsk.disabled = !askHandler;
    selectBar.appendChild(selectAsk);
    selectDock.appendChild(selectBar);

    pane._codeViewerRefs = {
        path: path,
        meta: meta,
        size: size,
        sizeDown: sizeDown,
        sizeValue: sizeValue,
        sizeUp: sizeUp,
        notes: notes,
        notesMenu: notesMenu,
        notesWhole: notesWhole,
        notesStatus: notesStatus,
        explain: explain,
        gh: gh,
        close: close,
        slot: slot,
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
        trail: trailBar,
        trailBack: trailBack,
        trailChips: trailChips,
        selectDock: selectDock,
        selectBar: selectBar,
        selectSpan: selectSpan,
        selectCopy: selectCopy,
        selectAsk: selectAsk,
    };
    pane._codeSelection = null;
    // The file the Explain control acts on, set synchronously on open (the read
    // that follows is irrelevant to it) and null while the column is empty.
    pane._codeViewerFile = null;
    pane._codeNotes = null;

    setExplanationCollapsed(pane, false);
    // Before the pane is mounted, so the stored size is what the first painted
    // line is measured at rather than something the listing reflows into.
    panes.add(pane);
    applyFontSize(pane);

    close.addEventListener('click', function () {
        const host = pane.parentElement;
        if (!host) return;
        for (let i = 0; i < closeHandlers.length; i++) {
            if (closeHandlers[i](host) === true) return;
        }
        clearCodeViewer(host);
    });
    explain.addEventListener('click', function () {
        const file = pane._codeViewerFile;
        if (!file || !explainHandler) return;
        explanation.hidden = false;
        setExplanationCollapsed(pane, false);
        explainHandler(file.repo, file.filePath, explain, pane._codeViewerRefs.explanationBody);
    });
    wireNotes(pane);
    explanationToggle.addEventListener('click', function () {
        setExplanationCollapsed(pane, !pane._codeViewerRefs.explanationBody.hidden);
    });
    bannerDismiss.addEventListener('click', function () {
        dismissBanner(pane);
    });
    wireSelection(pane);
    selectCopy.addEventListener('click', function () { copySelection(pane); });
    selectAsk.addEventListener('click', function () { askSelection(pane); });
    lines.addEventListener('click', function (event) {
        const btn = event.target && event.target.closest ? event.target.closest('.codeViewerSym') : null;
        const state = pane._codeViewerState;
        if (!btn || !state || !state.trace) return;
        startTrace(pane, btn, {
            repo: state.repo,
            srcRoot: state.srcRoot,
            filePath: state.filePath,
            fileKey: state.trace.fileKey,
            symbols: state.trace.symbols,
        }, true);
    });
    trailBack.addEventListener('click', function () {
        if (trail.length) jumpToTrail(pane, trail.length - 1);
    });
    trailChips.addEventListener('click', function (event) {
        const chip = event.target && event.target.closest ? event.target.closest('.codeViewerTrailChip') : null;
        if (chip) jumpToTrail(pane, Number(chip.dataset.index));
    });
    moreUp.addEventListener('click', function () { loadMore(pane, true); });
    moreDown.addEventListener('click', function () { loadMore(pane, false); });
    sizeDown.addEventListener('click', function () { stepFontSize(-CODE_FONT_STEP); });
    sizeUp.addEventListener('click', function () { stepFontSize(CODE_FONT_STEP); });

    return pane;
}

// ── Line rendering ───────────────────────────────────────────────────────────

// One source line: a fixed-width gutter number beside the text. The row — not the
// gutter — carries the highlight's left border, always declared and merely
// recoloured when a line is in the span, so the gutter's width is byte-identical
// on highlighted and unhighlighted rows. Colouring a border only on hits would
// shift every number by 2px as the highlight scrolls past, which reads as broken.
//
// In the listing (`select` given) the gutter number is a button that selects the
// line, pressed while the row is in the selection; the peek's rows pass none and
// keep the inert number.
function buildLine(number, text, hit, trace, select) {
    const row = document.createElement('div');
    const selected = !!select && number >= select.start && number <= select.end;
    row.className = 'codeViewerLine' + (hit ? ' codeViewerLine--hit' : '')
        + (selected ? ' codeViewerLine--selected' : '');
    row.dataset.line = String(number);

    const gutter = document.createElement(select !== undefined ? 'button' : 'span');
    gutter.className = 'codeViewerGutter';
    if (select !== undefined) {
        gutter.type = 'button';
        gutter.setAttribute('aria-label', 'Select line ' + number);
        gutter.setAttribute('aria-pressed', selected ? 'true' : 'false');
    } else {
        gutter.setAttribute('aria-hidden', 'true');
    }
    gutter.textContent = String(number);
    row.appendChild(gutter);

    const code = document.createElement('span');
    code.className = 'codeViewerCode';
    fillCode(code, text, trace);
    row.appendChild(code);

    return row;
}

// Fill one line's code span. With a trace index, names it knows become buttons;
// either way every node is a text node or a button whose textContent is set —
// textContent, never innerHTML, because this is fetched repo source.
function fillCode(code, text, trace) {
    if (!trace) {
        code.textContent = text;
        return;
    }
    clearEl(code);
    tokenizeLine(text, function (name) {
        return isTraceable(trace.symbols, trace.fileKey, name);
    }).forEach(function (seg) {
        if (!seg.name) {
            code.appendChild(document.createTextNode(seg.text));
            return;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'codeViewerSym';
        btn.textContent = seg.text;
        btn.dataset.name = seg.name;
        if (seg.qualifier) btn.dataset.qualifier = seg.qualifier;
        code.appendChild(btn);
    });
}

function isHit(state, number) {
    return !!state.hl && number >= state.hl.start && number <= state.hl.end;
}

// Append (or prepend) the inclusive line range to the rendered window.
function paintRange(state, from, to, atTop) {
    const refs = state.pane._codeViewerRefs;
    const frag = document.createDocumentFragment();
    for (let n = from; n <= to; n++) {
        frag.appendChild(buildLine(n, state.lines[n - 1], isHit(state, n), state.trace, state.pane._codeSelection));
    }
    if (atTop) refs.lines.insertBefore(frag, refs.lines.firstChild);
    else refs.lines.appendChild(frag);
    placeSelectBar(state.pane);
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
    renderNotes(pane);
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

// ── Selection ────────────────────────────────────────────────────────────────

// The listing row number under a viewport point, or under `fallback` when the
// point misses the listing (or the platform can't hit-test). 0 when neither is
// a row. A touch keeps targeting the element it started on, so a drag has to
// hit-test the point to learn which row the finger is over now.
function rowNumberAt(pane, x, y, fallback) {
    const lines = pane._codeViewerRefs.lines;
    let el = null;
    if (isFinite(x) && isFinite(y) && typeof document.elementFromPoint === 'function') {
        try { el = document.elementFromPoint(x, y); } catch (e) { el = null; }
    }
    if (!el || !lines.contains(el)) el = fallback;
    const row = el && el.closest ? el.closest('.codeViewerLine') : null;
    if (!row || !lines.contains(row)) return 0;
    return Number(row.dataset.line) || 0;
}

// Select from `anchor` to `to` (either order). The anchor is kept so a later
// shift-click or drag extends from where the selection began.
function setSelection(pane, anchor, to) {
    if (!pane._codeViewerState || !anchor || !to) { clearSelection(pane); return; }
    pane._codeSelectAnchor = anchor;
    pane._codeSelection = { start: Math.min(anchor, to), end: Math.max(anchor, to) };
    paintSelection(pane);
}

// A gutter click or Enter: select the line, or extend to it when `extend`.
function pickLine(pane, number, extend) {
    if (!number) return;
    if (extend && pane._codeSelection) setSelection(pane, pane._codeSelectAnchor, number);
    else setSelection(pane, number, number);
}

function clearSelection(pane) {
    if (!pane) return;
    cancelPress(pane);
    pane._codeSelection = null;
    pane._codeSelectAnchor = 0;
    pane._codeSelectDrag = null;
    pane._codeViewerRefs.lines.classList.remove('codeViewerLines--selecting');
    paintSelection(pane);
}

function paintSelection(pane) {
    const sel = pane._codeSelection;
    const rows = pane._codeViewerRefs.lines.querySelectorAll('.codeViewerLine');
    Array.prototype.forEach.call(rows, function (row) {
        const n = Number(row.dataset.line);
        const on = !!sel && n >= sel.start && n <= sel.end;
        row.classList.toggle('codeViewerLine--selected', on);
        const gutter = row.querySelector('button.codeViewerGutter');
        if (gutter) gutter.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    placeSelectBar(pane);
}

// `L29–L31`, or `L29` for one line.
function selectLabel(sel) {
    return sel.start === sel.end ? ('L' + sel.start) : ('L' + sel.start + '–L' + sel.end);
}

// Show the bar for the current selection, docked in the last selected row that
// is scrolled into view (the range's last row when none is, or when the platform
// can't measure). Moving the dock between rows is the only positioning — the
// sticky CSS does the rest.
function placeSelectBar(pane) {
    const refs = pane._codeViewerRefs;
    const bar = refs.selectBar;
    const dock = refs.selectDock;
    const sel = pane._codeSelection;
    if (!sel) {
        bar.hidden = true;
        if (dock.parentNode) dock.parentNode.removeChild(dock);
        return;
    }
    refs.selectSpan.textContent = selectLabel(sel);
    refs.selectSpan.setAttribute('aria-label', sel.start === sel.end
        ? ('Line ' + sel.start + ' selected')
        : ('Lines ' + sel.start + ' to ' + sel.end + ' selected'));
    const bodyRect = refs.body.getBoundingClientRect();
    let fallback = null;
    let row = null;
    for (let n = sel.end; n >= sel.start && !row; n--) {
        const el = refs.lines.querySelector('[data-line="' + n + '"]');
        if (!el) continue;
        if (!fallback) fallback = el;
        const r = el.getBoundingClientRect();
        if (bodyRect.height > 0 && r.bottom > bodyRect.top && r.top < bodyRect.bottom) row = el;
    }
    row = row || fallback;
    if (!row) {
        bar.hidden = true;
        if (dock.parentNode) dock.parentNode.removeChild(dock);
        return;
    }
    bar.hidden = false;
    if (dock.parentNode !== row) row.appendChild(dock);
}

// The selected source lines, raw, or null when nothing is selected.
function selectedLines(pane) {
    const sel = pane._codeSelection;
    const state = pane._codeViewerState;
    if (!sel || !state) return null;
    return state.lines.slice(sel.start - 1, sel.end);
}

function copySelection(pane) {
    const lines = selectedLines(pane);
    if (!lines) return;
    const text = lines.join('\n');
    const done = function () { showInjectToast('Copied'); };
    // The async clipboard is the one path that works from a tap on mobile Safari;
    // without it there is nothing to confirm, so the toast stays down.
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
    navigator.clipboard.writeText(text).then(done).catch(function () {});
}

function askSelection(pane) {
    const lines = selectedLines(pane);
    const state = pane._codeViewerState;
    if (!lines || !askHandler) return;
    askHandler({
        repo: state.repo,
        filePath: state.filePath,
        srcRoot: state.srcRoot,
        start: pane._codeSelection.start,
        end: pane._codeSelection.end,
        text: lines,
    });
}

// Drop a pending or live long-press.
function cancelPress(pane) {
    const press = pane._codeSelectPress;
    if (!press) return;
    if (press.timer) clearTimeout(press.timer);
    pane._codeSelectPress = null;
}

// The gutter's mouse, keyboard and touch wiring for one pane.
function wireSelection(pane) {
    wireViewerGlobals();
    const refs = pane._codeViewerRefs;
    const lines = refs.lines;
    const gutterOf = function (event) {
        const t = event.target;
        const g = t && t.closest ? t.closest('button.codeViewerGutter') : null;
        return g && lines.contains(g) ? g : null;
    };
    const lineOf = function (g) {
        const row = g.closest('.codeViewerLine');
        return row ? Number(row.dataset.line) : 0;
    };

    lines.addEventListener('click', function (event) {
        const g = gutterOf(event);
        if (!g) return;
        // A drag already set the range; its trailing click must not reset it.
        if (pane._codeSelectDragged) { pane._codeSelectDragged = false; return; }
        pickLine(pane, lineOf(g), event.shiftKey);
    });
    // Enter selects, Shift+Enter extends. Handled here rather than left to the
    // button's synthetic click, which doesn't reliably carry the Shift key.
    lines.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        const g = gutterOf(event);
        if (!g) return;
        event.preventDefault();
        pickLine(pane, lineOf(g), event.shiftKey);
    });

    // Mouse and pen: press on a number, drag down the gutter to extend.
    lines.addEventListener('pointerdown', function (event) {
        pane._codeSelectDragged = false;
        if (event.pointerType === 'touch') return;
        if (event.button) return;
        const g = gutterOf(event);
        if (!g) return;
        const n = lineOf(g);
        const anchor = (event.shiftKey && pane._codeSelection) ? pane._codeSelectAnchor : n;
        pane._codeSelectDrag = { anchor: anchor, from: n };
        lines.classList.add('codeViewerLines--selecting');
    });
    lines.addEventListener('pointermove', function (event) {
        const drag = pane._codeSelectDrag;
        if (!drag) return;
        const n = rowNumberAt(pane, event.clientX, event.clientY, event.target);
        if (!n || (n === drag.from && !pane._codeSelectDragged)) return;
        pane._codeSelectDragged = true;
        setSelection(pane, drag.anchor, n);
    });

    // Touch: rest a finger on any row for LONG_PRESS_MS to start a selection,
    // then drag it to extend; lifting ends it. Moving first is a scroll.
    lines.addEventListener('touchstart', function (event) {
        cancelPress(pane);
        if (!event.touches || event.touches.length !== 1) return;
        const t = event.touches[0];
        const n = rowNumberAt(pane, NaN, NaN, event.target);
        if (!n) return;
        const press = { x: t.clientX, y: t.clientY, active: false, timer: null };
        press.timer = setTimeout(function () {
            press.timer = null;
            if (pane._codeSelectPress !== press) return;
            press.active = true;
            setSelection(pane, n, n);
        }, LONG_PRESS_MS);
        pane._codeSelectPress = press;
    }, { passive: true });
    lines.addEventListener('touchmove', function (event) {
        const press = pane._codeSelectPress;
        if (!press || !event.touches || !event.touches.length) return;
        const t = event.touches[0];
        if (!press.active) {
            if (Math.abs(t.clientX - press.x) > LONG_PRESS_SLOP || Math.abs(t.clientY - press.y) > LONG_PRESS_SLOP) {
                cancelPress(pane);
            }
            return;
        }
        // The finger is extending the selection, not scrolling the listing.
        if (event.cancelable) event.preventDefault();
        const n = rowNumberAt(pane, t.clientX, t.clientY, null);
        if (n) setSelection(pane, pane._codeSelectAnchor, n);
    }, { passive: false });
    lines.addEventListener('touchend', function (event) {
        const press = pane._codeSelectPress;
        if (!press) return;
        // A finished long-press must not also land as a tap on a number or a name.
        if (press.active && event.cancelable) event.preventDefault();
        cancelPress(pane);
    });
    lines.addEventListener('touchcancel', function () { cancelPress(pane); });
    // The long-press would otherwise also raise the platform's context menu.
    lines.addEventListener('contextmenu', function (event) {
        if (pane._codeSelectPress) event.preventDefault();
    });

    refs.body.addEventListener('scroll', function () {
        if (pane._codeSelection) placeSelectBar(pane);
    }, { passive: true });
}

// ── Line notes ───────────────────────────────────────────────────────────────

function isCommentText(t) {
    return /^(\/\/|\/\*|\*|<!--)/.test(t);
}

// A line a note may sit on: not blank, not a comment on its own, not a lone
// brace or bracket.
function isNoteableLine(text) {
    const t = String(text == null ? '' : text).trim();
    return !!t && !isCommentText(t) && !/^[{}()[\];,]+$/.test(t);
}

// Whether an adjacent comment already explains line `n`: the line directly above
// is a `//`, `///` or `/* */` comment, or the line carries a trailing one. Such a
// line gets no note even when the reply offers one — a paraphrase of the comment
// beside it is noise, and a well-commented file should read as a sparse rail.
function isCommentExplained(lines, n) {
    const own = String(lines[n - 1] == null ? '' : lines[n - 1]);
    if (/\S\s+\/\/\s/.test(own) || /\S\s*\/\*.*\*\/\s*$/.test(own)) return true;
    if (n < 2) return false;
    return isCommentText(String(lines[n - 2] == null ? '' : lines[n - 2]).trim());
}

// The handler's raw notes, kept only where they may sit and clipped to `scope`
// (the whole file when null): `{ line, end, note, refs }`, one per line.
function filterNotes(lines, raw, scope) {
    const out = [];
    const seen = {};
    const lo = scope ? scope.start : 1;
    const hi = scope ? Math.min(scope.end, lines.length) : lines.length;
    (Array.isArray(raw) ? raw : []).forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        const line = Math.floor(Number(item.line));
        if (!(line >= lo && line <= hi) || seen[line]) return;
        const text = typeof item.note === 'string' ? item.note.trim() : '';
        if (!text || !isNoteableLine(lines[line - 1]) || isCommentExplained(lines, line)) return;
        const end = Math.floor(Number(item.end));
        seen[line] = true;
        out.push({
            line: line,
            end: end >= line ? Math.min(end, hi) : line,
            note: text.length > NOTE_MAX_CHARS ? text.slice(0, NOTE_MAX_CHARS - 1).trim() + '…' : text,
            refs: Array.isArray(item.refs)
                ? item.refs.filter(function (r) { return typeof r === 'string' && r; })
                : [],
        });
    });
    return out;
}

// Fold a scope's notes into the file's, in line order. A note that starts inside
// an earlier note's span is dropped, so no two notes ever claim the same row.
function mergeNotes(rec, list) {
    const all = rec.notes.concat(list).sort(function (a, b) { return a.line - b.line; });
    const kept = [];
    all.forEach(function (n) {
        const prev = kept[kept.length - 1];
        if (prev && n.line <= prev.end) return;
        kept.push(n);
    });
    rec.notes = kept;
}

// The open file's definitions from the trace index, or [] before it has loaded
// (or when the repo publishes none).
function fileDefs(state) {
    const t = state.trace;
    const entry = t && t.symbols && t.symbols.files ? t.symbols.files[t.fileKey] : null;
    if (!entry || !Array.isArray(entry.defs)) return [];
    return entry.defs.filter(function (d) {
        return d && typeof d.name === 'string' && d.name && d.start >= 1 && d.end >= d.start;
    });
}

function scopeOfDef(d) {
    return { start: d.start, end: d.end, symbol: d.name };
}

// The first listing row at least partly below the scroller's top edge — or,
// where the platform can't measure, the span the file opened on.
function topVisibleLine(state) {
    const refs = state.pane._codeViewerRefs;
    const top = refs.body.getBoundingClientRect().top;
    const rows = refs.lines.querySelectorAll(':scope > .codeViewerLine');
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (r.height > 0 && r.bottom > top) return Number(rows[i].dataset.line);
    }
    return state.hl ? state.hl.start : state.start;
}

// What to annotate: the whole file (one null scope) when it is short enough;
// otherwise every top-level definition when `whole`, else the one in view — the
// widest definition around the top visible line that still fits one call, or the
// narrowest when none does.
function notesScopes(state, whole) {
    if (state.total <= NOTES_WHOLE_MAX) return [null];
    const defs = fileDefs(state).sort(function (a, b) { return (a.start - b.start) || (b.end - a.end); });
    if (whole) {
        const out = [];
        let last = 0;
        defs.forEach(function (d) {
            if (d.start <= last) return;
            out.push(scopeOfDef(d));
            last = d.end;
        });
        return out;
    }
    const n = topVisibleLine(state);
    let fit = null;
    let narrow = null;
    defs.forEach(function (d) {
        if (d.start > n || d.end < n) return;
        const span = d.end - d.start + 1;
        if (span <= NOTES_WHOLE_MAX && (!fit || span > fit.end - fit.start + 1)) fit = d;
        if (!narrow || span < narrow.end - narrow.start + 1) narrow = d;
    });
    const pick = fit || narrow;
    return pick ? [scopeOfDef(pick)] : [];
}

function setNotesStatus(pane, text) {
    const el = pane._codeViewerRefs.notesStatus;
    el.textContent = text || '';
    el.hidden = !text;
}

function syncNotesToggle(pane) {
    const refs = pane._codeViewerRefs;
    const on = !!(pane._codeNotes && pane._codeNotes.on);
    refs.notes.classList.toggle('codeViewerNotes--on', on);
    refs.notes.setAttribute('aria-pressed', on ? 'true' : 'false');
}

// Start a fresh notes record for a newly opened file (or none, `repo` null): the
// toggle reads the repo's remembered state, nothing is fetched or shown yet. A
// reply still in flight holds the old record, so it lands nowhere.
function resetNotes(pane, repo) {
    if (pane._codeNotesTimer) clearTimeout(pane._codeNotesTimer);
    pane._codeNotesTimer = null;
    pane._codeNotes = repo
        ? { on: isCodeNotesOn(repo), notes: [], done: {}, pending: {}, active: 0, mode: null }
        : null;
    closeNotesMenu(pane);
    pane._codeViewerRefs.notes.disabled = !repo || !notesHandler;
    syncNotesToggle(pane);
    setNotesStatus(pane, '');
    renderNotes(pane);
}

// Ask the handler for one scope's notes, unless they are already in or coming.
function fetchNoteScope(pane, rec, state, scope) {
    const key = scope ? (scope.symbol + '@' + scope.start) : '';
    if (pane._codeNotes !== rec || !rec.on || !notesHandler || rec.done[key] || rec.pending[key]) {
        return Promise.resolve();
    }
    rec.pending[key] = true;
    setNotesStatus(pane, 'Writing notes…');
    const handler = notesHandler;
    return Promise.resolve().then(function () {
        return handler({
            repo: state.repo,
            filePath: state.filePath,
            srcRoot: state.srcRoot,
            sha: state.sha,
            lines: state.lines,
            scope: scope,
            names: fileDefs(state).map(function (d) { return d.name; }),
        });
    }).catch(function () { return null; }).then(function (res) {
        delete rec.pending[key];
        if (pane._codeNotes !== rec) return;
        if (!res || res.ok !== true || !Array.isArray(res.notes)) {
            // Off rather than half-on: the toggle never claims notes it hasn't got.
            rec.on = false;
            syncNotesToggle(pane);
            setNotesStatus(pane, NOTES_ERROR);
            renderNotes(pane);
            return;
        }
        rec.done[key] = true;
        mergeNotes(rec, filterNotes(state.lines, res.notes, scope));
        if (!Object.keys(rec.pending).length) setNotesStatus(pane, '');
        renderNotes(pane);
    });
}

// Fetch whatever the current view (or, `whole`, the whole file) still lacks,
// one call at a time so a long file's chunks can't fan out into a burst.
function requestNotes(pane, whole) {
    const rec = pane._codeNotes;
    const state = pane._codeViewerState;
    if (!rec || !rec.on || !state || !notesHandler) return;
    let chain = Promise.resolve();
    notesScopes(state, whole).forEach(function (scope) {
        chain = chain.then(function () { return fetchNoteScope(pane, rec, state, scope); });
    });
}

function notesMode(pane) {
    return pane.getBoundingClientRect().width >= NOTES_RAIL_MIN ? 'rail' : 'inline';
}

function listingRow(pane, n) {
    return pane._codeViewerRefs.lines.querySelector(':scope > .codeViewerLine[data-line="' + n + '"]');
}

function buildNote(state, note) {
    const el = document.createElement('div');
    el.className = 'codeViewerNote';
    el.dataset.noteLine = String(note.line);
    // The body carries the left rule; the note itself is the (sticky) slot.
    const body = document.createElement('div');
    body.className = 'codeViewerNoteBody';
    el.appendChild(body);
    const text = document.createElement('button');
    text.type = 'button';
    text.className = 'codeViewerNoteText';
    text.textContent = note.note;
    text.setAttribute('aria-label', 'Ask about line ' + note.line + ': ' + note.note);
    body.appendChild(text);
    // Only names the trace index can resolve become chips, so none is dead.
    const trace = state.trace;
    const names = trace ? note.refs.filter(function (r) { return isTraceable(trace.symbols, trace.fileKey, r); }) : [];
    if (names.length) {
        const refs = document.createElement('span');
        refs.className = 'codeViewerNoteRefs';
        names.forEach(function (name) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'bookRef codeViewerNoteRef';
            chip.dataset.name = name;
            chip.textContent = name;
            refs.appendChild(chip);
        });
        body.appendChild(refs);
    }
    return el;
}

// Lay the file's notes onto the mounted rows, replacing any laid before. Rail
// mode places each note in the grid's second column on its rows (by index in
// the mounted window, so a window grown upward re-lays them); interleaved mode
// puts it after its last row. Rows only gain `data-note` — nothing about the
// numbering, the highlight or the selection changes.
function renderNotes(pane) {
    const refs = pane._codeViewerRefs;
    const lines = refs.lines;
    const rec = pane._codeNotes;
    const state = pane._codeViewerState;
    Array.prototype.forEach.call(lines.querySelectorAll(':scope > .codeViewerNote'), function (el) {
        lines.removeChild(el);
    });
    Array.prototype.forEach.call(lines.querySelectorAll(':scope > .codeViewerLine[data-note]'), function (row) {
        row.removeAttribute('data-note');
        row.classList.remove('codeViewerLine--noteActive');
    });
    const show = !!rec && rec.on && !!state && rec.notes.length > 0;
    const rail = show && notesMode(pane) === 'rail';
    lines.classList.toggle('codeViewerLines--notes', show);
    lines.classList.toggle('codeViewerLines--rail', rail);
    // Interleaved notes are sized to the scroller's visible width, which the
    // body exposes as a size container only while they are showing.
    refs.body.classList.toggle('codeViewerBody--notes', show && !rail);
    if (rec) rec.mode = show ? (rail ? 'rail' : 'inline') : null;
    if (!show) return;
    rec.notes.forEach(function (note) {
        const first = Math.max(note.line, state.start);
        const last = Math.min(note.end, state.end);
        if (first > last) return;
        for (let n = first; n <= last; n++) {
            const row = listingRow(pane, n);
            if (row) row.dataset.note = String(note.line);
        }
        const el = buildNote(state, note);
        const anchor = listingRow(pane, rail ? first : last);
        if (!anchor) return;
        if (rail) el.style.gridRow = (first - state.start + 1) + ' / span ' + (last - first + 1);
        lines.insertBefore(el, anchor.nextSibling);
    });
    setActiveNote(pane, rec.active);
}

// Light note `line` and its rows (0 lights none).
function setActiveNote(pane, line) {
    const rec = pane._codeNotes;
    if (rec) rec.active = line || 0;
    const lines = pane._codeViewerRefs.lines;
    const key = String(line || '');
    Array.prototype.forEach.call(lines.querySelectorAll(':scope > .codeViewerNote'), function (el) {
        el.classList.toggle('codeViewerNote--active', !!line && el.dataset.noteLine === key);
    });
    Array.prototype.forEach.call(lines.querySelectorAll(':scope > .codeViewerLine[data-note]'), function (row) {
        row.classList.toggle('codeViewerLine--noteActive', !!line && row.dataset.note === key);
    });
}

// The note line a listing element belongs to — a note, or a row one covers.
function noteLineAt(pane, target) {
    const el = target && target.closest ? target.closest('.codeViewerNote, .codeViewerLine[data-note]') : null;
    if (!el || el.parentNode !== pane._codeViewerRefs.lines) return 0;
    return Number(el.classList.contains('codeViewerNote') ? el.dataset.noteLine : el.dataset.note) || 0;
}

function toggleNotes(pane) {
    const rec = pane._codeNotes;
    const file = pane._codeViewerFile;
    if (!rec || !file || !notesHandler) return;
    rec.on = !rec.on;
    setCodeNotesOn(file.repo, rec.on);
    syncNotesToggle(pane);
    setNotesStatus(pane, '');
    renderNotes(pane);
    if (rec.on) requestNotes(pane, false);
}

// Whether the toggle's menu has anything to offer: a file too long for one call
// whose definitions the index can name.
function canNoteWhole(pane) {
    const state = pane._codeViewerState;
    return !!state && !!notesHandler && state.total > NOTES_WHOLE_MAX && fileDefs(state).length > 0;
}

function openNotesMenu(pane) {
    if (!canNoteWhole(pane)) return;
    wireViewerGlobals();
    pane._codeViewerRefs.notesMenu.hidden = false;
}

function closeNotesMenu(pane) {
    pane._codeViewerRefs.notesMenu.hidden = true;
}

function noteWholeFile(pane) {
    const rec = pane._codeNotes;
    const file = pane._codeViewerFile;
    if (!rec || !file) return;
    if (!rec.on) {
        rec.on = true;
        setCodeNotesOn(file.repo, true);
        syncNotesToggle(pane);
        setNotesStatus(pane, '');
    }
    requestNotes(pane, true);
}

// A note's text was tapped: open chat on its line (or statement), seeded.
function askAboutNote(pane, line) {
    const rec = pane._codeNotes;
    const state = pane._codeViewerState;
    if (!rec || !state || !askHandler) return;
    const note = rec.notes.filter(function (n) { return n.line === line; })[0];
    if (!note) return;
    askHandler({
        repo: state.repo,
        filePath: state.filePath,
        srcRoot: state.srcRoot,
        start: note.line,
        end: note.end || note.line,
        text: state.lines.slice(note.line - 1, note.end || note.line),
        seed: 'Explain line ' + note.line,
    });
}

// A note's ref chip was tapped: peek the definition like a tapped name would.
function traceNoteRef(pane, chip) {
    const state = pane._codeViewerState;
    const note = chip.closest('.codeViewerNote');
    if (!state || !state.trace || !note) return;
    traceName(pane, chip.dataset.name, null, Number(note.dataset.noteLine), {
        repo: state.repo,
        srcRoot: state.srcRoot,
        filePath: state.filePath,
        fileKey: state.trace.fileKey,
        symbols: state.trace.symbols,
    }, true);
}

// The toggle's, the menu's and the notes' wiring for one pane.
function wireNotes(pane) {
    const refs = pane._codeViewerRefs;
    refs.notes.addEventListener('click', function () {
        // The long-press that opened the menu must not also flip the toggle.
        if (pane._codeNotesPressed) { pane._codeNotesPressed = false; return; }
        closeNotesMenu(pane);
        toggleNotes(pane);
    });
    refs.notes.addEventListener('contextmenu', function (event) {
        if (!canNoteWhole(pane)) return;
        event.preventDefault();
        openNotesMenu(pane);
    });
    refs.notes.addEventListener('touchstart', function (event) {
        if (pane._codeNotesPress) clearTimeout(pane._codeNotesPress.timer);
        const t = event.touches && event.touches[0];
        if (!t) return;
        const press = { x: t.clientX, y: t.clientY, timer: null };
        press.timer = setTimeout(function () {
            if (pane._codeNotesPress !== press) return;
            pane._codeNotesPress = null;
            if (!canNoteWhole(pane)) return;
            pane._codeNotesPressed = true;
            openNotesMenu(pane);
        }, LONG_PRESS_MS);
        pane._codeNotesPress = press;
    }, { passive: true });
    refs.notes.addEventListener('touchmove', function (event) {
        const press = pane._codeNotesPress;
        const t = event.touches && event.touches[0];
        if (!press || !t) return;
        if (Math.abs(t.clientX - press.x) > LONG_PRESS_SLOP || Math.abs(t.clientY - press.y) > LONG_PRESS_SLOP) {
            clearTimeout(press.timer);
            pane._codeNotesPress = null;
        }
    }, { passive: true });
    const endPress = function () {
        if (pane._codeNotesPress) clearTimeout(pane._codeNotesPress.timer);
        pane._codeNotesPress = null;
    };
    refs.notes.addEventListener('touchend', endPress);
    refs.notes.addEventListener('touchcancel', endPress);
    refs.notesWhole.addEventListener('click', function () {
        closeNotesMenu(pane);
        noteWholeFile(pane);
    });

    // Hover pairs a row with its note (and back); a tap does the same on touch.
    refs.lines.addEventListener('mouseover', function (event) {
        const rec = pane._codeNotes;
        if (!rec || !rec.mode) return;
        const line = noteLineAt(pane, event.target);
        if (line !== rec.active) setActiveNote(pane, line);
    });
    refs.lines.addEventListener('mouseleave', function () {
        const rec = pane._codeNotes;
        if (rec && rec.active) setActiveNote(pane, 0);
    });
    refs.lines.addEventListener('click', function (event) {
        const t = event.target;
        if (!t || !t.closest || !pane._codeNotes || !pane._codeNotes.mode) return;
        const chip = t.closest('.codeViewerNoteRef');
        if (chip) { traceNoteRef(pane, chip); return; }
        const text = t.closest('.codeViewerNoteText');
        if (text) { askAboutNote(pane, noteLineAt(pane, text)); return; }
        // A number or a name has its own job.
        if (t.closest('button')) return;
        const line = noteLineAt(pane, t);
        if (line) setActiveNote(pane, line);
    });

    // Rail or interleaved follows the pane's width, not the viewport's: the chat
    // pane opening on desktop narrows the viewer without resizing the window.
    if (typeof ResizeObserver === 'function') {
        try {
            new ResizeObserver(function () {
                const rec = pane._codeNotes;
                if (rec && rec.mode && notesMode(pane) !== rec.mode) renderNotes(pane);
            }).observe(pane);
        } catch (e) { /* the mode is still chosen on every render */ }
    }

    // A long file is annotated a definition at a time, so scrolling into one that
    // has none yet fetches it once the listing settles.
    refs.body.addEventListener('scroll', function () {
        const rec = pane._codeNotes;
        const state = pane._codeViewerState;
        if (!rec || !rec.on || !state || state.total <= NOTES_WHOLE_MAX) return;
        if (pane._codeNotesTimer) clearTimeout(pane._codeNotesTimer);
        pane._codeNotesTimer = setTimeout(function () {
            pane._codeNotesTimer = null;
            requestNotes(pane, false);
        }, NOTES_SCROLL_MS);
    }, { passive: true });
}

// ── Trace ────────────────────────────────────────────────────────────────────

// The index key for a repo-relative path: the manifest names files relative to
// srcRoot, so strip it back off.
function fileKeyFor(srcRoot, filePath) {
    const root = String(srcRoot || '').replace(/\/+$/, '');
    return (root && filePath.indexOf(root + '/') === 0) ? filePath.slice(root.length + 1) : filePath;
}

function baseName(path) {
    const s = String(path || '');
    return s.slice(s.lastIndexOf('/') + 1);
}

function trailLabel(entry) {
    return baseName(entry.filePath) + ':' + entry.line + ' › ' + entry.label;
}

// Re-wrap the names on lines already painted, for an index that arrived after
// the source did.
function redecorate(state) {
    const rows = state.pane._codeViewerRefs.lines.querySelectorAll('.codeViewerLine');
    Array.prototype.forEach.call(rows, function (row) {
        const n = Number(row.dataset.line);
        const code = row.querySelector('.codeViewerCode');
        if (code && n >= 1 && n <= state.lines.length) fillCode(code, state.lines[n - 1], state.trace);
    });
}

function refreshTrail(pane) {
    const refs = pane._codeViewerRefs;
    clearEl(refs.trailChips);
    refs.trail.hidden = trail.length === 0;
    trail.forEach(function (entry, i) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'codeViewerTrailChip';
        chip.dataset.index = String(i);
        chip.textContent = trailLabel(entry);
        refs.trailChips.appendChild(chip);
    });
}

// Go back to trail point `index`, dropping it and everything after it.
function jumpToTrail(pane, index) {
    const entry = trail[index];
    const host = pane.parentElement;
    if (!entry || !host) return;
    trail = trail.slice(0, index);
    renderCodeViewer(host, {
        target: { repo: entry.repo },
        filePath: entry.filePath,
        startLine: entry.line,
        endLine: entry.line,
        srcRoot: entry.srcRoot,
        keepTrail: true,
    });
}

let globalsWired = false;
// Document-level listeners every pane shares, wired once. Escape closes an open
// peek before anything else hears it — the mobile code sheet's own Escape
// listens on document, so this listens a level above — and with no peek open it
// clears a selection instead, so a second Escape still reaches the sheet. A
// pointer released anywhere ends a gutter drag.
function wireViewerGlobals() {
    if (globalsWired || typeof window === 'undefined') return;
    globalsWired = true;
    window.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        let menuClosed = false;
        panes.forEach(function (p) {
            if (!p._codeViewerRefs.notesMenu.hidden) { closeNotesMenu(p); menuClosed = true; }
        });
        if (menuClosed) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const layer = document.querySelector('.codeTraceLayer');
        if (layer) {
            event.preventDefault();
            event.stopPropagation();
            closePeek(layer.parentElement);
            return;
        }
        // Only a selection the user is plausibly looking at: one in a mounted
        // pane, while focus is in that pane or nowhere in particular.
        const focus = document.activeElement;
        let cleared = false;
        panes.forEach(function (p) {
            if (!p._codeSelection || !p.isConnected || p.hidden) return;
            if (focus && focus !== document.body && !p.contains(focus)) return;
            clearSelection(p);
            cleared = true;
        });
        if (cleared) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
    const endDrag = function () {
        panes.forEach(function (p) {
            if (!p._codeSelectDrag) return;
            p._codeSelectDrag = null;
            p._codeViewerRefs.lines.classList.remove('codeViewerLines--selecting');
        });
    };
    // The Notes menu closes on a press or a right-click anywhere outside it.
    const closeMenusOutside = function (event) {
        panes.forEach(function (p) {
            const refs = p._codeViewerRefs;
            if (refs.notesMenu.hidden) return;
            const wrap = refs.notesMenu.parentNode;
            if (event.target && wrap && wrap.contains(event.target)) return;
            closeNotesMenu(p);
        });
    };
    document.addEventListener('pointerdown', closeMenusOutside, true);
    document.addEventListener('contextmenu', closeMenusOutside, true);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', function () {
        panes.forEach(function (p) { if (p._codeSelection) placeSelectBar(p); });
    });
}

function closePeek(pane) {
    if (!pane) return;
    const layer = pane.querySelector(':scope > .codeTraceLayer');
    if (layer) layer.remove();
    pane._codeTracePeek = null;
}

// A name was tapped — in the listing (`fresh`, which starts a new peek trail) or
// inside a peek (which extends it). Resolve it and peek or pick.
function startTrace(pane, btn, from, fresh) {
    const row = btn.closest('[data-line]');
    const line = row ? Number(row.dataset.line) : 0;
    traceName(pane, btn.dataset.name, btn.dataset.qualifier || null, line, from, fresh);
}

// Resolve `name` as written on `line` of `from`'s file and peek or pick — the
// half of a trace that doesn't care whether a listing name or a note's ref chip
// was tapped.
function traceName(pane, name, qualifier, line, from, fresh) {
    const candidates = resolveName(from.symbols, from.fileKey, line, name, qualifier);
    if (!candidates.length) return;
    const prev = (!fresh && pane._codeTracePeek) ? pane._codeTracePeek.trail : [];
    const peek = {
        repo: from.repo,
        srcRoot: from.srcRoot,
        symbols: from.symbols,
        fromKey: from.fileKey,
        name: name,
        binding: qualifier || name,
        trail: prev.concat([{ repo: from.repo, srcRoot: from.srcRoot, filePath: from.filePath, line: line, label: name }]),
    };
    pane._codeTracePeek = peek;
    const top = topRanked(candidates);
    if (top.length === 1) showPeek(pane, peek, top[0]);
    else showPicker(pane, peek, candidates);
}

// A fresh overlay layer in `pane`, replacing any open one. The layer is the
// backdrop: a tap that lands on it rather than the card closes the peek.
function openLayer(pane, label) {
    wireViewerGlobals();
    const old = pane.querySelector(':scope > .codeTraceLayer');
    if (old) old.remove();
    const layer = document.createElement('div');
    layer.className = 'codeTraceLayer';
    layer.addEventListener('click', function (event) {
        if (event.target === layer) closePeek(pane);
    });
    const card = document.createElement('div');
    card.className = 'codeTracePeek';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', label);
    layer.appendChild(card);
    pane.appendChild(layer);
    return { layer: layer, card: card };
}

function buildCloseButton(pane) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'codeTracePeekClose';
    close.textContent = 'Close';
    close.addEventListener('click', function () { closePeek(pane); });
    return close;
}

function showPeek(pane, peek, cand) {
    const def = cand.def;
    const defPath = joinSrcRootPath(peek.srcRoot, cand.file);
    const ui = openLayer(pane, 'Definition of ' + def.name);
    const card = ui.card;

    const head = document.createElement('div');
    head.className = 'codeTracePeekHead';
    const nameEl = document.createElement('span');
    nameEl.className = 'codeTracePeekName';
    nameEl.textContent = def.name;
    head.appendChild(nameEl);
    const kind = document.createElement('span');
    kind.className = 'codeTracePeekKind';
    kind.textContent = def.kind || '';
    head.appendChild(kind);
    card.appendChild(head);

    const via = cand.reason === 'import' ? ('via import ' + peek.binding)
        : (cand.file === peek.fromKey ? 'same file' : 'name match');
    const meta = document.createElement('div');
    meta.className = 'codeTracePeekMeta';
    meta.textContent = cand.file + ' · lines ' + def.start + '–' + def.end + ' · ' + via;
    card.appendChild(meta);

    const chips = document.createElement('div');
    chips.className = 'codeTraceChips';
    peek.trail.forEach(function (entry) {
        const chip = document.createElement('span');
        chip.className = 'codeTraceChip';
        chip.textContent = trailLabel(entry);
        chips.appendChild(chip);
    });
    card.appendChild(chips);

    const code = document.createElement('div');
    code.className = 'codeTracePeekCode';
    const status = document.createElement('div');
    status.className = 'codeTracePeekStatus';
    status.textContent = 'Loading…';
    code.appendChild(status);
    card.appendChild(code);

    const trace = { symbols: peek.symbols, fileKey: cand.file };
    code.addEventListener('click', function (event) {
        const btn = event.target && event.target.closest ? event.target.closest('.codeViewerSym') : null;
        if (!btn) return;
        startTrace(pane, btn, {
            repo: peek.repo,
            srcRoot: peek.srcRoot,
            filePath: defPath,
            fileKey: cand.file,
            symbols: peek.symbols,
        }, false);
    });

    const actions = document.createElement('div');
    actions.className = 'codeTracePeekActions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'codeTracePeekOpen';
    open.textContent = 'Open ' + baseName(cand.file) + ' →';
    open.addEventListener('click', function () {
        const host = pane.parentElement;
        if (!host) return;
        trail = trail.concat(peek.trail);
        closePeek(pane);
        renderCodeViewer(host, {
            target: { repo: peek.repo },
            filePath: defPath,
            startLine: def.start,
            endLine: def.end,
            srcRoot: peek.srcRoot,
            keepTrail: true,
        });
    });
    actions.appendChild(open);
    actions.appendChild(buildCloseButton(pane));
    card.appendChild(actions);

    fetchLines({ repo: peek.repo }, defPath).then(function (res) {
        // Replaced or closed while the read was in flight.
        if (!ui.layer.parentElement) return;
        if (!res.ok) {
            status.textContent = 'Couldn’t read this file.';
            return;
        }
        code.removeChild(status);
        const last = Math.min(def.end, def.start + PEEK_ROWS - 1, res.lines.length);
        for (let n = def.start; n <= last; n++) {
            code.appendChild(buildLine(n, res.lines[n - 1], true, trace));
        }
        const rest = Math.min(def.end, res.lines.length) - last;
        if (rest > 0) {
            const more = document.createElement('div');
            more.className = 'codeTracePeekMore';
            more.textContent = '… ' + rest + ' more line' + (rest === 1 ? '' : 's');
            code.appendChild(more);
        }
    });
}

function showPicker(pane, peek, candidates) {
    const ui = openLayer(pane, 'Definitions of ' + peek.name);
    const card = ui.card;
    card.classList.add('codeTracePicker');

    const head = document.createElement('div');
    head.className = 'codeTracePeekHead';
    const nameEl = document.createElement('span');
    nameEl.className = 'codeTracePeekName';
    nameEl.textContent = peek.name;
    head.appendChild(nameEl);
    const count = document.createElement('span');
    count.className = 'codeTracePeekKind';
    count.textContent = candidates.length + ' definitions';
    head.appendChild(count);
    card.appendChild(head);

    const list = document.createElement('div');
    list.className = 'codeTracePickerList';
    candidates.forEach(function (cand, i) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'codeTracePickerItem';
        const where = document.createElement('span');
        where.className = 'codeTracePickerWhere';
        where.textContent = (cand.file === peek.fromKey ? '' : cand.file + ' · ') + 'line ' + cand.def.start;
        item.appendChild(where);
        const scope = document.createElement('span');
        scope.className = 'codeTracePickerScope';
        scope.textContent = cand.def.parent ? ('inside ' + cand.def.parent + '()') : 'top level';
        item.appendChild(scope);
        if (i === 0 && cand.reason === 'same scope') {
            const best = document.createElement('span');
            best.className = 'codeTracePickerBest';
            best.textContent = 'BEST MATCH · same scope';
            item.appendChild(best);
        }
        item.addEventListener('click', function () { showPeek(pane, peek, cand); });
        list.appendChild(item);
    });
    card.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'codeTracePeekActions';
    actions.appendChild(buildCloseButton(pane));
    card.appendChild(actions);
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
//   • srcRoot   — the manifest's source folder, which maps `filePath` to its key
//                 in the trace index. Remembered per repo once given; without
//                 one ever given, nothing in the listing is tappable.
//   • keepTrail — set only by a step along the trace trail; every other open
//                 clears it.
// Returns the pane element, or null when the arguments can't address a file.
export function renderCodeViewer(host, opts) {
    if (!host || !opts) return null;
    const target = opts.target;
    const filePath = String(opts.filePath || '');
    if (!target || !target.repo || !filePath) return null;

    // One viewer at a time: opening into a different host (another view's column
    // or sheet) empties the one that was showing, so no surface keeps reporting
    // a file it has stopped being the home of.
    if (active && active.host !== host) clearCodeViewer(active.host);

    const hl = normalizeSpan(opts.startLine, opts.endLine);
    const gen = ++renderGen;
    const shell = ensureShell(host);
    const pane = shell.pane;
    const refs = pane._codeViewerRefs;

    if (typeof opts.srcRoot === 'string') srcRoots.set(target.repo, opts.srcRoot);
    const srcRoot = srcRoots.get(target.repo);
    if (!opts.keepTrail) trail = [];
    closePeek(pane);
    refreshTrail(pane);
    if (typeof srcRoot === 'string') loadSymbols(target.repo);

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
    resetNotes(pane, target.repo);
    clearSelection(pane);
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
        srcRoot: srcRoot,
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
            sha: res.sha || null,
            total: total,
            hl: hl,
            start: 1,
            end: 0,
            srcRoot: srcRoot,
            trace: null,
        };
        pane._codeViewerState = state;
        if (typeof srcRoot === 'string') {
            const fileKey = fileKeyFor(srcRoot, filePath);
            const ready = getLoadedSymbols(target.repo);
            if (ready) {
                state.trace = { symbols: ready, fileKey: fileKey };
            } else if (ready === undefined) {
                // Still loading: paint now, wrap the names once it lands.
                loadSymbols(target.repo).then(function (symbols) {
                    if (!symbols || pane._codeViewerState !== state) return;
                    state.trace = { symbols: symbols, fileKey: fileKey };
                    redecorate(state);
                    // A long file's notes are scoped by definition, which only
                    // the index can name.
                    renderNotes(pane);
                    if (pane._codeNotes && pane._codeNotes.on) requestNotes(pane, false);
                });
            }
        }
        const win = computeWindow(total, hl);
        state.start = win.start;
        state.end = win.end;
        refs.status.hidden = true;
        refs.status.textContent = '';
        if (win.end >= win.start) paintRange(state, win.start, win.end, false);
        refreshWindowChrome(state);
        if (hl) scrollToLine(state, hl.start);
        if (pane._codeNotes && pane._codeNotes.on) requestNotes(pane, false);
    });

    return pane;
}

// Move the open file's highlight to `startLine`–`endLine` in place — no refetch,
// no repaint, the trace trail untouched — and scroll it into view. Returns false
// when it can't (no file loaded in `host` yet, or the span falls outside the
// rendered window), so the caller falls back to a fresh `renderCodeViewer`.
export function setCodeViewerHighlight(host, startLine, endLine) {
    const pane = host && host.querySelector ? host.querySelector(':scope > .codeViewerPane') : null;
    const state = pane ? pane._codeViewerState : null;
    const hl = normalizeSpan(startLine, endLine);
    if (!state || !hl || !active || active.host !== host || active.filePath !== state.filePath) return false;
    if (hl.start < state.start || hl.end > state.end) return false;
    state.hl = hl;
    active.hl = hl;
    active.banner = '';
    const refs = pane._codeViewerRefs;
    refs.banner.hidden = true;
    refs.bannerText.textContent = '';
    Array.prototype.forEach.call(refs.lines.querySelectorAll('.codeViewerLine'), function (row) {
        row.classList.toggle('codeViewerLine--hit', isHit(state, Number(row.dataset.line)));
    });
    refs.gh.href = githubBlobUrl(state.repo, state.filePath, hl);
    scrollToLine(state, hl.start);
    return true;
}

// Pin `el` above the source in `host`'s viewer, replacing any banner already
// there. The viewer's own jump banner is separate and unaffected.
export function setBanner(host, el) {
    if (!host || !el) return;
    const refs = ensureShell(host).pane._codeViewerRefs;
    clearEl(refs.slot);
    refs.slot.appendChild(el);
    refs.slot.hidden = false;
}

// Take down the banner `setBanner` pinned in `host`'s viewer, if any.
export function clearBanner(host) {
    const pane = host && host.querySelector ? host.querySelector(':scope > .codeViewerPane') : null;
    if (!pane) return;
    const refs = pane._codeViewerRefs;
    clearEl(refs.slot);
    refs.slot.hidden = true;
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
    trail = [];
    closePeek(shell.pane);
    refreshTrail(shell.pane);
    clearEl(refs.lines);
    refs.explain.disabled = true;
    refs.explain.textContent = EXPLAIN_LABEL;
    resetExplanation(shell.pane);
    resetNotes(shell.pane, null);
    clearSelection(shell.pane);
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
