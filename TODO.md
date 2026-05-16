# TODO List

## Bugs

- [x] **[HIGH]** Sync #mainBar data-view with the active mobile tab so #mobileProjHeader paints on Projects view
  - Description: On mobile, `#mobileProjHeader` (hamburger + project name + count pills) doesn't render even though the element is built correctly and all three children are appended. The console probe confirmed `exists: true`, `display: none`, `children: 3`. The hiding rules are these two top-level (not media-scoped) selectors in `style.css`: `#mainBar[data-view="today"] #mobileProjHeader { display: none; }` and `#mainBar[data-view="calendar"] #mobileProjHeader { display: none; }`. Their intent is correct — the project header is meaningless on Today and Calendar views since those aggregate across all projects. The bug is that `#mainBar[data-view]` is stuck on `"today"` or `"calendar"` even when the Projects tab is active in the bottom tab bar. `applyActiveView()` (or its initial-mount path) updates the `.mobileTab.active` class but doesn't write `mainBar.dataset.view = viewKey` in lockstep, so the visual active-tab state and the CSS routing attribute drift apart on first load.
  - Behavior:
    1. `applyActiveView(viewKey)` is the single code path that toggles the active view across mobile tabs AND desktop view-switch pills AND the `#mainBar[data-view]` attribute. Confirm it sets all three on every call, including the initial mount.
    2. Specifically, every code path that ends in changing the active view writes `mainBar.dataset.view = viewKey` (or equivalent `setAttribute('data-view', viewKey)`) BEFORE the tab class toggles, so layout reflows in one frame.
    3. Initial mount path: when the app first builds the DOM, `#mainBar` defaults to `data-view="projects"` (set at element creation in `main.js`, not deferred to the first `applyActiveView` call). If `applyActiveView('projects')` is called explicitly during init, that's fine too — the goal is no window where `data-view` is unset or holds a stale value.
  - Acceptance criteria:
    - On fresh page load with the Projects tab active, `document.getElementById('mainBar').getAttribute('data-view')` returns `"projects"`.
    - With the Projects tab active, `getComputedStyle(document.getElementById('mobileProjHeader')).display` returns a non-`"none"` value (whatever the mobile-block declaration sets — likely `flex` or `grid`).
    - Tapping the TODAY mobile tab sets `data-view="today"`, hides `#mobileProjHeader`, and shows `#todayView` content. Tapping CALENDAR does the same with `"calendar"` and `#calendarView`. Tapping back to PROJECTS restores `data-view="projects"` and `#mobileProjHeader` paints again.
    - Desktop pill switcher (when visible) stays in sync with `#mainBar[data-view]` the same way.
    - The hiding rules `#mainBar[data-view="today"] #mobileProjHeader { display: none }` and `#mainBar[data-view="calendar"] #mobileProjHeader { display: none }` stay in source — they're correctly suppressing the header on aggregate views.
  - Implementation notes:
    - `main.js` is over 25k tokens — grep for `applyActiveView`, `mainBar.dataset`, `setAttribute('data-view'`, and `dataset.view` to find every write site. There should be exactly one canonical writer (inside `applyActiveView`) and one initial-mount setter.
    - The element creation site for `#mainBar` is the right place to set `data-view="projects"` as the default — `const mainBar = document.createElement('section'); mainBar.id = 'mainBar'; mainBar.dataset.view = 'projects';`
    - If `applyActiveView` is the only writer and it's not being called on mount, calling it explicitly at the end of the DOM build for the Projects view is the fix.
    - Add a test assertion in `tests/main.js` or a new `mobileTabBarSync.test.js` pinning that the `#mainBar[data-view]` write happens inside the `applyActiveView` function body, and that the element is created with `dataset.view = 'projects'` at the DOM build site.
  - Out of scope:
    - The hiding rules themselves — leave them as-is; the intent of hiding the per-project header on Today/Calendar is correct.
    - Renaming `data-view` to something else for clarity — the attribute name is fine.
    - The bottom-sheet nub `!important` rule and the EXPANDED panel bleed-through — both handled in their own entries.
  - File: `toDoList_main/src/main.js`, `toDoList_main/tests/mobileTabBarSync.test.js`
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
