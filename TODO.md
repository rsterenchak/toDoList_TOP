# TODO List

## Bugs

- [ ] **[HIGH]** Re-select the active project when switching back to PROJECTS so #mobileProjHeader clears its data-empty flag
  - Description: On mobile, switching TODAY → PROJECTS (or CALENDAR → PROJECTS) leaves `#mobileProjHeader` hidden with `display: none`. The cause is NOT a stale `#mainBar[data-view]` — that attribute is now correctly written symmetrically by `applyActiveView()` for all three views (pinned by tests in `tests/mobileTabBarSync.test.js`). The actual culprit is a different hiding rule: `#mobileProjHeader[data-empty="true"] { display: none }`. When `applyActiveView('today')` or `applyActiveView('calendar')` runs, it removes the `.selectedProject` class from the sidebar row (see lines around 4805-4824 in `main.js`). The `footObserver` MutationObserver picks this up, fires `updateFooterCounts()`, which calls `updateMobileProjHeader('', 0, 0)`. With no active name, the function sets `mobileProjHeader.setAttribute('data-empty', 'true')`. When the user then taps the PROJECTS pill or mobile tab, `applyActiveView('projects')` runs — but it never re-adds `.selectedProject` to any row. No mutation fires on `sideMain`, so `updateFooterCounts()` is not re-invoked, and `data-empty="true"` stays stuck. The CSS rule keeps firing and the header stays hidden until the user manually clicks a project row in the sidebar.
  - Behavior:
    1. When `applyActiveView('projects')` runs, restore the previously-active sidebar selection so the `.selectedProject` class is re-added to a row. Easiest source of truth: the last project clicked, or — as a fallback — the last project in `listLogic.listProjectsArray()` (matches the `restoreFromStorage` boot-time default at line 4720). The re-selection triggers the existing observer pipeline, which clears `data-empty` and re-paints the header.
    2. Alternative if re-selection is undesirable: in `applyActiveView('projects')`, directly call (or schedule via setTimeout 0) the existing `updateFooterCounts()` pipeline so the header's `data-empty` attribute is recomputed against the current sidebar state. Re-selection is the cleaner fix because it also restores the sidebar visual.
  - Acceptance criteria:
    - Initial load → header visible (already works).
    - Tap TODAY → header hidden (already works).
    - Tap PROJECTS → header visible again with the previously-active project name (currently broken).
    - Tap CALENDAR → header hidden (already works).
    - Tap PROJECTS → header visible again with the previously-active project name (currently broken).
    - The restored selection should be the most recent project the user actively chose; on first switch-back after boot, fall back to the project that `restoreFromStorage` auto-selected (array tail).
  - Implementation notes:
    - `main.js` is over 25k tokens — grep for `selectedProject`, `applyActiveView`, and `updateMobileProjHeader` to find the relevant edit sites.
    - Track the last-active project name in a module-scope variable (or read it from the sidebar before the TODAY/CALENDAR switch wipes it). Restore it as the selected row when `safe === 'projects'`.
    - Existing tests pin: `clears any .selectedProject when switching to TODAY` (`tests/todayDashboardView.test.js:164`). Adding a re-select on switch-back to PROJECTS doesn't conflict — the TODAY clear-on-entry still runs.
    - Add a regression test that asserts the round-trip PROJECTS → TODAY → PROJECTS restores `.selectedProject` to a sidebar row.
  - Out of scope:
    - The `#mainBar[data-view]` write itself — that part is correct and pinned by tests.
    - The CSS hiding rules (`[data-view="today"] #mobileProjHeader { display: none }` and `[data-empty="true"] { display: none }`) — both are correct in intent.
    - Adjusting the mutation observer's filter or scope — the observer is fine; the problem is no class change happens to drive it on return-to-projects.
  - File: `toDoList_main/src/main.js`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)

