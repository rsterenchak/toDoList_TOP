// COMPLEXITY CHIPS — the trailing control on every scannable file row in the
// Structure tab's Code lens, and the hotspot nest that opens beneath it.
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
//
// PART 2 — the hotspot nest. A settled chip is no longer inert: tapping the badge
// (or the `clean` chip) opens a nest inside the same `.structureFileWrap`, right
// under the file row. The nest leads with a header — the scan's age on the left, a
// `rescan` chip on the right — then one row per hotspot. Tapping a hotspot opens an
// action row carrying up to three chips: `O↓ tighten`, `O↑ relax`, and a line-span
// jump chip that opens the span in the code viewer. Either dial builds a
// `Type: feature` TODO.md entry from the hotspot's own data and ships it through
// shipEntryForTodo, then retires the hotspot (`listLogic.markComplexityHotspotPushed`)
// so the badge count drops and the row dims. The nest is found through
// `chip.closest('.structureFileWrap')` rather than a new structureView hook, and its
// expansion state lives purely in the DOM — a repo switch or a lens switch rebuilds
// the tree, which is exactly what "ephemeral" means here.

import {
    getCachedTargets,
    dispatchComplexityScan,
    fetchActiveRuns,
    isInjectConfigured,
} from './inject.js';
import { listLogic } from './listLogic.js';
import { shipEntryForTodo } from './shipEntry.js';
import { renderCodeViewer } from './codeViewer.js';

// How long the "Entry shipped — run dispatched" confirmation lingers on the
// action row before the nest re-renders with the hotspot retired.
const PUSHED_ADVANCE_MS = 2000;

// How long a transient header note (the rescan's "no change since last scan")
// stays in the nest's eyebrow before the scanned age returns.
const NOTE_MS = 6000;

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
//   count    — a stored row with open hotspots (tap toggles the nest)
//   clean    — a stored row with none (tap toggles the header-only nest)
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

// Paint one chip from the derived state. Badge and `clean` chips are the nest's
// disclosure control, so they carry `aria-expanded`; a `scan` chip is disabled
// while any other file is scanning — the tree-wide single-scan guard, rendered.
// Only `scanning` is genuinely inert now.
function renderChip(chip) {
    const state = chipState(chip);
    const row = state === 'count' ? rowFor(chip._cxRepo, chip._cxPath) : null;
    const count = row ? openHotspotCount(row) : 0;
    chip.dataset.state = state;
    chip.innerHTML = chipInnerHTML(state, count);
    chip.setAttribute('aria-label', chipAria(state, count, chip._cxName));
    chip.title = chipAria(state, count, chip._cxName);
    const blocked = state === 'scan' && !!activeScan;
    chip.disabled = blocked || state === 'scanning';
    if (state === 'count' || state === 'clean') {
        chip.setAttribute('aria-expanded', chip._cxNest ? 'true' : 'false');
    } else {
        chip.removeAttribute('aria-expanded');
    }
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
        renderNest(chip);
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

// A rescan that ran to the deadline without the file's sha moving. The Worker's
// `unchanged` branch writes nothing by design, and the published manifest carries
// no per-file blob sha to pre-check against, so silence here means "same file,
// nothing to redo" — not a failure. A runner that genuinely died already fails
// loudly as a red Actions run, so the quiet client resolution is the correct half
// of that split: back to the badge, with a transient note in the nest's eyebrow.
function noChangeScan(scan) {
    setNoteForPath(scan.repo, scan.path, 'no change since last scan');
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
        if (row) {
            scan.sawRow = true;
            scan.lastSha = row.sha || null;
        }
        if (row && rowAdvanced(scan, row)) {
            errorPaths.delete(keyFor(scan.repo, scan.path));
            finishScan();
            return;
        }
    }
    if (Date.now() >= scan.deadline) {
        if (scan.rescan && scan.sawRow && scan.lastSha === scan.baselineSha) {
            noChangeScan(scan);
        } else {
            failScan();
        }
        return;
    }
    scheduleTick();
}

