# TODO List

- [x] **[LOW]** Add expand/collapse toggle to TODO.md viewer card to fill available space
  - Type: feature
  - Description: The TODO.md viewer's content area is currently a fixed-height scroll box, leaving empty card space below it (especially on desktop) while the user scrolls a cramped window inside. Add an expand/collapse icon button in the card header, immediately to the right of the Sync button, that toggles the content area between its default compact fixed height and an expanded height that fills the available open space below the Completed section. Default state is collapsed. The expanded state grows the content area (scrolling only if the file is longer than the expanded height); collapsing returns it to the compact fixed height. Persist the toggle state per-project in localStorage so each project remembers whether its viewer was left expanded. Match the "Void" styling: `#161622` button fill, `#2a2a38` border, `#9D93EE` icon, sized as a compact icon button (~28px) consistent with the header. Use a diagonal-arrows / expand icon when collapsed and a collapse icon when expanded, with an `aria-label` reflecting the action.
  - Behavior:
    1. Render an expand toggle icon button in the header, right of Sync. Default = collapsed (current fixed-height behavior unchanged).
    2. Tapping expand grows the content area to fill the available space below Completed; the inner content scrolls only when it exceeds that height. The icon and `aria-label` flip to the collapse action.
    3. Tapping collapse returns the content area to the compact fixed height.
    4. Persist the expanded/collapsed boolean per-project under the `todoapp_` localStorage prefix (e.g. `todoapp_todomd_expanded`, keyed by project). On project select / reload, restore that project's last state.
    5. State applies to whichever tab (Rendered / Raw) is active ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ toggling tabs does not change expand state.
  - Implementation notes:
    - The expanded height must flex into a container with a known/resolved height ÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂÃÂÃÂ a bare flex-fill will silently collapse if the parent chain has no explicit height (same root cause as the prior music-visualizer bar issue). Confirm the card's container resolves a height before relying on flex-grow; otherwise compute the available space explicitly (viewport minus fixed footer minus the elements above the content area).
    - Toggle wiring and the per-project state read/write live in `main.js` alongside the existing viewer card and Sync handler; investigate with grep + offset/limit, not a full read.
    - Reuse the existing per-project localStorage keying pattern already used for the viewer's last-fetch timestamp.
  - Acceptance criteria:
    - Toggle appears right of Sync, defaults to collapsed, and flips icon + aria-label on each tap.
    - Expanding fills the open space; content scrolls only when longer than the expanded area; collapsing restores the compact height.
    - State persists per-project across reloads and project switches.
    - Expanded view renders correctly (no zero-height collapse) on both mobile and desktop.
  - Out of scope: drag-to-resize / arbitrary heights, remembering scroll position, animating the height transition beyond a simple CSS transition.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-28

- [x] **[MEDIUM]** Fix completed section overlapping open todo descriptions
  - Type: bug
  - Description: When the COMPLETED section is expanded and a todo's description is open at the same time, the two collide/overlap visually instead of stacking cleanly. The expected behavior is that an open description grows its own row in normal document flow and the COMPLETED block sits fully below it, with no overlap regardless of which is opened first. Likely cause is that one of these expanding regions (the description panel or the COMPLETED accordion contents) is absolutely positioned or has a fixed/clipped height rather than contributing to layout height, so it renders on top of adjacent content instead of pushing it down. Audit the description-toggle and COMPLETED-toggle styling in `style.css` (and any inline height/position writes in `main.js`) and ensure both expanded regions are in normal flow (static positioning, `height: auto`, no negative margins) so siblings reflow around them.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
  - Completed: 2026-05-28

