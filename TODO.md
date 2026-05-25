# TODO List

## Bugs

- [ ] **[HIGH]** Fix recurring-task stats drawer overflowing onto next row on mobile
  - Description: After landing the mobile recency-strip swap, the stats drawer's bottom content (second strip row + missed-dates pill list) renders outside the drawer's visual border on phone-width viewports (≤420px). The next todo row in `#mainList` overlaps the drawer's lower half, and the `MISSED: <pill>` row leaks beneath the next row. The drawer's row track in the `#mainList` grid isn't growing to fit the strip's two-row wrap layout — `grid-auto-rows: minmax(54px, auto)` already lets drawer rows grow on desktop (per the existing `mainListStatsDrawerHeight.test.js`), so the regression is specific to the new strip variant. Likely cause: the strip's SVG is sized with a `viewBox` + `width: 100%` but no explicit `height` (or an `aspect-ratio` that doesn't account for the 2-row wrap), so the SVG's intrinsic block size collapses to a value smaller than its rendered children, the grid track sizes to that smaller value, and the next row overlaps. Recall the prior visualizer-bars learning: CSS-only SVG sizing inside a grid track needs an explicit height (or a height-yielding parent) or the track caps to the wrong value. Fix by either (a) setting an explicit `height` attribute on the recency-strip SVG sized from cell count and row count, or (b) wrapping the SVG in a `div` with an explicit pixel `min-height` derived from `cells-per-row × cell-height + gap + caption + date-label-row`. Verify by opening the drawer on a 380px-wide viewport with a daily-cadence recurring task — the drawer's bottom border must sit below the missed-pill list, not above it, and the next `#toDoChild` must start below the drawer with the usual `-9px 8px 8px` margin gap.
  - Behavior:
    1. On viewports ≤420px wide, opening the stats drawer reserves enough vertical grid-track height to contain the stat-card strip, window toggle, `LAST 14` caption, the wrapped 7×2 strip, the oldest/today date row, and the missed-pill list — all inside the drawer's visual border.
    2. The next `#toDoChild` in `#mainList` starts after the drawer's bottom margin, with no overlap.
    3. The `MISSED:` pill list renders inside the drawer, above the next row.
    4. Desktop drawer rendering is unchanged.
  - Implementation notes:
    - Inspect the recency-strip builder added for the Option C mobile swap — if the SVG is built with `setAttribute('width', '...')` but no `setAttribute('height', ...)`, add an explicit height computed from `rowsCount × (cellSize + gap) - gap`.
    - If the SVG is being styled via CSS with `width: 100%; height: auto`, the `viewBox` aspect ratio drives the height — confirm the viewBox matches the 2-row layout's pixel bounds, not just the first row's.
    - Trace `wireStatsToggle` → `renderDrawer` → recency-strip branch on a mobile viewport via the `todo-interaction-tree` skill if the cause isn't obvious from the SVG attributes alone.
    - No `style.css` change to `#mainList` should be needed — `grid-auto-rows: minmax(54px, auto)` is already correct (see `mainListStatsDrawerHeight.test.js`). The fix is inside the strip builder.
  - Acceptance criteria:
    - Drawer's bottom border sits below the missed-pill list on a 380px viewport.
    - Next todo row starts below the drawer with the normal inter-row gap.
    - Adding a regression test that the recency-strip SVG declares an explicit `height` attribute (or wrapping div has an explicit `min-height`) would mirror the prior `statsGridAxisLabels.test.js` pattern.
  - Out of scope: changing the strip's cell size, wrap count, or color treatment; changing the desktop drawer.
  - File: `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/` (new regression test alongside the existing stats-drawer tests)
  - Completed: YYYY-MM-DD (PR #<number>)

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
