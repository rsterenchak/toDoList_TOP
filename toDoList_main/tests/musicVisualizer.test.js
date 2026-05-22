// Decorative ambient visualizer for the music popover — module surface,
// mount / unmount lifecycle, style swap, prefs wiring, CSS contracts, and
// the popover wiring in main.js.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    VISUALIZER_STYLES,
    DEFAULT_VISUALIZER_STYLE,
    isValidVisualizerStyle,
    ensureVisualizer,
    destroyVisualizer,
    setVisualizerStyle,
    setVisualizerPlaying,
    isVisualizerMounted,
    getVisualizerRoot,
    getVisualizerStyle,
} from '../src/musicVisualizer.js';

import {
    isMusicVisualizerEnabled,
    setMusicVisualizerEnabled,
    getMusicVisualizerStyle,
    setMusicVisualizerStyle,
    MUSIC_VISUALIZER_ENABLED_KEY,
    MUSIC_VISUALIZER_STYLE_KEY,
} from '../src/prefs.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function clearVizPrefs() {
    localStorage.removeItem(MUSIC_VISUALIZER_ENABLED_KEY);
    localStorage.removeItem(MUSIC_VISUALIZER_STYLE_KEY);
}

function makeWrapper() {
    const wrap = document.createElement('div');
    wrap.className = 'musicPlayerWrap';
    document.body.appendChild(wrap);
    return wrap;
}


describe('musicVisualizer — module surface', () => {
    afterEach(() => { destroyVisualizer(); document.body.innerHTML = ''; clearVizPrefs(); });

    it('exports the documented function set', () => {
        expect(typeof ensureVisualizer).toBe('function');
        expect(typeof destroyVisualizer).toBe('function');
        expect(typeof setVisualizerStyle).toBe('function');
        expect(typeof setVisualizerPlaying).toBe('function');
    });

    it('exports the five visualizer styles by id', () => {
        expect(Array.isArray(VISUALIZER_STYLES)).toBe(true);
        expect(VISUALIZER_STYLES).toHaveLength(5);
        const ids = VISUALIZER_STYLES.map(function(s) { return s.id; });
        expect(ids).toEqual(['starfield', 'blobs', 'rings', 'bars', 'ghost']);
        VISUALIZER_STYLES.forEach(function(s) {
            expect(typeof s.id).toBe('string');
            expect(typeof s.label).toBe('string');
            expect(s.label.length).toBeGreaterThan(0);
        });
    });

    it('defaults the style to starfield', () => {
        expect(DEFAULT_VISUALIZER_STYLE).toBe('starfield');
    });

    it('isValidVisualizerStyle accepts the five style ids and rejects others', () => {
        ['starfield', 'blobs', 'rings', 'bars', 'ghost'].forEach(function(id) {
            expect(isValidVisualizerStyle(id)).toBe(true);
        });
        expect(isValidVisualizerStyle('hopscotch')).toBe(false);
        expect(isValidVisualizerStyle('')).toBe(false);
        expect(isValidVisualizerStyle(null)).toBe(false);
    });
});


describe('musicVisualizer — mount / unmount lifecycle', () => {
    afterEach(() => { destroyVisualizer(); document.body.innerHTML = ''; clearVizPrefs(); });

    it('ensureVisualizer mounts the root inside the supplied wrapper', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'starfield');
        expect(root).not.toBeNull();
        expect(root.parentNode).toBe(wrap);
        expect(isVisualizerMounted()).toBe(true);
        expect(getVisualizerStyle()).toBe('starfield');
    });

    it('ensureVisualizer adds class "musicViz" plus the per-style class', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'blobs');
        expect(root.classList.contains('musicViz')).toBe(true);
        expect(root.classList.contains('musicViz--blobs')).toBe(true);
    });

    it('destroyVisualizer removes the root and clears mounted state', () => {
        const wrap = makeWrapper();
        ensureVisualizer(wrap, 'starfield');
        expect(wrap.children.length).toBe(1);
        destroyVisualizer();
        expect(wrap.children.length).toBe(0);
        expect(isVisualizerMounted()).toBe(false);
        expect(getVisualizerRoot()).toBeNull();
    });

    it('ensureVisualizer with no wrapper element returns null', () => {
        expect(ensureVisualizer(null, 'starfield')).toBeNull();
        expect(isVisualizerMounted()).toBe(false);
    });

    it('falls back to the default style when an unknown id is passed', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'unknown-style-id');
        expect(getVisualizerStyle()).toBe(DEFAULT_VISUALIZER_STYLE);
        expect(root.classList.contains('musicViz--' + DEFAULT_VISUALIZER_STYLE)).toBe(true);
    });

    it('re-ensuring with the same wrapper reuses the existing root element', () => {
        const wrap = makeWrapper();
        const first = ensureVisualizer(wrap, 'rings');
        const second = ensureVisualizer(wrap, 'rings');
        expect(second).toBe(first);
        expect(wrap.children.length).toBe(1);
    });

    it('re-ensuring with a different wrapper tears down the old root and mounts in the new wrapper', () => {
        const wrapA = makeWrapper();
        const wrapB = makeWrapper();
        const rootA = ensureVisualizer(wrapA, 'bars');
        expect(wrapA.children.length).toBe(1);
        const rootB = ensureVisualizer(wrapB, 'bars');
        expect(rootB).not.toBe(rootA);
        expect(wrapA.children.length).toBe(0);
        expect(wrapB.children.length).toBe(1);
    });
});


