// Pomodoro timer controller. Mirrors companion.js's shape — `createPomodoro
// (doc)` returns an opaque controller and the singleton accessor at the
// bottom of the file gives every importer the same instance. The module
// owns its own DOM (icon + popover), audio synthesis, favicon swap, tab-
// title flash, and Notification permission. It holds no project / todo
// state and never calls into listLogic.js.
//
// The module is testable in jsdom because the controller is lazily created
// and exposes a `getState()` method along with imperative mode / duration
// setters that mutate state without requiring real DOM interaction.
//
// State machine: IDLE → RUNNING → PAUSED → RUNNING → COMPLETE_UNACKED → IDLE.
// Acknowledgment is the user clicking the icon or starting the next session;
// it clears the four alert layers (icon pulse, tab flash, favicon swap,
// browser notification dismissal is handled by the OS).
//
// Time accounting uses an `endTimestamp` anchor (`endTimestamp - Date.now()`
// per tick) so the timer survives a page refresh and doesn't drift in
// inactive tabs the way `setInterval` arithmetic does.

import { isFocusInTextInput } from './popoverNav.js';

export const POMODORO_STATE_KEY = 'todoapp_pomodoro_state';

// Defaults match the classic Pomodoro Technique. Durations are stored in
// seconds so the inline MM:SS editor can write whole-second values.
export const DEFAULT_DURATIONS = {
    focus: 25 * 60,
    short: 5 * 60,
    long:  15 * 60,
};

export const DEFAULT_VOLUME = 0.6;

const VALID_MODES   = ['focus', 'short', 'long'];
const VALID_STATUS  = ['IDLE', 'RUNNING', 'PAUSED', 'COMPLETE_UNACKED'];

// Mode → user-facing copy used by the popover, alert title, and Notification.
export const MODE_LABEL = {
    focus: 'Focus',
    short: 'Short break',
    long:  'Long break',
};

// Sensible per-mode min/max so the inline editor can't write unusable values.
const MIN_DURATION_SEC = 60;       // 1 min
const MAX_DURATION_SEC = 99 * 60;  // 99 min — keeps MM:SS at two digits.

function clampDuration(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds)) return null;
    const whole = Math.round(seconds);
    if (whole < MIN_DURATION_SEC) return MIN_DURATION_SEC;
    if (whole > MAX_DURATION_SEC) return MAX_DURATION_SEC;
    return whole;
}

// MM:SS formatter — two-digit minutes, two-digit seconds, never negative.
export function formatMMSS(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds || 0));
    const mm = Math.floor(s / 60);
    const ss = s - mm * 60;
    return (mm < 10 ? '0' + mm : '' + mm) + ':' + (ss < 10 ? '0' + ss : '' + ss);
}

// Parses "MM:SS" or "M:SS" into total seconds. Returns null on garbage.
// The popover's inline editor uses this to commit edits.
export function parseMMSS(str) {
    if (typeof str !== 'string') return null;
    const trimmed = str.trim();
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed);
    if (!match) return null;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

// Suggested-next-mode advance after a session completes — Focus → Short,
// either break → Focus. Long is opt-in (the user picks it explicitly).
export function nextSuggestedMode(mode) {
    if (mode === 'focus') return 'short';
    return 'focus';
}

