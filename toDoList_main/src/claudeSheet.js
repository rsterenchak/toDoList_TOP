// In-app Claude assistant. Lives behind a `⋯` launcher pinned to the
// bottom-right (the slot the old help `?` FAB used to occupy — help moved to
// the ghost menu's "Help" item and the global `?` keypress). On narrow
// viewports (≤1023px) the surface is a bottom sheet at ~86% height with a grab
// handle and a dimming backdrop; on wider viewports it docks as a right-hand
// panel (~380px, full height) so the app stays visible beside it.
//
// The Chat tab is functional in author mode: it holds a conversation with the
// Worker, renders replies, and — when a reply contains a fenced ```md entry —
// surfaces a "drafted entry" card whose "Inject & run" action (behind an
// inline confirm) injects the entry to TODO.md and dispatches an entry-mode
// routine run. Each dispatch becomes a Runs-tab record that polls QUEUED →
// RUNNING → SHIPPED. Run records persist in localStorage so they survive a
// reload.
//
// A SHIPPED run record is the door into iterate mode: tapping it opens the
// Chat tab and fires turn 1 carrying the run's entry id, so the Worker
// resolves that entry's merged diff and seeds the conversation. Follow-ups
// flow through the same drafted-entry card → Inject & run path as the author
// flow — fixing forward as a brand-new entry with a fresh id.
//
// The sheet also wears a SECOND identity: possession. Tapping the ghost chip in
// the composer chip area (mobile) or clicking the wandering companion (desktop,
// where the chip is hidden) hands the whole surface to the ghost — the work
// thread hides with its state intact, a ghost thread takes its place, and the
// composer goes ghostly. Possession is presence, not agency: it carries no
// model picker, no attachments and no task scope, and every byte of it flows
// through ghostTalk.js's Worker plumbing, never through the chat route and
// never through Supabase. See the POSSESSION section below.

import {
    chatWithWorker,
    injectEntry,
    mintEntryId,
    embedEntryMarker,
    dispatchRun,
    pollRunStatus,
    resolveEntryByMarker,
    revertEntry,
    fetchRunResult,
    readTodoMdFromWorker,
    getCachedTargets,
    loadInjectTargets,
    isInjectConfigured,
    showInjectToast,
    emitTodoRunStatusChange,
    refreshShippedMarkersForProject,
    getShippedMarkersForRepo,
    fetchModelCatalog,
    fetchModelSettings,
    TODO_RUN_STATUS_EVENT,
} from './inject.js';
// The per-run model picker renders the SAME list the Models panel drills into,
// so it imports that list builder rather than growing a second copy of the
// lane-grouping rules. modelsPanel.js imports getActiveChatRepo back out of this
// module — a cycle ESM resolves fine here, because every one of these bindings
// is a hoisted function declaration read at call time, never at module-eval time.
import { buildPickerList, providerForModel, readAutoMerge3p, resolveSurfaceChip } from './modelsPanel.js';
import {
    readActiveRun,
    writeActiveRun,
    clearActiveRun,
    readActiveRedeploy,
    activeProjectNameForViewer,
} from './runState.js';
import {
    GHOST_PLACEHOLDER,
    askGhost,
    fetchGhostHistory,
    ghostOpeningLine,
    isGhostWireReady,
    renderGhostPending,
} from './ghostTalk.js';
import { listLogic } from './listLogic.js';
import {
    buildCoveragePane,
    getAssignmentState,
    getProposedRows,
    onAssignmentChange,
    refreshAssignmentForActiveProject,
} from './assignmentCoverage.js';
import { onQueueChange, getQueueRows, getLoadedProjectName } from './agentQueueStore.js';
import { parsePastedEntry, commitEntryToActiveProject, taskLineTitle } from './entryParse.js';
import { mountMicButton, stopDictation } from './voiceInput.js';
import { setChatPaneCollapsed, getUsageBudget, setUsageBudget } from './prefs.js';
import { wireModalDismiss } from './modalDismiss.js';
import { serializeLayout } from './layoutInspect.js';
import { applyPendingUpdate, hasPendingUpdate, showConfirmModal } from './modals.js';
import {
    materializeEntryTodo,
    unshipEntry,
    revertConfirmMessage,
    revertToastMessage,
} from './dispatchDraft.js';
import DOMPurify from 'dompurify';

const MOBILE_MAX_WIDTH = 1023;
// Swipe-down-to-dismiss commit thresholds. A deliberate dismiss is either a
// long drag (>= SWIPE_CLOSE_PX) or a shorter drag thrown with real downward
// velocity (>= SWIPE_CLOSE_FLICK_PX at >= SWIPE_CLOSE_VELOCITY_PX_PER_MS). The
// distance bar is raised well above a casual scroll-intent swipe so the sheet
// no longer closes on almost any downward gesture.
const SWIPE_CLOSE_PX = 120;
const SWIPE_CLOSE_FLICK_PX = 60;
const SWIPE_CLOSE_VELOCITY_PX_PER_MS = 0.5;

// ── POSSESSION ──
// How much of the ghost transcript the possessed thread carries: deep enough
// that re-entering shows a conversation rather than a fragment, shallow enough
// that the hydrate stays one screen of DOM. Mirrors the limit the retired
// standalone modal used, so the thread reads the same after the move.
const GHOST_THREAD_LIMIT = 20;
// Fired on the document whenever possession is entered or left, so surfaces
// outside the sheet can react without importing it. main.js listens on desktop
// and parks the wandering companion on the pane's rim for as long as the ghost
// has it — the seam exists so the sprite reads the state rather than tracking
// the sheet, and follows a flip from any door (the chip, the sprite, the RUNS
// tab, a sheet close).
export const POSSESSION_EVENT = 'claudeGhostPossession';
// The chip that stands in for the model picker and the attach rail while
// possessed — the composer says who is listening instead of offering tools the
// ghost has no use for.
const GHOST_LISTENING_COPY = 'the ghost is listening';
// The work composer's prompt. Possession swaps it for GHOST_PLACEHOLDER and
// swaps it back on the way out, so the placeholder always names who is reading.
const CHAT_PLACEHOLDER = 'Ask Agent';

const RUNS_KEY = 'todoapp_claudeRuns';
const RUN_POLL_INTERVAL_MS = 5000;
const RUN_GIVE_UP_MS = 20 * 60 * 1000;

// Repos the file-attach picker can pull source from. The list is projected from
// the user's Inject targets at runtime (via `loadWorkspaceRepos`, reading the
// `inject_targets` cache in inject.js) so the chat menu never drifts from the
// targets managed in Inject settings. Until the cache loads — and if it's empty
// or fails to load — the list holds a safe fallback of just the default repo, so
// the chat is always usable. The default repo is the only one with a published
// `src-manifest.json`, so it gets the browsable file list; others fall back to
// a free-text path input since there's no manifest to render.
const DEFAULT_ATTACH_REPO = 'rsterenchak/toDoList_TOP';
let attachRepos = [DEFAULT_ATTACH_REPO];

let launcherEl = null;
let sheetEl = null;
let backdropEl = null;
// The movable chat surface (#claudeSheetBody): the tab row + chat/runs views.
// It is the SAME node at every breakpoint — D2 relocates it between the mobile
// slide-up sheet (#claudeSheet) and the desktop persistent pane
// (#desktopChatPane) so handlers, scroll state, and in-flight requests survive
// the move. All content lookups scope to it (see sheetQuery) so they resolve in
// whichever container currently holds it.
let contentEl = null;
let chatPaneEl = null;
let resizeHandler = null;
let keydownHandler = null;
let attachClickHandler = null;
// Registered once (module-level) so re-mounts don't stack duplicate coverage
// listeners. The listeners read live module state (sheetEl/contentEl), which each
// mount refreshes, so a single registration keeps working across remounts.
let coverageListenersWired = false;
let appUpdateHandler = null;
let appAppliedHandler = null;
let injectTargetsChangedHandler = null;

// True once a newer build's service worker is installed-and-waiting (the
// `appUpdateAvailable` event fired) but the page is still running the old
// bundle. While set, the rendered DOM is stale: the Runs/iterate UI shows a
// reload nudge and the layout inspector refuses to measure (a snapshot of the
// old build would mislead the Worker).
let updatePending = false;

// Conversation history sent to the Worker on each turn: [{ role, content }].
let chatHistory = [];
// The active workspace repo's iterate entry id, or null when no iterate session
// is in progress for it. While set, every chat turn re-sends it as `entry_id`
// so the Worker re-serves the cached seed (the merged-PR diff plus sliced
// post-merge source) on follow-ups, not just the seed turn. Persisted per repo
// (todoapp_claudeIterateEntry) in lockstep with chatHistory, so a reload or a
// workspace swap resumes that repo's iterate session, mirroring chatHistory.
let activeIterateEntry = null;
// The agent_queue row id a chat session was handed off from (via
// openChatWithSeed with a row id — e.g. tapping "Discuss in chat" on a
// needs_words Agent-board card), or null when the current session isn't a
// hand-off. In-memory session state (not persisted per repo like
// activeIterateEntry): once a run ships from this session, the id is copied onto
// the persisted run record, which is what survives a reload. Set on every seed
// (to the row id, or null when the seed carries none), and cleared on "+ New
// Chat", a workspace swap, and a NOCHANGE follow-up — mirroring the
// activeIterateEntry lifecycle so a stale link never rides a later, unrelated
// ship.
let activeHandoffRow = null;
// The todo id of the task SCOPED to the current conversation, or null when the
// chat is unscoped. Attaching a task (the row-side "Discuss" action) sets this;
// while set, the task's title + description ride on every turn so follow-ups
// need no re-explanation, and a scope chip renders above the composer. Only the
// id is held — the title/description are resolved through listLogic at render
// and send time so a rename shows fresh and a deletion collapses the chip.
// Persisted per repo (todoapp_claudeChatTask) in lockstep with chatHistory and
// activeIterateEntry, so a reload or workspace swap resumes that repo's scope;
// cleared by "+ New Chat" in the same place the transcript is wiped, and
// swapped/dropped on a workspace change exactly as the iterate entry is.
let activeChatTask = null;
// Repo-relative source paths attached to the CURRENT conversation. Sent as
// `attach_files` on every turn (per-conversation accumulation), so the model
// keeps the source context across follow-ups. Cleared on a fresh mount and by
// the Runs-tab "+ New" affordance.
let attachedFiles = [];
// Repo-relative paths the user accepted from a Worker file suggestion ("Lever
// 4"). Kept separate from `attachedFiles` so they travel as
// `suggested_attach_files` and get the Worker's tighter 20KB suggestion cap
// rather than the 40KB manual-attach budget. Cleared alongside `attachedFiles`.
let suggestedAttachedFiles = [];
// Worker-proposed paths the user has NOT yet accepted or dismissed. They render
// as the distinct "suggested" chip variant in the composer chip area; accepting
// moves a path into `suggestedAttachedFiles`, dismissing drops it. Cleared
// alongside `attachedFiles`.
let pendingSuggestedFiles = [];
// The repo all current attachments belong to. The Worker loads from a single
// repo per request, so every chip in a conversation must share this value;
// null while the attachment set is empty. Sent as `repo` alongside
// `attach_files` on each turn.
let attachedRepo = null;
// Images the user has picked for the NEXT chat turn, each { media_type, data }
// (data = raw base64, no `data:` prefix — the shape the Worker's multimodal turn
// expects). Rendered as thumbnail tiles in the rail above the composer; moved
// onto the outgoing user turn on send and then cleared. Session-scoped and
// in-memory only — never persisted (saveChatHistory strips `images` before it
// writes), so a reload or workspace swap loses them and localStorage never holds
// base64. Bounded by IMAGE_MAX_COUNT.
let pendingImages = [];
// Image-attachment limits, mirrored on the Worker as a backstop. At most four
// images per turn; each downscaled client-side (canvas) to stay under the
// Worker's 5MB/image cap so a phone screenshot never trips its 400; only the
// four still-image formats the model accepts are allowed.
const IMAGE_MAX_COUNT = 4;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MAX_DIMENSION = 1568;
const IMAGE_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
// The chat-level "workspace": the repo the whole conversation is framed
// around. Sent as `repo` on every turn so the Worker reframes its system
// prompt, and it's the single source of truth the picker reads from. Switching
// it clears the current chat. Reset to the default on a fresh mount.
let activeChatRepo = DEFAULT_ATTACH_REPO;
// Persistent chat send mode for the split send button: 'fast' (default) or
// 'deep'. The main send action — click OR Enter — sends in this mode; the caret
// menu picks it and the ★ marks it. Persisted under todoapp_chatMode so the
// choice survives reloads. The fast/deep distinction still reaches the Worker
// via chatWithWorker's deep_think flag (deep → true, fast → omitted), exactly as
// the former side-by-side Fast/Deep buttons did.
const CHAT_MODE_KEY = 'todoapp_chatMode';
let chatMode = 'fast';
let modeMenuClickHandler = null;
// Which repo the picker is currently browsing. Kept in sync with
// `activeChatRepo` (the workspace governs repo selection now), so it always
// equals the active workspace. Drives whether the picker shows the
// manifest-driven file list (any repo with a fetchable manifest) or a free-text
// path input (repos without one).
let selectedAttachRepo = DEFAULT_ATTACH_REPO;
// Per-repo manifest cache: repo string -> { ok, files }. `ok` records whether
// the repo published a fetchable `src-manifest.json` (drives browse vs.
// free-text mode); `files` is its path list (empty when not ok). Cached for the
// module's lifetime so re-selecting a repo never re-fetches.
let srcManifestCache = {};
// ── POSSESSION STATE ──
// True while the ghost is wearing the sheet. It is session state, never
// persisted: possession is a mood the surface is in, and a reload should land
// on the work chat rather than resuming a conversation the user can't see the
// start of. Everything visual hangs off the `is-possessed` class this drives.
let possessed = false;
// Whether the ghost thread has been hydrated from the transcript during THIS
// sheet-open. One readback per open, not per flip — flipping back and forth
// shouldn't re-fetch (or re-append) the same rows.
let ghostHydrated = false;
// Bumped on every possession flip and every sheet close. In-flight ghost work
// captures it and bails when it no longer matches, so a reply landing after the
// user has flipped back to the work chat can never paint into a stale thread.
let ghostSession = 0;
// The composer text banked for the identity the user is NOT currently in.
// Flipping identity swaps them, so a half-written prompt survives a trip
// through the ghost and vice versa.
let workDraft = '';
let ghostDraft = '';
// Run records, newest-first: [{ entryId, correlationId, title, status,
// dispatchedAt }]. Mirrored to localStorage so they survive a reload.
let runRecords = [];
// correlationId -> interval handle for in-flight status polls.
const runPollers = {};

export function isClaudeSheetOpen() {
    return !!(sheetEl && sheetEl.classList.contains('open'));
}

// Scoped lookup for chat content. The content node moves between the slide-up
// sheet and the desktop pane (placeChatContent), so queries must target the
// content wrapper rather than a fixed container — otherwise a desktop lookup
// would miss elements that have been relocated into #desktopChatPane.
function sheetQuery(selector) {
    return contentEl ? contentEl.querySelector(selector) : null;
}

// D2: present the chat as a persistent right-hand pane at desktop widths and a
// slide-up sheet at mobile widths, sharing one DOM subtree. On mount and on
// every viewport-crossing resize, the content node is re-parented to whichever
// container matches the current breakpoint. Moving (not duplicating) the node
// preserves its event handlers, scroll position, input text, and any in-flight
// request. Idempotent: a no-op when the content already lives in the right
// container. Falls back to leaving the content in the sheet when no pane is
// present (e.g. unit tests that mount only the sheet).
function placeChatContent() {
    if (!contentEl) return;
    const desktop = window.innerWidth > MOBILE_MAX_WIDTH;
    const target = desktop ? chatPaneEl : sheetEl;
    if (!target) return;
    if (contentEl.parentNode !== target) target.appendChild(contentEl);
}

function setActiveTab(tab) {
    if (!sheetEl) return;
    sheetEl.setAttribute('data-tab', tab);
    // Leaving CHAT ends possession: the ghost has no runs and no coverage to
    // show, and a possessed composer hovering over a run list would be lying
    // about what the send button does. Returning to CHAT lands on the work
    // chat with the ghost chip available again.
    if (tab !== 'chat') setPossessed(false);
    const chatTab = sheetQuery('#claudeTabChat');
    const runsTab = sheetQuery('#claudeTabRuns');
    const coverageTab = sheetQuery('#claudeTabCoverage');
    const chatView = sheetQuery('#claudeChatView');
    const runsView = sheetQuery('#claudeRunsView');
    const coverageView = sheetQuery('#claudeCoverageView');
    if (chatTab) chatTab.setAttribute('aria-selected', String(tab === 'chat'));
    if (runsTab) runsTab.setAttribute('aria-selected', String(tab === 'runs'));
    if (coverageTab) coverageTab.setAttribute('aria-selected', String(tab === 'coverage'));
    if (chatView) chatView.hidden = tab !== 'chat';
    if (runsView) runsView.hidden = tab !== 'runs';
    if (coverageView) coverageView.hidden = tab !== 'coverage';
    // Rebuild the coverage body from the live assignment cache + queue rows each
    // time the tab is entered, so it reflects any rows that shipped while it was
    // off-screen (onQueueChange keeps it fresh while it's the active tab).
    if (tab === 'coverage') renderCoverageView();
    // The attach button and its dropdown live in the composer, so they hide with
    // the chat view on the Runs tab. Still gate the button explicitly and collapse
    // the panel when leaving Chat so a panel left open can't linger on return.
    const attachBtn = sheetQuery('#claudeComposerAttach');
    if (attachBtn) attachBtn.hidden = tab !== 'chat';
    if (tab !== 'chat') setAttachPanelHidden(true);
    // The image button and its pending-thumbnail rail are chat-only too — same
    // gate as the attach button, so a Runs-tab view never shows either.
    const imageBtn = sheetQuery('#claudeComposerImage');
    if (imageBtn) imageBtn.hidden = tab !== 'chat';
    const imageRail = sheetQuery('#claudeImageRail');
    if (imageRail) imageRail.hidden = tab !== 'chat';
    // New Chat lives inside the chat view now, so it's hidden with the view on
    // RUNS / COVERAGE — no separate per-tab gate needed here. Its confirm does
    // need resetting, though: leaving Chat with the confirm armed would put it
    // one tap from a cross-device wipe on return, out of sight in between.
    syncClearChatVisibility();
    // Re-evaluate the reload nudge each time Runs opens so a flag left stale by
    // a worker that activated without dispatching appUpdateApplied can't surface
    // a false-positive banner — the visibility decision reads live worker state.
    if (tab === 'runs') {
        // Rehydrate run records from localStorage on every switch to Runs, not
        // just at sheet mount, so records written by another tab/window or by a
        // run dispatched in a prior session become visible without a full reload.
        // resumeRunPollers() then attaches a live poller to any freshly-appeared
        // QUEUED/RUNNING record so it doesn't sit stale until the next reload.
        loadRunRecords();
        renderRunsList();
        resumeRunPollers();
        renderUpdateNudge();
        // Refresh the shipped-marker cache the Runs list's spine reads (the
        // cross-device record of entries shipped via Run backlog or a Run pill,
        // which have no queue row). Respects the 60s TTL; on resolve it fires
        // TODO_RUN_STATUS_EVENT, which repaints the list with any new shipped
        // entries. A no-op when inject isn't configured or the project has no
        // routed target.
        refreshShippedMarkersForProject(getLoadedProjectName());
    }
}

// Repaint the COVERAGE tab's body from the assignmentCoverage module's cached
// descriptor + the live queue rows. A no-op when the view node isn't mounted
// (unit mounts that build only the sheet still have it, so this is defensive).
function renderCoverageView() {
    const view = sheetQuery('#claudeCoverageView');
    if (!view) return;
    view.textContent = '';
    view.appendChild(buildCoveragePane());
    refreshCoverageBadge();
}

// Reconcile the COVERAGE tab's visibility with the active project's assignment
// state, and repaint its body if it's the live tab. The tab shows only when the
// assignment classifies 'unfilled' or 'filled'; it's hidden for 'absent' (every
// non-coursework project) and while the read is still pending (state null), so it
// never flashes in before the read resolves. When it hides out from under a
// selected COVERAGE tab (a switch to a project without an assignment), fall back
// to CHAT rather than stranding a hidden tab selected over an empty body.
function refreshCoverageTab() {
    const state = getAssignmentState();
    const show = state === 'unfilled' || state === 'filled';
    const coverageTab = sheetQuery('#claudeTabCoverage');
    if (coverageTab) coverageTab.hidden = !show;
    const onCoverage = !!(sheetEl && sheetEl.getAttribute('data-tab') === 'coverage');
    if (!show) {
        if (onCoverage) setActiveTab('chat');
        refreshCoverageBadge();
        return;
    }
    if (onCoverage) renderCoverageView();
    refreshCoverageBadge();
}

// Update the COVERAGE tab's proposal-count badge from the same getProposedRows()
// query the pane's review action reads, so the badge and the action can never
// disagree. Shown only when proposals are waiting; hidden (and count cleared)
// otherwise. Runs on every queue change regardless of the active tab so the badge
// tracks proposals even while the user is on CHAT or RUNS.
function refreshCoverageBadge() {
    const badge = sheetQuery('#claudeTabCoverageBadge');
    if (!badge) return;
    const count = getProposedRows().length;
    if (count > 0) {
        badge.textContent = String(count);
        badge.hidden = false;
    } else {
        badge.textContent = '';
        badge.hidden = true;
    }
}

// `options.possessed` opens the sheet with the ghost already wearing it. Omitted
// (the default, and what every existing caller passes) the sheet opens on the
// work chat exactly as before; callers
// that pass an event object land there too, since an Event carries no
// `possessed` field.
export function openClaudeSheet(options) {
    if (!sheetEl) return;
    const wantPossessed = !!(options && options.possessed);
    // Possession is scoped to one open: a sheet that was closed comes back on
    // the work chat with a fresh (un-hydrated) ghost thread.
    if (!isClaudeSheetOpen()) ghostHydrated = false;
    sheetEl.classList.add('open');
    sheetEl.setAttribute('aria-hidden', 'false');
    if (backdropEl) backdropEl.classList.add('open');
    if (launcherEl) launcherEl.setAttribute('aria-expanded', 'true');
    // Re-sync the workspace list from the Inject targets on every open so a
    // target added, edited, or removed while the sheet was closed shows up in
    // the pill menu without a page reload. Fire-and-forget: the current list
    // stays usable while the reload is in flight, and a failed reload leaves it
    // intact. Repaints the pill/menu only — chatHistory, attachments, and the
    // active workspace survive.
    refreshWorkspaceRepos();

    if (wantPossessed) {
        // Desktop possession arrives from the companion, and the pane the ghost
        // is about to wear may be collapsed — uncollapse it the same way the
        // other programmatic entry points do (openChatWithTask, openChatWithSeed)
        // or the flip would happen behind a shut pane. Mobile needs none of
        // this: the sheet itself was just opened above.
        if (window.innerWidth > MOBILE_MAX_WIDTH) {
            document.body.classList.remove('chatPaneCollapsed');
            setChatPaneCollapsed(false);
        }
        // The ghost only ever wears the CHAT tab — there is nothing for it to
        // say over a run list.
        setActiveTab('chat');
        setPossessed(true);
        // Idempotent (ghostHydrated gates it), so a possessed-open against an
        // already-possessed sheet re-focuses rather than re-appending the
        // transcript.
        hydrateGhostThread();
    }
}

export function closeClaudeSheet() {
    if (!sheetEl) return;
    // Don't leave a dictation running in the background if the sheet is
    // dismissed mid-recording.
    stopDictation();
    // Possession resets with the sheet: the ghost doesn't wait behind a closed
    // door, and the thread it was holding is dropped so the next open hydrates
    // fresh rather than stacking a second copy of the transcript.
    setPossessed(false);
    ghostHydrated = false;
    clearGhostThread();
    sheetEl.classList.remove('open');
    sheetEl.setAttribute('aria-hidden', 'true');
    if (backdropEl) backdropEl.classList.remove('open');
    if (launcherEl) launcherEl.setAttribute('aria-expanded', 'false');
}

export function toggleClaudeSheet() {
    if (isClaudeSheetOpen()) closeClaudeSheet();
    else openClaudeSheet();
}

// Drop a "reference" into the chat composer: a backticked selector plus a
// plain-English label, appended to whatever the user has already typed without
// clobbering it. The Structure view's UI lens calls this so a region can be
// handed straight to the conversation. On mobile the sheet must be open for the
// composer to be visible (open it if it isn't); on desktop the pane is always
// mounted, so opening is unnecessary. Always lands on the Chat tab — a
// reference is a chat action, not a Runs one. A blank selector is ignored.
export function insertReference(label, selector) {
    const sel = String(selector || '').trim();
    if (!sel) return;
    if (!isClaudeSheetOpen() && window.innerWidth <= MOBILE_MAX_WIDTH) {
        openClaudeSheet();
    }
    setActiveTab('chat');
    const input = sheetQuery('#claudeComposerInput');
    if (!input) return;
    const lbl = String(label || '').trim();
    const ref = '`' + sel + '`' + (lbl ? ' (' + lbl + ')' : '');
    const existing = input.value || '';
    const sep = existing && !/\s$/.test(existing) ? ' ' : '';
    input.value = existing + sep + ref;
    try { input.focus(); } catch (e) { /* defensive */ }
    try { input.selectionStart = input.selectionEnd = input.value.length; } catch (e) { /* defensive */ }
    // Nudge the composer's auto-grow listener so it resizes to the new content.
    try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* defensive */ }
}

// Hand a task off from the AGENT board's needs_words card into the chat: reveal
// the Chat tab and seed the composer with the task context, leaving the send to
// the user (no auto-send). On mobile the slide-up sheet must be open for the
// composer to be visible (open it if it isn't); on desktop the docked pane is
// always mounted but may be user-collapsed, so un-collapse it. The workspace is
// already framed on the active project's repo by the project-switch auto-swap
// (autoSwapWorkspaceForProject), so this does NOT re-point it — a needs_words
// card only exists on a repo-backed project. Unlike insertReference (which
// appends a reference), this REPLACES the composer contents so a re-entry always
// lands on the same seeded prompt. A blank seed is ignored.
export function openChatWithSeed(seedText, handoffRowId) {
    const seed = String(seedText == null ? '' : seedText);
    if (!seed.trim()) return;
    // Record (or clear) the originating Agent-board row this seed hands off from.
    // A seed with a row id links the session so a ship from it settles that row;
    // a seed without one is a fresh, unlinked hand-off and must drop any prior
    // link so it can't be misattributed to an earlier row.
    activeHandoffRow = handoffRowId != null ? handoffRowId : null;
    if (window.innerWidth <= MOBILE_MAX_WIDTH) {
        if (!isClaudeSheetOpen()) openClaudeSheet();
    } else {
        document.body.classList.remove('chatPaneCollapsed');
        setChatPaneCollapsed(false);
    }
    setActiveTab('chat');
    const input = sheetQuery('#claudeComposerInput');
    if (!input) return;
    input.value = seed;
    try { input.focus(); } catch (e) { /* defensive */ }
    try { input.selectionStart = input.selectionEnd = input.value.length; } catch (e) { /* defensive */ }
    // Nudge the composer's auto-grow listener so it resizes to the new content.
    try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* defensive */ }
}

// Open the Claude sheet with a committed task ATTACHED (scoped) to the
// conversation — the row-side "Discuss" entry point. Unlike openChatWithSeed
// (which one-shot-seeds the composer), this attaches the task so it rides on
// every turn and renders as the scope chip until detached or the session is
// reset. Opens/uncollapses the chat surface exactly as openChatWithSeed does,
// then attaches; the composer is left untouched so the user types their own
// question. A blank id, or one that doesn't resolve to a real todo, is ignored.
// Reached from toDoRow via a registered handler (main.js wires it) so toDoRow
// never imports this module directly.
export function openChatWithTask(todoId) {
    if (!todoId || !listLogic.getTodoById(todoId)) return;
    if (window.innerWidth <= MOBILE_MAX_WIDTH) {
        if (!isClaudeSheetOpen()) openClaudeSheet();
    } else {
        document.body.classList.remove('chatPaneCollapsed');
        setChatPaneCollapsed(false);
    }
    setActiveTab('chat');
    attachTaskToChat(todoId);
    const input = sheetQuery('#claudeComposerInput');
    if (input) { try { input.focus(); } catch (e) { /* defensive */ } }
}

// Auto-expand / auto-collapse the Claude chat pane when the active project
// changes. A project "has a repo configured" by the SAME gate the sidebar
// project-row thunderbolt (⚡) uses — inject is configured globally AND this
// project carries a routed inject target — so the auto-behavior tracks the
// visible bolt indicator exactly (see projectRow.js).
//
// The chat surface this drives is the docked desktop pane (#desktopChatPane),
// whose visibility rides the `chatPaneCollapsed` body class — NOT the mobile
// slide-up sheet element (open/closeClaudeSheet toggle that, but on desktop the
// chat content is relocated out of it into the pane, so toggling it is a no-op
// there). A repo-backed project expands the pane (the state the chat expand
// button drives); a project without one collapses it (the state the collapse
// button drives). We toggle the canonical body class and persist via
// setChatPaneCollapsed — the exact pair the buttons' applyChatPaneCollapsed
// runs — so the pane and its stored preference stay in sync across reloads.
export function syncClaudeSheetForProject(projectName) {
    const hasRepo = isInjectConfigured()
        && !!listLogic.getProjectTargetId(projectName);
    const collapsed = !hasRepo;
    document.body.classList.toggle('chatPaneCollapsed', collapsed);
    setChatPaneCollapsed(collapsed);
    applyClaudeAvailability(hasRepo);
    autoSwapWorkspaceForProject(projectName);
    // Re-resolve the COVERAGE tab for the newly active project. Thread the switched-to
    // project name through explicitly — it is authoritative the instant the switch
    // fires, whereas the shared getSelectedProjectName() DOM reader can still lag the
    // switch, which would make both the double-fetch guard and the read target resolve
    // against the previous project and silently no-op the switch (the tab then only
    // appeared on a later pane reopen). refreshAssignment* reads assignment.md once
    // (skipping when the cache already belongs to this project), and refreshCoverageTab
    // reconciles the tab's visibility now (for an already-cached project) while the
    // onAssignmentChange listener repaints it once a pending read lands — so the tab
    // appears only after the read resolves, never before.
    refreshAssignmentForActiveProject(projectName);
    refreshCoverageTab();
}

// The single source of truth for "the assistant is unusable on this project"
// (no inject target routed). Rides one body class — `claudeUnavailable` — so the
// mobile `✦` launcher and the desktop `‹` expand tab share one flag and their
// dimmed/inert CSS states clear automatically on the next project switch once a
// repo is routed. Distinct from `chatPaneCollapsed`, which the user can also set
// manually on a repo-backed project (a manual collapse leaves the expand tab
// live). Also flips `aria-disabled` on both entry points and swaps in an
// explanatory `title` (restoring the original on re-enable) so the state is
// exposed to assistive tech and to desktop hover.
export const CLAUDE_UNAVAILABLE_MSG =
    'Claude unavailable here — no repo configured for this project';

function applyClaudeAvailability(hasRepo) {
    document.body.classList.toggle('claudeUnavailable', !hasRepo);
    const controls = [
        document.getElementById('claudeLauncher'),
        document.getElementById('chatExpandButton'),
    ];
    for (let i = 0; i < controls.length; i++) {
        const el = controls[i];
        if (!el) continue;
        if (!hasRepo) {
            el.setAttribute('aria-disabled', 'true');
            if (el.dataset.prevTitle === undefined) {
                el.dataset.prevTitle = el.getAttribute('title') || '';
            }
            el.setAttribute('title', CLAUDE_UNAVAILABLE_MSG);
        } else {
            el.removeAttribute('aria-disabled');
            if (el.dataset.prevTitle !== undefined) {
                if (el.dataset.prevTitle) el.setAttribute('title', el.dataset.prevTitle);
                else el.removeAttribute('title');
                delete el.dataset.prevTitle;
            }
        }
    }
}

// True while the assistant is gated off for the active project. Both entry-point
// click handlers consult this to turn a tap into a no-op-plus-tooltip.
export function isClaudeUnavailable() {
    return document.body.classList.contains('claudeUnavailable');
}

// A transient tooltip anchored to a dimmed entry point, shown when the user taps
// it while the assistant is unavailable. This is the touch-equivalent of the
// desktop `title` hover (there's no hover on touch): a single tap surfaces the
// reason and auto-dismisses. Positioned to the LEFT of the anchor (both the
// bottom-right launcher and the right-edge expand tab hug the viewport's right
// side) via computed fixed coords — the only inline styles here, dynamic by
// nature. Re-tapping replaces the current bubble rather than stacking.
let unavailableTooltipEl = null;
let unavailableTooltipTimer = null;

function hideClaudeUnavailableTooltip() {
    if (unavailableTooltipTimer) {
        clearTimeout(unavailableTooltipTimer);
        unavailableTooltipTimer = null;
    }
    if (unavailableTooltipEl && unavailableTooltipEl.parentNode) {
        unavailableTooltipEl.parentNode.removeChild(unavailableTooltipEl);
    }
    unavailableTooltipEl = null;
}

export function showClaudeUnavailableTooltip(anchorEl) {
    hideClaudeUnavailableTooltip();
    const tip = document.createElement('div');
    tip.className = 'claudeUnavailableTooltip';
    tip.setAttribute('role', 'status');
    tip.textContent = CLAUDE_UNAVAILABLE_MSG;
    document.body.appendChild(tip);
    if (anchorEl && typeof anchorEl.getBoundingClientRect === 'function') {
        const rect = anchorEl.getBoundingClientRect();
        tip.style.position = 'fixed';
        tip.style.right = Math.max(8, window.innerWidth - rect.left + 8) + 'px';
        tip.style.top = (rect.top + rect.height / 2) + 'px';
        tip.style.transform = 'translateY(-50%)';
    }
    unavailableTooltipEl = tip;
    unavailableTooltipTimer = setTimeout(hideClaudeUnavailableTooltip, 3200);
}

// On a project switch, re-point the chat workspace at the project's configured
// inject repo so the next chat turn is framed around the right app. Chat threads
// are persisted per repo (todoapp_claudeChat), so the swap saves the outgoing
// repo's thread and resumes the incoming repo's saved thread — unlike the
// "Clear chat" control, which deliberately wipes the current thread. Resolves
// projectName → target_id → the cached inject target's repo; leaves the
// workspace untouched when the project has no target, the target is no longer
// cached, the target is disabled, or the repo already matches the active
// workspace.
function autoSwapWorkspaceForProject(projectName) {
    const targetId = listLogic.getProjectTargetId(projectName);
    if (!targetId) return;
    const targets = getCachedTargets();
    let repo = null;
    // Skip disabled targets (enabled === false): the Worker's allowlist drops
    // them, so framing the chat on one would 400 at inject/dispatch. `!== false`
    // keeps legacy rows with no `enabled` column selectable.
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] && targets[i].id === targetId && targets[i].enabled !== false) { repo = targets[i].repo; break; }
    }
    if (!repo || repo === activeChatRepo) return;

    // Persist the outgoing repo's thread and iterate entry, switch, then resume
    // the incoming repo's saved thread (empty when none) and its iterate entry
    // (null when none) so each repo carries its own iterate session — an id is
    // never dragged across repos.
    saveChatHistory();
    saveIterateEntry();
    saveChatTask();
    setActiveChatRepo(repo);
    chatHistory = loadChatHistory(repo);
    activeIterateEntry = loadIterateEntry(repo);
    // The task scope is per repo like the thread: persist the outgoing repo's and
    // resume the incoming repo's (null when none), so a scope is never dragged
    // across repos and swapping back restores it.
    activeChatTask = loadChatTask(repo);
    // A workspace swap starts fresh on the incoming repo, so any hand-off link
    // from the outgoing repo's session must not ride a later ship on the new one.
    activeHandoffRow = null;
    clearAttachments();
    replayChatHistory();
    // The incoming repo's thread is a different thread — a confirm armed against
    // the outgoing one must never survive the swap and wipe this one instead.
    syncClearChatVisibility();
    // Behind the instant local paint, pull the incoming repo's stored turns so a
    // thread started on another device merges into this one. Fire-and-forget:
    // the swap is already complete and a failed read changes nothing.
    hydrateChatTurnsFromRemote(repo);
    renderScopeChip();
    renderWorkspacePill();

    // If the attach picker is open, refresh it to the new repo's source list.
    const panel = sheetQuery('#claudeAttachPanel');
    if (panel && !panel.hidden) {
        setAttachPanelHidden(false);
        refreshAttachPickerMode();
    }
}

