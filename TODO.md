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

- [ ] **[MEDIUM]** Auto-collapse projects sidebar when TODAY view is active
  - Description: When the active view is TODAY, the projects sidebar feels out of place — narrow, near-empty, and contextually disconnected from the dashboard content. Auto-collapse the sidebar whenever TODAY becomes active, and auto-expand it when PROJECTS becomes active. The hamburger button continues to work as a manual override within the current view (the user can open the sidebar while on TODAY if they want), but switching views resets to the new view's default. This reuses the existing sidebar toggle path rather than introducing new inline styles.
    - Behavior:
      1. On view-switch to TODAY: call the existing sidebar-close function (the same path the hamburger uses).
      2. On view-switch to PROJECTS: call the existing sidebar-open function. Existing project list, selection state, and `.selectedProject` class behavior must remain intact.
      3. Within a view, the hamburger continues to toggle the sidebar as today. A user can open the sidebar on TODAY manually; switching views resets to the new view's default.
      4. On initial page load in `restoreFromStorage()`, apply the active view's default sidebar state — if persisted `todoapp_active_view` is `"today"`, start with the sidebar collapsed.
    - Implementation notes:
      - Reuse the existing sidebar toggle function rather than writing new inline style assignments — inline styles in `main.js` override CSS and tend to leak into other behaviors.
      - The existing "don't auto-close sidebar on desktop when a project is selected" rule (touch-only via `pointer: coarse`) is unrelated and must continue to work.
      - `main.js` is over 25k tokens; grep for the existing hamburger handler / sidebar toggle function and the view-switch handler from the previous entry, with offset/limit pagination.
    - Out of scope: any change to the sidebar's content or styling; mobile behavior (sidebar is already hidden on mobile by default — this entry is desktop-focused).
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
