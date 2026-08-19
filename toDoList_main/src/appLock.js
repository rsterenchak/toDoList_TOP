// ── APP LOCK (PIN) ──
//
// A client-side privacy lock. When enabled, the app watches for user input at
// the document level and, once the configured idle span passes with no
// activity, mounts a full-screen overlay that blocks every edit until the
// user re-enters their 4-digit PIN.
//
// Three pieces live here because they are one subsystem and share state:
//   • persistence — the enabled flag, the hashed PIN, the idle timeout, and
//     the last-activity stamp, all behind the `todoapp_` prefix (CLAUDE.md
//     "Persistence") with the same try/catch-and-degrade shape prefs.js uses;
//   • the idle watch — document-level listeners that stamp activity and
//     re-arm a single timer (event-driven, never a poll);
//   • the lock overlay — the full-screen takeover and its PIN prompt.
//
// The setup modal is a separate surface and lives in pinLockModal.js, which
// imports from here; nothing here imports it back.
//
// On the PIN hash: the stored value is a salted, iterated digest, never the
// digits. That keeps the PIN out of a casual localStorage read (devtools, a
// synced backup, an exported profile). It is NOT a security boundary — a
// 4-digit space is trivially brute-forced by anyone who already has the
// device and the stored salt, and the todo data itself sits unencrypted in
// localStorage regardless. The lock is a privacy screen over the UI, in the
// spirit of a phone's lock screen, not encryption at rest.

export const APP_LOCK_ENABLED_KEY = 'todoapp_appLockEnabled';
export const APP_LOCK_PIN_KEY = 'todoapp_appLockPin';
export const APP_LOCK_TIMEOUT_KEY = 'todoapp_appLockTimeout';
export const APP_LOCK_ACTIVITY_KEY = 'todoapp_appLockLastActivity';

// Idle spans offered by the setup modal's <select>. 0 means "Never" — the
// lock stays armed as a manual concept only and no timer is ever scheduled.
export const APP_LOCK_TIMEOUT_OPTIONS = [
    { minutes: 1, label: '1 minute' },
    { minutes: 5, label: '5 minutes' },
    { minutes: 15, label: '15 minutes' },
    { minutes: 30, label: '30 minutes' },
    { minutes: 0, label: 'Never' },
];

export const APP_LOCK_DEFAULT_TIMEOUT_MINUTES = 5;

export const PIN_LENGTH = 4;

// ── persistence ──