describe('musicVisualizer — per-style markup contract', () => {
    afterEach(() => { destroyVisualizer(); document.body.innerHTML = ''; clearVizPrefs(); });

    it('STARFIELD mounts .musicViz--starfield with star children', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'starfield');
        expect(root.classList.contains('musicViz--starfield')).toBe(true);
        expect(root.querySelectorAll('.musicVizStar').length).toBeGreaterThan(0);
    });

    it('BLOBS mounts .musicViz--blobs with three blob children', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'blobs');
        expect(root.classList.contains('musicViz--blobs')).toBe(true);
        expect(root.querySelectorAll('.musicVizBlob').length).toBe(3);
    });

    it('RINGS mounts .musicViz--rings with three ring children', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'rings');
        expect(root.classList.contains('musicViz--rings')).toBe(true);
        expect(root.querySelectorAll('.musicVizRing').length).toBe(3);
    });

    it('BARS mounts .musicViz--bars with a bar wrapper containing 16 bars', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'bars');
        expect(root.classList.contains('musicViz--bars')).toBe(true);
        expect(root.querySelectorAll('.musicVizBarWrap').length).toBe(1);
        expect(root.querySelectorAll('.musicVizBar').length).toBe(16);
    });

    it('GHOST mounts .musicViz--ghost with ghost + three notes', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'ghost');
        expect(root.classList.contains('musicViz--ghost')).toBe(true);
        expect(root.querySelectorAll('.musicVizGhost').length).toBe(1);
        expect(root.querySelectorAll('.musicVizNote').length).toBe(3);
    });

    it('decorative root carries aria-hidden so screen readers skip it', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'starfield');
        expect(root.getAttribute('aria-hidden')).toBe('true');
    });
});


describe('musicVisualizer — style swap without remount', () => {
    afterEach(() => { destroyVisualizer(); document.body.innerHTML = ''; clearVizPrefs(); });

    it('setVisualizerStyle swaps the per-style class and inner markup but keeps the root element', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'starfield');
        expect(root.classList.contains('musicViz--starfield')).toBe(true);
        expect(root.querySelectorAll('.musicVizStar').length).toBeGreaterThan(0);

        setVisualizerStyle('bars');
        // Same root element — wrapper still has exactly one child.
        expect(wrap.children.length).toBe(1);
        expect(wrap.firstChild).toBe(root);
        // Class swapped, old markup gone, new markup in place.
        expect(root.classList.contains('musicViz--bars')).toBe(true);
        expect(root.classList.contains('musicViz--starfield')).toBe(false);
        expect(root.querySelectorAll('.musicVizStar').length).toBe(0);
        expect(root.querySelectorAll('.musicVizBar').length).toBe(16);
        expect(getVisualizerStyle()).toBe('bars');
    });

    it('setVisualizerStyle is a no-op when not mounted', () => {
        expect(isVisualizerMounted()).toBe(false);
        expect(() => setVisualizerStyle('rings')).not.toThrow();
        expect(isVisualizerMounted()).toBe(false);
    });

    it('setVisualizerStyle preserves the --playing class across a swap', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'starfield');
        setVisualizerPlaying(true);
        expect(root.classList.contains('musicViz--playing')).toBe(true);
        setVisualizerStyle('rings');
        expect(root.classList.contains('musicViz--playing')).toBe(true);
        expect(root.classList.contains('musicViz--rings')).toBe(true);
    });
});