// Dispatch a scan for one file and begin polling for its row. The tree-wide
// guard is checked here as well as in the chip's disabled state, so a stale
// click handler can never open a second scan.
//
// `opts.rescan` marks a scan started from an already-scanned file's nest header.
// It changes nothing about the dispatch or the poll — only how the DEADLINE is
// read: a rescan that expires with the row's sha exactly as it was at dispatch
// time is the Worker's `unchanged` branch, which deliberately writes nothing, so
// it settles quietly as "no change" instead of flipping the chip to `error`.
async function startScan(repo, path, opts) {
    if (activeScan) return;
    const before = rowFor(repo, path);
    errorPaths.delete(keyFor(repo, path));
    const scan = {
        repo: repo,
        path: path,
        hadRow: !!before,
        baselineAt: before ? (before.scanned_at || null) : null,
        baselineSha: before ? (before.sha || null) : null,
        rescan: !!(opts && opts.rescan),
        // Whether any poll read actually returned this file's row, and the sha it
        // last carried. The no-change resolution needs a sha we genuinely read —
        // a poll whose every read failed knows nothing and must still fail loudly.
        sawRow: false,
        lastSha: before ? (before.sha || null) : null,
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

// ── Hotspot nest ─────────────────────────────────────────────────────
// Everything below is the expanded block that opens under a settled file row.
// It is built off `chip.closest('.structureFileWrap')` rather than a hook handed
// down by structureView, so the tree's seam is unchanged: the chip already knows
// its repo and its repo-relative path, and the wrap is the chip's own ancestor.

function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function basename(path) {
    const parts = String(path || '').split('/');
    return parts[parts.length - 1] || String(path || '');
}

// "just now" / "Xm ago" / "Xh ago" / "Xd ago" — the same shape the NEXT REFACTOR
// card's eyebrow uses, so the two scanned-age readouts read alike.
function relativeTime(iso) {
    if (!iso) return '';
    const then = Date.parse(iso);
    if (isNaN(then)) return '';
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 45) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
}

// Nothing inside the nest may reach the file row's open-in-viewer handler. The
// nest is a SIBLING of that row today, so nothing bubbles through it — but the
// wrap is a single element and any future listener on it would swallow the whole
// nest, so every control stops its own click and the nest stops the rest.
function swallow(el) {
    el.addEventListener('click', function (event) { event.stopPropagation(); });
    el.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    return el;
}

// ── Transient header note ────────────────────────────────────────────

function clearNoteTimer(chip) {
    if (chip._cxNoteTimer) {
        clearTimeout(chip._cxNoteTimer);
        chip._cxNoteTimer = null;
    }
}

// Park a transient line in the nest's eyebrow for every chip showing this file
// (a tree only ever has one, but the lookup is by repo+path rather than by
// element so it survives a repaint mid-scan). Clears itself back to the scanned
// age after NOTE_MS.
function setNoteForPath(repo, path, text) {
    chips.forEach(function (chip) {
        if (chip._cxRepo !== repo || chip._cxPath !== path) return;
        clearNoteTimer(chip);
        chip._cxNote = text;
        chip._cxNoteTimer = setTimeout(function () {
            chip._cxNoteTimer = null;
            chip._cxNote = null;
            renderNest(chip);
        }, NOTE_MS);
    });
}

// ── Open / close ─────────────────────────────────────────────────────

// The wrap the nest mounts into and the row it mounts under, or null when the
// chip isn't in a tree yet. Falls back to the chip's own row parent so a chip
// mounted outside a `.structureFileWrap` still expands in place rather than
// silently doing nothing.
function nestHost(chip) {
    if (typeof chip.closest !== 'function') return null;
    const row = chip.closest('.structureFileRow');
    if (!row) return null;
    const wrap = chip.closest('.structureFileWrap') || row.parentNode;
    if (!wrap || row.parentNode !== wrap) return null;
    return { wrap: wrap, row: row };
}

function closeNest(chip) {
    if (chip._cxNest && chip._cxNest.parentNode) {
        chip._cxNest.parentNode.removeChild(chip._cxNest);
    }
    chip._cxNest = null;
    chip._cxOpenHotspot = null;
    renderChip(chip);
}

function toggleNest(chip) {
    if (chip._cxNest) {
        closeNest(chip);
        return;
    }
    const host = nestHost(chip);
    if (!host) return;
    const nest = document.createElement('div');
    nest.className = 'complexityNest';
    // Inherit the file row's indent so the nest lines up under its own file
    // rather than at the tree's left edge.
    nest.style.setProperty(
        '--structure-depth',
        host.row.style.getPropertyValue('--structure-depth') || '0'
    );
    swallow(nest);
    host.wrap.insertBefore(nest, host.row.nextSibling);
    chip._cxNest = nest;
    chip._cxOpenHotspot = null;
    renderNest(chip);
    renderChip(chip);
}

// ── Nest rendering ───────────────────────────────────────────────────

// Repaint the open nest from the stored row. A no-op when the chip has no nest
// open, and skipped entirely while a push is mid-flight (`_cxHold`) so a poll
// tick landing during the ship can't wipe the busy state or the confirmation.
function renderNest(chip) {
    const nest = chip._cxNest;
    if (!nest) return;
    if (!nest.isConnected) { chip._cxNest = null; return; }
    if (chip._cxHold) return;
    clearEl(nest);
    const row = rowFor(chip._cxRepo, chip._cxPath);
    nest.appendChild(buildNestHeader(chip, row));
    const hotspots = (row && Array.isArray(row.hotspots)) ? row.hotspots : [];
    const pushedNames = (row && Array.isArray(row.pushed)) ? row.pushed : [];
    hotspots.forEach(function (h) {
        if (!h) return;
        const isPushed = pushedNames.indexOf(h.name) !== -1;
        nest.appendChild(buildHotspotRow(chip, h, isPushed));
        if (!isPushed && chip._cxOpenHotspot === h.name) {
            nest.appendChild(buildActionRow(chip, h));
        }
    });
}

// The nest's first row: the scan's age (or a transient note) on the left, the
// rescan chip on the right. A clean file's nest is this row alone, which is where
// its rescan affordance lives — the badge state has no other control.
function buildNestHeader(chip, row) {
    const header = document.createElement('div');
    header.className = 'complexityNestHeader';
    const age = document.createElement('span');
    age.className = 'complexityNestAge';
    if (chip._cxNote) {
        age.classList.add('complexityNestAge--note');
        age.textContent = chip._cxNote;
    } else {
        const rel = row ? relativeTime(row.scanned_at) : '';
        age.textContent = rel ? 'scanned ' + rel : 'scanned';
    }
    header.appendChild(age);
    header.appendChild(buildRescanChip(chip));
    return header;
}

// Rescan reuses the same dispatch and the same poll the row's own `scan` chip
// uses — including the tree-wide single-scan guard, so it is disabled whenever
// any file is scanning.
function buildRescanChip(chip) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'complexityNestChip complexityNestRescan';
    const mine = !!activeScan
        && activeScan.repo === chip._cxRepo
        && activeScan.path === chip._cxPath;
    btn.textContent = mine ? 'scanning…' : 'rescan';
    btn.disabled = !!activeScan;
    if (mine) btn.title = 'Scanning this file…';
    else if (activeScan) btn.title = 'Another file is being scanned.';
    else btn.title = 'Run a fresh complexity scan for this file.';
    btn.setAttribute('aria-label', mine
        ? ('Scanning ' + chip._cxName)
        : ('Rescan ' + chip._cxName + ' for complexity hotspots'));
    btn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (btn.disabled) return;
        startScan(chip._cxRepo, chip._cxPath, { rescan: true });
    });
    return btn;
}

