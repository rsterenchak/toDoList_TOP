// Source-level pins for the email-OTP sign-in modal.
//
// The modal is the app's hard gate — index.js renders it whenever no
// Supabase session exists at boot, and re-renders it whenever the
// session is cleared via sign-out. Screen 2 collects a 6-digit code and
// calls verifyOtp in-app so the session lands in the installed PWA's
// own storage jar. These tests verify the wiring is in place at the
// source level (modal builder structure, the signInWithOtp / verifyOtp
// call shapes, the boot-time getSession + onAuthStateChange
// subscription, the sign-out row in both settings surfaces) rather
// than driving Supabase live, which is deferred to a later validation
// pass.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}


describe('Auth modal — source-level structure in auth.js', () => {
    const auth = read('auth.js');

    it('imports the shared supabase client', () => {
        expect(auth).toMatch(
            /import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*['"]\.\/supabaseClient\.js['"]/
        );
    });

    it('exports showAuthModal and hideAuthModal', () => {
        expect(auth).toMatch(/export\s+function\s+showAuthModal\s*\(/);
        expect(auth).toMatch(/export\s+function\s+hideAuthModal\s*\(/);
    });

    it('mounts a full-screen backdrop with id "authModalBackdrop"', () => {
        // The backdrop is what makes the modal a hard gate — CSS pins it
        // fixed-inset-0 with the highest z-index so the chrome behind
        // is unreachable until auth completes. The DOM id is also the
        // hook isAnyModalOrPopoverOpen checks against.
        expect(auth).toMatch(/backdrop\.id\s*=\s*BACKDROP_ID/);
        expect(auth).toMatch(/BACKDROP_ID\s*=\s*['"]authModalBackdrop['"]/);
        expect(auth).toMatch(/document\.body\.appendChild\(\s*backdrop\s*\)/);
    });

    it('exposes the dialog as a labelled role="dialog" with aria-modal', () => {
        expect(auth).toMatch(/dialog\.setAttribute\(\s*['"]role['"]\s*,\s*['"]dialog['"]\s*\)/);
        expect(auth).toMatch(/dialog\.setAttribute\(\s*['"]aria-modal['"]\s*,\s*['"]true['"]\s*\)/);
        expect(auth).toMatch(/aria-labelledby/);
    });

    it('renders a ghost mascot on screen 1 (className "authModalMascot")', () => {
        expect(auth).toMatch(/className\s*=\s*['"]authModalMascot['"]/);
    });

    it('renders the "Welcome." heading on screen 1', () => {
        expect(auth).toMatch(/textContent\s*=\s*['"]Welcome\.['"]/);
    });

    it('renders a single email input with autocomplete="email" and required=true', () => {
        expect(auth).toMatch(/input\.type\s*=\s*['"]email['"]/);
        expect(auth).toMatch(/input\.autocomplete\s*=\s*['"]email['"]/);
        expect(auth).toMatch(/input\.required\s*=\s*true/);
    });

    it('renders a primary "Continue →" submit button', () => {
        expect(auth).toMatch(/Continue\s*→/);
    });

    it('renders the screen-2 ghost-with-mail variant and "Enter your code." heading', () => {
        expect(auth).toMatch(/authModalMascot--mail/);
        expect(auth).toMatch(/authModalMailBadge/);
        expect(auth).toMatch(/textContent\s*=\s*['"]Enter your code\.['"]/);
    });

    it('highlights the destination email in accent purple on screen 2', () => {
        expect(auth).toMatch(/authModalEmailHighlight/);
        expect(auth).toMatch(/Enter the 6-digit code sent to/);
    });

    it('renders the screen-2 "Resend code" and "Use a different email" actions', () => {
        expect(auth).toMatch(/Resend code/);
        expect(auth).toMatch(/Use a different email/);
    });

    it('defines a Resend cooldown to throttle repeated taps', () => {
        // The resend handler must disable the button for a short window
        // so a frustrated user can't tap-spam Supabase past its rate
        // limit. The exact ms is implementation-detail; pin the named
        // constant + a setTimeout that re-enables the button.
        expect(auth).toMatch(/RESEND_COOLDOWN_MS/);
        expect(auth).toMatch(/resend\.disabled\s*=\s*true/);
        expect(auth).toMatch(/resend\.disabled\s*=\s*false/);
    });
});


describe('Auth modal — signInWithOtp call shape (code variant)', () => {
    const auth = read('auth.js');

    it('calls supabase.auth.signInWithOtp with the email and no emailRedirectTo', () => {
        expect(auth).toMatch(/supabase\.auth\.signInWithOtp\s*\(/);
        // The OTP-code variant drops emailRedirectTo entirely so Supabase
        // sends a 6-digit code (from {{ .Token }}) instead of a magic
        // link; verifyOtp then creates the session inside the PWA's own
        // storage jar rather than the system browser's. The option key
        // (emailRedirectTo:) must be gone from the call site.
        expect(auth).not.toMatch(/emailRedirectTo\s*:/);
    });

    it('surfaces "Too many tries — wait a moment" on a rate-limit error', () => {
        expect(auth).toMatch(/Too many tries\s*—\s*wait a moment/);
    });

    it('surfaces "Couldn\'t send code — try again" on a generic / network error', () => {
        expect(auth).toMatch(/Couldn['’]t send code\s*—\s*try again/);
    });

    it('branches on HTTP 429 status to pick the rate-limit message', () => {
        // The Supabase SDK surfaces rate limiting as either error.status
        // or a wrapped response.status; the wrapper checks both.
        expect(auth).toMatch(/===?\s*429/);
    });
});


describe('Auth modal — screen-2 code entry + verifyOtp', () => {
    const auth = read('auth.js');

    it('renders a code input wired for mobile OTP autofill', () => {
        // inputmode numeric → numeric keypad; autocomplete one-time-code →
        // iOS offers the code from the email; maxlength 6 caps the digits.
        expect(auth).toMatch(/authModalCodeInput/);
        expect(auth).toMatch(/inputMode\s*=\s*['"]numeric['"]/);
        expect(auth).toMatch(/autocomplete\s*=\s*['"]one-time-code['"]/);
        expect(auth).toMatch(/maxLength\s*=\s*6/);
    });

    it('renders a primary "Verify" button', () => {
        expect(auth).toMatch(/textContent\s*=\s*['"]Verify['"]/);
    });

    it('calls supabase.auth.verifyOtp with email + token + type "email"', () => {
        expect(auth).toMatch(/supabase\.auth\.verifyOtp\s*\(/);
        expect(auth).toMatch(/type:\s*['"]email['"]/);
    });

    it('surfaces an inline error on an invalid / expired code', () => {
        expect(auth).toMatch(/That code didn['’]t work — check it or resend/);
    });
});


describe('Auth gate boot-time wiring in index.js', () => {
    const indexJs = read('index.js');

    it('imports the shared supabase client', () => {
        expect(indexJs).toMatch(
            /import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*['"]\.\/supabaseClient\.js['"]/
        );
    });

    it('imports showAuthModal and hideAuthModal from auth.js', () => {
        expect(indexJs).toMatch(
            /import\s*\{[^}]*\bshowAuthModal\b[^}]*\}\s*from\s*['"]\.\/auth\.js['"]/
        );
        expect(indexJs).toMatch(
            /import\s*\{[^}]*\bhideAuthModal\b[^}]*\}\s*from\s*['"]\.\/auth\.js['"]/
        );
    });

    it('calls supabase.auth.getSession() at boot', () => {
        expect(indexJs).toMatch(/supabase\.auth\.getSession\s*\(/);
    });

    it('subscribes to supabase.auth.onAuthStateChange to react to sign-in / sign-out', () => {
        expect(indexJs).toMatch(/supabase\.auth\.onAuthStateChange\s*\(/);
    });

    it('renders the auth modal when no session exists at boot', () => {
        expect(indexJs).toMatch(/showAuthModal\s*\(\s*\)/);
    });

    it('hides the modal and runs the normal boot path when a session arrives', () => {
        // bootApp() is the latched runner that invokes restoreFromStorage
        // and maybeStartFirstRunCarousel once a session exists; the modal
        // hides via hideAuthModal in the same arrival callback.
        expect(indexJs).toMatch(/hideAuthModal\s*\(\s*\)/);
        expect(indexJs).toMatch(/restoreFromStorage\s*\(/);
        expect(indexJs).toMatch(/maybeStartFirstRunCarousel\s*\(/);
    });

    it('defers boot until the onAuthStateChange subscription has a session in hand', () => {
        // No top-level restoreFromStorage() — it now runs only from
        // bootApp(), which is latched and called from both the
        // getSession resolver and the onAuthStateChange callback.
        // Source-level shape check: bootApp must exist and gate the
        // calls. A bare top-level restoreFromStorage() call (not inside
        // a function body) would skip the auth gate.
        expect(indexJs).toMatch(/function\s+bootApp\s*\(/);
    });
});


describe('Sign-out row — desktop ghost menu (showSettingsMenu in settingsMenu.js)', () => {
    const settingsMenu = read('settingsMenu.js');

    it('imports the shared supabase client', () => {
        expect(settingsMenu).toMatch(
            /import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*['"]\.\/supabaseClient\.js['"]/
        );
    });

    it('renders an Account section heading inside showSettingsMenu', () => {
        const idx = settingsMenu.indexOf('function showSettingsMenu');
        expect(idx).toBeGreaterThan(-1);
        const fn = settingsMenu.slice(idx, idx + 20000);
        // Mirrors the HELP section heading pattern — a
        // settingsMenuSectionHeading div with the label text.
        expect(fn).toMatch(/Account/);
        expect(fn).toMatch(/settingsMenuSectionHeading/);
    });

    it('renders a Sign out row that calls supabase.auth.signOut()', () => {
        const idx = settingsMenu.indexOf('function showSettingsMenu');
        expect(idx).toBeGreaterThan(-1);
        const fn = settingsMenu.slice(idx, idx + 20000);
        expect(fn).toMatch(/Sign out/);
        expect(fn).toMatch(/supabase\.auth\.signOut\s*\(/);
    });
});


describe('Sign-out row — mobile settings modal (showSettingsModal in settingsModal.js)', () => {
    const settingsModal = read('settingsModal.js');

    it('renders an Account section in showSettingsModal', () => {
        const idx = settingsModal.indexOf('function showSettingsModal');
        expect(idx).toBeGreaterThan(-1);
        const fn = settingsModal.slice(idx, idx + 20000);
        expect(fn).toMatch(/Account/);
        // Account section follows the same section chrome the other
        // modal sections (Data / View / Appearance / About / Help) use.
        expect(fn).toMatch(/settingsSection/);
    });

    it('renders a Sign out action row that calls supabase.auth.signOut()', () => {
        const idx = settingsModal.indexOf('function showSettingsModal');
        expect(idx).toBeGreaterThan(-1);
        const fn = settingsModal.slice(idx, idx + 20000);
        expect(fn).toMatch(/Sign out/);
        expect(fn).toMatch(/createDrawerActionRow\s*\(\s*['"]Sign out['"]/);
        expect(fn).toMatch(/supabase\.auth\.signOut\s*\(/);
    });
});


describe('Auth modal — registered in isAnyModalOrPopoverOpen', () => {
    const modals = read('modals.js');

    it('lists authModalBackdrop alongside the other modal backdrops', () => {
        // The shared isAnyModalOrPopoverOpen helper backs the global
        // shortcut guards (Esc / "?" / arrow-nav). Including the auth
        // backdrop ensures those shortcuts can't fire under the gate.
        const idx = modals.indexOf('isAnyModalOrPopoverOpen');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 1500);
        expect(fn).toMatch(/authModalBackdrop/);
    });
});


describe('Auth modal — CSS', () => {
    const css = read('style.css');

    it('pins the backdrop fixed-inset-0 with high z-index', () => {
        const idx = css.indexOf('#authModalBackdrop {');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 600);
        expect(block).toMatch(/position:\s*fixed/);
        expect(block).toMatch(/inset:\s*0/);
        expect(block).toMatch(/z-index:\s*\d+/);
    });

    it('sizes the email input with font-size: 16px to prevent iOS Safari auto-zoom', () => {
        const idx = css.indexOf('.authModalEmailInput {');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 600);
        expect(block).toMatch(/font-size:\s*16px/);
    });

    it('sizes the code input with font-size: 16px to prevent iOS Safari auto-zoom', () => {
        const idx = css.indexOf('.authModalCodeInput {');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 600);
        expect(block).toMatch(/font-size:\s*16px/);
    });

    it('paints the primary Continue button in accent purple #6C5DF5', () => {
        const idx = css.indexOf('.authModalSubmit {');
        expect(idx).toBeGreaterThan(-1);
        const block = css.slice(idx, idx + 600);
        // The design pass pinned this exact accent — keep it sourced
        // from the literal so a theme-token drift can't quietly change
        // the auth gate's button color.
        expect(block).toMatch(/#6C5DF5/i);
    });
});
