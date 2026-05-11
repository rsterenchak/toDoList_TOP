# TODO List

## Bugs

- [x] **[HIGH]** Hide pomodoro, music, and ghost menu buttons from mobile nav bar
  - Description: At the ≤700px STACK breakpoint, `#navBar` should contain only the hamburger toggle on the left — the pomodoro clock icon (`#pomodoroToggle`), focus music equalizer (`#musicToggle`), and ghost menu (`#settingsToggle`) all live in the top-right cluster on desktop but have no place in the STACK mobile chrome. The pomodoro and music utilities are slated for the upcoming bottom sheet (separate entry); the ghost menu's actions (Export JSON, Import JSON, Theme, Toggle floating ghost, Help) are either already mirrored in the drawer (`drawerTheme`, `drawerCompanion`) or are desktop-only affordances. Hide all three at the `@media (max-width: 700px)` breakpoint with `display: none`. The mobile nav should read as just `[☰]` on the left with empty space to the right — the project name in `#mobileProjHeader` directly below carries the visual weight that the icon cluster carries on desktop. This is an interim state until the bottom sheet (entry 2) lands and reintroduces pomodoro + music as the sheet's expanded content; export/import/theme/companion already have permanent homes in the drawer, so they don't need a mobile re-mount.
  - Behavior:
    1. Below 701px, `#navBar` shows only `#sidebarToggle` (hamburger) — all three right-cluster buttons are hidden
    2. The hamburger's keyboard tab order on mobile flows: hamburger → directly into the projects drawer when opened, or into `#mobileProjHeader` page dots when closed
    3. Above 701px, the full nav cluster (hamburger + pomodoro + music + ghost) renders unchanged
    4. Pomodoro state continues running in the background on mobile even though its icon is hidden — the global Ctrl+Space shortcut still toggles it (desktop affordance, but the controller is platform-agnostic)
    5. Music continues playing on mobile if a station was started on desktop and the user resized down — the iframe lives in `#musicPopover` which stays in the DOM regardless
  - Acceptance criteria:
    - Mobile viewport shows only the hamburger in the nav bar, no other icons visible
    - Desktop viewport (701px+) is unchanged — all four nav buttons render
    - No layout shift in the navbar height when the icons hide (they're `flex-shrink: 0` so removing them just frees horizontal space)
    - Ghost menu's hover-pulse animation isn't visible on mobile (the element is `display: none`, so the animation can't paint)
    - Keyboard arrow-nav across the nav (`nav.addEventListener('keydown', ...)`) doesn't break — the handler walks `[sidebarToggle, pomodoroToggle, musicToggle, settingsToggle]` and `indexOf` returns -1 for hidden elements, so left/right just no-op on hidden targets (verify this is the case; if not, gate the handler on `!isMobile()`)
  - Implementation notes:
    - All three buttons share the same right-cluster geometry pattern (`margin-left: auto` on `#pomodoroToggle`, then `gap: 8px` carries the rest)
    - Hiding with `display: none` on the buttons themselves keeps `#navBar`'s flex layout intact and lets `#sidebarToggle` sit naturally on the left edge
    - `#sidebarToggle` doesn't need any change — it's already first in DOM order and has no `margin-left: auto`
    - This is a CSS-only PR — no main.js changes needed
    - The interim hidden state means the existing keyboard shortcuts that act on these icons (Ctrl+Space for pomodoro toggle, "?" for help modal) still work, since they operate on the controller / modal directly and don't traverse the hidden icon
  - Out of scope: bottom sheet that re-mounts pomodoro and music as expanded content (entry 2 from the original STACK trio); preserving any of the icons in the mobile chrome long-term — the sheet is the permanent home
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-05-11

- [ ] **[MEDIUM]** Fix STACK mobile header typography and empty-state ordering to match prototype
  - Description: The STACK mobile project header is rendering with the wrong typography family and color treatment, and the empty-state block on `NO TODOS YET` is hoisting above the header. Three corrections needed: (1) `#mobileProjName` should use SpaceMono in the project accent color, not the system sans serif in `var(--text-primary)` — the prototype calls for a monospace title in purple to match the rest of the Void theme's mono chrome, and the current `font-family: inherit; color: var(--text-primary)` renders it as plain sans-serif white. (2) `#mobileProjLabel` and `#mobileProjCounts` should also use SpaceMono with the tighter 0.12–0.16em letter-spacing already used for `#footVersion` and `#footOpen` / `#footDone` on desktop — the current `font-family: inherit` falls through to system sans and the letter shapes don't match the rest of the app's mono chrome. (3) On the `NO TODOS YET` empty state, the `#emptyState` block is rendering above `#mobileProjHeader` because `#mainList.emptyStatePresent` uses `display: flex; flex-direction: column` with `justify-content: center` and `#emptyState` flexes with `flex: 1 1 auto` — but on mobile, the empty state must render *below* the project header, not above it. Fix by ensuring `#mobileProjHeader` paints first regardless of empty state class on `#mainList`, since the two elements are siblings under `main2`. The root cause is likely that the empty state's `position` or the `#mainBar` grid is allowing the empty state to visually overflow upward; verify the DOM order by checking which element is `main2.firstChild` at runtime — `#mobileProjHeader` was appended before `#mainList`, so the visual reorder must be a CSS layout artifact.
  - Behavior:
    1. `#mobileProjName` renders in SpaceMono at 20–22px, weight 700, color `var(--accent)` (project's accent purple)
    2. `#mobileProjLabel` renders in SpaceMono at 10px with `letter-spacing: 0.16em`, color `var(--text-muted)`
    3. `#mobileProjCounts` (both `#mobileProjOpen` and `#mobileProjDone`) renders in SpaceMono at 10–11px with `letter-spacing: 0.12em`, matching the footer counts treatment on desktop
    4. Empty-state block renders *below* the project header at all times — `NO TODOS YET`, `ALL CAUGHT UP`, etc. paint inside `#mainList` underneath the header, never above it
    5. Project-color accent on the title still resolves via `var(--proj-accent, var(--accent))` so per-project color swatches recolor the title
  - Acceptance criteria:
    - Title font matches the SpaceMono used elsewhere — visually identical character shapes to `PROJECT N OF M` label and `OPEN`/`DONE` counts
    - Title color uses the accent purple (or per-project accent), not white
    - All chrome text in `#mobileProjHeader` uses SpaceMono — no sans-serif leak
    - Empty-state screens render in source order: header on top, empty state in the list area below
    - Desktop layout (>700px) is unchanged — desktop `#mainCrumb` and `#footVersion` already use SpaceMono and shouldn't be affected
  - Implementation notes:
    - `font-family: 'SpaceMono', ui-monospace, SFMono-Regular, Consolas, monospace` is the existing token used elsewhere (search `#footVersion` / `#footOpen` / `.dueMonthTitle` for the canonical stack)
    - `color: var(--proj-accent, var(--accent))` mirrors the pattern already on `.selectedProject` and the page dots, so per-project color settings work for free
    - For the empty-state ordering: check whether `#mainList.emptyStatePresent` is being applied while `#mobileProjHeader` has `data-empty="true"` — if both fire at once, the header collapses (via `display: none` on `[data-empty="true"]`) and the empty state takes the whole pane; this may be the actual root cause and means `#mobileProjHeader[data-empty="true"]` should NOT hide the header when the project exists but has no todos
    - The `data-empty` attribute on `#mobileProjHeader` is set in `updateMobileProjHeader` based on `total > 0 && activeIdx >= 0` — if a project exists with zero todos, `total` is still > 0 so the header should render, but verify the runtime DOM to confirm
  - Out of scope: page dot spacing audit (separate entry); bottom sheet for utilities (entry 2); empty-state mascot tuning
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
