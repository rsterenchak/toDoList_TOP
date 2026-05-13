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

- [x] **[MEDIUM]** Relocate view-switch pills to top bar and remove sidebar PROJECTS label
  - Description: Move the TODAY/PROJECTS pill bar from its current centered position in the main panel header row up into the top bar, anchored to the left immediately right of the hamburger icon. Remove the all-caps "PROJECTS" label that currently sits at the top of the sidebar so the project list begins directly at the sidebar's top padding. Together these align the layout with the chosen Today dashboard mockup and resolve the vertical asymmetry between the sidebar (which no longer has a header) and the main panel (which previously did).
    - Behavior:
      1. Top bar layout becomes: hamburger icon (far left) → small gap → TODAY pill → PROJECTS pill → flexible spacer → existing right-side icon cluster (pomodoro, stats, ghost). Pills keep their active/inactive styling, click behavior, and view-persistence wiring from the shell entry.
      2. The previous pill container in the main panel header row is removed. EXPAND ALL stays where it is (right-aligned, only rendered on PROJECTS view).
      3. The sidebar's "PROJECTS" all-caps header label is removed entirely. The project list now begins at the sidebar's existing top padding; the + button at the sidebar's bottom is unchanged.
      4. On TODAY view, the main panel's first visible element is now the date header — no header row sits above it, since EXPAND ALL is PROJECTS-only.
    - Implementation notes:
      - On narrow / mobile widths, the top bar may not have room for hamburger + two pills + three right-side icons. Start with the simplest fix: compress pill padding via a `<600px` breakpoint. If that's still tight, fall back to hiding pill text behind a small dropdown. Pill text needs to stay at `font-size: 16px+` to avoid iOS auto-zoom regardless of which approach is taken.
      - The pill bar was created in `main.js` in the shell entry; if any inline styles were applied there (background, border, layout), they need to be updated in `main.js` directly — CSS-only changes will be overridden.
      - `main.js` is over 25k tokens; grep for the pill bar creation block from the shell entry and the existing top-bar render block before reading, with offset/limit pagination.
    - Out of scope: any change to pill visuals (color, shape, animation) beyond position; the sidebar's + button placement or styling; the right-side icon cluster; any change to EXPAND ALL.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-13

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
