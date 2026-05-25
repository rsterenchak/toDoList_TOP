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

## Features

- [x] **[MEDIUM]** Re-enable drag-and-drop JSON import with redesigned full-window overlay
  - Description: The drag-and-drop import code in `exportImport.js` is fully intact (`attachDragDropImport` is exported, `#importDropOverlay` CSS is present, validation routes through the shared `importTodosFromString` pipeline with the destructive-overwrite confirm modal), but the boot-time call from `main.js` is missing — dragging a `.json` file onto the window currently does nothing. Re-wire the call alongside the other restore-from-storage hooks (passing the same `rebuildAfterImport` callback the file picker and Drive pull paths use), and redesign the overlay to a full-window dashed perimeter: replace the small centered `#importDropOverlayInner` card with an inset dashed border (`inset: 18px; border: 2px dashed var(--accent); border-radius: 8px; box-shadow: 0 0 24px var(--accent-glow)`) over a slightly darker base wash (`background: rgba(14,15,20,0.72)`), centered inside it a 44px Tabler-style file-arrow glyph (vanilla inline SVG or a unicode glyph — no new icon-font dependency), the existing "DROP JSON TO IMPORT" label in SpaceMono uppercase letterspaced, and a 12px `var(--text-secondary)` subline reading "Replaces all current projects & todos" so the destructive nature is legible before the confirm modal opens. Keep the pointer-coarse early-return (touch browsers skip drag listeners entirely), the existing `dragDepth` enter/leave counter, and the file-type guard. The overlay stays `pointer-events: none` so the window-level `drop` listener still fires.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/exportImport.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-24

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
