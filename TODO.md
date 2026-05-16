# TODO List

## Bugs

- [x] **[HIGH]** Force-hide bottom-sheet nub on mobile and restore missing #mobileProjHeader
  - Description: Two regressions from the previous "Hide IDLE nub + remove overflow button" pass that didn't fully land. First, `#bottomSheetNub` (the 56×4 gray bar inside a 96×44 button) is still painting above the bottom tab bar on mobile despite the prior `#bottomSheet #bottomSheetNub { display: none }` rule — something with higher specificity or later source order (the original state-driven `#bottomSheet[data-state="IDLE"] #bottomSheetNub { display: flex }` rule, or an inline `style.display = 'flex'` set in `main.js` during state transitions) is winning the cascade. Use `!important` placed at the end of the mobile media block to settle it definitively. Second, the entire `#mobileProjHeader` no longer paints on mobile — no hamburger, no purple project name + `▾` chevron, no `N OPEN / N DONE` count pills row. The task input row sits flush at the top of the viewport. Root cause needs a console probe to disambiguate three possible failure modes (element not created in JS, element created but hidden by orphaned CSS, or element created but children missing); the fix differs depending on which fails.
  - Behavior:
    1. Add `#bottomSheet #bottomSheetNub { display: none !important; }` placed at the END of the `@media (max-width: 700px)` block in `style.css` so it wins source order against earlier state-driven `display: flex` toggles and against any JS inline style. `!important` is justified because non-`!important` specificity attempts have already failed in two prior passes.
    2. Diagnose the missing `#mobileProjHeader` via console probe before patching:
       - Run `const h = document.getElementById('mobileProjHeader'); console.log('exists:', !!h, 'display:', h && getComputedStyle(h).display, 'children:', h && h.children.length);` in Safari Web Inspector.
       - **If `exists: false`** → the element isn't being created in `main.js`. The previous overflow-button removal pass yanked the wrong code. Restore the `mobileProjHeader.appendChild(...)` calls for `mobileProjLabel`, `mobileProjTitleRow`, `mobileProjCounts`, and the `main2.appendChild(mobileProjHeader)` line. The `⋯` overflow button creation stays removed.
       - **If `exists: true, display: 'none'`** → an orphaned CSS rule is hiding it. Likely a leftover selector from the overflow-button removal pass (e.g., a `.mobileProjOverflow-hidden #mobileProjHeader { display: none }` or similar) or a state class that's now permanently applied. Find and remove the orphan rule from `style.css`.
       - **If `exists: true, display: flex/grid/block` but `children: 0`** → the container element is created and visible, but its children were not appended. Find which child append calls were dropped (look for `mobileProjLabel.appendChild`, `mobileProjTitleRow.appendChild`, `mobileProjCountsOpen.appendChild`, etc.) and restore them.
    3. Once `#mobileProjHeader` paints again, verify all three rows of its Dense layout are intact: hamburger absolute-positioned top-right (`#sidebarToggle`, unchanged), purple project name + `▾` chevron in `#mobileProjTitleRow`, count pills row beneath. No `⋯` overflow button anywhere — that stays removed.
  - Acceptance criteria:
    - On mobile (≤700px), `#bottomSheetNub` does not render in any state — no 56×4 gray bar above the tab bar. Verified via `getComputedStyle(document.getElementById('bottomSheetNub')).display === 'none'` in IDLE, PEEK, and EXPANDED states.
    - PEEK strip still appears above the tab bar when Pomodoro or music is active; EXPANDED panel still slides up correctly.
    - On mobile, the project name "Project ▾", the hamburger top-right, and the `N OPEN / N DONE` count pills row are all visible at the top of the viewport — the input "+ Add a task — press Enter" sits BELOW them, not at the very top.
    - The `⋯` overflow button remains absent (the previous removal sticks).
    - Existing `stackBottomSheet.test.js > IDLE nub touch target is at least 44px tall` still passes — the source `height: 44px` declaration on `#bottomSheetNub` stays; only the `display` is forced off on mobile.
  - Implementation notes:
    - The `!important` rule is the price of admission here — two prior passes attempted plain specificity overrides and both lost. If a future cleanup wants to remove `!important`, it needs to first remove the original state-driven `display: flex/none` toggles for `#bottomSheetNub` inside the mobile block AND audit `main.js` for any inline style writes to `sheetNub.style.display`.
    - `main.js` is over 25k tokens — grep for `mobileProjHeader`, `mobileProjTitleRow`, `mobileProjCountsOpen`, `mobileProjCountsDone`, and `mobileProjLabel` to find the build sites. Compare against the previous commit's diff for the overflow-button removal pass to spot the over-zealous deletion.
    - Also grep `main.js` for `sheetNub.style` and `bottomSheetNub.style` to verify no inline display writes interfere with the `!important` rule. If found, leave them — the `!important` wins anyway, but flag the dead code for a future cleanup pass.
    - Pin both fixes with test assertions: extract the `#bottomSheet #bottomSheetNub` rule from the mobile media block and assert `display: none !important`; assert the existence of `#mobileProjHeader.appendChild(mobileProjTitleRow)` and `main2.appendChild(mobileProjHeader)` in `main.js`.
  - Out of scope:
    - The EXPANDED panel bleed-through (drag handle gray bar between tab bar and footer) — handled by the separate `display: none` for `#bottomSheetExpanded` TODO already in the queue.
    - Reinstating the `⋯` overflow button — it stays gone; long-press on a sidebar project row remains the canonical Edit / color / Delete path.
    - Cleaning up the state-driven `display: flex/none` toggles for `#bottomSheetNub` — that audit is deferred so this entry stays surgical.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`, `toDoList_main/tests/stackBottomSheet.test.js`
  - Completed: 2026-05-16

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