// ── RUN RECORDS (localStorage-backed) ──
function loadRunRecords() {
    try {
        const raw = localStorage.getItem(RUNS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        runRecords = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        runRecords = [];
    }
    return runRecords;
}

function saveRunRecords() {
    try {
        localStorage.setItem(RUNS_KEY, JSON.stringify(runRecords));
    } catch (e) { /* private mode */ }
    // A run record just changed (created, reconciled to SHIPPED, etc.). Notify
    // the todo rows so any description-status dot correlating to this entry
    // re-evaluates live — the shipped edge that flips a pending amber dot green.
    emitTodoRunStatusChange();
}

// Register a run dispatched OUTSIDE this sheet — the TODO.md viewer's "Run
// backlog" button and its per-entry "Run this entry" pill — so it shows in the
// Runs tab while it's in flight. Those dispatches write only the viewer's own
// active-run entry, which drives the viewer's header pill and nothing else: no
// agent_queue row is created for them either, so without this the Runs tab has
// nothing to show until the entry is checked off in TODO.md and the shipped
// spine surfaces it as SHIPPED with no preceding QUEUED/RUNNING row.
//
// Mirrors the chat-ship path: unshift a QUEUED record keyed by the SAME
// correlation id the viewer's pill polls, then start this sheet's poller so the
// row walks QUEUED → RUNNING → SHIPPED/FAILED on its own. Records are re-read
// from localStorage first (read-modify-write) so a dispatch made before the
// sheet ever mounted — or after another tab wrote a record — can't clobber the
// stored list. Returns the new record, or null when the dispatch is already
// tracked (dedup by correlation id, so a re-entrant call can never stack two
// rows for one run).
// Distil a TODO.md body down to the titles of the entries still OPEN in it —
// the dispatch-time snapshot a backlog run is later diffed against to discover
// which entry the routine checked off. Deliberately stores the titles rather
// than the body itself: TODO.md runs to six figures of bytes, run records are
// uncapped, and saveRunRecords swallows a quota error silently — so persisting
// whole bodies would eventually break run persistence outright with no signal.
// The titles are the entire input to the diff, so nothing is lost. Returns null
// when there is nothing to snapshot, keeping the record free of empty arrays.
function openTaskTitles(content) {
    if (typeof content !== 'string' || !content) return null;
    const titles = [];
    content.split('\n').forEach(function(line) {
        if (!/^\s*- \[ \]/.test(line)) return;
        const title = taskLineTitle(line);
        if (title) titles.push(title);
    });
    return titles.length ? titles : null;
}

export function trackDispatchedRun(opts) {
    if (!opts || !opts.correlationId) return null;
    loadRunRecords();
    if (findRunRecord(opts.correlationId)) return null;
    const record = {
        // Backlog runs have no entry id — the routine picks the task itself —
        // so the record stays un-joined to a TODO.md entry and simply never
        // becomes iterable/revertable, exactly as reconcile already handles.
        entryId: opts.entryId || null,
        // …which also means the row opens with a generic "Backlog run" label.
        // The open-entry snapshot taken at dispatch is what lets reconcile
        // recover the real title once the run lands. Entry runs already know
        // their entry (and its title), so they carry no snapshot.
        openTitles: opts.entryId ? null : openTaskTitles(opts.todoSnapshot),
        correlationId: opts.correlationId,
        title: opts.title || 'Untitled entry',
        status: 'QUEUED',
        dispatchedAt: typeof opts.dispatchedAt === 'number' ? opts.dispatchedAt : Date.now(),
        // The repo this run was dispatched against, so status polling queries
        // the same repo rather than the Worker's default.
        repo: opts.repo || null,
        // The project this run belongs to, so the poller frees that project's
        // run guard at terminal even when its viewer isn't mounted.
        project: opts.project || null,
        // Not a hand-off from an Agent-board card — nothing to settle.
        agentRowId: null,
    };
    runRecords.unshift(record);
    saveRunRecords();
    renderRunsList();
    startRunPoller(record);
    return record;
}

// ── CHAT HISTORY (localStorage-backed, per-repo) ──
// Each workspace repo owns a durable conversation so the chat survives reloads
// and a project auto-swap resumes that repo's thread. Stored under one key as a
// per-repo map { [repo]: [{ role, content }] }; reads are read-modify-write so
// saving one repo's thread never clobbers another's. Only user/assistant turns
// are persisted — transient `note` bubbles never enter chatHistory.
const CHAT_KEY = 'todoapp_claudeChat';
const CHAT_HISTORY_CAP = 60;

function readChatMap() {
    try {
        const raw = localStorage.getItem(CHAT_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        return {};
    }
}

function writeChatMap(map) {
    try {
        localStorage.setItem(CHAT_KEY, JSON.stringify(map));
    } catch (e) { /* private mode */ }
}

// Persist the active workspace's thread, capped to the last CHAT_HISTORY_CAP
// turns so a long conversation can't grow the key without bound. Any per-turn
// `images` field is stripped before writing: attached images are session-scoped
// and in-memory only, so base64 never lands in localStorage (a reload replays
// those turns text-only) and can't bloat the key.
function saveChatHistory() {
    const map = readChatMap();
    map[activeChatRepo] = chatHistory.slice(-CHAT_HISTORY_CAP).map(stripTurnImages);
    writeChatMap(map);
}

// Return a copy of a chat turn without its `images` field, or the turn itself
// when it carries none. Used only on the persistence path so the in-memory
// chatHistory keeps its images (the Worker still sees them on later turns within
// the session) while localStorage never does.
function stripTurnImages(turn) {
    if (turn && turn.images) {
        const copy = Object.assign({}, turn);
        delete copy.images;
        return copy;
    }
    return turn;
}

// The stored thread for `repo`, or [] when none is saved. Returns a copy so the
// live chatHistory is never aliased into the persisted map.
function loadChatHistory(repo) {
    const thread = readChatMap()[repo];
    return Array.isArray(thread) ? thread.slice() : [];
}

// Drop a repo's stored thread (the explicit pill "clear & focus" wipe), so a
// reload or later auto-swap-back can't resurrect a cleared conversation.
function deleteChatHistory(repo) {
    const map = readChatMap();
    if (Object.prototype.hasOwnProperty.call(map, repo)) {
        delete map[repo];
        writeChatMap(map);
    }
}

// ── CHAT TURNS (Supabase-backed, cross-device) ──
// localStorage keeps a thread on the device that wrote it, so a conversation
// started on the phone is invisible on the desktop. Every turn is therefore
// ALSO written to the `chat_turns` table (through listLogic, which owns all
// Supabase writes) and merged back in on hydrate. The local copy stays the
// authoritative one for painting: it loads synchronously, works offline, and a
// failed remote read or write changes nothing the user can see. There is no
// realtime subscription by design — replayChatHistory is a full teardown and a
// row arriving mid-compose would desync the array sent to the Worker.

// True while a chat turn is in flight (from the moment requestAssistantReply
// disables the composer until its reply or error settles). The remote hydrate
// reads it as a bail condition: replayChatHistory opens with
// `surface.innerHTML = ''`, so a merge landing mid-turn would destroy the
// pending assistant bubble the user is watching.
let chatTurnInFlight = false;

// The single funnel every chat turn is appended through. Push onto the live
// thread and persist it locally exactly as before, then mirror the turn into
// `chat_turns` and trim that repo's rows back to CHAT_HISTORY_CAP — the same
// constant saveChatHistory caps the local copy with, so the two never drift.
//
// The turn's `id` is minted here (when the caller didn't supply one) so the
// in-memory turn and its row share an identity and a later hydrate can union by
// id; `ts` is a client stamp that orders a turn whose row `created_at` hasn't
// come back yet. Both are plain scalars, so stripTurnImages carries them through
// untouched and `images` stay session-scoped — base64 reaches Supabase no more
// than it reaches localStorage.
//
// The remote write is fire-and-forget: a failure leaves the local thread intact
// and raises nothing, because this is a background sync rather than a user
// action.
function appendChatTurn(turn) {
    if (!turn) return turn;
    if (!turn.id) turn.id = mintEntryId();
    if (typeof turn.ts !== 'number') turn.ts = Date.now();
    chatHistory.push(turn);
    saveChatHistory();

    // Capture the repo now: the prune resolves after an await, by which point a
    // workspace swap could have moved activeChatRepo onto another thread.
    const repo = activeChatRepo;
    const row = { id: turn.id, repo: repo, role: turn.role, content: turn.content };
    try {
        Promise.resolve(listLogic.insertChatTurn(row))
            .then(function(result) {
                if (!result || result.ok === false) return null;
                return listLogic.pruneChatTurns(repo, CHAT_HISTORY_CAP);
            })
            .catch(function() { /* background sync — never surfaced */ });
    } catch (e) { /* background sync — never surfaced */ }
    // The thread just became non-empty (or grew), so the pill must be present.
    syncClearChatVisibility();
    return turn;
}

// Drop a repo's stored turns, in lockstep with deleteChatHistory. Every path
// that resets a thread must call both, or the next hydrate would pull the wiped
// conversation straight back out of Supabase. Fire-and-forget with the rejection
// swallowed — a failed clear must never interrupt the reset it accompanies.
function clearRemoteChatTurns(repo) {
    if (!repo) return;
    try {
        Promise.resolve(listLogic.clearChatTurns(repo))
            .catch(function() { /* background sync — never surfaced */ });
    } catch (e) { /* background sync — never surfaced */ }
}

// Project the thread down to what the Worker consumes — `role`, `content`, and
// the session-scoped `images` when a turn carries them. The sync metadata
// (`id`, `ts`, `created_at`) is bookkeeping for the local↔Supabase merge and has
// no meaning to the Worker, so it never rides the wire: the messages array it
// receives keeps exactly the shape it had before chat turns were synced.
function toWorkerTurns(history) {
    return (Array.isArray(history) ? history : []).map(function(turn) {
        const out = { role: turn.role, content: turn.content };
        if (turn.images) out.images = turn.images;
        return out;
    });
}

// Sort key for a merged turn: its row's `created_at` when it has one, else the
// client `ts` stamped at append. Legacy turns written before this change carry
// neither and key to 0, which sorts them first — correct, since they predate
// every synced turn — and Array#sort is stable, so their existing relative order
// survives.
function chatTurnOrderKey(turn) {
    if (!turn) return 0;
    if (turn.created_at) {
        const parsed = Date.parse(turn.created_at);
        if (!isNaN(parsed)) return parsed;
    }
    return typeof turn.ts === 'number' ? turn.ts : 0;
}

// True when a local turn is known to have come back from a `chat_turns` row, so
// its absence from a fresh fetch means the row was deleted rather than not yet
// written. `created_at` is the discriminator: appendChatTurn stamps only `id` and
// the client `ts`, and the hydrate merge below is the sole place `created_at` is
// ever assigned — always from `row.created_at`. A turn without one has never
// round-tripped (its insert may still be in flight, or it may predate the sync
// entirely) and is preserved.
function chatTurnWasPersisted(turn) {
    return !!(turn && turn.created_at && typeof turn.id === 'string' && turn.id);
}

// Merge `repo`'s stored turns into the live thread, behind the local hydrate
// that has already painted. Merge by turn id with the remote row winning on a
// conflict (its row is the durable copy), ordered by created_at falling back to
// the local ts, capped to the last CHAT_HISTORY_CAP, then re-saved and replayed.
// A turn's in-memory `images` survive a remote overwrite: the row can't carry
// them, and dropping them would blank the thumbnails on a turn the user just
// sent.
//
// The merge is deliberately NOT a union: a local turn absent from the remote set
// is dropped when it has previously round-tripped, so a wipe on another device
// replicates here (see chatTurnWasPersisted). A ZERO-ROW result therefore runs
// the same path as any other — it is positive proof the thread is empty, which
// is exactly what a remote clear produces — and only an ok:false fetch bails.
//
// An ok:false fetch — offline, signed out, a failed read — returns without
// touching chatHistory or the surface and raises no toast. This is a background
// sync, not a user action.
async function hydrateChatTurnsFromRemote(repo) {
    if (!repo) return;
    let result = null;
    try {
        result = await listLogic.fetchChatTurns(repo, CHAT_HISTORY_CAP);
    } catch (e) {
        return;
    }
    if (!result || result.ok === false) return;
    const rows = Array.isArray(result.turns) ? result.turns : [];

    // GUARD (load-bearing): replayChatHistory below opens with
    // `surface.innerHTML = ''`. If the workspace moved while this fetch was in
    // flight, merging would paint the wrong repo's thread; if a turn is being
    // sent, it would destroy the pending or mid-stream assistant bubble. Bail
    // without touching chatHistory or the surface in either case.
    if (repo !== activeChatRepo) return;
    if (chatTurnInFlight) return;

    const merged = [];
    const indexById = {};
    function put(turn) {
        if (!turn) return;
        const id = typeof turn.id === 'string' ? turn.id : '';
        if (!id) { merged.push(turn); return; }
        if (Object.prototype.hasOwnProperty.call(indexById, id)) {
            const prior = merged[indexById[id]];
            // Remote wins on the persisted fields; the local turn's session-only
            // images ride along, since no row can supply them.
            if (prior && prior.images && !turn.images) turn.images = prior.images;
            merged[indexById[id]] = turn;
            return;
        }
        indexById[id] = merged.length;
        merged.push(turn);
    }
    // Keep only the local turns the remote set still vouches for. A turn that has
    // round-tripped and is now missing was deleted elsewhere; one that hasn't may
    // simply be ahead of its insert. Local turns go in first so a remote row
    // still overwrites them on a conflict.
    const remoteIds = {};
    rows.forEach(function(row) {
        if (row && typeof row.id === 'string' && row.id) remoteIds[row.id] = true;
    });
    chatHistory.forEach(function(turn) {
        if (chatTurnWasPersisted(turn) && !Object.prototype.hasOwnProperty.call(remoteIds, turn.id)) return;
        put(turn);
    });
    rows.forEach(function(row) {
        if (!row || (row.role !== 'user' && row.role !== 'assistant')) return;
        put({
            id: row.id,
            role: row.role,
            content: typeof row.content === 'string' ? row.content : '',
            created_at: row.created_at,
        });
    });
    merged.sort(function(a, b) { return chatTurnOrderKey(a) - chatTurnOrderKey(b); });

    try {
        chatHistory = merged.slice(-CHAT_HISTORY_CAP);
        // Written through even when the merge emptied the thread, so a reload
        // can't restore turns a wipe on another device removed.
        saveChatHistory();
        replayChatHistory();
    } catch (e) { /* background sync — never surfaced */ }
    // replayChatHistory ends in this too, but the merge can empty the thread and
    // the pill must go with it even if the replay above threw.
    syncClearChatVisibility();
}

// ── ITERATE ENTRY (localStorage-backed, per-repo) ──
// A parallel per-repo map { [repo]: entryId } stored under one key, mirroring
// the chat-history map so each workspace's iterate session survives reloads and
// resumes on a workspace swap. The active repo's id is also held in
// `activeIterateEntry` so chat turns can send it without a read.
const ITERATE_KEY = 'todoapp_claudeIterateEntry';

function readIterateMap() {
    try {
        const raw = localStorage.getItem(ITERATE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        return {};
    }
}

function writeIterateMap(map) {
    try {
        localStorage.setItem(ITERATE_KEY, JSON.stringify(map));
    } catch (e) { /* private mode */ }
}

// Persist the active workspace's iterate entry id, or drop its map slot when
// the session is cleared (activeIterateEntry === null). Read-modify-write so one
// repo's entry never clobbers another's.
function saveIterateEntry() {
    const map = readIterateMap();
    if (activeIterateEntry) map[activeChatRepo] = activeIterateEntry;
    else delete map[activeChatRepo];
    writeIterateMap(map);
}

// The stored iterate entry id for `repo`, or null when none is saved.
function loadIterateEntry(repo) {
    const id = readIterateMap()[repo];
    return typeof id === 'string' && id ? id : null;
}

// Drop a repo's stored iterate entry, in lockstep with deleteChatHistory.
function deleteIterateEntry(repo) {
    const map = readIterateMap();
    if (Object.prototype.hasOwnProperty.call(map, repo)) {
        delete map[repo];
        writeIterateMap(map);
    }
}

// ── CHAT TASK SCOPE (localStorage-backed, per-repo) ──
// The task-scope chip's attachment, stored as { [repo]: todoId } under one key —
// a direct parallel to the iterate-entry map, so a repo's scope survives reloads
// and resumes on a workspace swap exactly as its chat thread and iterate session
// do. Only the id is persisted; the title/description are resolved live from
// listLogic at render/send time, so localStorage never holds a stale task copy.
const CHAT_TASK_KEY = 'todoapp_claudeChatTask';

function readTaskMap() {
    try {
        const raw = localStorage.getItem(CHAT_TASK_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
        return {};
    }
}

function writeTaskMap(map) {
    try {
        localStorage.setItem(CHAT_TASK_KEY, JSON.stringify(map));
    } catch (e) { /* private mode */ }
}

// Persist the active workspace's scoped task id, or drop its map slot when the
// chat is unscoped (activeChatTask === null). Read-modify-write so one repo's
// scope never clobbers another's, mirroring saveIterateEntry.
function saveChatTask() {
    const map = readTaskMap();
    if (activeChatTask) map[activeChatRepo] = activeChatTask;
    else delete map[activeChatRepo];
    writeTaskMap(map);
}

// The stored scoped task id for `repo`, or null when none is saved.
function loadChatTask(repo) {
    const id = readTaskMap()[repo];
    return typeof id === 'string' && id ? id : null;
}

// Drop a repo's stored task scope, in lockstep with deleteChatHistory /
// deleteIterateEntry.
function deleteChatTask(repo) {
    const map = readTaskMap();
    if (Object.prototype.hasOwnProperty.call(map, repo)) {
        delete map[repo];
        writeTaskMap(map);
    }
}

// Paint the scope chip above the composer from the current attachment. The chip
// is always present so the scope is never ambiguous: with a task attached it
// reads "🎯 <title>" and carries a detach ✕; with nothing attached it reads a
// muted "Unscoped". The stored id is resolved live through listLogic — a rename
// shows fresh — and if it no longer resolves (task deleted, project gone) the
// attachment self-heals to unscoped rather than rendering a dangling chip.
function renderScopeChip() {
    const host = sheetQuery('#claudeScopeChip');
    if (!host) return;
    const todo = activeChatTask ? listLogic.getTodoById(activeChatTask) : null;
    if (activeChatTask && !todo) {
        // The id no longer resolves — drop the dead attachment and fall back to
        // unscoped so a deleted task never leaves a stale chip behind.
        activeChatTask = null;
        saveChatTask();
    }
    host.innerHTML = '';
    const chip = document.createElement('span');
    chip.className = 'claudeScopeChipTag';
    if (todo) {
        chip.classList.add('claudeScopeChipTag--scoped');
        const title = (todo.title && todo.title.trim()) ? todo.title.trim() : 'Untitled task';
        const label = document.createElement('span');
        label.className = 'claudeScopeChipLabel';
        label.textContent = '🎯 ' + title;
        label.title = title;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'claudeScopeChipRemove';
        x.setAttribute('aria-label', 'Detach task from chat');
        x.textContent = '✕';
        x.addEventListener('click', detachChatTask);
        chip.appendChild(label);
        chip.appendChild(x);
    } else {
        chip.classList.add('claudeScopeChipTag--unscoped');
        chip.textContent = 'Unscoped';
    }
    host.appendChild(chip);
}

// Attach a committed task to the conversation by id (replacing any current one —
// at most one task is scoped at a time). No-op on a blank id or one that doesn't
// resolve to a real todo, so a phantom is never attached. Client-side scope
// only: this never writes to agent_queue or touches triage.
function attachTaskToChat(todoId) {
    if (!todoId) return;
    if (!listLogic.getTodoById(todoId)) return;
    activeChatTask = todoId;
    saveChatTask();
    renderScopeChip();
}

// Detach the scoped task: the chip returns to unscoped and the task stops riding
// on turns. The conversation itself is untouched.
function detachChatTask() {
    if (!activeChatTask) return;
    activeChatTask = null;
    saveChatTask();
    renderScopeChip();
}

// Resolve the scoped task to the { title, description } context sent on a turn,
// or null when nothing is attached. Resolves the id live so a renamed task sends
// fresh text; a dead id self-heals to unscoped (chip included) rather than
// sending stale context.
function resolveActiveChatTask() {
    if (!activeChatTask) return null;
    const todo = listLogic.getTodoById(activeChatTask);
    if (!todo) {
        activeChatTask = null;
        saveChatTask();
        renderScopeChip();
        return null;
    }
    return { title: todo.title, description: todo.description };
}

// Clear the chat surface and replay the in-memory chatHistory into it, rendering
// assistant turns through renderAssistantContent so fenced ```html/```svg replay
// as rendered markup rather than raw text. Used on mount-hydrate and auto-swap.
function replayChatHistory() {
    const surface = sheetQuery('#claudeChatSurface');
    if (surface) surface.innerHTML = '';
    for (let i = 0; i < chatHistory.length; i++) {
        const turn = chatHistory[i];
        if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) continue;
        // turn.images is present only while a turn is still in the in-memory
        // session (auto-swap replays from live chatHistory); after a reload it was
        // stripped on save, so the replay is text-only.
        const bubble = appendMessageBubble(turn.role, turn.content, turn.images);
        if (turn.role === 'assistant' && bubble) {
            renderAssistantContent(bubble, turn.content);
            mountCreateTaskAction(bubble, turn.content);
        }
    }
    // An empty (per-repo) thread carries a persistent capabilities note at the
    // top naming what this chat can do in scope. It's a transient `note` bubble
    // that never enters chatHistory, so it's re-derived from the empty state
    // rather than persisted.
    if (chatHistory.length === 0) renderChatIntro();
    // The thread was just replaced (mount-hydrate, remote merge, or a workspace
    // swap), so the pill's own visibility and any armed confirm are stale.
    syncClearChatVisibility();
}

// The capabilities intro note shown at the top of an empty chat thread. Names
// the four things the Sonnet chat can do in scope as one muted sentence, reusing
// the `.claudeMsg--note` treatment. Given a stable id so the send path can drop
// it before the first real turn and the clear-chat reset can re-render it.
const CHAT_INTRO_COPY =
    'This chat drafts TODO entries, takes file attachments, reframes a task for another repo, and iterates on shipped runs — describe a change to get started.';

function renderChatIntro() {
    const bubble = appendMessageBubble('note', CHAT_INTRO_COPY);
    if (bubble) bubble.id = 'claudeChatIntro';
    return bubble;
}

// Remove the intro note if present, so it doesn't linger above a conversation
// once the first real turn is sent.
function removeChatIntro() {
    const intro = sheetQuery('#claudeChatIntro');
    if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
}

// AWAITING is deliberately absent: a run parked behind a manual merge has not
// reached its outcome yet, so it must stay clearable-proof and promotable. It is
// still never polled — the workflow already completed, so a poller would only
// re-read the same green conclusion forever (resumeRunPollers skips it
// explicitly, and its promotion rides the shipped-marker cache instead).
function isTerminalStatus(status) {
    return status === 'SHIPPED' || status === 'FAILED' || status === 'NOCHANGE';
}

// A run is "completed" for the Clear-completed action when it can no longer be
// in flight: a positively terminal SHIPPED/FAILED status, or an unconfirmed
// record (finished or aged out, outcome unknown). RUNNING/QUEUED records that
// are not unconfirmed are still in flight and are never cleared.
function isClearableRun(rec) {
    return !!rec.unconfirmed || isTerminalStatus(rec.status);
}

// Derive a short, human title from a drafted entry's markdown. Uses the first
// non-empty line, stripping a leading `- [ ]` checkbox, a `**[PRIORITY]**`
// marker, and any trailing id marker so the Runs list reads cleanly.
function deriveRunTitle(entryText) {
    const lines = String(entryText || '').split('\n');
    let line = '';
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim()) { line = lines[i]; break; }
    }
    line = line
        .replace(/^\s*-\s*\[[ xX]?\]\s*/, '')
        .replace(/\*\*\[[^\]]*\]\*\*\s*/, '')
        .replace(/<!-- id: \S+ -->/, '')
        .trim();
    return line || 'Untitled entry';
}

// Resolve the project routed to `repo` via inject_targets — the project whose
// linked target points at that repo. Chat can be scoped to a workspace repo
// other than the on-screen project's, and `activeChatRepo` drives the inject
// target, so a task created for a chat-injected entry must land in the project
// that actually routes to the TARGET repo, not the selected one — creating it
// in the wrong project would attach the row to a list the entry never shipped
// to. Reads the same inject_targets cache the workspace menu projects from and
// each project's `target_id` FK, matching the two on `repo`. Returns the project
// name, or null when no project routes to `repo` (the caller then skips task
// creation and says so rather than mis-attaching it).
function projectForRepo(repo) {
    if (!repo) return null;
    const targets = getCachedTargets();
    const names = listLogic.listProjectsArray() || [];
    for (let i = 0; i < names.length; i++) {
        const targetId = listLogic.getProjectTargetId(names[i]);
        if (!targetId) continue;
        const target = targets.find(function(t) { return t && t.id === targetId; });
        if (target && target.repo === repo) return names[i];
    }
    return null;
}

function buildLauncher() {
    const btn = document.createElement('button');
    btn.id = 'claudeLauncher';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open Claude assistant');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = 'Claude';
    btn.textContent = '✦';
    btn.addEventListener('click', function(event) {
        event.stopPropagation();
        // Gated off on a project with no routed repo: the tap is a no-op that
        // surfaces the reason instead of opening a sheet against the wrong repo.
        if (isClaudeUnavailable()) {
            showClaudeUnavailableTooltip(btn);
            return;
        }
        toggleClaudeSheet();
    });
    return btn;
}

function buildTab(id, label, selected) {
    const tab = document.createElement('button');
    tab.id = id;
    tab.type = 'button';
    tab.className = 'claudeTab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(!!selected));
    tab.textContent = label;
    return tab;
}

// The chat-level workspace pill is retired as an interactive control: the repo
// the conversation is framed around is now governed entirely by the per-project
// auto-swap (syncClaudeSheetForProject → autoSwapWorkspaceForProject). The pill
// node persists, hidden, purely as the live read-out of the active workspace
// repo that renderWorkspacePill keeps current — it carries NO click listener and
// opens NO menu, so there is nothing for the user to tap and no dropdown handler
// left dangling on a hidden node.
function buildWorkspace() {
    const wrap = document.createElement('div');
    wrap.className = 'claudeWorkspace';
    wrap.hidden = true;

    const pill = document.createElement('button');
    pill.id = 'claudeWorkspacePill';
    pill.type = 'button';
    pill.className = 'claudeWorkspacePill';
    pill.hidden = true;
    pill.tabIndex = -1;
    pill.setAttribute('aria-hidden', 'true');

    wrap.appendChild(pill);
    return wrap;
}

// The "New Chat" control — a contextual button above the chat transcript
// (inside the CHAT view body, not the tab strip). Text-only (no icon), tinted
// with the purple accent palette. Wipes the current conversation but never the
// attachments or the iterate seed.
//
// The pill no longer wipes on its own click: the wipe is cross-device (it drops
// the local thread AND the repo's `chat_turns` rows), so a stray tap would
// permanently delete the conversation everywhere with nothing recoverable. It
// arms the inline confirm below the header instead, following the RUNS tab's
// "Clear completed" pattern.
function buildClearChat() {
    const btn = document.createElement('button');
    btn.id = 'claudeClearChat';
    btn.type = 'button';
    btn.className = 'claudeClearChat';
    btn.textContent = '+ New Chat';
    btn.setAttribute('aria-label', 'New Chat');
    btn.addEventListener('click', function() {
        const confirm = sheetQuery('.claudeClearChatConfirm');
        if (confirm) confirm.hidden = false;
    });
    return btn;
}

// The inline confirm for New Chat. A sibling of #claudeChatHeader rather than a
// child of it: the header is a right-aligned flex ROW carrying the spend control
// and the pill, and a taller child would stretch it. As its own row directly
// beneath, this spans the view width and can carry real copy.
//
// Unlike the runs-clear confirm, the pill STAYS visible while this is open, so
// it's obvious what's being confirmed.
function buildClearChatConfirm() {
    const wrap = document.createElement('div');
    wrap.className = 'claudeClearChatConfirm';
    wrap.hidden = true;

    const warn = document.createElement('span');
    warn.className = 'claudeClearChatConfirmWarn';
    warn.textContent = 'Deletes this thread on every device.';

    const yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    yesBtn.className = 'claudeClearChatYes';
    yesBtn.textContent = 'Wipe';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'claudeClearChatCancel';
    cancelBtn.textContent = 'Cancel';

    wrap.appendChild(warn);
    wrap.appendChild(yesBtn);
    wrap.appendChild(cancelBtn);

    cancelBtn.addEventListener('click', function() { wrap.hidden = true; });
    // clearChatConversation ends in syncClearChatVisibility, which re-hides this
    // row (and the now-pointless pill) once the thread is empty.
    yesBtn.addEventListener('click', clearChatConversation);

    return wrap;
}

// Keep the New Chat pill and its confirm honest about the thread's state: an
// empty thread has nothing to wipe, so the pill goes away entirely, and the
// confirm is never left armed across a repaint. Called wherever chatHistory is
// replaced or appended to, and wherever the chat view could go out of view while
// the confirm is open.
function syncClearChatVisibility() {
    const confirm = sheetQuery('.claudeClearChatConfirm');
    if (confirm) confirm.hidden = true;
    const btn = sheetQuery('#claudeClearChat');
    if (btn) btn.hidden = chatHistory.length === 0;
}

// The mobile spend control — a quiet readout button sitting left of New Chat in
// the chat header row. It opens the shared API-spend panel. It lives inside
// #claudeChatHeader (structurally part of the CHAT view), so it is absent on the
// RUNS and COVERAGE tabs without a per-tab gate, and it sits outside the scroll
// surface so it never scrolls away. A bare `$` glyph rather than an inline
// figure keeps the read to panel-open only (no eager Supabase read on every
// chat-view mount), consistent with the panel's read-on-open contract.
function buildSpendControl() {
    const btn = document.createElement('button');
    btn.id = 'claudeSpendControl';
    btn.type = 'button';
    btn.className = 'claudeSpendControl';
    btn.textContent = '$';
    btn.setAttribute('aria-label', 'Show API spend this month');
    btn.addEventListener('click', function() { openSpendPanel(btn); });
    return btn;
}

