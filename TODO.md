# TODO LIST

- [x] **[MEDIUM]** Mint and embed a stable entry-id marker on PWA-injected TODO.md entries
  - Type: feature
  - Description: `injectDescription` in `inject.js` currently sends `{ entry: item.desc }` with no id, so injected entries land in TODO.md without a `<!-- id: ... -->` marker ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ which means they can't be traced back to their merged PR later. Both the Worker's dedup-by-id check and the entry-mode/iterate resolution depend on that marker, so it must be minted at inject time. Update `injectDescription` to: mint a stable id once per item (`crypto.randomUUID()`, with a `Date.now()`+random fallback) and persist it as `item.entryId` (reuse it on re-inject ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ only mint when absent); build the entry payload as `item.desc.replace(/\s+$/, '') + "\n  <!-- id: " + item.entryId + " -->"` so the marker trails the entry WITHOUT mutating the stored `item.desc`; and pass the same id as `body.id` so the Worker's existing dedup-by-id makes a re-inject of the same item a no-op. The marker must be exactly `<!-- id: <uuid> -->` (one space each side) to match the Worker, the routine's entry-mode lookup, and `TODO_MD_ID_MARKER_RE` in main.js. Persist via the existing `listLogic.saveToStorage()` call already in the function.
  - File: `toDoList_main/src/inject.js`
  - Completed: 2026-05-30

- [x] **[LOW]** Add a hover tooltip to the version label in the About section
  - Type: feature
  - Description: Add a title attribute to the version label element in the Settings About section so hovering shows the full build string. Self-contained, no behavior change.
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-05-30
  <!-- id: bbc0f6cb-06d6-47c8-8422-e77346e5c3a0 -->

- [x] **[MEDIUM]** Add Claude sheet shell + launcher, relocating help off the ? FAB
  - Type: feature
  - Description: Build the container for the in-app Claude assistant ÃÂ¢ÃÂÃÂ a new module `claudeSheet.js` exporting a mount/open/close API, styled to the Void theme. On mobile (ÃÂ¢ÃÂÃÂ¤700px) it's a bottom sheet at ~86% height; on wider viewports it docks as a right-hand panel (~380px, full height) leaving the app visible beside it. Inside: a grab handle (mobile), a `CHAT` | `RUNS` segmented toggle, and two views ÃÂ¢ÃÂÃÂ an empty Chat surface (inert composer placeholder, no wiring yet) and a Runs list showing a "No runs yet ÃÂ¢ÃÂÃÂ tap + New to start" empty state plus a "+ New" affordance. Open via a new ÃÂ¢ÃÂÃÂ¦ launcher that REPLACES the existing `?`/help FAB in the bottom-right; close via launcher re-tap, backdrop tap, or swipe-down (mobile). Because the `?` FAB currently launches the Replay welcome tour, relocate that trigger atomically into the ghost/settings menu next to the existing "Configure inject" row (see `showInjectSettingsModal` wiring and the HELP-section welcome-tour entry in `main.js`) so help stays reachable and is never orphaned. No chat or inject logic in this entry ÃÂ¢ÃÂÃÂ shell, launcher, tabs, empty states, and the help relocation only.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/index.js`, `toDoList_main/tests/claudeSheet.test.js`
  - Completed: 2026-05-30
  <!-- id: 877a5efe-c491-4927-8024-92911f51f1fd -->

- [x] **[MEDIUM]** Wire the Claude sheet's author flow Ã¢ÂÂ chat, drafted-entry card, inject-with-confirm
  - Type: feature
  - Description: Make the Chat tab functional in author mode (builds on the shell from the sheet-shell entry). Add a `chatWithWorker(messages)` helper to `inject.js` mirroring `postToWorker` (same cached URL + Bearer secret) that POSTs `{ chat: true, messages }` and returns the reply text. In `claudeSheet.js`, hold the conversation in memory, send the running history on each turn, and render assistant replies. When a reply contains a fenced ```md entry, detect it and render it as a distinct green "drafted entry" card below the message. The card's single action is "Inject & run", which first shows an inline confirm ("This ships to main and deploys to your live app." Ã¢ÂÂ Ship it / Cancel). On confirm: mint a stable entry id and embed the `<!-- id: <uuid> -->` marker (reuse the id-mint + marker-embed pattern from the injectDescription change; factor it into a shared `inject.js` helper if not already), call inject with `{ entry, id }`, then `dispatchRun({ mode: 'entry', entryId, correlationId })` with a fresh `crypto.randomUUID()` correlation id, and push a run record `{ entryId, correlationId, title, status }` into the Runs list rendered as QUEUED. Reuse the existing status-polling path to flip the record QUEUED Ã¢ÂÂ RUNNING Ã¢ÂÂ SHIPPED. Keep run records in `localStorage` so they survive a reload.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/inject.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/claudeSheet.test.js`
  - Completed: 2026-05-30
  <!-- id: 41d5301f-f8d1-4fb3-b6bb-34d599cbd407 -->

- [x] **[MEDIUM]** Add a close X to the Claude sheet header on desktop
  - Type: bug
  - Description: The Claude sheet shipped without a reachable close affordance on desktop. The mobile bottom sheet closes via backdrop tap and swipe-down, but the desktop right-hand companion panel is non-blocking (no backdrop) and has no swipe, so there's currently no way to dismiss it short of re-tapping the corner launcher â a poor target. Add a close button (`Ã`) to the sheet header, mirroring the existing modal close-X convention in `inject.js` (`injectSettingsClose` / `injectTargetSubClose`: a `<button type="button">` with `textContent = 'Ã'`, an `aria-label` like "Close Claude panel", appended to the header, wired with `addEventListener('click', â¦)` to the sheet's existing close handler). Scope it to the desktop/panel layout only â hide it at the mobile breakpoint (â¤700px) via CSS, since the bottom sheet already has backdrop-tap and swipe-down and a header X there would be redundant. Reuse the existing close routine the launcher and backdrop already call; do not introduce a second close path.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/claudeSheet.test.js`
  - Completed: 2026-05-30
  <!-- id: 3e0701df-5cef-479c-8682-de8492de8bae -->

- [x] **[MEDIUM]** Implement collapse/expand toggle on the todo viewer panel
  - Type: feature
  - Description: When the existing collapse button is clicked, the todo viewer body content (todo rows and any non-header elements) should hide immediately, leaving only the fixed header bar visible. Clicking the button again should show the body content again. A CSS class (e.g. `collapsed`) should be toggled on the viewer container to hide the body via `display: none` or `visibility: hidden`, and the button's icon/label should reflect the current state. Collapse state should not persist across reloads unless already stored.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-30
  <!-- id: 4e1a4e11-b0cc-4b23-acf5-1bba4ecdd213 -->
