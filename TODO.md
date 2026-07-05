# TODO LIST

- [ ] **[HIGH]** Make the Dispatch confirm-on-main poll non-blocking — dispatch after best-effort confirmation instead of aborting
  - Type: bug
  - Description: The confirm-on-main poll in `dispatchDraft` aborts with "Entry not yet visible on main" when it can't read the just-injected marker within its window — but GitHub's write→read propagation is variable and the read sometimes lags past the window even though the inject committed, so legitimate dispatches get blocked. Since inject has already committed the entry and the run's own runner-boot latency (tens of seconds) reliably exceeds propagation, the poll should confirm best-effort and then dispatch regardless, never blocking. Change the timeout branch from abort to dispatch-anyway: poll a few seconds for the marker (fast path, dispatch immediately when seen), and if it isn't seen, dispatch anyway with a console warning. A rare genuine race then no-changes and is self-healed by Retry (which reuses the entry id).
  - Behavior:
    1. `dispatchDraft` polls `readTodoMdFromWorker` for the marker for a short window (~8 attempts × 1s). As soon as the marker appears it breaks and dispatches immediately (unchanged fast path).
    2. If the marker doesn't appear within the window, `dispatchDraft` proceeds to `dispatchRun` anyway (logs a `console.warn` that the entry wasn't confirmed on main) rather than returning the "not visible" error. The entry was injected; the run's boot latency covers propagation.
    3. Happy path unchanged: on `dispatchRun` success it persists `dispatched` + `entry_id`/`correlation_id` and the poller tracks it.
    4. The "Entry not yet visible on main — tap Dispatch again" error path is removed.
  - Implementation notes:
    - `toDoList_main/src/agentView.js`, `dispatchDraft`, the confirm-on-main loop: keep the loop and the early-break on marker-found, but after the loop do NOT return the "not visible" error — fall through to the existing `mintEntryId()` correlation + `dispatchRun(...)`. Optionally shorten the loop to ~8×1000ms since it's now a best-effort head start, not a gate. Drop the abort-time `setAgentRunState({ entry_id })` persist (the dispatched-success persist already records `entry_id`); keep the Dispatch button passing `row.entry_id` so Retry/re-dispatch still dedup-skips.
    - Client-only.
  - Out of scope: making the read perfectly consistent (this stops the poll from blocking rather than fixing propagation); dispatching against the commit SHA (workflow_dispatch can't target a SHA). Verify by dispatching a drafted card and confirming it proceeds to a run with no "not visible" error, and the card moves DRAFTED → Queued.
  - File: `toDoList_main/src/agentView.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 18f73313-eba3-4950-8ed4-852aa1bb0a1d -->
