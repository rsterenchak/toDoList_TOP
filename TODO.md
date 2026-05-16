# TODO List

## Bugs

- [x] **[HIGH]** Replace visibility-hide with display-none on EXPANDED sheet to fully suppress drag-handle bleed-through
  - Description: After the previous "visibility: hidden on resting state" TODO landed, the EXPANDED panel's background, border-top, padding, and content text (e.g., "POMODORO" header) are no longer visible at the bottom of the mobile viewport in IDLE/PEEK states — that part of the fix worked. But the `.sheetDragHandle` element inside `#bottomSheetExpanded` is still rendering, appearing as a small ~40×4 gray bar between the bottom tab bar and the `#footBar` "TASK MANAGEMENT V1.1" row. Root cause is that visibility cascades from parent to child but children can override it; `.sheetDragHandle` likely carries an explicit `visibility: visible` (or implicit override via a transform/opacity rule) so it keeps painting even when its parent is hidden. Combined with iOS Safari's loose enforcement of `overflow: hidden` against translated descendants, the handle escapes the clip. Fix by switching from `visibility: hidden` to `display: none` for the resting state — `display: none` removes the element and all descendants from the render tree entirely, so no child can opt back in.
  - Behavior:
    1. `#bottomSheetExpanded` in its resting state (no `data-state="EXPANDED"` on the parent) gets `display: none`. The `visibility: hidden` rule from the previous TODO is removed.
    2. `#bottomSheet[data-state="EXPANDED"] #bottomSheetExpanded` sets `display: flex` (matching the previous resting `display: flex` value that the panel needs for its column layout + drag handle + content stack).
    3. The `transform: translateY(100%)` declaration and its EXPANDED-state override (`transform: translateY(0)`) remain in source for the open animation — the slide-up still plays when the panel transitions to EXPANDED because `display: flex` lets the panel paint before the transform kicks in.
    4. Trade-off: the slide-DOWN close animation no longer plays — the panel disappears instantly on close instead of sliding away over 0.22s. This is acceptable because (a) the bleed-through bug is high-priority correctness, and (b) the close case is brief and not core to the UX. If the close animation matters later, it can be reintroduced via a `transitionend` listener that defers `display: none` until after the slide finishes (out of scope here).
  - Acceptance criteria:
    - In IDLE state on mobile, no part of `#bottomSheetExpanded` renders — no drag handle gray bar visible between tab bar and footer, no purple border-top, no content text peeking out anywhere in the viewport.
    - In PEEK state on mobile, same as IDLE — only the PEEK strip itself paints above the tab bar; nothing from EXPANDED is visible.
    - In EXPANDED state on mobile, the panel renders normally with the slide-UP animation playing (transform animates from `translateY(100%)` to `translateY(0)`), full controls visible, backdrop dimming the page above.
    - Closing the sheet (drag-down past 30%, Escape key, backdrop tap) hides the panel — the close happens without a slide-down animation, which is acceptable.
    - `getComputedStyle(document.getElementById('bottomSheetExpanded')).display` returns `"none"` when `data-state` is `"IDLE"` or `"PEEK"`, and `"flex"` when `data-state` is `"EXPANDED"`.
  - Implementation notes:
    - Pure CSS — no `main.js` changes. Edit the two existing rules for `#bottomSheetExpanded` inside the `@media (max-width: 700px)` block.
    - Remove (don't comment out) the previous `visibility: hidden` + delayed-visibility-transition declarations from the resting state and the EXPANDED state — they're superseded by `display`.
    - Don't keep `visibility: hidden` alongside `display: none` — redundant and adds noise to the cascade.
    - Verify in dev tools on iOS Safari (the original bleed-through platform) that no descendant of `#bottomSheetExpanded` has a computed `display` other than `none` while in IDLE/PEEK states.
    - Update `tests/stackBottomSheet.test.js` if it pins the `visibility: hidden` rule from the previous TODO — swap the assertion to pin `display: none` in resting state and `display: flex` (or whatever value EXPANDED needs) in EXPANDED state.
  - Out of scope:
    - Preserving the slide-DOWN close animation — explicitly traded away for correctness. A `transitionend`-based deferred `display: none` is the future enhancement if the close animation comes up again.
    - The IDLE-state nub hide (separate previous TODO) and the mobile project overflow button removal — both stay as-is.
    - Investigating why `.sheetDragHandle` was overriding visibility — `display: none` makes that irrelevant.
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/stackBottomSheet.test.js`
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
