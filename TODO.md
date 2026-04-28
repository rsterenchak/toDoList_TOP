# TODO List

## Bugs
     
- [x] **[MEDIUM]** Extract row construction helpers from main.js into new toDoRow.js
  - Description: First of two PRs splitting the `toDoRow.js` carve-out (the last sub-task in the main.js module-split refactor). Create `toDoList_main/src/toDoRow.js` and move the row-construction layer out of `main.js`: `buildToDoRow` plus the per-row wiring helpers `wireCheckbox`, `wireDescToggle`, and `wireToDoRowClick`. Thread shared dependencies (`ensureCompanion`, `listLogic`, anything from `dueDate.js` / `dragDrop.js`) via plain ES imports, matching the precedent set by `projectRow.js`. Leave the DOM-lifecycle functions (`attachToDoDrag`, `reorderToDoDOM`, `addAllToDo_DOM`, `appendNewToDoRow`, `focusBlankToDoInput*`) in `main.js` for the follow-up entry.
  - Implementation notes: an earlier attempt to extract `toDoRow.js` in one shot hit an API stream-idle timeout mid-`create_file` (~400-line file, long agentic session). Splitting the carve-out in half keeps each tool call short enough to land cleanly. `main.js` is over 25k tokens — investigate with grep + `offset`/`limit`, never read it in full.
  - Acceptance criteria: all behavior preserved (checkbox toggle, description expand/collapse, row click, due-date pill, etc.); existing tests pass; any test under `toDoList_main/tests/` that reads `main.js` as a string and greps for one of the moved function names gets repointed at `toDoRow.js`. No new dependencies.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/tests/`
  - Completed: 2026-04-27 (PR #<number>)

## Features

- [x] **[MEDIUM]** Add manual export/import of todos as a JSON file
  - Description: Add two actions to the app — "Export todos" downloads a JSON snapshot of all projects and todos to the user's filesystem, "Import todos" reads a previously exported JSON file and replaces the current `localStorage` state with its contents. The goal is a portable, user-controlled backup mechanism with no backend: the user exports manually, stores the file wherever they want (gitignored repo folder, cloud drive, phone storage), and imports to restore or transfer between devices. `localStorage` remains the live store; the file is purely a snapshot in/out.
  - Behavior:
    1. Export: triggers a download of `todos-YYYY-MM-DD.json` (append `-2`, `-3`, etc. if a same-day export already happened this session, tracked in memory). Filename uses local date, not UTC. File contents are a pretty-printed JSON object shaped `{ version: 1, exportedAt: <ISO string>, projects: [...] }` where `projects` mirrors the exact structure already persisted to `localStorage`. After a successful export, write `lastExportedAt` (ISO string) to `localStorage` under the existing `todoapp_` prefix.
    2. Import: opens a native file picker scoped to `.json`. On selection, parse and validate the file (must be a JSON object with a numeric `version` field and a `projects` array). If validation fails, show an inline error message ("Couldn't read that file — expected a todos export.") and abort. If validation passes, show a confirmation modal: **"Replace all current todos with this file? Your existing N todos across M projects will be permanently overwritten."** with explicit Cancel and Replace buttons. On confirm, overwrite `localStorage` via `listLogic.js` and re-render the full app.
    3. Drag-and-drop import: dropping a `.json` file anywhere on the app window is equivalent to using the file picker — runs the same validate → confirm → overwrite flow. While a file is being dragged over the window, show a subtle full-window overlay ("Drop to import").
    4. Stale-export reminder: in the footer, if `lastExportedAt` is missing or older than 7 days *and* the user has at least one todo, show a small muted hint "Last backup: N days ago — export?" that links to the export action. Dismissible for the session via a small × on the hint.
  - Implementation notes:
    - No new dependencies — use vanilla `Blob` + object URL + hidden `<a download>` for export, `<input type="file" accept=".json">` for import, and the standard `dragover`/`drop` events for drag-and-drop.
    - Place the Export and Import controls in the existing top-bar / settings area; match the visual treatment of the theme toggle and hamburger so they don't feel bolted on. Exact placement is a design question — propose a small icon group ("download" + "upload" SVG icons) but flag it for review.
    - Validation lives next to the import handler, not in `listLogic.js`. Once validated, hand off to a new `replaceAllProjects(projects)` helper added to `listLogic.js` that wipes the current `todoapp_` keys and writes the new state in one pass — no partial-overwrite states.
    - Confirmation modal must close 3 ways (explicit Cancel/X, backdrop click, Escape) per `CLAUDE.md`. The destructive-action message names exactly what will be lost (todo and project counts) per the same rule.
    - Schema-version field is forward-looking — for now, accept only `version: 1` and reject everything else with a clear error. Future migrations get added when the data model changes.
    - `main.js` is over 25k tokens; locate the top-bar render block and the modal helper with grep + offset/limit rather than a full read.
    - Mobile: drag-and-drop is desktop-only; the file-picker path covers mobile imports. Export on mobile triggers a normal download (browser handles where it lands).
  - Acceptance criteria:
    - Round-trip: export from project A, clear `localStorage`, import the file → identical project and todo state restored (including positions, completion status, due dates, and any subtasks if that feature has landed).
    - Importing a malformed JSON file or one with a missing/wrong `version` field shows an error and leaves existing data untouched.
    - Cancelling the import confirmation modal leaves existing data untouched.
    - Stale-export hint disappears within one render cycle of a successful export.
  - Out of scope: automatic / scheduled exports, cloud sync, multi-device merge, encryption at rest, partial-project export, File System Access API integration (tracked separately if pursued later).
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)

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
