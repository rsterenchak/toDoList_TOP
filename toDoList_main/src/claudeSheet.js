// In-app Claude assistant shell. Lives behind a `⋯` launcher pinned to the
// bottom-right (the slot the old help `?` FAB used to occupy — help moved to
// the ghost menu's "Help" item and the global `?` keypress). On narrow
// viewports (≤700px) the surface is a bottom sheet at ~86% height with a grab
// handle and a dimming backdrop; on wider viewports it docks as a right-hand
// panel (~380px, full height) so the app stays visible beside it.
//
// This module is the SHELL only: launcher, open/close lifecycle, the
// CHAT | RUNS segmented toggle, an inert Chat composer placeholder, and a
// Runs empty state with a "+ New" affordance. No chat, inject, or run logic
// is wired here.

const MOBILE_MAX_WIDTH = 700;
const SWIPE_CLOSE_PX = 60;

let launcherEl = null;
let sheetEl = null;
let backdropEl = null;
let keydownHandler = null;

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

    // Inert composer — visual placeholder only; no send/chat wiring yet.
    const composer = document.createElement('div');
    composer.id = 'claudeComposer';
    composer.className = 'claudeComposer';
    const input = document.createElement('textarea');
    input.id = 'claudeComposerInput';
    input.className = 'claudeComposerInput';
    input.setAttribute('placeholder', 'Ask Claude…');
    input.setAttribute('rows', '1');
    input.disabled = true;
    const send = document.createElement('button');
    send.id = 'claudeComposerSend';
    send.type = 'button';
    send.className = 'claudeComposerSend';
    send.textContent = '↑';
    send.disabled = true;
    send.setAttribute('aria-label', 'Send');
    composer.appendChild(input);
    composer.appendChild(send);

    view.appendChild(surface);
    view.appendChild(composer);
    return view;
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

    const empty = document.createElement('p');
    empty.id = 'claudeRunsEmpty';
    empty.className = 'claudeRunsEmpty';
    empty.textContent = 'No runs yet — tap + New to start';
    list.appendChild(empty);

    const newBtn = document.createElement('button');
    newBtn.id = 'claudeRunsNew';
    newBtn.type = 'button';
    newBtn.className = 'claudeRunsNew';
    newBtn.textContent = '+ New';
    // No run logic yet — the affordance just hands the user to the Chat
    // surface where authoring will live once it's wired.
    newBtn.addEventListener('click', function() {
        setActiveTab('chat');
    });

    view.appendChild(list);
    view.appendChild(newBtn);
    return view;
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

    return { launcher: launcherEl, sheet: sheetEl, backdrop: backdropEl };
}
