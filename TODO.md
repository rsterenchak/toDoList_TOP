# TODO List

## Bugs

- [x] **[MEDIUM]** Fix EXPANDED bottom-sheet panel bleed-through at bottom of mobile viewport
  - Description: On mobile (≤700px), the EXPANDED bottom-sheet panel (`#bottomSheetExpanded` — the purple-bordered dialog housing Pomodoro + music controls) remains partially visible at the bottom edge of the viewport even when the sheet is in IDLE or PEEK state. Its top border (1px solid `var(--accent)`), `.sheetDragHandle` glyph, and first section header ("POMODORO") peek out below the tab bar. The console confirms `data-state="IDLE"` and neither controller is active, so this isn't a stuck-state bug — the panel is genuinely being painted off-screen but iOS Safari isn't clipping it against `#outerContainer`'s `overflow: hidden`. Root cause is a known iOS Safari quirk where `transform: translateY(100%)` on an absolutely-positioned child inside a `height: 100dvh` container doesn't fully clip against the container's overflow rectangle — the bottom slice of the translated element leaks past the dvh boundary into the home-indicator zone. Fix by adding `visibility: hidden` to the resting (non-EXPANDED) state with a delayed visibility transition, so the panel doesn't paint at all when off-screen and the slide-down close animation still plays.
  - Behavior:
    1. `#bottomSheetExpanded` in its resting state (no `data-state="EXPANDED"` on the parent) gets `visibility: hidden`. The existing `transform: translateY(100%)` and `bottom: 0; height: min(50dvh, 320px)` rules stay unchanged — the panel still slides physically off-screen; the visibility hide is belt-and-suspenders against the iOS Safari clip-overflow miss.
    2. The transition declaration extends to two properties: `transition: transform 0.22s ease, visibility 0s linear 0.22s`. The `0s linear 0.22s` means visibility flips to `hidden` AFTER the 0.22s slide-down finishes, so the close animation still plays in full.
    3. When `#bottomSheet[data-state="EXPANDED"]` is set, the existing rule that toggles `transform: translateY(0)` also sets `visibility: visible`, and the visibility transition delay drops to `0s` so the panel is paintable from the first frame of the slide-up.
  - Acceptance criteria:
    - In IDLE state on mobile, no part of `#bottomSheetExpanded` is visible anywhere in the viewport — no purple border line, no `.sheetDragHandle` glyph, no "POMODORO" header text peeking out at the bottom edge or in the home-indicator zone.
    - In PEEK state on mobile, same as IDLE — only the PEEK strip itself (above the tab bar) is visible; the EXPANDED panel is fully hidden.
    - In EXPANDED state on mobile, the panel renders normally with its slide-up animation intact, full controls visible, and the backdrop dimming the page above it.
    - Closing the sheet (drag-down past 30%, Escape key, backdrop tap) still plays the full 0.22s slide-down animation — the panel doesn't disappear instantly, it animates away.
    - Verified on iOS Safari (the platform where the bleed-through reproduces) AND on a desktop browser narrowed to ≤700px to confirm the fix is cross-engine.
  - Implementation notes:
    - Pure CSS — no `main.js` changes. Edit the two existing rules for `#bottomSheetExpanded` inside the `@media (max-width: 700px)` block.
    - The two-property transition value matters: separate `transform` and `visibility` declarations, each with their own duration and delay. Don't collapse them into a single `transition: all`.
    - Don't switch to `display: none` for the hidden state — that kills the slide-down animation entirely (the element is removed from the layout tree before transitioning).
    - Don't switch to `opacity: 0` alone — opacity doesn't prevent paint or hit-testing, so the off-screen panel could still steal taps from the tab bar or the underlying footer.
    - `pointer-events: none` is already implied by the off-screen position but is harmless to add explicitly to the resting state as additional defense.
  - Out of scope:
    - `#viewSwitcher { display: none }` mobile rule — already in `style.css`; the earlier UI showing pills was a stale-cache issue resolved by hard-refresh.
    - Surfacing the Pomodoro / music controllers on `window` for easier debugging (the diagnostic returned `undefined` because the controllers are module-scoped, which is correct — `data-state` is the canonical source of truth for sheet state).
    - The IDLE-state purple bar + handle visible above the tab bar — that's the `#bottomSheetNub` rendering at its expected position; it's not a bug, just the IDLE affordance.
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/stackBottomSheet.test.js`
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
