# TODO List

## Bugs

- [x] **[HIGH]** Respect iOS safe-area-inset-top on STACK mobile welcome and project header
  - Description: On iPhone with notch / Dynamic Island, the iOS status bar (time, signal, battery) is overlapping the top of the mobile UI — both the welcome empty state's ghost mascot area and the project header's `PROJECT N OF M` label region. The `viewport-fit=cover` meta is set and `env(safe-area-inset-top)` is being used in `#outerContainer`'s grid track and `#navBar`'s padding, but the welcome state (which has `#navBar` hidden after the previous corrective entry) and the project header aren't getting that inset. When `#navBar` is `display: none` on mobile, the safe-area-inset-top reservation needs to move to whichever element is now the topmost — `#mobileProjHeader` for projects-loaded screens, and the empty-state container for the welcome screen. Two fixes: (1) `#mobileProjHeader { padding-top: calc(env(safe-area-inset-top, 0px) + 14px) }` and adjust the absolute-positioned `#sidebarToggle` inside it to `top: calc(env(safe-area-inset-top, 0px) + 8px)`. (2) On the welcome empty state (`#emptyState.emptyStateNoProjects`), add `padding-top: calc(env(safe-area-inset-top, 0px) + 48px)` so the ghost mascot doesn't tuck under the status bar / Dynamic Island. The hamburger on the welcome screen also needs to shift down by the same inset since it's the only top-bar control there.
  - Acceptance criteria:
    - On a notched iPhone (15 Pro, X-series, etc.), the iOS status bar never overlaps `PROJECT N OF M` or the project name
    - On the welcome empty state, the ghost mascot starts below the Dynamic Island / status bar with comfortable breathing room (≥24px gap)
    - The hamburger toggle on both screens sits below the status bar, never tucked behind it
    - On non-notched devices and browser DevTools at iPhone SE sizes, the layout is unchanged (the env() value resolves to 0)
    - Status bar style continues to use the existing `apple-mobile-web-app-status-bar-style: black-translucent` so the OS chrome blends with the app's dark theme
  - Implementation notes:
    - `#outerContainer` already allocates `calc(var(--nav-h) + env(safe-area-inset-top))` for the nav row — with `#navBar` now `display: none` on mobile, that track collapses, freeing the space. The inset needs to be re-applied to whatever sits at the top of the visible viewport instead
    - For the welcome state, the `#emptyState.emptyStateNoProjects` block currently uses `padding: 48px 16px 40px` on mobile — bump the top padding to absorb the inset
    - For the project-loaded state, the `#mobileProjHeader { padding: 14px 16px 10px }` becomes `padding: calc(env(safe-area-inset-top, 0px) + 14px) 16px 10px`
    - The hamburger's absolute position inside `#mobileProjHeader` was set to `top: calc(env(safe-area-inset-top, 0px) + 8px)` in the previous entry — verify it landed, since the screenshot shows it sitting flush at the very top edge of the viewport
  - Out of scope: home-indicator (bottom) safe area on the footer; landscape orientation behavior
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
     
