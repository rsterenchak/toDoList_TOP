// Shared browser-native voice dictation. A single SpeechRecognition session is
// ever live at a time; any surface (the Claude composer, the "Add a task"
// placeholder row) mounts a mic button via mountMicButton() and dictates into a
// target <input>/<textarea>. Review-only surfaces (the Claude composer) leave
// the transcribed text in the field for the user to edit and send manually.
// Auto-commit surfaces (the add-task row) opt in with an onFinal callback: the
// user taps the overlay (or re-taps the mic) to add the todo, which fires
// onFinal with the transcript. Escape / surface-close / the overlay's Discard
// control cancel and discard. A session the platform ends on its own (iOS
// Safari closes even continuous sessions on a speech pause, or after a
// no-speech / network error) never fires onFinal by itself: on an auto-commit
// surface with a transcript the overlay stays up "Paused" so the user can
// still tap to add (iOS won't reopen the keyboard for an Enter), and anywhere
// else it closes keeping the text in the field. The runaway watchdog is a
// keep-text cancel.
// Continuous listening — where a speech pause shouldn't end the session — is a
// separate opt-in: passing onFinal implies it, and a review-only surface that
// dictates paragraphs (the quick-capture panel) asks for it directly with
// `continuous: true`.
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
                           // cancels (keeping text) a session left running too long
let activeOnFinal = null;   // per-session opt-in: called with the final transcript
                           // when the user commits (overlay tap / mic re-tap),
                           // never on a cancel (Escape / surface-close)
let lastTranscript = '';    // most-recent trimmed transcript, for the onFinal payload/guard
let suppressFinal = false;  // set on the cancel path so onend skips onFinal
let committing = false;     // set by the commit path so its own onend may commit
let paused = false;         // the platform ended an auto-commit session the user
                           // didn't stop; the overlay waits for a tap (commit) or
                           // Discard / Escape (cancel) with the transcript intact
let sessionId = 0;          // bumped per session start and end; every rec handler
                           // ignores events from an instance that isn't current
                           // (iOS delivers onend/onresult late, sometimes after a
                           // new session has already started)

// A continuous session has no natural end, so stop it after this long — a
// keep-text cancel, never a commit.
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
//   continuous    — listen continuously: a speech pause doesn't end the
//                   session, and the runaway watchdog is armed. Implied by
//                   onFinal; review-only surfaces that dictate more than one
//                   sentence (the quick-capture panel) pass it on its own.
//   onFinal(text) — auto-commit hook: called once with the final transcript
//                   when the user commits (tapping the overlay or re-tapping the
//                   mic), and NOT when the user cancels (Escape / surface-close)
//                   or the transcript is empty. Passing it also turns on
//                   continuous listening, so the user taps to add rather than
//                   pausing to finish. Surfaces that want the dictated text
//                   committed for them (the add-task row, where iOS can't reopen
//                   the keyboard to press Enter) pass this; review-only surfaces
//                   (the Claude composer) omit it and keep the text in the field
//                   for a manual send.
//   onTranscript()  — called after each transcript write into the target, since
//                   a programmatic .value write fires no `input` event (the
//                   add-task row uses it to arm its tappable `+`).
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
        if ((recording || paused) && activeButton === btn) commitDictation();
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
    if (recording || paused) stopDictation();

    activeTarget = input;
    activeButton = btn || null;
    baseValue = input.value || '';
    // Fresh session — clear any suppress flag/transcript left by a prior one so
    // a commit here still fires onFinal even if the last session was cancelled.
    activeOnFinal = typeof opts.onFinal === 'function' ? opts.onFinal : null;
    lastTranscript = '';
    suppressFinal = false;
    committing = false;
    const id = ++sessionId;

    if (opts.focusTarget) {
        try { input.focus(); } catch (e) { /* not focusable */ }
    }

    // Continuous listening: a speech pause doesn't end the session, so the user
    // finishes by tapping. Auto-commit surfaces get it implicitly (they tap to
    // add); review-only surfaces dictating a paragraph ask for it outright.
    // Everything else keeps the pause-ends-the-session behavior.
    const continuous = activeOnFinal != null || opts.continuous === true;

    const begin = function() {
        const rec = new Ctor();
        rec.continuous = continuous;
        rec.interimResults = true;
        rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
        rec.onresult = function(event) {
            if (id !== sessionId) return;
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
            if (typeof opts.onTranscript === 'function') opts.onTranscript();
            updateOverlayInterim(trimmed);
            pulseOverlayBars();
        };
        rec.onerror = function(event) {
            if (id !== sessionId) return;
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
            } else if (canPause()) {
                // no-speech / network / audio-capture on an auto-commit surface:
                // the platform is about to end the session, so hold the
                // transcript in a paused overlay for the user's tap.
                pauseSession(btn);
            } else {
                // Same end anywhere else — a keep-text cancel, never a commit.
                suppressFinal = true;
            }
        };
        // Recognition ends when we stop/abort it (commit or cancel), on a denial,
        // or if the platform closes a continuous session on its own. finishSession
        // does the teardown and fires onFinal only on the commit path; an end the
        // user didn't ask for keeps the transcript in the field but never commits.
        rec.onend = function() {
            if (id !== sessionId) return;
            if (!committing && canPause()) { activeRec = null; pauseSession(btn); return; }
            if (!committing) suppressFinal = true;
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
    // (e.g. the user walks away): end it, leaving any transcript in the field
    // but never firing onFinal — only an explicit tap adds a todo by voice.
    if (continuous && typeof setTimeout === 'function') {
        runawayTimer = setTimeout(function() {
            runawayTimer = null;
            cancelDictation();
        }, RUNAWAY_MS);
    }
}