// One hotspot: its function name and its `time` chip. Tapping toggles the action
// row beneath it — one open at a time, so opening another closes this one. A
// hotspot already pushed is dimmed, carries a `pushed` chip, and is inert: its
// entry is already in TODO.md and there is nothing left to dial.
function buildHotspotRow(chip, h, isPushed) {
    const open = !isPushed && chip._cxOpenHotspot === h.name;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'complexityHotspotRow';
    if (isPushed) btn.classList.add('complexityHotspotRow--pushed');
    if (open) btn.classList.add('complexityHotspotRow--open');
    btn.disabled = isPushed;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');

    const name = document.createElement('span');
    name.className = 'complexityHotspotName';
    name.textContent = h.name || '(unnamed)';
    btn.appendChild(name);

    if (h.time) {
        const time = document.createElement('span');
        time.className = 'complexityNestChip complexityHotspotTime';
        time.textContent = h.time;
        btn.appendChild(time);
    }
    if (isPushed) {
        const pushed = document.createElement('span');
        pushed.className = 'complexityNestChip complexityHotspotPushed';
        pushed.textContent = 'pushed';
        btn.appendChild(pushed);
    }

    btn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (btn.disabled) return;
        chip._cxOpenHotspot = open ? null : h.name;
        renderNest(chip);
    });
    return btn;
}

