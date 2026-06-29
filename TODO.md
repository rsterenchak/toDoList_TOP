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

- [x] **[LOW]** Add a no-op comment to trigger a deploy and test the reload-on-update flow
  - Type: feature
  - Description: Add a single innocuous code comment (e.g. `// reload-on-update test — safe to remove`) to `main.js` so webpack produces a new content-hashed bundle on the next deploy. This is a deliberate no-op change whose sole purpose is to trigger the service worker update cycle so the reload-on-update UI can be observed in the wild. No behavior, styling, or logic should change.
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-06-25
  <!-- id: ddbe5425-49f5-431e-bc65-b16d3fb87a4a -->

- [x] **[LOW]** Fix white sparkle icon vertical centering inside the mobile chat FAB button
  - Type: bug
  - Description: The white sparkle icon (✦) inside the mobile chat button appears visually off-center. This is typically caused by text baseline offset when using a character as an icon — fix by replacing any `line-height`/padding approach with `display: flex; align-items: center; justify-content: center` on the button element, or by using `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)` on the icon element. The goal is pixel-accurate centering regardless of font metrics. No other changes to button size, position, color, or glow.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-06-25
  <!-- id: 301e26f6-e23d-4364-8fcf-164da2d58cbb -->

- [x] **[LOW]** Adjust mobile Claude launcher sparkle vertical offset to -10% relative to the FAB button

  - Type: bug
  - Description: The ✦ glyph on the mobile `#claudeLauncher` FAB still appears visually off-center after the prior 1px translateY nudge. Change the `transform` on `#claudeLauncher` inside `@media (max-width: 1023px)` from `translateY(1px)` to `translateY(-10%)` so the glyph shifts up by 10% of the button's height. Update the existing regression test in `mobileLauncherSparkleCentering.test.js` to expect the new value. No other properties (size, color, glow, position) should be changed.
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/mobileLauncherSparkleCentering.test.js`
  - Completed: 2026-06-25
  <!-- id: 99333a94-9d75-4d38-af8d-99fbca429860 -->

- [x] **[LOW]** Adjust mobile Claude launcher sparkle vertical offset to -15px — Completed: 2026-06-25

  - Type: bug
  - Description: The current `translateY(-10%)` on `#claudeLauncher` at `@media (max-width: 1023px)` is insufficient to optically center the sparkle glyph. Change the transform to `translateY(-15px)` for a fixed, density-independent upward shift. Update the corresponding test in `mobileLauncherSparkleCentering.test.js` to expect value `-15` with unit `px`.
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/mobileLauncherSparkleCentering.test.js`
  - Completed:
  <!-- id: 650f005c-9237-4366-9623-55234e32b68c -->

- [x] **[MEDIUM]** Add a desktop-only focus mode with an ambient space-drift scene — Completed: 2026-06-25
  - Type: feature
  - Description: Add a desktop-only focus mode for studying that hides the entire dashboard behind a calm, endlessly-drifting space scene, entered from a new icon in the nav's right-hand control cluster. Activating it dissolves the dashboard with a gentle cross-fade into a full-bleed near-black starfield with soft drifting nebulae; there is deliberately no timer or countdown shown anywhere, since the goal is to study without watching the clock. Music and the Pomodoro session stay reachable through a minimal corner cluster (a now-playing chip plus a single icon-only session control) that drives the existing `music.js` and `pomodoro.js` singletons, so the session keeps running silently. Exit with Esc or a dim "exit · esc" affordance, which reverses the transition back to the dashboard.
  - Behavior:
    1. New icon button in the nav right-cluster (beside the Pomodoro, music, and settings toggles), desktop-only — hidden on mobile the same way those toggles already are. Clicking it enters focus mode.
    2. Enter transition: the opaque space scene cross-fades in over ~450ms ease-out with a slight scale settle (≈1.02→1), fully covering the dashboard (nav, sidebar/rail, list, footer, chat pane, and the ghost companion). `prefers-reduced-motion: reduce` collapses this to a quick plain cross-fade with no scale.
    3. Scene (matches the approved mockup): full-bleed near-black space — two layered star fields drifting at different speeds, 2–3 soft nebula glows slowly drifting/pulsing in the Void purples, a handful of brighter twinkling stars, an occasional slow shooting star, and a subtle vignette.
    4. Corner controls, no countdown: a now-playing chip showing the active station with an animated equalizer (reflecting the music singleton's state), and one round icon-only control that toggles the Pomodoro session — start when idle, pause/resume when running — never displaying MM:SS.
    5. Exit via Esc or the dim "exit · esc" pill (top-right); the transition reverses and the dashboard returns. Clicking the scene itself does not exit, so a stray click while studying doesn't drop you out.
    6. When a Pomodoro session completes while focus mode is open, the scene gives a brief ambient brighten/pulse as the cue; the existing completion alerts (sound, notification, favicon/tab flash) still fire globally — no number is surfaced in the scene.
  - Implementation notes:
    - New module `toDoList_main/src/focusMode.js` mirroring the controller shape of `companion.js` / `pomodoro.js` / `music.js`: `createFocusMode(doc)` returning `{ activate, deactivate, isActive, destroy }`. Gate availability on the same desktop check `companion.js` uses (`(min-width: 1024px) and (pointer: fine)`); build the overlay DOM lazily on first activate and keep it in the DOM (hidden via a class) so re-entry is instant; stop any rAF/timers and remove the animation-driving classes on deactivate so no paint cost is incurred while off (mirror companion's "no work when disabled" approach).
    - Reuse the existing `music.js` / `pomodoro.js` singletons via their accessors (`ensureMusic` / `ensurePomodoro`, surfaced through `getMusicController` / `getPomodoroController` in `main.js`) and subscribe for state → control sync. Do not rebuild the music popover, now-playing strip, or bottom sheet — they stay untouched.
    - Wire the toggle into `component()`'s nav-cluster assembly next to `pomodoroToggle` / `musicToggle` / `settingsToggle`, and hide it on mobile exactly as those are `display:none` below the desktop breakpoint. `main.js` is over 25k tokens — grep with `offset`/`limit` to locate the nav-cluster assembly and the singleton accessors rather than reading the file whole.
    - Scene is pure CSS in `style.css` (layered radial-gradient star tiles animating via `background-position`, drifting nebula divs, twinkle, a shooting-star sweep, vignette) — no canvas and no animation library, so no new dependency. Respect `prefers-reduced-motion: reduce` by disabling the drift/twinkle/shoot/scale animations, matching the existing companion/pomodoro reduced-motion blocks.
    - Overlay z-index sits above all dashboard chrome including the companion; keep the corner controls inline and simple so they introduce no new anchored popovers. Note for review: focus mode is a deliberate full-screen takeover, not a dismissible modal, so it intentionally does not follow the "modals close on backdrop click" rule — exit is Esc or the explicit affordance only.
    - Ephemeral: focus mode is session-only and not persisted to `localStorage`, so a page refresh always returns to the dashboard.
  - Out of scope: any visible timer/countdown inside focus mode (intentional); mobile/touch support (desktop-only by design — the button is hidden and the module no-ops on non-desktop viewports); ambient session progression (the scene slowly drifting toward a planet or shifting over the focus block) as a possible later enhancement; bringing the ghost companion into the scene.
  - File: `toDoList_main/src/focusMode.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 9040d11a-2fdc-48ca-ac83-1416983d8515 -->

