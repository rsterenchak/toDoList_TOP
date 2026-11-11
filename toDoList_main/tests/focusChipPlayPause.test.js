import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { ensureMusic, destroyMusic, MUSIC_STATE_KEY } from '../src/music.js';
import { createFocusMode } from '../src/focusMode.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

function stubMatchMedia() {
    window.matchMedia = function(query) {
        return {
            matches: query.indexOf('min-width: 1024px') !== -1,
            media: query,
            addListener() {}, removeListener() {},
            addEventListener() {}, removeEventListener() {},
            dispatchEvent() { return false; },
        };
    };
}

// Clicking / tapping the focus page's now-playing chip toggles music
// play/pause and flashes a transient centred glyph; the volume popover stays
// reachable via hover, keyboard focus / Enter and long-press.
describe('focus mode — tap-to-play/pause on the now-playing chip', () => {
    let f;
    let m;
    beforeEach(() => {
        localStorage.removeItem(MUSIC_STATE_KEY);
        destroyMusic();
        stubMatchMedia();
        f = createFocusMode(document);
        f.activate();
        m = ensureMusic();
        // Never touch the real YT loader in tests — drive status directly.
        vi.spyOn(m, 'play').mockImplementation(() => { m._setStatus('PLAYING'); });
        vi.spyOn(m, 'pause').mockImplementation(() => { m._setStatus('PAUSED'); });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        f.destroy();
        destroyMusic();
        delete window.matchMedia;
    });

    const chip = () => document.querySelector('.focusNowPlaying');
    const glyph = () => document.querySelector('.focusPlayGlyph');
    const isOpen = () => document.querySelector('.focusVolumePopover')
        .classList.contains('focusVolumePopover--open');
    const click = () => chip().dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));

    it('mouse click plays when stopped and pauses when playing', () => {
        click();
        expect(m.play).toHaveBeenCalledTimes(1);
        expect(m.getState().status).toBe('PLAYING');
        click();
        expect(m.pause).toHaveBeenCalledTimes(1);
        expect(m.getState().status).toBe('PAUSED');
    });

    it('title and aria-label name the action and follow music state; role/status intact', () => {
        expect(chip().getAttribute('role')).toBe('button');
        expect(chip().getAttribute('aria-label')).toBe('Play music');
        expect(chip().title).toBe('Play music');
        m._setStatus('PLAYING');
        expect(chip().getAttribute('aria-label')).toBe('Pause music');
        expect(chip().title).toBe('Pause music');
        expect(chip().getAttribute('data-music-status')).toBe('PLAYING');
        m._setStatus('PAUSED');
        expect(chip().getAttribute('aria-label')).toBe('Play music');
    });

    it('flashes one centred glyph that auto-dismisses and restarts on rapid toggles', () => {
        vi.useFakeTimers();
        expect(glyph()).not.toBeNull();
        expect(glyph().getAttribute('aria-hidden')).toBe('true');
        click();
        expect(glyph().classList.contains('focusPlayGlyph--show')).toBe(true);
        expect(glyph().getAttribute('data-glyph')).toBe('play');
        vi.advanceTimersByTime(500);
        click();
        expect(glyph().getAttribute('data-glyph')).toBe('pause');
        vi.advanceTimersByTime(500);
        // Restarted: still showing 1000ms after the first toggle.
        expect(glyph().classList.contains('focusPlayGlyph--show')).toBe(true);
        expect(document.querySelectorAll('.focusPlayGlyph').length).toBe(1);
        vi.advanceTimersByTime(250);
        expect(glyph().classList.contains('focusPlayGlyph--show')).toBe(false);
    });

    it('hover-opened popover stays open across a click; Enter still toggles it; Space toggles playback', () => {
        const wrap = chip().parentElement;
        wrap.dispatchEvent(new MouseEvent('mouseenter'));
        click();
        expect(isOpen()).toBe(true);
        expect(chip().getAttribute('aria-expanded')).toBe('true');
        wrap.dispatchEvent(new MouseEvent('mouseleave'));
        expect(isOpen()).toBe(false);

        chip().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(isOpen()).toBe(true);
        expect(m.play).toHaveBeenCalledTimes(1);
        chip().dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        expect(m.getState().status).toBe('PAUSED');
    });

    it('long-press opens the popover without toggling playback', () => {
        vi.useFakeTimers();
        chip().dispatchEvent(new Event('touchstart'));
        vi.advanceTimersByTime(520);
        chip().dispatchEvent(new Event('touchend'));
        chip().dispatchEvent(new MouseEvent('click', { detail: 1 }));
        expect(isOpen()).toBe(true);
        expect(m.play).not.toHaveBeenCalled();
        expect(m.pause).not.toHaveBeenCalled();
    });

    it('click does not bubble to the focus page or exit focus mode', () => {
        const onDoc = vi.fn();
        document.body.addEventListener('click', onDoc);
        click();
        document.body.removeEventListener('click', onDoc);
        expect(onDoc).not.toHaveBeenCalled();
        expect(f.isActive()).toBe(true);
    });

    it('styles the glyph as an 84px non-interactive circle with a transition fade', () => {
        const rule = css.match(/\.focusPlayGlyph \{[^}]*\}/);
        expect(rule).not.toBeNull();
        expect(rule[0]).toMatch(/width:\s*84px/);
        expect(rule[0]).toMatch(/height:\s*84px/);
        expect(rule[0]).toMatch(/border-radius:\s*50%/);
        expect(rule[0]).toMatch(/background:\s*rgba\(255,255,255,0\.06\)/);
        expect(rule[0]).toMatch(/border:\s*0\.5px solid rgba\(255,255,255,0\.14\)/);
        expect(rule[0]).toMatch(/color:\s*var\(--text-primary\)/);
        expect(rule[0]).toMatch(/pointer-events:\s*none/);
        expect(rule[0]).toMatch(/transition:[^;]*opacity/);
        expect(css).toMatch(/\.focusPlayGlyph--show \{[^}]*opacity:\s*0\.85/);
    });
});
