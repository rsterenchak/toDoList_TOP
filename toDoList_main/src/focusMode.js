// Desktop-only focus mode. A calm, endlessly-drifting space scene that hides
// the entire dashboard for distraction-free studying. There is deliberately
// NO timer or countdown shown anywhere — the goal is to study without
// watching the clock. Music and the Pomodoro session stay reachable through a
// minimal corner cluster (a now-playing chip plus a single icon-only session
// control with a pomodoro mode selector beneath it) that drives the existing
// music.js / pomodoro.js singletons, so the session keeps running silently.
//
// A third corner control swaps the star scene for the currently-playing
// YouTube video, full-bleed. The swap NEVER touches the DOM the player lives
// in: moving an iframe always reloads its document, which severs its
// handshake with the YT.Player instance and stops playback. Instead a
// `focusVideoOn` class on <body> promotes the iframe's existing ancestors —
// the music popover and its player wrap — to full-bleed with CSS, so the node
// itself never moves and the stream plays straight through the swap.
//
// The controller mirrors the shape of companion.js / pomodoro.js / music.js:
// `createFocusMode(doc)` returns { activate, deactivate, isActive, destroy }.
// The overlay DOM is built lazily on first activate and kept in the DOM
// (hidden via a class) so re-entry is instant; while deactivated the
// animation-driving class is removed and the controller unsubscribes from the
// singletons, so no paint or work is incurred while off — mirroring
// companion's "no work when disabled" approach. Focus mode is session-only
// and never persisted, so a page refresh always returns to the dashboard.
//
// Hovering, keyboard-focusing (Enter) or long-pressing the now-playing chip
// reveals a slim vertical volume popover above it — percent readout, a
// draggable track and a mute toggle — driving the music singleton's
// setVolume / toggleMute and re-syncing from every music update. Clicking or
// tapping the chip (or Space on it) toggles music play/pause instead, and
// each toggle briefly fades a play / pause glyph in and out at the centre of
// the page — one reused element, so rapid toggles restart the fade.
//
// A fourth corner control opens a small popover for picking the scene
// itself — the star field, a "matrix" rain of falling glyphs, or a night
// rainforest (jungle silhouettes, rain sheets, a rippling pool), or an aurora
// (drifting light bands over layered ridges). All variants
// live in `.focusScene` and a modifier class shows one; the choice is the one
// piece of focus mode that IS persisted (`todoapp_focusTheme`, via prefs.js),
// read when the overlay is built.

import { ensureMusic, getMusicPlayerFrame } from './music.js';
import { ensurePomodoro, DEFAULT_DURATIONS, MODE_LABEL, POMODORO_MODES } from './pomodoro.js';
import { getFocusTheme, setFocusTheme, FOCUS_THEMES } from './prefs.js';

const FOCUS_THEME_LABELS = { stars: 'Stars', matrix: 'Matrix', rainforest: 'Rainforest', aurora: 'Aurora' };

// Matrix rain: a fixed set of glyph columns, each falling at its own pace.
// Half-width katakana plus digits and a few latin capitals, the classic mix.
const MATRIX_COLUMNS = 28;
const MATRIX_GLYPHS_PER_COLUMN = 26;
const MATRIX_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ZXEKTRAQ';

// Rainforest scene: a night sky with its own upper-half star field, two
// layered jungle ridges (trunks + canopy) as inline SVG silhouettes, a dark
// pool with ripple rings at the bottom, an occasional lightning wash, and two
// rotated rain sheets. Everything animates in CSS, gated on the active class.
const RAINFOREST_RIDGE_FAR =
    '<svg class="focusRfRidge focusRfRidge--far" viewBox="0 0 1200 300" preserveAspectRatio="none">' +
    '<path d="M0 300V170c40-30 80-46 120-34 30-40 80-58 130-36 40-34 96-40 140-8 36-30 92-36 130-4 ' +
    '44-38 104-44 150-10 40-28 96-30 136 2 46-34 110-36 150 0 44-26 100-26 144 8 40-24 80-20 100 4V300Z"/>' +
    '<rect x="208" y="40" width="5" height="90"/><ellipse cx="210" cy="40" rx="46" ry="16"/>' +
    '<rect x="736" y="26" width="5" height="90"/><ellipse cx="738" cy="28" rx="54" ry="18"/>' +
    '<rect x="1046" y="50" width="4" height="70"/><ellipse cx="1048" cy="50" rx="40" ry="14"/>' +
    '</svg>';
const RAINFOREST_RIDGE_NEAR =
    '<svg class="focusRfRidge focusRfRidge--near" viewBox="0 0 1200 300" preserveAspectRatio="none">' +
    '<path d="M0 300V200c30-46 90-70 140-44 20-52 96-70 140-26 30-30 80-34 110 0 34-60 118-74 170-24 ' +
    '30-26 76-26 104 6 40-56 128-64 176-14 26-22 70-22 96 8 34-44 104-52 150-12 30-24 74-24 104 6l10 4V300Z"/>' +
    '<rect x="420" y="40" width="9" height="110"/><ellipse cx="424" cy="42" rx="60" ry="20"/>' +
    '<ellipse cx="392" cy="56" rx="34" ry="12"/><ellipse cx="458" cy="58" rx="36" ry="12"/>' +
    '<rect x="1000" y="64" width="8" height="80"/><ellipse cx="1004" cy="64" rx="50" ry="17"/>' +
    '<path d="M60 300c10-40 30-70 56-84-6 30-4 60 8 84Z"/><path d="M560 300c12-46 36-74 64-86-8 34-6 62 6 86Z"/>' +
    '<path d="M1020 300c8-36 26-62 50-74-4 28-2 52 8 74Z"/>' +
    '</svg>';
