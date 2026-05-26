# TODO List

- [x] **[MEDIUM]** Route inject button to per-project targets and add project routing UI
  - Type: feature
  - Description: Wire the inject button to send entries to the project's configured target, completing the per-project inject-routing feature. Adds a "Project routing" section in the Inject settings modal where each project gets a target dropdown, updates the inject button's handler to include `repo` and `file_path` in the request body based on the active project's target, and introduces a new "no target" inject button state. Depends on Entry 2a having shipped the targets table UI. **Schema precondition: the `target_id uuid` column already exists on the `projects` table, nullable, with FK to `inject_targets(id)` ON DELETE SET NULL. No schema changes are part of this entry â only build behavior against the existing schema.**
    - Behavior:
      1. In the Inject settings modal, add a new "Project routing" section below "Inject targets." The section is a table: one row per project the user owns, columns are project name (left) and target dropdown (right). The dropdown lists "None" + every defined target by nickname, with the project's current `target_id` selection highlighted.
      2. Changing a project's dropdown immediately writes the new `target_id` to Supabase (no separate Save button â autosave). Brief inline confirmation ("Saved") fades after 1.5s near the row.
      3. When there are zero defined targets, the Project routing section shows empty-state copy ("Define a target first to enable project routing") instead of the table.
      4. The inject button on each todo reads the active project's `target_id`. State machine for the button:
         - **Connection not configured** (no Worker URL/secret on this device) â "Configure inject in settings" state, opens settings modal on click. This precedence is unchanged from existing behavior; takes priority over project-target state.
         - **Connection configured, project has no target** (`target_id` is NULL) â new state: visible-but-dimmed, label "Set inject target", clicking opens the settings modal scrolled to the Project routing section.
         - **Connection configured, project has a target, description empty** â invisible (existing behavior).
         - **Connection configured, project has a target, description present, not injected** â "Ready" state (existing purple outline, label "Inject to TODO.md").
         - **Already injected** â "Injected" state (existing green/dim, label "Injected", click is a no-op).
      5. On inject click: resolve the active project's `target_id` to a row from the cached `inject_targets` list, send `{ entry, repo: <target.repo>, filePath: <target.file_path> }` in the POST body with the existing `Authorization: Bearer` header.
      6. The "Test connection" button in the Connection section sends `{ test: true, repo, filePath }` using the *first defined target's* values. If no targets exist yet, the test omits repo/filePath entirely and the Worker falls back to its default target. The status pill reflects which target was tested: "Connected (target: <nickname>)" on success.
      7. The `injectedAt` field on todos stays as a simple timestamp â no need to also store which target the inject went to.
    - Acceptance criteria:
      - The Inject settings modal now shows a Project routing section listing all of the current user's projects with target dropdowns.
      - Changing a dropdown immediately persists `target_id` to Supabase without requiring a Save click.
      - Deleting a target from the Inject targets section sets `target_id` to NULL on any project pointing at it (verifiable by checking the project's dropdown after the delete â should show "None").
      - The inject button on a todo whose project has no target is visible-but-dimmed with the "Set inject target" label, and clicking opens the settings modal focused on Project routing.
      - The inject button on a todo whose project has a target sends `{ entry, repo, filePath }` (verifiable by checking the resulting commit lands in the configured repo).
      - Test connection in the modal correctly indicates which target was tested, and the status pill reflects the target's nickname.
      - Existing todos with `injectedAt` set continue to render their "injected" state regardless of the new field.
      - Projects without a `target_id` (i.e., never routed) render the "no target" inject button state on their todos.
      - As another user (or unauthenticated), the user's project routings are not visible â RLS via the existing projects-table policy is enforced.
    - Implementation notes:
      - State precedence in the inject button: connection-not-configured > project-no-target > description-empty > already-injected > ready. The first applicable state wins. Keeping this explicit prevents confusing "Set inject target" messaging when the deeper issue is missing connection.
      - The "scrolled to Project routing" focus behavior on the settings modal can be a simple `scrollIntoView` on the section's heading after open. No elaborate focus management needed.
      - Project routing autosave: dropdowns change on selection rather than typing, so no debounce. Just `await` the Supabase update on change and show the inline "Saved" feedback on resolve.
      - The Worker is already prepared for this (Entry 1 refactor): unknown repo+filePath combinations return 400, valid ones route correctly. No Worker changes needed.
      - If the user routes a project to a target whose repo isn't in the Worker's `ALLOWED_TARGETS`, the inject will return 400 at runtime. This is acceptable â the error toast surfaces "Target not in allowlist" and the user knows to update the Worker's allowlist plus the GitHub PAT scope. A tooltip on the dropdown or the empty-state copy can mention this once.
      - The inject button state machine has grown â consider extracting it into a small helper function (`getInjectButtonState(todo, project, config)` returning a state constant) to keep `main.js` row-render code readable.
    - Out of scope: Worker-side allowlist management UI; per-target shared secrets (auth stays one secret per Worker); bulk routing operations ("route all projects to target X"); routing history or audit log; surfacing the target nickname on the todo row itself.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-26

- [x] **[HIGH]** Mobile desc editor modal: description never persists across page refresh
  - Type: bug
  - Description: On `(pointer: coarse)` devices, opening a committed todo row routes through `showDescEditorModal` (`modals.js`). The modal's `persist()` function does `item.desc = textarea.value; listLogic.saveToStorage();` and the caller's `onSave` callback only invokes `updateDescIndicator` — no `listLogic.editToDoItem` call. Compare with `onTitleSave` in `openDescEditorForRow` (`toDoRow.js`) which DOES route through `listLogic.editToDoItem(projectName, item)` per the inline comment ("route the mutation through listLogic so the Supabase persistMutation gate fires — saveToStorage in the modal only writes localStorage"). Titles persist; descriptions don't. Two likely contributors stack: (1) `item.desc` is being mutated directly on the row's cached `toDoChild.__item` reference, which may be an orphaned snapshot if any re-render has replaced the canonical item in `listLogic`'s array between row build and modal open; (2) `saveToStorage()` may serialize from a canonical source that never saw the mutation. Fix by mirroring the title path: in `openDescEditorForRow`'s `onSave` callback, call `listLogic.editToDoItem(projectName, item)` (or add a dedicated `editToDoItemDesc` if a narrower API is preferred) AFTER the modal's persist routine assigns `item.desc`, so the description write hits the canonical item and the persistMutation gate fires. Also audit `persist()` in `showDescEditorModal` — if `item` is being passed as a copy anywhere, replace the direct mutation with a callback (`opts.onSave(textarea.value)` taking the new value as an argument) so the caller resolves the canonical item by `projectName` + title key before writing. Add a regression test in `tests/mobileDescEditorModal.test.js` asserting that `onSave` (or the persist routine) reaches `listLogic.editToDoItem` for the desc path, mirroring the existing title-path assertion. Verify locally: open desc editor on touch device, type, close modal, hard-refresh — desc should still be there.
  - File: `toDoList_main/src/modals.js`, `toDoList_main/src/toDoRow.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/tests/mobileDescEditorModal.test.js`
  - Completed: 2026-05-26
