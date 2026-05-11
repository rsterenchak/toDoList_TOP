# TODO List

## Bugs

- [x] **[LOW]** Reposition NO TODOS YET up-arrow between input and ghost mascot
  - Description: On the STACK mobile `NO TODOS YET` empty state, the dotted up-arrow is currently rendering below the ghost mascot, pointing up at the ghost rather than at the dashed task input above. The previous corrective entry hoisted the input to the top of the empty pane but left the up-arrow's source-order position unchanged, so the runtime DOM reads `input → mascot → upArrow → title → sub`. The arrow needs to sit between the input and the ghost so its chevron tip terminates near the bottom edge of the input — visually anchoring the "type up there" cue to the input it indicates. Fix is in `emptyState.js`: in the `done === 0` branch, append `upArrow` to the block *before* the mascot, so the final mobile DOM order becomes `input → upArrow → mascot → title → sub`. The arrow's existing `.emptyStateUpArrow` height (38px with an 8px gap to its chevron tip) should land cleanly between the input's bottom edge and the ghost's top — verify the visual spacing and bump `margin: 0 auto 4px` if a larger gap is needed for breathing room. Desktop's `NO TODOS YET` keeps its existing layout (the up-arrow is `display: none` on desktop, so source-order changes here don't affect it).
  - Acceptance criteria:
    - On mobile, dotted up-arrow renders directly below the dashed input and directly above the ghost mascot — never below the mascot
    - Arrow's chevron tip points up toward the input's bottom edge with reasonable visual proximity (≤8px gap)
    - Desktop layout is unchanged (up-arrow stays `display: none` above 700px)
    - `ALL CAUGHT UP` and `NO PROJECTS` variants are unchanged
  - Implementation notes:
    - In `emptyState.js`'s `done === 0` branch, move the `block.appendChild(upArrow)` call to immediately follow whatever appends the input (or, given the input is hoisted to the top of the block, place `upArrow` right after the input append and before the mascot)
    - No CSS changes needed — purely a source-order swap
  - Out of scope: redesigning the arrow's visual style; mascot size or position tuning
  - File: `toDoList_main/src/emptyState.js`
  - Completed: 2026-05-11

- [x] **[LOW]** Reorder ALL CAUGHT UP empty-state on mobile to place input above ghost mascot
  - Description: On the STACK mobile `ALL CAUGHT UP` empty state, the new-task input is rendering at the bottom of the empty-state block (below the green ghost, sparkles, title, and sub), but the prototype places the input at the top of the empty pane so the user can keep adding tasks without scrolling past the celebratory mascot. Same pattern as the previous `NO TODOS YET` reorder fix — that entry only touched the `done === 0` branch in `emptyState.js`, leaving the `done > 0` `emptyStateAllCaughtUp` branch with the original append order: `mascot → icon → sparkles → title → sub → input`. Mobile DOM should be `input → mascot → sparkles → title → sub` (no up-arrow on this variant — the celebratory ghost doesn't need a directional cue back to the input). Use the same approach as the previous fix: hoist the input to the top of the block when building, then add `order: 99` to `#emptyState.emptyStateAllCaughtUp #emptyStateInput` on desktop so the input returns to the bottom of the desktop flex column (preserving current desktop layout). The mascot, sparkles, and up-arrow are all `display: none` on desktop, so source-order changes here only affect mobile rendering.
  - Acceptance criteria:
    - On mobile `ALL CAUGHT UP`: input renders at the top of the empty pane (below the project header divider), green ghost + sparkles below it, `ALL CAUGHT UP` title and `N todos completed.` sub below the ghost, then the COMPLETED section as the next mainList child
    - On desktop `ALL CAUGHT UP` (701px+): input stays at the bottom of the block — unchanged from current behavior
    - Input placeholder text remains `New item` on both variants
    - Sparkles' absolute positioning around the mascot still reads correctly (the `.emptyStateSparkles` element uses `transform: translateY(-130px)` to overlay on the mascot — verify this still lands on the ghost after the source-order swap)
  - Implementation notes:
    - In `emptyState.js`, the `done > 0` branch in `updateEmptyState` builds the block with `block.appendChild(mascot)` → `block.appendChild(icon)` → `block.appendChild(sparkles)` → `block.appendChild(title)` → `block.appendChild(sub)` → `block.appendChild(input)`. Move the `input` append to the top of this sequence (or insert before the mascot)
    - Add `#emptyState.emptyStateAllCaughtUp #emptyStateInput { order: 99 }` in the desktop CSS scope (outside the mobile media query, since the parent `#mainList.emptyStatePresent` is `display: flex` on both viewports). The desktop CSS for the input is in the main empty-state block — drop the `order` rule near it
    - Verify the sparkles' `transform: translateY(-130px)` still positions them over the mascot after the swap; if the mascot is now in a different flex position, the offset may need adjustment
  - Out of scope: changing the COMPLETED section's behavior or position; tuning the sparkles' twinkle animation; redesigning the mascot
  - File: `toDoList_main/src/emptyState.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-11

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