- [x] **[MEDIUM]** Auto-collapse completed section and open descriptions to prevent overlap
  - Type: bug
  - Description: When the COMPLETED section is expanded and a todo's description is also open, the two regions still collide and overlap onto each other's rows (the prior reflow attempt didn't resolve it ÃÂ¢ÃÂÃÂ the description panel renders over the rows below instead of pushing them down). Switch to a mutually exclusive behavior: opening any todo description collapses the COMPLETED section if it's open, and expanding the COMPLETED section collapses any currently open todo descriptions. Only one of {any open description, the COMPLETED section} can be expanded at a time, so they can never visually collide. Wire the cross-toggle in `main.js` ÃÂ¢ÃÂÃÂ when the description-toggle handler fires open, call the same collapse path the COMPLETED chevron uses (and vice versa); reuse the existing animation/state rather than introducing a new "exclusive accordion" abstraction. The EXPAND ALL control should still expand everything (it's an explicit user override) ÃÂ¢ÃÂÃÂ only single-row toggles trigger the auto-collapse. `main.js` is over 25k tokens, so grep for the description-toggle and COMPLETED-toggle handlers with offset/limit rather than reading the file in full.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

- [x] **[MEDIUM]** Open completed-items section as a bottom sheet on mobile
  - Type: bug
  - Description: On mobile, tapping the `todoMdViewerHeader` ("COMPLETED (93)") doesn't open the section correctly Ã¢ÂÂ the inline accordion expansion fails to render/expand properly, so the completed-items list (with its Rendered / Raw markdown tabs) is unreachable on touch. Replace the inline accordion behavior on mobile with a bottom sheet: tapping the header slides up a sheet from the bottom of the viewport containing the completed list and the existing Rendered / Raw markdown toggle. Reuse the app's existing bottom-sheet machinery (drag handle + slide-up transition, the same pattern as the paste-URL/music sheet) rather than building a new overlay primitive. To locate the current header wiring and the existing sheet helpers, grep `main.js` with offset/limit (todoMdViewerHeader, the sheet open/close functions) Ã¢ÂÂ don't read it in full.
  - Behavior:
    1. Mobile: tapping the COMPLETED header opens the bottom sheet; the Rendered / Raw markdown tabs and the full completed list live inside it.
    2. Sheet dismisses 4 ways: drag handle / swipe-down, backdrop tap, an explicit close (X) button, and Escape.
    3. Touch swipe-down must be wired with `touchstart`/`touchmove`/`touchend` (native drag events don't fire reliably on touch).
  - Out of scope: desktop behavior Ã¢ÂÂ keep the existing inline accordion on wider breakpoints; this change is scoped to the mobile breakpoint only.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-29

- [x] **[MEDIUM]** Make todoMdViewer tappable to open as a bottom sheet on mobile
  - Type: feature
  - Description: On mobile, make the whole `todoMdViewer` a tap target that opens its contents as a bottom sheet, mirroring the COMPLETED-header bottom-sheet treatment. Tapping the viewer slides up a sheet from the bottom of the viewport containing the rendered markdown and the existing Rendered / Raw markdown toggle, instead of trying to display the full viewer inline where it's cramped/unreliable on touch. Reuse the app's existing bottom-sheet machinery (drag handle + slide-up transition, same pattern as the paste-URL/music sheet and the COMPLETED-section sheet) rather than building a new overlay primitive. To find the viewer markup, its tap wiring, and the shared sheet open/close helpers, grep `main.js` with offset/limit (todoMdViewer, todoMdViewerHeader, the sheet open/close functions) â don't read it in full.
  - Behavior:
    1. Mobile: tapping `todoMdViewer` opens the bottom sheet; the Rendered / Raw markdown tabs and the full markdown content live inside it.
    2. Sheet dismisses 4 ways: drag handle / swipe-down, backdrop tap, an explicit close (X) button, and Escape.
    3. Touch swipe-down must be wired with `touchstart`/`touchmove`/`touchend` (native drag events don't fire reliably on touch).
    4. The viewer's tap target should read as interactive (cursor/pressed feedback) so it's discoverable as tappable.
  - Out of scope: desktop behavior â keep the existing inline viewer on wider breakpoints; this change is scoped to the mobile breakpoint only. If the COMPLETED-section sheet entry lands first, share the same sheet helper rather than duplicating it.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-29

- [x] **[LOW]** Hide TODO.md viewer expand button on mobile
  - Type: feature
  - Description: The `todoMdViewerExpandBtn` adds little value on small screens and just clutters the mobile layout — hide it below the existing mobile breakpoint. Add a `display: none` rule scoped to the current mobile media query in `style.css` targeting `#todoMdViewerExpandBtn` (reuse the existing breakpoint rather than introducing a new one). Watch for an inline `style.display` / `style.cssText` write on the button in `main.js` — inline styles override the stylesheet, so if visibility is set from JS the media query won't take effect; in that case either gate the inline write by viewport width or move it to a class the CSS can override.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
  - Completed: 2026-05-29
