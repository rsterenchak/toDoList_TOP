# TODO List

## Bugs

- [x] **[MEDIUM]** Fix ArrowDown from sidebarToggle landing on first todo instead of first project
  - Description: Pressing ArrowDown while focused on `sidebarToggle` moves focus to the first todo row in the main panel instead of the first project (`projChild`) in the sidebar. Expected behavior is the spatial inverse of the existing ArrowUp transition (top project → sidebarToggle): from sidebarToggle, ArrowDown should focus the first `projChild` in the sidebar, since the sidebar sits directly below the toggle. Likely cause is the ArrowDown handler on `sidebarToggle` either targeting the wrong element (querying the todo list rather than the project list) or being absent entirely so default Tab-style focus order takes over and lands on the first focusable element after the toggle in DOM order.
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-05-10

## Features

- [x] **[MEDIUM]** Implement STACK mobile layout with project-as-header and menu drawer
  - Description: Replace the current mobile drawer-only layout with a "STACK" pattern where the project name renders as the screen header (large two-line title) with `PROJECT N OF M` label above and tappable page dots on the stats line; horizontal swipe-between-projects is dropped in favor of single-tap dots. The hamburger top-right opens a slide-in menu drawer (~78% width from right) containing the Projects list with active highlighting + "+ Add project", a View section (Show completed, Expand all descriptions, Sort By chip group), an Appearance section (Dark theme toggle, Companion ghost toggle), and a footer with version + project count. Empty states get retuned for STACK: NO PROJECTS centers a big purple ghost mascot + "Welcome." + filled "+ New project" CTA pill (theme toggle is the only surviving control), NO TODOS YET keeps the project header but accents the dashed input row and shows a muted gray ghost with a dotted up-arrow pointing to the input, ALL CAUGHT UP shows a green-tinted ghost + sparkles + faded "Done today" list of completed tasks (only when Show completed is on). Applies at the existing `≤700px` breakpoint.
  - Behavior:
    1. Project header renders as two-line title with `PROJECT N OF M` label above; stats line has open/done counts left, tappable page dots right
    2. Single tap on any non-active page dot jumps directly to that project; no swipe gesture between projects
    3. Hamburger toggles the drawer; X, backdrop tap, Escape, or hamburger again close it
    4. Selecting a project from the drawer updates the active state but keeps the drawer open (deliberate — supports browse-and-decide)
    5. "+ Add project" creates a new project, marks it active, focuses the input synchronously in the same tick (matches existing emptyStateCreateBtnMobile pattern for iOS soft keyboard)
  - Implementation notes:
    - Reuse existing `:has()` pulse animation on the project add affordance — the drawer's "+ Add project" inherits the same selector since the DOM still contains `#projButton`
    - Existing right-click project context menu (rename/delete) needs a long-press equivalent (~500ms) on touch per CLAUDE.md
    - `main.js` is over 25k tokens — navigate with grep + offset/limit
    - Light theme should work for free via existing token swap; spot-check empty states only
    - `wireDateInputs`, `addInitialToDo`, `regenToDos`, `addToDos_restore`, and `appendNewToDoRow` stay structurally unchanged — STACK is a CSS + DOM-shell rewrite at the breakpoint
  - Acceptance criteria:
    - Drawer closes 3 ways: X, backdrop, Escape (CLAUDE.md modal rule)
    - Page dots have ≥44×44 hit area despite smaller visible dots
    - Stats counts update reactively when tasks complete or get added
    - Empty states render correctly across project counts of 0, 1, and many
    - Project context menu has long-press equivalent on touch devices
  - Out of scope: drag-to-reorder visual feedback on touch (separate entry); music station picker (entry 2); task interaction patterns (entry 3)
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/emptyState.js`
  - Completed: 2026-05-10
  - Notes: Foundational STACK structure shipped — mobile project header (`PROJECT N OF M` label, name, open/done counts, tappable page dots), three-way drawer close vocabulary (X button, backdrop, Escape), and project-row long-press were all delivered. Visual-polish pieces and the drawer reorganization were broken out into the follow-up entries below so they can be designed and reviewed independently.

- [x] **[MEDIUM]** Reorganize mobile drawer into Projects / View / Appearance sections from right
  - Description: Convert the current mobile sidebar drawer (slides in from the LEFT, contains Projects + "+ Add project") into the STACK menu drawer described in the original STACK task: ~78% viewport width, slides in from the RIGHT, sections in order — Projects (with active highlight + "+ Add project"), View (Show completed, Expand all descriptions, Sort By chip group), Appearance (Dark theme toggle, Companion ghost toggle), footer (version label + project count). Selecting a project from the drawer keeps it open (browse-and-decide). The View / Appearance controls already exist elsewhere (settings menu, completed-section caret, bulk desc toggle, theme toggle, companion toggle) — this task wires mobile mirrors of them inside the drawer rather than introducing new state.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-10
  - Notes: Sort By chip group deferred — no underlying sort state exists yet, and the task scope explicitly forbade introducing new state. Filed below as a separate entry to track once a sort backing is added.

- [ ] **[LOW]** Add Sort By chip group to STACK mobile drawer View section
  - Description: The STACK mobile drawer reorganization (Projects/View/Appearance) intentionally shipped without the Sort By chip group from the original STACK spec because no underlying sort state existed yet — wiring a chip group would have introduced new persisted state, contradicting the parent task's "rather than introducing new state" rule. Once a sort feature exists for the project's todo list (e.g., manual / due date / created), add a chip group inside the drawer's View section between "Show completed" and "Expand all descriptions" that mirrors the same state. Use the existing `.drawerToggleRow` styling pattern as a reference; chips should be ≥44px tall for mobile hit targets.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

- [x] **[MEDIUM]** Restyle STACK mobile empty states with ghost mascots
  - Description: Three retuned empty-state variants for the STACK mobile layout. NO PROJECTS centers a big purple ghost mascot SVG + "Welcome." + filled "+ New project" CTA pill (theme toggle is the only surviving control on this screen). NO TODOS YET keeps the project header above the empty state and accents the dashed `+ Add a task…` input row, with a muted gray ghost mascot and a dotted up-arrow pointing at the input. ALL CAUGHT UP shows a green-tinted ghost mascot + sparkles + a faded "Done today" list of completed tasks (only when Show completed is on). Applies at the existing `≤700px` breakpoint. Ghost mascot SVGs commit to `toDoList_main/src/` per CLAUDE.md (no icon libraries).
  - File: `toDoList_main/src/emptyState.js`, `toDoList_main/src/style.css`, plus new ghost mascot SVGs in `toDoList_main/src/`
  - Completed: 2026-05-10

- [x] **[MEDIUM]** Add bottom sheet utility surface for Pomodoro and music on mobile
  - Description: Add a bottom-anchored utility surface for the STACK mobile layout that houses the Pomodoro timer and the YouTube music player across three states: IDLE (12px collapsed handle nub at the bottom edge, still tappable to expand), PEEK (48px strip when timer or music is running, with a 3px drag handle, timer status with green dot + `MM:SS` on the left, divider, music status with `♪` + station name + animated CSS visualizer bars on the right, and an expand chevron `⌃` on the far right), and EXPANDED (sheet at ~50% viewport height with a faint `--accent` top edge, dimmed backdrop over STACK content above, drag handle pill, POMODORO section with big `MM:SS` + Reset / Pause·Start / Skip controls, MUSIC section with now-playing card and a `›` chevron opening an inline station picker drilldown that swaps the sheet content). The 240×135 YouTube iframe stays hidden in the DOM by default with audio-only role; a "Show video" toggle inside the picker reveals it inline above the station list.
  - Behavior:
    1. IDLE → PEEK on timer start or music play; if both active, peek shows both segments side by side
    2. PEEK → IDLE: when timer hits 00:00 and music is paused, peek auto-collapses after a 3s grace window so the user sees the completion state briefly
    3. PEEK or IDLE → EXPANDED: tap or drag-up on handle/strip
    4. EXPANDED dismiss: backdrop tap, drag-down past 30%, Escape — returns to whichever lower state applies (PEEK if utilities running, IDLE otherwise)
    5. Drawer-open state hides the sheet entirely (drawer overlays everything)
    6. NO PROJECTS empty state hides the sheet entirely; NO TODOS YET and ALL CAUGHT UP keep it visible
  - Implementation notes:
    - Reuses existing `pomodoro.js` and `music.js` modules — no logic changes, only mount controls inside the sheet's expanded layout
    - Existing `todoapp_music_state` localStorage key drives rehydration on mount
    - Existing Pomodoro pause/resume coordination with music carries over unchanged
    - CSS visualizer bars need explicit parent height — `.peek-music .bars` must have a fixed height (e.g., 12px) for inner bar heights to compute (this was the documented prior failure mode)
    - Mobile custom-URL input in station picker needs `font-size: 16px+` to avoid iOS Safari zoom
    - iOS Safari `100dvh` quirks: cap sheet height at `min(50dvh, 320px)`
    - Sheet uses `position: absolute` inside `#outerContainer`, not `position: fixed`, to respect existing overflow rules
    - Inline station picker drilldown is a view-swap within the same sheet (not a stacked second sheet); a back chevron returns to the controls view
  - Acceptance criteria:
    - Sheet closes 3 ways: backdrop, drag-down, Escape (CLAUDE.md modal rule)
    - IDLE nub remains tappable (touch target ≥44px including invisible padding)
    - Peek strip layout doesn't shift when one utility starts or stops while the other stays running
    - Station picker `Show video` toggle reveals/hides the iframe without restarting playback
    - Backdrop tap on the picker drilldown returns to controls view, not all the way to dismiss
  - Out of scope: Pomodoro session config (interval lengths, sound) — uses existing defaults; lock-screen / notification-center integration; PiP video for music
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-10