- [x] **[MEDIUM]** Persist the iterate entry id across all turns of an iterate session so follow-ups keep the diff — Completed: 2026-06-26
  - Type: feature
  - Description: Today an iterate session only carries the merged-PR diff on turn 1. `startIterateFromRun(rec)` in `claudeSheet.js` passes `rec.entryId` to `requestAssistantReply(entryId, deep)` for the seed turn, but that id is a transient argument that is never stored — so `sendChatTurn` calls `requestAssistantReply(undefined, deep)` and `sendInspectTurn` calls `requestAssistantReply()` with no id, and every follow-up (including the INSPECT measurement turn, which is the turn meant to diagnose against the diff) reaches the Worker with no `entry_id` and the model loses the shipped code. The Worker now caches and re-serves the seed cheaply on every turn an id is present (already deployed), so the fix is purely client-side: hold the active iterate entry id as state and send it on every turn of the session. Add a per-repo iterate-entry map persisted in lockstep with the per-repo chat map (`chatHistory` under `CHAT_KEY` = `todoapp_claudeChat`) — e.g. a parallel `todoapp_claudeIterateEntry` map keyed by repo, with read/write/delete helpers mirroring `loadChatHistory`/`saveChatHistory`/`deleteChatHistory` — plus an in-memory value for the active workspace repo. Behaviors to satisfy: (1) `sendChatTurn` and `sendInspectTurn` send the active repo's stored iterate entry id as `entry_id`, replacing the hardcoded `undefined`/no-arg, so follow-ups and INSPECT turns carry the diff. (2) `startIterateFromRun` promotes `rec.entryId` to the stored iterate entry ONLY when the seed turn succeeds; on a 404 ("nothing to iterate on yet") it must NOT set it and must clear any existing value, so follow-up turns don't loop retrying a dead seed — and because `requestAssistantReply` swallows the error internally, this establish-on-success / clear-on-404 logic belongs inside `requestAssistantReply`'s own success and catch branches (where the outcome is actually known), keyed on the passed id being truthy, rather than in `startIterateFromRun` which can't see the swallowed 404. (3) The "No change" follow-up path (the `requestAssistantReply()` call seeded from a No-change run, intentionally a plain author turn with no merged PR) must CLEAR the active repo's iterate entry so it never inherits a stale id. (4) `clearChatConversation` ("+ New Chat") must clear the active repo's iterate entry, in-memory and persisted, alongside the chat wipe — its current comment claiming the iterate seed is "a transient arg ... never stored state, so clearing the messages can't disturb it" becomes false and must be rewritten. (5) The workspace auto-swap path (`autoSwapWorkspaceForProject` / `syncClaudeSheetForProject`) and the mount-hydrate path must load the NEW active repo's stored iterate entry alongside its replayed thread, so switching repos resumes that repo's iterate session (or none) instead of carrying an id across repos, and a reload mid-iterate resumes with the diff intact rather than silently dropping to no-diff turns. No change is needed in `inject.js` (`chatWithWorker` already sets `payload.entry_id` whenever an id is passed) or the Worker. Also correct the now-stale docs in CLAUDE.md's "Three context modes → (c) Iterate seed" section, which says the id is sent on the first turn only and later turns omit it — it is now sent on every turn of an active iterate session. Add Vitest coverage in `claudeSheet.test.js`: a follow-up turn sends `entry_id` while a session is active; "+ New Chat" and a workspace swap both clear it; a seed 404 does not establish it; the No-change follow-up sends no `entry_id`.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/tests/claudeSheet.test.js`, `CLAUDE.md`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 9ce7e5f4-cd84-41e4-9068-c442183921fd -->

- [x] **[MEDIUM]** Restructure mobile task rows: status as left-edge color, full-width single-line title — Completed: 2026-06-27
  - Type: feature
  - Description: On the mobile Projects list, each todo row crams the title, an inline status pill (IN PROGRESS / ACTIVE), a copy icon, and the due control onto one ~44px line, squeezing the title to ~18 characters so most entries truncate. Remove the inline status pill from mobile rows and instead encode status as a ~3px rounded color tab on the row's left edge (amber for in-progress, accent purple for active), keyed off the same status class/attribute that currently drives the pill color so every status carries over. With the pill gone, give the title the full remaining width as a single ellipsis-truncated line, and order the right-side controls as due control then copy icon. Keep the existing due element (amber calendar control) and the copy button exactly as they behave today — this only changes their placement. Prefer a CSS-only approach: hide `.todoStatusLabel` inside the mobile media query (the element stays in the DOM for desktop), draw the edge tab via a `::before` on the row keyed to its status, and reorder due/copy with flex `order` — so `toDoRow.js` ideally needs no change. Scope strictly to the mobile breakpoint; the desktop two-pane row layout is untouched.
  - Behavior:
    1. Row left edge shows a ~3px rounded status tab; color maps from the row's existing status hook (in-progress → amber, active → accent purple).
    2. Title spans the full width between the checkbox and the right cluster, single line, truncating with an ellipsis.
    3. Right cluster order: due control, then copy icon.
    4. The existing tap-to-read accent edge (`data-mobile-read`) takes visual precedence over the resting status tab when a row is expanded for reading.
  - Out of scope: desktop row layout; the ACTIVE filter pill + SORT toolbar row (separate pass); any change to status values or due-date behavior.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/toDoRow.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 9e641258-f4a6-4b5f-a256-411b4548f1af -->

