// COMPLEXITY CHIPS — the trailing control on every scannable file row in the
// Structure tab's Code lens (Part 1 of the Code-lens complexity feature).
//
// Like the NEXT REFACTOR card (refactorCard.js), this module is a pure reader
// plus a dispatcher: it never scans in the browser. Tapping a chip POSTs
// `dispatch_complexity_scan` to the Worker (inject.js), whose
// `claude-complexity-scan.yml` workflow runs the ~90s Sonnet pass server-side and
// persists a `complexity_scans` row keyed on `(user_id, repo, file_path)`. The
// chip then polls that row (through listLogic, the only data path) until its
// `scanned_at` advances, and settles into a badge showing the file's OPEN hotspot
// count — `hotspots` minus the ones already named in `pushed`, so the number stays
// honest once Part 2 starts pushing hotspots into entries.
//
// The scan runs in CI rather than over an open connection for the same reason the
// refactor scan does: mobile Safari drops a request held that long.
//
// structureView.js owns the tree; this module owns the chips. `buildFileRow`
// asks for one chip per row (`buildComplexityChip`), and each Code-lens render
// loads the repo's stored rows once and hands them over (`setComplexityScans`).
// Chip state is derived — never stored on the element — so a tree repaint, a lens
// switch, or a poll tick all repaint from the same module state.

import { getCachedTargets, dispatchComplexityScan } from './inject.js';
import { listLogic } from './listLogic.js';

// The extensions the Worker's complexity pass can read. Everything else (CSS,
// JSON, SVG, markdown…) gets no chip at all rather than a chip that can only
// fail.
const SCANNABLE_EXT = /\.(?:js|mjs|cjs|jsx|ts|tsx)$/i;

// How often the stored row is re-read while a scan is in flight.
const POLL_MS = 10000;

// How long to keep polling before giving up. The workflow has to spin a runner
// up before the ~90s scan even starts, so the ceiling is generous; past it the
// chip flips to `error` and its tap re-dispatches.
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// The stored rows for the repo the Code lens is currently showing, keyed by
// repo-relative `file_path`. Replaced wholesale on each render's load.
let scansRepo = null;
let scanRows = new Map();

// Paths whose last scan failed (dispatch error or poll timeout), keyed
// repo+path. Held at module scope rather than on the chip so the error — and its
// retry affordance — survives a tree repaint.
const errorPaths = new Set();

// Every chip built so far. Disconnected chips are pruned lazily on the next
// repaint (a chip is not connected at build time, so it is only prunable once it
// has been seen in the DOM).
const chips = new Set();

// The one scan in flight, or null. Module-level because the guard is tree-wide:
// while one file is scanning, every other file's `scan` chip renders disabled.
let activeScan = null;

function keyFor(repo, path) {
    return String(repo || '') + '\n' + String(path || '');
}

// True when this path is one the Worker's complexity pass can read.
export function isScannablePath(path) {
    return SCANNABLE_EXT.test(String(path || ''));
}

// Resolve the full inject target (repo + file_path) for a repo string so the
// dispatch carries the same shape the other Worker calls use. Mirrors
// refactorCard's resolver, including its repo-only fallback (the Worker resolves
// the rest). Guarded with typeof so a partial mock of inject.js degrades to the
// fallback rather than throwing.
function resolveTarget(repo) {
    const targets = (typeof getCachedTargets === 'function') ? (getCachedTargets() || []) : [];
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] && targets[i].repo === repo) return targets[i];
    }
    return { repo: repo };
}

// The stored row for a path, or null — only for the repo whose rows are loaded,
// so a chip can never read another repo's scan.
function rowFor(repo, path) {
    if (!repo || repo !== scansRepo) return null;
    return scanRows.get(path) || null;
}

// Open hotspots = every hotspot whose `name` is not already in the row's
// `pushed` array. Defensive about both arrays: a legacy row missing `pushed`
// counts every hotspot, and a row missing `hotspots` counts zero (which renders
// as `clean`).
export function openHotspotCount(row) {
    const hotspots = (row && Array.isArray(row.hotspots)) ? row.hotspots : [];
    const pushed = (row && Array.isArray(row.pushed)) ? row.pushed : [];
    let open = 0;
    for (let i = 0; i < hotspots.length; i++) {
        const h = hotspots[i];
        if (!h) continue;
        if (pushed.indexOf(h.name) === -1) open += 1;
    }
    return open;
}

// ── Chip rendering ───────────────────────────────────────────────────

