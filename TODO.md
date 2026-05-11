# TODO List

## Bugs

- [x] **[MEDIUM]** Fix ArrowDown from sidebarToggle landing on first todo instead of first project
  - Description: Pressing ArrowDown while focused on `sidebarToggle` moves focus to the first todo row in the main panel instead of the first project (`projChild`) in the sidebar. Expected behavior is the spatial inverse of the existing ArrowUp transition (top project → sidebarToggle): from sidebarToggle, ArrowDown should focus the first `projChild` in the sidebar, since the sidebar sits directly below the toggle. Likely cause is the ArrowDown handler on `sidebarToggle` either targeting the wrong element (querying the todo list rather than the project list) or being absent entirely so default Tab-style focus order takes over and lands on the first focusable element after the toggle in DOM order.
  - File: `toDoList_main/src/main.js`
  - Completed: 2026-05-10

## Features

- [ ] **[LOW]** Add Sort By chip group to STACK mobile drawer View section
  - Description: The STACK mobile drawer reorganization (Projects/View/Appearance) intentionally shipped without the Sort By chip group from the original STACK spec because no underlying sort state existed yet — wiring a chip group would have introduced new persisted state, contradicting the parent task's "rather than introducing new state" rule. Once a sort feature exists for the project's todo list (e.g., manual / due date / created), add a chip group inside the drawer's View section between "Show completed" and "Expand all descriptions" that mirrors the same state. Use the existing `.drawerToggleRow` styling pattern as a reference; chips should be ≥44px tall for mobile hit targets.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
