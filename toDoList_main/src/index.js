import _, { remove } from 'lodash';
import './style.css';
import './manifest.webmanifest';
import './favicon.svg';
import { component, restoreFromStorage, notifyUpdateAvailable } from './main.js';
import { listLogic } from './listLogic.js';
import { maybeStartFirstRunCarousel } from './welcomeCarousel.js';
import { supabase } from './supabaseClient.js';
import { showAuthModal, hideAuthModal } from './auth.js';
import { maybeMigrateLocalToSupabase } from './migration.js';
import Icon from './icon.png';
import button from './addProj_button.svg';

document.body.appendChild(component()); // build and attach DOM

// ── AUTH GATE ──
// Phase 4: render the magic-link sign-in modal as a hard front door
// when no Supabase session exists. bootApp() runs the normal load
// path (restoreFromStorage → maybeStartFirstRunCarousel); it's
// idempotent via the `booted` latch so the initial getSession() and
// the onAuthStateChange subscription (which fires on subscribe with
// the current session) can both safely trigger it. On a sign-out
// event we re-render the modal so the chrome below stays gated; the
// in-memory + localStorage state is left untouched — Phase 5 will
// route data through Supabase, and Phase 6 will migrate the local
// snapshot to the backend.
// Boot-watchdog contract: signal that interactive chrome is in the DOM so
// the inline watchdog in template.html stands down. Setting window.__appBooted
// is the success flag the watchdog's timer checks; we also clear its recovery
// counter and ask it to remove any overlay it surfaced (via the
// window.__clearBootWatchdog hook the inline script exposes). This is set
// independent of Supabase hydration — the moment the shell/auth chrome renders,
// not after the data pull — so a slow or failed hydrate never trips the
// watchdog. Wrapped in try/catch so a missing API (sessionStorage, etc.) can't
// turn the boot signal into a boot failure.
function markAppBooted() {
    try { window.__appBooted = true; } catch (_) { /* noop */ }
    try { sessionStorage.removeItem('todoapp_bootRecoveryAttempt'); } catch (_) { /* noop */ }
    try {
        if (typeof window.__clearBootWatchdog === 'function') window.__clearBootWatchdog();
    } catch (_) { /* noop */ }
}

let booted = false;
function bootApp(userId) {
    if (booted) return;
    booted = true;
    restoreFromStorage();              // now that DOM is live, restore saved projects
    markAppBooted();                   // signed-in shell is up — stand the watchdog down
    // First-run welcome carousel for mobile new users. The flag check and
    // (pointer: coarse) / viewport detection live inside maybeStartFirstRunCarousel
    // so callers don't need to know the gating rules; runs after restoreFromStorage
    // so the seeded sample project is already on screen when the closer card lands.
    // Desktop falls through to the existing coachmark tour started inside
    // restoreFromStorage.
    maybeStartFirstRunCarousel();

    // Phase 6: one-shot per-user migration of pre-auth localStorage data
    // up to Supabase. Marker-gated so subsequent sign-ins on the same
    // device are a no-op. Sequence is migrate → hydrate → render so the
    // freshly-uploaded rows are read back through the normal reconciliation
    // path and the UI re-renders from a single canonical source.
    //
    // Phase 5: with the offline cache rendered, reconcile against
    // Supabase in the background. The hydrate call awaits the
    // projects + todos pull, picks last-write-wins on `updated_at`
    // for divergent rows, rewrites `allProjects` in place, and
    // dispatches the `listLogicHydrated` event main.js listens for
    // to do a one-shot full re-render. Once the data settles,
    // subscribe to realtime so incoming server changes flow into the
    // UI without a refresh. Errors inside hydrate already get
    // console.warn'd; the .catch() here is belt-and-suspenders so
    // an unexpected rejection can't take down the page load.
    const migratePromise = userId
        ? maybeMigrateLocalToSupabase(userId)
        : Promise.resolve();
    migratePromise
        .then(function() { return listLogic.hydrateFromSupabase(); })
        .then(function() { listLogic.subscribeToRealtime(); })
        .catch(function(e) {
            console.warn('[bootApp] migrate/hydrate/subscribe failed:', e);
        });
}

supabase.auth.getSession().then(function(result) {
    const session = result && result.data && result.data.session;
    if (session) {
        bootApp(session.user && session.user.id);
    } else {
        showAuthModal();
        markAppBooted();               // auth front door is up — stand the watchdog down
    }
}).catch(function() {
    // Network failure on initial session probe — render the modal so
    // the user can manually authenticate; the same probe runs again
    // on the magic-link callback when the URL hash carries the
    // exchanged tokens.
    showAuthModal();
    markAppBooted();                   // auth front door is up — stand the watchdog down
});

