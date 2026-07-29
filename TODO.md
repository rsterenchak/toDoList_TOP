# TODO LIST

- [x] **[MEDIUM]** Add draggable resize handle between task queue rail and detail pane in Stream view (desktop)
  - Type: feature
  - Description: On desktop (>=1024px), add a thin draggable vertical divider between #mainBar (queue rail) and #descDetailPane (task detail pane) inside #mainSec's grid split, shown only in STREAM view (data-view="projects"). The handle sits in its own narrow grid track with a centered 4px-wide, 44px-tall rounded grip that turns accent-colored on hover, and the cursor becomes col-resize over the handle; dragging updates #mainSec's grid-template-columns first track width live, clamped between 260px and 480px (up from the current fixed 260-308px max, to give meaningful resize range), leaving the second track as minmax(0, 1fr). The resized width persists across reloads using the existing SIDEBAR_WIDTH_KEY-style pattern in prefs.js (add a new key, e.g. QUEUE_WIDTH_KEY, following the same get/set localStorage convention) and is reapplied on load. Implement pointerdown/pointermove/pointerup handling (no native HTML5 drag-and-drop) scoped only to the new handle element, and ensure it does not interfere with existing row click/drag interactions in #mainBar.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/prefs.js`
  - Completed: 2026-07-29
  <!-- id: 93cf70c3-5c7c-4186-ace0-0d3bf81697dc -->

- [x] **[MEDIUM]** Force a fresh shipped-marker check when a row first renders, so an already-shipped run doesn't show a stale DRAFTED badge until reload — Completed: 2026-07-29
  - Type: bug
  - Description: When a run ships while its project isn't open/rendered (or the tab reloads after shipping), the row's badge paints from `shippedMarkerCache` before a fresh check, and the follow-up refresh call passes no `force` flag, so the 60s TTL guard in `refreshShippedMarkers` (`toDoList_main/src/inject.js:628-634`) short-circuits and serves the stale pre-ship cache entry instead of re-fetching. The badge only corrects itself once the TTL naturally lapses or a hard reload wipes the in-memory `shippedMarkerCache` clean. The two call sites are `buildToDoRow`'s `refreshShippedMarkersForProject(toDoName)` at `toDoList_main/src/toDoRow.js:3766` and the full-render sweep's `refreshShippedMarkersForProject(name)` at `toDoList_main/src/toDoRow.js:2290` — both should pass `force=true`, matching the existing pattern already used at `inject.js:294`, `didEntryShip`, and `settleShippedRows`, all of which force the check specifically because a shipped fact must be trusted immediately rather than served from a stale cache.
  - File: `toDoList_main/src/toDoRow.js`
  <!-- id: 5f1c9f73-f7bc-4e02-812c-e80909a13e2d -->

- [ ] **[HIGH]** Mount the asking, dispatch, and review blocks in the mobile description modal and route badge taps to it
  - Type: bug
  - Description: On a touch device the `⌁ ASKING` / `⌁ DRAFTED` / `⌁ STUCK` / `⌁ MOCKUP` badge handler in `todoStatus.js` calls `descToggle.click()`, and because `isDetailPaneMode()` is false below 1024px `placeDescPanel` falls to its inline branch and inserts `#descSibling` beneath the row — an accordion drop-down the mobile design never intended. Tapping the row body instead opens `showDescEditorModal`, but that modal only builds the phase rail, `renderStuckBlock`, `renderMockupBlock`, and a bare REVIEW route button: `syncAskingPanel`, `syncDispatchPanel`, and `syncReviewPanel` all mount into `#descSibling` alone (and `syncReviewPanel` additionally gates on `isDetailPaneMode()`), so triage's question, the Dispatch control, and the WHAT CHANGED card are unreachable from the modal. Mount all three in the modal and repoint the badge taps at it so the inline panel never mounts on touch.
  - Behavior:
    1. On `(pointer: coarse)`, tapping `⌁ ASKING`, `⌁ DRAFTED`, `⌁ STUCK`, `⌁ MOCKUP`, or `⌁ REVIEW` opens the description modal for that row. `#descSibling` is never inserted into `#mainList`.
    2. In `asking`, the modal shows triage's question plus the answer textarea and Send control, identical to the desktop panel's block.
    3. With the linked queue row in `drafted`, the modal shows the Dispatch control; in `stuck` it shows the Retry control beneath the existing reason block.
    4. In `accept`, the modal shows the WHAT CHANGED card plus Accept / Revert / Open in TODO.md.
    5. Desktop behavior is unchanged at every width — the badge still opens `#descSibling` in the detail pane.
  - Implementation notes:
    - Export `buildAskingBlock`, `buildDispatchBlock`, `buildReviewBlock`, and `buildReviewActions` from `toDoRow.js` rather than extracting a new module. `modals.js` already imports `makeGenerateButton` / `syncGenerateControl` from `toDoRow.js`, so the import direction exists and the builders' signatures are already host-neutral. Extracting them would also have to move the module-level `pendingAnswers` map and the dispatch poller state they close over.
    - Add `renderAskingBlock` / `renderDispatchBlock` / `renderReviewBlock` inside `showDescEditorModal` mirroring the existing `renderStuckBlock` shape — idempotent, mount-or-clear, driven from `refreshPhaseUI` so they repaint on both `TODO_RUN_STATUS_EVENT` and `onQueueChange`.
    - Gate the modal's dispatch block on `getQueueRowForTodo(item.id).state === 'drafted'`, NOT on `derivePhase(item) === PHASE.DRAFTED`. `showDescEditorModal` calls `listLogic.markDraftSeen(item.id)` on open, which sets `draftSeenAt`, and `derivePhase` only returns DRAFTED while `!item.draftSeenAt` — so a phase-gated block would be cleared before it ever mounts.
    - Route the badge taps through a registered handler, not a direct import. `todoStatus.js` must not import `modals.js` (`modals.js` already imports `buildManualStatusControl` / `invokeReviewBadgeTap` from it). Reuse the existing `setAgentRouteBadgeTapHandler` hook — it is already exported and already imported by `main.js` but never invoked — and register it in `main.js` to the modal opener, gated on `(pointer: coarse)` so the desktop path still falls through to `descToggle.click()`.
    - Drop the modal's now-redundant `reviewBtn` and its `syncReviewAction` from the actions row; `buildReviewActions` supplies Open in TODO.md.
    - `#descEditorModalBody` already has `overflow-y: auto` with `min-height: 0`, so the new blocks scroll without further layout work. Style them by adding the modal's selectors alongside the existing `#descSibling` declarations so one rule set serves both hosts, per the `phaseRail` / `descEditorModalStatusRow` precedent.
    - Keep the answer textarea at `font-size: 16px` (it already sets this inline) to avoid iOS Safari focus auto-zoom.
  - Out of scope: the phase-first modal reordering and the collapsible entry disclosure — those land in a follow-up entry. Do not change `syncReviewPanel`'s desktop-only gate.
  - File: `toDoList_main/src/modals.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/src/todoStatus.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 21b043fb-2e42-4b21-a6bd-310f0b01c318 -->
