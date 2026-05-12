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

- [x] **[HIGH]** Fix STACK mobile layout — collapse mainTitle dead space, render page dots, hide desktop footer counts
  - Description: The ≤700px STACK breakpoint is still rendering broken after the last corrective PR. Three distinct issues compound into the screenshot's appearance: (1) `#mainTitle` is still allocating its 48px `--row-h` grid track between `#mobileProjLabel` and `#mobileProjName`, producing the large dead band beneath `PROJECT 1 OF 3`; the `grid-template-rows: auto auto 1fr` override on `#mainBar` and `#mainTitle { display: none }` rule from the prior entry either didn't land or got reverted. (2) `#mobileProjDots` is empty despite three projects existing — `updateMobileProjHeader` builds dot buttons unconditionally but they're not visible, suggesting either the parent `#mobileProjStats` is collapsing (no min-height, no items rendering its counts row), or the dot row is being painted outside the viewport. (3) `#footCounts` still renders `0 OPEN 35 DONE` in the footer alongside `TASK MANAGEMENT V1.1`, duplicating the counts that should appear under the project name in `#mobileProjStats`. Fix all three together in a single CSS-only PR: add `#mainBar { grid-template-rows: auto auto 1fr }` and `#mainTitle { display: none }` inside the existing `@media (max-width: 700px)` block, add `#footCounts { display: none }` to the same block, and verify `#mobileProjStats` renders with `min-height: 44px` and its children (`#mobileProjCounts`, `#mobileProjDots`) are visible. Inspect a built dist bundle in DevTools mobile view to confirm the rules actually reach the element — if they're being shadowed by a later specificity match, escalate with `!important` since the existing CSS uses `!important` for the mobile font-size rules with the same justification (inline styles in main.js).
  - Behavior:
    1. `#mobileProjHeader` paints flush at the top of `#mainBar` with no gap above `PROJECT N OF M` and no gap below the project name
    2. `#mobileProjStats` renders the open/done counts on the left and the page dots on the right, each row 44px tall, on the same horizontal line directly under the project name with the standard 14px 16px 10px header padding
    3. Page dots show one dot per project, with the active dot scaled and accent-colored
    4. Footer at the ≤700px breakpoint shows only `TASK MANAGEMENT V1.1` (the version label) — open/done counts are gone from the footer entirely
    5. Desktop above 700px is unchanged: `#mainTitle` shows the breadcrumb + bulk desc toggle, footer shows full counts
  - Acceptance criteria:
    - No vertical gap between `PROJECT 1 OF 3` and `Task Management App` larger than the header's natural 6px gap
    - Three projects → three dots visible in the header stats row
    - Footer at ≤700px shows only the version label, no counts
    - `#bulkDescActions`'s functionality is still reachable on mobile via the drawer's "Expand all descriptions" toggle (the toggle routes through `bulkDescToggleBtn.click()` even with the button `display: none`)
    - Desktop layout regression-tested at 701px+ — breadcrumb still renders, footer counts still render
  - Implementation notes:
    - All changes are inside the existing `@media (max-width: 700px)` block in `style.css` — no JS changes required
    - The drawer's `drawerExpandAll` row already mirrors the bulk desc toggle's `expanded` class state via `getState: function() { return bulkDescToggleBtn.classList.contains('expanded'); }` — verify the button still exists in the DOM (just hidden) so this works
    - `#mainList` already begins below `#mobileProjHeader` in source order under `main2`; collapsing the `#mainTitle` track is the only change needed to bring it flush to the header
    - The previous entry's PR commit history should be reviewed to confirm whether these rules ever landed or got partially reverted — if they're already in the file but not applying, the diagnosis is CSS specificity, not missing rules
  - Out of scope: bottom sheet for pomodoro/music (entry 2 from the original STACK trio); page-dot wrap behavior with 6+ projects (separate audit entry already drafted); empty-state mobile mascot tuning
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-05-11

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
