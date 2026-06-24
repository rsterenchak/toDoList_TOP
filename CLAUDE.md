# CLAUDE.md

Guidance for Claude when writing or reviewing code in this repo. Rules here are enforced by automated review — keep them concrete and verifiable.

## Project overview

A single-page todo list web app. Users create projects in a left sidebar, add todo items to the selected project, and manage them (edit, delete, check off, reorder). Runs in the browser with no backend — all state is client-side, persisted via `localStorage`. Bundled with webpack.

## Stack and constraints

- Vanilla JavaScript (no framework). Do not introduce React, Vue, Svelte, or any other framework.
- Plain CSS. Do not introduce Tailwind, CSS-in-JS, or preprocessors.
- Webpack handles bundling; Babel handles transpilation. Do not change the build toolchain.
- No new dependencies without an explicit task instruction to add one. This includes drag-and-drop libraries, date libraries, UI component libraries, and icon packages.
- Use native browser APIs wherever possible (HTML5 drag-and-drop, `localStorage`, `addEventListener`, etc.).

## Repo layout

- `toDoList_main/` — project root. Contains `package.json`, `webpack.config.js`, `.babelrc`, and the `src/` and `dist/` folders.
- `toDoList_main/src/` — all source code, assets, fonts, and icons.
- `toDoList_main/dist/` — webpack build output. **Never edit files here directly; they are regenerated on build.** Do not commit changes to `dist/` as part of a feature or bug task.
- `toDoList_main/node_modules/` — dependencies. Never edit.
- `TODO.md`, `CLAUDE.md`, `claude-config.md`, `README.md` — all at the repo root, one level above `toDoList_main/`.

## Source file organization

All source lives in `toDoList_main/src/`. Each JS file has a defined responsibility — stay within it:

- `toDoList_main/src/index.js` — DOM structure and markup rendering. Owns what the page looks like.
- `toDoList_main/src/main.js` — App bootstrap and event wiring. Owns how user actions connect to logic.
- `toDoList_main/src/toDo.js` — Rendering and interaction for todo items within the selected project.
- `toDoList_main/src/listLogic.js` — Data model for projects and todo items. All mutations to the data model go through here.
- `toDoList_main/src/style.css` — All styling. No inline styles in JS or HTML unless computed dynamically (e.g., drag position).

Do not mutate the data model from UI files (`index.js`, `toDo.js`, `main.js`). Go through `listLogic.js`.

## Assets

- Icons are SVG files committed to `toDoList_main/src/` (e.g., `addProj_button.svg`, `close-svgrepo-com.svg`, `empty_state.svg`, `favicon.svg`). When adding a new icon, commit the SVG file to `src/` and reference it — do not introduce icon libraries or icon fonts.
- Fonts are `.ttf`/`.otf` files committed to `toDoList_main/src/` (e.g., `SpaceMono-Regular.ttf`, `Zector.otf`) and loaded via `@font-face` in `style.css`. Do not introduce Google Fonts, font CDNs, or font loaders.

## Persistence

All user data (projects, todo items, theme choice, sidebar width, and any other user preferences) persists in `localStorage`. Key names use the prefix `todoapp_` (e.g., `todoapp_theme`, `todoapp_sidebarWidth`). State must survive page reloads.

## UI conventions

- Default theme is dark mode. A light theme exists as a user-toggleable alternative. Always honor the current theme when adding new UI — use the existing CSS variables rather than hardcoded colors.
- Modals close on: clicking an explicit close button, clicking the backdrop, and pressing Escape. All three affordances are required.
- Context menus (right-click) close on: selecting an option, clicking outside, pressing Escape, or right-clicking elsewhere. All four affordances are required.
- Destructive actions (delete project, delete todo) require a confirmation step. If the action affects other data (e.g., deleting a project with todos), the confirmation must state what will be lost.
- Text inputs used on mobile must have `font-size: 16px` or larger to prevent iOS Safari auto-zoom on focus.

## Mobile and touch

The app runs on mobile. When adding interactions:

- Right-click features must have a long-press equivalent (~500ms) for touch devices.
- HTML5 drag-and-drop events don't fire reliably on touch — add `touchstart`/`touchmove`/`touchend` handlers alongside native drag events.
- Do not suppress browser default behaviors (right-click menu, text zoom) globally. Scope suppression to the specific elements that need it.

## Scope discipline

- Keep changes scoped to the task described. Do not refactor, reformat, or fix unrelated issues in the same PR — file a new entry in `TODO.md` under the appropriate section instead.
- Do not delete or rename files unless the task explicitly requires it.
- Do not add CI workflows, license headers, or new top-level config files unless the task explicitly requires it.
- Do not modify `webpack.config.js`, `.babelrc`, `package.json`, or `package-lock.json` unless the task explicitly requires a build or dependency change.

