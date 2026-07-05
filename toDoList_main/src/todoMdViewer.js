import { listLogic } from './listLogic.js';
import { isTodoMdShowCompleted, setTodoMdShowCompleted } from './prefs.js';
import { showConfirmModal } from './modals.js';
import { isMobileViewport } from './viewport.js';
import {
    readActiveRun,
    writeActiveRun,
    clearActiveRun,
    readActiveRedeploy,
    writeActiveRedeploy,
    clearActiveRedeploy,
    activeProjectNameForViewer,
    ACTIVE_RUN_CHANGE_EVENT,
} from './runState.js';
import {
    findTargetById,
    readTodoMdFromWorker,
    rewriteTodoMd,
    dispatchRun,
    pollRunStatus,
    fetchActiveRuns,
    fetchPagesStatus,
    requestPagesRebuild,
    revertEntry,
    showInjectToast,
} from './inject.js';

// Entries reverted (merged) this session — once a completed row's change has
// been rolled back, its Revert control disappears so it can never be triggered
// again. This is the double-revert guard: a second merged revert of the same PR
// would re-apply the original change. Session-scoped — it resets on a full
// reload, which is acceptable given the confirm step and the pending-PR link
// below. `pendingRevertPrUrls` tracks entries whose revert PR opened but didn't
// auto-merge: the control then opens that existing PR rather than POSTing a
// duplicate revert. Both live at module scope so they survive re-renders.
const revertedThisSession = new Set();
const pendingRevertPrUrls = new Map();

// The viewer card's mobile tap-to-open-sheet behavior lives in main.js
// (the completed + viewer mobile-sheet machinery stays there). main.js
// registers a handler here via setViewerCardTapHandler so the card-tap
// wiring below can reach it without a circular import back into main.js.
let viewerCardTapHandler = null;
export function setViewerCardTapHandler(fn) {
    viewerCardTapHandler = typeof fn === 'function' ? fn : null;
}

// On the mobile breakpoint the anchored "⋯" overflow dropdown is cramped and
// easy to mis-tap, so the overflow button opens a slide-up bottom-sheet menu
// instead (desktop keeps the anchored dropdown). The sheet machinery lives in
// mobileSheets.js; main.js registers it here as a controller so the overflow
// wiring below can reach it without a circular import back into mobileSheets.js
// (which already imports from this module). The controller is
// `{ open(menuEl, opts), close() }` — see openOverflowMobileSheet /
// closeOverflowMobileSheet. When unset (e.g. tests that mount the card without
// main.js), the overflow button falls back to the anchored dropdown.
let overflowSheetController = null;
export function setOverflowSheetController(controller) {
    overflowSheetController =
        controller && typeof controller.open === 'function' &&
        typeof controller.close === 'function'
            ? controller
            : null;
}

// ── READ-ONLY TODO.md VIEWER CARD ──
// For projects routed to an inject target, surface the live contents of
// that target's TODO.md (or whatever file_path the target points at) in
// a card mounted below the Completed section. View-only — writes happen
// through the existing inject button on todo descriptions. Reuses the
// same Worker URL + shared secret the inject button reads (no separate
// config surface); reuses the routing config + target lookup so the
// repo / filePath always match the project's inject destination.
//
// The card has two tabs ("Rendered" — parsed checklist; "Raw markdown"
// — verbatim text), a "synced Xd ago" relative timestamp, and a Sync
// button that re-fetches on demand. Project switches re-fetch
// automatically; incremental row mutations on the same project don't
// (the card is preserved across mainListRendered events that don't
// change the active project).
const VIEWER_LASTFETCH_PREFIX = 'todoapp_todomd_lastfetch_';
const VIEWER_EXPANDED_PREFIX = 'todoapp_todomd_expanded_';
// The one in-flight automation run the pill tracks is held in per-project
// active-run state (see runState.js) so a run dispatched from the chat ship
// path drives this same pill and runs on different projects stay independent.
// It survives project navigation and full reloads so the pill can re-attach
// and resume polling on the project the run was launched from.
let viewerActiveTab = 'rendered';
let viewerActiveProject = null;
let viewerResizeHandler = null;
let viewerActiveRunChangeHandler = null;
let viewerRunPollInterval = null;
// Separate interval from the local run poll: this one polls the Worker's
// repo-level `active_runs` probe so a run started on ANOTHER device lights up
// the viewer's Running pill (and self-clears when that run finishes), even when
// no local active-run record exists. Cleared with the card on teardown.
let viewerServerRunPollInterval = null;
// Interval that polls the Worker's `pages_status` probe while a Redeploy is in
// flight, so the header's Redeploy pill settles back to neutral (or red) once
// the GitHub Pages publish completes. Cleared with the card on teardown.
let viewerPagesPollInterval = null;
// Low-frequency background poll that passively re-reads the latest Pages publish
// health for the card's whole lifetime, so a deploy that fails while the viewer
// is already open turns the Redeploy pill red within ~30s without a manual Sync.
// Cleared with the card on teardown.
let viewerPagesHealthInterval = null;
// The run id of the most recently observed Pages deploy, refreshed from every
// pages_status probe that carries one. A manual redeploy captures this as its
// baseline so the poll can tell the pre-redeploy run (already completed) apart
// from the genuinely-new publish it just kicked off.
let lastPagesRunId = null;

function viewerLastFetchKey(projectName) {
    return VIEWER_LASTFETCH_PREFIX + encodeURIComponent(projectName || '');
}

function viewerExpandedKey(projectName) {
    return VIEWER_EXPANDED_PREFIX + encodeURIComponent(projectName || '');
}

function readViewerLastFetch(projectName) {
    try {
        const raw = localStorage.getItem(viewerLastFetchKey(projectName));
        const n = parseInt(raw || '0', 10);
        return isNaN(n) ? 0 : n;
    } catch (e) { return 0; }
}

function writeViewerLastFetch(projectName, ts) {
    try {
        localStorage.setItem(viewerLastFetchKey(projectName), String(ts));
    } catch (e) { /* private mode */ }
}

function readViewerExpanded(projectName) {
    try {
        return localStorage.getItem(viewerExpandedKey(projectName)) === '1';
    } catch (e) { return false; }
}

function writeViewerExpanded(projectName, expanded) {
    try {
        localStorage.setItem(viewerExpandedKey(projectName), expanded ? '1' : '0');
    } catch (e) { /* private mode */ }
}

function detachViewerResizeHandler() {
    if (viewerResizeHandler) {
        window.removeEventListener('resize', viewerResizeHandler);
        viewerResizeHandler = null;
    }
    // Clear any in-flight run-status poll so a leaked interval can't keep
    // firing against a pill whose card was torn down or re-rendered.
    stopViewerRunPoll();
    stopViewerServerRunPoll();
    stopViewerPagesPoll();
    stopPagesHealthPoll();
    // Drop the per-project active-run subscription with the card it belonged to
    // so a torn-down card can't keep reacting to run changes.
    if (viewerActiveRunChangeHandler) {
        document.removeEventListener(ACTIVE_RUN_CHANGE_EVENT, viewerActiveRunChangeHandler);
        viewerActiveRunChangeHandler = null;
    }
}

function stopViewerRunPoll() {
    if (viewerRunPollInterval) {
        clearInterval(viewerRunPollInterval);
        viewerRunPollInterval = null;
    }
}

function stopViewerServerRunPoll() {
    if (viewerServerRunPollInterval) {
        clearInterval(viewerServerRunPollInterval);
        viewerServerRunPollInterval = null;
    }
}

function stopViewerPagesPoll() {
    if (viewerPagesPollInterval) {
        clearInterval(viewerPagesPollInterval);
        viewerPagesPollInterval = null;
    }
}

function stopPagesHealthPoll() {
    if (viewerPagesHealthInterval) {
        clearInterval(viewerPagesHealthInterval);
        viewerPagesHealthInterval = null;
    }
}

function formatViewerSyncedAgo(ts) {
    if (!ts) return 'never synced';
    const diff = Date.now() - ts;
    if (diff < 0) return 'synced just now';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'synced just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return 'synced ' + min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return 'synced ' + hr + 'h ago';
    const d = Math.floor(hr / 24);
    return 'synced ' + d + 'd ago';
}

// Exact form of the entry-id marker the inject Worker stamps onto each
// injected TODO.md entry: `<!-- id: ` + id + ` -->` (one space each side).
// The dedup guard and the routine's entry-mode targeting rely on this exact
// shape, so id extraction must match it character-for-character. The id
// itself (a crypto.randomUUID) carries no whitespace.
const TODO_MD_ID_MARKER_RE = /<!-- id: (\S+) -->/;

// Vanilla checklist parser — no markdown library per CLAUDE.md. Splits
// the file into ordered tokens so the rendered tab can lay them out as
// rows. Recognised shapes:
//   `- [ ] foo` / `- [x] foo` → checkbox row (checked = x | X)
//   `# foo` / `## foo` ...     → heading (level = leading # count)
//   anything else             → plain text line (preserves blank lines)
// Each top-level (indent 0) checkbox token is additionally tagged with the
// `entryId` of its `<!-- id: … -->` marker when one is found anywhere in that
// entry's block — the checkbox line itself or any following line up to the
// next top-level checkbox or heading. This lets the rendered tab offer a
// per-entry "Run this entry" control only for entries the routine can target.
export function parseTodoMdChecklist(text) {
    if (typeof text !== 'string') return [];
    const lines = text.split('\n');
    const tokens = lines.map(function(raw) {
        const cb = raw.match(/^(\s*)- \[( |x|X)\]\s?(.*)$/);
        if (cb) {
            return {
                type: 'checkbox',
                checked: cb[2].toLowerCase() === 'x',
                text: cb[3],
                indent: cb[1].length,
            };
        }
        const h = raw.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
            return { type: 'heading', level: h[1].length, text: h[2] };
        }
        return { type: 'text', text: raw };
    });

    // Associate each top-level entry with its marker id. The marker may sit
    // inline on the checkbox line or on any line within the entry's block.
    let currentTop = null;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'heading') {
            currentTop = null;
            continue;
        }
        if (t.type === 'checkbox' && t.indent === 0) {
            currentTop = t;
        }
        if (currentTop && !currentTop.entryId) {
            const m = t.text.match(TODO_MD_ID_MARKER_RE);
            if (m) currentTop.entryId = m[1];
        }
    }
    return tokens;
}

