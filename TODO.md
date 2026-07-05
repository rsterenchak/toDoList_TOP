# TODO LIST

- [ ] **[MEDIUM]** Block 'Run Backlog' while a redeploy is in progress from the TODO viewer — Completed: 2026-07-04
  - Type: bug
  - Description: Triggering a redeploy from the TODO.md viewer does not currently prevent 'Run Backlog' from being dispatched, so both can run concurrently and step on each other. Route the viewer's redeploy through the shared active-run state so that while a redeploy is active, the 'Run Backlog' control is disabled (and vice versa), matching how a single project only runs one thing at a time. Set/clear the run-state flag around the redeploy call and have the Run Backlog button read that flag to gate dispatch.
  - File: `toDoList_main/src/runState.js`, `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/claudeSheet.js`
  <!-- id: 512c306b-0e61-40f6-9c3a-261d8c12a735 -->

- [ ] **[HIGH]** Fix Run backlog/Run this entry buttons showing greyed-out/not-allowed state permanently instead of only during an active redeploy
  - Type: bug
  - Description: The greyed-out styling and `cursor: not-allowed` on the Run backlog and Run this entry buttons in `todoMdViewer.js` are currently applied unconditionally (likely a static class/CSS rule) instead of being gated behind the actual redeploy-active state. The buttons must look and behave normally — default pointer cursor, full opacity, clickable — whenever no redeploy is active for the project, and only switch to the greyed/not-allowed state when `setPagesRebuilding(true)` fires or `readActiveRedeploy(projectName)` is truthy at card-mount time; they must revert to normal the instant the redeploy settles (poll-completed, poll-give-up, or failure path). Fix the toggle logic so the blocked class/cursor is added and removed in lockstep with the same redeploy-active signal already driving `setPagesRebuilding`, rather than being present at all times. Acceptance criteria: (a) with no redeploy active, both buttons are fully clickable with a normal cursor; (b) the greyed/not-allowed state appears only while a redeploy owns the project; (c) the state reverts correctly on settle/give-up/failure and on a fresh card mount when no redeploy is active; (d) the previously-added acceptance criteria from the original entry (click-time guard as backstop, in-flight disabled/--loading states, run-pill swap, remount-mid-redeploy correctness) remain intact.
  - File: `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/style.css`
  <!-- id: a8eae79e-33d8-4e8a-82f7-4c253f831255 -->
