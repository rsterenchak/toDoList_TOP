# TODO LIST

- [x] **[LOW]** Keep the "Show completed (N)" overflow item on one line
  - Type: bug
  - Description: In the TODO.md viewer's overflow menu, the "Show completed (N)" item wraps its count onto a second line ("Show completed" / "(1)"). The item (`.todoMdViewerShowCompletedItem`) is a flex row of a checkmark plus the label (`.todoMdViewerShowCompletedLabel`, `flex: 1 1 auto`), and at the menu's `min-width: 150px` the checkmark + the "Show completed (N)" text exceeds the available label width; with no `white-space` rule on the label, it wraps. Fix in CSS only: add `white-space: nowrap` to `.todoMdViewerShowCompletedLabel` (or `.todoMdViewerShowCompletedItem`) so the text stays on one line — the menu is absolutely positioned with `min-width: 150px` and no max-width, so it grows to fit single-line content. If the menu doesn't widen on its own, also give `.todoMdViewerOverflowMenu` `width: max-content` (keeping the 150px floor) so it sizes to its widest item. No JS change — the label is already a single string. Confirm the longer "Hide completed (N)" state and the Clear items also stay single-line, and the menu doesn't overflow the viewport in the mobile sheet.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-06-23
  <!-- id: 20112c26-f035-4895-9d12-79bb4055448f -->

- [x] **[MEDIUM]** Fix the TODO.md viewer overflow menu being clipped when the card is collapsed
  - Type: bug
  - Description: When the TODO.md viewer card is collapsed (its default state), tapping the "⋯" overflow button opens the menu but nothing is visible — you have to expand the card so the entries/body exist before the menu shows. Cause: `.todoMdViewerCard` has `overflow: hidden`, and `#mainList .todoMdViewerCard.collapsed .todoMdViewerBody` is `display: none`, so a collapsed card is only as tall as its header; the menu (`.todoMdViewerOverflowMenu`, `position: absolute; top: calc(100% + 6px)`) drops below the header into a region that now falls outside the card's box and is cropped by the card's `overflow: hidden`. Fix: while the menu is open, let the inline card's overflow show — add a class to the card in `openOverflowMenu()` and remove it in `closeOverflowMenu()` (same spot the outside-click/Escape handlers are wired), backed by CSS `#mainList .todoMdViewerCard.todoMdViewerCard--menuOpen { overflow: visible; }`. This is sizing-safe: `#mainList .todoMdViewerCard` already pins `min-height: max-content`, so the card's height doesn't depend on `overflow` (the auto-min override that `overflow: hidden` triggers only fires when `min-height` is `auto`), and the body keeps its own `overflow: auto` / `max-height`. Verify the menu now renders over the area beneath the collapsed card, and check the `#todoMdViewerMobileSheet` placement — if a collapsed card clips it there too, extend the same `--menuOpen` toggle with a sheet-scoped `overflow: visible`.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/todoMdViewer.js`
  - Completed: 2026-06-23
  <!-- id: 9909567b-d4a7-4be6-bc5e-817799cebad6 -->

- [x] **[MEDIUM]** Use a modal menu instead of a dropdown for the todo viewer's overflow button on mobile
  - Type: feature
  - Description: In the todo viewer section, tapping the overflow (⋯) menu button on mobile currently opens a dropdown that is cramped and easy to mis-tap on touch. On mobile, the overflow button should instead open a modal/bottom-sheet menu (use the existing `mobileSheets.js` pattern) with large touch targets; desktop keeps the existing anchored dropdown unchanged. Preserve all current overflow-menu behavior: every menu item's action/click handler must still fire; the menu must close on item selection, backdrop tap/outside-click, and Escape; and any state the menu reads (the entry/section currently in view) must remain in scope when the menu is rendered as a modal rather than as a sibling dropdown. The likely code lives in `toDoMdViewer.js` (overflow button + menu construction) with the mobile sheet wiring from `mobileSheets.js` and styling in `style.css`.
  - File: `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/mobileSheets.js`, `toDoList_main/src/style.css`
  - Completed: 2026-06-23
  <!-- id: 2479dc6b-f7cd-418f-af28-b6f048f1af31 -->

- [x] **[HIGH]** Fix white page after deploy by handling service-worker updates cleanly
  - Type: bug
  - Description: After a new version deploys, the app keeps serving the old cached bundle, and on refresh the HTML references a new content-hashed bundle the stale cache can't supply — producing a white page that only a hard refresh clears. Fix the service-worker update lifecycle so a new worker activates and takes control without a manual hard refresh: call `skipWaiting`/`clients.claim` appropriately, detect the waiting worker on registration, and surface a small non-blocking "Update available — tap to refresh" prompt that reloads into the new version on tap (and never serve a cached HTML shell that points at bundle filenames absent from the cache). Likely code lives in the service worker (`sw.js`) and its registration/update handling in `index.js`.
  - File: `toDoList_main/src/sw.js`, `toDoList_main/src/index.js`
  - Completed: 2026-06-23
  <!-- id: fbff27cb-5250-45e3-8583-5840bcf87e9c -->

- [x] **[HIGH]** Fix post-deploy white page by serving the HTML document network-first
  - Type: bug
  - Description: After a deploy, a normal refresh can land on a blank page that only a hard refresh clears. Root cause: the service worker precaches `index.html` and serves it cache-first for navigations, while `output.clean: true` deletes the previous content-hashed bundle from `dist/` on every build — so once a new build is live, the old bundle is gone from GitHub Pages. In the seam where a new worker activates and claims the page (PWA reopened, or the `controllerchange` reload), a stale `index.html` leaks from GitHub Pages' ~10-minute HTTP cache and points at the previous bundle hash, which is now absent from both the network and the active worker's (new-generation) precache — the `<script>` 404s and nothing boots. The opt-in update cue added previously doesn't prevent this because the navigation itself is still served cache-first. Fix in `sw.js`: serve the HTML document network-first so the shell and the hashed bundle it references always come from the same (latest) generation when online. Add a `NavigationRoute` backed by a `NetworkFirst` strategy (e.g. `cacheName: 'html-shell'`, `networkTimeoutSeconds: 4`) and register it before `precacheAndRoute(...)` so it wins over the cache-first precache route for navigations; all content-hashed assets stay precached/cache-first (safe — their URLs change per build). On network failure, fall back to the precached shell (`matchPrecache` / `createHandlerBoundToURL` for `index.html`) so offline still loads after the first online visit. Also call `cleanupOutdatedCaches()`. Keep the existing update flow intact — the `SKIP_WAITING` message handler, `clients.claim()` on activate, and the index.js cue + `controllerchange` reload all stay; this change only makes those paths land on a fresh shell instead of a purged one. `workbox-routing` (`registerRoute`, `NavigationRoute`) and `workbox-strategies` (`NetworkFirst`) are already present in `node_modules` via `workbox-webpack-plugin` (same source as the working `workbox-precaching` import) — no new dependency and no `package.json` or `webpack.config.js` change.
  - File: `toDoList_main/src/sw.js`
  - Completed: 2026-06-23
  <!-- id: 3aea4045-5d4e-4f99-84c0-9fa11990cb5d -->

