# TODO List

## Bugs

- [ ] **[LOW]** Fix Delete key not removing project or todo on Mac
  - Description: On Mac, pressing the Delete key (the one labeled "Delete" on a MacBook keyboard, which is actually Backspace) on a selected project or selected todo row does nothing — the item isn't removed. The expected behavior matches the existing Windows/Linux flow: with a project or todo selected, hitting Delete removes it (with the existing confirmation step for destructive actions, per `CLAUDE.md`). Likely cause: the keyboard listener in `main.js` is checking `e.key === "Delete"` only, which corresponds to the forward-delete key (keyCode 46) — that key doesn't exist on most Mac laptop keyboards. The "Delete" key on a MacBook fires `e.key === "Backspace"` (keyCode 8). Fix by accepting both keys in the handler: `if (e.key === "Delete" || e.key === "Backspace")`, while still guarding against firing the delete when an input/textarea/contenteditable has focus (so Backspace inside the rename input or a description textarea still just deletes a character). Grep `main.js` for `"Delete"` and `key ===` to find the relevant handlers — there are likely two (one for project selection, one for todo row selection) and both need the same fix. Confirm the existing destructive-action confirmation still triggers from the Backspace path.
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[LOW]** Add center-screen checkmark animation on mobile swipe-to-complete
  - Description: When a todo row is swiped right past the completion threshold on a touch device, briefly show a large purple checkmark animation in the center of the viewport to confirm the action. Style: a bare ✓ in the accent purple (`#6C5DF5`), roughly 90px tall, that pops in with a slight overshoot (scale 0.3 → 1.2 → 1.0) while a soft circular ripple expands outward from it and fades to transparent. No enclosing circle or background — the check sits over whatever's behind it. Total duration roughly 1.0–1.2s, then the whole thing fades out. Overlay must be `pointer-events: none` and `position: fixed` centered, so it never intercepts taps and the user can keep scrolling or tapping mid-animation. Gate the whole behavior behind the existing touch-device check (`pointer: coarse`) — desktop completion paths don't trigger it. Trigger fires on swipe-release once the completion threshold is crossed (matches the existing swipe-right-to-complete flow), not mid-swipe. Swiping right on an already-completed row to un-complete it does NOT play the animation — only the complete direction does. Respect `prefers-reduced-motion`: when set, skip the animation entirely and just complete the todo silently. Hook into the existing `touchend` handler in `main.js` that finalizes the swipe-complete gesture; the animation should be a small DOM-node-insert-then-remove rather than a long-lived element, so there's no cleanup risk if the user fires it repeatedly in quick succession.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-26

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
