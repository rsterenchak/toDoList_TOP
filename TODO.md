# TODO LIST

- [x] **[MEDIUM]** Replace Conceive tab with Agent queue board
  - Type: feature
  - Description: Replace the Conceive view entirely with a new Agent view that renders the autonomous-agent work queue. Remove the Now/Next/Later board and all Conceive code; the Agent tab reads the `agent_queue` Supabase table scoped to the active project and renders it as grouped buckets — Needs you, Stuck, In progress, Shipped — matching the reviewed mockups, with a live realtime subscription so state changes stream in. This entry is the shell plus read/render only; flagging tasks and the follow-up interactions land in later entries.
  - Behavior:
    1. The tab previously wired as Conceive becomes "Agent"; selecting it sets `#mainBar` `data-view="agent"` (replacing the `conceive` value), revealing `#agentView` and hiding the task list, mirroring the existing view-swap CSS.
    2. On entering the view and on project switch, `renderAgentView()` queries `agent_queue` where `project_id` = active project, and renders bucket sections: Needs you (`needs_words`, `needs_mockup`), Stuck (`failed`), In progress (`triaging`, `drafted`, `dispatched`, `running` — running/queued as thin collapsible rows), Shipped (`shipped`). Empty buckets are omitted; a full-empty state shows when there are no rows.
    3. Each card shows a title (from the linked todo / stored context), a state chip, and state-appropriate secondary content (question preview for `needs_words`, `failure_reason` for `failed`, PR/queued status for in-progress). Interactive controls (answer inputs, buttons) render as static affordances here — wiring comes later.
    4. A realtime subscription on `agent_queue` (active project) re-renders on insert/update/delete, mirroring the channel pattern used for projects/todos in `listLogic.js`; the channel tears down on project switch and view exit.
  - Implementation notes:
    - New module `toDoList_main/src/agentView.js` exporting `renderAgentView()` plus a subscribe/unsubscribe pair; model mount/teardown on `conceiveView.js` (which it replaces) and realtime on the `.channel('public:todos').on('postgres_changes', …)` block in `listLogic.js` (~L2858).
    - Read via the shared client from `supabaseClient.js` (`.from('agent_queue')`). This view only reads — no data-model mutations here (those stay in `listLogic.js`).
    - Wire the tab button and `data-view` swap in `main.js` where the Conceive/Structure tabs are handled; update the default-view seed near `main.js` L177 if it referenced `conceive`. Rename the `#conceiveView` container to `#agentView` wherever it's built (`index.js` DOM build, possibly `template.html`).
    - Port the show/hide rules at `style.css` ~L2920–2953 to `data-view="agent"` / `#agentView`; remove the Conceive blocks (~L4101–4283, `.conceive*`). New board styling reuses existing tokens (surface/border/text/accent vars, 10px chip radius); answer inputs get `font-size:16px` to avoid iOS zoom even though inert this entry.
    - Remove `conceiveView.js` and `conceiveShapes.js` and their imports/call sites, but first grep for cross-references — `structureView.js` resolves repos via `resolveProjectRepo` and references Conceive's "Suggest plan" chat path, so preserve any shared helpers (move, don't delete). Conceive's Shipped log is discarded per decision — no migration.
  - Out of scope: the Give-to-agent flag toggle and Not-assigned bucket (next entry); expanding a card into its thread and answering (later entry); any Worker/triage behavior that populates rows — verify this entry by inserting a test `agent_queue` row via SQL.
  - File: `toDoList_main/src/agentView.js`, `toDoList_main/src/main.js`, `toDoList_main/src/index.js`, `toDoList_main/src/template.html`, `toDoList_main/src/conceiveView.js`, `toDoList_main/src/conceiveShapes.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 5ce04d46-c874-445d-b7ba-d0fcfe44311e -->

- [x] **[MEDIUM]** Add Give-to-agent flag toggle and Not-assigned bucket to Agent tab — Completed: 2026-07-04
  - Type: feature
  - Description: Extend the Agent view (from the tab-swap entry) with a Not-assigned bucket — the active project's tasks not yet in the agent queue — each carrying a "Give to agent" control. Tapping it flags the task for the autonomous agent by inserting an `agent_queue` row (state `triaging`, auto true), which the triage sweep then picks up. This is what makes the board fill from a real tap; the flagged task appears in the queue-driven buckets via the realtime subscription already wired in the tab-swap entry.
  - Behavior:
    1. `renderAgentView` renders a Not-assigned bucket at the bottom (after Shipped): the current project's todos whose id is NOT present among the loaded `agent_queue` rows' `todo_id` values. Each row shows the task title and a "Give to agent" pill (bolt icon + label, purple outline), matching the reviewed mockup. Omitted when every task is already queued.
    2. Tapping "Give to agent" inserts one `agent_queue` row for that task: `{ project_id: <active>, todo_id: <task id>, state: 'triaging', auto: true, context: { title, description } }` — the title/description are denormalized into `context` so the triage workflow needs no `todos` access. The button shows a brief pending state and disables while the insert is in flight.
    3. On success, the realtime subscription (from the tab-swap entry) fires and the task moves out of Not-assigned into In progress (triaging) with no manual refresh. On failure the button re-enables and a non-blocking error is surfaced.
    4. Double-flag guard: the button renders only for tasks not already queued, and a pre-insert existence check (or unique constraint) prevents a duplicate row if two devices flag the same task near-simultaneously.
  - Implementation notes:
    - Extend `agentView.js` (from the tab-swap entry) for the Not-assigned bucket and the button handler; read the project's todos from existing `listLogic.js` data (same source the Tasks view uses) and diff against the `agent_queue` rows already loaded for the board.
    - Per the "all data-model mutations route through `listLogic.js`" convention, put the insert in a new `listLogic.js` helper (e.g. `flagTaskForAgent(todoId)`) that builds the row and writes via the shared `supabaseClient.js` (`.from('agent_queue').insert(...)`), mirroring the existing `.from('todos')` writes in `listLogic.js`. `agentView.js` calls it from the click handler; the view never writes directly.
    - The pill reuses existing tokens (purple accent border, 10px chip radius, 36px touch target) — no new styling primitives. It is a real control here, not the inert affordance from the tab-swap entry.
    - `auto` defaults to true (flag = grant an autonomous run), matching the schema default; a draft-only variant is out of scope.
  - Out of scope: the triage that advances the row out of `triaging` (that's `claude-triage.yml` / `.claude/triage.md`); expanding a queued card into its thread and answering (later entry); dispatch of `drafted` rows. Verify by tapping Give-to-agent and confirming a row lands in `agent_queue` and the task hops to In progress live.
  - File: `toDoList_main/src/agentView.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 51c1b1a6-4775-40e1-840a-73e5b1ddd5cd -->

