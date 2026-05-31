# TODO LIST

- [x] **[MEDIUM]** Mint and embed a stable entry-id marker on PWA-injected TODO.md entries
  - Type: feature
  - Description: `injectDescription` in `inject.js` currently sends `{ entry: item.desc }` with no id, so injected entries land in TODO.md without a `<!-- id: ... -->` marker Ã¢ÂÂ which means they can't be traced back to their merged PR later. Both the Worker's dedup-by-id check and the entry-mode/iterate resolution depend on that marker, so it must be minted at inject time. Update `injectDescription` to: mint a stable id once per item (`crypto.randomUUID()`, with a `Date.now()`+random fallback) and persist it as `item.entryId` (reuse it on re-inject Ã¢ÂÂ only mint when absent); build the entry payload as `item.desc.replace(/\s+$/, '') + "\n  <!-- id: " + item.entryId + " -->"` so the marker trails the entry WITHOUT mutating the stored `item.desc`; and pass the same id as `body.id` so the Worker's existing dedup-by-id makes a re-inject of the same item a no-op. The marker must be exactly `<!-- id: <uuid> -->` (one space each side) to match the Worker, the routine's entry-mode lookup, and `TODO_MD_ID_MARKER_RE` in main.js. Persist via the existing `listLogic.saveToStorage()` call already in the function.
  - File: `toDoList_main/src/inject.js`
  - Completed: 2026-05-30

- [x] **[LOW]** Add a hover tooltip to the version label in the About section
  - Type: feature
  - Description: Add a title attribute to the version label element in the Settings About section so hovering shows the full build string. Self-contained, no behavior change.
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-05-30
  <!-- id: bbc0f6cb-06d6-47c8-8422-e77346e5c3a0 -->

- [ ] **[MEDIUM]** Add Claude sheet shell + launcher, relocating help off the ? FAB
  - Type: feature
  - Description: Build the container for the in-app Claude assistant — a new module `claudeSheet.js` exporting a mount/open/close API, styled to the Void theme. On mobile (≤700px) it's a bottom sheet at ~86% height; on wider viewports it docks as a right-hand panel (~380px, full height) leaving the app visible beside it. Inside: a grab handle (mobile), a `CHAT` | `RUNS` segmented toggle, and two views — an empty Chat surface (inert composer placeholder, no wiring yet) and a Runs list showing a "No runs yet — tap + New to start" empty state plus a "+ New" affordance. Open via a new ✦ launcher that REPLACES the existing `?`/help FAB in the bottom-right; close via launcher re-tap, backdrop tap, or swipe-down (mobile). Because the `?` FAB currently launches the Replay welcome tour, relocate that trigger atomically into the ghost/settings menu next to the existing "Configure inject" row (see `showInjectSettingsModal` wiring and the HELP-section welcome-tour entry in `main.js`) so help stays reachable and is never orphaned. No chat or inject logic in this entry — shell, launcher, tabs, empty states, and the help relocation only.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/index.js`, `toDoList_main/tests/claudeSheet.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 877a5efe-c491-4927-8024-92911f51f1fd -->
