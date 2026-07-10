# Task Manager PWA

Offline-first task management as an installable Progressive Web App — projects, recurring tasks, realtime multi-device sync, a built-in Pomodoro timer, and an in-app Claude assistant that drafts and ships its own backlog.

![Tests](https://github.com/rsterenchak/toDoList_TOP/actions/workflows/test.yml/badge.svg)

---

## Onboarding a repo into the routine

The routine reads a repo's `TODO.md`, opens a PR implementing each entry, and auto-merges it. `onboard.sh` (in the **`claude-routine-template`** repo) scaffolds a repo into it — it's shape-aware, and if your `gh` CLI is authenticated it also sets most of the GitHub settings for you. The rest is a handful of one-time credentials.

**Already-wired repo** — nothing to set up: open the PWA, switch the workspace picker to the repo, and inject an entry (or paste into `TODO.md` on `main`). The next run opens the PR and merges it.

### New repo — the fast path

**0. Preconditions.** onboard runs your *local* `onboard.sh` for detection and fetches the scaffold fresh from `claude-routine-template` **main**, so both have to be current:

```bash
grep -c 'SHAPE="sql"' onboard.sh   # local script up to date? want >= 1
curl -fsI https://raw.githubusercontent.com/rsterenchak/claude-routine-template/main/scripts/gen-src-manifest.js   # template pushed? want 200
```

**1. Scaffold.** Fill `NAME`/`SHAPE` and paste. The `( set -e … )` subshell stops at the first real error instead of cascading into misleading noise:

```bash
NAME=SQL_shape_test    # exact repo name
SHAPE=sql              # repo-only | console | desktop | maui | sql | web-build | web-served

( set -e
cd /workspaces

# clone if it exists, else create. NOTE: --clone is a BOOLEAN flag — no trailing
# dir arg (the trailing "$NAME" was the "accepts at most 1 arg(s)" bug).
if gh repo view "rsterenchak/$NAME" >/dev/null 2>&1; then
  [ -d "$NAME/.git" ] || gh repo clone "rsterenchak/$NAME"
else
  gh repo create "rsterenchak/$NAME" --private --clone
fi
[ -d "$NAME/.git" ] || { echo "!! $NAME dir not created — read the gh error above."; exit 1; }
cd "$NAME"

case "$SHAPE" in                       # seed a minimal fixture for the shape
  repo-only)  : ;;
  console)    dotnet new console ;;
  desktop)    dotnet new winforms ;;
  maui)       dotnet new maui ;;       # needs: dotnet workload install maui
  sql)        mkdir -p migrations; [ -e schema.sql ] || printf 'CREATE TABLE example (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    name TEXT NOT NULL\n);\n' > schema.sql ;;
  web-build)  printf '{"name":"web","scripts":{"build":"vite build","test":"vitest run --passWithNoTests"},"devDependencies":{"vite":"^5","vitest":"^2"}}' > package.json; echo 'export default {}' > vite.config.js; printf '<!doctype html><script type="module" src="/src/main.js"></script>' > index.html; mkdir -p src; echo 'console.log(1)' > src/main.js ;;
  web-served) printf '<!doctype html><h1>served</h1>' > index.html; mkdir -p src; echo 'console.log(1)' > src/app.js ;;
esac
[ -e README.md ] || echo "# $NAME ($SHAPE)" > README.md

git add -A && git commit -q -m fixture 2>/dev/null || true
git branch -M main
git push -u origin main                # 403 in a Codespace? see "Codespace push auth" below, then re-run

cd /workspaces/claude-routine-template && ./onboard.sh "../$NAME"
)
```

This clones or creates the repo, seeds a fixture for the shape, and runs onboard. If `gh` is authenticated, onboard also sets read-write workflow permissions, the Pages source, and offers to add your secrets — so steps 3–4 may already be done for you.

**2. Confirm the files reached `main`.** The one step that bites: onboard's own `git push` can 403 silently in a Codespace, leaving the scaffold local-only. Check what's actually on `main`:

```bash
gh api repos/rsterenchak/<repo>/contents --jq '.[].path'   # want manifest.yml, scripts/, claude-run.yml…
```

Only your original files? onboard's push didn't land — see **Troubleshooting → Codespace push auth**, then `git add -A && git commit -m scaffold && git push`.

**3. Grant access** (per repo, quick):
- Install the Claude GitHub app on the repo — https://github.com/apps/claude
- Add the repo to your worker PAT (**Contents: write, Actions: read + write**) — https://github.com/settings/personal-access-tokens

**4. Settings** — onboard's `gh` path sets these; do them by hand only if it didn't:
- **Actions → General → Workflow permissions:** "Read and write" *and* tick "Allow GitHub Actions to create and approve pull requests."
- **Pages → Deploy from a branch:** `web-build` → `gh-pages` / root; every other manifest shape (`web-served`, `console`, `desktop`, `maui`, `sql`, `doc`) → `main` / root; `repo-only` → skip.
- **Secrets:** `CLAUDE_CODE_OAUTH_TOKEN` (always); `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (the legacy service_role JWT) if the repo runs triage.

**5. Register with the worker.** Add the line onboard printed to `ALLOWED_TARGETS` in `todo-injector-worker/src`, then `wrangler deploy` — the allowlist only takes effect once the worker redeploys. `srcPrefix` is `"src/"` for web, the project subfolder for .NET, and `""` for `sql` / `doc` / `repo-only`.

**6. Verify + smoke-test.**

```bash
curl -fsI https://rsterenchak.github.io/<repo>/src-manifest.json   # want 200 (every shape but repo-only)
```

Inject a trivial entry in the PWA — the PR should open and merge (`sql` / `doc` / `repo-only` auto-merge with no CI; the code shapes merge once tests pass).

### Shape reference

`onboard.sh` detects the shape and scaffolds the matching files; override at the prompt if it guesses wrong.

| Shape | Detected from | Publishes | Structure lens |
|---|---|---|---|
| `web-build` | bundler config + build script | Pages `gh-pages` (built output) | Code + UI |
| `web-served` | no build; root `index.html` / `src/` | Pages `main` | Code + UI |
| `console` | `.csproj` / `.sln`, cross-platform | Pages `main` (manifest only) | Code + Types |
| `desktop` | WinForms / WPF (`net*-windows`) | Pages `main` (manifest only) | Code + Types |
| `maui` | `UseMaui` or an `-android` TFM | Pages `main` (manifest only) | Code + Types |
| `sql` | `.sql` files, no `package.json` | Pages `main` (manifest only) | Code + SQL |
| `doc` | a `docs/` dir or ≥ 2 `.md` files, no code | Pages `main` (manifest only) | Code |
| `repo-only` | none of the above | — | — |

CI on push: `desktop` on Windows, `maui` builds the Android head, the other code shapes on ubuntu; `sql` / `doc` / `repo-only` have none.

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

## Troubleshooting

**Codespace push auth (the recurring 403).** A Codespace's pinned `GITHUB_TOKEN` is scoped to the repo it *launched* from, not your target — so `git push` (and onboard's internal push) 403 with `Permission … denied`. Fix it, then verify before pushing:

```bash
unset GITHUB_TOKEN && gh auth status   # "not logged in"? run: gh auth login  (GitHub.com → HTTPS → browser)
gh auth setup-git
git -C <repo> ls-remote origin >/dev/null && echo "AUTH OK"   # proves write access BEFORE you push
```

Make it stick across new terminals: `echo 'unset GITHUB_TOKEN' >> ~/.bashrc`. (Sibling: `git config --local --unset commit.gpgsign` if commits fail on GPG signing.)

**onboard wrote files but nothing's on `main`.** Its push is guarded with `2>/dev/null`, so a 403 is swallowed — the scaffold is local-only, and re-running skips it as "already exists" while pushing nothing (a no-op loop). Never trust onboard's exit; confirm with `gh api repos/<owner>/<repo>/contents`. A bare `git push` reporting *"Everything up-to-date"* means the files were never **committed** — stage them: `git add -A && git commit -m scaffold && git push`.

**Cascading `not a git repository` / `target is not a directory`.** A chained `cmd; cmd; cmd` line barrels past its first error, so you see downstream noise instead of the root cause (the repo dir was never created — read the line *above* the cascade). Run steps individually, or use the `( set -e … )` subshell, which halts at the real failure and says why.

**Manifest 404s.** `curl -fsI https://<owner>.github.io/<repo>/src-manifest.json` — read the 404 body: **~9KB of HTML with a GitHub CSP header** means Pages is serving but the manifest isn't committed yet (workflow hasn't run, or failed); **no HTML body** means Pages isn't enabled (step 4). Then check `gh run list --repo <owner>/<repo>` — a **red run** is almost always missing read-write permissions (the commit-back to `main` 403s); a **green run** just needs a minute for Pages to redeploy.

**PR opens but won't auto-merge.** The "Allow GitHub Actions to create and approve pull requests" toggle is off (step 4).

**Inject 403s.** Either the worker PAT lacks access to the repo (step 3), or you updated `ALLOWED_TARGETS` without running `wrangler deploy` (step 5).

**OAuth token vs. PAT — two different credentials.** `CLAUDE_CODE_OAUTH_TOKEN` (step 4) authenticates Claude *inside* the run; the PAT access-list entry (step 3) lets the worker *reach* the repo. Setting one does not cover the other.

**Routine or config changes go straight to `main`** — don't route them through the pipeline. It ships backlog entries, not its own scaffolding.

---

## Author

Robert Sterenchak — solo developer.
