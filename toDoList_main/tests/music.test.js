// SomaFM music player feature — controller surface, persistence, station /
// volume mutations, pomodoro coordination, and main.js / style.css wiring.
// Mirrors the structure of pomodoro.test.js.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    createMusic,
    ensureMusic,
    destroyMusic,
    STATIONS,
    DEFAULT_VOLUME,
    MUSIC_STATE_KEY,
} from '../src/music.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function clearMusicStorage() {
    localStorage.removeItem(MUSIC_STATE_KEY);
}

// Minimal HTMLAudioElement stub — jsdom's audio element doesn't actually
// stream, and play() / load() can throw "Not implemented" in some setups.
// Patching createElement('audio') keeps the controller exercised end-to-end
// without relying on jsdom's incomplete media support.
function patchAudioElement() {
    const original = document.createElement.bind(document);
    document.createElement = function(tag) {
        if (String(tag).toLowerCase() === 'audio') {
            const el = original('div');
            el._isAudioStub = true;
            el.src = '';
            el.volume = 1;
            el.preload = 'none';
            el.paused = true;
            el.play = function() {
                el.paused = false;
                return Promise.resolve();
            };
            el.pause = function() {
                el.paused = true;
            };
            return el;
        }
        return original(tag);
    };
    return function restore() { document.createElement = original; };
}


describe('music — module surface', () => {
    let restoreAudio;
    beforeEach(() => { clearMusicStorage(); restoreAudio = patchAudioElement(); });
    afterEach(() => { destroyMusic(); clearMusicStorage(); restoreAudio(); });

    it('exports createMusic / ensureMusic / destroyMusic', () => {
        expect(typeof createMusic).toBe('function');
        expect(typeof ensureMusic).toBe('function');
        expect(typeof destroyMusic).toBe('function');
    });

    it('exports a non-empty STATIONS list with the documented shape', () => {
        expect(Array.isArray(STATIONS)).toBe(true);
        expect(STATIONS.length).toBeGreaterThanOrEqual(5);
        STATIONS.forEach(function(station) {
            expect(typeof station.id).toBe('string');
            expect(typeof station.name).toBe('string');
            expect(typeof station.genre).toBe('string');
            expect(typeof station.streamUrl).toBe('string');
            expect(station.streamUrl).toMatch(/^https?:\/\//);
        });
    });

    it('exports default volume in [0, 1]', () => {
        expect(DEFAULT_VOLUME).toBeGreaterThanOrEqual(0);
        expect(DEFAULT_VOLUME).toBeLessThanOrEqual(1);
    });

    it('createMusic returns a controller with the documented surface', () => {
        const ctl = createMusic(document);
        ['play', 'pause', 'setStation', 'setVolume', 'subscribe', 'destroy', 'getState']
            .forEach(function(method) {
                expect(typeof ctl[method]).toBe('function');
            });
        ctl.destroy();
    });

    it('starts IDLE with no station and the default volume on first run', () => {
        clearMusicStorage();
        const ctl = createMusic(document);
        const snap = ctl.getState();
        expect(snap.status).toBe('IDLE');
        expect(snap.stationId).toBeNull();
        expect(snap.volume).toBeCloseTo(DEFAULT_VOLUME);
        ctl.destroy();
    });
});


describe('music — persistence', () => {
    let restoreAudio;
    beforeEach(() => { clearMusicStorage(); restoreAudio = patchAudioElement(); });
    afterEach(() => { destroyMusic(); clearMusicStorage(); restoreAudio(); });

    it('persists state under the documented todoapp_ key prefix', () => {
        // Per CLAUDE.md, all user data persists under todoapp_*.
        expect(MUSIC_STATE_KEY).toMatch(/^todoapp_/);
        const ctl = createMusic(document);
        ctl.setStation(STATIONS[1].id);
        ctl.setVolume(0.25);
        const raw = localStorage.getItem(MUSIC_STATE_KEY);
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw);
        expect(parsed.stationId).toBe(STATIONS[1].id);
        expect(parsed.volume).toBeCloseTo(0.25);
        ctl.destroy();
    });

    it('persists only stationId and volume — never status, so no auto-resume', () => {
        const ctl = createMusic(document);
        ctl.setStation(STATIONS[0].id);
        ctl.play();
        const raw = localStorage.getItem(MUSIC_STATE_KEY);
        const parsed = JSON.parse(raw);
        expect(parsed.status).toBeUndefined();
        expect(parsed).toEqual({ stationId: STATIONS[0].id, volume: expect.any(Number) });
        ctl.destroy();
    });

    it('restores the saved station and volume on next instantiation', () => {
        const a = createMusic(document);
        a.setStation(STATIONS[2].id);
        a.setVolume(0.4);
        a.destroy();
        const b = createMusic(document);
        const snap = b.getState();
        expect(snap.stationId).toBe(STATIONS[2].id);
        expect(snap.volume).toBeCloseTo(0.4);
        // Always IDLE on restore — playback never auto-resumes.
        expect(snap.status).toBe('IDLE');
        b.destroy();
    });

    it('ignores an unknown stationId in persisted state and keeps null', () => {
        localStorage.setItem(MUSIC_STATE_KEY, JSON.stringify({
            stationId: 'not-a-real-station',
            volume:    0.6,
        }));
        const ctl = createMusic(document);
        expect(ctl.getState().stationId).toBeNull();
        expect(ctl.getState().volume).toBeCloseTo(0.6);
        ctl.destroy();
    });
});


