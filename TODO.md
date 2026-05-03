# TODO List

## Bugs
     
- [x] **[LOW]** Mute the hamburger icon and add a divider before the kebab menu
  - Description: Drop the top-left hamburger icon's color from the bright purple accent to the same neutral gray used by the save and import buttons, so the top bar reads as a single unified group rather than one loud purple element competing with the muted icons. Then add a hairline vertical divider (1px wide, ~18px tall, low-opacity white) between the import button and the kebab menu, signaling that the kebab is in a different category (settings/menu) from the data actions to its left. Both changes are purely cosmetic — the divider can be done as a `::before` pseudo-element on the kebab and the hamburger color via a simple stroke/color override.
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
