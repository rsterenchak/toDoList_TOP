# TODO List

## Bugs
     
- [x] **[MEDIUM]** Move ghost and theme toggles into a settings dropdown menu
  - Description: Replace the top-bar ghost-visibility pill switch and the standalone theme button with a single settings trigger (gear or kebab icon) that opens a dropdown housing two items: "Show ghost" (with an ON/OFF indicator reflecting current state) and "Theme" (toggles the active theme). Save and import buttons stay as direct icon buttons on the top bar so the most-used data actions remain one-click. The dropdown should close on selection, outside click, or Escape. The existing pill-switch markup can be removed once nothing else references it.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-03
     
- [x] **[LOW]** Left-align PROJECTS and TODO ITEMS column headers
  - Description: Change the PROJECTS and TODO ITEMS column headers from centered to left-aligned so they line up with the content below them (project names in the sidebar, todo rows in the main column). The current centered alignment creates a visual mismatch where the headers float over left-anchored content. Keep the existing purple color, uppercase styling, and letter-spacing — only `text-align` should change. The EXPAND ALL control on the right side of the TODO ITEMS header row stays anchored to the right.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-05-03

## Features

- [x] **[MEDIUM]** Add floating help button and keyboard shortcuts modal
  - Description: Add a circular `?` button pinned to the bottom-right corner of the viewport that opens a modal listing all keyboard shortcuts in the app, grouped by category (Navigation, Editing, Global). Bind `?` as a global keyboard shortcut to open the same modal — guard against the existing global keydown patterns (skip when typing in inputs/textareas, when another modal or popover is open). The new `showShortcutsModal` should mirror `showChangelogModal` for close-on-Escape, close-on-backdrop, and corner X. Hide the FAB on `pointer: coarse` viewports (the shortcuts don't apply on touch) and while any modal/popover is already open so it never sits on top of one. Don't persist a "seen" marker — the FAB itself is the discoverable surface.
  - File: `toDoList_main/src/modals.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-01
    
- [x] **[MEDIUM]** Add arrow-key navigation, Delete, and Enter editing for todo rows
  - Description: Add keyboard navigation between committed todo rows in the active project — Up/Down arrows move focus to the previous/next row (stop at boundaries rather than wrap, for predictability), Enter on the focused row enters edit mode by focusing the title input with the caret at the end, and Delete fires the same `showConfirmModal` flow as the row's `×` button so destructive deletes still go through a confirmation step. Reuse the existing `.todo-active` class for the focus indicator so styling stays consistent with the click-to-edit pattern, and skip the blank placeholder row at index 0 — it's reachable via `n` and direct click, so arrow nav is for committed rows only. Guard against the same conditions as the existing `n` global shortcut (skip when typing in inputs, when any modal or popover is open). Document the new bindings in the shortcuts modal once both features land.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-01

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
