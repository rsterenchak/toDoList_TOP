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

import {
    chatWithWorker,
    injectEntry,
    mintEntryId,
    embedEntryMarker,
    dispatchRun,
    pollRunStatus,
    resolveEntryByMarker,
    revertEntry,
    readTodoMdFromWorker,
    getCachedTargets,
    loadInjectTargets,
    isInjectConfigured,
    showInjectToast,
} from './inject.js';
import {
    readActiveRun,
    writeActiveRun,
    clearActiveRun,
    activeProjectNameForViewer,
} from './runState.js';
import { listLogic } from './listLogic.js';
import { setChatPaneCollapsed } from './prefs.js';
import { serializeLayout } from './layoutInspect.js';
import { applyPendingUpdate, hasPendingUpdate, showConfirmModal } from './modals.js';
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
// Voice dictation (browser-native speech recognition). `micRecognition` holds
// the live recognition instance while recording, null otherwise; `micRecording`
// tracks the button's recording state; `micBaseValue` is the composer text
// captured when recording started, so each transcript update is appended onto
// what the user had already typed rather than clobbering it.
let micRecognition = null;
let micRecording = false;
let micBaseValue = '';
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
    const chatTab = sheetQuery('#claudeTabChat');
    const runsTab = sheetQuery('#claudeTabRuns');
    const chatView = sheetQuery('#claudeChatView');
    const runsView = sheetQuery('#claudeRunsView');
    if (chatTab) chatTab.setAttribute('aria-selected', String(tab === 'chat'));
    if (runsTab) runsTab.setAttribute('aria-selected', String(tab === 'runs'));
    if (chatView) chatView.hidden = tab !== 'chat';
    if (runsView) runsView.hidden = tab !== 'runs';
    // The attach button and its dropdown live in the composer, so they hide with
    // the chat view on the Runs tab. Still gate the button explicitly and collapse
    // the panel when leaving Chat so a panel left open can't linger on return.
    const attachBtn = sheetQuery('#claudeComposerAttach');
    if (attachBtn) attachBtn.hidden = tab !== 'chat';
    if (tab !== 'chat') setAttachPanelHidden(true);
    // Clear chat acts on the conversation, so it's chat-only — hide it on Runs.
    const clearChatBtn = sheetQuery('#claudeClearChat');
    if (clearChatBtn) clearChatBtn.hidden = tab !== 'chat';
    // Re-evaluate the reload nudge each time Runs opens so a flag left stale by
    // a worker that activated without dispatching appUpdateApplied can't surface
    // a false-positive banner — the visibility decision reads live worker state.
    if (tab === 'runs') renderUpdateNudge();
}

export function openClaudeSheet() {
    if (!sheetEl) return;
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
}

export function closeClaudeSheet() {
    if (!sheetEl) return;
    // Don't leave a dictation running in the background if the sheet is
    // dismissed mid-recording.
    stopMicRecording();
    sheetEl.classList.remove('open');
    sheetEl.setAttribute('aria-hidden', 'true');
    if (backdropEl) backdropEl.classList.remove('open');
    if (launcherEl) launcherEl.setAttribute('aria-expanded', 'false');
}

export function toggleClaudeSheet() {
    if (isClaudeSheetOpen()) closeClaudeSheet();
    else openClaudeSheet();
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
    autoSwapWorkspaceForProject(projectName);
}

