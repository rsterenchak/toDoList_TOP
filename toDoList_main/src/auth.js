// Email OTP sign-in modal — the app's hard gate.
//
// On boot, index.js queries supabase.auth.getSession(); if no session
// exists, showAuthModal() renders a full-screen takeover blocking the
// rest of the UI until the user authenticates via Supabase email OTP.
// index.js also subscribes to supabase.auth.onAuthStateChange so the
// modal hides when a session arrives and re-renders on sign-out.
//
// The OTP (code) variant is used instead of the magic link so the
// session is created inside the installed PWA's own storage jar. A
// magic link opens in the system browser (a separate storage jar on
// iOS), leaving the standalone app still signed out; entering the code
// in-app avoids that split entirely.
//
// Screens:
//   1 (sign-in)      — "Welcome." heading + email input + Continue button.
//                      Submit calls supabase.auth.signInWithOtp; advances
//                      to screen 2 on success.
//   2 (code entry)   — "Enter your code." with a code input and a
//                      Verify button (calls verifyOtp in-app), plus a
//                      "Resend code" button (cooldown-disabled for 60s
//                      after each send, counting the wait down on its
//                      label) and a quieter "Use a different email" link
//                      back to screen 1.

import { supabase } from './supabaseClient.js';

const BACKDROP_ID = 'authModalBackdrop';
const DIALOG_ID   = 'authModal';

// Disabled window after an OTP is sent. Matches Supabase's documented
// per-address OTP interval (one request every 60s); a shorter window
// would re-enable the button before the server accepts another send, so
// every resend would 429. The wait counts down on the button label so
// it reads as deliberate rather than a dead button.
const RESEND_COOLDOWN_MS = 60 * 1000;

// Handle for the running Resend countdown, tracked at module scope so
// hideAuthModal can clear it when the gate tears down — a timer must
// never outlive its modal and fire against a removed button.
let resendCooldownTimer = null;


// Stop and forget any running Resend countdown. Idempotent.
function clearResendCooldown() {
    if (resendCooldownTimer !== null) {
        clearInterval(resendCooldownTimer);
        resendCooldownTimer = null;
    }
}


// Disable the Resend button for the full 60s server window and count the
// remaining seconds down on its label ("Resend code (45s)"), re-enabling
// and restoring the plain label at zero. Called both when the
// confirmation screen first renders (the initial send already opened the
// window) and on each resend press (which restarts the window).
function startResendCooldown(resend) {
    clearResendCooldown();
    let remaining = Math.round(RESEND_COOLDOWN_MS / 1000);
    resend.disabled = true;
    resend.textContent = 'Resend code (' + remaining + 's)';
    resendCooldownTimer = setInterval(function() {
        remaining -= 1;
        if (remaining <= 0) {
            clearResendCooldown();
            resend.disabled = false;
            resend.textContent = 'Resend code';
            return;
        }
        resend.textContent = 'Resend code (' + remaining + 's)';
    }, 1000);
}


// Idempotent teardown — safe to call when no modal is mounted.
// onAuthStateChange uses this when a session arrives so the gate
// vanishes without the caller needing to track its lifecycle.
export function hideAuthModal() {
    clearResendCooldown();
    const backdrop = document.getElementById(BACKDROP_ID);
    if (backdrop && backdrop.parentNode) {
        backdrop.parentNode.removeChild(backdrop);
    }
}


// Mount the full-screen auth gate. Always starts on screen 1 with the
// email input empty; the screen-2 flow is reached via the Continue
// submit handler. Safe to call twice — any prior modal is torn down
// first so a state change can't stack two backdrops.
export function showAuthModal() {
    hideAuthModal();

    const backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;

    const dialog = document.createElement('div');
    dialog.id = DIALOG_ID;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'authModalTitle');

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    renderSignInScreen(dialog, '');
}