- [x] **[HIGH]** Fix Agent tab crash reading card title from context object — Completed: 2026-07-04
  - Type: bug
  - Description: The Agent board crashes rendering any queued task, blanking the whole tab. In `agentView.js`, `buildCard` (line ~186) derives the card title with `(row.title || row.context || '').trim()`. But `agent_queue` rows have no top-level `title` column — the title lives inside the `context` JSONB (`context.title`, written at flag time as `{ title, description }`). So `row.title` is undefined, the expression falls through to `row.context`, which supabase-js returns as an object, and `.trim()` on an object throws `TypeError: (row.title || row.context || '').trim is not a function`, aborting `paint`/`renderAgentView`. Fix by reading the title from `row.context.title` (guarding for a missing or non-object context), never calling `.trim()` on the raw context object.
  - Behavior:
    1. `buildCard` derives the display title from `row.context.title` when `context` is an object, falling back to `row.title` then `'Untitled entry'`, and never calls a string method on a non-string.
    2. The Agent board renders queued rows without throwing, across every bucket, so a task flagged via Give-to-agent appears immediately (a `triaging` row under In progress) and the Not-assigned bucket renders instead of the whole view blanking.
  - Implementation notes:
    - `toDoList_main/src/agentView.js`, `buildCard` ~line 186. Replace `const text = (row.title || row.context || '').trim() || 'Untitled entry';` with a context-aware read, e.g. `const ctx = (row.context && typeof row.context === 'object') ? row.context : {}; const text = (ctx.title || row.title || '').trim() || 'Untitled entry';`.
    - This is the only site with the wrong assumption. `row.question` (~L121) and `row.failure_reason` (~L149) are real top-level string columns — leave them as-is. `context.description` isn't read here.
    - No schema or write-side change: `context: { title, description }` is the intended shape (written by the flag insert and by the triage routine); only the read was wrong.
  - Out of scope: any change to what triage writes into `context`; the `buildSecondary` question/failure rendering, which is already correct. Verify by flagging a task and confirming the Agent tab renders the card (title from the task) with no console error.
  - File: `toDoList_main/src/agentView.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 9cc26775-ac4b-4d83-be90-fdc888e4c6e0 -->

- [x] **[MEDIUM]** Exclude completed tasks from the Agent tab's Not-assigned bucket — Completed: 2026-07-04
  - Type: bug
  - Description: The Agent view's Not-assigned bucket lists finished tasks alongside open ones. `computeNotAssigned` in `agentView.js` filters items to those with a non-empty title that aren't already in `agent_queue`, but never excludes `completed` todos — so done work shows a "Give to agent" button and inflates the bucket count (currently 268). Add `&& !it.completed` to the filter predicate so only open, unqueued tasks appear; the bucket count is the filtered array's length, so it drops on its own. Completed state lives on the todo object as `completed` (from `toDo.js`'s `{tit, desc, due, pri, pos, completed}` factory).
  - File: `toDoList_main/src/agentView.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 38891d14-e996-4cbd-9983-d80f10b132d1 -->