// On a project switch, re-point the chat workspace at the project's configured
// inject repo so the next chat turn is framed around the right app. Chat threads
// are persisted per repo (todoapp_claudeChat), so the swap saves the outgoing
// repo's thread and resumes the incoming repo's saved thread — unlike the
// "Clear chat" control, which deliberately wipes the current thread. Resolves
// projectName → target_id → the cached inject target's repo; leaves the
// workspace untouched when the project has no target, the target is no longer
// cached, or the repo already matches the active workspace.
function autoSwapWorkspaceForProject(projectName) {
    const targetId = listLogic.getProjectTargetId(projectName);
    if (!targetId) return;
    const targets = getCachedTargets();
    let repo = null;
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] && targets[i].id === targetId) { repo = targets[i].repo; break; }
    }
    if (!repo || repo === activeChatRepo) return;

    // Persist the outgoing repo's thread, switch, then resume the incoming
    // repo's saved thread (empty when none) and replay it onto the surface.
    saveChatHistory();
    setActiveChatRepo(repo);
    chatHistory = loadChatHistory(repo);
    clearAttachments();
    replayChatHistory();
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
// turns so a long conversation can't grow the key without bound.
function saveChatHistory() {
    const map = readChatMap();
    map[activeChatRepo] = chatHistory.slice(-CHAT_HISTORY_CAP);
    writeChatMap(map);
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

// Clear the chat surface and replay the in-memory chatHistory into it, rendering
// assistant turns through renderAssistantContent so fenced ```html/```svg replay
// as rendered markup rather than raw text. Used on mount-hydrate and auto-swap.
function replayChatHistory() {
    const surface = sheetQuery('#claudeChatSurface');
    if (surface) surface.innerHTML = '';
    for (let i = 0; i < chatHistory.length; i++) {
        const turn = chatHistory[i];
        if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) continue;
        const bubble = appendMessageBubble(turn.role, turn.content);
        if (turn.role === 'assistant' && bubble) renderAssistantContent(bubble, turn.content);
    }
}

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

