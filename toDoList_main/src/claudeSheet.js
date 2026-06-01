// In-app Claude assistant. Lives behind a `⋯` launcher pinned to the
// bottom-right (the slot the old help `?` FAB used to occupy — help moved to
// the ghost menu's "Help" item and the global `?` keypress). On narrow
// viewports (≤700px) the surface is a bottom sheet at ~86% height with a grab
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
} from './inject.js';
import { serializeLayout } from './layoutInspect.js';
import { applyPendingUpdate, hasPendingUpdate } from './modals.js';

const MOBILE_MAX_WIDTH = 700;
const SWIPE_CLOSE_PX = 60;

const RUNS_KEY = 'todoapp_claudeRuns';
const RUN_POLL_INTERVAL_MS = 5000;
const RUN_GIVE_UP_MS = 10 * 60 * 1000;

// Repos the file-attach picker can pull source from. Mirrors the Worker's
// ALLOWED_TARGETS. The default repo is the only one with a published
// `src-manifest.json`, so it gets the browsable file list; others fall back to
// a free-text path input since there's no manifest to render.
const DEFAULT_ATTACH_REPO = 'rsterenchak/toDoList_TOP';
const ATTACH_REPOS = [DEFAULT_ATTACH_REPO, 'rsterenchak/matchingGame-test'];

let launcherEl = null;
let sheetEl = null;
let backdropEl = null;
let keydownHandler = null;
let workspaceClickHandler = null;
let attachClickHandler = null;
let appUpdateHandler = null;
let appAppliedHandler = null;

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
// Run records, newest-first: [{ entryId, correlationId, title, status,
// dispatchedAt }]. Mirrored to localStorage so they survive a reload.
let runRecords = [];
// correlationId -> interval handle for in-flight status polls.
const runPollers = {};

export function isClaudeSheetOpen() {
    return !!(sheetEl && sheetEl.classList.contains('open'));
}

function setActiveTab(tab) {
    if (!sheetEl) return;
    sheetEl.setAttribute('data-tab', tab);
    const chatTab = sheetEl.querySelector('#claudeTabChat');
    const runsTab = sheetEl.querySelector('#claudeTabRuns');
    const chatView = sheetEl.querySelector('#claudeChatView');
    const runsView = sheetEl.querySelector('#claudeRunsView');
    if (chatTab) chatTab.setAttribute('aria-selected', String(tab === 'chat'));
    if (runsTab) runsTab.setAttribute('aria-selected', String(tab === 'runs'));
    if (chatView) chatView.hidden = tab !== 'chat';
    if (runsView) runsView.hidden = tab !== 'runs';
    // The attach button and its dropdown now live in the header, so they no
    // longer hide with the chat view automatically — gate the button to the Chat
    // tab and collapse the panel when leaving Chat so it never floats over Runs.
    const attachBtn = sheetEl.querySelector('#claudeComposerAttach');
    if (attachBtn) attachBtn.hidden = tab !== 'chat';
    if (tab !== 'chat') setAttachPanelHidden(true);
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
}

export function closeClaudeSheet() {
    if (!sheetEl) return;
    sheetEl.classList.remove('open');
    sheetEl.setAttribute('aria-hidden', 'true');
    if (backdropEl) backdropEl.classList.remove('open');
    if (launcherEl) launcherEl.setAttribute('aria-expanded', 'false');
}