// The selected hotspot's action row: up to three chips. Each dial appears only
// when the scan actually proposed that direction, so a hotspot with nothing to
// tighten never offers a dial that would draft an empty entry.
function buildActionRow(chip, h) {
    const actions = document.createElement('div');
    actions.className = 'complexityActionRow';
    const chipRow = document.createElement('div');
    chipRow.className = 'complexityActionChips';
    const configured = typeof isInjectConfigured === 'function' && isInjectConfigured();
    if (h.tighten) chipRow.appendChild(buildDialChip(chip, h, 'tighten', actions, configured));
    if (h.relax) chipRow.appendChild(buildDialChip(chip, h, 'relax', actions, configured));
    const jump = buildJumpChip(chip, h);
    if (jump) chipRow.appendChild(jump);
    actions.appendChild(chipRow);
    return actions;
}

function buildDialChip(chip, h, direction, actions, configured) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'complexityNestChip complexityDialChip complexityDialChip--' + direction;
    btn.dataset.dial = direction;
    btn.textContent = direction === 'tighten' ? 'O↓ tighten' : 'O↑ relax';
    if (!configured) {
        btn.disabled = true;
        btn.title = 'Connect the injector Worker before pushing an entry.';
    } else {
        btn.title = buildDialTitle(chip, h, direction);
    }
    btn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (btn.disabled) return;
        pushDial(chip, h, direction, actions, btn);
    });
    return btn;
}

// Where the Structure view's code viewer lives at the current viewport, or null
// when it hasn't been mounted. Resolved by selector rather than imported from
// structureView.js — which imports THIS module — exactly as refactorCard's jump
// chip resolves it, and for the same cycle-avoidance reason.
function codeViewerHost() {
    if (typeof document === 'undefined') return null;
    const desktop = typeof window !== 'undefined' && window.innerWidth > 1023;
    return document.querySelector(desktop
        ? '#structureView > .structureCanvasHost'
        : '#structureCodeSheet .structureCodeSheetHost');
}

// A tappable `<file> : <start>–<end>` chip that opens the hotspot's span in the
// code viewer, mirroring refactorCard's buildJumpChip. The chip's path is already
// repo-relative (structureView joined it through joinSrcRootPath before handing it
// over), which is what the Worker's read route wants. Returns null when the scan
// gave no span or there is nowhere to render into, so the chip never appears as a
// control that can't do anything.
function buildJumpChip(chip, h) {
    if (h.start_line == null || h.end_line == null) return null;
    if (!codeViewerHost()) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'complexityNestChip complexityJumpChip';
    btn.textContent = basename(chip._cxPath) + ' : ' + h.start_line + '–' + h.end_line;
    btn.setAttribute('aria-label',
        'Read ' + chip._cxPath + ' lines ' + h.start_line + ' to ' + h.end_line);
    btn.addEventListener('click', function (event) {
        event.stopPropagation();
        // Re-resolved at click time: the nest outlives a viewport change, and a
        // host captured at render time could be a detached element by now.
        const host = codeViewerHost();
        if (!host) return;
        renderCodeViewer(host, {
            target: resolveTarget(chip._cxRepo),
            filePath: chip._cxPath,
            startLine: h.start_line,
            endLine: h.end_line,
            banner: 'Complexity hotspot: ' + (h.name || 'this span'),
        });
    });
    return btn;
}

