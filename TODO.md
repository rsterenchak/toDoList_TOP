# TODO List

## Bugs

- [ ] **[MEDIUM]** Backspace on focused todo-row sub-controls exits back to the row's title input
  - Description: Keyboard users who Tab into a todo row's sub-controls (`#checkToDo`, `#duePill`, `#descToggle`, `#statsToggle`, `#closeButtonToDo`) currently have no one-key way to back out of the row's chrome short of Shift+Tabbing through every preceding control or reaching for the mouse. Add a Backspace handler on each sub-control that moves focus back to the row's `#toDoInput` (the row's anchor element), mirroring the existing Backspace-as-exit convention already established by the due-date popover (`onDuePopoverKeydown`), pomodoro popover (`onPomodoroKeydown`), and music popover (`onMusicKeydown`). When the due-date popover is already open from a focused `#duePill`, the existing capture-phase `onDuePopoverKeydown` handler closes the popover first — the new row-level Backspace handler must not double-fire in that case.
  - Behavior:
    1. With focus on `#checkToDo`, `#descToggle`, `#statsToggle`, or `#closeButtonToDo`, pressing Backspace (no modifiers) moves focus to the same row's `#toDoInput` and prevents the browser's default "go back" navigation.
    2. With focus on `#duePill` and the date popover NOT open, Backspace moves focus to the same row's `#toDoInput`.
    3. With focus on `#duePill` and the date popover open, Backspace falls through to the existing `onDuePopoverKeydown` capture-phase handler, which closes the popover and returns focus to the pill — the row-level handler does not also bounce focus to the input.
    4. Modified Backspace (Ctrl/Cmd/Alt/Shift+Backspace) is not consumed by the row-level handler so the existing global Ctrl+Backspace sidebar shortcut still works when invoked from a focused sub-control.
    5. Backspace inside `#toDoInput` itself retains its native character-deletion behavior — the row-level handler does not bind to the input.
  - Implementation notes:
    - Add a single shared helper `wireSubControlBackspaceExit(subControl, toDoInput, toDoChild)` in `toDoRow.js`, called from each sub-control's wire-up site after the existing keydown listeners are attached. The helper installs a `keydown` listener on the sub-control that fires when `event.key === 'Backspace'` AND no modifier keys are held, calls `event.preventDefault()`, and calls `toDoInput.focus()`.
    - For `#duePill` specifically, the helper additionally checks `document.getElementById('dueDatePopover')` at the top of the handler — when the popover element exists, return early (no preventDefault, no focus change) so the capture-phase popover handler owns the keystroke.
    - The handler attaches in the bubble phase (default), so the capture-phase `onDuePopoverKeydown` runs first when the popover is open. The popover handler calls `stopPropagation`, so this listener never fires in that case. The popover-element check above is a belt-and-suspenders guard against future ordering changes.
    - Skip the helper entirely on blank placeholder rows: the chrome is hidden on those rows (`#duePill`, `#checkToDo`, `#descToggle`, `#statsToggle`, `#closeButtonToDo` all use `display: none` for `!item.tit`) so they're not focusable anyway, but a wire-time guard (`if (!item.tit) return;`) avoids paying for listeners that can never fire.
    - The placeholder row's own `#toDoInput` Backspace behavior — including the existing `data-original-blank` keystroke-save bypass from the recently-shipped bug fix — is unaffected; the input itself is never wired by this helper.
  - Acceptance criteria:
    - Tabbing into a committed row and pressing Backspace from each of `#checkToDo`, `#duePill`, `#descToggle`, `#statsToggle`, and `#closeButtonToDo` returns focus to the row's `#toDoInput`.
    - Pressing Backspace on `#duePill` while the date popover is open closes the popover and returns focus to the pill (no input bounce); pressing Backspace again then exits to `#toDoInput`.
    - Pressing Ctrl+Backspace (or Cmd+Backspace) on any focused sub-control still toggles the sidebar, matching the existing global shortcut.
    - Backspace inside `#toDoInput` still deletes characters; the row's title editing is unaffected.
    - Blank placeholder rows still hide their chrome and are not focusable via the new path.
  - Out of scope: extending the same Backspace-to-exit affordance to non-row controls (e.g. navbar buttons); a visual hint or tooltip that surfaces the new shortcut; updating the in-app help modal's keyboard-shortcuts section (worth a follow-up entry if this lands and proves discoverable).
  - File: `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/todoRowSubControlKeyboardNav.test.js`
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
