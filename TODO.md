# TODO List

- [x] **[MEDIUM]** Add inject targets management to the Inject settings modal — Completed: 2026-05-26
  - Type: feature
  - Description: Extend the existing Inject settings modal (currently just connection config) with a new "Inject targets" section that lets the user define and manage routing targets stored in Supabase. Each target is `{ nickname, repo, file_path }` in the `inject_targets` table, scoped per-user via RLS. The section is purely additive — targets are stored but not yet consumed by the inject button (that wiring lands in the next entry). Also refactor the existing connection section to collapse once configured, since the modal is growing. **Schema precondition: the `inject_targets` table already exists in Supabase with columns `id uuid pk`, `user_id uuid` (FK to `auth.users`), `nickname text`, `repo text`, `file_path text default 'TODO.md'`, `created_at`, `updated_at`, a unique constraint on `(user_id, nickname)`, and full RLS policies (SELECT/INSERT/UPDATE/DELETE where `user_id = auth.uid()`). No schema changes are part of this entry — only build UI against the existing schema.**
    - Behavior:
      1. In the Inject settings modal, refactor the existing connection fields into a collapsible "Connection (this device)" section. When no Worker URL or shared secret is configured, the section is auto-expanded. When both are present and the last test succeeded, the section collapses to a one-line summary: status pill + edit icon. Clicking edit re-expands the section. Modal closes 3 ways per `CLAUDE.md` (X / backdrop / Escape).
      2. Add a new "Inject targets" section below Connection. When zero targets exist for the current user, show empty-state copy ("No targets defined yet — add one to start routing") and a prominent "+ Add target" button. When targets exist, show them as rows: nickname (bold) + repo · file_path (muted) + edit icon + trash icon.
      3. Clicking "+ Add target" or the edit icon opens a sub-modal ("Add inject target" or "Edit inject target") with three inputs (nickname, repo, file path) plus Save / Cancel. All inputs use `font-size: 16px` minimum (iOS auto-zoom guard per `CLAUDE.md`). The repo input has a placeholder `owner/repository`. The file path defaults to `TODO.md` on the add flow and shows the existing value on the edit flow.
      4. Save in the sub-modal validates client-side: nickname non-empty, repo matches `owner/name` shape (one slash, no leading/trailing whitespace), file path non-empty. On validation failure, show inline error below the offending field. On success, write to Supabase via the `inject_targets` table; the DB unique constraint catches duplicate nicknames and surfaces as a friendly inline error on the nickname field. Close the sub-modal on success and refresh the targets list in the parent modal.
      5. Trash icon on a target row triggers a confirmation step per `CLAUDE.md`'s destructive-action rule. Copy: "Delete target `<nickname>`? Projects routing to it will become unrouted." Confirm performs the Supabase DELETE; the FK on `projects.target_id` (added separately in next entry) is configured `ON DELETE SET NULL`, so cascading routing cleanup is handled at the DB layer.
      6. Both modal and sub-modal must close 3 ways: X, backdrop, Escape. Sub-modal Escape closes only the sub-modal, leaving parent open.
    - Acceptance criteria:
      - The Inject settings modal now has three visible regions: Connection (collapsible), Inject targets (list + add button), and the existing close affordances.
      - Connection section auto-collapses when both URL and secret are configured and the last test was successful. Edit icon re-expands.
      - "+ Add target" opens a sub-modal with three fields. Save persists a new row to the `inject_targets` table. Cancel discards.
      - Edit icon on a target opens the same sub-modal pre-filled with that target's current values. Save updates the row.
      - Trash icon on a target shows a confirmation, then deletes the row from Supabase on confirm.
      - Adding a target with a nickname that already exists for the current user shows an inline error and does not save (the DB unique constraint is the source of truth; UI surfaces the error gracefully).
      - Empty state (no targets) shows the placeholder copy and add button only — no empty target rows.
      - All inputs in both modals use `font-size: 16px` minimum.
      - Both modals close via X, backdrop, and Escape. Sub-modal Escape does not close the parent.
      - As another user (or unauthenticated), the user's targets are not visible — RLS is enforced.
    - Implementation notes:
      - Targets list is fetched on modal open via the Supabase client (`from('inject_targets').select().order('created_at')`), cached in a module-level variable while the modal is open, re-fetched after any add/edit/delete. No realtime subscriptions needed at this scale.
      - The sub-modal can share styling with the parent modal — same dark surface, same field treatment, just smaller. Reuse existing modal CSS rather than introducing a new variant.
      - The "Edit" icon for the collapsed Connection section is the existing settings/pencil pattern in the app — match what's already there.
      - The inject button on each todo row is NOT updated in this entry. The button still POSTs `{ entry }` and the Worker uses its default target (the first entry in `ALLOWED_TARGETS`). Per-project routing lands in the next entry.
      - No npm dependencies. Use the existing Supabase client wired into the app.
    - Out of scope: Per-project target selection (next entry); changes to the inject button or inject request body; changes to the Worker; bulk target import/export; reordering targets in the list; cross-device realtime target sync.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
     
  