- [x] **[HIGH]** Wire the Agent tab's needs_words answer input to submit and re-queue — Completed: 2026-07-04
  - Type: feature
  - Description: Complete the deferred answer interaction for `needs_words` cards in the Agent view. The answer textarea built in `buildSecondary` (`agentView.js`, ~line 136) is currently `disabled` — a static affordance from the board's initial build — so the user can't respond to the agent's question. Make it editable and wire submission: on send, append the user's answer to the row's `thread` and flip the row's `state` back to `triaging`, so it re-enters the queue for a re-triage that now carries the answer. The existing realtime subscription then moves the card out of Needs you into In progress on its own (the "re-checking" state).
  - Behavior:
    1. In `buildSecondary` for `needs_words`, the textarea is no longer disabled and accepts input. Add a Send affordance — a button, plus Enter-without-Shift submits and Shift+Enter inserts a newline.
    2. On submit with non-empty trimmed text: disable the input and button (pending), append `{ role: 'user', text: <answer>, ts: <ISO now> }` to the row's existing `thread`, and set `state: 'triaging'`, persisted to `agent_queue`.
    3. On success the realtime subscription re-renders: the card leaves Needs you and appears under In progress (triaging), and the input clears. On failure, re-enable input and button and surface a non-blocking error.
    4. Empty or whitespace-only submissions are ignored (no write).
  - Implementation notes:
    - `toDoList_main/src/agentView.js`, `buildSecondary` (~L118–140): remove `input.disabled = true`; keep `rows = 2` and the 16px font-size (iOS focus zoom). Add the send button and a `keydown` handler on the textarea (Enter without Shift → submit + `preventDefault`; Shift+Enter → newline). `buildSecondary(row)` already receives the row, so `row.id` and `row.thread` are in scope for the handler.
    - Per the "all data-model mutations route through `listLogic.js`" convention, add `listLogic.answerAgentTask(rowId, answerText, currentThread)` that builds `[...(currentThread || []), { role: 'user', text: answerText, ts: new Date().toISOString() }]` and writes `{ thread, state: 'triaging' }` to `agent_queue` where `id = rowId` via `supabaseClient.js` (`.from('agent_queue').update(...)`), mirroring `flagTaskForAgent`. The view calls it and never writes directly.
    - Send-button styling in `style.css`, reusing accent/token vars, ≥36px touch target.
  - Out of scope: auto-dispatching the re-triage when the user answers (the triage workflow is re-run manually for now; auto-dispatch is a Worker addition); the triage routine reading the thread on re-triage (a companion `.claude/triage.md` change, below). Verify by answering a needs_words card and confirming the row's `thread` gains a user message and `state` flips to `triaging` in Supabase, and the card moves to In progress live.
  - File: `toDoList_main/src/agentView.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 58b64ad2-6489-4efb-8a9d-51cf313ca9e3 -->

- [x] **[HIGH]** Add a Dispatch button to drafted Agent cards that ships the draft through the run pipeline — Completed: 2026-07-04
  - Type: feature
  - Description: Give `drafted` cards in the Agent view an outlet. A drafted row currently shows only "Draft ready to dispatch." with no way to act on it. Add a Dispatch button that ships the agent's `draft` through the existing run pipeline: embed a fresh entry-id marker into the draft, inject it into TODO.md, dispatch `claude-run.yml` in entry mode against that id, and track the run to a terminal outcome — writing the row's `state` (dispatched → running → shipped / failed / no_change), `run_id`, and `pr_url` as it progresses. The button press is the review gate (no auto-dispatch here). Reuse the `inject.js` Worker-call chain the Runs-tab author flow already uses.
  - Behavior:
    1. A `drafted` card shows the draft text (`row.draft`, in a read-only scrollable block) plus a Dispatch button, so the user can review before shipping.
    2. On Dispatch: `mintEntryId()` → `embedEntryMarker(row.draft, id)` → `injectEntry({ entry, id, target })`; on inject success, mint a correlation id and `dispatchRun({ mode: 'entry', entryId: id, correlationId, target })`. Persist `entry_id`, `correlation_id`, and `state: 'dispatched'` to the `agent_queue` row; store `run_id` once known. Disable the button during the in-flight sequence. On inject/dispatch failure, surface a non-blocking error, leave `state: 'drafted'`, and re-enable the button.
    3. Poll with `pollRunStatus({ correlationId, target })`, mirroring the Runs-tab poller: while found and in-progress → `state: 'running'`; on completed, reconcile — `conclusion === 'success'` with the marker resolving to a merged PR (`resolveEntryByMarker(id)`) → `state: 'shipped'` + `pr_url`; success with no merged PR → `state: 'no_change'` + the run's closing summary (`fetchRunResult`); a positive-failure conclusion (reuse the Runs-tab `FAILURE_CONCLUSIONS` list) → `state: 'failed'` + summary. Anything else completed (neutral/skipped/no conclusion) stays running rather than flipping to failed.
    4. Each transition persists to `agent_queue`, so the realtime subscription moves the card live: In progress (dispatched/running) → Shipped, or Stuck (failed / no_change). The Shipped card links the PR.
  - Implementation notes:
    - `toDoList_main/src/agentView.js`: in `buildSecondary` for `drafted`, render the draft (read-only) plus the Dispatch button and wire the click to the inject → dispatch → poll sequence. Import from `inject.js`: `mintEntryId`, `embedEntryMarker`, `injectEntry`, `dispatchRun`, `pollRunStatus`, `resolveEntryByMarker`, `fetchRunResult` — the same set `claudeSheet.js` uses (see `claudeSheet.js` ~L1990–2035 for the inject→dispatch sequence and ~L2649–2677 for the poll/reconcile shape).
    - Resolve the dispatch `target` (repo/filePath) for the active project as the rest of the app does; for the toDoList project this is the default target, so an omitted target also works for v1.
    - Per the mutations-in-`listLogic` convention, add `listLogic.setAgentRunState(rowId, patch)` that writes `{ state, run_id?, pr_url?, failure_reason?, entry_id?, correlation_id? }` to `agent_queue` where `id = rowId` via `supabaseClient.js` (`.from('agent_queue').update(...)`), mirroring `flagTaskForAgent` / `answerAgentTask`. agentView calls it at each transition; the view never writes directly.
    - Add a `no_change` entry to `STATE_CHIP` (label "No change") and friendly labels for `dispatched` / `running` if missing; add `no_change` to the Stuck bucket's state list — its rendering already shows `failure_reason`, reuse it for the no-change summary. New styling (draft block, Dispatch button) in `style.css`, token vars, ≥36px touch target.
    - Client-side polling only, matching the Runs tab: the poll runs while the tab is open; if closed mid-run the row stalls at dispatched/running until reopened. A server-side reconcile (or `claude-run.yml` writing the outcome back to `agent_queue`) is a follow-on for hands-off cross-device settling.
  - Out of scope: serialize-by-file (one dispatch at a time) and the post-run diff-scope backstop — next entries; auto-dispatch of drafted rows (later; this button is deliberately the manual review gate); refactoring the Runs-tab poller into shared code (this cut reuses the `inject.js` primitives directly). Verify by tapping Dispatch on a drafted card and confirming an entry lands in TODO.md, `claude-run.yml` fires in entry mode, and the row walks dispatched → running → shipped with a live PR link.
  - File: `toDoList_main/src/agentView.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 75d24f4a-f68e-4c1e-a93b-efee147bbaba -->

