// SomaFM focus-music player. Mirrors pomodoro.js's shape: createMusic(doc)
// returns an opaque controller, and the singleton accessor at the bottom of
// the file gives every importer the same instance via ensureMusic(). The
// module owns its hidden <audio> element and persists the last-station and
// volume preference; it does NOT auto-resume on page load (mobile autoplay
// restrictions block it and unexpected audio is hostile).
//
// State machine: IDLE → PLAYING → PAUSED → PLAYING → IDLE.
// IDLE means no station selected (first run) or after destroy. Selecting a
// station while paused stages it without auto-playing; selecting while
// playing performs a seamless swap.
//
// Pomodoro coordination: a controller created with the optional `pomoCtl`
// argument subscribes to that controller's status and pauses the audio when
// the pomodoro lands in COMPLETE_UNACKED, resuming on acknowledge / reset /
// mode change / start IF the user was playing before the alert fired.

export const MUSIC_STATE_KEY = 'todoapp_music_state';

export const DEFAULT_VOLUME = 0.5;

// Hardcoded SomaFM station list — direct MP3 stream URLs, no API key, no
// fetch. Order matches the popover render order. Genre tags are short
// uppercase labels matching the typographic treatment of the pomodoro
// popover header.
export const STATIONS = [
    { id: 'groovesalad', name: 'Groove Salad',      genre: 'AMBIENT',   streamUrl: 'https://ice1.somafm.com/groovesalad-128-mp3' },
    { id: 'dronezone',   name: 'Drone Zone',        genre: 'AMBIENT',   streamUrl: 'https://ice1.somafm.com/dronezone-128-mp3' },
    { id: 'spacestation',name: 'Space Station Soma',genre: 'SPACE',     streamUrl: 'https://ice1.somafm.com/spacestation-128-mp3' },
    { id: 'defcon',      name: 'DEF CON Radio',     genre: 'ELECTRONIC',streamUrl: 'https://ice1.somafm.com/defcon-128-mp3' },
    { id: 'lush',        name: 'Lush',              genre: 'VOCALS',    streamUrl: 'https://ice1.somafm.com/lush-128-mp3' },
    { id: 'deepspaceone',name: 'Deep Space One',    genre: 'AMBIENT',   streamUrl: 'https://ice1.somafm.com/deepspaceone-128-mp3' },
];

const VALID_STATUS = ['IDLE', 'PLAYING', 'PAUSED'];

function findStation(stationId) {
    for (let i = 0; i < STATIONS.length; i++) {
        if (STATIONS[i].id === stationId) return STATIONS[i];
    }
    return null;
}

function readPersistedState() {
    try {
        const raw = localStorage.getItem(MUSIC_STATE_KEY);
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
        localStorage.setItem(MUSIC_STATE_KEY, JSON.stringify({
            stationId: state.stationId,
            volume:    state.volume,
        }));
    } catch (e) { /* quota / private-mode — best-effort */ }
}

function defaultState() {
    return {
        stationId: null,
        volume:    DEFAULT_VOLUME,
        // Status starts IDLE on every page load. Status is never persisted
        // because we don't auto-resume — the user must press play.
        status:    'IDLE',
    };
}

function sanitizeRestoredState(raw) {
    const fresh = defaultState();
    if (!raw) return fresh;
    if (typeof raw.stationId === 'string' && findStation(raw.stationId)) {
        fresh.stationId = raw.stationId;
    }
    if (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) {
        fresh.volume = raw.volume;
    }
    return fresh;
}