// ── SCREEN 1: SIGN-IN ──
// Ghost mascot, "Welcome." heading, single email input, primary
// Continue button, hidden-by-default error slot.
function renderSignInScreen(dialog, prefillEmail) {
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild);

    const mascot = document.createElement('div');
    mascot.className = 'authModalMascot';
    mascot.setAttribute('aria-hidden', 'true');
    dialog.appendChild(mascot);

    const heading = document.createElement('h1');
    heading.id = 'authModalTitle';
    heading.className = 'authModalHeading';
    heading.textContent = 'Welcome.';
    dialog.appendChild(heading);

    const form = document.createElement('form');
    form.id = 'authModalForm';
    form.setAttribute('novalidate', '');

    const input = document.createElement('input');
    input.id = 'authModalEmailInput';
    input.className = 'authModalEmailInput';
    input.type = 'email';
    input.name = 'email';
    input.autocomplete = 'email';
    input.inputMode = 'email';
    input.required = true;
    input.placeholder = 'you@example.com';
    input.setAttribute('aria-label', 'Email address');
    input.value = prefillEmail || '';

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.id = 'authModalSubmit';
    submit.className = 'authModalSubmit';
    submit.textContent = 'Continue →';

    const errorEl = document.createElement('div');
    errorEl.id = 'authModalError';
    errorEl.className = 'authModalError';
    errorEl.setAttribute('role', 'alert');
    errorEl.style.display = 'none';

    form.appendChild(input);
    form.appendChild(submit);
    form.appendChild(errorEl);
    dialog.appendChild(form);

    // Defer focus so the modal has finished attaching to the DOM before
    // we hand keyboard focus to the input — jsdom-friendly and avoids
    // a flash of focus landing on body.
    setTimeout(function() {
        try { input.focus(); } catch (_) { /* test environments */ }
    }, 0);

    form.addEventListener('submit', function(event) {
        event.preventDefault();
        const email = (input.value || '').trim();
        if (!email) {
            showError(errorEl, 'Enter an email address.');
            return;
        }
        submit.disabled = true;
        errorEl.style.display = 'none';
        sendCode(email).then(function(result) {
            if (result.ok) {
                renderConfirmationScreen(dialog, email);
            } else {
                submit.disabled = false;
                showError(errorEl, result.message);
            }
        });
    });
}


// ── SCREEN 2: CODE ENTRY ──
// Ghost mascot with a small mail-icon badge bottom-right, "Enter your
// code." heading, body copy with the email highlighted in the accent
// purple, a code input + primary Verify button, an outlined
// Resend code button (60s cooldown, counting down on its label), and a
// quieter text link back to
// screen 1. Submitting a valid code calls verifyOtp in-app so the
// session lands in the PWA's own storage jar; onAuthStateChange in
// index.js then hides this gate.
function renderConfirmationScreen(dialog, email) {
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild);

    const mascot = document.createElement('div');
    mascot.className = 'authModalMascot authModalMascot--mail';
    mascot.setAttribute('aria-hidden', 'true');

    const mailBadge = document.createElement('span');
    mailBadge.className = 'authModalMailBadge';
    mailBadge.setAttribute('aria-hidden', 'true');
    mascot.appendChild(mailBadge);

    dialog.appendChild(mascot);

    const heading = document.createElement('h1');
    heading.id = 'authModalTitle';
    heading.className = 'authModalHeading';
    heading.textContent = 'Enter your code.';
    dialog.appendChild(heading);

    const body = document.createElement('p');
    body.className = 'authModalBody';
    body.appendChild(document.createTextNode('Enter the code sent to '));
    const emailSpan = document.createElement('span');
    emailSpan.className = 'authModalEmailHighlight';
    emailSpan.textContent = email;
    body.appendChild(emailSpan);
    dialog.appendChild(body);

    const form = document.createElement('form');
    form.id = 'authModalCodeForm';
    form.setAttribute('novalidate', '');

    // Mobile-first: numeric keypad, iOS one-time-code autofill from the
    // email, and font-size 16px (via CSS) to avoid Safari auto-zoom on
    // focus. maxlength is 10 (Supabase's configurable OTP ceiling), not
    // the issued length: capping at the actual length (currently 8) would
    // silently truncate a longer code if the dashboard setting changed,
    // which is exactly the bug this replaced — 6 dropped the tail of every
    // 8-digit code. 10 never truncates a real code yet still resists junk
    // paste.
    const codeInput = document.createElement('input');
    codeInput.id = 'authModalCodeInput';
    codeInput.className = 'authModalCodeInput';
    codeInput.type = 'text';
    codeInput.name = 'code';
    codeInput.inputMode = 'numeric';
    codeInput.autocomplete = 'one-time-code';
    codeInput.maxLength = 10;
    codeInput.required = true;
    codeInput.placeholder = '••••••';
    codeInput.setAttribute('aria-label', 'Verification code');

    const verify = document.createElement('button');
    verify.type = 'submit';
    verify.id = 'authModalVerify';
    verify.className = 'authModalSubmit';
    verify.textContent = 'Verify';

    form.appendChild(codeInput);
    form.appendChild(verify);
    dialog.appendChild(form);

    const errorEl = document.createElement('div');
    errorEl.id = 'authModalError';
    errorEl.className = 'authModalError';
    errorEl.setAttribute('role', 'alert');
    errorEl.style.display = 'none';
    dialog.appendChild(errorEl);

    form.addEventListener('submit', function(event) {
        event.preventDefault();
        if (verify.disabled) return;
        const token = (codeInput.value || '').trim();
        if (!token) {
            showError(errorEl, 'Enter the code from your email.');
            return;
        }
        // Disable while the request is in flight so a double-tap can't
        // fire two verifyOtp calls, mirroring the Resend cooldown guard.
        verify.disabled = true;
        errorEl.style.display = 'none';
        verifyCode(email, token).then(function(result) {
            if (result.ok) {
                // onAuthStateChange in index.js hides the gate; leave the
                // button disabled so nothing else fires as it tears down.
                return;
            }
            verify.disabled = false;
            showError(errorEl, result.message);
            try { codeInput.focus(); } catch (_) { /* test environments */ }
        });
    });

    const resend = document.createElement('button');
    resend.type = 'button';
    resend.id = 'authModalResend';
    resend.className = 'authModalResend';
    resend.textContent = 'Resend code';
    resend.addEventListener('click', function() {
        if (resend.disabled) return;
        errorEl.style.display = 'none';
        // Restart the 60s window immediately so the countdown reflects
        // the fresh send; a rate-limit error still surfaces its message
        // below without cutting the cooldown short.
        startResendCooldown(resend);
        sendCode(email).then(function(result) {
            if (!result.ok) {
                showError(errorEl, result.message);
            }
        });
    });
    dialog.appendChild(resend);

    // The initial send that brought us to this screen already opened
    // Supabase's 60s per-address window, so arm the cooldown on render —
    // an immediate resend on landing would otherwise 429.
    startResendCooldown(resend);

    const back = document.createElement('button');
    back.type = 'button';
    back.id = 'authModalUseDifferent';
    back.className = 'authModalUseDifferent';
    back.textContent = 'Use a different email';
    back.addEventListener('click', function() {
        renderSignInScreen(dialog, '');
    });
    dialog.appendChild(back);

    // Defer focus so the modal has finished (re)rendering before we hand
    // keyboard focus to the code input.
    setTimeout(function() {
        try { codeInput.focus(); } catch (_) { /* test environments */ }
    }, 0);
}


