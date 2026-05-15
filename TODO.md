# TODO List

## Bugs

- [x] **[MEDIUM]** Hide top view-switch pills on mobile and lift bottom sheet above the tab bar
  - Description: The Dense mobile redesign left two layout bugs visible at ≤700px. First, the top-bar view-switch pills (`#viewPillProjects`, `#viewPillToday`, `#viewPillCalendar`) render across the iOS status bar / Dynamic Island AND duplicate the navigation already provided by the bottom tab bar — two navigators for the same destinations. Second, the bottom sheet's IDLE nub and PEEK strip render below the tab bar instead of above it, so the sheet's top edge and "POMODORO" label peek out at the very bottom of the viewport with the tab bar slicing across the middle. Fix by hiding `#viewSwitcher` entirely on mobile (the bottom tab bar is the sole mobile navigator; the pills are desktop chrome) and by pinning the sheet's IDLE / PEEK `bottom` to `var(--mobile-tab-h, 56px)` so those states sit directly above the tab bar — EXPANDED keeps `bottom: 0` so the panel still covers the tab bar in focus mode per the agreed sheet-coexistence model.
  - Behavior:
    1. Inside the existing `@media (max-width: 700px)` block in `style.css`, add `#viewSwitcher { display: none }` so the top-bar pill cluster never paints on mobile. Desktop (≥701px) is unchanged.
    2. `#bottomSheet[data-state="IDLE"]` and `#bottomSheet[data-state="PEEK"]` get `bottom: var(--mobile-tab-h, 56px)` on mobile so the nub / strip sits directly above the tab bar.
    3. `#bottomSheet[data-state="EXPANDED"]` keeps `bottom: 0` so the panel still covers the tab bar entirely when the user opens Pomodoro / music — focus-mode behavior per the prior design decision.
    4. The bottom-edge swipe-up gesture zone (`.sheetSwipeZone`) lifts its 16px hit area to `bottom: var(--mobile-tab-h, 56px)` so swiping up from above the tab bar still triggers the sheet without the tabs intercepting it.
  - Acceptance criteria:
    - On mobile, the top-bar pill cluster does not paint anywhere — no clipped pills under the status bar, no redundant top navigator.
    - On desktop (≥701px), the pill cluster paints in its existing `#navBar` position with no regression.
    - With Pomodoro or music active, the PEEK strip is visible directly above the tab bar (purple top edge + drag handle + timer/station row), not below or behind it.
    - With nothing active, the IDLE nub renders just above the tab bar and is tappable / draggable.
    - Tapping the PEEK strip (or dragging it up) expands the sheet; the EXPANDED panel covers the tab bar entirely. Dismissing returns IDLE/PEEK to the position above the tab bar and the tab bar reappears.
    - Nothing renders below the tab bar except the `env(safe-area-inset-bottom)` reservation; the "POMODORO" label is never visible below the tab bar.
  - Implementation notes:
    - Pure CSS — no `main.js` changes expected since sheet states are toggled via `data-state` and positions are CSS-driven. Verify no inline `style.bottom = ...` write on the sheet in `main.js`; if there is one, that's where the override lives and it needs to read from `--mobile-tab-h` too.
    - Confirm `--mobile-tab-h` is already defined as a CSS variable (the Dense redesign introduced it for `#mainList / #todayView / #calendarView` `padding-bottom`). If it isn't, declare it once on `#outerContainer` at the mobile breakpoint and reuse.
    - **Supersedes the earlier "Fix view-switch pills clipping into iOS status bar on mobile" TODO entry** — that entry proposed adding `padding-top` to `#viewSwitcher` to clear the safe area, but hiding the pills on mobile makes that fix unnecessary. Drop that entry when this lands.
    - `tests/stackBottomSheet.test.js` likely pins `bottom: 0` for IDLE/PEEK states; update those assertions to `bottom: var(--mobile-tab-h, 56px)` in the same commit so the suite stays green. EXPANDED's `bottom: 0` assertion stays.
    - Add a new assertion in `tests/mobileNavBarCollapse.test.js` (alongside the existing `#navBar` / `#sidebarToggle` / `#mobileProjHeader` rules) pinning `#viewSwitcher { display: none }` inside the mobile media query so a future refactor can't silently un-hide the pills.
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/stackBottomSheet.test.js`, `toDoList_main/tests/mobileNavBarCollapse.test.js`
  - Completed: 2026-05-15

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
