# TODO List

## Bugs

- [x] **[HIGH]** Fix mobile read-mode row clipping long titles behind fixed row height
  - Description: On mobile (≤700px), tapping a committed todo row to enter read mode (`data-mobile-read="true"`) unclamps the title display span to `white-space: normal` so long titles wrap into multi-line text — but the base `#toDoChild` rule sets `height: var(--item-h)` (a fixed clamp) and the row also has `overflow: clip`, so a wrapped 2–3 line title overflows the row's box and gets visually cut off (top and bottom lines truncated, only the middle line readable). Reproduces on the active row in the screenshot ("Bug: Delete key not working on Mac for project or list item deletion") at the iPhone width. Fix in `style.css` by adding `height: auto; min-height: var(--item-h);` to the existing mobile-scoped `#toDoChild[data-mobile-read="true"]:not([data-original-blank="true"])` rule so the row grows with its wrapped title content while preserving the 54px minimum for short titles. Keep `align-items: center` so the right-side controls (copy button, due-date pill, expand caret) float to the vertical middle of the tall title block — matches the chosen visual treatment (Option B). The descSibling panel below the row continues to render correctly since it's a separate grid track that already sizes to content; no JS changes needed.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-05-24

## Features

- [x] **[MEDIUM]** Re-enable drag-and-drop JSON import with redesigned full-window overlay
  - Description: The drag-and-drop import code in `exportImport.js` is fully intact (`attachDragDropImport` is exported, `#importDropOverlay` CSS is present, validation routes through the shared `importTodosFromString` pipeline with the destructive-overwrite confirm modal), but the boot-time call from `main.js` is missing — dragging a `.json` file onto the window currently does nothing. Re-wire the call alongside the other restore-from-storage hooks (passing the same `rebuildAfterImport` callback the file picker and Drive pull paths use), and redesign the overlay to a full-window dashed perimeter: replace the small centered `#importDropOverlayInner` card with an inset dashed border (`inset: 18px; border: 2px dashed var(--accent); border-radius: 8px; box-shadow: 0 0 24px var(--accent-glow)`) over a slightly darker base wash (`background: rgba(14,15,20,0.72)`), centered inside it a 44px Tabler-style file-arrow glyph (vanilla inline SVG or a unicode glyph — no new icon-font dependency), the existing "DROP JSON TO IMPORT" label in SpaceMono uppercase letterspaced, and a 12px `var(--text-secondary)` subline reading "Replaces all current projects & todos" so the destructive nature is legible before the confirm modal opens. Keep the pointer-coarse early-return (touch browsers skip drag listeners entirely), the existing `dragDepth` enter/leave counter, and the file-type guard. The overlay stays `pointer-events: none` so the window-level `drop` listener still fires.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/exportImport.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-24

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
