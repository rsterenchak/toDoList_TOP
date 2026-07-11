// Shared browser-native voice dictation. A single SpeechRecognition session is
// ever live at a time; any surface (the Claude composer, the "Add a task"
// placeholder row) mounts a mic button via mountMicButton() and dictates into a
// target <input>/<textarea>. Review-only surfaces (the Claude composer) leave
// the transcribed text in the field for the user to edit and send manually.
// Auto-commit surfaces (the add-task row) opt in with an onFinal callback: they
// listen continuously and the user taps the overlay (or re-taps the mic) to add
// the todo, which fires onFinal with the transcript; a natural pause no longer
// ends or commits the session. Escape / surface-close cancel and discard.
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
let runawayTimer = null;   // continuous sessions never self-end, so a watchdog
                           // commits/cancels a session left running too long
let activeOnFinal = null;   // per-session opt-in: called with the final transcript
                           // when the user commits (overlay tap / mic re-tap),
                           // never on a cancel (Escape / surface-close)
let lastTranscript = '';    // most-recent trimmed transcript, for the onFinal payload/guard
let suppressFinal = false;  // set on the cancel path so onend skips onFinal

// A continuous session has no natural end, so stop it after this long and commit
// whatever was captured (or cancel if nothing was said).
const RUNAWAY_MS = 60000;

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
//                   when the user commits (tapping the overlay or re-tapping the
//                   mic), and NOT when the user cancels (Escape / surface-close)
//                   or the transcript is empty. Passing it also makes the session
//                   listen continuously — it no longer ends on a speech pause, so
//                   the user taps to add. Surfaces that want the dictated text
//                   committed for them (the add-task row, where iOS can't reopen
//                   the keyboard to press Enter) pass this; review-only surfaces
//                   (the Claude composer) omit it and keep the text in the field
//                   for a manual send.
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
        // Re-tapping the active mic commits (same as tapping the overlay) so a
        // continuous session has a way to finish; a review-only session with no
        // transcript simply ends.
        if (recording && activeButton === btn) commitDictation();
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

    // Auto-commit surfaces (those passing onFinal) listen continuously so a
    // speech pause doesn't end the session — the user taps to add. Review-only
    // surfaces keep the old pause-ends-the-session behavior.
    const continuous = activeOnFinal != null;

    const begin = function() {
        const rec = new Ctor();
        rec.continuous = continuous;
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
                // A denial is terminal — suppress any trailing onend commit.
                suppressFinal = true;
                activeRec = null;
                recording = false;
                clearRunaway();
                setButtonState(btn, 'denied');
                closeOverlay();
            }
        };
        // Recognition ends when we stop/abort it (commit or cancel), on a denial,
        // or if the platform closes a continuous session on its own. finishSession
        // does the teardown and fires onFinal only on the commit path (decoupled
        // from `recording`: it commits iff !suppressFinal && onFinal && a transcript).
        rec.onend = function() {
            activeRec = null;
            finishSession(btn);
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
    // A continuous session has no natural end, so guard against one left running
    // (e.g. the user walks away): commit what was captured, or cancel if silent.
    if (continuous && typeof setTimeout === 'function') {
        runawayTimer = setTimeout(function() {
            runawayTimer = null;
            if (lastTranscript) commitDictation();
            else cancelDictation();
        }, RUNAWAY_MS);
    }
}

function clearRunaway() {
    if (runawayTimer) { clearTimeout(runawayTimer); runawayTimer = null; }
}

// Shared teardown for a session that has ended (via onend). Returns the button
// to idle, closes the overlay, and fires onFinal only on the commit path — never
// when suppressed (cancel), when there's no onFinal (review-only), or when the
// transcript is empty. State is neutralized before the callback so a repeat
// onend or a follow-up cancel can't re-fire it.
function finishSession(btn) {
    clearRunaway();
    recording = false;
    setButtonState(btn || activeButton, 'idle');
    const cb = activeOnFinal;
    const finalText = lastTranscript;
    const shouldCommit = !suppressFinal && typeof cb === 'function' && !!finalText;
    activeOnFinal = null;
    lastTranscript = '';
    suppressFinal = true;
    closeOverlay();
    if (shouldCommit) cb(finalText);
}

// Commit path — the user tapped the overlay or re-tapped the mic to finish.
// Stop WITHOUT suppressing so onend fires onFinal with the transcript (when
// non-empty). Safe to call when nothing is recording (a no-op).
function commitDictation() {
    if (!recording && !activeRec) return;
    recording = false;
    if (activeRec) {
        try { activeRec.stop(); } catch (e) { /* already stopped */ }
        activeRec = null;
    }
    // If the instance never wired onend (or already fired), finalize directly.
    finishSession(activeButton);
}

// Cancel path — Escape, backdrop dismiss, or surface-close cleanup. Suppress the
// onFinal an onend would otherwise fire and abort so the mic releases promptly,
// discarding the transcript.
function cancelDictation() {
    recording = false;
    suppressFinal = true;
    if (activeRec) {
        try {
            if (typeof activeRec.abort === 'function') activeRec.abort();
            else activeRec.stop();
        } catch (e) { /* already stopped */ }
        activeRec = null;
    }
    finishSession(activeButton);
}

// Stop an in-flight dictation without committing, leaving the transcribed text
// in the target field. Used by surface-close cleanup (a dismiss must not leave a
// session dangling) — a cancel, so it never fires onFinal. Safe to call when
// nothing is recording.
export function stopDictation() {
    cancelDictation();
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
    // where a tap adds the todo. Review-only surfaces (the Claude composer) don't
    // auto-commit, so the "add" framing would mislead there and is omitted.
    if (typeof activeOnFinal === 'function') {
        const hint = document.createElement('div');
        hint.className = 'voiceHint';
        hint.textContent = 'Tap to add';
        ov.appendChild(hint);
    }

    // Tapping the backdrop or the pill commits — it adds the todo through the
    // field's Enter path (onFinal). Review-only surfaces have no onFinal, so a
    // tap there simply ends the session with the text left in the field.
    ov.addEventListener('click', function() { commitDictation(); });

    document.body.appendChild(ov);
    overlayEl = ov;

    // Escape cancels — stop and discard, never commit.
    overlayKeyHandler = function(e) {
        if (e.key === 'Escape') { e.preventDefault(); cancelDictation(); }
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
