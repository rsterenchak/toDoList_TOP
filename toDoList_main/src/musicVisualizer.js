// Decorative ambient visualizer for the focus-music popover. Mirrors
// music.js's singleton-mount pattern — exactly one visualizer is mounted at
// a time, into a caller-supplied wrapper element that also houses the
// YouTube iframe target. The visualizer sits on top via z-index, so when
// the user disables it the YouTube iframe is revealed again.
//
// NOT audio-reactive. YouTube iframes don't expose their audio stream to
// the Web Audio API across origins, so the styles below are purely
// decorative CSS loops on fixed timings, not analyser-driven. When music
// is playing, animations run; when paused, the controller toggles a
// `musicViz--playing` class off the root so CSS pauses animations in
// place (animation-play-state: paused) rather than rewinding.
//
// Each style mounts a root element with class `musicViz musicViz--<id>`.
// The five styles share the wrapper geometry; per-style markup lives in
// `populateStyle()` and the animation rules live in `style.css`.

export const VISUALIZER_STYLES = [
    { id: 'starfield', label: 'Starfield' },
    { id: 'blobs',     label: 'Blobs' },
    { id: 'rings',     label: 'Rings' },
    { id: 'bars',      label: 'Bars' },
    { id: 'ghost',     label: 'Ghost' },
];

export const DEFAULT_VISUALIZER_STYLE = 'starfield';

export function isValidVisualizerStyle(id) {
    for (let i = 0; i < VISUALIZER_STYLES.length; i++) {
        if (VISUALIZER_STYLES[i].id === id) return true;
    }
    return false;
}

function normalizeStyle(id) {
    return isValidVisualizerStyle(id) ? id : DEFAULT_VISUALIZER_STYLE;
}


// ── singleton mount state ──
let _root = null;
let _wrapper = null;
let _currentStyle = null;


export function ensureVisualizer(wrapperEl, styleId) {
    if (!wrapperEl) return null;
    const style = normalizeStyle(styleId);
    // Re-mount when the wrapper changes (e.g., popover rebuilt) but reuse
    // the existing root when the wrapper is the same so live animations
    // keep their phase across pref toggles.
    if (_root && _wrapper === wrapperEl) {
        if (style !== _currentStyle) setVisualizerStyle(style);
        return _root;
    }
    destroyVisualizer();
    const doc = wrapperEl.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    _wrapper = wrapperEl;
    _currentStyle = style;
    _root = doc.createElement('div');
    _root.className = 'musicViz musicViz--' + style;
    _root.setAttribute('aria-hidden', 'true');
    populateStyle(_root, style);
    wrapperEl.appendChild(_root);
    return _root;
}

export function destroyVisualizer() {
    if (_root && _root.parentNode) {
        try { _root.parentNode.removeChild(_root); } catch (e) { /* defensive */ }
    }
    _root = null;
    _wrapper = null;
    _currentStyle = null;
}

// Swap the active style without re-mounting the wrapper or destroying the
// root element — the popover keeps its place in the DOM and only the inner
// markup + style class change.
export function setVisualizerStyle(styleId) {
    if (!_root) return;
    const next = normalizeStyle(styleId);
    if (next === _currentStyle) return;
    // Strip any previous musicViz--<style> class (preserve --playing).
    const toRemove = [];
    for (let i = 0; i < _root.classList.length; i++) {
        const c = _root.classList[i];
        if (c.indexOf('musicViz--') === 0 && c !== 'musicViz--playing') {
            toRemove.push(c);
        }
    }
    for (let i = 0; i < toRemove.length; i++) _root.classList.remove(toRemove[i]);
    _root.classList.add('musicViz--' + next);
    while (_root.firstChild) _root.removeChild(_root.firstChild);
    populateStyle(_root, next);
    _currentStyle = next;
}

// CSS toggles animation-play-state via the `musicViz--playing` class so
// pausing music freezes the animation in place rather than rewinding.
export function setVisualizerPlaying(playing) {
    if (!_root) return;
    if (playing) _root.classList.add('musicViz--playing');
    else _root.classList.remove('musicViz--playing');
}

// Test / introspection helpers.
export function isVisualizerMounted() { return !!_root; }
export function getVisualizerRoot()   { return _root; }
export function getVisualizerStyle()  { return _currentStyle; }


function populateStyle(root, styleId) {
    const doc = root.ownerDocument || document;
    if (styleId === 'starfield') {
        // 24 stars drift slowly across a deep-purple void. Per-element
        // random top/duration/delay keeps the field from feeling tiled.
        for (let i = 0; i < 24; i++) {
            const star = doc.createElement('span');
            star.className = 'musicVizStar';
            const top      = (Math.random() * 100).toFixed(2) + '%';
            const dur      = (10 + Math.random() * 8).toFixed(2) + 's';
            const delay    = (-Math.random() * 12).toFixed(2) + 's';
            const size     = (1 + Math.random() * 1.5).toFixed(2) + 'px';
            const opacity  = (0.4 + Math.random() * 0.6).toFixed(2);
            star.style.top = top;
            star.style.width = size;
            star.style.height = size;
            star.style.opacity = opacity;
            star.style.animationDuration = dur;
            star.style.animationDelay = delay;
            root.appendChild(star);
        }
        return;
    }
    if (styleId === 'blobs') {
        // Three large blurred blobs on long sine-style paths — lava-lamp.
        for (let i = 0; i < 3; i++) {
            const blob = doc.createElement('span');
            blob.className = 'musicVizBlob musicVizBlob--' + (i + 1);
            root.appendChild(blob);
        }
        return;
    }
    if (styleId === 'rings') {
        // Concentric rings expand outward from the central core every 4s,
        // staggered so a new ring is mid-flight when the prior one fades.
        for (let i = 0; i < 3; i++) {
            const ring = doc.createElement('span');
            ring.className = 'musicVizRing musicVizRing--' + (i + 1);
            root.appendChild(ring);
        }
        return;
    }
    if (styleId === 'bars') {
        // 16 equalizer bars with offset keyframes. The wrapper is needed
        // because flex-end alignment of percentage-height bars collapses
        // to zero against an unsized parent — the wrapper carries the
        // explicit height: 100% so the bars have something to scale into.
        const barWrap = doc.createElement('div');
        barWrap.className = 'musicVizBarWrap';
        for (let i = 0; i < 16; i++) {
            const bar = doc.createElement('span');
            bar.className = 'musicVizBar';
            barWrap.appendChild(bar);
        }
        root.appendChild(barWrap);
        return;
    }
    if (styleId === 'ghost') {
        // Companion ghost mascot bobs gently while music notes drift up
        // and past it — ties back to the app's existing ghost SVG vibe.
        const ghost = doc.createElement('span');
        ghost.className = 'musicVizGhost';
        ghost.setAttribute('aria-hidden', 'true');
        root.appendChild(ghost);
        for (let i = 0; i < 3; i++) {
            const note = doc.createElement('span');
            note.className = 'musicVizNote musicVizNote--' + (i + 1);
            note.textContent = '♪';
            root.appendChild(note);
        }
        return;
    }
}
