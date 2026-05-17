# TODO List

## Bugs

- [x] **[HIGH]** Fix uncommitted blank-placeholder text persisting after project switch
  - Description: After clicking the blank "Add a task" placeholder row and typing one or more characters without pressing Enter, switching to another project and switching back leaves the placeholder displaying the previously-typed text — and the row's chrome (close ×, due pill rendering as "Set date", checkbox, expand caret) all become visible as though the row were a real committed todo. The root cause is in `toDoRow.js`'s `toDoInput` `keyup` handler: `if (val.length > 0) { item.tit = val; listLogic.saveToStorage(); }` mutates `item.tit` on every keystroke and persists it, so a partial title gets baked into the project's items array even though the user never committed. On re-render, `buildToDoRow` keys all of its placeholder-vs-committed branches off `!item.tit`, so a non-empty `tit` is interpreted as a committed row and all the chrome reveals. The existing `sortCompletedToBottom` regression guard (pinned by a test in `listLogic.test.js`) only repairs this on the Enter commit path — project switches bypass it. Fix by scoping the keystroke-save behavior so it does NOT mutate `item.tit` for rows that were built as blank placeholders. Stamp `toDoChild.dataset.originalBlank = "true"` in `buildToDoRow` when `!item.tit` at build time, and in the `keyup` handler, skip the `item.tit = val; saveToStorage()` writes while that marker is present. The Enter commit path is unchanged — when the user actually commits, the existing handler sets `item.tit`, persists, removes the `originalBlank` flag (since the row is no longer a blank), and the chrome-reveal logic runs as it does today. Committed rows (`!item.tit` was false at build) continue to keystroke-save their edits, preserving the live-editing-safety property that exists for rename flows.
  - Behavior:
    1. Typing into a blank placeholder no longer writes to `item.tit` or `localStorage`; the typed text lives only in the input's own `value` until Enter commits.
    2. Switching projects without pressing Enter leaves the typed text behind — when the user returns, the placeholder is blank (`Add a task — press Enter` placeholder visible, no chrome). The keystrokes are lost on purpose; they were never committed.
    3. Pressing Enter on a blank placeholder works exactly as today: trim → set `item.tit`, set `item.pri = 2`, apply default due, save, reveal chrome, spawn a new blank, focus it.
    4. Edits to *committed* rows (clicking into an existing todo's title and retyping) continue to keystroke-save as today — the marker is only set on rows built as blanks, and the commit path removes it.
  - Implementation notes:
    - In `buildToDoRow`, alongside the existing `if (!item.tit) { ... }` branches that hide chrome, set `toDoChild.dataset.originalBlank = 'true'`. The dataset attribute survives in the DOM until the row is rebuilt by `addAllToDo_DOM`.
    - In the `toDoInput` `keyup` handler, wrap the persistence block: `if (toDoChild.dataset.originalBlank !== 'true') { /* existing item.tit + saveToStorage logic */ }`. Snap-back blur logic (`if (toDoInput.value.trim().length === 0 && savedTitle.length > 0)`) is unaffected because it only fires when the field is *empty* on blur — a blank placeholder being abandoned with text in it falls through to neither branch.
    - In the Enter commit handler, after the existing `item.tit = val; item.pri = 2; ...` block, add `delete toDoChild.dataset.originalBlank;` (or `toDoChild.removeAttribute('data-original-blank');`). After this point the row is a committed todo and subsequent edits should keystroke-save like every other committed row.
    - The `appendNewToDoRow` path that builds the next blank placeholder after a commit will re-stamp `data-original-blank='true'` on that new row at build time, so the cycle works for every chained entry.
    - The Enter handler's first-commit check (`siblingItems.some(function(i) { return !i.tit; })`) keeps working unchanged. It already filters `i !== item` before counting blank placeholders elsewhere, so the current row's `tit === ""` during typing doesn't double-count.
  - Acceptance criteria:
    - Reproducing the original bug — type into the blank placeholder, switch projects, switch back — results in a blank placeholder with placeholder text visible and no chrome.
    - Pressing Enter on the blank placeholder still commits the row, reveals chrome, and spawns a new blank below it.
    - Editing an existing committed row's title still saves on every keystroke (Vitest can cover this by inspecting the keyup handler's branching).
    - The `sortCompletedToBottom` invariant test in `listLogic.test.js` still passes — the regression guard there described the symptom from the original commit path; this fix removes the upstream cause but doesn't change the safety-net behavior.
  - Out of scope: a "draft" indicator that surfaces unsaved typing across sessions; toast-on-discard when leaving a project with uncommitted text (could be a follow-up entry if the discard ever feels surprising in practice); broader audit of other places `item.tit` may be mutated before commit (none observed, but worth a grep during implementation).
  - File: `toDoList_main/src/toDoRow.js`
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
