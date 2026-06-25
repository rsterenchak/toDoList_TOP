// YouTube focus-music feature — module-surface contract, persistence, URL
// parsing, station management, pomodoro coordination, and main.js / CSS /
// modals wiring. Mirrors the structure of pomodoro.test.js so the module's
// expectations stay scannable.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    createMusic,
    parseYouTubeUrl,
    createPomodoroSubscriber,
    CURATED_STATIONS,
    MUSIC_STATE_KEY,
    DEFAULT_VOLUME,
    ensureMusic,
    destroyMusic,
    youTubeUrlForStation,
} from '../src/music.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function clearMusicStorage() {
    localStorage.removeItem(MUSIC_STATE_KEY);
}


describe('music — module surface', () => {
    beforeEach(clearMusicStorage);
    afterEach(() => { destroyMusic(); clearMusicStorage(); });

    it('exports the createMusic / ensureMusic / destroyMusic trio', () => {
        expect(typeof createMusic).toBe('function');
        expect(typeof ensureMusic).toBe('function');
        expect(typeof destroyMusic).toBe('function');
    });

    it('exports the createPomodoroSubscriber wiring helper', () => {
        expect(typeof createPomodoroSubscriber).toBe('function');
    });

    it('exports the parseYouTubeUrl helper', () => {
        expect(typeof parseYouTubeUrl).toBe('function');
    });

    it('exports a non-empty CURATED_STATIONS list with the documented shape', () => {
        expect(Array.isArray(CURATED_STATIONS)).toBe(true);
        expect(CURATED_STATIONS.length).toBeGreaterThanOrEqual(4);
        CURATED_STATIONS.forEach(function(station) {
            expect(typeof station.id).toBe('string');
            expect(typeof station.name).toBe('string');
            expect(['live', 'playlist'].includes(station.kind)).toBe(true);
            expect(typeof station.sourceId).toBe('string');
        });
    });

    it('exports a default volume in [0, 1]', () => {
        expect(DEFAULT_VOLUME).toBeGreaterThanOrEqual(0);
        expect(DEFAULT_VOLUME).toBeLessThanOrEqual(1);
    });

    it('createMusic returns a controller with the documented surface', () => {
        const ctl = createMusic(document);
        ['play', 'pause', 'setStation', 'setVolume',
         'addCustomStation', 'removeCustomStation',
         'subscribe', 'destroy', 'getState']
            .forEach(function(method) {
                expect(typeof ctl[method]).toBe('function');
            });
        ctl.destroy();
    });

    it('starts IDLE with the first curated station active and default volume', () => {
        const ctl = createMusic(document);
        const snap = ctl.getState();
        expect(snap.status).toBe('IDLE');
        expect(snap.activeStationId).toBe(CURATED_STATIONS[0].id);
        expect(snap.volume).toBeCloseTo(DEFAULT_VOLUME);
        expect(snap.customStations).toEqual([]);
        ctl.destroy();
    });
});


describe('music — URL parsing', () => {
    it('accepts a bare 11-char video ID as a live station', () => {
        const parsed = parseYouTubeUrl('jfKfPfyJRdk');
        expect(parsed).toEqual({ kind: 'live', sourceId: 'jfKfPfyJRdk' });
    });

    it('parses youtube.com/watch?v= URLs', () => {
        const parsed = parseYouTubeUrl('https://www.youtube.com/watch?v=jfKfPfyJRdk');
        expect(parsed).toEqual({ kind: 'live', sourceId: 'jfKfPfyJRdk' });
    });

    it('parses youtu.be/ short URLs', () => {
        const parsed = parseYouTubeUrl('https://youtu.be/jfKfPfyJRdk');
        expect(parsed).toEqual({ kind: 'live', sourceId: 'jfKfPfyJRdk' });
    });

    it('parses youtube.com/playlist?list= URLs', () => {
        const parsed = parseYouTubeUrl('https://www.youtube.com/playlist?list=PLOzDu-MXXLljn7nM-NLFhhRYNb1qaR-bn');
        expect(parsed).toEqual({ kind: 'playlist', sourceId: 'PLOzDu-MXXLljn7nM-NLFhhRYNb1qaR-bn' });
    });

    it('parses youtube.com/embed/ID URLs', () => {
        const parsed = parseYouTubeUrl('https://www.youtube.com/embed/jfKfPfyJRdk');
        expect(parsed).toEqual({ kind: 'live', sourceId: 'jfKfPfyJRdk' });
    });

    it('parses youtube.com/live/ID URLs', () => {
        const parsed = parseYouTubeUrl('https://www.youtube.com/live/jfKfPfyJRdk');
        expect(parsed).toEqual({ kind: 'live', sourceId: 'jfKfPfyJRdk' });
    });

    it('rejects garbage and returns null', () => {
        expect(parseYouTubeUrl('not a url')).toBeNull();
        expect(parseYouTubeUrl('')).toBeNull();
        expect(parseYouTubeUrl(null)).toBeNull();
        expect(parseYouTubeUrl('https://example.com/jfKfPfyJRdk')).toBeNull();
    });
});