- [x] **[MEDIUM]** Reflect chat-shipped runs in the viewer's Running pill and block a second run on the same project
  - Type: feature
  - Description: The viewer header's Running pill only attaches for runs dispatched from the viewer's own Run backlog / per-entry buttons: it reads a single global active-run slot (`todoapp_activeRun`, currently private to `todoMdViewer.js`) that the chat ship path never writes, so a run shipped from the Claude sheet chat (`shipDraftedEntry`) tracks in the Runs tab but leaves the viewer header a plain button. Make a chat-shipped run drive that same existing pill — reuse it as-is, no new indicator and no CSS — and scope all run state per project so a run for one project never affects another. Replace the single global slot with per-project active-run state in a small shared module (`toDoList_main/src/runState.js`) keyed by project (e.g. `todoapp_activeRun:<encodeURIComponent(project)>`), exposing `readActiveRun(project)` / `writeActiveRun(project, rec)` / `clearActiveRun(project)` and dispatching a change event on `document` that names the affected project; reads must treat an entry older than the run give-up window (`RUN_GIVE_UP_MS`) as stale and ignore/clear it, so a project can never stay permanently blocked if a run is never confirmed. Import the module from both `todoMdViewer.js` and `claudeSheet.js` (additive: add the module and switch the viewer onto it, confirm the Vitest suite is green, then delete the viewer's private single-slot helpers). In `shipDraftedEntry`, after a successful `dispatchRun`, call `writeActiveRun(project, { correlationId, project, target: { repo: activeChatRepo, file_path: 'TODO.md' }, dispatchedAt })`, and also add `project` to the chat run record pushed onto `runRecords` so the poller knows which key to clear; `project` is the currently-selected project name, resolved from the same source the viewer uses — expose `activeProjectNameForViewer` (the `.selectedProject #projInput` reader) as a shared getter instead of duplicating the selector — so it lands under the same key the viewer reads for that project (this assumes the chat workspace tracks the open project, the default auto-swap behavior; if the workspace is routinely overridden to a different repo than the open project, a repo→project reverse lookup would be needed to pick the key). On render the viewer attaches via `readActiveRun(projectName)` (present-and-fresh → `startRunPill`), and it also subscribes to the change event so a viewer that's already mounted attaches the pill the instant a run is written for the project it's showing and restores the button when that project's entry is cleared; events for other projects are ignored. Fix the poll target for re-attached runs: `pollRunOnce` currently polls with the viewer's closure `target`, which is wrong for a chat run shipped to a different repo (it would query the wrong repo, get `found:false`, and hang on "Starting…") — resolve the poll target from the active-run record's stored `target` when present, falling back to the viewer's `target`. Scope the double-run guard per project: before dispatching, `shipDraftedEntry` (chat) checks `readActiveRun(<run's project>)` and `runBacklog` / `runEntry` (viewer) check `readActiveRun(projectName)`, refusing only when that specific project already has an active (fresh) run and showing a brief "A run is already in progress for this project" toast; a run on a different project must not block, so this replaces the viewer's current in-memory-only check (`runPill || viewerRunPollInterval`, which only ever reflects the one open project anyway). Finally, free a project's guard even when its viewer isn't open at terminal: the chat-side poller `pollRunRecordOnce` (`claudeSheet.js`) must clear that project's entry (`clearActiveRun(rec.project)`) on any terminal outcome (SHIPPED / FAILED / unconfirmed / give-up), since the viewer's terminal handlers that clear it today only run when that project's viewer is mounted; combined with the stale-entry check above, a project can't get stuck blocked. Keep the chat's `runRecords` / Runs-list tracking (global history, unchanged) and the viewer's single pill (always reflecting the open project) as independent surfaces that each poll and render themselves; the only shared state is the per-project active-run entries.
  - File: `toDoList_main/src/runState.js`, `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/todoMdViewer.js`
  - Completed: 2026-06-23
  <!-- id: 039c9f6d-079c-49c5-b317-b89cf73718b1 -->

- [x] **[LOW]** Recolor the chat composer send caret to match the accent purple #6C5DF5
  - Type: bug
  - Description: The `claudeComposerSendCaret` element currently uses a color that doesn't match the rest of the composer's accent styling, making it look inconsistent. Update its color to `#6C5DF5` so it's uniform with the other accent elements in the composer. This is a styling-only change — adjust the relevant `.claudeComposerSendCaret` rule (fill/color as appropriate for the element type) in the stylesheet; no behavior changes.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-06-23
  <!-- id: ee284b9c-139f-4af0-b5a0-2d8499158802 -->

- [x] **[LOW]** Color the composer dropdown selector #6C5DF5 instead of the send caret
  - Type: bug
  - Description: A prior change colored the send caret (`.claudeComposerSendCaret`) purple, but the intended target was the dropdown selector that sits next to it in the composer. Revert the caret back to its original `var(--text-secondary)` color and instead apply `#6C5DF5` to the dropdown selector (text and chevron) so the accent lands on the correct element. Change is styling-only — no behavior or markup changes.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-06-23
  <!-- id: 4d26ef55-2a7c-4f8c-ab3b-66884ede033c -->

- [x] **[LOW]** Match the deep/fast selector color to the submit button
  - Type: bug
  - Description: The deep-vs-fast mode selector in the Claude sheet composer uses a different color than the adjacent submit/send button, making them look mismatched. Restyle the selector to use the same accent color as the submit button so the two controls read as a matched pair. Pull the existing submit-button color from the shared CSS variable/token rather than hardcoding a new value, and verify the match holds in both dark and light themes. Likely locations: the composer control styles in `style.css` and, if the selector is built/styled inline, its markup in `claudeSheet.js`.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/claudeSheet.js`
  - Completed: 2026-06-23
  <!-- id: 8ab65856-a60e-4f68-95f2-696f3af2a27c -->

- [x] **[LOW]** Set fast/deep dropdown picker background to #6C5DF5 and caret to white
  - Type: bug
  - Description: The composer's fast-vs-deep mode dropdown picker should have its background color set to `#6C5DF5` (accent purple), and the send caret next to it should be white (`#fff`) rather than its current color. Apply both in the composer styling — background on the dropdown picker element, white on `.claudeComposerSendCaret`. Styling-only change, no behavior or markup changes.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-06-23
  <!-- id: 84c1b96e-f83a-4734-b47b-f2b0449700a0 -->

