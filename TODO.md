# TODO LIST

- [ ] **[MEDIUM]** Add a remove (×) control to every non-running Agent card
  - Type: feature
  - Description: Only Stuck cards have an unflag control ("Shelve + unflag"); a `drafted`, `needs_words`, `needs_mockup`, `triaging`, or `shipped` card has no way to be removed from the board, so an abandoned or test task is stranded. Add a compact "×" remove control to every card's header that deletes its `agent_queue` row — returning an unshipped task to Not-assigned and dismissing a shipped one. Show it on all states except `dispatched`/`running` (a run is in flight). Since the × covers removal, drop the now-redundant "Shelve + unflag" button from the Stuck branch and keep just Retry there.
  - Behavior:
    1. Every agent card except those in `dispatched`/`running` shows a small "×" (remove) control in its header, next to the state chip.
    2. Tapping × deletes the row via `unflagAgentTask`; the realtime subscription removes the card. An unshipped task's todo reappears in Not-assigned; a shipped card is simply dismissed.
    3. `dispatched`/`running` cards do not show the × — let the run settle to Shipped/Stuck first.
    4. The Stuck (`failed`/`no_change`) card no longer shows a separate "Shelve + unflag" button — the header × replaces it — but keeps its "Retry" button.
  - Implementation notes:
    - `toDoList_main/src/agentView.js`: in the card header builder (where the state chip is appended to `agentCardHead`), add a small × button for states other than `dispatched`/`running`, wired to `listLogic.unflagAgentTask(row.id)` then `refreshAgentQueue(getSelectedProjectName())` on success (mirror the current Shelve handler). In the `failed`/`no_change` branch of `buildSecondary`, remove the "Shelve + unflag" button (keep "Retry").
    - `unflagAgentTask` already exists (from the Stuck-actions entry) — no new helper.
    - `toDoList_main/src/style.css`: style the header × (small, muted, hover to `--text-warning`), keeping a ≥36px hit area even if visually compact, and make sure it doesn't crowd the title/chip in `agentCardHead`.
  - Out of scope: a confirm dialog (delete is immediate, matching current Shelve behavior); removing a `dispatched`/`running` row mid-flight (excluded — let the run settle); an archive state distinct from delete. Verify by removing a drafted card (it leaves, its task returns to Not-assigned) and confirming Stuck cards now show × + Retry with no separate Shelve button.
  - File: `toDoList_main/src/agentView.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 35480e1d-ae31-4e1a-9541-98d32082ece0 -->
