# TODO List

## Bugs

- [x] **[MEDIUM]** Add per-project auto-reorder-by-due-date toggle
  - Description: Add a small checkbox + "Sort by due" label to the "Todo items" column header, to the right of the title. When checked, the todo rows in the active project render sorted ascending by due date — earliest due first, items with no due date sinking to the bottom, completed items still grouped at the bottom as they are today. When unchecked, rows render in the user's manual order (current behavior). The setting is per-project (each project remembers its own preference) and persisted to `localStorage` under the existing `todoapp_` prefix — extend the project record in `listLogic.js` with a `sortByDue` boolean defaulting to `false`. Sorting is purely a render-time concern: do not mutate `pos` values on the todos themselves, just sort a copy before rendering so toggling the checkbox off restores the original manual order intact. Disable the drag handles on todo rows while the checkbox is on (re-enable when off) so the user can't manually reorder a list that will immediately re-sort itself. All mutations to the project record route through `listLogic.js` per the existing data-model convention. No backend or sync work is needed — this is local UI state; if/when todos move to a backend later, the field rides along on the project row.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`
  - Completed: 2026-05-26

- [x] **[MEDIUM]** Make todo titles editable from the mobile detail modal
  - Description: On desktop, todo titles are renamed inline by double-clicking the title field on the row. On mobile, tapping a todo row opens a detail modal showing title, description, and due date — but the title in that modal is read-only, so there's no way to rename a todo on touch devices without rotating to desktop. Add tap-to-edit behavior to the title inside the mobile modal: render the title as static text with a small pencil affordance (`✎` in the accent color) to signal editability; on tap, swap the static text for an input prefilled with the current value, focused and selected. Commit on Enter or blur, escape on Escape (revert). Reuse the existing `renameHandledByEnter` flag pattern so the Enter `keydown` handler and the `blur` handler don't both run duplicate-check logic against already-updated state. Empty titles revert to the previous value rather than blocking. All mutations route through `listLogic.js` (likely a reuse of the same rename path used by the desktop inline edit) — do not mutate the data model from the modal directly. Note: the input needs `font-size: 16px+` to avoid iOS Safari auto-zoom on focus.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-26

## Features

- [ ] **[LOW]** Add center-screen checkmark animation on mobile swipe-to-complete
  - Description: When a todo row is swiped right past the completion threshold on a touch device, briefly show a large purple checkmark animation in the center of the viewport to confirm the action. Style: a bare ✓ in the accent purple (`#6C5DF5`), roughly 90px tall, that pops in with a slight overshoot (scale 0.3 → 1.2 → 1.0) while a soft circular ripple expands outward from it and fades to transparent. No enclosing circle or background — the check sits over whatever's behind it. Total duration roughly 1.0–1.2s, then the whole thing fades out. Overlay must be `pointer-events: none` and `position: fixed` centered, so it never intercepts taps and the user can keep scrolling or tapping mid-animation. Gate the whole behavior behind the existing touch-device check (`pointer: coarse`) — desktop completion paths don't trigger it. Trigger fires on swipe-release once the completion threshold is crossed (matches the existing swipe-right-to-complete flow), not mid-swipe. Swiping right on an already-completed row to un-complete it does NOT play the animation — only the complete direction does. Respect `prefers-reduced-motion`: when set, skip the animation entirely and just complete the todo silently. Hook into the existing `touchend` handler in `main.js` that finalizes the swipe-complete gesture; the animation should be a small DOM-node-insert-then-remove rather than a long-lived element, so there's no cleanup risk if the user fires it repeatedly in quick succession.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
