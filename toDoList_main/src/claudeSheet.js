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
} from './inject.js';
import { serializeLayout } from './layoutInspect.js';
import { applyPendingUpdate, hasPendingUpdate } from './modals.js';

const MOBILE_MAX_WIDTH = 700;
const SWIPE_CLOSE_PX = 60;

const RUNS_KEY = 'todoapp_claudeRuns';
const RUN_POLL_INTERVAL_MS = 5000;
const RUN_GIVE_UP_MS = 10 * 60 * 1000;

let launcherEl = null;
let sheetEl = null;
let backdropEl = null;
let keydownHandler = null;
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

function buildChatView() {
    const view = document.createElement('div');
    view.id = 'claudeChatView';
    view.className = 'claudeView';
    view.setAttribute('role', 'tabpanel');

    const surface = document.createElement('div');
    surface.id = 'claudeChatSurface';
    surface.className = 'claudeChatSurface';

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
    view.appendChild(composer);
    return view;
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
        const reply = await chatWithWorker(chatHistory, entryId);
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
    badge.className = 'claudeRunBadge claudeRunBadge--' + status.toLowerCase();
    badge.textContent = RUN_STATUS_LABEL[status] || status;

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
        // Past the give-up window the run can no longer be reconciled, so a
        // non-terminal record would otherwise sit "Running" forever. Mark it
        // FAILED and stop watching so the Runs list never shows a stuck row.
        setRunRecordStatus(correlationId, 'FAILED');
        stopRunPoller(correlationId);
        return;
    }
    const res = await pollRunStatus({ correlationId: correlationId });
    if (!res || res.ok === false) return; // transient — keep polling
    if (res.found === false) return; // run not surfaced yet — stay QUEUED
    if (res.status === 'completed') {
        setRunRecordStatus(correlationId, res.conclusion === 'success' ? 'SHIPPED' : 'FAILED');
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
function resumeRunPollers() {
    let changed = false;
    runRecords.forEach(function(rec) {
        if (isTerminalStatus(rec.status)) return;
        if (!rec.correlationId) {
            // With no correlation id this record can never be polled to a real
            // status, so leaving it non-terminal would show a permanently-stuck
            // "Running" row. Fail it gracefully instead.
            rec.status = 'FAILED';
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
        if (event.key === 'Escape' && isClaudeSheetOpen()) {
            closeClaudeSheet();
        }
    };
    document.addEventListener('keydown', keydownHandler);

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
    Object.keys(runPollers).forEach(stopRunPoller);

    // Hydrate run records from localStorage, render them into the Runs tab,
    // and resume polling any run that was still in flight before a reload.
    loadRunRecords();
    renderRunsList();
    resumeRunPollers();

    return { launcher: launcherEl, sheet: sheetEl, backdrop: backdropEl };
}
