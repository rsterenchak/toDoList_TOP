# TODO List

## Bugs

- [ ] **[MEDIUM]** Pin sideTit and addProj while sideMa scrolls when projects overflow
  - Description: With the centering fix in place, creating enough projects causes `#sideMa` to grow tall and push `#sideTit` upward out of the upper-half zone (back behind the iOS status bar) and pushes `#addProj` down into the bottom settings area. Restructure `#sidebarTop` so the header and add-project button are always pinned at the top and bottom of the zone respectively, and only the projects list scrolls between them. Implementation: keep `#sidebarTop` as `display: flex; flex-direction: column` and continue using `justify-content: center` so the group still appears centered when projects fit naturally. Set `#sideTit` and `#addProj` to `flex-shrink: 0` so they never collapse. Set `#sideMa` to `min-height: 0; overflow-y: auto` — the `min-height: 0` is essential, without it the flex child won't shrink below its content size and internal scrolling won't engage. Add a thin custom-styled scrollbar matching existing scrollbars in the app (e.g., the todo list panel — grep for `::-webkit-scrollbar` in `style.css`). Add a subtle bottom-edge fade (linear-gradient overlay or `mask-image`) inside `#sideMa` to hint at more content when the list overflows; top edge doesn't need a fade since `#sideTit` is opaque above it. Centering behavior preserves: when content fits, the empty space splits above and below the group; when it overflows, the scroll wrapper fills the available height and scrolls internally. Mobile breakpoint only.
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Replace inline VIEW and APPEARANCE sections with a single Settings modal
  - Description: The sidebar currently renders the four toggle rows (Show completed, Expand all descriptions, Dark theme, Companion ghost) inline under always-visible VIEW and APPEARANCE headers, eating roughly 200px of vertical space. Replace this with a single "Settings" button at the bottom of the sidebar (above the version footer) that opens a modal containing all four toggles, grouped under the same VIEW and APPEARANCE sub-headers for clarity. Each toggle preserves its existing label, on/off state, persistence key, and click handler — only the rendering location changes. The version footer (`V1.1 · N PROJECTS`) stays visible in the sidebar (do not move it into the modal). Modal must close three ways per `CLAUDE.md`: explicit close (X) button, backdrop click, and Escape key — follow the existing modal pattern in `modals.js` / the changelog modal for structure. Mobile and desktop both — desktop sidebar benefits from the space recovery too. Implementation notes: the Settings button itself uses the existing button styling already present in the sidebar (e.g., the add-project button as a reference for visual weight, but with a label not just an icon). Grep `main.js` for the current VIEW/APPEARANCE wiring (likely near `sidebar` or section-header creation) using offset/limit — `main.js` is over 25k tokens, never read it whole. Out of scope: rearranging or renaming individual toggles, or adding new settings.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/modals.js`
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
