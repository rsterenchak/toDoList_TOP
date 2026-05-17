# TODO List

## Bugs

- [x] **[MEDIUM]** Add weekday and month labels to the recurring-task stats contributions grid
  - Description: The shipped stats drawer renders the contributions-grid cells correctly but is missing the axis labels the agreed mockup carried: weekday letters running down the left edge (S M T W T F S, Sunday-first to match the existing Sun-first cell math in `buildContributionsGrid`) and month abbreviations (Jan, Feb, …) floating above the first column of each month spanned by the visible window. Without these, a user looking at the grid can't tell which row represents which weekday — the original goal of "seeing when I tend to slip" is undermined because the spatial signal is unlabeled. Update `buildContributionsGrid` in `toDoRow.js` to add a left gutter (~14px) hosting seven `<text>` weekday labels positioned at each row's vertical center, and a top gutter (~14px) hosting one `<text>` month label per column whose week starts in a new calendar month. The first column always gets a month label regardless. Expand the SVG `width` and `height` and the `viewBox` to absorb the gutters, and shift every cell's `x` and `y` by the gutter offsets so cells visually align under their column's month label and beside their row's weekday letter. The fallback strip (`buildFallbackStrip`) is unaffected — it's a single row of last-12 occurrences with no weekday axis to label.
  - Behavior:
    1. Left gutter is 14px wide, with seven `<text>` elements at `x=0`, `y = row * (cellSize + gap) + cellSize/2 + gutterOffsetY`, `dominant-baseline="middle"`, text content `S M T W T F S` in row order (matches the existing `row = d.getDay()` math where Sunday is index 0).
    2. Top gutter is 14px tall. For each column index, derive the first day-of-week date in that column (`alignedStart + col * 7 days`) and emit a `<text>` label at `x = gutterX + col * (cellSize + gap)`, `y = 10`, when (a) `col === 0`, or (b) that column's first day's month differs from the previous column's first day's month. Label text uses the locale-short month name (e.g. `Date.toLocaleString(undefined, { month: 'short' })`).
    3. Label fill comes from `var(--text-muted)`; font is inherited from the SVG's parent (the drawer's `font-size: 12px` already cascades). Add a small inline `font-size: 9px` on labels to match the compact mockup density.
    4. Existing cell rendering, hit/miss/today/future class logic, and per-cell `<title>` tooltips remain unchanged — only their `x` / `y` offsets shift by the gutter width / height.
  - Implementation notes:
    - Introduce two local constants near the top of `buildContributionsGrid`: `const labelGutterX = 14;` and `const labelGutterY = 14;`. Use them in the SVG `width` / `height` calc, the `viewBox`, and every cell's coordinate computation. This makes future tuning a one-line change.
    - Use `document.createElementNS(svgNS, 'text')` for labels (same namespace as the existing `<rect>` calls). Set `class="statsGridLabel"` so styling lives in `style.css` next to the existing `.statsGrid` rules.
    - Add a `.statsGridLabel` CSS rule alongside `.statsGrid .statsCell*` in `style.css`: `fill: var(--text-muted); font-size: 9px; font-family: inherit;`. No need for separate `Hit`/`Miss` variants — labels are static chrome.
    - For the month-change detection, store `let lastLabeledMonth = -1;` outside the column loop and update it after each label emission so consecutive same-month columns don't repeat the abbreviation.
    - The 14d window may produce only 2–3 columns; the first-column-always rule guarantees at least one month label is visible in every window. Verify this on the All window too, which can span multiple months — labels should appear at each transition.
  - Acceptance criteria:
    - Opening the stats drawer on a daily-recurrence task shows S M T W T F S running down the left edge of the grid, each letter vertically centered against its row.
    - At least one month abbreviation appears above the grid, with additional abbreviations at every column where a new calendar month begins.
    - Cells remain aligned under their column's month label (no horizontal drift introduced by the gutter shift).
    - Switching window (14d / 30d / 90d / All) re-renders the grid with correctly recomputed month labels for the new span.
    - Fallback strip for monthly / yearly / custom-month / custom-year recurrences is unchanged.
    - The drawer's overall height grows by ~14px to absorb the top gutter; `#mainList`'s row sizing (now `grid-auto-rows: minmax(54px, auto)` after the clipping fix) accommodates this without additional changes.
  - Out of scope: vertical alignment of the month labels with the *exact* first cell of that month within the column (the label sits at the column root, not the cell — matches the GitHub contributions-graph convention); locale-specific weekday letters (sticking with English single letters for now).
  - File: `toDoList_main/src/toDoRow.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-17

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
