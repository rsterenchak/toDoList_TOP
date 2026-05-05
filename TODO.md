# TODO List

## Bugs

- [ ] **[LOW]** Auto-focus emptyStateCreateBtn and bind Enter to create first project
  - Description: When the app loads with no existing projects, the "CREATE YOUR FIRST PROJECT" empty-state button (`emptyStateCreateBtn`) doesn't receive focus, so keyboard users have to tab or click into it to get started. Apply focus to the button on render of the empty state, and ensure pressing Enter while it's focused triggers the same new-project creation flow as a click — which it should already do as a `<button>`, but verify rather than assume. Focus should only auto-apply on the empty state itself, not re-steal focus if the user has already moved to another control (e.g., the hamburger menu) by the time the empty state renders. Implementation lives in `main.js` where the empty state is rendered — grep for `emptyStateCreateBtn` with `offset`/`limit` since `main.js` is over 25k tokens — and call `.focus()` on the button after it's appended to the DOM. Verify the existing `:focus-visible` style in `style.css` reads clearly against the empty-state background; if not, add a focus treatment matching other primary buttons.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[LOW]** Color-warn the export-staleness footer label as it ages
  - Description: The "EXPORTED N AGO" footer label currently stays the same muted gray regardless of how long it's been since the last export, so users have no passive cue to back up their data. Shift the label's color (and prepend a small warning glyph) as the gap grows: under 3 days renders in the existing muted gray with no glyph; 3 to 7 days renders in amber (`--color-text-warning`) with a triangle-warning glyph; over 7 days renders in red (`--color-text-danger`) with the same glyph. The "never exported yet" state should jump straight to the urgent red+glyph treatment so first-time users get the same nudge. The label re-evaluates on every render and on the existing footer refresh tick — no new timers needed. Implementation lives in `main.js` (the footer label is rendered there — grep for the export-time label with `offset`/`limit` since `main.js` is over 25k tokens) plus `style.css` for the three color states and inline-glyph spacing. Use a small inline SVG triangle glyph rather than a new icon-font dependency, per the no-new-dependencies rule in `CLAUDE.md`.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-05

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