// ── Dial push ────────────────────────────────────────────────────────

// The pushed entry's title. Mechanical slot-filling, exactly like refactorCard's
// buildPushTitle: the scan already decided the direction and the target bound, so
// nothing here is a judgement call.
function buildDialTitle(chip, h, direction) {
    const file = basename(chip._cxPath);
    const name = h.name || 'the function';
    if (direction === 'tighten') {
        const to = (h.tighten && h.tighten.target) || 'a tighter bound';
        return 'Tighten ' + name + ' in ' + file
            + ' from ' + (h.time || 'its current bound') + ' to ' + to;
    }
    const to = (h.relax && h.relax.target) || 'a simpler bound';
    return 'Relax ' + name + ' in ' + file + ' to ' + to;
}

// The pushed entry — a complete TODO.md entry in the repo's exact format, because
// a shipped entry IS its TODO.md text: injectEntry posts it verbatim (wrapped only
// by embedEntryMarker), so free prose would land unparseable. `Type: feature`
// because the routine accepts only `bug` or `feature` and a complexity change
// isn't fixing broken behaviour. The Description body is space-joined onto ONE
// line: a sub-bullet can't carry embedded newlines without breaking the entry's
// list structure. No id marker is embedded — shipEntryForTodo mints the id and
// calls embedEntryMarker itself.
function buildDialEntry(chip, h, direction) {
    const dial = direction === 'tighten' ? h.tighten : h.relax;
    const target = (dial && dial.target) || '';
    const file = chip._cxPath;
    const name = h.name || '';

    const body = [];
    if (direction === 'tighten') {
        body.push('Reduce the time complexity of `' + name + '` in `' + file + '`'
            + (target ? (' from ' + (h.time || 'its current bound') + ' to ' + target) : '') + '.');
    } else {
        body.push('Relax `' + name + '` in `' + file + '`'
            + (target ? (' to ' + target) : '')
            + ', trading the tighter bound for a simpler implementation.');
    }
    if (h.start_line != null && h.end_line != null) {
        body.push('The scan located it around lines ' + h.start_line + '–' + h.end_line
            + ' — locate by name if the file has drifted.');
    }
    const current = [];
    if (h.time) current.push('time ' + h.time);
    if (h.space) current.push('space ' + h.space);
    if (current.length) body.push('Current complexity: ' + current.join(', ') + '.');
    if (h.rationale) body.push('Rationale: ' + h.rationale);
    if (dial && dial.how) body.push('Implementation: ' + dial.how);
    // Without this line a complexity dial reads as an invitation to rewrite the
    // function. Say what must survive, in the same breath as what must change.
    body.push('Preserve behaviour exactly: the same inputs must produce the same'
        + ' outputs, no signature or public API changes, no data-model changes, and'
        + ' no test files modified.');

    const lines = [];
    lines.push('- [ ] **[MEDIUM]** ' + buildDialTitle(chip, h, direction));
    lines.push('  - Type: feature');
    lines.push('  - Description: ' + body.join(' '));
    lines.push('  - File: `' + file + '`');
    lines.push('  - Completed: YYYY-MM-DD (PR #<number>)');
    return lines.join('\n');
}

function clearActionNote(actions) {
    const existing = actions.querySelector('.complexityActionNote');
    if (existing) existing.remove();
}

// A quiet inline note on the action row — never a toast. The nest is already the
// smallest surface in the tree; a global toast for a per-hotspot refusal would be
// louder than the action that provoked it.
function showActionNote(actions, text) {
    clearActionNote(actions);
    const note = document.createElement('div');
    note.className = 'complexityActionNote';
    note.textContent = text;
    actions.appendChild(note);
}

function setActionBusy(actions, busy) {
    const btns = actions.querySelectorAll('button');
    for (let i = 0; i < btns.length; i++) btns[i].disabled = !!busy;
}

