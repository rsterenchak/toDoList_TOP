# TODO List

## Bugs

- [x] **[LOW]** Center drawerSettingsButton in both axes within its container
  - Description: The `drawerSettingsButton` (Settings button added in the sidebar Settings-modal entry) currently sits offset within its container div rather than visually centered. Center the button on both axes by making the container `display: flex; justify-content: center; align-items: center` — the button itself needs no changes. If the container also holds the version footer or other sibling elements, scope this layout to a wrapping div that contains only the button instead of applying it to the shared parent. Grep `style.css` for the container's selector first to confirm what else lives in it before changing display mode (a sibling that was previously block-level will get rearranged by the flex switch). Mobile and desktop both.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-05-12

- [x] **[MEDIUM]** Let sidebarBottom size to its content; sidebarTop fills remaining height
  - Description: Replace the current proportional split between `#sidebarTop` and `#sidebarBottom` with a content-sized bottom and a flex-fill top. After moving VIEW and APPEARANCE behind the Settings modal, `#sidebarBottom` only contains `#drawerSettingsBtnWrap` (one button) and `#drawerFooter` (version label) — roughly 80–100px of actual content. A fixed percentage was reserving disproportionate empty space below the version footer. Set `#sidebarBottom: flex: 0 0 auto` (or omit a flex-basis entirely so it sizes to its children) and `#sidebarTop: flex: 1; min-height: 0` so it expands to fill all remaining vertical space inside `#sideBar`. The `min-height: 0` is required so `#sidebarTop`'s flex child `#sideMa` can still shrink and engage internal scrolling when projects overflow — without it, the flex-fill `#sidebarTop` won't allow its scrollable child to shrink. The existing `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` padding on `#sideBar` continues to apply unchanged. Self-adjusting: if rows are added or removed from `#sidebarBottom` later (e.g., adding a help link or moving the footer), no proportions need updating. Mobile breakpoint only — inside the existing `@media (max-width: 700px)` block.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-05-12

- [x] **[LOW]** Center empty-state ghost, welcome text, and new project button vertically on mobile
  - Description: On the empty-state welcome screen (no projects yet), the ghost mascot, "Welcome." label, and "+ New project" button currently sit in the upper third of the viewport, leaving a large unbalanced gap below. Center the whole block at true vertical 50% of the available area (viewport minus the fixed footer), so the content reads as deliberately placed rather than top-anchored. Scope is empty-state only — once a project exists and `addInitialToDo` runs, the regular layout takes over and should be untouched. Implementation likely lives in the empty-state container's CSS in `style.css` (flex column with `justify-content: center` against a height that excludes the footer, or equivalent); confirm no inline style writes in `main.js` are overriding the centering, since inline styles win on specificity.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
  - Completed: 2026-05-12

## Features

- [ ] **[MEDIUM]** Aggregate overdue/today/upcoming todos and render sections on Today dashboard
  - Description: Replace the placeholder empty state on the Today view with a real cross-project aggregation: a count summary line, three sections (OVERDUE / TODAY / UPCOMING), and task rows with checkbox, title, project pill, and due-date tag. Aggregation logic lives in `listLogic.js` as a single helper returning `{ overdue, today, upcoming, counts }`; rendering and event wiring stay in `main.js`.
    - Behavior:
      1. Aggregate non-completed todos across all projects, bucketing by due date relative to start of today (local timezone): `overdue` (due < today), `today` (due === today), `upcoming` (due within next 7 days, exclusive of today). Todos with no due date are excluded from the Today view. Todos more than 7 days out are excluded.
      2. Count summary line sits directly below the date header: `● {overdueCount} overdue · ● {todayCount} today · {upcomingCount} upcoming`. Overdue count in coral (`#d85a30`), today count in purple (`#9D93EE`), upcoming in muted text. When a count is zero, render its segment in muted text but keep the segment for layout stability.
      3. Render sections in order: OVERDUE, TODAY, UPCOMING. Each has a purple all-caps header label and a list of task rows. Sections with zero items are skipped entirely (no header, no empty placeholder). Within each section, sort by due date (earliest first), tiebreaker title alphabetical.
      4. Each task row shows: completion checkbox, todo title, project pill (project name, purple-on-dark, non-interactive in this entry), and a right-aligned due-date tag. Due-date tag format: `TODAY` for items in the today bucket, short month-day (e.g. `MAY 10`) for everything else. Color: coral for overdue, purple for today, muted for upcoming.
      5. Clicking the checkbox toggles completion via the existing complete-toggle path in `listLogic.js`, then re-renders the aggregation. Clicking the row title switches the active view to PROJECTS, selects the parent project (sets `.selectedProject`), and scrolls to that todo row.
      6. The existing empty state ("No items due yet — add a todo from any project to see it here") shows only when all three buckets are empty.
    - Implementation notes:
      - Aggregation goes through `listLogic.js` per the data-model-routing principle. Export a single `getTodayAggregation()` helper; `main.js` consumes it. Don't duplicate the bucketing logic in `main.js`.
      - Compare dates against start-of-today computed as `new Date().setHours(0,0,0,0)` to avoid timezone drift between stored due-date strings and the comparison.
      - The Today task row shares checkbox, project pill, and due-tag styling with the projects view where possible. Worth introducing a shared `buildTodayRow(item)` builder rather than copy-pasting from the existing todo-row builders — and small enough not to require the larger four-builder refactor on the horizon.
      - `main.js` is over 25k tokens; grep for the Today view render block from the shell entry and for the existing complete-toggle wiring before reading. Use offset/limit pagination.
    - Acceptance criteria:
      - Unit tests in `tests/listLogic.test.js` for `getTodayAggregation()` covering: empty input, only overdue, only today, only upcoming, mixed buckets, completed items excluded, items with no due date excluded, items beyond 7 days excluded, and the timezone-edge case of a due date set to midnight today.
      - Completing a todo from the Today view also reflects in its parent project's view when the user switches.
    - Out of scope: recurring-task interaction with the Today view (a recurring task that just completed should re-spawn its next instance — separate concern); editing due dates from the Today view (tag is display-only); a "focus on this task" entry point on each row; collapsible sections; a "completed today" count or section; clickable project pills; performance optimization for very large todo counts.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