- [ ] **[MEDIUM]** Add mobile task interactions: inline-expand creation, tap-to-view, swipe complete and delete
  - Description: Implement mobile-specific task interactions on the STACK layout. Task creation expands inline from the existing dashed `+ Add a task…` row into an active input (purple stroke, animated cursor) with a chip row underneath (Today / Tomorrow / calendar-icon / `+ ¶` description toggle); pressing return commits the task, slides it in with a 700ms fading purple-left-edge accent, refocuses the empty input with placeholder "Type the next…", and persists the date chip selection across the session (resets on project switch or app launch). Description toggle expands the input vertically with an internal divider; tapping again collapses (text preserved). Existing collapsed task rows stay title-only — no subtitle line — with a small `¶` glyph next to the date pill on tasks that have a non-empty description. Tapping any row enters read mode (description sibling appears below, visually merged with shared accent border, no keyboard summoned); tapping the title or description text within an expanded row enters edit mode (cursor + keyboard, auto-save on blur). Swipe-right past 50% commits Complete (green panel + check icon, toggles between completed and incomplete); swipe-left past 50% commits Delete (red panel + trash icon, fires `removeToDoByTitle`, slides a 5s undo toast above the peek strip with a purple UNDO button). Only one row can be in swipe state at a time.
  - Behavior:
    1. Tap dashed `+ Add a task…` row → active input + chip row; return commits and chains
    2. Date chip default: Today, persists across chained entries, resets on project switch / app launch
    3. Description toggle does NOT persist across chained entries — each new task starts with description collapsed
    4. Tap-outside-empty input dismisses + collapses to dashed; tap-outside-with-text drops keyboard but keeps input expanded
    5. Tap collapsed existing task → expands to read mode (no keyboard)
    6. Tap title or description text within an expanded row → focuses field, summons keyboard
    7. Tap outside focused field → auto-save on blur; tap outside expanded row entirely → collapses back to row-only
    8. Swipe-right past 50% on release → commit complete; before 50% → snap back
    9. Swipe-left past 50% on release → commit delete + undo toast; before 50% → snap back
    10. Swipe-right on already-completed row → uncomplete (toggle); swipe-left → delete
    11. Swipe on a currently-expanded row: collapse first, swipe applies to next gesture (avoids destructive mid-edit action)
    12. Undo toast: 5s persistence, restores via existing position-aware insert; dismisses on UNDO tap or 5s timeout
  - Implementation notes:
    - All data mutations route through `listLogic.js` — `removeToDoByTitle` for delete, equivalent toggle helper for complete
    - Reuses existing `descSibling` element and `descToggle` logic — purely a CSS change on mobile to merge them visually with the parent row (shared border, attached background)
    - The `¶` indicator on collapsed rows lives in the date-pill area; render only when `desc` is non-empty
    - Date chip persistence stored in a session-scoped variable, NOT localStorage (deliberate — "Today" should not survive reload)
    - All mobile inputs (title, description textarea, custom-URL field) need `font-size: 16px+` per existing `!important` pattern in style.css
    - Auto-save on blur — wire `blur` listeners on title input and description textarea; commit via `listLogic` on each blur if value changed
    - Swipe action panel colors: green = `--type-feature` (`#9ad0a8`), red = `--type-bug` (`#e48a96`) — no new tokens
    - 50% threshold = `Math.abs(deltaX) > rowBoundingRect.width * 0.5` measured at touchend, not viewport (row width can differ from screen)
    - Single-swipe-at-a-time: track active row via a class like `.swiping`; new touchstart on a different row resets the prior to rest
    - `dragDrop.js` `TOUCH_ARM_MS` axis discrimination already handles vertical-vs-horizontal — extend `cfg.swipe.onRight` and `cfg.swipe.onLeft` callbacks for complete/delete
    - Undo toast anchors to bottom edge of `#mainList`, slides up above the peek strip via `transform: translateY()` over ~200ms; auto-dismisses with fade after 5s
  - Acceptance criteria:
    - Chained entry: typing "buy milk" + return + "buy bread" + return commits both tasks in order with the persisted date
    - Swipe-right on incomplete row marks complete; second swipe-right unmarks (toggle is reversible)
    - Swipe-left on a row shows the undo toast; tapping UNDO restores the row at its original position using the original `pos` value
    - Tap-to-expand on a description-having row shows the description without summoning the keyboard
    - Multiple expanded rows render correctly (no z-index issues, no broken `descSibling` placement)
    - Vertical long-press still arms reorder (existing `dragDrop` behavior preserved)
    - Right-click context menu has long-press equivalent on touch (CLAUDE.md)
    - Destructive delete has a recovery path via undo toast (CLAUDE.md destructive action rule)
  - Out of scope: drag-to-reorder visual feedback redesign (separate entry); multi-select / bulk operations; haptic feedback; bulk swipe across multiple rows
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`, `toDoList_main/src/dragDrop.js`, `toDoList_main/tests/listLogic.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