// ── API SPEND ──
// Per-million-token prices (USD) for the models the pipeline's API calls use —
// the chat route (Sonnet, or Opus on deep_think) and the refactor-scan route.
// FOUR separate rates per family: a single blended rate would misreport badly
// because the chat route is deliberately cache-heavy, and a cache read is ~1/10
// of an input token while a cache write sits above it. Prices live client-side
// on purpose — usage_events stores exact token counts, so a price change is a
// one-line edit here and historical spend recomputes correctly. Keyed by model
// FAMILY (matched as a substring of the stored model id) so a generation bump —
// `claude-sonnet-4-5-YYYYMMDD`, or `claude-opus-5` now that deep_think calls it
// instead of `claude-opus-4-8` — keeps resolving to its family's rate without a
// table edit, by rule rather than by coincidence.
export const USAGE_RATES = {
    opus:   { input: 15,  output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
    sonnet: { input: 3,   output: 15, cacheWrite: 3.75,  cacheRead: 0.3 },
    haiku:  { input: 0.8, output: 4,  cacheWrite: 1,     cacheRead: 0.08 },
    // Third-party families a run can be pinned to, at the providers' published
    // per-million rates. Neither charges a cache-write premium — their caching is
    // automatic, so a cache-writing token bills at the plain input rate and
    // cacheWrite equals input rather than carrying opus's 1.25x.
    kimi:   { input: 3,   output: 15, cacheWrite: 3,     cacheRead: 0.3 },
    // xAI bills 2x on requests whose prompt reaches 200K tokens; this flat table
    // deliberately does not model that tier, so a long-context grok run
    // under-reports.
    grok:   { input: 2,   output: 6,  cacheWrite: 2,     cacheRead: 0.3 },
    // DeepSeek moved to peak/off-peak billing on 2026-08-16, where off-peak is
    // half of peak; this flat table holds the standard listed rates and
    // deliberately does not model that time-of-day split. The legacy
    // `deepseek-chat`/`deepseek-reasoner` aliases both served v4-flash, so
    // historical usage_events rows recorded under those names price correctly
    // at the generic (flash) rate below.
    deepseekPro: { input: 0.435, output: 0.87, cacheWrite: 0.435, cacheRead: 0.003625 },
    deepseek:    { input: 0.14,  output: 0.28, cacheWrite: 0.14,  cacheRead: 0.0028 },
    // The two GPT rows reached through the Vercel AI Gateway provider, at the
    // rates listed on Vercel's model pages on 2026-08-22 (Vercel mirrors OpenAI
    // list pricing with no markup). Caching is implicit here too, so cacheWrite
    // equals input rather than carrying a write premium.
    gptLuna: { input: 0.2, output: 1.2, cacheWrite: 0.2, cacheRead: 0.02 },
    // gpt-5.6-sol, doubling as the errs-high default for any future gpt-family
    // id. Sol's cached-input rate is inferred from the family's input÷10 pattern
    // (Terra $2→$0.20, Luna $0.2→$0.02) pending an explicit listing —
    // verify cacheRead against Vercel's Sol page.
    gpt:     { input: 2.5, output: 15,  cacheWrite: 2.5, cacheRead: 0.25 },
    // Three more rows reached through the Vercel AI Gateway provider, at the
    // rates on Vercel's provider tables on 2026-08-22 (Vercel mirrors provider
    // list pricing). Implicit caching on all three, so cacheWrite equals input.
    // MiniMax M3 at its standard rate — a launch promo at half these numbers may
    // still be active, in which case this row over-reports. cacheRead is
    // inferred from the family's input/10 pattern pending an explicit listing.
    minimax: { input: 0.6, output: 2.4, cacheWrite: 0.6, cacheRead: 0.06 },
    // GLM-5.2, cacheRead inferred the same way pending an explicit listing.
    glm:     { input: 1.4, output: 4.4, cacheWrite: 1.4, cacheRead: 0.14 },
    // Gemini 3.7 Flash at LIST rates; a 50% promo was active at sourcing
    // ($0.75/$3.75, $0.07 cached), so this row over-reports while that holds.
    // Google also prices long-context requests on higher tiers, which this flat
    // table deliberately does not model — a long-context gemini run
    // under-reports, the same caveat the grok 200K row carries.
    gemini:  { input: 1.5, output: 7.5, cacheWrite: 1.5, cacheRead: 0.15 },
    // OpenCode Go — a flat $10/month subscription with dollar-capped quotas, not
    // per-token billing. Its turns cost the API account nothing, so every lane
    // is zero and a Go row contributes zero to the month by construction.
    opencodeGo: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
};

// True for the OpenCode Go allowlist ids the Worker routes to that subscription.
// A PREFIX test, not a substring one: `algo/…` is not a Go row.
function isOpencodeGoModel(model) {
    return (typeof model === 'string' ? model : '').toLowerCase().indexOf('go/') === 0;
}

// The most expensive known family. An unrecognised model falls back to this so a
// new model OVER-reports rather than silently contributing zero — a figure that
// quietly ignores a model is worse than one that errs high.
const HIGHEST_USAGE_RATE = USAGE_RATES.opus;

function rateForModel(model) {
    const m = (typeof model === 'string' ? model : '').toLowerCase();
    // ORDER MATTERS ABSOLUTELY — this branch MUST stay FIRST, above every
    // substring family below it, with no exceptions. A Go id carries the
    // underlying model's name: `go/kimi-k2.7-code` contains `kimi` and
    // `go/deepseek-v4-flash` contains `deepseek`, so any family branch placed
    // above this one would bill a subscription-covered turn at that family's
    // per-token rate — $3/$15 for the kimi example.
    if (isOpencodeGoModel(m)) return USAGE_RATES.opencodeGo;
    // Every opus generation (`claude-opus-4-8`, `claude-opus-5`, …) prices at the
    // opus family rate — the deep_think path's model id can bump without an edit.
    if (m.indexOf('opus') !== -1) return USAGE_RATES.opus;
    if (m.indexOf('sonnet') !== -1) return USAGE_RATES.sonnet;
    if (m.indexOf('haiku') !== -1) return USAGE_RATES.haiku;
    // Third-party families, matched the same way — `kimi-k3`, `grok-4-fast`, and
    // whatever generation follows each keep resolving without a table edit.
    if (m.indexOf('kimi') !== -1) return USAGE_RATES.kimi;
    if (m.indexOf('grok') !== -1) return USAGE_RATES.grok;
    // ORDER MATTERS: the generic `deepseek` substring also matches the pro id,
    // so the pro branch MUST stay above it — swapped, Pro silently prices at
    // Flash rates.
    if (m.indexOf('deepseek-v4-pro') !== -1) return USAGE_RATES.deepseekPro;
    if (m.indexOf('deepseek') !== -1) return USAGE_RATES.deepseek;
    // No ordering hazard on these three — none of their substrings appears in
    // another family's ids, so each stands alone wherever it sits.
    if (m.indexOf('minimax') !== -1) return USAGE_RATES.minimax;
    if (m.indexOf('glm') !== -1) return USAGE_RATES.glm;
    if (m.indexOf('gemini') !== -1) return USAGE_RATES.gemini;
    // ORDER MATTERS here too: the generic `gpt` substring matches every gpt id,
    // Luna's included, so the luna branch MUST stay above it — swapped, Luna
    // silently prices at Sol rates.
    if (m.indexOf('gpt-5.6-luna') !== -1) return USAGE_RATES.gptLuna;
    if (m.indexOf('gpt') !== -1) return USAGE_RATES.gpt;
    return HIGHEST_USAGE_RATE;
}

// Display precision for one dollar figure. Two decimals is right for everything
// the panel normally shows, but a real-but-tiny spend — a deepseek-v4-flash turn
// at $0.14/M, a kimi cache-hit one — rounds to `$0.00` there and reads as no
// spend at all. Anything under a cent therefore falls back to four decimals, so
// a small number looks small rather than looking like zero. A genuine zero (and
// a non-numeric figure) still reads `$0.00`.
export function formatUsd(cost) {
    const n = typeof cost === 'number' && isFinite(cost) ? cost : 0;
    if (n > 0 && n < 0.01) return '$' + n.toFixed(4);
    return '$' + n.toFixed(2);
}

function usageTokenCount(value) {
    const n = typeof value === 'number' ? value : parseFloat(value);
    return (isFinite(n) && n > 0) ? n : 0;
}

// Dollar cost of a single usage_events row. Tolerant of the exact column names
// the Worker writes: input/output are read directly; cache reads and writes each
// accept a couple of plausible aliases, so a column-name difference degrades to
// "counted as zero for that lane" rather than a crash.
export function priceForUsageEvent(row) {
    if (!row) return 0;
    const rate = rateForModel(row.model);
    const input = usageTokenCount(row.input_tokens);
    const output = usageTokenCount(row.output_tokens);
    const cacheRead = usageTokenCount(
        row.cache_read_input_tokens != null ? row.cache_read_input_tokens : row.cache_read_tokens);
    const cacheWrite = usageTokenCount(
        row.cache_creation_input_tokens != null ? row.cache_creation_input_tokens : row.cache_write_tokens);
    return (input * rate.input
        + output * rate.output
        + cacheRead * rate.cacheRead
        + cacheWrite * rate.cacheWrite) / 1e6;
}

// Total dollar spend across a set of usage_events rows.
export function sumUsageCost(rows) {
    if (!Array.isArray(rows)) return 0;
    let total = 0;
    for (let i = 0; i < rows.length; i++) total += priceForUsageEvent(rows[i]);
    return total;
}

// The provider buckets the month's spend is split across, in the fixed order
// they render. Matched as SUBSTRINGS of the stored model id, the same rule
// rateForModel prices by, so a generation bump lands in its provider without a
// table edit. `claude` is listed alongside the three Anthropic families so a
// bare `claude-…` id (or the ghost's) still reads as Anthropic rather than
// falling to `other`.
const USAGE_PROVIDERS = [
    { key: 'anthropic', label: 'Anthropic', match: ['opus', 'sonnet', 'haiku', 'claude'] },
    { key: 'kimi', label: 'Kimi', match: ['kimi'] },
    { key: 'grok', label: 'Grok', match: ['grok'] },
    // Terminal catch-all: an unrecognised model prices at the opus fallback, so
    // its spend is real and must land somewhere visible rather than vanish.
    { key: 'other', label: 'Other', match: [] },
];

function providerKeyForModel(model) {
    const m = (typeof model === 'string' ? model : '').toLowerCase();
    for (let i = 0; i < USAGE_PROVIDERS.length; i++) {
        const p = USAGE_PROVIDERS[i];
        for (let j = 0; j < p.match.length; j++) {
            if (m.indexOf(p.match[j]) !== -1) return p.key;
        }
    }
    return 'other';
}

// Split a set of usage_events rows into per-provider dollar totals, priced with
// the same priceForUsageEvent the blended figure uses — so the buckets always
// sum to the headline total rather than to a separately-derived number.
// OpenCode Go rows are dropped before bucketing: they price at zero, so keeping
// them would only file a $0.00 subscription turn under the underlying model's
// provider (`go/kimi-k3` matches `kimi`) and imply per-token spend there.
// Dropping them cannot move the headline total, which already counts them as
// zero. Returns
// every bucket in the fixed USAGE_PROVIDERS order, zero-cost ones included: the
// order is stable for the caller to render against, and the render (not this
// helper) is what drops empty buckets.
export function providerSpendBreakdown(rows) {
    const totals = {};
    for (let i = 0; i < USAGE_PROVIDERS.length; i++) totals[USAGE_PROVIDERS[i].key] = 0;
    if (Array.isArray(rows)) {
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row) continue;
            if (isOpencodeGoModel(row.model)) continue;
            totals[providerKeyForModel(row.model)] += priceForUsageEvent(row);
        }
    }
    return USAGE_PROVIDERS.map(function(p) {
        return { key: p.key, label: p.label, cost: totals[p.key] };
    });
}

// Render the provider split — a segmented bar over a legend — into `container`,
// replacing its contents. Sits between the readout and the daily chart, and is
// filled from the same place the chart is (where the resolved rows are in
// scope), so a budget edit re-rendering the readout leaves it untouched. A month
// with no cost renders nothing at all, mirroring how the ratios section stays
// away rather than drawing an empty bar.
function renderProviderSplit(container, rows) {
    if (!container) return;
    container.innerHTML = '';
    const buckets = providerSpendBreakdown(rows).filter(function(b) { return b.cost > 0; });
    let total = 0;
    for (let i = 0; i < buckets.length; i++) total += buckets[i].cost;
    if (total <= 0) return;

    const bar = document.createElement('div');
    bar.className = 'usageSpendProviderBar';
    const legend = document.createElement('div');
    legend.className = 'usageSpendProviderLegend';

    for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        // Widths are computed from the split, so they stay inline; the colour is
        // the bucket's own class so both themes resolve it from one place.
        const seg = document.createElement('div');
        seg.className = 'usageSpendProviderSeg usageSpendProviderSeg--' + b.key;
        seg.style.width = ((b.cost / total) * 100).toFixed(2) + '%';
        bar.appendChild(seg);

        const item = document.createElement('div');
        item.className = 'usageSpendProviderLegendItem';
        const dot = document.createElement('span');
        dot.className = 'usageSpendProviderDot usageSpendProviderDot--' + b.key;
        const text = document.createElement('span');
        text.className = 'usageSpendProviderLegendText';
        text.textContent = b.label + ' ' + formatUsd(b.cost);
        item.appendChild(dot);
        item.appendChild(text);
        legend.appendChild(item);
    }

    container.appendChild(bar);
    container.appendChild(legend);
}

const USAGE_MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Group this month's usage rows into a per-day cost series — one slot per day of
// the WHOLE calendar month (the 1st through the month's last day, 28–31), so the
// axis is fixed regardless of how much data exists yet: a sparse early month reads
// as sparse and the chart does not reflow as days accumulate. A day with no usage
// (including days later in the month than today) renders as an empty slot rather
// than being omitted, so gaps stay visible. Grouped by LOCAL date: a UTC grouping
// would shift several hours of every evening's usage into the next day's bar,
// exactly the quiet wrongness that makes a chart worse than none. `now` defaults to
// the current time; passing a fixed Date makes the series deterministic under test.
// The summed cost across the series equals sumUsageCost(rows) for rows in the month.
export function dailyUsageSeries(rows, now) {
    const ref = now instanceof Date ? now : new Date();
    const year = ref.getFullYear();
    const month = ref.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate(); // days in this month
    const costByDay = {};
    if (Array.isArray(rows)) {
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || !row.created_at) continue;
            const d = new Date(row.created_at);
            if (isNaN(d.getTime())) continue;
            if (d.getFullYear() !== year || d.getMonth() !== month) continue;
            const day = d.getDate();
            costByDay[day] = (costByDay[day] || 0) + priceForUsageEvent(row);
        }
    }
    const series = [];
    for (let day = 1; day <= lastDay; day++) {
        const mm = ('0' + (month + 1)).slice(-2);
        const dd = ('0' + day).slice(-2);
        series.push({
            day: day,
            date: year + '-' + mm + '-' + dd,
            label: USAGE_MONTH_SHORT[month] + ' ' + day,
            cost: costByDay[day] || 0,
        });
    }
    return series;
}

// Fraction of this month's COST attributable to deep_think turns, not a fraction
// of turn count — one heavy turn outweighs a dozen light ones, so a turn-count
// share would understate it badly. Returns null when there is no cost to divide,
// so the caller can omit the figure rather than show a misleading 0%.
//
// Deliberately model-agnostic: the `deep_think` flag records the MODE a turn was
// sent in, and deep-think is a pickable surface now, so the share stays right
// whatever model the workspace points DEEP at.
export function computeDeepShare(rows) {
    if (!Array.isArray(rows)) return null;
    let total = 0;
    let deep = 0;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const cost = priceForUsageEvent(row);
        total += cost;
        if (row.deep_think) deep += cost;
    }
    if (total <= 0) return null;
    return deep / total;
}

// Cache hit rate across the month: cache_read ÷ (input + cache_read), a TOKEN
// ratio (not a cost ratio) because it measures whether the chat route's prompt
// cache is being hit, not what it saved. Returns null when there are no input or
// cache-read tokens to divide.
export function computeCacheHitRate(rows) {
    if (!Array.isArray(rows)) return null;
    let input = 0;
    let cacheRead = 0;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        input += usageTokenCount(row.input_tokens);
        cacheRead += usageTokenCount(
            row.cache_read_input_tokens != null ? row.cache_read_input_tokens : row.cache_read_tokens);
    }
    const denom = input + cacheRead;
    if (denom <= 0) return null;
    return cacheRead / denom;
}

// Render the two derived figures — deep share and cache hit rate — beneath the
// chart (or the not-enough-history note), plus the caveat that pre-instrumentation
// rows read as fast, uncached turns. Renders nothing when neither figure is
// computable (an empty month), so the panel stays clean with no data.
function renderSpendRatios(container, rows) {
    const deep = computeDeepShare(rows);
    const cache = computeCacheHitRate(rows);
    if (deep == null && cache == null) return;

    const grid = document.createElement('div');
    grid.className = 'usageSpendRatios';

    function addRatio(labelText, value, subText) {
        const cell = document.createElement('div');
        cell.className = 'usageSpendRatio';
        const val = document.createElement('div');
        val.className = 'usageSpendRatioValue';
        val.textContent = value == null ? '—' : Math.round(value * 100) + '%';
        const lab = document.createElement('div');
        lab.className = 'usageSpendRatioLabel';
        lab.textContent = labelText;
        const sub = document.createElement('div');
        sub.className = 'usageSpendRatioSub';
        sub.textContent = subText;
        cell.appendChild(val);
        cell.appendChild(lab);
        cell.appendChild(sub);
        grid.appendChild(cell);
    }

    addRatio('Deep share', deep, 'of cost on deep-think turns');
    addRatio('Cache hit rate', cache, 'cache reads ÷ input tokens');
    container.appendChild(grid);

    const caveat = document.createElement('p');
    caveat.className = 'usageSpendRatiosCaveat';
    caveat.textContent = 'Rows recorded before usage tagging count as fast, '
        + 'uncached turns, so both figures can read low until this month is fully tagged.';
    container.appendChild(caveat);
}

// Render the daily bar chart plus the two derived ratios into `container`,
// replacing its contents. The chart is hand-rolled inline SVG — one slot per day of
// the whole calendar month — rather than a charting dependency, which would be the
// project's largest for what a rect loop covers. The axis is fixed at the month's
// day count, so it renders correctly with a single day of data (no history guard):
// bars rise from a shared baseline scaled to the month's peak, empty and future days
// are blank slots, a faint gridline marks every seventh day, and each slot carries a
// full-height transparent hit area (a 6px bar is too small to tap) whose hover/tap
// updates a per-day tooltip. A single static caption names the month's peak day; a
// zero-usage month shows no caption. The ratios render beneath whenever computable.
// `now` defaults to the current time; a fixed Date makes the output deterministic.
export function renderSpendChart(container, rows, now) {
    if (!container) return;
    container.innerHTML = '';

    const series = dailyUsageSeries(rows, now);

    const heading = document.createElement('div');
    heading.className = 'usageSpendChartHeading';
    heading.textContent = 'Daily spend';
    container.appendChild(heading);

    const NS = 'http://www.w3.org/2000/svg';
    const VB_W = 300;
    const VB_H = 100;
    const TOP = 10;          // headroom above the tallest bar
    const BASELINE = 84;     // y of the shared baseline every bar rises from
    const plotH = BASELINE - TOP;
    const n = series.length;
    const slot = VB_W / n;
    // Keep every day as its own slot; shrink the gap before ever dropping a bar, and
    // never aggregate into weeks — the point is the session-shaped spikes.
    const gap = Math.min(2, slot * 0.25);
    const barW = Math.max(1, slot - gap);
    let maxCost = 0;
    let maxIdx = 0;
    for (let i = 0; i < n; i++) {
        if (series[i].cost > maxCost) { maxCost = series[i].cost; maxIdx = i; }
    }

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + VB_W + ' ' + VB_H);
    svg.setAttribute('class', 'usageSpendChartSvg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Daily API spend for the current month');

    // Faint gridline every seven days from the 1st — orientation, not data.
    for (let i = 0; i < n; i += 7) {
        const gx = i * slot;
        const grid = document.createElementNS(NS, 'line');
        grid.setAttribute('x1', gx.toFixed(2));
        grid.setAttribute('x2', gx.toFixed(2));
        grid.setAttribute('y1', String(TOP));
        grid.setAttribute('y2', String(BASELINE));
        grid.setAttribute('class', 'usageSpendChartWeek');
        svg.appendChild(grid);
    }

    const axis = document.createElementNS(NS, 'line');
    axis.setAttribute('x1', '0');
    axis.setAttribute('x2', String(VB_W));
    axis.setAttribute('y1', String(BASELINE));
    axis.setAttribute('y2', String(BASELINE));
    axis.setAttribute('class', 'usageSpendChartAxis');
    svg.appendChild(axis);

    const tip = document.createElement('div');
    tip.className = 'usageSpendChartTip';
    function showTip(s) {
        tip.textContent = s.label + ' · ' + formatUsd(s.cost);
    }

    for (let i = 0; i < n; i++) {
        const s = series[i];
        // Bars rise from the shared baseline, scaled to the month's peak. A day with
        // no usage draws no bar but still reserves its slot (and its hit area below).
        if (s.cost > 0) {
            const x = i * slot + (slot - barW) / 2;
            const h = maxCost > 0 ? (s.cost / maxCost) * plotH : 0;
            const rect = document.createElementNS(NS, 'rect');
            rect.setAttribute('x', x.toFixed(2));
            rect.setAttribute('y', (BASELINE - h).toFixed(2));
            rect.setAttribute('width', barW.toFixed(2));
            rect.setAttribute('height', Math.max(0, h).toFixed(2));
            rect.setAttribute('class', 'usageSpendChartBar');
            rect.setAttribute('data-date', s.date);
            svg.appendChild(rect);
        }
        // Full-height transparent hit area per slot, so a low-value or empty day is
        // hoverable/tappable rather than an untappable 6px sliver.
        const hit = document.createElementNS(NS, 'rect');
        hit.setAttribute('x', (i * slot).toFixed(2));
        hit.setAttribute('y', String(TOP));
        hit.setAttribute('width', slot.toFixed(2));
        hit.setAttribute('height', String(BASELINE - TOP));
        hit.setAttribute('class', 'usageSpendChartHit');
        hit.setAttribute('data-date', s.date);
        hit.setAttribute('tabindex', '0');
        const title = document.createElementNS(NS, 'title');
        title.textContent = s.label + ': ' + formatUsd(s.cost);
        hit.appendChild(title);
        hit.addEventListener('mouseenter', function() { showTip(s); });
        hit.addEventListener('click', function() { showTip(s); });
        hit.addEventListener('focus', function() { showTip(s); });
        svg.appendChild(hit);
    }

    container.appendChild(svg);
    container.appendChild(tip);

    // Single static caption naming the month's peak day; omitted for a zero month.
    if (maxCost > 0) {
        const caption = document.createElement('div');
        caption.className = 'usageSpendChartCaption';
        caption.textContent = 'Peak $' + maxCost.toFixed(2) + ' on ' + series[maxIdx].label;
        container.appendChild(caption);
    }

    renderSpendRatios(container, rows);
}

// Render the spend readout — the dollar figure, the budget bar (only when a
// positive budget is set), the percentage, and the always-present honesty line —
// into `container`, replacing its contents. Split out from openSpendPanel so it
// can be re-rendered when the usage read resolves or the budget changes, and so
// the "zero/unset budget renders without a bar" contract is unit-testable.
export function renderSpendReadout(container, totalCost, budget) {
    if (!container) return;
    container.innerHTML = '';
    const total = Number(totalCost) || 0;

    const amount = document.createElement('div');
    amount.className = 'usageSpendAmount';
    amount.textContent = '$' + total.toFixed(2);
    container.appendChild(amount);

    const hasBudget = typeof budget === 'number' && isFinite(budget) && budget > 0;
    if (hasBudget) {
        const pct = (total / budget) * 100;
        const track = document.createElement('div');
        track.className = 'usageSpendBar';
        if (pct > 100) track.classList.add('usageSpendBar--over');
        const fill = document.createElement('div');
        fill.className = 'usageSpendBarFill';
        fill.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
        track.appendChild(fill);
        container.appendChild(track);

        const pctLabel = document.createElement('div');
        pctLabel.className = 'usageSpendPct';
        pctLabel.textContent = Math.round(pct) + '% of $' + budget.toFixed(2) + ' monthly budget';
        container.appendChild(pctLabel);
    }

    const note = document.createElement('p');
    note.className = 'usageSpendNote';
    note.textContent = 'Tracks all API-billed usage — chat, scans, the ghost, and '
        + 'third-party pipeline runs (run · triage · derive through the '
        + "gateway). Plan-lane runs bill the Max plan and aren't measured here.";
    container.appendChild(note);

    // The third lane, dimmer than the note above it: OpenCode Go turns price at
    // zero on purpose, so without this line their absence from the figure reads
    // as a gap rather than as coverage.
    const goNote = document.createElement('p');
    goNote.className = 'usageSpendGoNote';
    goNote.textContent = 'OpenCode Go turns are subscription-covered and not counted here.';
    container.appendChild(goNote);
}

// The readout's in-flight state, shown from panel open until the month's usage
// read resolves. A centered spinner over a muted label replaces the old
// immediate $0.00, so a slow read never flashes a misleading zero. Reuses the
// shared .projRunSpinner glyph and `spin` keyframes (sized up via
// .usageSpendSpinner).
function renderSpendLoading(container) {
    if (!container) return;
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'usageSpendLoading';
    const spinner = document.createElement('div');
    spinner.className = 'projRunSpinner usageSpendSpinner';
    const label = document.createElement('div');
    label.className = 'usageSpendLoadingLabel';
    label.textContent = 'Loading usage…';
    wrap.appendChild(spinner);
    wrap.appendChild(label);
    container.appendChild(wrap);
}

// The readout's terminal error state: shown when the usage read fails or comes
// back with nothing usable, in place of the spinner. Prevents the panel from
// silently settling on a $0.00 that reads as a real (and cheap) month when it
// really means the read didn't land.
function renderSpendError(container, message) {
    if (!container) return;
    container.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'usageSpendError';
    err.textContent = message || 'Couldn’t load usage';
    container.appendChild(err);
}

// Build and open the shared API-spend panel — one panel, opened from both the
// desktop nav control and the mobile chat-header control. Reads usage on open
// only (no subscribe/poll — spend moves slowly and a stale figure between opens
// is fine), shows a loading spinner immediately, then fills once the read
// resolves. A failed or empty read shows an inline error rather than settling on
// a misleading $0.00. Dismisses three ways via wireModalDismiss (close control,
// backdrop, Escape) and restores focus to whatever opened it.
export function openSpendPanel(anchorEl) {
    const prior = document.getElementById('usageSpendBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'usageSpendBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'usageSpendModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'usageSpendTitleText');

    const header = document.createElement('div');
    header.id = 'usageSpendHeader';

    const title = document.createElement('div');
    title.id = 'usageSpendTitle';
    const eyebrow = document.createElement('span');
    eyebrow.id = 'usageSpendEyebrow';
    eyebrow.textContent = 'API SPEND';
    const titleText = document.createElement('span');
    titleText.id = 'usageSpendTitleText';
    titleText.textContent = 'This month';
    title.appendChild(eyebrow);
    title.appendChild(titleText);

    const closeX = document.createElement('button');
    closeX.id = 'usageSpendClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close API spend');
    closeX.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeX);

    const readout = document.createElement('div');
    readout.id = 'usageSpendReadout';

    // The per-provider split, filled once the usage read resolves. Its own
    // container between the readout and the chart for the same reason the chart
    // has one: a budget edit re-renders only the readout, so the split survives.
    const providersContainer = document.createElement('div');
    providersContainer.id = 'usageSpendProviders';

    // The daily chart + derived ratios, filled once the usage read resolves. Kept
    // separate from the readout so a budget edit re-renders the readout without
    // wiping the chart, and so it can scroll with the readout inside the body.
    const chartContainer = document.createElement('div');
    chartContainer.id = 'usageSpendChart';

    // The budget editor — makes the bar's budget genuinely configurable. Editing
    // it persists to prefs and re-renders the readout in place against the last
    // resolved total.
    let lastTotal = 0;
    const budgetRow = document.createElement('div');
    budgetRow.id = 'usageSpendBudgetRow';
    const budgetLabel = document.createElement('label');
    budgetLabel.id = 'usageSpendBudgetLabel';
    budgetLabel.setAttribute('for', 'usageSpendBudgetInput');
    budgetLabel.textContent = 'Monthly budget $';
    const budgetInput = document.createElement('input');
    budgetInput.id = 'usageSpendBudgetInput';
    budgetInput.type = 'number';
    budgetInput.min = '0';
    budgetInput.step = '1';
    budgetInput.value = String(getUsageBudget());
    budgetInput.addEventListener('change', function() {
        setUsageBudget(budgetInput.value);
        renderSpendReadout(readout, lastTotal, getUsageBudget());
    });
    budgetRow.appendChild(budgetLabel);
    budgetRow.appendChild(budgetInput);

    // Header and budget editor stay pinned; the readout + chart scroll between
    // them so the added chart never pushes the budget editor past the 86vh cap.
    const body = document.createElement('div');
    body.id = 'usageSpendBody';
    body.appendChild(readout);
    body.appendChild(providersContainer);
    body.appendChild(chartContainer);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(budgetRow);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // Immediate loading state so a slow read never flashes a misleading $0.00;
    // the resolve handler below swaps in the real figure or an inline error.
    renderSpendLoading(readout);

    const previouslyFocused = anchorEl || document.activeElement;
    closeX.focus();

    wireModalDismiss({
        backdrop: backdrop,
        closeButtons: [closeX],
        onClose: function() {
            if (previouslyFocused
                && typeof previouslyFocused.focus === 'function'
                && document.contains(previouslyFocused)) {
                try { previouslyFocused.focus(); } catch (e) { /* defensive */ }
            }
        },
    });

    // Read on open only. Fill once resolved; a failed or empty read swaps the
    // spinner for an inline error rather than settling on a misleading $0.00.
    if (typeof listLogic.loadMonthlyUsage === 'function') {
        Promise.resolve(listLogic.loadMonthlyUsage()).then(function(res) {
            if (!document.body.contains(backdrop)) return; // dismissed before it landed
            if (res && res.ok && Array.isArray(res.rows) && res.rows.length > 0) {
                lastTotal = sumUsageCost(res.rows);
                renderSpendReadout(readout, lastTotal, getUsageBudget());
                renderProviderSplit(providersContainer, res.rows);
                renderSpendChart(chartContainer, res.rows, new Date());
            } else {
                renderSpendError(readout);
            }
        }, function() {
            if (!document.body.contains(backdrop)) return; // dismissed before it landed
            renderSpendError(readout);
        });
    } else {
        // No read available at all — surface the error rather than a stuck spinner.
        renderSpendError(readout);
    }
}

// Wipe the current conversation — the in-memory message array, its persisted
// per-repo copy, and every rendered bubble — without touching the attached file
// chips or the active workspace. The iterate entry id is now stored state that
// rides every turn of an active iterate session, so a fresh chat must clear it
// too (in memory and persisted) or follow-ups would keep pulling the prior
// session's diff; a later iterate from a shipped run still seeds fresh.
function clearChatConversation() {
    chatHistory = [];
    deleteChatHistory(activeChatRepo);
    // The stored turns go with the local copy — a wipe that left them behind
    // would be undone by the next hydrate.
    clearRemoteChatTurns(activeChatRepo);
    activeIterateEntry = null;
    deleteIterateEntry(activeChatRepo);
    // "New Chat" clears the task scope along with the transcript, in the same
    // place the thread is wiped so the two reset paths can't drift apart.
    activeChatTask = null;
    deleteChatTask(activeChatRepo);
    // A fresh chat is no longer the hand-off session, so a subsequent ship must
    // not settle the row the wiped conversation was handed off from.
    activeHandoffRow = null;
    const surface = sheetQuery('#claudeChatSurface');
    if (surface) surface.innerHTML = '';
    // The thread is empty again, so re-surface the capabilities intro note.
    renderChatIntro();
    // The scope returns to unscoped in lockstep with the wipe.
    renderScopeChip();
    // The confirm that armed this wipe is dismissed here, and the now-empty
    // thread retires the pill until there's something to wipe again.
    syncClearChatVisibility();
}

// The composer file-picker button + its dropdown panel. The button leads the
// composer row (before the mic, textarea, and Send); the panel anchors directly
// above the button (the composer lives at the bottom of the sheet) and overlays
// the chat surface rather than displacing it, so tapping it drops the picker
// open right where it lives.
// Clip glyph — a simplified single-stroke paperclip stroked with currentColor
// and fill:none, mirroring the image button's IMAGE_SVG and voiceInput's
// MIC_SVG. An inline SVG (rather than the 📎 emoji, which paints in its own
// fixed colors) lets the button's void-theme color variable tint the glyph at
// rest and the purple accent on hover, so the attach control reads identically
// to the mic and image controls.
const CLIP_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M17 6v10a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10a1 1 0 0 1-2 0V7">' +
    '</path></svg>';

function buildAttach() {
    const wrap = document.createElement('div');
    wrap.className = 'claudeAttach';

    // File-picker button — the leading composer control, before the mic, input,
    // and Send. It toggles the attach panel that opens above it; setActiveTab
    // hides it on the Runs tab since attachments are chat-only.
    const attach = document.createElement('button');
    attach.id = 'claudeComposerAttach';
    attach.type = 'button';
    attach.className = 'claudeComposerAttach';
    attach.innerHTML = CLIP_SVG;
    attach.setAttribute('aria-label', 'Attach files');
    attach.setAttribute('aria-haspopup', 'menu');
    attach.setAttribute('aria-expanded', 'false');
    attach.addEventListener('click', function() { toggleAttachPanel(); });

    // File-picker panel — drops down below the button when tapped. Shows either
    // a manifest-driven file list (repos with a published manifest) or a
    // free-text path input (repos without one), for whichever workspace is
    // active. The repo itself is chosen at the chat level via the workspace
    // pill, not here.
    const panel = document.createElement('div');
    panel.id = 'claudeAttachPanel';
    panel.className = 'claudeAttachPanel';
    panel.setAttribute('role', 'menu');
    panel.hidden = true;
    // Keep clicks inside the panel from reaching the document-level outside-click
    // handler — selecting a file rebuilds the list, detaching the clicked row,
    // which would otherwise read as a click "outside" and close the panel
    // prematurely (mirrors the workspace menu's guard).
    panel.addEventListener('click', function(event) { event.stopPropagation(); });

    // Manifest-driven browse mode (repos with a published manifest): filter +
    // scrollable list.
    const search = document.createElement('input');
    search.id = 'claudeAttachSearch';
    search.className = 'claudeAttachSearch';
    search.type = 'text';
    search.setAttribute('placeholder', 'Filter files…');
    const fileList = document.createElement('div');
    fileList.id = 'claudeAttachList';
    fileList.className = 'claudeAttachList';
    search.addEventListener('input', function() { renderAttachList(search.value); });
    panel.appendChild(search);
    panel.appendChild(fileList);

    // Free-text mode (repos with no published manifest): type a repo-relative
    // path and tap Add to attach it as a chip.
    const pathRow = document.createElement('div');
    pathRow.id = 'claudeAttachPathRow';
    pathRow.className = 'claudeAttachPathRow';
    pathRow.hidden = true;
    const pathInput = document.createElement('input');
    pathInput.id = 'claudeAttachPathInput';
    pathInput.className = 'claudeAttachPathInput';
    pathInput.type = 'text';
    pathInput.setAttribute('placeholder', 'Enter file path, e.g. src/MainSection.jsx');
    const pathAdd = document.createElement('button');
    pathAdd.id = 'claudeAttachPathAdd';
    pathAdd.type = 'button';
    pathAdd.className = 'claudeAttachPathAdd';
    pathAdd.textContent = 'Add';
    pathAdd.addEventListener('click', function() { addFreeTextAttachment(); });
    pathInput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            addFreeTextAttachment();
        }
    });
    pathRow.appendChild(pathInput);
    pathRow.appendChild(pathAdd);
    panel.appendChild(pathRow);

    // Inline notice for cross-repo attempts; hidden until one occurs.
    const notice = document.createElement('p');
    notice.id = 'claudeAttachNotice';
    notice.className = 'claudeAttachNotice';
    notice.hidden = true;
    panel.appendChild(notice);

    wrap.appendChild(attach);
    wrap.appendChild(panel);
    return wrap;
}

// ── IMAGE ATTACHMENTS ──
// A dedicated image button, distinct from the 📎 repo-file picker: it opens a
// hidden <input type="file" accept="image/*" multiple> and the picked images are
// read, downscaled, and staged as thumbnails in a rail above the composer, then
// attached to the next user turn as a per-message `images` field. Everything here
// is session-scoped and vanilla (FileReader + Canvas, no new deps).

// Image glyph — a framed-picture icon (frame, sun, mountain) stroked with
// currentColor and fill:none, mirroring voiceInput's MIC_SVG. Using an inline
// SVG rather than the 🖼️ emoji lets the button's void-theme color variables and
// its purple hover color actually paint the glyph (an emoji renders in its own
// fixed colors), so the image control reads identically to the mic.
const IMAGE_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"></rect>' +
    '<circle cx="8.5" cy="8.5" r="1.5"></circle>' +
    '<path d="M21 15l-5-5L5 21"></path></svg>';

// The image button + its hidden file input, sitting between the 📎 and the mic
// in the composer row. The wrapper is a bare flex item (mirrors .claudeAttach)
// so the button aligns with the other 36×36 composer controls.
function buildImageAttach() {
    const wrap = document.createElement('div');
    wrap.className = 'claudeImageAttach';

    const btn = document.createElement('button');
    btn.id = 'claudeComposerImage';
    btn.type = 'button';
    btn.className = 'claudeComposerImage';
    btn.innerHTML = IMAGE_SVG;
    btn.setAttribute('aria-label', 'Attach images');

    const fileInput = document.createElement('input');
    fileInput.id = 'claudeImageInput';
    fileInput.className = 'claudeImageInput';
    fileInput.type = 'file';
    fileInput.setAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif');
    fileInput.multiple = true;
    fileInput.hidden = true;

    btn.addEventListener('click', function() {
        // Reset the value first so re-picking the same file still fires `change`.
        try { fileInput.value = ''; } catch (e) { /* defensive */ }
        fileInput.click();
    });
    fileInput.addEventListener('change', function() {
        // Staging is async (FileReader + optional downscale per file). Expose the
        // in-flight promise on the input so callers can await the work settling —
        // the `change` event itself resolves before any tile renders.
        fileInput.imagePickPromise = handleImagePick(fileInput.files);
    });

    wrap.appendChild(btn);
    wrap.appendChild(fileInput);
    return wrap;
}

// Read a File to a `data:` URL via FileReader, resolving the URL string.
function readFileAsDataURL(file) {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onload = function() { resolve(String(reader.result || '')); };
        reader.onerror = function() { reject(reader.error || new Error('read failed')); };
        try { reader.readAsDataURL(file); } catch (e) { reject(e); }
    });
}

// Split a base64 `data:` URL into { media_type, data }, or null if it isn't one.
function parseImageDataUrl(url) {
    const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(String(url || ''));
    if (!m) return null;
    return { media_type: m[1], data: m[2] };
}

