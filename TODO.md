# TODO List

## Bugs

- [ ] **[MEDIUM]** Move hamburger toggle to top-right of mobile project header, hide navBar on mobile
  - Description: In the STACK prototype, the hamburger menu toggle sits at the top-right of the viewport, vertically aligned with the `PROJECT N OF M` label — not in a separate nav bar above the project header. The current build keeps `#sidebarToggle` in its desktop position inside `#navBar` (top-left of a dedicated 44px nav row), which adds an unnecessary chrome band above the project header and pushes the entire mobile layout down by `var(--nav-h) + env(safe-area-inset-top)`. Move the hamburger to the top-right of `#mobileProjHeader` and hide `#navBar` entirely at the ≤700px breakpoint. The mobile project header already uses `padding: 14px 16px 10px` and has `#mobileProjLabel` at the top — the hamburger should anchor to the top-right of that same row, sitting at the same vertical baseline as the label. Implementation can either (a) position `#sidebarToggle` absolutely within `#mobileProjHeader` at the breakpoint via `position: absolute; top: env(safe-area-inset-top, 0) + 10px; right: 16px`, or (b) restructure the header to use a two-row grid where row 1 is `[label | hamburger]` and row 2 is the name + stats. Option (a) preserves the existing DOM (hamburger stays in `#navBar`) and is purely a CSS move, but requires `#mobileProjHeader` to have `position: relative` and enough top padding to clear the absolute child. Option (b) is more semantic but requires the hamburger to be re-parented in main.js, which complicates the desktop fallback. Recommend option (a) — single-file CSS change, no main.js touched. With `#navBar { display: none }` at ≤700px, the project header becomes the topmost element and the safe-area-inset-top moves to `#mobileProjHeader` instead.
  - Behavior:
    1. Below 701px, `#navBar` is `display: none` — its 44px chrome band disappears entirely
    2. `#sidebarToggle` repositions to the top-right of `#mobileProjHeader` via absolute positioning, sitting at the same vertical baseline as `#mobileProjLabel`
    3. `#mobileProjHeader` absorbs the safe-area-inset-top padding that previously lived on `#navBar`, so iOS notch / Dynamic Island clearance is preserved
    4. The project name (`#mobileProjName`) and stats (`#mobileProjStats`) sit below the label+hamburger row with the existing 6px column gap
    5. Above 701px, the hamburger returns to its desktop position inside `#navBar` and `#mobileProjHeader` is hidden — desktop layout is unchanged
  - Acceptance criteria:
    - Hamburger sits at the top-right of the viewport at the ≤700px breakpoint, on the same horizontal line as `PROJECT N OF M`
    - No 44px empty band above the project header
    - Hamburger remains a ≥44×44 hit target (the existing `width: 36px; height: 36px` is below the touch standard — increase to 44×44 on mobile via the breakpoint override, or add invisible padding)
    - iOS safe-area-inset-top is respected — on a notched device the hamburger doesn't tuck behind the Dynamic Island
    - Tapping the hamburger still opens the drawer; X / backdrop / Escape close it as before
    - Desktop layout (701px+) is unchanged
  - Implementation notes:
    - `#sidebarToggle` already exists in `#navBar` — keep it there, just reposition it absolutely at the breakpoint
    - `#mobileProjHeader` needs `position: relative` and top padding bumped to accommodate the absolute child: roughly `padding: calc(env(safe-area-inset-top, 0px) + 14px) 16px 10px`
    - `#sidebarToggle` at ≤700px: `position: absolute; top: calc(env(safe-area-inset-top, 0px) + 8px); right: 12px; width: 44px; height: 44px; z-index: 2`
    - `#navBar` at ≤700px: `display: none`
    - `#mobileProjHeader` and `#mobileProjStats` already use `padding-top: 14px` and the label sits at the top — the hamburger's `top: calc(env(...) + 8px)` should land it ~2px above the label baseline for visual centering with the small mono label text
    - `#outerContainer`'s grid at the breakpoint currently allocates `calc(var(--nav-h) + env(safe-area-inset-top))` for the nav row — with the nav hidden, that track collapses naturally since the nav is `display: none`, but verify the grid doesn't reserve the space anyway (`#outerContainer { grid-template-rows: calc(var(--nav-h) + env(safe-area-inset-top)) minmax(0, 1fr) calc(var(--foot-h) + env(safe-area-inset-bottom)) }` will still hold the slot empty). Fix by overriding to `grid-template-rows: 0 minmax(0, 1fr) calc(var(--foot-h) + env(safe-area-inset-bottom))` at the breakpoint, or by collapsing the nav row entirely via `grid-template-rows: auto minmax(0, 1fr) auto`
  - Out of scope: bottom sheet that re-mounts pomodoro + music (entry 2); hamburger long-press menu; redesigning the project header's two-row layout to put the hamburger on its own row
  - File: `toDoList_main/src/style.css`
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
