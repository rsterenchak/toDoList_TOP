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
