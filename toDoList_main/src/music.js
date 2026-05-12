// Focus-music controller. Mirrors the shape of pomodoro.js and companion.js —
// `createMusic(doc)` returns an opaque controller and the singleton accessor
// at the bottom of the file gives every importer the same instance. The
// controller owns its own player iframe target (created on demand inside the
// popover wrapper main.js mounts), the YouTube IFrame Player API loader, the
// curated/custom station registry, and the persisted last-station / volume
// preferences.
//
// State machine: IDLE → BUFFERING → PLAYING → PAUSED → PLAYING → IDLE.
// All audio is driven by the YouTube IFrame Player API loaded lazily on first
// play. No API key, no OAuth, no backend. The iframe is rendered visibly
// inside the popover (240×135) so YouTube's TOS embed-visibility terms are
// honoured and the lofi/ambient stream artwork shows through as ambient
// visual feedback.
//
// The module is testable in jsdom because the controller exposes a
// `getState()` method along with imperative setters that mutate state without
// requiring an actual YT player. The `_loadIframeApi()` helper short-circuits
// in environments where `window.YT` (or the API script tag) cannot land.

export const MUSIC_STATE_KEY = 'todoapp_music_state';

export const DEFAULT_VOLUME = 0.5;

const VALID_STATUS = ['IDLE', 'BUFFERING', 'PLAYING', 'PAUSED'];

// Curated lofi / ambient starter stations. Hardcoded so the picker has
// useful entries on first run. `kind` is `live` (single video) or
// `playlist` (rotating list); the play path branches on it.
export const CURATED_STATIONS = [
    { id: 'curated:lofigirl-beats',     name: 'Lofi Girl — beats to relax/study',    genre: 'Lofi',     kind: 'live',     sourceId: 'jfKfPfyJRdk' },
    { id: 'curated:lofigirl-synthwave', name: 'Lofi Girl — synthwave radio',         genre: 'Synthwave', kind: 'live',    sourceId: '4xDzrJKXOOY' },
    { id: 'curated:chillhop-jazzy',     name: 'Chillhop — jazzy beats radio',        genre: 'Lofi',     kind: 'live',     sourceId: '5yx6BWlEVcY' },
    { id: 'curated:bootleg-boy',        name: 'The Bootleg Boy — chill lofi hiphop', genre: 'Lofi',     kind: 'live',     sourceId: 'rUxyKA_-grg' },
    { id: 'curated:ambient-drone',      name: 'Ambient drone — pure ambient',        genre: 'Ambient',  kind: 'playlist', sourceId: 'PLOzDu-MXXLljn7nM-NLFhhRYNb1qaR-bn' },
    { id: 'curated:synthwave-radio',    name: 'Synthwave radio — beats to drive to', genre: 'Synthwave', kind: 'live',    sourceId: 'MVPTGNGiI-4' },
];

// Recognised URL shapes for the paste-URL flow.
const VIDEO_ID_RE     = /^[a-zA-Z0-9_-]{11}$/;
const PLAYLIST_ID_RE  = /^(?:PL|OL|UU|LL|FL|RD)[a-zA-Z0-9_-]{10,}$/;