- [x] **[MEDIUM]** Recompute the TODO.md viewer card's expanded height when a todo description opens or closes — Completed: 2026-07-04
  - Type: bug
  - Description: When the inline TODO.md viewer card (`#todoMdViewerCard`) is expanded, `applyExpandedHeight()` in `toDoList_main/src/todoMdViewer.js` (around line 1643) computes `body.style.height` once as `mainListRect.bottom - headerRect.bottom - bottomGap`, then only recomputes on window resize or the card's own collapse/expand toggle. Toggling a todo's description open (`wireDescToggle` in `toDoList_main/src/toDoRow.js`, around line 1206) inserts a `#descSibling` row directly into `#mainList` without dispatching `mainListRendered` or calling `applyExpandedHeight()`, shifting every row below it — including the still-expanded viewer card's own header — while the card keeps its stale cached height. With many todo rows the desync is large enough to be visible: the expanded card's body extends past its actual available space and visually overlaps/collides with neighboring todo rows. Fix by recomputing the expanded height whenever a description panel opens or closes elsewhere in the list, e.g. have `wireDescToggle`'s insert/remove of `#descSibling` trigger the existing `applyExpandedHeight()` (or its `viewerResizeHandler` wrapper) so the cached height tracks the live layout instead of a one-time snapshot.
  - File: `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/toDoRow.js`
  <!-- id: 2c00ecf9-0f60-4f4b-ac25-a7d735c91b75 -->