supabase.auth.onAuthStateChange(function(_event, session) {
    if (session) {
        hideAuthModal();
        bootApp(session.user && session.user.id);
    } else {
        // Sign-out (or initial-load with no session). Re-render the
        // modal so the chrome behind it stays gated, and let
        // listLogic tear down its realtime subscriptions + clear
        // its in-memory state so the next user can't see the
        // previous user's data.
        try { listLogic.handleSignOut(); } catch (_) { /* noop */ }
        showAuthModal();
        markAppBooted();               // auth front door is up — stand the watchdog down
    }
});


// ── SERVICE WORKER ──
// Installable PWA + offline shell. The worker is emitted as /sw.js by
// workbox-webpack-plugin (InjectManifest). All user data lives in
// localStorage, so cache-first for the shell is sufficient — no runtime
// fetch strategy is needed for data. When a new worker reaches the
// `waiting` state on a subsequent deploy, notify main.js so the footer
// can surface an "update available" cue; clicking the version label
// tells the worker to skipWaiting and reloads the page.
//
// updateViaCache: 'none' tells the browser to bypass the HTTP cache when
// checking sw.js for updates. GitHub Pages serves assets with a 10-minute
// Cache-Control max-age, which would otherwise gate update discovery
// behind that cache lifetime. With 'none', every navigation re-checks
// sw.js against the origin so new builds are found within one page load.
//
// visibilitychange + a periodic interval call registration.update() so
// installed PWAs that stay open in the background for hours/days still
// discover new builds. Navigation alone is not enough on mobile, where
// users frequently re-foreground the app without ever doing a full load.
// A module-level handle to the active SW registration so callers outside the
// register() promise can force an immediate update check rather than waiting
// for the next visibility/hourly poll. Stored alongside the closure
// `registration` the periodic checks use so the exported helper has something
// to act on.
let swRegistration = null;

// Force an immediate `registration.update()` on the stored registration so a
// freshly-deployed worker is discovered now instead of on the next poll. A
// no-op until a registration exists (or where service workers aren't
// supported). The Claude assistant calls this — via a `requestSwUpdateCheck`
// document event so it needn't import this entry module — the moment a run
// ships, so the client stops serving the old cached bundle promptly.
export function requestUpdateCheck() {
    if (swRegistration && typeof swRegistration.update === 'function') {
        try { swRegistration.update(); } catch (_) { /* update() can reject on quota / network */ }
    }
}
document.addEventListener('requestSwUpdateCheck', requestUpdateCheck);

if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (registration) {
            swRegistration = registration;
            if (registration.waiting) {
                notifyUpdateAvailable(registration);
            }
            registration.addEventListener('updatefound', function () {
                const installing = registration.installing;
                if (!installing) return;
                installing.addEventListener('statechange', function () {
                    if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                        notifyUpdateAvailable(registration);
                    }
                });
            });

            function checkForUpdate() {
                if (typeof registration.update === 'function') {
                    try { registration.update(); } catch (_) { /* update() can reject on quota / network */ }
                }
            }

            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'visible') checkForUpdate();
            });

            // Hourly poll catches the case where the tab stays visible for
            // a long session and no visibilitychange ever fires.
            setInterval(checkForUpdate, 60 * 60 * 1000);
        }).catch(function () { /* registration can fail on file:// or insecure origins */ });

        // Whether a worker already controlled this page when it loaded. The
        // new worker now calls clients.claim() on activate (see sw.js), which
        // fires controllerchange — but on a first-ever install (no prior
        // controller) reloading would be a pointless flash since the page is
        // already running the current build. Only a genuine UPDATE, where a
        // controller existed at load and a new worker then took over, warrants
        // the reload into the new version.
        const hadControllerAtLoad = !!navigator.serviceWorker.controller;
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
            if (!hadControllerAtLoad) return;
            if (reloading) return;
            reloading = true;
            // The new build is now controlling the page, so any "update ready"
            // nudge is obsolete. Announce that the update applied before we
            // reload so listeners clear the cue and a stale flag never outlives it.
            document.dispatchEvent(new CustomEvent('appUpdateApplied'));
            window.location.reload();
        });
    });
}


