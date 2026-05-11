# TODO List

## Bugs

- [ ] **[HIGH]** Hide inline-expand date chips and description toggle from desktop placeholder todo row
  - Description: The blank placeholder todo row (the `+ Add a task — press Enter` dashed row at the top of every project's task list) is rendering a chip cluster on its right side: `Today`, `Tomorrow`, a calendar icon, and a `+ ¶` description toggle. These chips are the mobile inline-expand task-creation affordance from the STACK design and should not appear on desktop at all — desktop placeholder rows should look identical to committed todo rows (checkbox / title input / due pill / drag handle / close button), just with the dashed `+ Add a task…` placeholder text and the leading `+` glyph. On mobile, the chips should only render when the user *taps* the placeholder to expand it into the active inline-creation state; the resting placeholder still looks identical to a committed row. Two things to fix: (1) hide the chip cluster on desktop entirely via `@media (min-width: 701px) { .chipCluster { display: none } }` (or whatever selector wraps the Today/Tomorrow/calendar/¶ controls), and (2) gate the chip cluster's rendering on mobile so it only appears when the placeholder row has an `.expanded` or `.active` class — the resting placeholder should look the same as a committed row regardless of viewport. The current state suggests the chips were added unconditionally to the placeholder row template in `toDoRow.js` (likely in `buildToDoRow` when `!item.tit`) without the mobile-only + active-only gating. Verify by grepping `toDoRow.js` for the chip-cluster element creation — it was likely added inside the `if (!item.tit)` branch alongside the `#addGlyph` placeholder cue. The fix is to either (a) remove the chip-cluster creation entirely from the placeholder template and add it dynamically on focus/tap (deferred to a future mobile inline-expand entry), or (b) keep the cluster in the DOM but hide it via CSS in all states except mobile + expanded.
  - Behavior:
    1. On desktop (>700px), placeholder row renders identically to a committed row: `[+ glyph][placeholder input "Add a task — press Enter"][due pill][drag handle][close button]` — no chips, no extra controls
    2. On mobile (≤700px) at rest, placeholder row also renders identically to a committed row — chips hidden until the user taps the input
    3. Chip cluster (`Today`, `Tomorrow`, calendar, `+ ¶`) is currently leaking onto desktop and onto the resting mobile placeholder; both should be eliminated
    4. The cluster's eventual mobile home is the inline-expand state from the STACK design (entry 3 from the original trio: "Add mobile task interactions: inline-expand creation, tap-to-view, swipe complete and delete") — until that entry lands, the cluster should be hidden in all states
  - Acceptance criteria:
    - Desktop placeholder row matches a committed row visually — no chip controls visible
    - Mobile placeholder row at rest also matches a committed row — no chips at rest
    - The placeholder input's existing focus / commit / Enter-to-create behavior is unchanged
    - The leading `+` glyph (`#addGlyph`) remains as the only placeholder-row-specific affordance
    - The placeholder row's `pointer-events` and click handlers are unchanged — first click still focuses the input
  - Implementation notes:
    - `toDoRow.js`'s `buildToDoRow` is the likely culprit — the chip cluster was probably added inside the `if (!item.tit)` branch that already creates `#addGlyph`
    - The cleanest fix is to remove the chip-cluster element creation entirely from the placeholder template, since (a) it's not used on desktop, (b) the mobile inline-expand entry isn't built yet, and (c) leaving dead DOM in the placeholder row risks future divergence. The cluster can be re-introduced as part of entry 3 when the inline-expand state is actually wired up
    - If the cluster element creation is reused by other code paths, gate it with CSS instead: `#toDoChild:has(#addGlyph) .chipCluster { display: none }` (the placeholder is the only row with `#addGlyph`)
    - Check the recent commit history on `toDoRow.js` for the chip-cluster addition — likely landed in the same PR as the previous mobile-layout corrective entry but slipped past review because it only manifests on resting placeholder rows
  - Out of scope: building the mobile inline-expand state (entry 3 from the STACK trio — separate ticket); date-chip persistence across chained entries; description toggle behavior
  - File: `toDoList_main/src/toDoRow.js`, `toDoList_main/src/style.css`
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