// The chip's state, derived fresh on every repaint:
//   scanning — this file is the one scan in flight
//   error    — its last scan failed to dispatch or timed out (tap retries)
//   count    — a stored row with open hotspots (inert in Part 1)
//   clean    — a stored row with none (inert in Part 1)
//   scan     — nothing stored yet (tap dispatches; disabled while another scans)
function chipState(chip) {
    if (activeScan && activeScan.repo === chip._cxRepo && activeScan.path === chip._cxPath) {
        return 'scanning';
    }
    if (errorPaths.has(keyFor(chip._cxRepo, chip._cxPath))) return 'error';
    const row = rowFor(chip._cxRepo, chip._cxPath);
    if (row) return openHotspotCount(row) > 0 ? 'count' : 'clean';
    return 'scan';
}

// Inline SVG for the two glyph states, matching the inline-SVG approach the rest
// of the app uses instead of importing icon assets. The hotspot glyph is a
// flame; the scan glyph a magnifier.
function chipIcon(state) {
    if (state === 'count') {
        return '<svg class="complexityChipIcon" viewBox="0 0 12 12" width="10" height="10" fill="none"'
            + ' stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"'
            + ' aria-hidden="true"><path d="M6 1.2c2 2 3.2 3.2 3.2 5A3.2 3.2 0 0 1 2.8 6.2c0-1 .5-1.8 1.2-2.5.1 1 .6 1.5 1.1 1.6C4.6 4 5.2 2.4 6 1.2Z"/></svg>';
    }
    return '<svg class="complexityChipIcon" viewBox="0 0 12 12" width="10" height="10" fill="none"'
        + ' stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"'
        + ' aria-hidden="true"><circle cx="5.2" cy="5.2" r="3.2"/><line x1="7.6" y1="7.6" x2="10.4" y2="10.4"/></svg>';
}

function chipInnerHTML(state, count) {
    if (state === 'scanning') {
        return '<span class="complexityChipSpinner" aria-hidden="true"></span>';
    }
    if (state === 'count') {
        return chipIcon('count') + '<span class="complexityChipLabel">' + count + '</span>';
    }
    if (state === 'clean') {
        return '<span class="complexityChipLabel">clean</span>';
    }
    if (state === 'error') {
        return '<span class="complexityChipLabel">retry</span>';
    }
    return chipIcon('scan') + '<span class="complexityChipLabel">scan</span>';
}

function chipAria(state, count, name) {
    const file = name || 'this file';
    if (state === 'scanning') return 'Scanning ' + file + ' for complexity hotspots';
    if (state === 'count') {
        return count + (count === 1 ? ' open complexity hotspot in ' : ' open complexity hotspots in ') + file;
    }
    if (state === 'clean') return 'No complexity hotspots in ' + file;
    if (state === 'error') return 'Complexity scan failed for ' + file + ' — tap to retry';
    return 'Scan ' + file + ' for complexity hotspots';
}

// Paint one chip from the derived state. Badge and `clean` chips are inert in
// Part 1 (expansion arrives in Part 2), and a `scan` chip is disabled while any
// other file is scanning — the tree-wide single-scan guard, rendered.
function renderChip(chip) {
    const state = chipState(chip);
    const row = state === 'count' ? rowFor(chip._cxRepo, chip._cxPath) : null;
    const count = row ? openHotspotCount(row) : 0;
    chip.dataset.state = state;
    chip.innerHTML = chipInnerHTML(state, count);
    chip.setAttribute('aria-label', chipAria(state, count, chip._cxName));
    chip.title = chipAria(state, count, chip._cxName);
    const blocked = state === 'scan' && !!activeScan;
    chip.disabled = blocked || state === 'scanning' || state === 'count' || state === 'clean';
}

// Repaint every live chip, pruning the ones whose tree has been replaced. A chip
// is only prunable once it has actually been in the DOM — `buildComplexityChip`
// returns it before structureView appends it, so an unseen chip is still pending
// mount, not stale.
function renderAll() {
    chips.forEach(function (chip) {
        if (chip.isConnected) {
            chip._cxSeen = true;
        } else if (chip._cxSeen) {
            chips.delete(chip);
            return;
        }
        renderChip(chip);
    });
}

// ── Scan lifecycle ───────────────────────────────────────────────────

function clearPollTimer() {
    if (activeScan && activeScan.timer) {
        clearTimeout(activeScan.timer);
        activeScan.timer = null;
    }
}

function finishScan() {
    clearPollTimer();
    activeScan = null;
    renderAll();
}

function failScan() {
    if (!activeScan) return;
    errorPaths.add(keyFor(activeScan.repo, activeScan.path));
    finishScan();
}

// Whether the stored row for the scanning file has actually moved on. A file
// with no row before the scan is settled by the row simply appearing; one that
// already had a row needs a newer `scanned_at` or a different `sha`, so a
// re-scan isn't reported complete by the row it started from.
function rowAdvanced(scan, row) {
    if (!scan.hadRow) return true;
    return (row.scanned_at || null) !== scan.baselineAt
        || (row.sha || null) !== scan.baselineSha;
}

