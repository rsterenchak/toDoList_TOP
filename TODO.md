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

- [x] **[MEDIUM]** Add Today dashboard view with view-switch navigation
  - Description: Introduce a new top-level "Today" view as the app's home screen, alongside the existing project view, with a pill-style nav bar at the top of the main panel for switching between them. This entry covers the view-switch infrastructure and the Today shell only — actual aggregation of overdue/today/upcoming items and section rendering will land in a follow-up entry.
    - Behavior:
      1. Render a pill bar near the top of the main panel with two pills: `TODAY` (active by default on first load) and `PROJECTS`. Clicking swaps the main panel content between the new Today view and the existing project view.
      2. Persist the active view across reloads via a `todoapp_active_view` localStorage key (default `"today"`). Read on `restoreFromStorage()`; write whenever the active pill changes.
      3. When TODAY is active, no project should appear selected in the sidebar — clear any `.selectedProject` class on view switch. Clicking a project in the sidebar should automatically switch the active view back to PROJECTS.
      4. The Today shell renders only a date header (e.g. "Tuesday, May 12, 2026") and an empty state below ("No items due yet — add a todo from any project to see it here"). The actual count summary line and overdue/today/upcoming sections come in the follow-up aggregation entry.
    - Implementation notes:
      - On mobile widths, the pill bar sits below the existing header without crowding it. Pills must use `font-size: 16px+` to avoid iOS auto-zoom.
      - `main.js` is over 25k tokens; navigate with grep + offset/limit when locating the top-bar render block.
    - Out of scope: aggregation logic (overdue/today/upcoming filtering + section rendering — separate entry); a CALENDAR pill or view; recurring-task interaction with the Today view.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/index.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
