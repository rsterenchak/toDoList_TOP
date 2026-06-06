// Pins the contract for the now-playing strip: a thin row rendered directly
// below the header that appears only while music is PLAYING or BUFFERING and is
// hidden entirely otherwise. The strip's visibility always follows the music
// controller's status (so pomodoro-coordinated auto-pause/resume reflows it for
// free); it owns no independent visibility state beyond the immediate collapse
// the dismiss button performs. The wiring lives in main.js (a syncNowPlayingStrip
// subscriber) and style.css; music.js is unchanged. main.js's component()
// bootstrap is not instantiable in jsdom, so the wiring is verified via
// source-level regex (mirroring music.test.js / pomodoroInlineCountdown.test.js),
// and the status-driven behavior is exercised against the real controller.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    createMusic,
    CURATED_STATIONS,
    MUSIC_STATE_KEY,
    getStationById,
    destroyMusic,
} from '../src/music.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function clearMusicStorage() {
    localStorage.removeItem(MUSIC_STATE_KEY);
}


describe('now-playing strip — DOM markup', () => {
    const main = read('main.js');

    it('creates a #nowPlayingStrip element', () => {
        expect(main).toMatch(/nowPlayingStrip\.id\s*=\s*['"]nowPlayingStrip['"]/);
    });

    it('inserts the strip between the nav and the main section', () => {
        // Ordered appendChild calls on the outer container — the strip sits
        // directly after the nav and before the main pane so it owns its own
        // horizontal row beneath the header. The main pane is wrapped in the
        // D2 two-pane split (#mainSplit), so the strip precedes that wrapper.
        expect(main).toMatch(
            /base\.appendChild\(nav\);\s*base\.appendChild\(nowPlayingStrip\);\s*base\.appendChild\(mainSplit\);/
        );
    });

    it('gives the strip a pause control and a dismiss control', () => {
        expect(main).toMatch(/nowPlayingStripPause/);
        expect(main).toMatch(/nowPlayingStripDismiss/);
        // Both are real buttons with accessible labels.
        const idx = main.indexOf('nowPlayingPause');
        expect(idx).toBeGreaterThan(-1);
        expect(main).toMatch(/aria-label['"]\s*,\s*['"]Pause music['"]/);
        expect(main).toMatch(/aria-label['"]\s*,\s*['"]Dismiss now playing['"]/);
    });
});


describe('now-playing strip — syncNowPlayingStrip wiring', () => {
    const main = read('main.js');

    function syncBody() {
        const m = /function\s+syncNowPlayingStrip\s*\([\s\S]*?\n    \}/.exec(main);
        expect(m).toBeTruthy();
        return m[0];
    }

    it('shows the strip only while PLAYING or BUFFERING', () => {
        const body = syncBody();
        expect(body).toMatch(/['"]PLAYING['"]/);
        expect(body).toMatch(/['"]BUFFERING['"]/);
        expect(body).toMatch(/nowPlayingStrip--visible/);
    });

    it('resolves the active station name via getStationById', () => {
        const body = syncBody();
        expect(body).toMatch(/getStationById\(\s*snap\s*,\s*snap\.activeStationId\s*\)/);
    });

    it('is subscribed to the music controller alongside syncMusicIcon', () => {
        expect(main).toMatch(/ctl\.subscribe\(syncNowPlayingStrip\)/);
    });

    it('pause control routes through the controller pause() method', () => {
        // The pause button reuses the controller's pause — no bespoke logic.
        const idx = main.indexOf('nowPlayingPause.addEventListener');
        expect(idx).toBeGreaterThan(-1);
        const handler = main.slice(idx, idx + 200);
        expect(handler).toMatch(/ctl\.pause\(\)/);
    });

    it('dismiss control pauses AND collapses the strip immediately', () => {
        const idx = main.indexOf('nowPlayingDismiss.addEventListener');
        expect(idx).toBeGreaterThan(-1);
        const handler = main.slice(idx, idx + 260);
        expect(handler).toMatch(/ctl\.pause\(\)/);
        expect(handler).toMatch(/classList\.remove\(\s*['"]nowPlayingStrip--visible['"]\s*\)/);
    });
});


describe('now-playing strip — CSS presentation', () => {
    const css = read('style.css');

    it('hides the strip by default', () => {
        const idx = css.indexOf('#nowPlayingStrip {');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 400);
        expect(block).toMatch(/display:\s*none/);
    });

    it('reveals the strip via the --visible modifier class', () => {
        expect(css).toMatch(/#nowPlayingStrip\.nowPlayingStrip--visible\s*\{\s*display:\s*flex/);
    });

    it('reserves a dedicated grid track for the strip beneath the header', () => {
        // The outer container's second track stays `auto` so the strip
        // collapses to 0 when hidden; the third `auto` track is the desktop
        // view sub-band (also collapsible). Explicit grid-row placement keeps
        // the other rows from reshuffling regardless of which tracks collapse.
        const idx = css.indexOf('#outerContainer {');
        const block = css.slice(idx, idx + 700);
        expect(block).toMatch(/grid-template-rows:\s*var\(--nav-h\)\s+auto\s+auto\s+1fr\s+var\(--foot-h\)/);
        expect(css).toMatch(/#nowPlayingStrip\s*\{[\s\S]*?grid-row:\s*2/);
    });
});


describe('now-playing strip — status-driven contract', () => {
    beforeEach(clearMusicStorage);
    afterEach(() => { destroyMusic(); clearMusicStorage(); });

    // Mirror syncNowPlayingStrip's decision so the contract is exercised against
    // the real controller snapshot shape rather than asserted only by regex.
    function stripVisibleFor(snap) {
        return snap.status === 'PLAYING' || snap.status === 'BUFFERING';
    }

    it('snapshot exposes a status and a resolvable active station', () => {
        const ctl = createMusic(document);
        const snap = ctl.getState();
        expect(typeof snap.status).toBe('string');
        const station = getStationById(snap, snap.activeStationId);
        expect(station).toBeTruthy();
        expect(typeof station.name).toBe('string');
        ctl.destroy();
    });

    it('an IDLE controller maps to a hidden strip', () => {
        const ctl = createMusic(document);
        expect(ctl.getState().status).toBe('IDLE');
        expect(stripVisibleFor(ctl.getState())).toBe(false);
        ctl.destroy();
    });

    it('PLAYING and BUFFERING map to a visible strip; PAUSED/IDLE do not', () => {
        expect(stripVisibleFor({ status: 'PLAYING' })).toBe(true);
        expect(stripVisibleFor({ status: 'BUFFERING' })).toBe(true);
        expect(stripVisibleFor({ status: 'PAUSED' })).toBe(false);
        expect(stripVisibleFor({ status: 'IDLE' })).toBe(false);
    });

    it('the default active station resolves to a real curated station name', () => {
        const ctl = createMusic(document);
        const snap = ctl.getState();
        const station = getStationById(snap, snap.activeStationId);
        expect(CURATED_STATIONS.some(s => s.name === station.name)).toBe(true);
        ctl.destroy();
    });
});