// Approximate decoded byte length of a base64 string (used to compare against
// the 5MB cap without decoding).
function base64ByteLength(b64) {
    const s = String(b64 || '');
    if (!s) return 0;
    let padding = 0;
    if (s.charAt(s.length - 1) === '=') padding = s.charAt(s.length - 2) === '=' ? 2 : 1;
    return Math.floor(s.length * 3 / 4) - padding;
}

// Downscale + re-encode an image so its base64 payload lands under the 5MB cap.
// Loads the source into an <img>, draws it into a <canvas> at a reduced size, and
// re-encodes as JPEG (much smaller than PNG for photos/screenshots, which are
// the only things that exceed 5MB), shrinking further across a bounded set of
// attempts until under budget. Resolves { media_type, data } or null when the
// canvas isn't usable (e.g. no 2d context) so the caller can fall back to the
// original bytes; the Worker enforces the same cap as a backstop.
function downscaleImage(dataUrl) {
    return new Promise(function(resolve) {
        let img;
        try { img = new Image(); } catch (e) { resolve(null); return; }
        img.onload = function() {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext && canvas.getContext('2d');
                const width = img.naturalWidth || img.width;
                const height = img.naturalHeight || img.height;
                if (!ctx || !width || !height) { resolve(null); return; }
                let scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(width, height));
                let quality = 0.85;
                for (let attempt = 0; attempt < 6; attempt++) {
                    const w = Math.max(1, Math.round(width * scale));
                    const h = Math.max(1, Math.round(height * scale));
                    canvas.width = w;
                    canvas.height = h;
                    ctx.clearRect(0, 0, w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    const out = canvas.toDataURL('image/jpeg', quality);
                    const parsed = parseImageDataUrl(out);
                    if (parsed && base64ByteLength(parsed.data) <= IMAGE_MAX_BYTES) {
                        resolve(parsed);
                        return;
                    }
                    scale *= 0.75;
                    quality = Math.max(0.5, quality - 0.1);
                }
                resolve(null);
            } catch (e) { resolve(null); }
        };
        img.onerror = function() { resolve(null); };
        img.src = dataUrl;
    });
}

// Read one picked File into a staged image { media_type, data }. Images already
// under the cap keep their original bytes (preserves animated GIFs and avoids a
// needless re-encode); oversized ones are downscaled, falling back to the raw
// bytes if the canvas path can't run. Returns null for an unreadable/unparsable
// file.
async function prepareImage(file) {
    const dataUrl = await readFileAsDataURL(file);
    const parsed = parseImageDataUrl(dataUrl);
    if (!parsed) return null;
    if (base64ByteLength(parsed.data) <= IMAGE_MAX_BYTES) return parsed;
    const shrunk = await downscaleImage(dataUrl);
    return shrunk || parsed;
}

// Handle a batch of picked files: filter to the allowed still-image types, prep
// each (read + downscale), and stage it — capped at IMAGE_MAX_COUNT total. Any
// single file that fails to read is skipped without aborting the batch.
async function handleImagePick(fileList) {
    const files = fileList ? Array.prototype.slice.call(fileList) : [];
    for (let i = 0; i < files.length; i++) {
        if (pendingImages.length >= IMAGE_MAX_COUNT) break;
        const file = files[i];
        if (!file || IMAGE_ALLOWED_TYPES.indexOf(file.type) === -1) continue;
        try {
            const image = await prepareImage(file);
            if (image && pendingImages.length < IMAGE_MAX_COUNT) {
                pendingImages.push(image);
                renderPendingImages();
            }
        } catch (e) { /* skip an unreadable image */ }
    }
}

// Repaint the pending-image rail above the composer from `pendingImages`: one
// ~48px thumbnail tile per staged image, each with a corner × to remove it. An
// empty rail collapses via CSS (:empty), so nothing extra is needed to hide it.
function renderPendingImages() {
    const rail = sheetQuery('#claudeImageRail');
    if (!rail) return;
    rail.innerHTML = '';
    pendingImages.forEach(function(image, index) {
        const tile = document.createElement('div');
        tile.className = 'claudeImageTile';
        const thumb = document.createElement('img');
        thumb.className = 'claudeImageTileThumb';
        thumb.src = imageDataUrl(image);
        thumb.alt = 'Pending image';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'claudeImageTileRemove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Remove image');
        remove.addEventListener('click', function() {
            pendingImages.splice(index, 1);
            renderPendingImages();
        });
        tile.appendChild(thumb);
        tile.appendChild(remove);
        rail.appendChild(tile);
    });
}

// ── SEND MODE (split button: persistent Fast/Deep default) ──
// Hydrate chatMode from localStorage, tolerating a missing/garbage value by
// falling back to 'fast'. Called on mount so a reload resumes the saved default.
function loadChatMode() {
    let stored = null;
    try { stored = localStorage.getItem(CHAT_MODE_KEY); } catch (e) { /* private mode */ }
    chatMode = stored === 'deep' ? 'deep' : 'fast';
    return chatMode;
}

// Set the persistent default and re-render the split button + menu so the label,
// accent, and ★ all reflect the new choice.
function setChatMode(mode) {
    chatMode = mode === 'deep' ? 'deep' : 'fast';
    try { localStorage.setItem(CHAT_MODE_KEY, chatMode); } catch (e) { /* private mode */ }
    renderSendMode();
}

// A model id compressed to the three-letter acronym the composer's model toggle
// wears — `claude-sonnet-5` → SON, `claude-opus-5` → OPU. The toggle is a chip
// on a control row shared with the attach circles and the send pill, so it has
// room for a tag and not for an id; the full id stays one tap away in the mode
// menu (and in the chip's title).
//
// The family word is whatever survives stripping a vendor prefix (`anthropic.`,
// `us.anthropic.`) and the leading `claude-`; anything unrecognised falls back
// to the first alphabetic run in the id, so a third-party id like `gpt-5-codex`
// still yields GPT rather than nothing. An id with no letters at all yields ''
// and the caller shows the mode word instead.
export function modelAcronym(modelId) {
    const raw = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
    if (!raw) return '';
    // Drop a dotted vendor namespace, then the `claude-` family prefix, so the
    // acronym names the model rather than the vendor every id shares.
    const afterVendor = raw.slice(raw.lastIndexOf('.') + 1);
    const afterFamily = afterVendor.replace(/^claude-/, '');
    const word = (afterFamily.match(/[a-z]+/) || raw.match(/[a-z]+/) || [''])[0];
    return word.slice(0, 3).toUpperCase();
}

// What each send mode will actually run on, in the strings the composer paints:
// the two menu items and the model toggle's chip label. Fast is the `chat`
// surface and Deep is the `deep` surface — two registry surfaces now that
// deep-think is pickable, so "Fast" and "Deep" can name real models instead of
// standing for whatever the Worker happens to resolve.
//
// Kept pure, and kept as ONE decision, because the menu and the toggle must
// never disagree: a menu reading `Deep · claude-opus-5` beside a chip tagged
// with something else is worse than no chip at all.
//
// A resolved value wins; with none, the catalog's `defaults` map names what the
// unconfigured surface falls through to. With NEITHER — the per-repo settings
// cache hasn't resolved yet, or the read failed — the menu labels degrade to the
// plain `Fast` / `Deep` the composer has always shown, `captionModel` comes back
// '', and the chip wears the uppercased mode word rather than a guessed acronym.
export function describeSendModes(mode, resolvedChat, resolvedDeep, defaults) {
    const map = (defaults && typeof defaults === 'object') ? defaults : {};
    function pick(value, fallback) {
        const v = typeof value === 'string' ? value.trim() : '';
        if (v) return v;
        return typeof fallback === 'string' ? fallback.trim() : '';
    }
    const chat = pick(resolvedChat, map.chat);
    const deep = pick(resolvedDeep, map.deep);
    const isDeep = mode === 'deep';
    const active = isDeep ? deep : chat;
    return {
        fastLabel: chat ? 'Fast · ' + chat : 'Fast',
        deepLabel: deep ? 'Deep · ' + deep : 'Deep',
        captionModel: active,
        toggleLabel: modelAcronym(active) || (isDeep ? 'DEEP' : 'FAST'),
    };
}

// One surface's resolved id out of a settings payload, or '' when the payload
// doesn't carry it (an older Worker, a failed read, or a surface nobody set).
function resolvedSurfaceValue(settings, surface) {
    const entry = ((settings && settings.surfaces) || {})[surface] || {};
    return typeof entry.value === 'string' ? entry.value.trim() : '';
}

// Paint the model toggle (acronym + accent + title), the send pill (accent +
// aria-label), and the menu's items + ★ from the current chatMode. Defaults to
// the live contentEl scope, but accepts an explicit `root` so it can paint a
// freshly-built view before it is mounted (at which point contentEl is still
// null).
//
// The model names come out of the SAME per-repo settings cache the drafted-entry
// card's chip reads, never a second fetch of their own — one cache means the card,
// the Models panel, and the composer can't disagree about what this workspace
// resolves to.
function renderSendMode(root) {
    const scope = root || contentEl;
    if (!scope) return;
    const isDeep = chatMode === 'deep';
    const settings = runModelSettingsByRepo.get(activeChatRepo || '') || null;
    const modes = describeSendModes(
        chatMode,
        resolvedSurfaceValue(settings, CHAT_MODEL_SURFACE),
        resolvedSurfaceValue(settings, DEEP_MODEL_SURFACE),
        runModelCatalog && runModelCatalog.defaults,
    );
    const toggle = scope.querySelector('#claudeComposerModelToggle');
    if (toggle) {
        const tag = toggle.querySelector('.claudeModelToggleTag');
        if (tag) tag.textContent = modes.toggleLabel;
        // The chip is three letters wide, so the mode it stands for and the id it
        // abbreviates both live in the accessible name and the tooltip.
        const mode = isDeep ? 'Deep' : 'Fast';
        toggle.setAttribute(
            'aria-label',
            'Send mode: ' + mode + (modes.captionModel ? ' · ' + modes.captionModel : ''),
        );
        toggle.title = modes.captionModel
            ? mode + ' send · runs on ' + modes.captionModel
            : mode + ' send';
        toggle.classList.toggle('claudeModelToggleDeep', isDeep);
    }
    const send = scope.querySelector('#claudeComposerSend');
    if (send) {
        send.setAttribute('aria-label', isDeep ? 'Send deep' : 'Send');
        send.title = modes.captionModel
            ? (isDeep ? 'Deep send · runs on ' : 'Fast send · runs on ') + modes.captionModel
            : '';
        send.classList.toggle('claudeComposerSendDeep', isDeep);
    }
    const menu = scope.querySelector('#claudeComposerModeMenu');
    if (menu) {
        const options = menu.querySelectorAll('.claudeModeOption');
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const mode = opt.getAttribute('data-mode');
            const on = mode === chatMode;
            opt.setAttribute('aria-checked', on ? 'true' : 'false');
            const star = opt.querySelector('.claudeModeStar');
            if (star) star.textContent = on ? '★' : '';
            const name = opt.querySelector('.claudeModeName');
            if (name) name.textContent = mode === 'deep' ? modes.deepLabel : modes.fastLabel;
        }
    }
}

// Pull the active workspace's model settings into the shared cache, then repaint
// the send mode so the labels stop reading plain `Fast` / `Deep`. Fire-and-forget
// and best-effort: a failed read leaves the plain labels standing, and
// ensureRunModelContext drops its cached promise so the next call retries.
//
// Routed through a promise chain rather than called bare so that NOTHING here —
// not the read, not the repaint — can take the composer down with it. The model
// names are a caption; a composer that fails to build because a caption couldn't
// be resolved would be a far worse trade than a button that just says "Fast".
function refreshSendModeModels() {
    Promise.resolve()
        .then(function() { return ensureRunModelContext(activeChatRepo); })
        .then(function() { renderSendMode(); }, function() { /* labels stay plain */ });
}

function isModeMenuOpen() {
    const menu = sheetQuery('#claudeComposerModeMenu');
    return !!(menu && !menu.hidden);
}

function openModeMenu() {
    const menu = sheetQuery('#claudeComposerModeMenu');
    const toggle = sheetQuery('#claudeComposerModelToggle');
    if (!menu) return;
    menu.hidden = false;
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
}

function closeModeMenu() {
    const menu = sheetQuery('#claudeComposerModeMenu');
    const toggle = sheetQuery('#claudeComposerModelToggle');
    if (menu) menu.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function toggleModeMenu() {
    if (isModeMenuOpen()) closeModeMenu();
    else openModeMenu();
}

function buildChatView() {
    const view = document.createElement('div');
    view.id = 'claudeChatView';
    view.className = 'claudeView';
    view.setAttribute('role', 'tabpanel');

    // New Chat — a contextual control scoped to the CHAT tab, sitting above the
    // transcript and right-aligned in its own header row. It's structurally part
    // of the chat view (not the tab strip) so it's absent on RUNS / COVERAGE
    // without a per-tab hidden gate, and it sits OUTSIDE the scroll surface so it
    // never scrolls away with the log. Relocated out of #claudeSheetTabs, whose
    // width the COVERAGE tab's badge was pushing past the 360px docked pane.
    const header = document.createElement('div');
    header.id = 'claudeChatHeader';
    header.className = 'claudeChatHeader';
    // Spend control leads the row so it sits LEFT of New Chat (the row is
    // right-aligned, so an earlier child lands further left).
    header.appendChild(buildSpendControl());
    header.appendChild(buildClearChat());

    const clearChatConfirm = buildClearChatConfirm();

    const surface = document.createElement('div');
    surface.id = 'claudeChatSurface';
    surface.className = 'claudeChatSurface';

    // The ghost thread — the possessed identity's transcript, a sibling of the
    // work surface rather than a takeover of it, so flipping hides one and shows
    // the other with both their contents intact. Hidden until the state class
    // says otherwise (see the possession block in style.css).
    const ghostThread = document.createElement('div');
    ghostThread.id = 'claudeGhostThread';
    ghostThread.className = 'claudeGhostThread';
    // Replies arrive asynchronously, so the thread announces its own additions.
    ghostThread.setAttribute('role', 'log');
    ghostThread.setAttribute('aria-live', 'polite');

    // Task-scope chip — always present above the composer so the conversation's
    // scope is never ambiguous: it reads "🎯 <title>" (with a detach ✕) when a
    // task is attached, or a muted "Unscoped" otherwise. renderScopeChip() fills
    // it from the active attachment.
    const scopeChip = document.createElement('div');
    scopeChip.id = 'claudeScopeChip';
    scopeChip.className = 'claudeScopeChip';

    // Selected-attachment chips — sit directly above the composer. The chip
    // area also holds the two permanent residents of possession: the ghost chip
    // that toggles it (mobile's door, glowing while active; hidden on desktop,
    // which possesses from the companion) and the "the ghost is listening" chip
    // that stands in for the attachment chips while it is.
    const chips = document.createElement('div');
    chips.id = 'claudeAttachChips';
    chips.className = 'claudeAttachChips';
    chips.appendChild(buildGhostChip());
    chips.appendChild(buildGhostListeningChip());

    // Pending-image rail — thumbnail tiles for images staged for the next turn,
    // a separate rail from the file-attach chips. Sits directly above the
    // composer; collapses when empty via CSS.
    const imageRail = document.createElement('div');
    imageRail.id = 'claudeImageRail';
    imageRail.className = 'claudeImageRail';

    const composer = document.createElement('div');
    composer.id = 'claudeComposer';
    composer.className = 'claudeComposer';
    const input = document.createElement('textarea');
    input.id = 'claudeComposerInput';
    input.className = 'claudeComposerInput';
    input.setAttribute('placeholder', CHAT_PLACEHOLDER);
    input.setAttribute('rows', '1');
    // Send pill: one action that sends in the persistent default mode (chatMode —
    // 'fast' or 'deep'), keeping the accent fill that marks a Deep default. The
    // mode itself is now chosen from the model toggle below rather than a caret
    // welded to this button, so the pill is a pill again — a single word at the
    // far end of the control row.
    const send = document.createElement('button');
    send.id = 'claudeComposerSend';
    send.type = 'button';
    send.className = 'claudeComposerSend';
    send.textContent = 'Send';
    send.setAttribute('aria-label', 'Send');

    // Model toggle: the acronym chip that leads the control row (SON / OPU — see
    // modelAcronym) and opens the mode menu. It stands where the split send's
    // caret used to, and it is the composer's only model affordance now: the tag
    // names what the ACTIVE mode resolves to out of the shared per-repo settings
    // cache, which is the same setting the Models panel writes, so the two
    // surfaces cannot drift. Text is filled by renderSendMode() below.
    const modelToggle = document.createElement('button');
    modelToggle.id = 'claudeComposerModelToggle';
    modelToggle.type = 'button';
    modelToggle.className = 'claudeModelToggle';
    modelToggle.setAttribute('aria-label', 'Send mode');
    modelToggle.setAttribute('aria-haspopup', 'menu');
    modelToggle.setAttribute('aria-expanded', 'false');
    const modelToggleTag = document.createElement('span');
    modelToggleTag.className = 'claudeModelToggleTag';
    modelToggle.appendChild(modelToggleTag);
    const modelToggleCaret = document.createElement('span');
    modelToggleCaret.className = 'claudeModelToggleCaret';
    modelToggleCaret.textContent = '▾';
    modelToggleCaret.setAttribute('aria-hidden', 'true');
    modelToggle.appendChild(modelToggleCaret);

    // Mode menu: two options (Fast / Deep), the active default carrying a ★. Opens
    // above the toggle (the composer sits at the bottom of the sheet). Selecting a
    // mode persists it and closes the menu; the ★ tracks the choice. Each item's
    // text is repainted by renderSendMode() to name the model that mode resolves
    // to; the pair below seeds the plain labels it falls back to.
    const modeMenu = document.createElement('div');
    modeMenu.id = 'claudeComposerModeMenu';
    modeMenu.className = 'claudeModeMenu';
    modeMenu.setAttribute('role', 'menu');
    modeMenu.hidden = true;
    // Keep clicks inside the menu from reaching the document-level outside-click
    // handler (mirrors the attach panel + workspace menu guards).
    modeMenu.addEventListener('click', function(event) { event.stopPropagation(); });
    [['fast', 'Fast'], ['deep', 'Deep']].forEach(function(pair) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'claudeModeOption';
        opt.setAttribute('role', 'menuitemradio');
        opt.setAttribute('data-mode', pair[0]);
        const star = document.createElement('span');
        star.className = 'claudeModeStar';
        star.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'claudeModeName';
        name.textContent = pair[1];
        opt.appendChild(star);
        opt.appendChild(name);
        opt.addEventListener('click', function() {
            setChatMode(pair[0]);
            closeModeMenu();
            const inp = sheetQuery('#claudeComposerInput');
            if (inp) { try { inp.focus(); } catch (err) { /* defensive */ } }
        });
        modeMenu.appendChild(opt);
    });

    // The toggle and its menu sit in one relative-positioned wrapper the menu
    // drops out of, so the menu stays anchored to the chip wherever the control
    // row puts it.
    const toggleGroup = document.createElement('div');
    toggleGroup.id = 'claudeComposerModelToggleWrap';
    toggleGroup.className = 'claudeModelToggleWrap';
    toggleGroup.appendChild(modelToggle);
    toggleGroup.appendChild(modeMenu);

    // Two rows, at every width. The textarea owns the top row outright, so a long
    // draft can never collide with the controls the way it did when input and
    // buttons shared one line; the controls read [SON ▾] [📎] [🖼] [🎤] … [Send]
    // on the row beneath it, send pushed to the far end. buildAttach() carries the
    // attach button's click listener and the panel; buildMicButton() carries the
    // mic's listener (and returns null on browsers without speech recognition, so
    // the affordance is hidden entirely rather than shown broken).
    const inputRow = document.createElement('div');
    inputRow.className = 'claudeComposerInputRow';
    inputRow.appendChild(input);

    const controlRow = document.createElement('div');
    controlRow.className = 'claudeComposerControlRow';
    controlRow.appendChild(toggleGroup);
    controlRow.appendChild(buildAttach());
    controlRow.appendChild(buildImageAttach());
    const mic = buildMicButton();
    if (mic) controlRow.appendChild(mic);
    controlRow.appendChild(send);

    composer.appendChild(inputRow);
    composer.appendChild(controlRow);

    // Main send + Enter both use the persisted default mode (deep → deep_think)
    // — unless the ghost has the sheet, in which case the same two gestures
    // whisper to it instead. One composer, two destinations, decided by the
    // identity the surface is currently wearing.
    send.addEventListener('click', function() { submitComposer(); });
    modelToggle.addEventListener('click', function() { toggleModeMenu(); });
    // Enter sends; Shift+Enter inserts a newline.
    input.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitComposer();
        }
    });

    // Paste-to-attach: pasting an image (e.g. a screenshot via Ctrl+V) with the
    // composer focused stages it as a thumbnail just like the 🖼 picker. We pull
    // every image `file` item off the clipboard and hand the File array to
    // handleImagePick, so caps/encode/downscale/render stay single-sourced. When
    // at least one image is present we preventDefault so the raw bitmap doesn't
    // also fall through as noise into the textarea; a plain-text paste carries no
    // image item and is left completely untouched (so extractDraftedEntry still
    // works). Scoped to the textarea, not the document, so it never intercepts
    // pastes meant for other inputs.
    input.addEventListener('paste', function(event) {
        const clip = event.clipboardData;
        if (!clip || !clip.items) return;
        const files = [];
        for (let i = 0; i < clip.items.length; i++) {
            const item = clip.items[i];
            if (item && item.kind === 'file' && item.type && item.type.indexOf('image/') === 0) {
                const file = item.getAsFile();
                if (file) files.push(file);
            }
        }
        if (files.length === 0) return;
        event.preventDefault();
        handleImagePick(files);
    });

    // Paint the initial acronym / accent / ★ from the hydrated default. Scoped to
    // the composer itself because contentEl isn't assigned until the sheet body is
    // built, and the composer isn't appended to `view` yet here — the toggle and
    // the send pill now live in separate rows, so the scope has to span both.
    renderSendMode(composer);
    // …then fill in the model names once the shared per-repo settings cache has
    // them. Deliberately after the synchronous paint, so a slow or failed read
    // costs nothing but the sub-caption.
    refreshSendModeModels();

    // Scroll-to-bottom pill — a centered "↓" that floats just above the composer
    // whenever the chat log isn't pinned to the latest message. It lives inside
    // the composer (which is position: relative) and is absolutely positioned so
    // showing/hiding it never shifts the input row. Tapping it jumps to the
    // newest bubble; a scroll listener on the surface toggles its visibility.
    const scrollDown = document.createElement('button');
    scrollDown.id = 'claudeScrollDown';
    scrollDown.type = 'button';
    scrollDown.className = 'claudeScrollDown';
    scrollDown.textContent = '↓';
    scrollDown.setAttribute('aria-label', 'Scroll to latest message');
    scrollDown.hidden = true;
    scrollDown.addEventListener('click', function() {
        surface.scrollTop = surface.scrollHeight;
    });
    composer.appendChild(scrollDown);

    // Hidden once the log is within `threshold` of the bottom (so a tiny
    // overshoot doesn't keep the pill visible), shown otherwise. Programmatic
    // scroll-to-bottom (used by every bubble-append path) fires this same
    // listener, so a new message auto-hides the pill.
    const SCROLL_BOTTOM_THRESHOLD = 40;
    surface.addEventListener('scroll', function() {
        const distance = surface.scrollHeight - surface.scrollTop - surface.clientHeight;
        scrollDown.hidden = distance <= SCROLL_BOTTOM_THRESHOLD;
    });

    view.appendChild(header);
    // The New Chat confirm sits between the header row and the transcript, so it
    // spans the view width instead of stretching the right-aligned header row.
    view.appendChild(clearChatConfirm);
    view.appendChild(surface);
    view.appendChild(ghostThread);
    view.appendChild(scopeChip);
    view.appendChild(chips);
    view.appendChild(imageRail);
    view.appendChild(composer);
    // The chip is painted by mountClaudeSheet after contentEl is assigned and the
    // scope is hydrated — sheetQuery can't resolve it yet at build time.
    return view;
}

// ── VOICE DICTATION ──
// Browser-native speech recognition turns the mic button into an alternative
// way to type into the composer. Transcribed text lands in the same input the
// user types into; from there it sends through the ordinary send path — there
// is no separate voice routing and no auto-send. The recognition engine, the
// single-session lifecycle, and the iOS first-grant retry all live in the
// shared voiceInput.js module (also consumed by the add-task placeholder row);
// this composer just mounts a button pointed at #claudeComposerInput.
function buildMicButton() {
    return mountMicButton(function() { return sheetQuery('#claudeComposerInput'); }, {
        id: 'claudeComposerMic',
        className: 'micButton',
    });
}

// ── FILE ATTACHMENTS ──
// Repo-relative source paths display their basename in chips and the intro
// row, but the full path is what travels in `attach_files` so the Worker can
// fetch the file.
function fileBasename(path) {
    const parts = String(path || '').split('/');
    return parts[parts.length - 1] || String(path || '');
}

// The GitHub Pages manifest URL for a repo, by convention:
// 'owner/name' -> 'https://owner.github.io/name/src-manifest.json'.
export function manifestUrlForRepo(repo) {
    const parts = String(repo || '').split('/');
    const owner = parts[0] || '';
    const name = parts[1] || '';
    return 'https://' + owner + '.github.io/' + name + '/src-manifest.json';
}

// Fetch a repo's `src-manifest.json` once and cache the result per repo.
// Tolerates either a bare JSON array of paths or an object with a `files`
// array. Returns { ok, files, regions, hasDom, srcRoot }: `ok` is true only when
// a manifest was actually fetched and parsed (so the picker shows the browse
// list); any failure (404, network, parse) yields { ok: false, files: [] } so
// the picker degrades to the free-text path input rather than throwing. The
// `regions` / `hasDom` / `srcRoot` keys are additive and only present when the
// published manifest carries the build-time UI index (Structure tab UI lens);
// `regions` is left `undefined` for an older manifest that predates it, which
// the consumer reads as "UI map not built yet".
export async function loadManifest(repo) {
    if (srcManifestCache[repo]) return srcManifestCache[repo];
    let result;
    try {
        const res = await fetch(manifestUrlForRepo(repo));
        if (!res || !res.ok) {
            result = { ok: false, files: [] };
        } else {
            const data = await res.json();
            const isObj = data && !Array.isArray(data);
            const files = Array.isArray(data)
                ? data
                : (isObj && Array.isArray(data.files) ? data.files : []);
            const hasRegionsKey = !!(isObj && Object.prototype.hasOwnProperty.call(data, 'regions'));
            result = {
                ok: true,
                files: files.filter(function(p) { return typeof p === 'string' && p; }),
                regions: hasRegionsKey
                    ? (Array.isArray(data.regions)
                        ? data.regions.filter(function (r) { return r && typeof r.selector === 'string'; })
                        : [])
                    : undefined,
                hasDom: isObj && typeof data.hasDom === 'boolean' ? data.hasDom : undefined,
                srcRoot: isObj && typeof data.srcRoot === 'string' ? data.srcRoot : undefined,
                // The commit SHA the manifest was generated at (deploy-time
                // GITHUB_SHA). Surfaced so the Structure view can cache per-file
                // explanations keyed by it; absent on deterministic /
                // served-from-source manifests, where it stays undefined.
                sha: isObj && typeof data.sha === 'string' && data.sha ? data.sha : undefined,
                // The lens the manifest declares ('ui' | 'code' | 'types') and
                // its non-DOM symbol index. Surfaced for the Structure tab's
                // adaptive Types lens; left undefined for web / older manifests
                // that predate them, where structureView defaults to the UI lens.
                lens: isObj && typeof data.lens === 'string' ? data.lens : undefined,
                types: isObj && Array.isArray(data.types) ? data.types : undefined,
                // The sql-mode manifest's table outline: one entry per table
                // carrying its columns/constraints. Surfaced for the Structure
                // tab's adaptive SQL lens; left undefined for non-sql manifests.
                tables: isObj && Array.isArray(data.tables) ? data.tables : undefined,
            };
        }
    } catch (e) {
        result = { ok: false, files: [] };
    }
    srcManifestCache[repo] = result;
    return result;
}

// Synchronous, no-fetch read of a repo's already-loaded manifest. Returns the
// cached { ok, files, ... } result when loadManifest has run for `repo` this
// session, or null when nothing is cached yet. Lets a surface that must not
// block on a network call (e.g. the description editor's File:-path picker)
// show its browse affordance only when the manifest is already in hand and hide
// it otherwise, rather than triggering a second fetch of its own.
export function getCachedManifest(repo) {
    if (!repo) return null;
    return srcManifestCache[repo] || null;
}

// The cached manifest paths for the repo the picker is currently browsing, or
// an empty list when that repo has no fetchable manifest.
function currentManifestFiles() {
    const entry = srcManifestCache[selectedAttachRepo];
    return entry && entry.ok ? entry.files : [];
}

function currentAttachFilter() {
    const search = sheetQuery('#claudeAttachSearch');
    return search ? search.value : '';
}

// Toggle the file-picker panel. On open, sync the picker to the current repo
// selection: fetch its manifest and either show the browse list or fall back to
// the free-text path input.
async function toggleAttachPanel() {
    const panel = sheetQuery('#claudeAttachPanel');
    if (!panel) return;
    if (panel.hidden) {
        setAttachPanelHidden(false);
        await refreshAttachPickerMode();
    } else {
        setAttachPanelHidden(true);
    }
}

// Show or hide the dropdown panel and keep the picker button's aria-expanded in
// sync, so the button correctly advertises the panel's open state to assistive
// tech now that it owns the dropdown.
function setAttachPanelHidden(hidden) {
    const panel = sheetQuery('#claudeAttachPanel');
    if (panel) panel.hidden = hidden;
    const btn = sheetQuery('#claudeComposerAttach');
    if (btn) btn.setAttribute('aria-expanded', String(!hidden));
}

// A non-default repo short name for chip/notice display, e.g.
// 'rsterenchak/matchingGame-test' -> 'matchingGame-test'.
function repoShortName(repo) {
    const parts = String(repo || '').split('/');
    return parts[parts.length - 1] || String(repo || '');
}

// Show or clear the cross-repo inline notice inside the picker.
function showAttachNotice() {
    const notice = sheetQuery('#claudeAttachNotice');
    if (!notice) return;
    notice.textContent = 'Attachments must come from one repo per conversation. Clear current chips or start a + New chat to switch repos.';
    notice.hidden = false;
}

function clearAttachNotice() {
    const notice = sheetQuery('#claudeAttachNotice');
    if (!notice) return;
    notice.hidden = true;
    notice.textContent = '';
}

// Show or hide the browse controls vs. the free-text path input. Browse mode is
// for repos with a fetchable manifest; free-text is the fallback.
function applyAttachPickerMode(isManifest) {
    const search = sheetQuery('#claudeAttachSearch');
    const list = sheetQuery('#claudeAttachList');
    const pathRow = sheetQuery('#claudeAttachPathRow');
    if (search) search.hidden = !isManifest;
    if (list) list.hidden = !isManifest;
    if (pathRow) pathRow.hidden = isManifest;
}

// Fetch the selected repo's manifest and swap the picker into the matching
// mode: browse list when a manifest is available, free-text input otherwise.
// Guards against a stale selection — if the user switches repos again before
// the fetch resolves, the late result is dropped so a previous repo's list can
// never leak into the current view.
async function refreshAttachPickerMode() {
    const repo = selectedAttachRepo;
    const result = await loadManifest(repo);
    if (repo !== selectedAttachRepo) return;
    applyAttachPickerMode(result.ok);
    if (result.ok) renderAttachList(currentAttachFilter());
}

// Attach the path typed into the free-text input (non-default repos).
function addFreeTextAttachment() {
    const input = sheetQuery('#claudeAttachPathInput');
    if (!input) return;
    const path = (input.value || '').trim();
    if (!path) return;
    if (addAttachment(path, selectedAttachRepo)) input.value = '';
}

function renderAttachList(filter) {
    const list = sheetQuery('#claudeAttachList');
    if (!list) return;
    list.innerHTML = '';
    const q = String(filter || '').trim().toLowerCase();
    const all = currentManifestFiles();
    const files = q ? all.filter(function(p) { return p.toLowerCase().indexOf(q) !== -1; }) : all;
    if (!files.length) {
        const empty = document.createElement('p');
        empty.className = 'claudeAttachEmpty';
        empty.textContent = all.length ? 'No files match' : 'No files available';
        list.appendChild(empty);
        return;
    }
    files.forEach(function(path) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'claudeAttachItem';
        item.dataset.path = path;
        item.textContent = path;
        if (attachedFiles.indexOf(path) !== -1) {
            item.classList.add('claudeAttachItem--selected');
        }
        item.addEventListener('click', function() { addAttachment(path, selectedAttachRepo); });
        list.appendChild(item);
    });
}

// Attach a path from `repo`. Every chip in a conversation must share one repo
// (the Worker loads from a single repo per request), so a path from a different
// repo than the existing chips is refused with the inline notice and no state
// change. Returns true when the path was actually added.
function addAttachment(path, repo) {
    if (!path) return false;
    repo = repo || DEFAULT_ATTACH_REPO;
    if (attachedFiles.length && attachedRepo && repo !== attachedRepo) {
        showAttachNotice();
        return false;
    }
    if (attachedFiles.indexOf(path) !== -1) return false;
    attachedFiles.push(path);
    attachedRepo = repo;
    clearAttachNotice();
    renderComposerChipArea();
    renderAttachIntro();
    renderAttachList(currentAttachFilter());
    return true;
}

function removeAttachment(path) {
    const before = attachedFiles.length;
    attachedFiles = attachedFiles.filter(function(p) { return p !== path; });
    if (attachedFiles.length === before) return;
    // Releasing the last chip unlocks the repo so the picker can switch freely.
    if (!attachedFiles.length) attachedRepo = null;
    renderComposerChipArea();
    renderAttachIntro();
    renderAttachList(currentAttachFilter());
}

// Reset attachments for a fresh conversation: drop the list, clear the chips
// and intro row, and collapse the picker. The active workspace is unchanged —
// a fresh chat stays in the same workspace — so the picker re-syncs to it.
function clearAttachments() {
    attachedFiles = [];
    suggestedAttachedFiles = [];
    pendingSuggestedFiles = [];
    attachedRepo = null;
    selectedAttachRepo = activeChatRepo;
    clearAttachNotice();
    renderComposerChipArea();
    renderAttachIntro();
    setAttachPanelHidden(true);
    renderAttachList('');
    // Staged images are part of the pending turn too, so a fresh conversation
    // (new chat / workspace swap) drops them alongside the file attachments.
    pendingImages = [];
    renderPendingImages();
}

// The single composer-area chip renderer. Every chip source flows through here
// so the chip strip has one home: future chip types add a loop here rather than
// a parallel renderer. Order is intentional: manual attachments first (the
// user-curated set takes visual precedence), then accepted suggestions
// (integrated to look like regular chips), then pending suggestions (the
// distinct "suggested" variant the user can accept with one tap or dismiss).
// All three live in `#claudeAttachChips` above the input bar. Each chip carries
// a `data-source` ("manual" or "suggestion") so its origin is legible in the DOM.
function renderComposerChipArea() {
    const chips = sheetQuery('#claudeAttachChips');
    if (!chips) return;
    // Clear the attachment chips only — the ghost chip and the listening chip
    // are permanent residents of this row, so a repaint must not evict them
    // (and with them the possession toggle's click handler).
    const stale = chips.querySelectorAll('.claudeAttachChip');
    for (let i = 0; i < stale.length; i++) {
        if (stale[i].parentNode) stale[i].parentNode.removeChild(stale[i]);
    }
    attachedFiles.forEach(function(path) {
        // Default-repo chips read as a bare basename; chips from any other repo
        // carry their repo subtly so a mixed-looking set stays unambiguous.
        const text = (attachedRepo && attachedRepo !== DEFAULT_ATTACH_REPO)
            ? repoShortName(attachedRepo) + ': ' + path
            : fileBasename(path);
        chips.appendChild(buildAttachChip(path, text, removeAttachment, 'manual'));
    });
    suggestedAttachedFiles.forEach(function(path) {
        // Accepted suggestions are visually integrated — a regular chip whose ✕
        // removes from the suggestion channel only, never from `attachedFiles`.
        chips.appendChild(buildAttachChip(path, fileBasename(path), removeSuggestedAttachment, 'suggestion'));
    });
    pendingSuggestedFiles.forEach(function(path) {
        chips.appendChild(buildSuggestionChip(path));
    });
}

