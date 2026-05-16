# TODO List

## Bugs

- [ ] **[HIGH]** Restore sidebar project selection when switching back to Projects view so #mobileProjHeader re-paints
  - Description: On mobile, tapping TODAY (or CALENDAR) and then tapping PROJECTS leaves `#mobileProjHeader` hidden — `data-view` is correctly `"projects"`, but `data-empty="true"` is set on the header element, and a CSS rule `#mobileProjHeader[data-empty="true"] { display: none }` hides it. Root cause is in `applyActiveView()`: the `'today'` branch explicitly clears `.selectedProject` from every sidebar row (per the existing comment: *"Today owns the main panel — the sidebar selection only makes sense once PROJECTS is active again"*). When `updateMobileProjHeader()` fires off the mutation observer with no active project name, it sets `data-empty="true"` on the header. The `'projects'` return trip flips `data-view` but never re-applies `.selectedProject` to the previously-active sidebar row, so `data-empty` stays `"true"` and the header stays hidden. Fix by either (a) NOT clearing `.selectedProject` on TODAY/CALENDAR transitions in the first place — the selection is cosmetic to the hidden sidebar so persisting it is harmless — or (b) re-applying the selection on the `'projects'` return trip by reading the active project from `getActiveProject()` (or whatever persistence helper exists) and finding the matching sidebar row. Option (a) is simpler and addresses the root cause.
  - Behavior:
    1. Remove the `.selectedProject` clearing block from the `'today'` branch (and `'calendar'` if it has one) inside `applyActiveView()`. The selection class persists across view switches.
    2. On TODAY/CALENDAR views the sidebar is hidden anyway, so the lingering `.selectedProject` class on a non-visible row has zero visual effect.
    3. When the user taps PROJECTS, `data-view="projects"` un-hides the sidebar AND the header simultaneously. Because `.selectedProject` was never cleared, `updateMobileProjHeader` reads a valid active project name on its next mutation observer fire and removes `data-empty="true"`.
    4. The `refreshTodayDateHeader()` call stays — that part of the `'today'` branch is fine; only the `.selectedProject` clearing comes out.
  - Acceptance criteria:
    - On mobile, tapping TODAY → tapping PROJECTS leaves `#mobileProjHeader` visible with the correct project name, count pills, and chevrons.
    - `document.getElementById('mobileProjHeader').getAttribute('data-empty')` returns `null` (or no value) after the round-trip, NOT `"true"`.
    - Tapping CALENDAR → tapping PROJECTS does the same.
    - Tapping back-and-forth rapidly between all three tabs doesn't lose the header.
    - The sidebar's project rows still show the active project highlighted (purple left accent) when PROJECTS is active — the `.selectedProject` class is now persistent, but only visible on the PROJECTS view because the sidebar itself is hidden on TODAY/CALENDAR.
    - Switching to a different project (via long-press → Edit, or via the sidebar drawer) still correctly transfers `.selectedProject` to the new row — the change is "stop clearing on view switch," not "freeze selection forever."
    - The existing test `applyActiveView clears any .selectedProject when switching to TODAY` (in `tests/todayDashboardView.test.js`) flips polarity — it should now assert that `.selectedProject` is NOT cleared. Update that assertion in the same commit.
  - Implementation notes:
    - `main.js`: grep for the line inside `applyActiveView()` that does `querySelector('.selectedProject')` followed by `classList.remove('selectedProject')`
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