// Walk a parsed token list and drop every completed (`- [x]`) top-level
// entry along with ALL of its nested lines — sub-bullets, nested checkboxes,
// continuation text, and the trailing `<!-- id: … -->` marker — when
// `hideCompleted` is true. An entry's block runs from its top-level checkbox
// line through to (but not including) the next top-level checkbox or heading,
// which is what bounds the hide range. The completed top-level count is always
// tallied (regardless of `hideCompleted`) so the "Show completed (N)" toggle
// can label itself off the live content.
//
// NOTE: this filters the VIEWER's rendered DOM only. TODO.md on disk is never
// touched, and the pipeline reads the full file server-side via the GitHub
// API — so this render-side filter is purely cosmetic and must never be
// "consolidated" into anything that affects the pipeline read path.
export function filterCompletedTokens(tokens, hideCompleted) {
    let completedCount = 0;
    const kept = [];
    let hiding = false;
    tokens.forEach(function(tok) {
        if (tok.type === 'heading') {
            // A heading bounds the previous entry's block and never belongs
            // to a completed entry, so it always renders.
            hiding = false;
            kept.push(tok);
            return;
        }
        if (tok.type === 'checkbox' && tok.indent === 0) {
            // Top-level checkbox: starts a new entry block.
            if (tok.checked) {
                completedCount++;
                hiding = !!hideCompleted;
                if (hiding) return; // drop the completed entry's own line
            } else {
                hiding = false; // an active entry ends any prior hide range
            }
            kept.push(tok);
            return;
        }
        // Any other line (nested bullet, text, blank, marker) belongs to the
        // current entry block — drop it while hiding a completed entry.
        if (hiding) return;
        kept.push(tok);
    });
    return { tokens: kept, completedCount };
}

// Count completed top-level entries in raw TODO.md markdown. Used to label the
// viewer's "Show completed (N)" toggle without rendering.
export function countCompletedTodoMdEntries(text) {
    return filterCompletedTokens(parseTodoMdChecklist(text), false).completedCount;
}

// True when the markdown has at least one unchecked (`- [ ]`) top-level entry —
// i.e. there is a backlog to run. Mirrors the per-entry run-button gate
// predicate (`tok.indent === 0 && !tok.checked`) so the Run backlog pill's idle
// state stays in lockstep with whether any entry is actually runnable.
export function hasUncheckedTodoEntries(text) {
    return parseTodoMdChecklist(text).some(function(tok) {
        return tok.type === 'checkbox' && tok.indent === 0 && !tok.checked;
    });
}

const RUN_ENTRY_PLAY_GLYPH =
    '<svg class="todoMdViewerRunEntryIcon" viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">' +
    '<polygon points="6 4 20 12 6 20"/>' +
    '</svg>';

const DELETE_ENTRY_TRASH_GLYPH =
    '<svg class="todoMdViewerDeleteEntryIcon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="4 6 20 6"/>' +
    '<path d="M7 6V4h10v2"/>' +
    '<path d="M6 6l1 14h10l1-14"/>' +
    '<line x1="10" y1="10" x2="10" y2="17"/>' +
    '<line x1="14" y1="10" x2="14" y2="17"/>' +
    '</svg>';

// Quiet counter-clockwise / undo arrow for the per-entry Revert pill — same
// glyph the Runs-tab Revert control uses so the two surfaces read identically.
const REVERT_ENTRY_UNDO_GLYPH =
    '<svg class="todoMdViewerRevertEntryIcon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="1 4 1 10 7 10"/>' +
    '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>' +
    '</svg>';

// Refresh / sync glyph for the icon-only Sync chip in the viewer bar. The
// button reads as a neutral 36×36 chip alongside the amber Run backlog pill,
// so the "Sync" text label is dropped in favor of this glyph (the aria-label
// and title still name the action for assistive tech and hover).
const SYNC_GLYPH =
    '<svg class="todoMdViewerSyncIcon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="23 4 23 10 17 10"/>' +
    '<polyline points="1 20 1 14 7 14"/>' +
    '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>' +
    '</svg>';

export function buildViewerRenderedBody(text, options) {
    const opts = options || {};
    const onRunEntry = typeof opts.onRunEntry === 'function' ? opts.onRunEntry : null;
    const onDeleteEntry = typeof opts.onDeleteEntry === 'function' ? opts.onDeleteEntry : null;
    const onRevertEntry = typeof opts.onRevertEntry === 'function' ? opts.onRevertEntry : null;
    const wrap = document.createElement('div');
    wrap.className = 'todoMdViewerRendered';
    const tokens = filterCompletedTokens(
        parseTodoMdChecklist(text),
        !!opts.hideCompleted
    ).tokens;
    tokens.forEach(function(tok) {
        if (tok.type === 'heading') {
            const h = document.createElement('div');
            h.className = 'todoMdViewerHeading todoMdViewerHeading--h' + tok.level;
            h.textContent = tok.text;
            wrap.appendChild(h);
            return;
        }
        if (tok.type === 'checkbox') {
            const row = document.createElement('div');
            row.className = 'todoMdViewerCheckRow';
            if (tok.checked) row.classList.add('todoMdViewerCheckRow--done');
            if (tok.indent > 0) row.style.paddingLeft = (12 + tok.indent * 4) + 'px';
            const box = document.createElement('span');
            box.className = 'todoMdViewerCheckBox';
            box.setAttribute('aria-hidden', 'true');
            box.textContent = tok.checked ? '✓' : '';
            const label = document.createElement('span');
            label.className = 'todoMdViewerCheckText';
            // Strip an inline id marker from the visible label — it is
            // internal plumbing, never shown to the user.
            label.textContent = tok.text.replace(TODO_MD_ID_MARKER_RE, '').replace(/\s+$/, '');
            row.appendChild(box);
            row.appendChild(label);
            // Per-entry "Run this entry" control — only for top-level OPEN
            // (unchecked) entries whose `<!-- id: … -->` marker resolved to a
            // concrete id. Entries without an id never get the control (running
            // the wrong thing is worse than not offering it); a completed entry
            // gets Revert instead (re-running a shipped entry isn't wanted).
            if (onRunEntry && tok.indent === 0 && tok.entryId && !tok.checked) {
                const runBtn = document.createElement('button');
                runBtn.type = 'button';
                runBtn.className = 'todoMdViewerRunEntryBtn';
                runBtn.dataset.entryId = tok.entryId;
                runBtn.setAttribute('aria-label', 'Run this entry');
                runBtn.title = 'Run the automation routine for this entry';
                runBtn.innerHTML = RUN_ENTRY_PLAY_GLYPH +
                    '<span class="todoMdViewerRunEntryLabel">Run this entry</span>';
                runBtn.addEventListener('click', function(event) {
                    event.stopPropagation();
                    onRunEntry(tok.entryId, runBtn);
                });
                row.appendChild(runBtn);
            }
            // Per-entry Revert control — only for top-level COMPLETED (checked)
            // entries carrying a resolved id, and only while the entry hasn't
            // already been reverted this session (the double-revert guard — a
            // second merged revert of the same PR re-applies the original
            // change). Rolls the shipped change back through the Worker `revert`
            // route. A still-pending revert PR (auto-merge failed) keeps the
            // pill so it can link out to that existing PR.
            if (onRevertEntry && tok.indent === 0 && tok.entryId && tok.checked &&
                !revertedThisSession.has(tok.entryId)) {
                const revertBtn = document.createElement('button');
                revertBtn.type = 'button';
                revertBtn.className = 'todoMdViewerRevertEntryBtn';
                revertBtn.dataset.entryId = tok.entryId;
                const pendingPr = pendingRevertPrUrls.has(tok.entryId);
                revertBtn.setAttribute('aria-label',
                    pendingPr ? 'Open the revert pull request' : 'Revert this change');
                revertBtn.title =
                    pendingPr ? 'Open the revert pull request' : 'Revert this shipped change';
                revertBtn.innerHTML = REVERT_ENTRY_UNDO_GLYPH +
                    '<span class="todoMdViewerRevertEntryLabel">Revert</span>';
                const revertLabel = label.textContent;
                revertBtn.addEventListener('click', function(event) {
                    event.stopPropagation();
                    onRevertEntry(tok.entryId, revertLabel, revertBtn);
                });
                row.appendChild(revertBtn);
            }
            // Per-entry delete control — same gate as the Run button (top-level
            // entries carrying a resolved id marker). Deleting an id-less entry
            // isn't offered: with no marker the Worker can't target it safely.
            if (onDeleteEntry && tok.indent === 0 && tok.entryId) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'todoMdViewerDeleteEntryBtn';
                delBtn.dataset.entryId = tok.entryId;
                delBtn.setAttribute('aria-label', 'Delete this entry');
                delBtn.title = 'Delete this entry from TODO.md';
                delBtn.innerHTML = DELETE_ENTRY_TRASH_GLYPH;
                const entryLabel = label.textContent;
                delBtn.addEventListener('click', function(event) {
                    event.stopPropagation();
                    onDeleteEntry(tok.entryId, entryLabel, delBtn);
                });
                row.appendChild(delBtn);
            }
            wrap.appendChild(row);
            return;
        }
        // Suppress marker-only lines — the id has been consumed onto its
        // entry's token; the raw comment is not user-facing content.
        if (/^\s*<!-- id: \S+ -->\s*$/.test(tok.text)) return;
        const line = document.createElement('div');
        line.className = 'todoMdViewerTextLine';
        if (tok.text === '') line.classList.add('todoMdViewerTextLine--blank');
        line.textContent = tok.text;
        wrap.appendChild(line);
    });
    return wrap;
}