// Parses a YouTube URL (or bare ID) into `{ kind, sourceId }`. Returns null
// when nothing recognisable is found. Used by addCustomStation to validate
// user-pasted strings before they're persisted.
export function parseYouTubeUrl(input) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Bare 11-char video ID — accept as a shortcut.
    if (VIDEO_ID_RE.test(trimmed)) {
        return { kind: 'live', sourceId: trimmed };
    }
    // Bare playlist ID — accept too.
    if (PLAYLIST_ID_RE.test(trimmed)) {
        return { kind: 'playlist', sourceId: trimmed };
    }

    // Anything else needs to look like a URL we can parse.
    let url;
    try { url = new URL(trimmed); } catch (e) { return null; }
    const host = (url.hostname || '').toLowerCase().replace(/^www\./, '');

    if (host === 'youtu.be') {
        const id = url.pathname.replace(/^\//, '').split('/')[0];
        if (VIDEO_ID_RE.test(id)) return { kind: 'live', sourceId: id };
        return null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
        // /watch?v=ID — single video. A `list=` param on /watch is treated as
        // a video so the user-selected ID is what plays first; the playlist
        // URL form below is for /playlist.
        if (url.pathname === '/watch') {
            const v = url.searchParams.get('v');
            if (v && VIDEO_ID_RE.test(v)) return { kind: 'live', sourceId: v };
        }
        if (url.pathname === '/playlist') {
            const list = url.searchParams.get('list');
            if (list && PLAYLIST_ID_RE.test(list)) return { kind: 'playlist', sourceId: list };
        }
        // /embed/ID and /live/ID — pluck the ID off the path.
        const embedMatch = /^\/(?:embed|live|v|shorts)\/([a-zA-Z0-9_-]{11})/.exec(url.pathname);
        if (embedMatch) return { kind: 'live', sourceId: embedMatch[1] };
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
            activeStationId: state.activeStationId,
            volume: state.volume,
            muted: state.muted,
            preMuteVolume: state.preMuteVolume,
            customStations: state.customStations,
        }));
    } catch (e) { /* quota / private mode — best-effort */ }
}

function defaultState() {
    return {
        // Default-select the first curated station so the picker isn't empty
        // on first open. Playback still requires an explicit user gesture.
        activeStationId: CURATED_STATIONS[0].id,
        volume: DEFAULT_VOLUME,
        // Mute is a user-toggled overlay on top of the slider position. While
        // muted, `volume` reads 0 (so the player and the slider stay in
        // lockstep); `preMuteVolume` holds the level to restore on unmute.
        muted: false,
        preMuteVolume: DEFAULT_VOLUME,
        customStations: [],
        status: 'IDLE',
        nowPlaying: null,
        // Used only by the pomodoro coordination — captured when a session
        // completes so the music can resume on acknowledgment if it had been
        // playing at the moment of the alert.
        wasPlayingBeforePomodoroAlert: false,
    };
}

function sanitizeRestoredState(raw) {
    const fresh = defaultState();
    if (!raw) return fresh;
    if (typeof raw.activeStationId === 'string') fresh.activeStationId = raw.activeStationId;
    if (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) {
        fresh.volume = raw.volume;
    }
    if (typeof raw.muted === 'boolean') fresh.muted = raw.muted;
    if (typeof raw.preMuteVolume === 'number' && raw.preMuteVolume >= 0 && raw.preMuteVolume <= 1) {
        fresh.preMuteVolume = raw.preMuteVolume;
    }
    if (Array.isArray(raw.customStations)) {
        fresh.customStations = raw.customStations
            .filter(function(s) {
                return s && typeof s === 'object' &&
                       typeof s.id === 'string' &&
                       typeof s.name === 'string' &&
                       (s.kind === 'live' || s.kind === 'playlist') &&
                       typeof s.sourceId === 'string';
            })
            .slice(0, 50); // sanity cap
    }
    return fresh;
}


// Builds the canonical youtube.com URL for a station so the picker can link
// out to youtube.com in a new tab. Used as a sign-in fallback: when the
// embedded player surfaces the "Sign in to confirm you're not a bot" gate,
// the in-iframe sign-in link is silently swallowed in some browsers, so the
// user opens the stream on youtube.com proper, signs in there, and returns
// to the app — the iframe inherits the auth via cookies.
export function youTubeUrlForStation(station) {
    if (!station || typeof station.sourceId !== 'string' || !station.sourceId) return '';
    if (station.kind === 'playlist') {
        return 'https://www.youtube.com/playlist?list=' + encodeURIComponent(station.sourceId);
    }
    return 'https://www.youtube.com/watch?v=' + encodeURIComponent(station.sourceId);
}


// Combined picker list — custom first, then curated. Stable id lookups for
// `setStation` and the active-row highlight in the popover.
export function getStationById(state, id) {
    if (!id) return null;
    const all = (state.customStations || []).concat(CURATED_STATIONS);
    for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
}