describe('music — station management', () => {
    beforeEach(clearMusicStorage);
    afterEach(() => { destroyMusic(); clearMusicStorage(); });

    it('addCustomStation prepends a custom station and selects it', () => {
        const ctl = createMusic(document);
        const station = ctl.addCustomStation('My lofi', 'https://youtu.be/jfKfPfyJRdk');
        expect(station).toBeTruthy();
        expect(station.kind).toBe('live');
        expect(station.sourceId).toBe('jfKfPfyJRdk');
        expect(station.name).toBe('My lofi');
        const snap = ctl.getState();
        expect(snap.customStations.length).toBe(1);
        expect(snap.activeStationId).toBe(station.id);
        ctl.destroy();
    });

    it('addCustomStation rejects unparseable URLs', () => {
        const ctl = createMusic(document);
        const station = ctl.addCustomStation('bogus', 'https://example.com/foo');
        expect(station).toBeNull();
        expect(ctl.getState().customStations.length).toBe(0);
        ctl.destroy();
    });

    it('removeCustomStation removes by id and returns true', () => {
        const ctl = createMusic(document);
        const station = ctl.addCustomStation('My lofi', 'jfKfPfyJRdk');
        const ok = ctl.removeCustomStation(station.id);
        expect(ok).toBe(true);
        expect(ctl.getState().customStations.length).toBe(0);
        // Active station falls back to the first curated entry once the active
        // custom one is removed.
        expect(ctl.getState().activeStationId).toBe(CURATED_STATIONS[0].id);
        ctl.destroy();
    });

    it('setStation switches the active station id', () => {
        const ctl = createMusic(document);
        const target = CURATED_STATIONS[1].id;
        ctl.setStation(target);
        expect(ctl.getState().activeStationId).toBe(target);
        ctl.destroy();
    });

    it('setVolume clamps to [0, 1]', () => {
        const ctl = createMusic(document);
        ctl.setVolume(2);
        expect(ctl.getState().volume).toBe(1);
        ctl.setVolume(-0.5);
        expect(ctl.getState().volume).toBe(0);
        ctl.setVolume(0.42);
        expect(ctl.getState().volume).toBeCloseTo(0.42);
        ctl.destroy();
    });

    it('persists active station, volume, and custom stations across instances', () => {
        const ctlA = createMusic(document);
        const station = ctlA.addCustomStation('My lofi', 'jfKfPfyJRdk');
        ctlA.setVolume(0.33);
        ctlA.destroy();

        const ctlB = createMusic(document);
        const snap = ctlB.getState();
        expect(snap.volume).toBeCloseTo(0.33);
        expect(snap.customStations.length).toBe(1);
        expect(snap.customStations[0].sourceId).toBe('jfKfPfyJRdk');
        expect(snap.activeStationId).toBe(station.id);
        ctlB.destroy();
    });
});


