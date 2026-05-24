import _, { remove } from 'lodash';
import './style.css';
import './manifest.webmanifest';
import './favicon.svg';
import { component, restoreFromStorage, notifyUpdateAvailable } from './main.js';
import { listLogic } from './listLogic.js';
import { maybeStartFirstRunCarousel } from './welcomeCarousel.js';
import { supabase } from './supabaseClient.js';
import { showAuthModal, hideAuthModal } from './auth.js';
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
let booted = false;
function bootApp() {
    if (booted) return;
    booted = true;
    restoreFromStorage();              // now that DOM is live, restore saved projects
    // First-run welcome carousel for mobile new users. The flag check and
    // (pointer: coarse) / viewport detection live inside maybeStartFirstRunCarousel
    // so callers don't need to know the gating rules; runs after restoreFromStorage
    // so the seeded sample project is already on screen when the closer card lands.
    // Desktop falls through to the existing coachmark tour started inside
    // restoreFromStorage.
    maybeStartFirstRunCarousel();

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
    listLogic.hydrateFromSupabase()
        .then(function() {
            listLogic.subscribeToRealtime();
        })
        .catch(function(e) {
            console.warn('[bootApp] hydrate/subscribe failed:', e);
        });
}

supabase.auth.getSession().then(function(result) {
    const session = result && result.data && result.data.session;
    if (session) {
        bootApp();
    } else {
        showAuthModal();
    }
}).catch(function() {
    // Network failure on initial session probe — render the modal so
    // the user can manually authenticate; the same probe runs again
    // on the magic-link callback when the URL hash carries the
    // exchanged tokens.
    showAuthModal();
});

supabase.auth.onAuthStateChange(function(_event, session) {
    if (session) {
        hideAuthModal();
        bootApp();
    } else {
        // Sign-out (or initial-load with no session). Re-render the
        // modal so the chrome behind it stays gated, and let
        // listLogic tear down its realtime subscriptions + clear
        // its in-memory state so the next user can't see the
        // previous user's data.
        try { listLogic.handleSignOut(); } catch (_) { /* noop */ }
        showAuthModal();
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
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (registration) {
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

        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
            if (reloading) return;
            reloading = true;
            window.location.reload();
        });
    });
}



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
