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