// A regular (manual or accepted-suggestion) chip: a static label and a ✕ that
// runs `onRemove(path)`. `source` tags the chip's origin ("manual" or
// "suggestion") so the dismiss path is legible from the DOM alone.
function buildAttachChip(path, text, onRemove, source) {
    const chip = document.createElement('span');
    chip.className = 'claudeAttachChip';
    chip.dataset.path = path;
    chip.dataset.source = source || 'manual';
    const label = document.createElement('span');
    label.className = 'claudeAttachChipLabel';
    label.textContent = text;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'claudeAttachChipRemove';
    x.setAttribute('aria-label', 'Remove ' + fileBasename(path));
    x.textContent = '✕';
    x.addEventListener('click', function() { onRemove(path); });
    chip.appendChild(label);
    chip.appendChild(x);
    return chip;
}

// A pending-suggestion chip: distinct ✦-prefixed variant whose label accepts the
// suggestion on tap and whose ✕ dismisses it without accepting.
function buildSuggestionChip(path) {
    const chip = document.createElement('span');
    chip.className = 'claudeAttachChip claudeAttachChip--suggested';
    chip.dataset.path = path;
    chip.dataset.source = 'suggestion';
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'claudeAttachChipLabel';
    label.textContent = '✦ ' + fileBasename(path);
    label.setAttribute('aria-label', 'Attach suggested file ' + fileBasename(path));
    label.addEventListener('click', function() { acceptSuggestedFile(path); });
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'claudeAttachChipRemove';
    x.setAttribute('aria-label', 'Dismiss suggestion ' + fileBasename(path));
    x.textContent = '✕';
    x.addEventListener('click', function() { dismissSuggestedFile(path); });
    chip.appendChild(label);
    chip.appendChild(x);
    return chip;
}

// A single intro row pinned to the top of the thread that names the attached
// files, so the user can see what source context the assistant has. Updated in
// place; removed entirely when no attachments remain.
function renderAttachIntro() {
    const surface = sheetQuery('#claudeChatSurface');
    if (!surface) return;
    let intro = surface.querySelector('#claudeAttachIntro');
    if (!attachedFiles.length) {
        if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
        return;
    }
    if (!intro) {
        intro = document.createElement('div');
        intro.id = 'claudeAttachIntro';
        intro.className = 'claudeAttachIntro';
        surface.insertBefore(intro, surface.firstChild);
    }
    intro.textContent = '📎 Attached: ' + attachedFiles.map(fileBasename).join(', ');
}

// ── WORKER FILE SUGGESTIONS ("Lever 4") ──
// When the Worker's chat reply names files it would like to see, it returns them
// as `suggested_files`. Each becomes a "suggested" chip in the composer chip
// area (above the input bar, beside any manual-attach chips) so the proposal
// sits where the user is about to type. Accepting moves the path onto
// `suggestedAttachedFiles` — a separate channel from manual attachments — which
// rides under `suggested_attach_files` on later turns and gets the Worker's
// tighter 20KB cap. Dismissing drops the proposal without attaching anything.

// Queue Worker-proposed paths as pending suggestions, skipping any already
// attached, already accepted, or already pending so a repeated suggestion never
// stacks duplicate chips. An empty/absent list is a no-op, which respects a
// `suggested_files: []` turn (no stale chips re-rendered).
function addSuggestedFiles(files) {
    if (!Array.isArray(files) || !files.length) return;
    files.forEach(function(path) {
        if (!path) return;
        if (attachedFiles.indexOf(path) !== -1) return;
        if (suggestedAttachedFiles.indexOf(path) !== -1) return;
        if (pendingSuggestedFiles.indexOf(path) !== -1) return;
        pendingSuggestedFiles.push(path);
    });
    renderComposerChipArea();
}

// Accept a pending suggestion: move it onto the suggestion channel (so it rides
// `suggested_attach_files`) and re-render so its chip integrates as a regular
// attach chip rather than the distinct suggested variant.
function acceptSuggestedFile(path) {
    if (!path) return;
    pendingSuggestedFiles = pendingSuggestedFiles.filter(function(p) { return p !== path; });
    if (suggestedAttachedFiles.indexOf(path) === -1) {
        suggestedAttachedFiles.push(path);
    }
    renderComposerChipArea();
}

// Dismiss a pending suggestion: drop it from the pending list only, never
// touching `attachedFiles` or accepted suggestions.
function dismissSuggestedFile(path) {
    const before = pendingSuggestedFiles.length;
    pendingSuggestedFiles = pendingSuggestedFiles.filter(function(p) { return p !== path; });
    if (pendingSuggestedFiles.length === before) return;
    renderComposerChipArea();
}

// Remove an accepted suggestion: drop it from the suggestion channel only, never
// touching the manual `attachedFiles` set.
function removeSuggestedAttachment(path) {
    const before = suggestedAttachedFiles.length;
    suggestedAttachedFiles = suggestedAttachedFiles.filter(function(p) { return p !== path; });
    if (suggestedAttachedFiles.length === before) return;
    renderComposerChipArea();
}

// ── WORKSPACE (chat-level repo selector) ──
// The workspace pill names the repo the whole conversation is framed around.
// Tapping it opens a menu of all allowed repos; choosing a different one (behind
// an inline confirm, since it wipes the chat) switches the active workspace.

function setActiveChatRepo(repo) {
    activeChatRepo = repo;
    selectedAttachRepo = repo;
}

// Project the workspace repo list from the Inject targets (Supabase
// `inject_targets`, cached in inject.js) so the chat menu is a clean projection
// of the targets the user manages in Inject settings — the two never drift. The
// save-time allowlist guard already keeps every target's repo on the Worker's
// `ALLOWED_TARGETS`, so the targets list is a safe subset. Each menu item still
// anchors on the target's `repo` string, so `activeChatRepo`, the chat-turn
// `repo` payload, and the `repoShortName` display are all unchanged; the menu is
// simply sourced differently. Duplicate repos (two targets on the same repo)
// collapse to one item, since the menu anchors on the repo string.
//
// This reads the cache synchronously; `refreshWorkspaceRepos` reloads the cache
// first. The projection preserves `chatHistory`, attachments, and the active
// workspace — only an explicit pill switch wipes the chat. The exceptions:
// when the cache is empty or failed to load, fall back to the default repo so
// the chat is always usable; and when the active workspace is no longer in the
// list (the user deleted that target), fall back to the first target (or the
// default) so the user isn't stranded on a repo the menu no longer lists.
function loadWorkspaceRepos() {
    const targets = getCachedTargets();
    const seen = {};
    const names = [];
    targets.forEach(function(t) {
        if (!t || t.enabled === false) return;
        const repo = t.repo;
        if (repo && !seen[repo]) { seen[repo] = true; names.push(repo); }
    });
    attachRepos = names.length ? names : [DEFAULT_ATTACH_REPO];
    if (attachRepos.indexOf(activeChatRepo) === -1) {
        setActiveChatRepo(attachRepos[0]);
    }
    renderWorkspacePill();
}

// Read-only projections of the workspace repo list and the active workspace
// repo, exported for the Structure view's repo picker so it stays a clean
// mirror of the chat's allowlist (`attachRepos`) and defaults to the repo the
// chat is currently framed around. Returns copies/primitives so callers can't
// mutate the module's internal state.
export function getAttachRepos() {
    return attachRepos.slice();
}

export function getActiveChatRepo() {
    return activeChatRepo;
}

// Read-only projection of the conversation's scoped task id (null when
// unscoped), exported for tests that assert the attach/detach/persistence
// lifecycle without reaching into module internals.
export function getActiveChatTask() {
    return activeChatTask;
}

// The app's own repo — the "running app" the UI lens can walk live. The
// Structure view compares its selected repo against this to decide between the
// live DOM map and the "no published UI map yet" state.
export function getRunningAppRepo() {
    return DEFAULT_ATTACH_REPO;
}

// Reframe the conversation on `repo`, the same deliberate switch the chat's
// workspace pill performed: set the active workspace and start fresh on the new
// repo — wipe the in-memory thread and its persisted copy, drop any iterate
// seed (so a follow-up can't pull the prior repo's diff), and clear the
// attachment chips (they're single-repo). No-op when the repo isn't an allowed
// workspace or already equals the active one. Exported for the Structure view's
// repo picker, which is bound to the chat workspace.
export function setChatWorkspaceRepo(repo) {
    if (!repo || attachRepos.indexOf(repo) === -1) return;
    if (repo === activeChatRepo) return;
    setActiveChatRepo(repo);

    chatHistory = [];
    deleteChatHistory(repo);
    clearRemoteChatTurns(repo);
    activeIterateEntry = null;
    deleteIterateEntry(repo);
    // Reframing wipes the incoming repo's session, so drop its task scope too.
    activeChatTask = null;
    deleteChatTask(repo);
    // Reframing on a new repo starts a fresh session, so drop any hand-off link.
    activeHandoffRow = null;
    const surface = sheetQuery('#claudeChatSurface');
    if (surface) surface.innerHTML = '';

    const panel = sheetQuery('#claudeAttachPanel');
    const pickerWasOpen = !!(panel && !panel.hidden);
    clearAttachments();
    renderScopeChip();
    renderWorkspacePill();
    // Model settings are per-repo, so the send-mode captions belong to the repo
    // that just left. Repaint from the incoming repo's cache entry (plain labels
    // until it lands) rather than leaving the old workspace's models on screen.
    renderSendMode();
    refreshSendModeModels();
    if (pickerWasOpen && panel) {
        setAttachPanelHidden(false);
        refreshAttachPickerMode();
    }
}

// Reload the inject-targets cache from Supabase, then re-project the workspace
// list. Fired on mount, on every sheet open, and whenever the targets change
// mid-session (the `injectTargetsChanged` event). Fire-and-forget at the call
// sites: the current list stays usable while the reload is in flight, and a
// failed reload leaves the safe fallback in place. Repaints only — never wipes
// chatHistory, attachments, or the active workspace.
async function refreshWorkspaceRepos() {
    await loadInjectTargets();
    loadWorkspaceRepos();
}

// Paint the hidden pill node with the active workspace's short name. The pill is
// no longer a control (see buildWorkspace) — this keeps its text current as the
// single live read-out of which repo the conversation is framed around.
function renderWorkspacePill() {
    const pill = sheetQuery('#claudeWorkspacePill');
    if (!pill) return;
    pill.textContent = '📂 ' + repoShortName(activeChatRepo) + ' ▾';
    pill.title = 'Workspace: ' + activeChatRepo;
}

// ── POSSESSION ──
// The ghost wearing the sheet. One flag drives one state class, and the class
// drives the whole identity in CSS: the work thread hides (state intact — it is
// display:none, never emptied), the ghost thread shows, the composer goes
// ghostly, and every affordance that belongs to the work chat — model picker,
// scope chip, attach / image / voice circles, chip rail — steps aside for a
// single "the ghost is listening" chip.
//
// The plumbing under it is ghostTalk.js's, the same two Worker calls the desktop
// floating skin makes. Nothing here talks to the Worker directly and nothing
// here touches Supabase: the ghost transcript lives server-side in
// `ghost_messages` and the work chat's own history (chatHistory / appendChatTurn)
// is never written to from possession, so the two conversations can't bleed.
//
// The greeting is the one line on screen that is not transcript. When the last
// exchange has gone cold it renders as the newest ghost row — deliberately
// indistinguishable from a real one — but it is never persisted and never rides
// a payload, so the next hydrate simply doesn't contain it.

export function isSheetPossessed() {
    return possessed;
}

// The one writer for possession. Banks the draft of the identity being left,
// restores the other's, repaints the affordances, and announces the flip.
function setPossessed(next) {
    const want = !!next;
    if (possessed === want) return;
    const input = sheetQuery('#claudeComposerInput');
    if (input) {
        if (possessed) ghostDraft = input.value || '';
        else workDraft = input.value || '';
    }
    possessed = want;
    // Any ghost reply still in flight belongs to the identity we just left.
    ghostSession++;
    if (input) {
        input.value = possessed ? ghostDraft : workDraft;
        input.placeholder = possessed ? GHOST_PLACEHOLDER : CHAT_PLACEHOLDER;
    }
    applyPossessionState();
    if (possessed) hydrateGhostThread();
    emitPossessionChange();
}

export function togglePossession() {
    setPossessed(!possessed);
}

// Paint everything the state flag governs that CSS can't reach on its own: the
// class the stylesheet keys off and the chip's pressed/glow state. The send
// pill's caption is a static "Send" in both identities now that the model lives
// on its own toggle (which CSS hides while possessed), so only the mode-derived
// accent needs repainting on the way back out. The mode menu closes on every
// flip so a popover can't linger over the other identity.
function applyPossessionState() {
    if (contentEl) contentEl.classList.toggle('is-possessed', possessed);
    closeModeMenu();
    const chip = sheetQuery('#claudeGhostChip');
    if (chip) {
        chip.classList.toggle('is-active', possessed);
        chip.setAttribute('aria-pressed', possessed ? 'true' : 'false');
    }
    if (!possessed) renderSendMode();
}

// Announce the flip so surfaces outside the sheet can follow it. Fire-and-forget
// and guarded: an environment without CustomEvent simply gets no announcement.
function emitPossessionChange() {
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function') return;
    try {
        document.dispatchEvent(new CustomEvent(POSSESSION_EVENT, {
            detail: { possessed: possessed },
        }));
    } catch (e) { /* defensive */ }
}

// The ghost chip — the possession toggle, living in the composer chip area. It
// wears the same committed sprite the desktop companion does (--ghost-sprite),
// so the two surfaces can never fork the art, and it glows while the ghost has
// the sheet. Built at every breakpoint but shown only on mobile: desktop
// possesses by clicking the companion, and the stylesheet hides the chip there
// so the pane at rest carries no ghost affordance at all.
function buildGhostChip() {
    const chip = document.createElement('button');
    chip.id = 'claudeGhostChip';
    chip.type = 'button';
    chip.className = 'claudeGhostChip';
    chip.setAttribute('aria-label', 'Talk to the ghost');
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', function() { togglePossession(); });
    return chip;
}

// What the chip rail says while possessed, in place of the attachment chips.
function buildGhostListeningChip() {
    const chip = document.createElement('span');
    chip.id = 'claudeGhostListening';
    chip.className = 'claudeGhostListening';
    chip.textContent = GHOST_LISTENING_COPY;
    return chip;
}

// The newest rows, oldest-to-newest, then the opening line. A warm conversation
// already ends on the ghost's last reply, so only a cold one adds a row — the
// greeting, which exists in this thread and nowhere else. Runs at most once per
// sheet-open; a failed readback resolves empty (ghostTalk swallows it), so the
// thread opens on a greeting rather than an error.
function hydrateGhostThread() {
    if (ghostHydrated) return;
    const thread = sheetQuery('#claudeGhostThread');
    if (!thread) return;
    ghostHydrated = true;
    const mySession = ghostSession;
    fetchGhostHistory().then(function(rows) {
        if (mySession !== ghostSession || !sheetQuery('#claudeGhostThread')) return;
        const recent = rows.slice(-GHOST_THREAD_LIMIT);
        recent.forEach(function(row) { appendGhostRow(row.role, row.text); });
        const opening = ghostOpeningLine(rows);
        if (opening.greeting) appendGhostRow('ghost', opening.text);
        scrollGhostThread();
    });
}

function appendGhostRow(role, text) {
    const thread = sheetQuery('#claudeGhostThread');
    if (!thread) return null;
    const row = document.createElement('div');
    row.className = 'claudeGhostRow claudeGhostRow--' + (role === 'user' ? 'user' : 'ghost');
    row.textContent = text;
    thread.appendChild(row);
    return row;
}

function scrollGhostThread() {
    const thread = sheetQuery('#claudeGhostThread');
    if (thread) thread.scrollTop = thread.scrollHeight;
}

function clearGhostThread() {
    const thread = sheetQuery('#claudeGhostThread');
    if (thread) thread.textContent = '';
}

// The breakpoint names the surface, so the transcript still records where a
// whisper happened now that one sheet serves both — "mobile" under 1024px,
// "desktop" above, exactly the two names the standalone skins used.
function ghostSurface() {
    return window.innerWidth <= MOBILE_MAX_WIDTH ? 'mobile' : 'desktop';
}

// Optimistic: the user's turn and a pending ghost row go up immediately, and the
// reply swaps into the row already holding its place. Both turns land in
// `ghost_messages` server-side, so the next hydrate agrees with what was shown.
function sendGhostTurn() {
    const input = sheetQuery('#claudeComposerInput');
    if (!input) return Promise.resolve();
    const message = (input.value || '').trim();
    if (!message) return Promise.resolve();
    input.value = '';
    ghostDraft = '';
    const mySession = ghostSession;
    appendGhostRow('user', message);
    const pendingRow = appendGhostRow('ghost', '');
    // No dots where there is no wire — the answer is already known, and dots
    // that never resolve into anything read as a hang.
    if (pendingRow && isGhostWireReady()) {
        pendingRow.classList.add('claudeGhostRow--pending');
        renderGhostPending(pendingRow);
    }
    scrollGhostThread();

    return askGhost(message, ghostSurface()).then(function(text) {
        if (mySession !== ghostSession || !pendingRow) return;
        pendingRow.classList.remove('claudeGhostRow--pending');
        pendingRow.textContent = text;
        scrollGhostThread();
    });
}

// The single composer entry point, shared by the send button and Enter. Which
// conversation the text joins is decided here and nowhere else, so the two
// gestures can never disagree about who is being spoken to.
function submitComposer() {
    if (possessed) return sendGhostTurn();
    return sendChatTurn(chatMode === 'deep');
}

// ── CHAT ──
// Reconstruct a displayable `data:` URL from a stored image ({ media_type, data }
// with raw base64), used both for the pending rail and the sent-bubble thumbs.
function imageDataUrl(image) {
    return 'data:' + image.media_type + ';base64,' + image.data;
}

function appendMessageBubble(role, text, images) {
    const surface = sheetQuery('#claudeChatSurface');
    if (!surface) return null;
    const bubble = document.createElement('div');
    bubble.className = 'claudeMsg claudeMsg--' + role;
    bubble.textContent = text;
    // An optional images arg renders the turn's attached images as a thumbnail
    // gallery beneath the text (image-only turns carry an empty text node). Only
    // the live send path and an in-session replay pass images; a post-reload
    // replay passes undefined (they were stripped on save), so bubbles are
    // text-only there.
    if (Array.isArray(images) && images.length) {
        const gallery = document.createElement('div');
        gallery.className = 'claudeMsgImages';
        images.forEach(function(image) {
            if (!image || !image.media_type || !image.data) return;
            const thumb = document.createElement('img');
            thumb.className = 'claudeMsgImageThumb';
            thumb.src = imageDataUrl(image);
            thumb.alt = 'Attached image';
            gallery.appendChild(thumb);
        });
        bubble.appendChild(gallery);
    }
    surface.appendChild(bubble);
    surface.scrollTop = surface.scrollHeight;
    return bubble;
}

// Split an assistant reply into ordered segments so that fenced ```html and
// ```svg blocks can be rendered inline while everything else stays plain text.
// Each segment is { type: 'text' | 'html' | 'svg', value }. Fences other than
// html/svg (e.g. the ```md draft block) are left inside text segments — they're
// handled elsewhere and must not be rendered as live markup.
export function splitRenderableBlocks(text) {
    const src = String(text || '');
    // Fenced ```html / ```svg blocks. Case-insensitive label (```SVG / ```Svg
    // also match) and the markup may start on the same line as the label — the
    // newline after the label is optional. The captured body is trimmed so a
    // same-line ```svg<svg…> doesn't carry stray indentation into the sanitizer.
    const re = /```(html|svg)[ \t]*\r?\n?([\s\S]*?)```/gi;
    const fenced = [];
    let last = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (m.index > last) fenced.push({ type: 'text', value: src.slice(last, m.index) });
        fenced.push({ type: m[1].toLowerCase(), value: m[2].trim() });
        last = re.lastIndex;
    }
    if (last < src.length || !fenced.length) {
        fenced.push({ type: 'text', value: src.slice(last) });
    }
    // Fallback: promote a complete, top-level <svg>…</svg> element found inside a
    // remaining text segment to an svg segment so an un-fenced SVG in the reply
    // still renders. This runs AFTER fenced-block extraction, so an <svg> already
    // inside an extracted ```svg/```html fence is never matched twice. Only
    // balanced elements (open + close) are promoted; a bare <svg> mention with no
    // closing tag stays plain text. The scan also skips any ``` fenced span that
    // survived into a text segment (e.g. a ```md draft block) so an <svg> written
    // literally inside such a fence stays text rather than rendering mid-draft.
    const segments = [];
    for (const seg of fenced) {
        if (seg.type !== 'text') { segments.push(seg); continue; }
        // Map out any ``` fenced spans that survived into this text segment (e.g. a
        // ```md draft block) so an <svg> written literally inside one is ignored.
        const fences = [];
        const fenceRe = /```[\s\S]*?```/g;
        let fm;
        while ((fm = fenceRe.exec(seg.value)) !== null) {
            fences.push([fm.index, fenceRe.lastIndex]);
        }
        const insideFence = (i) => fences.some(([s, e]) => i >= s && i < e);
        // Promote each balanced <svg>…</svg> that lies outside every fenced span,
        // leaving the surrounding (and fenced) text contiguous and unrendered.
        const svgRe = /<svg[\s\S]*?<\/svg>/gi;
        let li = 0;
        let sm;
        while ((sm = svgRe.exec(seg.value)) !== null) {
            if (insideFence(sm.index)) continue;
            if (sm.index > li) segments.push({ type: 'text', value: seg.value.slice(li, sm.index) });
            segments.push({ type: 'svg', value: sm[0] });
            li = svgRe.lastIndex;
        }
        if (li === 0 || li < seg.value.length) {
            segments.push({ type: 'text', value: seg.value.slice(li) });
        }
    }
    return segments;
}

// Sanitize a ```html block. DOMPurify strips scripts, event handlers, and other
// XSS vectors by default, so the model's mockup HTML renders as inert structure.
function sanitizeHtmlBlock(html) {
    return DOMPurify.sanitize(String(html));
}

// Sanitize an svg block. Defense-in-depth that renders the model's SVG safely
// regardless of what arrives (the Worker prompt now instructs fenced ```svg
// blocks for mockups): restrict to the SVG profile and explicitly forbid
// <script>, <foreignObject>, and <image> (the external-href vector).
function sanitizeSvgBlock(svg) {
    return DOMPurify.sanitize(String(svg), {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject', 'image', 'script'],
    });
}

// Render an assistant reply into a bubble, turning fenced ```html and ```svg
// blocks into live (sanitized) inline markup while keeping the surrounding prose
// as plain text. When the reply carries no renderable block this is identical to
// `bubble.textContent = text`, preserving the prior behavior exactly.
export function renderAssistantContent(bubble, text) {
    if (!bubble) return bubble;
    const segments = splitRenderableBlocks(text);
    if (segments.length === 1 && segments[0].type === 'text') {
        bubble.textContent = segments[0].value;
        return bubble;
    }
    bubble.textContent = '';
    for (const seg of segments) {
        if (seg.type === 'text') {
            if (seg.value) bubble.appendChild(document.createTextNode(seg.value));
            continue;
        }
        const box = document.createElement('div');
        box.className = 'claudeMsgRendered claudeMsgRendered--' + seg.type;
        box.innerHTML = seg.type === 'svg'
            ? sanitizeSvgBlock(seg.value)
            : sanitizeHtmlBlock(seg.value);
        bubble.appendChild(box);
    }
    return bubble;
}

// Detect a fenced ```md … ``` block in an assistant reply and return its inner
// text (trimmed), or null when none is present. This is the signal that Claude
// has drafted a TODO.md entry ready to inject.
export function extractDraftedEntry(reply) {
    const m = String(reply || '').match(/```md\s*\n([\s\S]*?)```/);
    if (!m) return null;
    const entry = m[1].replace(/\s+$/, '');
    return entry.trim() ? entry : null;
}

// Mount a "Create task" action on a COMPLETED assistant bubble. Chat sits
// upstream of the pipeline, so a reply that arrives at a change should be able
// to emit it directly instead of forcing a copy-paste back through the compose
// row. On tap it parses the message with the SAME parser the paste path uses
// (shared parsePastedEntry — headline for the title, full entry text for the
// description, code fence stripped) and commits a task into the ACTIVE project
// through the blank placeholder's Enter path, so the row lands with its status
// badge and a fresh placeholder exactly like a typed task. The active project
// is tracked separately from the chat's repo, so the confirmation names the
// project that received it. Only ever called once a message is complete (never
// mid-token), and only on assistant bubbles; idempotent so a replay/re-render
// can't double-mount.
function mountCreateTaskAction(bubble, rawText) {
    if (!bubble || bubble.querySelector('.claudeMsgCreateTask')) return;
    const text = String(rawText == null ? '' : rawText);
    if (!text.trim()) return;

    const actions = document.createElement('div');
    actions.className = 'claudeMsgActions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'claudeMsgCreateTask';
    btn.textContent = '+ Create task';
    btn.setAttribute('aria-label', 'Create a task from this reply');
    btn.addEventListener('click', function() {
        const parsed = parsePastedEntry(text);
        if (!parsed.title) {
            showInjectToast('Couldn’t read a task from this reply.', 'error');
            return;
        }
        const project = commitEntryToActiveProject(parsed);
        if (!project) {
            showInjectToast('Couldn’t create the task — open a project first.', 'error');
            return;
        }
        showInjectToast('Added “' + parsed.title + '” to ' + project + '.');
    });
    actions.appendChild(btn);
    bubble.appendChild(actions);
}

// Detect an `INSPECT: <selector>` directive line the Worker emits in iterate
// mode to ask for a live layout snapshot of an on-screen element. Returns the
// captured selector (trimmed), or null when no directive line is present.
export function extractInspectDirective(reply) {
    const m = String(reply || '').match(/^INSPECT:\s*(.+)$/m);
    if (!m) return null;
    const selector = m[1].trim();
    return selector || null;
}