// ── SUPABASE RE-HYDRATE TRIGGERS ──
// The app hydrates once on boot, then relies on the realtime subscription for
// live updates. A backgrounded tab — a suspended mobile PWA, a sleeping
// desktop tab — can silently drop or miss realtime events, so moving between
// phone and desktop can leave stale data with nothing to trigger a catch-up.
// Two triggers call listLogic.hydrateFromSupabase(), which runs a last-write-
// wins reconcile and dispatches `listLogicHydrated` for an in-place re-render
// (no scroll jump, no lost input) — deliberately NOT a location.reload(),
// which would interrupt an in-progress edit:
//
//   1. Return-to-visible (primary): a visibilitychange where the tab becomes
//      visible re-hydrates the instant the PWA is foregrounded or the desktop
//      tab is refocused — exactly the seam where cross-device data goes stale.
//   2. Backstop interval: a 5-minute re-hydrate covers a tab that stays
//      continuously visible for a long stretch while the socket quietly dropped.
//
// Both skip the pull when an editable element is focused so a background
// re-render never discards a task edit in progress; the next interval (or the
// next visibility regain after blur) catches it up. hydrateFromSupabase
// early-returns without a session and single-flights overlapping calls, so the
// triggers are safe to arm unconditionally and a tick that races a visibility
// regain just short-circuits.
//
// This wiring is kept independent of the service-worker block above — it's a
// data concern, not an SW one, and decoupling it avoids disturbing the
// SW-update visibility/interval pins. The 5-minute setInterval here sits AFTER
// the hourly SW-update setInterval so the latter stays the first setInterval in
// this file (a test asserts the first interval is ≥ 15 min).
function isEditableElementFocused() {
    const el = document.activeElement;
    if (!el || typeof el.matches !== 'function') return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.matches('[contenteditable]');
}

function rehydrateUnlessEditing() {
    if (isEditableElementFocused()) return;
    try {
        listLogic.hydrateFromSupabase();
    } catch (_) { /* hydrate guards its own errors; belt-and-suspenders */ }
}

// On wake (return-to-visible), pair the re-hydrate with a realtime
// re-subscribe: the re-hydrate backfills whatever was missed during the
// background gap, and resubscribeToRealtime re-opens the channels so live
// cross-device push resumes going forward (a backgrounded PWA or sleeping
// tab can silently drop the websocket with no recovery). resubscribe is
// a no-op when signed out and not gated on editing — re-opening channels
// never discards in-progress input.
function wakeRecoverRealtime() {
    try {
        listLogic.resubscribeToRealtime();
    } catch (_) { /* resubscribe guards its own errors; belt-and-suspenders */ }
}

document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') rehydrateUnlessEditing();
    if (document.visibilityState === 'visible') wakeRecoverRealtime();
});

// A network drop/restore that didn't involve backgrounding (e.g. wifi
// blip on a continuously-visible tab) also leaves the socket dead — catch
// it via the online event so live push recovers there too.
window.addEventListener('online', function () {
    rehydrateUnlessEditing();
    wakeRecoverRealtime();
});

// Waking a sleeping or unlocking a locked desktop is the gap the other
// triggers miss: sleep/lock frequently doesn't toggle document visibility
// (so visibilitychange never fires), the backstop setInterval is suspended
// while the machine sleeps and won't tick until its next boundary after wake
// (up to 5 min), and `online` only fires if the browser registered a network
// drop. The reliable signal for returning to a woken/unlocked desktop is the
// window regaining focus, so run the same re-hydrate + realtime re-subscribe
// pair the visibility handler does. The mid-edit guard inside
// rehydrateUnlessEditing still skips the pull when an editable element is
// focused, and hydrateFromSupabase single-flights overlapping calls, so a tab
// switch that fires both visibility and focus is harmless.
window.addEventListener('focus', function () {
    rehydrateUnlessEditing();
    wakeRecoverRealtime();
});

setInterval(rehydrateUnlessEditing, 5 * 60 * 1000);



// ******** PROJECT TIPS ********
// 1 - define todo objects in own module
//     should have the following properties, title, description,
//     dueDate, and priority. later include notes & checklist

// 2 - should have projects or separate lists of 'todo's'

// 3 - Keep Application Logic separated form DOM-related changes

// 4 - toDo list should be able to do the following,
//     1. view all projects
//     2. view all todos in each project (probably just the title and duedate… perhaps changing color for different priorities)
//     3. expand a single todo to see/edit its details
//     4. delete a todo


// ******** LOADING STORAGE ********
// 1. SET - Figure out how to store data (within storage ie LocalStorage()) populated within array
//
// 2. GET - Figure out how to display that information from session -> session
//
//
//