export function isAppLockEnabled() {
    try {
        return localStorage.getItem(APP_LOCK_ENABLED_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

export function setAppLockEnabled(enabled) {
    try {
        localStorage.setItem(APP_LOCK_ENABLED_KEY, enabled ? 'true' : 'false');
    } catch (e) { /* ignore quota/private-mode */ }
}

// A PIN is exactly PIN_LENGTH digits — the boxed inputs can't produce
// anything else, but the guard keeps a hand-written localStorage value or a
// future caller from storing a hash of something unenterable.
export function isValidPin(pin) {
    return typeof pin === 'string' && new RegExp('^[0-9]{' + PIN_LENGTH + '}$').test(pin);
}

// Salted, iterated FNV-1a run over four independently-seeded chains so the
// digest is 128 bits rather than 32. Synchronous on purpose: crypto.subtle is
// promise-based, and an async verify would have to be threaded through the
// overlay's keystroke handler for no gain against a 4-digit search space.
function digestPin(pin, salt) {
    const seed = salt + '|' + pin;
    const chains = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
    let out = '';
    for (let c = 0; c < chains.length; c++) {
        let h = chains[c] >>> 0;
        for (let round = 0; round < 256; round++) {
            for (let i = 0; i < seed.length; i++) {
                h ^= seed.charCodeAt(i);
                h = Math.imul(h, 0x01000193) >>> 0;
            }
            h = (h ^ (round + c)) >>> 0;
        }
        out += h.toString(16).padStart(8, '0');
    }
    return out;
}

function mintSalt() {
    if (typeof globalThis !== 'undefined'
        && globalThis.crypto
        && typeof globalThis.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(8);
        globalThis.crypto.getRandomValues(bytes);
        return Array.from(bytes).map(function(b) {
            return b.toString(16).padStart(2, '0');
        }).join('');
    }
    // Fallback for runtimes without getRandomValues. The salt only has to be
    // per-install unique, not unguessable — see the hashing note up top.
    return (Math.random().toString(16).slice(2) + Date.now().toString(16)).slice(0, 16);
}

export function hasAppLockPin() {
    try {
        const raw = localStorage.getItem(APP_LOCK_PIN_KEY);
        return !!raw && raw.indexOf(':') > 0;
    } catch (e) {
        return false;
    }
}

// Stores `<salt>:<digest>`. Returns false (and writes nothing) when the PIN
// isn't four digits, so a caller can surface the validation error.
export function setAppLockPin(pin) {
    if (!isValidPin(pin)) return false;
    const salt = mintSalt();
    try {
        localStorage.setItem(APP_LOCK_PIN_KEY, salt + ':' + digestPin(pin, salt));
        return true;
    } catch (e) {
        return false;
    }
}

export function verifyAppLockPin(pin) {
    if (!isValidPin(pin)) return false;
    let raw;
    try {
        raw = localStorage.getItem(APP_LOCK_PIN_KEY);
    } catch (e) {
        return false;
    }
    if (!raw) return false;
    const sep = raw.indexOf(':');
    if (sep <= 0) return false;
    const salt = raw.slice(0, sep);
    const stored = raw.slice(sep + 1);
    return digestPin(pin, salt) === stored;
}

// Turning the lock off forgets the PIN too, so re-enabling always asks for a
// fresh one rather than silently reviving a PIN the user thought was gone.
export function clearAppLock() {
    try {
        localStorage.removeItem(APP_LOCK_PIN_KEY);
        localStorage.removeItem(APP_LOCK_ENABLED_KEY);
        localStorage.removeItem(APP_LOCK_TIMEOUT_KEY);
        localStorage.removeItem(APP_LOCK_ACTIVITY_KEY);
    } catch (e) { /* ignore quota/private-mode */ }
}

// Minutes, with 0 meaning "Never". Anything unparseable or off the offered
// list degrades to the default rather than disabling the lock silently.
export function readAppLockTimeoutMinutes() {
    let raw;
    try {
        raw = localStorage.getItem(APP_LOCK_TIMEOUT_KEY);
    } catch (e) {
        return APP_LOCK_DEFAULT_TIMEOUT_MINUTES;
    }
    if (raw === null) return APP_LOCK_DEFAULT_TIMEOUT_MINUTES;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) return APP_LOCK_DEFAULT_TIMEOUT_MINUTES;
    const known = APP_LOCK_TIMEOUT_OPTIONS.some(function(opt) { return opt.minutes === parsed; });
    return known ? parsed : APP_LOCK_DEFAULT_TIMEOUT_MINUTES;
}

export function writeAppLockTimeoutMinutes(minutes) {
    try {
        localStorage.setItem(APP_LOCK_TIMEOUT_KEY, String(minutes));
    } catch (e) { /* ignore quota/private-mode */ }
}

export function markAppLockActivity() {
    try {
        localStorage.setItem(APP_LOCK_ACTIVITY_KEY, String(Date.now()));
    } catch (e) { /* ignore quota/private-mode */ }
}

// Returns NaN when nothing is stored — the boot check reads that as "no idle
// span to measure yet" and arms the timer instead of locking immediately.
export function readAppLockLastActivity() {
    try {
        return parseInt(localStorage.getItem(APP_LOCK_ACTIVITY_KEY), 10);
    } catch (e) {
        return NaN;
    }
}

// The lock is live only when the user turned it on AND a PIN exists — an
// enabled flag with no PIN would mount an overlay nothing can dismiss.
export function isAppLockArmed() {
    return isAppLockEnabled() && hasAppLockPin();
}

// ── boxed PIN digit inputs ──
//
// Shared by the lock overlay below and by pinLockModal.js's setup form so the
// two PIN surfaces can't drift. Four single-character inputs that advance on
// entry, walk back on Backspace, and accept a pasted 4-digit string.
// inputMode="numeric" brings up the phone keypad without the `type="number"`
// spinner chrome; the 16px+ font size lives in style.css per the CLAUDE.md
// iOS auto-zoom rule.
export function createPinDigitInputs(options) {
    const opts = options || {};
    const onComplete = typeof opts.onComplete === 'function' ? opts.onComplete : null;
    const onInput = typeof opts.onInput === 'function' ? opts.onInput : null;

    const row = document.createElement('div');
    row.className = 'pinDigitRow';
    if (opts.groupLabel) {
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', opts.groupLabel);
    }

    const inputs = [];

    function value() {
        return inputs.map(function(input) { return input.value; }).join('');
    }

    function announce() {
        if (onInput) onInput(value());
        if (onComplete && value().length === PIN_LENGTH) onComplete(value());
    }

    for (let i = 0; i < PIN_LENGTH; i++) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'pinDigitInput';
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.maxLength = 1;
        input.setAttribute('pattern', '[0-9]*');
        input.setAttribute('aria-label', 'PIN digit ' + (i + 1) + ' of ' + PIN_LENGTH);
        if (opts.idPrefix) input.id = opts.idPrefix + (i + 1);
        input.addEventListener('input', function() {
            // Strip anything non-numeric rather than rejecting the keystroke,
            // so an IME or autofill can't seed a letter into the box.
            input.value = input.value.replace(/[^0-9]/g, '').slice(0, 1);
            if (input.value && i < PIN_LENGTH - 1) inputs[i + 1].focus();
            announce();
        });
        input.addEventListener('keydown', function(event) {
            if (event.key === 'Backspace' && !input.value && i > 0) {
                event.preventDefault();
                inputs[i - 1].value = '';
                inputs[i - 1].focus();
                announce();
                return;
            }
            if (event.key === 'ArrowLeft' && i > 0) {
                event.preventDefault();
                inputs[i - 1].focus();
                return;
            }
            if (event.key === 'ArrowRight' && i < PIN_LENGTH - 1) {
                event.preventDefault();
                inputs[i + 1].focus();
            }
        });
        input.addEventListener('paste', function(event) {
            const text = event.clipboardData && event.clipboardData.getData
                ? event.clipboardData.getData('text')
                : '';
            const digits = String(text || '').replace(/[^0-9]/g, '').slice(0, PIN_LENGTH);
            if (!digits) return;
            event.preventDefault();
            for (let d = 0; d < PIN_LENGTH; d++) inputs[d].value = digits[d] || '';
            inputs[Math.min(digits.length, PIN_LENGTH - 1)].focus();
            announce();
        });
        input.addEventListener('focus', function() { input.select(); });
        inputs.push(input);
        row.appendChild(input);
    }

    return {
        row: row,
        inputs: inputs,
        value: value,
        clear: function() {
            inputs.forEach(function(input) { input.value = ''; });
        },
        focusFirst: function() {
            if (inputs.length) inputs[0].focus();
        },
    };
}

// ── lock overlay ──

const OVERLAY_ID = 'appLockOverlay';

let overlayTeardown = null;

export function isAppLocked() {
    return !!document.getElementById(OVERLAY_ID);
}

// Mounts the full-screen lock. Unlike every other modal in the app this one
// deliberately breaks the three-way-close convention: no close button, no
// backdrop dismiss, and Escape is swallowed rather than honoured — any of the
// three would defeat the lock. The only exit is a correct PIN.
export function lockApp() {
    if (!hasAppLockPin()) return false;
    if (isAppLocked()) return true;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'appLockTitle');

    const card = document.createElement('div');
    card.className = 'appLockCard';

    const icon = document.createElement('div');
    icon.className = 'appLockIcon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML =
        '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" '
        + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="4" y="10.5" width="16" height="10" rx="2"/>'
        + '<path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>'
        + '</svg>';

    const title = document.createElement('div');
    title.id = 'appLockTitle';
    title.className = 'appLockTitle';
    title.textContent = 'Locked';

    const hint = document.createElement('div');
    hint.className = 'appLockHint';
    hint.textContent = 'Enter your PIN to unlock';

    const error = document.createElement('div');
    error.id = 'appLockError';
    error.className = 'appLockError';
    error.setAttribute('role', 'alert');

    const digits = createPinDigitInputs({
        idPrefix: 'appLockDigit',
        groupLabel: 'Unlock PIN',
        onInput: function() { error.textContent = ''; },
        onComplete: function(pin) {
            if (verifyAppLockPin(pin)) {
                unlockApp();
                return;
            }
            error.textContent = 'Incorrect PIN';
            digits.clear();
            digits.focusFirst();
            card.classList.remove('appLockCard--shake');
            // Reflow so the animation restarts on a second wrong entry.
            void card.offsetWidth;
            card.classList.add('appLockCard--shake');
        },
    });

    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(hint);
    card.appendChild(digits.row);
    card.appendChild(error);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.body.classList.add('appLocked');

    digits.focusFirst();

    // Escape must not reach the modals / menus stacked underneath, and Tab
    // must not walk focus into the app behind the overlay — the overlay is
    // the only interactive surface while locked.
    function onKeydownCapture(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.key === 'Tab' && !overlay.contains(event.target)) {
            event.preventDefault();
            digits.focusFirst();
        }
    }

    function onFocusInCapture(event) {
        if (overlay.contains(event.target)) return;
        digits.focusFirst();
    }

    document.addEventListener('keydown', onKeydownCapture, true);
    document.addEventListener('focusin', onFocusInCapture, true);

    overlayTeardown = function() {
        document.removeEventListener('keydown', onKeydownCapture, true);
        document.removeEventListener('focusin', onFocusInCapture, true);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.body.classList.remove('appLocked');
    };

    return true;
}

