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

// The focus page's now-playing chip reveals a vertical volume popover that
// drives the music singleton's setVolume / toggleMute and stays in sync.
describe('focus mode — volume popover on the now-playing chip', () => {
    let f;
    beforeEach(() => {
        localStorage.removeItem(MUSIC_STATE_KEY);
        destroyMusic();
        stubMatchMedia();
        f = createFocusMode(document);
        f.activate();
    });
    afterEach(() => {
        vi.useRealTimers();
        f.destroy();
        destroyMusic();
        delete window.matchMedia;
    });

    const pop = () => document.querySelector('.focusVolumePopover');
    const chip = () => document.querySelector('.focusNowPlaying');
    const isOpen = () => pop().classList.contains('focusVolumePopover--open');

    it('music exposes toggleMute that flips the mute state', () => {
        const m = ensureMusic();
        m.setVolume(0.4);
        m.toggleMute();
        expect(m.getState().muted).toBe(true);
        expect(m.getState().volume).toBe(0);
        m.toggleMute();
        expect(m.getState().muted).toBe(false);
        expect(m.getState().volume).toBeCloseTo(0.4);
    });

    it('wraps the chip with a hidden popover holding readout, slider and mute', () => {
        const wrap = chip().parentElement;
        expect(wrap.classList.contains('focusVolumeWrap')).toBe(true);
        expect(wrap.parentElement.classList.contains('focusCorner')).toBe(true);
        expect(pop().parentElement).toBe(wrap);
        expect(pop().querySelector('.focusVolumePct')).not.toBeNull();
        const slider = pop().querySelector('[role="slider"]');
        expect(slider.getAttribute('aria-orientation')).toBe('vertical');
        expect(pop().querySelector('.focusMuteBtn')).not.toBeNull();
        expect(isOpen()).toBe(false);
        // Equalizer / status hook untouched.
        expect(chip().querySelector('.focusEqBars')).not.toBeNull();
        expect(chip().getAttribute('data-music-status')).not.toBeNull();
    });

    it('opens on hover and keyboard focus, closes on leave', () => {
        const wrap = chip().parentElement;
        wrap.dispatchEvent(new MouseEvent('mouseenter'));
        expect(isOpen()).toBe(true);
        expect(chip().getAttribute('aria-expanded')).toBe('true');
        wrap.dispatchEvent(new MouseEvent('mouseleave'));
        expect(isOpen()).toBe(false);
        chip().focus();
        expect(isOpen()).toBe(true);
    });

    it('closes on outside press and on Escape without exiting focus mode', () => {
        chip().parentElement.dispatchEvent(new MouseEvent('mouseenter'));
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(isOpen()).toBe(false);
        chip().parentElement.dispatchEvent(new MouseEvent('mouseenter'));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(isOpen()).toBe(false);
        expect(f.isActive()).toBe(true);
    });

    it('tap toggles and a ~500ms long-press opens on touch', () => {
        vi.useFakeTimers();
        chip().dispatchEvent(new Event('touchstart'));
        chip().dispatchEvent(new Event('touchend'));
        chip().dispatchEvent(new MouseEvent('click', { detail: 1 }));
        expect(isOpen()).toBe(true);
        chip().dispatchEvent(new Event('touchstart'));
        chip().dispatchEvent(new Event('touchend'));
        chip().dispatchEvent(new MouseEvent('click', { detail: 1 }));
        expect(isOpen()).toBe(false);

        chip().dispatchEvent(new Event('touchstart'));
        vi.advanceTimersByTime(520);
        expect(isOpen()).toBe(true);
        chip().dispatchEvent(new Event('touchend'));
        chip().dispatchEvent(new MouseEvent('click', { detail: 1 }));
        expect(isOpen()).toBe(true); // click ending the long-press is swallowed
    });

    it('track press/drag sets volume; mute toggles; UI syncs to outside changes', () => {
        const m = ensureMusic();
        const track = pop().querySelector('.focusVolumeTrack');
        track.getBoundingClientRect = () => ({ top: 100, bottom: 200, height: 100, left: 0, right: 28, width: 28 });
        track.dispatchEvent(new MouseEvent('mousedown', { clientY: 125, button: 0, bubbles: true }));
        expect(m.getState().volume).toBeCloseTo(0.75);
        document.dispatchEvent(new MouseEvent('mousemove', { clientY: 170 }));
        expect(m.getState().volume).toBeCloseTo(0.3);
        document.dispatchEvent(new MouseEvent('mouseup'));
        document.dispatchEvent(new MouseEvent('mousemove', { clientY: 100 }));
        expect(m.getState().volume).toBeCloseTo(0.3);
        expect(pop().querySelector('.focusVolumePct').textContent).toBe('30%');
        expect(pop().querySelector('.focusVolumeFill').style.height).toBe('30%');
        expect(pop().querySelector('.focusVolumeThumb').style.bottom).toBe('30%');
        expect(track.getAttribute('aria-valuenow')).toBe('30');

        pop().querySelector('.focusMuteBtn').click();
        expect(m.getState().muted).toBe(true);
        expect(pop().classList.contains('focusVolumePopover--muted')).toBe(true);
        expect(pop().querySelector('.focusMuteBtn').getAttribute('aria-pressed')).toBe('true');
        expect(pop().querySelector('.focusVolumePct').textContent).toBe('0%');

        m.setVolume(0.6); // changed elsewhere (dashboard slider)
        expect(pop().classList.contains('focusVolumePopover--muted')).toBe(false);
        expect(pop().querySelector('.focusVolumePct').textContent).toBe('60%');

        track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
        expect(m.getState().volume).toBeCloseTo(0.65);
    });

    it('styles the popover with the shared tokens, anchored above the chip', () => {
        const block = css.slice(css.indexOf('.focusVolumePopover {'));
        const rule = block.slice(0, block.indexOf('}'));
        expect(rule).toMatch(/bottom:\s*calc\(100% \+ 8px\)/);
        expect(rule).toMatch(/var\(--bg-elevated\)/);
        expect(rule).toMatch(/var\(--border-mid\)/);
        expect(rule).toMatch(/border-radius:\s*999px/);
        expect(css).toMatch(/\.focusVolumeFill \{[^}]*var\(--accent\)/);
    });
});
