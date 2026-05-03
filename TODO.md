# TODO List

## Bugs
     
- [ ] **[MEDIUM]** Pair add-project + button with PROJECTS column header
  - Description: Move the add-project + button from its dedicated row beneath the PROJECTS header into the header row itself, anchored to the right edge of the sidebar column — mirroring the TODO ITEMS / EXPAND ALL pattern on the right side. This gives both column headers the same "label on left, action on right" structure and reclaims a row of vertical space at the top of the sidebar so projects start higher. Keep the existing button styling, click handler, and add-project flow intact — only the placement changes.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

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