// Strip the INSPECT directive line from a reply so the user sees clean prose
// instead of a literal "INSPECT: ..." line, collapsing the blank gap it leaves.
function stripInspectDirective(reply) {
    return String(reply || '')
        .replace(/^INSPECT:\s*.+$\n?/m, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// Detect an `ASK: <question> :: <opt> | <opt> | <opt>` directive line the Worker
// emits when it needs a quick, enumerable answer before drafting. Returns
// { question, options } parsed from the FIRST such line — the question is the
// text before the first ` :: `, options are the ` | `-separated list after,
// each trimmed and non-empty. Parses defensively: a line with no ` :: `, an
// empty question, or zero options after trimming yields null so it falls back to
// plain text rather than throwing. Independent of INSPECT detection.
export function extractAskDirective(reply) {
    const m = String(reply || '').match(/^ASK:\s*(.+)$/m);
    if (!m) return null;
    const body = m[1];
    const sep = body.indexOf(' :: ');
    if (sep === -1) return null;
    const question = body.slice(0, sep).trim();
    const options = body.slice(sep + 4).split(' | ')
        .map(function(o) { return o.trim(); })
        .filter(function(o) { return o.length > 0; });
    if (!question || !options.length) return null;
    return { question: question, options: options };
}

// Replace the `ASK:` directive line with just its question text so the visible
// bubble reads as prose (the options render as tap chips beneath, not inline),
// collapsing the blank gap it leaves — mirroring stripInspectDirective.
function stripAskDirective(reply, ask) {
    return String(reply || '')
        .replace(/^ASK:\s*.+$/m, ask.question)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function sendChatTurn(deep) {
    const input = sheetQuery('#claudeComposerInput');
    const send = sheetQuery('#claudeComposerSend');
    if (!input) return;
    const text = (input.value || '').trim();
    // Pending images make an otherwise-empty turn sendable, so an image-only send
    // (screenshot with no words) still goes through.
    const images = pendingImages.map(function(image) {
        return { media_type: image.media_type, data: image.data };
    });
    if (!text && !images.length) return;
    if (send && send.disabled) return;

    removeChatIntro();
    const turn = { role: 'user', content: text };
    if (images.length) turn.images = images;
    appendChatTurn(turn);
    appendMessageBubble('user', text, turn.images);
    input.value = '';
    // The images now live on the sent turn; clear the pending rail.
    pendingImages = [];
    renderPendingImages();

    // A user can paste a pre-drafted entry straight into the composer; surface
    // its Inject & run card directly rather than forcing a re-prompt for Sonnet
    // to re-emit it. Shares extractDraftedEntry with the assistant-reply path.
    const pastedDraft = extractDraftedEntry(text);
    if (pastedDraft) renderDraftedEntryCard(pastedDraft);

    // During an active iterate session every turn re-sends its entry id so the
    // Worker keeps re-serving the cached diff/code seed on follow-ups; outside a
    // session activeIterateEntry is null and no id rides. `deep` is per-message:
    // Fast passes undefined, Deep passes true.
    await requestAssistantReply(activeIterateEntry, deep);
}

// Send the running history to the Worker, render the assistant reply in place
// of a pending bubble, and surface a drafted-entry card when the reply carries
// a fenced ```md block. Shared by the manual chat turn and the iterate seed.
// `entryId` is the iterate session's entry id — supplied on the seed turn and
// re-sent on every follow-up while the session is active. A Worker 404 for the
// seed means no merged PR carries the entry's marker yet, so it's shown as a
// gentle "nothing to iterate on" note rather than an error. The session id is
// established here on success and cleared here on a 404 (keyed on `entryId`
// being truthy), because this is where the swallowed outcome is actually known.
async function requestAssistantReply(entryId, deep) {
    const input = sheetQuery('#claudeComposerInput');
    const send = sheetQuery('#claudeComposerSend');
    const modelToggle = sheetQuery('#claudeComposerModelToggle');
    if (send) send.disabled = true;
    if (modelToggle) modelToggle.disabled = true;
    if (input) input.disabled = true;
    // A background chat-turns hydrate must not replay over a turn in progress —
    // its replay wipes the surface, pending bubble and all. Held for the whole
    // turn and released in the finally alongside the composer.
    chatTurnInFlight = true;

    // A Deep turn routes to a heavier model, so its placeholder reads
    // "Thinking deeply…" rather than the plain "…" — the slower turn should
    // look intentional, not stalled.
    let pending = appendMessageBubble('assistant', deep ? 'Thinking deeply…' : '…');
    if (pending) pending.classList.add('claudeMsg--pending');

    try {
        // The scoped task (if any) rides on every turn so follow-ups need no
        // re-explanation; resolveActiveChatTask reads its title/description live
        // and self-heals a deleted task to unscoped before the send.
        const attachTask = resolveActiveChatTask();
        const result = await chatWithWorker(toWorkerTurns(chatHistory), entryId, attachedFiles, activeChatRepo, suggestedAttachedFiles, deep, attachTask);
        const reply = result.reply;
        const suggestedFiles = result.suggestedFiles || [];
        appendChatTurn({ role: 'assistant', content: reply });
        // The seed (or any follow-up carrying an id) landed: establish/refresh
        // the active repo's iterate session so later turns keep the diff.
        if (entryId) {
            activeIterateEntry = entryId;
            saveIterateEntry();
        }
        const inspectSelector = extractInspectDirective(reply);
        const ask = extractAskDirective(reply);
        // Strip each directive line from the visible prose independently so the
        // two coexist — an ASK reply keeps its question text, an INSPECT reply
        // drops its line, and a reply carrying both is cleaned of both.
        let visible = reply;
        if (inspectSelector) visible = stripInspectDirective(visible);
        if (ask) visible = stripAskDirective(visible, ask);
        if (pending && pending.parentNode) {
            pending.classList.remove('claudeMsg--pending');
            renderAssistantContent(pending, visible);
            // Mount the "Create task" action now that the reply is complete —
            // parse from the raw reply so a fenced ```md entry (or a plain reply)
            // yields the same title/description the paste path would.
            mountCreateTaskAction(pending, reply);
        }
        if (inspectSelector) renderAttachLayoutButton(inspectSelector);
        if (ask) renderAskChips(ask);
        const draft = extractDraftedEntry(reply);
        if (draft) renderDraftedEntryCard(draft);
        if (suggestedFiles.length) addSuggestedFiles(suggestedFiles);
    } catch (e) {
        if (pending && pending.parentNode) {
            pending.classList.remove('claudeMsg--pending');
            if (entryId && e && e.status === 404) {
                // Dead seed — no merged PR carries this marker. Clear the stored
                // iterate id so follow-up turns don't loop retrying it.
                activeIterateEntry = null;
                saveIterateEntry();
                pending.classList.add('claudeMsg--note');
                pending.textContent = 'Nothing to iterate on yet — this run shipped before iterate tracking, so there’s no merged change to build on.';
            } else {
                pending.classList.add('claudeMsg--error');
                pending.textContent = 'Chat failed — ' + (e && e.reason ? e.reason : 'error');
            }
        }
    } finally {
        chatTurnInFlight = false;
        if (send) send.disabled = false;
        if (modelToggle) modelToggle.disabled = false;
        if (input) {
            input.disabled = false;
            try { input.focus(); } catch (err) { /* defensive */ }
        }
    }
}

// ── LAYOUT INSPECTOR ──
// Beneath an assistant reply that carried an `INSPECT: <selector>` directive,
// render an "Attach layout" button labeled with the selector. On tap it
// serializes the live layout for that selector: when the element isn't on
// screen it surfaces a retry notice without sending a turn; when found it sends
// the snapshot as the next user turn so the Worker can diagnose against it.
function renderAttachLayoutButton(selector) {
    const surface = sheetQuery('#claudeChatSurface');
    if (!surface) return null;

    const wrap = document.createElement('div');
    wrap.className = 'claudeInspectAttach';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'claudeInspectBtn';
    btn.textContent = 'Attach layout: ' + selector;

    const notice = document.createElement('p');
    notice.className = 'claudeInspectNotice';
    notice.hidden = true;

    // Reload affordance, surfaced only when the capture is blocked because a
    // newer build is waiting. Reuses the same skipWaiting + reload path the
    // Runs-tab nudge drives.
    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'claudeInspectReload';
    reloadBtn.textContent = 'Reload';
    reloadBtn.hidden = true;
    reloadBtn.addEventListener('click', function() { applyPendingUpdate(); });

    btn.addEventListener('click', function() {
        // Gate on the update-pending flag first: when a newer build is waiting,
        // the on-screen DOM is the OLD bundle (the new SW is installed but not
        // yet controlling), so a measurement would feed the Worker stale
        // telemetry. Refuse to capture and point the user at a reload instead.
        if (updatePending) {
            notice.hidden = false;
            notice.textContent =
                "You're viewing an older build — reload first so the measurement reflects the shipped change";
            reloadBtn.hidden = false;
            return; // do not send a turn
        }
        reloadBtn.hidden = true;
        const result = serializeLayout(selector);
        if (!result || result.found === false) {
            notice.hidden = false;
            notice.textContent =
                "Couldn't find that element on screen — navigate to where it's visible, then tap again";
            return; // leave the button tappable for retry; do not send a turn
        }
        notice.hidden = true;
        const content = 'Live layout for `' + selector + '`:\n```json\n' +
            JSON.stringify(result, null, 2) + '\n```';
        sendInspectTurn(content);
    });

    wrap.appendChild(btn);
    wrap.appendChild(notice);
    wrap.appendChild(reloadBtn);
    surface.appendChild(wrap);
    surface.scrollTop = surface.scrollHeight;
    return wrap;
}

// Send a serialized layout snapshot as the next user turn — mirrors a manual
// chat turn but with content the inspector composed rather than the composer.
// The INSPECT measurement turn is the one meant to diagnose against the diff, so
// it must carry the active iterate entry id when a session is in progress.
async function sendInspectTurn(content) {
    removeChatIntro();
    appendChatTurn({ role: 'user', content: content });
    appendMessageBubble('user', content);
    await requestAssistantReply(activeIterateEntry);
}

// ── ASK CHIPS ──
// Beneath an assistant reply that carried an `ASK:` directive, render a wrapping
// row of tap chips — one per option. Tapping a chip sends that option's exact
// label as the next user turn through the same send path a typed message takes,
// marks the chosen chip with the accent, and disables the whole row so a
// resolved question can't be re-answered (mirroring the INSPECT button settling
// after capture).
function renderAskChips(ask) {
    const surface = sheetQuery('#claudeChatSurface');
    if (!surface) return null;

    const row = document.createElement('div');
    row.className = 'claudeAskChips';

    ask.options.forEach(function(label) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'claudeAskChip';
        chip.textContent = label;
        chip.addEventListener('click', function() {
            if (row.classList.contains('claudeAskChips--answered')) return;
            row.classList.add('claudeAskChips--answered');
            chip.classList.add('claudeAskChip--chosen');
            Array.prototype.forEach.call(row.querySelectorAll('.claudeAskChip'), function(c) {
                c.disabled = true;
            });
            sendAskAnswer(label);
        });
        row.appendChild(chip);
    });

    surface.appendChild(row);
    surface.scrollTop = surface.scrollHeight;
    return row;
}

// Send a tapped ASK chip's label as the next user turn — same path a typed
// message takes, so it carries the active iterate entry id and the current
// deep-think mode exactly as the composer would (attachments/active repo ride
// through chatWithWorker from module state as usual).
async function sendAskAnswer(label) {
    removeChatIntro();
    appendChatTurn({ role: 'user', content: label });
    appendMessageBubble('user', label);
    await requestAssistantReply(activeIterateEntry, chatMode === 'deep');
}

// Seed an iterate chat on `entryId`: switch to the Chat tab, reset the
// conversation, and fire turn 1 carrying the entry id so the Worker resolves
// that entry's merged diff and replies with iterate context. The seed turn
// establishes the ACTIVE repo's iterate session on success (in
// requestAssistantReply), so later turns keep re-sending the id and the diff;
// a 404 there clears it and surfaces a readable note. Callers MUST have already
// framed the workspace on the entry's repo — activeIterateEntry is per-workspace
// and swapped in lockstep with chatHistory, so seeding on the wrong workspace
// would attach the id to another repo's thread. `noteLabel` is the opening
// status bubble. Shared by the RUNS-tab shipped record (startIterateFromRun) and
// a task's ACCEPT-face Iterate control (openIterateForEntry) so the two can't
// drift.
async function seedIterateSession(entryId, noteLabel) {
    setActiveTab('chat');
    if (!isClaudeSheetOpen()) openClaudeSheet();

    chatHistory = [];
    // Seeding replaces the thread, so the prior conversation's stored copies go
    // with it — both the local one and the repo's `chat_turns` rows, or the next
    // hydrate would merge the replaced conversation back in beneath the seed.
    deleteChatHistory(activeChatRepo);
    clearRemoteChatTurns(activeChatRepo);
    const surface = sheetQuery('#claudeChatSurface');
    if (surface) surface.innerHTML = '';
    clearAttachments();

    appendMessageBubble('note', noteLabel);

    // The Worker requires a non-empty messages array even when entry_id is
    // present (the id only adds diff/code context to the system field, it's not
    // a turn), so seed turn 1 with a synthesized opening user message.
    const seedPrompt = 'Walk me through what shipped for this entry and whether it matches the intent.';
    appendChatTurn({ role: 'user', content: seedPrompt });
    appendMessageBubble('user', seedPrompt);

    await requestAssistantReply(entryId);
}

// Seed an iterate chat from a SHIPPED run record (the RUNS tab entry point). The
// record's run is always the active workspace's project, so no workspace swap is
// needed here. Tapping a non-shipped or id-less run is a no-op — iterate needs a
// merged change to build on.
async function startIterateFromRun(rec) {
    if (!rec || rec.status !== 'SHIPPED' || !rec.entryId) return;
    await seedIterateSession(rec.entryId, 'Iterating on “' + (rec.title || 'this run') + '” — pulling the shipped change…');
}

// Open iterate mode on a shipped entry straight from a task's ACCEPT face,
// scoped to `repo` (the task's routed target). The row layer can't import this
// module (the toDoRow → claudeSheet → modals → toDoRow cycle), so main.js
// registers this as the opener via setIterateTaskHandler. Reuses the exact seed
// the RUNS-tab shipped record drives (seedIterateSession). Repo framing comes
// FIRST: setChatWorkspaceRepo performs the same deliberate swap the workspace
// pill does (a no-op when already on `repo` or when it isn't an allowed
// workspace), so the per-workspace iterate id can never attach to the wrong
// thread. Then open/uncollapse the chat surface as the other row entry points do
// (openChatWithTask), fire the seed, and focus the composer so the user can
// describe the change immediately. A 404 (entry cleared from TODO.md or its PR
// reverted) surfaces as a readable note via requestAssistantReply's handler. A
// missing entry id is a no-op.
export function openIterateForEntry(entryId, repo) {
    if (!entryId) return Promise.resolve();
    if (repo && repo !== activeChatRepo) setChatWorkspaceRepo(repo);
    if (window.innerWidth <= MOBILE_MAX_WIDTH) {
        if (!isClaudeSheetOpen()) openClaudeSheet();
    } else {
        document.body.classList.remove('chatPaneCollapsed');
        setChatPaneCollapsed(false);
    }
    // seedIterateSession runs synchronously up to the Worker call, so the surface
    // exists by the time we focus the composer below.
    const p = seedIterateSession(entryId, 'Iterating on this shipped change — pulling the diff…');
    const input = sheetQuery('#claudeComposerInput');
    if (input) { try { input.focus(); } catch (e) { /* defensive */ } }
    return p;
}

// ── PER-RUN MODEL PICK ──
// The Models panel sets which model each workflow runs on for a repo (or
// globally); this is the layer above it — one drafted entry, shipped once, on a
// model chosen for that ship alone. The override is deliberately NOT persisted:
// it belongs to the card in front of you, so a one-off experiment can never
// quietly become the standing setting, and the next draft starts back at the
// repo's default.
//
// Catalog and settings are read lazily — the first drafted card to render pays
// for them — then cached for the session: the catalog once (it is scope-free),
// the settings per repo (they are not). Both reads are best-effort. A failure
// leaves the chip on its inherit face and the ship path unchanged, because a run
// with no override dispatches exactly as it always did; a failed read clears its
// cached promise so the next card retries rather than inheriting the failure.
const RUN_MODEL_SURFACE = 'run';
// The two surfaces the composer's send modes resolve against — Fast sends on
// `chat`, Deep on `deep`. Both are read out of the same cache below.
const CHAT_MODEL_SURFACE = 'chat';
const DEEP_MODEL_SURFACE = 'deep';
let runModelCatalog = null;
let runModelCatalogPromise = null;
const runModelSettingsByRepo = new Map();
const runModelSettingsPromises = new Map();

function ensureRunModelContext(repo) {
    const key = repo || '';
    if (!runModelCatalogPromise) {
        runModelCatalogPromise = Promise.resolve(fetchModelCatalog()).then(function(res) {
            if (res && res.ok) runModelCatalog = res;
            else runModelCatalogPromise = null;
            return runModelCatalog;
        }, function() {
            runModelCatalogPromise = null;
            return null;
        });
    }
    if (!runModelSettingsPromises.has(key)) {
        runModelSettingsPromises.set(key, Promise.resolve(fetchModelSettings(repo)).then(function(res) {
            if (res && res.ok) runModelSettingsByRepo.set(key, res);
            else runModelSettingsPromises.delete(key);
            return runModelSettingsByRepo.get(key) || null;
        }, function() {
            runModelSettingsPromises.delete(key);
            return null;
        }));
    }
    return Promise.all([runModelCatalogPromise, runModelSettingsPromises.get(key)])
        .then(function(pair) {
            return { catalog: pair[0] || runModelCatalog, settings: pair[1] || null };
        });
}

// What a drafted card will actually ship on. The card's own override wins; with
// none, the RUN surface's resolved value for the workspace repo does; and when
// that is empty too the run inherits the workflow's own default — which the
// catalog's `defaults` map can now name, so the chip reads the real id under its
// `default` tag instead of the bare word. `overridden` is what separates a
// bright chip from a dim one, and it is keyed on the pick rather than on the
// resolved value, so picking the model that was already the default still reads
// as a deliberate per-run choice.
//
// `model` stays the id the ship path and the confirm copy reason about: the
// workflow default is what the run inherits, not something this card selected,
// so naming it on the chip must not turn an inheriting ship into an explicit
// pick. Only `chipText` reads the defaults map.
export function resolveRunModel(override, settings, defaults) {
    const picked = typeof override === 'string' ? override.trim() : '';
    const entry = ((settings && settings.surfaces) || {})[RUN_MODEL_SURFACE] || {};
    const inherited = typeof entry.value === 'string' ? entry.value.trim() : '';
    const chip = resolveSurfaceChip(RUN_MODEL_SURFACE, settings, defaults, 'repo');
    return {
        model: picked || inherited,
        inherited: inherited,
        overridden: !!picked,
        chipText: picked || chip.text,
        sourceTag: picked ? '' : 'default',
    };
}

// The confirm step's copy for one effective pick. A third-party model on a repo
// that does not auto-merge third-party ships does NOT deploy — it opens a PR and
// waits for a human — so "Ship it" and "this deploys to your live app" would both
// be false. Everything else keeps the existing wording verbatim.
//
// A model id the catalog doesn't carry keeps the plan-lane copy rather than
// defaulting to the cautious side: the catalog is the only authority on who
// bills, and telling someone their ordinary Anthropic run merely opens a PR is
// the more damaging of the two possible lies.
export function shipCopyForModel(options) {
    const o = options || {};
    const provider = providerForModel(o.catalog, o.model);
    const thirdParty = !!provider && provider !== 'anthropic';
    const opensPr = thirdParty && !o.autoMerge3p;
    return {
        thirdParty: thirdParty,
        opensPr: opensPr,
        shipLabel: opensPr ? 'Ship → PR' : 'Ship it',
        warnText: opensPr
            ? 'This opens a PR — merge it yourself to deploy.'
            : 'This ships to main and deploys to your live app.',
        subline: opensPr ? 'api · waits for merge' : '',
    };
}

// Every Anthropic model id the pipeline dispatches names its own family, so a
// run's billing lane is readable off the id alone.
const ANTHROPIC_MODEL_HINTS = ['claude', 'opus', 'sonnet', 'haiku'];

// The Runs-tab tag for a record's model: the bare id for an API-billed run,
// nothing at all otherwise. Deliberately id-matched rather than catalog-looked-up
// — a run row renders on load, long before (and often entirely without) a
// catalog fetch, and a tag that appeared a second late would read as a state
// change rather than a fact. Anthropic and absent models add nothing, so the
// list stays quiet except where the billing actually differs.
export function runModelTagText(model) {
    const m = typeof model === 'string' ? model.trim() : '';
    if (!m) return '';
    const lower = m.toLowerCase();
    for (let i = 0; i < ANTHROPIC_MODEL_HINTS.length; i++) {
        if (lower.indexOf(ANTHROPIC_MODEL_HINTS[i]) !== -1) return '';
    }
    return m;
}

// ── DRAFTED ENTRY CARD ──
// A green card below the assistant message holding the drafted entry text and
// a single "Inject & run" action. The action first swaps to an inline confirm
// ("This ships to main and deploys to your live app." → Ship it / Cancel)
// before injecting and dispatching, so a tap can't ship by accident.
function renderDraftedEntryCard(entryText) {
    const surface = sheetQuery('#claudeChatSurface');
    if (!surface) return;

    const card = document.createElement('div');
    card.className = 'claudeDraftCard';

    const pre = document.createElement('pre');
    pre.className = 'claudeDraftEntry';
    pre.textContent = entryText;
    card.appendChild(pre);

    const actions = document.createElement('div');
    actions.className = 'claudeDraftActions';

    // The per-run pick, held on this card and nowhere else — '' means inherit.
    // The workspace repo is read once, at render, so a workspace swap behind an
    // already-drawn card can never retarget the pick the card is showing.
    const modelRepo = activeChatRepo;
    let modelOverride = '';
    let modelCatalog = null;
    let modelSettings = null;

    const modelWrap = document.createElement('div');
    modelWrap.className = 'claudeDraftModel';

    const modelRow = document.createElement('div');
    modelRow.className = 'claudeDraftModelRow';

    const modelChip = document.createElement('button');
    modelChip.type = 'button';
    modelChip.className = 'claudeDraftModelChip';
    modelChip.setAttribute('aria-haspopup', 'menu');
    modelChip.setAttribute('aria-expanded', 'false');
    const modelName = document.createElement('span');
    modelName.className = 'claudeDraftModelName';
    const modelSourceTag = document.createElement('span');
    modelSourceTag.className = 'claudeDraftModelTag';
    modelChip.appendChild(modelName);
    modelChip.appendChild(modelSourceTag);

    // Revert-to-inherit, a SIBLING of the chip rather than a child: a button
    // nested inside a button is invalid markup and the inner one's clicks are
    // unreliable across engines.
    const modelClear = document.createElement('button');
    modelClear.type = 'button';
    modelClear.className = 'claudeDraftModelClear';
    modelClear.textContent = '✕';
    modelClear.setAttribute('aria-label', 'Use the default model for this repo');
    modelClear.hidden = true;

    modelRow.appendChild(modelChip);
    modelRow.appendChild(modelClear);

    const modelSub = document.createElement('div');
    modelSub.className = 'claudeDraftModelSub';
    modelSub.hidden = true;

    const modelMenu = document.createElement('div');
    modelMenu.className = 'claudeDraftModelMenu';
    modelMenu.setAttribute('role', 'menu');
    modelMenu.hidden = true;
    // Clicks inside the popover belong to the picker; never let them reach the
    // document-level outside-click close (the send-mode menu's guard).
    modelMenu.addEventListener('click', function(event) { event.stopPropagation(); });

    modelWrap.appendChild(modelRow);
    modelWrap.appendChild(modelSub);
    modelWrap.appendChild(modelMenu);

    const injectBtn = document.createElement('button');
    injectBtn.type = 'button';
    injectBtn.className = 'claudeDraftInject';
    injectBtn.textContent = 'Inject & run';

    const confirm = document.createElement('div');
    confirm.className = 'claudeDraftConfirm';
    confirm.hidden = true;
    const warn = document.createElement('p');
    warn.className = 'claudeDraftConfirmWarn';
    warn.textContent = 'This ships to main and deploys to your live app.';
    const confirmRow = document.createElement('div');
    confirmRow.className = 'claudeDraftConfirmRow';
    const shipBtn = document.createElement('button');
    shipBtn.type = 'button';
    shipBtn.className = 'claudeDraftShip';
    shipBtn.textContent = 'Ship it';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'claudeDraftCancel';
    cancelBtn.textContent = 'Cancel';
    confirmRow.appendChild(shipBtn);
    confirmRow.appendChild(cancelBtn);
    confirm.appendChild(warn);
    confirm.appendChild(confirmRow);

    // The chip's face AND the confirm step's copy are one decision, repainted
    // together: the button that says "Ship it" and the chip that says which
    // model it ships on must never disagree about whether this run deploys.
    function paintModel() {
        const resolved = resolveRunModel(modelOverride, modelSettings, modelCatalog && modelCatalog.defaults);
        modelName.textContent = resolved.chipText;
        modelSourceTag.textContent = resolved.sourceTag;
        modelSourceTag.hidden = !resolved.sourceTag;
        modelChip.classList.toggle('claudeDraftModelChip--set', resolved.overridden);
        modelClear.hidden = !resolved.overridden;
        modelChip.title = resolved.overridden
            ? 'This ship runs on ' + resolved.model
            : 'Default model for this repo — tap to pick one for this ship';

        const copy = shipCopyForModel({
            catalog: modelCatalog,
            model: resolved.model,
            autoMerge3p: readAutoMerge3p(modelSettings),
        });
        modelSub.textContent = copy.subline;
        modelSub.hidden = !copy.subline;
        shipBtn.textContent = copy.shipLabel;
        warn.textContent = copy.warnText;
    }

    // ── PICKER POPOVER ──
    // Same three-way dismissal the send-mode menu uses (pick / outside click /
    // Escape), with both document listeners torn down on close so a card that
    // scrolls out of the transcript leaves nothing behind.
    let outsideHandler = null;
    let escapeHandler = null;

    function closeModelMenu() {
        if (modelMenu.hidden) return;
        modelMenu.hidden = true;
        modelChip.setAttribute('aria-expanded', 'false');
        if (outsideHandler) document.removeEventListener('click', outsideHandler);
        if (escapeHandler) document.removeEventListener('keydown', escapeHandler, true);
        outsideHandler = null;
        escapeHandler = null;
    }

    function openModelMenu() {
        // No catalog means nothing to offer. Opening an empty popover would read
        // as "there are no other models", which is a different claim from "we
        // haven't been able to ask yet".
        if (!modelCatalog) return;
        modelMenu.innerHTML = '';
        const resolved = resolveRunModel(modelOverride, modelSettings, modelCatalog && modelCatalog.defaults);
        modelMenu.appendChild(buildPickerList({
            catalog: modelCatalog,
            surface: RUN_MODEL_SURFACE,
            current: modelOverride,
            // Inherit names what it falls back to, so the row is a real preview
            // rather than a blank promise.
            inheritHint: resolved.inherited || 'workflow default',
            onPick: function(model) {
                modelOverride = model || '';
                closeModelMenu();
                paintModel();
            },
        }));
        modelMenu.hidden = false;
        modelChip.setAttribute('aria-expanded', 'true');

        // The click that opened this is still bubbling; the wrap test below is
        // what keeps it from closing the popover on the way up.
        outsideHandler = function(event) {
            if (modelWrap.contains(event.target)) return;
            closeModelMenu();
        };
        document.addEventListener('click', outsideHandler);
        // Capture phase so Escape peels back the popover and stops there — the
        // sheet's own document-level Escape would otherwise also close the sheet
        // underneath it.
        escapeHandler = function(event) {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            closeModelMenu();
            try { modelChip.focus(); } catch (e) { /* defensive */ }
        };
        document.addEventListener('keydown', escapeHandler, true);
    }

    modelChip.addEventListener('click', function() {
        if (modelMenu.hidden) openModelMenu();
        else closeModelMenu();
    });
    modelClear.addEventListener('click', function() {
        modelOverride = '';
        closeModelMenu();
        paintModel();
    });

    injectBtn.addEventListener('click', function() {
        closeModelMenu();
        injectBtn.hidden = true;
        confirm.hidden = false;
    });
    cancelBtn.addEventListener('click', function() {
        confirm.hidden = true;
        injectBtn.hidden = false;
    });
    shipBtn.addEventListener('click', function() {
        closeModelMenu();
        shipDraftedEntry(entryText, card, modelOverride);
    });

    // The chip is FUSED to the action row rather than stacked above it: chip
    // then "Inject & run", on one line. It stays put when the row flips to the
    // confirm step, so the model can still be read (and changed) at the moment
    // the copy under it is describing what that model will do.
    const actionRow = document.createElement('div');
    actionRow.className = 'claudeDraftActionRow';
    actionRow.appendChild(modelWrap);
    actionRow.appendChild(injectBtn);
    actions.appendChild(actionRow);
    actions.appendChild(confirm);
    card.appendChild(actions);
    surface.appendChild(card);
    surface.scrollTop = surface.scrollHeight;

    // Paint the inherit face immediately so the row never renders chipless, then
    // repaint once the (lazy, session-cached) catalog + settings land. A card
    // dismissed before the read resolves is left alone.
    paintModel();
    ensureRunModelContext(modelRepo).then(function(ctx) {
        if (!document.contains(card)) return;
        modelCatalog = (ctx && ctx.catalog) || null;
        modelSettings = (ctx && ctx.settings) || null;
        paintModel();
    });

    return card;
}

// `modelOverride` is the card's per-run pick ('' when it inherits). It rides the
// dispatch only when set, so an inheriting ship sends exactly the payload it
// always did and the Worker's own precedence chain decides the model.
async function shipDraftedEntry(entryText, card, modelOverride) {
    const shipBtn = card && card.querySelector('.claudeDraftShip');
    const cancelBtn = card && card.querySelector('.claudeDraftCancel');

    // Per-project single-run guard: the chat workspace tracks the open project,
    // so a chat ship lands under that project's active-run key — the same key
    // the viewer reads and writes. Refuse only when THIS project already has a
    // fresh active run (here or from the viewer); a run on another project must
    // not block. The viewer mirrors this guard for its own dispatches.
    const project = activeProjectNameForViewer();
    if (readActiveRun(project)) {
        showInjectToast('A run is already in progress for this project');
        return;
    }
    // Mutual exclusion with a manual redeploy on this project: the viewer's
    // Redeploy owns the same per-project slot while a publish is in flight, so
    // a chat ship must not dispatch a run on top of it.
    if (readActiveRedeploy(project)) {
        showInjectToast('A redeploy is in progress for this project');
        return;
    }

    if (shipBtn) shipBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    const entryId = mintEntryId();
    const entry = embedEntryMarker(entryText, entryId);
    // Ship to the active workspace repo, not the Worker's default. Both calls
    // carry the same target so the entry lands in the selected repo's TODO.md
    // and the run dispatches against that same repo.
    const target = { repo: activeChatRepo, file_path: 'TODO.md' };
    const injectResult = await injectEntry({ entry: entry, id: entryId, target: target });
    if (!injectResult.ok) {
        markDraftCardError(card, 'Inject failed — ' + (injectResult.reason || 'error'));
        return;
    }

    // Create a real task for this entry so the shipped work is represented in a
    // list — moving through DRAFT → REVIEW and showing its full ACCEPT face
    // (ACCEPT & CLOSE, REVERT, OPEN IN TODO.MD, COPY CONTEXT, ITERATE) — exactly
    // as an entry injected from a task is. Chat's Inject & run otherwise ships an
    // entry with nothing representing it, the same gap derive proposals had, so
    // it reuses the same `materializeEntryTodo` funnel: create a todo whose
    // description is the ENTRY AS INJECTED (`entry`, marker and all — never a
    // summary, the bug the derive path hit) and whose title is the entry's
    // headline via the shared `deriveRunTitle`. Chat can target a workspace repo
    // other than the on-screen project's, so the task lands in the project routed
    // to the TARGET repo; when nothing routes there, skip creation and say so in
    // the chat rather than attaching it to the wrong list. Best-effort: a failed
    // creation must never turn a ship that already injected/dispatched into a
    // surfaced error.
    const taskProject = projectForRepo(activeChatRepo);
    if (taskProject) {
        try {
            const createdId = await materializeEntryTodo(
                taskProject,
                deriveRunTitle(entryText),
                entry,
                entryId
            );
            if (createdId) {
                // The entry id already rode in the todo's single insert (via
                // materializeEntryTodo → addEntryTodo), so the row resolves its
                // shipped state without this stamp. Keep stamping so the local
                // amber-lighting fires and a genuine link failure still surfaces —
                // no agent_queue row exists for a chat dispatch, so this is the
                // only place a failed link is visible. A failed stamp orphans a
                // task from work that shipped (the first bug this project hit), so
                // surface it rather than swallowing it, matching shipEntryForTodo.
                const stamp = listLogic.stampTodoEntryId(createdId, entryId);
                if (!stamp || stamp.ok === false) {
                    showInjectToast('Run dispatched, but couldn’t link this task to its entry', 'error');
                }
            }
        } catch (e) { /* task creation is best-effort — never fail the ship on it */ }
    } else {
        appendMessageBubble('assistant',
            'Injected into ' + activeChatRepo + ', which no project here routes to — no task was created for it.');
    }

    const correlationId = mintEntryId();
    const dispatchResult = await dispatchRun({
        mode: 'entry',
        entryId: entryId,
        correlationId: correlationId,
        target: target,
        model: modelOverride || undefined,
    });
    if (!dispatchResult.ok) {
        markDraftCardError(card, 'Run failed — ' + (dispatchResult.reason || 'error'));
        return;
    }

    const dispatchedAt = Date.now();
    const record = {
        entryId: entryId,
        correlationId: correlationId,
        title: deriveRunTitle(entryText),
        status: 'QUEUED',
        dispatchedAt: dispatchedAt,
        // Persist the repo this run was dispatched against so status polling
        // queries the same repo, not the Worker's default. Without this, a run
        // shipped to a non-default workspace can never be confirmed.
        repo: activeChatRepo,
        // The project this run belongs to, so the poller can free that
        // project's run guard at terminal even when its viewer isn't mounted.
        project: project,
        // The Agent-board row this run was handed off from (via "Discuss in
        // chat" on a needs_words card), or null. Persisted on the record so the
        // terminal transition in setRunRecordStatus can settle that row — even
        // after a reload, when the resumed poller drives the reconcile.
        agentRowId: activeHandoffRow,
    };
    // The model this run ACTUALLY dispatched on, as the Worker resolved it —
    // not the override we asked for, which is empty whenever the run inherits.
    // A chat ship creates no agent_queue row, so this local record is the only
    // place that fact is written down; without it the Runs tab can't tell an
    // API-billed run from a plan one. Absent keys stay absent rather than
    // guessing, so an older Worker leaves the record unstamped.
    if (dispatchResult.model) record.model = dispatchResult.model;
    if (dispatchResult.billing) record.billing = dispatchResult.billing;
    // The merge gate this run dispatched under. A run with auto-merge off
    // finishes green while its PR sits open, so the entry stays unchecked —
    // which the reconcile would otherwise read as "the routine skipped this".
    // Stamping the gate here is what lets it tell that apart from "waiting on a
    // merge the user owes" (see reconcileSuccessConclusion). The workflow input
    // arrives as a string on some Worker versions, so accept both forms; an
    // older Worker that reports nothing leaves the run gated-open (true), which
    // is the historical behavior.
    record.autoMerge = !(dispatchResult.auto_merge === false || dispatchResult.auto_merge === 'false');
    runRecords.unshift(record);
    saveRunRecords();
    // Drive the viewer's per-project "Running" pill for this same run: write
    // the active-run entry under the project's key so a mounted viewer attaches
    // its pill immediately (via the change event) and a re-mount re-attaches.
    writeActiveRun(project, {
        correlationId: correlationId,
        project: project,
        target: { repo: activeChatRepo, file_path: 'TODO.md' },
        dispatchedAt: dispatchedAt,
    });
    renderRunsList();
    startRunPoller(record);

    markDraftCardShipped(card);
    setActiveTab('runs');
}

function markDraftCardError(card, message) {
    if (!card) return;
    const actions = card.querySelector('.claudeDraftActions');
    if (actions) actions.innerHTML = '';
    const err = document.createElement('p');
    err.className = 'claudeDraftError';
    err.textContent = message;
    card.appendChild(err);
}

function markDraftCardShipped(card) {
    if (!card) return;
    card.classList.add('claudeDraftCard--shipped');
    const actions = card.querySelector('.claudeDraftActions');
    if (actions) actions.innerHTML = '';
    const note = document.createElement('p');
    note.className = 'claudeDraftShippedNote';
    note.textContent = 'Shipped — tracking in Runs.';
    card.appendChild(note);
}

// The COVERAGE tab's panel — an empty scroll container that renderCoverageView
// fills with the assignmentCoverage module's pane on entry / queue change /
// assignment resolve. Hidden until the tab is selected (and the tab itself is
// hidden unless the active project carries an assignment).
function buildCoverageView() {
    const view = document.createElement('div');
    view.id = 'claudeCoverageView';
    view.className = 'claudeView';
    view.setAttribute('role', 'tabpanel');
    view.hidden = true;
    return view;
}

function buildRunsView() {
    const view = document.createElement('div');
    view.id = 'claudeRunsView';
    view.className = 'claudeView';
    view.setAttribute('role', 'tabpanel');
    view.hidden = true;

    // Reload nudge — hidden until a newer build is waiting. Sits above the run
    // list so the user sees it the moment they open Runs after a ship.
    const nudge = document.createElement('div');
    nudge.id = 'claudeUpdateNudge';
    nudge.className = 'claudeUpdateNudge';
    nudge.hidden = true;
    const nudgeText = document.createElement('span');
    nudgeText.className = 'claudeUpdateNudgeText';
    nudgeText.textContent = 'A newer build is ready — reload to see your change';
    const nudgeBtn = document.createElement('button');
    nudgeBtn.id = 'claudeUpdateReload';
    nudgeBtn.type = 'button';
    nudgeBtn.className = 'claudeUpdateReload';
    nudgeBtn.textContent = 'Reload';
    nudgeBtn.addEventListener('click', function() {
        // If there's nothing left to apply, the cue is stale — clear it and
        // hide the nudge instead of leaving a dead button on screen.
        if (!applyPendingUpdate()) {
            updatePending = false;
            renderUpdateNudge();
        }
    });
    nudge.appendChild(nudgeText);
    nudge.appendChild(nudgeBtn);

    const list = document.createElement('div');
    list.id = 'claudeRunsList';
    list.className = 'claudeRunsList';

    const newBtn = document.createElement('button');
    newBtn.id = 'claudeRunsNew';
    newBtn.type = 'button';
    newBtn.className = 'claudeRunsNew';
    newBtn.textContent = '+ New';
    // Authoring lives in the Chat surface — the affordance hands the user
    // there and focuses the composer so they can start drafting an entry.
    newBtn.addEventListener('click', function() {
        setActiveTab('chat');
        clearAttachments();
        const input = sheetQuery('#claudeComposerInput');
        if (input) { try { input.focus(); } catch (e) { /* defensive */ } }
    });

    view.appendChild(nudge);
    view.appendChild(list);
    view.appendChild(newBtn);
    return view;
}

// Toggle the Runs-tab reload nudge to mirror the update-pending flag. Called on
// mount (to catch a worker that was already waiting before this mount) and from
// the `appUpdateAvailable` listener.
function renderUpdateNudge() {
    const nudge = sheetQuery('#claudeUpdateNudge');
    if (!nudge) return;
    // Show only when the flag is set AND a worker is genuinely waiting. Gating
    // on hasPendingUpdate() keeps a stale flag from surfacing a Reload button
    // that would no-op once the update has already applied.
    nudge.hidden = !(updatePending && hasPendingUpdate());
}

// ── RUNS LIST ──
const RUN_STATUS_LABEL = {
    QUEUED: 'Queued',
    RUNNING: 'Running',
    SHIPPED: 'Shipped',
    FAILED: 'Failed',
    NOCHANGE: 'No change',
    // The run finished green but its PR is still open behind a manual merge:
    // not shipped, not skipped, and not terminal — it promotes to SHIPPED off
    // the shipped-marker cache once the user merges.
    AWAITING: 'Awaiting merge',
};

// The only GitHub workflow conclusions that are positive proof of failure.
// Any other completed conclusion (success aside) leaves the outcome
// unconfirmed rather than asserting FAILED.
const FAILURE_CONCLUSIONS = ['failure', 'cancelled', 'timed_out'];

// ── QUEUE-SOURCED RUNS ──
// The RUNS tab reads the `agent_queue` store as its primary source so a run
// dispatched from ANY device (the task row, the detail pane, or the coverage
// tab's Derive) shows up here — not only chat-shipped runs, which are the ones
// captured in the localStorage `runRecords` fallback. Queue rows are already
// project-scoped and cross-device by construction (RLS scopes them to the user;
// `getQueueRows()` returns the loaded project's rows), and the store's own
// dispatch reconciler polls in-flight rows by their persisted `correlation_id`
// and settles them, notifying via `onQueueChange` — so live status here needs no
// separate poller, just a repaint on that subscription.
//
// Field mapping queue row → run record: entry_id→entryId, correlation_id→
// correlationId, id→agentRowId, run_id→runId, pr_number/pr_url pass through,
// created_at→dispatchedAt (for ordering), project resolved from the loaded
// project, repo from that project's routed inject target, title derived from the
// row's stashed `draft` entry or the linked todo (never stored twice), and
// `state` mapped to the run status below.
const QUEUE_STATE_TO_STATUS = {
    dispatched: 'QUEUED',
    running: 'RUNNING',
    shipped: 'SHIPPED',
    failed: 'FAILED',
    no_change: 'NOCHANGE',
};

// Session-scoped revert state for queue-derived rows, keyed by entry id. Queue
// rows aren't held in `runRecords`, so their post-revert guard (`reverted`, or a
// pending revert PR url) can't ride `saveRunRecords`; hold it here so a re-render
// — which rebuilds every queue-derived record from scratch — preserves the guard
// that stops a shipped change being reverted twice.
const queueRunRevertState = new Map();

// The workspace repo a project's runs target, resolved from its routed inject
// target the same way the chat workspace auto-swap does. Null when the project
// has no routed target (the Worker falls back to its default repo for polling).
function repoForProject(projectName) {
    if (!projectName) return null;
    let targetId = null;
    try { targetId = listLogic.getProjectTargetId(projectName); } catch (e) { targetId = null; }
    if (!targetId) return null;
    const targets = getCachedTargets();
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] && targets[i].id === targetId) return targets[i].repo || null;
    }
    return null;
}

// Parse an ISO timestamp to epoch ms for ordering; 0 when absent/unparseable so
// a row with no created_at sorts oldest rather than throwing.
function parseIsoMs(value) {
    if (!value) return 0;
    const t = Date.parse(value);
    return isNaN(t) ? 0 : t;
}

// Derive a queue run's title WITHOUT storing a second copy: prefer the stashed
// draft entry (what the row shipped), else the linked todo's title, else its
// description's first line. Keeps the title in lockstep with an edited entry.
function titleForQueueRow(row, itemsById) {
    if (typeof row.draft === 'string' && row.draft.trim()) return deriveRunTitle(row.draft);
    const item = (row.todo_id != null && itemsById) ? itemsById[row.todo_id] : null;
    if (item) {
        const t = (item.tit || '').trim();
        if (t) return t;
        if (item.desc) return deriveRunTitle(item.desc);
    }
    return 'Untitled entry';
}

// Build an id → todo item map for the loaded project so queue rows can resolve a
// title from their linked todo. Empty on any failure — the caller falls back to
// 'Untitled entry'.
function buildItemsById(projectName) {
    const map = {};
    if (!projectName) return map;
    let items = [];
    try { items = listLogic.listItems(projectName) || []; } catch (e) { items = []; }
    items.forEach(function(it) { if (it && it.id != null) map[it.id] = it; });
    return map;
}

