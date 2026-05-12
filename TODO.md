# TODO List

## Bugs

- [x] **[MEDIUM]** Replace mobile project page dots with swipe-on-title gesture
  - Description: On the ≤700px breakpoint, replace the row of tappable page dots (`#mobileProjDots`) in the mobile project header with a swipe-on-title gesture. Render small `‹` and `›` chevrons flanking `#mobileProjName` as visual affordances for the gesture; tapping a chevron switches to the prev/next project, and a horizontal swipe on the title row does the same. Use the project order from `listLogic.listProjectsArray()` to resolve the target project, then route through the same selection path the existing dot click uses (find the matching `#projChild` and call `.click()`) so accent + render + addAllToDo_DOM all run unchanged. Hard-stop at the ends (no wrap-around) with a small rubber-band CSS translate so the user feels the boundary. Gesture lives on the title row only — don't extend the swipe target to the main content area below, since row swipe-to-delete already owns horizontal gestures there. Fire `navigator.vibrate(10)` on each successful switch to match the haptic pattern already used in `wireCheckbox`. Drop `#mobileProjDots` entirely (both the DOM node in `main.js` and its CSS rules in `style.css`); the chevrons + "PROJECT N OF M" label together replace the position indicator. Desktop is unaffected — the mobile header is already display:none above the breakpoint. Implement the swipe via the existing `touchstart`/`touchmove`/`touchend` pattern (CLAUDE.md: HTML5 drag must be paired with touch handlers, same principle here) with a horizontal-dominant threshold around 40px to commit; movement below that snaps back. Investigate `updateMobileProjHeader` in `main.js` with grep + offset/limit — that function rebuilds the header every observer tick and is where the dot row currently renders.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-12

- [x] **[MEDIUM]** Fix mobile top chrome hugging the device edge in browser tabs
  - Description: On the ≤700px breakpoint, the hamburger button (`#sidebarToggle`) and the project header (`#mobileProjHeader`) sit too close to the top of the viewport in any context where `env(safe-area-inset-top)` reports `0` — i.e. regular browser tabs on iOS Safari / Chrome and any non-notched device. The current rules use `calc(env(safe-area-inset-top, 0px) + Npx)`, which collapses to just the `Npx` floor when the inset is zero, so the status bar / URL bar visually clashes with the app chrome. Fix by wrapping the inset in `max()` with a sensible floor so there's always breathing room: `top: calc(max(env(safe-area-inset-top, 0px), 24px) + 8px)` for `#sidebarToggle` and `padding-top: calc(max(env(safe-area-inset-top, 0px), 24px) + 14px)` for `#mobileProjHeader`. Apply the same `max()` floor to `#emptyState.emptyStateNoProjects`'s top padding so the welcome ghost doesn't ride the top edge either. Notched standalone-PWA devices still expand to the real inset; everywhere else gets the 24px guarantee.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-05-12

- [ ] **[MEDIUM]** Add swipe-up gesture to open bottom menu on mobile
  - Description: The bottom menu (footer labeled "TASK MANAGEMENT V1.1") currently opens only via tap on its handle. Add a swipe-up gesture as an alternative trigger — wire `touchstart`/`touchmove`/`touchend` on the handle and a thin hit zone along the bottom edge, track the Y delta during the move, and open the menu once an upward swipe crosses a threshold (~40px distance or a short upward velocity). While the menu is open, the reverse gesture (swipe-down) should close it. Apply only on touch devices (`pointer: coarse` matchMedia check) so desktop pointer behavior is unaffected, and reuse the existing handle as the gesture origin rather than adding new visual chrome. Consider translating the menu with the finger during the drag so the gesture feels physical, then snap open/closed based on final position; this is `main.js` gesture-wiring territory (grep for existing swipe handlers and mirror that pattern).
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[LOW]** Hide per-row delete button on mobile in favor of swipe-left
  - Description: At the ≤700px breakpoint, the per-row `×` delete button on each todo row is redundant — the existing swipe-left-to-delete gesture (with the 5s UNDO toast) already covers destructive removal and is the expected mobile pattern. Hide `#closeButtonToDo` inside the existing `@media (max-width: 700px)` block in `style.css` so the row's right cluster reads as just the due pill + expand caret on mobile, while desktop keeps the button untouched. The swipe handler in `attachToDoDrag` already calls `listLogic.removeToDoByItem` directly and only falls back to `btn.click()` when it can't resolve the item, so hiding the button doesn't break the swipe path. Worth eyeballing the row's right padding (currently `0 8px 0 4px`) after the change — with the X gone, `#descToggle` becomes the rightmost child and may sit a touch close to the edge.
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