const RAINFOREST_MARKUP =
    '<div class="focusRainforest">' +
        '<div class="focusRfSky"></div>' +
        '<div class="focusRfStars"></div>' +
        '<div class="focusRfLightning"></div>' +
        RAINFOREST_RIDGE_FAR +
        RAINFOREST_RIDGE_NEAR +
        '<div class="focusRfPool">' +
            '<span class="focusRfRipple focusRfRipple--1"></span>' +
            '<span class="focusRfRipple focusRfRipple--2"></span>' +
            '<span class="focusRfRipple focusRfRipple--3"></span>' +
        '</div>' +
        '<div class="focusRfRain focusRfRain--1"></div>' +
        '<div class="focusRfRain focusRfRain--2"></div>' +
    '</div>';

// Aurora scene: a warm-to-night base gradient, two blurred, skewed light bands
// (teal → sky → violet; the second narrower and drifting out of phase) and a
// back and front ridge cut with clip-path polygons. The shared star field and
// vignette stay visible for depth; the band drift is a CSS translate keyframe
// gated on the active class.
const AURORA_MARKUP =
    '<div class="focusAurora">' +
        '<div class="focusAuroraBase"></div>' +
        '<div class="focusAuroraBand focusAuroraBand--1"></div>' +
        '<div class="focusAuroraBand focusAuroraBand--2"></div>' +
        '<div class="focusAuroraRidge focusAuroraRidge--back"></div>' +
        '<div class="focusAuroraRidge focusAuroraRidge--front"></div>' +
    '</div>';

function randomGlyphs(n) {
    let out = '';
    for (let i = 0; i < n; i++) {
        out += MATRIX_GLYPHS.charAt(Math.floor(Math.random() * MATRIX_GLYPHS.length));
    }
    return out;
}

// Gate: focus mode only runs on desktop-class viewports with a fine pointer —
// the same gate companion.js uses. On mobile the toggle button is hidden and
// this check bars activation, so the module no-ops there.
export function supportsDesktopFocusMode() {
    return !!(window.matchMedia &&
              window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches);
}

