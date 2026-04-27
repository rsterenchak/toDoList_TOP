# TODO List

## Bugs
     
- [x] **[MEDIUM]** Extract row construction helpers from main.js into new toDoRow.js
  - Description: First of two PRs splitting the `toDoRow.js` carve-out (the last sub-task in the main.js module-split refactor). Create `toDoList_main/src/toDoRow.js` and move the row-construction layer out of `main.js`: `buildToDoRow` plus the per-row wiring helpers `wireCheckbox`, `wireDescToggle`, and `wireToDoRowClick`. Thread shared dependencies (`ensureCompanion`, `listLogic`, anything from `dueDate.js` / `dragDrop.js`) via plain ES imports, matching the precedent set by `projectRow.js`. Leave the DOM-lifecycle functions (`attachToDoDrag`, `reorderToDoDOM`, `addAllToDo_DOM`, `appendNewToDoRow`, `focusBlankToDoInput*`) in `main.js` for the follow-up entry.
  - Implementation notes: an earlier attempt to extract `toDoRow.js` in one shot hit an API stream-idle timeout mid-`create_file` (~400-line file, long agentic session). Splitting the carve-out in half keeps each tool call short enough to land cleanly. `main.js` is over 25k tokens — investigate with grep + `offset`/`limit`, never read it in full.
  - Acceptance criteria: all behavior preserved (checkbox toggle, description expand/collapse, row click, due-date pill, etc.); existing tests pass; any test under `toDoList_main/tests/` that reads `main.js` as a string and greps for one of the moved function names gets repointed at `toDoRow.js`. No new dependencies.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/`
  - Completed: 2026-04-27 (PR #<number>)

## Features

- [x] **[MEDIUM]** Add tonal depth between sidebar, main area, and todo cards
  - Description: Right now the sidebar, the main todo-list area, and the todo card backgrounds all sit at roughly the same near-black value, so the layout reads flat — items dissolve into the background instead of feeling like they're floating on it. Introduce ~5-10 brightness points of separation between the three surfaces: sidebar at the darkest tone, main content area one step lighter, and todo card surfaces another notch lighter (or with a subtle 1px inner border around `#1F1F2E`). Add the new surface tones as design tokens in the dark theme variable block alongside the existing palette so the light theme can mirror the layering with its own values.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-04-27 (PR #<number>)

- [ ] **[MEDIUM]** Improve add-task input field affordance with placeholder, icon, and submit hint
  - Description: The empty add-task input at the top of the todo list has no placeholder, no icon, and no visible affordance — it reads as a thin div more than an input. Set a muted-gray placeholder ("Add a task…"), add a faint left-side `+` glyph inside the input (Unicode character or inline SVG — no icon-font dependency), and surface a subtle right-side `↵` hint on focus to communicate that Enter submits. Set the placeholder attribute where the input is built in `main.js`, and add the icon, hint, and focus-state styling in CSS. Keep the input's `font-size` at 16px+ to avoid iOS Safari auto-zoom.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