function readPersistedState() {
    try {
        const raw = localStorage.getItem(POMODORO_STATE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch (e) {
        return null;
    }
}

function writePersistedState(state) {
    try {
        localStorage.setItem(POMODORO_STATE_KEY, JSON.stringify(state));
    } catch (e) { /* quota / private-mode — best-effort */ }
}

function defaultState() {
    return {
        mode: 'focus',
        durations: { focus: DEFAULT_DURATIONS.focus, short: DEFAULT_DURATIONS.short, long: DEFAULT_DURATIONS.long },
        // endTimestamp is the wall-clock ms when the active session would
        // complete. Null whenever no countdown is in flight.
        endTimestamp: null,
        // remainingMs is captured on pause so resume can set a fresh
        // endTimestamp without arithmetic on stale wall-clock values.
        remainingMs: null,
        status: 'IDLE',
        soundEnabled: true,
        volume: DEFAULT_VOLUME,
    };
}

function sanitizeRestoredState(raw) {
    const fresh = defaultState();
    if (!raw) return fresh;
    if (VALID_MODES.indexOf(raw.mode) !== -1) fresh.mode = raw.mode;
    if (raw.durations && typeof raw.durations === 'object') {
        VALID_MODES.forEach(function(m) {
            const clamped = clampDuration(raw.durations[m]);
            if (clamped !== null) fresh.durations[m] = clamped;
        });
    }
    if (typeof raw.soundEnabled === 'boolean') fresh.soundEnabled = raw.soundEnabled;
    if (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) {
        fresh.volume = raw.volume;
    }
    // Restore an in-flight countdown only when its endTimestamp is still in
    // the future; expired sessions reset to IDLE so the alert state machine
    // stays consistent across reloads.
    if (VALID_STATUS.indexOf(raw.status) !== -1 && raw.status === 'RUNNING' &&
        typeof raw.endTimestamp === 'number' && raw.endTimestamp > Date.now()) {
        fresh.status = 'RUNNING';
        fresh.endTimestamp = raw.endTimestamp;
    } else if (raw.status === 'PAUSED' &&
               typeof raw.remainingMs === 'number' &&
               raw.remainingMs > 0) {
        fresh.status = 'PAUSED';
        fresh.remainingMs = raw.remainingMs;
    } else if (raw.status === 'COMPLETE_UNACKED') {
        fresh.status = 'COMPLETE_UNACKED';
    }
    return fresh;
}


// Factory — every call returns an independent controller. The typical app
// creates exactly one via the singleton accessor at the bottom of the file.
export function createPomodoro(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);

    let state = sanitizeRestoredState(readPersistedState());
    let tickId = null;
    let titleFlashId = null;
    let originalTitle = (doc && doc.title) || 'Task Management';
    const subscribers = [];
    let audioCtx = null;

    function persist() { writePersistedState(state); }

    function notify() {
        for (let i = 0; i < subscribers.length; i++) {
            try { subscribers[i](getSnapshot()); } catch (e) { /* subscribers must not crash the controller */ }
        }
    }

    function getSnapshot() {
        let remainingMs;
        if (state.status === 'RUNNING' && state.endTimestamp) {
            remainingMs = Math.max(0, state.endTimestamp - Date.now());
        } else if (state.status === 'PAUSED' && state.remainingMs) {
            remainingMs = state.remainingMs;
        } else {
            remainingMs = state.durations[state.mode] * 1000;
        }
        return {
            mode:         state.mode,
            status:       state.status,
            remainingMs:  remainingMs,
            durations:    Object.assign({}, state.durations),
            soundEnabled: state.soundEnabled,
            volume:       state.volume,
        };
    }

    function setMode(mode) {
        if (VALID_MODES.indexOf(mode) === -1) return;
        // Switching modes while a session is running resets the countdown to
        // the new mode's default — same affordance as Reset, but tied to the
        // mode tab so the user doesn't need a second click.
        state.mode = mode;
        if (state.status === 'RUNNING' || state.status === 'PAUSED') {
            stopTick();
            state.status = 'IDLE';
            state.endTimestamp = null;
            state.remainingMs = null;
        }
        persist();
        notify();
    }

    function setDuration(mode, seconds) {
        if (VALID_MODES.indexOf(mode) === -1) return;
        const clamped = clampDuration(seconds);
        if (clamped === null) return;
        state.durations[mode] = clamped;
        // If the user re-edits the active mode while idle, reflect the new
        // duration in the displayed countdown immediately.
        if (mode === state.mode && state.status === 'IDLE') {
            state.endTimestamp = null;
            state.remainingMs = null;
        }
        persist();
        notify();
    }

    function setSoundEnabled(enabled) {
        state.soundEnabled = !!enabled;
        persist();
        notify();
    }

    function setVolume(volume) {
        if (typeof volume !== 'number' || !isFinite(volume)) return;
        state.volume = Math.max(0, Math.min(1, volume));
        persist();
        notify();
    }

    function start() {
        // Acknowledge a pending alert before kicking off the next session,
        // so the icon-pulse / tab-flash / favicon-swap clear immediately.
        if (state.status === 'COMPLETE_UNACKED') acknowledge();
        const durMs = state.durations[state.mode] * 1000;
        // PAUSED → RUNNING reuses remainingMs; everything else starts fresh
        // from the configured duration.
        const remainingMs = (state.status === 'PAUSED' && state.remainingMs) ? state.remainingMs : durMs;
        state.status = 'RUNNING';
        state.endTimestamp = Date.now() + remainingMs;
        state.remainingMs = null;
        // Lazily ask for Notification permission the first time a session
        // starts. No-ops gracefully when the API isn't present (jsdom, older
        // browsers) or permission is denied.
        requestNotificationPermissionLazy();
        scheduleTick();
        persist();
        notify();
    }

    function pause() {
        if (state.status !== 'RUNNING') return;
        state.remainingMs = Math.max(0, (state.endTimestamp || 0) - Date.now());
        state.endTimestamp = null;
        state.status = 'PAUSED';
        stopTick();
        persist();
        notify();
    }

    // Single-entry toggle for the keyboard shortcut path in main.js. Returns
    // 'playing' on a fresh start or resume, 'paused' on a pause, and 'noop'
    // when the timer is sitting on a completed-but-unacknowledged session
    // (the shortcut intentionally does not auto-restart from 00:00 — the
    // user has to acknowledge or pick the next mode explicitly).
    function toggle() {
        if (state.status === 'COMPLETE_UNACKED') return 'noop';
        if (state.status === 'RUNNING') {
            pause();
            return 'paused';
        }
        start();
        return 'playing';
    }

    function reset() {
        stopTick();
        state.status = 'IDLE';
        state.endTimestamp = null;
        state.remainingMs = null;
        // Reset implicitly acknowledges a pending alert.
        clearAlertLayers();
        persist();
        notify();
    }

    function acknowledge() {
        if (state.status === 'COMPLETE_UNACKED') {
            state.status = 'IDLE';
        }
        clearAlertLayers();
        persist();
        notify();
    }

    function subscribe(fn) {
        if (typeof fn !== 'function') return function() {};
        subscribers.push(fn);
        return function unsubscribe() {
            const i = subscribers.indexOf(fn);
            if (i !== -1) subscribers.splice(i, 1);
        };
    }

    function destroy() {
        stopTick();
        clearAlertLayers();
        if (audioCtx && typeof audioCtx.close === 'function') {
            try { audioCtx.close(); } catch (e) { /* already closed */ }
        }
        audioCtx = null;
        subscribers.length = 0;
    }

    // ── tick loop ──
    // 250ms cadence is plenty for a MM:SS readout and lets the hand-sweep
    // animation read smoothly on next paint without a per-frame rAF loop.
    function scheduleTick() {
        stopTick();
        tickId = setInterval(onTick, 250);
    }
    function stopTick() {
        if (tickId !== null) { clearInterval(tickId); tickId = null; }
    }
    function onTick() {
        if (state.status !== 'RUNNING' || !state.endTimestamp) {
            stopTick();
            return;
        }
        const remainingMs = state.endTimestamp - Date.now();
        if (remainingMs <= 0) {
            complete();
            return;
        }
        notify();
    }

    function complete() {
        stopTick();
        state.status = 'COMPLETE_UNACKED';
        state.endTimestamp = null;
        state.remainingMs = null;
        fireAlertLayers();
        persist();
        notify();
    }

    // ── alert layers ──
    // Icon pulse + favicon swap are pure DOM hooks consumers wire up via the
    // `pomodoro-alert` body class. Tab-title flash and the optional browser
    // Notification + audio bell are owned here so the module remains the
    // single source of truth for "what happens when a session completes".
    function fireAlertLayers() {
        if (!doc) return;
        try { doc.body.classList.add('pomodoro-alert'); } catch (e) { /* no body in test */ }
        try { doc.documentElement.setAttribute('data-pomodoro-alert', 'on'); } catch (e) { /* ignore */ }
        startTitleFlash();
        showFaviconAlert(true);
        fireNotification();
        playBell();
    }

    function clearAlertLayers() {
        if (doc) {
            try { doc.body.classList.remove('pomodoro-alert'); } catch (e) { /* ignore */ }
            try { doc.documentElement.removeAttribute('data-pomodoro-alert'); } catch (e) { /* ignore */ }
        }
        stopTitleFlash();
        showFaviconAlert(false);
    }

    function startTitleFlash() {
        if (!doc) return;
        if (titleFlashId !== null) return;
        const completedMode = state.mode;
        const message = (completedMode === 'focus' ? 'Break time!' : 'Focus time!') + ' — ' + originalTitle;
        let toggled = false;
        titleFlashId = setInterval(function() {
            try {
                doc.title = toggled ? originalTitle : message;
                toggled = !toggled;
            } catch (e) { /* document.title set fails in some test envs */ }
        }, 700);
        // Visibility regain clears the flash automatically — the user has
        // seen the alert, no need to keep nagging.
        if (typeof doc.addEventListener === 'function') {
            doc.addEventListener('visibilitychange', onVisibilityClearFlash);
        }
    }

    function stopTitleFlash() {
        if (titleFlashId !== null) {
            clearInterval(titleFlashId);
            titleFlashId = null;
        }
        if (doc) {
            try { doc.title = originalTitle; } catch (e) { /* ignore */ }
            if (typeof doc.removeEventListener === 'function') {
                doc.removeEventListener('visibilitychange', onVisibilityClearFlash);
            }
        }
    }

    function onVisibilityClearFlash() {
        if (!doc) return;
        if (doc.visibilityState === 'visible' && state.status === 'COMPLETE_UNACKED') {
            stopTitleFlash();
        }
    }

    function showFaviconAlert(on) {
        if (!doc || typeof doc.getElementById !== 'function') return;
        const link = doc.getElementById('faviconLink') || doc.querySelector('link[rel="icon"]');
        if (!link) return;
        if (on) {
            // Capture the current href once so the swap-back is exact.
            if (!link.dataset || !link.dataset.pomodoroOriginal) {
                if (link.dataset) link.dataset.pomodoroOriginal = link.href || '';
            }
            try { link.href = makeAlertFaviconDataUrl(); } catch (e) { /* ignore */ }
        } else if (link.dataset && link.dataset.pomodoroOriginal !== undefined) {
            try { link.href = link.dataset.pomodoroOriginal; } catch (e) { /* ignore */ }
            try { delete link.dataset.pomodoroOriginal; } catch (e) { /* ignore */ }
        }
    }

    function makeAlertFaviconDataUrl() {
        // 32×32 SVG echoing the existing favicon shape but tinted accent,
        // built inline so the alert variant doesn't require committing a
        // second SVG asset that would only ever be used by this swap.
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
            '<rect width="32" height="32" rx="6" fill="#FF7A59"/>' +
            '<circle cx="16" cy="16" r="6" fill="#fff"/>' +
            '<rect x="15" y="9" width="2" height="8" fill="#FF7A59"/>' +
            '</svg>';
        return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    }

    function fireNotification() {
        if (typeof Notification === 'undefined') return;
        if (Notification.permission !== 'granted') return;
        try {
            const completedMode = state.mode;
            const title = 'toDoList';
            const body = (completedMode === 'focus' ? 'Break time!' : 'Focus time!') +
                         ' ' + MODE_LABEL[completedMode] + ' session complete.';
            new Notification(title, { body: body });
        } catch (e) { /* permission revoked between check and send, etc. */ }
    }

    let permissionRequested = false;
    function requestNotificationPermissionLazy() {
        if (permissionRequested) return;
        if (typeof Notification === 'undefined') return;
        if (Notification.permission !== 'default') return;
        permissionRequested = true;
        try {
            const result = Notification.requestPermission();
            if (result && typeof result.then === 'function') {
                result.then(function() { /* permission stored on the Notification API */ });
            }
        } catch (e) { /* older browsers throw on the call signature */ }
    }

    function playBell() {
        if (!state.soundEnabled) return;
        const Ctor = (typeof window !== 'undefined') &&
                     (window.AudioContext || window.webkitAudioContext);
        if (!Ctor) return;
        try {
            if (!audioCtx) audioCtx = new Ctor();
            const now = audioCtx.currentTime;
            const decay = 1.6;
            // Two-partial soft bell — 880Hz fundamental + 1320Hz overtone.
            // Exponential decay across ~1.6s reads as a chime, not a beep.
            playPartial(audioCtx, 880,  now, decay, state.volume);
            playPartial(audioCtx, 1320, now, decay, state.volume * 0.5);
        } catch (e) { /* AudioContext can fail on first gesture in some browsers */ }
    }

    function playPartial(ctx, freq, startTime, decaySec, volume) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + decaySec);
        osc.connect(gain).connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + decaySec + 0.05);
    }

    return {
        start:           start,
        pause:           pause,
        toggle:          toggle,
        reset:           reset,
        setMode:         setMode,
        setDuration:     setDuration,
        setSoundEnabled: setSoundEnabled,
        setVolume:       setVolume,
        acknowledge:     acknowledge,
        subscribe:       subscribe,
        destroy:         destroy,
        getState:        getSnapshot,
    };
}