// Turn one dial into a shipped entry. Mirrors refactorCard's push semantics end to
// end: the inject guard, the resolved target, an in-flight-run probe that fails
// CLOSED (two entries touching the same file must never queue in parallel), a busy
// state while shipping, a transient confirmation, then the pushed re-render. No
// todo is created — the dial's entry belongs to the file, not to a project — so
// shipEntryForTodo is called with a null todoId and skips its stamp.
async function pushDial(chip, h, direction, actions, btn) {
    clearActionNote(actions);
    if (typeof isInjectConfigured !== 'function' || !isInjectConfigured()) {
        showActionNote(actions, 'Connect the injector Worker before pushing an entry.');
        return;
    }
    const target = resolveTarget(chip._cxRepo);
    const label = btn.textContent;
    chip._cxHold = true;
    setActionBusy(actions, true);
    btn.textContent = 'shipping…';

    const release = function (text) {
        chip._cxHold = false;
        setActionBusy(actions, false);
        btn.textContent = label;
        showActionNote(actions, text);
    };

    let active;
    try {
        active = await fetchActiveRuns(target);
    } catch (e) {
        active = null;
    }
    if (!active || active.ok === false) {
        release('Couldn’t check for an in-flight run — the push was not attempted.'
            + ' Try again in a moment.');
        return;
    }
    if (active.active) {
        release('A run is already in flight — try again once it lands.');
        return;
    }

    let shipRes;
    try {
        shipRes = await shipEntryForTodo({
            todoId: null,
            entryText: buildDialEntry(chip, h, direction),
            target: target,
        });
    } catch (e) {
        shipRes = { ok: false, error: (e && e.message) || '' };
    }
    if (!shipRes || shipRes.ok === false) {
        release((shipRes && shipRes.error)
            ? ('Couldn’t ship the entry — ' + shipRes.error)
            : 'Couldn’t ship the entry.');
        return;
    }

    // The hotspot is spoken for: retire it locally so the badge drops now, and
    // persist through listLogic (the only data path) in the background — the nest
    // has already moved on and a failed write self-heals on the next scan.
    const live = rowFor(chip._cxRepo, chip._cxPath);
    if (live) {
        const pushed = Array.isArray(live.pushed) ? live.pushed : [];
        if (pushed.indexOf(h.name) === -1) pushed.push(h.name);
        live.pushed = pushed;
    }
    if (listLogic && typeof listLogic.markComplexityHotspotPushed === 'function') {
        Promise.resolve(
            listLogic.markComplexityHotspotPushed(chip._cxRepo, chip._cxPath, h.name)
        ).catch(function () { /* background write; the nest already advanced */ });
    }
    renderChip(chip);

    clearEl(actions);
    const done = document.createElement('div');
    done.className = 'complexityActionShipped';
    done.textContent = 'Entry shipped — run dispatched';
    actions.appendChild(done);
    setTimeout(function () {
        chip._cxHold = false;
        chip._cxOpenHotspot = null;
        renderNest(chip);
    }, PUSHED_ADVANCE_MS);
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
// the code viewer. An unscanned or failed chip dispatches a scan; a settled one
// toggles the hotspot nest under the row. `scanning` is the only inert state, and
// the derived `disabled` already blocks it — the switch below just keeps the chip
// honest if a caller ever re-enables it.
export function buildComplexityChip(repo, filePath, fileName) {
    if (!repo || !filePath || !isScannablePath(filePath)) return null;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'complexityChip';
    chip._cxRepo = repo;
    chip._cxPath = filePath;
    chip._cxName = fileName || filePath;
    // Nest bookkeeping lives on the chip, but the nest itself lives in the DOM —
    // so a tree repaint (repo switch, lens switch) discards both together and the
    // expansion is ephemeral without anyone having to clear it.
    chip._cxNest = null;
    chip._cxOpenHotspot = null;
    chip.addEventListener('click', function (event) {
        event.stopPropagation();
        if (chip.disabled) return;
        const state = chip.dataset.state || '';
        if (state === 'scan' || state === 'error') {
            startScan(repo, filePath);
        } else if (state === 'count' || state === 'clean') {
            toggleNest(chip);
        }
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
    chips.forEach(function (chip) { clearNoteTimer(chip); });
    chips.clear();
}