## What not to flag in review

- Linter, formatter, or type-checker concerns (handled separately by CI).
- Missing test coverage unless the task was to add tests.
- Stylistic preferences not documented in this file.
- Pre-existing issues on lines the PR did not modify.
- Files in `dist/` or `node_modules/`.

## Large files

`toDoList_main/src/main.js` is over 25k tokens and will trip the Read tool's
default limit. Do not attempt to read it in full.

- Use `grep` (or the Grep tool) to locate the relevant section first.
- Then read only that range with `offset` and `limit` parameters.
- If you need more context around a match, widen the range — don't read the
  whole file.

## System overview

The app ships with an in-app Claude assistant — a "Claude sheet" the user opens inside the PWA. The full pipeline turns a chat into shipped code through these layers:

1. **Author (Sonnet, conversational planner).** The user opens the Claude sheet's Chat tab and talks to Sonnet to draft a TODO entry. Sonnet is the conversational planner role; its turns run through the Worker and are billed to the Anthropic Console (API). The chat round-trip is implemented by `chatWithWorker` in `toDoList_main/src/inject.js`.
2. **Inject (Cloudflare Worker).** Tapping "Inject & run" (or the per-todo inject button) POSTs the finished entry to a user-configured Cloudflare Worker — `todo-injector-worker` — which appends it to the target repo's `TODO.md` over the GitHub API. The entry carries a stable `<!-- id: <uuid> -->` marker so the Worker can dedup-by-id and later trace the entry to its merged PR. See `injectEntry` / `dispatchRun` in `inject.js`.
3. **Dispatch (`claude-run.yml`).** The same Worker fires a `workflow_dispatch` against `.github/workflows/claude-run.yml`, passing `mode` (`backlog` or `entry`), an `entry_id`, and a `correlation_id` echoed into the run name so status polling can find the run.
4. **Build (Opus, agentic builder).** `claude-run.yml` runs `anthropics/claude-code-action` with Opus (`claude-opus-4-8`), authenticated via the subscription OAuth token (Max plan quota, not an API key). Opus is the agentic builder role: it reads `.claude/routine-base.md` + `.claude/routine.md` and executes exactly one task — implement the change, run tests, open a PR, auto-merge with a merge commit.
5. **Deploy (`deploy.yml`).** Merging to `main` triggers `.github/workflows/deploy.yml`, which webpack-builds `toDoList_main/`, regenerates `dist/src-manifest.json`, and publishes `dist/` to GitHub Pages.

In short: Sonnet plans (Console-billed), the Worker injects and dispatches, Opus builds (Max-plan-billed), and Pages deploys — all without leaving the PWA.

## Repos and allowlist

The Worker is multi-repo aware. `ALLOWED_TARGETS` in the Worker (`todo-injector-worker`) defines the set of repos the system may inject into, dispatch runs against, and read source from — currently `rsterenchak/toDoList_TOP` and `rsterenchak/matchingGame-test`. Every Worker request that names a repo is validated against this allowlist; the client mirrors it as `ATTACH_REPOS` in `toDoList_main/src/claudeSheet.js`. The Worker source itself lives outside this repo, so treat `ALLOWED_TARGETS` as the Worker-side source of truth (see the Worker project, not this repo).

To add a third repo to the system:

- **(a)** Add a `{ repo, filePath }` entry to `ALLOWED_TARGETS` in the Worker.
- **(b)** Ensure the GitHub PAT the Worker uses has **Contents: write** and **Actions: read + write** scope on the new repo (Contents for the `TODO.md` append, Actions to dispatch and poll the run workflow).
- **(c)** Add a `scripts/gen-src-manifest.js` to the new repo plus a deploy.yml step that runs it after the build and before the Pages publish, so the repo publishes its own `src-manifest.json` (the file picker fetches `https://<owner>.github.io/<name>/src-manifest.json` by convention). Use the `.cjs` extension when the repo's `package.json` declares `"type": "module"`, since the manifest script is plain CommonJS.
- **(d)** Run `npm run deploy` on the Worker to push the updated `ALLOWED_TARGETS`.

This repo's own manifest script is `toDoList_main/scripts/gen-src-manifest.js`, wired into `deploy.yml` — copy it as the template for a new repo.

## Three context modes

The assistant layers three independent context mechanisms, each sent as a distinct field on the Worker request and each invoked from a different UI surface. They compose — a single turn can carry all three.