export function toggleClaudeSheet() {
    if (isClaudeSheetOpen()) closeClaudeSheet();
    else openClaudeSheet();
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

function isTerminalStatus(status) {
    return status === 'SHIPPED' || status === 'FAILED';
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

// The chat-level workspace pill + its dropdown menu. Sits in the tab row,
// low-emphasis, naming the repo the conversation is anchored to.
function buildWorkspace() {
    const wrap = document.createElement('div');
    wrap.className = 'claudeWorkspace';

    const pill = document.createElement('button');
    pill.id = 'claudeWorkspacePill';
    pill.type = 'button';
    pill.className = 'claudeWorkspacePill';
    pill.setAttribute('aria-haspopup', 'menu');
    pill.setAttribute('aria-expanded', 'false');
    pill.addEventListener('click', function(event) {
        event.stopPropagation();
        toggleWorkspaceMenu();
    });

    const menu = document.createElement('div');
    menu.id = 'claudeWorkspaceMenu';
    menu.className = 'claudeWorkspaceMenu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    // Keep clicks inside the menu from reaching the document-level outside-click
    // handler — a menu item that rebuilds the menu detaches its own node, which
    // would otherwise read as a click "outside" and close the menu prematurely.
    menu.addEventListener('click', function(event) { event.stopPropagation(); });

    wrap.appendChild(pill);
    wrap.appendChild(menu);
    return wrap;
}

// The header-level file-picker button + its dropdown panel. The panel anchors
// directly below the button (like the workspace pill's menu) and overlays the
// chat surface and composer rather than displacing them, so tapping the
// top-right button drops the picker down right where it lives.
function buildAttach() {
    const wrap = document.createElement('div');
    wrap.className = 'claudeAttach';

    // File-picker button — a header-level control grouped with the tabs and
    // workspace pill. It toggles the attach panel that drops down beneath it;
    // setActiveTab hides it on the Runs tab since attachments are chat-only.
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
    const send = document.createElement('button');
    send.id = 'claudeComposerSend';
    send.type = 'button';
    send.className = 'claudeComposerSend';
    send.textContent = '↑';
    send.setAttribute('aria-label', 'Send');
    composer.appendChild(input);
    composer.appendChild(send);

    send.addEventListener('click', function() { sendChatTurn(); });
    // Enter sends; Shift+Enter inserts a newline.
    input.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendChatTurn();
        }
    });

    view.appendChild(surface);
    view.appendChild(chips);
    view.appendChild(composer);
    return view;
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
    const search = sheetEl && sheetEl.querySelector('#claudeAttachSearch');
    return search ? search.value : '';
}

// Toggle the file-picker panel. On open, sync the picker to the current repo
// selection: fetch its manifest and either show the browse list or fall back to
// the free-text path input.
async function toggleAttachPanel() {
    const panel = sheetEl && sheetEl.querySelector('#claudeAttachPanel');
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
    const panel = sheetEl && sheetEl.querySelector('#claudeAttachPanel');
    if (panel) panel.hidden = hidden;
    const btn = sheetEl && sheetEl.querySelector('#claudeComposerAttach');
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
    const notice = sheetEl && sheetEl.querySelector('#claudeAttachNotice');
    if (!notice) return;
    notice.textContent = 'Attachments must come from one repo per conversation. Clear current chips or start a + New chat to switch repos.';
    notice.hidden = false;
}

function clearAttachNotice() {
    const notice = sheetEl && sheetEl.querySelector('#claudeAttachNotice');
    if (!notice) return;
    notice.hidden = true;
    notice.textContent = '';
}

// Show or hide the browse controls vs. the free-text path input. Browse mode is
// for repos with a fetchable manifest; free-text is the fallback.
function applyAttachPickerMode(isManifest) {
    const search = sheetEl && sheetEl.querySelector('#claudeAttachSearch');
    const list = sheetEl && sheetEl.querySelector('#claudeAttachList');
    const pathRow = sheetEl && sheetEl.querySelector('#claudeAttachPathRow');
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
    const input = sheetEl && sheetEl.querySelector('#claudeAttachPathInput');
    if (!input) return;
    const path = (input.value || '').trim();
    if (!path) return;
    if (addAttachment(path, selectedAttachRepo)) input.value = '';
}

function renderAttachList(filter) {
    const list = sheetEl && sheetEl.querySelector('#claudeAttachList');
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
    renderAttachChips();
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
    renderAttachChips();
    renderAttachIntro();
    renderAttachList(currentAttachFilter());
}

// Reset attachments for a fresh conversation: drop the list, clear the chips
// and intro row, and collapse the picker. The active workspace is unchanged —
// a fresh chat stays in the same workspace — so the picker re-syncs to it.
function clearAttachments() {
    attachedFiles = [];
    attachedRepo = null;
    selectedAttachRepo = activeChatRepo;
    clearAttachNotice();
    renderAttachChips();
    renderAttachIntro();
    setAttachPanelHidden(true);
    renderAttachList('');
}

