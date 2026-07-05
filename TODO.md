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
