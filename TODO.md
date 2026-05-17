# TODO List

## Bugs

- [ ] **[HIGH]** Fix recurring-task stats drawer being clipped to 54px by #mainList's grid track sizing
  - Description: When the stats drawer is opened from the chart icon on a recurring task row, only the top ~54px paints — the stat-card strip renders fully, the window-toggle row clips through the middle, and the contributions grid + missed-dates list are entirely hidden beneath the next todo row. The root cause is in `style.css`: `#mainList` is a CSS grid declared as `grid-template-rows: repeat(auto-fit, minmax(54px, 54px))`, which locks every implicit row track — including the one the new `#statsSibling` lands in — to exactly 54px. The drawer's own CSS (`display: flex; flex-direction: column; padding: 10px 14px 12px; gap: 8px`) renders correctly inside the cell, but the cell itself caps the height. `#descSibling` masks the same limitation because its content rarely exceeds 34px, so it fits inside the 54px clamp by accident. Fix by replacing the hardcoded `minmax(54px, 54px)` with `grid-auto-rows: minmax(54px, auto)` (and dropping the now-redundant `grid-template-rows` line) so rows preserve their 54px minimum for normal todo rows but grow to fit their content for drawers. Confirm `#toDoChild` heights are unaffected (they're already `var(--item-h)` plus margin, comfortably under 54px) and that the existing `dragDrop.js` `computeDropIndex` math still works — it operates on `getBoundingClientRect()` per row, so auto-sized rows don't change the logic.
  - Acceptance criteria:
    - Opening the stats drawer reveals the full content stack: stat strip, optional approximate-dates note, window toggle, contributions grid (or fallback strip), and missed-dates pill list.
    - Closing the drawer returns `#mainList` to its prior visual layout; surrounding todo rows still sit at their normal heights.
    - Description panels (`#descSibling`) continue to render at their existing height.
    - Drag-and-drop reorder still places the drop indicator at correct positions.
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

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