- [x] **[LOW]** Add spacing between row status edge tab and title first letter on mobile
  - Type: bug
  - Description: On the mobile Projects list, the ~3px left-edge status tab sits flush against the first character of the title — the colored bar and the text visually collide with no gap. Add horizontal breathing room so the title's first letter clears the tab: increase the title's left padding (or the row's left content padding) by ~8–10px beyond the tab width so the gap reads consistently with the row's other internal spacing. Keep it uniform across all statuses, and ensure the inset doesn't shift the title horizontally when the tap-to-read accent edge (`data-mobile-read`) becomes active. CSS-only, scoped to the mobile breakpoint.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-06-27
  <!-- id: cb244d75-1c01-4e5c-b7cc-2ad526df95a6 -->

- [x] **[MEDIUM]** Fix add-task chip row clipping and colliding on mobile — Completed: 2026-06-27
  - Type: bug
  - Description: On the mobile Projects list, focusing the `+ Add a task` placeholder expands it and reveals the quick-option chip row (Today / Tomorrow / 📅 / `+ ¶`), but the chips render clipped — their bottom is cut off by the row's edge — and the expanded box visually collides with the first real task below. Root cause: `#mobileCreateChips` is appended inside the `#toDoChild` placeholder and flex-wrapped onto a second line, but `#toDoChild` is a grid item in `#mainList` with `overflow: clip` and a `grid-auto-rows: minmax(54px, auto)` track — the track undersizes the wrapped chip line so `overflow: clip` crops it, and simply switching the row to `overflow: visible` would instead make the chips overlap the row below. Fix by rendering the chip row as its own panel directly beneath the placeholder — a sibling in `#mainList` occupying its own grid row, mirroring how `#descSibling` attaches under a row — so it gets real measured height and is never clipped or overlapping. In `mobileTaskCreate.js`, insert the chips element as the placeholder's next sibling once the row is mounted instead of appending it as a child; the chip click handlers already close over `toDoChild`/`item`, so they keep working. In `style.css`, change the reveal selector from the descendant form (`#toDoChild[data-blank-placeholder]:focus-within #mobileCreateChips`) to the adjacent-sibling form (`… :focus-within + #mobileCreateChips`), and give the panel the same attached treatment (dashed top divider, matched side gutters, bottom radius) used for `#descSibling`. Scoped to the mobile breakpoint; desktop is unaffected.
  - File: `toDoList_main/src/mobileTaskCreate.js`, `toDoList_main/src/style.css`, `toDoList_main/src/toDoRow.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 71d127fa-16ad-4bf6-9ea2-f9553a2dda87 -->

- [x] **[MEDIUM]** Add a task status selector to the mobile description editor modal — Completed: 2026-06-27
  - Type: feature
  - Description: On mobile there is now no way to set a task's workflow status — the status badge that doubles as the change control on desktop (`.todoStatusLabel` → `showStatusPopover`) is hidden on the mobile breakpoint in favor of the left-edge color tab, so status is shown but no longer settable. Add a status selector to the mobile description editor modal (`descEditorModal` in `modals.js`), which is already the per-task sheet (it edits the title plus Clear / Inject / Copy entry). Render it as a segmented control — three connected segments `○ ACTIVE | ⏵ IN PROGRESS | ○ IDEA` — in a labeled `Status` row in the modal body, sitting between the textarea (`#descEditorModalBody`) and the actions row (`#descEditorModalActions`). The selected segment fills with its status color, matched to the row edge tab (active → accent purple, in_progress → amber, idea → muted). Pull the labels and order from `STATUS_META` / `STATUS_ORDER` in `todoStatus.js` so the vocabulary stays single-sourced rather than re-hardcoded.
  - Behavior:
    1. On open, the control reflects the row's current `item.status` (default Active for legacy/undefined, via `normalizeStatus`).
    2. Tapping a segment writes through `listLogic.setToDoStatus(projectName, item, status)` — the same mutation channel the desktop badge uses — so the localStorage write and Supabase mirror come for free; new tasks still default to Active, unchanged.
    3. After the write, reflect the change on the underlying row live (the modal is an overlay, the row is still mounted): resolve the row from `item` within `#mainList` (match on `__item`), call `refreshTodoStatusUI` to repaint its left-edge color, then `reorderToDoDOM(projectName)` so it re-sorts/re-filters when sort = Status.
  - Out of scope: the desktop on-row status badge (unchanged); any new status values; changing the default for new tasks.
  - File: `toDoList_main/src/modals.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 98ebba47-a8cb-45eb-b992-9c29e481409b -->

- [x] **[MEDIUM]** Rework the filter + sort row on mobile: segmented status filter, icon-only sort — Completed: 2026-06-27
  - Type: feature
  - Description: On mobile only, rework the task filter + sort row (`#taskFilterBar`). Keep the existing cycle pill (`.taskCyclePill`) as the desktop control untouched, and add a separate three-segment filter — `All · Active · Ideas`, each segment showing its live count, the active filter's segment tinted accent — that renders only at the mobile breakpoint and sets the filter directly on tap (no cycling). Gate the two with CSS so exactly one is ever visible: the cycle pill hides at the mobile breakpoint, the segmented control hides on desktop — mirroring the existing dual Sort-trigger pattern (`#taskSortBtn` overlay on desktop, `#taskSortBtnMobile` in the filter row on mobile), so both filter controls share one state via `getTaskFilter`/`setTaskFilter`. Also collapse the mobile Sort trigger (`#taskSortBtnMobile`) from its `Sort: Status` text label to an icon-only button (a sort glyph) carrying a small accent dot when the active sort is anything other than None; it opens the same `#taskSortMenu`. Match the segmented control's active-segment tint to the status selector's segmented control so filtering and status-setting share one visual language on mobile. Desktop is untouched — the cycle pill and the labeled `#taskSortBtn` both stay as-is.
  - Behavior:
    1. `buildTaskFilterBar` in `taskFilter.js` builds the existing cycle pill AND a new segmented control in the same bar; CSS shows the cycle pill on desktop and the segments on mobile. Tapping a mobile segment calls `setTaskFilter(key)` for that segment directly, repaints the active segment, and runs `applyTaskFilter`.
    2. `applyTaskFilter` → `updateCounts` refreshes counts on both controls from the existing `{all, active, ideas}` totals (write each count into its segment as well as the cycle pill); the matching logic (active = active+in_progress, ideas = idea) is unchanged. Keep `paintCyclePill` for the desktop pill and add a parallel paint pass for the segmented active state so both stay in sync regardless of which is visible.
    3. `#taskSortBtnMobile` (built in `main.js`) renders icon-only with the sort glyph; `syncTaskSortButton` toggles an active-dot/class when `getTaskSort() !== 'none'`. Still anchors/opens `#taskSortMenu` via the existing `activeSortTrigger`/`showTaskSortMenu` path. The desktop `#taskSortBtn` keeps its text label.
    4. Mobile segments stay comfortably tappable (match the existing pill height, adequate touch hit area); CSS fit check at the mobile breakpoint so the three segments + icon sort don't overflow `#taskFilterBar`.
  - Out of scope: the desktop cycle pill and desktop `#taskSortBtn` (both unchanged); the sort menu contents; the filter matching logic; any change to which statuses map to which filter.
  - File: `toDoList_main/src/taskFilter.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 97e9d77d-4ea2-49a0-b1f5-771c8c1780d8 -->

- [x] **[LOW]** Resize the mobile segmented filter to content-width with a tinted active segment
  - Type: feature
  - Description: The mobile segmented status filter (the `All · Active · Ideas` control in `#taskFilterBar`) shipped stretched edge-to-edge with each segment flexed to fill the row, and its active segment painted as a solid `#6C5DF5` block — heavier and wider than intended. Size the segmented control to its content instead: drop the `flex: 1` / full-width on the segment container and its segments so the group hugs its labels and sits left-aligned, letting the icon-only Sort trigger (`#taskSortBtnMobile`) hold the right edge via its existing `margin-left: auto`. Soften the active segment from the solid fill to the accent tint used by the status selector's segmented control (tinted background + accent-purple text) so the two segmented controls read as one family. CSS-only, scoped to the mobile breakpoint; the desktop cycle pill and all filter behavior are untouched.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-06-27
  <!-- id: 307cde38-22c1-428e-919b-2d89d227c706 -->

- [x] **[LOW]** Restructure the description-editor modal actions into a primary + secondary layout — Completed: 2026-06-27
  - Type: feature
  - Description: The action buttons in the mobile description-editor modal (`#descEditorModalActions` in `modals.js`) sit in a single row at three different content-widths — Clear small, Inject to TODO.md wide, Copy entry between — so the row reads as unstructured. Restructure into a primary + secondary layout: Inject becomes a full-width filled primary button on its own top row (keeping the upload icon and the full `Inject to TODO.md` label), with Clear and Copy entry as an equal-width (50/50) outline pair on a second row beneath. This also flips the fill emphasis — Inject takes the solid accent fill (it is currently an accent outline) and Copy entry drops to a border-bright outline (it is currently the solid purple), since Inject is the actual pipeline action. Prefer CSS-only: make `#descEditorModalActions` wrap, give `.injectBtn` `order` first + `flex-basis: 100%` plus the filled-primary treatment, and set the Clear / Copy buttons to `flex: 1` outline secondary — so `modals.js` only needs touching if those two buttons lack distinct class hooks to target. Match radius and height across all three. Targets the modal's actions only; the desktop inline `#descSibling` inject button is unaffected.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/modals.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 92a37b33-6982-431e-bc2b-5e698321df70 -->

- [x] **[LOW]** Tone the modal Inject button fill to match the approved render — Completed: 2026-06-27
  - Type: bug
  - Description: The full-width Inject primary button in the description-editor modal (`#descEditorModalActions .injectBtn` in `style.css`) shipped with a brighter purple fill than the approved mockup, so it reads as the brightest element on the screen. Align it to the render: use the deeper accent `#6C5DF5` (the same purple as the selected filter pill, `.taskFilterPill.selected`) for the button's background and border instead of the lighter `--accent` (#8b7bff). If an accent glow/box-shadow was applied to the button, drop it so the fill reads flat like the mockup. Confirm the Clear and Copy entry outline buttons still match the render's border-bright outline. CSS-only, modal actions only; the desktop `#descSibling` inject button is unaffected.
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: b4e755c9-3d3c-472c-a287-108ad1110410 -->

- [x] **[LOW]** Rename the "Projects" tab label to "Tasks View" on mobile

  - Type: feature
  - Description: The bottom navigation tab currently labeled "Projects" on mobile should read "Tasks View" instead. Only the visible label text should change — the tab's functionality, event listeners, ARIA attributes, and any JS selectors that reference the tab by class or data attribute must remain untouched. Locate the tab label text in `toDoList_main/src/index.js` (where DOM markup is rendered) or `toDoList_main/src/mobileSheets.js` (mobile sheet/tab wiring) and update the string.
  - File: `toDoList_main/src/index.js`, `toDoList_main/src/mobileSheets.js`
  - Completed: 2026-06-27
  <!-- id: 949653a0-39fb-46b5-b598-6bd7d8bc97f2 -->

- [x] **[MEDIUM]** Add a Structure tab with a cross-repo Code lens — Completed: 2026-06-27
  - Type: feature
  - Description: Add a new "Structure" view to the dashboard — a third pill in the desktop view switcher and a third tab on the mobile bottom bar — that renders a navigable, cross-repo map of a project's source. This first cut is the Code lens: a repo picker selects which allowlisted repo to view, and that repo's source files render as a collapsible tree built from its published `src-manifest.json` (the same artifact and fetch path the chat's attach-file picker already uses). Tapping a file reveals an "Explain with Sonnet" action that runs a one-shot Fast-mode chat turn with that file attached and shows the returned 2–3 sentence summary inline. A new `structureView.js` follows the `conceiveView.js` contract — it owns its `#structureView` container, exports a single `renderStructureView()`, reaches the DOM at call time, and has no back-edges into `main.js`.
  - Behavior:
    1. Nav: a Structure pill in `#viewSwitcher` and a Structure tab appended to `#mobileTabBar` (third, after Conceive), each with an inline-SVG icon matching the existing icon style. `applyActiveView('structure')` mirrors the active state across both navigators and persists through `prefs.js`, exactly as projects/conceive do.
    2. Repo picker at the top of the view, populated from the existing repo allowlist mirror (`ATTACH_REPOS` in `claudeSheet.js`) and defaulting to the current chat workspace repo. Selecting a repo re-renders the tree for that repo.
    3. Code tree: fetch the selected repo's `src-manifest.json` via the existing convention, group the flat path list into nested folders by splitting on `/`, and render collapsible folder rows and file rows using the Conceive collapse pattern (an `.expanded`/open class plus an in-module open-state set keyed by path). A repo with no published manifest degrades to a small "no manifest published yet" state — the same graceful fallback the attach picker uses — not an error.
    4. Explain: each file row carries an "Explain with Sonnet" affordance that sends a one-shot Fast-mode turn (that file as the only attachment, repo = the selected repo, a fixed "summarize what this file is responsible for" prompt) and renders the reply inline beneath the row.
  - Implementation notes:
    - Reuse, don't duplicate, the manifest loader: export `loadManifest` / `manifestUrlForRepo` (and the `ATTACH_REPOS` list) from `claudeSheet.js`, or lift them into a tiny shared module, and import into `structureView.js`. Keep the per-repo manifest cache.
    - Explain runs through the existing `chatWithWorker` path in `inject.js`. If `chatWithWorker` is bound to the chat transcript, add a thin stateless wrapper (or a direct call to the same Worker chat route) so the tab's explanations don't write into chat history.
    - Create `#structureView` in `main.js` alongside `#conceiveView`; show it via `#mainBar[data-view="structure"]` in `style.css`, hiding `#mainList` and the filter bar exactly as the Conceive branch does; call `renderStructureView()` from the `'structure'` branch of `applyActiveView`.
    - Constraints: vanilla JS and plain CSS, no new dependencies (no tree/graph/icon libraries — inline SVG for the tab icon, the Void tokens for styling). If the picker includes a filter input, keep it at `font-size: 16px+` to avoid iOS Safari auto-zoom. `main.js` is over 25k tokens — grep with offset/limit to locate the nav-wiring and view-switch sites rather than reading it whole.
  - Out of scope: the Code/UI toggle, the UI lens (live DOM walk of the running app with off-screen regions dimmed), the Reference-in-chat seam, and the picker↔workspace binding land in the immediate follow-up entry; the build-time id→file index, find-in-code, published UI maps for non-running repos, and a "View on GitHub" deep link land in the fast-follow after that; an in-app raw source reader, cross-reload open-state persistence, and arrow-key tree traversal are later.
  - File: `toDoList_main/src/structureView.js`, `toDoList_main/src/main.js`, `toDoList_main/src/prefs.js`, `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/inject.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: cb75fb99-1ace-46a7-9e08-a79c60985fc0 -->

- [x] **[MEDIUM]** Add the UI lens and Reference-in-chat to the Structure tab — Completed: 2026-06-27
  - Type: feature
  - Description: Build on the Structure tab's Code lens by adding a Code/UI toggle and the UI lens — a live, tappable map of the running app's on-screen regions, so you can name a piece of UI and hand its selector straight to chat without opening the code. The UI lens walks the live DOM of the running app (the dashboard's own repo), keeps elements that carry an id, a `data-region`, or a landmark role, nests them by containment, and dims regions that aren't currently on screen; any other selected repo shows a "no published map yet" state under the UI lens until the build-time maps land in the fast-follow. Tapping a region exposes its selector plus a "Reference in chat" action that drops a backticked selector and a plain-English label into the Claude composer (opening the sheet on mobile) without clobbering what's typed, and the Structure repo picker is bound to the chat workspace so the project you're mapping is the one the conversation is framed on. Default the toggle to UI, since reference-in-chat is the reason to open the tab.
  - Behavior:
    1. Toggle: a Code/UI segmented control at the top of the view, beside the repo picker. It swaps the rendered tree between the Code lens (entry 1) and the UI lens; the choice persists through `prefs.js` and defaults to UI.
    2. UI lens — running app: walk `document.body`; keep elements with an `id`, a `data-region`, or a landmark ARIA role; skip the Structure view's own subtree and the chat containers so the map can't include itself; collapse runs of id-less repeated siblings (todo/project rows) into a single "× N rows" line; nest kept nodes by DOM containment. Label each region by precedence `data-region` > `aria-label` > prettified id, and pick its selector by `#id` > `[data-region="…"]` > a stable class. Dim regions that aren't currently visible (inactive view, `display:none`, or offscreen) so on-screen-now reads differently from latent.
    3. UI lens — other repos: until the published maps ship (fast-follow), a non-running repo selected under the UI lens shows a small "no published UI map yet" state; the Code lens stays available for every repo.
    4. Region actions: tapping a region row reveals its selector, a one-line note, a primary "Reference in chat", and a secondary "Copy selector". Reference calls the new seam; Copy writes the selector to the clipboard.
    5. Workspace binding: the repo picker reflects the chat workspace (`activeChatRepo`) on render, and on select sets the workspace the same way the chat's workspace pill does (keeping its chat-clearing behavior), so a referenced selector always lands in a conversation framed on the same repo.
  - Implementation notes:
    - Do the walk in `structureView.js` as a read-only traversal of `document`. Exclude `#structureView` and the chat containers (`#desktopChatPane` and the sheet root); collapse id-less repeated siblings rather than listing each.
    - Visibility for dimming: treat a region as on-screen when it has layout (`offsetParent !== null` or `getClientRects().length`) and isn't `display:none`; everything else renders dimmed. Surfaces hidden only by `#mainBar[data-view]` are still in the DOM and should appear (dimmed) — that's what lets `#conceiveView`, `#musicPopover`, and `#focusModeOverlay` show up without navigating to them first.
    - Add an exported `insertReference(label, selector)` to `claudeSheet.js`: open the sheet if it's closed (mobile) or ensure the desktop pane is mounted, then append a backticked selector plus the label into the composer at the cursor (or appended with a separating space) without clobbering existing text, and focus the composer. Reuse the existing sheet-open and composer plumbing.
    - Bind the picker to the workspace: read `activeChatRepo` when rendering the picker and, on select, call the same workspace-setter the chat's workspace pill uses. Running-app detection compares the selected repo against the app's own repo constant / default workspace.
    - Constraints: vanilla JS, plain CSS, no new dependencies; reuse the Void tokens and the entry-1 collapse pattern for the region tree. `main.js` shouldn't need changes — the tab, container, and nav already exist from entry 1; if a lookup is unavoidable, grep with offset/limit.
  - Out of scope: the build-time `gen-src-manifest.js` id→file(+line) index, find-in-code on a region, published UI maps for non-running repos (and the no-UI-surface state that distinguishes a DOM-less repo from "map not built yet"), and the "View on GitHub" deep link all land in the fast-follow; an in-app raw source reader, cross-reload open-state persistence, and arrow-key tree traversal remain later.
  - File: `toDoList_main/src/structureView.js`, `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/prefs.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: e23b88ae-60e7-4f9f-9d02-7c579bb02dd7 -->

- [x] **[MEDIUM]** Add find-in-code and published UI maps via a build-time id index — Completed: 2026-06-27
  - Type: feature
  - Description: Close out the Structure tab by emitting a build-time index that maps every UI handle to the source file (and line) that defines it, then consume it for two things: find-in-code on a region, and published UI maps for repos that aren't the running app. Extend `gen-src-manifest.js` to scan the source for id / `data-region` / landmark definitions and add a `regions` array (selector, label, owner file, line) plus a `hasDom` flag to the existing `src-manifest.json`, additively — so the Code lens and the chat attach picker keep working unchanged. In the UI lens, a "Find in code" action on a region lists its owner file(s) from the index and jumps to the Code lens with that file surfaced (Explain available there), and a quiet "View on GitHub" deep-links to the file at its line. For a non-running repo, the UI lens now renders the published region map instead of entry 2's placeholder; a repo whose manifest reports no DOM shows a "no UI surface" state, distinct from an older manifest that predates this change ("map not built yet").
  - Behavior:
    1. Build index: extend `toDoList_main/scripts/gen-src-manifest.js` (already wired into `deploy.yml`) to scan `src/` — `.js`, `.css`, and the HTML template — for id definitions (`el.id = '…'`, `id="…"`, `id: '…'`) and `data-region="…"` markers, recording `{ selector, label, file, line }`. Emit these as a `regions` array plus a `hasDom` boolean, added to the existing `src-manifest.json` object alongside `files` — additive only, with `files` left exactly as is.
    2. Loader: extend the manifest loader exported in entry 1 to also surface `regions` and `hasDom` (return `{ ok, files, regions, hasDom }`), keeping the per-repo cache.
    3. Find-in-code: each region row (live or published) gets a "Find in code" action that looks the selector up in `regions` and reveals its owner file(s) inline; tapping an owner file flips the toggle to the Code lens and opens/expands that file, where Explain is available. The live UI map resolves a live selector to its file through this same static index.
    4. View on GitHub: where an owner file and line are known, a quiet secondary "View on GitHub" links to `https://github.com/<owner>/<repo>/blob/main/<path>#L<line>`; the same affordance appears on Code-lens file rows. It's the escape hatch, not the default tap.
    5. Published map and states: for a non-running repo under the UI lens, render the published region map from `regions` — a flat list (no live nesting) of each handle with its defining file, under an "as of last deploy" banner — replacing entry 2's "no published map yet" placeholder. If the manifest reports `hasDom: false`, show the "No UI surface" state instead; if the manifest has no `regions` field at all (older deploy), show a "UI map not built yet — redeploy with the updated build step" state.
  - Implementation notes:
    - Scan with Node built-ins only (`fs`, `path`) and regex over source text — no AST/parser dependency, consistent with how the source is already read as text. The index is a navigation aid; approximate matching is fine. An id may resolve to several files (assignment in `main.js`, styles in `style.css`); record all and prefer the JS definition as the primary owner.
    - Keep `src-manifest.json` backward-compatible — only add keys, never change the `files` shape. The script writes `dist/src-manifest.json` on build; never hand-edit `dist`, the script is the source of truth.
    - State precedence in `structureView.js`: key "No UI surface" vs "not built yet" vs "no manifest" off, in order, `hasDom === false`, a missing `regions` field, and a missing manifest.
    - Other repos' published maps come online as each repo redeploys with this updated script (the existing per-repo onboarding step) — that rollout isn't part of this entry; this entry ships the extended script for `toDoList_TOP` plus the generic consumer that reads any repo's `regions`.
    - Constraints: vanilla JS, plain CSS, no new dependencies; no changes to `webpack.config.js`, `.babelrc`, `package.json`, or `deploy.yml` (the deploy step already runs `gen-src-manifest.js`). If a Vitest test asserts the manifest shape, loosen it to allow the new additive keys.
  - Out of scope: an in-app raw source reader (fetching and rendering file contents in the tab), cross-reload persistence of open/closed tree nodes, and arrow-key tree traversal remain later nice-to-haves; rolling the updated build script out to your other repos is ordinary per-repo onboarding, tracked separately.
  - File: `toDoList_main/scripts/gen-src-manifest.js`, `toDoList_main/src/structureView.js`, `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 55994ede-e7da-42a9-a3b9-a3079af5b7fa -->

- [x] **[MEDIUM]** Tie the Structure tab to the selected project instead of a repo picker — Completed: 2026-06-27
  - Type: feature
  - Description: Replace the Structure tab's repo picker with repo resolution from the currently selected project, matching how Conceive grounds its tools. Resolve the selected project's linked repo via `resolveProjectRepo` (the same inject-target path Conceive's Generate tasks / Suggest plan use) and render that repo's Code and UI lenses, removing the dropdown entirely. Because the picker previously guaranteed a repo, add the states that selection can now produce — no project selected, and a selected project with no linked repo — and keep a small read-only repo label where the dropdown was so it stays clear which repo resolved (the UI lens behaves differently for the running app vs other repos).
  - Behavior:
    1. Remove the repo picker/dropdown from the Structure header. In its place, show the resolved repo as a read-only label (the repo string, with the selected project's name as a quiet hint) next to the existing Code/UI toggle — a label, not a control.
    2. Resolve the repo from the selected project via `resolveProjectRepo(selectedProject)`, reading the selected project the same way Conceive does (the `.selectedProject` sidebar row / `#projInput`). The resolved repo drives both lenses exactly as the picker's selection did.
    3. Re-render on selection change: switching the selected project while the Structure view is active re-renders the tab against the new project's repo, mirroring Conceive's re-render-on-selection hook.
    4. New states: with no project selected, show "Select a project to see its structure"; with a selected project whose `resolveProjectRepo` returns null (no linked target), show "<project> isn't linked to a repo — link one in its inject target to map its structure", pointing to the existing inject-target UI. The Code lens's "no manifest published yet" state and entry 3's "no UI surface" / "map not built yet" states are unchanged and still apply once a repo resolves.
    5. Reference-in-chat alignment: Reference in chat keeps aligning the chat workspace to the mapped repo, now sourced from the selected project's repo rather than a picker selection — set the workspace to that repo (reusing the workspace setter and chat-clear behavior wired in entry 2) at the moment of reference, so a referenced selector lands in a conversation framed on the right repo. Do not reframe the workspace passively on project switches — only on the explicit Reference action.
  - Implementation notes:
    - Import `resolveProjectRepo` from `seedTasksModal.js` (the Conceive tools' shared helper) rather than re-implementing target resolution. Resolved repos are already allowlist-validated at save time, so no extra validation is needed.
    - This is a removal plus a derived value: delete the picker UI and any repo-selection state it held; the Code/UI toggle and its persisted pref are untouched. If a per-tab repo selection was persisted, drop it — the repo is now derived, not chosen.
    - The re-render hook: if a central project-selection handler already re-renders whatever view is active, no change is needed; if it re-renders per view (as it likely does for Conceive), add a Structure branch there. That's the only reason `main.js` is in scope — the tab, container, and nav already exist from entry 1.
    - Constraints: vanilla JS, plain CSS, no new dependencies; reuse the Void tokens and the existing empty-state styling. `claudeSheet.js` needs no change — the workspace setter is already reachable from entry 2.
  - Out of scope: no change to the `gen-src-manifest.js` build step or the published-map logic from entry 3; the later nice-to-haves (in-app raw source reader, cross-reload open-state persistence, arrow-key tree traversal) remain later.
  - File: `toDoList_main/src/structureView.js`,
  <!-- id: 56fc12b6-628f-476a-9b29-6a320ba32060 -->

- [x] **[MEDIUM]** Add Reference in chat and Copy selector to published UI-map rows
  - Type: bug
  - Description: On the Structure tab's UI lens, the published-map rows (shown for any repo that isn't the running app) render only "Find in code" and a "View on GitHub" link — they're missing "Reference in chat" and "Copy selector" that the live map's rows have. Confirmed in `structureView.js`: the live row renderer `buildRegionRow` wires all three (Reference via the imported `insertReference`, Copy via the standalone clipboard helper, plus Find in code), while the later published row renderer `buildPublishedRegionRow` only got Find-in-code and the GitHub link. That's why the live map in the PWA shows all three but a linked repo's published map doesn't. Reference-in-chat is the tab's primary action and is just as valid for a published handle (e.g. matchingGame's `.card`) as a live one, so published rows should offer the same three.
  - Behavior:
    1. `buildPublishedRegionRow` renders the same action set as `buildRegionRow`: Reference in chat (primary), Copy selector, and Find in code (Find-in-code and the View-on-GitHub link stay).
    2. Reference in chat calls `insertReference(region.label, region.selector)`, identical to the live row. Under the project-tied repo model the selected project's repo is already the published repo being viewed, so the inserted selector lands in a chat framed on the right repo — no special-casing.
    3. Copy selector copies `region.selector` via the same standalone clipboard helper the live row uses, reusing the selector already shown on the row.
  - Implementation notes:
    - Reuse, don't reimplement: `insertReference` is already imported and the clipboard helper already exists, so `buildPublishedRegionRow` just needs the two buttons with the same labels, styling, and action-row layout as `buildRegionRow`.
    - Better still, extract the shared Reference + Copy action row into one helper both renderers call, so the two paths can't drift again. Keep Find-in-code per-renderer (the live row resolves a selector to its owner; the published row already knows the owner file).
    - Constraint: vanilla JS, plain CSS, no new dependencies. Work in `structureView.js`; touch `style.css` only if the published row needs the same action-row flex treatment as the live row.
  - Out of scope: the live map (`buildRegionRow`) is unchanged; no change to the manifest/build step or the region data the consumer reads.
  - File: `toDoList_main/src/structureView.js`, `toDoList_main/src/style.css`
  - Completed: 2026-06-27
  <!-- id: 714cee5d-41e2-4ae8-8297-8babc0983074 -->

- [x] **[MEDIUM]** Group the published UI map by defining file with collapsible headers
  - Type: feature
  - Description: On the Structure tab's UI lens, the published map (any repo that isn't the running app) is a flat alphabetical list, while the live map nests by DOM containment — so a connected app like matchingGame doesn't "folder up" the way the PWA does. The published map can't reconstruct real DOM hierarchy (it's a static build-time scan of handle definitions with no runtime containment), but every region already carries its defining file. Group the published rows under collapsible file headers (by `region.file`) so the map has the same foldable structure as the live map — organized by where each handle is defined rather than by DOM nesting — and reads like the Code lens's file tree. The live map is unchanged.
  - Behavior:
    1. In the published-map render path (the `regions.forEach` that appends `buildPublishedRegionRow`), group regions by `region.file` and render a collapsible file header per file, with that file's region rows nested beneath, reusing the same collapse mechanism the Code lens and live map already use.
    2. Order files alphabetically; within a file, order rows by `line`. Keep the "Published map — as of last deploy" banner above the groups.
    3. File headers are collapsible (chevron), defaulting to expanded so every handle is visible on open; track open/closed in-module like the rest of the tree.
    4. Each region row keeps its three actions (Reference in chat, Copy selector, Find in code). Since the file is now the group header, shorten the per-row "Defined in X:line" to just the line; the selector stays on the row.
  - Implementation notes:
    - Consumer-only change in `structureView.js` — no manifest or build change, since `region.file` and `line` are already emitted. Group the `regions` array by `file` before rendering and reuse the existing collapsible folder/row helpers rather than adding a new one.
    - Don't touch the live map (`buildRegionRow`); it nests by real DOM containment, which is correct and richer. This only restructures the published path (`buildPublishedRegionRow` and its render loop).
    - Constraint: vanilla JS, plain CSS, no new dependencies; reuse the Void tokens and the Code-lens folder-row styling for the file headers.
  - Out of scope: true DOM-hierarchy nesting for the published map (would need static render analysis or a heavy, page-incomplete build-time headless render); no change to the build step, the manifest, or the live map.
  - File: `toDoList_main/src/structureView.js`, `toDoList_main/src/style.css`
  - Completed: 2026-06-27
  <!-- id: 8a261855-3303-4931-9029-9084c9f2306a -->

- [x] **[MEDIUM]** Add a filter box to the Structure tab tree (both lenses) — Completed: 2026-06-28
  - Type: feature
  - Description: The Structure tab's tree has no search — fine for matchingGame's 9 files, but toDoList's Code lens is 30+ and the UI lens can be long too, so finding a file or handle means scrolling. Add a filter input at the top of the tree (above the tree container, under the repo header / lens toggle) that narrows the visible items live as you type, styled like the chat attach-file picker's search. It filters whatever the active lens shows: in the Code lens, by file name/path; in the UI lens, by a region's label, selector, or defining file (so "card" matches the handle "Card" / `.card` in Card.jsx). Substring, case-insensitive — a navigation aid, not fuzzy search.
  - Behavior:
    1. A full-width search field with a magnifying-glass icon, a clear (×) button that appears once there's text, and a live match count ("3 of 30"). Placeholder reflects the lens ("Filter files…" / "Filter handles…").
    2. Matching rows stay visible with the matched substring highlighted; non-matching rows hide. A folder (Code lens) or file-group header (UI published map) shows only when it has at least one visible descendant, and auto-expands while a query is active.
    3. In the nested live UI map, a node that matches also reveals its ancestor chain (parents stay visible and expanded) so the match remains reachable in the tree.
    4. Clearing the field (× or empty) restores the full tree and the prior open/closed state. Switching lenses re-applies the current query to the newly shown lens.
    5. When nothing matches, show a quiet "No matches for '<query>'." in place of the tree.
  - Implementation notes:
    - Mount the input in the view's persistent header region, not inside the tree container that `clear()` empties on each render — otherwise it's wiped when the lens re-renders.
    - Filter the already-rendered DOM via show/hide (a hidden class) plus the ancestor-reveal walk, rather than re-rendering — this preserves inline "Explain with Sonnet" results and the user's expand/collapse state across keystrokes. Drive it from one `applyStructureFilter(query)` that walks `currentTreeEl`, with a shared `matchesQuery(text)` helper used for files and regions alike.
    - Reuse the attach picker's search-field styling and the Void tokens; purple focus ring on the input, muted placeholder. No new dependencies; vanilla JS, plain CSS.
  - Out of scope: fuzzy/ranked matching (substring only), searching file contents (names and handle metadata only), and persisting the query across reloads or repo switches.
  - File: `toDoList_main/src/structureView.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR
  <!-- id: 37836a31-9340-47e8-8926-5d4dbd872582 -->

- [x] **[MEDIUM]** Cache "Explain with Sonnet" results per file + commit SHA — Completed: 2026-06-28
  - Type: feature
  - Description: Each tap of "Explain with Sonnet" in the Structure Code lens spends a fresh Sonnet call, even when re-opening a file whose source hasn't changed. Cache the explanation per repo + file + manifest SHA so revisits render instantly and cost nothing, invalidating automatically when a new commit changes the SHA. The manifest already carries `sha`, so the key is free and correctness is automatic.
  - Behavior:
    1. Before calling the Worker in `explainFile`, check a cache keyed by repo + file path + the loaded manifest's `sha`; on a hit, render the stored explanation immediately with no Worker call.
    2. On a miss, call the Worker as today, then store the returned explanation under that key.
    3. A new commit means a new SHA, so the key naturally misses and re-explains against current source — stale explanations never surface.
    4. If the manifest has no `sha` (deterministic / served-from-source manifests omit it), skip the cache and always call — never risk a stale explanation.
    5. Only successful explanations are cached; failed/error results are not.
  - Implementation notes:
    - Client-side only in `structureView.js`. The SHA is already on the manifest result (`result.sha`) that `ensureRegionsLoaded` reads — thread or re-read it where `explainFile` runs. No Worker change.
    - Persist in localStorage under a `todoapp_`-prefixed key (the app's convention), e.g. `todoapp_structureExplain:<repo>:<file>:<sha>`, value = the explanation text. Bound it with a small LRU cap (e.g. last ~50) so it can't grow unbounded; explanations are small.
    - Keep the existing inline result UI; a hit just fills it instantly (no spinner). A subtle "cached" affordance is optional, not required.
  - Out of scope: caching across SHAs (intentional — a new commit re-explains), caching the UI lens or the chat, and any server-side caching.
  - File: `toDoList_main/src/structureView.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 612a533a-208d-46de-b2ee-48f5c3bf2e3d -->

- [x] **[MEDIUM]** Persist the Structure tree's open/closed state across reloads — Completed: 2026-06-28
  - Type: feature
  - Description: The Structure tab's tree resets to its default expansion on every reload — folders re-collapse, file groups re-open, and any manual expand/collapse in the live map is lost. Persist the open/closed state per repo + lens so the tree comes back the way it was left. State is small (a set of open-node keys), stored client-side.
  - Behavior:
    1. When a folder (Code lens), file-group header (UI published map), or nested node (live map) is expanded or collapsed, record the new state keyed by repo + lens.
    2. On render, restore the persisted open/closed state for that repo + lens; the first time a repo/lens is opened (no stored state), fall back to the current default expansion.
    3. Only manual user toggles persist. The filter box's temporary auto-expand (from the filter entry) must not be written to the stored state — clearing the filter restores the persisted manual state, unchanged.
    4. Switching repos or lenses loads that target's own stored state independently.
  - Implementation notes:
    - Client-side only in `structureView.js`. Persist in localStorage under a `todoapp_`-prefixed key (the app's convention), e.g. `todoapp_structureTree:<repo>:<lens>`, value = the list of open-node keys. Use a stable key per collapsible node: folder path (Code lens), defining file name (published map), selector (live map — selectors are already the stable identifier the tree uses).
    - This sits on top of the filter and Explain-cache work in the same file, so it must run after both — don't run it concurrently with them.
    - Bound the stored state lightly (e.g. cap the number of repos retained) so it can't grow unbounded; the per-tree key list is tiny.
  - Out of scope: persisting scroll position, the active lens, or the filter query; syncing state across devices.
  - File: `toDoList_main/src/structureView.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: fbfe9490-7bbd-4bfd-8437-af230b5e091e -->

- [x] **[LOW]** Render View-on-GitHub links for C# repos (empty srcRoot) — Completed: 2026-06-28
- Type: bug
- Description: In the Structure tab Code lens, file rows for C# repos never show the "View on GitHub ↗" link. C# manifests emit `srcRoot: ""` with full repo-relative file paths (e.g. `LinearSearch/BST.cs`), but `githubBlobUrl` returns `''` whenever `currentSrcRoot` is falsy, so the link is suppressed. Web repos (non-empty srcRoot) are unaffected.
- Behavior: When `currentSrcRoot` is empty but `repo` and `file` are present, build the blob URL without a root segment — `https://github.com/<repo>/blob/main/<file><#Lline>` — since the file path is already repo-root-relative. When `currentSrcRoot` is non-empty, keep current behavior exactly (prefix `/<root>/`). Never emit a double slash (`blob/main//file`).
- Implementation notes: In `githubBlobUrl` (structureView.js ~L168), drop the `!currentSrcRoot` clause from the early-return so empty root no longer suppresses the link, then assemble the path so the root segment is included only when non-empty — e.g. compute `root` as the trimmed srcRoot, and build the path as `'/blob/main/' + (root ? root + '/' : '') + file`. Keep the `!repo || !file` guard. `buildGithubLink` needs no change (it already returns null only when the URL is empty).
- Out of scope: UI lens; the Explain button; any change to web-repo link output; manifest generation.
- File: toDoList_main/src/structureView.js
- Completed:
  <!-- id: ef616fe1-8d61-4007-b713-3f28516c18c3 -->

- [x] **[MEDIUM]** Render an adaptive second lens in the Structure tab — Types for C# repos, UI for web — Completed: 2026-06-28
  - Type: feature
  - Description: The Structure tab's second lens is hard-coded to `UI`, which is empty for C#/.NET repos (no DOM → "no UI surface"). Make the second lens adaptive to the active repo's manifest: web repos keep the `UI` lens unchanged; repos whose `src-manifest.json` declares `"lens":"types"` (the csharp scanner now emits this plus a `types` array — classes/interfaces/structs/enums/records, each with a `members` list of methods/constructors/properties carrying `signature` and `line`) show a `Types` lens instead, a navigable class/member outline. The Code lens is unchanged for both.
  - Behavior:
    - Read the manifest's lens once per repo: in the result-handling where `currentSrcRoot`/`currentSha` are set (structureView.js ~L150), capture module-scoped `currentLens = (result && result.lens) || 'ui'` (default `'ui'` for back-compat — toDoList_TOP's own manifest and any web repo predating the field carry no `lens`) and `currentTypes = (result && Array.isArray(result.types)) ? result.types : []`.
    - Adaptive toggle: in `buildLensToggle` (~L1502) the non-Code segment's `data-lens` + label derive from `currentLens` — `'ui'`→`UI` (unchanged), `'types'`→`Types`. Because the manifest is fetched async after the toggle is built, relabel the second segment once `currentLens` resolves (or build the toggle after the lens is known); the segment must read `Types` whenever the selected repo's manifest says so and `UI` otherwise, updating on repo switch.
    - Active-lens normalization: the persisted choice is "Code vs the second slot," not the literal lens name. When the active `lens` is the second slot but its id doesn't match the resolved `currentLens` (persisted `'ui'` but this repo is `'types'`, or vice versa), switch `lens` to `currentLens` so the user stays on the second lens with the correct identity for this repo. Leave `lens === 'code'` untouched.
    - Dispatch: the second lens calls `renderUiLens` when `currentLens === 'ui'` (unchanged) and a new `renderTypesLens(repo, treeEl)` when `currentLens === 'types'`.
    - `renderTypesLens`: mirror `renderPublishedUiMap`'s grouped-by-file collapsible structure (~L1020). Group `currentTypes` by `file`; each file is a collapsible header (reuse the published-map file-group header). Under each file, render one row per type via a new `buildTypeRow(repo, file, type, depth)` at depth 1, and one row per member at depth 2.
    - `buildTypeRow` mirrors `buildPublishedRegionRow` (~L930): a row showing the type's kind + name (e.g. `class BinarySearchTree`) with an expandable action panel carrying `appendReferenceCopyActions(actionRow, '<kind> <name>', '<name>', repo)` (Reference in chat + Copy name), a `Find in code` button → `findInCode(repo, type.name, ...)`, and `buildGithubLink(repo, type.file, type.line)` (View on GitHub). Member rows share the shape: label is the member `signature` (e.g. `Insert(int value)`, `Count : int`), copy value is the member name, Find-in-code searches the member name, GitHub link uses `buildGithubLink(repo, type.file, member.line)`.
    - Empty/absent: if `currentLens === 'types'` and `currentTypes` is empty, show the existing structure empty-state ("No types found in this repo's source.").
    - Filter: `Types` rows respond to the existing filter box exactly as region rows do (`applyStructureFilter`/`matchesQuery` hide/reveal already-rendered rows by text) — type rows match on kind+name, member rows on signature; a matching member auto-reveals its file group and type, mirroring the live map's ancestor-reveal.
    - Fold-state: wire `'types'` into the existing per-repo-per-lens fold machinery (`hydrateActiveLensState`/`persistActiveLensState` and the fold-set selector ~L106–141) so a Types repo remembers which file groups are expanded, keyed by `(repo, 'types')`, exactly as the UI/Code lenses do.
  - Out of scope: the SQL `Schema` and docs `Outline` lenses (separate future modes); the live-DOM UI walk (unchanged); the Code lens (unchanged); the scanner (piece 1, already shipped — this entry only consumes the manifest's `lens`/`types`); any override selector in Configure Inject.
  - File: `toDoList_main/src/structureView.js`, `toDoList_main/src/style.css`
  - Completed:
  <!-- id: 9c286c48-be5f-47c2-8076-baecb495a472 -->

- [x] **[HIGH]** Surface `lens` and `types` from the manifest in `loadManifest` — Completed: 2026-06-28
  - Type: bug
  - Description: The Structure tab's Types lens never activates for C# repos — the toggle stays `UI | Code` with "No UI surface" even when the repo's `src-manifest.json` declares `"lens":"types"` and a populated `types` array (confirmed live at the repo's Pages URL). Root cause: `loadManifest` in `toDoList_main/src/claudeSheet.js` (~L1077) constructs its `result` object from an explicit field list (`ok`/`files`/`regions`/`hasDom`/`srcRoot`/`sha`) and never copies the newer `lens` and `types` fields. So `structureView`'s `result.lens` / `result.types` are always `undefined`, `currentLens` coerces to `'ui'`, and the adaptive Types lens (already shipped and correct in structureView.js) can never engage.
  - Behavior: In `loadManifest`'s success branch — the `result = { ok: true, ... }` object — add two fields: `lens: isObj && typeof data.lens === 'string' ? data.lens : undefined` and `types: isObj && Array.isArray(data.types) ? data.types : undefined`. Purely additive: the existing `files`/`regions`/`hasDom`/`srcRoot`/`sha` consumers (the attach picker, the Code and UI lenses) are unaffected. After this, a C# manifest (`lens:"types"`) drives the Types lens, while web and older lens-less manifests leave `lens` undefined so structureView's existing `result.lens === 'types' ? 'types' : 'ui'` default keeps them on UI.
  - Out of scope: structureView rendering (already correct — do not touch); the scanner (already emits `lens`/`types`); the manifest fetch URL and the in-memory `srcManifestCache` (no change).
  - File: `toDoList_main/src/claudeSheet.js`
  - Completed:
  <!-- id: 97acf6b5-5f8d-4caa-a7ec-3f9822db69eb -->

- [x] **[MEDIUM]** Make "Find in code" search the type index in the Structure Types lens — Completed: 2026-06-28
  - Type: feature
  - Description: In the Structure tab's Types lens, every row's "Find in code" reports "Not found in the source index" because `findInCode` (toDoList_main/src/structureView.js ~L292) searches the manifest's `regions` by CSS selector — and a C# manifest has `regions: []`. Repoint Find-in-code on type/member rows at the `types` data instead, so it lists where the queried name is defined (file + line), across the whole repo (a name defined in several classes lists all of them — which the single-line View-on-GitHub link can't). Separately, the reused row labels its copy button "Copy selector" even on a type row where it copies a type/member name — relabel it "Copy name" in the Types lens.
  - Behavior:
    - Add `findTypeInCode(repo, name, resultEl, btn)` (sibling to `findInCode`): scan the module-scoped `currentTypes` for every type whose `name` equals the queried name and every member (across all types) whose `name` equals it; collect each match as a `{ file, line }` owner — a type match uses `type.file`/`type.line`, a member match uses its owning `type.file` and the member's `line`. Dedupe by `file`+`line`, sort by file then line, and render each via the existing `buildOwnerFileRow(repo, owner)` (the same `{ file, line }` shape `region.files` entries use, so the rows and their View-on-GitHub deep links come for free). No async/network needed — `currentTypes` is already loaded for the rendering lens — so resolve synchronously; on no match, show a quiet "Not found in the type index." note in `resultEl`.
    - In the Types row builder `buildTypeOutlineRow`, wire the "Find in code" button to call `findTypeInCode(repo, spec.name, findResult, findBtn)` instead of `findInCode`. The UI-lens region rows keep calling `findInCode` unchanged.
    - Relabel the copy action for type rows: give `appendReferenceCopyActions` an optional 5th parameter `copyLabel` defaulting to `'Copy selector'`; `buildTypeOutlineRow` passes `'Copy name'`. All other callers (the live UI map row, `buildPublishedRegionRow`) omit it and keep `'Copy selector'` unchanged.
  - Out of scope: `findInCode` and the UI/Code lenses (additive only — do not touch); call-site/usage search (the manifest carries definitions only, so this reports definitions, not references); the scanner; any new manifest field.
  - File: `toDoList_main/src/structureView.js`
  - Completed:
  <!-- id: 96685b3a-f770-407c-b74d-8eae699be8a5 -->

- [x] **[MEDIUM]** Add "Collapse all / Expand all" pill to the Structure tab toolbar on both mobile and desktop — Completed: 2026-06-28

  - Type: feature
  - Description: The Structure tab (`#mobileTabStructure` on mobile, the desktop structure panel) has no way to collapse sections — on deep trees the user must scroll extensively. Add a thin toolbar strip below the tab bar containing a pill button that collapses all sections at once; when any section is collapsed the pill label switches to "Expand all" and re-expands everything. Each section header should also gain an individual chevron for per-section toggling that stays in sync with the global pill state. Collapsed state is UI-only (not persisted); it resets when the tab is closed or re-opened. Ensure the toolbar and pill render correctly at both mobile and desktop breakpoints using existing CSS variables.
  - File: `toDoList_main/src/structureView.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 546e66c5-bfd0-49bf-8baf-04cdf8ac34ea -->

- [x] **[LOW]** Shrink the Structure tab collapse/expand pill by ~25% on mobile — Completed: 2026-06-28
  - Type: feature
  - Description: The `.structureCollapseAllPill` renders at 104×33px on mobile (font-size 16px, padding 5px 14px). Add a mobile-breakpoint override in `.structureToolbar` / `.structureCollapseAllPill` that reduces font-size to 12px and padding to 3px 10px, bringing the pill to roughly 78×25px — matching the density of other small controls in the structure header. The 16px font-size in the base rule exists solely to prevent iOS Safari auto-zoom on focusable inputs; a button is exempt, so the mobile override can go below 16px. Scope the override inside the existing mobile media query already used for structure-view rules in style.css (check for a `max-width` breakpoint near the `.structureToolbar` block). No JS changes needed.
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: be28005a-91b8-430b-81fa-7a9f6e06efb8 -->

- [x] **[MEDIUM]** Revamp `#taskFilterBar` on mobile with single-row filter tabs + sort button that opens a bottom sheet
  - Type: feature
  - Description: On mobile viewports only, replace the current filter bar with a compact single-row bar: filter tabs (Active / Ideas / All) on the left with the active tab shown as a filled purple pill, and a "⇅ Sort" button on the right separated by a vertical divider that shows the current sort label beneath it (e.g. "Due date" in green, or dimmed "None"). Tapping the sort button opens a mobile bottom sheet with three sort chips — None, Due date, Status — where the active choice is purple-filled. The selected sort is applied to the visible task list and persisted to localStorage under `todoapp_taskSort`; it survives page reload and resets to "None" if the key is absent. The desktop filter bar layout must remain unchanged — gate all new bar markup and styles behind the existing mobile breakpoint in `style.css`.
  - File: `toDoList_main/src/taskFilter.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-06-28
  <!-- id: 5b52b6d5-1497-49e6-99c6-72e20aaa2af2 -->

- [x] **[MEDIUM]** Revamp `#mobileProjHeader` on mobile with minimal accent-underline style
  - Type: feature
  - Description: On mobile viewports only, restyle the existing project header bar (`#mobileProjHeader`) to match the Option A design: project name centered and bold in `#e8e8f0`, a short purple accent underline (`#6C5DF5`, ~120px wide, 2.5px tall, centered beneath the name) directly below the name text, back arrow on the left in purple, and the ⋯ menu button on the right in muted gray. The bar background should use `#15151e`. All existing event listeners, ARIA attributes, and functionality (back navigation, project menu, any name-update logic) must remain completely untouched — this is a CSS/layout-only change. Gate all new styles behind the existing mobile breakpoint in `style.css` so the desktop header is unaffected.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
  - Completed: 2026-06-28
  <!-- id: fa339e90-9270-4010-becc-f40eb3582751 -->

- [ ] **[MEDIUM]** Move the Structure tab's per-row actions into one shared selection toolbar (UI + Types lenses)
  - Type: feature
  - Description: On the Structure tab's UI lens (live map + published map) and Types lens, every handle row carries its own inline action panel — Reference in chat, Copy selector/name, Find in code, plus the published/Types View-on-GitHub link — so the same trio repeats under every row and the list reads as noise. Replace the per-row panels with a single shared toolbar pinned above the tree that acts on the currently selected handle: tapping a row selects it (instead of expanding an inline panel) and the toolbar reflects that selection and runs the chosen action against it. This kills the repetition, gives the actions one predictable home, and keeps each row a clean single line. The Code lens (file tree) is untouched — it keeps its per-file Explain / View on GitHub.
  - Behavior:
    1. Selection model: tapping a region/type row body selects it (a single active selection, module-scoped) and applies a selected style (Void purple tint + accent label); tapping the selected row again deselects. The caret keeps its own independent job — toggling child rows — so selecting a row and expanding/collapsing its children stay separate gestures. Rows no longer build or toggle an inline `.structureRegionActions` panel.
    2. Shared toolbar: a dedicated strip directly above the tree container, present for the UI and Types lenses only (not the Code lens). It shows the selected handle's label, a context line, and the action buttons — Reference in chat (primary), Copy selector, Find in code. The existing Collapse/Expand-all pill stays where it is.
    3. Idle state: with nothing selected (fresh render, or after a deselect), the toolbar shows a muted "Select a handle to reference it" hint and its buttons are disabled.
    4. Per-kind context + labels: for a live-map handle the context line is its selector plus on/off-screen status; for a published handle, its selector plus line; for a Types row, the type/member plus its line. The copy button reads "Copy selector" for live/published handles and "Copy name" for Types rows (matching today). When the selection carries a defining file+line (published + Types), the toolbar also surfaces the View-on-GitHub link; live-map handles don't (they resolve via Find in code).
    5. Find in code: results render in a result area inside the toolbar (cleared when the selection changes), not under each row. Find dispatches by kind — `findInCode(repo, selector, …)` for live/published handles, `findTypeInCode(repo, name, …)` for Types rows.
  - Implementation notes:
    - All three row builders change in `structureView.js`: `buildRegionRow` (live), `buildPublishedRegionRow` (published), and `buildTypeOutlineRow` (Types) stop appending their `.structureRegionActions` panel and instead wire the row's click to a new `selectHandle(descriptor)`. Give each a small descriptor carrying what the toolbar needs — `{ kind, label, value (selector or name), copyLabel, repo, file, line, visible }` — so one toolbar renderer can drive Reference/Copy/Find/GitHub for any kind.
    - Build the toolbar once in `renderStructureView` (or a `renderActionToolbar` it calls) for the UI/Types lenses, holding it and its result area at module scope like `collapseToolbarEl`. Reuse `appendReferenceCopyActions` to build the toolbar's Reference + Copy buttons from the active descriptor (pass its `copyLabel`), and reuse `buildGithubLink` for the conditional link — don't reimplement. `insertReference`, the clipboard helper, `findInCode`, and `findTypeInCode` keep their current signatures.
    - Selection is ephemeral (not persisted to `localStorage`, like the bulk-fold): clear it on repo change and on lens change; within a same-repo/same-lens re-render, re-apply it to the matching row if that handle still exists (match by `value`), else fall to idle.
    - Keep `.expanded` (children open — rotates the caret) separate from the new selected state (`.is-selected` / `aria-pressed`). The bulk-fold (`structureSections` / `setSectionExpanded`) is otherwise unaffected — it toggles the children wrap, not the now-gone action panel — but its comment about a region row's `aria-expanded` driving the action panel is now stale and should be updated, since region rows use `aria-pressed` for selection and no longer have an action panel.
    - Constraints: vanilla JS, plain CSS, no new dependencies; reuse the Void tokens. The now-unrendered `.structureRegionActions` / action-row rules in `style.css` can be pruned or left dead; the new toolbar and selected-row state need styling.
  - Out of scope: the Code lens / file tree (`renderNode`, `buildFileRow`) — unchanged; the tree guide lines (separate follow-up entry); any manifest, build-step, or region/type data change; persisting the selection across reloads; changes to `insertReference` / the clipboard helper / `findInCode` / `findTypeInCode`.
  - File: `toDoList_main/src/structureView.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 5ec905bc-709a-4464-8f9f-39945585c835 -->

- [x] **[MEDIUM]** Restyle mobile project header name pill: A3 without underline, with true bar-centered placement
  - Type: feature
  - Description: Update `#mobileProjTitleRow` inside the `≤1023px` breakpoint to render as a pill (border-radius: 14px, background: `#1a1826`, border: 1px solid `rgba(108,93,245,0.45)`) wrapping the project name and chevron. Remove the `#mobileProjTitleRow::after` accent-underline pseudo-element entirely and remove the `padding-bottom: 9px` that reserved space for it. Set `.mobileProjDropdownChev` color to `#6C5DF5` (full accent purple). Fix centering by making `#mobileProjHeader` `position: relative` and switching `#mobileProjTitleRow` from flex-grow to `position: absolute; left: 50%; transform: translateX(-50%); width: max-content; max-width: 60%` so the pill centers against the full bar width rather than the leftover flex space. Update `mobileHeaderSingleRow.test.js` to assert the new pill styles, the removed underline, and the absolute-center positioning.
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/mobileHeaderSingleRow.test.js`
  - Completed: 2026-06-28
  <!-- id: a49537bb-6ba4-4078-b241-974ae3ce5eba -->

- [x] **[LOW]** Reduce mobile project name pill height so it breathes within the header bar
  - Type: feature
  - Description: In the `≤1023px` breakpoint, change `#mobileProjTitleRow` padding from `2px 4px 2px 12px` to `1px 4px 1px 12px`. This trims 2px of vertical padding from the pill so it sits visibly inset from the top and bottom edges of the `#mobileProjHeader` bar (which stays at its `min-height: 40px`) rather than spanning flush to the bar's height. No other values change — border-radius, background, border, absolute centering, and max-width are all untouched.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-06-28
  <!-- id: 28a6fb50-ef2f-470a-b074-0863f855f8b9 -->
