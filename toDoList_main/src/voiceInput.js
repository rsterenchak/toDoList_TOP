// Shared browser-native voice dictation. A single SpeechRecognition session is
// ever live at a time; any surface (the Claude composer, the "Add a task"
// placeholder row) mounts a mic button via mountMicButton() and dictates into a
// target <input>/<textarea>. Transcribed text lands in that field for the user
// to review, edit, and commit through the field's ordinary path — there is no
// auto-commit and no separate voice routing.
//
// The optional "listening overlay" (a centered pill with an equalizer and the
// live interim transcript over a dimmed, blurred backdrop) also lives here so
// every dictating surface shares one implementation; surfaces opt in per mount.
//
// The iOS/PWA first-grant gotcha — start() sometimes throws or no-ops when the
// mic permission must be re-granted for the session — is handled by retrying
// once with a fresh instance before falling back to the denied state, and by
// starting recognition synchronously inside the tap handler (no setTimeout in
// the activation path) so the user-activation chain that unlocks the mic stays
// intact.

// ── Single-session module state ──
let activeRec = null;      // the live SpeechRecognition instance, or null
let recording = false;     // true while a session is running
let baseValue = '';        // the target's text captured at session start
let activeTarget = null;   // the input/textarea being dictated into
let activeButton = null;   // the mic button that started the session
let overlayEl = null;      // the listening overlay element, while shown
let overlayKeyHandler = null;
let barTimer = null;
let activeOnFinal = null;   // per-session opt-in: called with the final transcript
                           // on a natural speech-pause end (never on a cancel)
let lastTranscript = '';    // most-recent trimmed transcript, for the onFinal payload/guard
let suppressFinal = false;  // set on any manual stop (cancel) so onend skips onFinal

// Simple mic glyph: a rounded capsule (the mic body) over a stand stem. Shared
// by every mic button so the affordance reads the same on all surfaces.
const MIC_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="3" width="6" height="11" rx="3"></rect>' +
    '<path d="M5 11a7 7 0 0 0 14 0"></path>' +
    '<line x1="12" y1="18" x2="12" y2="21"></line></svg>';

const DENIED_TITLE =
    'Microphone permission denied. Enable it in browser settings to use voice input.';