function buildViewerRawBody(text) {
    const pre = document.createElement('pre');
    pre.className = 'todoMdViewerRaw';
    pre.textContent = typeof text === 'string' ? text : '';
    return pre;
}

export function placeViewerCard(card, mainListDiv) {
    const spacer = mainListDiv.querySelector('#projectsGhostSpacer');
    if (spacer && spacer.parentNode === mainListDiv) {
        if (card.nextSibling !== spacer) mainListDiv.insertBefore(card, spacer);
    } else if (card.parentNode !== mainListDiv) {
        mainListDiv.appendChild(card);
    }
}

function buildTodoMdViewerCard(projectName, target) {
    const card = document.createElement('div');
    card.id = 'todoMdViewerCard';
    card.className = 'todoMdViewerCard';
    card.dataset.projectName = projectName;

    const header = document.createElement('div');
    header.className = 'todoMdViewerHeader';

    const tabs = document.createElement('div');
    tabs.className = 'todoMdViewerTabs';
    tabs.setAttribute('role', 'tablist');

    const renderedTab = document.createElement('button');
    renderedTab.type = 'button';
    renderedTab.className = 'todoMdViewerTab';
    renderedTab.dataset.tab = 'rendered';
    renderedTab.setAttribute('role', 'tab');
    renderedTab.textContent = 'Rendered';

    const rawTab = document.createElement('button');
    rawTab.type = 'button';
    rawTab.className = 'todoMdViewerTab';
    rawTab.dataset.tab = 'raw';
    rawTab.setAttribute('role', 'tab');
    rawTab.textContent = 'Raw markdown';

    tabs.appendChild(renderedTab);
    tabs.appendChild(rawTab);

    const meta = document.createElement('div');
    meta.className = 'todoMdViewerMeta';

    const syncedLabel = document.createElement('span');
    syncedLabel.className = 'todoMdViewerSynced';
    syncedLabel.setAttribute('aria-live', 'polite');
    syncedLabel.textContent = formatViewerSyncedAgo(readViewerLastFetch(projectName));

    const runBacklogBtn = document.createElement('button');
    runBacklogBtn.type = 'button';
    runBacklogBtn.className = 'todoMdViewerRunBtn';
    runBacklogBtn.setAttribute('aria-label', 'Run backlog automation');
    runBacklogBtn.title = 'Trigger the automation routine in backlog mode';
    runBacklogBtn.innerHTML =
        '<svg class="todoMdViewerRunIcon" viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">' +
        '<polygon points="6 4 20 12 6 20"/>' +
        '</svg>' +
        '<span class="todoMdViewerRunLabel">Run backlog</span>';

    // Health-aware "Redeploy" pill. GitHub Pages' managed publish occasionally
    // fails, leaving the live site stale with no in-app recovery. This pill
    // reflects the newest deploy's health (quiet/neutral when healthy, red on a
    // failed publish, an amber spinner while a publish is in flight) and, when
    // tapped, re-triggers the publish through the Worker. Its live wiring
    // (fetchPagesStatus / requestPagesRebuild) lives further down the closure.
    const deployPill = document.createElement('button');
    deployPill.type = 'button';
    deployPill.className = 'todoMdViewerDeployPill todoMdViewerDeployPill--idle';
    deployPill.setAttribute('aria-live', 'polite');

    const syncBtn = document.createElement('button');
    syncBtn.type = 'button';
    syncBtn.className = 'todoMdViewerSyncBtn';
    syncBtn.setAttribute('aria-label', 'Sync TODO.md');
    syncBtn.title = 'Sync TODO.md';
    syncBtn.innerHTML = SYNC_GLYPH;

    // Body collapse toggle — hides everything below the header (todo rows
    // and any non-header content) so only the fixed header bar remains.
    // State is in-memory only (default expanded); it intentionally does not
    // persist across reloads.
    const collapseBodyBtn = document.createElement('button');
    collapseBodyBtn.type = 'button';
    collapseBodyBtn.className = 'todoMdViewerCollapseBtn';

    const bodyExpandedGlyph =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<polyline points="6 15 12 9 18 15"/>' +
        '</svg>';
    const bodyCollapsedGlyph =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<polyline points="6 9 12 15 18 9"/>' +
        '</svg>';

    // "⋯" overflow menu — holds the whole-file destructive actions (Clear
    // completed / Clear all) out of the way of the always-visible controls.
    // The button and its anchored menu share a position:relative wrapper so
    // the menu floats below the button without disturbing the flex row.
    const overflowWrap = document.createElement('div');
    overflowWrap.className = 'todoMdViewerOverflowWrap';

    const overflowBtn = document.createElement('button');
    overflowBtn.type = 'button';
    overflowBtn.className = 'todoMdViewerOverflowBtn';
    overflowBtn.setAttribute('aria-label', 'More TODO.md actions');
    overflowBtn.setAttribute('aria-haspopup', 'true');
    overflowBtn.setAttribute('aria-expanded', 'false');
    overflowBtn.title = 'More actions';
    overflowBtn.textContent = '⋯';

    const overflowMenu = document.createElement('div');
    overflowMenu.className = 'todoMdViewerOverflowMenu';
    overflowMenu.setAttribute('role', 'menu');
    overflowMenu.hidden = true;

    // "Show completed (N)" toggle — a checkable menu item at the top of the
    // overflow menu (above the destructive clear actions, separated by a
    // divider). Replaces the old standalone header icon button, which crowded
    // the meta row. Defaults OFF (completed entries hidden in the rendered
    // body). The visible label flips between "Show completed (N)" and "Hide
    // completed (N)"; aria-checked reflects the persisted state for screen
    // readers. N recomputes from live content on every render.
    const showCompletedItem = document.createElement('button');
    showCompletedItem.type = 'button';
    showCompletedItem.className = 'todoMdViewerOverflowItem todoMdViewerShowCompletedItem';
    showCompletedItem.setAttribute('role', 'menuitemcheckbox');
    showCompletedItem.setAttribute('aria-checked', 'false');
    const showCompletedCheck = document.createElement('span');
    showCompletedCheck.className = 'todoMdViewerShowCompletedCheck';
    showCompletedCheck.setAttribute('aria-hidden', 'true');
    showCompletedCheck.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<polyline points="20 6 9 17 4 12"/>' +
        '</svg>';
    const showCompletedLabel = document.createElement('span');
    showCompletedLabel.className = 'todoMdViewerShowCompletedLabel';
    showCompletedLabel.textContent = 'Show completed (0)';
    showCompletedItem.appendChild(showCompletedCheck);
    showCompletedItem.appendChild(showCompletedLabel);

    const overflowDivider = document.createElement('div');
    overflowDivider.className = 'todoMdViewerOverflowDivider';
    overflowDivider.setAttribute('role', 'separator');

    const clearCompletedItem = document.createElement('button');
    clearCompletedItem.type = 'button';
    clearCompletedItem.className = 'todoMdViewerOverflowItem';
    clearCompletedItem.setAttribute('role', 'menuitem');
    clearCompletedItem.textContent = 'Clear completed';

    const clearAllItem = document.createElement('button');
    clearAllItem.type = 'button';
    clearAllItem.className = 'todoMdViewerOverflowItem danger';
    clearAllItem.setAttribute('role', 'menuitem');
    clearAllItem.textContent = 'Clear all';

    overflowMenu.appendChild(showCompletedItem);
    overflowMenu.appendChild(overflowDivider);
    overflowMenu.appendChild(clearCompletedItem);
    overflowMenu.appendChild(clearAllItem);
    overflowWrap.appendChild(overflowBtn);
    overflowWrap.appendChild(overflowMenu);

    meta.appendChild(syncedLabel);
    meta.appendChild(runBacklogBtn);
    meta.appendChild(deployPill);
    meta.appendChild(syncBtn);
    meta.appendChild(overflowWrap);
    meta.appendChild(collapseBodyBtn);

    header.appendChild(tabs);
    header.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'todoMdViewerBody';
    body.dataset.state = 'loading';
    const loadingNote = document.createElement('div');
    loadingNote.className = 'todoMdViewerNote';
    loadingNote.textContent = 'Loading…';
    body.appendChild(loadingNote);

    card.appendChild(header);
    card.appendChild(body);

    function applyTab(tab) {
        viewerActiveTab = tab === 'raw' ? 'raw' : 'rendered';
        renderedTab.classList.toggle('is-active', viewerActiveTab === 'rendered');
        renderedTab.setAttribute('aria-selected', viewerActiveTab === 'rendered' ? 'true' : 'false');
        rawTab.classList.toggle('is-active', viewerActiveTab === 'raw');
        rawTab.setAttribute('aria-selected', viewerActiveTab === 'raw' ? 'true' : 'false');
        const text = card.dataset.content || '';
        if (card.dataset.state !== 'ready') return;
        body.innerHTML = '';
        body.appendChild(
            viewerActiveTab === 'raw'
                ? buildViewerRawBody(text)
                : buildViewerRenderedBody(text, { onRunEntry: runEntry, onDeleteEntry: deleteEntry, onRevertEntry: revertCompletedEntry, hideCompleted: !isTodoMdShowCompleted() })
        );
        syncRunEntryButtonsDisabled();
    }

    // Reflect the persisted toggle state onto the overflow menu item
    // (aria-checked + the "Show/Hide completed (N)" label). N is recomputed
    // each call so it tracks content changes between renders. At N=0 the item
    // (and its divider) is hidden + disabled — "show completed (0)" is a no-op.
    function applyShowCompletedState() {
        const on = isTodoMdShowCompleted();
        const n = countCompletedTodoMdEntries(card.dataset.content || '');
        showCompletedItem.setAttribute('aria-checked', on ? 'true' : 'false');
        showCompletedLabel.textContent =
            (on ? 'Hide' : 'Show') + ' completed (' + n + ')';
        const empty = n === 0;
        showCompletedItem.hidden = empty;
        showCompletedItem.disabled = empty;
        overflowDivider.hidden = empty;
    }

    showCompletedItem.addEventListener('click', function(event) {
        event.stopPropagation();
        setTodoMdShowCompleted(!isTodoMdShowCompleted());
        // Preserve scroll position so toggling doesn't jump the body to top.
        const prevScroll = body.scrollTop;
        applyShowCompletedState();
        applyTab(viewerActiveTab);
        body.scrollTop = prevScroll;
        // Close the menu (matching the clear items) so the re-rendered list
        // is visible behind the dismissed menu.
        closeOverflowMenu();
    });

    renderedTab.addEventListener('click', function() { applyTab('rendered'); });
    rawTab.addEventListener('click', function() { applyTab('raw'); });
    applyTab(viewerActiveTab);
    applyShowCompletedState();

    function renderError(reason) {
        card.dataset.state = 'error';
        body.dataset.state = 'error';
        body.innerHTML = '';
        const err = document.createElement('div');
        err.className = 'todoMdViewerError';
        err.textContent = 'Couldn’t load TODO.md — ' + (reason || 'unknown error');
        body.appendChild(err);
    }

    function renderContent(content) {
        card.dataset.state = 'ready';
        card.dataset.content = content;
        body.dataset.state = 'ready';
        body.innerHTML = '';
        body.appendChild(
            viewerActiveTab === 'raw'
                ? buildViewerRawBody(content)
                : buildViewerRenderedBody(content, { onRunEntry: runEntry, onDeleteEntry: deleteEntry, onRevertEntry: revertCompletedEntry, hideCompleted: !isTodoMdShowCompleted() })
        );
        syncRunEntryButtonsDisabled();
        // Refresh the toggle's (N) now that live content is available.
        applyShowCompletedState();
        // Neutralize the Run backlog pill when there's nothing pending to run,
        // so amber means "there's a backlog" and neutral means "nothing to run."
        // Re-runs after every sync (including the post-run re-fetch once boxes
        // get checked on main), so the state stays correct with no extra hook.
        const hasUnchecked = hasUncheckedTodoEntries(content);
        runBacklogBtn.classList.toggle('todoMdViewerRunBtn--idle', !hasUnchecked);
        if (hasUnchecked) {
            runBacklogBtn.setAttribute('aria-label', 'Run backlog automation');
            runBacklogBtn.title = 'Trigger the automation routine in backlog mode';
        } else {
            runBacklogBtn.setAttribute('aria-label', 'Run backlog automation — nothing to run');
            runBacklogBtn.title = 'Nothing to run — no pending backlog entries';
        }
    }

    async function runSync() {
        if (syncBtn.disabled) return;
        syncBtn.disabled = true;
        syncBtn.classList.add('todoMdViewerSyncBtn--loading');
        // Swap the idle "Sync" label for an animated spinner + "Syncing"
        // label for the duration of the fetch; restored in finally on both
        // success and failure.
        syncBtn.innerHTML =
            '<span class="todoMdViewerSyncSpinner" aria-hidden="true"></span>' +
            '<span class="todoMdViewerSyncLabel">Syncing</span>';
        try {
            const res = await readTodoMdFromWorker(target);
            if (res.ok) {
                writeViewerLastFetch(projectName, Date.now());
                syncedLabel.textContent = formatViewerSyncedAgo(Date.now());
                renderContent(res.content);
            } else {
                renderError(res.reason || 'fetch failed');
            }
        } finally {
            syncBtn.disabled = false;
            syncBtn.classList.remove('todoMdViewerSyncBtn--loading');
            syncBtn.innerHTML = SYNC_GLYPH;
        }
        // Refresh the Redeploy pill's health after every sync (this includes the
        // mount fetch, so the pill reflects deploy health on first render too).
        // Fire-and-forget — a Pages-probe failure never blocks or errors the sync.
        refreshPagesStatus();
    }

    syncBtn.addEventListener('click', runSync);

    // ── Overflow menu (Clear completed / Clear all) ──
    // Whole-file destructive ops live behind the "⋯" button so they stay out
    // of the way of the always-visible controls. The menu closes the app's
    // usual four ways: selecting an item, clicking outside, pressing Escape,
    // or re-tapping the button.
    let overflowOutsideHandler = null;
    let overflowKeydownHandler = null;
    // True while the overflow menu is hosted in the mobile bottom sheet rather
    // than the anchored desktop dropdown — gates the sheet-specific teardown.
    let overflowInSheet = false;

    function closeOverflowMenu() {
        if (overflowMenu.hidden) return;
        overflowMenu.hidden = true;
        overflowBtn.setAttribute('aria-expanded', 'false');
        // Re-clip the card now that the menu is gone (see openOverflowMenu).
        card.classList.remove('todoMdViewerCard--menuOpen');
        if (overflowOutsideHandler) {
            document.removeEventListener('click', overflowOutsideHandler, true);
            overflowOutsideHandler = null;
        }
        if (overflowKeydownHandler) {
            document.removeEventListener('keydown', overflowKeydownHandler, true);
            overflowKeydownHandler = null;
        }
        // Mobile: the menu was moved into a bottom sheet — dismiss the sheet
        // and return the menu element to its anchored wrapper. close() here is
        // the programmatic teardown (it does NOT re-fire the sheet's onDismiss,
        // so we restore the menu ourselves).
        if (overflowInSheet) {
            overflowInSheet = false;
            if (overflowSheetController) overflowSheetController.close();
            restoreOverflowMenuToWrap();
        }
    }

    // Move the overflow menu element back under its anchored wrapper (it is
    // DOM-moved into the bottom sheet on mobile). Idempotent — used by both the
    // programmatic close above and the sheet's own dismiss path.
    function restoreOverflowMenuToWrap() {
        if (overflowMenu.parentNode !== overflowWrap) {
            overflowWrap.appendChild(overflowMenu);
        }
        overflowMenu.hidden = true;
    }

    function openOverflowSheet() {
        // The menu element is DOM-moved into the sheet, so every item's click
        // handler and the state they read (card.dataset.content, the toggle,
        // performRewrite) stay in scope. hidden=false so it shows inside the
        // sheet; the sheet CSS strips the dropdown's floating chrome.
        overflowInSheet = true;
        overflowMenu.hidden = false;
        overflowBtn.setAttribute('aria-expanded', 'true');
        overflowSheetController.open(overflowMenu, {
            title: 'More actions',
            // Fired only when the user dismisses via the sheet's own
            // affordances (close button / backdrop / Escape / swipe-down).
            onDismiss: function() {
                overflowInSheet = false;
                overflowBtn.setAttribute('aria-expanded', 'false');
                restoreOverflowMenuToWrap();
            },
        });
    }

    function openOverflowMenu() {
        if (!overflowMenu.hidden) return;
        // Mobile: open the menu as a slide-up bottom sheet with large touch
        // targets instead of the cramped anchored dropdown. Falls back to the
        // dropdown when no sheet controller is registered.
        if (isMobileViewport() && overflowSheetController) {
            openOverflowSheet();
            return;
        }
        overflowMenu.hidden = false;
        overflowBtn.setAttribute('aria-expanded', 'true');
        // A collapsed card is only as tall as its header, and the card clips
        // with `overflow: hidden`; the menu drops below the header into that
        // clipped region. Let the card overflow show while the menu is open so
        // the menu is visible without first expanding the card.
        card.classList.add('todoMdViewerCard--menuOpen');
        overflowOutsideHandler = function(event) {
            if (!overflowWrap.contains(event.target)) closeOverflowMenu();
        };
        overflowKeydownHandler = function(event) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                closeOverflowMenu();
            }
        };
        document.addEventListener('click', overflowOutsideHandler, true);
        document.addEventListener('keydown', overflowKeydownHandler, true);
    }

    overflowBtn.addEventListener('click', function(event) {
        event.stopPropagation();
        if (overflowMenu.hidden) openOverflowMenu();
        else closeOverflowMenu();
    });

    // Route a destructive TODO.md rewrite through the Worker, then re-run the
    // viewer's own fetch-and-render so the rendered + raw tabs reflect disk. A
    // `skipped` result (nothing matched) refreshes without surfacing an error;
    // a genuine failure surfaces a toast and leaves the view untouched.
    async function performRewrite(op, id, btn) {
        if (btn) {
            btn.disabled = true;
            btn.classList.add('todoMdViewerDeleteEntryBtn--loading');
        }
        try {
            const res = await rewriteTodoMd(target, op, id);
            if (res.ok) {
                await runSync();
            } else {
                showInjectToast('Update failed — ' + (res.reason || 'unknown error'), 'error');
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('todoMdViewerDeleteEntryBtn--loading');
            }
        }
    }

    // Re-render the rendered body from the already-loaded content (no re-fetch:
    // a revert is a PR operation that leaves TODO.md unchanged) so the session
    // reverted/pending sets are re-read and the Revert pill reflects the new
    // state. Scroll position is preserved so the list doesn't jump.
    function rerenderViewerBody() {
        if (card.dataset.state !== 'ready') return;
        const prevScroll = body.scrollTop;
        applyTab(viewerActiveTab);
        body.scrollTop = prevScroll;
    }

    // Roll back a completed entry's shipped change through the Worker `revert`
    // route. Only ever reached from a completed, id-bearing row's Revert pill
    // (the render gate). A revert is a PR op — NOT a dispatch — so it's allowed
    // even while this project has an active run (no readActiveRun guard). When a
    // prior attempt opened a revert PR that didn't auto-merge, the pill links to
    // that existing PR instead of POSTing a duplicate revert.
    function revertCompletedEntry(entryId, entryLabel, btn) {
        if (!entryId) return;
        const pendingUrl = pendingRevertPrUrls.get(entryId);
        if (pendingUrl) {
            try { window.open(pendingUrl, '_blank', 'noopener'); } catch (e) { /* popup blocked */ }
            return;
        }
        const named = entryLabel ? ' “' + entryLabel + '”' : '';
        showConfirmModal({
            message: 'Revert this entry' + named + '? This ships a rollback — a new build will deploy.',
            confirmLabel: 'Revert',
            onConfirm: function() { performRevert(entryId, btn); },
        });
    }

    async function performRevert(entryId, btn) {
        if (btn) {
            btn.disabled = true;
            btn.classList.add('todoMdViewerRevertEntryBtn--loading');
        }
        try {
            const res = await revertEntry(entryId, target);
            if (res && res.ok && res.merged === true) {
                // Rollback merged — a new build is deploying. Mark the entry
                // reverted so the pill disappears and can't be triggered again.
                showInjectToast('Reverted — new build shipping');
                revertedThisSession.add(entryId);
                rerenderViewerBody();
                return;
            }
            if (res && res.ok && res.merged === false) {
                // The revert PR opened but didn't auto-merge (conflict, or
                // mergeability unconfirmed). Track the PR URL so the pill
                // switches to opening it rather than POSTing again, and surface
                // the reason so the user can finish it in GitHub.
                if (res.revert_pr_url) pendingRevertPrUrls.set(entryId, res.revert_pr_url);
                showInjectToast(res.reason
                    ? ('Revert needs attention: ' + res.reason)
                    : 'Revert PR opened — finish it in GitHub', 'error');
                rerenderViewerBody();
                return;
            }
            // ok === false → surface the error and leave the pill so it can retry.
            showInjectToast((res && res.reason)
                ? ('Revert failed — ' + res.reason)
                : 'Revert failed', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('todoMdViewerRevertEntryBtn--loading');
            }
        }
    }

    // Per-entry delete — confirm naming the entry, then delete by id. Only ever
    // reached from an id-bearing row's trash button (the render gate).
    function deleteEntry(entryId, entryLabel, btn) {
        if (!entryId) return;
        const named = entryLabel ? ' “' + entryLabel + '”' : '';
        showConfirmModal({
            message: 'Delete this entry' + named + ' from TODO.md? This can’t be undone.',
            confirmLabel: 'Delete',
            onConfirm: function() { performRewrite('delete_entry', entryId, btn); },
        });
    }

    clearCompletedItem.addEventListener('click', function(event) {
        event.stopPropagation();
        closeOverflowMenu();
        showConfirmModal({
            message: 'Clear completed entries? This removes every completed (done) entry from TODO.md — your shipped history. This can’t be undone.',
            confirmLabel: 'Clear completed',
            onConfirm: function() { performRewrite('clear_completed', undefined, null); },
        });
    });

    clearAllItem.addEventListener('click', function(event) {
        event.stopPropagation();
        closeOverflowMenu();
        // Clear all gets the stronger two-step: a first confirm spelling out the
        // full wipe, then a final guard before the irreversible write.
        showConfirmModal({
            message: 'Clear the ENTIRE backlog? This wipes every entry in TODO.md, including completed and shipped entries.',
            confirmLabel: 'Clear all',
            onConfirm: function() {
                showConfirmModal({
                    message: 'This permanently empties TODO.md and can’t be undone. Really clear everything?',
                    confirmLabel: 'Yes, clear everything',
                    onConfirm: function() { performRewrite('clear_all', undefined, null); },
                });
            },
        });
    });

    // ── Run-status pill ──
    // After a successful dispatch the Run backlog button is swapped out for
    // a status pill that polls the Worker every 5s and reflects the run's
    // lifecycle (starting → queued → running → terminal). The pill occupies
    // the button's slot in `meta`; only one run is tracked at a time. The
    // correlation_id is internal plumbing for the dispatch/status calls and
    // is NEVER rendered in the UI.
    const RUN_POLL_INTERVAL_MS = 5000;
    const RUN_GIVE_UP_MS = 20 * 60 * 1000;

    const runPillCheckGlyph =
        '<svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 7.5 6 10.5 11 4.5"/></svg>';
    const runPillAlertGlyph =
        '<svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 1.5l6 11H1z"/><line x1="7" y1="5.5" x2="7" y2="8.5"/><line x1="7" y1="10.6" x2="7" y2="10.7"/></svg>';
    const runPillClockGlyph =
        '<svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="5.5"/><polyline points="7 4 7 7 9.5 8.5"/></svg>';
    const runPillLinkGlyph =
        '<svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 2.5H2.5v9h9v-3"/><polyline points="8 2.5 11.5 2.5 11.5 6"/><line x1="6" y1="8" x2="11.5" y2="2.5"/></svg>';

    let runPill = null;
    let runPillLastUrl = null;
    // True only while the mounted pill is driven by the ambient server probe
    // (a cross-device run with no local active-run record) rather than by a
    // local dispatch. The local lifecycle (startRunPill / restoreRunButton)
    // always clears it, so a local run cleanly takes over a server pill, and
    // the server probe only ever tears down a pill it owns — never a local
    // terminal pill (success/failure/timeout) that lingers after clearActiveRun.
    let serverDrivenPill = false;

    function actionsFallbackUrl() {
        return target && target.repo
            ? 'https://github.com/' + target.repo + '/actions'
            : '';
    }

    function renderRunPill(opts) {
        if (!runPill) return;
        runPill.className = 'todoMdViewerRunPill todoMdViewerRunPill--' + opts.state;
        runPill.dataset.dismissible = opts.dismissible ? '1' : '0';
        runPill.innerHTML = '';
        if (opts.spinner) {
            const sp = document.createElement('span');
            sp.className = 'todoMdViewerRunPillSpinner';
            sp.setAttribute('aria-hidden', 'true');
            runPill.appendChild(sp);
        } else if (opts.glyph) {
            const g = document.createElement('span');
            g.className = 'todoMdViewerRunPillGlyph';
            g.setAttribute('aria-hidden', 'true');
            g.innerHTML = opts.glyph;
            runPill.appendChild(g);
        }
        const label = document.createElement('span');
        label.className = 'todoMdViewerRunPillLabel';
        label.textContent = opts.label;
        runPill.appendChild(label);
        if (opts.url) {
            const link = document.createElement('a');
            link.className = 'todoMdViewerRunPillLink';
            link.href = opts.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.setAttribute('aria-label', 'Open the run in GitHub Actions');
            link.title = 'Open in GitHub Actions';
            link.innerHTML = runPillLinkGlyph;
            runPill.appendChild(link);
        }
        // Every run-pill state render (start / queued / running and the terminal
        // settles) passes through here, so this is the single chokepoint that
        // disables the deploy pill on run start and re-enables it the instant the
        // run goes terminal.
        syncDeployPillEnabled();
    }

    function restoreRunButton() {
        stopViewerRunPoll();
        serverDrivenPill = false;
        if (runPill && runPill.parentNode) {
            runPill.parentNode.replaceChild(runBacklogBtn, runPill);
        }
        runPill = null;
        // A run is no longer tracked — re-enable the per-entry controls and the
        // deploy pill (in case it was blocked by an active run).
        syncRunEntryButtonsDisabled();
        syncDeployPillEnabled();
    }

    // While a run is being tracked (the pill is mounted), every per-entry
    // "Run this entry" control is disabled so a second dispatch can't orphan
    // the first run's tracking — the pill follows a single-run model. The
    // controls are ALSO greyed while a manual redeploy owns this project (a
    // run and a redeploy are mutually exclusive), so the buttons visibly read
    // as unavailable rather than staying enabled behind the click-time guard.
    // Reads the shared per-project redeploy state directly so a card remounted
    // (or its body rebuilt) mid-redeploy repaints greyed — writeActiveRedeploy/
    // clearActiveRedeploy emit no change event. Called after each body rebuild
    // and on every pill start / teardown.
    function syncRunEntryButtonsDisabled() {
        const runActive = !!runPill;
        const redeployBlocked = !!readActiveRedeploy(projectName);
        const btns = card.querySelectorAll('.todoMdViewerRunEntryBtn');
        btns.forEach(function(b) {
            if (b.classList.contains('todoMdViewerRunEntryBtn--loading')) return;
            b.disabled = runActive || redeployBlocked;
            b.classList.toggle('todoMdViewerRunEntryBtn--disabled', runActive);
            b.classList.toggle('todoMdViewerRunEntryBtn--redeployblocked', redeployBlocked);
        });
    }

    // Grey out and disable the Run backlog button while a manual redeploy owns
    // this project, mirroring the deploy pill's run-blocked treatment in the
    // reverse direction (a run blocks redeploy; a redeploy blocks runs). The
    // per-entry controls fold the same block into syncRunEntryButtonsDisabled.
    // Skips the Run backlog button while it is mid-dispatch (--loading) so an
    // in-flight run isn't disturbed; the run pill (swapped in on a successful
    // dispatch) is untouched since a run and a redeploy never overlap here. The
    // click-time readActiveRedeploy guards in runBacklog/runEntry remain a
    // backstop. Reads the shared per-project redeploy state so a card remounted
    // mid-redeploy paints greyed too.
    function syncRunButtonsRedeployBlocked() {
        const blocked = !!readActiveRedeploy(projectName);
        if (!runBacklogBtn.classList.contains('todoMdViewerRunBtn--loading')) {
            runBacklogBtn.disabled = blocked;
            runBacklogBtn.classList.toggle('todoMdViewerRunBtn--redeployblocked', blocked);
        }
        syncRunEntryButtonsDisabled();
    }

    function showRunSuccess() {
        stopViewerRunPoll();
        // Render terminal state before clearing: the clear emits a change event
        // this card hears, and the subscriber keeps a pill only when terminal.
        renderRunPill({ state: 'success', label: 'Done', glyph: runPillCheckGlyph });
        clearActiveRun(projectName);
        const successPill = runPill;
        // Auto-dismiss ~5s after success, restoring the Run backlog button —
        // but only if this same pill is still mounted in the success state
        // (a later run or a teardown may have replaced it).
        setTimeout(function() {
            if (runPill && runPill === successPill &&
                runPill.classList.contains('todoMdViewerRunPill--success')) {
                restoreRunButton();
            }
        }, 5000);
    }

    function showRunFailure(url) {
        stopViewerRunPoll();
        renderRunPill({
            state: 'failure',
            label: 'Failed',
            glyph: runPillAlertGlyph,
            url: url || runPillLastUrl || actionsFallbackUrl(),
            dismissible: true,
        });
        clearActiveRun(projectName);
    }

    function showRunTimeout() {
        stopViewerRunPoll();
        renderRunPill({
            state: 'timeout',
            label: 'Still running? — check Actions',
            glyph: runPillClockGlyph,
            url: runPillLastUrl || actionsFallbackUrl(),
            dismissible: true,
        });
        clearActiveRun(projectName);
    }

    async function pollRunOnce(correlationId, startedAt) {
        // Give-up timeout: stop watching after 20 minutes without a terminal
        // status. The run may still be going on GitHub; the client just
        // stops polling and offers a link to check.
        if (Date.now() - startedAt >= RUN_GIVE_UP_MS) {
            showRunTimeout();
            return;
        }
        // Poll the run's own stored target when present (a chat-shipped run can
        // target a different repo than the viewer's closure `target`).
        const rec = readActiveRun(projectName);
        const pollTarget = (rec && rec.target && rec.target.repo) ? rec.target : target;
        const res = await pollRunStatus({ correlationId: correlationId, target: pollTarget });
        if (!runPill) return; // torn down mid-flight
        if (!res || res.ok === false) {
            // Transient error (network blip / not-yet-surfaced) — keep the
            // current state and keep polling.
            return;
        }
        if (res.runUrl) runPillLastUrl = res.runUrl;
        if (res.found === false) {
            // Post-dispatch race window: the run hasn't surfaced yet.
            renderRunPill({ state: 'starting', label: 'Starting…', spinner: true });
            return;
        }
        if (res.status === 'completed') {
            if (res.conclusion === 'success') showRunSuccess();
            else showRunFailure(res.runUrl);
            return;
        }
        if (res.status === 'queued') {
            renderRunPill({ state: 'queued', label: 'Queued', spinner: true });
        } else {
            renderRunPill({ state: 'running', label: 'Running…', spinner: true });
        }
    }

    function startRunPill(correlationId) {
        stopViewerRunPoll();
        serverDrivenPill = false; // a local dispatch always owns the pill
        // Idempotent restart: drop any pill already mounted (the change-event
        // subscriber and the dispatch finally can both ask to start one) so a
        // single pill ends up in the meta slot, not two stacked nodes.
        if (runPill && runPill.parentNode) {
            runPill.parentNode.replaceChild(runBacklogBtn, runPill);
        }
        runPillLastUrl = null;
        runPill = document.createElement('div');
        runPill.className = 'todoMdViewerRunPill';
        runPill.setAttribute('role', 'status');
        runPill.setAttribute('aria-live', 'polite');
        // Tap-to-dismiss for the persistent terminal states (failure /
        // timeout). The link affordance opens in a new tab and must not
        // also dismiss the pill.
        runPill.addEventListener('click', function(event) {
            if (event.target.closest('a')) return;
            if (runPill && runPill.dataset.dismissible === '1') restoreRunButton();
        });
        if (runBacklogBtn.parentNode) {
            runBacklogBtn.parentNode.replaceChild(runPill, runBacklogBtn);
        } else {
            meta.insertBefore(runPill, syncBtn);
        }
        renderRunPill({ state: 'starting', label: 'Starting…', spinner: true });
        // Give-up is measured against the PERSISTED dispatch timestamp, so a
        // reload or project switch mid-run does not reset the 10-minute clock.
        // Falls back to now for the rare case the record is missing.
        const rec = readActiveRun(projectName);
        const startedAt = (rec && typeof rec.dispatchedAt === 'number') ? rec.dispatchedAt : Date.now();
        viewerRunPollInterval = setInterval(function() {
            pollRunOnce(correlationId, startedAt);
        }, RUN_POLL_INTERVAL_MS);
        // Poll once immediately so a re-attached run that already finished
        // lands straight on its terminal state instead of waiting a full
        // interval (and never flashing "running" first).
        pollRunOnce(correlationId, startedAt);
        // A run is now tracked — disable the per-entry controls for its duration.
        syncRunEntryButtonsDisabled();
    }

    // Mount a Running pill driven purely by the server signal — no local
    // active-run record, no correlation id, no give-up clock. Used for the
    // cross-device case: a run started elsewhere for this project's repo. It
    // reuses the same pill geometry/state as the local "running" stage; the
    // ambient poll tears it down the moment the server reports the repo idle.
    function mountServerRunPill() {
        runPillLastUrl = null;
        serverDrivenPill = true;
        runPill = document.createElement('div');
        runPill.className = 'todoMdViewerRunPill';
        runPill.setAttribute('role', 'status');
        runPill.setAttribute('aria-live', 'polite');
        if (runBacklogBtn.parentNode) {
            runBacklogBtn.parentNode.replaceChild(runPill, runBacklogBtn);
        } else {
            meta.insertBefore(runPill, syncBtn);
        }
        renderRunPill({ state: 'running', label: 'Running…', spinner: true });
        syncRunEntryButtonsDisabled();
    }

    // Ambient probe of the Worker's repo-level `active_runs` signal so a run
    // started on another device surfaces here (and self-clears when it ends).
    // The local active-run record always wins: when one exists, the rich local
    // lifecycle owns the pill and this probe stands down. A lingering local
    // terminal pill (success/failure/timeout, runPill set but not server-driven)
    // is likewise left untouched. Fire-and-forget — `ok:false` means "not
    // active", never an error toast.
    async function pollServerRunSignal() {
        if (readActiveRun(projectName)) return;
        if (runPill && !serverDrivenPill) return;
        if (!target || !target.repo) return;
        const res = await fetchActiveRuns(target);
        // The card may have been torn down or a local run may have started
        // while the probe was in flight — bail rather than fight the local path.
        if (readActiveRun(projectName)) return;
        if (runPill && !serverDrivenPill) return;
        const active = !!(res && res.ok && res.active === true);
        if (active) {
            if (!runPill) mountServerRunPill();
        } else if (serverDrivenPill) {
            restoreRunButton();
        }
    }

    function startServerRunPoll() {
        stopViewerServerRunPoll();
        viewerServerRunPollInterval = setInterval(pollServerRunSignal, RUN_POLL_INTERVAL_MS);
        // Poll once immediately so a cross-device run surfaces on mount without
        // waiting a full interval.
        pollServerRunSignal();
    }

    // ── Redeploy pill lifecycle ──
    // The pill mirrors the newest GitHub Pages publish for this project's repo:
    // quiet/neutral when the latest deploy succeeded, red (danger) when it
    // failed, and an amber "Deploying" spinner while a publish is in flight.
    // Tapping it re-triggers the publish and polls until it settles. Pages
    // publishes usually land in ~2 minutes; give up after 5.
    const PAGES_POLL_INTERVAL_MS = 5000;
    const PAGES_GIVE_UP_MS = 5 * 60 * 1000;
    // Slow passive health cadence: re-read the latest publish status every 30s
    // for the card's lifetime so a deploy that fails while the viewer is open
    // surfaces on the pill on its own. Much slower than the 5s redeploy poll,
    // and refreshPagesStatus stands down while a local redeploy is mid-poll, so
    // the two never fight.
    const PAGES_HEALTH_INTERVAL_MS = 30000;
    // Monochrome line-rocket that inherits `currentColor`, so it recolors with
    // the pill state (muted grey when idle, danger red on failure) and matches
    // the grey stroke icons beside it. One rocket definition, shown on desktop
    // beside the "Redeploy" label and on the collapsed mobile card icon-only.
    const deployPillGlyph =
        '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 1.3c2.1 2.1 2.6 4.7 2 7.7H5c-.6-3-.1-5.6 2-7.7z"/><circle cx="7" cy="5" r="1"/><path d="M5 8.3 3.2 11.5 5.2 10.2"/><path d="M9 8.3 10.8 11.5 8.8 10.2"/><path d="M6 10.5 7 12.7 8 10.5"/></svg>';
    // True while a locally-initiated redeploy is being polled — the passive
    // refresh stands down so it can't stomp the optimistic "Deploying" state.
    let pagesRebuilding = false;

    // Set the local rebuild flag AND mirror it into the shared per-project
    // redeploy state, so a run dispatch (Run backlog / Run this entry / chat
    // ship) is gated for the whole time a redeploy owns this project — the
    // reverse of the deploy pill disabling while a run is active. The two stay
    // in lockstep because every rebuild-flag transition routes through here.
    function setPagesRebuilding(active) {
        pagesRebuilding = active;
        if (active) writeActiveRedeploy(projectName, { startedAt: Date.now() });
        else clearActiveRedeploy(projectName);
        // Every redeploy transition (tap, poll-completed, poll-give-up, failure)
        // routes through here, so this is the single chokepoint that greys the
        // Run backlog / Run this entry controls for the redeploy's duration and
        // un-greys them the instant it settles.
        syncRunButtonsRedeployBlocked();
    }

    // Paint the pill for one of three states: 'idle' (quiet/healthy),
    // 'failure' (red), or 'deploying' (amber spinner). The label always reads
    // "Redeploy" except while deploying, and the pill is disabled mid-deploy so
    // a second publish can't be queued on top of the first.
    function renderDeployPill(state) {
        deployPill.className = 'todoMdViewerDeployPill todoMdViewerDeployPill--' + state;
        deployPill.innerHTML = '';
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        if (state === 'deploying') {
            icon.className = 'todoMdViewerDeployPillSpinner';
        } else {
            icon.className = 'todoMdViewerDeployPillGlyph';
            icon.innerHTML = deployPillGlyph;
        }
        deployPill.appendChild(icon);
        const label = document.createElement('span');
        label.className = 'todoMdViewerDeployPillLabel';
        label.textContent = state === 'deploying' ? 'Deploying' : 'Redeploy';
        deployPill.appendChild(label);
        syncDeployPillEnabled(state);
    }

    // Reflect the deploy pill's disabled state, its run-blocked styling, and its
    // title/aria. The pill is disabled while a publish is in flight
    // (state === 'deploying') AND while a backlog run is active — a run that
    // merges kicks off its own Pages deploy, so a manual redeploy mid-run is
    // redundant. The run block uses `!!runPill && !isTerminalRunPill()`, so it
    // lifts the instant the run goes terminal (success/failure/timeout) rather
    // than when its pill is dismissed. Called with an explicit deploy state from
    // renderDeployPill, or with no argument from the run-pill lifecycle
    // (renderRunPill / restoreRunButton), in which case the current deploy state
    // is read back off the pill's class so the right per-state title is
    // restored. Guarded against a run being restored on mount before the pill is
    // built.
    function syncDeployPillEnabled(state) {
        if (!deployPill) return;
        if (!state) {
            if (deployPill.classList.contains('todoMdViewerDeployPill--deploying')) state = 'deploying';
            else if (deployPill.classList.contains('todoMdViewerDeployPill--failure')) state = 'failure';
            else state = 'idle';
        }
        const runActive = !!runPill && !isTerminalRunPill();
        const runBlocked = runActive && state !== 'deploying';
        deployPill.disabled = (state === 'deploying') || runActive;
        deployPill.classList.toggle('todoMdViewerDeployPill--runblocked', runBlocked);
        if (runBlocked) {
            deployPill.setAttribute('aria-label', 'Redeploy is unavailable while a backlog run is running');
            deployPill.title = 'Redeploy is unavailable while a backlog run is running';
        } else if (state === 'deploying') {
            deployPill.setAttribute('aria-label', 'Deploying the site');
            deployPill.title = 'A site publish is in progress';
        } else if (state === 'failure') {
            deployPill.setAttribute('aria-label', 'Redeploy the site — the last publish failed');
            deployPill.title = 'The last site publish failed — tap to redeploy';
        } else {
            deployPill.setAttribute('aria-label', 'Redeploy the site');
            deployPill.title = 'Redeploy the site';
        }
    }

    // Map a fetchPagesStatus result onto a pill state. A transient failure
    // (ok:false) leaves the current state untouched — never alarm on a blip.
    function applyPagesStatus(res) {
        if (!res || res.ok === false) return;
        // Remember the current/previous deploy's run id so a manual redeploy can
        // baseline against it and ignore that stale run until a new one appears.
        if (res.runId) lastPagesRunId = res.runId;
        if (res.status && res.status !== 'completed') {
            renderDeployPill('deploying');
        } else if (res.conclusion === 'failure') {
            renderDeployPill('failure');
        } else {
            renderDeployPill('idle');
        }
    }

    // Passive health refresh, called on mount and after each sync. Stands down
    // while a local redeploy is mid-poll so it can't overwrite the optimistic
    // "Deploying" state the rebuild flow owns.
    async function refreshPagesStatus() {
        if (pagesRebuilding) return;
        if (!target || !target.repo) return;
        const res = await fetchPagesStatus(target);
        if (pagesRebuilding) return; // a redeploy started while the probe was in flight
        applyPagesStatus(res);
    }

    // Poll the Worker's pages_status probe until the in-flight publish reports
    // completed, then settle the pill to neutral or red. Gives up after
    // PAGES_GIVE_UP_MS and falls back to a passive refresh.
    //
    // baselineRunId is the run id of the deploy that was current when the
    // redeploy was tapped. A fresh pages-build-deployment run takes ~10-20s to
    // register, so the first few ticks still see that baseline run — already
    // `completed` — and must NOT settle the pill: doing so drops it to idle while
    // the real redeploy is still queued. So long as the probe reports the
    // baseline run, hold the Deploying state and keep polling; only once a
    // genuinely-new run id appears does the normal completed-check settle it.
    // A null baseline (pages_status never carried a run id) falls back to the
    // old behavior — settle on the first completed run.
    function startPagesPoll(baselineRunId) {
        stopViewerPagesPoll();
        const startedAt = Date.now();
        viewerPagesPollInterval = setInterval(async function() {
            if (Date.now() - startedAt >= PAGES_GIVE_UP_MS) {
                stopViewerPagesPoll();
                setPagesRebuilding(false);
                refreshPagesStatus();
                return;
            }
            const res = await fetchPagesStatus(target);
            if (!res || res.ok === false) return; // transient — keep polling
            // The new publish hasn't registered yet — the probe is still seeing
            // the pre-redeploy run. Hold Deploying and keep polling; don't let its
            // stale `completed` settle the pill.
            if (baselineRunId && res.found && res.runId === baselineRunId) {
                renderDeployPill('deploying');
                return;
            }
            if (res.status === 'completed') {
                stopViewerPagesPoll();
                setPagesRebuilding(false);
                applyPagesStatus(res);
            }
            // Otherwise a publish is still in flight — hold the Deploying state.
        }, PAGES_POLL_INTERVAL_MS);
    }

    // Start the ambient health poll for the card's lifetime. Mirrors
    // startServerRunPoll: it re-reads the latest publish status on a slow
    // cadence and repaints the pill, so a deploy that fails (or starts) while
    // the viewer is already open surfaces within one interval. refreshPagesStatus
    // early-returns while a local redeploy owns the poll, so this never stomps
    // the optimistic Deploying state.
    function startPagesHealthPoll() {
        stopPagesHealthPoll();
        viewerPagesHealthInterval = setInterval(refreshPagesStatus, PAGES_HEALTH_INTERVAL_MS);
    }

    // Tap handler: re-trigger the Pages publish, flip to the optimistic
    // "Deploying" state, then poll until it settles.
    async function requestPagesRedeploy() {
        if (pagesRebuilding) return;
        if (!target || !target.repo) return;
        setPagesRebuilding(true);
        renderDeployPill('deploying');
        const res = await requestPagesRebuild(target);
        if (!res || res.ok === false) {
            showInjectToast('Redeploy failed — ' + ((res && res.reason) || 'unknown error'), 'error');
            setPagesRebuilding(false);
            refreshPagesStatus();
            return;
        }
        showInjectToast('Redeploy dispatched');
        // Baseline against the run that was current at tap time so the poll can
        // ignore it until the new publish registers (falls back to the old
        // settle-on-first-completed behavior when no run id was ever seen).
        startPagesPoll(lastPagesRunId);
    }

    deployPill.addEventListener('click', function(event) {
        event.stopPropagation();
        requestPagesRedeploy();
    });
    // Paint the initial idle content (glyph + "Redeploy" label) synchronously so
    // the pill reads correctly before the first pages_status probe resolves. The
    // mount runSync() then settles it to the real deploy health.
    renderDeployPill('idle');

    async function runBacklog() {
        if (runBacklogBtn.disabled) return;
        // Per-project single-run guard: refuse a dispatch when this project
        // already has a fresh active run (started here or shipped from chat).
        if (readActiveRun(projectName)) {
            showInjectToast('A run is already in progress for this project');
            return;
        }
        // Mutual exclusion with a manual redeploy: a merged run kicks off its
        // own deploy, so the two must never overlap on the same project.
        if (readActiveRedeploy(projectName)) {
            showInjectToast('A redeploy is in progress for this project');
            return;
        }
        runBacklogBtn.disabled = true;
        runBacklogBtn.classList.add('todoMdViewerRunBtn--loading');
        let dispatchedId = null;
        try {
            const correlationId =
                (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                    ? crypto.randomUUID()
                    : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
            const res = await dispatchRun({
                mode: 'backlog',
                correlationId: correlationId,
                target: target,
            });
            if (res.ok) {
                dispatchedId = correlationId;
                // Persist the run under this project's key so the pill can
                // re-attach after a project switch or full reload.
                writeActiveRun(projectName, {
                    correlationId: correlationId,
                    project: projectName,
                    target: target ? { repo: target.repo, file_path: target.file_path } : null,
                    dispatchedAt: Date.now(),
                });
                showInjectToast('Backlog run dispatched');
            } else {
                showInjectToast('Run failed — ' + (res.reason || 'unknown error'), 'error');
            }
        } finally {
            runBacklogBtn.disabled = false;
            runBacklogBtn.classList.remove('todoMdViewerRunBtn--loading');
            // On a successful dispatch, swap the button for the status pill
            // and begin polling with the same correlation id.
            if (dispatchedId) startRunPill(dispatchedId);
        }
    }

    runBacklogBtn.addEventListener('click', runBacklog);

    // Dispatch an entry-mode run for a single resolved TODO.md entry id and
    // hand it to the same header pill the Run backlog button drives. Mirrors
    // runBacklog's flow (disable-in-flight, persist the active-run record,
    // start the pill on success) but targets one entry by id rather than
    // letting the routine pick the next backlog task.
    async function runEntry(entryId, btn) {
        if (!entryId) return;
        if (btn && btn.disabled) return;
        // Per-project single-run guard: never dispatch a second run while this
        // project already has a fresh active run (here or shipped from chat).
        if (readActiveRun(projectName)) {
            showInjectToast('A run is already in progress for this project');
            return;
        }
        // Mutual exclusion with a manual redeploy on this project (see runBacklog).
        if (readActiveRedeploy(projectName)) {
            showInjectToast('A redeploy is in progress for this project');
            return;
        }
        if (btn) {
            btn.disabled = true;
            btn.classList.add('todoMdViewerRunEntryBtn--loading');
        }
        let dispatchedId = null;
        try {
            const correlationId =
                (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                    ? crypto.randomUUID()
                    : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
            const res = await dispatchRun({
                mode: 'entry',
                entryId: entryId,
                correlationId: correlationId,
                target: target,
            });
            if (res.ok) {
                dispatchedId = correlationId;
                writeActiveRun(projectName, {
                    correlationId: correlationId,
                    project: projectName,
                    target: target ? { repo: target.repo, file_path: target.file_path } : null,
                    dispatchedAt: Date.now(),
                });
                showInjectToast('Entry run dispatched');
            } else {
                showInjectToast('Run failed — ' + (res.reason || 'unknown error'), 'error');
            }
        } finally {
            if (btn) {
                btn.classList.remove('todoMdViewerRunEntryBtn--loading');
                btn.disabled = false;
            }
            if (dispatchedId) startRunPill(dispatchedId);
        }
    }

    function applyExpandedHeight() {
        if (!card.classList.contains('todoMdViewerCard--expanded')) {
            body.style.height = '';
            return;
        }
        const mainListDiv = document.getElementById('mainList');
        if (!mainListDiv) return;
        const mainListRect = mainListDiv.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        // The card sits inside #mainList (overflow-y: auto). The expanded
        // body's height needs to be the vertical room left between the
        // header's bottom edge and the bottom of the mainList viewport —
        // not relying on flex-grow, since #mainList is a CSS grid and the
        // card's chain doesn't propagate a flex height.
        const bottomGap = 16;
        const available = mainListRect.bottom - headerRect.bottom - bottomGap;
        const fallback = 240;
        body.style.height = Math.max(fallback, available) + 'px';
    }

    function applyCollapsedState(collapsed) {
        card.classList.toggle('collapsed', !!collapsed);
        if (collapsed) {
            collapseBodyBtn.innerHTML = bodyCollapsedGlyph;
            collapseBodyBtn.setAttribute('aria-label', 'Expand panel');
            collapseBodyBtn.title = 'Expand panel';
        } else {
            collapseBodyBtn.innerHTML = bodyExpandedGlyph;
            collapseBodyBtn.setAttribute('aria-label', 'Collapse panel');
            collapseBodyBtn.title = 'Collapse panel';
        }
    }

    collapseBodyBtn.addEventListener('click', function() {
        const willBeCollapsed = !card.classList.contains('collapsed');
        applyCollapsedState(willBeCollapsed);
        // When uncollapsing, also fill the body to the bottom of #mainList
        // by applying the --expanded class that applyExpandedHeight keys off.
        // When collapsing, remove the class so applyExpandedHeight clears
        // the inline height.
        card.classList.toggle('todoMdViewerCard--expanded', !willBeCollapsed);
        applyExpandedHeight();
    });

    applyCollapsedState(true);

    // Mobile: tapping the card body anywhere outside its own buttons /
    // tabs opens the viewer in a slide-up bottom sheet. The inline card
    // is cramped on touch — the sheet hosts the same card (DOM move,
    // preserving all the listeners wired above) so tabs, Sync, and the
    // expand toggle keep working inside the sheet. The mobile-sheet
    // machinery lives in main.js, which registers the handler via
    // setViewerCardTapHandler — keeping this wiring here without a
    // circular import back into main.js.
    card.addEventListener('click', function(event) {
        if (viewerCardTapHandler) viewerCardTapHandler(card, event);
    });

    detachViewerResizeHandler();
    viewerResizeHandler = function() {
        if (card.classList.contains('todoMdViewerCard--expanded')) {
            applyExpandedHeight();
        }
    };
    window.addEventListener('resize', viewerResizeHandler);

    // True while the mounted pill is in a terminal state (success / failure /
    // timeout). Those states clear the project's run entry themselves and then
    // linger (auto-dismiss on success, tap-to-dismiss otherwise), so an
    // external clear event must not tear them down early.
    function isTerminalRunPill() {
        if (!runPill) return false;
        return runPill.classList.contains('todoMdViewerRunPill--success') ||
            runPill.classList.contains('todoMdViewerRunPill--failure') ||
            runPill.classList.contains('todoMdViewerRunPill--timeout');
    }

    // React to run state written/cleared elsewhere (notably a chat-shipped run
    // for the project this card is showing). A write attaches the pill if one
    // isn't already up; a clear restores the button when a still-live pill is
    // mounted. Changes for other projects are ignored.
    viewerActiveRunChangeHandler = function(event) {
        const changed = event && event.detail ? event.detail.project : '';
        if (changed !== projectName) return;
        const rec = readActiveRun(projectName);
        if (rec) {
            // A local run takes over even from a server-driven pill, so the
            // cross-device "Running…" upgrades into the rich local lifecycle.
            if (!runPill || serverDrivenPill) startRunPill(rec.correlationId);
        } else if (runPill && !isTerminalRunPill()) {
            restoreRunButton();
            // The local record cleared — re-probe the server signal so a run
            // still in flight elsewhere keeps the pill up instead of flashing
            // back to the button for one interval.
            pollServerRunSignal();
        }
    };
    document.addEventListener(ACTIVE_RUN_CHANGE_EVENT, viewerActiveRunChangeHandler);

    // Re-attach an in-flight run's pill if one is tracked for THIS project and
    // hasn't resolved yet. This fires on every card mount — both project
    // switches and a full page reload — so the run's tracking survives
    // navigation. readActiveRun is keyed by project, so runs launched from
    // other projects never surface here, and a stale (aged-out) record is
    // cleared rather than re-attached. startRunPill reads the persisted
    // dispatch timestamp for the give-up clock and polls once immediately, so
    // an already-finished run lands on its terminal state without flashing
    // "running".
    const activeRun = readActiveRun(projectName);
    if (activeRun) {
        startRunPill(activeRun.correlationId);
    }

    // Begin the ambient cross-device run probe for this project's repo. It runs
    // for the card's whole lifetime (not just while a local run is tracked), so
    // a run started on another device lights up the Running pill within one
    // interval and self-clears when the run completes. When a local run is
    // active the probe stands down and the local lifecycle owns the pill.
    startServerRunPoll();

    // Kick off the initial fetch — the card mounts with the cached
    // timestamp in the header and a "Loading…" body, then the body fills
    // in (or flips to an inline error) when the Worker responds.
    runSync();

    // Begin the ambient Pages health poll for this card's lifetime, so a deploy
    // that fails while the viewer stays open turns the Redeploy pill red on its
    // own (~30s) without waiting for a manual Sync. The mount runSync() already
    // did the first health read; this keeps it fresh from here on.
    startPagesHealthPoll();

    // Paint the Run backlog / Run this entry controls greyed if this project is
    // already mid-redeploy at mount time — writeActiveRedeploy/clearActiveRedeploy
    // emit no change event, so a card remounted during a redeploy would otherwise
    // render the buttons ungreyed.
    syncRunButtonsRedeployBlocked();

    return card;
}

function updateTodoMdViewerCard() {
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;

    const projectName = activeProjectNameForViewer();
    const existing = mainListDiv.querySelector('#todoMdViewerCard');

    if (!projectName) {
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        detachViewerResizeHandler();
        viewerActiveProject = null;
        return;
    }

    const targetId = listLogic.getProjectTargetId(projectName);
    const target = targetId ? findTargetById(targetId) : null;

    if (!target) {
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        detachViewerResizeHandler();
        viewerActiveProject = null;
        return;
    }

    if (existing && existing.dataset.projectName === projectName) {
        placeViewerCard(existing, mainListDiv);
        return;
    }

    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    const card = buildTodoMdViewerCard(projectName, target);
    placeViewerCard(card, mainListDiv);
    viewerActiveProject = projectName;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('mainListRendered', function() {
        try { updateTodoMdViewerCard(); }
        catch (e) { console.warn('[mainListRendered] viewer update failed:', e); }
    });
}
