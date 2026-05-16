# TODO List

## Bugs

- [ ] **[LOW]** Hide IDLE bottom-sheet nub on mobile and remove redundant project overflow button
  - Description: Two pieces of redundant mobile chrome surfaced after the Dense redesign. First, `#bottomSheetNub` (the 56×4px IDLE-state handle bar inside a 96×44 tap target) renders just above the bottom tab bar — its position calc `bottom: calc(var(--mobile-tab-h) + var(--foot-h) + env(safe-area-inset-bottom))` correctly stacks it above the tabs by spec, but visually it reads as a stray gray decoration floating above the tab bar with nothing to anchor it. The tab bar is the visual bottom-of-screen anchor on mobile, the swipe-up zone (`.sheetSwipeZone`) provides the gesture path, and the PEEK strip paints its own visible chrome above the tabs when Pomodoro or music is actually active. Hide `#bottomSheetNub` entirely on mobile — IDLE state still functions as the resting state machine value, but no visible chrome paints. Second, `#mobileProjOverflow` (the `⋯` button next to the project name in the mobile header) opens a popover containing Edit, a color-picker strip, and Delete — exactly the same three actions surfaced by the existing `projectMenu.js` long-press context menu on any project row in the sidebar drawer (confirmed in the Help modal's Projects section: "Right-click (long-press on touch) a project row to rename, recolor, or delete it."). Remove the overflow button and its popover.
  - Behavior:
    1. `#bottomSheetNub` gets `display: none` inside the `@media (max-width: 700px)` block. Override the state-driven `#bottomSheet[data-state="IDLE"] #bottomSheetNub { display: flex; }` rule with higher specificity (`#bottomSheet #bottomSheetNub { display: none; }`) so no `!important` is needed.
    2. The state machine still cycles `IDLE → PEEK → EXPANDED` unchanged — `data-state="IDLE"` remains the resting state; only the visible chrome is suppressed.
    3. PEEK strip continues to render above the tab bar when a controller is active. EXPANDED panel continues to render normally. The `.sheetSwipeZone` invisible swipe-up hit zone stays in place.
    4. `#mobileProjOverflow` (and its `mobileProjOverflowPopover` / associated popover element, event listeners, and outside-click handlers) is removed from the `main.js` build path entirely — no DOM element created, no event wiring.
    5. The `.mobileProjTitleRow` flex layout collapses cleanly without the overflow button — the row holds just the project name + `▾` chevron on the left, with nothing on the right.
  - Acceptance criteria:
    - On mobile (≤700px) in IDLE state, no 56×4 gray bar renders anywhere — the space between the last visible todo row and the top of the tab bar is empty.
    - PEEK strip still appears above the tab bar when Pomodoro or music is active.
    - EXPANDED panel still slides up and renders correctly when triggered via the swipe-up gesture, by long-pressing on a row, or programmatically.
    - The `.sheetSwipeZone` continues to intercept bottom-edge swipe-up touches and expand the sheet.
    - The mobile project header row shows only the project name + `▾` chevron on the left — no `⋯` icon, no overflow popover.
    - Long-pressing a project row in the sidebar drawer still opens the `projContextMenu` with Edit / color swatches / Delete — verifying the removed functionality stays reachable.
    - Existing test `stackBottomSheet.test.js > IDLE nub touch target is at least 44px tall` still passes (the button element retains its 44px height in source — only the mobile `display: none` rule hides it; the touch-target contract continues to hold at the desktop breakpoint where the rule doesn't apply).
  - Implementation notes:
    - `main.js` is over 25k tokens — grep for `mobileProjOverflow` to find the button creation, the popover construction, the event handlers, and the popover dismiss wiring. Pull them out together in one pass so no orphan listeners remain.
    - Pure CSS handles the nub hide; no `main.js` changes needed for that half. The button element and listeners stay in source but the element is non-painting on mobile.
    - If a test pins the existence of `#mobileProjOverflow` in the DOM, update it to assert the element is NOT created at any breakpoint after this change.
    - Verify no remaining call sites reference `mobileProjOverflow` after removal (grep across `main.js`, `modals.js`, and any helper files).
  - Out of scope:
    - Repositioning the nub anywhere visible — the design choice here is to drop it on mobile, not relocate it. (Alternative: if Robert wants a visible bottom-edge affordance instead, swap the `display: none` rule for `bottom: env(safe-area-inset-bottom, 0px)` which puts the nub in the home-indicator zone below the tab bar. Not recommended — iOS HIG discourages interactive elements there, and the swipe zone already covers the discoverability gap.)
    - Migrating the `projectMenu.js` long-press context menu functionality — it already covers all the actions the overflow button exposed.
    - Removing the IDLE state from the state machine — it's still meaningful as the resting value, just visually silent on mobile.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`, `toDoList_main/tests/stackBottomSheet.test.js`
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