describe('musicVisualizer — playing state toggle', () => {
    afterEach(() => { destroyVisualizer(); document.body.innerHTML = ''; clearVizPrefs(); });

    it('setVisualizerPlaying(true) adds the --playing class; (false) removes it', () => {
        const wrap = makeWrapper();
        const root = ensureVisualizer(wrap, 'starfield');
        expect(root.classList.contains('musicViz--playing')).toBe(false);
        setVisualizerPlaying(true);
        expect(root.classList.contains('musicViz--playing')).toBe(true);
        setVisualizerPlaying(false);
        expect(root.classList.contains('musicViz--playing')).toBe(false);
    });

    it('setVisualizerPlaying is a no-op when not mounted', () => {
        expect(() => setVisualizerPlaying(true)).not.toThrow();
        expect(isVisualizerMounted()).toBe(false);
    });
});


describe('prefs — music visualizer keys', () => {
    beforeEach(clearVizPrefs);
    afterEach(clearVizPrefs);

    it('uses the todoapp_ prefix on both keys', () => {
        expect(MUSIC_VISUALIZER_ENABLED_KEY).toBe('todoapp_musicVisualizerEnabled');
        expect(MUSIC_VISUALIZER_STYLE_KEY).toBe('todoapp_musicVisualizerStyle');
    });

    it('isMusicVisualizerEnabled defaults to false on a fresh install', () => {
        expect(isMusicVisualizerEnabled()).toBe(false);
    });

    it('setMusicVisualizerEnabled persists and reads back true/false', () => {
        setMusicVisualizerEnabled(true);
        expect(isMusicVisualizerEnabled()).toBe(true);
        setMusicVisualizerEnabled(false);
        expect(isMusicVisualizerEnabled()).toBe(false);
    });

    it('getMusicVisualizerStyle defaults to starfield', () => {
        expect(getMusicVisualizerStyle()).toBe('starfield');
    });

    it('setMusicVisualizerStyle persists a valid style id', () => {
        setMusicVisualizerStyle('bars');
        expect(getMusicVisualizerStyle()).toBe('bars');
        setMusicVisualizerStyle('ghost');
        expect(getMusicVisualizerStyle()).toBe('ghost');
    });

    it('setMusicVisualizerStyle falls back to starfield when given an unknown id', () => {
        setMusicVisualizerStyle('nonsense');
        expect(getMusicVisualizerStyle()).toBe('starfield');
    });
});