// Module-level loader so concurrent `play()` calls don't queue a second
// `<script>` tag. The promise resolves once `window.onYouTubeIframeAPIReady`
// fires (or immediately if `window.YT && window.YT.Player` is already there).
// Returns null when the document / window isn't usable.
let _iframeApiPromise = null;
export function loadIframeApi(doc) {
    if (typeof window === 'undefined' || !doc) return Promise.reject(new Error('no window'));
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (_iframeApiPromise) return _iframeApiPromise;

    _iframeApiPromise = new Promise(function(resolve, reject) {
        const prior = doc.getElementById('youtubeIframeApi');
        const onReady = function() {
            if (window.YT && window.YT.Player) resolve(window.YT);
            else reject(new Error('YT api loaded without Player'));
        };
        // The API calls window.onYouTubeIframeAPIReady when it finishes loading.
        // Chain to any pre-existing handler so we don't clobber a host page's
        // wiring (the app owns the page so this is defensive).
        const priorHandler = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = function() {
            if (typeof priorHandler === 'function') {
                try { priorHandler(); } catch (e) { /* ignore — defensive */ }
            }
            onReady();
        };
        if (prior) return; // already in-flight
        try {
            const tag = doc.createElement('script');
            tag.id  = 'youtubeIframeApi';
            tag.src = 'https://www.youtube.com/iframe_api';
            tag.async = true;
            tag.onerror = function() { reject(new Error('failed to load YT iframe api')); };
            (doc.head || doc.body || doc.documentElement).appendChild(tag);
        } catch (e) {
            reject(e);
        }
    });
    return _iframeApiPromise;
}

// Test helper — resets the cached promise so subsequent loadIframeApi calls
// re-attempt the script injection.
export function _resetIframeApiPromise() { _iframeApiPromise = null; }


export function createPomodoroSubscriber(controller, music) {
    // Pure function for testability — wires the pomodoro snapshot stream into
    // the music controller's pomodoro-aware pause/resume behaviour.
    let lastStatus = null;
    return function onPomodoroSnap(snap) {
        if (!snap) return;
        const status = snap.status;
        if (status === 'COMPLETE_UNACKED' && lastStatus !== 'COMPLETE_UNACKED') {
            music._handlePomodoroAlertStart();
        } else if (lastStatus === 'COMPLETE_UNACKED' && status !== 'COMPLETE_UNACKED') {
            music._handlePomodoroAlertEnd();
        }
        lastStatus = status;
    };
}


