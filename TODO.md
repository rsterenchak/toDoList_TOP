# TODO List

## Bugs
     
- [x] **[MEDIUM]** Spawn completed instance when checking off a recurring todo
  - Description: When a recurring task is checked off, `advanceRecurringTodo` rolls the due date forward and unchecks the box, leaving no historical trace in the Completed section — there's no "I did this last Tuesday and the Tuesday before" trail to glance at for consistency. Push a frozen clone of the item (with `due` set to the just-completed date and `recurrence: null` so the clone doesn't itself chain) into the project's items array as a completed entry alongside the still-recurring original, then run `sortCompletedToBottom` and re-render via `reorderToDoDOM` from the checkbox handler in `toDoRow.js` so the new instance appears at the top of the Completed section instead of waiting for a project-switch refresh. Cover the new behavior in `tests/listLogic.test.js`: a single advance creates one completed clone with no recurrence, and repeated advances stack instances without mutating the original's recurrence config or the next-due math.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/listLogic.test.js`
  - Completed: 2026-04-30

## Features

- [x] **[LOW]** Replace export/import nav icons with floppy and folder glyphs
  - Description: Swap the current down-arrow-into-tray (export) and up-arrow-out-of-tray (import) icons in `exportImport.js` for a pixel-art floppy disk (export = save) and folder (import = open). Keep the existing `shape-rendering="crispEdges"`, `fill="currentColor"` treatment so the new glyphs stay in the theme-toggle / compact-titles family. Use a 10×10 viewBox: the floppy needs a body outline, a write-protect tab block in the top right, an interior divider, and a label rectangle at the bottom; the folder needs a small left-aligned tab on top of a hollow rectangle body. The `title` and `aria-label` already say "Export todos" / "Import todos" so the up/down directional cue isn't load-bearing — the save/open metaphor carries the meaning visually.
  - File: `toDoList_main/src/exportImport.js`
  - Completed: 2026-04-30

- [ ] **[LOW]** Add affordance cues to new-task input (leading +, placeholder, N keyboard hint)
  - Description: Replace the bare new-task input at the top of the todo panel with a more inviting variant: a small purple `+` glyph on the left, placeholder text "Add a task — press Enter" inside the field, and a subtle keyboard hint badge `N` on the right. Wire a global `keydown` listener so pressing `N` while focus is *not* in another input/textarea/contenteditable element focuses this input and prevents the keystroke from leaking into the field. Form submission, the existing focus/blur styling, and the input's data path stay unchanged — this is purely affordance polish plus one shortcut.
  - Implementation notes:
    - `+` glyph and `N` badge are decorative — keep them inside the input's wrapper, not as separate clickable elements, so click-anywhere-on-the-row still focuses the input.
    - Mobile: keep `font-size: 16px+` on the input to avoid iOS Safari auto-zoom on focus. The `N` badge can hide below ~480px since touch users won't use it.
    - The `N` shortcut handler must early-return when `document.activeElement` is an input, textarea, contenteditable, or inside an open modal/popover — otherwise typing "n" anywhere (including in a todo title) will yank focus.
    - `main.js` is over 25k tokens — locate the new-task input render and form-submit wiring with grep + offset/limit rather than a full read.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
