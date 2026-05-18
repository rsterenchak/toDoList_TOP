# TODO List

## Bugs

- [ ] **[HIGH]** Recurring-task stats: today's completion should count as a hit in the grid and the streak
  - Description: When a recurring task is completed today, `advanceRecurringTodo` pushes a frozen completed clone into the project's items array with `due` set to today's date — but the stats drawer renders today's cell as an unfilled ring regardless of whether that clone exists, and the streak / hit-rate stats stay at zero because today is excluded from the expected-date sequence. The original spec called for today to be "neither hit nor miss — render as a ring whether or not it's already satisfied," but that was the wrong call: excluding today from misses is correct (the day isn't over, you haven't missed it yet) but excluding it from *hits* hides successful work the moment it lands and contradicts the user's mental model of "I just did the thing, the chart should reflect that." Fix by treating today as eligible for hit detection in `getRecurringTaskStats` and by rendering today as a filled cell with a ring outline overlay when a hit exists for today. When no hit exists for today, the cell remains a hollow ring (today is still "in-flight" for miss purposes — it can become a hit later in the day, but it never becomes a miss until midnight rolls over).
  - Behavior:
    1. `getRecurringTaskStats` extends its expected-date walk to *include* today (currently stops at yesterday). Today is added to `expectedDates` if today matches the recurrence sequence.
    2. Hit detection unchanged in shape — today's YYYY-MM-DD key matched against the set of completed-clone `due` keys. When today's clone exists in the project's items array, today goes into the `hits` set; otherwise it does not.
    3. Miss detection unchanged: a miss is an expected date strictly before today with no matching clone. Today is never a miss regardless of completion state.
    4. Current-streak math walks expected dates backwards starting from today (was yesterday). If today is a hit, today is the start of the run; the walker continues back through yesterday, the day before, and so on, terminating at the first non-hit. If today is not a hit, the walker starts at yesterday and proceeds as before — a "potential streak of zero" is shown rather than today's absence breaking an otherwise-intact streak.
    5. Best-streak math unchanged: longest unbroken hit run anywhere in the all-time expected sequence, now able to include today.
    6. Hit rate computation includes today in both numerator (when today is a hit) and denominator (whenever today is an expected occurrence). For the 14d / 30d / 90d / All windows, today is the *most recent* expected date when applicable.
    7. Grid render for today: SVG cell receives the hit fill (`var(--accent)` or equivalent) AND a stroke outline using `var(--accent-light)` at 1.5px — overlaying the ring on top of the filled body. When today is not a hit, the cell renders as today does currently: no fill, ring outline only. The fallback strip (`buildFallbackStrip`) gets the same treatment for its rightmost cell when today is its most recent expected occurrence.
  - Implementation notes:
    - In `listLogic.js`, change the expected-date walker's terminal condition from `expectedDate < today` to `expectedDate <= today`. The YYYY-MM-DD key for today (`formatYMD(now)`) flows into the same Set lookup that's already in place for past dates, so no other detection logic needs to change.
    - Streak math: rename or document the existing "walk backwards from yesterday" loop to "walk backwards from today's index in `expectedDates`." When today is a hit, `currentStreak` increments before the loop; when today is not a hit, the loop starts at the previous expected date and walks back from there. This preserves the "abandoned for a week then today doesn't count as a fresh streak yet" UX — but the moment today is hit, it does count.
    - Grid cell render in `buildContributionsGrid`: extract the today-detection branch into a small helper that returns `{ classes, stroke }`. When today is a hit, return both the hit class and the today stroke; when today is a miss-eligible (never the case — today can't be a miss) or unfilled, return the today stroke alone. Avoid duplicating the SVG attribute-setting logic across branches.
    - `summarizeRecurringMissPattern` does not need to change. Today is never a miss, so the miss-summary helper continues to operate on `misses` exactly as before. The abandoned-detection's "longest contiguous miss run ending at yesterday" rule still applies — today's hit/non-hit state is irrelevant to it.
    - Unit tests for `getRecurringTaskStats` need updates to cover: today is a hit → in `hits`, in `expectedDates`, currentStreak includes today; today is not a hit and not yet a miss → not in `hits`, not in `misses`, in `expectedDates`, currentStreak walks from yesterday; today is the only expected date and is a hit → streak 1, hit rate 100%; today is the only expected date and is not a hit → streak 0, hit rate 0%, no misses. Existing tests that asserted "today is neither hit nor miss" need their expectations updated; the new contract is "today can be a hit, but cannot be a miss."
    - Grid render tests (likely DOM-snapshot-style in `toDoRow.test.js` if such coverage exists; otherwise add) should assert that today's `<rect>` carries both fill and stroke when a clone for today exists in items, and only stroke when not.
  - Acceptance criteria:
    - Completing a recurring task today causes its stats drawer to show today's grid cell as filled with a visible ring outline.
    - STREAK increments from 0 to 1 the moment today is completed (assuming yesterday was a miss or there was no prior history); subsequent days extend the streak normally.
    - HIT RATE recomputes to include today in the denominator and numerator on completion.
    - DONE count increments from 0 to 1 on the first completion of the day.
    - Unchecking today's completion (if that flow exists — recurring uncheck currently rolls back the clone) reverts the cell to ring-only and decrements the stats.
    - The "abandoned" miss pattern callout's wording remains unchanged when today gets hit after a long miss streak — the run ending at yesterday is still N days; today doesn't shorten it because today was never part of the miss run.
    - Switching the drawer's window (14d / 30d / 90d / All) keeps today's filled-plus-ring treatment in the rightmost position.
  - Out of scope: a "streak in danger" warning when today's expected occurrence is still un-hit late in the day; partial-day urgency colors on the today ring; revising the visual treatment of *future* expected occurrences (they remain the hollow `var(--bg-base)` cells with a thin border).
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`
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
