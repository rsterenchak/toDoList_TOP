# TODO List

## Bugs

- [x] **[HIGH]** Fix recurring-task stats drawer overflow on mobile by switching strip to single-row 16px cells
  - Description: After the initial mobile recency-strip swap, the drawer's bottom content (strip's second wrap row + missed-dates pill list) still renders outside the drawer's visual border on phone-width viewports (≤420px) — the next `#toDoChild` overlaps the drawer's lower half. Root cause is the two-row wrap layout: the SVG's intrinsic block size collapses below its rendered children's footprint, so the `#mainList` grid track sizes to the wrong value and the next row sits on top. Fix by reworking the mobile recency strip to a single row of 14 cells at 16×16px with a 3px gap (no wrap), and declaring an explicit `height="16"` on the SVG so the grid track sizes deterministically. Mirrors the prior visualizer-bars learning: CSS-only SVG sizing inside a grid track needs an explicit height or the track caps to the wrong value. The single-row layout also resolves the height calculation question — total strip block is one cell tall plus the `LAST 14` caption above and the oldest-date / `today` label row below, all measurable in pixels. Total width at 16px cells + 3px gaps for 14 cells is `14×16 + 13×3 = 263px`, which fits inside a 380px viewport's drawer padding box with margin to spare. Cells still use the same `cellClasses` / `cellTitleLabel` helpers so the hit / miss / today-ring treatments are identical to desktop.
  - Behavior:
    1. On viewports ≤420px wide, daily / weekdays / weekly / custom-interval cadences render a single horizontal row of 14 cells at 16×16px with 3px gaps — no wrap, no horizontal scroll.
    2. The SVG declares an explicit `height="16"` attribute (not just `viewBox`) so the `#mainList` grid track sizes correctly.
    3. The drawer's bottom border sits below the missed-pill list; the next `#toDoChild` starts after the drawer's bottom margin with no overlap.
    4. Cell color rules (hit / miss / today ring / future) match the desktop grid via the shared helpers.
    5. `LAST 14` caption sits above the strip; oldest-date and `today` labels sit below, full-width-distributed via flex `justify-content: space-between`.
    6. Window-toggle changes (14d / 30d / 90d / All) re-render the drawer; the strip always shows the last 14 regardless of selection.
    7. Desktop (>420px) rendering of the contributions grid is unchanged.
  - Implementation notes:
    - Update the mobile recency-strip builder added in the prior PR to emit a single 14-cell row at 16×16px with 3px gaps instead of the 7×2 wrap at 22×22px.
    - Set both `viewBox="0 0 263 16"` and `width="263"` `height="16"` on the SVG (or use `width="100%"` with explicit `height="16"`) so the SVG contributes a real pixel height to the `#mainList` grid track.
    - Verify by opening the drawer on a 380px-wide viewport with a daily-cadence recurring task — drawer's bottom border below the missed-pill list, next row starts below with the usual `-9px 8px 8px` margin gap.
    - No `style.css` change to `#mainList` should be needed — `grid-auto-rows: minmax(54px, auto)` is already correct (see `mainListStatsDrawerHeight.test.js`). The fix is inside the strip builder.
  - Acceptance criteria:
    - On a 380px viewport with the drawer open, the drawer's bottom border sits below the missed-pill list.
    - Next todo row starts below the drawer with the normal inter-row gap.
    - Add a regression test (mirroring the `statsGridAxisLabels.test.js` pattern) asserting the mobile-strip SVG declares an explicit `height` attribute and lays cells out in a single row.
  - Out of scope: changing the desktop contributions grid, adjusting stat-card / window-toggle layout, adding new color treatments.
  - File: `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/` (new regression test alongside the existing stats-drawer tests)
  - Completed: 2026-05-25

- [ ] **[MEDIUM]** Hide checkbox on mobile and rely on existing swipe-right to complete
  - Description: On `≤700px` viewports the `#checkToDo` square at the left of each todo row is visually redundant — swipe-right-to-complete is already wired in `toDoRow.js` via `attachToDoDrag`'s `swipeTargets.onRight`, which programmatically toggles `checkToDo.checked` and dispatches its existing `change` event, so the data path and completion micro-interaction are unchanged. Hide the checkbox at the mobile breakpoint in `style.css` (`#checkToDo { display: none; }` inside `@media (max-width: 700px)`) so the title gets the reclaimed horizontal space; the desktop layout keeps the checkbox exactly as today. Don't remove the element from the DOM — `swipeTargets.onRight` guards on `cb.style.display === 'none'` and the swipe path needs `checkToDo` to exist so it can flip `.checked` and fire the change event the persistence layer listens for. Verify swipe-right still completes/uncompletes from a mobile viewport, that the strikethrough + slide-to-Completed animation still plays, and that the completed-section toggle continues to surface re-open via swipe.
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Increase mobile todo-row edge gutter and shrink title font to recover horizontal room
  - Description: At `≤700px` the todo rows currently sit only 6px from the viewport edges (`#toDoChild { margin: 4px 6px; ... }`), so titles read as hugging the screen. Raise the lateral row margin to **14px** on each side and add `env(safe-area-inset-left/right, 0px)` on top so landscape and notched devices get additional inset beyond the base value. Apply the same horizontal inset to the top "+ Add a task" empty-input row inside `#mainList` so it aligns with the rows beneath it (the input is the first row of `#mainList` — match via row-level padding rather than per-element margin so the swipe-action panes still extend the full width of each `#toDoChild`). To partially offset the title room lost to the wider gutter, drop `#toDoInput` from its current mobile size to **15px** at the `≤700px` breakpoint (keep the `!important` since inline styles in `main.js` would otherwise override it). 15px is below the 16px iOS-Safari zoom-avoidance threshold for *focused* inputs, but `#toDoInput` is rendered with the `.toDoTitleDisplay` span on top while not focused on mobile (focus is a deliberate two-tap edit gesture); confirm focused editing on iOS Safari doesn't auto-zoom — if it does, fall back to keeping `#toDoInput` at 16px and shrink only `.toDoTitleDisplay` to 15px instead, which is purely visual and not subject to the input-zoom rule. Desktop spacing and font sizes stay unchanged.
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[MEDIUM]** Re-enable drag-and-drop JSON import with redesigned full-window overlay
  - Description: The drag-and-drop import code in `exportImport.js` is fully intact (`attachDragDropImport` is exported, `#importDropOverlay` CSS is present, validation routes through the shared `importTodosFromString` pipeline with the destructive-overwrite confirm modal), but the boot-time call from `main.js` is missing — dragging a `.json` file onto the window currently does nothing. Re-wire the call alongside the other restore-from-storage hooks (passing the same `rebuildAfterImport` callback the file picker and Drive pull paths use), and redesign the overlay to a full-window dashed perimeter: replace the small centered `#importDropOverlayInner` card with an inset dashed border (`inset: 18px; border: 2px dashed var(--accent); border-radius: 8px; box-shadow: 0 0 24px var(--accent-glow)`) over a slightly darker base wash (`background: rgba(14,15,20,0.72)`), centered inside it a 44px Tabler-style file-arrow glyph (vanilla inline SVG or a unicode glyph — no new icon-font dependency), the existing "DROP JSON TO IMPORT" label in SpaceMono uppercase letterspaced, and a 12px `var(--text-secondary)` subline reading "Replaces all current projects & todos" so the destructive nature is legible before the confirm modal opens. Keep the pointer-coarse early-return (touch browsers skip drag listeners entirely), the existing `dragDepth` enter/leave counter, and the file-type guard. The overlay stays `pointer-events: none` so the window-level `drop` listener still fires.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/exportImport.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-24

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
