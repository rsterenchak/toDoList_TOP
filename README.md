# Task Manager PWA

Offline-first task management as an installable Progressive Web App — projects, recurring tasks, realtime multi-device sync, a built-in Pomodoro timer, and an in-app Claude assistant that drafts and ships its own backlog.

![Tests](https://github.com/rsterenchak/toDoList_TOP/actions/workflows/test.yml/badge.svg)

---

## Overview

A personal, offline-first task manager built as an installable PWA. Projects and tasks live in **Supabase** (Postgres) with realtime sync across devices, the app installs to the home screen and works offline, and an **in-app Claude assistant** can draft backlog entries that flow through an automated pipeline which opens and auto-merges its own pull requests.

It's built and maintained solo — a daily-driver tool first, and a sandbox for trying out full-stack architecture ideas second. The UI is a dark "Void" theme with a keyboard-first interaction model (add with `Enter`, arrow-key navigation across rows and panes).

---

## Live Application

https://rsterenchak.github.io/toDoList_TOP/

---

## Features

**Tasks & projects**

* Multiple projects, each with its own task list
* Tasks with titles, descriptions, due dates, and completion
* Drag-and-drop reordering
* Recurring tasks (advance-on-check) with a per-task completion stats drawer
* Three views — **Projects**, **Today**, and **Calendar**
* Keyboard-first: add with `Enter`, arrow-key navigation across rows and panes

**Sync & data**

* Supabase Postgres as the source of truth, with per-user row-level security
* Realtime sync across devices and tabs (self-echo filtered)
* Passwordless **magic-link** authentication
* Offline-first: localStorage cache plus first-login migration of any pre-auth data
* Google Drive export

**Focus tools**

* Pomodoro timer — Focus / Short / Long modes, inline-editable countdown, audio + browser-notification alerts, survives a page refresh
* A ghost "study companion" that wanders and studies alongside the timer
* Built-in focus-music stations (YouTube-backed)

**In-app Claude assistant**

* Chat panel that can draft `TODO.md` backlog entries
* One-tap **Inject & run** dispatches an automated pipeline run that opens a PR and auto-merges
* A **Runs** tab tracks each dispatch QUEUED → RUNNING → SHIPPED

**Platform**

* Installable PWA — works offline, with an in-app update flow
* Two-pane desktop layout (task list + persistent chat); mobile bottom tab bar + bottom sheets
* Changelog and stats modals

---

## Tech Stack

* **Language:** Vanilla JavaScript (ES modules) — no UI framework
* **Build:** Webpack 5 + Babel
* **PWA:** Workbox (`workbox-webpack-plugin` `InjectManifest`) service worker
* **Data:** Supabase — Postgres + Realtime + Auth (magic link), per-user RLS
* **Backend proxy:** Cloudflare Worker (Wrangler) — GitHub Contents API operations and the in-app Claude chat surface
* **Tests:** Vitest + jsdom
* **CI/CD:** GitHub Actions, deployed to GitHub Pages
* **Client storage:** localStorage (offline cache of project data + device-scoped UI prefs)

---

## Architecture

All projects and tasks live in an in-memory model (`allProjects`) backed by Supabase Postgres, which is the source of truth. Every user mutation updates memory, writes a localStorage cache, and mirrors the change to Supabase. Access is scoped per user by row-level security — the `todos` table has no `user_id` column, so ownership is enforced via a sub-select against the parent `projects` row.

On load, the cached snapshot renders immediately, then reconciles against Supabase using last-write-wins on `updated_at`, then subscribes to a realtime channel so changes made on other devices or tabs appear without a refresh (the client filters echoes of its own writes). The service worker precaches the app shell so the app opens instantly and works offline.

A passwordless magic-link sign-in gates the app. On a user's first sign-in on a given device, any pre-auth local data is migrated up to Supabase (cloud wins if both sides hold data); sign-out wipes that user's local data while preserving device-scoped UI prefs.

A Cloudflare Worker proxies GitHub Contents API operations and backs the in-app Claude chat. From chat, a drafted entry can be injected into `TODO.md` and dispatched to an automated routine that opens a pull request, runs the test suite, and auto-merges — see the pipeline section below. Webpack bundles the app, GitHub Actions builds and deploys it to GitHub Pages, and Workbox emits the precaching service worker.

---

## Project Structure

Representative module map (`toDoList_main/src/`). `main.js` is the app's spine and is being progressively decomposed into the focused modules below.

**Core & data**

* `listLogic.js` — in-memory model (`allProjects`) + Supabase persistence + realtime
* `toDo.js` — task factory
* `supabaseClient.js` — Supabase client (with a test stub for jsdom)
* `auth.js` — magic-link sign-in modal and auth gate
* `migration.js` — first-login localStorage → Supabase migration + sign-out wipe

**UI & interaction**

* `main.js` — DOM construction, layout shells, and event wiring
* `toDoRow.js` / `dueDate.js` / `dragDrop.js` — task rows, due-date & recurrence popovers, drag reorder
* `claudeSheet.js` — in-app Claude chat + Runs panel
* `inject.js` — TODO.md inject + pipeline dispatch/status (via the Worker)
* `modals.js` / `changelog.js` — modals, update cue, changelog
* `pomodoro.js` / `companion.js` — focus timer and ghost companion
* `driveExport.js` — Google Drive export
* `index.js` / `sw.js` — entry point and service worker

**Build & infra**

* `webpack.config.js` — bundling + Workbox service-worker generation
* `tests/` — Vitest + jsdom suite
* `.github/workflows/` — CI plus the Claude run pipeline

---

## Testing

Automated testing runs on a **Vitest + jsdom** suite, executed in CI on every push (the badge above tracks it). Coverage spans model and persistence logic, the service-worker update lifecycle (`tests/serviceWorkerUpdate.test.js`), and mobile layout invariants — for example, a test pins task inputs at a 16px+ font size to prevent iOS Safari's auto-zoom-on-focus.

Because the full PWA update lifecycle depends on real browser behavior (especially `controllerchange` semantics, which differ across engines), it's also validated manually on Desktop Chrome, iOS Safari, and Android Chrome — see the **PWA updates → Validating updates empirically** section below for the per-platform checklist.

---

## Claude run pipeline — adding repos

Quick reference for wiring a new or existing repo into the routine that reads `TODO.md`, opens a PR, and auto-merges.

### Existing repo (already wired)

1. Open the PWA, switch the workspace picker to the target repo.
2. Inject a TODO entry (or paste directly into `TODO.md` on `main`).
3. The next run picks it up — watch for the PR to open and auto-merge.

### New repo (first-time setup)

Roughly 7 steps. Order matters for steps 1–3.

1. **Scaffold the pipeline files.** From the `claude-routine-template` repo, run `./onboard.sh` against the target repo. It drops in `.claude/routine.md`, `.claude/routine-base.md`, `.github/workflows/claude-run.yml`, `test.yml`, `deploy.yml`, `CLAUDE.md`, and an initial `TODO.md`. Review and commit directly to `main`.

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

## Author

Robert Sterenchak — solo developer.