// A platform-ended session pauses rather than closes only where a tap can still
// add the todo: an auto-commit surface showing the overlay, with something
// transcribed (an empty pause has nothing to strand, so it just closes).
function canPause() {
    return typeof activeOnFinal === 'function' && !!overlayEl && !!lastTranscript;
}

// Park a session the user didn't end: stop the recognizer and retire its
// instance, but leave activeOnFinal / lastTranscript / baseValue intact and the
// overlay up in its paused state, so the next overlay tap or mic re-tap commits
// through commitDictation exactly as it would have mid-session. The runaway
// watchdog keeps running — it still cancels (keeping the text) an overlay left
// paused, with no second timer.
function pauseSession(btn) {
    sessionId++;
    recording = false;
    paused = true;
    const rec = activeRec;
    activeRec = null;
    if (rec) {
        try {
            if (typeof rec.abort === 'function') rec.abort();
            else rec.stop();
        } catch (e) { /* already stopped */ }
    }
    setButtonState(btn || activeButton, 'idle');
    pauseOverlay();
}

function clearRunaway() {
    if (runawayTimer) { clearTimeout(runawayTimer); runawayTimer = null; }
}

// Shared teardown for a session that has ended (via onend). Returns the button
// to idle, closes the overlay, and fires onFinal only on the commit path — never
// when suppressed (cancel), when there's no onFinal (review-only), or when the
// transcript is empty. State is neutralized before the callback so a repeat
// onend or a follow-up cancel can't re-fire it, and the session id is retired so
// a late event from the ended instance can't touch the next session.
function finishSession(btn) {
    sessionId++;
    committing = false;
    paused = false;
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

// Commit path — the user tapped the overlay or re-tapped the mic. Stop WITHOUT suppressing and finalize here, firing onFinal with
// the transcript (when non-empty). Safe to call when nothing is recording.
function commitDictation() {
    // Paused: the platform already ended the recognizer; the tap is the commit.
    if (paused) {
        suppressFinal = false;
        finishSession(activeButton);
        return;
    }
    // No live session, but the tap still has to dismiss: an overlay can outlive
    // its session (iOS standalone doesn't reliably fire onend), and leaving it
    // up reads as a hung app with no way out.
    if (!recording && !activeRec) { closeOverlay(); return; }
    recording = false;
    committing = true;
    if (activeRec) {
        try { activeRec.stop(); } catch (e) { /* already stopped */ }
        activeRec = null;
    }
    // If the instance never wired onend (or already fired), finalize directly.
    finishSession(activeButton);
}

// Cancel path — Escape, Discard, surface-close cleanup, or the runaway watchdog. Suppress
// the onFinal an onend would otherwise fire and abort so the mic releases
// promptly; the transcript is never committed but stays in the field.
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

        // Discard — the phone has no Escape key, so an auto-commit overlay
        // (which a tap commits, and which can sit paused) needs an explicit
        // cancel. Keeps the text in the field and never fires onFinal.
        const discard = document.createElement('button');
        discard.type = 'button';
        discard.className = 'voiceDiscard';
        discard.setAttribute('aria-label', 'Discard dictation');
        discard.textContent = '\u00d7';
        discard.addEventListener('click', function(e) {
            e.stopPropagation();
            cancelDictation();
        });
        ov.appendChild(discard);
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
    overlayEl = null;
    // Sweep by class rather than only the tracked node: an overlay whose session
    // was torn down without closing it is still in the DOM but no longer
    // referenced, and it has to come out too or the dismiss does nothing.
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    const stray = document.querySelectorAll('.voiceOverlay');
    for (let i = 0; i < stray.length; i++) {
        if (stray[i].parentNode) stray[i].parentNode.removeChild(stray[i]);
    }
}

// Flip the overlay to its paused state: "Paused" label, a frozen equalizer, and
// the interim transcript and tap-to-add hint left as they were.
function pauseOverlay() {
    if (barTimer) { clearTimeout(barTimer); barTimer = null; }
    if (!overlayEl) return;
    overlayEl.setAttribute('aria-label', 'Paused');
    const label = overlayEl.querySelector('.voiceListenLabel');
    if (label) label.textContent = 'Paused';
    const pill = overlayEl.querySelector('.voiceListenPill');
    if (pill) {
        pill.classList.remove('voiceListenPill--speaking');
        pill.classList.add('voiceListenPill--paused');
    }
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