- **(a) Active-repo reframe** — sent as `body.repo`. Switches the conversation frame so the Worker reframes its system prompt around the named repo. Cheap (~1.7k input tokens). Invoked by the **workspace pill** in the chat tab header (`#claudeWorkspacePill` in `claudeSheet.js`); the active workspace is tracked in `activeChatRepo` and rides on every chat turn, attachments or not.
- **(b) Attached files** — sent as `body.attach_files` (an array of repo-relative source paths). Loads real source content so the model reasons over actual code rather than guesses. Bounded at **5 files / 40KB each / 80KB total** (Worker-side; see the Worker for the exact enforcement). Typical cost ~5–25k input tokens depending on file sizes. Invoked by the **attach (📎) picker** in the composer; the current chip set accumulates per-conversation and is re-sent on every turn. All chips in one conversation must come from a single repo.
- **(c) Iterate seed** — the iterate seed is sent as `body.entry_id`, on the **first turn only** of an iterate session. The Worker resolves that entry's marker to a merged PR and assembles a seed: the PR diff plus sliced post-merge source. Typical cost ~12–20k input tokens. Invoked by tapping a **SHIPPED run record** in the Runs tab, which opens an iterate chat seeded from that merged change. Later turns omit `entry_id` (see `chatWithWorker` in `inject.js`).

## Key files in this repo

The in-app assistant and its supporting pipeline are concentrated in a handful of source files. When working on assistant behavior, these are the files to reach for:

- `toDoList_main/src/claudeSheet.js` — the in-app Claude assistant sheet: chat tab, author flow, Runs tab, iterate, layout-inspector wiring, file-attach picker, and the workspace pill.
- `toDoList_main/src/inject.js` — all Worker calls: inject, dispatch, chat, status poll, and entry-id minting.
- `toDoList_main/src/runState.js` — per-project active-run state shared by the TODO.md viewer's header pill and the chat ship path, so a run shipped from either surface drives the same pill and a project only runs one at a time.
- `toDoList_main/src/layoutInspect.js` — serializes an element's live computed layout for the inspector.
- `toDoList_main/src/main.js` — DOM, UI, and event wiring; very large, so grep with `offset`/`limit` rather than reading it in full.
- `toDoList_main/src/listLogic.js` — the data model; ALL mutations to projects and todo items route through here.
- `toDoList_main/src/style.css` — all styling and responsive breakpoints.
- `toDoList_main/scripts/gen-src-manifest.js` — the manifest generator run by `deploy.yml` on each deploy.

## Hard rollback

The pipeline is built to fix forward — iterating on a shipped change through chat cures the large majority of regressions. For the rare case where a shipped change is bad in a way that fix-forward via iterate cannot quickly cure, there is a **full-auto in-app Revert**. It rolls back a shipped change through the Worker's `revert` route: the Worker resolves the entry's `<!-- id -->` marker to its merged PR, opens a revert PR via the GitHub GraphQL `revertPullRequest` mutation, and auto-merges it — `deploy.yml` then runs automatically and the rollback ships in roughly 2 minutes. The control surfaces in two places, both via the shared `revertEntry` helper in `inject.js`:

- **Runs tab** — a Revert control on each SHIPPED row (`buildRevertControl` in `claudeSheet.js`).
- **TODO.md viewer** — a Revert pill on each completed (`- [x]`) entry row, where it replaces the "Run this entry" button (`revertCompletedEntry` in `todoMdViewer.js`).

Both confirm before acting, then handle the three Worker outcomes: `merged: true` ships the rollback; `merged: false` means the revert PR opened but didn't auto-merge (conflict, or mergeability unconfirmed), and the control switches to opening that existing revert PR rather than POSTing again; `ok: false` surfaces the error (404 nothing-to-revert, 409 already-a-revert, 5xx).

**Safety properties.** A revert can never re-revert itself: reverts never become runs or TODO.md entries, so the UI has no path to revert a revert, and the Worker additionally refuses to revert any PR whose title starts with `Revert ` (reverting a revert re-applies the original change). A successful revert is guarded against re-triggering — once merged, the control disappears (Runs tab persists `rec.reverted`; the viewer tracks the entry id in a session-scoped reverted set, so it resets on a full reload).

**Manual fallback.** For the `merged: false` case — the revert PR opened but auto-merge couldn't complete — finish it in GitHub: open the linked revert PR and merge it, or open the offending PR in the GitHub mobile app or web UI and tap **Revert**. When reverting manually via GitHub, revert ONLY the original feature PR, never a revert PR: revert PRs share titles with their originals (e.g. `Revert "[Claude] feature: X"`), and reverting a revert re-applies the original change — easy to do by mistake at a glance. Read the PR carefully before tapping Revert.