function renderAttachChips() {
    const chips = sheetEl && sheetEl.querySelector('#claudeAttachChips');
    if (!chips) return;
    chips.innerHTML = '';
    attachedFiles.forEach(function(path) {
        const chip = document.createElement('span');
        chip.className = 'claudeAttachChip';
        chip.dataset.path = path;
        const label = document.createElement('span');
        label.className = 'claudeAttachChipLabel';
        // Default-repo chips read as a bare basename; chips from any other repo
        // carry their repo subtly so a mixed-looking set stays unambiguous.
        label.textContent = (attachedRepo && attachedRepo !== DEFAULT_ATTACH_REPO)
            ? repoShortName(attachedRepo) + ': ' + path
            : fileBasename(path);
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'claudeAttachChipRemove';
        x.setAttribute('aria-label', 'Remove ' + fileBasename(path));
        x.textContent = '✕';
        x.addEventListener('click', function() { removeAttachment(path); });
        chip.appendChild(label);
        chip.appendChild(x);
        chips.appendChild(chip);
    });
}

// A single intro row pinned to the top of the thread that names the attached
// files, so the user can see what source context the assistant has. Updated in
// place; removed entirely when no attachments remain.
function renderAttachIntro() {
    const surface = sheetEl && sheetEl.querySelector('#claudeChatSurface');
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

// ── WORKSPACE (chat-level repo selector) ──
// The workspace pill names the repo the whole conversation is framed around.
// Tapping it opens a menu of all allowed repos; choosing a different one (behind
// an inline confirm, since it wipes the chat) switches the active workspace.

function setActiveChatRepo(repo) {
    activeChatRepo = repo;
    selectedAttachRepo = repo;
}

// Paint the pill with the active workspace's short name, e.g. "📂 toDoList_TOP ▾".
function renderWorkspacePill() {
    const pill = sheetEl && sheetEl.querySelector('#claudeWorkspacePill');
    if (!pill) return;
    pill.textContent = '📂 ' + repoShortName(activeChatRepo) + ' ▾';
    pill.title = 'Workspace: ' + activeChatRepo;
}

function isWorkspaceMenuOpen() {
    const menu = sheetEl && sheetEl.querySelector('#claudeWorkspaceMenu');
    return !!(menu && !menu.hidden);
}

function openWorkspaceMenu() {
    const menu = sheetEl && sheetEl.querySelector('#claudeWorkspaceMenu');
    const pill = sheetEl && sheetEl.querySelector('#claudeWorkspacePill');
    if (!menu) return;
    buildWorkspaceMenu();
    menu.hidden = false;
    if (pill) pill.setAttribute('aria-expanded', 'true');
}

function closeWorkspaceMenu() {
    const menu = sheetEl && sheetEl.querySelector('#claudeWorkspaceMenu');
    const pill = sheetEl && sheetEl.querySelector('#claudeWorkspacePill');
    if (menu) { menu.hidden = true; menu.innerHTML = ''; }
    if (pill) pill.setAttribute('aria-expanded', 'false');
}

function toggleWorkspaceMenu() {
    if (isWorkspaceMenuOpen()) closeWorkspaceMenu();
    else openWorkspaceMenu();
}

// Render one radio menu item per allowed repo, the active one checkmarked.
function buildWorkspaceMenu() {
    const menu = sheetEl && sheetEl.querySelector('#claudeWorkspaceMenu');
    if (!menu) return;
    menu.innerHTML = '';
    ATTACH_REPOS.forEach(function(repo) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'claudeWorkspaceItem';
        item.setAttribute('role', 'menuitemradio');
        item.dataset.repo = repo;
        const active = repo === activeChatRepo;
        item.setAttribute('aria-checked', String(active));
        if (active) item.classList.add('claudeWorkspaceItem--active');
        item.textContent = (active ? '✓ ' : '') + repoShortName(repo);
        item.addEventListener('click', function() { onWorkspaceItemClick(repo); });
        menu.appendChild(item);
    });
}

// Choosing the active repo is a no-op (just close); a different one asks to
// confirm first, because switching wipes the current chat.
function onWorkspaceItemClick(repo) {
    if (repo === activeChatRepo) { closeWorkspaceMenu(); return; }
    showWorkspaceConfirm(repo);
}

