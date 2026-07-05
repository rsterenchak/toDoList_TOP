# TODO LIST

- [ ] **[MEDIUM]** Block 'Run Backlog' while a redeploy is in progress from the TODO viewer
  - Type: bug
  - Description: Triggering a redeploy from the TODO.md viewer does not currently prevent 'Run Backlog' from being dispatched, so both can run concurrently and step on each other. Route the viewer's redeploy through the shared active-run state so that while a redeploy is active, the 'Run Backlog' control is disabled (and vice versa), matching how a single project only runs one thing at a time. Set/clear the run-state flag around the redeploy call and have the Run Backlog button read that flag to gate dispatch.
  - File: `toDoList_main/src/runState.js`, `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/claudeSheet.js`
  <!-- id: d1c90caa-8fcf-4b16-9c15-cea350f74262 -->
