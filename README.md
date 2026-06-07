# Project and Task Manager Application

![Tests](https://github.com/rsterenchak/toDoList_TOP/actions/workflows/test.yml/badge.svg)

## Overview

This project is a simple front-end task management application built as part of CS307 (Software Engineering). The main goal of the application is to allow users to create projects and manage tasks within those projects.

The core feature implemented is the ability to add and edit tasks, including updating task titles, descriptions, and due dates. The application is designed to be lightweight and focused on basic task organization.

---

## Claude run pipeline — adding repos

Quick reference for wiring a new or existing repo into the routine that reads `TODO.md`, opens a PR, and auto-merges.

### Existing repo (already wired)

1. Open the PWA, switch the workspace picker to the target repo.
2. Inject a TODO entry (or paste directly into `TODO.md` on `main`).
3. The next run picks it up — watch for the PR to open and auto-merge.

### New repo (first-time setup)

Roughly 7 steps. Order matters for steps 1–3.

1. **Scaffold the pipeline files.** From the `todo-injector-worker` repo, run `./onboard.sh` against the target repo. It drops in `.claude/routine.md`, `.claude/routine-base.md`, `.github/workflows/claude-run.yml`, `test.yml`, `deploy.yml`, `CLAUDE.md`, and an initial `TODO.md`. Review and commit directly to `main`.

2. **Install the Claude GitHub app** on the new repo: https://github.com/apps/claude — grant access to just this repo.

3. **Add the PAT secret.** Settings → Secrets and variables → Actions → New repository secret. Name matches what `claude-run.yml` expects (check the workflow file). PAT scoped to `Actions: read+write`.

4. **Set workflow permissions.** Settings → Actions → General → Workflow permissions → **"Read and write permissions"**. New repos default to read-only; without this, `deploy.yml` 403s on `gh-pages` push and `claude-run.yml` 403s on PR auto-merge.

5. **Configure Pages.** Settings → Pages → Source: "Deploy from a branch", branch `gh-pages`, folder `/ (root)`. (If the project deploys from `main` instead, use that with `/ (root)`.)

6. **Register the repo with the worker.** Edit `ALLOWED_TARGETS` in `todo-injector-worker/src` to include the new repo (`owner/repo`). Then `wrangler deploy` from the worker's directory — the allowlist won't take effect until the new worker is live.

7. **Add the repo as an inject target in the PWA**, then smoke-test by injecting a trivial entry (e.g. "Add a comment to README.md saying 'Pipeline verified'"). If the PR opens, tests pass, and it auto-merges — you're integrated.

### Gotchas that bit on first runs

* **Workflow permissions** (Step 4) and **Pages source** (Step 5) are repo settings, not files — easy to forget because they don't come from `onboard.sh`. 403s on deploy or auto-merge are almost always one of these.
* **Worker `ALLOWED_TARGETS` is hardcoded** and requires `wrangler deploy` to take effect. Adding the repo in the PWA without updating + deploying the worker first will fail at inject time.
* **Direct commits to `main` for routine/config changes** — don't route them through the pipeline. The pipeline ships backlog entries, not its own scaffolding.

---


---

## Live Application

You can access the deployed application here:
https://rsterenchak.github.io/toDoList_TOP/

---

## Features

* Create and manage multiple projects
* Add new tasks to a project
* Edit task titles
* Edit task descriptions
* Assign due dates to tasks
* Delete tasks
* Persist data using localStorage

---

## Technologies Used

* JavaScript (ES Modules)
* HTML
* CSS
* localStorage (for data persistence)

---

## Project Structure

* **main.js**
  Handles DOM creation, event listeners, and user interaction

* **listLogic.js**
  Manages all project and task data using the `allProjects` object

* **toDo.js**
  Factory function used to create task objects

---

## How It Works

User input is captured through the UI and handled by event listeners in `main.js`. When a task is created or updated, the data is passed into the `listLogic` module, which updates the correct project inside the `allProjects` object.

Each task is created using the `toDo` factory function, which ensures all task objects follow the same structure. After updates are made, the data is saved to `localStorage`, and the UI is re-rendered to reflect the changes.

---

## Google Drive Export Setup

The "Export to Drive" menu item requires an OAuth 2.0 Client ID provisioned in the Google Cloud Console (see the comment block at the top of `toDoList_main/src/driveExport.js` for step-by-step instructions). The Client ID is injected at build time from the `GOOGLE_OAUTH_CLIENT_ID` environment variable — it is **never** committed to source.

* **Production (GitHub Pages):** add `GOOGLE_OAUTH_CLIENT_ID` as a repository secret under *Settings → Secrets and variables → Actions*. The deploy workflow forwards it to the build step automatically.
* **Local development:** export it in your shell before `npm start`:
  ```
  export GOOGLE_OAUTH_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
  npm start
  ```
  Without the env var, the menu item appears but surfaces a "Drive export not configured for this build" toast — the rest of the app works normally.

---

## PWA updates

The app installs as a Progressive Web App. The service worker (built by `workbox-webpack-plugin`'s `InjectManifest` and emitted as `dist/sw.js`) precaches the app shell, so installed clients load instantly and work offline. When a new build is deployed, installed clients need to discover the update, fetch it, and reload — this section documents that flow so future contributors know the contract.

### Update lifecycle

1. **Build deployed.** A new `sw.js` ships with a fresh precache manifest. The HTML, JS, CSS, and other assets it lists also change.
2. **Update discovery.** The currently-installed worker calls `registration.update()` on three triggers:
   * Each `visibilitychange` event where the tab becomes visible (handles re-foregrounding the app after sleep, app switching, or screen-off on mobile).
   * An hourly `setInterval` poll (handles long-lived tabs that stay visible without any visibility transition).
   * The initial `load` event on every navigation.
   The worker is registered with `updateViaCache: 'none'`, which tells the browser to bypass its HTTP cache when re-checking `sw.js`. GitHub Pages serves assets with a 10-minute `Cache-Control` max-age, so without this option update discovery would be gated behind that lifetime; with it, every check goes to the origin.
3. **New worker installs.** The browser downloads the new `sw.js`, runs `install`, precaches the new asset manifest, and parks the worker in the `waiting` state (because the old worker still controls open clients).
4. **Cue surfaces.** `notifyUpdateAvailable(registration)` fires in `src/modals.js`. It writes a "hasUpdate" class onto the desktop footer's version pill and dispatches an `appUpdateAvailable` `CustomEvent` on `document`. The mobile Settings modal's About → Version row and the mobile chrome's gear button both listen for the event and flip into their "update available" appearance — so the cue surfaces on every layout, not just desktop.
5. **User taps the cue.** `applyPendingUpdate()` posts `{ type: 'SKIP_WAITING' }` to the waiting worker.
6. **Worker activates.** The waiting worker calls `self.skipWaiting()` (handled in `src/sw.js`), the browser activates it, and `controllerchange` fires on every open client.
7. **Page reloads.** A one-shot `controllerchange` listener in `src/index.js` calls `window.location.reload()`, the page comes back up under the new worker, and the cue clears.

The contract: in the worst case, an installed client picks up a new build on the second navigation or the next `visibilitychange` after the build is live, whichever comes first.

### Validating updates empirically

The mechanics above are exercised by unit tests in `toDoList_main/tests/serviceWorkerUpdate.test.js`, but the full lifecycle depends on real browser behavior (especially `controllerchange` semantics, which differ subtly across engines). When making changes to the service-worker registration, the update cue, or the cache strategy, validate on at least:

* **Desktop Chrome** — installed PWA from `chrome://apps`. The most forgiving environment; expect updates to appear within one visibility change.
* **iOS Safari** — home-screen-installed PWA. iOS has documented quirks around `skipWaiting` and `controllerchange` in standalone display mode; confirm `controllerchange` actually fires after `SKIP_WAITING` and that the reload happens automatically (vs. requiring a manual swipe-down refresh).
* **Android Chrome** — installed PWA via the install prompt. Generally behaves like desktop Chrome but worth confirming on a real device since the install scope and storage isolation differ.

For each platform, the validation step is: deploy a known version bump, open the installed PWA, and confirm the cue appears within the contract (at most one navigation or visibility change after the new build is live), and that tapping it reloads the page into the new worker.

### Asset filename hashing

`webpack.config.js` currently emits bundles as `[name]bundle.js` with no content hash. Content hashing is **not required** for update discovery: Workbox's `InjectManifest` tracks asset revisions independently in the precache manifest baked into `sw.js`, so every new build produces a new `sw.js` whose precache list invalidates the old caches regardless of filename. Hashing would improve long-term HTTP caching for unchanged assets across deploys, but until that becomes a measurable problem, the simpler unhashed filenames are kept.

---

## Testing

Testing was performed manually by interacting with the application. This included:

* Creating tasks
* Editing titles and descriptions
* Assigning due dates
* Deleting tasks
* Refreshing the page to verify data persistence

The application was also tested for basic edge cases such as empty inputs and duplicate task entries.

---

## Known Limitations

* No input validation for empty or duplicate tasks
* No user authentication or multi-user support
* Priority and task assignment features are not fully implemented

---

## Future Improvements

* Add input validation for task creation
* Implement task prioritization
* Add user authentication for multi-user support
* Improve UI/UX for better usability

---

## Author

Robert Sterenchak
CS307 - Software Engineering