function showWorkspaceConfirm(repo) {
    const menu = sheetEl && sheetEl.querySelector('#claudeWorkspaceMenu');
    if (!menu) return;
    menu.innerHTML = '';
    const confirm = document.createElement('div');
    confirm.className = 'claudeWorkspaceConfirm';
    const warn = document.createElement('p');
    warn.className = 'claudeWorkspaceConfirmWarn';
    warn.textContent = 'Switch to ' + repoShortName(repo) + '? This clears the current chat.';
    const row = document.createElement('div');
    row.className = 'claudeWorkspaceConfirmRow';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'claudeWorkspaceConfirmYes';
    yes.textContent = 'Switch';
    yes.addEventListener('click', function() { confirmWorkspaceSwitch(repo); });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'claudeWorkspaceConfirmCancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function() { closeWorkspaceMenu(); });
    row.appendChild(yes);
    row.appendChild(cancel);
    confirm.appendChild(warn);
    confirm.appendChild(row);
    menu.appendChild(confirm);
}

// Commit the workspace switch: adopt the new repo, wipe the conversation (same
// effect as + New), repaint the pill, and re-sync the picker to the new repo if
// it's open.
function confirmWorkspaceSwitch(repo) {
    setActiveChatRepo(repo);

    chatHistory = [];
    const surface = sheetEl && sheetEl.querySelector('#claudeChatSurface');
    if (surface) surface.innerHTML = '';

    const panel = sheetEl && sheetEl.querySelector('#claudeAttachPanel');
    const pickerWasOpen = !!(panel && !panel.hidden);

    clearAttachments();

    renderWorkspacePill();
    closeWorkspaceMenu();

    if (pickerWasOpen && panel) {
        setAttachPanelHidden(false);
        refreshAttachPickerMode();
    }
}