- [x] **[MEDIUM]** Move purple background from dropdown menu to the caret button that opens it
  - Type: bug
  - Description: A prior change set `.claudeModeMenu` (the fast/deep dropdown window) background to `#6C5DF5`, but the intended target was the caret button that opens the menu, not the menu itself. Restore `.claudeModeMenu` background to `var(--bg-elevated)`, and instead set `.claudeComposerSendCaret` (the caret half of the split send control that opens the menu) background to `#6C5DF5`. Keep the caret glyph at `#fff` for white-on-purple contrast. Update the corresponding assertions in the test suite to match the new targets.
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/claudeSheet.test.js`
  - Completed: 2026-06-23
  <!-- id: 28de2bc0-d0b8-4348-9890-d006468c7622 -->

- [x] **[LOW]** Rename the viewPillProjects tab label to "Task View"
  - Type: feature
  - Description: Change the visible text of the `viewPillProjects` tab/pill from "Projects" (currently rendered as "PROJECTS") to "Task View". This is a single-label text change only — scope is strictly the `viewPillProjects` element's label string. Do NOT touch any other "Project"/"Projects" copy (sidebar heading elsewhere, aria-labels, the N-projects footer, modal/help text), the data model, or any `todoapp_`-prefixed localStorage keys. If the pill's text is uppercased via CSS, the source string can stay normal-case ("Task View") and render as "TASK VIEW".
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-06-23
  <!-- id: 0b235b16-c0a6-4d52-b129-a81eb3763e5c -->

- [x] **[MEDIUM]** Mark no-op runs "No change" instead of Shipped in the Runs tab
  - Type: bug
  - Description: A run record flips to SHIPPED on `conclusion === 'success'` alone (`pollRunRecordOnce` in `claudeSheet.js`). A graceful no-op run — the routine reports an entry ineligible (e.g. its premise was superseded by later code) and exits clean with tests green — returns success, so it's stamped SHIPPED even though no PR merged and the entry stays unchecked. That false SHIPPED then becomes an iterate row: tapping it seeds an iterate chat that tries to resolve the entry marker to a merged PR, finds none, and dead-ends ("nothing to iterate on"). Fix: on a completed success conclusion, before asserting SHIPPED, verify the entry actually merged via `resolveEntryByMarker(rec.entryId)` (the same proof `promoteFailedRecordIfShipped` already uses) — `found:true` with a `merge_commit_sha` → SHIPPED as today; a definitive `found:false` → a new terminal status rendered as a "No change" badge. Race guard: a real ship's merged PR can lag in search right at completion, so only commit "No change" on a definitive `found:false` that persists across a short retry (e.g. re-check after one poll interval, up to a couple of attempts) — never on a single transient miss or a resolve error (resolve failures / network blips keep polling and must not assert "No change"), so a genuine ship is never misread. Wire the new status into `isTerminalStatus` and `isClearableRun` (it is terminal and Clear-completed-able) and `RUN_STATUS_LABEL` (label "No change"). Badge styling matches the approved mockup: reuse the `.claudeRunBadge` pill geometry (11px / 600 / 0.04em tracking, full pill radius) with background `#241d12`, `0.5px solid #6e5a2a`, text `#cbb079` (amber — deliberately distinct from green Shipped, red Failed, and the cool-gray dashed Unknown). The "No change" row is NOT iterable; instead, on tap it opens the run's GitHub Actions log so the user can read the agent's verdict — persist the run URL onto the record (the poll response already returns `runUrl`; store it on the record in the completion branch and `saveRunRecords`), open that URL in a new tab on row tap with the same `role="button"` + Enter/Space handling the iterable rows use, and show a trailing `↗` affordance glyph (color `#6e5a2a`). Defensive: a record with no `entryId` can't be verified, so keep the existing success → SHIPPED behavior for those (don't regress legacy records). Out of scope: the in-app deep-link that opens the stale entry in the TODO.md viewer (the heavier "tap → reconcile" option, deferred); the TODO.md viewer's own header Running pill (`todoMdViewer.js` — a separate, transient surface, left unchanged here); backlog task selection; the routine / Worker; and the existing FAILED → SHIPPED promotion (untouched, and it never applies to "No change" since that isn't FAILED).
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/style.css`
  - Completed: 2026-06-23
  <!-- id: be086c81-21ed-495b-944a-53d2f1521c38 -->

- [x] **[HIGH]** Confirm ship via the entry's checkbox on main, not merged-PR search
  - Type: bug
  - Description: The run-status poller proves a ship by searching merged PR bodies for the entry's `<!-- id -->` marker (`resolveEntryByMarker` → the Worker's `resolve` route) inside a short grace window, and labels anything still unresolved "No change". That search hits GitHub's PR search index, which lags minutes behind a merge, so a run whose change actually landed on main (a real push-merge) resolves `found:false` while the grace is open and gets mislabeled "No change"; the mount-time re-verify only corrects it on a later reload, which is why these rows read right after a refresh but wrong in the moment. Fix: in the success-completion branch of `pollRunRecordOnce` (`claudeSheet.js`), stop using the marker SEARCH to decide ship-vs-no-op and instead read the result directly off main via the existing index-free `read` route (`readTodoMdFromWorker` in `inject.js` — a GitHub contents fetch that reflects the merge immediately and regardless of merge method, PR-merge or direct push). On a success conclusion, hold the row on Running, read the run's target-repo TODO.md, locate the entry whose `<!-- id: <rec.entryId> -->` marker matches, and key the terminal status on its checkbox: a checked `- [x]` entry → SHIPPED; the entry still present and unchecked `- [ ]` → "No change" (the routine leaves a skipped entry unchecked for human reconciliation, so unchecked-with-marker is the positive signature of a no-op). Fail safe toward SHIPPED on every ambiguity so a genuine ship is never mislabeled: marker absent (entry completed-then-cleared, or squashed away) → SHIPPED; read fails transiently → keep polling, retry a couple of ticks, then SHIPPED; record with no `entryId` or no resolvable target → SHIPPED as today. This deletes the grace-window race entirely — the decision waits only for one quick contents read, then paints exactly one terminal badge (still no Shipped→No-change flash). Keep the rest of the "No change" work unchanged (amber badge + label, `isTerminalStatus` / `isClearableRun` / `RUN_STATUS_LABEL` wiring, the non-iterable row that taps out to the run's Actions log). Out of scope: the Worker (no `resolve` or route change — `read` already exists); `promoteFailedRecordIfShipped`, which keeps using marker-search on mount, where search lag is harmless (it can migrate to the same read later); the TODO.md viewer's header pill; and the FAILED path.
  - File: `toDoList_main/src/claudeSheet.js`
  - Completed: 2026-06-24
  <!-- id: 45a3c33f-482a-4c9c-bc21-aceebcf57778 -->

- [x] **[LOW]** Update the Fast-mode submit button color in the chat window to match the dropdown's lighter purple
  - Type: feature
  - Description: The Fast-mode submit button in the Claude sheet chat composer currently uses the deep/dark button color. Change its background color to match the lighter purple used by the dropdowns in the same sheet (approximately the `#6C5DF5` / `#9D93EE` accent range from the design tokens). Locate the Fast submit button's CSS rule in `style.css` (or the inline style set in `claudeSheet.js`) and update the color to match the dropdown's lighter purple exactly — sample the dropdown's rendered background rather than guessing a hex value. Do not change the button's shape, size, or any other property.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/claudeSheet.js`
  - Completed: 2026-06-24
  <!-- id: 0e45835a-e884-4ced-9b84-636cbfd78429 -->

