# TODO List

## Bugs

- [ ] **[MEDIUM]** Add incomplete-count badges to sidebar project rows
  - Description: Add a small numeric badge to each sidebar project row showing the project's incomplete todo count. This entry is purely additive — `mainTitle`, EXPAND ALL, and all other existing PROJECTS-view chrome remain untouched. A follow-up entry will remove `mainTitle` and relocate EXPAND ALL once badges are verified working.
    - Behavior:
      1. Each sidebar project row gains a right-aligned count badge: `[project name (truncates) … [badge]]`. Selected project's existing purple left-border accent and bold weight remain intact.
      2. Badge content is the incomplete todo count as an integer; renders `0` for empty / all-completed projects (no hiding) so layout stays consistent.
      3. Badge styling: small pill, `color: #9D93EE`, `background: rgba(108, 93, 245, 0.18)`, `font-family: 'Courier New', monospace`, `font-size: 11px`, padding `1px 7px`, `border-radius: 99px`. Right-aligned within the row.
      4. Badge updates: every add / complete / uncomplete / delete on a todo, and every add / delete / rename of a project, re-renders the affected badge in the same pass as the rest of the UI. No stale counts.
      5. Project name truncation is preserved — name shrinks to fit, badge stays fully visible.
    - Implementation notes:
      - Add `getProjectIncompleteCount(project)` helper to `listLogic.js` rather than inlining the filter at the render site — centralizes the definition of "open" per the data-model-routing principle.
      - All badge styling lives in `style.css`. No inline JS style assignments — inline styles in `main.js` override CSS and have been a recurring bug source.
      - This entry is strictly additive: do not remove, relocate, or restyle `mainTitle`, EXPAND ALL, the footer count, or anything else outside the sidebar. Any tempting "while I'm here" cleanups belong in the follow-up entry.
      - `main.js` is over 25k tokens; grep for the sidebar project list render block and the add / complete / uncomplete / delete todo handlers before reading. Use offset/limit pagination.
    - Acceptance criteria:
      - Page loads without console errors after the change.
      - Unit tests in `tests/listLogic.test.js` for `getProjectIncompleteCount()`: empty project (returns 0), all completed (returns 0), all incomplete (returns full count), mixed completion states.
      - Adding, deleting, completing, and uncompleting a todo each update the parent project's badge in the same render pass.
      - Renaming a project preserves its badge.
      - Selected project's purple-left-border accent and bold weight remain intact on a row that now has a badge.
      - Long project names truncate with ellipsis; badge remains fully visible.
      - All existing PROJECTS-view functionality (mainTitle, EXPAND ALL, add task, due-date popover, rename, etc.) is unchanged.
    - Out of scope: any change to `mainTitle`, EXPAND ALL, footer counts, or main-panel layout; color-coding; click-on-badge interactions; animation; surfacing badges outside the sidebar.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Remove mainTitle from PROJECTS view and relocate EXPAND ALL to add-task row
  - Description: With sidebar count badges in place from the previous entry, `mainTitle` on the PROJECTS view is now strictly redundant — it shows the selected project's name, which is already highlighted in the sidebar. Remove it. The main panel's first visible element on PROJECTS becomes the existing add-task input row. The EXPAND ALL control (currently inside `mainTitle`) relocates to the right end of the add-task row.
    - Behavior:
      1. The `mainTitle` div and all DOM nodes inside it are removed from the PROJECTS view. The main panel's first visible element on PROJECTS is now the add-task input row.
      2. EXPAND ALL moves to the right end of the add-task row. Existing dropdown content (Expand all / Collapse all) and behavior are unchanged; only its position changes.
    - Implementation notes:
      - **Before removing any code**, run a project-wide search for the identifier `mainTitle` and enumerate every site that references it: text-content updates, querySelector / getElementById calls, classList operations, parent-element traversal, event listeners, CSS selectors. Every site needs to be updated or removed in the same diff. A single surviving null reference will throw on bootstrap and break the page — this exact failure happened the last time this work was attempted.
      - Specifically verify (non-exhaustive): the project-selection handler that updates the title text on click, the rename-project commit path, the footer count rendering (confirm it does NOT depend on mainTitle and continues to update independently), the EXPAND ALL handler and its dropdown anchoring logic, the initial render in `restoreFromStorage()`, and any `#mainTitle` CSS selectors.
      - EXPAND ALL relocation: the dropdown's anchor element changes. Verify the positioning logic (likely absolute / fixed) still aligns correctly against the new anchor. If the dropdown's position is computed from anchor `getBoundingClientRect()`, no math change is needed — just re-aim at the new element.
      - All styling changes live in `style.css`. No inline JS style assignments.
      - `main.js` is over 25k tokens; grep for `mainTitle`, `EXPAND ALL`, `expandAll`, the add-task row render block, and the project-selection handler before reading. Use offset/limit pagination.
    - Acceptance criteria:
      - Page loads without console errors after the change. This is the explicit smoke test — verify before doing anything else.
      - Switching between projects works smoothly — no flicker, no errors, no stale state.
      - Renaming a project (double-click → edit → Enter or blur) still commits and re-renders correctly.
      - The footer's `0 OPEN / 0 DONE` count still updates on add / complete / uncomplete / delete.
      - EXPAND ALL's dropdown opens, positions correctly relative to its new anchor on the add-task row, and both Expand all / Collapse all items still toggle the description-expand state correctly.
      - The sidebar count badges from the previous entry continue working.
      - No CSS rules in `style.css` reference `#mainTitle` after the change (orphan selectors removed).
      - All existing tests pass.
    - Out of scope: any change to the sidebar count badges; changes to the footer counts or its rendering; restyling the add-task row beyond placing EXPAND ALL on its right side; restyling EXPAND ALL itself.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

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