// ── CHAT ──
function appendMessageBubble(role, text) {
    const surface = sheetEl && sheetEl.querySelector('#claudeChatSurface');
    if (!surface) return null;
    const bubble = document.createElement('div');
    bubble.className = 'claudeMsg claudeMsg--' + role;
    bubble.textContent = text;
    surface.appendChild(bubble);
    surface.scrollTop = surface.scrollHeight;
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

async function sendChatTurn() {
    const input = sheetEl && sheetEl.querySelector('#claudeComposerInput');
    const send = sheetEl && sheetEl.querySelector('#claudeComposerSend');
    if (!input) return;
    const text = (input.value || '').trim();
    if (!text) return;
    if (send && send.disabled) return;

    chatHistory.push({ role: 'user', content: text });
    appendMessageBubble('user', text);
    input.value = '';

    // Manual turns never carry an entry id — the iterate seed (turn 1) is the
    // only place it's sent; the Worker assembles the diff context from there.
    await requestAssistantReply();
}

// Send the running history to the Worker, render the assistant reply in place
// of a pending bubble, and surface a drafted-entry card when the reply carries
// a fenced ```md block. Shared by the manual chat turn and the iterate seed.
// `entryId` is only supplied on an iterate session's first turn; a Worker 404
// for that seed means no merged PR carries the entry's marker yet, so it's
// shown as a gentle "nothing to iterate on" note rather than an error.
async function requestAssistantReply(entryId) {
    const input = sheetEl && sheetEl.querySelector('#claudeComposerInput');
    const send = sheetEl && sheetEl.querySelector('#claudeComposerSend');
    if (send) send.disabled = true;
    if (input) input.disabled = true;

    let pending = appendMessageBubble('assistant', '…');
    if (pending) pending.classList.add('claudeMsg--pending');

    try {
        const reply = await chatWithWorker(chatHistory, entryId, attachedFiles, activeChatRepo);
        chatHistory.push({ role: 'assistant', content: reply });
        const inspectSelector = extractInspectDirective(reply);
        if (pending && pending.parentNode) {
            pending.classList.remove('claudeMsg--pending');
            pending.textContent = inspectSelector ? stripInspectDirective(reply) : reply;
        }
        if (inspectSelector) renderAttachLayoutButton(inspectSelector);
        const draft = extractDraftedEntry(reply);
        if (draft) renderDraftedEntryCard(draft);
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
    const surface = sheetEl && sheetEl.querySelector('#claudeChatSurface');
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
    const surface = sheetEl && sheetEl.querySelector('#claudeChatSurface');
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
    const surface = sheetEl && sheetEl.querySelector('#claudeChatSurface');
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
    if (shipBtn) shipBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    const entryId = mintEntryId();
    const entry = embedEntryMarker(entryText, entryId);
    const injectResult = await injectEntry({ entry: entry, id: entryId });
    if (!injectResult.ok) {
        markDraftCardError(card, 'Inject failed — ' + (injectResult.reason || 'error'));
        return;
    }

    const correlationId = mintEntryId();
    const dispatchResult = await dispatchRun({
        mode: 'entry',
        entryId: entryId,
        correlationId: correlationId,
    });
    if (!dispatchResult.ok) {
        markDraftCardError(card, 'Run failed — ' + (dispatchResult.reason || 'error'));
        return;
    }

    const record = {
        entryId: entryId,
        correlationId: correlationId,
        title: deriveRunTitle(entryText),
        status: 'QUEUED',
        dispatchedAt: Date.now(),
    };
    runRecords.unshift(record);
    saveRunRecords();
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
        const input = sheetEl && sheetEl.querySelector('#claudeComposerInput');
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
    const nudge = sheetEl && sheetEl.querySelector('#claudeUpdateNudge');
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
};

// The only GitHub workflow conclusions that are positive proof of failure.
// Any other completed conclusion (success aside) leaves the outcome
// unconfirmed rather than asserting FAILED.
const FAILURE_CONCLUSIONS = ['failure', 'cancelled', 'timed_out'];

function renderRunsList() {
    const list = sheetEl && sheetEl.querySelector('#claudeRunsList');
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
function startRunPoller(rec) {
    if (!rec || !rec.correlationId) return;
    const correlationId = rec.correlationId;
    if (runPollers[correlationId]) return;
    if (isTerminalStatus(rec.status)) return;
    const startedAt = typeof rec.dispatchedAt === 'number' ? rec.dispatchedAt : Date.now();
    runPollers[correlationId] = setInterval(function() {
        pollRunRecordOnce(correlationId, startedAt);
    }, RUN_POLL_INTERVAL_MS);
    pollRunRecordOnce(correlationId, startedAt);
}

function stopRunPoller(correlationId) {
    if (runPollers[correlationId]) {
        clearInterval(runPollers[correlationId]);
        delete runPollers[correlationId];
    }
}

async function pollRunRecordOnce(correlationId, startedAt) {
    if (Date.now() - startedAt >= RUN_GIVE_UP_MS) {
        // Past the give-up window the run can no longer be reconciled. We can't
        // see a positive outcome either way, so "couldn't confirm" is NOT
        // "failed" — flag it unconfirmed (keeping its last-known status) and
        // stop watching so the row neither lies about failure nor sits
        // "Running" forever.
        markRunRecordUnconfirmed(correlationId);
        stopRunPoller(correlationId);
        return;
    }
    const res = await pollRunStatus({ correlationId: correlationId });
    if (!res || res.ok === false) return; // transient — keep polling
    if (res.found === false) return; // run not surfaced yet — stay QUEUED
    if (res.status === 'completed') {
        // Only assert FAILED on a positive failure signal. A success conclusion
        // ships; a recognized failure conclusion fails; anything else completed
        // (neutral, skipped, action_required, or no conclusion) is unconfirmed
        // rather than asserted-failed.
        if (res.conclusion === 'success') {
            setRunRecordStatus(correlationId, 'SHIPPED');
        } else if (FAILURE_CONCLUSIONS.indexOf(res.conclusion) !== -1) {
            setRunRecordStatus(correlationId, 'FAILED');
        } else {
            markRunRecordUnconfirmed(correlationId);
        }
        stopRunPoller(correlationId);
        return;
    }
    if (res.status === 'queued') {
        setRunRecordStatus(correlationId, 'QUEUED');
    } else {
        setRunRecordStatus(correlationId, 'RUNNING');
    }
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

    // Close `×` — surfaced on the desktop panel only (CSS hides it at ≤700px,
    // where backdrop-tap and swipe-down already dismiss). Reuses the same close
    // path as the launcher and backdrop; not a second close route.
    const closeX = document.createElement('button');
    closeX.id = 'claudeSheetClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close Claude panel');
    closeX.textContent = '×';
    closeX.addEventListener('click', closeClaudeSheet);

    const tabs = document.createElement('div');
    tabs.id = 'claudeSheetTabs';
    tabs.className = 'claudeSheetTabs';
    tabs.setAttribute('role', 'tablist');
    const chatTab = buildTab('claudeTabChat', 'CHAT', true);
    const runsTab = buildTab('claudeTabRuns', 'RUNS', false);
    chatTab.addEventListener('click', function() { setActiveTab('chat'); });
    runsTab.addEventListener('click', function() { setActiveTab('runs'); });
    tabs.appendChild(chatTab);
    tabs.appendChild(runsTab);
    tabs.appendChild(buildWorkspace());
    tabs.appendChild(buildAttach());

    sheet.appendChild(handle);
    sheet.appendChild(closeX);
    sheet.appendChild(tabs);
    sheet.appendChild(buildChatView());
    sheet.appendChild(buildRunsView());

    attachSwipeToClose(sheet);
    return sheet;
}

// Touch swipe-down to dismiss on mobile. HTML5 drag events don't fire on
// touch, so this rides touchstart/touchmove/touchend directly. Gated to the
// mobile viewport and to a downward gesture so taps on inner controls are
// untouched.
function attachSwipeToClose(target) {
    let startY = 0;
    let tracking = false;
    target.addEventListener('touchstart', function(event) {
        if (window.innerWidth > MOBILE_MAX_WIDTH) return;
        if (!event.touches || event.touches.length !== 1) return;
        startY = event.touches[0].clientY;
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
        if (touch.clientY - startY >= SWIPE_CLOSE_PX) closeClaudeSheet();
    }, { passive: true });
}

export function mountClaudeSheet(parent) {
    if (!parent) return;
    launcherEl = buildLauncher();
    backdropEl = document.createElement('div');
    backdropEl.id = 'claudeSheetBackdrop';
    backdropEl.addEventListener('click', closeClaudeSheet);
    sheetEl = buildSheet();

    parent.appendChild(backdropEl);
    parent.appendChild(sheetEl);
    parent.appendChild(launcherEl);

    keydownHandler = function(event) {
        if (event.key !== 'Escape') return;
        // Escape peels back one layer: an open workspace menu first, then the
        // whole sheet — so dismissing the menu never also closes the panel.
        if (isWorkspaceMenuOpen()) {
            closeWorkspaceMenu();
            return;
        }
        if (isClaudeSheetOpen()) closeClaudeSheet();
    };
    document.addEventListener('keydown', keydownHandler);

    // Close the workspace menu on any click outside it (the pill stops its own
    // click from bubbling here, so tapping the pill toggles rather than closes).
    if (workspaceClickHandler) document.removeEventListener('click', workspaceClickHandler);
    workspaceClickHandler = function(event) {
        if (!isWorkspaceMenuOpen()) return;
        const wrap = sheetEl && sheetEl.querySelector('.claudeWorkspace');
        if (wrap && !wrap.contains(event.target)) closeWorkspaceMenu();
    };
    document.addEventListener('click', workspaceClickHandler);

    // Close the file-picker panel on any click outside it. The panel stops its
    // own clicks from bubbling here, and the picker button shares the
    // .claudeAttach wrap, so tapping the button toggles rather than closes.
    if (attachClickHandler) document.removeEventListener('click', attachClickHandler);
    attachClickHandler = function(event) {
        const panel = sheetEl && sheetEl.querySelector('#claudeAttachPanel');
        if (!panel || panel.hidden) return;
        const wrap = sheetEl && sheetEl.querySelector('.claudeAttach');
        if (wrap && !wrap.contains(event.target)) setAttachPanelHidden(true);
    };
    document.addEventListener('click', attachClickHandler);

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

    updatePending = hasPendingUpdate();
    renderUpdateNudge();

    // Fresh mount starts a fresh conversation and drops any pollers a prior
    // mount left running.
    chatHistory = [];
    attachedFiles = [];
    attachedRepo = null;
    activeChatRepo = DEFAULT_ATTACH_REPO;
    selectedAttachRepo = DEFAULT_ATTACH_REPO;
    srcManifestCache = {};
    renderWorkspacePill();
    Object.keys(runPollers).forEach(stopRunPoller);

    // Hydrate run records from localStorage, render them into the Runs tab,
    // and resume polling any run that was still in flight before a reload.
    loadRunRecords();
    renderRunsList();
    resumeRunPollers();

    return { launcher: launcherEl, sheet: sheetEl, backdrop: backdropEl };
}