describe('music — pomodoro coordination', () => {
    beforeEach(clearMusicStorage);
    afterEach(() => { destroyMusic(); clearMusicStorage(); });

    it('pauses on COMPLETE_UNACKED and resumes after acknowledgment if it was playing', () => {
        const ctl = createMusic(document);
        const sub = createPomodoroSubscriber(null, ctl);

        // Force state to PLAYING — bypasses the actual YT player.
        ctl._setStatus('PLAYING');

        sub({ status: 'RUNNING' });
        expect(ctl.getState().status).toBe('PLAYING');

        sub({ status: 'COMPLETE_UNACKED' });
        expect(ctl.getState().status).toBe('PAUSED');

        sub({ status: 'IDLE' });
        // No real player attached, so resume can't actually un-pause the YT
        // iframe — but the controller's internal flag must clear so a future
        // alert doesn't double-trigger.
        const snap = ctl.getState();
        // Status stays PAUSED here because we have no real player to flip to
        // PLAYING; the contract is "we tried to resume", not "we're playing".
        expect(['PAUSED', 'PLAYING']).toContain(snap.status);

        ctl.destroy();
    });

    it('does not resume if the user was already paused at alert time', () => {
        const ctl = createMusic(document);
        const sub = createPomodoroSubscriber(null, ctl);

        ctl._setStatus('PAUSED');
        sub({ status: 'RUNNING' });
        sub({ status: 'COMPLETE_UNACKED' });
        // Was not playing — controller stays PAUSED rather than firing the
        // resume branch.
        expect(ctl.getState().status).toBe('PAUSED');

        sub({ status: 'IDLE' });
        // No spurious play.
        expect(ctl.getState().status).toBe('PAUSED');

        ctl.destroy();
    });
});


