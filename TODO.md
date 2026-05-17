# TODO List

## Bugs

- [x] **[MEDIUM]** Unify nav, sidebar, and todo row visual language with accent-tinted borders
  - Description: The current UI has inconsistent border and background treatments across the three major surfaces — the nav bar uses neutral `--border-dim` separators, the sidebar uses `--bg-elevated` with neutral borders, and todo rows are flat with neutral hairlines. Shift all dividing lines (nav bottom border, sidebar right border, project row separators, todo row separators, completed header border) to a consistent low-opacity purple (`rgba(108,93,245,0.10–0.15)`) so every section reads as part of one accent-tinted system. Also update the view-switcher pills (PROJECTS / TODAY / CALENDAR) from a fully solid fill to a semi-transparent accent fill on active (`rgba(108,93,245,0.20)` bg + `#6C5DF5` border + `#9D93EE` text) and a subtle accent-tinted border on inactive (`rgba(108,93,245,0.35)` border, `--text-muted` text). Checkboxes on todo rows should adopt `border-color: rgba(108,93,245,0.4)` to match. The base background tone and elevation model stay the same — this is purely a border/separator color pass.
  - Behavior:
    1. Nav bottom border: `border-bottom: 0.5px solid rgba(108,93,245,0.20)`
    2. Sidebar right border: `border-right: 0.5px solid rgba(108,93,245,0.15)`
    3. Project row separators: `border-bottom: 0.5px solid rgba(108,93,245,0.10)`
    4. Todo row separators (`#toDoChild` border-bottom): `0.5px solid rgba(108,93,245,0.10)`
    5. Completed header border-top: same `rgba(108,93,245,0.10)`
    6. Active view pill: `background: rgba(108,93,245,0.20)`, `border: 0.5px solid #6C5DF5`, `color: #9D93EE`, `border-radius: 6px` (square-ish, not fully round)
    7. Inactive view pill: `background: transparent`, `border: 0.5px solid rgba(108,93,245,0.35)`, `color: var(--text-muted)`, same border-radius
    8. Todo row checkbox border: `rgba(108,93,245,0.4)` to match the purple family
  - Implementation notes:
    - All changes are CSS-only in `style.css`. No JS changes required.
    - Todo row borders are currently set via inline JS styles in `main.js` — grep for `border` assignments on `#toDoChild` and verify which are CSS-driven vs inline. Inline styles will override the CSS change and must be updated in `main.js` too.
    - The view-switcher pills (`#tabProjects`, `#tabToday`, `#tabCalendar`) currently use a solid `--accent` fill for the active state — switch to the semi-transparent treatment above.
    - Neutral `--border-dim` / `--border-bright` replacements should only target the structural dividers listed above — don't touch component-internal borders (context menus, popovers, modals, drag indicators).
    - Verify dark theme: `rgba(108,93,245,0.10–0.20)` is light enough not to create visual noise on `--bg-elevated` but should remain visible. Spot-check against the light theme if it exists.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
  - Completed: 2026-05-17

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
