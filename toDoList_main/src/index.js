import _, { remove } from 'lodash';
import './style.css';
import './manifest.webmanifest';
import './favicon.svg';
import { component, restoreFromStorage, notifyUpdateAvailable } from './main.js';
import { listLogic } from './listLogic.js';
import Icon from './icon.png';
import button from './addProj_button.svg';


document.body.appendChild(component()); // build and attach DOM

restoreFromStorage();                   // now that DOM is live, restore saved projects


// ── SERVICE WORKER ──
// Installable PWA + offline shell. The worker is emitted as /sw.js by
// workbox-webpack-plugin (InjectManifest). All user data lives in
// localStorage, so cache-first for the shell is sufficient — no runtime
// fetch strategy is needed for data. When a new worker reaches the
// `waiting` state on a subsequent deploy, notify main.js so the footer
// can surface an "update available" cue; clicking the version label
// tells the worker to skipWaiting and reloads the page.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').then(function (registration) {
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
