# TODO List

## Bugs
     
- [x] **[MEDIUM]** Extract row construction helpers from main.js into new toDoRow.js
  - Description: First of two PRs splitting the `toDoRow.js` carve-out (the last sub-task in the main.js module-split refactor). Create `toDoList_main/src/toDoRow.js` and move the row-construction layer out of `main.js`: `buildToDoRow` plus the per-row wiring helpers `wireCheckbox`, `wireDescToggle`, and `wireToDoRowClick`. Thread shared dependencies (`ensureCompanion`, `listLogic`, anything from `dueDate.js` / `dragDrop.js`) via plain ES imports, matching the precedent set by `projectRow.js`. Leave the DOM-lifecycle functions (`attachToDoDrag`, `reorderToDoDOM`, `addAllToDo_DOM`, `appendNewToDoRow`, `focusBlankToDoInput*`) in `main.js` for the follow-up entry.
  - Implementation notes: an earlier attempt to extract `toDoRow.js` in one shot hit an API stream-idle timeout mid-`create_file` (~400-line file, long agentic session). Splitting the carve-out in half keeps each tool call short enough to land cleanly. `main.js` is over 25k tokens — investigate with grep + `offset`/`limit`, never read it in full.
  - Acceptance criteria: all behavior preserved (checkbox toggle, description expand/collapse, row click, due-date pill, etc.); existing tests pass; any test under `toDoList_main/tests/` that reads `main.js` as a string and greps for one of the moved function names gets repointed at `toDoRow.js`. No new dependencies.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/`
  - Completed: 2026-04-27 (PR #<number>)

## Features

- [x] **[MEDIUM]** Add recurring tasks (rolling todo model with daily/weekly/monthly patterns)
  - Description: Add a recurrence feature so a todo can repeat on a schedule. Use a rolling-todo data model: a recurring task is a single persistent todo with a `recurrence` field; checking it off does not delete the row but instead unchecks it and advances its due date to the next occurrence. Recurrence is configured from a new "Repeat" section appended to the existing due-date popover. Recurring rows are visually marked with a small ↻ glyph after the title so they're scannable in the list.
  - Behavior:
    1. Data model: extend `toDo.js` with a `recurrence` field, either `null` (one-off task, default) or an object shaped `{ pattern: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom', interval: number, intervalUnit: 'day' | 'week' | 'month' | 'year', basis: 'dueDate' | 'completionDate', endDate: ISOString | null }`. For non-custom patterns, `interval` and `intervalUnit` are ignored. `basis` defaults to `'dueDate'`. `endDate` defaults to `null` (no end).
    2. UI — repeat configuration: in the existing due-date popover, append a new "Repeat" section below the calendar. Default state shows "Repeat: Never ▾" as a dropdown trigger. Tapping it expands an inline section with: a pattern dropdown (Never / Daily / Weekdays / Weekly / Monthly / Yearly / Custom); when "Custom" is selected, reveal `Every [N] [days/weeks/months/years]` (number input + unit dropdown); a small toggle row "Repeat from completion date" (off by default, meaning repeat from due date); an optional "End on" date field that's hidden until a small "Add end date" link is clicked. Selecting "Never" clears `recurrence` to `null` and collapses the section. Closing the popover commits the recurrence config to the todo.
    3. UI — list row indicator: rows with `recurrence !== null` render a small ↻ glyph (inline SVG, sized 14px, color `var(--color-text-secondary)`) immediately after the title text. The date pill's text remains the next due date — no "Every Mon" text on the pill itself.
    4. Completion behavior: when the user checks the checkbox of a recurring todo, do **not** mark it completed and do **not** strike through the title. Instead, compute the next due date based on `recurrence.basis` (from the current due date, or from `Date.now()`) and `recurrence.pattern`/`interval`/`intervalUnit`, update the todo's `due` field, and re-render. The checkbox briefly flashes checked then unchecks (small CSS transition, ~250ms) so the user gets feedback that the action registered. If the computed next due date is past `recurrence.endDate`, treat completion as terminal: mark the todo completed normally and stop recurring.
    5. Pattern arithmetic: `daily` → +1 day; `weekdays` → next Mon–Fri (skip Sat/Sun); `weekly` → +7 days; `monthly` → +1 month, clamping to last day of target month if the original day-of-month doesn't exist (e.g. Jan 31 → Feb 28); `yearly` → +1 year, same clamping for Feb 29; `custom` → +`interval` × `intervalUnit`, with the same month/year clamping rules. All arithmetic uses local time, not UTC.
    6. Editing: editing the due date of a recurring task via the popover updates the *current* occurrence's due date and leaves the recurrence config intact. There is no "edit this occurrence vs. all future" distinction — model (1) doesn't have that concept.
    7. Subtasks: if subtasks have landed by then, treat them as part of the recurring task — when the parent's due date advances, all subtasks reset to unchecked. (If subtasks haven't landed yet, this clause is a no-op.)
  - Implementation notes:
    - No new dependencies — date math via vanilla `Date`. The month/year clamping logic is the only non-trivial bit; encapsulate it in a `nextDueDate(currentDue, recurrence, completionDate)` pure function in `listLogic.js` so it's unit-testable in isolation.
    - All `recurrence` mutations go through `listLogic.js` per the "data-model writes go through listLogic" rule. Add helpers `setRecurrence(todoId, recurrence)` and `advanceRecurringTodo(todoId)` (the latter called from the row's checkbox handler in `main.js`).
    - The due-date popover lives in `main.js`; locate it with grep + offset/limit since `main.js` is over 25k tokens. The new Repeat section should mirror the existing popover's styling and close-behavior conventions (close 3 ways: backdrop, Escape, explicit close).
    - The ↻ glyph is an inline SVG (no icon-font dependency). Store the SVG markup as a small constant near the row-render code.
    - Mobile inputs in the recurrence config (number input for custom interval) need `font-size: 16px+` to avoid iOS Safari auto-zoom.
    - Section headers in the popover follow sentence case ("Repeat", not "REPEAT" or "Repeat:") to match the existing visual language.
  - Acceptance criteria:
    - A daily recurring task with due date today, checked off → due date becomes tomorrow, checkbox unchecked, row stays in the list.
    - A weekdays recurring task with due Friday, checked off → due date becomes Monday (skipping Sat/Sun).
    - A monthly recurring task with due Jan 31, checked off → due date becomes Feb 28 (or 29 in leap years), then Mar 31, etc.
    - A custom "every 3 weeks" task, checked off → due date advances 21 days.
    - With `basis: 'completionDate'`, completing a daily task 3 days late → next due is 1 day after completion, not 1 day after the original due date.
    - A recurring task with `endDate` set, where the next computed due exceeds `endDate` → behaves like a normal one-off completion (marked done, no advance).
    - Round-trip through `localStorage` preserves the entire `recurrence` object including `null` end dates.
  - Out of scope: time-of-day support, "skip this occurrence" action, "edit all future occurrences" UX, weekday-of-month patterns ("last Friday of month", "every other Tuesday"), notification/reminder integration, recurrence history or streak tracking.
  - File: `toDoList_main/src/toDo.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`
  - Completed: 2026-04-28 (PR #<number>)

- [ ] **[LOW]** Add affordance cues to new-task input (leading +, placeholder, N keyboard hint)
  - Description: Replace the bare new-task input at the top of the todo panel with a more inviting variant: a small purple `+` glyph on the left, placeholder text "Add a task — press Enter" inside the field, and a subtle keyboard hint badge `N` on the right. Wire a global `keydown` listener so pressing `N` while focus is *not* in another input/textarea/contenteditable element focuses this input and prevents the keystroke from leaking into the field. Form submission, the existing focus/blur styling, and the input's data path stay unchanged — this is purely affordance polish plus one shortcut.
  - Implementation notes:
    - `+` glyph and `N` badge are decorative — keep them inside the input's wrapper, not as separate clickable elements, so click-anywhere-on-the-row still focuses the input.
    - Mobile: keep `font-size: 16px+` on the input to avoid iOS Safari auto-zoom on focus. The `N` badge can hide below ~480px since touch users won't use it.
    - The `N` shortcut handler must early-return when `document.activeElement` is an input, textarea, contenteditable, or inside an open modal/popover — otherwise typing "n" anywhere (including in a todo title) will yank focus.
    - `main.js` is over 25k tokens — locate the new-task input render and form-submit wiring with grep + offset/limit rather than a full read.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

- [x] **[MEDIUM]** Redesign TODO panel with date grouping, smart input, semantic date pills, and nested subtasks
  - Description: Overhaul the TODO ITEMS panel to improve scannability and add a subtask layer. Replace the empty input with an affordance-rich variant (leading `+` icon, "Add a task — press Enter" placeholder, `N` kbd badge that focuses the input when pressed outside any editable element); group the active project's todos under date-based section headers (Due today, This week, Later) computed from each todo's `due` field at render time; recolor the date pill semantically (warm coral when due is today or overdue, neutral gray otherwise); and add a nested subtasks layer so a row can be expanded inline to reveal child checkboxes that strikethrough on completion. Project sidebar, footer, top bar, and mascot stay unchanged.
  - Behavior:
    1. Smart input is visual + one wiring change — `+` icon left, placeholder text, small `N` kbd badge right. Pressing `N` while focus is outside any editable element focuses this input. Form submission still goes through the existing form-submit listener with no behavior change.
    2. Section grouping partitions the active project's todos into "Due today" (due ≤ today), "This week" (due ≤ today + 7), and "Later" (everything else, including todos with no due date). Each non-empty group renders under a small uppercase header preceded by a colored dot; empty groups are hidden entirely. Sort order within each group preserves the existing position-based ordering.
    3. Semantic date pill keeps its current shape and date text but switches background + text color to the warm coral treatment when the todo's `due` is today or earlier; otherwise it stays the existing neutral gray.
    4. Subtasks: a row with `subtasks.length > 0` shows an expand chevron right of the date pill. Expanded state renders children indented under the parent, each with its own checkbox; checking a child strikes through that child's title without altering the parent's checked state. Toggling the parent does not cascade to children. Persist expanded/collapsed per-row in `localStorage` so state survives reload.
  - Implementation notes:
    - No new dependencies — date math via vanilla `Date`, no date-fns or similar.
    - Extend `toDo.js` factory with `subtasks: []` (each entry shaped `{title, completed}`); route all subtask mutations through new helpers in `listLogic.js` per the "data-model writes go through listLogic" rule.
    - `main.js` is over 25k tokens; use grep + offset/limit when locating the row-render path, form-submit listener, and the date-pill render block.
    - Add regression tests in `tests/listLogic.test.js` covering subtask create / toggle / delete and `localStorage` round-trip under the existing `todoapp_` prefix.
  - Out of scope: project sidebar (no per-project counts), footer and stats area, mascot positioning, top-bar (hamburger / theme toggle / settings) — all stay as they are today.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/toDo.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
