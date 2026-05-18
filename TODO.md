# TODO List

## Bugs

- [x] **[MEDIUM]** Backspace on focused todo-row sub-controls should exit to nav mode (focus the row itself), not edit mode
  - Description: The shipped Backspace-exit affordance on the row's sub-controls (`#checkToDo`, `#duePill`, `#descToggle`, `#statsToggle`, `#closeButtonToDo`) currently moves focus to `#toDoInput`, which drops the user straight into title-editing mode. The intent was a true "back out" gesture — leave the row's inner chrome and return to row-level nav mode so the user can keep moving between rows with ArrowUp/ArrowDown without first having to escape the input. Update `wireSubControlBackspaceExit` in `toDoRow.js` to mirror the existing arrow-nav handler's "focus the row in nav mode" contract: focus `toDoChild` itself (it already carries `tabindex="-1"` for exactly this purpose), add `.todo-active` to this row, and strip `.todo-active` from every other row in `#mainList`. This makes the next ArrowDown / ArrowUp resolve to "current row = this row" via the focus-based path in the global keydown handler, so the user transitions cleanly from sub-control focus → row nav mode → arrow-key traversal.
  - Behavior:
    1. With focus on any of the five wired sub-controls, pressing Backspace (no modifiers) moves focus to the parent `#toDoChild`, adds `.todo-active` to it, removes `.todo-active` from any other `#toDoChild` in `#mainList`, and prevents the browser's default "go back" navigation.
    2. The next ArrowUp / ArrowDown after the Backspace navigates between rows normally — the focus-based "currentRow = ae.closest('#toDoChild')" resolution in the global arrow-nav handler picks up the newly focused row.
    3. With focus on `#duePill` and the date popover open, the existing capture-phase `onDuePopoverKeydown` handler still owns the keystroke — it closes the popover and returns focus to the pill — and the row-level handler does not also bounce focus to the row.
    4. Modified Backspace (Ctrl/Cmd/Alt/Shift+Backspace) is unchanged: the row-level handler does not consume it, so the global Ctrl+Backspace sidebar shortcut still works from a focused sub-control.
    5. Backspace inside `#toDoInput` itself retains native character-deletion behavior — the row-level handler is not bound to the input.
  - Implementation notes:
    - Update `wireSubControlBackspaceExit(subControl, toDoInput, toDoChild)` in `toDoRow.js`: instead of `toDoInput.focus()`, do (a) `const mainList = toDoChild.parentElement; if (mainList) mainList.querySelectorAll('#toDoChild.todo-active').forEach(function(el) { if (el !== toDoChild) el.classList.remove('todo-active'); });`, (b) `toDoChild.classList.add('todo-active')`, (c) `toDoChild.focus()`. Keep the `event.preventDefault()` and the existing `#dueDatePopover` early-return guard.
    - The `toDoInput` parameter is no longer used by the helper. Either drop it from the signature (and update all five call sites) or keep it for backward-compat and add a JSDoc note that it's reserved. Dropping is cleaner and shorter — preferred.
    - The arrow-nav handler in `main.js` does not need changes. Its first resolution path is `ae.closest('#toDoChild')`, which already finds the now-focused row.
    - The `.todo-active` cleanup mirrors the same forEach pattern used in the arrow-nav handler and in the post-deletion focus logic in `wireCloseButton` — keep the comparison `el !== toDoChild` so a redundant Backspace on a row that's already active doesn't strip and re-add the class needlessly (a no-op in practice but avoids a flash if the class transitions ever get an animation in the future).
  - Acceptance criteria:
    - Tabbing into a committed row's sub-control and pressing Backspace focuses the `#toDoChild` element itself (the `:focus-within` outline shifts to the row), adds `.todo-active` to that row, and removes `.todo-active` from any other row.
    - Pressing ArrowDown / ArrowUp immediately after the Backspace moves focus to the next / previous committed row, matching the arrow-nav contract.
    - Pressing Backspace on `#duePill` while the date popover is open still closes the popover and returns focus to the pill (no row focus, no `.todo-active` reshuffle).
    - Pressing Ctrl/Cmd+Backspace on any focused sub-control still toggles the sidebar.
    - Backspace inside `#toDoInput` still deletes characters; title editing is unaffected.
    - The blank placeholder row continues to skip the wire-up — its chrome is hidden and never focusable.
    - The existing `todoRowSubControlKeyboardNav.test.js` Backspace assertions update to expect `toDoChild.focus()` and the `.todo-active` add/remove, replacing the prior `toDoInput.focus()` expectation.
  - Out of scope: extending the same exit affordance to controls outside the row (navbar buttons, project rail icons); adding a visible hint or tooltip surfacing the shortcut; updating the in-app help modal's keyboard-shortcuts section (worth a follow-up if this lands and proves discoverable).
  - File: `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/todoRowSubControlKeyboardNav.test.js`
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
