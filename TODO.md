# TODO List

## Bugs

- [ ] **[MEDIUM]** Redesign mobile UI with Dense layout, bottom tab bar, and Today/Calendar views
  - Description: Replace the current centered-title mobile layout with a compact "Dense" header — hamburger + tappable project name dropdown (▾) + overflow dots in a single row, followed by inline `5 OPEN` / `39 DONE` count pills. Add a persistent bottom tab bar with three destinations: Projects (current paradigm), Today (all tasks due today across projects), and Calendar (month-grid view of tasks by date). Integrate the new tab bar with the existing `#bottomSheet` utility surface so the Pomodoro/music sheet still works — the PEEK strip floats above the tab bar, the EXPANDED sheet covers the tab bar in focus mode, and the IDLE nub stays as a fallback handle when no utility is active. Also fix the top safe-area cut-off where the iOS status bar overlaps the project header.
  - Behavior:
    1. Mobile header (`≤700px`) collapses to a single ~40px row: hamburger left, purple project name with `▾` chevron (opens the existing sidebar / project picker), overflow dots right. The `PROJECT 1 OF 3` label and large centered title with side `<` `>` arrows are removed — the dropdown replaces the carousel pattern.
    2. Beneath the header, render `5 OPEN` and `39 DONE` as small inline pills — open uses `rgba(108,93,245,.15)` fill with `#a799ff` text, done uses a neutral surface fill with muted text.
    3. Bottom tab bar (`#mobileTabBar`) paints at `≤700px` with three tabs: Projects (`ti-list`), Today (`ti-target`), Calendar (`ti-calendar`). Active tab gets a 2px purple top indicator plus bold purple label/icon; inactive tabs are muted. Labels uppercase, 9–10px, 0.3px letter-spacing. Total bar height ~56px including safe-area-inset-bottom.
    4. Today view shows every open todo across all projects whose `due` equals today (local time, not UTC midnight drift), sorted by project then position. Each row uses the same checkbox/title/date affordances as Projects, plus a small project-name chip showing which project the row belongs to. Empty state: a short text message ("Nothing due today") with the existing ghost mascot.
    5. Calendar view shows a month grid (CSS grid, no date library). Each day cell shows the date number plus a small purple count dot if any open todos fall on that day. Tapping a day filters the list rendered below the grid to that day's todos. Month navigation via left/right chevrons in the calendar header.
    6. Sheet coexistence: at `≤700px`, the existing `#bottomSheetNub` (IDLE) and `#bottomSheetPeek` (PEEK) reposition so their `bottom` is `var(--mobile-tab-h, 56px)` instead of `0` — they sit directly above the tab bar. The IDLE nub is preserved as a fallback handle when no utility is active. When `data-state="EXPANDED"`, the sheet's `bottom` stays at `0` so it covers the tab bar entirely (focus mode); on dismiss (drag past 30%, Escape, backdrop tap), both sheet and tab bar return.
    7. The bottom-edge swipe-up zone (`.sheetSwipeZone`) lifts its 16px hit area to sit above the tab bar — otherwise tabs intercept every swipe.
    8. Safe-area fix: the app root container gets `padding-top: env(safe-area-inset-top, 0px)` and `padding-bottom: env(safe-area-inset-bottom, 0px)`. Add `viewport-fit=cover` to the `<meta name="viewport">` in `template.html` if not already present.
  - Acceptance criteria:
    - Mobile (`≤700px`) shows the Dense header, count pills, and bottom tab bar; the previous centered-title + arrows layout no longer renders at this breakpoint.
    - Tapping Projects / Today / Calendar swaps the main content area without a full page reload; the active tab indicator updates.
    - Today view only shows open todos whose `due` equals today in the local timezone; completed items are excluded unless the existing "Show completed" sidebar toggle is on.
    - Calendar count dots match actual todo counts per day; tapping a day filters the list; navigating months keeps the selected day if it exists in the new month, otherwise selects the 1st.
    - With Pomodoro or music active, the PEEK strip is visible directly above the tab bar showing the timer + station readout. Tap on PEEK still expands the sheet.
    - With nothing active, the IDLE nub renders just above the tab bar and can still be tapped or dragged to bring up the sheet.
    - EXPANDED sheet visually covers the tab bar (no tabs peeking through). On dismiss, the tab bar reappears in the same position.
    - On notched iPhones (or any device reporting non-zero `env(safe-area-inset-top)`), the project header sits below the status bar and the tab bar sits above the home indicator; no content is cut off at either edge.
    - Desktop (`>700px`) layout is unchanged — `#mobileTabBar` does not paint, the existing header layout is preserved.
    - All `tests/stackBottomSheet.test.js` assertions that pinned `bottom: 0` for PEEK/IDLE positions are updated to the new `bottom: var(--mobile-tab-h)` math in the same commit; EXPANDED bottom assertion stays at `0`.
  - Implementation notes:
    - `main.js` is over 25k tokens — navigate with grep + offset/limit. Hot spots: the `#bottomSheet` builder + state machine, the project-switcher chevron next to the title, the mobile drawer (`main1.classList.contains('sidebar-open')`), the empty-state branches, and `refreshSheetVisibility`.
    - Today view is a pure read across `listLogic` — add a `getAllTodosDueOn(dateISO)` helper to `listLogic.js` rather than reaching into project state from UI. Pair with `tests/listLogic.test.js` cases covering: midnight boundary, empty result, single-project result, mixed-project result, and that completed items are excluded.
    - Calendar view renders with CSS grid and `Date` math — no new dependency.
    - Tab bar must hide when the mobile drawer is open and when `#emptyState.emptyStateNoProjects` is active, mirroring `refreshSheetVisibility`. Add a sibling `refreshTabBarVisibility` and hook it into the same drawer open/close events.
    - Define `--mobile-tab-h: 56px` as a CSS variable so the PEEK strip's `bottom`, the swipe zone's `bottom`, and the tab bar's `height` all derive from one source.
    - The existing `attachDragGesture` plumbing is untouched — only the resting positions move.
    - No new dependencies (per `CLAUDE.md`) — vanilla JS, CSS, factory-function/module patterns.
    - Any new inputs (e.g., on the Calendar view) must use `font-size: 16px+` to avoid iOS Safari focus-zoom.
    - Keep the dynamic viewport units (`100dvh`) already in use; don't regress to `100vh`.
  - Out of scope:
    - Rendering recurring tasks in Today or Calendar views — the rolling-todo data model lands in a separate entry.
    - Drag-to-reschedule on the Calendar view; for now, rescheduling still happens through the existing due-date popover on each row.
    - Week view, agenda view, or any non-month Calendar layouts.
    - Search as a fourth tab.
    - Per-project filtering inside the Today view (Today is global by design).
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`, `toDoList_main/src/template.html`, `toDoList_main/tests/listLogic.test.js`, `toDoList_main/tests/stackBottomSheet.test.js`
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