// Factory — each call returns an independent controller. The typical app
// creates exactly one (via ensureFocusMode). Returns
// { activate, deactivate, isActive, destroy }.
export function createFocusMode(doc) {
    doc = doc || document;

    let overlay      = null;   // root overlay element, kept in the DOM once built
    let chipEl       = null;   // now-playing chip (data-music-status drives the eq)
    let stationLabel = null;   // station name text inside the chip
    let sessionBtn   = null;   // single icon-only pomodoro control
    let pomoNameEl   = null;   // mode selector: active mode name
    let pomoDurEl    = null;   // mode selector: active mode duration ("25 min")
    let pomoDots     = [];     // mode selector: one dot per mode, active one lit
    let videoBtn     = null;   // icon-only star-scene ⇄ video toggle
    let videoOn      = false;  // session-only; never persisted, resets on exit
    let active       = false;
    let unsubMusic   = null;
    let unsubPom     = null;
    let brightenId   = null;   // timer clearing the completion brighten pulse
    let lastPomStatus = null;  // tracks transitions for the completion cue
    let onKeydown    = null;
    let sceneEl      = null;   // .focusScene — carries the theme modifier
    let themeWrap    = null;   // anchor for the theme button + popover
    let themeBtn     = null;   // round icon-only theme picker button
    let themePopover = null;   // scene picker cards
    let themeOpen    = false;
    let onThemeOutside = null; // outside-click closer, bound only while open
    let theme        = 'stars';
    let volumeWrap   = null;   // anchor for the chip + volume popover
    let volumePop    = null;   // vertical volume popover above the chip
    let volumeTrack  = null;   // role=slider hit area around the 4px rail
    let volumeFill   = null;   // accent fill, height = volume
    let volumeThumb  = null;   // 14px thumb riding the fill's top
    let volumePct    = null;   // percent readout
    let muteBtn      = null;   // circular mute toggle
    let volumeOpen   = false;
    let onVolumeOutside = null; // outside-press closer, bound only while open
    let longPressId  = null;   // ~500ms touch long-press timer on the chip
    let suppressChipClick = false; // swallow the click ending a long-press
    let lastTouchAt  = 0;      // ignore emulated mouse hover right after touch
    let dragEnd      = null;   // tears down an in-flight track drag
    let playGlyph    = null;   // centred transient play / pause glyph
    let glyphTimerId = null;   // hides the glyph again after its flash
    let pomoWrap     = null;   // pomodoro pill — details collapse behind hover
    let pomoOpen     = false;  // tap-expanded state (touch fallback for :hover)
    let onPomoOutside = null;  // outside-press collapser, bound only while open
    let pomoTouchAt  = 0;      // last touch on the pill, to tell taps from clicks

    function build() {
        if (overlay) return;
        overlay = doc.createElement('div');
        overlay.id = 'focusModeOverlay';
        overlay.className = 'focusModeOverlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.setAttribute('aria-label', 'Focus mode');

        // ── Scene layers (pure CSS animation, no canvas) ──
        // Two layered star fields drift at different speeds, 2–3 soft nebula
        // glows drift/pulse, a few brighter twinkling stars, an occasional
        // slow shooting star, and a vignette. Decorative, so aria-hidden.
        const scene = doc.createElement('div');
        scene.className = 'focusScene';
        scene.setAttribute('aria-hidden', 'true');
        scene.innerHTML =
            '<div class="focusStars focusStars--far"></div>' +
            '<div class="focusStars focusStars--near"></div>' +
            '<div class="focusNebula focusNebula--1"></div>' +
            '<div class="focusNebula focusNebula--2"></div>' +
            '<div class="focusNebula focusNebula--3"></div>' +
            '<div class="focusTwinkle focusTwinkle--1"></div>' +
            '<div class="focusTwinkle focusTwinkle--2"></div>' +
            '<div class="focusTwinkle focusTwinkle--3"></div>' +
            '<div class="focusShootingStar"></div>' +
            '<div class="focusMatrix"></div>' +
            RAINFOREST_MARKUP +
            AURORA_MARKUP +
            '<div class="focusVignette"></div>';
        // Matrix columns: per-column position, speed and delay are computed
        // here (custom properties), the fall itself is a CSS keyframe gated
        // on the active class like the star drift.
        const matrix = scene.querySelector('.focusMatrix');
        for (let i = 0; i < MATRIX_COLUMNS; i++) {
            const col = doc.createElement('span');
            col.className = 'focusMatrixCol';
            col.textContent = randomGlyphs(MATRIX_GLYPHS_PER_COLUMN);
            col.style.setProperty('--matrix-x', ((i + 0.5) / MATRIX_COLUMNS * 100).toFixed(2) + '%');
            col.style.setProperty('--matrix-dur', (7 + Math.random() * 9).toFixed(2) + 's');
            col.style.setProperty('--matrix-delay', (-Math.random() * 16).toFixed(2) + 's');
            matrix.appendChild(col);
        }
        sceneEl = scene;
        overlay.appendChild(scene);

        // ── Corner controls — no countdown ──
        const corner = doc.createElement('div');
        corner.className = 'focusCorner';

        // Now-playing chip: station name + animated equalizer reflecting the
        // music singleton's state. Hover / focus / tap / long-press reveals
        // the volume popover anchored above it (the full music controls still
        // live in the dashboard popover).
        chipEl = doc.createElement('div');
        chipEl.className = 'focusNowPlaying';
        chipEl.setAttribute('data-music-status', 'IDLE');
        chipEl.setAttribute('tabindex', '0');
        chipEl.setAttribute('role', 'button');
        chipEl.setAttribute('aria-haspopup', 'true');
        chipEl.setAttribute('aria-expanded', 'false');
        chipEl.setAttribute('aria-label', 'Play music');
        chipEl.title = 'Play music';
        chipEl.innerHTML =
            '<span class="focusEqBars" aria-hidden="true">' +
            '<span></span><span></span><span></span><span></span><span></span>' +
            '</span>' +
            '<span class="focusStationLabel"></span>';
        stationLabel = chipEl.querySelector('.focusStationLabel');
        buildVolumePopover();

        // Single icon-only session control: start when idle, pause/resume when
        // running — never displaying MM:SS. Drives pomodoro.toggle().
        sessionBtn = doc.createElement('button');
        sessionBtn.type = 'button';
        sessionBtn.className = 'focusSessionBtn';
        sessionBtn.setAttribute('data-pomo-status', 'IDLE');
        sessionBtn.setAttribute('aria-label', 'Start focus session');
        sessionBtn.title = 'Start focus session';
        sessionBtn.innerHTML =
            '<svg class="focusSessionPlay" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
            '<path fill="currentColor" d="M8 5v14l11-7z"/></svg>' +
            '<svg class="focusSessionPause" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
            '<path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
        sessionBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            // Touch has no hover: the first tap on the collapsed pill opens
            // its details instead of starting the session.
            if (!pomoOpen && Date.now() - pomoTouchAt < 800) {
                openPomoDetails();
                return;
            }
            const pom = ensurePomodoro();
            if (pom) pom.toggle();
            closePomoDetails();
        });

        // Mode selector: one horizontal pill with the session button flush at
        // its left edge, then ◀ / ▶ stepping Focus → Short break → Long break
        // (wrapping) via pomodoro.setMode around a two-line label naming the
        // armed mode and its length in whole minutes (never a ticking MM:SS),
        // then three dots marking which is armed. Everything but the session
        // button sits in .focusPomoDetails, collapsed until the pill is
        // hovered, keyboard-focused, or tap-opened (.focusPomoWrap--open).
        pomoWrap = doc.createElement('div');
        pomoWrap.className = 'focusPomoWrap';
        pomoWrap.addEventListener('touchstart', function() {
            pomoTouchAt = Date.now();
        }, { passive: true });
        // Taps on the pill outside its buttons toggle the details.
        pomoWrap.addEventListener('click', function(e) {
            e.stopPropagation();
            if (pomoOpen) closePomoDetails();
            else openPomoDetails();
        });
        const stepper = doc.createElement('div');
        stepper.className = 'focusPomoStepper';
        const prevBtn = makeStepBtn('prev', 'Previous pomodoro mode', 'M15 6l-6 6 6 6');
        const nextBtn = makeStepBtn('next', 'Next pomodoro mode', 'M9 6l6 6-6 6');
        const label = doc.createElement('div');
        label.className = 'focusPomoLabel';
        label.setAttribute('aria-live', 'polite');
        pomoNameEl = doc.createElement('span');
        pomoNameEl.className = 'focusPomoName';
        pomoDurEl = doc.createElement('span');
        pomoDurEl.className = 'focusPomoDuration';
        label.appendChild(pomoNameEl);
        label.appendChild(pomoDurEl);
        stepper.appendChild(prevBtn);
        stepper.appendChild(label);
        stepper.appendChild(nextBtn);
        const dots = doc.createElement('div');
        dots.className = 'focusPomoDots';
        dots.setAttribute('aria-hidden', 'true');
        pomoDots = POMODORO_MODES.map(function(mode) {
            const dot = doc.createElement('span');
            dot.className = 'focusPomoDot';
            dot.setAttribute('data-pomo-mode', mode);
            dots.appendChild(dot);
            return dot;
        });
        const details = doc.createElement('div');
        details.className = 'focusPomoDetails';
        details.appendChild(stepper);
        details.appendChild(dots);
        pomoWrap.appendChild(sessionBtn);
        pomoWrap.appendChild(details);

        // Thin vertical divider between the pomodoro pill and the round
        // video / scene buttons.
        const pomoSep = doc.createElement('span');
        pomoSep.className = 'focusPomoSep';
        pomoSep.setAttribute('aria-hidden', 'true');

        // Scene swap: star field ⇄ the live video, full-bleed. Disabled until
        // a player iframe exists (music never started this session), in which
        // case clicking is a no-op.
        videoBtn = doc.createElement('button');
        videoBtn.type = 'button';
        videoBtn.className = 'focusVideoBtn';
        videoBtn.setAttribute('aria-pressed', 'false');
        videoBtn.innerHTML =
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
            'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<rect x="2.5" y="4.5" width="19" height="13" rx="2"/>' +
            '<path d="M8 20.5h8"/></svg>';
        videoBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleVideoScene();
        });

        corner.appendChild(volumeWrap);
        corner.appendChild(pomoWrap);
        corner.appendChild(pomoSep);
        // Scene picker: a round button opening a card popover anchored
        // above it. Closes on picking a card, clicking outside, or Escape.
        themeWrap = doc.createElement('div');
        themeWrap.className = 'focusThemeWrap';
        themeBtn = doc.createElement('button');
        themeBtn.type = 'button';
        themeBtn.className = 'focusThemeBtn';
        themeBtn.setAttribute('aria-haspopup', 'true');
        themeBtn.setAttribute('aria-expanded', 'false');
        themeBtn.setAttribute('aria-label', 'Choose focus scene');
        themeBtn.title = 'Choose focus scene';
        themeBtn.innerHTML =
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
            'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/>' +
            '<rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/>' +
            '<rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/>' +
            '<rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>';
        themeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (themeOpen) closeThemePicker();
            else openThemePicker();
        });

        themePopover = doc.createElement('div');
        themePopover.className = 'focusThemePopover';
        themePopover.setAttribute('role', 'menu');
        themePopover.setAttribute('aria-label', 'Focus scene');
        FOCUS_THEMES.forEach(function(name) {
            const card = doc.createElement('button');
            card.type = 'button';
            card.className = 'focusThemeCard';
            card.setAttribute('role', 'menuitemradio');
            card.setAttribute('data-focus-theme', name);
            card.innerHTML =
                '<span class="focusThemeThumb focusThemeThumb--' + name + '" aria-hidden="true"></span>' +
                '<span class="focusThemeCardLabel">' + FOCUS_THEME_LABELS[name] + '</span>';
            card.addEventListener('click', function(e) {
                e.stopPropagation();
                setTheme(name);
                closeThemePicker();
            });
            themePopover.appendChild(card);
        });
        themeWrap.appendChild(themeBtn);
        themeWrap.appendChild(themePopover);

        corner.appendChild(videoBtn);
        corner.appendChild(themeWrap);
        overlay.appendChild(corner);

        // Transient play / pause glyph flashed at the centre of the page on
        // each chip toggle. Decorative (the chip's label announces the
        // action) and never intercepts pointer events.
        playGlyph = doc.createElement('div');
        playGlyph.className = 'focusPlayGlyph';
        playGlyph.setAttribute('aria-hidden', 'true');
        playGlyph.setAttribute('data-glyph', 'play');
        playGlyph.innerHTML =
            '<svg class="focusPlayGlyphPlay" viewBox="0 0 24 24" width="30" height="30">' +
            '<path fill="currentColor" d="M8 5v14l11-7z"/></svg>' +
            '<svg class="focusPlayGlyphPause" viewBox="0 0 24 24" width="30" height="30">' +
            '<path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
        overlay.appendChild(playGlyph);

        applyFocusTheme(getFocusTheme());

        // ── Exit affordance ──
        // A dim "exit · esc" pill, top-right. Clicking the scene itself does
        // NOT exit (so a stray click while studying doesn't drop you out) —
        // only the pill and Esc close focus mode.
        const exitPill = doc.createElement('button');
        exitPill.type = 'button';
        exitPill.className = 'focusExitPill';
        exitPill.setAttribute('aria-label', 'Exit focus mode');
        exitPill.innerHTML = 'exit<span class="focusExitDot">·</span>esc';
        exitPill.addEventListener('click', function(e) {
            e.stopPropagation();
            deactivate();
        });
        overlay.appendChild(exitPill);

        doc.body.appendChild(overlay);
    }

    // ── Volume popover — hover-revealed above the now-playing chip ──
    // Built once with the chip; wraps it so hovering either keeps it open.
    function buildVolumePopover() {
        volumeWrap = doc.createElement('div');
        volumeWrap.className = 'focusVolumeWrap';

        volumePop = doc.createElement('div');
        volumePop.className = 'focusVolumePopover';
        volumePop.setAttribute('role', 'group');
        volumePop.setAttribute('aria-label', 'Music volume');

        volumePct = doc.createElement('span');
        volumePct.className = 'focusVolumePct';

        volumeTrack = doc.createElement('div');
        volumeTrack.className = 'focusVolumeTrack';
        volumeTrack.setAttribute('role', 'slider');
        volumeTrack.setAttribute('tabindex', '0');
        volumeTrack.setAttribute('aria-label', 'Volume');
        volumeTrack.setAttribute('aria-orientation', 'vertical');
        volumeTrack.setAttribute('aria-valuemin', '0');
        volumeTrack.setAttribute('aria-valuemax', '100');
        const rail = doc.createElement('span');
        rail.className = 'focusVolumeRail';
        volumeFill = doc.createElement('span');
        volumeFill.className = 'focusVolumeFill';
        volumeThumb = doc.createElement('span');
        volumeThumb.className = 'focusVolumeThumb';
        rail.appendChild(volumeFill);
        rail.appendChild(volumeThumb);
        volumeTrack.appendChild(rail);

        muteBtn = doc.createElement('button');
        muteBtn.type = 'button';
        muteBtn.className = 'focusMuteBtn';
        muteBtn.setAttribute('aria-pressed', 'false');
        muteBtn.setAttribute('aria-label', 'Mute music');
        muteBtn.title = 'Mute music';
        muteBtn.innerHTML =
            '<svg class="focusMuteIconOn" viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
            'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>' +
            '<path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>' +
            '<svg class="focusMuteIconOff" viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
            'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>' +
            '<path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
        muteBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            const music = ensureMusic();
            if (music && typeof music.toggleMute === 'function') music.toggleMute();
        });

        volumePop.appendChild(volumePct);
        volumePop.appendChild(volumeTrack);
        volumePop.appendChild(muteBtn);
        volumeWrap.appendChild(chipEl);
        volumeWrap.appendChild(volumePop);

        // Track: press / drag (mouse + touch) and keyboard set the volume.
        volumeTrack.addEventListener('mousedown', function(e) {
            if (e.button !== undefined && e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            startDrag(e.clientY, 'mousemove', 'mouseup', function(ev) { return ev.clientY; });
        });
        volumeTrack.addEventListener('touchstart', function(e) {
            const t = e.touches && e.touches[0];
            if (!t) return;
            e.preventDefault();
            e.stopPropagation();
            lastTouchAt = Date.now();
            startDrag(t.clientY, 'touchmove', 'touchend', function(ev) {
                const tt = ev.touches && ev.touches[0];
                return tt ? tt.clientY : null;
            });
        }, { passive: false });
        volumeTrack.addEventListener('click', function(e) { e.stopPropagation(); });
        volumeTrack.addEventListener('keydown', function(e) {
            const music = ensureMusic();
            if (!music) return;
            const cur = Math.round(((music.getState().volume) || 0) * 100);
            let next = null;
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = cur + 5;
            else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = cur - 5;
            else if (e.key === 'PageUp') next = cur + 10;
            else if (e.key === 'PageDown') next = cur - 10;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = 100;
            if (next === null) return;
            e.preventDefault();
            music.setVolume(Math.max(0, Math.min(100, next)) / 100);
        });

        // Reveal: mouse hover and keyboard focus open; leaving closes.
        volumeWrap.addEventListener('mouseenter', function() {
            if (Date.now() - lastTouchAt < 800) return;
            openVolume();
        });
        volumeWrap.addEventListener('mouseleave', function() {
            if (Date.now() - lastTouchAt < 800) return;
            if (dragEnd) return; // keep open while a drag strays outside
            closeVolume();
        });
        volumeWrap.addEventListener('focusin', function() { openVolume(); });
        volumeWrap.addEventListener('focusout', function(e) {
            if (e.relatedTarget && volumeWrap.contains(e.relatedTarget)) return;
            if (dragEnd) return;
            closeVolume();
        });

        // Touch: tap toggles, ~500ms long-press opens.
        chipEl.addEventListener('touchstart', function() {
            lastTouchAt = Date.now();
            clearLongPress();
            longPressId = setTimeout(function() {
                longPressId = null;
                suppressChipClick = true;
                openVolume();
            }, 500);
        }, { passive: true });
        chipEl.addEventListener('touchmove', clearLongPress, { passive: true });
        chipEl.addEventListener('touchend', function() { lastTouchAt = Date.now(); clearLongPress(); });
        chipEl.addEventListener('touchcancel', clearLongPress);
        // Click / tap toggles play / pause; the popover stays reachable via
        // hover, keyboard focus / Enter and the long-press above.
        chipEl.addEventListener('click', function(e) {
            e.stopPropagation();
            if (suppressChipClick) { suppressChipClick = false; return; }
            toggleMusicPlayback();
        });
        chipEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (volumeOpen) closeVolume();
                else openVolume();
            } else if (e.key === ' ') {
                e.preventDefault();
                toggleMusicPlayback();
            }
        });
    }

    // Plays or pauses through the music singleton, then flashes the glyph
    // for the action just taken. With no player yet, the dashboard popover's
    // player target hosts the lazily-created embed.
    function toggleMusicPlayback() {
        const music = ensureMusic();
        if (!music) return;
        const status = music.getState().status;
        if (status === 'PLAYING' || status === 'BUFFERING') {
            music.pause();
            flashPlayGlyph('pause');
        } else {
            music.play(doc.getElementById('musicPlayerTarget'));
            flashPlayGlyph('play');
        }
    }

    // Fades the centred glyph in, then out after ~700ms. A repeat toggle
    // restarts the fade on the same element instead of stacking new ones.
    function flashPlayGlyph(kind) {
        if (!playGlyph) return;
        playGlyph.setAttribute('data-glyph', kind);
        if (glyphTimerId) clearTimeout(glyphTimerId);
        playGlyph.classList.add('focusPlayGlyph--show');
        glyphTimerId = setTimeout(function() {
            glyphTimerId = null;
            if (playGlyph) playGlyph.classList.remove('focusPlayGlyph--show');
        }, 700);
    }

    function clearPlayGlyph() {
        if (glyphTimerId) { clearTimeout(glyphTimerId); glyphTimerId = null; }
        if (playGlyph) playGlyph.classList.remove('focusPlayGlyph--show');
    }

    function clearLongPress() {
        if (longPressId) { clearTimeout(longPressId); longPressId = null; }
    }

    // Maps a client Y to 0..1 along the track (bottom = 0, top = 1).
    function volumeFromY(clientY) {
        if (!volumeTrack) return null;
        const rect = volumeTrack.getBoundingClientRect();
        if (!rect || !rect.height) return null;
        return Math.max(0, Math.min(1, (rect.bottom - clientY) / rect.height));
    }

    function applyVolumeAtY(clientY) {
        if (clientY === null || clientY === undefined) return;
        const v = volumeFromY(clientY);
        if (v === null) return;
        const music = ensureMusic();
        if (music) music.setVolume(Math.round(v * 100) / 100);
    }

    function startDrag(clientY, moveEvt, endEvt, readY) {
        if (dragEnd) dragEnd();
        applyVolumeAtY(clientY);
        const onMove = function(ev) {
            if (moveEvt === 'touchmove') ev.preventDefault();
            applyVolumeAtY(readY(ev));
        };
        const onEnd = function() { if (dragEnd) dragEnd(); };
        doc.addEventListener(moveEvt, onMove, moveEvt === 'touchmove' ? { passive: false } : false);
        doc.addEventListener(endEvt, onEnd);
        if (endEvt === 'touchend') doc.addEventListener('touchcancel', onEnd);
        if (volumeWrap) volumeWrap.classList.add('focusVolumeWrap--dragging');
        dragEnd = function() {
            doc.removeEventListener(moveEvt, onMove, moveEvt === 'touchmove' ? { passive: false } : false);
            doc.removeEventListener(endEvt, onEnd);
            if (endEvt === 'touchend') doc.removeEventListener('touchcancel', onEnd);
            if (volumeWrap) volumeWrap.classList.remove('focusVolumeWrap--dragging');
            dragEnd = null;
        };
    }

    function openVolume() {
        if (volumeOpen || !volumePop) return;
        volumeOpen = true;
        volumePop.classList.add('focusVolumePopover--open');
        if (chipEl) chipEl.setAttribute('aria-expanded', 'true');
        const music = ensureMusic();
        if (music) syncVolume(music.getState());
        onVolumeOutside = function(e) {
            if (volumeWrap && volumeWrap.contains(e.target)) return;
            closeVolume();
        };
        doc.addEventListener('mousedown', onVolumeOutside, true);
        doc.addEventListener('touchstart', onVolumeOutside, true);
    }

    function closeVolume() {
        if (!volumeOpen) return;
        volumeOpen = false;
        if (dragEnd) dragEnd();
        if (volumePop) volumePop.classList.remove('focusVolumePopover--open');
        if (chipEl) chipEl.setAttribute('aria-expanded', 'false');
        if (onVolumeOutside) {
            doc.removeEventListener('mousedown', onVolumeOutside, true);
            doc.removeEventListener('touchstart', onVolumeOutside, true);
            onVolumeOutside = null;
        }
    }

    // ── Music state → volume popover ──
    function syncVolume(snap) {
        if (!volumePop) return;
        const muted = !!(snap && snap.muted);
        const vol = snap && typeof snap.volume === 'number' ? Math.max(0, Math.min(1, snap.volume)) : 0;
        const pct = Math.round(vol * 100);
        if (volumePct) volumePct.textContent = pct + '%';
        if (volumeFill) volumeFill.style.height = pct + '%';
        if (volumeThumb) volumeThumb.style.bottom = pct + '%';
        if (volumeTrack) {
            volumeTrack.setAttribute('aria-valuenow', String(pct));
            volumeTrack.setAttribute('aria-valuetext', muted ? 'Muted' : pct + '%');
        }
        volumePop.classList.toggle('focusVolumePopover--muted', muted);
        if (muteBtn) {
            muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
            const lbl = muted ? 'Unmute music' : 'Mute music';
            muteBtn.setAttribute('aria-label', lbl);
            muteBtn.title = lbl;
        }
    }

    // ── Scene theme — stars / matrix / rainforest / aurora ──
    function applyFocusTheme(name) {
        theme = FOCUS_THEMES.indexOf(name) !== -1 ? name : 'stars';
        if (sceneEl) {
            FOCUS_THEMES.forEach(function(t) {
                sceneEl.classList.toggle('focusScene--' + t, t === theme);
            });
        }
        if (themePopover) {
            themePopover.querySelectorAll('.focusThemeCard').forEach(function(card) {
                const on = card.getAttribute('data-focus-theme') === theme;
                card.classList.toggle('focusThemeCard--active', on);
                card.setAttribute('aria-checked', on ? 'true' : 'false');
            });
        }
    }

    function setTheme(name) {
        applyFocusTheme(name);
        setFocusTheme(theme);
    }

    function openThemePicker() {
        if (themeOpen || !themePopover) return;
        themeOpen = true;
        themePopover.classList.add('focusThemePopover--open');
        themeBtn.setAttribute('aria-expanded', 'true');
        onThemeOutside = function(e) {
            if (themeWrap && themeWrap.contains(e.target)) return;
            closeThemePicker();
        };
        doc.addEventListener('mousedown', onThemeOutside, true);
    }

    function closeThemePicker() {
        if (!themeOpen) return;
        themeOpen = false;
        if (themePopover) themePopover.classList.remove('focusThemePopover--open');
        if (themeBtn) themeBtn.setAttribute('aria-expanded', 'false');
        if (onThemeOutside) {
            doc.removeEventListener('mousedown', onThemeOutside, true);
            onThemeOutside = null;
        }
    }

    // ── Scene swap — star field ⇄ the live video ──
    // Purely a pair of class toggles: `focusVideoOn` on <body> promotes the
    // popover and its player wrap to full-bleed at z-index 10001, just below
    // the overlay, and `--video` drops the overlay to a translucent scrim and
    // hides the star scene so the video shows through. The iframe stays put,
    // which is the only way the stream survives the swap.
    function currentFrame() {
        return getMusicPlayerFrame(doc);
    }

    function syncVideoBtn() {
        if (!videoBtn) return;
        const available = !!currentFrame();
        videoBtn.disabled = !available;
        videoBtn.setAttribute('aria-pressed', videoOn ? 'true' : 'false');
        const lbl = !available ? 'Video scene unavailable until music starts'
                  : videoOn   ? 'Show the star scene'
                              : 'Show the video full-screen';
        videoBtn.setAttribute('aria-label', lbl);
        videoBtn.title = lbl;
    }

    function showVideoScene() {
        if (videoOn) return;
        // No player yet (music never started this session) — a no-op; the
        // button already renders its disabled state.
        if (!getMusicPlayerFrame(doc)) { syncVideoBtn(); return; }
        videoOn = true;
        doc.body.classList.add('focusVideoOn');
        if (overlay) overlay.classList.add('focusModeOverlay--video');
        syncVideoBtn();
    }

    // Drops the promotion, returning the popover to its normal anchored size.
    // Called by the toggle, by deactivate and by destroy — leaving focus mode
    // must clear it even while the toggle is still on, so re-entry starts on
    // the star scene and the popover renders exactly as it did before.
    function hideVideoScene() {
        if (!videoOn) return;
        videoOn = false;
        doc.body.classList.remove('focusVideoOn');
        if (overlay) overlay.classList.remove('focusModeOverlay--video');
        syncVideoBtn();
    }

    function toggleVideoScene() {
        if (videoOn) hideVideoScene();
        else showVideoScene();
    }

    // ── Music state → chip ──
    function syncMusic(snap) {
        // The player iframe is created lazily by music.js, so every music
        // update is also when the swap control can become available.
        syncVideoBtn();
        syncVolume(snap);
        if (!chipEl) return;
        const status = (snap && snap.status) || 'IDLE';
        chipEl.setAttribute('data-music-status', status);
        const playing = status === 'PLAYING' || status === 'BUFFERING';
        let label = '';
        if (snap) {
            if (snap.nowPlaying && snap.nowPlaying.name) label = snap.nowPlaying.name;
            else if (snap.activeStation && snap.activeStation.name) label = snap.activeStation.name;
        }
        if (stationLabel) stationLabel.textContent = playing ? label : (label || 'Music paused');
        // Name the action a click / tap takes, so screen readers announce it.
        const action = playing ? 'Pause music' : 'Play music';
        chipEl.setAttribute('aria-label', action);
        chipEl.title = action;
    }

    // Small round ◀ / ▶ button for the mode selector.
    function makeStepBtn(dir, label, path) {
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'focusPomoStep focusPomoStep--' + dir;
        btn.setAttribute('aria-label', label);
        btn.title = label;
        btn.innerHTML =
            '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="' + path + '"/></svg>';
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            stepMode(dir === 'next' ? 1 : -1);
        });
        return btn;
    }

    function openPomoDetails() {
        if (pomoOpen || !pomoWrap) return;
        pomoOpen = true;
        pomoWrap.classList.add('focusPomoWrap--open');
        onPomoOutside = function(e) {
            if (pomoWrap && pomoWrap.contains(e.target)) return;
            closePomoDetails();
        };
        doc.addEventListener('mousedown', onPomoOutside, true);
        doc.addEventListener('touchstart', onPomoOutside, true);
    }

    function closePomoDetails() {
        if (!pomoOpen) return;
        pomoOpen = false;
        if (pomoWrap) pomoWrap.classList.remove('focusPomoWrap--open');
        if (onPomoOutside) {
            doc.removeEventListener('mousedown', onPomoOutside, true);
            doc.removeEventListener('touchstart', onPomoOutside, true);
            onPomoOutside = null;
        }
    }

    function stepMode(delta) {
        const pom = ensurePomodoro();
        if (!pom) return;
        const n = POMODORO_MODES.length;
        const i = POMODORO_MODES.indexOf(pom.getState().mode);
        pom.setMode(POMODORO_MODES[((i === -1 ? 0 : i) + delta + n) % n]);
    }

    // ── Pomodoro state → session control ──
    function syncPomodoro(snap) {
        if (!sessionBtn) return;
        const status = (snap && snap.status) || 'IDLE';
        const mode = (snap && POMODORO_MODES.indexOf(snap.mode) !== -1) ? snap.mode : 'focus';
        sessionBtn.setAttribute('data-pomo-status', status);
        sessionBtn.setAttribute('data-pomo-mode', mode);
        const noun = mode === 'focus' ? 'focus session' : MODE_LABEL[mode].toLowerCase();
        const verb = status === 'RUNNING' ? 'Pause'
                   : status === 'PAUSED' ? 'Resume'
                   : 'Start';
        const lbl = verb + ' ' + noun;
        sessionBtn.setAttribute('aria-label', lbl);
        sessionBtn.title = lbl;
        // Mode selector label + dots. Duration comes from the controller
        // (seeded from DEFAULT_DURATIONS), in whole minutes — no countdown.
        const secs = (snap && snap.durations && snap.durations[mode]) || DEFAULT_DURATIONS[mode];
        if (pomoNameEl) pomoNameEl.textContent = MODE_LABEL[mode];
        if (pomoDurEl) pomoDurEl.textContent = Math.round(secs / 60) + ' min';
        pomoDots.forEach(function(dot) {
            dot.classList.toggle('focusPomoDot--active', dot.getAttribute('data-pomo-mode') === mode);
        });
        // Completion cue: a brief ambient brighten/pulse as the session
        // completes (the global alerts — sound, notification, favicon/tab
        // flash — still fire from pomodoro.js). No number is surfaced.
        if (status === 'COMPLETE_UNACKED' && lastPomStatus !== 'COMPLETE_UNACKED') {
            pulseCompletion();
        }
        lastPomStatus = status;
    }

    function pulseCompletion() {
        if (!overlay) return;
        overlay.classList.add('focusModeOverlay--complete');
        if (brightenId) clearTimeout(brightenId);
        brightenId = setTimeout(function() {
            brightenId = null;
            if (overlay) overlay.classList.remove('focusModeOverlay--complete');
        }, 1600);
    }

    function activate() {
        if (active) return;
        if (!supportsDesktopFocusMode()) return;
        build();
        active = true;
        overlay.setAttribute('aria-hidden', 'false');
        overlay.classList.add('focusModeOverlay--active');
        doc.body.classList.add('focusModeOpen');

        // Subscribe and render current state. Subscriptions live only while
        // active so the controller does no work when off.
        const music = ensureMusic();
        if (music) {
            syncMusic(music.getState());
            unsubMusic = music.subscribe(syncMusic);
        } else {
            syncMusic(null);
        }
        const pom = ensurePomodoro();
        if (pom) {
            lastPomStatus = pom.getState().status;
            syncPomodoro(pom.getState());
            unsubPom = pom.subscribe(syncPomodoro);
        } else {
            syncPomodoro(null);
        }

        // Esc exits. Bound on the document so it works regardless of focus.
        // With the scene picker or volume popover open, Esc closes just that first.
        onKeydown = function(e) {
            if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                if (themeOpen) { closeThemePicker(); return; }
                if (volumeOpen) { closeVolume(); return; }
                deactivate();
            }
        };
        doc.addEventListener('keydown', onKeydown);
    }

    function deactivate() {
        if (!active) return;
        active = false;
        // Always drop the video promotion, even mid-swap.
        hideVideoScene();
        closeThemePicker();
        closeVolume();
        closePomoDetails();
        clearLongPress();
        clearPlayGlyph();
        if (overlay) {
            overlay.classList.remove('focusModeOverlay--active');
            overlay.classList.remove('focusModeOverlay--complete');
            overlay.setAttribute('aria-hidden', 'true');
        }
        doc.body.classList.remove('focusModeOpen');
        if (unsubMusic) { unsubMusic(); unsubMusic = null; }
        if (unsubPom)   { unsubPom();   unsubPom = null; }
        if (brightenId) { clearTimeout(brightenId); brightenId = null; }
        if (onKeydown)  { doc.removeEventListener('keydown', onKeydown); onKeydown = null; }
    }

    function isActive() {
        return active;
    }

    function destroy() {
        deactivate();
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
        chipEl = null;
        stationLabel = null;
        sessionBtn = null;
        pomoWrap = null;
        pomoNameEl = null;
        pomoDurEl = null;
        pomoDots = [];
        videoBtn = null;
        sceneEl = null;
        themeWrap = null;
        themeBtn = null;
        themePopover = null;
        volumeWrap = null;
        volumePop = null;
        volumeTrack = null;
        volumeFill = null;
        volumeThumb = null;
        volumePct = null;
        muteBtn = null;
        playGlyph = null;
        lastPomStatus = null;
    }

    return {
        activate:   activate,
        deactivate: deactivate,
        isActive:   isActive,
        destroy:    destroy,
    };
}


// ── MODULE-LEVEL SINGLETON ──
// Centralised access to the desktop focus mode, mirroring ensureCompanion.
// Stays null when the viewport doesn't qualify, so callers must null-guard
// before invoking the returned controller.
let _focusModeSingleton = null;

export function ensureFocusMode() {
    if (_focusModeSingleton) return _focusModeSingleton;
    if (!supportsDesktopFocusMode()) return null;
    _focusModeSingleton = createFocusMode(document);
    return _focusModeSingleton;
}

export function destroyFocusMode() {
    if (_focusModeSingleton) {
        _focusModeSingleton.destroy();
        _focusModeSingleton = null;
    }
}