function showError(errorEl, message) {
    errorEl.textContent = message;
    errorEl.style.display = '';
}


// Wraps supabase.auth.signInWithOtp so the two screens can share one
// error-classification path. With no emailRedirectTo option Supabase
// sends the OTP code (when the email template carries {{ .Token }})
// rather than a magic link. Returns a plain { ok, message } shape
// instead of bubbling Supabase's response object up — keeps the
// renderers ignorant of the SDK error surface.
function sendCode(email) {
    return supabase.auth.signInWithOtp({
        email: email,
    }).then(function(response) {
        const error = response && response.error;
        if (!error) return { ok: true };
        // Supabase signals rate limiting via HTTP 429 either as a
        // top-level status field or wrapped inside response.status,
        // depending on SDK version — check both, plus the textual
        // hint, so the user sees the calmer message either way.
        const status = error.status || (error.response && error.response.status);
        const msg = String(error.message || '').toLowerCase();
        if (status === 429 || msg.indexOf('rate') !== -1) {
            return { ok: false, message: 'Too many tries — wait a moment' };
        }
        return { ok: false, message: "Couldn't send code — try again" };
    }, function() {
        // Network failure / promise rejection — same generic message.
        return { ok: false, message: "Couldn't send code — try again" };
    });
}


// Wraps supabase.auth.verifyOtp for the screen-2 Verify button. On
// success the session is created in-app (inside the PWA's storage jar)
// and onAuthStateChange takes over. Returns the same { ok, message }
// shape as sendCode so the renderer stays ignorant of the SDK surface.
function verifyCode(email, token) {
    return supabase.auth.verifyOtp({
        email: email,
        token: token,
        type: 'email',
    }).then(function(response) {
        const error = response && response.error;
        if (!error) return { ok: true };
        // Any error here means the token didn't verify — wrong digits or
        // an expired code. Point the user at re-checking or resending.
        return { ok: false, message: "That code didn't work — check it or resend" };
    }, function() {
        // Network failure / promise rejection — same generic message as send.
        return { ok: false, message: "Couldn't send code — try again" };
    });
}
