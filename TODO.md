# TODO LIST

- [ ] **[MEDIUM]** Add draggable resize handle between task queue rail and detail pane in Stream view (desktop)
  - Type: feature
  - Description: On desktop (>=1024px), add a thin draggable vertical divider between #mainBar (queue rail) and #descDetailPane (task detail pane) inside #mainSec's grid split, shown only in STREAM view (data-view="projects"). The handle sits in its own narrow grid track with a centered 4px-wide, 44px-tall rounded grip that turns accent-colored on hover, and the cursor becomes col-resize over the handle; dragging updates #mainSec's grid-template-columns first track width live, clamped between 260px and 480px (up from the current fixed 260-308px max, to give meaningful resize range), leaving the second track as minmax(0, 1fr). The resized width persists across reloads using the existing SIDEBAR_WIDTH_KEY-style pattern in prefs.js (add a new key, e.g. QUEUE_WIDTH_KEY, following the same get/set localStorage convention) and is reapplied on load. Implement pointerdown/pointermove/pointerup handling (no native HTML5 drag-and-drop) scoped only to the new handle element, and ensure it does not interfere with existing row click/drag interactions in #mainBar.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/prefs.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 93cf70c3-5c7c-4186-ace0-0d3bf81697dc -->
