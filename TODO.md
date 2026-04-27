# TODO List

## Bugs
     
- [x] **[MEDIUM]** Extract row construction helpers from main.js into new toDoRow.js
  - Description: First of two PRs splitting the `toDoRow.js` carve-out (the last sub-task in the main.js module-split refactor). Create `toDoList_main/src/toDoRow.js` and move the row-construction layer out of `main.js`: `buildToDoRow` plus the per-row wiring helpers `wireCheckbox`, `wireDescToggle`, and `wireToDoRowClick`. Thread shared dependencies (`ensureCompanion`, `listLogic`, anything from `dueDate.js` / `dragDrop.js`) via plain ES imports, matching the precedent set by `projectRow.js`. Leave the DOM-lifecycle functions (`attachToDoDrag`, `reorderToDoDOM`, `addAllToDo_DOM`, `appendNewToDoRow`, `focusBlankToDoInput*`) in `main.js` for the follow-up entry.
  - Implementation notes: an earlier attempt to extract `toDoRow.js` in one shot hit an API stream-idle timeout mid-`create_file` (~400-line file, long agentic session). Splitting the carve-out in half keeps each tool call short enough to land cleanly. `main.js` is over 25k tokens — investigate with grep + `offset`/`limit`, never read it in full.
  - Acceptance criteria: all behavior preserved (checkbox toggle, description expand/collapse, row click, due-date pill, etc.); existing tests pass; any test under `toDoList_main/tests/` that reads `main.js` as a string and greps for one of the moved function names gets repointed at `toDoRow.js`. No new dependencies.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/`
  - Completed: 2026-04-27 (PR #<number>)

## Features

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
  - Completed: 2026-04-27 (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
