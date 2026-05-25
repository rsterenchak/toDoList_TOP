# TODO List

## Bugs

- [ ] **[MEDIUM]** Hide description chevron on todo rows on mobile only
  - Description: Each todo row ends with a small `▼` chevron that toggles the description panel. On mobile, horizontal space is at a premium and titles already truncate aggressively — hide the chevron at the mobile breakpoint so the saved space goes to the title. Tapping the row already opens the description, so the chevron is redundant on touch anyway. Desktop keeps the chevron unchanged (it's still useful as an explicit affordance with a mouse, and there's room for it).
  - Behavior:
    1. At the mobile breakpoint, the `▼` chevron is not visible on any todo row (initial render, restore-from-storage, newly added rows, completed rows).
    2. Tapping a todo row still opens its description (unchanged).
    3. Blurring/tapping outside still closes the description (unchanged — verify, since on mobile the chevron may have been one of the close paths).
    4. On desktop, the chevron renders and behaves exactly as today.
    5. No layout shift on mobile rows — the saved space goes to the title.
  - Implementation notes:
    - Prefer a CSS-only change: target the chevron element by its existing class and `display: none` it inside the existing mobile breakpoint in `style.css`. No DOM/JS changes needed if the chevron is already a discrete element.
    - Grep `main.js` for the chevron's class/selector first to confirm there are no inline `style.display` writes — those would override the CSS rule and need to be made conditional (or removed) for the hide to take effect.
    - Mobile breakpoint should match existing convention in `style.css` (no new breakpoint).
    - If close-on-outside-tap doesn't already work on mobile, that's a separate bug — file it separately rather than scope-creeping this entry.
  - Acceptance criteria:
    - On a narrow viewport, no `▼` chevron appears on any todo row; titles have noticeably more room.
    - Tapping a row opens the description; tapping outside closes it.
    - On a wide viewport, the chevron renders and works exactly as today.
  - Out of scope: Desktop chevron behavior, the description panel itself, focus/blur behavior, refactoring the four overlapping todo-row builders.
  - File: `toDoList_main/src/style.css` (likely CSS-only; `toDoList_main/src/main.js` only if inline style writes need to be made conditional)
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[MEDIUM]** Re-enable drag-and-drop JSON import with redesigned full-window overlay
  - Description: The drag-and-drop import code in `exportImport.js` is fully intact (`attachDragDropImport` is exported, `#importDropOverlay` CSS is present, validation routes through the shared `importTodosFromString` pipeline with the destructive-overwrite confirm modal), but the boot-time call from `main.js` is missing — dragging a `.json` file onto the window currently does nothing. Re-wire the call alongside the other restore-from-storage hooks (passing the same `rebuildAfterImport` callback the file picker and Drive pull paths use), and redesign the overlay to a full-window dashed perimeter: replace the small centered `#importDropOverlayInner` card with an inset dashed border (`inset: 18px; border: 2px dashed var(--accent); border-radius: 8px; box-shadow: 0 0 24px var(--accent-glow)`) over a slightly darker base wash (`background: rgba(14,15,20,0.72)`), centered inside it a 44px Tabler-style file-arrow glyph (vanilla inline SVG or a unicode glyph — no new icon-font dependency), the existing "DROP JSON TO IMPORT" label in SpaceMono uppercase letterspaced, and a 12px `var(--text-secondary)` subline reading "Replaces all current projects & todos" so the destructive nature is legible before the confirm modal opens. Keep the pointer-coarse early-return (touch browsers skip drag listeners entirely), the existing `dragDepth` enter/leave counter, and the file-type guard. The overlay stays `pointer-events: none` so the window-level `drop` listener still fires.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/exportImport.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-24

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