describe('musicVisualizer — CSS and main.js wiring', () => {
    const main = read('main.js');
    const css  = read('style.css');

    it('main.js imports the visualizer helpers from musicVisualizer.js', () => {
        expect(main).toMatch(/import\s*\{[^}]*ensureVisualizer[^}]*\}\s*from\s*['"]\.\/musicVisualizer\.js['"]/);
        expect(main).toMatch(/destroyVisualizer/);
        expect(main).toMatch(/setVisualizerStyle/);
        expect(main).toMatch(/setVisualizerPlaying/);
        expect(main).toMatch(/VISUALIZER_STYLES/);
    });

    it('main.js imports the visualizer pref accessors', () => {
        expect(main).toMatch(/isMusicVisualizerEnabled/);
        expect(main).toMatch(/setMusicVisualizerEnabled/);
        expect(main).toMatch(/getMusicVisualizerStyle/);
        expect(main).toMatch(/setMusicVisualizerStyle/);
    });

    it('builds a musicVizRow with a checkbox and a native select dropdown', () => {
        expect(main).toMatch(/vizRow\.className\s*=\s*['"]musicVizRow['"]/);
        expect(main).toMatch(/vizCheckbox\s*=\s*document\.createElement\(\s*['"]input['"]\s*\)/);
        expect(main).toMatch(/vizCheckbox\.type\s*=\s*['"]checkbox['"]/);
        expect(main).toMatch(/vizStyleSelect\s*=\s*document\.createElement\(\s*['"]select['"]\s*\)/);
    });

    it('appends the visualizer row to the popover before the controls row', () => {
        const vizIdx = main.indexOf("pop.appendChild(vizRow)");
        const controlsIdx = main.indexOf("pop.appendChild(controls)");
        expect(vizIdx).toBeGreaterThan(-1);
        expect(controlsIdx).toBeGreaterThan(-1);
        expect(vizIdx).toBeLessThan(controlsIdx);
    });

    it('appends the visualizer row to the popover after the picker', () => {
        const pickerIdx = main.indexOf("pop.appendChild(picker)");
        const vizIdx = main.indexOf("pop.appendChild(vizRow)");
        expect(pickerIdx).toBeGreaterThan(-1);
        expect(vizIdx).toBeGreaterThan(pickerIdx);
    });

    it('checkbox change handler persists the pref via setMusicVisualizerEnabled', () => {
        const idx = main.indexOf('vizCheckbox.addEventListener');
        expect(idx).toBeGreaterThan(-1);
        const block = main.slice(idx, idx + 600);
        expect(block).toMatch(/['"]change['"]/);
        expect(block).toMatch(/setMusicVisualizerEnabled/);
    });

    it('dropdown change handler persists the pref and swaps the active style', () => {
        const idx = main.indexOf('vizStyleSelect.addEventListener');
        expect(idx).toBeGreaterThan(-1);
        const block = main.slice(idx, idx + 600);
        expect(block).toMatch(/['"]change['"]/);
        expect(block).toMatch(/setMusicVisualizerStyle/);
        expect(block).toMatch(/setVisualizerStyle/);
    });

    it('select dropdown uses font-size: 16px+ to avoid iOS Safari auto-zoom', () => {
        const idx = css.indexOf('.musicVizStyleSelect');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 600);
        const sizeMatch = /font-size:\s*(\d+)px/.exec(block);
        expect(sizeMatch).toBeTruthy();
        expect(parseInt(sizeMatch[1], 10)).toBeGreaterThanOrEqual(16);
    });

    it('musicPlayerWrap is position: relative so the visualizer overlay can layer above the iframe', () => {
        const idx = css.indexOf('.musicPlayerWrap {');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 400);
        expect(block).toMatch(/position:\s*relative/);
    });

    it('.musicViz overlay is absolutely positioned with a higher z-index than the iframe and height: 100%', () => {
        const idx = css.indexOf('.musicViz {');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 600);
        expect(block).toMatch(/position:\s*absolute/);
        expect(block).toMatch(/z-index:\s*\d+/);
        // Explicit height is required so the BARS style's percentage-height
        // children have something to resolve against.
        expect(block).toMatch(/height:\s*100%/);
    });

    it('.musicViz pauses descendant animations until the --playing class lands', () => {
        // The `pause when not playing, resume when playing` contract is
        // expressed by toggling animation-play-state between the base
        // .musicViz rule and the .musicViz--playing rule. Pin both.
        expect(css).toMatch(/\.musicViz[^{]*\{[^}]*animation-play-state:\s*paused/);
        expect(css).toMatch(/\.musicViz--playing[^{]*\{[^}]*animation-play-state:\s*running/);
    });

    it('prefers-reduced-motion turns off every visualizer animation (static fallback)', () => {
        // The decorative loops are turned off for users who've opted out of
        // motion — the markup stays mounted but every animation resolves to
        // `none`, freezing the elements at their initial frame.
        const reducedMotionBlocks = css.match(/@media\s+\(prefers-reduced-motion:\s*reduce\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g) || [];
        const matching = reducedMotionBlocks.filter(function(block) {
            return /\.musicViz\b/.test(block) && /animation:\s*none/.test(block);
        });
        expect(matching.length).toBeGreaterThan(0);
    });

    it('keyframes exist for each visualizer style', () => {
        expect(css).toMatch(/@keyframes\s+musicVizStarDrift\b/);
        expect(css).toMatch(/@keyframes\s+musicVizBlob/);
        expect(css).toMatch(/@keyframes\s+musicVizRingPulse\b/);
        expect(css).toMatch(/@keyframes\s+musicVizBarPulse\b/);
        expect(css).toMatch(/@keyframes\s+musicVizGhostBob\b/);
        expect(css).toMatch(/@keyframes\s+musicVizNoteFloat\b/);
    });
});
