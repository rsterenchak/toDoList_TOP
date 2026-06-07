# TODO LIST

- [x] **[MEDIUM]** D1a: Migrate the responsive breakpoint constant from 700px to 1024px (with paired test updates) — Completed: 2026-06-05
  - Type: feature
  - Description: Migrate every occurrence of the literal 700px / 701px breakpoint in source AND in tests to 1023px / 1024px. This is a coordinated constant migration: the source and the tests that pin the source's literal value must change in lockstep so the test suite continues to express truth about the codebase. The visual behavior of the app does not change in terms of *what* layout appears at which width — the mobile layout still appears below the breakpoint, the desktop layout still appears at and above the breakpoint. ONLY the threshold value moves. The persistent left sidebar, the slide-in drawer, the workspace pill, the chat sheet, and all responsive behaviors stay structurally identical post-merge — they just switch between mobile and desktop presentations at 1024px instead of 700px. The pattern unification (drawer-everywhere) and the sidebar removal are deliberately deferred to D1b. This entry is the foundation that makes those later entries possible without test churn.
  - Implementation notes:
    - **The agent should treat tests that pin the literal breakpoint as part of the contract being migrated, not as immutable assertions.** Tests that hardcode `@media (max-width: 700px)` or `innerWidth <= 700` or `MOBILE_MAX_WIDTH = 700` exist to lock down "the source has this specific breakpoint value." When the source's breakpoint value migrates, those tests must migrate with it — that's preserving the contract, not weakening it. This is explicit authorization to update those tests as part of this entry, with the constraint that the test's *intent* (what behavior it verifies) must remain the same; only the literal threshold value changes.
    - **Migration scope (source):**
      - `style.css`: every `@media (max-width: 700px)` → `@media (max-width: 1023px)`, every `@media (min-width: 701px)` → `@media (min-width: 1024px)`. Per the agent's prior investigation: ~128 occurrences across the codebase, the majority in style.css.
      - All `.js` source files in `toDoList_main/src/`: every literal `700` / `701` used as a viewport breakpoint → `1023` / `1024`. Examples per the agent's prior investigation: `main.js` (the `isMobile()` definition), `claudeSheet.js` (`MOBILE_MAX_WIDTH`), `coachmark.js`, `welcomeCarousel.js`, `emptyState.js`, `mobileTaskCreate.js`. These are all the same breakpoint serving slightly different surfaces; they all migrate together.
      - **DO NOT** change `700` / `701` values that are NOT viewport breakpoints (e.g. timeout values like `setTimeout(..., 700)`, animation durations, pixel offsets unrelated to viewport width). Use context to distinguish — viewport breakpoints appear in `@media` queries, `window.innerWidth` comparisons, `MOBILE_MAX_WIDTH`-style constants, and explicit `<= 700` / `>= 701` viewport checks. Other 700s stay.
    - **Migration scope (tests):**
      - Per the agent's investigation: ~46 test files pin the breakpoint literal. For each, find every occurrence of `700` / `701` that exists *because it's a viewport breakpoint* and update it to `1023` / `1024`. The contextual signals are the same as for source — `@media` literals in expected strings, viewport-width assertions, breakpoint-constant assertions.
      - Tests should continue to express the same behavioral intent. If a test asserts "at desktop sizes, the mobile X button is hidden," that assertion stays — it's the *literal width number* that changes, not the intent.
      - If a test hardcodes a viewport like `Object.defineProperty(window, 'innerWidth', { value: 800 })` to simulate desktop behavior, the value `800` needs to stay valid as desktop. At the new breakpoint, 800 is now *mobile*. Tests like this need their simulated viewport bumped (e.g. to `1100` or some value clearly above 1024). Same for any `value: 500` mobile simulation — those stay mobile under the new breakpoint, so they don't need to change.
      - **jsdom default `innerWidth = 1024` consideration (per the agent's discovery):** jsdom's default viewport is 1024px. Under the new breakpoint, *the default jsdom environment is now mobile* (1024 is `<= 1023` if we use `<= 1023`, or it's the boundary if we use `< 1024`). Pick `< 1024` semantics for the breakpoint so jsdom's default 1024 viewport is **desktop**, preserving the test environment's identity. Concretely: `isMobile()` should evaluate to `innerWidth < 1024` (not `<= 1023` and not `<= 1024`), and `@media (min-width: 1024px)` is the desktop media query (which matches jsdom's 1024px default). This keeps the default test environment in desktop mode, so the existing desktop-mode tests don't suddenly flip to mobile mode and require rewriting their entire setup.
      - **DO NOT** weaken tests by removing assertions, skipping tests, or replacing specific assertions with looser ones. The only change to tests is updating the literal breakpoint values in lockstep with source.
      - **DO NOT** delete tests. If a test no longer makes sense at all under the new breakpoint (genuinely cannot be made to work even with literal value updates), comment it out with a `// TODO: revisit in D1b — breakpoint migration left this test pinning behavior that D1b retires` and explain. But this should be rare; nearly all tests should just need their literal numbers updated.
    - **What does NOT change in this entry:**
      - The persistent left sidebar still appears at ≥1024 (desktop). It does NOT become a drawer yet. D1b handles that.
      - The slide-in drawer still appears at <1024 (mobile). It still opens from the same trigger.
      - The workspace pill `#mobileProjHeader` still hides at ≥1024. It does NOT appear on desktop yet. D1c handles that.
      - The chat slide-up sheet still works exactly as it does today, just at the new breakpoint.
      - All pomodoro, music, INBOX, filter pills, status indicators, voice mic, header layout, bottom nav — all functionality stays identical, just toggling between mobile/desktop presentations at 1024 instead of 700.
    - **What CAN change visually for the user post-merge:**
      - If you previously had a browser window between 700 and 1023px wide, you used to see the desktop layout. After this entry, you see the mobile layout. Same for windows ≥1024 — they still see desktop.
      - The transition between layouts now happens at a different width. That's the *intended* visible change.
      - Nothing else.
    - **Critical**: do NOT change the structural presentation of the sidebar (rail vs full vs drawer). That's D1b.
    - **Critical**: do NOT show the workspace pill on desktop. That's D1c.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT change anything other than the breakpoint constant. This entry is single-purpose: migrate a constant + the tests that pin it.
    - **Acceptance test scenarios:**
      - All 1990 tests that previously passed continue to pass after this entry (with the literal-value updates described above).
      - At browser window width ≥1024px: same desktop layout that appeared at ≥701px before. Sidebar persistent on left, no workspace pill, chat sheet behavior unchanged.
      - At browser window width <1024px: same mobile layout that appeared at ≤700px before. Drawer, workspace pill visible, mobile chrome.
      - At browser window width 800px (previously desktop, now mobile): now shows the mobile layout. This is the intended behavior change.
      - At browser window width 1024px exactly: shows desktop (because of `< 1024` semantics — 1024 is not "less than" 1024).
      - No regressions to existing functionality. Test suite passes.
    - **Test additions (new tests, not just updates):**
      - (a) A test asserting `isMobile()` returns `true` for `innerWidth = 1023` and `false` for `innerWidth = 1024`. This pins the exact boundary semantics.
      - (b) A test asserting the literal `1024` (or `1023` depending on which direction the comparison runs) appears in the `isMobile()` definition in main.js, so any future drift away from this value gets caught.
  - Visual reference: no visual change in this entry. The next two entries (D1b, D1c) produce the user-visible desktop redesign.
  - Out of scope: any structural changes to the sidebar (D1b), any changes to the workspace pill visibility on desktop (D1c), removal of any features, addition of any new UI surfaces, the two-pane chat layout, the chat collapse/expand toggle, and any other change beyond updating the breakpoint constant and the tests that pin it. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/coachmark.js`, `toDoList_main/src/welcomeCarousel.js`, `toDoList_main/src/emptyState.js`, `toDoList_main/src/mobileTaskCreate.js`, `toDoList_main/tests/` (broadly — many test files migrate together)
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: adc9277c-27c3-47a9-b217-20e75bafbd89 -->

- [x] **[MEDIUM]** D1b: Convert #sideBar from persistent column to slide-in drawer at desktop widths; retire rail/resizer/collapse machinery — Completed: 2026-06-05
  - Type: feature
  - Description: At desktop widths (≥1024px), `#sideBar` no longer renders as a persistent left column. Instead, it slides in as an overlay drawer — the same presentation it already uses on mobile. The hamburger / sidebar-toggle button (which already exists and works on mobile) becomes visible at desktop widths as the trigger for opening the drawer. The rail-mode (54px icon strip), the rail↔full resizer, the `todoapp_sidebarRail` localStorage preference, the auto-collapse-on-tab-view behavior, the `Ctrl+Backspace`-specific desktop gating, and any other machinery that exists to support the "persistent rail vs full column" desktop presentation are retired. The drawer's three-way close vocabulary (X button, backdrop tap, Escape) works at all breakpoints, not just mobile. The workspace pill (`#mobileProjHeader`) is still hidden at desktop — D1c adds it as the better trigger surface and lets the hamburger become redundant.
  - Implementation notes:
    - **Tests that pin the retired machinery are part of the contract being retired, not immutable assertions.** This is explicit authorization to remove or update the following test suites (and any similar tests that exist):
      - `projectsIconRail.test.js` — entirely retired. The rail mode no longer exists.
      - `todayViewAutoCollapseSidebar.test.js` — entirely retired or substantially rewritten. The auto-collapse behavior was specific to the persistent column; with a drawer, there's nothing to auto-collapse.
      - Parts of `ctrlBackspaceSidebarToggle.test.js` — the desktop-specific routing through "rail/full and mobile drawer branches" must be updated to "the unified drawer at all breakpoints."
      - `stackDrawerThreeWayClose.test.js` — the desktop-specific "Escape bails on desktop because sidebar is a persistent rail" test must be retired/inverted, and the "X button hidden at desktop" assertion must be inverted (X button visible everywhere because the drawer is at every breakpoint).
      - Any test that asserts the literal `@media (min-width: 1024px) { #sideBar { ... persistent-column CSS ... } }` pattern — those persistent-column CSS rules are being removed, so the tests that pin them must update accordingly.
    - **What "retired" means for tests:** delete the test file (or the specific `it()` blocks) and add a brief comment in the routine's PR description noting the retirement. Do NOT leave dead tests with `it.skip()`; clean removal is preferred since this is intentional contract retirement. If a test verifies behavior that *also* exists elsewhere (e.g. a sidebar-related test that's actually about the workspace pill's drawer-open behavior), keep that part and remove only the rail-specific assertions.
    - **What "rewritten" means for tests:** if a test still has a meaningful behavioral assertion under the new contract (e.g. "the drawer closes on Escape"), update the test to make that assertion under the new unified-drawer semantics. The behavior the test pins should survive; the implementation details specific to the retired machinery should not.
    - **Critical**: do NOT weaken tests by simply removing assertions to make them pass. Retire tests that pin retired behavior; rewrite tests that pin still-relevant behavior; keep tests that don't touch the affected machinery untouched.
    - **Source changes:**
      - In `style.css`, the `@media (min-width: 1024px)` rules for `#sideBar` change from persistent-column to overlay-drawer. Mirror the existing mobile rules: `position: fixed`, `transform: translateX(100%)` by default, slides in via the `.sidebar-open` class. The drawer can occupy the same width on desktop as it does on mobile, or be slightly wider — your call as the agent, just keep it reasonable (250-320px is the typical drawer width).
      - The persistent-column CSS rules at `@media (min-width: 1024px)` are removed: any `position: relative` or `flex: 0 0 <width>` or similar layout rules for `#sideBar` at desktop widths.
      - The main content area's CSS at desktop widths: remove any `margin-left` / `padding-left` / flex sibling offsets that previously made room for the persistent sidebar. The main content area now fills the full viewport width.
      - The CSS for `#mobileSidebarClose` (the X button inside the drawer header): remove the desktop-hides-this rule. The X button is visible at all breakpoints.
      - The rail-mode CSS — `.sidebar-rail`, `#sideBar.rail`, or whatever the class pattern is — entirely removed.
      - The resizer element CSS — removed.
    - **JS changes:**
      - `prefs.js`: remove the `SIDEBAR_RAIL_KEY` constant, the `isSidebarRailOn()` function, the `setSidebarRailOn()` function, and any related rail-preference persistence.
      - `main.js`: remove the rail/full toggle code, the resizer event handlers, the auto-collapse-on-tab-view code (e.g. the `todayViewAutoCollapseSidebar` logic). Remove any `isSidebarRailOn()` calls.
      - `main.js`: in the `Ctrl+Backspace` handler, remove any branch that's specific to the rail/full toggle on desktop. The chord should now route through `sidebarToggle.click()` at all breakpoints, which opens or closes the drawer.
      - `main.js`: in the drawer's Escape handler, remove the `!isMobile()` desktop-bail. Escape closes the drawer at all breakpoints (since the drawer exists at all breakpoints now).
      - The sidebar-toggle button (hamburger) CSS: ensure it's visible at all breakpoints. If it was previously `display: none` at desktop widths, remove that rule.
    - **localStorage cleanup:** existing users may have `todoapp_sidebarRail` stored. The value is no longer meaningful. Optional: add a one-time migration that deletes the stale key on next app load. Not critical — leaving an unused localStorage key is harmless — but tidier if simple.
    - **Critical**: do NOT show the workspace pill on desktop. `#mobileProjHeader` remains hidden at desktop widths after this entry. D1c adds that.
    - **Critical**: do NOT make any structural changes to the chat sheet, the main task list area, the INBOX view, the CALENDAR view, the bottom nav, the pomodoro/music chips, or any other component. ONLY the sidebar's desktop presentation changes.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT modify the `isMobile()` definition or the breakpoint constant (1024). Those are D1a's contract, locked.
    - **Acceptance test scenarios:**
      - At ≥1024px window width:
        - No persistent left column visible
        - Main task area fills the full viewport width (no offset for a sidebar that's not there)
        - Hamburger button visible in the header (or wherever it lives on desktop now)
        - Tap hamburger → drawer slides in from the side (same direction as mobile)
        - Drawer shows the project list
        - Drawer can be closed via X button, backdrop tap, or Escape
        - Project selection from the drawer works (taps a project → drawer closes, main view updates)
      - At <1024px window width: zero behavioral changes from after D1a (mobile UX completely unchanged)
      - All pomodoro, music, INBOX, filter pills, status indicators, voice mic, chat sheet, header chrome work at both breakpoints
      - No console errors
    - **Test additions (new tests for new contract):**
      - (a) At desktop widths, `#sideBar` has `position: fixed` (not `position: relative` or `static`) — verified via computed CSS or class assertion.
      - (b) At desktop widths, the X button (`#mobileSidebarClose`) is visible (not `display: none`).
      - (c) The Escape handler in `main.js` no longer contains `isMobile()` gating for the sidebar-close path.
      - (d) The `Ctrl+Backspace` chord routes through `sidebarToggle.click()` regardless of viewport width.
      - (e) `prefs.js` does not export `isSidebarRailOn` or `setSidebarRailOn`.
      - (f) The main content area's CSS at desktop widths has no `margin-left` or `padding-left` accommodating a persistent sidebar.
  - Visual reference: `desktop-final-idle.svg` from the design session shows the no-sidebar state. After D1b, desktop matches that — except the workspace pill in the header is still missing (D1c adds it). The hamburger button stays visible as a transitional trigger.
  - Out of scope: workspace pill visibility on desktop (D1c), two-pane chat (D2), chat collapse toggle (D3), removal of the hamburger button (acceptable to keep at all breakpoints), and any other UI changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/prefs.js`, `toDoList_main/tests/` (broadly — multiple test files retire or migrate)
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: d6d99084-b97d-4692-b018-cf30f7993330 -->

- [x] **[MEDIUM]** First-run coachmark tour: open the projects drawer for sidebar-targeted steps on desktop — Completed: 2026-06-05
  - Type: bug
  - Description: After D1b converted the desktop projects sidebar from a persistent column/rail to a slide-in overlay drawer that is closed by default, the first-run desktop coachmark tour (`maybeStartFirstRunTour` / `startCoachmarkTour` in `coachmark.js`) now spotlights elements that live inside the closed, off-screen drawer. Specifically the `sampleProject` step targets `#projChild` inside `#sideMa`, and the `addProject` step targets `#projButton` — both are translated off-screen (`transform: translateX(100%)`) while the drawer is shut, so their spotlight cutouts and callouts land against the right viewport edge instead of over the real control. The elements still exist in the DOM (no null target, no thrown error, and the callout layout clamps to the viewport), so this degrades the visual tour rather than crashing it. Fix: when a coachmark step targets a sidebar element on desktop, open the drawer first (add `sidebar-open` to `#sideBar` and `visible` to `#sidebarOverlay`, or route through the existing `openSidebar` path) so the spotlight lands on the real, on-screen control; close it again when the tour advances past the sidebar steps or finishes. Keep mobile behavior unchanged (the tour already early-exits on mobile via the breakpoint guard).
  - File: `toDoList_main/src/coachmark.js`, `toDoList_main/src/main.js`, `toDoList_main/tests/`

- [x] **[MEDIUM]** D1c: Reveal #mobileProjHeader at desktop widths as the project drawer trigger; hide the hamburger at desktop — Completed: 2026-06-05
  - Type: feature
  - Description: At desktop widths (≥1024px), `#mobileProjHeader` becomes visible in the header as the project selector and drawer trigger. The pill displays the active project name and a small dropdown indicator (▾), matching the mobile pattern. Tapping the pill opens the project drawer (the slide-in overlay that D1b established). The hamburger button (which D1b kept as a transitional trigger) is hidden at desktop widths — the pill is now the single trigger. Mobile behavior is completely unchanged: the workspace pill works exactly as it did before, the hamburger still works on mobile if it's currently visible there, and the slide-in drawer still appears the same way. After this entry ships, the desktop design from the design session is complete: full-width header with workspace pill on the left, no persistent sidebar, main task area filling the viewport, chat sheet behavior unchanged (D2 makes chat persistent).
  - Implementation notes:
    - **The mobile pill (`#mobileProjHeader`) already exists and has working drawer-open wiring.** This entry primarily reveals it at desktop and adjusts its styling to fit the desktop header — it does NOT create new DOM or new event handlers. The pill's tap-to-open-drawer behavior should work for free since the drawer is now unified across breakpoints (D1b's contract).
    - **CSS changes:**
      - Remove the `display: none` rule that hides `#mobileProjHeader` at `@media (min-width: 1024px)`. The pill becomes visible at all breakpoints.
      - Add desktop-specific styling for `#mobileProjHeader` to fit the desktop header layout. The mobile pill spans full width with chevrons (`‹` / `›`) flanking the project name. The desktop version should be more compact:
        - Sit on the left side of the header (where the hamburger currently is, or just to the right of it)
        - Width auto-sized to content (project name + dropdown indicator) with a reasonable max-width (e.g. 220-280px) and ellipsis truncation for long names
        - NO `‹` / `›` carousel chevrons at desktop — those are mobile-only swipe affordances. Desktop users use the drawer to switch projects.
        - Show only: the project name + a small `▾` or `▼` dropdown indicator
        - Tappable target with hover state
        - Use existing design tokens — match the visual weight of other header elements (filter pills, etc.)
      - At desktop widths, hide the hamburger button (`#sidebarToggle` or whatever the actual selector is). Use a media query: `@media (min-width: 1024px) { #sidebarToggle { display: none; } }`.
      - The mobile chevrons (`#mobileProjPrev`, `#mobileProjNext`) and counts (`#mobileProjCounts`) need to be hidden at desktop widths too if they're descendants of `#mobileProjHeader`. The pill at desktop is name + dropdown indicator only.
    - **JS changes:**
      - Likely none required if the pill's tap handler is already wired correctly. The handler that opens the drawer when the pill is tapped should work at any breakpoint, since D1b unified the drawer.
      - If there's any JS code that explicitly checks viewport width and skips the pill's wiring at desktop (e.g. "don't bother wiring this since it's not visible"), remove that check.
      - The `Ctrl+Backspace` chord and the existing Escape handler still work — D1b unified them. No changes here.
    - **Long project name handling:**
      - The mobile pill has its own truncation strategy. The desktop pill should truncate similarly — ellipsis after a reasonable character count (the existing CSS `text-overflow: ellipsis` with `max-width` should work).
      - For very long project names, the pill shows the truncated name with `...` and the dropdown indicator. Tapping still opens the drawer where the full name is visible.
    - **What stays the same:**
      - The drawer itself — same overlay, same X close, same backdrop, same Escape handler, same animation. All from D1b.
      - The mobile pill at <1024px — completely unchanged.
      - The hamburger at <1024px — completely unchanged.
      - The project list inside the drawer — unchanged.
      - All other header elements: filter pills, pomodoro chip, music chip, INBOX/CALENDAR tabs.
      - Main task list, INBOX view, CALENDAR view, compose row, status indicators, voice mic, chat sheet.
    - **Critical**: do NOT modify the drawer itself (its DOM, its CSS, its event handlers). That's D1b's contract. Only the trigger surfaces change.
    - **Critical**: do NOT modify the workspace pill's underlying behavior — the tap → drawer-open path. Only its visibility and visual styling at desktop change.
    - **Critical**: do NOT remove the hamburger at mobile widths. Only hide it at ≥1024px.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT modify the breakpoint constant or `isMobile()` definition. That's D1a's contract.
    - **Acceptance test scenarios:**
      - At ≥1024px window width:
        - Workspace pill visible in the header, showing the active project name with a `▾` dropdown indicator
        - Pill sits on the left side of the header
        - Long project names truncate with ellipsis; pill width caps at ~280px
        - Hamburger button is NOT visible
        - Tapping the pill opens the drawer (same as D1b's drawer behavior)
        - Selecting a project from the drawer closes the drawer and updates the active project; the pill text updates to reflect the new project
        - `‹` / `›` chevrons NOT visible at desktop
        - The drawer's three-way close (X / backdrop / Escape) all work
      - At <1024px window width:
        - Workspace pill visible (unchanged from current mobile UX)
        - Hamburger button visibility unchanged from current mobile UX
        - `‹` / `›` chevrons still visible on mobile
        - All other mobile behavior unchanged
      - Resizing across the 1024 boundary:
        - The pill stays visible throughout (was always visible on mobile, now visible on desktop too)
        - The hamburger appears/disappears as the boundary is crossed
        - The chevrons appear/disappear as the boundary is crossed
        - No broken intermediate states
    - **Test additions:**
      - (a) At ≥1024px, `#mobileProjHeader` is NOT `display: none` — verified via computed CSS
      - (b) At ≥1024px, the hamburger button (`#sidebarToggle` or its equivalent) IS `display: none`
      - (c) At ≥1024px, `#mobileProjPrev` and `#mobileProjNext` (chevrons) are NOT visible
      - (d) The pill's existing tap-to-open-drawer handler still triggers `sidebarOpen()` (or whatever the existing function is) regardless of viewport width
      - (e) The pill text reflects the active project name at all breakpoints
  - Visual reference: `desktop-final-idle.svg` from the design session — workspace pill on the left of the header (`TaskApp ▼ toDoList_TOP`), no hamburger visible, no persistent sidebar, main task area fills the viewport width.
  - Out of scope: the two-pane chat layout (D2), the chat collapse/expand toggle (D3), any sidebar/drawer changes (D1b's contract), any breakpoint changes (D1a's contract), removal of the hamburger at mobile widths, any other UI changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/style.css`, possibly `toDoList_main/src/main.js` (only if event handlers need adjustment), `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: d86cf21e-e6f2-48e4-93e4-f85f50ba175c -->

- [x] **[MEDIUM]** D2: At desktop widths, present the chat as a persistent right pane (replacing the slide-up sheet on desktop only) — Completed: 2026-06-06
  - Type: feature
  - Description: At desktop widths (≥1024px), the Claude chat is presented as a persistent right pane (~40% of viewport width) instead of a slide-up sheet. The main task area takes the left ~60% of the viewport. At mobile widths (<1024px), the chat continues to appear as a slide-up sheet, exactly as it does today — mobile UX is completely unchanged. The chat content itself — message history, input row with mic and send, Chat/Runs tabs, workspace pill in chat header — is identical in both presentations; only the *container* the content lives in changes. After this entry ships, the desktop two-pane layout from the design mockups is visible: task pane on left, chat pane on right, both visible simultaneously. The collapse/expand toggle for the chat pane is deliberately deferred to D3.
  - Implementation notes:
    - **Architecture: same content, two containers.**
      - The chat sheet's content (everything currently rendered inside `#claudeSheet` or its equivalent — the Chat/Runs tabs, message list, input row, etc.) should be either (a) rendered once and conditionally appended to the sheet container OR the pane container based on viewport, or (b) duplicated across both containers with shared event handlers, with the container-not-in-use hidden via CSS.
      - **Strongly prefer Option (a) — render once, move between containers.** Duplicating DOM is fragile (event handlers, scroll state, focus state, in-flight requests all become two things to coordinate). Moving an existing element between parents preserves all of that.
      - The implementation: at the desktop breakpoint, on viewport-resize or initial mount, if `width >= 1024px` the chat content node is appended as a child of the desktop chat pane element; if `width < 1024px` it's appended as a child of the existing slide-up sheet element. The chat sheet's open/close animation only runs at <1024px; at desktop the pane is always visible.
      - If the existing chat content is structured in a way that makes (a) genuinely difficult — e.g. its parent is hardcoded throughout claudeSheet.js — then fall back to (b) with explicit cross-container event listener registration via a single delegated handler on the document.
    - **New DOM elements:**
      - A new container `#mainSplit` (or similar) that wraps the existing main content area + the new chat pane. CSS at desktop: `display: flex; flex-direction: row;`. At mobile: behaves as if it weren't there (display: contents, or just unaffecting layout).
      - The existing main task area (workspace with tasks, filter pills, etc.) becomes the left child of `#mainSplit`, with `flex: 1` or `flex: 0 0 60%`.
      - A new container `#desktopChatPane` becomes the right child of `#mainSplit`, with `flex: 0 0 40%` (or whatever proportion you prefer; 60/40 is the design's split). At desktop: `display: flex; flex-direction: column;`. At mobile: `display: none;`.
      - The existing `#claudeSheet` (slide-up sheet) stays in place in the DOM. At desktop, it should be `display: none;` (or just have its slide-up trigger disabled). At mobile, it functions as today.
    - **CSS for the desktop pane:**
      - Border between task pane and chat pane: a thin vertical line (`border-left: 1px solid #2a2a3a` on the chat pane)
      - The chat pane should be `height: calc(100vh - <header-height>px)` so it fills the viewport below the header but doesn't extend behind it
      - The chat content inside the pane should scroll independently from the task list (separate scroll context)
      - Background slightly distinct from the task pane (e.g. `background: #0b0b11` vs task pane's `#07070c`, matching the mockup)
    - **JS for content placement:**
      - On viewport resize, when crossing the 1024px boundary, move the chat content from one container to the other.
      - On initial page load, place the chat content in the correct container based on initial viewport width.
      - The mover function should be idempotent — calling it when the chat is already in the right container should be a no-op.
      - Preserve scroll position when moving (if possible — `scrollTop` survives a parent change in most browsers; verify).
      - Preserve input field text when moving (the input is part of the moved content, so its value persists naturally).
    - **What stays the same:**
      - All chat content rendering — message history, Chat/Runs tabs, workspace pill in the chat sheet/pane, input row, mic button, send button, conversation messages
      - All chat behavior — sending messages, receiving responses, voice transcription, "Add to Idea dump" flows, etc.
      - All workspace pill behavior in the chat header (selecting active repo)
      - The slide-up sheet behavior at mobile widths
      - The main task area and all its components: filter pills, status indicators, compose row, INBOX, CALENDAR, header chrome, pomodoro, music
      - All other features: TODO.md viewer, voice mic, etc.
    - **Critical**: do NOT add a collapse/expand toggle for the chat pane. That's D3.
    - **Critical**: do NOT modify the breakpoint constant or `isMobile()` definition (D1a's contract).
    - **Critical**: do NOT modify the project drawer or workspace pill (D1b/D1c contracts).
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT modify chat content behavior — message sending, voice input, popovers — only the container the content lives in changes.
    - **Critical**: at mobile widths, the slide-up sheet must work IDENTICALLY to today. No regressions.
    - **Critical**: do NOT duplicate the chat DOM. Move the existing chat node between containers; do not create two copies of the chat content.
    - **Acceptance test scenarios:**
      - At ≥1024px window width:
        - Two visible panes side by side: task pane on left (~60% width), chat pane on right (~40% width)
        - Chat content (tabs, messages, input row) lives inside the right pane
        - The slide-up chat sheet is NOT visible (not triggerable, no visual presence)
        - All chat functionality works: sending messages, receiving responses, voice input, all current chat affordances
        - Task pane shows the full task list, filter pills, compose row, status indicators — all functioning
        - Both panes scroll independently
      - At <1024px window width:
        - Chat appears as a slide-up sheet exactly as it does today
        - The desktop chat pane is NOT visible
        - All mobile UX identical to current behavior
      - Resizing across the 1024px boundary:
        - Chat content moves between containers without losing state (scroll position, input text, focus state)
        - No console errors during the transition
        - No flickering or layout jumps that look broken (a brief reflow is acceptable)
      - Layout consistency at 1024, 1036, 1100, 1280, 1440, 1920px:
        - Two-pane layout at all these widths
        - Task pane and chat pane proportions consistent
        - No reverting at wider widths (this is the D1c-fix bug — if it surfaces here too, it surfaces; D2 doesn't fix it, but doesn't make it worse)
    - **Test additions:**
      - (a) At `innerWidth = 1280`, `#desktopChatPane` has computed `display` other than `none`
      - (b) At `innerWidth = 1280`, `#claudeSheet` has computed `display: none` (or is otherwise not interactive)
      - (c) At `innerWidth = 500` (mobile), `#desktopChatPane` has computed `display: none`
      - (d) At `innerWidth = 500`, `#claudeSheet` is interactive as today
      - (e) The chat content node (whatever its top-level identifier is) has exactly one parent at any given viewport — verify it's not duplicated
      - (f) Moving the chat content between containers preserves event handlers (verify by triggering a send action after a resize)
  - Visual reference: `desktop-final-idle.svg` from the design session — the two-pane layout with the chat pane on the right showing Chat/Runs tabs and conversation, separated by a thin vertical border.
  - Out of scope: the chat collapse/expand toggle (D3), the radio now-playing strip's width constraint to task pane only (polish, future entry), any chat content changes, any other UI changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 284a951e-7b02-4d9a-8aa4-206e22edf928 -->

- [x] **[HIGH]** D2-fix: Inject chat content into the desktop chat pane (currently empty) — Completed: 2026-06-06
  - Type: bug
  - Description: After D2 shipped, the desktop two-pane layout is structurally present — the chat pane container is visible on the right side of the viewport at ≥1024px — but the chat content (Chat/Runs tabs, message history, input row with mic and send) is not appearing inside it. The pane is visually empty. The slide-up chat sheet still works correctly at mobile widths (<1024px), so the bug is isolated to the desktop content-injection path. This is a HIGH priority bug because desktop users currently have no way to access the chat at all — neither the sheet nor the pane shows anything.
  - Implementation notes:
    - **Investigation first, then fix.** The agent should diagnose before patching. The most likely root causes, in priority order:
      - (a) The content-mover function exists but is only called on `resize` events, not on initial page load. Fix: call the mover function once during initial setup, after the DOM is ready, AND on resize.
      - (b) The content-mover function uses incorrect selectors that don't match the actual chat-content node IDs/classes. Fix: identify the actual chat content node (likely the children of `#claudeSheet` or a specific container inside it) and target it correctly.
      - (c) The chat content was never wired to be movable. The agent built the pane container but didn't write the mover. Fix: write the mover function, ensuring it runs on initial mount + resize.
      - (d) The chat content IS being moved but is hidden inside the pane via a CSS rule that doesn't apply to it correctly (e.g. `#claudeSheet { display: none; }` at desktop also hides its now-displaced children, OR the moved content has `display: none` inherited).
    - **Investigation approach:**
      - Open the desktop view, inspect the DOM in browser devtools, find the chat content node (Chat/Runs tabs, message list, input row). Identify which parent it currently lives in. That tells you whether the content was never moved (still inside `#claudeSheet`) or was moved but is invisible (inside the pane but hidden via CSS).
      - Check the JS for whatever mover function should exist. Confirm it's called on initial mount, not just on resize.
      - Check the CSS for `#claudeSheet` and its descendants at desktop widths. If `#claudeSheet { display: none; }` hides descendants that were moved out, that's the root cause.
    - **Likely fix shape:**
      - In the JS file that handles the chat presentation (`claudeSheet.js` or `main.js` depending on where D2 added it):
        - Identify the mover function (likely named something like `moveChatToDesktopPane`, `applyChatLayout`, `relocateChatContent`, etc.). If it doesn't exist, create one.
        - The function takes the chat content node and appends it to either `#desktopChatPane` (at desktop) or `#claudeSheet` (at mobile), based on `window.innerWidth >= 1024`.
        - Call the function once during initial mount, AFTER the chat sheet is initialized (so the content exists), and AFTER `#desktopChatPane` is in the DOM.
        - Wire the function to `window.addEventListener('resize', ...)` with appropriate debouncing to avoid thrashing on continuous resize.
      - In the CSS: if `#claudeSheet { display: none; }` is the rule at desktop, make sure it ONLY hides `#claudeSheet` itself, not any descendants that were moved out of it. (Moving content out of `#claudeSheet` makes them descendants of `#desktopChatPane` instead, so this might not actually be an issue — but verify.)
    - **What stays the same (do NOT touch):**
      - The mobile slide-up sheet (still works per verification)
      - The desktop pane container, divider, CSS layout (already in place per D2)
      - The chat content itself — tabs, message rendering, input row, mic, send, voice input, popovers
      - The workspace pill in the chat header (the repo selector)
      - All non-chat features: task pane, INBOX, CALENDAR, pomodoro, music, voice mic in chat input, status indicators, filter pills, TODO.md viewer
      - The breakpoint constant (1024px, D1a's contract)
      - The project drawer (D1b's contract)
      - The workspace pill in main header (D1c's contract)
    - **Critical**: do NOT modify the breakpoint constant or `isMobile()` definition.
    - **Critical**: do NOT modify the project drawer, workspace pill, or other previously-shipped contracts.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT add a collapse/expand toggle for the chat pane. That's D3.
    - **Critical**: do NOT duplicate the chat DOM. The chat content node must live in exactly one place at any given time — either inside `#claudeSheet` (mobile) or inside `#desktopChatPane` (desktop), never both.
    - **Critical**: the mobile slide-up sheet must continue to work IDENTICALLY to current state. Verify by setting `innerWidth = 500` in tests.
    - **Acceptance test scenarios:**
      - At `innerWidth >= 1024`:
        - Chat content (Chat/Runs tabs, message history, input row with mic and send) is visible inside the desktop chat pane on the right
        - All chat functionality works: sending messages, receiving responses, voice input, all existing chat affordances
        - Scrolling the chat message history works independently from the task pane scroll
        - Switching projects via the workspace pill (in main header) does not break the chat pane
      - At `innerWidth < 1024`:
        - Chat slide-up sheet works identically to current behavior (verified to be working)
        - The desktop chat pane is NOT visible
        - All chat functionality in the sheet works as before
      - Resizing across the 1024px boundary:
        - On crossing into desktop: chat content appears in the right pane, sheet disappears
        - On crossing into mobile: chat content reappears in the sheet container; sheet behavior restored
        - No flicker, no console errors, no duplicated content
    - **Test additions:**
      - (a) At `innerWidth = 1280`, the chat content node has a parent that is `#desktopChatPane` (not `#claudeSheet`)
      - (b) At `innerWidth = 1280`, the chat content node IS visible (computed `display` is not `none`)
      - (c) At `innerWidth = 500`, the chat content node has a parent that is `#claudeSheet` (not `#desktopChatPane`)
      - (d) Resizing window from 500 to 1280 in a test should move the chat content's parent accordingly
      - (e) The chat content node exists exactly once in the document — no duplication
      - (f) Sending a chat message at `innerWidth = 1280` triggers the same handler as at `innerWidth = 500` — event handlers preserved across the move
  - Visual reference: `desktop-final-idle.svg` from the design session — chat pane on the right with Chat/Runs tabs, message exchanges, and input row at the bottom.
  - Out of scope: the chat collapse/expand toggle (D3), any styling changes to the chat content, any new chat features, the lingering D1c >1024 layout-reverting bug (still deferred), any other UI changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/claudeSheet.js`, possibly `toDoList_main/src/main.js`, possibly `toDoList_main/src/style.css`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: d357a7ac-2501-4c09-b922-9cf65c825f33 -->

- [x] **[MEDIUM]** D3: Collapse/expand toggle for the desktop chat pane (with localStorage persistence) — Completed: 2026-06-06
  - Type: feature
  - Description: At desktop widths (≥1024px), add a small toggle button that lets the user collapse the chat pane (right side) so the task pane fills the full viewport width. When collapsed, a re-expand button appears so the user can bring the chat back. The collapsed/expanded state persists across page reloads via localStorage (key: `todoapp_chatPaneCollapsed`, default: false / expanded). At mobile widths (<1024px), this toggle has no effect — the chat continues to behave as a slide-up sheet, the collapse preference is ignored. After this entry ships, the desktop two-pane has the dismissibility that completes the design vision.
  - Implementation notes:
    - **Toggle button (collapse — when chat pane is visible):**
      - Small button positioned at the top-left corner of the chat pane (just inside the pane, near the workspace pill at the chat header)
      - Icon: `›` (right chevron) or `⇥` — pick whichever looks cleaner in the existing design language
      - `aria-label`: "Collapse chat pane"
      - On click: set localStorage `todoapp_chatPaneCollapsed = 'true'`, apply CSS class to body or main container (e.g. `body.chatPaneCollapsed`), let CSS handle the visual transition
    - **Re-expand button (when chat pane is collapsed):**
      - Small floating button on the right edge of the viewport (vertically centered, fixed positioning)
      - OR: button in the main header on the right side, near the pomodoro/music chips
      - Pick the placement that fits the existing header layout best. The floating-right-edge pattern is more discoverable; the header-button pattern is more contained.
      - Icon: `‹` (left chevron) or `⇤`
      - `aria-label`: "Expand chat pane"
      - On click: set localStorage `todoapp_chatPaneCollapsed = 'false'`, remove the CSS class
    - **CSS for collapsed state at desktop:**
      - `body.chatPaneCollapsed #desktopChatPane { display: none; }` — chat pane hidden entirely
      - `body.chatPaneCollapsed .taskPane` (or whatever the task pane's container class is) — task pane expands to fill `100%` width via `flex: 1 1 100%` or similar
      - The expand button is shown via `body.chatPaneCollapsed #chatExpandButton { display: block; }` (and hidden by default when the class isn't present)
    - **Animation (optional, light touch):**
      - If easy to add without complexity: a brief `transition: flex-basis 0.2s ease` on the panes so the task pane smoothly expands when chat collapses
      - If it adds complexity or risks layout issues, skip the animation. An instant transition is acceptable.
    - **localStorage persistence:**
      - On page load, read `todoapp_chatPaneCollapsed`. If `'true'`, apply the `chatPaneCollapsed` class to body immediately (before paint, if possible, to avoid a flash of expanded state). If `'false'` or null, leave the class off.
      - Use the existing prefs.js module if there's a pattern for other localStorage prefs (e.g. `getCollapsedChat()`, `setCollapsedChat(value)` functions).
    - **Behavior at width transitions:**
      - The CSS rules above should be scoped to `@media (min-width: 1024px)` — at mobile, the collapsed class has no visual effect because the chat sheet/pane logic doesn't apply.
      - When the viewport resizes back to desktop after being at mobile, the localStorage state determines whether the chat pane appears or is collapsed.
      - Don't write a JS resize handler for this — pure CSS media queries + class toggling is sufficient.
    - **What stays the same:**
      - The chat content inside the pane — tabs, message history, input row, mic/send, voice input, popovers — all unchanged
      - The mobile slide-up sheet — completely unchanged
      - Task pane behavior — filter pills, compose row, status indicators, INBOX, CALENDAR, all unchanged
      - All other features: pomodoro, music, voice mic in chat input, workspace pill, project drawer, etc.
      - The breakpoint (D1a), the drawer (D1b), the workspace pill (D1c), the two-pane structure (D2)
    - **Critical**: do NOT modify the breakpoint constant or `isMobile()` definition.
    - **Critical**: do NOT modify the chat content, the project drawer, or the workspace pill.
    - **Critical**: do NOT modify the mobile slide-up sheet's behavior.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT change any task pane behavior beyond the width adjustment when chat collapses.
    - **Acceptance test scenarios:**
      - At `innerWidth >= 1024`, fresh page load (no localStorage value):
        - Chat pane visible on the right, task pane on the left
        - Collapse button visible inside the chat pane (top-left of pane)
        - Re-expand button NOT visible
      - Click the collapse button:
        - Chat pane disappears, task pane expands to fill the viewport
        - localStorage `todoapp_chatPaneCollapsed = 'true'`
        - Re-expand button appears (right edge or header)
      - Click the re-expand button:
        - Chat pane reappears, task pane returns to ~60% width
        - localStorage `todoapp_chatPaneCollapsed = 'false'`
        - Collapse button reappears
      - Reload the page while collapsed:
        - Chat pane is collapsed on load (no flash of expanded state)
      - At `innerWidth < 1024` (mobile):
        - The collapse/expand buttons have no visible effect (collapsed class doesn't apply)
        - Chat sheet behavior identical to current
      - Resize from mobile to desktop while in different localStorage states:
        - Goes back to whatever the localStorage state says
    - **Test additions:**
      - (a) On desktop, clicking the collapse button hides `#desktopChatPane` and sets localStorage
      - (b) On desktop, clicking the re-expand button shows `#desktopChatPane` and clears localStorage flag
      - (c) On desktop with `todoapp_chatPaneCollapsed = 'true'` in localStorage, `#desktopChatPane` is hidden on initial mount
      - (d) On desktop with `todoapp_chatPaneCollapsed = 'false'` (or null) in localStorage, `#desktopChatPane` is visible on initial mount
      - (e) On mobile (innerWidth < 1024), the collapse button is not visible
      - (f) On mobile, applying the `chatPaneCollapsed` class to body does NOT hide the chat sheet
  - Visual reference: the desktop mockups from the design session show the expanded state. The collapsed state is a 100%-width task pane with a small `‹` chevron button on the right edge to reopen.
  - Out of scope: any styling changes to the chat content, any task pane changes beyond width expansion when collapsed, the lingering D1c >1024 layout bug (still deferred), any other UI changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/prefs.js` (if using the prefs module pattern), `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 81b7c4ff-bc67-4a2e-b3e2-e8b4b09a084a -->

- [x] **[MEDIUM]** Desktop header polish: consolidate workspace pill into top header, move view tabs into thin sub-band below — Completed: 2026-06-06
  - Type: feature
  - Description: At desktop widths (≥1024px), restructure the header chrome to consolidate visual hierarchy. The workspace pill (`Task Management App ▾`) moves up from its current location in the task pane area into the main top header, sitting on the left. The counts (`11 open · 146 done`) sit inline next to the workspace pill in the top header. The pomodoro/music/ghost utility chips stay on the right of the top header. Below the main header, a thin sub-band (~32px tall) contains the PROJECTS / INBOX / CALENDAR view tabs, restyled as underlined-text tabs (not pills) — purple text + purple underline for the active tab, muted gray for inactive. The SORT BY DUE / EXPAND ALL controls move from their current row (alongside the workspace pill) down to share the same row as the filter pills (ALL / ACTIVE / IDEAS) inside the task pane. Net effect: 3 rows of chrome → 2 rows of chrome (main header + thin sub-band) before the task pane's own sub-header begins. Mobile UX is completely unchanged — the bottom nav and mobile pill behavior stay identical.
  - Implementation notes:
    - **At desktop widths (≥1024px), the new layout is:**
      - Top header (~48px tall, spans full viewport):
        - LEFT: workspace pill `Task Management App ▾`
        - INLINE after pill: counts `11 open · 146 done`
        - RIGHT: pomodoro chip, music chip, ghost menu (unchanged from current)
      - Thin sub-band (~32px tall, spans full viewport):
        - Distinct background (subtle — e.g. `#08080d` if main header is `#0b0b11`)
        - Thin top border (`border-top: 1px solid #1a1a22`)
        - View tabs as underlined text (NOT pills):
          - Active: purple text (`#9D93EE`), purple underline (2px tall, ~80% width of text), bold weight
          - Inactive: muted gray text (`#8a8a99`), no underline, normal weight
          - Hover state: text brightens slightly
          - ~24-32px horizontal padding between tabs
      - Task pane sub-header (inside task pane, ~36px tall):
        - LEFT: filter pills `ALL / ACTIVE / IDEAS` (unchanged)
        - RIGHT: `SORT BY DUE / EXPAND ALL` controls (moved here from current position)
      - Below: compose row, task rows, COMPLETED section, TODO.md viewer (all unchanged)
    - **DOM placement (likely needs adjustment, not creation):**
      - The workspace pill (`#mobileProjHeader`) needs to move from its current parent container into the main top header container. Since D1c established the pill should already be in the desktop header, this may be a styling-only adjustment, OR if the agent placed it in the task pane's container, it needs to move up.
      - The view tabs (likely `#viewPillProjects`, `#viewPillInbox`, `#viewPillCalendar` per the codebase conventions) need to move from the main top header into the new sub-band container. Either the agent creates a new container `#desktopViewSubBand` (or similar name) and moves the tabs into it, OR the existing tabs container is repositioned and restyled.
      - The SORT BY DUE / EXPAND ALL controls — these need to move from their current row down to share the row with the filter pills.
    - **CSS for the view tabs at desktop (the key visual change):**
      - At desktop widths, the tabs lose their pill background and become text-only with a purple underline indicator on the active one.
      - Use `text-decoration` or a `::after` pseudo-element to create the underline (positioned ~2px below the text baseline, ~80% of the text width, centered).
      - Active tab styling: purple color, bold font-weight, underline visible
      - Inactive tab styling: muted gray, normal weight, no underline
      - DO NOT remove the pill styling from the tabs at MOBILE widths — mobile bottom nav should look identical to current.
    - **Mobile considerations:**
      - At mobile widths (<1024px), the existing bottom nav with view tabs as icon-pills stays exactly as it is today. None of this polish work should affect mobile.
      - The workspace pill on mobile (top of screen) stays in its current mobile position and styling.
      - The new desktop sub-band should be `display: none` at mobile widths via media query.
    - **Width / overflow consideration:**
      - The new top header has: workspace pill (~200px) + counts (~150px) + spacer + chips (~120px). Total ~470px + spacer at 1024px viewport. Comfortable at every desktop width.
      - The sub-band tabs (text + underline) are small enough that they fit easily at 1024px.
    - **What stays the same (do NOT touch):**
      - Mobile UX completely identical — bottom nav, mobile pill, slide-in drawer, all of it
      - The chat pane (D2 contract) — tabs, content, input row, workspace pill, collapse toggle (D3 contract)
      - The project drawer (D1b contract) — the workspace pill still triggers it the same way
      - Filter pills (ALL/ACTIVE/IDEAS) — their styling stays as the current pill style
      - Task rows, status indicators, INBOX, CALENDAR, pomodoro, music, voice mic, TODO.md viewer
      - The breakpoint constant (D1a contract)
    - **Critical**: do NOT modify mobile UX in any way. The view tabs at mobile must stay as the pill-style bottom nav.
    - **Critical**: do NOT modify the chat pane's view tabs (CHAT/RUNS) — those are separate from the main view tabs. They stay in their current pill style inside the chat pane.
    - **Critical**: do NOT modify the breakpoint, drawer, workspace pill identity, two-pane structure, or chat collapse toggle.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT introduce any new view tabs or remove existing ones — PROJECTS/INBOX/CALENDAR remain the three tabs.
    - **Critical**: ensure the active state of the view tabs continues to work — clicking INBOX still routes to the inbox view, etc. Don't break the existing click handlers in the restyle.
    - **Acceptance test scenarios:**
      - At desktop widths (≥1024px):
        - Top header has workspace pill on left, counts inline next to it, chips on right
        - Below: thin sub-band with view tabs as underlined text (PROJECTS active in purple with underline; INBOX and CALENDAR muted gray)
        - Task pane sub-header has filter pills LEFT and sort/expand RIGHT on same row
        - Compose row + task list below the task pane sub-header
        - Clicking INBOX tab routes to inbox view (active state updates)
        - Clicking CALENDAR tab routes to calendar view (active state updates)
        - Workspace pill click opens project drawer
        - Sort by Due toggle and Expand All dropdown still work
        - No visible "third row" of header chrome — should be just two rows (main header + sub-band)
      - At mobile widths (<1024px):
        - Bottom nav with view tabs as pill-style icons (identical to current)
        - Workspace pill at top (identical to current)
        - All mobile UX identical to current
      - Resizing across 1024px:
        - Desktop sub-band appears/disappears as the boundary is crossed
        - View tabs styling changes between desktop (underlined text) and mobile (pill icons)
        - No layout jumps or broken intermediate states
    - **Test additions:**
      - (a) At `innerWidth = 1280`, the desktop view sub-band element (`#desktopViewSubBand` or equivalent) has computed display other than `none`
      - (b) At `innerWidth = 1280`, the workspace pill is a child of (or visually positioned within) the top header element, not the task pane
      - (c) At `innerWidth = 1280`, the active view tab has a computed style indicating purple color + underline (use `getComputedStyle` to verify `color` and either `border-bottom` or `::after` content)
      - (d) At `innerWidth = 500` (mobile), the desktop sub-band is `display: none`
      - (e) At `innerWidth = 500`, the bottom nav view tabs retain their current pill styling (regression guard)
      - (f) Clicking a view tab at desktop updates the active state (the previously active tab loses its underline, the clicked one gains it)
  - Visual reference: `header-option-b.svg` from the design session — main header with workspace pill on left, counts inline, chips on right; thin sub-band below with underlined text tabs; task pane sub-header with filter pills LEFT, sort/expand RIGHT.
  - Out of scope: any structural changes to the two-pane layout (D2 contract), chat pane collapse (D3 contract), project drawer (D1b contract), the breakpoint (D1a contract). Any mobile UX changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 7a636f5f-df46-4a8c-a726-3c857ef6ff29 -->

- [x] **[HIGH]** Fix #mobileProjHeader at desktop: render as single row AND restore click-to-open-drawer behavior — Completed: 2026-06-06
  - Type: bug
  - Description: After the desktop header polish entry shipped, two regressions exist in the workspace pill (`#mobileProjHeader`) at desktop widths (≥1024px): (1) the pill renders as two stacked lines — project name on top, dropdown ▾ on a separate line below — instead of the intended single inline row, AND (2) clicking on the pill no longer opens the project drawer. Both regressions almost certainly share a root cause in the polish entry's CSS handling of `#mobileProjHeader` sub-elements. This is a HIGH priority bug because the click regression makes desktop users unable to switch projects via the pill — the primary way they were supposed to navigate after D1c retired the persistent sidebar. Mobile UX is unaffected and must remain identical.
  - Implementation notes:
    - **Diagnosis (the agent should investigate before patching):**
      - At desktop in the browser, inspect the rendered DOM of `#mobileProjHeader` and its sub-elements:
        - `#mobileProjHeader` — outer container
        - `#mobileProjLabel` — "PROJECT N OF M" text (should be hidden at desktop)
        - `#mobileProjTitleRow` — container of prev chevron + name + next chevron
        - `#mobileProjPrev` — ‹ left chevron (should be hidden at desktop)
        - `#mobileProjName` — the actual project name text
        - `#mobileProjNext` — › right chevron (should be hidden at desktop)
        - `#mobileProjStats`, `#mobileProjCounts`, `#mobileProjOpen`, `#mobileProjDone` — counts (hidden at desktop)
      - Identify the click handler binding. Check `main.js` (or wherever the workspace pill's click handler is registered) to find which element receives the click and which function it routes to (likely something like `openSidebar()` or `sidebarOpen()`).
      - Most likely scenarios for the click regression:
        - (a) The click handler is bound to `#mobileProjTitleRow` or `#mobileProjName` but the polish entry's `display: none` rules accidentally hide the element receiving clicks. Fix: make sure the receiving element is visible at desktop (e.g. by moving the click handler to `#mobileProjHeader` itself, or by ensuring the receiving sub-element retains `display: block` or `display: inline-flex`).
        - (b) The click handler is bound to a sub-element that's still visible, but a parent's `pointer-events: none` (perhaps added in polish entry) blocks clicks from reaching it. Fix: ensure `pointer-events: auto` on the receiving element.
        - (c) The click handler was bound to a wrapper that was repositioned in the DOM by the polish entry's restructuring. Fix: re-bind the handler to the new structure, or rebind to `#mobileProjHeader` itself.
      - Most likely scenarios for the two-line rendering:
        - (a) `#mobileProjHeader` has `flex-direction: column` at desktop (legacy mobile pattern). Fix: `flex-direction: row` at desktop.
        - (b) The ▾ dropdown indicator is a child element that's wrapping to a new line because the parent's `flex-wrap: wrap` is enabled OR a sibling element is pushing it down. Fix: `flex-wrap: nowrap` on the parent, OR adjust the ▾ element to be inline with the name.
        - (c) The ▾ is a `::after` pseudo-element on `#mobileProjName` but `#mobileProjName` is `display: block` causing the ::after to render on a new line. Fix: ensure `display: inline-block` or `display: inline-flex` on the name, OR move the ▾ to be a sibling element instead of a pseudo-element.
    - **Combined fix approach:**
      - At `@media (min-width: 1024px)`:
        - `#mobileProjHeader { flex-direction: row; align-items: center; gap: 6px; cursor: pointer; pointer-events: auto; width: auto; max-width: 240px; }`
        - Visible at desktop: `#mobileProjName` (and the ▾ indicator, however it's implemented)
        - Hidden at desktop: `#mobileProjLabel, #mobileProjPrev, #mobileProjNext, #mobileProjStats, #mobileProjCounts, #mobileProjOpen, #mobileProjDone { display: none; }`
        - The ▾ indicator: if it's a `::after` pseudo-element on `#mobileProjHeader`, make sure it has `content: ' ▾'`, `display: inline-block`, and `flex: 0 0 auto`. If it's a separate child element, ensure it's `display: inline-flex` or `display: inline-block`.
      - **Click binding:** if the click handler is bound to a specific sub-element that's now hidden at desktop, REBIND it to `#mobileProjHeader` directly. This ensures the whole pill area is clickable regardless of internal structure changes. Use the existing function the handler calls (don't write new logic).
      - Verify the click handler still works at mobile by testing at `innerWidth < 1024`. If the rebinding to `#mobileProjHeader` works at mobile too, that's the cleanest solution.
    - **What stays the same (do NOT touch):**
      - The view tab sub-band styling (Option B from polish entry) — stays as shipped
      - The filter pills + SORT BY DUE row — stays as shipped
      - The chat pane, drawer, breakpoint, two-pane layout, collapse toggle — all unchanged
      - Mobile UX completely identical to current — chevrons, label, counts all visible at mobile, pill click still opens drawer at mobile
      - All other components: pomodoro, music, INBOX, CALENDAR, voice mic, TODO.md viewer
    - **Critical**: do NOT modify any component outside `#mobileProjHeader` and its sub-elements.
    - **Critical**: do NOT modify the click handler's destination function (whatever opens the drawer). Just ensure the click event reaches that function.
    - **Critical**: do NOT modify mobile UX. Verify by testing at `innerWidth = 500`.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Acceptance test scenarios:**
      - At `innerWidth >= 1024`:
        - The workspace pill renders as a single inline row: project name + ▾, side-by-side, vertically centered
        - The pill's height is ≤ 32px (catches the two-line regression)
        - Clicking anywhere on the pill opens the project drawer
        - The drawer slides in correctly (D1b behavior, unchanged)
        - Selecting a project from the drawer closes the drawer AND updates the pill's text to the new project name
        - Long project names truncate with ellipsis
      - At `innerWidth < 1024`:
        - The workspace pill renders identically to current mobile behavior (chevrons, label, counts visible)
        - Clicking the pill (or its tap target) opens the drawer (unchanged)
        - All mobile UX identical to current
      - Resizing across 1024px:
        - The pill smoothly transitions between desktop (compact inline) and mobile (multi-element) layouts
        - The click handler continues to work on both sides of the boundary
    - **Test additions:**
      - (a) At `innerWidth = 1280`, `#mobileProjHeader` has computed `flex-direction: row` (not `column`)
      - (b) At `innerWidth = 1280`, the pill's computed `height` is ≤ 40px
      - (c) At `innerWidth = 1280`, simulating a click on `#mobileProjHeader` triggers the drawer-open function (verify the drawer's `.sidebar-open` class gets applied, or whatever the drawer-open state indicator is)
      - (d) At `innerWidth = 500`, the same click simulation still triggers the drawer-open function (regression guard for mobile)
      - (e) At `innerWidth = 500`, sub-elements (`#mobileProjPrev`, `#mobileProjNext`, etc.) are visible (regression guard for mobile)
  - Visual reference: `header-option-b.svg` from the polish design — workspace pill as single inline `[Task Management App ▾]` row, ~22px tall, clickable to open project drawer.
  - Out of scope: any changes to the view tab sub-band, filter pills, chat pane, drawer, two-pane layout, breakpoint, or any other component. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/style.css`, possibly `toDoList_main/src/main.js` (if click rebinding is needed), `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 317a83ac-b51d-4647-a656-ca283d643800 -->

- [x] **[MEDIUM]** Replace project drawer with anchored dropdown picker at desktop widths; color "open" text in header counts to match design — Completed: 2026-06-06
  - Type: feature
  - Description: At desktop widths (≥1024px), replace the slide-in project drawer with an anchored dropdown menu that appears below the workspace pill when clicked. The dropdown lists all projects with their names and open-task counts, highlights the active project, and dismisses on click-outside or Escape. The slide-in drawer behavior is preserved at mobile widths (<1024px) — only the desktop trigger changes. Additionally, color the "open" word in the inline header counts (e.g. "11 open · 148 done") to match the purple accent of its number rather than rendering in default text color. The "open" + its number form a unified visual unit; the "done" + its number stay in muted gray as the de-emphasized counterpart.
  - Implementation notes:
    - **The dropdown component (new UI):**
      - Create a new DOM element `#projectPickerDropdown` (or similar — match codebase naming) that's appended to the body OR positioned absolutely relative to the workspace pill. Either is fine; whichever fits cleaner.
      - Width: ~280px (auto-sizes with content but caps at 280px)
      - Max-height: ~60vh with internal scroll for cases of many projects
      - Default hidden (`display: none` or `opacity: 0` + `pointer-events: none`)
      - Position: directly below `#mobileProjHeader` with ~4px gap, left-aligned with the pill (use `position: absolute` with computed `top` and `left` based on the pill's bounding rect)
      - Background: `#15151e`
      - Border: `1px solid #3a3a50`
      - Border-radius: `8px`
      - Drop shadow: subtle (`box-shadow: 0 8px 24px rgba(0,0,0,0.4)`)
      - z-index: above task content but below modals (e.g. `z-index: 100`)
    - **Dropdown contents:**
      - Header label: small "PROJECTS" text in muted gray (`#5a5a6a`), 10px, uppercase, letter-spacing for that "section header" feel. Padding: `8px 16px`.
      - Project rows:
        - Each row: `32px` height, `padding: 0 16px`, displays project name (left) + open-task count (right)
        - Active project: purple left-accent (3px wide `#6C5DF5` stripe), purple-tinted background (`#6C5DF5` at 18% opacity), purple text for name and count (`#9D93EE`), small `✓` indicator before the count
        - Non-active project: regular text (`#e8e8f0` for name), muted gray count (`#8a8a99`)
        - Zero-count project: same name color, count in extra-muted gray (`#5a5a6a`) so empty projects feel quieter
        - Hover state: light background tint (e.g. `rgba(255,255,255,0.04)`)
        - Clicking a row: invokes the existing project-selection function (same one the drawer's item clicks call), then dismisses the dropdown
      - Divider (`1px solid #2a2a3a`) between project list and footer
      - Footer: "+ New project" action in purple (`#9D93EE`), 12px text, hover state same as project rows. Clicking invokes whatever the existing "create new project" flow is — if no existing flow, OMIT this footer entirely (don't invent new functionality). If unsure, search the codebase for existing project-creation code (likely in `listLogic.js` or a settings menu). If no such flow exists, leave the footer out.
    - **Dropdown open/close logic:**
      - At desktop (≥1024px), clicking `#mobileProjHeader` opens the dropdown INSTEAD of opening the drawer. Do not open the drawer at desktop — the dropdown replaces it.
      - At mobile (<1024px), clicking `#mobileProjHeader` opens the drawer as today. No change.
      - Dismissal: clicking anywhere outside the dropdown closes it. Pressing Escape closes it. Clicking a project row closes it. Clicking the pill again while it's open closes it (toggle behavior).
      - Use a flag like `dropdownOpen` in state OR check the DOM class on the dropdown element. Either is fine.
      - The pill's `▾` indicator can flip to `▴` when the dropdown is open (purely visual feedback). The pill's border can also accent purple when open (`border-color: #9D93EE`) — see the mockup. Both are optional polish; just one of the two is sufficient.
    - **Click handler routing:**
      - The existing click handler on `#mobileProjHeader` (which calls `openSidebar()` or similar after the previous fix) needs to branch on viewport width:
        - At desktop: open dropdown
        - At mobile: open drawer (existing behavior)
      - Implement this branch inline OR via a single function that handles both. Don't duplicate the click binding.
    - **Project list data:**
      - REUSE the same data source the drawer uses. Don't duplicate the list of projects. The dropdown and drawer should always show the same projects in the same order.
      - When the user creates/deletes/renames a project, both surfaces update via the existing data flow.
      - Open-task counts: use the existing per-project task-count computation. If this doesn't exist in a reusable form, write it once and use it from both surfaces.
    - **At mobile widths (<1024px):**
      - The dropdown should NEVER appear at mobile. `@media (max-width: 1023px) { #projectPickerDropdown { display: none !important; } }` ensures this.
      - The drawer continues to work identically. Don't touch mobile UX at all.
    - **Color the "open" text in header counts:**
      - In the top header next to the workspace pill, the inline counts currently render as something like `<span>11 open · 148 done</span>` (or with separate spans per number/word).
      - The desired styling:
        - "11 open" — both number AND word in purple `#6C5DF5` (or your primary accent). Together they form a unified visual element.
        - "·" separator — muted gray (e.g. `#8a8a99`)
        - "148 done" — both number AND word in muted gray (e.g. `#5a5a6a`). De-emphasized to make "open" stand out.
      - If "open" is currently rendered as default white/light text, wrap it in a span with the appropriate class so it gets the purple color matching "11". Same for "done" matching its number.
      - This is a small CSS adjustment. Should be minimal code.
    - **What stays the same:**
      - Mobile drawer behavior — completely unchanged
      - All other components: chat pane, view tabs, filter pills, sort/expand, compose row, task rows, INBOX, CALENDAR, pomodoro, music, voice mic, TODO.md viewer
      - The project-selection function — same function called from both dropdown and drawer
      - The breakpoint constant (1024px)
      - All chat collapse toggle, two-pane structure, drawer 3-way close behavior
    - **Critical**: do NOT modify mobile UX. Drawer must work identically at mobile.
    - **Critical**: do NOT duplicate project list data. Both surfaces read from the same source.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT introduce a new "create project" code path. Either reuse existing OR omit the "+ New project" footer.
    - **Critical**: do NOT break the drawer's three-way close at mobile. The drawer's X button, backdrop, and Escape handler all still work.
    - **Acceptance test scenarios:**
      - At `innerWidth >= 1024`:
        - Clicking the workspace pill opens the dropdown anchored below it, NOT the drawer
        - The dropdown shows all projects with names + counts
        - Active project is highlighted (purple accent stripe, purple text, ✓)
        - Non-active projects show name in regular text + count in muted gray
        - Zero-count projects show count in extra-muted gray
        - Clicking a non-active project: switches to that project, dropdown closes, pill text updates
        - Clicking the active project (or clicking outside the dropdown, or pressing Escape): dropdown closes, no project change
        - Pill's `▾` flips to `▴` (or pill border accents purple) when dropdown is open
        - Drawer is NEVER shown at desktop widths
      - At `innerWidth < 1024`:
        - Clicking the workspace pill opens the drawer (unchanged from current behavior)
        - The dropdown is never visible at mobile
        - All mobile UX identical to current
      - Header count coloring:
        - At all breakpoints: "11 open" renders in purple, "148 done" in muted gray, "·" in medium gray
        - Both numbers and their respective words use matching colors
      - Resizing across 1024px:
        - At desktop: pill opens dropdown
        - At mobile: pill opens drawer
        - Switching breakpoint mid-session works correctly (no stale state)
    - **Test additions:**
      - (a) At `innerWidth = 1280`, clicking the pill makes `#projectPickerDropdown` visible (computed display ≠ none)
      - (b) At `innerWidth = 1280`, clicking the pill does NOT trigger the drawer-open function
      - (c) At `innerWidth = 1280`, clicking a project row in the dropdown invokes the project-selection function
      - (d) At `innerWidth = 1280`, clicking outside the dropdown closes it
      - (e) At `innerWidth = 1280`, pressing Escape closes the dropdown
      - (f) At `innerWidth = 500`, clicking the pill triggers the drawer-open function (NOT the dropdown)
      - (g) At `innerWidth = 500`, `#projectPickerDropdown` is always `display: none`
      - (h) The "open" text in header has computed color matching the purple accent (not default text color); "done" text has computed muted gray color
  - Visual reference: `project-picker-dropdown.svg` from the design session — dropdown anchored below the pill, ~280px wide, project rows with names + counts, active project with purple accent and ✓.
  - Out of scope: any changes to the chat pane, drawer behavior at mobile, view tabs, filter pills, breakpoint, two-pane structure, or any other shipped component. Any new project-creation flow that doesn't already exist. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, possibly `toDoList_main/src/listLogic.js` (if a new helper for project counts is needed), `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 4a48a7ee-ecdd-4b7e-9f4d-95713e1dc19f -->

- [x] **[HIGH]** Fix project picker dropdown click handler — only opens "sometimes" due to event race condition — Completed: 2026-06-06
  - Type: bug
  - Description: After the dropdown picker shipped, clicking the workspace pill at desktop widths sometimes opens the dropdown and sometimes does nothing visible (or causes a brief flash). The behavior is non-deterministic, indicating an event handler race condition rather than a logic bug. This is HIGH priority because the dropdown is the primary way users switch projects at desktop after the drawer was retired — unreliable behavior makes the pill effectively broken. Mobile UX is unaffected and must remain identical.
  - Implementation notes:
    - **Diagnosis (the agent should verify before patching):**
      - Open the desktop view in browser devtools. Click the workspace pill repeatedly. Observe:
        - Does the dropdown briefly appear and disappear (open + close in same tick)?
        - Are multiple click handlers registered on `#mobileProjHeader`? Check Event Listeners in devtools.
        - Is the document-level click-outside listener attached BEFORE the dropdown becomes visible (synchronous registration), or AFTER (deferred via setTimeout/RAF)?
      - Search `main.js` (or wherever the dropdown click handler lives) for:
        - The click handler on `#mobileProjHeader` — confirm it's registered exactly once and uses the `window.__hydrateListenerRegistered` one-shot guard pattern (or equivalent) to prevent multi-bundle double-registration
        - The document-level click-outside dismiss handler — confirm how/when it's attached
        - The Escape key dismiss handler — confirm proper registration
    - **Most likely root cause: click-outside handler catches the opening click.**
      - When the pill is clicked, the pill's click handler runs first (opens dropdown), then the event bubbles to document. If the document-level "click outside dropdown → close" handler is already attached, it sees the click and may interpret it as "outside the dropdown" because the dropdown JUST appeared and the click target was the pill (not the dropdown content), triggering close.
      - **Two correct fixes (pick one — DO NOT do both):**
        - (a) **Defer click-outside attachment to the next tick.** When the dropdown opens, attach the document click-outside listener via `setTimeout(() => { document.addEventListener('click', closeHandler) }, 0)` OR `requestAnimationFrame(() => { document.addEventListener('click', closeHandler) })`. This ensures the opening click has fully bubbled and resolved before the dismiss listener is live.
        - (b) **Check the click target in the dismiss handler.** In the document click-outside handler, explicitly check if `event.target` is `#mobileProjHeader` or any descendant of it. If yes, ignore the click (the pill handler is responsible). If no, proceed with dismissal. Use `event.target.closest('#mobileProjHeader')` for a clean check.
      - The agent should pick (a) OR (b) — whichever fits the existing code structure better. Don't apply both; they're alternative solutions to the same problem.
    - **Multi-bundle double-registration check:**
      - Per CLAUDE.md, the codebase has a known issue where `main.js` evaluates more than once due to multiple webpack entry bundles. If the dropdown click handler is registered at module level WITHOUT a one-shot guard, it will be registered N times where N is the number of bundles.
      - Verify the dropdown handler uses the existing `window.__hydrateListenerRegistered` (or similar) one-shot pattern. If not, wrap the registration:
```js
        if (!window.__dropdownListenerRegistered) {
          window.__dropdownListenerRegistered = true;
          // ... register handler
        }
```
      - Apply the same pattern to the click-outside handler and the Escape key handler if they have the same issue.
    - **Toggle behavior verification:**
      - The original entry asked for "click pill while dropdown is open → close it." This should still work after the fix.
      - In the pill's click handler, check if dropdown is currently open: if open, close it; if closed, open it. This is toggle logic.
      - Make sure the click-outside handler doesn't also fire on this same toggle-close click, causing a "close then immediately re-open" loop.
    - **Critical**: do NOT modify the dropdown's content, styling, or visual design — only the event handler logic.
    - **Critical**: do NOT modify mobile drawer behavior. Verify by testing at `innerWidth = 500`.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT touch any other component (chat pane, view tabs, filter pills, etc.).
    - **Critical**: do NOT reintroduce the drawer at desktop — the dropdown is the desktop pattern now.
    - **Acceptance test scenarios:**
      - At `innerWidth >= 1024`:
        - Clicking the pill opens the dropdown — every single time, with no flashing or partial states
        - Clicking the pill while the dropdown is open closes it (toggle works)
        - Clicking outside the dropdown closes it
        - Pressing Escape closes the dropdown
        - Clicking a project row closes the dropdown and switches projects
        - Repeated rapid clicking (e.g. 10 clicks in a row) produces consistent toggle behavior — no stuck states
      - At `innerWidth < 1024`:
        - Drawer behavior identical to current (verified working)
        - Dropdown never shown
    - **Test additions:**
      - (a) At `innerWidth = 1280`, simulating a click on `#mobileProjHeader` makes `#projectPickerDropdown` visible AND it remains visible after the click event completes (catches the "opens then immediately closes" race)
      - (b) At `innerWidth = 1280`, simulating a click on `#mobileProjHeader` while the dropdown IS visible makes it hidden (toggle works)
      - (c) At `innerWidth = 1280`, simulating a click on `document.body` while the dropdown is open closes it
      - (d) The click handler on `#mobileProjHeader` is registered exactly once (use a counter or check window.__dropdownListenerRegistered flag is set)
      - (e) At `innerWidth = 500`, the same click handler routes to drawer-open, not dropdown-open (regression guard for mobile)
  - Visual reference: `project-picker-dropdown.svg` from the design session — dropdown behavior should be reliable, not intermittent.
  - Out of scope: any visual changes to the dropdown, any drawer behavior changes, any other component. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/main.js`, possibly `toDoList_main/src/style.css` (only if a `pointer-events` adjustment is needed), `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: f28db964-3307-45c4-a9db-a3a07c1a9ec0 -->

- [x] **[LOW]** Increase vertical spacing between desktop header rows (workspace pill → sub-band → filter pills → compose) — Completed: 2026-06-06
  - Type: bug
  - Description: At desktop widths (≥1024px), the header rows are stacked too tightly together — the workspace pill row, the view tab sub-band (PROJECTS/INBOX/CALENDAR), the filter pills row (ALL/ACTIVE/IDEAS), and the compose row sit nearly flush against each other with minimal vertical gap. The design intent (per `header-option-b.svg` mockup) was modest breathing room between these distinct chrome sections to establish visual hierarchy. This entry adjusts the vertical spacing to match the mockup. CSS-only fix.
  - Implementation notes:
    - **At desktop widths (≥1024px), the gaps should be approximately:**
      - Between top header (workspace pill + counts row, ~48px tall) and the view tab sub-band: keep flush or with very small gap (4-6px max) — these are conceptually part of the same header region
      - Between the view tab sub-band and the filter pills row: ~16-20px vertical gap. This is the largest gap — it separates "global navigation" (which view, which project) from "task-pane controls" (which filter, sort)
      - Between the filter pills row and the compose row: ~12-16px vertical gap
      - Between the compose row and the first task row: ~8-12px vertical gap (current spacing is probably fine here, just verify)
    - **Approach: padding/margin on the appropriate containers.**
      - The task pane has multiple sections; the agent should identify where each row's container lives in the DOM and apply `margin-top` or `padding-top` to add the gap.
      - Use `padding-top` on the receiving container rather than `margin-bottom` on the giving container — easier to reason about and less prone to margin collapse issues.
      - At mobile widths (<1024px), do NOT change spacing. Mobile chrome may have different proportions that work well as-is. Scope the spacing changes to `@media (min-width: 1024px)`.
    - **Visual reference:** the `header-option-b.svg` mockup from the design session is the target. The gaps in that mockup are visible to the eye — distinct sections separated by clear vertical space, not flush stacking.
    - **What stays the same:**
      - Mobile UX completely unchanged (no spacing adjustments at <1024px)
      - The chrome elements themselves: workspace pill, view tabs, filter pills, sort/expand, compose row, task rows — all unchanged
      - Chat pane (no changes there)
      - All previously-shipped contracts (breakpoint, drawer, two-pane, etc.)
    - **Critical**: do NOT modify mobile spacing.
    - **Critical**: do NOT modify any chrome element's own styling (background, border, padding, text) — only the gaps BETWEEN them.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT change the height or position of the top header itself.
    - **Acceptance test scenarios:**
      - At `innerWidth >= 1024`:
        - Visible vertical gap between the view tab sub-band and the filter pills row (~16-20px)
        - Visible vertical gap between the filter pills row and the compose row (~12-16px)
        - The top header and the sub-band can be flush or have a very small gap (4-6px max)
        - The layout matches `header-option-b.svg` in terms of vertical rhythm — distinct sections with breathing room
      - At `innerWidth < 1024`:
        - Mobile spacing identical to current (no regression)
    - **Test additions:**
      - (a) At `innerWidth = 1280`, the computed distance between the bottom of the view tab sub-band and the top of the filter pills row is >= 12px (catches the regression of "everything flush")
      - (b) At `innerWidth = 1280`, the computed distance between the bottom of the filter pills row and the top of the compose row is >= 8px
      - (c) At `innerWidth = 500`, the spacing is unchanged from current (use a baseline assertion if practical)
  - Visual reference: `header-option-b.svg` from the design session — desktop layout with breathing room between sections.
  - Out of scope: any chrome element changes, mobile spacing changes, any other component changes, the cycle pill UI change (separate entry if still desired). **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: fc8d7d8a-1ea6-4d27-bcb9-157d2f3864d9 -->

- [x] **[LOW]** Remove sub-band background to eliminate visible color stripe between view tabs and filter pills — Completed: 2026-06-06
  - Type: bug
  - Description: At desktop widths (≥1024px), the view tab sub-band (containing PROJECTS/INBOX/CALENDAR) has a slightly different background color than the page (`#08080d` vs `#07070c`). With the recent spacing changes adding gap between the sub-band and the filter pills row, the sub-band's distinct background is now visible as a horizontal "stripe" of slightly-lighter color extending below the tabs. This entry removes the sub-band's distinct background so the tabs sit directly on the page background — no stripe, no visible color shift. The tabs themselves and their underline indicator remain visually identical; only the band's background color is removed.
  - Implementation notes:
    - **The change is small and surgical:**
      - Locate the CSS rule for the desktop view tab sub-band container (likely `#desktopViewSubBand`, `.desktop-view-tabs-band`, or similar — agent should grep the codebase for the recent sub-band styling and find the actual selector).
      - In the rule(s) scoped to `@media (min-width: 1024px)`, REMOVE:
        - `background: #08080d` (or whatever the distinct background color is)
        - Any `border-top` or `border-bottom` properties on the band container (the visible thin borders were paired with the background to mark the band region)
      - DO NOT remove or modify:
        - The tab elements themselves (PROJECTS/INBOX/CALENDAR text)
        - The active tab's purple text color
        - The active tab's purple underline indicator
        - The tabs' click handlers
        - The padding/positioning of the tabs within the band area — they should still sit where they sit today, just without the band's distinct background
    - **At mobile widths (<1024px):**
      - If the mobile view doesn't use a similar sub-band (mobile uses the bottom nav for view tabs), this change has no mobile effect.
      - If for any reason the mobile UI shares the same selector, ensure the mobile styling is preserved — only the desktop background should change.
    - **What stays the same:**
      - All other components: workspace pill, counts, chips, filter pills, sort/expand, compose row, task list, chat pane, all of it
      - The tabs' click behavior, active state, underline indicator
      - The vertical spacing between sections (the recent spacing entry's changes stay intact)
      - Mobile UX completely unaffected
      - The breakpoint constant, drawer, two-pane structure, all previously-shipped contracts
    - **Critical**: do NOT modify any element other than the sub-band container's background and borders.
    - **Critical**: do NOT change the vertical spacing — that's the previous entry's contract.
    - **Critical**: do NOT modify the tabs' styling beyond removing the parent container's background.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT modify mobile UX in any way.
    - **Acceptance test scenarios:**
      - At `innerWidth >= 1024`:
        - The PROJECTS/INBOX/CALENDAR tabs are visible (text + underline indicator on active)
        - The area around the tabs has the same background color as the rest of the page (no visible color stripe)
        - The clickable area for each tab is unchanged (clicking PROJECTS still routes to projects view, etc.)
        - The active tab's purple text + underline still indicate the active state
        - No visible horizontal stripe between the tab row and the filter pills row
      - At `innerWidth < 1024`:
        - Mobile UX completely unchanged
    - **Test additions:**
      - (a) At `innerWidth = 1280`, the computed `background-color` of the sub-band container is transparent OR matches the page background (`#07070c` or equivalent rgba)
      - (b) At `innerWidth = 1280`, the sub-band container's `border-top` and `border-bottom` are both `none` or `0`
      - (c) At `innerWidth = 1280`, the tabs themselves still render with their existing colors (the active tab's text color is unchanged)
  - Visual reference: `subband-spacing-options.svg` Option A from the design session — tabs sit directly on the page background with no distinct band.
  - Out of scope: any tab styling changes, any spacing changes (kept from previous entry), any chrome element changes, any mobile UX changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 9b393636-0f69-4efc-a7c4-20b2e2711103 -->

- [x] **[MEDIUM]** Align chat pane sub-header row with task pane view tabs sub-band at desktop widths — Completed: 2026-06-06
  - Type: bug
  - Description: At desktop widths (≥1024px), the chat pane and task pane do not share a horizontal coordinate system for their sub-header rows. In the task pane, the view tabs sub-band (PROJECTS/INBOX/CALENDAR) sits directly below the top header. In the chat pane, the collapse `›` button sits on its own row directly below the top header, with the CHAT/RUNS tabs (and the repo workspace pill) placed on a separate row below it. The result: when scanning horizontally across the pane divider, the panes look misaligned — the chat pane's content starts at a different vertical position than the task pane's content. This entry aligns the chat pane's sub-header row with the task pane's view tabs sub-band, so both panes have a peer "first row under the main header" at the same vertical position. Mobile UX is unaffected (mobile uses the slide-up chat sheet, not the desktop pane).
  - Implementation notes:
    - **Target alignment:**
      - Top header (full width): row 1 — workspace pill on left + counts + chips on right (UNCHANGED)
      - Sub-header row: row 2 — BOTH panes have content at this y-coordinate
        - Task pane (left of divider): PROJECTS/INBOX/CALENDAR view tabs (already there, UNCHANGED)
        - Chat pane (right of divider): collapse `›` + CHAT/RUNS tabs + repo workspace pill — all on the same row, sitting at the same vertical position as the task pane's view tabs
      - Below sub-header: each pane has its own content
        - Task pane: filter pills row, compose row, task rows, COMPLETED, TODO.md viewer
        - Chat pane: messages area, input row at bottom
    - **Likely DOM structure to verify (the agent should inspect the actual code):**
      - The chat pane's outer container is likely `#desktopChatPane`. Currently its first child is likely the collapse button OR a header container that holds collapse + tabs + repo pill in vertically stacked sub-elements.
      - The fix: ensure the chat pane's top section is a single horizontal flex row containing: collapse button (left) + CHAT/RUNS tabs (left-center) + repo workspace pill (right, pushed via `margin-left: auto`).
      - Match this row's height to the task pane's view tabs sub-band height (likely ~32-36px).
      - Vertical positioning: this row sits immediately below the main header, with the SAME `margin-top` (or `padding-top`) as the task pane's view tabs sub-band — ideally 0 or minimal so both rows start at the same y-coordinate.
    - **CSS changes (at `@media (min-width: 1024px)`):**
      - The chat pane's top region needs to be a single flex row:
    .chat-pane-top-row { /* or whatever the actual selector is */
      display: flex;
      align-items: center;
      height: 36px;
      padding: 0 16px;
      margin-top: 0; /* or matching the task pane sub-band's offset */
      gap: 12px;
    }
      - Collapse button sits inline (no longer on its own row)
      - CHAT/RUNS tabs sit inline next to collapse button
      - Repo workspace pill pushed to the right via `margin-left: auto` or `justify-self: flex-end`
    - **Vertical position alignment:**
      - The task pane's view tabs sub-band currently sits at some y-coordinate `Y1` below the top header
      - The chat pane's sub-header row must also sit at `Y1`, not some larger value
      - If the chat pane has any padding/margin pushing its content down (e.g. `padding-top: 16px`), reduce or remove it so the sub-header row sits flush below the main header
      - Use the dev tools to measure: the task pane's view tabs row's `getBoundingClientRect().top` should approximately equal the chat pane's sub-header row's `getBoundingClientRect().top` (within a few pixels for natural padding differences)
    - **What stays the same:**
      - All chat content rendering — message history, voice input, send, mic, popovers
      - All chat behavior — sending messages, the chat collapse/expand toggle
      - Task pane — view tabs, filter pills, compose, task list, COMPLETED, TODO.md viewer
      - Mobile UX completely unchanged (mobile uses chat sheet, not pane)
      - The breakpoint constant, drawer, project picker dropdown, all previously-shipped contracts
      - The two-pane structure itself (just the chat pane's internal sub-header layout changes)
      - The chat pane width / split ratio
    - **Critical**: do NOT modify mobile UX. Verify by testing at `innerWidth = 500`.
    - **Critical**: do NOT modify the task pane's layout — the view tabs sub-band stays where it is. Only the chat pane's internal sub-header restructures to align with it.
    - **Critical**: do NOT change the collapse/expand toggle's behavior — it should still hide/show the chat pane via the existing localStorage flag. Only its visual position changes (moves into the sub-header row).
    - **Critical**: do NOT modify the project picker dropdown.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT change the chat content (messages area, input row) — only the chat pane's top section restructures.
    - **Acceptance test scenarios:**
      - At `innerWidth >= 1024`:
        - When inspecting the DOM, the chat pane's sub-header row contains: collapse button, CHAT/RUNS tabs, and the repo workspace pill — all in a single horizontal flex row
        - The y-coordinate of the chat pane's sub-header row's top edge matches the y-coordinate of the task pane's view tabs sub-band top edge (within ~4px tolerance)
        - The CHAT/RUNS tabs are visible at the same height as the PROJECTS/INBOX/CALENDAR tabs
        - The collapse button still toggles the chat pane open/closed (D3 behavior)
        - The repo workspace pill still opens its dropdown when clicked
        - The chat pane's content area (messages + input) is unchanged in behavior
      - At `innerWidth < 1024`:
        - Chat sheet (not pane) behavior identical to current — mobile UX unchanged
    - **Test additions:**
      - (a) At `innerWidth = 1280`, the chat pane's sub-header row and the task pane's view tabs sub-band have approximately equal `top` values (use `getBoundingClientRect()`)
      - (b) At `innerWidth = 1280`, the chat pane's collapse button is on the same row as the CHAT/RUNS tabs (verify via parent element or y-coordinate)
      - (c) At `innerWidth = 1280`, the chat collapse button still toggles the chat pane visibility (click + verify state)
      - (d) At `innerWidth = 500`, chat sheet behavior unchanged (regression guard)
  - Visual reference: `two-pane-alignment.svg` from the design session — both panes' sub-header rows align horizontally; chat pane's collapse button, tabs, and repo pill all on the same row.
  - Out of scope: any task pane layout changes (the view tabs sub-band stays where it is), any chat content changes (messages, input row), the cycle pill UI (separate entry if pursued), any mobile UX changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/style.css`, possibly `toDoList_main/src/main.js` (only if DOM restructuring is needed), possibly `toDoList_main/src/claudeSheet.js`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 29b70b21-f014-46f3-8132-62f429b3f38b -->

- [x] **[MEDIUM]** Two-pane alignment: roomier sub-header spacing, segmented-control CHAT/RUNS tabs, both panes' sub-headers align — Completed: 2026-06-06
  - Type: feature
  - Description: At desktop widths (≥1024px), refine the two-pane sub-header alignment with three coordinated changes: (1) add ~16px vertical gap between the top header and the sub-header row in both panes — currently they sit too flush; (2) align the chat pane's sub-header row at the same vertical position as the task pane's view tabs sub-band (currently the chat pane's collapse button sits above the tabs on its own row, misaligned); (3) restyle the CHAT/RUNS tabs as a segmented control — a single rounded container with the active half highlighted, replacing the separate-pills layout. The repo workspace pill sits on the right of the chat sub-header row. The collapse `›` button sits inline at the left of the chat sub-header row, in line with CHAT/RUNS. Mobile UX is unaffected (mobile uses the slide-up chat sheet, not the desktop pane).
  - Implementation notes:
    - **Layout structure (at desktop, ≥1024px):**
      - Top header (row 1, ~48px tall, full viewport): workspace pill + counts on left, chips on right (UNCHANGED)
      - 16px vertical gap (visible empty space between top header and sub-header row)
      - Sub-header row (~36px tall, full viewport width but content split between panes):
        - Task pane (left of divider): PROJECTS/INBOX/CALENDAR view tabs (UNCHANGED — already underlined-text style)
        - Chat pane (right of divider, from left to right): collapse `›` button, CHAT/RUNS segmented control, (spacer pushes right), repo workspace pill
      - Below sub-header: each pane has its own content rhythm
    - **CHAT/RUNS as segmented control:**
      - A single rounded outer container (`border-radius: 13px`, `border: 1px solid #3a3a50`, `background: #15151e`)
      - Width: ~152px total (76px per half)
      - Two halves inside, side-by-side, no gap between them
      - Active half: solid purple background (`#6C5DF5`), white text (`#e8e8f0`), bold weight, slightly inset rounded shape (`border-radius: 12px` to fit inside the outer 13px radius)
      - Inactive half: transparent background, muted gray text (`#8a8a99`), regular weight
      - Clicking inactive half: switches active state, slides/snaps the highlight
      - Outer container is a single click target with internal logic, OR two halves each click-handled separately — either is fine, agent picks based on existing code
      - Optional: a brief CSS transition on the active highlight position (`transition: background 0.15s ease`) for polish — skip if it adds complexity
    - **Chat pane sub-header row structure:**
      - Single horizontal flex row containing (left to right): collapse `›`, segmented control (CHAT/RUNS), spacer, repo workspace pill
      - `display: flex; align-items: center; gap: 12px;`
      - Height matches the task pane's view tabs sub-band (~36px)
      - The repo workspace pill uses `margin-left: auto` to push to the right edge
      - Vertical position: top of this row should be at the same y-coordinate as the top of the task pane's view tabs sub-band (within ~4px tolerance)
    - **16px gap above the sub-header row:**
      - The gap applies to BOTH panes' sub-header rows (since they align, the gap is the same)
      - Apply via `padding-top: 16px` on the container that holds both panes' sub-header rows, OR `margin-top: 16px` on each sub-header row individually — pick whichever fits the existing structure
      - The space should be empty/transparent (showing page background `#07070c`)
    - **What stays the same:**
      - Top header — workspace pill, counts, chips unchanged
      - Task pane view tabs — PROJECTS/INBOX/CALENDAR still in underlined-text style
      - Task pane content below sub-header — filter pills, sort/expand, compose, task list, COMPLETED, TODO.md viewer — all unchanged
      - Chat pane content below sub-header — messages area, input row with mic/send — unchanged
      - The chat collapse toggle behavior (D3) — still toggles via localStorage; only the button's visual position changes
      - The repo workspace pill — still opens its dropdown when clicked
      - Project picker dropdown — unchanged
      - Mobile UX completely unaffected (chat sheet, not pane)
      - All previously-shipped contracts: breakpoint, drawer, project picker, two-pane structure, chat collapse
    - **Critical**: do NOT modify mobile UX. Verify by testing at `innerWidth = 500`.
    - **Critical**: do NOT modify the task pane's view tabs (PROJECTS/INBOX/CALENDAR) — they stay as underlined text. Only the chat pane's tabs become segmented.
    - **Critical**: do NOT modify chat content (messages area, input row).
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT modify the project picker dropdown.
    - **Critical**: do NOT change the collapse toggle's behavior — only its visual position (moves into the sub-header row inline with tabs).
    - **Critical**: do NOT use Sort by Due / Expand All position from task pane as a reference for chat sub-header — those stay on the filter pills row in the task pane.
    - **Acceptance test scenarios:**
      - At `innerWidth >= 1024`:
        - Visible ~16px gap between top header and sub-header row (eyeball test: the gap is clearly larger than 4px and clearly smaller than 32px)
        - Chat pane's collapse button, CHAT/RUNS segmented control, and repo pill are all on the same horizontal row
        - Chat pane's sub-header row top y-coordinate matches task pane's view tabs sub-band top y-coordinate (within ~4px)
        - CHAT/RUNS render as a single segmented control with rounded outer border, active half highlighted in purple
        - Clicking inactive RUNS half switches active state to RUNS
        - Clicking inactive CHAT half (when RUNS is active) switches back to CHAT
        - The collapse button still toggles the chat pane open/closed
        - The repo workspace pill still opens its dropdown
      - At `innerWidth < 1024`:
        - Chat sheet behavior identical to current (mobile chat sheet, not pane)
        - All mobile UX unchanged
    - **Test additions:**
      - (a) At `innerWidth = 1280`, the y-coordinate of the chat sub-header row equals the y-coordinate of the task pane's view tabs sub-band (`getBoundingClientRect().top`, within 4px tolerance)
      - (b) At `innerWidth = 1280`, the CHAT/RUNS tabs are within a single parent container (the segmented control)
      - (c) At `innerWidth = 1280`, computed CSS shows the segmented control container has rounded `border-radius` and a `border` styling
      - (d) At `innerWidth = 1280`, the gap between the top header's bottom and the sub-header row's top is ≥ 12px
      - (e) At `innerWidth = 1280`, clicking the inactive segmented half switches the active state
      - (f) At `innerWidth = 1280`, the collapse button still triggers the chat pane visibility toggle
      - (g) At `innerWidth = 500`, chat sheet behavior unchanged (regression guard)
  - Visual reference: `chat-tabs-layout-options.svg` Option C from the design session — CHAT/RUNS as segmented control inside a single rounded container, sub-header row aligned with task pane, 16px gap above.
  - Out of scope: any task pane layout changes (view tabs stay as underlined text), filter pill changes (cycle pill is separate entry if pursued), chat content changes, mobile UX changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/style.css`, possibly `toDoList_main/src/main.js` (only if DOM restructuring is needed), possibly `toDoList_main/src/claudeSheet.js`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: ebacfc08-7079-417d-9bda-8f9caedeaaa7 -->

- [x] **[LOW]** Paint the 16px gap above sub-header rows with pane background color (eliminate color discontinuity) — Completed: 2026-06-06
  - Type: bug
  - Description: At desktop widths (≥1024px), there's a 16px vertical gap between the top header (navbar) and the sub-header row containing the view tabs (PROJECTS/INBOX/CALENDAR) on the left and the segmented chat tabs (CHAT/RUNS + collapse + repo pill) on the right. Currently this gap renders with the page background color (`#07070c`), which is visibly darker than the chat pane's content background (`#0b0b11`). The result: a thin darker stripe between the navbar and the sub-header row on the chat side. This entry paints the gap with the pane's background color so the chat pane appears as one continuous colored region from sub-header down to bottom. The same fix applies to the task pane for consistency (eliminates the same discontinuity, even if less visually obvious there). The 16px gap is preserved — the change is purely cosmetic, no spacing alteration.
  - Implementation notes:
    - **The change is surgical CSS:**
      - Identify where the 16px gap currently sits. Most likely it's `margin-top` on the sub-header row container or `padding-top` on a wrapper above the panes' content. Find the actual selector via inspect element.
      - Move the gap from "between navbar and pane wrapper" to "inside each pane as padding-top". Specifically:
        - REMOVE the 16px gap from its current location (e.g. delete `margin-top: 16px` on the sub-header row, or `padding-top: 16px` on a wrapper)
        - ADD `padding-top: 16px` to the outer container of each pane (e.g. `#desktopChatPane` and the task pane's outer container)
      - The visual result: same 16px of vertical space, but it's now painted by the pane's background color instead of the page background.
    - **Pane background colors to verify match:**
      - Chat pane container: `background: #0b0b11` (or whatever the actual color is)
      - Task pane container: usually inherits the page background OR has its own — verify against the actual codebase. If task pane uses page bg, the task-side gap won't look different, which is fine.
      - Whatever each pane is painted with, the new `padding-top` region should inherit that background.
    - **At mobile widths (<1024px):**
      - Scope the `padding-top: 16px` rule to `@media (min-width: 1024px)` only — mobile uses the chat sheet, not a pane, so this doesn't apply.
    - **What stays the same:**
      - Visible vertical spacing — still ~16px between navbar bottom and sub-header row top
      - Sub-header row alignment — both panes' rows still align at the same y-coordinate
      - Top header / navbar — unchanged
      - Segmented CHAT/RUNS control, view tabs, repo pill, collapse button — all unchanged
      - Filter pills, sort/expand, compose row, task list, chat content — unchanged
      - Project picker dropdown, mobile UX, all previously-shipped contracts — unchanged
    - **Critical**: do NOT change the visible spacing — the gap remains ~16px tall to the eye.
    - **Critical**: do NOT change pane content backgrounds.
    - **Critical**: do NOT modify mobile UX.
    - **Critical**: do NOT modify the TODO.md viewer.
    - **Critical**: do NOT change the navbar's height or background.
    - **Acceptance test scenarios:**
      - At `innerWidth >= 1024`:
        - The vertical region immediately above the chat pane's sub-header row has the same background color as the chat pane's content area below it (no visible darker stripe)
        - The vertical region immediately above the task pane's sub-header row has the same background color as the task pane's content area
        - The visible spacing between navbar bottom and sub-header row top is approximately unchanged (~16px tall)
        - Both panes' sub-header rows still align at the same y-coordinate
        - The chat pane appears as one continuous colored region from sub-header to bottom
      - At `innerWidth < 1024`:
        - Mobile UX unchanged
    - **Test additions:**
      - (a) At `innerWidth = 1280`, the computed `background-color` of the chat pane's `padding-top` region matches the chat pane's content background (sample a pixel from each region and compare)
      - (b) At `innerWidth = 1280`, the visible distance between the navbar bottom edge and the sub-header row top edge is still ≥ 12px
      - (c) At `innerWidth = 1280`, both panes' sub-header rows still have approximately equal `top` y-coordinates (within 4px)
      - (d) At `innerWidth = 500`, no `padding-top` of 16px is applied to the chat pane (regression guard for mobile)
  - Visual reference: `navbar-gap-variations.svg` Variation 2 from the design session — the gap remains but is painted with each pane's background color, eliminating the color discontinuity.
  - Out of scope: any other layout changes, navbar restyling, mobile UX changes. **Do NOT modify the TODO.md viewer.**
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 49b88e7a-acfb-42a7-a473-412101b52117 -->

- [x] **[HIGH]** Pass the active workspace repo when injecting and dispatching from the chat — Completed: 2026-06-06
  - Type: bug
  - Description: In the in-app Claude assistant, shipping a drafted entry always injects to and runs claude-run on the default repo (`toDoList_TOP`) regardless of which workspace is selected via the pill. Root cause: `shipDraftedEntry` in `claudeSheet.js` calls both `injectEntry({ entry, id })` and `dispatchRun({ mode: 'entry', entryId, correlationId })` with no `target`, so neither request carries `repo`/`filePath` and the Worker falls back to its default target. Fix by building a target from the active workspace — `{ repo: activeChatRepo, file_path: 'TODO.md' }` — and passing it as `target` to both calls, so the entry lands in the selected repo's `TODO.md` and the run dispatches against that repo. Confirm the Worker honors an explicit `filePath` of `TODO.md` for non-default repos (matchingGame-test's `TODO.md` is at repo root, same as the default). Add a regression test (test-first) asserting that after switching the workspace via the pill, both the inject and dispatch request bodies carry the switched repo rather than the default.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/tests/claudeSheet.test.js`
  - Out of scope: `injectEntry`/`dispatchRun` in `inject.js` (they already accept and forward `target`); the chat-turn `repo` wiring, which already rides `activeChatRepo` correctly.
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: bd615b2f-6dfd-4d7f-ac4e-03667f534341 -->

- [x] **[MEDIUM]** Re-fetch the chat workspace repo list when the sheet opens — Completed: 2026-06-07
  - Type: bug
  - Description: The chat-window workspace menu (the pill dropdown) is sourced from the Worker's `ALLOWED_TARGETS` allowlist via `loadWorkspaceRepos`, which fires only once per mount in `mountClaudeSheet`. Opening/closing the sheet just toggles classes and never remounts, so after a repo is added to or removed from `ALLOWED_TARGETS`, the menu keeps showing the stale list until a full page reload. Fix by also calling `loadWorkspaceRepos()` (fire-and-forget) from `openClaudeSheet` so each open re-syncs `attachRepos` and repaints the pill/menu. The in-app "Inject targets" (settings modal, Supabase-backed `cachedTargets`) are a separate list that intentionally does not feed the chat workspace menu — if those should also appear in chat, that's a separate sourcing change, not part of this fix.
  - Behavior:
    1. Each sheet open re-fetches the allowlist; a newly-added repo appears in the menu and a removed one disappears, with no page reload.
    2. The refresh only repaints the pill/menu — it must not clear `chatHistory`, attachments, or the active workspace (only an explicit pill switch wipes the chat). Pin this with a regression test.
    3. If the currently active workspace was removed from the allowlist, fall back to the default repo and repaint the pill so the user isn't stranded on a repo the Worker no longer accepts.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/tests/claudeSheet.test.js`
  - Out of scope: making in-app Inject targets (`cachedTargets`) populate the chat workspace menu; any change to `ALLOWED_TARGETS` sourcing on the Worker.
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: b29825ba-9452-4bbe-b4dd-c7cec30a0716 -->

- [x] **[LOW]** Block saving an inject target whose repo isn't in the Worker allowlist — Completed: 2026-06-07
  - Type: feature
  - Description: The inject-target add/edit sub-modal only validates that `repo` is non-empty and matches the `owner/repository` shape — it never checks the repo against the Worker's `ALLOWED_TARGETS`, so a target pointing at an unlisted repo saves cleanly and then silently fails at inject/dispatch time. Add a save-time allowlist check in `onSave`: after the existing synchronous `validateTargetForm` pass and before the Supabase insert/update, call `fetchAllowedRepos()` and, if it resolves with a repo list that does not include `values.repo`, set an inline error on the repo field via the existing `setError(repoField, …)` machinery ("Not in the Worker allowlist — add it to ALLOWED_TARGETS first") and abort the write. Keep `validateTargetForm` synchronous (shape checks only); the async allowlist check lives in `onSave`.
  - Behavior:
    1. Block the Supabase write when the allowlist fetch succeeds and `values.repo` is absent from `result.repos`; surface the failure as an inline repo-field error using the same red treatment as the existing shape errors.
    2. Disable Save while the async check is in flight and re-enable it on a blocked result so the user can fix the repo and retry — never leave Save stuck disabled.
    3. If `fetchAllowedRepos()` returns null or throws (Worker unreachable), skip the check and allow the save, matching the app's graceful-degradation pattern rather than blocking on a transient failure.
    4. Apply the same check on the edit flow, not just add.
  - Implementation notes: `fetchAllowedRepos()` is already exported from `inject.js` and resolves to `{ default, repos: [{ repo, srcPrefix }] }`; match with `result.repos.some(r => r.repo === values.repo)`. No new dependency needed.
  - Out of scope: what feeds the chat workspace menu; any change to `ALLOWED_TARGETS` on the Worker; validating `file_path`.
  - File: `toDoList_main/src/inject.js`, `toDoList_main/tests/injectTargetsManagement.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 47042474-b464-4dcd-9ae8-9f01e3eac068 -->

- [x] **[MEDIUM]** Poll run status against the workspace repo a chat-shipped run was dispatched to — Completed: 2026-06-06
  - Type: bug
  - Description: Now that `shipDraftedEntry` in `claudeSheet.js` dispatches entry-mode runs against the active workspace repo (a `target` of `{ repo: activeChatRepo, file_path: 'TODO.md' }`), the status poller has gone stale: `startRunPoller` → `pollRunRecordOnce` calls `pollRunStatus({ correlationId })` with no `target`, so the Worker polls its DEFAULT repo for the run's `correlation_id`. For a run dispatched against a non-default repo (e.g. `matchingGame-test`), the default-repo poll never finds it (`res.found === false`), so the Runs-tab record sits QUEUED until the give-up window and is then marked unconfirmed — the run actually ran, but the UI can never confirm it. Fix: persist the dispatched repo on the run record at ship time (e.g. `record.repo = activeChatRepo`) and thread a `target` of `{ repo: record.repo, file_path: 'TODO.md' }` through `startRunPoller` → `pollRunRecordOnce` → `pollRunStatus(...)` so status polling queries the same repo the run was dispatched against. Default-repo runs (no stored repo) must keep working exactly as today. Add a regression test (test-first) asserting the status request body carries the non-default repo for a run shipped while a non-default workspace is active, and carries the default (or omits repo) for a default-workspace run.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/tests/claudeSheet.test.js`
  - Out of scope: `pollRunStatus` in `inject.js` (it already accepts and forwards `target`); the inject/dispatch repo wiring (already fixed); the TODO.md viewer's own status polling.
  - Completed: YYYY-MM-DD (PR #<number>)

- [x] **[MEDIUM]** Source the chat workspace menu from Inject targets instead of the Worker allowlist — Completed: 2026-06-06
  - Type: feature
  - Description: The chat workspace menu currently fetches its repo list from the Worker's `ALLOWED_TARGETS` via `loadWorkspaceRepos` → `fetchAllowedRepos`, so repos managed in Inject settings (Supabase `inject_targets`) don't necessarily appear in the chat and vice versa. Now that the save-time allowlist guard in the inject-target sub-modal guarantees every target's repo is on `ALLOWED_TARGETS`, `inject_targets` is a clean subset of the allowlist and the better single source of truth. Switch `loadWorkspaceRepos` to read from `cachedTargets` (mapped to the `.repo` field) via a new exported accessor in `inject.js` — each menu item still anchors on the target's `repo` string so `activeChatRepo`, the chat-turn `repo` payload, and the existing `repoShortName` display all stay unchanged; the menu simply becomes a projection of the inject targets list. This entry supersedes the previously-drafted MEDIUM "Re-fetch the chat workspace repo list when the sheet opens" entry — same surface, but the source swap rewrites the refresh strategy.
  - Behavior:
    1. Replace the `fetchAllowedRepos()` call in `loadWorkspaceRepos` with a read from `cachedTargets` (export `getCachedTargets()` from `inject.js`); map each target to its `repo` field for `attachRepos`.
    2. Refresh on every sheet open: call `loadInjectTargets()` (fire-and-forget) from `openClaudeSheet` so add/edit/deletes made while the sheet was closed show up on next open. The refresh only repaints the pill/menu — it must not wipe `chatHistory`, attachments, or `activeChatRepo` (only an explicit pill switch does that).
    3. Refresh mid-session on mutation: have `insertInjectTarget`, `updateInjectTarget`, and `deleteInjectTarget` dispatch a `document` custom event (e.g. `injectTargetsChanged`) on a successful Supabase write; `claudeSheet.js` listens and repaints. Coalesce rapid mutations rather than firing per-keystroke.
    4. Empty / failed-fetch fallback: if `cachedTargets` is empty or the load fails, fall back to a one-item list of the hardcoded `DEFAULT_ATTACH_REPO` so the chat is always usable on a fresh install or transient outage — matches the existing graceful-degradation pattern.
    5. Stranded-active-repo fallback: if `activeChatRepo` is not present in the new list after a refresh (the user deleted that target), gracefully switch to the first target (or `DEFAULT_ATTACH_REPO` if the list is empty) and repaint the pill so the user isn't stranded on a repo the new source doesn't include.
  - Implementation notes: `loadInjectTargets`/`cachedTargets` already live in `inject.js`; this entry just adds a small accessor + the change event. The `claudeSheet.test.js` regression set should cover: chat source equals inject targets, refresh on sheet open, refresh on `injectTargetsChanged`, empty-list fallback, and stranded-active-repo fallback. Note that any grandfathered target predating the guard (e.g. an `wgu-dsa-prep` row that was saved before the guard shipped and is not on `ALLOWED_TARGETS`) will appear in the menu and produce a failed run if selected — those need to be deleted by hand in Inject settings; this entry intentionally does not retroactively scan/repair them.
  - Out of scope: showing inject-target nicknames in the workspace menu (possible follow-up); honoring each target's `file_path` on dispatch instead of the hardcoded `TODO.md` in the HIGH "active workspace repo on inject/dispatch" entry (every current target uses `TODO.md`, so harmless today — polish later); changes to the Worker `repos` route or `fetchAllowedRepos` itself (still consumed by the LOW save-time guard).
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/inject.js`, `toDoList_main/tests/claudeSheet.test.js`, `toDoList_main/tests/injectTargetsManagement.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: aa4a92e4-114f-4ca5-978e-2a0dd4be870f -->

- [x] **[HIGH]** Add context-menu delete to the desktop project dropdown — Completed: 2026-06-07
  - Type: bug
  - Description: The desktop revamp of the project dropdown removed the per-row `×` that previously let users delete a project, leaving no path to project deletion from the new desktop surface. Restore the affordance via a context menu pinned to the row, opened on right-click (mouse) or a ~500ms long-press (touch), with a single "Delete project…" item — rename and other actions reserved for a follow-up; just the destructive action lands here. Selecting it opens a confirmation modal worded "Delete '<project name>'? This deletes <N todos> along with the project. This cannot be undone." with Cancel and Delete buttons. On confirm, the project and its todos are removed via `listLogic` and persisted; if the deleted project was the active one, the view falls back to the first remaining project (or the empty-state view if the list is now empty). Add a regression test (test-first) in `listLogic.test.js` asserting that deleting a project removes both the project record and all of its todos and that the new state persists — the previous per-row `×` had cascade behavior that must hold under the new entry point.
  - Behavior:
    1. Right-click on a project row in the desktop dropdown opens the context menu anchored to the row; a ~500ms long-press on touch opens the same menu (per CLAUDE.md's right-click + long-press pairing).
    2. Context menu closes 4 ways per CLAUDE.md: option select, click outside, Escape, right-click elsewhere.
    3. Confirmation modal closes 3 ways per CLAUDE.md: explicit close button, backdrop click, Escape — Escape only closes the modal, not the parent dropdown.
    4. The confirm message names the project and the exact number of todos that will be lost. When N is 0, drop the "<N todos>" clause so the copy doesn't read "This deletes 0 todos…" — fall back to "Delete '<project name>'? This cannot be undone."
    5. Active-project fallback: deleting the currently-viewed project switches the view to the first remaining project, or the empty state if the list is now empty. Pin this with a regression test.
  - Implementation notes: `main.js` owns the dropdown's row rendering and event wiring — grep with offset/limit, the file is over 25k tokens. Add the context-menu DOM, a `contextmenu` listener for right-click, and a `touchstart`/`touchmove`/`touchend` long-press detector with a movement-cancel threshold so a scroll doesn't fire the menu. Style the context menu and confirmation modal in `style.css` matching the Void aesthetic — purple-tinted hover, red danger button. Confirm or add a cascade-delete path in `listLogic.js`; if the previous `×` removed todos along with the project, the same path is reusable from here.
  - Out of scope: rename / reorder / any non-delete context-menu actions (future entries can extend the menu); the mobile project chrome (the initial-letter sidebar) — if delete is missing there too, that's a separate surface and a separate entry.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 03ee2eb0-5ef0-46af-a5d2-1d8a2da2da96 -->

- [x] **[HIGH]** Fix project delete context menu rendering behind the project dropdown — Completed: 2026-06-07
  - Type: bug
  - Description: The context menu added by the previous "Add context-menu delete to the desktop project dropdown" entry renders behind the dropdown that triggered it, so "Delete project…" is unreachable and the new delete path is effectively broken. Root cause is almost certainly stacking-context related: the context menu is currently mounted inside a dropdown row, and the dropdown panel either sets `overflow: hidden`/`auto` (clipping the menu) or establishes its own stacking context (`transform`, `opacity`, `position` + `z-index`, etc.) that pins the menu's z-index below sibling rows below it. The robust fix is to portal the context menu out of the row and append it to `document.body` (or a top-level overlay layer) and position it via measured coordinates from the row's `getBoundingClientRect`, with a high z-index above the dropdown panel and any modal layers it might also need to clear. As a fallback if portaling is overscope, raise the dropdown panel's child stacking so the menu escapes its container — but portaling is the durable fix because it survives any future dropdown layout change.
  - Behavior:
    1. Right-click / long-press on a project row opens the context menu visually above the dropdown panel, with no clipping at the dropdown's edges and no row text bleeding through it.
    2. Menu still anchors to the row that triggered it — re-measure on open so scrolling or resizing the dropdown doesn't strand the menu at a stale coordinate.
    3. All four close paths from CLAUDE.md (option select, click outside, Escape, right-click elsewhere) continue to work when the menu lives outside the dropdown — verify the outside-click listener references the menu's new DOM location, not its old in-row parent.
    4. The menu must also close when the dropdown itself closes (e.g., clicking outside the dropdown). Pin this in a test — a portaled child can otherwise outlive its conceptual parent.
  - Implementation notes: `main.js` owns the dropdown and the new context menu — grep with offset/limit for the context-menu append site and the `contextmenu`/long-press wiring. Use `position: fixed` with viewport coordinates from the row's `getBoundingClientRect`, clamped against viewport edges so the menu doesn't open off-screen near the right or bottom. `style.css` change is small — a `z-index` rule on the new top-level menu class above whatever the dropdown panel uses. Confirm the dropdown panel's stacking before picking the new value (search `project_knowledge_search` for the dropdown's CSS rather than guessing the current z-index).
  - Out of scope: any other context-menu items (rename, reorder); restyling the context menu itself; changes to the dropdown's own stacking aside from what's strictly needed to host a portaled child.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: b173d274-eb72-4a3f-8b9b-74175a1d355b -->

- [x] **[HIGH]** Bump #projContextMenu z-index above the desktop project picker dropdown — Completed: 2026-06-07
  - Type: bug
  - Description: The project context menu (Edit · color picker · Delete) renders behind the desktop `#projectPickerDropdown` panel because of a stacking-context gap, leaving Delete unreachable from the new desktop project switcher. The menu is already portaled to `document.body` (`document.body.appendChild(menu)` in `projectMenu.js`) and uses `position: fixed`, so the issue is not clipping or a trapped parent — it's purely z-index: `#projContextMenu` is set to `z-index: 20` (sufficient when the menu only opened from sidebar `#projChild` rows) while `#projectPickerDropdown` is `z-index: 100`, so 100 wins and the menu paints underneath. Raise `#projContextMenu` to `z-index: 200` — comfortably above the dropdown (100) and the settings menu (30), and well below the welcome carousel (650) and desktop spotlight (600/601) so first-run flows are unaffected. Supersedes the previously-drafted "Fix project delete context menu rendering behind the project dropdown" entry; the portal change it proposed was based on a wrong diagnosis. If that entry hasn't shipped yet, skip it.
  - Behavior:
    1. Right-click / long-press on a row inside `#projectPickerDropdown` opens the context menu visually above the dropdown panel, with Edit / color picker / Delete fully clickable and no row text bleeding through the menu.
    2. The dropdown stays open beneath the menu (acting on a row visible inside it is the whole point); existing dismiss paths still work — selecting an item, Escape, outside click, outside right-click, scroll, or viewport resize all close the menu (per `hideProjectContextMenu`).
    3. The menu must still close above the dropdown without trapping clicks — verify the existing capture-phase outside-click listener still fires when the click target is inside the dropdown but outside the menu.
  - Implementation notes: One-line change in `style.css` (`#projContextMenu { z-index: 200; }`). Add a regression test in `tests/` that asserts `#projContextMenu`'s computed `z-index` is greater than `#projectPickerDropdown`'s — bare numeric assertions invite the same drift to recur the next time the picker bumps its own z-index, but a relational assertion fails the moment they cross again. The existing z-index ladder elsewhere (settings menu 30, welcome carousel 650, spotlight overlay 600/601) should be cited in a CSS comment above the new value so the next person reading the rule sees the budget.
  - Out of scope: any change to `projectMenu.js` (the portal logic, dismiss handlers, and positioning are all correct); any change to `#projectPickerDropdown`'s own z-index; restyling the menu surface; the sidebar `#projChild` use case (unaffected — its parent has no stacking competitor above z-index 20).
  - File: `toDoList_main/src/style.css`, `toDoList_main/tests/projectContextMenu.test.js` (or the existing stacking-related test file — grep `tests/` for `z-index` first; if there's an existing stacking ladder test, extend it instead of adding a new file)
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: a693e3d5-6554-42e3-b313-c8db61b854e6 -->

- [x] **[HIGH]** Add Rename to the desktop project picker context menu — Completed: 2026-06-07
  - Type: feature
  - Description: The right-click / long-press context menu on a desktop `#projectPickerDropdown` row only offers `Delete project…` — Rename (the "Edit" arm of `showProjectContextMenu` in `projectMenu.js`) was deferred when the desktop delete affordance shipped, leaving no path to rename a project from the new desktop surface. Surface a `Rename` item above `Delete project…` in the same context menu, wired to the same rename flow the sidebar's Edit item already uses, so the dropdown reaches parity with the sidebar for the two non-destructive + destructive project actions. Out of scope: the inline color picker (that's a separate decision — say the word and I'll draft it).
  - Behavior:
    1. Right-click / long-press on a row inside `#projectPickerDropdown` opens the context menu with two items, in order: `Rename` (default treatment) and `Delete project…` (danger treatment). No separator between them in this scope — the color picker that would normally sit between them stays gated for a follow-up.
    2. Selecting `Rename` closes both the context menu and the dropdown, then drops the just-targeted project into the existing rename / edit-name flow — same end behavior as picking `Edit` from the sidebar context menu, so a user moving between sidebar and dropdown gets identical results.
    3. The four context-menu dismissal paths from CLAUDE.md (option select, click outside, Escape, right-click elsewhere) all continue to close the menu without firing the Rename action.
    4. Regression-test alongside the new entry: opening the context menu from a dropdown row exposes both `Rename` and `Delete project…`; clicking `Rename` triggers the same callback the sidebar's Edit click fires.
  - Implementation notes: `projectMenu.js`'s `showProjectContextMenu(x, y, onEdit, onDelete, colorContext)` already builds an Edit item — easiest path is to reuse it from the dropdown row's `contextmenu` / long-press handler (in `main.js`), passing a real `onEdit` callback that points at the existing rename flow, leaving `colorContext` as `undefined` so the swatch strip stays hidden for this scope. If the dropdown shipped its own ad-hoc context menu instead of reusing `showProjectContextMenu` (the trailing ellipsis on `Delete project…` versus the sidebar's plain `Delete` suggests this — grep `Delete project…` in `main.js` and `projectMenu.js` to confirm), the right move is to consolidate onto `showProjectContextMenu` and let the dropdown's invocation pass the labels it wants via a small options bag — one menu source for both surfaces is cheaper to maintain than two parallel ones.
  - Out of scope: the inline color picker; mobile project chrome (initial-letter sidebar); any change to the rename flow itself.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/projectMenu.js`, `toDoList_main/tests/projectContextMenu.test.js` (or the closest existing test file — grep first)
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 9df144ad-8b48-49d4-97a8-64d061c07389 -->

- [x] **[HIGH]** Make Rename in the desktop project picker edit the row inline — Completed: 2026-06-07
  - Type: bug
  - Description: Rename in the `#projectPickerDropdown` context menu currently routes to the project's todo page instead of letting the user edit the name, because it reuses the sidebar's `onEdit` callback that activates the sidebar row's `#projInput` element — the dropdown row has no equivalent inline-edit field, so the click falls through to "switch to this project." Add inline editing scoped to the dropdown's own row geometry: the row swaps in place into a focused text input pre-populated with the current name and select-all'd so a single keypress replaces. Enter (or blur) commits via the existing rename flow `listLogic` already exposes for the sidebar; Escape cancels and restores the row. Mirrors the sidebar's edit behavior at parity, scoped to the dropdown surface.
  - Behavior:
    1. Right-click / long-press on a dropdown row → pick `Rename` → that row replaces its `.projectPickerName` + `.projectPickerCount` children with a single text input matching the row's 32px height and padding; the dropdown stays open and other rows are unaffected.
    2. The input mounts focused with the name pre-selected (select-all) so typing replaces; arrow keys position normally.
    3. Commit paths: Enter, and blur (clicking outside the input but still inside the dropdown). Both submit through the same rename helper the sidebar's Edit path uses — no parallel mutation site.
    4. Cancel paths: Escape, and Escape only. A blur with an unchanged value also reverts cleanly (no-op write).
    5. Validation: reuse the existing rename validation (trim whitespace, reject empty, reject duplicates). On rejection the input stays open with an inline error treatment matching whatever the sidebar uses on its `#projInput` reject path — don't invent a new error surface.
    6. After a successful commit the row repaints with the new name + the same count badge, the row stays in its current sort position, and the dropdown stays open. After a cancel the row repaints with the prior name.
    7. Closing the dropdown while editing (clicking outside it, Escape on the dropdown chrome) cancels the edit cleanly — no orphan input mid-save, no stale value committed.
  - Implementation notes: The wiring lives in `main.js` where `#projectPickerDropdown` rows are built and where the context-menu `Rename` handler routes — grep with offset/limit, the file is over 25k tokens. The cleanest path is to add a small `enterRowEditMode(row, project)` helper next to the dropdown row builder rather than spreading edit DOM logic across the context-menu handler. Reuse whatever rename helper the sidebar's `#projInput` commit calls — there should be exactly one; if it isn't already exported from `listLogic.js`, export it now and switch both call sites at the same time so the two surfaces share the mutation. Style the input in `style.css` as a `.projectPickerRow.editing` variant — same 32px row height, same horizontal padding, SpaceMono 13px to match the row's name treatment, a 1px purple focus border, transparent-ish background so the row's accent stripe stays readable. No new dependency. Regression test: clicking `Rename` from a dropdown row swaps the row into an input, Enter commits via the shared rename helper (assert it's the same function the sidebar Edit path invokes — wire a spy), Escape reverts, and a duplicate-name input keeps the editor open with an error.
  - Out of scope: rename from the sidebar (already works, unchanged); the inline color picker in the dropdown context menu (separate follow-up); mobile project chrome.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/projectContextMenu.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: b04c818e-5cc1-47a1-a0e2-69697f820863 -->

- [x] **[HIGH]** Give the desktop project picker dropdown its own inline rename edit mode — Completed: 2026-06-07
  - Type: bug
  - Description: The Rename item in the `#projectPickerDropdown` context menu was wired to the sidebar `projectRow.js` `onEdit` helper, which `selectIfNeeded()` + focuses the sidebar's `#projInput`. At desktop widths the sidebar drawer is hidden, so the user sees only a silent project switch and the context menu closing — no editable input ever appears. The dropdown surface needs its own inline edit mode that lives ON the dropdown row, independent of the sidebar's input. Add an `enterRowEditMode(row, currentName)` helper next to the dropdown row builder in `main.js` that swaps the row's `.projectPickerName` + `.projectPickerCount` children for a single text input pre-populated with the current name and select-all'd on mount. Wire the dropdown context menu's `Rename` handler to call this helper — NOT to the sidebar's `onEdit`. Commit via the shared `listLogic.editProject(oldName, newName)` mutation already used by the sidebar's rename keydown handler so the data path stays single-sourced; only the input UI is per-surface. The previous "Make Rename in the desktop project picker edit the row inline" entry described this approach but the implementation reused the sidebar helper instead — this entry is the correction.
  - Behavior:
    1. Right-click / long-press on a dropdown row → pick `Rename` → that row replaces its name+count children with a focused 32px-tall input matching the row's padding, value pre-selected.
    2. The dropdown stays open; other rows render unchanged; no project switch fires (`selectIfNeeded` must NOT be called from this path).
    3. Enter commits via `listLogic.editProject(currentName, newName.trim())` and repaints the row with the new name + the original count badge in its original position; blur also commits (same path).
    4. Escape cancels and repaints the row with the prior name; an empty / whitespace-only commit reverts cleanly via the same path.
    5. Duplicate-name commit keeps the input open with a `color: var(--text-danger)` treatment on the input — same vocabulary the sidebar's rename uses on `#projInput`. No silent revert, no swallowed mutation.
    6. Closing the dropdown (Escape, outside click) while an edit is in flight commits the current value (matching the blur path) — no orphan input, no stale value lost.
    7. The context-menu surface must NOT call `selectIfNeeded` or `onEdit` from `projectRow.js` for the dropdown's `Rename` click — those are sidebar-only paths; cross-wiring them is the bug being fixed.
  - Behavioral regression tests (test-first — these are what the previous entry's tests failed to catch):
    1. After clicking `Rename` from a dropdown row's context menu, an `input` element exists INSIDE that `.projectPickerRow` (`row.querySelector('input')` is non-null) and is the active element. Asserting only that a rename callback fires is insufficient — pin the visible DOM state.
    2. `listLogic.editProject` is called with `(oldName, newName)` on Enter; the row's textContent reads the new name after the commit; the row's position in the dropdown is unchanged.
    3. Escape removes the input and the row's textContent reads the prior name.
    4. A duplicate-name commit leaves the input mounted and applies the error color treatment.
    5. The dropdown's project-switch click handler (`navigateToProjectByIndex` / `#projChild.click()`) does NOT fire on a `Rename` click — assert with a spy that switching is not triggered.
  - Implementation notes: `main.js` is >25k tokens — grep with offset/limit for `projectPickerDropdown` to find the row builder and the context-menu wiring, and for `attachProjectContextMenu` to confirm the sidebar wiring (which should remain untouched). `listLogic.editProject` is already callable from any module that imports `listLogic` — no new export needed. Style `.projectPickerRow.editing` in `style.css`: 32px row height preserved, 16px horizontal padding, SpaceMono 13px (matches `.projectPickerName`), a 1px purple focus ring (`box-shadow: inset 0 0 0 1px var(--purple)`), transparent-ish background so the row's accent stripe stays readable. The danger color uses `var(--text-danger)` to match the sidebar's vocabulary.
  - Out of scope: changes to the sidebar `attachProjectContextMenu` / `onEdit` / `#projInput` flow (those still work — they're just not for this surface); the inline color picker in the dropdown context menu (separate follow-up); mobile project chrome.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/projectContextMenu.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 1a731218-8f25-4426-9750-fd67a83da7f9 -->

- [x] **[HIGH]** Stop Rename's click from bubbling into the project picker's outside-click handler — Completed: 2026-06-07
  - Type: bug
  - Description: Clicking `Rename` in the desktop project picker dropdown's context menu briefly mounts the inline edit input on the row and then closes everything — symptom: "the menu just closes." Root cause is an event-bubbling race between two portaled overlays. The context menu (`#projRowContextMenu`) is portaled to `document.body`, so a click on its `Rename` item — even though the item is logically a descendant of the dropdown — is NOT a descendant of `#projectPickerDropdown` in the actual DOM tree. The Rename item's click handler runs (`hideProjectRowContextMenu()` then `enterRowEditMode(row, projectName)`, which correctly mounts and focuses the input on the row), then the click bubbles up to the document-level outside-click handler the dropdown installs in `openProjectPicker` — that handler checks `projectPickerDropdown.contains(e.target) || mobileProjHeader.contains(e.target)` and the Rename item satisfies neither, so it reads as "outside," fires `closeProjectPicker()`, which calls `cancelActiveRowEditor()` and tears down the input that was mounted one tick earlier. Fix is to stop the Rename item's click from bubbling to that handler: in `showProjectRowContextMenu` (main.js), the Rename item's `click` listener should call `event.stopPropagation()` before it does anything else, so the dropdown's outside-click never sees the event. Same change for the `Delete project…` item to keep the context menu's symmetry: clicks on its items belong to the menu, not to "outside the dropdown."
  - Behavior:
    1. Right-click / long-press a dropdown row → context menu appears → click `Rename` → context menu tears down, the row's name+count children hide, the input mounts focused with select-all, and the dropdown STAYS OPEN with the row in `.editing` state. No flash, no close.
    2. Enter / blur commits via the existing `commit()` path; `buildProjectPickerRows()` repaints; dropdown still open. Escape cancels via the existing `cancel()` path; dropdown still open.
    3. `Delete project…` continues to work exactly as before (the propagation stop is symmetric but doesn't change the delete flow — `deleteProjectFlow` already drives its own teardown).
    4. Outside-click on truly outside surfaces (the page background, another part of the app) still closes the dropdown — the only thing changing is that clicks landing on context-menu items no longer count as "outside."
  - Implementation notes: Surgical — add `event.stopPropagation()` as the first line of the `Rename` and `Delete project…` click handlers inside `showProjectRowContextMenu`. No other code paths change; do NOT touch the dropdown's outside-click handler, the context-menu's own dismiss listeners, or `enterRowEditMode`. The capture-phase listeners the context menu itself installs (`onProjRowCtxOutsideClick` etc.) are unaffected because they see the event first, in capture phase, and stopPropagation in the target's bubble-phase handler doesn't reach back into capture. The existing `projectContextMenu.test.js` will need one additional source-inspection assertion: the Rename item's click handler body contains `stopPropagation()` BEFORE `enterRowEditMode(`. Behavioral test (if it fits the existing jsdom harness used in this file's `clickRenameFromMenu` flow): after clicking Rename, the input exists on the row AND `projectPickerDropdown.classList.contains('open')` is still true.
  - Out of scope: refactoring the context menu off the body portal (the portal is intentional — it's how the menu escapes the dropdown's z-index ladder); changing the dropdown's outside-click handler logic (it's correct for the case where the user really does click outside); the delete flow's existing behavior.
  - File: `toDoList_main/src/main.js`, `toDoList_main/tests/projectContextMenu.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: ecbe5e9a-bb83-4578-907f-2b18525aa76d -->

- [x] **[MEDIUM]** Replace Expand all + Sort by Due with a single Sort dropdown (adds Status sort) — Completed: 2026-06-07
  - Type: feature
  - Description: Remove the Expand all button and the Sort by Due checkbox from the task-list controls row (the band that hosts the ALL / Active / Ideas filter pills) and replace both with a single Sort dropdown sitting in the same right-aligned slot. The dropdown button reads its current state — "Sort ▾" for none, "Sort: Due ▾" for due-sorted, "Sort: Status ▾" for status-sorted — and opens a small menu with three mutually-exclusive options: None, Due date, Status (subtitled "In Progress · Active · Idea"). Selecting any option applies that sort and persists the choice globally across projects via `prefs.js`, mirroring the `getTaskFilter`/`setTaskFilter` shape with a new `getTaskSort`/`setTaskSort` pair under a `todoapp_taskSort` key (values: `'none' | 'due' | 'status'`, default `'none'`). The Status sort reorders todos so `in_progress` items come first, then `active`, then `idea`; within each status group the existing `pos` ordering is preserved as the secondary key so a manual drag-arrangement inside a status group is never destroyed by toggling Status on. Sort and filter compose cleanly — the filter still hides rows via its existing CSS class after the sort has run, so the visible subset is correctly ordered.
  - Behavior:
    1. New `listLogic.sortItemsByStatus(projectName)` mutation: reorders `items` so the visible group order is `in_progress` → `active` → `idea`, with `pos` ascending as a stable secondary sort within each group. Cached todos lacking a status field hydrate to `active` (the existing normalisation rule) and sort accordingly. Persists via the existing CRUD path so the reordered indices write back to localStorage / Supabase like every other reorder.
    2. The dropdown's menu items route through a single `setTaskSort(key)` handler that: (a) writes the new pref, (b) calls the corresponding `listLogic.sortItemsBy*` mutation for `'due'` or `'status'` (or `listLogic.sortByPosition` / equivalent reset for `'none'`, so the manual order returns), (c) re-renders the task list, (d) re-applies `applyTaskFilter()` afterwards so the filter's hide-class lands on the now-correctly-ordered rows.
    3. Mutex enforced by the single-key pref — selecting Due replaces Status and vice versa; no concept of "both on."
    4. The dropdown closes 3 ways (item select, outside click, Escape) and reuses the `#projContextMenu` / `#settingsMenu` visual vocabulary — same surface as the existing right-click menus so the chrome reads as kin.
    5. Expand all button and its handler are removed: no DOM, no listener, no leftover localStorage key. The header is repainted with the dropdown in Expand all's slot.
  - Test-first regression set (these go in BEFORE the implementation, per the standing "regression tests before implementation" rule):
    1. `listLogic.sortItemsByStatus` ordering invariants: a project containing `[in_progress A, active B, idea C, in_progress D, active E]` (in `pos` 0..4 order) sorts to `[in_progress A, in_progress D, active B, active E, idea C]` — group order correct, intra-group `pos` order preserved.
    2. Legacy hydration: a cached todo without a `status` field sorts as `active`.
    3. `prefs.js` round-trip: `setTaskSort('status')` then re-import / re-read returns `'status'`; default with no key is `'none'`; out-of-vocabulary values are coerced to `'none'`.
    4. Mutex: calling `setTaskSort('due')` after `'status'` leaves the pref at `'due'` only, with no second key written.
    5. Compose with filter: with the Active pill selected and Status sort applied, the visible rows are `in_progress` then `active` (no `idea`); the `taskFilterHidden` class is on the `idea` rows after the sort.
    6. DOM teardown: after the change, `document.getElementById('expandAllBtn')` (or whatever the current id is — grep first) returns null; no `expand`-related listeners remain on `#mainList` or its ancestors. Pin this with a source-inspection assertion that the symbol is gone from `main.js`, plus a behavioral assertion that it's absent from the rendered DOM.
  - Implementation notes: `main.js` is over 25k tokens — grep with offset/limit for the existing `Expand all` text and the Sort-by-Due checkbox markup to find the band; both controls almost certainly live in the same builder function. Build the new dropdown inline there. The dropdown menu's surface styles already exist as `#projContextMenu` / `#settingsMenu` in `style.css` — extend the existing rule with a new shared selector (`#projContextMenu, #settingsMenu, #taskSortMenu`) rather than duplicating tokens. The new `sortItemsByStatus` in `listLogic.js` should sit next to `sortCompletedToBottom` and `sortItemsByDue` (or whatever the existing due-sort helper is named — grep first; if it isn't named like that, name the new one to match the existing convention). The sort modifies the `items` array in place via the same path other sort mutations use so the persistence layer and the optimistic-write tracking see one update. Be especially careful about the destructive-vs-additive split: implement and verify the new dropdown wires up and applies the sorts BEFORE deleting the Expand all builder code — the test set above pins both the additive and destructive halves, but ordering the implementation that way avoids a page-load failure mid-PR if a downstream listener still references the old id.
  - Out of scope: any change to the filter pills (ALL / Active / Ideas) themselves; the `sortCompletedToBottom` invariant (still runs on commit, independent of this user-facing sort); the right-click context menu for individual rows; mobile-only sort chrome if it differs from the desktop band (grep first — if the existing Sort-by-Due checkbox lives in shared markup the dropdown inherits the same surface; if mobile has its own control, scope a follow-up entry rather than bundling).
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/prefs.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/listLogic.test.js`, `toDoList_main/tests/prefs.test.js` (or the closest existing prefs test file — grep first)
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 25c82b0c-6c68-4a72-bbfe-2b724d972dba -->

- [x] **[MEDIUM]** Replace ALL/Active/Ideas filter pills with a single cycle pill — Completed: 2026-06-07
  - Type: feature
  - Description: Replace the three-pill `#taskFilterBar` (ALL, Active, Ideas — each rendered as a separate `.taskFilterPill` button) with a single cycle pill that rotates through the three filter states on click in the order `all → active → ideas → all → …`. The pill displays only the currently active filter's label + count plus a trailing `›` indicator as a discoverability cue that the control cycles rather than toggles. Behaviour at desktop and mobile is identical — no breakpoint-specific path. The filter semantics, counts, hide-class application, and persistence layer all stay exactly as they are: this entry changes the UI control only. The current persistence via `prefs.js`'s `getTaskFilter`/`setTaskFilter` (key `todoapp_taskFilter`) is preserved as-is, so a cycled filter still survives reload. (An earlier-session decision excluded persistence; persistence has shipped separately since then, so this entry leaves it in place rather than re-removing it.)
  - Behavior:
    1. Initial render: read the persisted filter via `getTaskFilter()` (default `'active'`); the pill paints with the corresponding label + count + ` ›`. E.g. `Active 155 ›`.
    2. Each click advances the filter through `['all', 'active', 'ideas']` modulo 3, calling `setTaskFilter(next)` followed by `applyTaskFilter()` exactly like a current pill click does. Label and count update in place.
    3. The `›` glyph is present in all three states — never hidden, never replaced — and is visually muted relative to the rest of the pill text (e.g. `opacity: 0.7`) so the cycle hint reads as a secondary affordance rather than competing with the label.
    4. Counts continue to come from the existing count-update path (the one that already keeps the three pills' counts current). Whatever currently re-renders the bar / refreshes its counts on add / complete / status change must still drive the single pill's count.
    5. Empty-state copy (`Nothing active right now.` / `No ideas captured yet.` from the existing `EMPTY_MESSAGES`) continues to surface for `active` / `ideas` states when filtering hides every committed row. No empty-state for `all` — same as today.
  - Test-first regression set (these go in BEFORE the implementation):
    1. DOM shape: after mount, `#taskFilterBar` contains exactly one cycle-pill element and zero of the old per-filter pill elements. Behavioral assertion against the rendered DOM, not just a source grep — this is the destructive half and needs a real "the old three are gone" check. Pin both: a `querySelectorAll` count on the new pill class returning 1, and on the old class (or `[data-filter="all"]`, `[data-filter="ideas"]` etc.) returning 0.
    2. Default state: with no `todoapp_taskFilter` in localStorage, the pill renders `Active <count> ›`. With `todoapp_taskFilter='ideas'` set ahead of mount, the pill renders `Ideas <count> ›` — proving the existing prefs round-trip still works.
    3. Cycle order: starting from `active`, three sequential clicks pass through `ideas`, `all`, then back to `active`. Each transition writes the new value via `setTaskFilter` (assert with a spy on the prefs module) and the pill's textContent updates to match.
    4. Filter application: each click results in exactly one `applyTaskFilter()` invocation (assert with a spy), and the resulting `taskFilterHidden` class lands on the correct row subset for the new filter (e.g. after clicking from `active` to `ideas`, the `idea` rows are visible and the `active` / `in_progress` rows carry the hidden class).
    5. `›` invariant: in every cycle state, the pill's textContent ends with `›` (no state where the cue disappears).
    6. Composition with the sort dropdown (assuming the prior sort entry has shipped): cycling the filter does not perturb the current sort selection; cycling does not call `setTaskSort`.
    7. Empty-state handoff: when no committed rows match the active filter, the existing empty-state message keyed off the filter still renders (no regression in `EMPTY_MESSAGES` wiring).
  - Implementation notes: `taskFilter.js` owns the bar — collapse the three-element `FILTERS` array loop in `buildTaskFilterBar` into a single pill render. Keep `FILTERS` (or an equivalent array) as the source of truth for cycle order, label, and the `match` function so the filter semantics module stays the one source of truth; the cycle pill just reads `FILTERS[next].label / match`. The single delegated click handler on the bar stays — its body changes from `setTaskFilter(key) → applyTaskFilter()` to `setTaskFilter(nextKey) → applyTaskFilter()` where `nextKey` is computed from the current pref. The count-update path (whatever updates `.taskFilterCount` today on add / complete / status change) needs to update the cycle pill's count instead — grep `taskFilterCount` to find every write site and re-point each one. Style the pill in `style.css` extending the existing `.taskFilterPill` rule rather than duplicating tokens; the muted `›` is a `::after` pseudo-element or a child span with `opacity: 0.7`. Build the new pill render path and verify it works (tests 2–7 above pass) BEFORE removing the three-pill render code — same destructive-vs-additive ordering rule that bit the earlier rename entry. Source-inspection assertions ("the old three-pill loop is gone from `taskFilter.js`") can supplement but not replace the DOM assertions in test 1 — the lesson from the inline-rename bubble race is that source-pattern tests pass for "correct code exists" while missing event/DOM interactions.
  - Out of scope: changes to the filter semantics (`active = active+in_progress`, `ideas = idea`); the underlying `prefs.js` persistence; the sort dropdown work landing in parallel; the row-level status badge / popover (separate surface); any keyboard shortcuts; anything outside the bar.
  - File: `toDoList_main/src/taskFilter.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/taskFilter.test.js` (or the closest existing test file — grep first)
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 4d1dd8a7-595b-430e-94d0-887e5a7cfacd -->

- [x] **[HIGH]** Fix status label refusing to open popover after another row's popover is open — Completed: 2026-06-07
  - Type: bug
  - Description: Clicking a row's status label while another row's status popover is already open dismisses the existing popover but does NOT open the new one — the user has to click the second label a second time to see its popover. Root cause is in `wireStatusLabelDelegation` (`toDoList_main/src/todoStatus.js`): the delegated click handler on `#mainList` toggles on the presence of ANY open `#todoStatusPopover`, not on whether the popover belongs to the just-clicked label. So when label B is clicked while label A's popover is open, the handler runs `hideStatusPopover()` (because a popover exists) instead of `showStatusPopover()`, A's popover tears down, and B's never mounts. The user sees nothing happen on the first click — the cue (A's popover closing) is easy to miss when A is offscreen or out of attention — and only the second click opens B's popover. The focus-side hypothesis (row's own click handler in `toDoRow.js` focusing the input) is real but not the blocker here: that handler runs before the delegated handler in bubble phase but doesn't dismiss the popover; the delegated handler is what's actively closing the wrong thing. Fix by checking whether the open popover is anchored to THIS label before deciding to toggle off vs swap: if the clicked label already has `aria-expanded="true"`, hide (true toggle on the same label); otherwise call `showStatusPopover(label, item, projectName, row)` directly — `showStatusPopover` already calls `hideStatusPopover()` at its top, so it cleanly tears down any popover anchored to a different label before mounting the new one.
  - Behavior:
    1. Clicking a status label while no popover is open mounts that label's popover (unchanged).
    2. Clicking the SAME label while its own popover is open closes it (true toggle, unchanged).
    3. Clicking a DIFFERENT label while another label's popover is open: the old popover tears down and the new one mounts in the same click — no second click required. The old anchor's `aria-expanded` flips back to `false` (handled inside `hideStatusPopover`'s existing `openLabel` reset), and the new anchor's `aria-expanded` flips to `true` (handled inside `showStatusPopover`).
    4. Outside-click dismissal is unaffected — `onStatusPopoverOutsideClick` already short-circuits on clicks that land on any `.todoStatusLabel`, so this fix does not double-fire.
    5. The Inbox surface's status-change re-render (`ensureInboxStatusRerender` in `main.js`, listening on `.todoStatusOption` clicks) is unaffected — it only fires on option selection, not label tap.
  - Test-first regression set (behavioral, against the rendered DOM — not source patterns; same lesson from the rename bubble race):
    1. Toggle-on-same-label still works: clicking label A twice opens then closes A's popover (the existing test, preserved).
    2. Cross-label swap in a single click: with rows A and B in `#mainList`, clicking A then clicking B (without an intervening outside click) leaves exactly one `#todoStatusPopover` mounted, and `document.querySelector('.todoStatusLabel[aria-expanded="true"]')` is B's label. The current code fails this — only zero popovers exist after the two clicks, which is the regression to pin.
    3. Cross-label swap fires `showStatusPopover` for B with B's row/item/project — assert with a spy on `showStatusPopover`, so a future refactor that bypasses it (e.g. directly building the popover inline) still routes through the canonical entry point.
    4. The first click on a fresh page (no popover anywhere) still opens the popover — guards against a regression where the new `aria-expanded` check incorrectly treats "no expanded label" as "this label is expanded."
    5. Inbox parity: the same scenario in `#inboxView` (which also calls `wireStatusLabelDelegation`) behaves identically — a cross-row swap in one click.
  - Implementation notes: Minimal — the change lives entirely inside the `wireStatusLabelDelegation` click callback in `todoStatus.js`. The check is `if (label.getAttribute('aria-expanded') === 'true')` for the toggle-off branch; the else branch unconditionally calls `showStatusPopover(label, item, projectName, row)` and lets `showStatusPopover`'s own `hideStatusPopover()` call at the top handle the prior-popover teardown — do NOT call `hideStatusPopover()` manually in the handler before `showStatusPopover`, since `showStatusPopover` already does it (calling it twice is harmless but obscures the single ownership of dismissal). The `event.stopPropagation()` already in the handler stays. No CSS change. No change to `showStatusPopover` / `hideStatusPopover` themselves. The behavioral tests above are exactly the kind that the previous rename saga showed are non-optional for "two overlays interacting" bugs — source-inspection alone passes for "the right code exists" while missing the cross-label race.
  - Out of scope: the row's `toDoChild.click` handler in `toDoRow.js` (focusing the input on label click is a separate behavior — keeping it as-is means the row stays activated, which is fine; if focus-stealing on label tap turns out to be annoying in practice, that's a follow-up entry); the `onStatusPopoverOutsideClick` capture-phase listener (correct as-is); any change to the popover's own positioning, dismissal vocabulary, or styling; the cycle-pill or sort-dropdown entries landing in parallel.
  - File: `toDoList_main/src/todoStatus.js`, `toDoList_main/tests/todoStatus.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: bdbd752d-a6fa-47fc-9c68-ff8b8207b9af -->