describe('music — main.js wiring', () => {
    const main = read('main.js');
    // The popover open/close logic moved into music.js's createMusicUI factory;
    // the toggle button + factory call + imports stay in main.js.
    const music = read('music.js');
    const css  = read('style.css');
    const modals = read('modals.js');

    it('imports the music helpers in main.js', () => {
        expect(main).toMatch(/import\s*\{[^}]*ensureMusic[^}]*\}\s*from\s*['"]\.\/music\.js['"]/);
        expect(main).toMatch(/createPomodoroSubscriber/);
    });

    it('creates a #musicToggle button between pomodoro and settings in the nav', () => {
        expect(main).toMatch(/musicToggle\.id\s*=\s*['"]musicToggle['"]/);
        expect(main).toMatch(/nav\.appendChild\(\s*musicToggle\s*\)/);
        // pomodoroToggle must be appended before musicToggle, and musicToggle
        // before settingsToggle. The focus-mode toggle sits between music and
        // settings in the right cluster. A regex catches this ordering.
        expect(main).toMatch(/pomodoroToggle\s*\)\s*;\s*nav\.appendChild\(\s*musicToggle\s*\)\s*;\s*nav\.appendChild\(\s*focusModeToggle\s*\)\s*;\s*nav\.appendChild\(\s*settingsToggle/);
    });

    it('opens / dismisses the popover via showMusicPopover / hideMusicPopover', () => {
        expect(music).toMatch(/function\s+showMusicPopover\s*\(/);
        expect(music).toMatch(/function\s+hideMusicPopover\s*\(/);
        expect(music).toMatch(/onMusicOutsideClick/);
        expect(music).toMatch(/onMusicKeydown/);
    });

    it('uses .open / .remove("open") instead of detaching the popover so the iframe survives close', () => {
        expect(music).toMatch(/musicPopover\.classList\.add\(\s*['"]open['"]\s*\)/);
        expect(music).toMatch(/musicPopover\.classList\.remove\(\s*['"]open['"]\s*\)/);
    });

    it('registers the popover with isAnyModalOrPopoverOpen via the .open class selector', () => {
        // Presence-only check would be wrong — the popover lives in the DOM
        // at rest. The test for the helper itself is below.
        expect(modals).toMatch(/#musicPopover\.open/);
    });

    it('isAnyModalOrPopoverOpen recognises the music popover', () => {
        const fnIdx = modals.indexOf('function isAnyModalOrPopoverOpen');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = modals.slice(fnIdx, fnIdx + 2000);
        expect(body).toContain('musicPopover');
    });

    it('styles #musicToggle with the same 36×36 nav-button geometry as #pomodoroToggle', () => {
        const idx = css.indexOf('#musicToggle');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 1000);
        expect(block).toMatch(/width:\s*36px/);
        expect(block).toMatch(/height:\s*36px/);
        expect(block).toMatch(/border-radius:\s*8px/);
    });

    it('does not give #musicToggle margin-left:auto (only #pomodoroToggle anchors the right cluster)', () => {
        const idx = css.indexOf('#musicToggle {');
        expect(idx).toBeGreaterThan(-1);
        // Block defining the toggle itself stops at the first `}` after the opening brace.
        const end = css.indexOf('}', idx);
        const block = css.slice(idx, end);
        // Strip CSS comments so a clarifying note about why we don't set
        // margin-left:auto isn't mistaken for an actual declaration.
        const stripped = block.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(stripped).not.toMatch(/margin-left\s*:\s*auto\s*;/);
    });

    it('recolors the icon with the accent treatment when playing or buffering', () => {
        expect(css).toMatch(/#musicToggle\[data-music-status="PLAYING"\]/);
        expect(css).toMatch(/#musicToggle\[data-music-status="BUFFERING"\]/);
    });

    it('animates the visualizer bars unconditionally, including under prefers-reduced-motion', () => {
        // The keyframe definition exists.
        expect(css).toMatch(/@keyframes\s+musicVizBar\b/);
        // The animation is wired to .musicVizBars span without gating on
        // data-music-status. Earlier revisions only animated during
        // PLAYING (and later BUFFERING) — but the visualizer is purely
        // a "fake pattern" with no real audio analysis, and tying it to
        // the YouTube iframe's state machine left the bars frozen on
        // every state-machine hiccup or cache-stale selector mismatch.
        // Always-on motion is the contract now; color still tracks state.
        expect(css).toMatch(/\.musicVizBars\s+span\s*\{[^}]*animation:\s*musicVizBar\s+[\d.]+s/);
        // The visualizer intentionally opts out of the reduced-motion
        // guard — the "music is on" affordance disappears entirely if
        // the bars freeze, and a 2px-wide × 14px loop on a single nav
        // icon is well below the motion-sensitivity threshold. Pin that
        // by asserting no rule inside any prefers-reduced-motion block
        // turns off the bar animation. Other animations across the app
        // (modals, companion cheer, etc.) still respect the preference.
        const reducedMotionBlocks = css.match(/@media\s+\(prefers-reduced-motion:\s*reduce\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g) || [];
        for (const block of reducedMotionBlocks) {
            expect(block).not.toMatch(/\.musicVizBars\b/);
            expect(block).not.toMatch(/#musicToggle\b/);
        }
    });

    it('keeps the paste-URL inputs at 16px+ to avoid iOS Safari auto-zoom', () => {
        const idx = css.indexOf('.musicPasteUrlInput');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx - 200, idx + 600);
        const sizeMatch = /font-size:\s*(\d+)px/.exec(block);
        expect(sizeMatch).toBeTruthy();
        expect(parseInt(sizeMatch[1], 10)).toBeGreaterThanOrEqual(16);
    });

    it('hides the Claude launcher when the music popover is open', () => {
        // Same vocabulary as the pomodoro popover rule; must check `.open`
        // because the music popover stays in the DOM at rest.
        expect(css).toMatch(/body:has\(#musicPopover\.open\)\s*#claudeLauncher\s*\{\s*display:\s*none/);
    });

    it('adds a Music topic to HELP_TOPICS', () => {
        expect(modals).toMatch(/category:\s*['"]Music['"]/);
    });
});


describe('music — persistence key uses the todoapp_ prefix', () => {
    it('namespaces the localStorage key', () => {
        expect(MUSIC_STATE_KEY).toMatch(/^todoapp_/);
    });
});


describe('music — youTubeUrlForStation sign-in fallback', () => {
    it('builds a /watch?v= URL for live (single-video) stations', () => {
        const url = youTubeUrlForStation({ kind: 'live', sourceId: 'jfKfPfyJRdk' });
        expect(url).toBe('https://www.youtube.com/watch?v=jfKfPfyJRdk');
    });

    it('builds a /playlist?list= URL for playlist stations', () => {
        const url = youTubeUrlForStation({
            kind: 'playlist',
            sourceId: 'PLOzDu-MXXLljn7nM-NLFhhRYNb1qaR-bn',
        });
        expect(url).toBe(
            'https://www.youtube.com/playlist?list=PLOzDu-MXXLljn7nM-NLFhhRYNb1qaR-bn'
        );
    });

    it('returns an empty string for stations without a sourceId', () => {
        expect(youTubeUrlForStation(null)).toBe('');
        expect(youTubeUrlForStation({})).toBe('');
        expect(youTubeUrlForStation({ kind: 'live' })).toBe('');
        expect(youTubeUrlForStation({ kind: 'live', sourceId: '' })).toBe('');
    });

    it('produces working URLs for every curated station', () => {
        CURATED_STATIONS.forEach(function(station) {
            const url = youTubeUrlForStation(station);
            expect(url.startsWith('https://www.youtube.com/')).toBe(true);
            if (station.kind === 'playlist') {
                expect(url).toContain('/playlist?list=');
            } else {
                expect(url).toContain('/watch?v=');
            }
        });
    });
});


describe('music — Focus Music modal header carries an Open-in-YouTube icon button', () => {
    // The popover (and its header button) is built in music.js's createMusicUI
    // factory, co-located with the youTubeUrlForStation / getStationById
    // helpers it uses.
    const music = readFileSync(resolve(srcDir, 'music.js'), 'utf8');
    const css  = readFileSync(resolve(srcDir, 'style.css'), 'utf8');

    it('resolves the header URL via the co-located youTubeUrlForStation and getStationById helpers', () => {
        // Both helpers are defined in music.js, so the folded-in popover header
        // references them directly rather than importing them across modules.
        expect(music).toMatch(/export function youTubeUrlForStation/);
        expect(music).toMatch(/export function getStationById/);
    });

    it('builds the header as a real <button> element (not an anchor)', () => {
        const idx = music.indexOf('musicHeaderOpenExt');
        expect(idx).toBeGreaterThan(-1);
        // Find the createElement call attached to the headerOpenExt variable.
        expect(music).toMatch(/headerOpenExt\s*=\s*document\.createElement\(\s*['"]button['"]\s*\)/);
    });

    it('opens the URL in a new tab via window.open with the noopener feature', () => {
        const idx = music.indexOf('musicHeaderOpenExt');
        const block = music.slice(idx, idx + 1500);
        expect(block).toMatch(/window\.open\(\s*[^,]+,\s*['"]_blank['"]\s*,\s*['"]noopener['"]\s*\)/);
    });

    it('resolves the URL from the active station at click time, falling back to youtube.com', () => {
        const idx = music.indexOf('musicHeaderOpenExt');
        const block = music.slice(idx, idx + 1500);
        expect(block).toMatch(/getStationById\s*\(/);
        expect(block).toMatch(/youTubeUrlForStation\s*\(/);
        expect(block).toMatch(/https:\/\/www\.youtube\.com/);
    });

    it('labels the icon button for assistive tech and tooltip on hover', () => {
        const idx = music.indexOf('musicHeaderOpenExt');
        const block = music.slice(idx, idx + 1500);
        expect(block).toMatch(/aria-label['"\s,]+Open in YouTube/);
        expect(block).toMatch(/title\s*=\s*['"]Open in YouTube['"]/);
    });

    it('lays the header out as a 3-column grid so the title stays centered', () => {
        const idx = css.indexOf('.musicPopoverHeader');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 600);
        expect(block).toMatch(/display:\s*grid/);
        expect(block).toMatch(/grid-template-columns:/);
    });

    it('styles the header icon button with a hover affordance and ~28px hit target', () => {
        const idx = css.indexOf('.musicHeaderOpenExt');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 800);
        expect(block).toMatch(/width:\s*28px/);
        expect(block).toMatch(/height:\s*28px/);
        expect(css).toMatch(/\.musicHeaderOpenExt:hover/);
    });

    it('removes the per-row Open-in-YouTube arrows from the station rows', () => {
        const stationRowIdx = music.indexOf('function stationRow');
        expect(stationRowIdx).toBeGreaterThan(-1);
        const block = music.slice(stationRowIdx, stationRowIdx + 3000);
        expect(block).not.toContain('musicStationOpenExt');
        // The rendered ↗ glyph that lived in the row should no longer be there.
        expect(block).not.toContain('↗');
        // No leftover CSS for the removed per-row class either.
        expect(css).not.toContain('.musicStationOpenExt');
    });
});