function buildLauncher() {
    const btn = document.createElement('button');
    btn.id = 'claudeLauncher';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open Claude assistant');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = 'Claude';
    btn.textContent = '⋯';
    btn.addEventListener('click', function(event) {
        event.stopPropagation();
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

// The "Clear chat" control in the tab row, to the right of the CHAT / RUNS
// selector. Text-only (no icon), tinted with the danger token. Wipes the
// current conversation but never the attachments or the iterate seed.
function buildClearChat() {
    const btn = document.createElement('button');
    btn.id = 'claudeClearChat';
    btn.type = 'button';
    btn.className = 'claudeClearChat';
    btn.textContent = 'Clear chat';
    btn.setAttribute('aria-label', 'Clear chat');
    btn.addEventListener('click', clearChatConversation);
    return btn;
}

// Wipe the current conversation — the in-memory message array, its persisted
// per-repo copy, and every rendered bubble — without touching the attached file
// chips or the active workspace. The iterate seed rides only an iterate
// session's first turn (a transient arg to requestAssistantReply, never stored
// state), so clearing the messages can't disturb it; a later iterate from a
// shipped run still seeds fresh.
function clearChatConversation() {
    chatHistory = [];
    deleteChatHistory(activeChatRepo);
    const surface = sheetQuery('#claudeChatSurface');
    if (surface) surface.innerHTML = '';
}

// The composer file-picker button + its dropdown panel. The button leads the
// composer row (before the mic, textarea, and Send); the panel anchors directly
// above the button (the composer lives at the bottom of the sheet) and overlays
// the chat surface rather than displacing it, so tapping it drops the picker
// open right where it lives.
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
    attach.textContent = '📎';
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

// Paint the main send button (label + accent + aria-label) and the menu's ★ from
// the current chatMode. Defaults to the live contentEl scope, but accepts an
// explicit `root` so it can paint a freshly-built view before it is mounted (at
// which point contentEl is still null).
function renderSendMode(root) {
    const scope = root || contentEl;
    if (!scope) return;
    const isDeep = chatMode === 'deep';
    const send = scope.querySelector('#claudeComposerSend');
    if (send) {
        const label = send.querySelector('.claudeSendModeLabel');
        if (label) label.textContent = isDeep ? 'Deep' : 'Fast';
        send.setAttribute('aria-label', isDeep ? 'Send deep' : 'Send');
        send.classList.toggle('claudeComposerSendDeep', isDeep);
    }
    const menu = scope.querySelector('#claudeComposerModeMenu');
    if (menu) {
        const options = menu.querySelectorAll('.claudeModeOption');
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const on = opt.getAttribute('data-mode') === chatMode;
            opt.setAttribute('aria-checked', on ? 'true' : 'false');
            const star = opt.querySelector('.claudeModeStar');
            if (star) star.textContent = on ? '★' : '';
        }
    }
}

function isModeMenuOpen() {
    const menu = sheetQuery('#claudeComposerModeMenu');
    return !!(menu && !menu.hidden);
}

function openModeMenu() {
    const menu = sheetQuery('#claudeComposerModeMenu');
    const caret = sheetQuery('#claudeComposerSendCaret');
    if (!menu) return;
    menu.hidden = false;
    if (caret) caret.setAttribute('aria-expanded', 'true');
}

function closeModeMenu() {
    const menu = sheetQuery('#claudeComposerModeMenu');
    const caret = sheetQuery('#claudeComposerSendCaret');
    if (menu) menu.hidden = true;
    if (caret) caret.setAttribute('aria-expanded', 'false');
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

    const surface = document.createElement('div');
    surface.id = 'claudeChatSurface';
    surface.className = 'claudeChatSurface';

    // Selected-attachment chips — sit directly above the composer.
    const chips = document.createElement('div');
    chips.id = 'claudeAttachChips';
    chips.className = 'claudeAttachChips';

    const composer = document.createElement('div');
    composer.id = 'claudeComposer';
    composer.className = 'claudeComposer';
    const input = document.createElement('textarea');
    input.id = 'claudeComposerInput';
    input.className = 'claudeComposerInput';
    input.setAttribute('placeholder', 'Ask Claude…');
    input.setAttribute('rows', '1');
    // Split send button: one main action that sends in the persistent default
    // mode (chatMode — 'fast' or 'deep', its label reflecting that mode) plus a
    // caret that opens a small menu to pick and persist the default. This replaces
    // the former side-by-side Fast/Deep send pair, so a deep send is a deliberate,
    // remembered choice rather than a separate per-tap button — and Enter now
    // sends in the chosen default rather than always Fast.
    const send = document.createElement('button');
    send.id = 'claudeComposerSend';
    send.type = 'button';
    send.className = 'claudeComposerSend';
    send.setAttribute('aria-label', 'Send');
    // The main button's caption names the active default ("Fast" / "Deep"); a
    // span so renderSendMode() can repaint just the text. Initial text is filled
    // by renderSendMode() below once the button is in the DOM.
    const sendModeLabel = document.createElement('span');
    sendModeLabel.className = 'claudeSendModeLabel';
    send.appendChild(sendModeLabel);

    // Caret: toggles the mode menu that opens above the split button.
    const sendCaret = document.createElement('button');
    sendCaret.id = 'claudeComposerSendCaret';
    sendCaret.type = 'button';
    sendCaret.className = 'claudeComposerSendCaret';
    sendCaret.textContent = '▾';
    sendCaret.setAttribute('aria-label', 'Choose send mode');
    sendCaret.setAttribute('aria-haspopup', 'menu');
    sendCaret.setAttribute('aria-expanded', 'false');

    // Mode menu: two options (Fast / Deep), the active default carrying a ★. Opens
    // above the button (the composer sits at the bottom of the sheet). Selecting a
    // mode persists it and closes the menu; the ★ tracks the choice.
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

    // The main button and caret sit in one split control, with the menu anchored
    // to it; .claudeSendSplit is the relative-positioned wrapper the menu drops
    // out of.
    const sendGroup = document.createElement('div');
    sendGroup.id = 'claudeComposerSendSplit';
    sendGroup.className = 'claudeSendSplit';
    sendGroup.appendChild(send);
    sendGroup.appendChild(sendCaret);
    sendGroup.appendChild(modeMenu);

    // Composer row reads [📎] [🎤] [input] [Send ▾]: the attach button + its
    // dropdown panel lead the row, the mic button follows, then the textarea, with
    // the split send control last. buildAttach() carries the attach button's click
    // listener and the panel; buildMicButton() carries the mic's listener (and
    // returns null on browsers without speech recognition, so the affordance is
    // hidden entirely rather than shown broken).
    composer.appendChild(buildAttach());
    const mic = buildMicButton();
    if (mic) composer.appendChild(mic);
    composer.appendChild(input);
    composer.appendChild(sendGroup);

    // Main send + Enter both use the persisted default mode (deep → deep_think).
    send.addEventListener('click', function() { sendChatTurn(chatMode === 'deep'); });
    sendCaret.addEventListener('click', function() { toggleModeMenu(); });
    // Enter sends; Shift+Enter inserts a newline.
    input.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendChatTurn(chatMode === 'deep');
        }
    });

    // Paint the initial label / accent / ★ from the hydrated default. Scoped to
    // the split control itself because contentEl isn't assigned until the sheet
    // body is built, and the composer isn't appended to `view` yet here.
    renderSendMode(sendGroup);

    view.appendChild(surface);
    view.appendChild(chips);
    view.appendChild(composer);
    return view;
}

