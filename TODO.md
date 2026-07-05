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

- [x] **[MEDIUM]** Make the Agent board reliably settle dispatched runs to a terminal state — Completed: 2026-07-05
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

- [x] **[MEDIUM]** Add in-app triage dispatch — a Run button and auto-fire on answer — Completed: 2026-07-05
  - Type: feature
  - Description: Trigger the triage sweep from inside the Agent tab instead of the Actions tab. Add (1) a project-level Run button in the Agent view header that dispatches `claude-triage.yml` for the active project, and (2) auto-fire — when the user answers a `needs_words` card (which already flips the row to `triaging`), also dispatch a triage sweep, so the follow-up loop goes hands-off. Both go through a new Worker `dispatch_triage` route. Triage is a batch, read-only sweep, so fire-and-forget is fine: the board reflects verdicts live via the existing realtime subscription, with no status polling needed here.
  - Behavior:
    1. The Agent header shows a Run button (beside the AGENT QUEUE chip). Tapping it dispatches a triage sweep for the active project's id and shows a brief "queued" acknowledgment; it neither blocks nor polls — rows update live as triage writes verdicts.
    2. In the answer submit handler (from the answer-wiring entry), after the row flips to `triaging` and persists, also dispatch a triage sweep for the project. If the dispatch call fails, the answer is still saved (row is in `triaging`); surface a non-blocking notice that they may need to Run manually.
    3. Both triggers are guarded by a short in-flight flag so rapid answers or double-taps don't fire redundant sweeps in the same tick; the workflow's concurrency group and batch-all-`triaging` design coalesce anything that overlaps, so at worst it's one extra sweep.
  - Implementation notes:
    - `toDoList_main/src/inject.js`: add `export async function dispatchTriage(projectId, correlationId)` that POSTs `{ dispatch_triage: true, project_id: projectId, correlation_id: correlationId }` via `postToWorker`, mirroring `dispatchRun` — returns `{ ok, ... }` / `{ ok: false, reason }` via `describeError`. Mint the correlation id with `mintEntryId()` (optional; used only for the run-name).
    - `toDoList_main/src/agentView.js`: render the Run button in the header (reuse token/button classes) wired to `dispatchTriage(listLogic.getProjectId(projectName))`; in the existing answer submit handler, call `dispatchTriage(...)` after the successful `answerAgentTask` write. Guard both with a short in-flight flag.
    - Depends on the Worker `dispatch_triage` route being deployed first (dispatches `claude-triage.yml` with `project_id`). Do not inject this entry until that route is live.
    - Run button styling in `style.css`, token vars, ≥36px touch target.
  - Out of scope: a "triage running" spinner or triage status polling (fire-and-forget for now — the realtime subscription surfaces results; an active-runs-for-triage probe is a later nice-to-have); auto-dispatch of drafted/ship runs (that's the auto-ship step, which needs the serialize + diff rails first). Verify by tapping Run with a flagged task present and seeing a run fire and the verdict appear live, and by answering a needs_words card and confirming a sweep auto-fires.
  - File: `toDoList_main/src/inject.js`, `toDoList_main/src/agentView.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 6a45eaaa-92f8-4a04-8c7a-ada4fe6cbc36 -->

- [x] **[HIGH]** Build the needs_mockup launcher — bundle context to Claude and accept the finished entry back — Completed: 2026-07-05
  - Type: feature
  - Description: Give `needs_mockup` cards an exit. `buildSecondary`'s `needs_mockup` branch currently renders a static "Attach a mockup to continue." (~line 297), so the card is a dead-end — triage routes visual tasks here but nothing can progress them. Replace that branch with the launcher hand-off: show the bundle triage captured in `row.context` (region, tokens, change), an "Open mockup" button that copies a ready-to-paste mockup prompt and opens Claude, and a paste-back field that takes the finished TODO.md entry, writes it to the row's `draft`, and flips the row to `drafted` — where the Dispatch card (draft preview + Dispatch button) already ships it. This is a launcher, not an in-app renderer; the mockup discipline stays in the real tooling, and the round-trip is deliberately manual (there's no clean one-tap prefill/return).
  - Behavior:
    1. A `needs_mockup` card shows the context bundle from `row.context` — Region, Tokens, Change — rendering only the fields that are present (triage may not fill all of them), reusing the drafted-card's read-only block styling.
    2. An "Open mockup" button builds a mockup prompt from the task + bundle (see implementation notes), copies it to the clipboard, opens `https://claude.ai/new` in a new tab, and shows a toast confirming the prompt is copied and to paste it into Claude or Claude Design.
    3. A "Paste finished entry" textarea plus a "Save draft" button: on save with non-empty trimmed text, write the pasted text to the row's `draft` and set `state: 'drafted'`. The realtime subscription then moves the card to In progress (drafted), where the existing Dispatch card handles shipping. Empty saves are ignored; the button disables during the write.
    4. On save failure, re-enable and surface a non-blocking error. Textarea `font-size` ≥16px (iOS zoom).
  - Implementation notes:
    - `toDoList_main/src/agentView.js`, the `needs_mockup` branch of `buildSecondary` (~L297): replace the static paragraph with the bundle display + Open mockup button + paste-back textarea/Save. `buildSecondary(row)` receives the row, so `row.id` and `row.context` are in scope. Mirror the needs_words submit pattern already in this function (~L201–296: textarea + `Promise.resolve(listLogic.…).then(...)`) for the Save handler.
    - Reuse `listLogic.setAgentRunState(row.id, { draft: pastedText, state: 'drafted' })` (the Dispatch entry's helper) for the write — the view never writes to `agent_queue` directly.
    - Open-mockup handler: build the prompt as — "I'm working on my toDoList_TOP PWA and need mockups for a UI change, then a finished TODO.md entry.\n\nTask: <context.title>\n<context.description>\n\nContext:\n- Region: <context.region>\n- Tokens: <context.tokens>\n- Change: <context.change>\n\nShow me 2-3 mockup options (A/B/C), let me pick one, then produce a single TODO.md entry in this format: `- [ ] **[PRIORITY]** <title>` with `- Type:` / `- Description:` / `- File:` / `- Completed:` sub-bullets, priority in literal brackets, full repo-relative paths under `toDoList_main/src/`, no id marker." — omit any Context line whose field is empty. Then `await navigator.clipboard.writeText(prompt)` in a try/catch (GitHub Pages is a secure context and the click is a user gesture, so the clipboard API is available), `window.open('https://claude.ai/new', '_blank')`, and toast via `showInjectToast` from `inject.js` (add to the import if not already there).
    - Bundle display, button, and textarea styling in `style.css`, token vars, ≥36px touch targets; reuse the drafted-card block styling for visual consistency.
  - Out of scope: any automated round-trip from Claude back to the row (paste-back is deliberately manual); rendering mockups in-app (the launcher intentionally sends them to the real tooling); the ship step (already built — this hands into the Dispatch card). Verify by running triage to produce a `needs_mockup` card, tapping Open mockup (prompt on clipboard, Claude opens), pasting a finished entry back, and confirming the card flips to drafted with the Dispatch button available.
  - File: `toDoList_main/src/agentView.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 49a99dc5-e702-409b-bc61-6a68264717d3 -->

- [x] **[MEDIUM]** Replace the needs_mockup bundle display with an expandable copy-ready prompt — Completed: 2026-07-05
  - Type: bug
  - Description: The `needs_mockup` card shows the raw context bundle (Region / Tokens / Change) above the Open mockup button, but that bundle is context *for* the prompt, not the prompt itself — and Open mockup copies the real (fuller) prompt silently to the clipboard, so it's ambiguous what the user is meant to paste into Claude. Collapse the two into one visible thing: Open mockup expands a read-only block containing the *actual full prompt* with a Copy button on it, so what the user sees is exactly what they paste. Remove the separate always-visible bundle block and the silent clipboard-write-plus-blank-tab behavior.
  - Behavior:
    1. The `needs_mockup` card shows the task title, an "Open mockup" button, and the paste-back field — but NOT the standalone Region/Tokens/Change block (that content moves into the prompt text).
    2. Tapping "Open mockup" toggles a read-only block showing the full assembled prompt (task + description + the Region/Tokens/Change context + the mockup/entry-format instructions — the same string the handler already builds), with a "Copy" button and an "Open Claude Design" link beside it.
    3. "Copy" writes the prompt to the clipboard (`navigator.clipboard.writeText` in a try/catch) and confirms via toast; on failure it says copy failed rather than swallowing it. The prompt block stays visible so the user can also select-and-copy manually.
    4. "Open Claude Design" opens `https://claude.ai/new` (or the Design entry point) in a new tab — a separate, deliberate tap, so there's no focus race between the copy and the open.
    5. The paste-back textarea + Save draft (write `draft` + `state: 'drafted'` via `setAgentRunState`) is unchanged.
  - Implementation notes:
    - `toDoList_main/src/agentView.js`, the `needs_mockup` branch of `buildSecondary`: remove the always-on bundle `<div>`; build the prompt string (unchanged from the current handler) once and render it inside a read-only, scrollable block that toggles open on the Open mockup button. Reuse the drafted-card read-only block styling.
    - Copy handler: `await navigator.clipboard.writeText(prompt)` in try/catch → `showInjectToast` success/failure. Keep the block visible regardless so manual select-copy works. The Open-Claude link is a plain `window.open(url, '_blank')` on its own control, decoupled from the copy.
    - No `agent_queue`/`listLogic` change — this is display + interaction only on an existing branch.
    - Styling in `style.css`: the toggle, the prompt block, Copy button, and link, token vars, ≥36px targets.
  - Out of scope: in-app mockup rendering (deliberately kept in Claude — the launcher is the boundary); prefilling the Claude chat automatically (no cross-origin way to do it — copy-paste is the primitive); the Save-draft → drafted → Dispatch path (already built).
  - File: `toDoList_main/src/agentView.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 6a22a525-8bce-4312-b1f8-b16985803acd -->

- [x] **[LOW]** Add a capabilities intro note to the empty Claude chat surface — Completed: 2026-07-05
  - Type: feature
  - Description: When the active repo's Claude chat thread is empty, render a persistent instructional note at the top of `#claudeChatSurface` naming what the Sonnet chat can do in scope — draft TODO entries, take file attachments, reframe a task for another repo, and iterate on shipped runs — as one muted sentence. Reuse the existing `.claudeMsg--note` treatment (centered, 0.5px dashed `--border-mid`, transparent bg, `--text-muted` 12px italic) that the transient iterate/follow-up bubbles already use; the simplest path is calling `appendMessageBubble('note', <copy>)` inside `replayChatHistory()` when `chatHistory.length === 0`. Since notes are never persisted into `chatHistory`, give the bubble an id (e.g. `claudeChatIntro`) and remove it in the send path before the first `appendMessageBubble('user', …)` so it doesn't linger above the conversation, then re-render it after the clear-chat reset near `deleteChatHistory(activeChatRepo)`. It shows on any empty thread (per-repo), has no dismiss control, and adds no new persistence — vanilla only, no new deps. Add a `.claudeMsg--intro` modifier in `style.css` only if the note needs different spacing at the top; otherwise no CSS change is required.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: bf3a6fac-2acb-4da2-8512-91b8733ed118 -->

- [x] **[HIGH]** Fix Dispatch race — confirm the injected entry is on main before dispatching the run — Completed: 2026-07-05
  - Type: bug
  - Description: Dispatching a drafted card can fire the run before the freshly-injected entry is visible on main, so the run checks out a stale TODO.md, can't find the entry's marker, and no-op's with a "marker not found / no unchecked tasks" no_change — even though the inject succeeded and the entry lands moments later. `dispatchDraft` (`agentView.js`) calls `dispatchRun` immediately after `injectEntry` returns ok, but GitHub's workflow_dispatch can resolve `main` to a tip that predates the inject commit (dispatch-after-push race). Fix by confirming the entry is on main before dispatching: after a successful inject, poll `readTodoMdFromWorker(target)` until the content contains the entry's `<!-- id: <entryId> -->` marker (short backoff, bounded retries), then dispatch. If the marker doesn't appear within the window, abort with a non-blocking error and leave the row `drafted` rather than firing a doomed run.
  - Behavior:
    1. In `dispatchDraft`, between the successful `injectEntry` and `dispatchRun`, poll `readTodoMdFromWorker(target)` for `<!-- id: <entryId> -->` — up to ~6 attempts with ~800ms between them (roughly a 5s ceiling).
    2. On the first read whose content includes the marker, proceed to `dispatchRun` exactly as today.
    3. If the marker never appears within the attempts, return `{ ok: false, error: 'Entry not yet visible on main — tap Dispatch again' }`; the button re-enables and the row stays `drafted`. No run is dispatched.
    4. A `readTodoMdFromWorker` call that errors (transient) counts as a miss and is retried, not treated as fatal, until the attempt budget is spent.
  - Implementation notes:
    - `toDoList_main/src/agentView.js`, `dispatchDraft` (~L600): import `readTodoMdFromWorker` from `inject.js` (add to the existing import block alongside `injectEntry` / `dispatchRun`). After the `if (!injectResult.ok) return …` guard, insert a bounded poll loop — e.g. `let visible = false; for (let i = 0; i < 6; i++) { const r = await readTodoMdFromWorker(target); if (r && r.ok !== false && typeof r.content === 'string' && r.content.includes('<!-- id: ' + entryId + ' -->')) { visible = true; break; } await new Promise(function (res) { setTimeout(res, 800); }); }` then `if (!visible) return { ok: false, error: 'Entry not yet visible on main — tap Dispatch again' };` — before minting the correlation id and dispatching.
    - Reuses the same on-main read the reconcile path already uses (`readTodoMdFromWorker` checkbox check), so it's the project's established "is it really on main" signal, not the lagging PR/search index.
    - No `agent_queue` / schema / Worker change — client-only, inserted between two existing steps.
  - Out of scope: dispatching against the inject commit's exact SHA (the bulletproof version — needs the Worker's dispatch route to accept a ref plus `injectEntry` surfacing the commit sha; a follow-on only if the read-confirm proves insufficient); the serialize-by-file rails. Verify by dispatching a drafted card and confirming the run only fires once the entry is present on main, and that it ships instead of no-change'ing.
  - File: `toDoList_main/src/agentView.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 7bf2df71-9af9-4915-a0be-debf435490d7 -->

- [x] **[MEDIUM]** Match the Agent view header to the approved mockup — identity, status, and queue counts — Completed: 2026-07-05
  - Type: feature
  - Description: The shipped Agent view header drifted from the approved mockup: `paint()` renders the generic project header (the project name plus an "Agent queue" chip) instead of the dedicated Agent identity the design specified. Bring it in line — replace the project-name + chip with a bolt-icon "Agent" identity block, a lightweight Working/Idle status pill, and a "N flagged · N running · N shipped today" counts subline, keeping the existing Run button. The master-pause control from the mockup is intentionally deferred (nothing auto-dispatches yet).
  - Behavior:
    1. The Agent view header shows, left to right: a rounded-square bolt-icon badge + "Agent" (mono), then on the right a status pill followed by the existing Run button. The redundant project name and "Agent queue" chip are removed (the project name already shows in the top project switcher/tabs).
    2. The status pill reads "Working" with a green dot when any row is in an in-flight workflow state (`triaging` / `dispatched` / `running`), otherwise a muted "Idle". It's an indicator, not a control.
    3. A counts subline under the header row, in mono: "N flagged · N running · N shipped today" — flagged = total queue rows for the project, running = rows in `triaging`/`dispatched`/`running`, shipped today = `shipped` rows whose `updated_at` is today. Segments show even at 0.
    4. Everything below the header (buckets, cards, Not assigned) is unchanged.
  - Implementation notes:
    - `toDoList_main/src/agentView.js`, the header block in `paint()` (~L1138–1149): remove the `name` (projectName) node and the `'Agent queue'` chip; build an identity element — a rounded badge containing `buildBoltIcon()` (already defined in this file for the Give-to-agent pill) plus an "Agent" label — and a right-side group holding the new status pill and the existing Run button (keep the Run wiring intact). Add the counts subline element after the header row.
    - Counts from the loaded `_rows`, recomputed each `paint()` so realtime keeps them live: `flagged = _rows.length`; `running = _rows.filter(r => ['triaging','dispatched','running'].includes(r.state)).length`; `shippedToday = _rows.filter(r => r.state === 'shipped' && r.updated_at && new Date(r.updated_at).toDateString() === new Date().toDateString()).length`. If the board's `agent_queue` select doesn't already fetch `updated_at`, add it to that query in `listLogic.js` so the date filter works.
    - Status pill: "Working"/green when `running > 0`, else muted "Idle".
    - Styling in `style.css`: the identity badge + label, the status pill (green/muted variants), and the counts subline, using existing tokens (accent purple badge, success green for Working, `--text-muted` mono for counts), matching the mockup's spacing; keep ≥36px touch targets on interactive controls.
  - Out of scope: the master-pause button from the mockup (freezes autonomous dispatch, which doesn't exist yet — ships with the auto-dispatch + rails work); card/chip restyling (`STATE_CHIP` labels and card layout already match the mockup). Verify by opening the Agent tab and confirming the header shows the Agent identity + status pill + counts instead of the project name + chip, and that the counts track the board live.
  - File: `toDoList_main/src/agentView.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 50458df6-1d60-465b-93e7-7e339ed46ddc -->

- [x] **[MEDIUM]** Fix Agent view borders defaulting to purple — use --border-mid, not the undefined --border fallback — Completed: 2026-07-05
  - Type: bug
  - Description: Every card, input, and container in the Agent view has a bright purple border instead of the mockup's subtle hairline. Root cause: the Agent CSS declares borders as `var(--border, var(--accent))`, but `--border` is not a token in the design system, so the fallback resolves to `--accent` (#6C5DF5, purple) on every structural element. The rest of the app uses `var(--border-mid)` (#23242e) for card/modal hairlines. Replace the broken `var(--border, …)` fallbacks in the Agent CSS with `var(--border-mid)`, leaving the intentional `var(--accent)` borders on the interactive accent controls untouched.
  - Behavior:
    1. Agent cards, the answer/paste textareas, the draft/prompt read-only blocks, the toast, and the status-pill container render with the neutral `--border-mid` hairline — matching the mockup and the rest of the app.
    2. Purple borders remain only on the deliberate accent controls (bolt badge, Run button, answer Send, Dispatch button, Give-to-agent pill, Open/Start-mockup button) — unchanged.
  - Implementation notes:
    - `toDoList_main/src/style.css`, Agent section (~L4100–4700): replace `var(--border, var(--accent))` and `var(--border, var(--text-muted))` with `var(--border-mid)` on the structural rules — the affected lines are `.agentCard` (~4295), `.agentAnswerInput` (~4384), `.agentDraftBlock` (~4484), `.agentMockupPaste` (~4653), `.agentViewToast` (~4243), the status/counts border (~4183), and `.agentMockupDesignLink` (~4601). Do NOT touch the `var(--accent)` borders on `.agentIdentityBadge`, `.agentRunBtn`, `.agentAnswerSend`, `.agentDispatchButton`, `.agentMockupCopy`, `.agentMockupOpen`, the Give-to-agent pill, or hover/focus states — those accents are intentional and match the mockup.
    - `--border-bright` (#2d2f3d) is the app's emphasized hairline if an input wants a slightly stronger edge; default to `--border-mid` for consistency with the cards.
    - CSS-only; the `--border-mid` token already exists in both light and dark `:root`, so no token or JS change.
  - Out of scope: card/chip layout (already matches). Verify by opening the Agent tab and confirming cards/inputs/blocks show a subtle dark hairline, with purple only on the accent buttons and the bolt badge.
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 7779c5ff-339b-4a9e-aa7e-2f3f874e6eb8 -->

- [x] **[MEDIUM]** Add Shelve + unflag and Retry actions to Stuck (failed / no_change) cards — Completed: 2026-07-05
  - Type: feature
  - Description: Stuck cards (`failed` / `no_change`) render only the run's reason paragraph — the `buildSecondary` `failed`/`no_change` branch (~L305) has no actions, so a stuck task is a dead-end. Add the two controls from the mockup: "Shelve + unflag" (removes the task from the agent queue, returning it to Not-assigned) and "Retry" (re-dispatches the same entry through the run pipeline, reusing the existing marker so it never duplicates the TODO.md entry).
  - Behavior:
    1. A `failed` or `no_change` card shows, below the reason, a "Shelve + unflag" button and a "Retry" button.
    2. Shelve + unflag deletes the `agent_queue` row for that task; the realtime subscription removes the card and the task reappears in Not-assigned (its todo id is no longer in the queue). No confirmation needed.
    3. Retry re-dispatches the task's existing entry: it reuses the row's stored `entry_id` (not a fresh one), so `injectEntry` dedup-skips the already-present marker and the run re-targets the same TODO.md entry — no duplicate append. The row goes back through the dispatch flow (confirm-on-main → dispatch entry mode → poll), moving to In progress and settling at shipped / failed / no_change as usual.
    4. Both buttons disable while their action is in flight; on failure they re-enable and show a non-blocking error. Retry is disabled if the row has neither an `entry_id` nor a `draft`.
  - Implementation notes:
    - `toDoList_main/src/agentView.js`, the `failed`/`no_change` branch of `buildSecondary` (~L305): keep the reason paragraph, then append an actions row with the two buttons, mirroring the Answer/Dispatch button patterns already in this file for pending/error handling and reusing the `agentAnswerActions`/`agentDraftActions` styling.
    - Shelve + unflag: add `listLogic.unflagAgentTask(row.id)` — deletes the row via `supabaseClient` (`.from('agent_queue').delete().eq('id', rowId)`), mirroring `flagTaskForAgent` / `setAgentRunState`. The view calls it, then `refreshAgentQueue(getSelectedProjectName())` on success.
    - Retry: let `dispatchDraft` accept the existing entry id — change its signature to `dispatchDraft(row, draftText, existingEntryId)` with `const entryId = existingEntryId || mintEntryId();` (mint only when none is passed). The Retry handler calls `dispatchDraft(row, (row.draft || '').trim(), row.entry_id)`. This keeps the race-fix confirm-on-main and the poller intact, and because the existing marker is already in TODO.md, `injectEntry` dedup-skips instead of appending a second copy.
    - Button styling in `style.css` reuses the existing action-button treatment; ≥36px touch targets. No schema change (`unflagAgentTask` deletes an existing row; `entry_id` is already persisted by the dispatch flow).
  - Out of scope: a context-preserving "shelved" state (this unflag deletes the row — re-flagging re-triages fresh); correct-and-retry with an added note (blind re-dispatch for now — the two-red cap and thread-based correction are a follow-on); removing the entry from TODO.md on shelve (shelve manages the queue row only). Verify by shelving a stuck card (it leaves, the task returns to Not-assigned) and retrying one (it re-dispatches the same entry with no duplicate in TODO.md).
  - File: `toDoList_main/src/agentView.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 92895192-017e-43e1-9bfa-80e04cff36bd -->
