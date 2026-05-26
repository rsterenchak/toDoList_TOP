# TODO List

## Bugs

- [ ] **[LOW]** Fix Delete key not removing project or todo on Mac
  - Description: On Mac, pressing the Delete key (the one labeled "Delete" on a MacBook keyboard, which is actually Backspace) on a selected project or selected todo row does nothing — the item isn't removed. The expected behavior matches the existing Windows/Linux flow: with a project or todo selected, hitting Delete removes it (with the existing confirmation step for destructive actions, per `CLAUDE.md`). Likely cause: the keyboard listener in `main.js` is checking `e.key === "Delete"` only, which corresponds to the forward-delete key (keyCode 46) — that key doesn't exist on most Mac laptop keyboards. The "Delete" key on a MacBook fires `e.key === "Backspace"` (keyCode 8). Fix by accepting both keys in the handler: `if (e.key === "Delete" || e.key === "Backspace")`, while still guarding against firing the delete when an input/textarea/contenteditable has focus (so Backspace inside the rename input or a description textarea still just deletes a character). Grep `main.js` for `"Delete"` and `key ===` to find the relevant handlers — there are likely two (one for project selection, one for todo row selection) and both need the same fix. Confirm the existing destructive-action confirmation still triggers from the Backspace path.
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [ ] **[MEDIUM]** Add one-click "Inject to TODO.md" button with per-device settings modal
  - Description: Add a button inside the expanded description panel of each todo row (and as a button in the mobile edit modal) that sends the description text to a user-configured Cloudflare Worker endpoint, which commits it as a new entry appended to the end of `TODO.md` in this repo. The button is the user's primary handoff path from "wrote up a TODO.md entry in the app's description field" to "entry is in the repo and the Claude Code pipeline can pick it up" — replacing the current copy/paste workflow. The Worker URL and shared secret are configured per-device through a new "Configure inject" entry in the ghost menu, which opens a dedicated settings modal; configuration is stored in `localStorage` and is not committed to the repo or bundled into the deployed build. Assumes a separately-deployed Worker endpoint exists (tracked separately, not part of this entry); this entry is PWA-side only.
    - Behavior:
      1. Add a "Configure inject" row to the ghost menu. Clicking it opens an "Inject settings" modal.
      2. The settings modal contains: a status pill (Not configured / Connected · last tested Xm ago / 401 Unauthorized etc.), a "Worker URL" text input, a "Shared secret" password input with a show/hide eye toggle, and an action row with "Save", "Test connection", and "Clear" buttons (Clear right-aligned, visually separated as destructive). Both inputs use `font-size: 16px` to avoid iOS Safari auto-zoom. Modal closes 3 ways (X button, backdrop click, Escape) per `CLAUDE.md`.
      3. "Save" writes both values to `localStorage` under `todoapp_injectWorkerUrl` and `todoapp_injectSharedSecret`. "Clear" wipes both with a confirmation step per `CLAUDE.md`'s destructive-action rule.
      4. "Test connection" sends `{ test: true }` to the configured Worker URL with the secret in `Authorization: Bearer <secret>`. Worker returns `{ ok: true }` without committing. Result persists as `lastTestedAt` and `lastTestResult` in localStorage so the status pill reflects the most recent test on subsequent modal opens. A toast also fires with the result.
      5. Render an "Inject to TODO.md" button inside each todo's expanded description panel (purple outline matching Void theme, upload icon plus label). Only renders when the description is non-empty. On mobile (`pointer: coarse`), the button lives in the edit modal's button row.
      6. Inject button has four states: invisible (no description), "not configured" (button visible but dimmed, label "Configure inject in settings", clicking opens the settings modal), "ready" (normal purple outline, label "Inject to TODO.md"), and "injected" (green/dim, checkmark icon, label "Injected", clicking is a no-op).
      7. On inject click: disable the button immediately (prevent double-clicks), POST `{ entry: <description text verbatim> }` to the configured Worker URL with the secret in an `Authorization: Bearer` header.
      8. On success: set `injectedAt = Date.now()` on the todo, persist via `listLogic.js`, show a brief success toast, and swap the button to its "injected" state.
      9. On failure (network, 401, 5xx): re-enable the button, show an error toast with the failure reason. `injectedAt` stays null.
    - Acceptance criteria:
      - The "Configure inject" row appears in the ghost menu and opens the settings modal.
      - Worker URL and shared secret persist across reloads via localStorage.
      - Test connection accurately reflects 200 / 401 / network failure / 5xx states in both the status pill and a toast.
      - The show/hide eye toggle on the secret field swaps `type="password"` and `type="text"` without losing input.
      - The inject button is invisible when the todo has no description.
      - The inject button is visible-but-dimmed when no inject config is set, and clicking it opens the settings modal.
      - Clicking inject on a configured device with a populated description results in a new commit on `main` appending the description to `TODO.md`, and the todo's `injectedAt` is persisted.
      - After reload, todos with `injectedAt` set still render the "injected" state.
      - Double-clicking the inject button does not produce two commits.
      - The button works the same in the mobile edit modal as it does in the desktop description panel.
      - Existing todos (loaded from storage without an `injectedAt` field) default to `injectedAt: null` and show the regular inject button.
      - Clearing inject config returns the inject button on all rows to the "not configured" state.
    - Implementation notes:
      - Add `injectedAt: null` to the `toDo.js` factory return shape. Update row-builder paths (`addInitialToDo`, `regenToDos`, `appendNewToDoRow`, `addToDos_restore`) to read it and render the correct inject button state. `listLogic.js` persists it through the existing save path with no special handling needed.
      - Inject config lives only in `localStorage` (`todoapp_injectWorkerUrl`, `todoapp_injectSharedSecret`, `todoapp_injectLastTestedAt`, `todoapp_injectLastTestResult`). Read once on app boot, cache in a module-level variable in `main.js`. On save, update both localStorage and the cached values.
      - No new npm dependencies. Use `fetch` directly. No new modules — settings modal + inject button + config helpers all live in `main.js` (or split into a small `inject.js` mirroring the `music.js` / `pomodoro.js` pattern if it grows past ~200 lines).
      - Reuse the existing toast/notification pattern if one exists; otherwise a lightweight inline approach is fine.
      - The settings modal must use `font-size: 16px+` on both inputs (iOS Safari auto-zoom guard per `CLAUDE.md`).
      - Both modals (settings modal, mobile edit modal) must close 3 ways: X button, backdrop click, Escape.
      - Clear button on the settings modal needs a destructive-action confirmation step per `CLAUDE.md`.
      - The Worker is expected to accept `{ test: true }` as a no-op that returns `{ ok: true }` without writing to GitHub. Worker code is out of scope for this PR but the contract is established here.
    - Out of scope: Deploying or configuring the Cloudflare Worker itself; re-injection of already-injected todos; opening a PR instead of committing direct to main; section-based routing within `TODO.md`; viewing the resulting commit from the badge (the timestamp is local-only for now); cross-device config sync (config is intentionally per-device).
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/toDo.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
