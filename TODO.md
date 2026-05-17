# TODO List

## Bugs

- [x] **[MEDIUM]** Unify nav, sidebar, and todo row visual language with accent-tinted borders
  - Description: The current UI has inconsistent border and background treatments across the three major surfaces — the nav bar uses neutral `--border-dim` separators, the sidebar uses `--bg-elevated` with neutral borders, and todo rows are flat with neutral hairlines. Shift all dividing lines (nav bottom border, sidebar right border, project row separators, todo row separators, completed header border) to a consistent low-opacity purple (`rgba(108,93,245,0.10–0.15)`) so every section reads as part of one accent-tinted system. Also update the view-switcher pills (PROJECTS / TODAY / CALENDAR) from a fully solid fill to a semi-transparent accent fill on active (`rgba(108,93,245,0.20)` bg + `#6C5DF5` border + `#9D93EE` text) and a subtle accent-tinted border on inactive (`rgba(108,93,245,0.35)` border, `--text-muted` text). Checkboxes on todo rows should adopt `border-color: rgba(108,93,245,0.4)` to match. The base background tone and elevation model stay the same — this is purely a border/separator color pass.
  - Behavior:
    1. Nav bottom border: `border-bottom: 0.5px solid rgba(108,93,245,0.20)`
    2. Sidebar right border: `border-right: 0.5px solid rgba(108,93,245,0.15)`
    3. Project row separators: `border-bottom: 0.5px solid rgba(108,93,245,0.10)`
    4. Todo row separators (`#toDoChild` border-bottom): `0.5px solid rgba(108,93,245,0.10)`
    5. Completed header border-top: same `rgba(108,93,245,0.10)`
    6. Active view pill: `background: rgba(108,93,245,0.20)`, `border: 0.5px solid #6C5DF5`, `color: #9D93EE`, `border-radius: 6px` (square-ish, not fully round)
    7. Inactive view pill: `background: transparent`, `border: 0.5px solid rgba(108,93,245,0.35)`, `color: var(--text-muted)`, same border-radius
    8. Todo row checkbox border: `rgba(108,93,245,0.4)` to match the purple family
  - Implementation notes:
    - All changes are CSS-only in `style.css`. No JS changes required.
    - Todo row borders are currently set via inline JS styles in `main.js` — grep for `border` assignments on `#toDoChild` and verify which are CSS-driven vs inline. Inline styles will override the CSS change and must be updated in `main.js` too.
    - The view-switcher pills (`#tabProjects`, `#tabToday`, `#tabCalendar`) currently use a solid `--accent` fill for the active state — switch to the semi-transparent treatment above.
    - Neutral `--border-dim` / `--border-bright` replacements should only target the structural dividers listed above — don't touch component-internal borders (context menus, popovers, modals, drag indicators).
    - Verify dark theme: `rgba(108,93,245,0.10–0.20)` is light enough not to create visual noise on `--bg-elevated` but should remain visible. Spot-check against the light theme if it exists.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
  - Completed: 2026-05-17

## Features

- [ ] **[MEDIUM]** Add recurring-task stats drawer with hit-rate grid
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
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