// Factory — every call returns an independent controller. The typical app
// creates exactly one via the singleton accessor at the bottom of the file.
export function createMusic(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);

    let state = sanitizeRestoredState(readPersistedState());
    let player = null;
    let pendingPlayAfterReady = false;
    const subscribers = [];

    function persist() { writePersistedState(state); }

    function notify() {
        for (let i = 0; i < subscribers.length; i++) {
            try { subscribers[i](getSnapshot()); } catch (e) { /* subscribers must not crash the controller */ }
        }
    }

    function getSnapshot() {
        return {
            activeStationId: state.activeStationId,
            activeStation:   getStationById(state, state.activeStationId),
            volume:          state.volume,
            muted:           state.muted,
            preMuteVolume:   state.preMuteVolume,
            status:          state.status,
            nowPlaying:      state.nowPlaying ? Object.assign({}, state.nowPlaying) : null,
            customStations:  state.customStations.slice(),
            curatedStations: CURATED_STATIONS.slice(),
        };
    }

    function setStatus(next) {
        if (VALID_STATUS.indexOf(next) === -1) return;
        if (state.status === next) return;
        state.status = next;
        notify();
    }

    function setVolume(volume) {
        if (typeof volume !== 'number' || !isFinite(volume)) return;
        state.volume = Math.max(0, Math.min(1, volume));
        // Dragging the slider above 0 while muted is an implicit unmute —
        // matches the UX of most native players.
        if (state.muted && state.volume > 0) state.muted = false;
        if (player && typeof player.setVolume === 'function') {
            try { player.setVolume(Math.round(state.volume * 100)); } catch (e) { /* defensive */ }
        }
        persist();
        notify();
    }

    function setMuted(muted) {
        muted = !!muted;
        if (muted === state.muted) return;
        if (muted) {
            if (state.volume > 0) state.preMuteVolume = state.volume;
            state.muted = true;
            state.volume = 0;
        } else {
            state.muted = false;
            state.volume = state.preMuteVolume > 0 ? state.preMuteVolume : DEFAULT_VOLUME;
        }
        if (player && typeof player.setVolume === 'function') {
            try { player.setVolume(Math.round(state.volume * 100)); } catch (e) { /* defensive */ }
        }
        persist();
        notify();
    }

    function setStation(id) {
        const station = getStationById(state, id);
        if (!station) return;
        state.activeStationId = id;
        persist();
        // Selecting a station while paused stages it but doesn't auto-play.
        // Selecting while playing performs a seamless swap.
        if (state.status === 'PLAYING' || state.status === 'BUFFERING') {
            loadStationIntoPlayer(station);
        }
        notify();
    }

    function loadStationIntoPlayer(station) {
        if (!player) return;
        try {
            if (station.kind === 'playlist' && typeof player.loadPlaylist === 'function') {
                player.loadPlaylist({ list: station.sourceId, listType: 'playlist' });
            } else if (typeof player.loadVideoById === 'function') {
                player.loadVideoById(station.sourceId);
            }
        } catch (e) { /* defensive — fail silently, user can retry */ }
    }

    function addCustomStation(name, urlOrId) {
        const parsed = parseYouTubeUrl(urlOrId);
        if (!parsed) return null;
        const trimmedName = (name || '').trim() || (parsed.kind === 'playlist' ? 'Custom playlist' : 'Custom station');
        const station = {
            id:       'custom:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name:     trimmedName,
            kind:     parsed.kind,
            sourceId: parsed.sourceId,
            genre:    'Custom',
        };
        state.customStations.unshift(station);
        state.activeStationId = station.id;
        persist();
        notify();
        return station;
    }

    function removeCustomStation(id) {
        const before = state.customStations.length;
        state.customStations = state.customStations.filter(function(s) { return s.id !== id; });
        if (state.customStations.length === before) return false;
        // If we just removed the active station, fall back to the first
        // curated entry so the picker doesn't end up pointing at a ghost.
        if (state.activeStationId === id) {
            state.activeStationId = CURATED_STATIONS[0].id;
            if (state.status === 'PLAYING' || state.status === 'BUFFERING') {
                pause();
            }
        }
        persist();
        notify();
        return true;
    }

    function setNowPlaying(info) {
        if (!info) { state.nowPlaying = null; notify(); return; }
        state.nowPlaying = {
            title:  info.title  || '',
            author: info.author || '',
        };
        notify();
    }

    // Lazy-creates the YT.Player instance bound to a target element inside
    // the popover. The target lives in the DOM at popover-build time; this
    // function ignores re-entry so subsequent calls reuse the same player.
    function ensurePlayer(targetEl) {
        if (player) return Promise.resolve(player);
        if (!targetEl) return Promise.reject(new Error('no target element for player'));
        return loadIframeApi(doc).then(function(YT) {
            if (player) return player;
            player = new YT.Player(targetEl, {
                height: '135',
                width:  '240',
                playerVars: {
                    autoplay: 0,
                    controls: 0,
                    disablekb: 1,
                    modestbranding: 1,
                    rel: 0,
                    playsinline: 1,
                },
                events: {
                    onReady: function() {
                        try { player.setVolume(Math.round(state.volume * 100)); } catch (e) { /* defensive */ }
                        if (pendingPlayAfterReady) {
                            pendingPlayAfterReady = false;
                            const station = getStationById(state, state.activeStationId);
                            if (station) {
                                loadStationIntoPlayer(station);
                                try { player.playVideo(); } catch (e) { /* defensive */ }
                            }
                        }
                    },
                    onStateChange: function(event) {
                        // YT.PlayerState: -1 unstarted, 0 ended, 1 playing,
                        // 2 paused, 3 buffering, 5 cued.
                        if (!event) return;
                        if (event.data === 1) {
                            setStatus('PLAYING');
                            try {
                                const data = player.getVideoData ? player.getVideoData() : null;
                                if (data) setNowPlaying({ title: data.title, author: data.author });
                            } catch (e) { /* defensive */ }
                        } else if (event.data === 2) {
                            setStatus('PAUSED');
                        } else if (event.data === 3) {
                            setStatus('BUFFERING');
                        } else if (event.data === 0) {
                            setStatus('IDLE');
                            setNowPlaying(null);
                        }
                    },
                    onError: function() {
                        // Hand the user back to IDLE; the popover surfaces the
                        // status so they know to try a different station.
                        setStatus('IDLE');
                    },
                },
            });
            return player;
        });
    }

    function play(targetEl) {
        const station = getStationById(state, state.activeStationId);
        if (!station) return;
        setStatus('BUFFERING');
        if (!player) {
            pendingPlayAfterReady = true;
            ensurePlayer(targetEl).catch(function() {
                pendingPlayAfterReady = false;
                setStatus('IDLE');
            });
            return;
        }
        try {
            // If the station hasn't been loaded yet (e.g., after construction
            // with a default station and no swap), load it before play.
            const data = (player.getVideoData && player.getVideoData()) || {};
            if (station.kind === 'live' && data.video_id !== station.sourceId) {
                loadStationIntoPlayer(station);
            } else if (station.kind === 'playlist') {
                loadStationIntoPlayer(station);
            }
            player.playVideo();
        } catch (e) {
            setStatus('IDLE');
        }
    }

    function pause() {
        if (player && typeof player.pauseVideo === 'function') {
            try { player.pauseVideo(); } catch (e) { /* defensive */ }
        }
        setStatus('PAUSED');
    }

    function _handlePomodoroAlertStart() {
        state.wasPlayingBeforePomodoroAlert = (state.status === 'PLAYING' || state.status === 'BUFFERING');
        if (state.wasPlayingBeforePomodoroAlert) pause();
    }

    function _handlePomodoroAlertEnd() {
        if (state.wasPlayingBeforePomodoroAlert) {
            state.wasPlayingBeforePomodoroAlert = false;
            // Only attempt resume when we still have a player — skipping the
            // ensurePlayer branch keeps us from forcing a fresh load on an
            // unrelated state transition.
            if (player) {
                try { player.playVideo(); } catch (e) { /* defensive */ }
            }
        }
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
        if (player && typeof player.destroy === 'function') {
            try { player.destroy(); } catch (e) { /* defensive */ }
        }
        player = null;
        subscribers.length = 0;
    }

    return {
        play:                       play,
        pause:                      pause,
        setStation:                 setStation,
        setVolume:                  setVolume,
        setMuted:                   setMuted,
        addCustomStation:           addCustomStation,
        removeCustomStation:        removeCustomStation,
        subscribe:                  subscribe,
        destroy:                    destroy,
        getState:                   getSnapshot,
        // exposed for the pomodoro coordination subscriber — they're called
        // from createPomodoroSubscriber, not from external chrome.
        _handlePomodoroAlertStart:  _handlePomodoroAlertStart,
        _handlePomodoroAlertEnd:    _handlePomodoroAlertEnd,
        // exposed for tests that need to drive the YT lifecycle without an
        // actual player attached.
        _setNowPlaying:             setNowPlaying,
        _setStatus:                 setStatus,
    };
}


// ── MODULE-LEVEL SINGLETON ──
let _musicSingleton = null;

export function ensureMusic() {
    if (_musicSingleton) return _musicSingleton;
    if (typeof document === 'undefined') return null;
    _musicSingleton = createMusic(document);
    return _musicSingleton;
}

export function destroyMusic() {
    if (_musicSingleton) {
        _musicSingleton.destroy();
        _musicSingleton = null;
    }
}
