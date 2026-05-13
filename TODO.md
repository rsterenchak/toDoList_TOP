# TODO List

## Bugs

- [x] **[MEDIUM]** Restyle Today view todo rows to match Projects view row style
  - Description: Update the Today view's todo row rendering to visually match the Projects view's todo rows — dark card fill, rounded corners, more generous padding, and the dotted-border due pill with calendar icon. Move the project-name pill from its current right-side position to the left of the title, where it functions as a leading context chip. The due pill takes the right-aligned slot the project pill used to occupy, matching the Projects view's layout exactly. The project pill changes from a filled style to a purple-outline + purple-text style to align with the rest of the row's chip aesthetic.
    - Behavior:
      1. Row layout (left to right): completion checkbox → project pill → todo title → due pill (right-aligned).
      2. Row card: dark fill matching the Projects-view row fill (`~#1a1a22`), `border-radius: 6px`, padding ~11px vertical × 14px horizontal, ~4px vertical gap between rows.
      3. Project pill: purple outline + purple text on transparent background, all-caps, same monospace styling currently used. `max-width: ~110px` with `text-overflow: ellipsis` and `white-space: nowrap` for long project names.
      4. Due pill: visually identical to the existing Projects-view due pill — dotted 1px border, calendar icon, all-caps date text, chevron-down affordance. Amber border + amber text variant for items due today and "due in N days" labels (≤3 days out), matching the Projects view's existing amber styling convention.
      5. Checkbox styling matches the Projects-view checkbox (size, border, hover, checked state).
      6. The existing click-row-to-jump-to-project behavior (from the aggregation entry) remains intact: clicking the row body outside the checkbox and pills switches to PROJECTS view, selects the project, and scrolls to the todo.
    - Implementation notes:
      - Reuse the existing project-row CSS classes for the card fill, checkbox, and due pill where possible. If `style.css` doesn't currently expose them as shared classes, extract a `.todoRowCard` (or similarly named) class that both views share, so future tweaks only touch one place.
      - The due-pill rendering currently lives inside the project-row builder in `main.js`. If extracting it cleanly to a small shared helper is straightforward, do so and reuse it in `buildTodayRow`. If not, match the markup and styles directly in `buildTodayRow` and leave a `// TODO: extract shared due-pill builder` comment for a future cleanup pass.
      - Inline JS style assignments on the existing Today rows (set during the aggregation entry) must be removed if they conflict with the new CSS — inline styles override stylesheets in this codebase and have been a recurring source of bugs.
      - The four-builder consolidation refactor on the roadmap remains separate; don't pull it into this entry. Only `buildTodayRow` is in scope.
      - `main.js` is over 25k tokens; grep for `buildTodayRow` (or the Today-row creation block from the aggregation entry) and the existing project-row builder before reading, with offset/limit pagination.
    - Out of scope: making the due pill interactive on the Today view (clicking the chevron should not yet open the date popover — the pill remains display-only in this entry; interactivity is a follow-up entry); a description-toggle control on Today rows; an X close/remove control on Today rows; the four-builder consolidation refactor.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-13

## Features

- [ ] **[MEDIUM]** Add Calendar view shell with month grid and right-side day detail panel
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
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
