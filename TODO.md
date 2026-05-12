# TODO List

## Bugs

- [x] **[MEDIUM]** Center sidebar projects block in the upper half of the sidebar on mobile
  - Description: On mobile, the sidebar's top section (PROJECTS header, close button, project list, add-project button) currently pins to the top edge directly below the iOS safe-area inset, leaving a large empty void before the VIEW/APPEARANCE settings block at the bottom. Reposition the top section so its bottom edge anchors to the sidebar's vertical midpoint, with the block extending upward from there based on project count — short lists hover near the midpoint, long lists fill upward and eventually scroll as before. Implementation: make the sidebar root `display: flex; flex-direction: column` and split into two children — a top half sized `flex: 0 0 50%` containing the projects section with `justify-content: flex-end` so its content bottom-aligns against the midpoint, and a bottom half (`flex: 0 0 50%`) holding the settings/version block, content top-aligned naturally. The previously-added `env(safe-area-inset-top)` padding still applies and is measured from above the new top half (additive, not replaced). Scope to the mobile breakpoint only — desktop sidebar is a docked panel and shouldn't shift. Implementation note: this should be a `style.css`-only change if `#sideTit` and the settings container already share a common flex parent inside `#sideBar`; if they don't, a thin wrapper element in `main.js` may be needed (grep `appendSidebar` / `#sideBar` creation in `main.js` to verify structure before touching). Remember `main.js` is over 25k tokens — search with grep + offset/limit, never read it whole.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[LOW]** Center empty-state ghost, welcome text, and new project button vertically on mobile
  - Description: On the empty-state welcome screen (no projects yet), the ghost mascot, "Welcome." label, and "+ New project" button currently sit in the upper third of the viewport, leaving a large unbalanced gap below. Center the whole block at true vertical 50% of the available area (viewport minus the fixed footer), so the content reads as deliberately placed rather than top-anchored. Scope is empty-state only — once a project exists and `addInitialToDo` runs, the regular layout takes over and should be untouched. Implementation likely lives in the empty-state container's CSS in `style.css` (flex column with `justify-content: center` against a height that excludes the footer, or equivalent); confirm no inline style writes in `main.js` are overriding the centering, since inline styles win on specificity.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

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