// Factory — every call returns an independent controller. The typical app
// creates exactly one via the singleton accessor at the bottom of the file.
// The optional `pomoCtl` argument wires up the pomodoro-coordination logic;
// when omitted the controller is fully standalone.
export function createMusic(doc, pomoCtl) {
    doc = doc || (typeof document !== 'undefined' ? document : null);

    let state = sanitizeRestoredState(readPersistedState());
    let audioEl = null;
    const subscribers = [];
    // Captured when the pomodoro lands in COMPLETE_UNACKED so we can
    // restore the user's playing state once they acknowledge.
    let pomodoroWasPlaying = false;
    let lastPomoStatus = null;
    let unsubscribePomo = null;

    function persist() { writePersistedState(state); }

    function notify() {
        for (let i = 0; i < subscribers.length; i++) {
            try { subscribers[i](getSnapshot()); } catch (e) { /* subscribers must not crash the controller */ }
        }
    }

    function getSnapshot() {
        return {
            stationId: state.stationId,
            volume:    state.volume,
            status:    state.status,
        };
    }

    function ensureAudioEl() {
        if (audioEl) return audioEl;
        if (!doc || typeof doc.createElement !== 'function') return null;
        audioEl = doc.createElement('audio');
        audioEl.preload = 'none';
        audioEl.volume  = state.volume;
        // Stream errors land the controller back in PAUSED so the visualizer
        // settles and the user can retry without a stuck PLAYING state.
        audioEl.addEventListener('error', function() {
            if (state.status === 'PLAYING') {
                state.status = 'PAUSED';
                notify();
            }
        });
        try {
            if (doc.body && typeof doc.body.appendChild === 'function') {
                audioEl.style.display = 'none';
                doc.body.appendChild(audioEl);
            }
        } catch (e) { /* no body in some test envs */ }
        return audioEl;
    }

    function play() {
        const station = findStation(state.stationId) || STATIONS[0];
        if (!station) return;
        // First play() may be the first user gesture — autoplay restrictions
        // forbid audio.play() outside one. The popover's Play button is the
        // only entry point so this falls out naturally.
        state.stationId = station.id;
        state.status = 'PLAYING';
        const el = ensureAudioEl();
        if (el) {
            try {
                if (el.src !== station.streamUrl) el.src = station.streamUrl;
                el.volume = state.volume;
                const result = el.play();
                if (result && typeof result.then === 'function') {
                    result.catch(function() {
                        // play() rejection (autoplay block, network) lands us
                        // back in PAUSED so the UI doesn't lie about state.
                        if (state.status === 'PLAYING') {
                            state.status = 'PAUSED';
                            notify();
                        }
                    });
                }
            } catch (e) { /* play() can throw synchronously in some envs */ }
        }
        persist();
        notify();
    }

    function pause() {
        if (state.status !== 'PLAYING') return;
        state.status = 'PAUSED';
        if (audioEl) {
            try { audioEl.pause(); } catch (e) { /* ignore */ }
        }
        persist();
        notify();
    }

    function setStation(stationId) {
        const station = findStation(stationId);
        if (!station) return;
        const wasPlaying = state.status === 'PLAYING';
        state.stationId = station.id;
        if (wasPlaying) {
            // Seamless swap — set the new src and keep playing.
            const el = ensureAudioEl();
            if (el) {
                try {
                    el.src = station.streamUrl;
                    el.volume = state.volume;
                    const result = el.play();
                    if (result && typeof result.then === 'function') {
                        result.catch(function() {
                            if (state.status === 'PLAYING') {
                                state.status = 'PAUSED';
                                notify();
                            }
                        });
                    }
                } catch (e) { /* ignore */ }
            }
        }
        // While paused / idle, selecting a station only stages it. The
        // user must press Play to start audio.
        persist();
        notify();
    }

    function setVolume(volume) {
        if (typeof volume !== 'number' || !isFinite(volume)) return;
        state.volume = Math.max(0, Math.min(1, volume));
        if (audioEl) {
            try { audioEl.volume = state.volume; } catch (e) { /* ignore */ }
        }
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
        if (typeof unsubscribePomo === 'function') {
            try { unsubscribePomo(); } catch (e) { /* ignore */ }
            unsubscribePomo = null;
        }
        if (audioEl) {
            try { audioEl.pause(); } catch (e) { /* ignore */ }
            try {
                if (audioEl.parentNode) audioEl.parentNode.removeChild(audioEl);
            } catch (e) { /* ignore */ }
            audioEl = null;
        }
        subscribers.length = 0;
    }

    // ── pomodoro coordination ──
    // When the pomodoro completes (COMPLETE_UNACKED), pause the audio so the
    // chime isn't drowned out. Capture wasPlaying so we can resume on
    // acknowledgment if the user was actively listening before the alert.
    function onPomodoroSnapshot(snap) {
        if (!snap) return;
        const status = snap.status;
        const enteringAlert = status === 'COMPLETE_UNACKED' && lastPomoStatus !== 'COMPLETE_UNACKED';
        const leavingAlert  = status !== 'COMPLETE_UNACKED' && lastPomoStatus === 'COMPLETE_UNACKED';
        if (enteringAlert) {
            pomodoroWasPlaying = state.status === 'PLAYING';
            if (pomodoroWasPlaying) pause();
        } else if (leavingAlert) {
            if (pomodoroWasPlaying) {
                pomodoroWasPlaying = false;
                play();
            }
        }
        lastPomoStatus = status;
    }

    if (pomoCtl && typeof pomoCtl.subscribe === 'function') {
        try {
            const initial = typeof pomoCtl.getState === 'function' ? pomoCtl.getState() : null;
            if (initial) lastPomoStatus = initial.status;
        } catch (e) { /* ignore */ }
        try {
            unsubscribePomo = pomoCtl.subscribe(onPomodoroSnapshot);
        } catch (e) { /* ignore */ }
    }

    return {
        play:       play,
        pause:      pause,
        setStation: setStation,
        setVolume:  setVolume,
        subscribe:  subscribe,
        destroy:    destroy,
        getState:   getSnapshot,
    };
}


// ── MODULE-LEVEL SINGLETON ──
// Mirrors pomodoro.js's access pattern: every importer gets the same
// instance via ensureMusic() so wiring callers (main.js for the icon
// button + popover) doesn't need to thread a deps bag. The optional
// `pomoCtl` argument is consumed only on first access.
let _musicSingleton = null;

export function ensureMusic(pomoCtl) {
    if (_musicSingleton) return _musicSingleton;
    if (typeof document === 'undefined') return null;
    _musicSingleton = createMusic(document, pomoCtl || null);
    return _musicSingleton;
}

export function destroyMusic() {
    if (_musicSingleton) {
        _musicSingleton.destroy();
        _musicSingleton = null;
    }
}
