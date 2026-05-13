# TODO List

## Bugs

- [x] **[MEDIUM]** Remove mainTitle from PROJECTS view and add incomplete-count badges to sidebar projects
  - Description: The PROJECTS view's `mainTitle` strip duplicates information already in the sidebar (the selected project's name) and reads as cramped against the sidebar's right edge. Remove `mainTitle` entirely. Move the open-item count to a small badge on each sidebar project row so it's always visible — not just for the selected project. The PROJECTS main panel now starts directly with the existing add-task input row, matching how TODAY and CALENDAR start with their primary content. The EXPAND ALL control (which lived in the `mainTitle` row) relocates to the right side of the add-task row.
    - Behavior:
      1. Remove the `mainTitle` div rendering from the PROJECTS view in `main.js`. The main panel's first visible element on PROJECTS is now the add-task input row.
      2. Update sidebar project rendering: each row becomes `[project name (truncates) … [count badge]]` in a horizontal flex. The selected project keeps its existing purple left-border accent and bold weight.
      3. Badge content: incomplete todo count for the project as an integer. Shows `0` for empty / all-completed projects so layout stays consistent across rows (no hiding).
      4. Badge styling: small pill, `color: #9D93EE`, `background: rgba(108, 93, 245, 0.18)`, `font-family: 'Courier New', monospace`, `font-size: 11px`, padding `1px 7px`, `border-radius: 99px`. Right-aligned within the row.
      5. Badge updates: every add / complete / uncomplete / delete on a todo must re-render the affected project's sidebar badge in the same pass that re-renders the main panel. Adding or deleting a project also updates correctly. No stale counts after any operation.
      6. Project name truncation: existing ellipsis truncation continues to work — the name flex item shrinks to fit; the badge is fixed-width and always fully visible on the right.
      7. Relocate EXPAND ALL: right-aligned on the add-task row. Existing dropdown behavior (Expand all / Collapse all) is unchanged; only position changes.
    - Implementation notes:
      - Add a `getProjectIncompleteCount(project)` helper in `listLogic.js` rather than inlining the filter at the sidebar render site — this centralizes the definition of "open" in one place per the data-model-routing principle and is trivially testable.
      - All badge and layout styling lives in `style.css`. No inline JS style assignments on the badge — inline styles in `main.js` override CSS and have been a recurring source of bugs in this codebase.
      - Badges are only visible when the sidebar is visible. With the auto-collapse rule on TODAY and CALENDAR views, badges only appear on PROJECTS, which is the intended scope — open counts elsewhere (footer total, Today summary line) are separate and unaffected.
      - `main.js` is over 25k tokens; grep for `mainTitle`, the sidebar project list render block, the EXPAND ALL handler, and the add/complete/delete todo handlers before reading. Use offset/limit pagination.
    - Acceptance criteria:
      - Unit tests in `tests/listLogic.test.js` for `getProjectIncompleteCount()` covering: empty project (returns 0), all completed (returns 0), all incomplete (returns full count), mixed completion states.
      - Adding, deleting, completing, and uncompleting a todo each update the parent project's badge in the same render pass — no stale counts.
      - Long project names truncate with ellipsis and the count badge remains fully visible on the right.
      - Selected project's purple-left-border accent and bold weight remain intact on the row that now also has a badge.
    - Out of scope: color-coding badges by count or urgency (all stay purple); showing a completed-count alongside incomplete; click-on-badge interactions; animation when count changes; surfacing badges anywhere outside the sidebar.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`
  - Completed: 2026-05-13

## Features

- [x] **[MEDIUM]** Add Calendar view shell with month grid and right-side day detail panel
  - Description: Add a third top-level view, Calendar, alongside TODAY and PROJECTS. The view consists of a month grid on the left and a day-detail panel on the right; clicking a date in the grid populates the panel with that day's todos. This entry covers the view shell, grid rendering, day selection, and read-only display of the selected day's tasks. Drag-to-reschedule, recurring task instance projection, view-mode toggle (week/agenda), and add-from-calendar are explicitly deferred to follow-up entries.
    - Behavior:
      1. Add a `CALENDAR` pill as the third pill in the top bar, sized to match the existing TODAY/PROJECTS compact spec (12px text, 4px 12px padding). Active/inactive styling follows the existing pill rules. Persistence already exists via `todoapp_active_view`; `"calendar"` becomes a valid value.
      2. The Calendar view replaces the main panel content when active. The sidebar auto-collapses on entry to CALENDAR (same rule as TODAY); reopens on switch to PROJECTS.
      3. Month grid layout: 7 columns × 5-6 rows. Header row shows day-of-week initials (S M T W T F S). Cells show the day number top-aligned. Today's date gets a subtle purple outline. The selected date gets a purple-tinted background fill (`~#2a2435`). Leading/trailing days from adjacent months are dimmed (`~#4a4a5c`). Grid defaults to the current month on first load.
      4. Density indicator: each cell with one or more incomplete todos due on that date shows a small horizontal row of purple dots below the day number — 1 dot for 1 task, 2 dots for 2, 3 dots for 3 or more. Capped at 3 dots; no 4+ representation needed at this stage.
      5. Month navigation: `<` and `>` chevrons flank the month label (e.g. "May 2026") above the grid. Clicking moves the grid one month back/forward. The selected date persists across month changes (it becomes a leading/trailing day if scrolled past) unless the user clicks a new date in the visible month.
      6. Day-detail panel (right side, ~300px wide): shows selected date as a header (e.g. "TUESDAY MAY 12", purple all-caps), item count subtitle ("3 items" or "No items on this day"), and a list of incomplete todos for that date. Each task row reuses the shared row builder from the Today restyle entry with the due pill omitted (date is implied by selection) — checkbox, project pill, title only. Add a `{ hideDuePill: true }` option to the row builder if it doesn't already exist.
      7. Clicking a task row body in the day panel switches the active view to PROJECTS, selects that task's parent project, and scrolls the row into view (same behavior as Today rows). Clicking the checkbox toggles completion via the existing path and re-renders the calendar — the dot count for that date should update in the same render pass.
      8. On view-switch to CALENDAR, the selected date defaults to today. Selected date is not persisted across page reloads — always resets to today on load.
    - Implementation notes:
      - Aggregation goes through `listLogic.js`. Add a `getCalendarMonth(year, month)` helper returning `{ "YYYY-MM-DD": [todos] }` for all dates visible in the calendar grid for that month, including leading days from the previous month and trailing days from the next so the grid is always complete. Filter to incomplete todos with a matching due date; exclude items with no due date. Recurring tasks render their current instance only at this stage; next-instance projection is deferred to the recurring-task integration entry.
      - Compute date comparisons via `new Date(year, month, day).setHours(0,0,0,0)` to avoid timezone drift, same approach as the Today aggregation.
      - Reuse the shared row builder from the Today restyle entry, passing `{ hideDuePill: true }`. If the builder doesn't currently support that option, add it as a small extension rather than copy-pasting a near-duplicate row builder.
      - Top bar now carries three pills + hamburger + three right-side icons. At mobile widths this gets tight; the breakpoint compression added in the top-bar relocation entry needs to be re-evaluated for three pills — likely further padding reduction, with horizontal scroll on the pill cluster as a fallback. Pills must still hit `font-size: 16px+` on mobile.
      - `main.js` is over 25k tokens; grep for the pill bar (added in the top-bar relocation entry), the Today view container, and the sidebar toggle function before reading. Use offset/limit pagination.
    - Acceptance criteria:
      - Unit tests in `tests/listLogic.test.js` for `getCalendarMonth()` covering: empty input, single date with one todo, single date with multiple todos (including >3 to confirm the cap doesn't affect the helper's output), todos spread across the month, todos with no due date excluded, completed todos excluded, leading and trailing days populated, edge case where a todo's due date falls on the first or last visible cell of the grid.
      - Switching between TODAY, PROJECTS, and CALENDAR pills works smoothly with no flicker; `todoapp_active_view` persists correctly across reloads with `"calendar"` as a valid value.
      - Completing a todo from the day-detail panel updates the calendar dot count on that date in the same render pass.
    - Out of scope: drag-to-reschedule (separate entry); recurring task instance projection on future dates (separate entry); week and agenda view modes (separate entry); add-from-calendar including a "+ ADD FOR THIS DAY" button (separate entry); editing a todo's due date from the calendar; hover preview of tasks for non-selected dates; multi-day or all-day event spans; project-colored dots; auto-advancing the selected date when the calendar is left open past midnight.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/index.js`, `toDoList_main/tests/listLogic.test.js`
  - Completed: 2026-05-13

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
