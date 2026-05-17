# TODO List

## Bugs

- [x] **[MEDIUM]** Replace recurring-task missed-dates pill wall with pattern callout + modal for full list
  - Description: The stats drawer's missed-dates pill list grows linearly with miss count, and at high miss counts (e.g. a daily task abandoned 4 months ago) it produces 100+ wrapping pills that visually dominate the drawer and bury the actual signal — the stat strip and contributions grid. Restructure the missed section in the drawer into two stacked pieces: (1) a pattern callout that surfaces one insight derived from the misses, and (2) a "Most recent misses:" pill row showing the 5 newest miss dates followed by a `+ N more` button. The button opens a new modal listing every missed date, grouped by month with a count summary at the top — keeping the drawer compact while still giving the user a path to the full history. Below the existing 7-miss threshold (default), keep the current full pill list behavior in the drawer — small miss counts genuinely benefit from showing every date inline. The callout always renders when there is at least one miss, even at low counts, with phrasing that adapts to the count.
  - Behavior:
    1. Add `listLogic.summarizeRecurringMissPattern(stats, now)` returning `{ kind, text }` where `kind ∈ ['abandoned' | 'weekday' | 'recentSlip' | 'fallback' | 'lowCount']` and `text` is the rendered callout sentence. Priority order: abandoned → weekday → recentSlip → fallback. For miss counts of 1–2, return `lowCount` with text like `Missed Apr 17` or `Missed Apr 17 and Apr 24` (plus a weekday observation when both fall on the same DOW: `— both Thursdays`).
    2. **Abandoned detection**: compute the longest contiguous miss run ending at yesterday (today is not yet a miss). Fire when the run length ≥ 7 AND ≥ 50% of the window's misses fall inside the run. Phrasing: `Last hit was ${formatShortDate(lastHit)} — ${runLength} consecutive misses since.` When there's no prior hit in the window, phrase as `${runLength} consecutive misses, no completions in this window.`
    3. **Weekday concentration**: compute miss rate per weekday (misses on that weekday / expected occurrences on that weekday). Fire only when (a) the task's expected occurrences span ≥ 4 distinct weekdays, (b) one or two weekdays have a miss rate ≥ 60%, AND (c) those weekdays' miss rate is at least 1.5× the average miss rate of the other expected weekdays. Phrasing: `${pct}% of your ${weekdayName} occurrences are missed` (one weekday) or `${weekday1}s and ${weekday2}s account for ${pct}% of your misses` (two weekdays).
    4. **Recent slip**: split the window into first half / second half by date. Fire when first-half hit rate ≥ 70% AND second-half hit rate ≤ 30% AND the window has ≥ 14 expected occurrences. Phrasing: `Strong start (${firstPct}% hits through ${midDate}) but slipped recently (${secondPct}% since).`
    5. **Fallback**: when no other pattern fires but there are ≥ 7 misses: `Missed ${missCount} of ${expectedCount} occurrences. No clear pattern.`
    6. Render the callout immediately below the contributions grid. Style mirrors the existing `.statsApproximateNote` band but with a left-accent border at 2px and a small icon prefix (use a circle-with-line-and-dot info glyph rendered inline as SVG, same stroke/size rhythm as the `.recurringGlyph`).
    7. Below the callout: when misses ≤ 7, render the existing pill list unchanged. When misses > 7, render `Most recent misses:` label + 5 newest miss-date pills + a `+ ${remaining} more` button that opens the new modal. Sort the 5-pill preview newest-first.
    8. Open the modal via a new `showMissedDatesModal(taskTitle, misses)` exported from `modals.js`. Title: `Missed: ${taskTitle}`. Modal body starts with a one-line overview (`${missCount} missed dates across ${earliestMonthYear} – ${latestMonthYear}` — or `in ${monthYear}` when all misses fall in a single month). Below the overview, group misses by month with a small heading per group (`${monthName} ${year} · ${monthMissCount} missed`), each followed by a row of date pills using the same `.statsMissedPill` styling as the drawer. Months sort newest-first; pills within a month sort newest-first as well.
    9. Modal close vocabulary matches the existing changelog / help / settings modals: explicit close X button, backdrop click, and Escape. Wire through `isAnyModalOrPopoverOpen` so the global `?` / Escape handlers yield while the modal is open.
  - Implementation notes:
    - `summarizeRecurringMissPattern` lives in `listLogic.js` next to `getRecurringTaskStats` and consumes the same `stats` object the drawer already passes in. Keep it pure (no DOM, no `Date.now()` — accept an optional `now` argument for testability, like `getTodayAggregation` does).
    - Add a constant `MISS_PILL_THRESHOLD = 7` near the top of the misses helper section in `toDoRow.js` so the cutoff is one-line tunable.
    - `showMissedDatesModal` follows the same shell pattern as `showHelpModal` and `showChangelogModal`: backdrop + dialog with `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the title, capture-phase Escape handler, and focus restoration on close. The Close button gets initial focus.
    - Group misses by month in JS before render: walk the sorted misses array and bucket by `${year}-${month}` key, then iterate the buckets in descending order. Use `toLocaleString(undefined, { month: 'long' })` for the month name so non-en-US locales render naturally.
    - Modal body must scroll independently when the list is long. Mirror `#helpModalBody`'s `overflow-y: auto; flex: 1 1 auto` rule on the new `#missedDatesModalBody`.
    - Add CSS rules for `#missedDatesModalBackdrop`, `#missedDatesModal`, `#missedDatesModalHeader`, `#missedDatesModalTitle`, `#missedDatesModalClose`, `#missedDatesModalBody`, `.missedDatesOverview`, `.missedDatesMonthGroup`, and `.missedDatesMonthHeading` alongside the existing help-modal block in `style.css`. Reuse `.statsMissedPill` styling for the date pills inside the modal — no need to duplicate.
    - The `+ N more` button uses the same chip-shaped rhythm as the existing pills but with `color: var(--accent-text)` and `border-color: rgba(108, 93, 245, 0.4)` so it reads as an action rather than a static date.
    - Unit tests for `summarizeRecurringMissPattern` should cover: zero misses returns null/empty, 1 miss returns lowCount with single date, 2 misses on same weekday returns lowCount with weekday observation, 2 misses on different weekdays returns lowCount without weekday note, abandoned detection at exactly 7-miss run, abandoned with no prior hits in window phrases correctly, weekday-concentration with 1 vs 2 weekday clusters, weekday detection correctly skips weekly recurrences (single expected weekday), recent-slip detection at 14-occurrence boundary, fallback when none fire.
    - Add `isAnyModalOrPopoverOpen` coverage for `#missedDatesModalBackdrop` and a follow-up test mirroring the existing `shortcutsHelpModal.test.js` shape — assert the modal renders with the documented `role` / `aria-modal` / `aria-labelledby`, has a close X with id `missedDatesModalClose`, and groups its body by month.
  - Acceptance criteria:
    - Drawer with ≤ 7 misses renders the callout AND the full pill list inline (no `+ N more` button).
    - Drawer with > 7 misses shows the callout, `Most recent misses:`, 5 newest pills, and a `+ ${remaining} more` button.
    - Clicking `+ N more` opens a modal titled `Missed: ${taskTitle}` with an overview line and misses grouped by month, newest-first within and across groups.
    - Modal closes on X, backdrop click, and Escape; focus returns to the `+ N more` button afterward.
    - For the screenshot scenario (130+ misses, 4-month abandonment) the callout reads `Last hit was Jan 31 — 130 consecutive misses since.`, the drawer shows 5 newest May pills + `+ 125 more`, and the modal lists all 130 grouped under May / Apr / Mar / Feb / Jan headings.
    - Switching the drawer's window (14d / 30d / 90d / All) re-derives the callout and updates the modal's miss set on the next open.
    - No callout renders when miss count is zero.
  - Out of scope: a "Mark all caught up" bulk action; export of missed dates as CSV/text; configurable thresholds via settings (the 7-miss cutoff stays hardcoded); inline editing or backfilling missed dates from the modal.
  - File: `toDoList_main/src/toDoRow.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/modals.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`
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