export function unlockApp() {
    if (overlayTeardown) {
        overlayTeardown();
        overlayTeardown = null;
    } else {
        const stale = document.getElementById(OVERLAY_ID);
        if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
        document.body.classList.remove('appLocked');
    }
    markAppLockActivity();
    rearmAppLockTimer();
}

// ── idle watch ──

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

let watchStarted = false;
let idleTimer = null;

function clearIdleTimer() {
    if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
}

// Re-arms the single idle timer from the current settings. Called on every
// activity event, after an unlock, and whenever the settings change. No timer
// is scheduled when the lock is disarmed, when the timeout is Never, or while
// the overlay is already up.
export function rearmAppLockTimer() {
    clearIdleTimer();
    if (!isAppLockArmed() || isAppLocked()) return;
    const minutes = readAppLockTimeoutMinutes();
    if (!minutes) return;
    idleTimer = setTimeout(function() {
        idleTimer = null;
        if (isAppLockArmed()) lockApp();
    }, minutes * 60000);
}

// Locks straight away when more than the configured idle span has already
// elapsed since the last recorded activity. Covers the two cases a timer
// alone misses: a reload after the app sat closed, and a background tab whose
// timers the browser throttled while it was hidden.
export function enforceAppLockIdle() {
    if (!isAppLockArmed() || isAppLocked()) return false;
    const minutes = readAppLockTimeoutMinutes();
    if (!minutes) return false;
    const last = readAppLockLastActivity();
    if (isNaN(last)) return false;
    if (Date.now() - last < minutes * 60000) return false;
    return lockApp();
}

// Starts the document-level idle watch. Idempotent — a second component()
// pass (or a re-evaluated bundle) won't stack a second set of listeners.
export function startAppLockWatch() {
    if (watchStarted) return;
    watchStarted = true;

    function onActivity() {
        // Keystrokes into the lock overlay are not app activity — stamping
        // them would push the idle window forward while the app is locked.
        if (isAppLocked()) return;
        markAppLockActivity();
        rearmAppLockTimer();
    }

    ACTIVITY_EVENTS.forEach(function(name) {
        document.addEventListener(name, onActivity, { capture: true, passive: true });
    });

    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') {
            // Stamp on the way out so the span the app spent hidden counts
            // as idle time when it comes back.
            if (!isAppLocked()) markAppLockActivity();
            return;
        }
        if (!enforceAppLockIdle()) rearmAppLockTimer();
    });

    if (!enforceAppLockIdle()) {
        if (isNaN(readAppLockLastActivity())) markAppLockActivity();
        rearmAppLockTimer();
    }
}

// Test seam: lets a suite reset the module's watch/timer singletons between
// cases the way it would get a fresh page load.
export function resetAppLockWatchForTests() {
    clearIdleTimer();
    watchStarted = false;
}
