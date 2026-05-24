// Magic-link sign-in modal — the app's hard gate.
//
// On boot, index.js queries supabase.auth.getSession(); if no session
// exists, showAuthModal() renders a full-screen takeover blocking the
// rest of the UI until the user authenticates via Supabase magic-link
// auth. index.js also subscribes to supabase.auth.onAuthStateChange so
// the modal hides when a session arrives and re-renders on sign-out.
//
// Screens:
//   1 (sign-in)      — "Welcome." heading + email input + Continue button.
//                      Submit calls supabase.auth.signInWithOtp; advances
//                      to screen 2 on success.
//   2 (confirmation) — "Check your inbox." with a Resend link button
//                      (cooldown-disabled for 10s after each press) and a
//                      quieter "Use a different email" link back to screen 1.

import { supabase } from './supabaseClient.js';

const BACKDROP_ID = 'authModalBackdrop';
const DIALOG_ID   = 'authModal';

// Brief disabled window after the Resend button is pressed so a user
// can't tap-spam Supabase and trip the upstream rate limiter.
const RESEND_COOLDOWN_MS = 10 * 1000;


// Idempotent teardown — safe to call when no modal is mounted.
// onAuthStateChange uses this when a session arrives so the gate
// vanishes without the caller needing to track its lifecycle.
export function hideAuthModal() {
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
        sendMagicLink(email).then(function(result) {
            if (result.ok) {
                renderConfirmationScreen(dialog, email);
            } else {
                submit.disabled = false;
                showError(errorEl, result.message);
            }
        });
    });
}


// ── SCREEN 2: CONFIRMATION ──
// Ghost mascot with a small mail-icon badge bottom-right, "Check your
// inbox." heading, body copy with the email highlighted in the accent
// purple, primary outlined Resend button (10s cooldown), and a quieter
// text link back to screen 1.
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
    heading.textContent = 'Check your inbox.';
    dialog.appendChild(heading);

    const body = document.createElement('p');
    body.className = 'authModalBody';
    body.appendChild(document.createTextNode('A link is on its way to '));
    const emailSpan = document.createElement('span');
    emailSpan.className = 'authModalEmailHighlight';
    emailSpan.textContent = email;
    body.appendChild(emailSpan);
    dialog.appendChild(body);

    const errorEl = document.createElement('div');
    errorEl.id = 'authModalError';
    errorEl.className = 'authModalError';
    errorEl.setAttribute('role', 'alert');
    errorEl.style.display = 'none';
    dialog.appendChild(errorEl);

    const resend = document.createElement('button');
    resend.type = 'button';
    resend.id = 'authModalResend';
    resend.className = 'authModalResend';
    resend.textContent = 'Resend link';
    resend.addEventListener('click', function() {
        if (resend.disabled) return;
        resend.disabled = true;
        errorEl.style.display = 'none';
        sendMagicLink(email).then(function(result) {
            if (!result.ok) {
                showError(errorEl, result.message);
            }
            setTimeout(function() {
                resend.disabled = false;
            }, RESEND_COOLDOWN_MS);
        });
    });
    dialog.appendChild(resend);

    const back = document.createElement('button');
    back.type = 'button';
    back.id = 'authModalUseDifferent';
    back.className = 'authModalUseDifferent';
    back.textContent = 'Use a different email';
    back.addEventListener('click', function() {
        renderSignInScreen(dialog, '');
    });
    dialog.appendChild(back);
}


function showError(errorEl, message) {
    errorEl.textContent = message;
    errorEl.style.display = '';
}


// Wraps supabase.auth.signInWithOtp so the two screens can share one
// error-classification path. Returns a plain { ok, message } shape
// instead of bubbling Supabase's response object up — keeps the
// renderers ignorant of the SDK error surface.
function sendMagicLink(email) {
    return supabase.auth.signInWithOtp({
        email: email,
        options: {
            emailRedirectTo: window.location.origin + window.location.pathname,
        },
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
        return { ok: false, message: "Couldn't send link — try again" };
    }, function() {
        // Network failure / promise rejection — same generic message.
        return { ok: false, message: "Couldn't send link — try again" };
    });
}