- [ ] **[MEDIUM]** Make the Agent board reliably settle dispatched runs to a terminal state
  - Type: bug
  - Description: A dispatched run can strand a card at `dispatched`/`running` indefinitely — the client poll only lives while the Agent tab is open and doesn't resume on reload, so a run that completes while you're away never gets reconciled (the work ships, the board never catches up). The current shipped-vs-no-change check also uses the closed-PR search (`resolveEntryByMarker`), which lags GitHub's index and can miss a fresh merge. Fix both: on view mount, settle or resume-poll any `agent_queue` rows already in `dispatched`/`running`; and determine "shipped" from the entry's checkbox on main via `readTodoMdFromWorker`, the project's lag-free merge signal, rather than the PR search.
  - Behavior:
    1. On view mount and project switch, read TODO.md once via `readTodoMdFromWorker(target)`, then for each loaded row in `dispatched`/`running`: locate the entry block carrying the row's `entry_id` marker and inspect its checkbox. `- [x]` → settle `state: 'shipped'` immediately (no poll needed, so it works even after the run ages out of the status window). If not checked, (re)start a status poller for that row.
    2. Resumed pollers are guarded so a row already being polled isn't double-polled, kick an immediate one-shot poll so an already-completed run settles at once, and are torn down on view exit / project switch.
    3. A poller's completion reconcile: a positive-failure conclusion (reuse the Runs-tab `FAILURE_CONCLUSIONS`) → `state: 'failed'` + summary; otherwise re-check the checkbox on main — `- [x]` → `shipped`, `- [ ]` still present → `no_change` + the run's closing summary (`fetchRunResult`). `resolveEntryByMarker` is used only best-effort for `pr_url` to link the Shipped card; never block the shipped transition on it (the link can fill in on a later poll).
    4. Each settle persists to `agent_queue`, so the realtime subscription moves the card to Shipped / Stuck live and the poller stops for that row.
  - Implementation notes:
    - `toDoList_main/src/agentView.js`: reuse the poll/reconcile code the Dispatch entry added. Add a mount-time resume step in the paint path that reads TODO.md once and checks all `dispatched`/`running` rows against that single fetch, then starts pollers (keyed by `correlation_id`) only for the not-yet-shipped ones. Use a `runPollers`-style map with a one-shot guard, cleared in the existing teardown (mirror `claudeSheet.js` ~L2623–2645 `startRunPoller`/`stopRunPoller`).
    - Checkbox read: split TODO.md into blank-line-separated blocks (mirror the Worker's `splitTodoBlocks` / `fetchEntryFromTodoMd` boundaries), find the block containing `<!-- id: <entry_id> -->`, and test whether it starts with `- [x]`.
    - Reuse `setAgentRunState` from the Dispatch entry for all state writes; the view never writes directly. No new UI — the Shipped/Stuck cards already render.
  - Out of scope: a fully server-side reconcile (e.g. `claude-run.yml` writing the outcome back to `agent_queue`) — this keeps reconcile client-side but resumes on open, which self-heals the stuck row next time the tab loads; serialize-by-file and the diff-scope backstop (separate entries).
  - File: `toDoList_main/src/agentView.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 00dac2f7-0d17-4850-a1ae-27e51fff72a0 -->