- [x] **[HIGH]** Suppress iOS native text-selection on long-press of project rows
  - Description: On iOS, long-pressing a project row in the mobile drawer fires *both* the iOS native text-selection gesture (showing the blue selection handles + `Edit` callout bar with copy/lookup) *and* the app's custom project context menu (color swatches + Delete). The two stack on top of each other, the native selection visible underneath the custom menu. The app's `attachProjectContextMenu` in `projectRow.js` wires a 500ms touch long-press timer that calls `showProjectContextMenu`, but doesn't prevent the iOS default selection gesture from firing on the same long-press. Fix is to add CSS `user-select: none` and `-webkit-user-select: none` to `#projChild` and its descendant `#projInput` at the ≤700px breakpoint (or globally — desktop right-click for context menu doesn't need text selection either), plus `-webkit-touch-callout: none` to suppress the iOS callout bar entirely. The `touch-action: manipulation` rule already exists for `#projChild` in the mobile media query but doesn't cover selection. Verify the rename flow still works after this fix — when a user activates Edit from the context menu, the `#projInput` needs to become editable (the existing `Edit` handler sets `pointer-events: auto; cursor: text` and focuses it); confirm that focusing the input automatically re-enables text editing in iOS despite the user-select: none on the parent.
  - Acceptance criteria:
    - Long-press on a project row in the mobile drawer shows ONLY the app's custom context menu (color swatches + Edit / Delete) — no iOS blue selection handles, no `Edit / Copy / Look Up` callout bar
    - Rename flow still works: tap `Edit` in the context menu → input becomes editable, soft keyboard appears, user can type and commit
    - Long-press on a todo row (which has its own context menu / swipe behavior in a future entry) is unaffected by this change — todos use a different selector
    - Desktop right-click on a project row still opens the custom context menu without any text-selection artifacts
  - Implementation notes:
    - Add to `#projChild` in style.css: `user-select: none; -webkit-user-select: none; -webkit-touch-callout: none`
    - `#projInput` inherits user-select from its parent; need to explicitly override when it becomes editable. The existing `Edit` handler in `projectRow.js` sets `pointer-events: auto; cursor: text` — also set `user-select: auto; -webkit-user-select: auto` at the same time
    - Re-lock the input after rename commit (the existing `keydown` handler on `Enter` sets `pointer-events: none; cursor: default` — also re-set `user-select: none`)
    - `-webkit-touch-callout: none` is the key rule — it's the iOS-specific property that suppresses the long-press callout bar, separate from selection
  - Out of scope: same fix for todo rows (separate entry needed if/when todo long-press lands); changing the long-press timeout
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/projectRow.js`
  - Completed: 2026-05-11
     
- [ ] **[MEDIUM]** Hide hamburger toggle when mobile drawer is open
  - Description: When the mobile drawer is open, the hamburger toggle is rendering *inside* the drawer's top-right corner (image 3) where the drawer's own X close button should be the only dismiss affordance. The hamburger is positioned absolutely within `#mobileProjHeader` (per the recent corrective entry that moved it from `#navBar`), but the drawer slides over `#mobileProjHeader` and the hamburger paints on top of the drawer's surface — making it look like a control inside the drawer rather than the one outside it that opened the drawer. The result is two controls in the same corner: the hamburger and the X close button stacked. Fix is to hide `#sidebarToggle` whenever the drawer is open, using a CSS sibling selector or a class on the body / html. Cleanest approach: when `#sideBar.sidebar-open` is present, hide `#sidebarToggle` via `body:has(#sideBar.sidebar-open) #sidebarToggle { display: none }` at the ≤700px breakpoint. The X close button inside the drawer takes over dismissal, along with the existing Escape and backdrop tap paths.
  - Acceptance criteria:
    - Mobile drawer closed: hamburger visible at the top-right of `#mobileProjHeader`, tap opens the drawer
    - Mobile drawer open: hamburger hidden entirely, only the X close button inside the drawer is visible at the top-right
    - Closing the drawer (via X, backdrop, Escape) restores the hamburger
    - Desktop layout (701px+) is unchanged — desktop sidebar is a persistent rail/full pane, not a drawer
    - The transition between drawer open / closed doesn't visually flash the hamburger (a brief opacity transition or `display: none` swap is fine)
  - Implementation notes:
    - Add `body:has(#sideBar.sidebar-open) #sidebarToggle { display: none }` inside the existing `@media (max-width: 700px)` block
    - Alternatively, set a class on `<html>` or `<body>` when the drawer opens (in the existing `openSidebar` / `closeSidebar` functions in main.js) and key the CSS off that — slightly more compatible with older browsers, but `:has()` is now widely supported
    - The X close button (`#mobileSidebarClose`) is positioned absolutely inside `#sideTit` at `top: 8px; right: 8px` and is hidden on desktop — verify it remains the sole top-right control inside the open drawer
    - No JS changes needed if going the `:has()` route
  - Out of scope: animating the hamburger → X transformation; changing the drawer's slide-in direction; adding a swipe-to-close gesture
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