// ── VOICE DICTATION ──
// Browser-native speech recognition turns the mic button into an alternative
// way to type into the composer. Transcribed text lands in the same input the
// user types into; from there it sends through the ordinary send path — there
// is no separate voice routing and no auto-send.

// The platform's SpeechRecognition constructor, or null if unsupported. Read
// live (not cached at module load) so the feature follows whatever `window`
// exposes — Chrome/Android ship `SpeechRecognition`, Safari/iOS the
// `webkit`-prefixed variant.
function getSpeechRecognitionCtor() {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// The mic button, or null when speech recognition is unavailable (so the caller
// simply omits it from the composer). Idle by default; toggles recording state
// classes as dictation starts and stops.
function buildMicButton() {
    if (!getSpeechRecognitionCtor()) return null;
    const mic = document.createElement('button');
    mic.id = 'claudeComposerMic';
    mic.type = 'button';
    mic.className = 'micButton';
    mic.setAttribute('aria-label', 'Voice input');
    // Simple mic glyph: a rounded capsule (the mic body) over a stand stem.
    mic.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="9" y="3" width="6" height="11" rx="3"></rect>' +
        '<path d="M5 11a7 7 0 0 0 14 0"></path>' +
        '<line x1="12" y1="18" x2="12" y2="21"></line></svg>';
    mic.addEventListener('click', function() { toggleMicRecording(); });
    return mic;
}

function micButtonEl() {
    return sheetQuery('#claudeComposerMic');
}

// Reflect the current dictation state on the button. `denied` wins over the
// recording flag so a permission failure shows the faded state even mid-attempt.
function setMicState(state) {
    const btn = micButtonEl();
    if (!btn) return;
    btn.classList.remove('micButton--recording', 'micButton--denied');
    if (state === 'recording') {
        btn.classList.add('micButton--recording');
        btn.setAttribute('aria-label', 'Stop voice input');
        btn.removeAttribute('title');
    } else if (state === 'denied') {
        btn.classList.add('micButton--denied');
        btn.setAttribute('aria-label', 'Voice input');
        btn.setAttribute('title',
            'Microphone permission denied. Enable it in browser settings to use voice input.');
    } else {
        btn.setAttribute('aria-label', 'Voice input');
        btn.removeAttribute('title');
    }
}

function toggleMicRecording() {
    if (micRecording) stopMicRecording();
    else startMicRecording();
}

// Spin up a recognition instance and begin dictating into the composer. The iOS
// PWA gotcha — `start()` sometimes throws or no-ops when permission must be
// re-granted per session — is handled by retrying once with a fresh instance
// before falling back to the denied state.
function startMicRecording() {
    const Ctor = getSpeechRecognitionCtor();
    const input = sheetQuery('#claudeComposerInput');
    if (!Ctor || !input) return;

    micBaseValue = input.value || '';

    const begin = function() {
        const recognition = new Ctor();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
        recognition.onresult = function(event) {
            let transcript = '';
            const results = event && event.results ? event.results : [];
            for (let i = 0; i < results.length; i++) {
                const alt = results[i] && results[i][0];
                if (alt && alt.transcript) transcript += alt.transcript;
            }
            const trimmed = transcript.trim();
            input.value = micBaseValue && trimmed
                ? micBaseValue + ' ' + trimmed
                : micBaseValue + trimmed;
        };
        recognition.onerror = function(event) {
            const code = event && event.error;
            if (code === 'not-allowed' || code === 'permission-denied' ||
                code === 'service-not-allowed') {
                micRecognition = null;
                micRecording = false;
                setMicState('denied');
            }
        };
        // Recognition ends on its own after a pause (continuous = false) or when
        // we stop it; either way the button returns to idle unless a denial
        // already moved it to the denied state.
        recognition.onend = function() {
            micRecognition = null;
            if (micRecording) {
                micRecording = false;
                setMicState('idle');
            }
        };
        return recognition;
    };

    try {
        micRecognition = begin();
        micRecognition.start();
    } catch (e) {
        // Retry once with a fresh instance (iOS PWA re-grant path).
        try {
            micRecognition = begin();
            micRecognition.start();
        } catch (e2) {
            micRecognition = null;
            micRecording = false;
            setMicState('denied');
            return;
        }
    }
    micRecording = true;
    setMicState('recording');
}

// Stop an in-flight dictation, leaving the transcribed text in the composer for
// the user to review/edit/send. Safe to call when not recording (used by the
// sheet-close cleanup so a dismiss can't leave a recording dangling).
function stopMicRecording() {
    micRecording = false;
    if (micRecognition) {
        try { micRecognition.stop(); } catch (e) { /* already stopped */ }
        micRecognition = null;
    }
    const btn = micButtonEl();
    if (btn && btn.classList.contains('micButton--recording')) setMicState('idle');
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
function manifestUrlForRepo(repo) {
    const parts = String(repo || '').split('/');
    const owner = parts[0] || '';
    const name = parts[1] || '';
    return 'https://' + owner + '.github.io/' + name + '/src-manifest.json';
}

// Fetch a repo's `src-manifest.json` once and cache the result per repo.
// Tolerates either a bare JSON array of paths or an object with a `files`
// array. Returns { ok, files }: `ok` is true only when a manifest was actually
// fetched and parsed (so the picker shows the browse list); any failure (404,
// network, parse) yields { ok: false, files: [] } so the picker degrades to the
// free-text path input rather than throwing.
async function loadManifest(repo) {
    if (srcManifestCache[repo]) return srcManifestCache[repo];
    let result;
    try {
        const res = await fetch(manifestUrlForRepo(repo));
        if (!res || !res.ok) {
            result = { ok: false, files: [] };
        } else {
            const data = await res.json();
            const files = Array.isArray(data)
                ? data
                : (data && Array.isArray(data.files) ? data.files : []);
            result = {
                ok: true,
                files: files.filter(function(p) { return typeof p === 'string' && p; }),
            };
        }
    } catch (e) {
        result = { ok: false, files: [] };
    }
    srcManifestCache[repo] = result;
    return result;
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
    chips.innerHTML = '';
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
        const repo = t && t.repo;
        if (repo && !seen[repo]) { seen[repo] = true; names.push(repo); }
    });
    attachRepos = names.length ? names : [DEFAULT_ATTACH_REPO];
    if (attachRepos.indexOf(activeChatRepo) === -1) {
        setActiveChatRepo(attachRepos[0]);
    }
    renderWorkspacePill();
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

// ── CHAT ──
function appendMessageBubble(role, text) {
    const surface = sheetQuery('#claudeChatSurface');
    if (!surface) return null;
    const bubble = document.createElement('div');
    bubble.className = 'claudeMsg claudeMsg--' + role;
    bubble.textContent = text;
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

async function sendChatTurn(deep) {
    const input = sheetQuery('#claudeComposerInput');
    const send = sheetQuery('#claudeComposerSend');
    if (!input) return;
    const text = (input.value || '').trim();
    if (!text) return;
    if (send && send.disabled) return;

    chatHistory.push({ role: 'user', content: text });
    saveChatHistory();
    appendMessageBubble('user', text);
    input.value = '';

    // A user can paste a pre-drafted entry straight into the composer; surface
    // its Inject & run card directly rather than forcing a re-prompt for Sonnet
    // to re-emit it. Shares extractDraftedEntry with the assistant-reply path.
    const pastedDraft = extractDraftedEntry(text);
    if (pastedDraft) renderDraftedEntryCard(pastedDraft);

    // Manual turns never carry an entry id — the iterate seed (turn 1) is the
    // only place it's sent; the Worker assembles the diff context from there.
    // `deep` is per-message: Fast passes undefined, Deep passes true.
    await requestAssistantReply(undefined, deep);
}

// Send the running history to the Worker, render the assistant reply in place
// of a pending bubble, and surface a drafted-entry card when the reply carries
// a fenced ```md block. Shared by the manual chat turn and the iterate seed.
// `entryId` is only supplied on an iterate session's first turn; a Worker 404
// for that seed means no merged PR carries the entry's marker yet, so it's
// shown as a gentle "nothing to iterate on" note rather than an error.
async function requestAssistantReply(entryId, deep) {
    const input = sheetQuery('#claudeComposerInput');
    const send = sheetQuery('#claudeComposerSend');
    const sendCaret = sheetQuery('#claudeComposerSendCaret');
    if (send) send.disabled = true;
    if (sendCaret) sendCaret.disabled = true;
    if (input) input.disabled = true;

    // A Deep turn routes to a heavier model, so its placeholder reads
    // "Thinking deeply…" rather than the plain "…" — the slower turn should
    // look intentional, not stalled.
    let pending = appendMessageBubble('assistant', deep ? 'Thinking deeply…' : '…');
    if (pending) pending.classList.add('claudeMsg--pending');

    try {
        const result = await chatWithWorker(chatHistory, entryId, attachedFiles, activeChatRepo, suggestedAttachedFiles, deep);
        const reply = result.reply;
        const suggestedFiles = result.suggestedFiles || [];
        chatHistory.push({ role: 'assistant', content: reply });
        saveChatHistory();
        const inspectSelector = extractInspectDirective(reply);
        if (pending && pending.parentNode) {
            pending.classList.remove('claudeMsg--pending');
            renderAssistantContent(pending, inspectSelector ? stripInspectDirective(reply) : reply);
        }
        if (inspectSelector) renderAttachLayoutButton(inspectSelector);
        const draft = extractDraftedEntry(reply);
        if (draft) renderDraftedEntryCard(draft);
        if (suggestedFiles.length) addSuggestedFiles(suggestedFiles);
    } catch (e) {
        if (pending && pending.parentNode) {
            pending.classList.remove('claudeMsg--pending');
            if (entryId && e && e.status === 404) {
                pending.classList.add('claudeMsg--note');
                pending.textContent = 'Nothing to iterate on yet — this run shipped before iterate tracking, so there’s no merged change to build on.';
            } else {
                pending.classList.add('claudeMsg--error');
                pending.textContent = 'Chat failed — ' + (e && e.reason ? e.reason : 'error');
            }
        }
    } finally {
        if (send) send.disabled = false;
        if (sendCaret) sendCaret.disabled = false;
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
// chat turn (no entry id) but with content the inspector composed rather than
// the composer.
async function sendInspectTurn(content) {
    chatHistory.push({ role: 'user', content: content });
    saveChatHistory();
    appendMessageBubble('user', content);
    await requestAssistantReply();
}

// Seed an iterate chat from a SHIPPED run: switch to the Chat tab, reset the
// conversation, and fire turn 1 carrying the run's entry id so the Worker
// resolves that entry's merged diff and replies with iterate context. Later
// turns omit the id (handled by sendChatTurn). Tapping a non-shipped or
// id-less run is a no-op — iterate needs a merged change to build on.
async function startIterateFromRun(rec) {
    if (!rec || rec.status !== 'SHIPPED' || !rec.entryId) return;
    setActiveTab('chat');
    if (!isClaudeSheetOpen()) openClaudeSheet();

    chatHistory = [];
    const surface = sheetQuery('#claudeChatSurface');
    if (surface) surface.innerHTML = '';
    clearAttachments();

    appendMessageBubble('note', 'Iterating on “' + (rec.title || 'this run') + '” — pulling the shipped change…');

    // The Worker requires a non-empty messages array even when entry_id is
    // present (the id only adds diff/code context to the system field, it's not
    // a turn), so seed turn 1 with a synthesized opening user message.
    const seedPrompt = 'Walk me through what shipped for this entry and whether it matches the intent.';
    chatHistory.push({ role: 'user', content: seedPrompt });
    appendMessageBubble('user', seedPrompt);

    await requestAssistantReply(rec.entryId);
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

    injectBtn.addEventListener('click', function() {
        injectBtn.hidden = true;
        confirm.hidden = false;
    });
    cancelBtn.addEventListener('click', function() {
        confirm.hidden = true;
        injectBtn.hidden = false;
    });
    shipBtn.addEventListener('click', function() {
        shipDraftedEntry(entryText, card);
    });

    actions.appendChild(injectBtn);
    actions.appendChild(confirm);
    card.appendChild(actions);
    surface.appendChild(card);
    surface.scrollTop = surface.scrollHeight;
    return card;
}

async function shipDraftedEntry(entryText, card) {
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

    const correlationId = mintEntryId();
    const dispatchResult = await dispatchRun({
        mode: 'entry',
        entryId: entryId,
        correlationId: correlationId,
        target: target,
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
    };
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
};

// The only GitHub workflow conclusions that are positive proof of failure.
// Any other completed conclusion (success aside) leaves the outcome
// unconfirmed rather than asserting FAILED.
const FAILURE_CONCLUSIONS = ['failure', 'cancelled', 'timed_out'];

function renderRunsList() {
    const list = sheetQuery('#claudeRunsList');
    if (!list) return;
    list.innerHTML = '';
    if (!runRecords.length) {
        const empty = document.createElement('p');
        empty.id = 'claudeRunsEmpty';
        empty.className = 'claudeRunsEmpty';
        empty.textContent = 'No runs yet — tap + New to start';
        list.appendChild(empty);
        return;
    }
    runRecords.forEach(function(rec) {
        list.appendChild(buildRunRow(rec));
    });
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
        message: 'Revert “' + (rec.title || 'this run') + '”? This ships a rollback — a new build will deploy.',
        confirmLabel: 'Revert',
        onConfirm: function() { performRevertRun(rec, btn); },
    });
}

async function performRevertRun(rec, btn) {
    btn.disabled = true;
    btn.classList.add('claudeRunRevertBtn--loading');
    // Revert against the repo the run shipped to, mirroring pollRunStatus: a run
    // without a persisted repo falls back to the Worker's default repo.
    const target = rec.repo ? { repo: rec.repo, file_path: 'TODO.md' } : null;
    const res = await revertEntry(rec.entryId, target);
    if (res && res.ok && res.merged === true) {
        // Rollback merged — a new build is deploying. Mark the record reverted so
        // the control can no longer be triggered (double-revert guard).
        showInjectToast('Reverted — new build shipping');
        rec.reverted = true;
        saveRunRecords();
        renderRunsList();
        return;
    }
    if (res && res.ok && res.merged === false) {
        // The revert PR opened but didn't auto-merge (conflict, or mergeability
        // unconfirmed). Persist the PR URL so the control switches to opening it
        // rather than POSTing again, and surface the reason.
        if (res.revert_pr_url) rec.revertPrUrl = res.revert_pr_url;
        saveRunRecords();
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
    }

    row.appendChild(title);
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
    } else if (status === 'NOCHANGE' && rec.runUrl) {
        // A "No change" run had nothing to merge, so it's not iterable. Instead
        // its row opens the GitHub Actions log so the user can read the agent's
        // verdict — same role="button" + Enter/Space affordance the iterable
        // rows use, with a trailing ↗ glyph marking it as an outbound link.
        row.classList.add('claudeRunRow--nochange');
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.setAttribute('aria-label', 'Open the run log for ' + (rec.title || 'this run'));
        row.title = 'Open the run log';
        const openLog = function() {
            try { window.open(rec.runUrl, '_blank', 'noopener'); } catch (e) { /* popup blocked */ }
        };
        row.addEventListener('click', openLog);
        row.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openLog();
            }
        });
        const glyph = document.createElement('span');
        glyph.className = 'claudeRunOpenGlyph';
        glyph.textContent = '↗';
        glyph.setAttribute('aria-hidden', 'true');
        row.appendChild(glyph);
    }
    return row;
}