// The platform's SpeechRecognition constructor, or null if unsupported. Read
// live (not cached at module load) so the feature follows whatever `window`
// exposes — Chrome/Android ship `SpeechRecognition`, Safari/iOS the
// `webkit`-prefixed variant.
export function getSpeechRecognitionCtor() {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// True while a dictation session is active on any surface.
export function isDictating() {
    return recording;
}

function resolveTarget(target) {
    return typeof target === 'function' ? target() : target;
}

// Build a mic button, or return null when speech recognition is unavailable (so
// the caller simply omits the affordance). `target` is the field to dictate
// into — an element, or a function resolving to one lazily at tap time (used by
// the composer, whose input can be re-mounted). Options:
//   id            — element id to assign
//   className     — button class (default 'micButton')
//   ariaLabel     — idle aria-label (default 'Voice input')
//   overlay       — show the listening overlay while dictating
//   focusTarget   — focus the target field when dictation starts (so the
//                   transcript is visible on surfaces that hide the field until
//                   focus, e.g. the mobile placeholder row)
//   stopPropagation — stop the click from bubbling (so a row-level click
//                   handler doesn't also fire)
//   onFinal(text) — auto-commit hook: called once with the final transcript
//                   when a session ends on its own (a natural speech pause),
//                   and NOT when the user cancels (backdrop tap / Escape / a
//                   fresh session) or the transcript is empty. Surfaces that
//                   want the dictated text committed for the user (the add-task
//                   row, where iOS can't reopen the keyboard to press Enter)
//                   pass this; review-only surfaces (the Claude composer) omit
//                   it and keep the text in the field for a manual send.
export function mountMicButton(target, opts = {}) {
    if (!getSpeechRecognitionCtor()) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = opts.className || 'micButton';
    if (opts.id) btn.id = opts.id;
    btn.setAttribute('aria-label', opts.ariaLabel || 'Voice input');
    btn.innerHTML = MIC_SVG;
    btn.addEventListener('click', function(e) {
        if (opts.stopPropagation) { e.preventDefault(); e.stopPropagation(); }
        if (recording && activeButton === btn) stopDictation();
        else startDictation(target, btn, opts);
    });
    return btn;
}

// Reflect the current dictation state on a mic button. `denied` shows the faded
// state and an explanatory tooltip; `recording` swaps the label; `idle` clears.
function setButtonState(btn, state) {
    if (!btn) return;
    btn.classList.remove('micButton--recording', 'micButton--denied');
    if (state === 'recording') {
        btn.classList.add('micButton--recording');
        btn.setAttribute('aria-label', 'Stop voice input');
        btn.removeAttribute('title');
    } else if (state === 'denied') {
        btn.classList.add('micButton--denied');
        btn.setAttribute('aria-label', 'Voice input');
        btn.setAttribute('title', DENIED_TITLE);
    } else {
        btn.setAttribute('aria-label', 'Voice input');
        btn.removeAttribute('title');
    }
}

// Begin dictating into `target`. Any session already running is torn down first
// so only one recognition instance is ever live. `btn` (optional) is the mic
// button whose visual state tracks the session; `opts` mirrors mountMicButton's.
export function startDictation(target, btn, opts = {}) {
    const Ctor = getSpeechRecognitionCtor();
    const input = resolveTarget(target);
    if (!Ctor || !input) return;

    // Only one live session — tear down any prior one first.
    if (recording) stopDictation();

    activeTarget = input;
    activeButton = btn || null;
    baseValue = input.value || '';
    // Fresh session — clear any suppress flag/transcript left by a prior one so
    // a natural end here can auto-commit even if the last session was cancelled.
    activeOnFinal = typeof opts.onFinal === 'function' ? opts.onFinal : null;
    lastTranscript = '';
    suppressFinal = false;

    if (opts.focusTarget) {
        try { input.focus(); } catch (e) { /* not focusable */ }
    }

    const begin = function() {
        const rec = new Ctor();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
        rec.onresult = function(event) {
            let transcript = '';
            const results = event && event.results ? event.results : [];
            for (let i = 0; i < results.length; i++) {
                const alt = results[i] && results[i][0];
                if (alt && alt.transcript) transcript += alt.transcript;
            }
            const trimmed = transcript.trim();
            lastTranscript = trimmed;
            input.value = baseValue && trimmed
                ? baseValue + ' ' + trimmed
                : baseValue + trimmed;
            updateOverlayInterim(trimmed);
            pulseOverlayBars();
        };
        rec.onerror = function(event) {
            const code = event && event.error;
            if (code === 'not-allowed' || code === 'permission-denied' ||
                code === 'service-not-allowed') {
                activeRec = null;
                recording = false;
                setButtonState(btn, 'denied');
                closeOverlay();
            }
        };
        // Recognition ends on its own after a pause (continuous = false) or when
        // we stop it; either way the button returns to idle unless a denial
        // already moved it to the denied state.
        rec.onend = function() {
            activeRec = null;
            if (recording) {
                // Reaching onend with recording still true means the session
                // ended on its own (a natural speech pause) — a cancel routes
                // through stopDictation, which clears recording and sets
                // suppressFinal first. So this branch is the auto-commit path.
                recording = false;
                setButtonState(btn, 'idle');
                const cb = activeOnFinal;
                const finalText = lastTranscript;
                const commit = !suppressFinal && typeof cb === 'function' && finalText;
                closeOverlay();
                if (commit) cb(finalText);
            }
        };
        return rec;
    };

    try {
        activeRec = begin();
        activeRec.start();
    } catch (e) {
        // Retry once with a fresh instance (iOS PWA re-grant path).
        try {
            activeRec = begin();
            activeRec.start();
        } catch (e2) {
            activeRec = null;
            recording = false;
            setButtonState(btn, 'denied');
            closeOverlay();
            return;
        }
    }
    recording = true;
    setButtonState(btn, 'recording');
    if (opts.overlay) openOverlay();
}

// Stop an in-flight dictation, leaving the transcribed text in the target for
// the user to review/edit/commit. Safe to call when nothing is recording (used
// by surface-close cleanup so a dismiss can't leave a session dangling).
export function stopDictation() {
    recording = false;
    // A manual stop is a cancel: the transcript stays in the field for review
    // but must not auto-commit, so suppress the onFinal an onend would otherwise
    // fire once the underlying recognition instance winds down.
    suppressFinal = true;
    if (activeRec) {
        try { activeRec.stop(); } catch (e) { /* already stopped */ }
        activeRec = null;
    }
    if (activeButton && activeButton.classList.contains('micButton--recording')) {
        setButtonState(activeButton, 'idle');
    }
    closeOverlay();
}

// ── Listening overlay ──
// A centered "listening pill" over a dimmed, blurred backdrop: a mono
// "Listening" label above, a ~7-bar equalizer inside the capsule, and the live
// interim transcript below. Appended to <body> on demand and shared by any
// surface that opts in. Dismisses on a tap anywhere on it or on Escape (both
// stop the session and keep whatever was transcribed).
function openOverlay() {
    if (overlayEl || typeof document === 'undefined') return;
    const ov = document.createElement('div');
    ov.className = 'voiceOverlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Listening');

    const label = document.createElement('div');
    label.className = 'voiceListenLabel';
    label.textContent = 'Listening';

    const pill = document.createElement('div');
    pill.className = 'voiceListenPill';
    for (let i = 0; i < 7; i++) {
        const bar = document.createElement('span');
        bar.className = 'voiceBar';
        pill.appendChild(bar);
    }

    const interim = document.createElement('div');
    interim.className = 'voiceInterim';

    ov.appendChild(label);
    ov.appendChild(pill);
    ov.appendChild(interim);

    // Hint copy — shown only on auto-commit surfaces (those that pass onFinal),
    // where a natural pause adds the todo and a tap/Escape cancels it. Review-only
    // surfaces (the Claude composer) never auto-commit, so the "cancel" framing
    // would mislead there and is omitted.
    if (typeof activeOnFinal === 'function') {
        const hint = document.createElement('div');
        hint.className = 'voiceHint';
        hint.textContent = 'Pause to add · tap to cancel';
        ov.appendChild(hint);
    }

    // Tapping the backdrop or the pill dismisses (cancel — stops + keeps the
    // transcript in the field, but suppresses any auto-commit).
    ov.addEventListener('click', function() { stopDictation(); });

    document.body.appendChild(ov);
    overlayEl = ov;

    overlayKeyHandler = function(e) {
        if (e.key === 'Escape') { e.preventDefault(); stopDictation(); }
    };
    document.addEventListener('keydown', overlayKeyHandler, true);
}

function closeOverlay() {
    if (barTimer) { clearTimeout(barTimer); barTimer = null; }
    if (overlayKeyHandler) {
        document.removeEventListener('keydown', overlayKeyHandler, true);
        overlayKeyHandler = null;
    }
    if (overlayEl && overlayEl.parentNode) {
        overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
}

function updateOverlayInterim(text) {
    if (!overlayEl) return;
    const el = overlayEl.querySelector('.voiceInterim');
    if (el) el.textContent = text || '';
}

// Quicken the equalizer on each incoming result, then relax after a beat, so
// the bars visibly react to speech. CSS freezes the animation under
// prefers-reduced-motion, so this class is inert for opted-out users.
function pulseOverlayBars() {
    if (!overlayEl) return;
    const pill = overlayEl.querySelector('.voiceListenPill');
    if (!pill) return;
    pill.classList.add('voiceListenPill--speaking');
    if (barTimer) clearTimeout(barTimer);
    barTimer = setTimeout(function() {
        if (pill) pill.classList.remove('voiceListenPill--speaking');
        barTimer = null;
    }, 600);
}
