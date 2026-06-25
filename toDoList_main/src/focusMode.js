// Desktop-only focus mode. A calm, endlessly-drifting space scene that hides
// the entire dashboard for distraction-free studying. There is deliberately
// NO timer or countdown shown anywhere — the goal is to study without
// watching the clock. Music and the Pomodoro session stay reachable through a
// minimal corner cluster (a now-playing chip plus a single icon-only session
// control) that drives the existing music.js / pomodoro.js singletons, so the
// session keeps running silently.
//
// The controller mirrors the shape of companion.js / pomodoro.js / music.js:
// `createFocusMode(doc)` returns { activate, deactivate, isActive, destroy }.
// The overlay DOM is built lazily on first activate and kept in the DOM
// (hidden via a class) so re-entry is instant; while deactivated the
// animation-driving class is removed and the controller unsubscribes from the
// singletons, so no paint or work is incurred while off — mirroring
// companion's "no work when disabled" approach. Focus mode is session-only
// and never persisted, so a page refresh always returns to the dashboard.

import { ensureMusic } from './music.js';
import { ensurePomodoro } from './pomodoro.js';

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
    let active       = false;
    let unsubMusic   = null;
    let unsubPom     = null;
    let brightenId   = null;   // timer clearing the completion brighten pulse
    let lastPomStatus = null;  // tracks transitions for the completion cue
    let onKeydown    = null;

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
            '<div class="focusVignette"></div>';
        overlay.appendChild(scene);

        // ── Corner controls — no countdown ──
        const corner = doc.createElement('div');
        corner.className = 'focusCorner';

        // Now-playing chip: station name + animated equalizer reflecting the
        // music singleton's state. Display only — tapping the chip does
        // nothing (the full music controls live in the dashboard popover).
        chipEl = doc.createElement('div');
        chipEl.className = 'focusNowPlaying';
        chipEl.setAttribute('data-music-status', 'IDLE');
        chipEl.innerHTML =
            '<span class="focusEqBars" aria-hidden="true">' +
            '<span></span><span></span><span></span><span></span><span></span>' +
            '</span>' +
            '<span class="focusStationLabel"></span>';
        stationLabel = chipEl.querySelector('.focusStationLabel');

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
            const pom = ensurePomodoro();
            if (pom) pom.toggle();
        });

        corner.appendChild(chipEl);
        corner.appendChild(sessionBtn);
        overlay.appendChild(corner);

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

    // ── Music state → chip ──
    function syncMusic(snap) {
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
    }

    // ── Pomodoro state → session control ──
    function syncPomodoro(snap) {
        if (!sessionBtn) return;
        const status = (snap && snap.status) || 'IDLE';
        sessionBtn.setAttribute('data-pomo-status', status);
        const running = status === 'RUNNING';
        const lbl = running ? 'Pause focus session'
                  : status === 'PAUSED' ? 'Resume focus session'
                  : 'Start focus session';
        sessionBtn.setAttribute('aria-label', lbl);
        sessionBtn.title = lbl;
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
        onKeydown = function(e) {
            if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                deactivate();
            }
        };
        doc.addEventListener('keydown', onKeydown);
    }

    function deactivate() {
        if (!active) return;
        active = false;
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
