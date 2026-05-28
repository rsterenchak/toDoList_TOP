# TODO List

- [x] **[LOW]** Add expand/collapse toggle to TODO.md viewer card to fill available space
  - Type: feature
  - Description: The TODO.md viewer's content area is currently a fixed-height scroll box, leaving empty card space below it (especially on desktop) while the user scrolls a cramped window inside. Add an expand/collapse icon button in the card header, immediately to the right of the Sync button, that toggles the content area between its default compact fixed height and an expanded height that fills the available open space below the Completed section. Default state is collapsed. The expanded state grows the content area (scrolling only if the file is longer than the expanded height); collapsing returns it to the compact fixed height. Persist the toggle state per-project in localStorage so each project remembers whether its viewer was left expanded. Match the "Void" styling: `#161622` button fill, `#2a2a38` border, `#9D93EE` icon, sized as a compact icon button (~28px) consistent with the header. Use a diagonal-arrows / expand icon when collapsed and a collapse icon when expanded, with an `aria-label` reflecting the action.
  - Behavior:
    1. Render an expand toggle icon button in the header, right of Sync. Default = collapsed (current fixed-height behavior unchanged).
    2. Tapping expand grows the content area to fill the available space below Completed; the inner content scrolls only when it exceeds that height. The icon and `aria-label` flip to the collapse action.
    3. Tapping collapse returns the content area to the compact fixed height.
    4. Persist the expanded/collapsed boolean per-project under the `todoapp_` localStorage prefix (e.g. `todoapp_todomd_expanded`, keyed by project). On project select / reload, restore that project's last state.
    5. State applies to whichever tab (Rendered / Raw) is active — toggling tabs does not change expand state.
  - Implementation notes:
    - The expanded height must flex into a container with a known/resolved height — a bare flex-fill will silently collapse if the parent chain has no explicit height (same root cause as the prior music-visualizer bar issue). Confirm the card's container resolves a height before relying on flex-grow; otherwise compute the available space explicitly (viewport minus fixed footer minus the elements above the content area).
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