// Build an entryId → todo item map for the loaded project so a shipped TODO.md
// marker can resolve back to the todo that injected it — the source of both its
// title and its project scope. Empty on any failure.
function buildItemsByEntryId(projectName) {
    const map = {};
    if (!projectName) return map;
    let items = [];
    try { items = listLogic.listItems(projectName) || []; } catch (e) { items = []; }
    items.forEach(function(it) { if (it && it.entryId) map[it.entryId] = it; });
    return map;
}

// Build shipped-entry records from the project repo's TODO.md marker cache — the
// complete, cross-device record of what shipped, regardless of how it was
// dispatched. A run started via Run backlog or an entry's own Run pill never gets
// an agent_queue row, so it's invisible to buildQueueRunRecords; its `[x]` entry
// in TODO.md is the only trace, and this reads that.
//
// The spine is the shipped marker set (getShippedMarkersForRepo) for the loaded
// project's routed repo. Each shipped id is joined back to the todo that injected
// it (by entry_id) for its title and — critically — its project scope: the marker
// cache is repo-scoped and one repo can back several projects, so an id with no
// linked todo in THIS project belongs to another project sharing the repo (or has
// no todo at all) and is skipped. That join also supplies the title without a
// second TODO.md read (the marker cache holds ids, not text).
//
// Entries already represented by a queue record or a local record are skipped
// (`skipEntryIds`) so the same shipped change isn't listed twice — the queue row
// carries richer detail (status, PR) and wins.
function buildShippedEntryRecords(projectName, skipEntryIds) {
    if (!projectName) return [];
    const repo = repoForProject(projectName);
    if (!repo) return [];
    const shippedIds = getShippedMarkersForRepo(repo);
    if (!shippedIds.length) return [];
    const itemsByEntryId = buildItemsByEntryId(projectName);
    const records = [];
    shippedIds.forEach(function(entryId) {
        if (!entryId) return;
        if (skipEntryIds && skipEntryIds.has(entryId)) return;
        const item = itemsByEntryId[entryId];
        // No linked todo in this project → the entry is another project's (shared
        // repo) or has no todo; either way it isn't scoped here. Skip it.
        if (!item) return;
        const title = (item.tit || '').trim() || (item.desc ? deriveRunTitle(item.desc) : 'Untitled entry');
        const rec = {
            entryId: entryId,
            correlationId: null,
            title: title,
            status: 'SHIPPED',
            // The marker set has no timestamps; the todo's shipped_at (stamped
            // when its run settled) orders these against created_at-ordered queue
            // records. Absent shipped_at sorts oldest rather than jumping around.
            dispatchedAt: parseIsoMs(item.shippedAt),
            repo: repo,
            project: projectName,
            agentRowId: null,
            runId: null,
            // Cross-device like a queue record (rebuilt from scratch each render,
            // never held in runRecords), so its revert guard rides
            // queueRunRevertState keyed by entry id rather than saveRunRecords.
            __fromMarker: true,
        };
        const side = queueRunRevertState.get(entryId);
        if (side) {
            if (side.reverted) rec.reverted = true;
            if (side.revertPrUrl) rec.revertPrUrl = side.revertPrUrl;
        }
        records.push(rec);
    });
    return records;
}

// Map the loaded project's `agent_queue` rows to run-record-shaped objects for the
// RUNS list. Only rows in a dispatched-run state (dispatched/running/shipped/
// failed/no_change) become records; pre-dispatch states (drafted, needs_words,
// proposed, …) are not runs and are skipped.
function buildQueueRunRecords() {
    const rows = getQueueRows();
    if (!rows || !rows.length) return [];
    const projectName = getLoadedProjectName();
    const repo = repoForProject(projectName);
    let itemsById = null;
    const records = [];
    rows.forEach(function(row) {
        if (!row) return;
        const status = QUEUE_STATE_TO_STATUS[row.state];
        if (!status) return;
        if (itemsById === null) itemsById = buildItemsById(projectName);
        const rec = {
            entryId: row.entry_id || null,
            correlationId: row.correlation_id || null,
            title: titleForQueueRow(row, itemsById),
            status: status,
            dispatchedAt: parseIsoMs(row.created_at),
            repo: repo,
            project: projectName,
            agentRowId: row.id,
            runId: row.run_id != null ? row.run_id : null,
            // Flags this record as queue-derived (not a localStorage record), so
            // the revert path persists its guard in queueRunRevertState.
            __fromQueue: true,
        };
        if (row.pr_number != null) rec.pr_number = row.pr_number;
        if (row.pr_url) rec.pr_url = row.pr_url;
        // The model the run dispatched on, stamped at kickoff. Queue rows are the
        // cross-device record, so this is what makes an API-billed run legible on
        // a device that never saw the ship.
        if (row.model) rec.model = row.model;
        // A no-change row already carries the agent's closing summary in
        // failure_reason — surface it without a second fetch.
        if (status === 'NOCHANGE' && typeof row.failure_reason === 'string') {
            rec.result = row.failure_reason;
        }
        const side = row.entry_id ? queueRunRevertState.get(row.entry_id) : null;
        if (side) {
            if (side.reverted) rec.reverted = true;
            if (side.revertPrUrl) rec.revertPrUrl = side.revertPrUrl;
        }
        records.push(rec);
    });
    return records;
}

// Whether a localStorage fallback record should show for the active project. The
// queue-sourced list is project-scoped; the local fallback keeps its records
// visible when no project is active (unknown) or when the record predates the
// `project` field (legacy), and otherwise scopes to the active project so the
// list switches with the selection.
function localRecordVisible(rec, activeProject) {
    if (!activeProject) return true;
    if (rec.project == null || rec.project === '') return true;
    return rec.project === activeProject;
}

function byDispatchedDesc(a, b) {
    return (b.dispatchedAt || 0) - (a.dispatchedAt || 0);
}

// localStorage is a FALLBACK, not a parallel truth: once a queue row exists for a
// record's entry (the cross-device record of that same dispatch), drop the local
// copy so the two lists can't disagree. Stops any poller the pruned record owned.
function pruneMatchedLocalRecords(queueEntryIds) {
    if (!queueEntryIds || !queueEntryIds.size) return;
    let changed = false;
    runRecords = runRecords.filter(function(rec) {
        if (rec.entryId && queueEntryIds.has(rec.entryId)) {
            if (rec.correlationId) stopRunPoller(rec.correlationId);
            changed = true;
            return false;
        }
        return true;
    });
    if (changed) saveRunRecords();
}

// The runs to render, newest-first, from three sources unioned by entry id so no
// shipped change is listed twice:
//   1. queue records — every dispatched agent_queue row (in-flight and shipped),
//      the richest source (status, PR);
//   2. shipped-entry records — every `[x]` entry in the project repo's TODO.md
//      with NO queue row (runs dispatched via Run backlog or an entry's Run pill,
//      which the queue never sees) so the list is the complete shipped record;
//   3. localStorage fallback records with no matching queue row (chat-shipped
//      runs on this device).
// The shipped spine is unioned with the queue's in-flight rows (source 1), so a
// run mid-flight — unchecked in TODO.md, thus absent from the shipped set —
// still appears via its queue row and settles into place when it lands.
function getDisplayRunRecords() {
    const activeProject = activeProjectNameForViewer();
    const queueRecords = buildQueueRunRecords();
    const queueEntryIds = new Set();
    queueRecords.forEach(function(r) { if (r.entryId) queueEntryIds.add(r.entryId); });
    pruneMatchedLocalRecords(queueEntryIds);
    const localRecords = runRecords.filter(function(rec) {
        return localRecordVisible(rec, activeProject);
    });
    // Skip any shipped marker already covered by a queue or local record so the
    // same change isn't listed twice; the richer record wins.
    const covered = new Set(queueEntryIds);
    localRecords.forEach(function(rec) { if (rec.entryId) covered.add(rec.entryId); });
    const shippedRecords = buildShippedEntryRecords(getLoadedProjectName(), covered);
    // ONE ordering for every combination of sources: dispatch time, descending.
    // A local-only list must not fall back to `runRecords`' insertion order —
    // that order is only incidentally newest-first (dispatch inserts at the head)
    // and nothing enforces it: `trackDispatchedRun` accepts an explicit
    // `dispatchedAt`, and records persisted by earlier versions arrive in
    // whatever order they were stored. Selecting the ordering by which sources
    // happen to be loaded is what let the same project read newest-first on one
    // device and not on the device that dispatched the runs. The concat is a
    // no-op when the other two arrays are empty, so one sorted path covers all.
    return queueRecords.concat(shippedRecords).concat(localRecords).sort(byDispatchedDesc);
}

function renderRunsList() {
    const list = sheetQuery('#claudeRunsList');
    if (!list) return;
    list.innerHTML = '';
    const display = getDisplayRunRecords();
    if (!display.length) {
        const empty = document.createElement('p');
        empty.id = 'claudeRunsEmpty';
        empty.className = 'claudeRunsEmpty';
        empty.textContent = 'No runs yet — tap + New to start';
        list.appendChild(empty);
        return;
    }
    display.forEach(function(rec) {
        list.appendChild(buildRunRow(rec));
    });
    // The Clear-completed affordance only clears localStorage records (queue rows
    // are the pipeline's own record), so its count comes from `runRecords`.
    const clearableCount = runRecords.filter(isClearableRun).length;
    if (clearableCount) {
        list.appendChild(buildClearCompleted(clearableCount));
    }
}

// Low-emphasis "Clear completed" affordance pinned beneath the last run row.
// Rendered only when at least one clearable record exists. Tapping it swaps to
// an inline confirm so a stray tap can't wipe rows; confirming removes every
// clearable record (SHIPPED/FAILED/unconfirmed), leaving in-flight runs intact.
function buildClearCompleted(count) {
    const wrap = document.createElement('div');
    wrap.className = 'claudeRunsClearWrap';

    const btn = document.createElement('button');
    btn.id = 'claudeRunsClear';
    btn.type = 'button';
    btn.className = 'claudeRunsClearBtn';
    btn.textContent = 'Clear completed';

    const confirm = document.createElement('div');
    confirm.className = 'claudeRunsClearConfirm';
    confirm.hidden = true;

    const warn = document.createElement('span');
    warn.className = 'claudeRunsClearConfirmWarn';
    warn.textContent = 'Clear ' + count + ' completed run' +
        (count === 1 ? '' : 's') + '? In-flight runs stay.';

    const yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    yesBtn.className = 'claudeRunsClearYes';
    yesBtn.textContent = 'Clear';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'claudeRunsClearCancel';
    cancelBtn.textContent = 'Cancel';

    confirm.appendChild(warn);
    confirm.appendChild(yesBtn);
    confirm.appendChild(cancelBtn);

    btn.addEventListener('click', function() {
        btn.hidden = true;
        confirm.hidden = false;
    });
    cancelBtn.addEventListener('click', function() {
        confirm.hidden = true;
        btn.hidden = false;
    });
    yesBtn.addEventListener('click', clearCompletedRuns);

    wrap.appendChild(btn);
    wrap.appendChild(confirm);
    return wrap;
}

// Drop every clearable record from memory and localStorage, then re-render.
// In-flight (RUNNING/QUEUED, non-unconfirmed) records survive untouched.
function clearCompletedRuns() {
    runRecords = runRecords.filter(function(rec) { return !isClearableRun(rec); });
    saveRunRecords();
    renderRunsList();
}

// Build the per-row Revert control shown on SHIPPED rows. It's its own button
// inside the row; click and keyboard both stopPropagation so the row's iterate
// action never also fires. When the record already carries a revert PR that
// didn't auto-merge (rec.revertPrUrl), the control opens that existing PR rather
// than POSTing a fresh revert — a second merged revert of the same PR would
// re-apply the original change, so we never create a duplicate revert PR.
function buildRevertControl(rec) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'claudeRunRevertBtn';
    const pendingPr = !!rec.revertPrUrl;
    btn.setAttribute('aria-label', pendingPr ? 'Open the revert pull request' : 'Revert this change');
    btn.title = pendingPr ? 'Open the revert pull request' : 'Revert this change';
    // Quiet counter-clockwise / undo arrow in the existing icon-button style.
    btn.innerHTML =
        '<svg class="claudeRunRevertIcon" width="14" height="14" viewBox="0 0 24 24" ' +
        'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        '<polyline points="1 4 1 10 7 10"></polyline>' +
        '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>';
    btn.addEventListener('click', function(event) {
        event.stopPropagation();
        if (rec.revertPrUrl) {
            try { window.open(rec.revertPrUrl, '_blank', 'noopener'); } catch (e) { /* popup blocked */ }
            return;
        }
        confirmAndRevertRun(rec, btn);
    });
    // Enter/Space natively fire the button's click, but the keydown also bubbles
    // to the row's keydown handler (iterate) — stop it here so the keyboard path
    // matches the click path and never double-fires.
    btn.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    return btn;
}

// Confirm the rollback, then ship it. The confirm names the run and states a new
// build will deploy; Cancel does nothing.
function confirmAndRevertRun(rec, btn) {
    showConfirmModal({
        // What the rollback does to the BOOKKEEPING, by source — the same copy
        // the TODO.md viewer's and the task row's Revert controls show, from the
        // one shared resolver, so a single action is never described two ways.
        message: revertConfirmMessage(rec.entryId),
        confirmLabel: 'Revert',
        onConfirm: function() { performRevertRun(rec, btn); },
    });
}

// Persist a run's post-revert guard. A localStorage record rides `saveRunRecords`
// as before; a queue-derived record (which isn't in `runRecords`) mirrors its
// `reverted` / pending-PR state into queueRunRevertState, keyed by entry id, so a
// re-render that rebuilds queue records from scratch preserves the guard.
function persistRunRevertGuard(rec) {
    // Queue- and marker-derived records are both cross-device (rebuilt from
    // scratch each render, never in runRecords), so their guard rides
    // queueRunRevertState keyed by entry id rather than saveRunRecords.
    if (rec && (rec.__fromQueue || rec.__fromMarker)) {
        if (rec.entryId) {
            const prev = queueRunRevertState.get(rec.entryId) || {};
            queueRunRevertState.set(rec.entryId, {
                reverted: !!rec.reverted || !!prev.reverted,
                revertPrUrl: rec.revertPrUrl || prev.revertPrUrl || null,
            });
        }
        return;
    }
    saveRunRecords();
}

async function performRevertRun(rec, btn) {
    btn.disabled = true;
    btn.classList.add('claudeRunRevertBtn--loading');
    // Revert against the repo the run shipped to, mirroring pollRunStatus: a run
    // without a persisted repo falls back to the Worker's default repo.
    const target = rec.repo ? { repo: rec.repo, file_path: 'TODO.md' } : null;
    const res = await revertEntry(rec.entryId, target);
    if (res && res.ok && res.merged === true) {
        // Rollback merged — a new build is deploying. Roll the bookkeeping back
        // through the ONE shared post-merge step every Revert surface calls, so
        // the entry, its todo, and its queue row stop claiming a ship that no
        // longer exists; then mark the record reverted (double-revert guard).
        const unship = await unshipEntry(rec.entryId, {
            target: target,
            mergedPrNumber: rec.pr_number,
        });
        showInjectToast(revertToastMessage(unship));
        rec.reverted = true;
        persistRunRevertGuard(rec);
        renderRunsList();
        return;
    }
    if (res && res.ok && res.merged === false) {
        // The revert PR opened but didn't auto-merge (conflict, or mergeability
        // unconfirmed). Persist the PR URL so the control switches to opening it
        // rather than POSTing again, and surface the reason.
        if (res.revert_pr_url) rec.revertPrUrl = res.revert_pr_url;
        persistRunRevertGuard(rec);
        showInjectToast(res.reason
            ? ('Revert needs attention: ' + res.reason)
            : 'Revert PR opened — finish it in GitHub');
        renderRunsList();
        return;
    }
    // ok === false → surface the error and restore the control so it can retry.
    showInjectToast((res && res.reason) ? ('Revert failed: ' + res.reason) : 'Revert failed');
    btn.disabled = false;
    btn.classList.remove('claudeRunRevertBtn--loading');
}

function buildRunRow(rec) {
    const row = document.createElement('div');
    row.className = 'claudeRunRow';
    row.dataset.correlationId = rec.correlationId;

    const title = document.createElement('span');
    title.className = 'claudeRunTitle';
    title.textContent = rec.title || 'Untitled entry';
    title.title = rec.title || '';

    const badge = document.createElement('span');
    const status = rec.status || 'QUEUED';
    if (rec.unconfirmed) {
        // The run finished or aged out but its outcome couldn't be positively
        // verified. Render a distinct, dimmed "Unknown" pill so it never passes
        // as either Shipped or Failed.
        badge.className = 'claudeRunBadge claudeRunBadge--unconfirmed';
        badge.textContent = 'Unknown';
        badge.title = 'This run finished but its outcome couldn’t be confirmed.';
    } else {
        badge.className = 'claudeRunBadge claudeRunBadge--' + status.toLowerCase();
        badge.textContent = RUN_STATUS_LABEL[status] || status;
        if (status === 'AWAITING') {
            badge.title = 'The run finished and opened a pull request — it ships once you merge it.';
        }
    }

    row.appendChild(title);

    // An API-billed run wears its model between the title and the status pill,
    // so a list of runs makes plain which ones left plan quota. Plan-lane runs
    // add nothing — the tag is a difference marker, not a label.
    const modelTag = runModelTagText(rec.model);
    if (modelTag) {
        const tag = document.createElement('span');
        tag.className = 'claudeRunModelTag';
        tag.textContent = modelTag;
        tag.title = 'Ran on ' + modelTag + ' — API billed';
        row.appendChild(tag);
    }

    row.appendChild(badge);

    // A SHIPPED run has a merged change behind it, so its row becomes the
    // door into an iterate chat. Non-shipped rows stay inert.
    if (status === 'SHIPPED' && rec.entryId) {
        row.classList.add('claudeRunRow--iterable');
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.setAttribute('aria-label', 'Iterate on ' + (rec.title || 'this run'));
        row.title = 'Iterate on this shipped change';
        row.addEventListener('click', function() { startIterateFromRun(rec); });
        row.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                startIterateFromRun(rec);
            }
        });
        // A shipped change can be rolled back. The Revert control sits inside the
        // iterable row but stops propagation on both click and keyboard so it
        // never also fires the row's iterate action. A record already reverted
        // (rec.reverted) shows no fresh trigger — re-reverting a revert PR would
        // re-apply the original change.
        if (!rec.reverted) row.appendChild(buildRevertControl(rec));
    } else if (status === 'AWAITING' && rec.awaitingPrUrl) {
        // The work is done but the merge is the user's to make, so the row's one
        // affordance is the door to that PR. The row itself stays inert — there
        // is nothing merged to iterate on or revert until it lands. Propagation
        // is stopped on both click and keydown exactly as the revert control
        // does, so the link never doubles as a row action.
        const prLink = document.createElement('a');
        prLink.className = 'claudeRunAwaitingPrLink';
        prLink.href = rec.awaitingPrUrl;
        prLink.target = '_blank';
        prLink.rel = 'noopener';
        prLink.textContent = 'Open PR ↗';
        prLink.title = 'Open the pull request waiting to be merged';
        prLink.addEventListener('click', function(event) { event.stopPropagation(); });
        prLink.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        });
        row.appendChild(prLink);
    } else if (status === 'NOCHANGE') {
        // A "No change" run merged nothing, so it's not iterable. Its row is an
        // inline accordion: tapping the header toggles a panel showing the
        // agent's closing summary (why nothing merged), lazily fetched and cached
        // on the record, with a purple "Follow up" button (seeds a corrected-entry
        // chat) and an "Open full log ↗" link. The trailing affordance is an
        // expand chevron rather than the old ↗ outbound glyph.
        row.classList.add('claudeRunRow--nochange');
        // The panel wraps to its own line beneath the header (title + badge +
        // chevron all sit on the first flex line).
        row.classList.add('claudeRunRow--collapsible');

        const chevron = document.createElement('span');
        chevron.className = 'claudeRunChevron';
        chevron.textContent = '▸';
        chevron.setAttribute('aria-hidden', 'true');
        row.appendChild(chevron);

        const panel = document.createElement('div');
        panel.className = 'claudeRunResultPanel';
        panel.hidden = true;
        row.appendChild(panel);

        let expanded = false;
        const toggle = function() {
            expanded = !expanded;
            panel.hidden = !expanded;
            row.classList.toggle('claudeRunRow--expanded', expanded);
            chevron.textContent = expanded ? '▾' : '▸';
            row.setAttribute('aria-expanded', String(expanded));
            // Lazily load (and render) the summary on first expand. Expand state
            // is per-row — toggling this row never touches another's panel.
            if (expanded) ensureRunResultLoaded(rec, panel);
        };

        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.setAttribute('aria-expanded', 'false');
        row.setAttribute('aria-label', 'Show why ' + (rec.title || 'this run') + ' made no change');
        row.title = 'Show the run summary';
        row.addEventListener('click', function(event) {
            // Controls inside the panel (Follow up / Open full log) own their
            // clicks — never let them toggle the accordion.
            if (panel.contains(event.target)) return;
            toggle();
        });
        row.addEventListener('keydown', function(event) {
            if (event.target !== row) return; // panel controls handle their own keys
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggle();
            }
        });
    }
    return row;
}

// Populate a "No change" row's summary panel. The agent's closing summary is
// fetched once (via the Worker's `run_result` route, keyed on the persisted run
// id and falling back to the correlation id for older records) and cached on
// `rec.result` so re-expands and reloads render instantly without re-fetching.
// An empty result or a fetch failure renders a one-line fallback but always
// keeps the "Open full log ↗" link available.
async function ensureRunResultLoaded(rec, panel) {
    if (rec.result != null) {
        renderRunResultPanel(rec, panel);
        return;
    }
    panel.innerHTML = '';
    const loading = document.createElement('p');
    loading.className = 'claudeRunResultLoading';
    loading.textContent = 'Reading the run summary…';
    panel.appendChild(loading);

    const target = rec.repo ? { repo: rec.repo, file_path: 'TODO.md' } : null;
    const res = await fetchRunResult(rec.runId || rec.correlationId, target);
    // Cache the summary (string, possibly empty) so a re-expand never re-fetches.
    // A failed fetch caches an empty string — the fallback copy covers it and the
    // log link stays available; the user can still reload to retry.
    rec.result = (res && res.ok && typeof res.result === 'string') ? res.result : '';
    saveRunRecords();
    renderRunResultPanel(rec, panel);
}

// Render the cached summary (or its fallback) plus the action row into a "No
// change" row's panel.
function renderRunResultPanel(rec, panel) {
    panel.innerHTML = '';
    const summary = (rec.result || '').trim();

    const body = document.createElement('p');
    body.className = 'claudeRunResultText';
    if (summary) {
        body.textContent = summary;
    } else {
        body.classList.add('claudeRunResultText--empty');
        body.textContent = 'Couldn’t read the run summary.';
    }
    panel.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'claudeRunResultActions';

    const followBtn = document.createElement('button');
    followBtn.type = 'button';
    followBtn.className = 'claudeRunFollowUpBtn';
    followBtn.textContent = 'Follow up';
    followBtn.addEventListener('click', function(event) {
        event.stopPropagation();
        startFollowUpFromRun(rec);
    });
    actions.appendChild(followBtn);

    if (rec.runUrl) {
        const logLink = document.createElement('a');
        logLink.className = 'claudeRunResultLogLink';
        logLink.href = rec.runUrl;
        logLink.target = '_blank';
        logLink.rel = 'noopener';
        logLink.textContent = 'Open full log ↗';
        logLink.addEventListener('click', function(event) {
            event.stopPropagation();
        });
        actions.appendChild(logLink);
    }

    panel.appendChild(actions);
}

// Seed an author chat from a "No change" run so the user can draft a corrected
// follow-up entry. Switches to the Chat tab, resets the conversation, and fires
// a plain first author turn carrying a short framing line, the original entry
// block (read off main — a no-op run leaves the entry present and unchecked),
// and the agent's summary. It deliberately omits the iterate entry_id: a
// NOCHANGE run has no merged PR, so an iterate seed would 404 with "nothing to
// iterate on yet". The summary and entry ride in the user message instead, and
// the Worker auto-loads CLAUDE.md + manifest as on any author turn.
async function startFollowUpFromRun(rec) {
    if (!rec || rec.status !== 'NOCHANGE' || !rec.entryId) return;
    setActiveTab('chat');
    if (!isClaudeSheetOpen()) openClaudeSheet();

    chatHistory = [];
    // The follow-up starts a fresh author conversation, so the replaced thread's
    // stored copies go with it — local and remote alike.
    deleteChatHistory(activeChatRepo);
    clearRemoteChatTurns(activeChatRepo);
    // A NOCHANGE follow-up is a plain author turn with no merged PR, so clear any
    // active iterate session for this repo — it must never inherit a stale id and
    // accidentally send entry_id (which would 404 with "nothing to iterate on").
    activeIterateEntry = null;
    saveIterateEntry();
    // This is a fresh author conversation, not the original hand-off session, so
    // drop any hand-off link too.
    activeHandoffRow = null;
    const surface = sheetQuery('#claudeChatSurface');
    if (surface) surface.innerHTML = '';
    clearAttachments();

    appendMessageBubble('note', 'Following up on “' + (rec.title || 'this run') + '” — pulling the original entry…');

    // Read the original entry block off main. A no-op run leaves its entry
    // present and unchecked, so it's still in TODO.md; if the read fails, the
    // turn still composes from the summary alone.
    const target = rec.repo ? { repo: rec.repo, file_path: 'TODO.md' } : null;
    let entryBlock = '';
    const read = await readTodoMdFromWorker(target);
    if (read && read.ok !== false && typeof read.content === 'string') {
        entryBlock = extractEntryBlock(read.content, rec.entryId) || '';
    }

    const summary = (rec.result || '').trim();
    const parts = ['This entry ran but made no change; here’s the agent’s summary explaining why — help me draft a corrected follow-up entry.'];
    if (entryBlock) parts.push('Original entry:\n\n' + entryBlock);
    if (summary) parts.push('Agent summary:\n\n' + summary);
    const content = parts.join('\n\n');

    appendChatTurn({ role: 'user', content: content });
    appendMessageBubble('user', content);
    // No entry_id — this is a plain author turn (NOCHANGE has no merged PR).
    await requestAssistantReply();
}

// Slice an entry's full block (its `- [ ]`/`- [x]` line through every sub-bullet,
// up to but excluding the next top-level checkbox) out of a TODO.md body by its
// `<!-- id: <uuid> -->` marker. Returns null when the marker is absent. Reuses
// the same marker walk entryCheckboxState keys off.
function extractEntryBlock(content, entryId) {
    if (typeof content !== 'string' || !entryId) return null;
    const lines = content.split('\n');
    const checkboxRe = /^\s*- \[[ xX]\]/;
    let markerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('<!-- id: ' + entryId) !== -1) { markerIdx = i; break; }
    }
    if (markerIdx === -1) return null;
    // The entry's checkbox is the nearest preceding task line.
    let start = markerIdx;
    while (start >= 0 && !checkboxRe.test(lines[start])) start--;
    if (start < 0) return null;
    // The block ends just before the next checkbox line (or at EOF).
    let end = start + 1;
    while (end < lines.length && !checkboxRe.test(lines[end])) end++;
    return lines.slice(start, end).join('\n').replace(/\s+$/, '');
}

// The board queue state a terminal run status maps to, so a chat-shipped run
// leaves the originating Agent-board card in the same terminal state a
// board-dispatched card reaches (see agentView.js's reconcileShipped).
const HANDOFF_TERMINAL_STATE = {
    SHIPPED: 'shipped',
    FAILED: 'failed',
    NOCHANGE: 'no_change',
};

// Transition a hand-off run's originating Agent-board row when the run reaches a
// terminal outcome. A no-op for runs not handed off from a board card
// (record.agentRowId is null) or non-terminal statuses. The data-model write
// goes through listLogic (all agent_queue mutations do); it persists to the
// board and the card settles on the next board render/realtime tick. Fire-and-
// forget — a failed settle must never break run-status bookkeeping.
function settleHandoffRow(record, status) {
    if (!record || !record.agentRowId) return;
    const state = HANDOFF_TERMINAL_STATE[status];
    if (!state) return;
    const patch = { state: state };
    if (record.entryId) patch.entry_id = record.entryId;
    if (record.correlationId) patch.correlation_id = record.correlationId;
    try {
        Promise.resolve(listLogic.setAgentRunState(record.agentRowId, patch))
            .catch(function () { /* non-blocking: board settles on next render */ });
    } catch (e) { /* defensive: setAgentRunState missing/throwing synchronously */ }
}

function setRunRecordStatus(correlationId, status) {
    let changed = false;
    let changedProject = null;
    for (let i = 0; i < runRecords.length; i++) {
        if (runRecords[i].correlationId === correlationId &&
            runRecords[i].status !== status) {
            runRecords[i].status = status;
            changed = true;
            changedProject = runRecords[i].project;
            // A run handed off from an Agent-board card just reached a new
            // status. When it's terminal, settle the originating row the same
            // way a board-dispatched card settles, so a card handed off to chat
            // doesn't stay parked at "Needs words" after its work ships/fails.
            settleHandoffRow(runRecords[i], status);
        }
    }
    if (changed) {
        saveRunRecords();
        renderRunsList();
        // A run reaching SHIPPED means a new build just deployed. Force an
        // immediate SW update check now so the installed PWA discovers the new
        // worker rather than waiting for the next hourly/visibility poll —
        // otherwise "check the live result" and the layout inspector would run
        // against the stale cached bundle. index.js owns the registration and
        // listens for this event (dispatched here so this module needn't import
        // the entry point).
        if (status === 'SHIPPED') {
            try {
                document.dispatchEvent(new CustomEvent('requestSwUpdateCheck'));
            } catch (e) { /* defensive: CustomEvent unsupported */ }
            // The shipped-marker cache only re-reads TODO.md once per its 60s
            // TTL, so the TODO_RUN_STATUS_EVENT saveRunRecords() just emitted
            // can be handled with stale markers, leaving the row's shipped dot
            // amber for up to a minute. Force an immediate re-read for this
            // run's project so the glyph flips to shipped promptly.
            if (changedProject) {
                refreshShippedMarkersForProject(changedProject, true);
            }
        }
    }
}

// Flag a run as unconfirmed without asserting an outcome: its last-known status
// is preserved so the row keeps whatever it last legitimately showed, but the
// UI renders an "Unknown" pill so the user can tell "this finished but I can't
// verify it" apart from a genuine failure. Used when a run ages out of the poll
// window or completes with a conclusion that's neither success nor a recognized
// failure signal.
function markRunRecordUnconfirmed(correlationId) {
    let changed = false;
    for (let i = 0; i < runRecords.length; i++) {
        if (runRecords[i].correlationId === correlationId && !runRecords[i].unconfirmed) {
            runRecords[i].unconfirmed = true;
            changed = true;
        }
    }
    if (changed) {
        saveRunRecords();
        renderRunsList();
    }
}

// Record that a poll just confirmed this run is still alive (status queued or
// in_progress). The give-up window measures idle time from this timestamp, so a
// healthy long build that keeps reporting progress never ages out mid-flight.
// Persisted (but not re-rendered — lastAliveAt is invisible) so the window
// survives a reload: dispatchedAt alone would age a 20-minute-plus build out the
// instant its Runs tab remounts.
function markRunRecordAlive(correlationId) {
    let changed = false;
    for (let i = 0; i < runRecords.length; i++) {
        if (runRecords[i].correlationId === correlationId) {
            runRecords[i].lastAliveAt = Date.now();
            changed = true;
        }
    }
    if (changed) saveRunRecords();
}

// ── RUN POLLING ──
// Reuses inject.js's pollRunStatus — the same path the TODO.md viewer's
// header pill drives — to flip a run record QUEUED → RUNNING → SHIPPED
// (or FAILED). One interval per correlation id; cleared on a terminal status
// or after the give-up window.
// Free a project's per-project run guard at a terminal outcome. The viewer's
// own terminal handlers clear it too, but only when that project's viewer is
// mounted — this covers a chat-shipped run whose project is not on screen, so
// combined with runState's stale-entry check a project can't get stuck blocked.
// A no-op for records dispatched before `project` was persisted (undefined).
function freeProjectRunGuard(project) {
    if (project == null) return;
    clearActiveRun(project);
}

function startRunPoller(rec) {
    if (!rec || !rec.correlationId) return;
    const correlationId = rec.correlationId;
    if (runPollers[correlationId]) return;
    if (isTerminalStatus(rec.status)) return;
    const startedAt = typeof rec.dispatchedAt === 'number' ? rec.dispatchedAt : Date.now();
    // Poll against the repo the run was dispatched to. Records from before this
    // was persisted (no rec.repo) fall back to null → the Worker's default repo,
    // exactly as polling behaved before.
    const target = rec.repo ? { repo: rec.repo, file_path: 'TODO.md' } : null;
    // The project this run belongs to (undefined on records from before this
    // was persisted) — passed through so the poller frees its run guard at
    // terminal even when that project's viewer is closed.
    const project = rec.project;
    runPollers[correlationId] = setInterval(function() {
        pollRunRecordOnce(correlationId, startedAt, target, project);
    }, RUN_POLL_INTERVAL_MS);
    pollRunRecordOnce(correlationId, startedAt, target, project);
}

function stopRunPoller(correlationId) {
    if (runPollers[correlationId]) {
        clearInterval(runPollers[correlationId]);
        delete runPollers[correlationId];
    }
}

async function pollRunRecordOnce(correlationId, startedAt, target, project) {
    // Give up only after RUN_GIVE_UP_MS elapses with NO confirmed-alive signal.
    // A healthy long build (implement, test, open PR, merge) can genuinely run
    // past the window while still reporting queued/in_progress, so measure the
    // idle time from the most recent alive confirmation (lastAliveAt) when we
    // have one, falling back to dispatch time for records never confirmed alive
    // (or persisted before lastAliveAt existed). Measuring purely from dispatch
    // would flip an actively-running row to "Unknown" at the 20-minute mark.
    const rec = findRunRecord(correlationId);
    const lastAlive = rec && typeof rec.lastAliveAt === 'number' ? rec.lastAliveAt : startedAt;
    if (Date.now() - lastAlive >= RUN_GIVE_UP_MS) {
        // Past the give-up window the run can no longer be reconciled. We can't
        // see a positive outcome either way, so "couldn't confirm" is NOT
        // "failed" — flag it unconfirmed (keeping its last-known status) and
        // stop watching so the row neither lies about failure nor sits
        // "Running" forever.
        markRunRecordUnconfirmed(correlationId);
        stopRunPoller(correlationId);
        freeProjectRunGuard(project);
        return;
    }
    const res = await pollRunStatus({ correlationId: correlationId, target: target || null });
    if (!res || res.ok === false) return; // transient — keep polling
    if (res.found === false) return; // run not surfaced yet — stay QUEUED
    if (res.status === 'completed') {
        // Only assert FAILED on a positive failure signal. A success conclusion
        // is reconciled against the merged-PR proof (it might be a clean no-op,
        // not a ship); a recognized failure conclusion fails; anything else
        // completed (neutral, skipped, action_required, or no conclusion) is
        // unconfirmed rather than asserted-failed.
        if (res.conclusion === 'success') {
            // reconcileSuccessConclusion owns stopping the poller and freeing
            // the guard once it reaches a verdict (SHIPPED / NOCHANGE), and
            // deliberately keeps polling on a transient read failure.
            await reconcileSuccessConclusion(correlationId, project, res.runUrl, target, res.runId);
            return;
        }
        if (FAILURE_CONCLUSIONS.indexOf(res.conclusion) !== -1) {
            setRunRecordStatus(correlationId, 'FAILED');
        } else {
            markRunRecordUnconfirmed(correlationId);
        }
        stopRunPoller(correlationId);
        freeProjectRunGuard(project);
        return;
    }
    if (res.status === 'queued') {
        markRunRecordAlive(correlationId);
        setRunRecordStatus(correlationId, 'QUEUED');
    } else {
        markRunRecordAlive(correlationId);
        setRunRecordStatus(correlationId, 'RUNNING');
    }
}

