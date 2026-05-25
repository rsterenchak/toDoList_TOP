# TODO List

## Bugs

- [ ] **[MEDIUM]** Remove description dropdown button from todo rows
  - Description: Each todo row currently ends with a small `▼` chevron that toggles the description panel below the row. Remove that button entirely — focusing the todo row (clicking/tapping the title, or tabbing into it) already opens the description, so the chevron is redundant chrome that costs horizontal space on every row. The description panel itself, its open/close animation, and the focus-driven open behavior all stay; only the explicit toggle button goes away. Keyboard users can still open the description by focusing the row, and a focused row should also close its description on blur as it does today (verify this still works once the chevron is gone — the chevron's click handler may have been the only path to *close* a description in some flows).
  - Behavior:
    1. The `▼` chevron no longer renders on any todo row (initial render, restore-from-storage, newly added rows, completed rows).
    2. Focusing a todo row opens its description (unchanged).
    3. Blurring a todo row closes its description (verify; if the chevron handler was the close path, wire close to blur or document-click).
    4. No layout shift on rows that previously had the chevron — the saved space goes to the title.
  - Implementation notes:
    - Grep `main.js` for the chevron element's class/selector and its click handler. Remove the DOM creation, the listener wiring, and any teardown.
    - Check the four todo-row builder functions (`addInitialToDo`, `regenToDos`, `appendNewToDoRow`, `addToDos_restore`) — the chevron is likely added in each, so the removal needs to happen in all four (or this is a good prompt to consolidate them, but that's the separate refactor on the backlog — not in scope here).
    - Remove the chevron's CSS rules from `style.css` too, including any hover/focus states.
    - Reminder: inline JS styles override CSS, so check whether the chevron has inline `style.display` writes that need to come out along with the element.
  - Acceptance criteria:
    - No `▼` chevron appears on any todo row, including newly created ones and rows restored from storage.
    - Focusing a row opens its description; blurring closes it.
    - No regressions in the description panel's open/close animation or content.
  - Out of scope: Refactoring the four overlapping todo-row builders, changes to the description panel itself, changes to how focus is acquired.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[MEDIUM]** Re-enable drag-and-drop JSON import with redesigned full-window overlay
  - Description: The drag-and-drop import code in `exportImport.js` is fully intact (`attachDragDropImport` is exported, `#importDropOverlay` CSS is present, validation routes through the shared `importTodosFromString` pipeline with the destructive-overwrite confirm modal), but the boot-time call from `main.js` is missing — dragging a `.json` file onto the window currently does nothing. Re-wire the call alongside the other restore-from-storage hooks (passing the same `rebuildAfterImport` callback the file picker and Drive pull paths use), and redesign the overlay to a full-window dashed perimeter: replace the small centered `#importDropOverlayInner` card with an inset dashed border (`inset: 18px; border: 2px dashed var(--accent); border-radius: 8px; box-shadow: 0 0 24px var(--accent-glow)`) over a slightly darker base wash (`background: rgba(14,15,20,0.72)`), centered inside it a 44px Tabler-style file-arrow glyph (vanilla inline SVG or a unicode glyph — no new icon-font dependency), the existing "DROP JSON TO IMPORT" label in SpaceMono uppercase letterspaced, and a 12px `var(--text-secondary)` subline reading "Replaces all current projects & todos" so the destructive nature is legible before the confirm modal opens. Keep the pointer-coarse early-return (touch browsers skip drag listeners entirely), the existing `dragDepth` enter/leave counter, and the file-type guard. The overlay stays `pointer-events: none` so the window-level `drop` listener still fires.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/exportImport.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-24

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
