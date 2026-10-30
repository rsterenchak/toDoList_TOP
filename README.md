# Void — Task Manager PWA

An offline-first, installable task manager that also understands and ships its own code. Projects and tasks sync across devices in realtime; a built-in Claude assistant drafts backlog entries, triages them against the live source, opens pull requests and auto-merges them; and an **Understanding** tab turns any onboarded repo into a readable book with guided tours.

[![Tests](https://github.com/rsterenchak/toDoList_TOP/actions/workflows/test.yml/badge.svg)](https://github.com/rsterenchak/toDoList_TOP/actions/workflows/test.yml)
[![Deploy](https://github.com/rsterenchak/toDoList_TOP/actions/workflows/deploy.yml/badge.svg)](https://github.com/rsterenchak/toDoList_TOP/actions/workflows/deploy.yml)

**Live:** https://rsterenchak.github.io/toDoList_TOP/

Built and maintained solo. It's a daily-driver tool first and a sandbox for full-stack and agentic-workflow ideas second — vanilla JavaScript, no UI framework, with a dark "Void" theme and a keyboard-first interaction model.

---

## Contents

- [Signed in vs offline](#signed-in-vs-offline)
- [The three tabs](#the-three-tabs)
- [The agent pipeline](#the-agent-pipeline)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Testing](#testing)
- [PWA update contract](#pwa-update-contract)
- [Related repositories](#related-repositories)

---

## Signed in vs offline

The sign-in gate has two doors, and which one you take decides how much of the app you get.

| | Signed in | Offline (no account) |
|---|---|---|
| How you get in | Passwordless magic link to an e-mail on the allowlist — sign-up is restricted | **Use offline on this device**, the outlined button under the sign-in form |
| Where your data lives | Supabase, with a localStorage cache; edits sync across devices in realtime | This browser's localStorage only — nothing leaves the device, nothing syncs |
| What you see | All three tabs, the assistant, the agent pipeline, Models, the TODO.md viewer, the ghost | The **Stream** tab only: projects, tasks, filters and sort, Today and Calendar, plain quick capture, and the focus tools (Pomodoro, focus mode, music, the footer companion) |
| Backup | The cloud is the copy | **Settings → Export to JSON**; a one-line reminder appears above the list after 7 days without an export |
| Remembered? | Yes — the device boots signed in until you sign out | Yes — the device skips the gate and boots straight into offline mode |

**Switching.** From offline, **Settings → Sign in** raises the gate again; when a session lands, the device flips to account mode, reloads, and the first signed-in boot migrates the offline projects and tasks up to Supabase (cloud wins on conflict). **Sign out** wipes that user's data from the device, keeps device preferences, and shows the gate — from there either door is open again. Exports made offline can be imported into a signed-in device and vice versa.

**What offline hides, and why.** Everything that reads or writes through the Worker or a linked repo — Understanding, Structure, chat, Generate / Inject / Discuss on a task, the Runs and Models panels, repo setup, split-into-tasks capture — is absent, not merely greyed out: none of it mounts, and no request fires. Signed-in use of those surfaces is additionally admin-only on the Worker side; a signed-in account that isn't an admin sees them but gets *Your account isn't an admin* when it tries.

**Two meanings of "offline".** This section is about running *without an account*. Separately, the installed app works *without a network* in either mode: the service worker precaches the shell, a signed-in device renders its cached snapshot and reconciles when it reconnects — see [PWA update contract](#pwa-update-contract).

---

## The three tabs

### Stream — tasks

- Multiple projects, each with its own list; **All / In progress / Done** filter and sort; **Projects**, **Today** and **Calendar** views.
- Tasks carry a title, a description (which doubles as the entry the agent ships — see below), due dates, recurrence with a per-task completion-stats drawer, drag-and-drop ordering and a manual status.
- Keyboard-first on desktop: add with `Enter`, arrow keys across rows and panes, `Ctrl/Cmd+Enter` to expand every description.
- Mobile: bottom tab bar, bottom sheets, swipe navigation between projects, a first-run welcome carousel, and **quick capture** — dictate or type a note, have it split into tasks, review them as a checklist and file them into any project.
- Undo toast on destructive actions; confirmation on anything that loses data.

### Understanding — the repo as a book

- Each onboarded repo gets a generated **code book** (`codebook.json` → `src-book.json`): chapters ordered so one read-through gives a working grasp of how everything connects, with tappable symbol chips that open the real code beside the reader.
- Resume card, reading progress and paragraph-level bookmarks sync through Supabase; notes and per-chapter flags live alongside.
- **Guided tours** — step-through walkthroughs of a flow (how the app boots, how the database connects) with forward/back navigation, nested under the chapters they belong to.
- **Chapter-scoped chat** — ask a question about one chapter and the assistant answers from that chapter's files only.
- Stale chapters are flagged when the code they anchor to moves; regeneration runs in CI from a button.

### Structure — the codebase as a map

- A **constellation map** of the repo's areas (from `codemap.json`), drilling into a per-area mini-map and file list; three-pane layout on desktop (areas rail, map, code viewer).
- **Code viewer** with **code trace** — tap a name to jump to its definition, with a trail back.
- Lenses: **Code**, **UI**, **Types**, **SQL** — what's shown depends on the repo's shape.
- **Complexity scanner** with a *Next refactor* card (cheapest-first by dependency order, not file size), a **Run & Capture** card for console-shaped repos, and remote layout capture for guest repos.
- **Coverage** for coursework repos: the assignment rubric's aspects (A1, B2, …) tracked against proposed, accepted and shipped work.

---

## The agent pipeline

Every project can be linked to a GitHub repo that has been onboarded with [`claude-routine-template`](https://github.com/rsterenchak/claude-routine-template). From then on, a task's description *is* its `TODO.md` entry, and the app can ship it without leaving the browser.

```
 you ──► Stream task ──► Generate (triage) ──► entry ──► Inject ──► TODO.md on main
                              │                             │
                      needs words / mockup?                 ▼
                              │                       claude-run.yml
                      escalated? ──► scoped pass       build · test · PR
                      (Fable)                               │
                                                      auto-merge ──► deploy.yml ──► Pages
```

**Roles and billing.** Two Claude roles share the work: a conversational planner (Sonnet, API-billed through the Worker) for chat, drafting and A/B/C mockups, and an agentic builder (Opus by default, Max-plan-billed via Claude Code in Actions) for runs, triage and derive. The **Models** panel picks the model per surface, per repo or globally.

**Ways an entry gets written.**

- **Write** it yourself in the description, with a searchable `File:` picker that fills real repo paths.
- **Paste** an entry drafted elsewhere; the parser checks it.
- **Generate** — flag the task and the **triage sweep** reads the live source and returns one of: a finished draft, a question only you can answer (*needs words*), a park for a visual change (*needs mockup* — the app then generates three mockups to pick from), or **escalated**: intent is clear but the fast pass couldn't root-cause it, so a second, scoped pass on a stronger model picks up from its findings.
- **Chat** with the assistant, attach source files and screenshots, and tap *Inject & run* on the draft it produces. For structural UI moves it first enumerates everything wired to the element (listeners, paired popovers, mount-path registrations) so the entry names what must survive.
- **Derive** — on coursework repos, propose entries from `assignment.md`'s rubric; on personal repos, from `project.md`'s brief and committed mockups.

**Shipping and after.**

- **Inject** appends the entry to `TODO.md` with a stable `<!-- id -->` marker; a screenshot attached to the task is committed beside it as context for the run.
- A run implements exactly one entry, runs the suite, renders the change at the viewports named on its `Verify:` line and inspects the screenshots, opens a PR, and auto-merges with a merge commit. The **Runs** sheet tracks QUEUED → RUNNING → SHIPPED with the shots and verdicts attached.
- **Iterate** — tap a shipped run to open a chat seeded with its diff and fix forward.
- **Revert** — a full-auto in-app rollback that opens and merges a revert PR for the rare change iterate can't cure.
- The **TODO.md viewer** shows the linked backlog as a checklist and can run, revert or redeploy entries directly.

**Focus tools, because it's still a task manager.** A Pomodoro timer (Focus / Short / Long, inline-editable, survives reloads, audio and notification alerts), a desktop **focus mode**, focus-music stations with a visualizer, and a ghost companion that wanders the footer, studies alongside the timer and will talk back when asked.

---

## Tech stack

| Layer | Choice |
|---|---|
| Language | Vanilla JavaScript (ES modules), plain CSS — no UI framework, no preprocessor |
| Build | Webpack 5 + Babel; Workbox `InjectManifest` service worker |
| Data | Supabase — Postgres, Realtime, Auth (magic link), per-user row-level security |
| Backend | Cloudflare Worker (`todo-injector-worker`): GitHub Contents/Actions operations, the chat gateway with prompt caching, model routing across Anthropic (plan or API), OpenCode Go and Vercel AI Gateway lanes |
| Automation | GitHub Actions running Claude Code (`claude-run.yml`, `claude-triage.yml`, `claude-derive.yml`, `claude-book.yml`, `claude-scan.yml`) |
| Tests | Vitest + jsdom, 400+ test files |
| Hosting | GitHub Pages via `deploy.yml` |
| Client storage | localStorage — offline cache of project data plus device-scoped preferences (`todoapp_*`) |

---

## Architecture

**Data model.** Projects and tasks live in an in-memory model (`allProjects` in `listLogic.js`) backed by Supabase, which is the source of truth. Every mutation goes through `listLogic.js` — view files never touch Supabase directly — and each one updates memory, writes the localStorage cache, and mirrors to Postgres through a column-whitelisted `persistMutation`. Ownership is enforced by RLS: the `todos` table carries no `user_id`; access resolves through a sub-select against the parent `projects` row.

**Sync.** On load the cached snapshot renders immediately, then reconciles against Supabase (last-write-wins on `updated_at`), then subscribes to a realtime channel so edits from other devices appear without a refresh; the client filters echoes of its own writes. Returning to the tab re-hydrates and re-subscribes unless an edit is in progress. The agent queue (`agent_queue`), run outputs, book progress and bookmarks ride the same channel.

**Auth and access mode.** A passwordless magic-link sign-in gates the app; an optional PIN lock covers a shared device. First sign-in on a device migrates any pre-auth local data up (cloud wins on conflict); sign-out wipes that user's data and keeps device prefs. The gate's second door, offline mode, is one switch rather than per-feature patches: `accessMode.js` stamps `data-access` on `<html>`, `style.css` hides every Worker-backed surface under `html[data-access="local"]`, and mount sites check `hasAccount()` so nothing in that list is built or requested — a test pins the CSS block and the selector list together. See [Signed in vs offline](#signed-in-vs-offline).

**The Worker.** All Worker calls funnel through `postToWorker` in `inject.js`, carrying the shared secret and the user's Supabase session; the Worker admits PWA routes only for e-mails in its `ADMIN_EMAILS` list, while CI routes stay on the secret alone. The set of repos it may touch is the Supabase `inject_targets` registry, read live — registering a repo needs no redeploy. Chat context layers three mechanisms: an active-repo reframe (`repo`), attached source files (`attach_files`), and an iterate seed (`entry_id` → the merged PR's diff).

**Offline.** The service worker precaches the app shell so the installed app opens instantly without a network; see [PWA update contract](#pwa-update-contract) for how new builds reach installed clients.

---

## Repository layout

```
toDoList_TOP/
├── TODO.md                  the agent-driven backlog (markers link entries to PRs)
├── project.md               the brief the derive pass reads
├── CLAUDE.md                conventions and architecture notes for agent runs
├── docs/                    automation overview, routine spec, porting guide,
│   └── mockups/             approved designs for surfaces not yet built
├── .claude/                 routine-base.md, triage.md, derive.md, book.md…
├── .github/workflows/       test.yml, deploy.yml, claude-*.yml
└── toDoList_main/           the app
    ├── src/                 ~100 ES modules; every module opens with a purpose comment
    ├── tests/               Vitest + jsdom suite
    ├── scripts/             gen-src-manifest.js — builds src-manifest / src-book / src-tours
    ├── codemap.json         module → area map that drives the Structure tab
    ├── codebook.json        the Understanding tab's chapters
    ├── codetour.json        guided-tour steps
    └── webpack.config.js
```

Where to look in `src/` (the Structure tab's areas, in `codemap.json`):

| Area | Load-bearing modules |
|---|---|
| Data | `listLogic.js` (model + persistence + realtime), `supabaseClient.js`, `auth.js`, `migration.js`, `storage.js`, `prefs.js` |
| Tasks | `toDoRow.js`, `dueDate.js`, `dragDrop.js`, `taskFilter.js`, `taskSort.js`, `mobileTaskCreate.js`, `entryScreenshot.js`, `filePicker.js` |
| Shell | `main.js` (DOM + wiring; grep it, it's large), `index.js`, `modals.js`, `mobileSheets.js`, `settingsModal.js`, `theme.js`, `sw.js` |
| Pipeline | `inject.js` (every Worker call), `shipEntry.js`, `runState.js`, `agentQueueStore.js`, `agentView.js`, `dispatchDraft.js`, `todoMdViewer.js`, `assignmentCoverage.js`, `modelsPanel.js` |
| Chat | `claudeSheet.js`, `chatMarkdown.js`, `mockupFlow.js`, `layoutInspect.js`, `imagePrep.js` |
| Structure | `structureView.js`, `structureCanvas.js`, `codeMapModel.js`, `codeViewer.js`, `codeTrace.js`, `codeTours.js`, `complexityHotspots.js`, `refactorCard.js`, `captureCard.js` |
| Understanding | `understandingView.js`, `codeBook.js`, `bookProgress.js`, `bookBookmarks.js`, `bookNotes.js`, `tourPlayer.js` |
| Focus / Ghost | `pomodoro.js`, `focusMode.js`, `music.js`, `musicVisualizer.js`, `companion.js`, `ghostTalk.js` |

---

## Development

```bash
cd toDoList_main
npm install
npm start          # webpack dev server
npm run build      # production bundle → dist/
npm test           # vitest (watch)
npm run test:run   # vitest, single pass — what CI runs
```

The app expects a Supabase project (URL + anon key) and, for the pipeline features, the Worker URL and secret entered in **Inject settings**. Without them the task manager still works locally; the agent surfaces stay idle.

Conventions worth knowing before changing code — all enforced by review or tests:

- No new dependencies, frameworks or CSS tooling without a task that says so.
- Data mutations route through `listLogic.js`; new persisted fields must be added to `persistMutation`'s whitelist.
- Every new module gets a purpose comment and a `codemap.json` entry; `tests/genSrcManifest.test.js` fails otherwise, and also when a tour step or book chapter stops resolving.
- Mobile text inputs are 16px or larger (iOS auto-zoom); right-click features have a long-press twin; modals close on X, backdrop and `Escape`.
- `dist/` is build output — never edited, never committed from a feature branch.

`CLAUDE.md` holds the full set, with the reasoning behind each rule.

---

## Testing

The suite runs on **Vitest + jsdom** on every push (`test.yml` — the badge at the top). Coverage spans the data model and persistence, the service-worker update lifecycle, the agent queue's state machine (stuck-row reconcile, queued-sweep handling, retroactive promotion, run dedup), the manifest/book/tour generator, and layout invariants such as the 16px input floor and viewport-fit on mobile.

Two behaviours — retroactive promotion of a run to Shipped and run-record dedup — each shipped once as a silent no-op that looked correct in review. Both now carry a regression test; the operating rule is that a green Shipped badge plus a changelog line is not proof a change worked — only behaviour on real data is.

The full PWA update path depends on real browser behaviour (`controllerchange` semantics differ across engines), so it is also validated by hand on desktop Chrome, iOS Safari and Android Chrome — see below.

---

## PWA update contract

The service worker (`workbox-webpack-plugin` `InjectManifest`, emitted as `dist/sw.js`) precaches the app shell. When a new build deploys, installed clients discover, fetch and apply it like this:

1. The installed worker calls `registration.update()` on every `visibilitychange` to visible, on an hourly interval, and on each navigation. Registration uses `updateViaCache: 'none'` so the check bypasses the browser's HTTP cache (Pages serves a 10-minute max-age).
2. The new worker installs, precaches the new manifest and parks in `waiting`.
3. `notifyUpdateAvailable` (`modals.js`) marks the desktop version pill and dispatches `appUpdateAvailable`; the mobile Settings → About row and the gear button listen and flip to their update state.
4. Tapping the cue posts `SKIP_WAITING`; the worker calls `self.skipWaiting()`; `controllerchange` fires; a one-shot listener in `index.js` reloads the page.

Worst case: an installed client picks up a new build on the second navigation or the next `visibilitychange` after the build is live. Bundles are not content-hashed on purpose — Workbox tracks revisions in the precache manifest, so a new `sw.js` invalidates old caches regardless of filenames.

When changing registration, the cue or the cache strategy, deploy a version bump and confirm on each platform that the cue appears within the contract and that tapping it reloads into the new worker: desktop Chrome (installed from `chrome://apps`), iOS Safari (home-screen install — check `controllerchange` actually fires in standalone mode), Android Chrome (install prompt).

---

## Related repositories

- [`claude-routine-template`](https://github.com/rsterenchak/claude-routine-template) — the routine, triage, derive and book prompts, the workflows, and `onboard.sh` / `offboard.sh`, which scaffold any repo (web, .NET console/desktop/MAUI, SQL, docs-only) into the pipeline. The template is the source of truth: a pipeline change made here is landed there too, and onboarded repos refresh from it.
- `todo-injector-worker` (private) — the Cloudflare Worker: inject, dispatch, status, read, chat, resolve, revert, the model registry and the provider gateway.
- [`docs/onboarding.md`](docs/onboarding.md) — the step-by-step runbook for wiring a new repo into the pipeline from this app, with troubleshooting for the 403s and 404s that actually happen.

---

## Author

Robert Sterenchak — solo developer.