function findRunRecord(correlationId) {
    for (let i = 0; i < runRecords.length; i++) {
        if (runRecords[i].correlationId === correlationId) return runRecords[i];
    }
    return null;
}

// Transient read failures tolerated before a green run fails safe to SHIPPED.
// The decision keys on one quick contents read off main; if that read keeps
// failing we must not hang the row on Running forever, but we also can't read a
// transient blip as a no-op — so after a couple of misses we fail safe toward
// SHIPPED (every ambiguity lands on SHIPPED, never on "No change").
const READ_CONFIRM_RETRIES = 2;

// Determine an entry's checkbox state in a TODO.md body by its `<!-- id: … -->`
// marker. The marker comment is an indented sub-bullet of its entry, so the
// entry's checkbox is the nearest preceding `- [ ]` / `- [x]` task line. Returns
// 'checked', 'unchecked', or null when the marker is absent (or malformed with
// no preceding checkbox — treated as absent, which the caller fails safe to
// SHIPPED).
function entryCheckboxState(content, entryId) {
    if (typeof content !== 'string' || !entryId) return null;
    const lines = content.split('\n');
    const checkboxRe = /^\s*- \[([ xX])\]/;
    let checked = null;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(checkboxRe);
        if (m) checked = m[1].toLowerCase() === 'x';
        if (lines[i].indexOf('<!-- id: ' + entryId) !== -1) {
            if (checked === null) return null;
            return checked ? 'checked' : 'unchecked';
        }
    }
    return null;
}

// List every entry that flipped from open to checked between a backlog run's
// dispatch-time snapshot (titles of the entries then open) and main's TODO.md as
// it reads now. A title that was open before and is checked now is a task the
// routine completed. Returns the array of such titles — ALWAYS an array when the
// diff could run, so the caller can tell the three cases apart, because they
// carry different verdicts as well as different labels:
//   • exactly one   → that's the task the run completed; name the row with it.
//   • zero          → nothing was checked off: the run genuinely changed nothing.
//   • two or more   → something else was checked off in the same window, so which
//                     one this run did is a guess. Never guessed at.
// Returns null (not an empty array) when there is nothing to diff against — no
// snapshot, or no content — so "couldn't tell" is never read as "confirmed zero".
function newlyCheckedTitles(openTitles, content) {
    if (!Array.isArray(openTitles) || !openTitles.length) return null;
    if (typeof content !== 'string') return null;
    const wasOpen = new Set(openTitles);
    const found = [];
    content.split('\n').forEach(function(line) {
        if (!/^\s*- \[[xX]\]/.test(line)) return;
        const title = taskLineTitle(line);
        if (title && wasOpen.has(title)) found.push(title);
    });
    return found;
}

// Diff a landed backlog run against main. A backlog dispatch names no entry (the
// routine picks the task), so its row is created as "Backlog run" and the only
// moment the completed task can be identified is here: read main's TODO.md and
// diff it against the record's dispatch-time snapshot. The result drives BOTH the
// row's label and its verdict — a confirmed zero-flip diff is the positive
// signature of a no-change backlog run, exactly as an unchecked marker is for an
// entry run. Returns the array of newly-checked titles (possibly empty), or null
// when the diff couldn't run at all: no snapshot, no target, or a failed read.
// null is the "couldn't tell" case and fails safe to SHIPPED at the caller.
async function resolveBacklogCheckedTitles(rec, target) {
    if (!rec || !Array.isArray(rec.openTitles) || !rec.openTitles.length) return null;
    if (!target || !target.repo || !target.file_path) return null;
    const read = await readTodoMdFromWorker(target);
    if (!read || read.ok === false) return null;
    return newlyCheckedTitles(rec.openTitles, read.content);
}

// Name the task a no-change backlog run picked, from the routine's closing
// summary. Nothing was checked off, so the TODO.md diff has no title to offer —
// but a run that picked a task and then aborted (tests red, merge conflict) opens
// its summary by naming that task. Deliberately NOT prose parsing: the summary is
// matched against the dispatch-time snapshot, so the only titles that can win are
// ones that were genuinely open at dispatch. Ambiguity fails safe the same way
// the diff does — zero or two-or-more snapshot titles quoted in the summary leave
// the generic label alone. Returns the resolved title, or null.
function summaryNamedTitle(openTitles, summary) {
    if (!Array.isArray(openTitles) || !openTitles.length) return null;
    if (typeof summary !== 'string' || !summary) return null;
    const haystack = summary.toLowerCase();
    const found = openTitles.filter(function(title) {
        return title && haystack.indexOf(title.toLowerCase()) !== -1;
    });
    return found.length === 1 ? found[0] : null;
}

// Fetch a no-change backlog run's closing summary once, at reconcile. Serves two
// purposes: it is what summaryNamedTitle matches the snapshot against, and it is
// cached onto the record so the row's "No change" panel renders instantly instead
// of fetching on first expand. Strictly best-effort — a failed fetch returns null
// and, critically, caches NOTHING: ensureRunResultLoaded skips its own fetch once
// `rec.result` is set, so caching '' here would poison the panel permanently.
async function fetchNoChangeSummary(rec, runId, target) {
    const res = await fetchRunResult(runId != null ? runId : rec.correlationId, target);
    if (!res || res.ok === false || typeof res.result !== 'string') return null;
    return res.result;
}

// Today's date as an ISO YYYY-MM-DD string (local time) — the completion date
// stamped onto a Conceive board Shipped-log record.
function todayIsoDate() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
}

// Log a finalized run to its target project's Conceive board "Shipped" section.
// Fire-and-forget: fetches the agent's closing summary (the same `run_result`
// the Runs-tab No-change panel reads) and appends a log record through listLogic,
// which gates to board-shape projects and dedups by entry id. Skipped — with no
// run_result fetch — when the run has no project or entry id, or the target
// project isn't a board (the cheap pre-check mirrors appendConceiveLogEntry's
// authoritative gate so non-board targets never trigger a fetch).
function logConceiveRun(project, rec, verdict, runId, target) {
    if (!project || !rec || !rec.entryId) return;
    const stages = listLogic.getProjectStages(project);
    if (!stages.some(function(s) { return s && s.label === 'Now'; })) return;
    fetchRunResult(runId != null ? runId : rec.correlationId, target).then(function(res) {
        const summary = (res && res.ok && typeof res.result === 'string') ? res.result : '';
        listLogic.appendConceiveLogEntry(project, {
            id: rec.entryId,
            title: rec.title || '',
            verdict: verdict,
            summary: summary,
            date: todayIsoDate(),
        });
    });
}

// Reconcile a completed-with-success run. A green workflow conclusion alone is
// NOT proof a change merged: a graceful no-op run (the routine reports the entry
// ineligible and exits clean with tests green) also returns success. Decide
// ship-vs-no-op by reading the run's target TODO.md directly off main via the
// index-free `read` route (a GitHub contents fetch that reflects the merge
// immediately, PR-merge or direct push — no PR-search lag), and key on the
// entry's checkbox:
//   • entry checked `- [x]`           → SHIPPED.
//   • entry present and unchecked     → NOCHANGE ("No change"): the routine
//     leaves a skipped entry unchecked, so unchecked-with-marker is the positive
//     signature of a no-op.
//   • marker absent (completed-then-cleared or squashed away) → SHIPPED.
//   • read fails transiently → keep polling, retry a couple of ticks, then
//     fail safe to SHIPPED.
// Fail safe toward SHIPPED on every ambiguity so a genuine ship is never
// mislabeled. A backlog run (no entryId) has no marker to key on, so it is
// verified the equivalent way — by diffing main's TODO.md against the record's
// dispatch-time snapshot (see resolveBacklogCheckedTitles): one title flipped
// from open to checked → SHIPPED under that title, a confirmed zero flipped →
// NOCHANGE, and anything the diff can't answer (no snapshot, no target, failed
// read, two-or-more flips) → SHIPPED. A record with no entryId AND no snapshot
// therefore keeps the historical success → SHIPPED behavior exactly.
async function reconcileSuccessConclusion(correlationId, project, runUrl, target, runId) {
    const rec = findRunRecord(correlationId);
    const settle = function() {
        stopRunPoller(correlationId);
        freeProjectRunGuard(project);
    };
    if (!rec) { settle(); return; }
    if (!rec.entryId) {
        // A backlog run has no entry to check, so its dispatch-time snapshot is
        // what stands in for the marker: diffing it against main's TODO.md both
        // identifies the entry the routine completed (the row is still labelled
        // "Backlog run", and this is the only moment that can be fixed) AND
        // settles ship-vs-no-op. Diff first, then commit.
        const snapshot = Array.isArray(rec.openTitles) ? rec.openTitles.slice() : null;
        const checked = await resolveBacklogCheckedTitles(rec, target);
        // A confirmed zero-flip diff — nothing that was open at dispatch is
        // checked now — is the positive signature of a no-op run: the routine
        // found every open entry ineligible (or picked one and aborted before
        // landing it) and exited clean, so the green conclusion merged nothing.
        // Every other outcome, including a null "couldn't tell" and an ambiguous
        // multi-flip, fails safe to SHIPPED per this function's policy.
        const noChange = Array.isArray(checked) && checked.length === 0;
        // The diff had no title to offer on the no-change path, so fall back to
        // the routine's closing words — which are worth fetching here anyway, to
        // prime the row's summary panel. Done BEFORE the re-find below so every
        // await on this path is behind it.
        const summary = noChange ? await fetchNoChangeSummary(rec, runId, target) : null;
        // Re-find: the awaits may have spanned a trackDispatchedRun, which
        // re-reads the records array and would leave `rec` pointing at a
        // detached object whose mutations never persist.
        const live = findRunRecord(correlationId) || rec;
        if (checked && checked.length === 1) live.title = checked[0];
        if (noChange) {
            // Mirror the entry-mode no-op path: persist the Actions log URL (the
            // "Open full log ↗" link) and the run id so the verdict panel can
            // fetch this run's summary, plus the summary itself when it was read.
            if (runUrl) live.runUrl = runUrl;
            if (runId != null) live.runId = runId;
            if (summary != null) live.result = summary;
            const named = summaryNamedTitle(snapshot, summary);
            if (named) live.title = named;
        }
        // The snapshot is spent — this record settles terminal here and can
        // never be diffed again, so don't leave it sitting in localStorage.
        live.openTitles = null;
        saveRunRecords();
        renderRunsList();
        if (noChange) {
            setRunRecordStatus(correlationId, 'NOCHANGE');
            // Inert for a backlog record as things stand — logConceiveRun gates
            // on an entry id and a backlog dispatch never has one — but kept in
            // lockstep with the entry-mode no-op branch so the two can't drift.
            logConceiveRun(project, live, 'nochange', runId, target);
        } else {
            setRunRecordStatus(correlationId, 'SHIPPED');
        }
        settle();
        return;
    }
    if (!target || !target.repo || !target.file_path) {
        setRunRecordStatus(correlationId, 'SHIPPED');
        settle();
        return;
    }
    const read = await readTodoMdFromWorker(target);
    if (!read || read.ok === false) {
        // Transient read failure — keep polling, but don't hang forever: once the
        // misses pass the retry threshold, fail safe to SHIPPED.
        rec.readMisses = (rec.readMisses || 0) + 1;
        if (rec.readMisses > READ_CONFIRM_RETRIES) {
            setRunRecordStatus(correlationId, 'SHIPPED');
            logConceiveRun(project, rec, 'shipped', runId, target);
            settle();
        } else {
            saveRunRecords();
        }
        return;
    }
    const state = entryCheckboxState(read.content, rec.entryId);
    if (state === 'unchecked') {
        // Entry still present and unchecked. Persist the Actions log URL (the
        // "Open full log ↗" link) and the run id (so the verdict panel can fetch
        // the run's summary by run id; older records without it fall back to the
        // correlation id) before deciding which unchecked this is.
        if (runUrl) rec.runUrl = runUrl;
        if (runId != null) rec.runId = runId;
        if (rec.autoMerge === false) {
            // Auto-merge was off for this run, so unchecked is NOT the no-op
            // signature: the routine did the work and opened a PR, then stopped
            // short of merging it, which is exactly why the entry is still open.
            // Settling that at NOCHANGE would be terminal and would never
            // correct itself after the user merges, so hold it at AWAITING and
            // let the shipped-marker cache promote it.
            setRunRecordStatus(correlationId, 'AWAITING');
            // Fire-and-forget: the row's badge and its marker-driven promotion
            // don't depend on the PR link landing, so never delay settling on it.
            attachAwaitingPrUrl(correlationId, rec.entryId);
        } else {
            // Auto-merge was on, so an unchecked entry means the routine skipped
            // it (no-op) — the historical verdict, unchanged.
            setRunRecordStatus(correlationId, 'NOCHANGE');
            logConceiveRun(project, rec, 'nochange', runId, target);
        }
    } else {
        // 'checked' → shipped; null (marker absent) → fail safe to SHIPPED.
        setRunRecordStatus(correlationId, 'SHIPPED');
        logConceiveRun(project, rec, 'shipped', runId, target);
    }
    settle();
}

// Resume polling for any run record that hasn't reached a terminal status —
// called on mount so a run dispatched before a reload keeps updating.
// Retroactively re-check a FAILED record against its entry-id marker. A FAILED
// row may have been over-asserted by an earlier reconcile; if that entry's
// marker turns up in a merged PR (resolve → found:true with a merge_commit_sha)
// that IS positive proof the work shipped, so promote it to SHIPPED. found:false
// (no merged PR carries the marker) leaves the row FAILED — never a false
// promotion. The attempt is cached on the record so each FAILED row is rechecked
// at most once per session (no busy-looping). SHIPPED stays a hard terminal
// state and is never demoted here.
async function promoteFailedRecordIfShipped(rec) {
    rec.resolveAttempted = true;
    saveRunRecords();
    const res = await resolveEntryByMarker(rec.entryId);
    if (res && res.found === true && res.merge_commit_sha) {
        setRunRecordStatus(rec.correlationId, 'SHIPPED');
    }
}

// The Worker target a run record polls/reads against — its persisted repo, or
// null when it has none (the Worker then falls back to its default repo).
function targetForRunRecord(rec) {
    return (rec && rec.repo) ? { repo: rec.repo, file_path: 'TODO.md' } : null;
}

// Best-effort door to the PR an AWAITING run is parked behind, fetched once when
// the run enters that state. The Worker's `resolve` route answers by marker; when
// its response carries no url the row simply shows no link — the amber badge and
// the marker-driven promotion are the core of this state, and no Worker change is
// made to manufacture a url. Re-finds the record after the await (which may have
// spanned a records reload) and skips a record that already promoted, so a link
// is never stamped onto a run that has since shipped.
async function attachAwaitingPrUrl(correlationId, entryId) {
    if (!entryId) return;
    const res = await resolveEntryByMarker(entryId);
    const url = (res && typeof res.pr_url === 'string') ? res.pr_url.trim() : '';
    if (!url) return;
    const live = findRunRecord(correlationId);
    if (!live || live.status !== 'AWAITING') return;
    live.awaitingPrUrl = url;
    saveRunRecords();
    renderRunsList();
}

// Promote a single AWAITING record once its entry turns up in the repo's shipped
// marker set — the user merged the PR and the routine's `- [x]` landed on main.
// That cache is already refreshed on the Runs tab's own cycle, so this costs no
// extra network call: it reads what's there and flips the row when the proof
// arrives. Mirrors the normal shipped branch (setRunRecordStatus fires the SW
// update check and forces a marker refresh; logConceiveRun records the verdict).
// Returns true when it promoted, so callers can tell a live change from a no-op.
function promoteAwaitingRecordIfMerged(rec) {
    if (!rec || rec.status !== 'AWAITING' || !rec.entryId) return false;
    if (getShippedMarkersForRepo(rec.repo).indexOf(rec.entryId) === -1) return false;
    setRunRecordStatus(rec.correlationId, 'SHIPPED');
    logConceiveRun(rec.project, rec, 'shipped', rec.runId, targetForRunRecord(rec));
    return true;
}

// Sweep every AWAITING record against the shipped-marker cache. Called from the
// two places the cache can newly contain a merged entry: the resumeRunPollers
// pass (a Runs-tab open, which also kicks refreshShippedMarkersForProject) and
// the TODO_RUN_STATUS_EVENT the cache fires when it reconciles.
function promoteAwaitingRecords() {
    runRecords.slice().forEach(promoteAwaitingRecordIfMerged);
}

function resumeRunPollers() {
    let changed = false;
    runRecords.forEach(function(rec) {
        // FAILED is terminal for polling, but a FAILED record carrying an
        // entryId may have been over-asserted: its marker could be present in a
        // merged PR, which is positive proof of a ship. Re-check it once per
        // session and promote to SHIPPED on a positive marker match.
        if (rec.status === 'FAILED' && rec.entryId && !rec.resolveAttempted) {
            promoteFailedRecordIfShipped(rec);
            return;
        }
        // AWAITING is non-terminal but must never get a poller: its workflow has
        // already completed, so polling would re-read the same green conclusion
        // forever. Its only path forward is the shipped-marker cache, so check
        // that instead and leave the record where it is when the merge hasn't
        // landed yet.
        if (rec.status === 'AWAITING') {
            promoteAwaitingRecordIfMerged(rec);
            return;
        }
        if (isTerminalStatus(rec.status)) return;
        // Already flagged unconfirmed: its outcome can't be polled to anything
        // more definite, so don't restart a poller that would just re-flag it.
        if (rec.unconfirmed) return;
        if (!rec.correlationId) {
            // With no correlation id this record can never be polled to a real
            // status. That's "couldn't confirm", not "failed" — flag it
            // unconfirmed (keeping its last-known status) so the row reads
            // "Unknown" instead of falsely claiming failure.
            rec.unconfirmed = true;
            changed = true;
            return;
        }
        startRunPoller(rec);
    });
    if (changed) {
        saveRunRecords();
        renderRunsList();
    }
}

function buildSheet() {
    const sheet = document.createElement('div');
    sheet.id = 'claudeSheet';
    sheet.setAttribute('role', 'dialog');
    // Non-modal: on desktop the panel docks beside a still-interactive app.
    sheet.setAttribute('aria-modal', 'false');
    sheet.setAttribute('aria-label', 'Claude assistant');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.setAttribute('data-tab', 'chat');

    // Grab handle — surfaced on mobile only (CSS), doubles as a tap-to-close.
    const handle = document.createElement('button');
    handle.id = 'claudeSheetHandle';
    handle.type = 'button';
    handle.setAttribute('aria-label', 'Close Claude assistant');
    handle.addEventListener('click', closeClaudeSheet);

    // Close `×` — surfaced on the desktop panel only (CSS hides it at ≤1023px,
    // where backdrop-tap and swipe-down already dismiss). Reuses the same close
    // path as the launcher and backdrop; not a second close route.
    const closeX = document.createElement('button');
    closeX.id = 'claudeSheetClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close Claude panel');
    closeX.textContent = '×';
    closeX.addEventListener('click', closeClaudeSheet);

    // The `×` lives in its own right-aligned row above the tab list rather than
    // overlaying the corner, so it never shares a flex container with the tabs.
    const closeRow = document.createElement('div');
    closeRow.id = 'claudeSheetCloseRow';
    closeRow.className = 'claudeSheetCloseRow';
    closeRow.appendChild(closeX);

    const tabs = document.createElement('div');
    tabs.id = 'claudeSheetTabs';
    tabs.className = 'claudeSheetTabs';
    tabs.setAttribute('role', 'tablist');
    const chatTab = buildTab('claudeTabChat', 'CHAT', true);
    const runsTab = buildTab('claudeTabRuns', 'RUNS', false);
    chatTab.addEventListener('click', function() { setActiveTab('chat'); });
    runsTab.addEventListener('click', function() { setActiveTab('runs'); });
    // COVERAGE — a project-conditional third tab, hidden until the active project's
    // assignment.md classifies as unfilled/filled (refreshCoverageTab toggles it).
    // It sits as a standalone pill beside the CHAT/RUNS segmented control rather
    // than inside it, so the two-half control never reflows as this tab comes and
    // goes. Hidden by default so a project without an assignment shows no tab.
    const coverageTab = buildTab('claudeTabCoverage', 'COVERAGE', false);
    coverageTab.hidden = true;
    // A count badge for waiting derive proposals, appended beside the label. Hidden
    // until proposals exist (refreshCoverageBadge toggles it from getProposedRows).
    const coverageBadge = document.createElement('span');
    coverageBadge.id = 'claudeTabCoverageBadge';
    coverageBadge.className = 'claudeTabBadge';
    coverageBadge.hidden = true;
    coverageTab.appendChild(coverageBadge);
    coverageTab.addEventListener('click', function() { setActiveTab('coverage'); });
    // CHAT / RUNS live inside a single grouping wrapper so the desktop pane can
    // render them as one segmented control (a rounded container with the active
    // half highlighted). At mobile widths the wrapper is `display: contents`
    // (see .claudeTabGroup in style.css), so the two tabs fall back to being
    // direct flex children of #claudeSheetTabs and the slide-up sheet's tab row
    // looks exactly as before.
    const tabGroup = document.createElement('div');
    tabGroup.className = 'claudeTabGroup';
    tabGroup.appendChild(chatTab);
    tabGroup.appendChild(runsTab);
    tabs.appendChild(tabGroup);
    tabs.appendChild(coverageTab);
    tabs.appendChild(buildWorkspace());

    // The interactive surface (tabs + chat/runs views) lives in its own wrapper
    // so D2 can relocate the whole thing between the mobile sheet and the
    // desktop pane as a single node, without re-binding handlers. The handle
    // (mobile grab) and close row (desktop ×) are container chrome and stay with
    // the sheet. `contentEl` is the canonical query root for chat lookups.
    const body = document.createElement('div');
    body.id = 'claudeSheetBody';
    body.appendChild(tabs);
    body.appendChild(buildChatView());
    body.appendChild(buildRunsView());
    body.appendChild(buildCoverageView());
    contentEl = body;

    sheet.appendChild(handle);
    sheet.appendChild(closeRow);
    sheet.appendChild(body);

    attachSwipeToClose(sheet);
    return sheet;
}

// Walk up from `node` (exclusive of `stopAt`) looking for a scrollable
// ancestor — an element whose overflow-y allows scrolling and whose content
// actually overflows. Used to tell whether a touch began inside the chat log
// rather than on inert sheet chrome.
function findScrollableAncestor(node, stopAt) {
    let el = node;
    while (el && el !== stopAt && el.nodeType === 1) {
        const style = window.getComputedStyle(el);
        const oy = style ? style.overflowY : '';
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
            return el;
        }
        el = el.parentNode;
    }
    return null;
}

// Touch swipe-down to dismiss on mobile. HTML5 drag events don't fire on
// touch, so this rides touchstart/touchmove/touchend directly. Gated to the
// mobile viewport and to a downward gesture so taps on inner controls are
// untouched. The dismiss gesture only starts when the touch begins on the
// grabber handle (the explicit close affordance) OR inside the chat body
// while the scroll container is already at scrollTop === 0 (a pull-to-close
// from the top). Touches on other sheet chrome — tabs, composer, file
// picker — or inside a scrolled-down chat log never start a dismiss, so
// scrolling the log and tapping inner controls can't close the sheet. It
// only commits on a deliberate swipe: a long drag, or a shorter drag thrown
// with real downward velocity.
function attachSwipeToClose(target) {
    let startY = 0;
    let startT = 0;
    let tracking = false;
    target.addEventListener('touchstart', function(event) {
        if (window.innerWidth > MOBILE_MAX_WIDTH) return;
        if (!event.touches || event.touches.length !== 1) return;
        const handle = target.querySelector('#claudeSheetHandle');
        const onHandle = !!(handle && (event.target === handle || handle.contains(event.target)));
        if (!onHandle) {
            // Outside the grabber, dismiss is only allowed when the touch
            // starts in a scrollable region that's pinned at the top — there
            // a downward drag is pull-to-close intent, not scroll intent.
            // Touches on non-scrollable chrome or inside a scrolled-down
            // region must be left to native handling.
            const scrollable = findScrollableAncestor(event.target, target);
            if (!scrollable || scrollable.scrollTop > 0) return;
        }
        startY = event.touches[0].clientY;
        startT = Date.now();
        tracking = true;
    }, { passive: true });
    target.addEventListener('touchmove', function(event) {
        if (!tracking || !event.touches || !event.touches.length) return;
        const dy = event.touches[0].clientY - startY;
        if (dy < 0) tracking = false;
    }, { passive: true });
    target.addEventListener('touchend', function(event) {
        if (!tracking) return;
        tracking = false;
        const touch = (event.changedTouches && event.changedTouches[0]) || null;
        if (!touch) return;
        const dy = touch.clientY - startY;
        const dt = Math.max(1, Date.now() - startT);
        const velocity = dy / dt;
        // Deliberate-swipe gate: a long drag, or a shorter but fast downward
        // flick. Casual scroll-intent swipes clear neither bar.
        const longDrag = dy >= SWIPE_CLOSE_PX;
        const fastFlick = dy >= SWIPE_CLOSE_FLICK_PX && velocity >= SWIPE_CLOSE_VELOCITY_PX_PER_MS;
        if (longDrag || fastFlick) closeClaudeSheet();
    }, { passive: true });
}

export function mountClaudeSheet(parent) {
    if (!parent) return;
    // A fresh mount starts with no active dictation — stop any recognition the
    // previous sheet left running before the old DOM is replaced.
    stopDictation();
    // Hydrate the persistent send-mode default before building the composer so the
    // split button paints the saved Fast/Deep choice on first render.
    loadChatMode();
    launcherEl = buildLauncher();
    backdropEl = document.createElement('div');
    backdropEl.id = 'claudeSheetBackdrop';
    backdropEl.addEventListener('click', closeClaudeSheet);
    sheetEl = buildSheet();

    parent.appendChild(backdropEl);
    parent.appendChild(sheetEl);
    parent.appendChild(launcherEl);

    // D2: the desktop chat pane is built by main.js as part of the page shell.
    // Grab it (may be absent in unit mounts) and seat the chat content in the
    // container that matches the current viewport, then keep it in sync across
    // the breakpoint on resize. Drop any prior mount's resize listener so
    // remounts don't stack handlers.
    //
    // Scope the lookup to `parent`, not `document`: real boot (index.js) builds
    // the whole page tree inside a DETACHED `base` and mounts the sheet on it
    // BEFORE appending base to document.body. A document-level lookup here would
    // miss the still-detached pane, leave chatPaneEl null, and the desktop pane
    // would render empty. The pane is already a descendant of `parent` at this
    // point, so querySelector finds it whether or not base is attached yet.
    chatPaneEl = (parent.querySelector && parent.querySelector('#desktopChatPane'))
        || document.getElementById('desktopChatPane');
    placeChatContent();
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    resizeHandler = function() { placeChatContent(); };
    window.addEventListener('resize', resizeHandler);

    keydownHandler = function(event) {
        if (event.key !== 'Escape') return;
        // Escape peels back one layer: an open send-mode menu first, then the
        // whole sheet — so dismissing a popover never also closes the sheet
        // beneath it.
        if (isModeMenuOpen()) {
            closeModeMenu();
            return;
        }
        if (isClaudeSheetOpen()) closeClaudeSheet();
    };
    document.addEventListener('keydown', keydownHandler);

    // Close the file-picker panel on any click outside it. The panel stops its
    // own clicks from bubbling here, and the picker button shares the
    // .claudeAttach wrap, so tapping the button toggles rather than closes.
    if (attachClickHandler) document.removeEventListener('click', attachClickHandler);
    attachClickHandler = function(event) {
        const panel = sheetQuery('#claudeAttachPanel');
        if (!panel || panel.hidden) return;
        const wrap = sheetQuery('.claudeAttach');
        if (wrap && !wrap.contains(event.target)) setAttachPanelHidden(true);
    };
    document.addEventListener('click', attachClickHandler);

    // Close the send-mode menu on any click outside the model toggle. The menu
    // stops its own clicks from bubbling here, and the toggle shares the
    // .claudeModelToggleWrap, so tapping the toggle toggles rather than closes.
    if (modeMenuClickHandler) document.removeEventListener('click', modeMenuClickHandler);
    modeMenuClickHandler = function(event) {
        if (!isModeMenuOpen()) return;
        const wrap = sheetQuery('.claudeModelToggleWrap');
        if (wrap && !wrap.contains(event.target)) closeModeMenu();
    };
    document.addEventListener('click', modeMenuClickHandler);

    // Track the SW update-pending state so the Runs nudge and the inspector
    // gate stay in sync. Seed from hasPendingUpdate() to cover a worker that
    // was already waiting before this mount, then keep it current via the
    // event modals.js dispatches. Drop any prior mount's listener first so
    // remounts don't stack handlers.
    if (appUpdateHandler) document.removeEventListener('appUpdateAvailable', appUpdateHandler);
    appUpdateHandler = function() {
        updatePending = true;
        renderUpdateNudge();
    };
    document.addEventListener('appUpdateAvailable', appUpdateHandler);

    // The new build is now controlling the page (index.js fires this on the SW
    // `controllerchange`), so the pending cue is obsolete — clear it and hide
    // the nudge so it never lingers past the update it announced.
    if (appAppliedHandler) document.removeEventListener('appUpdateApplied', appAppliedHandler);
    appAppliedHandler = function() {
        updatePending = false;
        renderUpdateNudge();
    };
    document.addEventListener('appUpdateApplied', appAppliedHandler);

    // Repaint the workspace pill/menu when the Inject targets change mid-session
    // (an add/edit/delete in Inject settings dispatches this). Reload the cache
    // and re-project so the menu reflects the new set without a page reload;
    // chatHistory, attachments, and the active workspace survive (the pill wipes
    // the chat; auto-swap loads the target repo's saved thread). Drop any prior
    // mount's listener first so remounts don't stack handlers.
    if (injectTargetsChangedHandler) {
        document.removeEventListener('injectTargetsChanged', injectTargetsChangedHandler);
    }
    injectTargetsChangedHandler = function() { refreshWorkspaceRepos(); };
    document.addEventListener('injectTargetsChanged', injectTargetsChangedHandler);

    updatePending = hasPendingUpdate();
    renderUpdateNudge();

    // Fresh mount drops any pollers a prior mount left running. The chat thread
    // is NOT reset here — it's hydrated from the active repo's saved thread below
    // (after loadWorkspaceRepos resolves the workspace), so a reload resumes the
    // conversation rather than starting empty.
    attachedFiles = [];
    suggestedAttachedFiles = [];
    pendingSuggestedFiles = [];
    pendingImages = [];
    attachedRepo = null;
    // A fresh mount is never possessed, and it inherits neither identity's
    // banked draft. ghostSession is bumped rather than reset so any reply still
    // in flight from the previous mount can't paint into the new DOM.
    possessed = false;
    ghostHydrated = false;
    ghostSession++;
    workDraft = '';
    ghostDraft = '';
    applyPossessionState();
    activeChatRepo = DEFAULT_ATTACH_REPO;
    selectedAttachRepo = DEFAULT_ATTACH_REPO;
    // Reset to the safe fallback so a fresh mount never inherits a prior mount's
    // list; loadWorkspaceRepos repopulates it from the Worker when it resolves.
    attachRepos = [DEFAULT_ATTACH_REPO];
    srcManifestCache = {};
    // Project immediately from whatever the inject-targets cache already holds
    // (it may be warm from app boot's initInjectTargets), then reload it to
    // catch any change. Fire-and-forget: the pill/menu start on the current
    // projection and repaint when the reload resolves.
    loadWorkspaceRepos();
    refreshWorkspaceRepos();
    Object.keys(runPollers).forEach(stopRunPoller);

    // Hydrate the active workspace's chat thread from localStorage and replay it
    // onto the surface, so a reload / PWA relaunch resumes the conversation. Runs
    // after loadWorkspaceRepos so it keys on the resolved active repo. The repo's
    // iterate entry is hydrated alongside the thread, so a reload mid-iterate
    // resumes with the diff intact rather than silently dropping to no-diff turns.
    chatHistory = loadChatHistory(activeChatRepo);
    activeIterateEntry = loadIterateEntry(activeChatRepo);
    // The task scope is hydrated per repo alongside the thread and iterate entry,
    // so a reload / PWA relaunch resumes the same scope; renderScopeChip paints it
    // (self-healing to unscoped if the task was deleted while away).
    activeChatTask = loadChatTask(activeChatRepo);
    // A fresh mount (reload / PWA relaunch) has no in-flight hand-off — the link
    // is in-memory session state, and once a run ships it rides the persisted run
    // record instead, so a reload mid-hand-off simply drops the (pre-ship) link.
    activeHandoffRow = null;
    replayChatHistory();
    // The local thread has painted; now merge in the active repo's stored turns
    // so a conversation started on another device resumes here. Fire-and-forget
    // behind the synchronous hydrate, which is what keeps the chat instant and
    // usable offline.
    hydrateChatTurnsFromRemote(activeChatRepo);
    renderScopeChip();

    // Hydrate run records from localStorage, render them into the Runs tab,
    // and resume polling any run that was still in flight before a reload.
    loadRunRecords();
    renderRunsList();
    resumeRunPollers();

    // COVERAGE tab reactivity, wired once. onAssignmentChange fires when the
    // active project's assignment.md read resolves (from either the board or the
    // pane's own refresh) — reconcile the tab's visibility and repaint it then, so
    // it appears exactly when the read lands. onQueueChange keeps the open
    // coverage summary tracking rows that ship while it's the live tab, and always
    // refreshes the proposal-count badge so it tracks even from CHAT / RUNS.
    if (!coverageListenersWired) {
        coverageListenersWired = true;
        onAssignmentChange(refreshCoverageTab);
        onQueueChange(function() {
            if (sheetEl && sheetEl.getAttribute('data-tab') === 'coverage') {
                renderCoverageView();
            } else {
                refreshCoverageBadge();
            }
            // Keep the Runs tab tracking queue rows arriving and settling live —
            // the same subscription the coverage tab and the row badges use — so a
            // run dispatched or settled on another device appears without a reload.
            if (sheetEl && sheetEl.getAttribute('data-tab') === 'runs') {
                renderRunsList();
            }
        });
        // The Runs list's shipped spine is sourced from the TODO.md marker cache,
        // which onQueueChange does NOT cover: an entry shipped via Run backlog or
        // an entry's Run pill has no queue row, so its only signal is the marker
        // cache refreshing (which fires TODO_RUN_STATUS_EVENT). Repaint on that too
        // so a just-shipped entry appears the moment the cache reconciles.
        if (typeof document !== 'undefined') {
            document.addEventListener(TODO_RUN_STATUS_EVENT, function() {
                // The same cache reconcile is what proves a manually-merged PR
                // landed, so settle any AWAITING record against it BEFORE the
                // repaint — otherwise the row would paint amber one more time
                // and only flip on the following refresh.
                promoteAwaitingRecords();
                if (sheetEl && sheetEl.getAttribute('data-tab') === 'runs') {
                    renderRunsList();
                }
            });
        }
    }
    // Resolve the tab for whatever project is already selected at mount (a reload
    // lands on the persisted project without a fresh switch firing).
    refreshAssignmentForActiveProject();
    refreshCoverageTab();

    return { launcher: launcherEl, sheet: sheetEl, backdrop: backdropEl };
}