describe('music — state machine and mutations', () => {
    let restoreAudio;
    beforeEach(() => { clearMusicStorage(); restoreAudio = patchAudioElement(); });
    afterEach(() => { destroyMusic(); clearMusicStorage(); restoreAudio(); });

    it('play() moves IDLE → PLAYING and selects the first station when none is set', () => {
        const ctl = createMusic(document);
        ctl.play();
        const snap = ctl.getState();
        expect(snap.status).toBe('PLAYING');
        expect(snap.stationId).toBe(STATIONS[0].id);
        ctl.destroy();
    });

    it('pause() moves PLAYING → PAUSED', () => {
        const ctl = createMusic(document);
        ctl.play();
        ctl.pause();
        expect(ctl.getState().status).toBe('PAUSED');
        ctl.destroy();
    });

    it('clamps setVolume to [0, 1]', () => {
        const ctl = createMusic(document);
        ctl.setVolume(-1);
        expect(ctl.getState().volume).toBe(0);
        ctl.setVolume(2);
        expect(ctl.getState().volume).toBe(1);
        ctl.destroy();
    });

    it('setStation while paused stages it without auto-playing', () => {
        const ctl = createMusic(document);
        ctl.setStation(STATIONS[1].id);
        const snap = ctl.getState();
        expect(snap.stationId).toBe(STATIONS[1].id);
        expect(snap.status).toBe('IDLE');
        ctl.destroy();
    });

    it('setStation while playing performs a seamless swap and stays PLAYING', () => {
        const ctl = createMusic(document);
        ctl.play();
        ctl.setStation(STATIONS[2].id);
        const snap = ctl.getState();
        expect(snap.stationId).toBe(STATIONS[2].id);
        expect(snap.status).toBe('PLAYING');
        ctl.destroy();
    });

    it('setStation rejects unknown ids', () => {
        const ctl = createMusic(document);
        ctl.setStation('not-real');
        expect(ctl.getState().stationId).toBeNull();
        ctl.destroy();
    });

    it('subscribe receives notifications and unsubscribe stops them', () => {
        const ctl = createMusic(document);
        const seen = [];
        const unsub = ctl.subscribe(function(snap) { seen.push(snap.status); });
        ctl.play();
        ctl.pause();
        const lengthBefore = seen.length;
        unsub();
        ctl.play();
        // No new notifications after unsubscribe.
        expect(seen.length).toBe(lengthBefore);
        ctl.destroy();
    });
});


describe('music — pomodoro coordination', () => {
    let restoreAudio;
    beforeEach(() => { clearMusicStorage(); restoreAudio = patchAudioElement(); });
    afterEach(() => { destroyMusic(); clearMusicStorage(); restoreAudio(); });

    function makeFakePomodoro() {
        let snap = { status: 'IDLE' };
        const subs = [];
        return {
            getState: function() { return snap; },
            subscribe: function(fn) { subs.push(fn); return function() {}; },
            // Test helper — push a new status snapshot to subscribers.
            _setStatus: function(status) {
                snap = { status: status };
                subs.forEach(function(fn) { fn(snap); });
            },
        };
    }

    it('pauses audio when pomodoro enters COMPLETE_UNACKED while playing', () => {
        const fake = makeFakePomodoro();
        const ctl = createMusic(document, fake);
        ctl.play();
        expect(ctl.getState().status).toBe('PLAYING');
        fake._setStatus('COMPLETE_UNACKED');
        expect(ctl.getState().status).toBe('PAUSED');
        ctl.destroy();
    });

    it('resumes playback when pomodoro leaves COMPLETE_UNACKED if user was playing before', () => {
        const fake = makeFakePomodoro();
        const ctl = createMusic(document, fake);
        ctl.play();
        fake._setStatus('COMPLETE_UNACKED');
        fake._setStatus('IDLE'); // user acknowledged
        expect(ctl.getState().status).toBe('PLAYING');
        ctl.destroy();
    });

    it('does NOT resume playback after acknowledgment if user was paused before', () => {
        const fake = makeFakePomodoro();
        const ctl = createMusic(document, fake);
        // User is not actively playing when the alert fires.
        fake._setStatus('COMPLETE_UNACKED');
        fake._setStatus('IDLE');
        expect(ctl.getState().status).toBe('IDLE');
        ctl.destroy();
    });
});