function findRow(rows, path) {
    for (let i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].file_path === path) return rows[i];
    }
    return null;
}

// Fold a freshly-read row set into the loaded map — but only when it is still
// the repo the lens is showing, so a poll that lands after a repo switch can't
// paint another repo's counts onto the tree.
function applyRows(repo, rows) {
    if (repo !== scansRepo) return;
    scanRows = new Map();
    rows.forEach(function (row) {
        if (row && row.file_path) scanRows.set(row.file_path, row);
    });
}

function scheduleTick() {
    if (!activeScan) return;
    activeScan.timer = setTimeout(pollTick, POLL_MS);
}

// One poll tick: re-read the repo's rows through the SAME listLogic function the
// render load uses, match by `file_path`, and settle when the row advances. A
// failed read is not fatal — it just costs a tick — so a blip mid-scan doesn't
// strand the chip in `scanning`; only the deadline does that, and it flips to
// `error`.
async function pollTick() {
    const scan = activeScan;
    if (!scan) return;
    scan.timer = null;
    let loaded;
    try {
        loaded = await listLogic.loadComplexityScans(scan.repo);
    } catch (e) {
        loaded = null;
    }
    if (activeScan !== scan) return; // superseded (repo switch / reset)
    if (loaded && loaded.ok !== false) {
        const rows = Array.isArray(loaded.rows) ? loaded.rows : [];
        applyRows(scan.repo, rows);
        const row = findRow(rows, scan.path);
        if (row && rowAdvanced(scan, row)) {
            errorPaths.delete(keyFor(scan.repo, scan.path));
            finishScan();
            return;
        }
    }
    if (Date.now() >= scan.deadline) {
        failScan();
        return;
    }
    scheduleTick();
}

// Dispatch a scan for one file and begin polling for its row. The tree-wide
// guard is checked here as well as in the chip's disabled state, so a stale
// click handler can never open a second scan.
async function startScan(repo, path) {
    if (activeScan) return;
    const before = rowFor(repo, path);
    errorPaths.delete(keyFor(repo, path));
    const scan = {
        repo: repo,
        path: path,
        hadRow: !!before,
        baselineAt: before ? (before.scanned_at || null) : null,
        baselineSha: before ? (before.sha || null) : null,
        deadline: Date.now() + POLL_TIMEOUT_MS,
        timer: null,
    };
    activeScan = scan;
    renderAll();
    let res;
    try {
        res = await dispatchComplexityScan(resolveTarget(repo), path);
    } catch (e) {
        res = { ok: false, reason: (e && e.message) || '' };
    }
    if (activeScan !== scan) return; // superseded while the POST was in flight
    if (!res || res.ok === false) {
        failScan();
        return;
    }
    scheduleTick();
}

// ── Public surface ───────────────────────────────────────────────────

// Hand the Code lens's freshly-loaded rows to the chips. Called once per Code-lens
// render with whatever `listLogic.loadComplexityScans` returned (an empty list on
// a failed read, so the chips degrade to their unscanned state rather than
// surfacing an error the row has no room for).
export function setComplexityScans(repo, rows) {
    scansRepo = repo || null;
    scanRows = new Map();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
        if (row && row.file_path) scanRows.set(row.file_path, row);
    });
    renderAll();
}

// Build the trailing chip for one file row, or return null when the file isn't
// one the complexity pass can read. `filePath` is REPO-relative (the manifest's
// srcRoot-joined path) because that is what both the Worker and the stored
// `file_path` column speak; `fileName` is only used for the accessible label.
//
// The click handler stops propagation so a chip tap never opens the row's file in
// the code viewer, and does nothing at all in the inert states — the derived
// `disabled` already blocks them, but the guard keeps the chip honest if a caller
// ever re-enables it.
export function buildComplexityChip(repo, filePath, fileName) {
    if (!repo || !filePath || !isScannablePath(filePath)) return null;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'complexityChip';
    chip._cxRepo = repo;
    chip._cxPath = filePath;
    chip._cxName = fileName || filePath;
    chip.addEventListener('click', function (event) {
        event.stopPropagation();
        if (chip.disabled) return;
        const state = chip.dataset.state || '';
        if (state !== 'scan' && state !== 'error') return;
        startScan(repo, filePath);
    });
    // Keyboard activation on the row is Enter/Space, which would bubble into the
    // row's own open-in-viewer handler; stop it here for the same reason the
    // click is stopped.
    chip.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    chips.add(chip);
    renderChip(chip);
    return chip;
}

// Drop all chip and scan state. Exported for tests and for a hard reset — the
// normal render path replaces the rows via setComplexityScans and prunes stale
// chips on its own.
export function resetComplexityHotspots() {
    clearPollTimer();
    activeScan = null;
    scansRepo = null;
    scanRows = new Map();
    errorPaths.clear();
    chips.clear();
}