- [x] **[MEDIUM]** Add a Revert control to Shipped rows in the Claude sheet Runs tab — Completed: 2026-06-24
  - Type: feature
  - Description: Add a per-run Revert affordance to SHIPPED rows in the Claude sheet's Runs tab that rolls back that run's shipped change through the Worker's already-deployed full-auto `revert` route. Each SHIPPED record carries `rec.entryId`; the Worker resolves it to the merged PR, opens a revert PR via GraphQL, and auto-merges it so `deploy.yml` ships the rollback. The control lives on the row built by `buildRunRow` in `claudeSheet.js`, coexisting with the existing whole-row "iterate" behavior (`startIterateFromRun`).
  - Behavior:
    - Render the Revert control ONLY on rows whose status is `SHIPPED` and that have `rec.entryId`, and only when the record has not already been reverted (see the reverted-state gate below). Non-shipped, id-less, or already-reverted rows never show a fresh Revert trigger.
    - The control is its own button inside the row. Activating it by click OR keyboard must `event.stopPropagation()` (and not bubble to the row's keydown) so it never also fires the row's iterate action.
    - Tapping it opens a confirmation via `showConfirmModal` naming the run (`rec.title`) and stating this ships a rollback — a new build will deploy. Cancel does nothing.
    - On confirm: disable the control and show a loading state (reuse the existing per-row `--loading` convention), then call the new `revertEntry(rec.entryId, target)` where `target = rec.repo ? { repo: rec.repo, file_path: 'TODO.md' } : null` — mirroring `pollRunStatus` so a run shipped to a non-default workspace reverts against the correct repo.
    - Handle the three Worker outcomes:
      - `merged === true`: show a success toast (`showInjectToast`, e.g. "Reverted — new build shipping"). Mark the record reverted (`rec.reverted = true`) and persist via `saveRunRecords`, then re-render so the control reflects the reverted state and can no longer be triggered. This is the double-revert guard: a second merged revert of the same PR would re-apply the original change, so a reverted row must never re-submit.
      - `merged === false`: the revert PR opened but didn't auto-merge (`res.reason` — conflict, or mergeability unconfirmed). Surface `res.reason` and give the user `res.revert_pr_url` to finish in GitHub. Persist that URL on the record so the control switches to opening the existing revert PR rather than POSTing again — never create a duplicate revert PR.
      - `ok === false`: error toast using the helper's `reason` (covers 404 nothing-to-revert, 409 already-a-revert, 502 failures).
  - Implementation notes:
    - Add and export `revertEntry(entryId, target)` in `inject.js`, mirroring `pollRunStatus`/`resolveEntryByMarker`: POST `{ revert: true, entry_id }` through `postToWorker` (adding `repo` + `filePath` from `target` when provided); return `Object.assign({ ok: true }, res || {})` on success and `{ ok: false, reason: describeError(e) }` on failure. This helper is shared with the viewer Revert entry that follows.
    - In `claudeSheet.js`, import `showConfirmModal` from `./modals.js` (`showInjectToast`, `runRecords`, `saveRunRecords`, and `renderRunsList` are already in this module).
    - Icon is a quiet undo / counter-clockwise-arrow inline SVG in the existing icon-button style, with an amber/caution accent (the app's warning amber, distinct from delete-red and run-purple); `aria-label="Revert this change"` plus a title tooltip; comfortable tap target on mobile. Add the matching rule in `style.css` on the existing per-row control vocabulary.
  - Out of scope:
    - The viewer per-entry Revert and the CLAUDE.md "no in-app revert by design" rewrite — both land with the next (viewer) entry.
    - Any Worker change — the `revert` route is already deployed.
    - Do not restructure the existing whole-row iterate interaction; Revert sits alongside it.
  - File: `toDoList_main/src/inject.js`, `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/style.css`
  <!-- id: 34b83cbf-0377-431e-8b58-b320d7d6f5f9 -->

- [x] **[MEDIUM]** Add a per-entry Revert to completed rows in the TODO.md viewer, and hide Run on completed rows — Completed: 2026-06-24
  - Type: feature
  - Description: Add a Revert control to completed (`- [x]`) entry rows in the TODO.md viewer that rolls back that entry's shipped change through the already-deployed Worker `revert` route and the `revertEntry` helper added with the Runs Revert control. On completed rows, replace the "Run this entry" button with Revert — re-running a shipped entry isn't wanted — while keeping Delete; open rows stay exactly as they are. The control resolves the row's `<!-- id -->` marker (`tok.entryId`) to the merged PR, the same gate the existing Run/Delete controls already use. Also rewrite the now-stale "no in-app revert by design" section of CLAUDE.md.
  - Behavior:
    - In `buildViewerRenderedBody` (`todoMdViewer.js`), per top-level (`indent === 0`) entry carrying a resolved `tok.entryId`:
      - Revert: show ONLY when `tok.checked` (completed) AND the entry has not been reverted this session (see guard). Render as a labeled "Revert" pill in the right-hand control cluster.
      - Run this entry: change its render gate to also require `!tok.checked`, so it shows on open rows only (today it also shows on completed rows). Open rows keep Run unchanged.
      - Delete: unchanged — open and completed both keep it.
    - Activating Revert (click) must `event.stopPropagation()`, matching the existing Run/Delete controls. Revert is NOT gated by the per-project active-run guard (`readActiveRun`) — it's a PR operation, not a dispatch, so it's allowed even while a run is in flight.
    - Tapping Revert opens `showConfirmModal` naming the entry (its label) and stating this ships a rollback; Cancel does nothing.
    - On confirm: disable the button with a loading state (reuse the per-entry `--loading` convention) and call `revertEntry(entryId, target)` with the viewer's existing `target` (the project's resolved inject target `{ repo, file_path }`, the same object `performRewrite`/`runEntry` already pass).
    - Handle the three Worker outcomes (identical contract to the Runs Revert):
      - `merged === true`: success toast (`showInjectToast`, e.g. "Reverted — new build shipping"); add the entryId to a module-level reverted-this-session set and re-render so the row's Revert disappears. This is the double-revert guard — a second merged revert of the same PR would re-apply the original change. Session-scoped: it resets on a full reload, which is acceptable given the confirm step and the merged:false link below.
      - `merged === false`: surface `res.reason` (conflict or unconfirmed) and open/link `res.revert_pr_url` to finish in GitHub; track the entryId as pending so the control links to the existing revert PR rather than POSTing again — never create a duplicate revert PR.
      - `ok === false`: error toast using the helper's `reason` (404 nothing-to-revert, 409 already-a-revert, 502 failures).
  - Implementation notes:
    - Add `revertEntry` to the existing `./inject.js` import in `todoMdViewer.js`; `showConfirmModal` and `showInjectToast` are already imported there.
    - Pass a new optional `onRevertEntry(entryId, entryLabel, btn)` callback into `buildViewerRenderedBody` alongside `onRunEntry`/`onDeleteEntry`, and wire it in the viewer to the handler above (mirroring how `deleteEntry`/`runEntry` are wired). This is additive to the opts — existing callers/tests are unaffected. Keep the reverted/pending session sets at module scope so they survive re-renders and re-fetches.
    - Revert pill: a labeled "Revert" button with a leading undo / counter-clockwise-arrow inline SVG, styled on the `todoMdViewerRunEntryBtn` vocabulary but with the app's warning-amber accent (distinct from Run-purple and Delete-red); comfortable tap target on mobile; works in both the desktop card and the `#todoMdViewerMobileSheet`. Add the rule in `style.css`.
    - CLAUDE.md: rewrite the "Hard rollback" / "no in-app revert button by design" section to reflect that in-app full-auto Revert now exists — in the Runs tab on Shipped rows and in the viewer on completed entries — via the Worker `revert` route (GraphQL `revertPullRequest` + auto-merge; on conflict it leaves the revert PR open and returns its link). Document the safety properties: reverts never become runs or TODO.md entries (so the UI can't revert a revert), the Worker additionally refuses reverting any PR whose title starts with `Revert `, and a successful revert is guarded against re-triggering. Keep the manual GitHub Revert documented as the fallback for the conflict / not-auto-merged case.
  - Out of scope:
    - Any Worker change — the `revert` route and `revertEntry` already shipped with the Runs entry.
    - Touching the existing Run/Delete controls beyond the completed-row gate change for Run.
    - Persisting the reverted-state guard across reloads, or adding a Worker-side dedup of repeat reverts of the same PR (possible future hardening; the session guard plus the confirm step suffice here).
  - File: `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/style.css`, `CLAUDE.md`
  <!-- id: a5f6f825-f35a-4d3c-9da1-9e1545ceb4d3 -->

- [x] **[HIGH]** Fix delete confirmation modal rendering behind the TODO.md viewer sheet on mobile
  - Type: bug
  - Description: On mobile, tapping the delete button on a todo entry inside the TODO.md viewer causes the confirmation modal (Cancel / Delete buttons) to appear behind the viewer sheet, making it inaccessible without closing the sheet first. The modal's z-index or stacking context is lower than the sheet's, so it renders underneath. Fix by ensuring the delete confirmation modal has a z-index high enough to appear above the TODO.md viewer sheet — audit the z-index layering in `style.css` for both the sheet and the modal and establish a clear stacking order so the modal always renders on top. The fix should not affect the modal's behavior on desktop.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/modals.js`
  - Completed: 2026-06-24
  <!-- id: 68bf1821-8904-4cec-a320-5f265294ab41 -->

- [x] **[MEDIUM]** Surface cross-device "running" status for the active project — server-driven viewer pill + dropdown-trigger spinner — Completed: 2026-06-24
  - Type: feature
  - Description: Make a run started on another device visible here for the active project, using the Worker's deployed `active_runs` route (a repo-level "is anything running right now" probe). Add a shared `fetchActiveRuns` helper, drive the TODO.md viewer's existing "Running" pill off the server signal (not just the local run record) so a run started elsewhere lights it up and it self-clears when the run completes, and add a purple spinner to the project-dropdown trigger that shows while the active project's repo has an in-flight run. Per-project spinners in the picker rows are a separate follow-up entry.
  - Behavior:
    - `fetchActiveRuns(target)` in `inject.js`: POST `{ active_runs: true, repo, filePath }`, returning `{ ok: true, active, count, newest }` on success and `{ ok: false, reason }` on failure — mirroring `pollRunStatus`. It's an ambient, fire-and-forget probe: callers treat `ok:false` as "not active" and never raise an error toast.
    - Resolving a project's repo: project name → `listLogic.getProjectTargetId(name)` → `findTargetById(id)` → `target.repo`. A project with no routed target (same gate as the ⚡ bolt — inject configured AND a `target_id`) has no repo, so it's never polled and never shows a spinner or a server-driven pill.
    - Trigger spinner: mount a spinner in `#mobileProjTitleRow` adjacent to `#mobileProjChevron` (the ▾) so it reads as trailing the project name + caret on both breakpoints — placement A. The `#mobileProjHeader` pill is the project trigger on both desktop (dropdown) and mobile (drawer), so this one element covers both. Show it ONLY when the active project has a routed repo AND `fetchActiveRuns(repo).active === true`; hide otherwise. Purple (`#9D93EE`), spinning sync glyph, `aria-hidden` (decorative — the pill already names the project) and `pointer-events: none` so it never interferes with the pill's click-to-open.
    - Trigger poll cadence: poll on load, immediately on active-project change (re-resolve repo + re-poll, reusing the header's existing update / MutationObserver path rather than a new observer), and on a light interval (~10s) only while `document.visibilityState === 'visible'` — pause when hidden so it doesn't poll in the background.
    - Viewer "Running" pill (`todoMdViewer.js`): today it shows when a local active-run record exists (`readActiveRun(project)`). Add a server source — also show the pill when `fetchActiveRuns` reports the viewer's project repo is active, even with no local record (the cross-device case). The existing local path (rich queued→shipped status, run-guard clearing at terminal) is unchanged. Because the server signal is authoritative, the pill hides the moment the server reports the repo no longer active, so it self-clears when a run completes and surfaces a run started elsewhere within one poll interval — which also closes the stale-pill window the 20-minute give-up in `runState.js` exists to bound. Poll the viewer project's repo on the viewer's existing run-poll cadence and on `ACTIVE_RUN_CHANGE_EVENT` / project switch; fire-and-forget, `ok:false` → not active.
  - Implementation notes:
    - Add and export `fetchActiveRuns(target)` in `inject.js` next to `pollRunStatus`; it's the shared helper the follow-up picker-spinner entry also uses.
    - The header nodes (`mobileProjHeader`, `mobileProjTitleRow`, `mobileProjName`, `mobileProjChevron`) are built in `main.js` — grep to them with `offset`/`limit`, do not read `main.js` whole. Mount the spinner once and toggle a class; keep the repo-resolution + poll in a small unit (inline by the header wiring or a tiny helper). If the mobile ‹ › carousel crowds it, placing the spinner at the title-row's trailing edge on mobile is acceptable.
    - Add the spinner CSS plus a shared `@keyframes` spin in `style.css`; the picker-row spinners in the follow-up entry reuse the same keyframes.
    - Optional: a tiny in-memory cache (repo → { active, at } with a few-seconds TTL) could dedupe the viewer's and the trigger's polls when they target the same repo (the common case where the viewer shows the active project). Skip it if it adds complexity.
  - Out of scope:
    - Per-project spinners in the picker rows — both the desktop `.projectPickerRow` dropdown and the mobile `#projChild` drawer rows — and the all-routed-repos poll scoped to while the picker is open. That's the next entry.
    - Any Worker change — the `active_runs` route is already deployed.
    - The Runs tab list — it's deliberately device-local and not synced.
  - File: `toDoList_main/src/inject.js`, `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  <!-- id: 9f45e8e0-a110-4363-b989-79e5bc9e85c7 -->

- [x] **[MEDIUM]** Add per-project "running" spinners to the project switcher (desktop dropdown + mobile drawer), polled only while open — Completed: 2026-06-24
  - Type: feature
  - Description: Show a purple "running" spinner on each project row whose repo has an in-flight run, in both project-switcher surfaces — the desktop `.projectPickerRow` dropdown and the mobile `#projChild` drawer rows. Reuse the `fetchActiveRuns` helper and the shared spin keyframes added with the active-project work. The wider poll (all routed repos) runs ONLY while the switcher is open, so the extra chatter is bounded to when you're actually looking. The dropdown is the desktop switcher (≥1024px) and the drawer the mobile one (<1024px), so the two row spinners are platform-exclusive.
  - Behavior:
    - Spinner: purple (`#9D93EE`), spinning sync glyph, placement A — left of the count badge (after the project name) on each row. Decorative (`aria-hidden`), `pointer-events: none`; must not disturb the ⚡ bolt, the name (or its rename input), or the count.
    - Shows on a row iff that project has a routed repo AND that repo currently has an active run (`fetchActiveRuns(repo).active === true`). Same routed-repo gate as the ⚡ bolt (inject configured AND a `target_id`); unrouted projects never show it.
    - Poll lifecycle — only while the switcher is open:
      - Desktop dropdown (`projectPicker.js`): on `openProjectPicker` (after `buildProjectPickerRows`) start the poll and update each row's spinner as results arrive; stop on `closeProjectPicker`. Rows are rebuilt on each open, so re-mount the spinner elements on each build and let the poll fill them.
      - Mobile drawer (`#projChild` in `#sideMa`): while the drawer is open (`main1.sidebar-open`), run the poll and update each row's spinner; stop when the drawer closes.
    - Dedupe by repo: collect the distinct set of repos across all routed projects, call `fetchActiveRuns` once per repo, then map each result back to every row whose project routes to that repo (multiple projects can share one repo). Fire-and-forget; `ok:false` → not active (no spinner, no toast).
    - Cadence while open: refresh immediately on open, then a light interval (~10s). No polling at all when the switcher is closed.
  - Implementation notes:
    - Reuse `fetchActiveRuns(target)` and the shared `@keyframes` spin from the active-project entry. Resolve a project's repo via `listLogic.getProjectTargetId(name)` → `findTargetById(id)` → `target.repo`.
    - Desktop: in `projectPicker.js`, add the spinner element to each `.projectPickerRow` (inserted before `.projectPickerCount`) during `buildProjectPickerRows`, and own the open-gated poll inside the picker factory (it already tracks `projectPickerIsOpen`). Import `findTargetById` from `inject.js` (no circular — `inject.js` doesn't import the picker).
    - Mobile: the `#projChild` rows + drawer live in `main.js` (grep with `offset`/`limit`; do not read it whole). Model the run spinner on the existing ⚡ bolt indicator (`attachProjectInjectIndicator` in `projectRow.js`) — a small element toggled by the poll, placed left of the `.projBadge` count, with the `#projChild` grid gaining a column for it the way `.hasInjectBolt` adds the leading bolt column. Hide it during rename like the bolt does.
    - Optional: the small shared in-memory cache (repo → { active, at }, few-second TTL) floated in the prior entry lets the dropdown, drawer, and active-project polls dedupe calls to the same repo. Skip if it complicates.
  - Out of scope:
    - The active-project trigger spinner and the cross-device viewer pill — shipped in the prior entry.
    - Any Worker change — `active_runs` is deployed.
    - The Runs tab list — deliberately device-local, not synced.
    - A persistent/always-on all-repos poll — the wide poll is open-gated only.
  - File: `toDoList_main/src/projectPicker.js`, `toDoList_main/src/main.js`, `toDoList_main/src/projectRow.js`, `toDoList_main/src/style.css`
  <!-- id: a49b50e1-90bf-467d-8007-1f2c721cb99d -->

- [x] **[LOW]** Add a no-op test entry to verify the inject-and-run pipeline end-to-end
  - Type: feature
  - Description: This is a test entry to confirm the full pipeline — inject, dispatch, build, merge, deploy — completes successfully and checks off the entry. The build agent should open a trivial PR (e.g., add and remove a single comment in `main.js`) that passes all existing tests, auto-merges, and marks this entry complete. No functional change should survive in the final codebase.
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-06-24
  <!-- id: 1ab046ed-e3ec-4ed6-9fca-7a65750468e9 -->

- [x] **[MEDIUM]** Add a text-only Clear chat button right of the Chat/Runs tab selector and hide the workspace pill
  - Type: feature
  - Description: Hide the workspace/repo selector pill (`#claudeWorkspacePill`) and add a text-only "Clear chat" button (no trash icon) positioned to the right of the Chat/Runs tab selector in the Claude sheet. Clearing wipes the in-memory chat message array and the persisted chat history (localStorage), removing all rendered chat bubbles — it must NOT reset the attached file chips or the iterate seed, only the messages. Because the pill is being removed, preserve the repo frame it used to set: `activeChatRepo` must keep a valid value (default to `rsterenchak/toDoList_TOP` or the last-selected/persisted repo) so `body.repo` still rides correctly on every chat turn and the chat → inject/dispatch flow continues to send the right repo. The pill's open-menu listener and repo-select handler must be cleanly detached rather than left firing on a hidden/removed node. The button should match existing header-control styling (using the danger/accent token consistent with a clear action) and honor both dark and light themes. Likely locations: the tab-selector and pill markup/wiring plus the new button in `claudeSheet.js`, message-state/persistence handling in `claudeSheet.js`, and header/tab styling in `style.css`.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 8b840e5e-019a-4188-acdc-002b3bdacb1b -->

- [x] **[LOW]** Add glowing FAB style to the mobile chat button
  - Type: feature
  - Description: The mobile chat button is visually subtle and easy to miss. Give it a circular FAB appearance with a soft purple glow halo (two concentric radial layers at ~15–18% opacity using `#6C5DF5`) behind the button circle, matching the Void accent color. The button must stay in its current fixed position — no layout or positioning changes, only visual layer additions via `box-shadow` and/or a pseudo-element glow. Apply only at mobile breakpoints so the desktop layout is unaffected.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/mobileSheets.js`
  - Completed: 2026-06-24
  <!-- id: a6be4397-6b4a-425e-93c5-8e27c225ed93 -->

- [x] **[MEDIUM]** Fix mobile chat button glow not appearing on the live button
  - Type: bug
  - Description: A prior PR added a glowing FAB style for the mobile chat button, but the button is visually unchanged on a real device — a green Shipped status was not proof the fix worked. First confirm which file actually renders the mobile chat button and what its real selector/class is (grep for the button creation, likely in `mobileSheets.js`, `main.js`, or `claudeSheet.js`), then verify the glow rule targets that exact element and is not scoped out by the mobile media query on real viewports or overridden by a more specific existing rule. Expected result: the mobile chat button shows the circular FAB with the soft purple glow halo (`#6C5DF5` radial layers) in its current fixed position, verified on a real mobile viewport — not just present-in-CSS. Add a check that the glow selector matches the rendered button so this can't silently no-op again.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/mobileSheets.js`, `toDoList_main/src/main.js`
  - Completed: 2026-06-24
  <!-- id: b0ead23e-57ff-44fa-9489-5b5ab1287ec3 -->

- [x] **[MEDIUM]** Fix mobile chat button glow and style it as a purple FAB with white sparkle icon
  - Type: bug
  - Description: The prior glow PR shipped but produced no visible change on the real button. Grep for the mobile chat button's actual DOM element and class name across `mobileSheets.js`, `main.js`, and `claudeSheet.js` to find the correct selector. Apply the following styles to that element at mobile breakpoints: circular shape (`border-radius: 50%`), purple background (`#6C5DF5`), white sparkle icon (✦) centered, and a three-layer radial glow halo using `box-shadow` (e.g. `0 0 8px 4px rgba(108,93,245,0.35), 0 0 18px 8px rgba(108,93,245,0.18), 0 0 30px 14px rgba(108,93,245,0.10)`). Button must stay in its current fixed position — no layout or positioning changes. Verify the glow and purple face are visible on a real mobile viewport after deploy.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/mobileSheets.js`, `toDoList_main/src/main.js`
  - Completed: 2026-06-24
  <!-- id: 28817a1a-f757-4bff-b821-d49435dc1ea1 -->

- [x] **[LOW]** Increase mobile chat button sparkle icon size by 20%
  - Type: feature
  - Description: The white sparkle icon (✦) on the mobile chat FAB button should be 20% larger than the size set in the prior PR. Find the existing font-size applied to the sparkle icon on the mobile chat button and multiply it by 1.2 (e.g. if it was set to 13px, update to ~15.6px). No other changes — button size, position, glow, or background color must remain untouched.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-06-24
  <!-- id: 36dca112-d267-4238-a898-45f2f61052a8 -->

- [x] **[LOW]** Replace red clear-chat button with a purple "New Chat" button in the Claude sheet header
  - Type: feature
  - Description: The current clear-chat button in the Claude sheet header is styled red (destructive color). Replace it with a "+ New Chat" button using the purple accent palette (`#2a2560` fill, `#6C5DF5` border, `#9D93EE` text) to match other purple UI elements in the sheet. The button's behavior (clearing the chat and starting fresh) stays the same — only the label ("+ New Chat") and color change. Update both the element's label/aria-label and its CSS styling; do not change any other header elements.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/style.css`
  - Completed: 2026-06-24
  <!-- id: d667cf1f-2771-48e6-9be2-d8d08667bb24 -->

- [x] **[LOW]** Add a scroll-to-bottom arrow button centered above the composer when chat is not scrolled to the latest message
  - Type: feature
  - Description: When the user scrolls up in the Claude sheet chat window and is not at the bottom, display a centered "↓" pill button floating just above the composer input. The button should be styled with the purple accent palette (`#2a2560` fill, `#6C5DF5` border, `#9D93EE` text/arrow) to match other sheet UI elements. Tapping it scrolls the chat to the latest message and hides the button. The button should be hidden when the chat is already scrolled to the bottom (within a small threshold, e.g. 40px). Implement the scroll detection via a `scroll` event listener on the chat messages container in `claudeSheet.js`, and position the button absolutely centered above the composer using CSS. The button must not overlap or shift the composer input.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/style.css`
  - Completed: 2026-06-24
  <!-- id: a88a664b-f0f3-4727-bce6-4fedf39af390 -->

- [x] **[LOW]** Add upward light beam glow effect to the scroll-to-bottom arrow button on hover
  - Type: feature
  - Description: When the user hovers over the scroll-to-bottom "↓" pill button in the Claude sheet chat window, display an upward-fading light beam glow emanating from the button — a vertical gradient rectangle above the pill that fades from `#6C5DF5` at the button edge to transparent at the top. Implement via a CSS `::before` pseudo-element or a sibling element on the button, using a `linear-gradient` from `rgba(108,93,245,0.25)` at the bottom to `rgba(108,93,245,0)` at the top. The glow should appear on `:hover` and transition in smoothly (e.g. `opacity` transition ~200ms). The button's base styles and scroll behavior must remain unchanged.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/claudeSheet.js`
  - Completed: 2026-06-24
  <!-- id: a139bd35-27e5-46b6-a070-903534d0ebe2 -->

- [x] **[LOW]** Add soft radial purple glow to the scroll-to-bottom arrow button on hover
  - Type: feature
  - Description: When the user hovers over the scroll-to-bottom "↓" pill button in the Claude sheet chat window, display a soft radial purple glow blooming outward from the button center. Implement via a CSS `box-shadow` with multiple layered spread values on `:hover` to simulate the radial bloom effect — e.g. `box-shadow: 0 0 8px 2px rgba(108,93,245,0.18), 0 0 16px 6px rgba(108,93,245,0.12), 0 0 28px 10px rgba(108,93,245,0.08)`. The glow should transition in smoothly (~200ms). The button's base styles and scroll behavior must remain unchanged.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/claudeSheet.js`
  - Completed: 2026-06-24
  <!-- id: 85cb887e-4a15-425c-a7fb-dfa13460f833 -->

- [x] **[LOW]** Remove the upward light beam hover effect from the scroll-to-bottom arrow button
  - Type: bug
  - Description: The scroll-to-bottom "↓" pill button in the Claude sheet chat window has an upward light beam glow on hover (a vertical linear-gradient pseudo-element or sibling element). Remove this effect entirely — delete the associated CSS rule(s) targeting the beam on `:hover`. The button's base styles, the soft radial glow (if already shipped), and the scroll behavior must remain unchanged.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/claudeSheet.js`
  - Completed: 2026-06-25
  <!-- id: 9ea44835-a730-49d4-9f2e-2aa914151832 -->

- [x] **[MEDIUM]** Add verdict panel and Follow-up chat to No-change run rows — Completed: 2026-06-25
  - Type: feature
  - Description: The Runs-tab "No change" row currently taps straight out to the GitHub Actions log. Make it an inline accordion (Option A): tapping the row expands a panel showing the agent's closing summary — why the run merged nothing — lazily fetched via the Worker's new `run_result` route and cached on the run record, with a purple "Follow up" button and a relocated "Open full log ↗" link. "Follow up" opens a seeded author chat whose first turn carries the original entry block plus that summary, framed so Sonnet helps draft a corrected entry. The expand/collapse, panel, and buttons live in `buildRunRow`'s NOCHANGE branch in `claudeSheet.js`; the fetch wrapper goes in `inject.js`; the panel styling in `style.css`.
  - Behavior:
    1. The NOCHANGE row's trailing affordance becomes an expand chevron (collapsed vs expanded) replacing the current `↗` open-log glyph (`.claudeRunOpenGlyph`); tapping the row header toggles the panel and no longer calls `window.open(rec.runUrl)` directly.
    2. On first expand, if `rec.result` isn't cached, call the new `fetchRunResult` with `rec.runId` (falling back to `rec.correlationId`), showing a brief loading state; cache the returned summary on `rec.result` and persist the record so re-expands and reloads render instantly without re-fetching.
    3. The expanded panel renders the summary amber-tinted to match the `.claudeRunBadge--nochange` tokens in SpaceMono, with an action row holding a purple "Follow up" button and an "Open full log ↗" link (the relocated `window.open(rec.runUrl)`).
    4. "Follow up" fetches the original entry block (read TODO.md via the existing `read` path, extract the block carrying `<!-- id: rec.entryId -->`), switches to the Chat tab, and auto-sends a first author turn: a short framing line ("This entry ran but made no change; here's the agent's summary explaining why — help me draft a corrected follow-up entry") followed by the entry block and the summary.
    5. If `run_result` returns an empty result or fails, the panel shows a one-line fallback ("Couldn't read the run summary") and keeps "Open full log ↗" available.
  - Acceptance criteria:
    - SHIPPED rows are untouched: tap-to-iterate, the `entry_id`-on-turn-1 iterate seed, and the Revert control behave exactly as before — only the NOCHANGE branch of `buildRunRow` changes.
    - The Follow-up seed is a plain author turn and must NOT send `body.entry_id` (a NOCHANGE run has no merged PR, so the iterate seed would 404 with "nothing to iterate on yet"); the summary and entry ride in the user message, and the Worker auto-loads CLAUDE.md + manifest as on any author turn.
    - "Open full log ↗" still opens `rec.runUrl` in a new tab, and `rec.runUrl` continues to be populated at reconcile.
    - Expand state is per-row: with multiple NOCHANGE rows, expanding one neither collapses nor triggers a fetch on the others.
    - Existing `claudeSheet` Runs-tab / NOCHANGE tests still pass; any test asserting the old "tap opens the log" behavior is updated to the toggle, and a test covers first-expand fetch+cache and Follow-up composing a seed with no `entry_id`.
  - Implementation notes:
    - New `inject.js` wrapper `fetchRunResult(runId, target)` posts `{ run_result: true, run_id: runId, repo, filePath }` to the Worker (mirrors the existing run-call wrappers; send `correlation_id` instead when `runId` is absent).
    - Persist `rec.runId` at reconcile: in `reconcileSuccessConclusion`'s NOCHANGE branch, where `rec.runUrl` is set from the poll response, also set `rec.runId = res.runId` (already present in the status response); older records without it fall back to the Worker's `correlation_id` lookup.
    - Reuse the existing marker walk (`entryCheckboxState` keys off `<!-- id: <uuid> -->`) to locate and slice the entry block from the `read` content for the seed.
    - No new dependencies; keep panel CSS in `style.css` using existing Void tokens (amber bg `#241d12` / border `#6e5a2a` / text `#cbb079`, purple `#6C5DF5` for the button, SpaceMono for the summary), with mobile-sized touch targets.
  - Out of scope: the Worker `run_result` route and the routine's summary-sentinel change (shipped separately), and any change to SHIPPED-row iterate or Revert.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/inject.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/claudeSheet.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 11ba9e84-b2eb-43f9-9c04-7848bbd2d74c -->

- [x] **[MEDIUM]** Add a lower-center update-reload pill on mobile — Completed: 2026-06-25
  - Type: feature
  - Description: On mobile, when a service-worker update is waiting, the only way to apply it is to spot the gear-button dot, open Settings, and tap the About → Version "Update available" pill — buried behind several taps. Add a compact reload pill anchored in the lower-center of the viewport (the thumb zone, floating just above the bottom nav) that appears whenever an update is pending and applies it on tap. It shows a refresh icon, "Update available", a "Reload" tap target, and a × to dismiss. Mobile-only — desktop keeps its existing footer version cue unchanged. The pill element and its event wiring live in `main.js` alongside the existing mobile update cue, styled in `style.css`.
  - Behavior:
    1. The pill is mobile-only (≤1023px, matching where the desktop footer is hidden) and never renders on desktop, which keeps its `#footVersion` cue.
    2. It appears whenever an update is pending: it listens for the `appUpdateAvailable` event AND checks `hasPendingUpdate()` on mount, so an update detected during boot (before the pill is wired) still surfaces.
    3. Tapping "Reload" calls `applyPendingUpdate()` — the same skipWaiting + reload path the desktop footer and Settings pill use.
    4. Tapping × dismisses the pill for the session without clearing the pending update; the gear-button dot and the Settings → About "Update available" pill stay as the persistent fallback.
    5. The pill auto-removes when the update is applied from any surface — it listens for `appUpdateApplied` (fired just before the `controllerchange` reload) and tears itself down on that event.
  - Acceptance criteria:
    - No new reload logic: the Reload tap routes through `applyPendingUpdate()` in `modals.js`; the pill must not postMessage the worker or reload directly.
    - Dismissing must not clear `pendingUpdateRegistration` — the update stays pending and the gear-dot/Settings cues stay live.
    - Desktop is untouched: no change to `#footVersion`, and the pill must not mount above 1023px.
    - Single instance: if `appUpdateAvailable` fires more than once, reuse the existing pill rather than stacking duplicates.
    - It must clear the bottom nav and the iOS home indicator (respect `env(safe-area-inset-bottom)`) and never permanently obstruct the nav's tap targets.
  - Implementation notes:
    - Build the pill in `main.js` where `paintAboutVersionUpdateCue` and the gear-dot wiring already live, reusing the `hasPendingUpdate` / `applyPendingUpdate` imports from `modals.js`; add listeners for `appUpdateAvailable` (show) and `appUpdateApplied` (remove) plus a mount-time `hasPendingUpdate()` check.
    - Gate visibility with the app's `isMobile()` (`< 1024`) and/or a ≤1023px media query so it tracks the same boundary as the hidden footer.
    - Position with `position: fixed; left: 50%; transform: translateX(-50%);` anchored near the bottom (above the nav), with `bottom` accounting for the nav height + `env(safe-area-inset-bottom)`, and a z-index above the chrome.
    - Style with the Void tokens (surface `#191a22`, faint border, purple `#6C5DF5`/`#9D93EE` for the refresh icon and Reload, light `#e8e8f0` / muted `#8a8a99` text), SpaceMono/Trebuchet, with comfortable (~44px) tap targets for Reload and ×; no new dependencies (inline SVG or a simple glyph for the refresh icon).
  - Out of scope: the desktop footer cue and the Settings/gear-dot cues (unchanged — this is an added third surface), and any change to the service-worker registration, `applyPendingUpdate`, or the `controllerchange` reload in `index.js` / `modals.js`.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 360b8fcd-bf61-4cc9-a8bc-071844c505fe -->
