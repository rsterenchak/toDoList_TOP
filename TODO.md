# TODO List

## Bugs
     
- [x] **[MEDIUM]** Spawn completed instance when checking off a recurring todo
  - Description: When a recurring task is checked off, `advanceRecurringTodo` rolls the due date forward and unchecks the box, leaving no historical trace in the Completed section — there's no "I did this last Tuesday and the Tuesday before" trail to glance at for consistency. Push a frozen clone of the item (with `due` set to the just-completed date and `recurrence: null` so the clone doesn't itself chain) into the project's items array as a completed entry alongside the still-recurring original, then run `sortCompletedToBottom` and re-render via `reorderToDoDOM` from the checkbox handler in `toDoRow.js` so the new instance appears at the top of the Completed section instead of waiting for a project-switch refresh. Cover the new behavior in `tests/listLogic.test.js`: a single advance creates one completed clone with no recurrence, and repeated advances stack instances without mutating the original's recurrence config or the next-due math.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/listLogic.test.js`
  - Completed: 2026-04-30

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
