# TODO List

## Bugs

- [x] **[MEDIUM]** Fix contributions-grid month label clipped at the right edge of the SVG
  - Description: When the recurring-task stats drawer opens on a small window (e.g. 14d) and the contributions grid has only one or two columns starting in a single calendar month, the top-gutter month label (`May`, `Sept`, etc.) is clipped to just the first one or two letters. The root cause is in `buildContributionsGrid` in `toDoRow.js`: month labels are positioned at `x = labelGutterX + col * (cellSize + gap)` with the default `text-anchor: start`, so the glyph grows rightward from the column's left edge. For a single-column grid the SVG's total width is `labelGutterX + cellSize` = 28px, but the rendered "May" glyph at 9px font extends to roughly 33-34px — past the SVG's right edge, where the SVG's UA-default `overflow: hidden` clips it. The `.statsGridWrapper`'s `overflow-x: auto` doesn't surface a scrollbar because the SVG's own bounds are the constraint, not the wrapper's. Fix by introducing a `labelGutterRight` constant (24px — enough for the widest 3-letter month abbreviation plus a couple px of slack) and folding it into the SVG `width` calculation so there's always room for a label that starts at the last column to extend past the last cell. The viewBox absorbs the new width; cells and weekday labels keep their existing positions because both are keyed off `labelGutterX`, not the new right gutter. The fallback strip (`buildFallbackStrip`) is unaffected — it has no month labels.
  - Behavior:
    1. Single-column grid (14d on a Sunday, etc.) renders the full month label (`May`, `Jun`, `Sep`, etc.) above the column without clipping.
    2. Multi-column grids look identical to today — the right gutter is only visible when the rightmost column has a month label, and in normal cases the extra space sits unused.
    3. Weekday labels on the left and cell positions are unchanged.
  - Implementation notes:
    - Add `const labelGutterRight = 24;` next to the existing `labelGutterX` and `labelGutterY` declarations near the top of `buildContributionsGrid` so future tuning is one-line.
    - Update the SVG `width` calc: `const width = labelGutterX + gridWidth + labelGutterRight;`. Keep `height` unchanged.
    - The `viewBox` derives from `width` and `height` already, so no separate change is needed there.
    - No change to month-label `x` positioning — labels still grow rightward from their column's left edge; the new right gutter just gives them room.
  - Acceptance criteria:
    - Opening the stats drawer with a 14d window where the grid spans a single column renders the full month abbreviation (e.g. `May`) above that column with no clipping.
    - Opening with a 30d / 90d / All window continues to render correctly; multi-month label transitions render at their column boundaries without overlap.
    - The grid's cells and weekday gutter remain aligned with the column headers — no horizontal drift from the new constant.
    - The fallback strip renders unchanged.
    - `statsGridAxisLabels.test.js` continues to pass; consider adding an assertion that the SVG width includes a right-side gutter so this regression doesn't return.
  - Out of scope: switching to center-anchored month labels (a more principled but more invasive refactor); a separate fix for labels that would clip *left* into the weekday gutter (none observed, but worth a follow-up entry if a locale produces a wider month abbreviation).
  - File: `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/statsGridAxisLabels.test.js`
  - Completed: 2026-05-18

## Features

- [x] **[MEDIUM]** Add recurring-task stats drawer with hit-rate grid
  - Description: Recurring tasks currently push a frozen completed clone into the project's `items` array every time `advanceRecurringTodo` fires, but the user has no UI to see how consistently they hit their cadence. Add a stats drawer that opens below a recurring task row — mirroring how `descSibling` is inserted under `toDoChild` by the existing description toggle — and surfaces, for the focused task, a 4-card stat strip (current streak / hit rate / best streak / completions in window), a GitHub-style contributions grid showing each expected occurrence as a cell (intense purple = hit, dim = missed, ring = today, unstyled = future), a window toggle (14d / 30d / 90d / All — default 30d), and a missed-dates pill list beneath the grid. Open via a new chart-icon button in the meta cluster that renders only when `item.recurrence` is non-null; the drawer and the description panel can be open simultaneously.
  - Behavior:
    1. Add `listLogic.getRecurringTaskStats(project, item, window)` that walks the project's `items` array, finds the original recurring item plus all completed clones sharing its title, derives the expected occurrence sequence by walking `nextDueDate` from a start anchor (earliest completed clone's `due`, or the original's creation if no clones yet) forward to today, and returns `{ expectedDates: [], hits: Set<string>, misses: [], currentStreak, bestStreak, hitRate, completedCount }`. Window argument is one of `'14d' | '30d' | '90d' | 'all'`; expected dates are clipped to that window before counting.
    2. A hit is an expected date whose YYYY-MM-DD key matches a completed clone's `due`. A miss is any expected date strictly before today with no matching clone. Today is neither — it renders as a ring whether or not it's already satisfied.
    3. Streak math walks expected dates backwards from yesterday: longest unbroken run ending at yesterday is the current streak; best streak is the longest unbroken run anywhere in the all-time expected sequence.
    4. The drawer's chart-icon button is keyboard-reachable and Enter-activates the toggle, mirroring `descToggle`.
    5. When the original task's `recurrence.basis === 'completionDate'`, the drawer shows a small "completion-based — dates approximate" label under the stat strip so the user knows the expected sequence is reconstructed, not authoritative.
  - Implementation notes:
    - The drawer lives in a new `#statsSibling` element inserted/removed by a new `wireStatsToggle` helper in `toDoRow.js`, paralleling `wireDescToggle`. Both can co-exist as siblings under the same `toDoChild`.
    - Cell rendering is SVG — `<rect>` per expected date, sized 14x14 with 4px gaps, weeks-as-columns and weekday-as-row layout. Colors come from `--accent` (hit), `--bg-elevated` slightly darkened (miss), `--bg-base` with `--border-mid` stroke (future), and `--accent-light` stroke (today).
    - Grid degrades for monthly / yearly / custom-month / custom-year cadences — fall back to a single horizontal strip of the last 12 expected occurrences as 18x18 cells, no weekday rows. Detect by `recurrence.pattern in ['monthly','yearly']` or `recurrence.intervalUnit in ['month','year']`.
    - Add `getRecurringTaskStats` unit tests covering: daily with all hits, daily with two misses, weekdays skipping weekends in expected sequence, completion-basis approximate expected sequence, current streak ending at today, best streak in the middle of history, empty history (no clones yet).
    - The chart-icon button uses an inline SVG (no new dependency) sized 14x14 to match the recurring glyph; `aria-label="Show stats"` / `"Hide stats"`.
  - Acceptance criteria:
    - Drawer opens on chart-icon click for recurring tasks only; non-recurring rows do not render the icon.
    - Window toggle re-derives stats and re-renders the grid without closing the drawer.
    - Drawer survives a project switch (i.e., closing the drawer when the row unmounts is fine; the stats themselves persist via the data model).
    - Existing `descSibling` behavior is unchanged — opening stats does not close the description panel and vice versa.
    - Monthly / yearly recurrences render the fallback strip instead of an empty or sparse grid.
  - Out of scope: aggregate stats across all recurring tasks (a separate top-level "Stats" view is a future entry); editing or backfilling missed dates; export of the underlying hit/miss history; a "pattern detected" insight callout.
  - File: `toDoList_main/src/toDoRow.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`
  - Completed: 2026-05-17

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
