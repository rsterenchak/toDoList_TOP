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

import {
    chatWithWorker,
    injectEntry,
    mintEntryId,
    embedEntryMarker,
    dispatchRun,
    pollRunStatus,
} from './inject.js';

const MOBILE_MAX_WIDTH = 700;
const SWIPE_CLOSE_PX = 60;

const RUNS_KEY = 'todoapp_claudeRuns';
const RUN_POLL_INTERVAL_MS = 5000;
const RUN_GIVE_UP_MS = 10 * 60 * 1000;

let launcherEl = null;
let sheetEl = null;
let backdropEl = null;
let keydownHandler = null;

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
    if (send) send.disabled = true;
    input.disabled = true;

    let pending = appendMessageBubble('assistant', '…');
    if (pending) pending.classList.add('claudeMsg--pending');

    try {
        const reply = await chatWithWorker(chatHistory);
        chatHistory.push({ role: 'assistant', content: reply });
        if (pending && pending.parentNode) {
            pending.classList.remove('claudeMsg--pending');
            pending.textContent = reply;
        }
        const draft = extractDraftedEntry(reply);
        if (draft) renderDraftedEntryCard(draft);
    } catch (e) {
        if (pending && pending.parentNode) {
            pending.classList.remove('claudeMsg--pending');
            pending.classList.add('claudeMsg--error');
            pending.textContent = 'Chat failed — ' + (e && e.reason ? e.reason : 'error');
        }
    } finally {
        if (send) send.disabled = false;
        input.disabled = false;
        try { input.focus(); } catch (err) { /* defensive */ }
    }
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

    view.appendChild(list);
    view.appendChild(newBtn);
    return view;
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
        // Stop watching after the give-up window; leave the last known
        // non-terminal status in place rather than guessing a terminal one.
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
    runRecords.forEach(function(rec) {
        if (!isTerminalStatus(rec.status)) startRunPoller(rec);
    });
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