// ── POMODORO UI FACTORY ──
// Builds and wires the popover, the transient Ctrl+Space status pill, the
// header-icon sync, and the global Ctrl+Space shortcut. Everything places
// itself into the DOM; nothing is returned. component() in main.js still owns
// the pomodoroToggle button (passed in), getPomodoroController, and the
// music-coupling subscribe block.
//
// deps:
//   - pomodoroToggle: the header button DOM node (built + placed by
//                     component()); this factory wires its click + icon sync.
export function createPomodoroUI(deps) {
    deps = deps || {};
    const pomodoroToggle = deps.pomodoroToggle;

    function syncPomodoroIcon() {
        const ctl = ensurePomodoro();
        if (!ctl) return;
        const snap = ctl.getState();
        pomodoroToggle.setAttribute('data-pomo-status', snap.status);
        pomodoroToggle.setAttribute('data-pomo-mode',   snap.mode);
        const totalMs = (snap.durations[snap.mode] || 0) * 1000;
        let progress = 0;
        if (snap.status === 'RUNNING' && totalMs > 0) {
            progress = 1 - (snap.remainingMs / totalMs);
        } else if (snap.status === 'PAUSED' && totalMs > 0) {
            progress = 1 - (snap.remainingMs / totalMs);
        } else if (snap.status === 'COMPLETE_UNACKED') {
            progress = 1;
        }
        progress = Math.max(0, Math.min(1, progress));
        const hand = pomodoroToggle.querySelector('.clockIconHand');
        if (hand) hand.setAttribute('transform', 'rotate(' + (progress * 360).toFixed(2) + ' 12 14)');
        // Inline countdown: show the live MM:SS next to the icon while a
        // session is running or paused; clear it otherwise. CSS controls the
        // span's visibility via the button's data-pomo-status attribute, so we
        // only need to keep the text content in sync here.
        const inline = pomodoroToggle.querySelector('.pomodoroCountdownInline');
        if (inline) {
            if (snap.status === 'RUNNING' || snap.status === 'PAUSED') {
                inline.textContent = formatMMSS(Math.round((snap.remainingMs || 0) / 1000));
            } else {
                inline.textContent = '';
            }
        }
    }

    function hidePomodoroPopover() {
        const existing = document.getElementById('pomodoroPopover');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        pomodoroToggle.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onPomodoroOutsideClick, true);
        document.removeEventListener('keydown', onPomodoroKeydown, true);
        window.removeEventListener('resize', hidePomodoroPopover);
        window.removeEventListener('scroll', hidePomodoroPopover, true);
    }

    function onPomodoroOutsideClick(event) {
        const pop = document.getElementById('pomodoroPopover');
        if (!pop) return;
        if (pop.contains(event.target) || pomodoroToggle.contains(event.target)) return;
        hidePomodoroPopover();
    }

    function onPomodoroKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            hidePomodoroPopover();
            pomodoroToggle.focus();
            return;
        }
        const pop = document.getElementById('pomodoroPopover');
        if (!pop) return;

        // Backspace closes the popover (parity with the music popover) so
        // keyboard users have a one-key "back out" anywhere in the menu.
        // Skipped while editing the inline countdown so Backspace still
        // deletes characters in the duration input.
        if (event.key === 'Backspace' && !isFocusInTextInput()) {
            event.preventDefault();
            event.stopPropagation();
            hidePomodoroPopover();
            pomodoroToggle.focus();
            return;
        }

        pomodoroArrowNav(pop, event);
    }

    // 2D arrow navigation matching the pomodoro popover's visual layout.
    // Rows top-to-bottom: [Focus | Short | Long], [countdown], [Start | Reset],
    // [Suggest] (last row only present in the COMPLETE_UNACKED state). Left
    // /Right walk within a row, Up/Down between rows. Movement clamps at the
    // edges (no wrap) — Backspace owns the "exit the menu" affordance, so
    // wrap-around would only confuse the spatial model. Column index is
    // preserved across row jumps and clamped to the new row's length so a
    // Down from "Long" lands on Reset, not Start.
    function pomodoroArrowNav(pop, event) {
        const isLeft  = event.key === 'ArrowLeft';
        const isRight = event.key === 'ArrowRight';
        const isUp    = event.key === 'ArrowUp';
        const isDown  = event.key === 'ArrowDown';
        const isHome  = event.key === 'Home';
        const isEnd   = event.key === 'End';
        if (!isLeft && !isRight && !isUp && !isDown && !isHome && !isEnd) return;

        // Defer to native caret handling when the inline countdown editor
        // (a text input) has focus.
        if (isFocusInTextInput()) return;

        const rows = [];
        const tabs = Array.from(pop.querySelectorAll('.pomodoroTab'));
        if (tabs.length) rows.push(tabs);
        const countdown = pop.querySelector('.pomodoroCountdown');
        if (countdown && countdown.getClientRects().length > 0) rows.push([countdown]);
        const actions = [
            pop.querySelector('.pomodoroPrimaryBtn'),
            pop.querySelector('.pomodoroResetBtn'),
        ].filter(function(el) { return el && el.getClientRects().length > 0; });
        if (actions.length) rows.push(actions);
        const suggest = pop.querySelector('.pomodoroSuggestBtn');
        if (suggest && suggest.getClientRects().length > 0) rows.push([suggest]);
        if (!rows.length) return;

        const ae = document.activeElement;
        let curRow = -1, curCol = -1;
        outer: for (let r = 0; r < rows.length; r++) {
            for (let c = 0; c < rows[r].length; c++) {
                if (rows[r][c] === ae) { curRow = r; curCol = c; break outer; }
            }
        }

        // Entry from outside the grid (focus on the toggle): pick a corner
        // based on the arrow direction. Other keys with no current position
        // are no-ops so we don't pull focus on stray Left/Right.
        if (curRow === -1) {
            if (isDown || isHome) {
                event.preventDefault();
                event.stopPropagation();
                rows[0][0].focus();
            } else if (isUp || isEnd) {
                event.preventDefault();
                event.stopPropagation();
                rows[rows.length - 1][0].focus();
            }
            return;
        }

        let nextRow = curRow, nextCol = curCol;
        if (isLeft)       nextCol = Math.max(0, curCol - 1);
        else if (isRight) nextCol = Math.min(rows[curRow].length - 1, curCol + 1);
        else if (isUp)    nextRow = Math.max(0, curRow - 1);
        else if (isDown)  nextRow = Math.min(rows.length - 1, curRow + 1);
        else if (isHome)  { nextRow = 0; nextCol = 0; }
        else if (isEnd)   { nextRow = rows.length - 1; nextCol = rows[nextRow].length - 1; }

        // After a row change the preserved column may overrun the new row.
        nextCol = Math.min(nextCol, rows[nextRow].length - 1);
        if (nextRow === curRow && nextCol === curCol) return;

        event.preventDefault();
        event.stopPropagation();
        rows[nextRow][nextCol].focus();
    }

    function showPomodoroPopover() {
        const ctl = ensurePomodoro();
        if (!ctl) return;

        const pop = document.createElement('div');
        pop.id = 'pomodoroPopover';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Pomodoro timer');

        const header = document.createElement('div');
        header.className = 'pomodoroPopoverHeader';
        header.textContent = 'Pomodoro';
        pop.appendChild(header);

        // Mode tabs — switching while a countdown is running resets it to the
        // new mode's default. Same affordance the controller exposes via
        // setMode; the tab is just a UI alias.
        const tabs = document.createElement('div');
        tabs.className = 'pomodoroTabs';
        const tabConfig = [
            ['focus', 'Focus'],
            ['short', 'Short'],
            ['long',  'Long'],
        ];
        const tabButtons = {};
        tabConfig.forEach(function(pair) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'pomodoroTab';
            tab.dataset.mode = pair[0];
            tab.textContent = pair[1];
            tab.setAttribute('role', 'tab');
            tab.addEventListener('click', function() {
                ctl.setMode(pair[0]);
            });
            tabs.appendChild(tab);
            tabButtons[pair[0]] = tab;
        });
        pop.appendChild(tabs);

        // Inline-editable MM:SS countdown. Click to edit; Enter / blur commit
        // via parseMMSS, Escape reverts. Mobile-safe font-size handled in CSS.
        const countdownWrap = document.createElement('div');
        countdownWrap.className = 'pomodoroCountdownWrap';

        const countdown = document.createElement('button');
        countdown.type = 'button';
        countdown.className = 'pomodoroCountdown';
        countdown.setAttribute('aria-label', 'Edit duration');
        countdownWrap.appendChild(countdown);

        const countdownInput = document.createElement('input');
        countdownInput.type  = 'text';
        countdownInput.className = 'pomodoroCountdownInput';
        countdownInput.inputMode = 'numeric';
        countdownInput.maxLength = 5;
        countdownInput.style.display = 'none';
        countdownWrap.appendChild(countdownInput);

        pop.appendChild(countdownWrap);

        function commitCountdownEdit() {
            const parsed = parseMMSS(countdownInput.value);
            if (parsed !== null) {
                ctl.setDuration(ctl.getState().mode, parsed);
            }
            countdownInput.style.display = 'none';
            countdown.style.display = '';
        }

        countdown.addEventListener('click', function() {
            // Editing the duration mid-session would be ambiguous; gate
            // editing to IDLE so the inline input only appears when the
            // edit will actually take effect.
            const status = ctl.getState().status;
            if (status === 'RUNNING' || status === 'PAUSED') return;
            const snap = ctl.getState();
            countdownInput.value = formatMMSS(Math.round(snap.remainingMs / 1000));
            countdown.style.display = 'none';
            countdownInput.style.display = '';
            countdownInput.focus();
            countdownInput.select();
        });
        countdownInput.addEventListener('blur', commitCountdownEdit);
        countdownInput.addEventListener('keydown', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                commitCountdownEdit();
            } else if (event.key === 'Escape') {
                event.stopPropagation();
                countdownInput.style.display = 'none';
                countdown.style.display = '';
            }
        });

        // Action row — Start/Pause/Resume + Reset. The primary button label
        // tracks the current status.
        const actions = document.createElement('div');
        actions.className = 'pomodoroActions';

        const primaryBtn = document.createElement('button');
        primaryBtn.type = 'button';
        primaryBtn.className = 'pomodoroPrimaryBtn';

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'pomodoroResetBtn';
        resetBtn.textContent = 'Reset';

        actions.appendChild(primaryBtn);
        actions.appendChild(resetBtn);
        pop.appendChild(actions);

        primaryBtn.addEventListener('click', function() {
            const status = ctl.getState().status;
            if (status === 'RUNNING') {
                ctl.pause();
            } else {
                ctl.start();
                // Per the spec — Start closes the popover so the icon's
                // sweeping hand is the user's primary feedback channel.
                hidePomodoroPopover();
            }
        });

        resetBtn.addEventListener('click', function() {
            ctl.reset();
        });

        // Suggestion row — only renders when a session has just completed
        // and is awaiting acknowledgment. Auto-suggests the next mode.
        const suggestion = document.createElement('div');
        suggestion.className = 'pomodoroSuggestion';
        const suggestBtn = document.createElement('button');
        suggestBtn.type = 'button';
        suggestBtn.className = 'pomodoroSuggestBtn';
        suggestion.appendChild(suggestBtn);
        pop.appendChild(suggestion);

        suggestBtn.addEventListener('click', function() {
            const next = nextSuggestedMode(ctl.getState().mode);
            ctl.setMode(next);
            ctl.start();
            hidePomodoroPopover();
        });

        function syncPopoverFromState(snap) {
            // Active mode tab
            tabConfig.forEach(function(pair) {
                tabButtons[pair[0]].classList.toggle('active', snap.mode === pair[0]);
            });
            countdown.textContent = formatMMSS(Math.round((snap.remainingMs || 0) / 1000));
            // Primary button label and disabled state
            if (snap.status === 'RUNNING')        primaryBtn.textContent = 'Pause';
            else if (snap.status === 'PAUSED')    primaryBtn.textContent = 'Resume';
            else                                  primaryBtn.textContent = 'Start';
            // Suggestion only shows in the post-complete acknowledgment window
            if (snap.status === 'COMPLETE_UNACKED') {
                suggestion.style.display = '';
                const nextMode = nextSuggestedMode(snap.mode);
                suggestBtn.textContent = 'Start ' + (MODE_LABEL[nextMode] || nextMode).toLowerCase();
            } else {
                suggestion.style.display = 'none';
            }
        }

        const unsubscribe = ctl.subscribe(syncPopoverFromState);
        syncPopoverFromState(ctl.getState());

        document.body.appendChild(pop);

        // Anchor the popover beneath the trigger, right-aligned, clamped to
        // the viewport — mirrors the settings menu placement.
        const rect = pomodoroToggle.getBoundingClientRect();
        const popRect = pop.getBoundingClientRect();
        let top  = rect.bottom + 4;
        let left = rect.right - popRect.width;
        if (left < 4) left = 4;
        if (top + popRect.height > window.innerHeight) {
            top = Math.max(4, window.innerHeight - popRect.height - 4);
        }
        pop.style.top  = top + 'px';
        pop.style.left = left + 'px';

        pomodoroToggle.setAttribute('aria-expanded', 'true');

        // Acknowledge any pending alert the moment the user opens the
        // popover — the visit itself counts as acknowledgement, per the spec.
        if (ctl.getState().status === 'COMPLETE_UNACKED') ctl.acknowledge();

        document.addEventListener('click', onPomodoroOutsideClick, true);
        document.addEventListener('keydown', onPomodoroKeydown, true);
        window.addEventListener('resize', hidePomodoroPopover);
        window.addEventListener('scroll', hidePomodoroPopover, true);

        // Tear down the popover-scoped subscription on dismissal so the
        // controller doesn't keep notifying a removed DOM element.
        const origRemove = pop.parentNode ? null : null;
        const observer = new MutationObserver(function() {
            if (!document.contains(pop)) {
                unsubscribe();
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true });
    }

    pomodoroToggle.addEventListener('click', function(event) {
        event.stopPropagation();
        if (document.getElementById('pomodoroPopover')) {
            hidePomodoroPopover();
        } else {
            showPomodoroPopover();
        }
    });

    // ── Ctrl+Space global shortcut ──
    // Toggles the Pomodoro timer from anywhere in the app. We skip while the
    // user is typing in an input/textarea/contentEditable so Ctrl+Space can
    // still insert a space (and so IME completion chords still work).
    // On every toggle a brief status pill ("Paused" amber / "Play" purple)
    // surfaces inside the popover header for visual confirmation. If the
    // popover was closed, we open it just long enough for the pill to fade,
    // then auto-close it; if it was already open, only the pill fades.
    let pomodoroPillTimers = [];
    let pomodoroPillOpenedByShortcut = false;

    function clearPomodoroPillTimers() {
        for (let i = 0; i < pomodoroPillTimers.length; i++) {
            clearTimeout(pomodoroPillTimers[i]);
        }
        pomodoroPillTimers = [];
    }

    function buildPomodoroPillIcon(kind) {
        // Inline SVG keeps the pill icon-library-free, matching the rest of
        // main.js. The play triangle and pause bars are tiny (10px) so the
        // pill stays compact alongside its label.
        if (kind === 'paused') {
            return '<svg class="pomodoroStatusPillIcon" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
                '<rect x="3" y="2" width="2" height="8" rx="0.5" fill="currentColor"/>' +
                '<rect x="7" y="2" width="2" height="8" rx="0.5" fill="currentColor"/>' +
                '</svg>';
        }
        return '<svg class="pomodoroStatusPillIcon" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
            '<path d="M3.5 2.2v7.6L10 6z" fill="currentColor"/>' +
            '</svg>';
    }

    function showPomodoroStatusPill(kind) {
        // Open the popover first if it's closed so we have a header to dock
        // the pill into. Track that we opened it so the auto-close timer
        // below knows to dismiss it after the pill fades.
        const wasOpenAlready = !!document.getElementById('pomodoroPopover');
        if (!wasOpenAlready) {
            showPomodoroPopover();
            pomodoroPillOpenedByShortcut = true;
        }
        const pop = document.getElementById('pomodoroPopover');
        if (!pop) return;
        const header = pop.querySelector('.pomodoroPopoverHeader');
        if (!header) return;

        // Cancel any in-flight pill so rapid repeated presses always reflect
        // the latest toggle rather than stacking stale fade-outs.
        clearPomodoroPillTimers();
        const existing = pop.querySelector('.pomodoroStatusPill');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

        const pill = document.createElement('div');
        pill.className = 'pomodoroStatusPill ' + (kind === 'paused' ? 'paused' : 'playing');
        pill.setAttribute('role', 'status');
        pill.innerHTML = buildPomodoroPillIcon(kind) +
            '<span class="pomodoroStatusPillLabel">' +
            (kind === 'paused' ? 'Paused' : 'Play') +
            '</span>';
        // Insert as a sibling between the header and whatever follows
        // (typically the tabs row).
        if (header.nextSibling) {
            header.parentNode.insertBefore(pill, header.nextSibling);
        } else {
            header.parentNode.appendChild(pill);
        }

        // Visible at full opacity for ~1.2s, then fade over ~400ms via the
        // .fading class (CSS transition). Auto-close path waits an extra
        // ~200ms after removal so the user sees the pill finish before the
        // popover blinks out.
        pomodoroPillTimers.push(setTimeout(function() {
            pill.classList.add('fading');
        }, 1200));
        pomodoroPillTimers.push(setTimeout(function() {
            if (pill.parentNode) pill.parentNode.removeChild(pill);
        }, 1600));
        pomodoroPillTimers.push(setTimeout(function() {
            // Timer-driven auto-close — this isn't a user-driven dismissal,
            // so it intentionally bypasses the modal's "close 3 ways"
            // convention. Only fires when the shortcut itself opened the
            // popover; if the user already had it open, we leave it alone.
            if (pomodoroPillOpenedByShortcut && document.getElementById('pomodoroPopover')) {
                hidePomodoroPopover();
            }
            pomodoroPillOpenedByShortcut = false;
        }, 1800));
    }

    document.addEventListener('keydown', function(e) {
        // Older Gecko reported the space key as 'Spacebar'; modern browsers
        // emit ' '. Accept both so the shortcut works across engines.
        if (e.key !== ' ' && e.key !== 'Spacebar') return;
        if (!e.ctrlKey) return;
        if (e.altKey || e.shiftKey || e.metaKey) return;
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const ctl = ensurePomodoro();
        if (!ctl) return;
        const result = ctl.toggle();
        e.preventDefault();
        if (result === 'noop') return;
        showPomodoroStatusPill(result);
    });

    // Subscribe at controller-level too so the icon sweep + accent recolor
    // stay in sync regardless of whether the popover is open.
    setTimeout(function() {
        const ctl = ensurePomodoro();
        if (!ctl) return;
        ctl.subscribe(syncPomodoroIcon);
        syncPomodoroIcon();
    }, 0);
}


// ── MODULE-LEVEL SINGLETON ──
// Mirrors the companion.js access pattern: every importer gets the same
// instance via ensurePomodoro() so wiring callers (main.js for the icon
// button + popover) doesn't need to thread a deps bag. Instances created
// here are auto-restored from localStorage on first access.
let _pomodoroSingleton = null;

export function ensurePomodoro() {
    if (_pomodoroSingleton) return _pomodoroSingleton;
    if (typeof document === 'undefined') return null;
    _pomodoroSingleton = createPomodoro(document);
    return _pomodoroSingleton;
}

export function destroyPomodoro() {
    if (_pomodoroSingleton) {
        _pomodoroSingleton.destroy();
        _pomodoroSingleton = null;
    }
}
