# TODO LIST

- [x] **[MEDIUM]** Block 'Run Backlog' while a redeploy is in progress from the TODO viewer — Completed: 2026-07-04
  - Type: bug
  - Description: Triggering a redeploy from the TODO.md viewer does not currently prevent 'Run Backlog' from being dispatched, so both can run concurrently and step on each other. Route the viewer's redeploy through the shared active-run state so that while a redeploy is active, the 'Run Backlog' control is disabled (and vice versa), matching how a single project only runs one thing at a time. Set/clear the run-state flag around the redeploy call and have the Run Backlog button read that flag to gate dispatch.
  - File: `toDoList_main/src/runState.js`, `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/claudeSheet.js`
  <!-- id: d1c90caa-8fcf-4b16-9c15-cea350f74262 -->

- [x] **[MEDIUM]** Grey out Run backlog and Run this entry buttons while a redeploy is in progress — Completed: 2026-07-04
  - Type: feature
  - Description: The viewer's redeploy→run guard is currently click-time only — `runBacklog()` and `runEntry()` in `todoMdViewer.js` refuse via `readActiveRedeploy(projectName)` and a toast, but the buttons still appear fully enabled, unlike the deploy pill which visibly greys out while a run is active. Make the Run backlog and Run this entry buttons reactively grey/disable while a redeploy owns the project, mirroring the deploy pill's existing run-blocked treatment (`syncDeployPillEnabled` and its blocked class in `todoMdViewer.js` / `style.css`). Drive the greying from `setPagesRebuilding(active)` (the single chokepoint for every redeploy transition — tap, poll-completed, poll-give-up, and the failure path, all in the same card closure as the buttons) so the buttons grey when a redeploy starts and un-grey when it settles; also sync from `readActiveRedeploy(projectName)` at card-mount time, since `writeActiveRedeploy`/`clearActiveRedeploy` emit no change event and a remount mid-redeploy would otherwise paint the buttons ungreyed. Acceptance criteria: (a) both buttons grey out within the redeploy lifecycle and restore on settle/give-up/failure; (b) the existing click-time `readActiveRedeploy` guards and toast remain as a backstop; (c) the in-flight `disabled = true`/`--loading` states and the run-pill swap on successful dispatch are not disturbed; (d) greying survives a card remount while a redeploy is active.
  - File: `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/style.css`
  <!-- id: e05d232c-393d-4c4d-ab7a-7451bd92a167 -->
