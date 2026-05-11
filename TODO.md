# TODO List

## Bugs

- [ ] **[MEDIUM]** Reorder NO TODOS YET empty-state on mobile to place input above ghost and up-arrow
  - Description: On the STACK mobile `NO TODOS YET` empty state, the dashed task input should sit at the top of the empty pane with the ghost mascot and dotted up-arrow rendered below it — the arrow points upward at the input as a visual cue ("type up there"). The current build renders the elements in the wrong order: ghost at top, then up-arrow, then `NO TODOS YET` title, then the `New item` input at the bottom — the up-arrow now points at the title rather than at the input it was designed to indicate. Fix is in `emptyState.js` where the block is built and appended: the current order is `[mascot, icon, upArrow, title, sub, input]` (with mascot/upArrow visible only on mobile). For the `emptyStateNoTodos` variant specifically, the mobile DOM should be `[input, mascot, upArrow, title, sub]` so the arrow visually anchors to the input above it. Don't reorder with CSS `flex order` — desktop's `emptyStateNoTodos` block uses the same DOM and the desktop ordering (`[icon, title, sub, input]`) is currently correct. Two options: (a) build the block with the input first when the variant is `emptyStateNoTodos`, then use CSS `order` to push the input back down on desktop to preserve current desktop layout, or (b) detect mobile via `window.matchMedia('(max-width: 700px)')` at build time and conditionally insert the input at the top of the block. Option (a) is cleaner — single DOM, layout-driven swap. The `emptyStateAllCaughtUp` and `emptyStateNoProjects` variants don't have this issue and stay as-is.
  - Behavior:
    1. On mobile `NO TODOS YET`: input renders at the top of the empty pane (immediately below the project header divider), gray ghost mascot below it, dotted up-arrow below the ghost pointing up at the input, then `NO TODOS YET` title and sub
    2. The dashed accent border on the input (added in the previous corrective entry — `border-color: var(--accent); border-style: dashed`) remains
    3. Up-arrow's dotted shaft visually terminates near the bottom edge of the input above it — verify the existing `.emptyStateUpArrow` height (38px) places its tip close enough to the input; bump if needed
    4. Desktop `NO TODOS YET` (701px+) keeps the existing order: title → sub → input at the bottom (current behavior)
    5. `ALL CAUGHT UP` and `NO PROJECTS` variants are unchanged on both mobile and desktop
  - Acceptance criteria:
    - Mobile `NO TODOS YET` renders input → ghost → arrow → title → sub, top to bottom
    - The up-arrow's chevron tip points at the input above it, not at the title below it
    - Desktop `NO TODOS YET` layout is unchanged
    - The empty-state input's focus and Enter-to-commit behavior is unchanged (still delegates to the hidden placeholder row's `#toDoInput`)
  - Implementation notes:
    - In `emptyState.js`, when `done === 0` (the `emptyStateNoTodos` branch), append the input to the block before the mascot rather than at the end
    - On desktop, add `order: 99` to `#emptyState.emptyStateNoTodos #emptyStateInput` so it returns to the bottom of the flex column — desktop's `#emptyState` is `display: flex; flex-direction: column` (from `#mainList.emptyStatePresent`), so `order` works
    - On mobile, the input already has natural source order at the top — no CSS needed at the breakpoint
    - The mascot, up-arrow, and sparkles are `display: none` on desktop anyway (their `display: block` rule lives in the mobile media query), so the desktop layout effectively renders `[title, sub, input]` regardless of where the input sits in source order
  - Out of scope: changing the `ALL CAUGHT UP` or `NO PROJECTS` layouts; redesigning the up-arrow shape; mascot animation
  - File: `toDoList_main/src/emptyState.js`, `toDoList_main/src/style.css`
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