## Worker location and routes

`todo-injector-worker` is a **separate repo** — it is not part of `toDoList_TOP`. It is deployed via `npm run deploy`, which runs `wrangler deploy` under the hood, so changes to Worker behavior require editing and redeploying the Worker with `wrangler`, not this app.

The Worker exposes these routes:

- `inject` — write an entry to the target repo's `TODO.md`.
- `dispatch` — start the `claude-run.yml` workflow.
- `status` — poll a workflow run by `correlation_id`.
- `read` — read the target repo's `TODO.md`.
- `chat` — the Sonnet proxy; accepts `messages`, `entry_id`, `attach_files`, `repo`, and `telemetry` fields.
- `resolve` — find a merged PR by its `<!-- id: ... -->` marker comment.

Note that `SYSTEM_PROMPT` and `ITERATE_PREAMBLE` live in the Worker, NOT in this repo — so changes to chat behavior (the conversational planner's instructions, the iterate framing) require editing and redeploying the Worker, not the app.

## Instrumentation & operating lessons

The pipeline looks deceptively simple from the outside — a green "Shipped" badge and a fresh changelog bullet suggest the work landed and works. It doesn't suggest that, and treating it as proof is how regressions slip through. The governing principle: **a green Shipped status plus a changelog entry is NOT proof a fix worked — only behavior on real data is. Always instrument, never trust the surface.** Every operating habit below exists because the surface lied at least once.

A handful of concrete instrumentation techniques carry most of the weight:

- **Worker chat telemetry via `npx wrangler tail`.** Tailing the Worker prints a `chat usage { iterate_seed: true|false, input_tokens, ... }` line per chat turn. This is the fastest way to confirm a turn actually carried the context it was supposed to: a healthy iterate-seed turn (the first turn of an iterate session, which loads the PR diff plus sliced post-merge source) lands around **12–20k input tokens**, while ordinary follow-up turns sit around **1–2k**. If an iterate turn shows 1–2k tokens, the seed silently didn't attach — the surface looked fine, the telemetry told the truth.
- **Service-worker state from DevTools.** To see whether a new service worker is waiting, installing, or active, paste this into the console (kept in raw, copy-pasteable form on purpose):

  ```js
  navigator.serviceWorker.getRegistration().then(r => console.log({waiting: !!r.waiting, installing: !!r.installing, active: r.active?.scriptURL}))
  ```

- **View-source on the live HTML** to read the content-hashed bundle filenames. Because webpack hashes the bundle name on each build, a changed hash in the served HTML proves the deploy produced a new revision (and that the service worker will pick it up) rather than serving a stale cache.
- **Probe-injection into `todoapp_claudeRuns` localStorage** to exercise the Runs-tab reconcile logic directly — write a synthetic run record into that key and watch how the UI reconciles it, instead of waiting on a full real run to reproduce a state.

Two specific behaviors — **retroactive promotion** (a run record being promoted to Shipped after the fact when its PR is detected merged) and **run dedup** (collapsing duplicate run records for the same dispatch) — each carry a dedicated **regression test**. Both shipped once as a silent no-op: the code looked correct, passed review by eye, and did nothing. We don't trust ourselves to catch the no-op pattern by code review alone, so the invariant is pinned by a test rather than by vigilance.

## Cross-cutting verification discipline for structural UI changes

When a chat turn describes moving, relocating, or restructuring a UI element, the Worker's system prompt now instructs the chat agent to lead with **proactive enumeration** of the cross-cutting concerns attached to that element — its event listeners, the state it reads or writes, any paired UI elements, and its ARIA wiring — **before** drafting a TODO entry. The user's role in that flow is to verify the enumeration is complete, add anything Sonnet missed from local knowledge the model can't see, and confirm. The outcome is a defensive entry whose acceptance criteria spell out exactly which behaviors must survive the move.

This discipline exists because early structural-UI moves broke load-bearing flows. Relocating the **workspace pill** and the **file picker** silently severed flows like injection, because the entries that described those moves named only the visual relocation and never the behaviors that depended on the moved element. The element moved; the wiring didn't come with it; the surface looked correct.

Once the cross-cutting clause was in place, subsequent structural moves shipped clean — because the enumeration forced the entry to name the invariants up front, e.g. "tapping the pill must still open the workspace menu; selecting a repo must still update `activeChatRepo`; the chat → inject flow must still send `body.repo` correctly." Naming the dependencies before the move is what turns a risky relocation into a verifiable one.
