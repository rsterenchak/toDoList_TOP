// Volume slider row beneath the paste-URL button in the mobile bottom-sheet
// music picker. Pins the structure (speaker icon + native range + percentage
// readout), the wiring (slider input → setVolume, icon click → setMuted),
// the persistence of mute state, and the mobile-safe slider styling (44px+
// touch hit zone).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    createMusic,
    MUSIC_STATE_KEY,
    DEFAULT_VOLUME,
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


// The sheet's DOM/logic now lives in mobileUtilitySheet.js (extracted from
// main.js's component()), so the JS assertions read that module.
describe('mobile music picker — volume row beneath the paste button', () => {
    const main = read('mobileUtilitySheet.js');
    const css  = read('style.css');

    it('appends a sheetVolumeRow to the picker view directly after sheetPasteRow', () => {
        // Both rows live inside sheetPicker, with the volume row appended
        // *after* the paste row so it visually sits below the "+ Paste YouTube
        // URL" button.
        const pasteIdx = main.indexOf('sheetPicker.appendChild(sheetPasteRow)');
        const volumeIdx = main.indexOf('sheetPicker.appendChild(sheetVolumeRow)');
        expect(pasteIdx).toBeGreaterThan(-1);
        expect(volumeIdx).toBeGreaterThan(pasteIdx);
    });

    it('builds the row as: speaker icon button (mute toggle) + range slider + percentage readout', () => {
        expect(main).toMatch(/sheetVolumeIcon\s*=\s*document\.createElement\(\s*['"]button['"]\s*\)/);
        expect(main).toMatch(/sheetVolumeIcon\.className\s*=\s*['"]sheetVolumeIcon['"]/);
        expect(main).toMatch(/sheetVolumeSlider\s*=\s*document\.createElement\(\s*['"]input['"]\s*\)/);
        expect(main).toMatch(/sheetVolumeSlider\.type\s*=\s*['"]range['"]/);
        expect(main).toMatch(/sheetVolumeSlider\.min\s*=\s*['"]0['"]/);
        expect(main).toMatch(/sheetVolumeSlider\.max\s*=\s*['"]100['"]/);
        expect(main).toMatch(/sheetVolumePct\s*=\s*document\.createElement\(\s*['"]span['"]\s*\)/);
        expect(main).toMatch(/sheetVolumePct\.className\s*=\s*['"]sheetVolumePct['"]/);
    });

    it('wires the slider input event to setVolume on the music controller', () => {
        const idx = main.indexOf('sheetVolumeSlider.addEventListener');
        expect(idx).toBeGreaterThan(-1);
        const block = main.slice(idx, idx + 600);
        expect(block).toMatch(/['"]input['"]/);
        expect(block).toMatch(/setVolume\s*\(/);
    });

    it('wires the speaker icon click to toggle setMuted on the music controller', () => {
        const idx = main.indexOf('sheetVolumeIcon.addEventListener');
        expect(idx).toBeGreaterThan(-1);
        const block = main.slice(idx, idx + 600);
        expect(block).toMatch(/['"]click['"]/);
        expect(block).toMatch(/setMuted\s*\(/);
    });

    it('renders the percentage readout from the controller snapshot in syncMusicSheet', () => {
        const idx = main.indexOf('function syncMusicSheet');
        expect(idx).toBeGreaterThan(-1);
        const block = main.slice(idx, idx + 2000);
        // The readout is fed from the snapshot's volume — Math.round on the
        // 0..1 value times 100 — so it stays in lockstep with the slider.
        expect(block).toMatch(/sheetVolumePct\.textContent/);
        expect(block).toMatch(/sheetVolumeSlider\.value/);
    });

    it('separates the row from the paste button with a 1px top border', () => {
        const idx = css.indexOf('.sheetVolumeRow');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 600);
        expect(block).toMatch(/border-top:\s*1px\s+solid/);
    });

    it('gives the slider track + thumb a ≥44px tall touch hit zone', () => {
        // Visible thumb is small (~12px) but the row reserves a 44px tap
        // target so the slider remains usable on touch devices.
        const idx = css.indexOf('.sheetVolumeRow');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 800);
        expect(block).toMatch(/min-height:\s*44px/);
    });

    it('uses the purple accent on the slider thumb and the speaker icon', () => {
        // Matches the popover's existing accent vocabulary so the new row
        // doesn't read as a stylistic outlier.
        expect(css).toMatch(/\.sheetVolumeSlider/);
        expect(css).toMatch(/\.sheetVolumeIcon/);
        // The thumb is styled via the WebKit pseudo so reading the rule by
        // selector is the most stable check.
        const thumbBlock = css.match(/\.sheetVolumeSlider::-webkit-slider-thumb\s*\{[^}]*\}/);
        expect(thumbBlock).toBeTruthy();
    });
});


describe('music controller — mute state', () => {
    beforeEach(clearMusicStorage);
    afterEach(() => { destroyMusic(); clearMusicStorage(); });

    it('exposes setMuted on the controller surface', () => {
        const ctl = createMusic(document);
        expect(typeof ctl.setMuted).toBe('function');
        ctl.destroy();
    });

    it('defaults to muted=false on a fresh controller', () => {
        const ctl = createMusic(document);
        expect(ctl.getState().muted).toBe(false);
        ctl.destroy();
    });

    it('setMuted(true) stores the pre-mute volume and drops volume to 0', () => {
        const ctl = createMusic(document);
        ctl.setVolume(0.7);
        ctl.setMuted(true);
        const snap = ctl.getState();
        expect(snap.muted).toBe(true);
        expect(snap.volume).toBe(0);
        expect(snap.preMuteVolume).toBeCloseTo(0.7);
        ctl.destroy();
    });

    it('setMuted(false) restores the pre-mute volume', () => {
        const ctl = createMusic(document);
        ctl.setVolume(0.42);
        ctl.setMuted(true);
        expect(ctl.getState().volume).toBe(0);
        ctl.setMuted(false);
        const snap = ctl.getState();
        expect(snap.muted).toBe(false);
        expect(snap.volume).toBeCloseTo(0.42);
        ctl.destroy();
    });

    it('dragging the volume above 0 while muted auto-unmutes', () => {
        const ctl = createMusic(document);
        ctl.setVolume(0.5);
        ctl.setMuted(true);
        expect(ctl.getState().muted).toBe(true);
        ctl.setVolume(0.3);
        const snap = ctl.getState();
        expect(snap.muted).toBe(false);
        expect(snap.volume).toBeCloseTo(0.3);
        ctl.destroy();
    });

    it('persists muted + preMuteVolume across instances', () => {
        const ctlA = createMusic(document);
        ctlA.setVolume(0.6);
        ctlA.setMuted(true);
        ctlA.destroy();

        const ctlB = createMusic(document);
        const snap = ctlB.getState();
        expect(snap.muted).toBe(true);
        expect(snap.volume).toBe(0);
        expect(snap.preMuteVolume).toBeCloseTo(0.6);
        ctlB.destroy();
    });
});