- [x] **[HIGH]** Restore #mainBar[data-view] write on the return trip to Projects so #mobileProjHeader re-paints — Completed: 2026-05-16
  - Description: On mobile, `#mobileProjHeader` paints correctly on initial load with the Projects tab active, but disappears after tapping the TODAY or CALENDAR tab and then tapping back to PROJECTS. The header element stays built (DOM children intact) but `getComputedStyle(...).display` returns `none`. The hiding rules in `style.css` are correct in intent: `#mainBar[data-view="today"] #mobileProjHeader { display: none }` and `#mainBar[data-view="calendar"] #mobileProjHeader { display: none }`. The bug is in `applyActiveView()` — the function writes `mainBar.dataset.view = 'today'` (or `'calendar'`) on the outbound trip but doesn't write `mainBar.dataset.view = 'projects'` on the return. The attribute stays stuck on the last non-Projects value, the CSS rule keeps firing, and the header stays hidden. Confirmed by the diagnostic flow: initial load shows `#mobileProjHeader` at 390×100 dimensions; after TODAY → PROJECTS round-trip, computed display is `none` even though the active-tab class and the visible content area both indicate Projects is active.
  - Behavior:
    1. Find `applyActiveView()` in `main.js`. Verify the `mainBar.dataset.view = viewKey` (or `setAttribute('data-view', viewKey)`) write is unconditional — it runs on EVERY call, regardless of `viewKey` value. The current bug pattern is likely either an `if (viewKey !== 'projects')` early branch, a switch statement missing the `'projects'` case, or a guard that only writes the attribute when transitioning AWAY from Projects.
    2. After the fix, every call to `applyActiveView('projects')` results in `#mainBar` having `data-view="projects"` regardless of what the attribute was before.
    3. Same fix covers any other future view value — the write is symmetric across all three tabs (and any future tabs).
  - Acceptance criteria:
    - Fresh load → Projects tab active → `document.getElementById('mainBar').getAttribute('data-view')` returns `"projects"`, `#mobileProjHeader` visible.
    - Tap TODAY → `data-view="today"`, `#mobileProjHeader` hidden, `#todayView` content shown.
    - Tap PROJECTS → `data-view="projects"`, `#mobileProjHeader` visible again, `#mainList` content shown.
    - Tap CALENDAR → `data-view="calendar"`, `#mobileProjHeader` hidden, `#calendarView` content shown.
    - Tap PROJECTS → `data-view="projects"`, `#mobileProjHeader` visible again.
    - Tap rapidly between all three tabs in any order — the attribute always tracks the active tab; the header always paints when (and only when) Projects is active.
    - The desktop view-switch pill cluster (when visible at ≥701px) stays in sync the same way.
  - Implementation notes:
    - `main.js` is over 25k tokens — grep for `applyActiveView`, `mainBar.dataset`, and `setAttribute('data-view'` to find the function body and every write site.
    - The fix is one line in the most common case: ensure the `mainBar.dataset.view = viewKey` assignment lives unconditionally at the top of the function body, before any view-specific branching. If the current code has it inside an `if/else` branch, move it out.
    - Also verify there are no OTHER writers to `mainBar.dataset.view` outside of `applyActiveView` — if there are, they should be removed or refactored to go through the function.
    - Add a test assertion in a new `tests/mobileTabBarSync.test.js` (or extend an existing test) that pins: the function `applyActiveView` exists, contains an unconditional write to `mainBar.dataset.view` or `mainBar.setAttribute('data-view', …)`, and the write uses the `viewKey` parameter (not a hardcoded value).
  - Out of scope:
    - The hiding CSS rules — they're correct, don't touch them.
    - Renaming `data-view` or `applyActiveView` — the names are fine.
    - The bottom-sheet nub `!important` rule and the EXPANDED panel `display: none` fix — both handled in their own entries.
    - Investigating whether other elements (`#bulkDescActions`, `#mainList`) are also affected by stale `data-view` — they're listed in the same selector, so they get fixed together, but verifying them is just a side-effect of the acceptance criteria above.
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