function setRunRecordStatus(correlationId, status) {
    let changed = false;
    for (let i = 0; i < runRecords.length; i++) {
        if (runRecords[i].correlationId === correlationId &&
            runRecords[i].status !== status) {
            runRecords[i].status = status;
            changed = true;
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
    if (Date.now() - startedAt >= RUN_GIVE_UP_MS) {
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
            await reconcileSuccessConclusion(correlationId, project, res.runUrl, target);
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
        setRunRecordStatus(correlationId, 'QUEUED');
    } else {
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
// mislabeled. A record with no entryId or no resolvable target can't be
// verified, so keep the historical success → SHIPPED behavior for those.
async function reconcileSuccessConclusion(correlationId, project, runUrl, target) {
    const rec = findRunRecord(correlationId);
    const settle = function() {
        stopRunPoller(correlationId);
        freeProjectRunGuard(project);
    };
    if (!rec) { settle(); return; }
    if (!rec.entryId || !target || !target.repo || !target.file_path) {
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
            settle();
        } else {
            saveRunRecords();
        }
        return;
    }
    const state = entryCheckboxState(read.content, rec.entryId);
    if (state === 'unchecked') {
        // Entry still present and unchecked → the routine skipped it (no-op).
        // Persist the Actions log URL so the (non-iterable) "No change" row can
        // open it on tap.
        if (runUrl) rec.runUrl = runUrl;
        setRunRecordStatus(correlationId, 'NOCHANGE');
    } else {
        // 'checked' → shipped; null (marker absent) → fail safe to SHIPPED.
        setRunRecordStatus(correlationId, 'SHIPPED');
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
    tabs.appendChild(buildClearChat());
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
    stopMicRecording();
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

    // Close the send-mode menu on any click outside the split send control. The
    // menu stops its own clicks from bubbling here, and the caret shares the
    // .claudeSendSplit wrap, so tapping the caret toggles rather than closes.
    if (modeMenuClickHandler) document.removeEventListener('click', modeMenuClickHandler);
    modeMenuClickHandler = function(event) {
        if (!isModeMenuOpen()) return;
        const wrap = sheetQuery('.claudeSendSplit');
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
    attachedRepo = null;
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
    // after loadWorkspaceRepos so it keys on the resolved active repo.
    chatHistory = loadChatHistory(activeChatRepo);
    replayChatHistory();

    // Hydrate run records from localStorage, render them into the Runs tab,
    // and resume polling any run that was still in flight before a reload.
    loadRunRecords();
    renderRunsList();
    resumeRunPollers();

    return { launcher: launcherEl, sheet: sheetEl, backdrop: backdropEl };
}