describe('music — main.js wiring', () => {
    const main   = read('main.js');
    const css    = read('style.css');
    const modals = read('modals.js');

    it('imports the music module helpers in main.js', () => {
        expect(main).toMatch(/import\s*\{[^}]*ensureMusic[^}]*\}\s*from\s*['"]\.\/music\.js['"]/);
    });

    it('creates a #musicToggle button in the nav between pomodoro and settings', () => {
        expect(main).toMatch(/musicToggle\.id\s*=\s*['"]musicToggle['"]/);
        expect(main).toMatch(/nav\.appendChild\(\s*musicToggle\s*\)/);
        // Order: pomodoroToggle then musicToggle then settingsToggle.
        const pomoIdx = main.indexOf('nav.appendChild(pomodoroToggle)');
        const musicIdx = main.indexOf('nav.appendChild(musicToggle)');
        const settingsIdx = main.indexOf('nav.appendChild(settingsToggle)');
        expect(pomoIdx).toBeGreaterThan(-1);
        expect(musicIdx).toBeGreaterThan(pomoIdx);
        expect(settingsIdx).toBeGreaterThan(musicIdx);
    });

    it('opens / dismisses the popover via showMusicPopover / hideMusicPopover', () => {
        expect(main).toMatch(/function\s+showMusicPopover\s*\(/);
        expect(main).toMatch(/function\s+hideMusicPopover\s*\(/);
        expect(main).toMatch(/onMusicOutsideClick/);
        expect(main).toMatch(/onMusicKeydown/);
    });

    it('registers the popover with isAnyModalOrPopoverOpen so global shortcuts pause', () => {
        expect(modals).toMatch(/getElementById\(\s*['"]musicPopover['"]\s*\)/);
    });

    it('adds a Music topic to the help modal so the feature is documented', () => {
        expect(modals).toMatch(/category:\s*['"]Music['"]/);
    });

    it('styles #musicToggle with the same 36×36 nav-button geometry', () => {
        const idx = css.indexOf('#musicToggle');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 1000);
        expect(block).toMatch(/width:\s*36px/);
        expect(block).toMatch(/height:\s*36px/);
        expect(block).toMatch(/border-radius:\s*8px/);
    });

    it('does NOT carry margin-left: auto on #musicToggle (only #pomodoroToggle does)', () => {
        // The right cluster is anchored by margin-left: auto on #pomodoroToggle.
        // Music must rely on the navbar's gap so it sits flush to the pomodoro.
        const idx = css.indexOf('#musicToggle');
        const next = css.indexOf('}', idx);
        const block = css.slice(idx, next);
        expect(block).not.toMatch(/margin-left:\s*auto/);
    });

    it('recolors the icon when a stream is playing', () => {
        // The accent recolor is the primary "music in flight" affordance.
        expect(css).toMatch(/#musicToggle\[data-music-status="PLAYING"\]/);
    });

    it('animates the visualizer bars while playing via a keyframe', () => {
        expect(css).toMatch(/@keyframes\s+musicVizBar/);
        expect(css).toMatch(/\.musicVizBars\b/);
    });

    it('respects prefers-reduced-motion by flattening the visualizer animation', () => {
        // The pomodoro icon already has a similar carve-out — the music
        // visualizer needs the same respect for the user preference.
        expect(css).toMatch(/@media\s+\(prefers-reduced-motion:\s*reduce\)[^@]*#musicToggle[^@]*animation:\s*none/s);
    });

    it('hides the floating help FAB when the music popover is open', () => {
        expect(css).toMatch(/body:has\(#musicPopover\)\s*#helpFab\s*\{\s*display:\s*none/);
    });
});
